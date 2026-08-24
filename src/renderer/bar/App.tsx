import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppState, BubbleSize, CaptureSource, MediaDeviceInfoLite } from '../../shared/types'

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

type MenuId = 'camera' | 'mic' | 'source' | 'settings' | null

function shortPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts.slice(-2).join('/')
}

export function BarApp(): JSX.Element {
  const [state, setState] = useState<AppState | null>(null)
  const [menu, setMenu] = useState<MenuId>(null)
  const [sources, setSources] = useState<CaptureSource[]>([])
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [cameras, setCameras] = useState<MediaDeviceInfoLite[]>([])
  const [mics, setMics] = useState<MediaDeviceInfoLite[]>([])
  const [micLevel, setMicLevel] = useState(0)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ text: string; path?: string; error?: boolean } | null>(
    null
  )
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const seenErrorRef = useRef<string | null>(null)

  useEffect(() => {
    if (!window.york) return
    void window.york.getState().then(setState)
    return window.york.onStateChanged(setState)
  }, [])

  // Surface main-process errors once as a toast, then clear sticky state
  useEffect(() => {
    if (!state?.error || state.error === seenErrorRef.current) return
    seenErrorRef.current = state.error
    setToast({ text: state.error, error: true })
    const t = setTimeout(() => {
      setToast(null)
      void window.york.clearError()
    }, 4500)
    return () => clearTimeout(t)
  }, [state?.error])

  const refreshDevices = useCallback(async () => {
    try {
      // Prompt permissions so labels populate
      // Audio-only probe so we do not steal the camera from the bubble
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      probe.getTracks().forEach((t) => t.stop())
    } catch {
      // continue with whatever we can list
    }

    const devices = await navigator.mediaDevices.enumerateDevices()
    setCameras(
      devices
        .filter((d) => d.kind === 'videoinput')
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || 'Camera',
          kind: 'videoinput' as const
        }))
    )
    setMics(
      devices
        .filter((d) => d.kind === 'audioinput')
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || 'Microphone',
          kind: 'audioinput' as const
        }))
    )
  }, [])

  const refreshSources = useCallback(async () => {
    try {
      const result = await window.york.getSources()
      setSources(result.sources)
      setSourceError(result.error)
    } catch (err) {
      setSources([])
      setSourceError(err instanceof Error ? err.message : 'Could not list screens or windows')
    }
  }, [])

  useEffect(() => {
    void refreshDevices()
    void refreshSources()
    const onChange = (): void => {
      void refreshDevices()
    }
    navigator.mediaDevices.addEventListener('devicechange', onChange)
    return () => navigator.mediaDevices.removeEventListener('devicechange', onChange)
  }, [refreshDevices, refreshSources])

  // Mic meter
  useEffect(() => {
    let cancelled = false

    async function setupMeter(): Promise<void> {
      stopMeter()
      if (!state?.micEnabled) {
        setMicLevel(0)
        return
      }
      try {
        const constraints: MediaStreamConstraints = {
          audio: state.selectedMicId
            ? { deviceId: { exact: state.selectedMicId } }
            : true
        }
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        micStreamRef.current = stream
        const ctx = new AudioContext()
        audioCtxRef.current = ctx
        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        analyserRef.current = analyser
        const data = new Uint8Array(analyser.frequencyBinCount)

        const tick = (): void => {
          analyser.getByteFrequencyData(data)
          let sum = 0
          for (let i = 0; i < data.length; i++) sum += data[i]
          const avg = sum / data.length / 255
          setMicLevel(avg)
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      } catch {
        setMicLevel(0)
      }
    }

    function stopMeter(): void {
      cancelAnimationFrame(rafRef.current)
      micStreamRef.current?.getTracks().forEach((t) => t.stop())
      micStreamRef.current = null
      void audioCtxRef.current?.close()
      audioCtxRef.current = null
      analyserRef.current = null
    }

    void setupMeter()
    return () => {
      cancelled = true
      stopMeter()
    }
  }, [state?.micEnabled, state?.selectedMicId])

  const showToast = (text: string, path?: string): void => {
    setToast({ text, path })
    setTimeout(() => setToast(null), 3500)
  }

  const toggleMenu = (id: MenuId): void => {
    setMenu((prev) => {
      const next = prev === id ? null : id
      const wide = next === 'settings' || next === 'source'
      void window.york.setBarExpanded(next !== null, wide)
      return next
    })
    if (id === 'source') void refreshSources()
    if (id === 'camera' || id === 'mic') void refreshDevices()
  }

  const onRecord = async (): Promise<void> => {
    if (!state) return
    setMenu(null)
    void window.york.setBarExpanded(false)
    void window.york.clearError()

    if (state.recording) {
      try {
        const result = await window.york.stopRecord()
        if (result) showToast(`Saved ${shortPath(result.path)}`, result.path)
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Recording failed')
      }
      return
    }

    if (state.saving) return

    setBusy(true)
    try {
      if (!state.selectedSourceId) {
        showToast('Pick a screen or window first')
        return
      }
      const source = sources.find((s) => s.id === state.selectedSourceId)
      await window.york.startRecord({
        sourceId: state.selectedSourceId,
        sourceType: source?.type ?? 'screen',
        cameraEnabled: state.cameraEnabled,
        cameraDeviceId: state.selectedCameraId,
        micEnabled: state.micEnabled,
        micDeviceId: state.selectedMicId,
        bubbleSize: state.bubbleSize,
        pip: { x: 0.78, y: 0.72 },
        displayId: source?.displayId
      })
      showToast('Recording… click the York tray icon to stop')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Recording failed')
    } finally {
      setBusy(false)
    }
  }

  const onScreenshot = async (): Promise<void> => {
    setBusy(true)
    setMenu(null)
    void window.york.setBarExpanded(false)
    void window.york.clearError()
    try {
      const result = await window.york.takeScreenshot()
      showToast(`Saved ${shortPath(result.path)}`, result.path)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Screenshot failed')
    } finally {
      setBusy(false)
    }
  }

  if (!state) {
    return <div className="pill loading">Loading…</div>
  }

  return (
    <div className="shell">
      <div className="pill">
        <div className="drag" />
        <IconButton
          title="Camera"
          active={state.cameraEnabled}
          onClick={() => toggleMenu('camera')}
          label="Cam"
        >
          <CamIcon on={state.cameraEnabled} />
        </IconButton>
        <IconButton
          title="Microphone"
          active={state.micEnabled}
          onClick={() => toggleMenu('mic')}
          label="Mic"
        >
          <MicIcon on={state.micEnabled} level={micLevel} />
        </IconButton>
        <IconButton
          title="Screen or window"
          active={!!state.selectedSourceId}
          onClick={() => toggleMenu('source')}
          label="Screen"
        >
          <ScreenIcon />
        </IconButton>
        <div className="divider" />
        <IconButton title="Screenshot" onClick={() => void onScreenshot()} disabled={busy}>
          <ShotIcon />
        </IconButton>
        <IconButton
          title="Settings"
          active={menu === 'settings'}
          onClick={() => toggleMenu('settings')}
        >
          <CogIcon />
        </IconButton>
        <button
          className={`record ${state.recording || state.saving ? 'recording' : ''}`}
          onClick={() => void onRecord()}
          disabled={(!state.recording && busy) || state.saving}
          title={
            state.saving
              ? 'Saving recording…'
              : state.recording
                ? 'Stop recording'
                : 'Start recording'
          }
        >
          <span className="record-dot" />
          <span className="record-label">
            {state.saving
              ? 'Saving…'
              : state.recording
                ? formatElapsed(state.elapsedMs)
                : 'Rec'}
          </span>
        </button>
      </div>

      {menu === 'camera' && (
        <MenuPanel onClose={() => setMenu(null)}>
          <MenuRow
            label={state.cameraEnabled ? 'Camera on' : 'Camera off'}
            onClick={() => void window.york.setCameraEnabled(!state.cameraEnabled)}
          />
          <MenuSection title="Device" />
          {cameras.length === 0 && <MenuHint>No cameras found</MenuHint>}
          {cameras.map((c) => (
            <MenuRow
              key={c.deviceId}
              label={c.label}
              selected={state.selectedCameraId === c.deviceId || (!state.selectedCameraId && c === cameras[0])}
              onClick={() => void window.york.setSelectedCamera(c.deviceId)}
            />
          ))}
          <MenuSection title="Bubble size" />
          {(['S', 'M', 'L'] as BubbleSize[]).map((size) => (
            <MenuRow
              key={size}
              label={size === 'S' ? 'Small' : size === 'M' ? 'Medium' : 'Large'}
              selected={state.bubbleSize === size}
              onClick={() => void window.york.setBubbleSize(size)}
            />
          ))}
        </MenuPanel>
      )}

      {menu === 'mic' && (
        <MenuPanel onClose={() => setMenu(null)}>
          <MenuRow
            label={state.micEnabled ? 'Microphone on' : 'Microphone off'}
            onClick={() => void window.york.setMicEnabled(!state.micEnabled)}
          />
          <div className="meter">
            <div className="meter-fill" style={{ width: `${Math.min(100, micLevel * 180)}%` }} />
          </div>
          <MenuSection title="Device" />
          {mics.length === 0 && <MenuHint>No microphones found</MenuHint>}
          {mics.map((m) => (
            <MenuRow
              key={m.deviceId}
              label={m.label}
              selected={state.selectedMicId === m.deviceId || (!state.selectedMicId && m === mics[0])}
              onClick={() => void window.york.setSelectedMic(m.deviceId)}
            />
          ))}
        </MenuPanel>
      )}

      {menu === 'source' && (
        <MenuPanel onClose={() => setMenu(null)} wide>
          {sourceError && (
            <>
              <MenuHint>{sourceError}</MenuHint>
              <MenuRow
                label="Open Screen Recording settings…"
                onClick={() => void window.york.openScreenPrivacySettings()}
              />
            </>
          )}
          <MenuSection title="Displays" />
          {sources.filter((s) => s.type === 'screen').length === 0 && !sourceError && (
            <MenuHint>No displays found</MenuHint>
          )}
          {sources
            .filter((s) => s.type === 'screen')
            .map((s) => (
              <SourceRow
                key={s.id}
                source={s}
                selected={state.selectedSourceId === s.id}
                onClick={() => {
                  void window.york.setSelectedSource(s.id)
                  void window.york.setBarExpanded(false)
                  setMenu(null)
                }}
              />
            ))}
          <MenuSection title="Windows" />
          {sources.filter((s) => s.type === 'window').length === 0 && !sourceError && (
            <MenuHint>No windows found</MenuHint>
          )}
          {sources
            .filter((s) => s.type === 'window')
            .map((s) => (
              <SourceRow
                key={s.id}
                source={s}
                selected={state.selectedSourceId === s.id}
                onClick={() => {
                  void window.york.setSelectedSource(s.id)
                  void window.york.setBarExpanded(false)
                  setMenu(null)
                }}
              />
            ))}
        </MenuPanel>
      )}

      {menu === 'settings' && (
        <MenuPanel onClose={() => setMenu(null)} wide>
          <MenuSection title="Save recordings to" />
          <div className="path-block">{state.settings.videoDir}</div>
          <MenuRow
            label="Change video folder…"
            onClick={() => void window.york.chooseVideoDir()}
          />
          <MenuRow
            label="Open video folder"
            onClick={() => void window.york.openPath(state.settings.videoDir)}
          />
          <MenuSection title="Save screenshots to" />
          <div className="path-block">{state.settings.screenshotDir}</div>
          <MenuRow
            label="Change screenshot folder…"
            onClick={() => void window.york.chooseScreenshotDir()}
          />
          <MenuRow
            label="Open screenshot folder"
            onClick={() => void window.york.openPath(state.settings.screenshotDir)}
          />
          {state.lastSavedPath && (
            <>
              <MenuSection title="Last saved" />
              <div className="path-block">{state.lastSavedPath}</div>
              <MenuRow
                label="Show in folder"
                onClick={() => void window.york.openSavedFolder(state.lastSavedPath!)}
              />
            </>
          )}
        </MenuPanel>
      )}

      {toast && (
        <button
          type="button"
          className={`toast ${toast.error ? 'error' : ''} ${toast.path ? 'clickable' : ''}`}
          onClick={() => {
            if (toast.path) void window.york.openSavedFolder(toast.path)
          }}
          title={toast.path ? 'Show in folder' : undefined}
        >
          {toast.text}
        </button>
      )}

      <style>{barCss}</style>
    </div>
  )
}

