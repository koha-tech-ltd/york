import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  shell,
  Tray,
  systemPreferences,
  type DesktopCapturerSource
} from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, createWriteStream, unlinkSync, statSync } from 'fs'
import type { WriteStream } from 'fs'
import type {
  AppState,
  BubbleSize,
  MediaDeviceInfoLite,
  RecordOptions,
  RecordResult,
  ScreenshotResult,
  YorkSettings
} from '../shared/types'
import type { ListedSources } from '../shared/types'
import { BUBBLE_SIZES, IPC, bubbleWindowSize } from '../shared/types'
import { convertWebmToMp4, getFfmpegPath } from './ffmpeg'
import { ensureSettingsDirs, loadSettings, saveSettings } from './settings'
import { initPointerHooks, mapPointerNormalized, readPointerSnapshot } from './pointer'
import {
  fetchDesktopSources,
  listCaptureSources,
  overlayWindowOptions,
  screenAccessHelp
} from './captureSources'
import {
  openMacScreenPrivacySettings,
  readScreenAccess,
  requestMacScreenCaptureAccess
} from './macScreenAccess'

let barWindow: BrowserWindow | null = null
let bubbleWindow: BrowserWindow | null = null
let compositorWindow: BrowserWindow | null = null
let tray: Tray | null = null

let recording = false
let saving = false
let cameraEnabled = true
let micEnabled = true
let bubbleSize: BubbleSize = 'M'
let selectedSourceId: string | null = null
let selectedCameraId: string | null = null
let selectedMicId: string | null = null
let elapsedMs = 0
let lastSavedPath: string | null = null
let error: string | null = null
let recordStartedAt = 0
let elapsedTimer: ReturnType<typeof setInterval> | null = null

let webmStream: WriteStream | null = null
let webmPath: string | null = null
let recordResolve: ((result: RecordResult) => void) | null = null
let recordReject: ((err: Error) => void) | null = null
let compositorReady = false
let pointerTimer: ReturnType<typeof setInterval> | null = null
let lastLeftButton = false
let finishInProgress = false
let activeRecordMeta: {
  sourceType: 'screen' | 'window'
  sourceId?: string
  displayId?: number
} | null = null

const isDev = !app.isPackaged

function stopPointerLoop(): void {
  if (pointerTimer) {
    clearInterval(pointerTimer)
    pointerTimer = null
  }
  lastLeftButton = false
  activeRecordMeta = null
}

function startPointerLoop(): void {
  if (pointerTimer) {
    clearInterval(pointerTimer)
    pointerTimer = null
  }
  lastLeftButton = false
  pointerTimer = setInterval(() => {
    if (!recording || !compositorWindow || compositorWindow.isDestroyed() || !activeRecordMeta) {
      return
    }
    const snap = readPointerSnapshot()
    const mapped = mapPointerNormalized(snap, {
      sourceType: activeRecordMeta.sourceType,
      sourceId: activeRecordMeta.sourceId,
      displayId: activeRecordMeta.displayId
    })
    const click = snap.leftButton && !lastLeftButton
    lastLeftButton = snap.leftButton
    compositorWindow.webContents.send(IPC.pointerState, {
      x: mapped.x,
      y: mapped.y,
      zoomTarget: snap.leftAlt ? 2 : 1,
      click
    })
  }, 16)
}

function getState(): AppState {
  return {
    recording,
    saving,
    cameraEnabled,
    micEnabled,
    bubbleSize,
    selectedSourceId,
    selectedCameraId,
    selectedMicId,
    elapsedMs,
    lastSavedPath,
    error,
    settings: loadSettings()
  }
}

function broadcastState(): void {
  const state = getState()
  for (const win of [barWindow, bubbleWindow, compositorWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.stateChanged, state)
    }
  }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function videosYorkDir(): string {
  const dir = loadSettings().videoDir
  ensureDir(dir)
  return dir
}

function picturesYorkDir(): string {
  const dir = loadSettings().screenshotDir
  ensureDir(dir)
  return dir
}

