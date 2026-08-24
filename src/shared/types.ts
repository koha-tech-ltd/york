export type BubbleSize = 'S' | 'M' | 'L'

export const BUBBLE_SIZES: Record<BubbleSize, number> = {
  S: 120,
  M: 180,
  L: 240
}

/** Extra transparent margin so circular box-shadow is not clipped by the square window. */
export const BUBBLE_SHADOW_PAD = 36

export function bubbleWindowSize(diameter: number): number {
  return diameter + BUBBLE_SHADOW_PAD * 2
}

export interface CaptureSource {
  id: string
  name: string
  type: 'screen' | 'window'
  thumbnailDataUrl: string
  displayId?: number
}

export type ScreenAccess =
  | 'granted'
  | 'denied'
  | 'not-determined'
  | 'restricted'
  | 'unknown'

export interface ListedSources {
  sources: CaptureSource[]
  screenAccess: ScreenAccess
  error: string | null
}

export interface MediaDeviceInfoLite {
  deviceId: string
  label: string
  kind: 'audioinput' | 'videoinput'
}

export interface YorkSettings {
  videoDir: string
  screenshotDir: string
}

export interface RecordOptions {
  sourceId: string
  sourceType: 'screen' | 'window'
  cameraEnabled: boolean
  cameraDeviceId: string | null
  micEnabled: boolean
  micDeviceId: string | null
  bubbleSize: BubbleSize
  /** Pip placement in the recorded frame (0–1 from top-left of camera circle). */
  pip: {
    x: number
    y: number
  }
  /** Electron display id when capturing a screen (for cursor mapping). */
  displayId?: number
}

export interface PointerFrameState {
  /** Normalized 0–1 position within the capture frame */
  x: number
  y: number
  zoomTarget: number
  click: boolean
}

export interface RecordResult {
  path: string
  durationMs: number
}

export interface ScreenshotResult {
  path: string
}

export interface AppState {
  recording: boolean
  saving: boolean
  cameraEnabled: boolean
  micEnabled: boolean
  bubbleSize: BubbleSize
  selectedSourceId: string | null
  selectedCameraId: string | null
  selectedMicId: string | null
  elapsedMs: number
  lastSavedPath: string | null
  error: string | null
  settings: YorkSettings
}

export const IPC = {
  getSources: 'york:get-sources',
  openScreenPrivacySettings: 'york:open-screen-privacy-settings',
  getMediaDevices: 'york:get-media-devices',
  startRecord: 'york:start-record',
  stopRecord: 'york:stop-record',
  takeScreenshot: 'york:take-screenshot',
  setCameraEnabled: 'york:set-camera-enabled',
  setMicEnabled: 'york:set-mic-enabled',
  setBubbleSize: 'york:set-bubble-size',
  setSelectedSource: 'york:set-selected-source',
  setSelectedCamera: 'york:set-selected-camera',
  setSelectedMic: 'york:set-selected-mic',
  getState: 'york:get-state',
  stateChanged: 'york:state-changed',
  openSavedFolder: 'york:open-saved-folder',
  openPath: 'york:open-path',
  setBarExpanded: 'york:set-bar-expanded',
  getSettings: 'york:get-settings',
  chooseVideoDir: 'york:choose-video-dir',
  chooseScreenshotDir: 'york:choose-screenshot-dir',
  clearError: 'york:clear-error',
  // compositor ↔ main
  compositorReady: 'york:compositor-ready',
  compositorStart: 'york:compositor-start',
  compositorStop: 'york:compositor-stop',
  compositorChunk: 'york:compositor-chunk',
  compositorDone: 'york:compositor-done',
  compositorError: 'york:compositor-error',
  compositorScreenshot: 'york:compositor-screenshot',
  pointerState: 'york:pointer-state',
  // bubble
  bubbleDrag: 'york:bubble-drag',
  getDesktopSourceId: 'york:get-desktop-source-id'
} as const