function IconButton(props: {
  children: React.ReactNode
  onClick: () => void
  title: string
  active?: boolean
  disabled?: boolean
  label?: string
}): JSX.Element {
  return (
    <button
      className={`icon-btn ${props.active ? 'active' : ''}`}
      onClick={props.onClick}
      title={props.title}
      disabled={props.disabled}
      type="button"
    >
      {props.children}
    </button>
  )
}

function MenuPanel(props: {
  children: React.ReactNode
  onClose: () => void
  wide?: boolean
}): JSX.Element {
  return (
    <div className={`menu ${props.wide ? 'wide' : ''}`}>
      <div
        className="menu-backdrop"
        onClick={() => {
          void window.york.setBarExpanded(false)
          props.onClose()
        }}
      />
      <div className="menu-body">{props.children}</div>
    </div>
  )
}

function MenuSection(props: { title: string }): JSX.Element {
  return <div className="menu-section">{props.title}</div>
}

function MenuHint(props: { children: React.ReactNode }): JSX.Element {
  return <div className="menu-hint">{props.children}</div>
}

function MenuRow(props: {
  label: string
  onClick: () => void
  selected?: boolean
}): JSX.Element {
  return (
    <button className={`menu-row ${props.selected ? 'selected' : ''}`} onClick={props.onClick}>
      <span>{props.label}</span>
      {props.selected && <span className="check">✓</span>}
    </button>
  )
}