function timestampName(prefix: string, ext: string): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `${prefix}-${stamp}.${ext}`
}

function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

function rendererHtml(name: 'bar' | 'bubble' | 'compositor'): string {
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}/${name}/index.html`
  }
  return join(__dirname, `../renderer/${name}/index.html`)
}

function loadRenderer(win: BrowserWindow, name: 'bar' | 'bubble' | 'compositor'): void {
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(rendererHtml(name))
  } else {
    void win.loadFile(rendererHtml(name))
  }
}

function protectWindow(win: BrowserWindow): void {
  // Prefer true exclusion from capture. On some Windows/Chromium paths,
  // content protection still paints windows as black rectangles in the
  // desktop capture stream — we also hide overlays while recording.
  win.setContentProtection(true)
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
}

/** Hide York UI so it does not appear as black boxes in the recording. */
function hideOverlaysForCapture(): void {
  if (barWindow && !barWindow.isDestroyed()) barWindow.hide()
  if (bubbleWindow && !bubbleWindow.isDestroyed()) bubbleWindow.hide()
}

function restoreOverlaysAfterCapture(): void {
  if (barWindow && !barWindow.isDestroyed()) {
    barWindow.show()
  }
  updateBubbleVisibility()
  refreshTrayMenu()
}

function refreshTrayMenu(): void {
  if (!tray) return
  const items: Electron.MenuItemConstructorOptions[] = []

  if (recording) {
    items.push({
      label: 'Stop recording',
      click: () => {
        void requestStopRecording()
      }
    })
    items.push({ type: 'separator' })
  }

  items.push(
    {
      label: 'Show controls',
      enabled: !recording,
      click: () => {
        if (barWindow && !barWindow.isDestroyed()) {
          barWindow.show()
          barWindow.focus()
        }
      }
    },
    {
      label: 'Hide controls',
      enabled: !recording,
      click: () => barWindow?.hide()
    },
    { type: 'separator' },
    {
      label: 'Quit York',
      click: () => app.quit()
    }
  )

  tray.setContextMenu(Menu.buildFromTemplate(items))
  tray.setToolTip(recording ? `York — recording ${formatTrayElapsed(elapsedMs)}` : 'York')
}

function formatTrayElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

async function requestStopRecording(): Promise<RecordResult | null> {
  if (finishInProgress) return null
  if (!recording || !compositorWindow || compositorWindow.isDestroyed()) return null

  const stopPromise = new Promise<RecordResult>((resolve, reject) => {
    recordResolve = resolve
    recordReject = reject
    compositorWindow!.webContents.send(IPC.compositorStop)
  })

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Stop timed out — try again')), 45000)
  })

  try {
    return await Promise.race([stopPromise, timeout])
  } catch (err) {
    cleanupRecording(false)
    restoreOverlaysAfterCapture()
    throw err
  }
}

function createBarWindow(): BrowserWindow {
  const display = screen.getPrimaryDisplay()
  const { width: sw } = display.workAreaSize
  const barWidth = 460
  const barHeight = 64
  const x = Math.round(display.workArea.x + (sw - barWidth) / 2)
  const y = Math.round(display.workArea.y + 24)

  const win = new BrowserWindow({
    width: barWidth,
    height: barHeight,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  protectWindow(win)
  win.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver')
  loadRenderer(win, 'bar')
  win.once('ready-to-show', () => win.show())
  return win
}

function createBubbleWindow(): BrowserWindow {
  const size = BUBBLE_SIZES[bubbleSize]
  const winSize = bubbleWindowSize(size)
  const display = screen.getPrimaryDisplay()
  const x = Math.round(display.workArea.x + display.workArea.width - winSize - 32)
  const y = Math.round(display.workArea.y + display.workArea.height - winSize - 32)

  const win = new BrowserWindow({
    width: winSize,
    height: winSize,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    thickFrame: false,
    show: false,
    ...overlayWindowOptions(process.platform),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  protectWindow(win)
  win.setBackgroundColor('#00000000')
  win.setHasShadow(false)
  win.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver')
  loadRenderer(win, 'bubble')
  win.once('ready-to-show', () => updateBubbleVisibility())
  return win
}

function createCompositorWindow(): BrowserWindow {
  // Must be a real (off-screen) window — fully hidden windows throttle rAF / captureStream
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    x: -20000,
    y: -20000,
    show: true,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    opacity: 0,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })

  win.setIgnoreMouseEvents(true)
  loadRenderer(win, 'compositor')
  return win
}

function resolveResource(...parts: string[]): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, ...parts)
  }
  return join(app.getAppPath(), 'resources', ...parts)
}

function createTrayIcon(): Electron.NativeImage {
  const trayPath = resolveResource('tray.png')
  if (existsSync(trayPath)) {
    const img = nativeImage.createFromPath(trayPath)
    // Windows tray is typically 16; keep a crisp 32 for HiDPI
    const size = process.platform === 'darwin' ? 22 : 16
    return img.resize({ width: size, height: size, quality: 'best' })
  }

  // Fallback: simple navy mark if asset missing
  const size = 16
  const canvas = Buffer.alloc(size * size * 4)
  const cx = 7.5
  const cy = 7.5
  const r = 6
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx
      const dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      const i = (y * size + x) * 4
      if (dist <= r) {
        canvas[i] = 12
        canvas[i + 1] = 35
        canvas[i + 2] = 64
        canvas[i + 3] = dist > r - 1 ? Math.round(255 * (r - dist)) : 255
      }
    }
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size })
}

function createTray(): void {
  tray = new Tray(createTrayIcon())
  tray.setToolTip('York')
  refreshTrayMenu()
  tray.on('click', () => {
    if (recording) {
      void requestStopRecording()
      return
    }
    if (!barWindow || barWindow.isDestroyed()) return
    if (barWindow.isVisible()) barWindow.hide()
    else {
      barWindow.show()
      barWindow.focus()
    }
  })
}

function applyBubbleSize(size: BubbleSize): void {
  bubbleSize = size
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return
  const dim = bubbleWindowSize(BUBBLE_SIZES[size])
  const bounds = bubbleWindow.getBounds()
  bubbleWindow.setBounds({
    x: bounds.x + bounds.width - dim,
    y: bounds.y + bounds.height - dim,
    width: dim,
    height: dim
  })
}

function updateBubbleVisibility(): void {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return
  // Never show the live bubble while recording — it becomes a black square in capture
  if (cameraEnabled && !recording && !saving) {
    if (process.platform === 'darwin') bubbleWindow.showInactive()
    else bubbleWindow.show()
    bubbleWindow.moveTop()
  } else {
    bubbleWindow.hide()
  }
}

async function listSources(): Promise<ListedSources> {
  const appName = app.isPackaged ? 'York' : 'Electron'
  let listed = await listCaptureSources(desktopCapturer, {
    screenAccess: readScreenAccess(),
    appName
  })
  if (listed.sources.length === 0 && listed.screenAccess === 'granted') {
    for (let i = 0; i < 3 && listed.sources.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 400))
      listed = await listCaptureSources(desktopCapturer, {
        screenAccess: readScreenAccess(),
        appName
      })
    }
  }
  if (!selectedSourceId) {
    const primary = listed.sources.find((s) => s.type === 'screen') ?? listed.sources[0]
    if (primary) {
      selectedSourceId = primary.id
      broadcastState()
    }
  }
  return listed
}

async function requestMediaPermissions(): Promise<void> {
  if (process.platform === 'darwin') {
    try {
      await systemPreferences.askForMediaAccess('camera')
      await systemPreferences.askForMediaAccess('microphone')
    } catch {
      // ignore — user may deny
    }
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.getState, () => getState())

  ipcMain.handle(IPC.getSources, async () => listSources())

  ipcMain.handle(IPC.openScreenPrivacySettings, async () => {
    await openMacScreenPrivacySettings()
  })

  ipcMain.handle(IPC.getMediaDevices, async (): Promise<MediaDeviceInfoLite[]> => {
    // Device enumeration happens in renderer; this is a passthrough placeholder
    // kept for future main-process filtering. Return empty — bar uses navigator.
    return []
  })

  ipcMain.handle(IPC.setCameraEnabled, (_e, enabled: boolean) => {
    cameraEnabled = enabled
    updateBubbleVisibility()
    broadcastState()
  })

  ipcMain.handle(IPC.setMicEnabled, (_e, enabled: boolean) => {
    micEnabled = enabled
    broadcastState()
  })

  ipcMain.handle(IPC.setBubbleSize, (_e, size: BubbleSize) => {
    applyBubbleSize(size)
    broadcastState()
  })

  ipcMain.handle(IPC.setSelectedSource, (_e, id: string | null) => {
    selectedSourceId = id
    broadcastState()
  })

  ipcMain.handle(IPC.setSelectedCamera, (_e, id: string | null) => {
    selectedCameraId = id
    broadcastState()
  })

  ipcMain.handle(IPC.setSelectedMic, (_e, id: string | null) => {
    selectedMicId = id
    broadcastState()
  })

  ipcMain.handle(IPC.setBarExpanded, (_e, expanded: boolean, wide = false) => {
    if (!barWindow || barWindow.isDestroyed()) return
    const bounds = barWindow.getBounds()
    const width = expanded ? (wide ? 360 : 320) : 460
    const height = expanded ? 460 : 64
    const centerX = bounds.x + bounds.width / 2
    const x = Math.round(centerX - width / 2)
    barWindow.setBounds({ x, y: bounds.y, width, height })
  })

  ipcMain.handle(IPC.openSavedFolder, async (_e, filePath: string) => {
    if (filePath && existsSync(filePath)) {
      shell.showItemInFolder(filePath)
    }
  })

  ipcMain.handle(IPC.openPath, async (_e, dirPath: string) => {
    if (dirPath) {
      ensureDir(dirPath)
      await shell.openPath(dirPath)
    }
  })

  ipcMain.handle(IPC.getSettings, (): YorkSettings => ensureSettingsDirs(loadSettings()))

  ipcMain.handle(IPC.chooseVideoDir, async (): Promise<YorkSettings> => {
    const current = loadSettings()
    const result = await dialog.showOpenDialog(barWindow!, {
      title: 'Choose folder for recordings',
      defaultPath: current.videoDir,
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return current
    const next = saveSettings({ videoDir: result.filePaths[0] })
    ensureSettingsDirs(next)
    broadcastState()
    return next
  })

  ipcMain.handle(IPC.chooseScreenshotDir, async (): Promise<YorkSettings> => {
    const current = loadSettings()
    const result = await dialog.showOpenDialog(barWindow!, {
      title: 'Choose folder for screenshots',
      defaultPath: current.screenshotDir,
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return current
    const next = saveSettings({ screenshotDir: result.filePaths[0] })
    ensureSettingsDirs(next)
    broadcastState()
    return next
  })

  ipcMain.handle(IPC.clearError, () => {
    error = null
    broadcastState()
  })

  ipcMain.handle(IPC.getDesktopSourceId, async (_e, sourceId: string) => {
    return sourceId
  })

  ipcMain.on(IPC.bubbleDrag, (_e, delta: { dx: number; dy: number }) => {
    if (!bubbleWindow || bubbleWindow.isDestroyed()) return
    const b = bubbleWindow.getBounds()
    bubbleWindow.setPosition(b.x + Math.round(delta.dx), b.y + Math.round(delta.dy))
  })

  ipcMain.on(IPC.compositorReady, () => {
    compositorReady = true
  })

  ipcMain.on(IPC.compositorChunk, (_e, chunk: ArrayBuffer) => {
    if (webmStream) {
      webmStream.write(Buffer.from(chunk))
    }
  })

  ipcMain.on(IPC.compositorDone, () => {
    void finishRecording()
  })

  ipcMain.on(IPC.compositorError, (_e, message: string) => {
    error = message
    broadcastState()
    if (recordReject) {
      recordReject(new Error(message))
      recordResolve = null
      recordReject = null
    }
    cleanupRecording(false)
    restoreOverlaysAfterCapture()
  })

  ipcMain.handle(IPC.startRecord, async (_e, options: RecordOptions): Promise<{ started: true }> => {
    if (recording) {
      throw new Error('Already recording')
    }
    error = null
    selectedSourceId = options.sourceId

    if (!compositorWindow || compositorWindow.isDestroyed()) {
      compositorWindow = createCompositorWindow()
      compositorReady = false
    }

    if (!compositorReady) {
      await new Promise<void>((resolve) => {
        const started = Date.now()
        const check = (): void => {
          if (compositorReady) resolve()
          else if (Date.now() - started > 5000) resolve()
          else setTimeout(check, 50)
        }
        check()
      })
    }

    const tmpDir = join(app.getPath('temp'), 'york')
    ensureDir(tmpDir)
    webmPath = join(tmpDir, timestampName('recording', 'webm'))
    webmStream = createWriteStream(webmPath)

    const display =
      options.displayId != null
        ? screen.getAllDisplays().find((d) => d.id === options.displayId)
        : screen.getPrimaryDisplay()
    activeRecordMeta = {
      sourceType: options.sourceType,
      sourceId: options.sourceId,
      displayId: options.displayId ?? display?.id
    }

    recording = true
    recordStartedAt = Date.now()
    elapsedMs = 0
    broadcastState()
    refreshTrayMenu()

    // Hide overlays BEFORE capture starts — transparent Electron windows
    // show up as solid black rectangles in desktopCapturer.
    hideOverlaysForCapture()
    await new Promise<void>((resolve) => setTimeout(resolve, 250))

    elapsedTimer = setInterval(() => {
      elapsedMs = Date.now() - recordStartedAt
      broadcastState()
      if (tray) {
        tray.setToolTip(`York — recording ${formatTrayElapsed(elapsedMs)}`)
      }
    }, 250)

    startPointerLoop()
    compositorWindow.webContents.send(IPC.compositorStart, options)
    return { started: true }
  })

  ipcMain.handle(IPC.stopRecord, async (): Promise<RecordResult | null> => {
    return requestStopRecording()
  })

  ipcMain.handle(IPC.takeScreenshot, async (): Promise<ScreenshotResult> => {
    if (!selectedSourceId) {
      await listSources()
    }
    const resolvedId = selectedSourceId
    if (!resolvedId) {
      const appName = app.isPackaged ? 'York' : 'Electron'
      throw new Error(
        screenAccessHelp(readScreenAccess(), { appName }) ?? 'Select a screen or window first'
      )
    }

    const type = resolvedId.startsWith('screen:') ? ('screen' as const) : ('window' as const)
    let sources: DesktopCapturerSource[]
    try {
      sources = await desktopCapturer.getSources({
        types: [type],
        thumbnailSize: { width: 3840, height: 2160 }
      })
    } catch {
      const appName = app.isPackaged ? 'York' : 'Electron'
      throw new Error(
        screenAccessHelp(readScreenAccess(), { appName }) ??
          'Could not capture. Grant Screen Recording, then quit from the tray and reopen York.'
      )
    }
    const source = sources.find((s) => s.id === resolvedId)
    if (!source) {
      throw new Error('Capture source not found')
    }

    const png = source.thumbnail.toPNG()
    const outPath = join(picturesYorkDir(), timestampName('screenshot', 'png'))
    writeFileSync(outPath, png)
    lastSavedPath = outPath
    broadcastState()
    return { path: outPath }
  })
}

async function finishRecording(): Promise<void> {
  if (finishInProgress) return
  finishInProgress = true

  stopPointerLoop()
  const duration = Date.now() - recordStartedAt
  if (elapsedTimer) {
    clearInterval(elapsedTimer)
    elapsedTimer = null
  }

  recording = false
  saving = true
  elapsedMs = duration
  broadcastState()
  refreshTrayMenu()

  await new Promise<void>((resolve) => setTimeout(resolve, 150))

  await new Promise<void>((resolve) => {
    if (!webmStream) {
      resolve()
      return
    }
    webmStream.end(() => resolve())
  })
  webmStream = null

  const input = webmPath
  webmPath = null

  if (!input || !existsSync(input) || statSync(input).size < 1024) {
    saving = false
    finishInProgress = false
    cleanupRecording(false)
    restoreOverlaysAfterCapture()
    const msg = 'Recording was too short or incomplete — hold for a couple of seconds before stopping'
    error = msg
    broadcastState()
    recordReject?.(new Error(msg))
    recordResolve = null
    recordReject = null
    return
  }

  try {
    const outPath = join(videosYorkDir(), timestampName('recording', 'mp4'))
    await convertWebmToMp4(input, outPath)
    try {
      unlinkSync(input)
    } catch {
      // ignore
    }
    lastSavedPath = outPath
    error = null
    saving = false
    finishInProgress = false
    restoreOverlaysAfterCapture()
    broadcastState()
    recordResolve?.({ path: outPath, durationMs: duration })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    error = msg
    saving = false
    finishInProgress = false
    restoreOverlaysAfterCapture()
    broadcastState()
    recordReject?.(new Error(msg))
  }

  recordResolve = null
  recordReject = null
}

function cleanupRecording(keepFile: boolean): void {
  stopPointerLoop()
  if (elapsedTimer) {
    clearInterval(elapsedTimer)
    elapsedTimer = null
  }
  if (webmStream) {
    webmStream.end()
    webmStream = null
  }
  if (!keepFile && webmPath && existsSync(webmPath)) {
    try {
      unlinkSync(webmPath)
    } catch {
      // ignore
    }
  }
  webmPath = null
  recording = false
  saving = false
  finishInProgress = false
  restoreOverlaysAfterCapture()
  broadcastState()
}

app.whenReady().then(async () => {
  void getFfmpegPath()
  initPointerHooks()
  ensureSettingsDirs(loadSettings())
  await requestMediaPermissions()
  requestMacScreenCaptureAccess()

  // Allow camera / mic / display capture from our windows
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['media', 'mediaKeySystem', 'display-capture'].includes(permission)
    callback(allowed)
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return ['media', 'mediaKeySystem', 'display-capture'].includes(permission)
  })

  // Prefer explicit source id from our UI when getDisplayMedia is used
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await fetchDesktopSources(desktopCapturer)
      const preferred =
        (selectedSourceId && sources.find((s) => s.id === selectedSourceId)) ||
        sources.find((s) => s.id.startsWith('screen:')) ||
        sources[0]
      if (!preferred) {
        callback({})
        return
      }
      callback({ video: preferred as DesktopCapturerSource, audio: 'loopback' })
    } catch {
      callback({})
    }
  })

  registerIpc()

  barWindow = createBarWindow()
  bubbleWindow = createBubbleWindow()
  compositorWindow = createCompositorWindow()
  createTray()

  globalShortcut.register('CommandOrControl+Shift+Y', () => {
    if (recording) void requestStopRecording()
  })

  // Default source: primary screen
  const listed = await listSources()
  const primary = listed.sources.find((s) => s.type === 'screen') ?? listed.sources[0]
  if (primary) {
    selectedSourceId = primary.id
  }

  updateBubbleVisibility()
  broadcastState()

  app.on('activate', () => {
    if (recording || saving) return
    if (barWindow && !barWindow.isDestroyed()) {
      barWindow.show()
    }
  })
})

app.on('window-all-closed', () => {
  // Keep running via tray on all platforms for Loom-like UX
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('before-quit', () => {
  if (recording && compositorWindow) {
    compositorWindow.webContents.send(IPC.compositorStop)
  }
})
