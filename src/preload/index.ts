import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppState,
  BubbleSize,
  CaptureSource,
  PointerFrameState,
  RecordOptions,
  RecordResult,
  ScreenshotResult,
  YorkSettings
} from '../shared/types'
import { IPC } from '../shared/types'

const api = {
  getState: (): Promise<AppState> => ipcRenderer.invoke(IPC.getState),
  getSources: (): Promise<CaptureSource[]> => ipcRenderer.invoke(IPC.getSources),
  startRecord: (options: RecordOptions): Promise<{ started: true }> =>
    ipcRenderer.invoke(IPC.startRecord, options),
  stopRecord: (): Promise<RecordResult | null> => ipcRenderer.invoke(IPC.stopRecord),
  takeScreenshot: (): Promise<ScreenshotResult> => ipcRenderer.invoke(IPC.takeScreenshot),
  setCameraEnabled: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.setCameraEnabled, enabled),
  setMicEnabled: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.setMicEnabled, enabled),
  setBubbleSize: (size: BubbleSize): Promise<void> =>
    ipcRenderer.invoke(IPC.setBubbleSize, size),
  setSelectedSource: (id: string | null): Promise<void> =>
    ipcRenderer.invoke(IPC.setSelectedSource, id),
  setSelectedCamera: (id: string | null): Promise<void> =>
    ipcRenderer.invoke(IPC.setSelectedCamera, id),
  setSelectedMic: (id: string | null): Promise<void> =>
    ipcRenderer.invoke(IPC.setSelectedMic, id),
  openSavedFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.openSavedFolder, filePath),
  openPath: (dirPath: string): Promise<void> => ipcRenderer.invoke(IPC.openPath, dirPath),
  setBarExpanded: (expanded: boolean, wide = false): Promise<void> =>
    ipcRenderer.invoke(IPC.setBarExpanded, expanded, wide),
  getSettings: (): Promise<YorkSettings> => ipcRenderer.invoke(IPC.getSettings),
  chooseVideoDir: (): Promise<YorkSettings> => ipcRenderer.invoke(IPC.chooseVideoDir),
  chooseScreenshotDir: (): Promise<YorkSettings> =>
    ipcRenderer.invoke(IPC.chooseScreenshotDir),
  clearError: (): Promise<void> => ipcRenderer.invoke(IPC.clearError),
  onStateChanged: (cb: (state: AppState) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, state: AppState): void => cb(state)
    ipcRenderer.on(IPC.stateChanged, listener)
    return () => ipcRenderer.removeListener(IPC.stateChanged, listener)
  },
  bubbleDrag: (dx: number, dy: number): void => {
    ipcRenderer.send(IPC.bubbleDrag, { dx, dy })
  },
  compositorReady: (): void => ipcRenderer.send(IPC.compositorReady),
  onCompositorStart: (cb: (options: RecordOptions) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, options: RecordOptions): void => cb(options)
    ipcRenderer.on(IPC.compositorStart, listener)
    return () => ipcRenderer.removeListener(IPC.compositorStart, listener)
  },
  onCompositorStop: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.compositorStop, listener)
    return () => ipcRenderer.removeListener(IPC.compositorStop, listener)
  },
  onPointerState: (cb: (state: PointerFrameState) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, state: PointerFrameState): void => cb(state)
    ipcRenderer.on(IPC.pointerState, listener)
    return () => ipcRenderer.removeListener(IPC.pointerState, listener)
  },
  sendChunk: (chunk: ArrayBuffer): void => {
    ipcRenderer.send(IPC.compositorChunk, chunk)
  },
  sendDone: (): void => ipcRenderer.send(IPC.compositorDone),
  sendError: (message: string): void => ipcRenderer.send(IPC.compositorError, message)
}

contextBridge.exposeInMainWorld('york', api)

export type YorkApi = typeof api