function SourceRow(props: {
  source: CaptureSource
  selected: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      className={`source-row ${props.selected ? 'selected' : ''}`}
      onClick={props.onClick}
    >
      {props.source.thumbnailDataUrl ? (
        <img src={props.source.thumbnailDataUrl} alt="" />
      ) : (
        <span className="source-thumb" />
      )}
      <span>{props.source.name}</span>
    </button>
  )
}

function CamIcon({ on }: { on: boolean }): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="7"
        width="12"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="2"
        opacity={on ? 1 : 0.45}
      />
      <path d="M15 10l5-2v8l-5-2v-4z" fill="currentColor" opacity={on ? 1 : 0.45} />
      {!on && <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2" />}
    </svg>
  )
}

function MicIcon({ on, level }: { on: boolean; level: number }): JSX.Element {
  return (
    <span className="mic-wrap">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <rect
          x="9"
          y="3"
          width="6"
          height="11"
          rx="3"
          stroke="currentColor"
          strokeWidth="2"
          opacity={on ? 1 : 0.45}
        />
        <path
          d="M5 11a7 7 0 0014 0"
          stroke="currentColor"
          strokeWidth="2"
          opacity={on ? 1 : 0.45}
        />
        <line x1="12" y1="18" x2="12" y2="21" stroke="currentColor" strokeWidth="2" />
        {!on && <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2" />}
      </svg>
      {on && <span className="mic-level" style={{ transform: `scaleY(${0.15 + level * 1.2})` }} />}
    </span>
  )
}

function ScreenIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
      <line x1="8" y1="20" x2="16" y2="20" stroke="currentColor" strokeWidth="2" />
      <line x1="12" y1="17" x2="12" y2="20" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

function ShotIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 8h3l1.5-2h7L17 8h3v11H4V8z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="3.5" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

function CogIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M19.4 13a7.8 7.8 0 00.1-2l2-1.2-2-3.4-2.3.6a7.6 7.6 0 00-1.7-1L15 3h-4l-.5 2.9a7.6 7.6 0 00-1.7 1L6.5 6.4l-2 3.4 2 1.2a7.8 7.8 0 000 2l-2 1.2 2 3.4 2.3-.6a7.6 7.6 0 001.7 1L11 21h4l.5-2.9a7.6 7.6 0 001.7-1l2.3.6 2-3.4-2-1.3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const barCss = `
.shell {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding-top: 4px;
  position: relative;
}
.pill {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 48px;
  padding: 0 10px 0 18px;
  background: rgba(22, 22, 26, 0.92);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 999px;
  backdrop-filter: blur(16px);
  box-shadow: 0 8px 28px rgba(0,0,0,0.35);
  color: #f2f2f4;
  -webkit-app-region: no-drag;
}
.pill.loading {
  padding: 0 20px;
  font-size: 12px;
  color: #aaa;
}
.drag {
  width: 10px;
  height: 22px;
  margin-right: 4px;
  border-radius: 4px;
  background: repeating-linear-gradient(
    to bottom,
    rgba(255,255,255,0.25) 0 2px,
    transparent 2px 5px
  );
  -webkit-app-region: drag;
  cursor: grab;
}
.icon-btn {
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #e8e8ec;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.icon-btn:hover, .icon-btn.active {
  background: rgba(255,255,255,0.1);
}
.icon-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.divider {
  width: 1px;
  height: 22px;
  background: rgba(255,255,255,0.12);
  margin: 0 4px;
}
.record {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 14px 0 10px;
  margin-left: 2px;
  border: none;
  border-radius: 999px;
  background: #e84040;
  color: white;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.record:hover { filter: brightness(1.08); }
.record.recording { background: #2a2a30; border: 1px solid rgba(255,255,255,0.12); }
.record-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: white;
}
.record.recording .record-dot {
  border-radius: 2px;
  background: #e84040;
}
.mic-wrap { position: relative; display: inline-flex; }
.mic-level {
  position: absolute;
  right: -3px;
  bottom: 1px;
  width: 3px;
  height: 12px;
  border-radius: 2px;
  background: #5dffa8;
  transform-origin: bottom;
}
.menu {
  position: absolute;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
}
.menu.wide { width: 320px; }
.menu:not(.wide) { width: 220px; }
.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1;
}
.menu-body {
  position: relative;
  z-index: 2;
  background: rgba(24,24,28,0.96);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 14px;
  padding: 8px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.45);
  max-height: 400px;
  overflow: auto;
  color: #eee;
}
.path-block {
  font-size: 11px;
  color: #9a9aa3;
  padding: 4px 10px 8px;
  word-break: break-all;
  line-height: 1.35;
}
.menu-section {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #888;
  padding: 8px 8px 4px;
}
.menu-hint {
  font-size: 12px;
  color: #777;
  padding: 6px 8px;
}
.menu-row {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  color: #eee;
  text-align: left;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}
.menu-row:hover, .menu-row.selected { background: rgba(255,255,255,0.08); }
.check { color: #5dffa8; font-size: 12px; }
.source-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  border: none;
  background: transparent;
  color: #eee;
  text-align: left;
  padding: 6px;
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
}
.source-row:hover, .source-row.selected { background: rgba(255,255,255,0.08); }
.source-row img,
.source-thumb {
  width: 72px;
  height: 42px;
  object-fit: cover;
  border-radius: 6px;
  background: #111;
  flex-shrink: 0;
}
.meter {
  height: 4px;
  margin: 4px 8px 8px;
  border-radius: 999px;
  background: rgba(255,255,255,0.08);
  overflow: hidden;
}
.meter-fill {
  height: 100%;
  background: linear-gradient(90deg, #5dffa8, #3dd68c);
  border-radius: 999px;
  transition: width 80ms linear;
}
.toast {
  position: absolute;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 380px;
  padding: 8px 12px;
  border-radius: 10px;
  background: rgba(20,20,24,0.95);
  border: 1px solid rgba(255,255,255,0.1);
  color: #ddd;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  font-family: inherit;
}
.toast.clickable {
  pointer-events: auto;
  cursor: pointer;
}
.toast.clickable:hover {
  border-color: rgba(255,255,255,0.25);
}
.toast.error { color: #ff8f8f; border-color: rgba(232,64,64,0.4); }
`
