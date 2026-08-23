import { screen } from 'electron'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

export interface PointerSnapshot {
  /** Absolute screen coordinates */
  screenX: number
  screenY: number
  leftAlt: boolean
  leftButton: boolean
}

type KeyStateFn = (vKey: number) => boolean

let keyDown: KeyStateFn = () => false

const VK_LMENU = 0xA4
const VK_LBUTTON = 0x01

export function initPointerHooks(): void {
  if (process.platform !== 'win32') {
    // macOS/Linux: Alt detection requires a native hook; zoom still works if we
    // later add one. Mouse position always works via Electron.
    keyDown = () => false
    return
  }

  try {
    const koffi = require('koffi') as typeof import('koffi')
    const user32 = koffi.load('user32.dll')
    const GetAsyncKeyState = user32.func('int16_t __stdcall GetAsyncKeyState(int vKey)')
    keyDown = (vKey: number): boolean => (GetAsyncKeyState(vKey) & 0x8000) !== 0
  } catch {
    keyDown = () => false
  }
}

export function readPointerSnapshot(): PointerSnapshot {
  const point = screen.getCursorScreenPoint()
  return {
    screenX: point.x,
    screenY: point.y,
    leftAlt: keyDown(VK_LMENU) || keyDown(0x12),
    leftButton: keyDown(VK_LBUTTON)
  }
}

/**
 * Map absolute screen point into normalized 0–1 frame coordinates.
 */
export function mapPointerNormalized(
  snapshot: PointerSnapshot,
  sourceType: 'screen' | 'window',
  displayId?: number
): { x: number; y: number } {
  const displays = screen.getAllDisplays()
  let display =
    (displayId != null ? displays.find((d) => d.id === displayId) : undefined) ??
    screen.getDisplayNearestPoint({ x: snapshot.screenX, y: snapshot.screenY })

  if (sourceType === 'screen' && displayId != null) {
    display = displays.find((d) => d.id === displayId) ?? display
  }

  const bounds = display.bounds
  return {
    x: Math.min(1, Math.max(0, (snapshot.screenX - bounds.x) / bounds.width)),
    y: Math.min(1, Math.max(0, (snapshot.screenY - bounds.y) / bounds.height))
  }
}
