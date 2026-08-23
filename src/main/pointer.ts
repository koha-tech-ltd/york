import { screen } from 'electron'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

export interface PointerSnapshot {
  /** Absolute coordinates (Electron DIP for screen path; physical px for window path). */
  screenX: number
  screenY: number
  leftAlt: boolean
  leftButton: boolean
}

export interface PointerMapContext {
  sourceType: 'screen' | 'window'
  displayId?: number
  sourceId?: string
}

type KeyStateFn = (vKey: number) => boolean

let keyDown: KeyStateFn = () => false
let getCursorPhysical: (() => { x: number; y: number }) | null = null
let getWindowRectFn:
  | ((hwnd: number) => { left: number; top: number; right: number; bottom: number } | null)
  | null = null

const VK_LMENU = 0xa4
const VK_LBUTTON = 0x01

export function initPointerHooks(): void {
  if (process.platform !== 'win32') {
    keyDown = () => false
    getCursorPhysical = null
    getWindowRectFn = null
    return
  }

  try {
    const koffi = require('koffi') as typeof import('koffi')
    const user32 = koffi.load('user32.dll')
    const GetAsyncKeyState = user32.func('int16_t __stdcall GetAsyncKeyState(int vKey)')
    keyDown = (vKey: number): boolean => (GetAsyncKeyState(vKey) & 0x8000) !== 0

    const Point = koffi.struct('POINT', {
      x: 'long',
      y: 'long'
    })
    const GetCursorPos = user32.func('bool __stdcall GetCursorPos(_Out_ POINT *lpPoint)')
    getCursorPhysical = () => {
      const pt = { x: 0, y: 0 }
      if (!GetCursorPos(pt)) {
        const dip = screen.getCursorScreenPoint()
        return { x: dip.x, y: dip.y }
      }
      return { x: pt.x, y: pt.y }
    }

    const Rect = koffi.struct('RECT', {
      left: 'long',
      top: 'long',
      right: 'long',
      bottom: 'long'
    })
    const GetWindowRect = user32.func('bool __stdcall GetWindowRect(void *hWnd, _Out_ RECT *lpRect)')
    void Rect
    void Point

    getWindowRectFn = (hwnd: number) => {
      if (!hwnd) return null
      const rect = { left: 0, top: 0, right: 0, bottom: 0 }
      // HWND is pointer-sized; pass as BigInt for 64-bit safety
      const ok = GetWindowRect(BigInt(hwnd), rect)
      if (!ok) return null
      if (rect.right <= rect.left || rect.bottom <= rect.top) return null
      return rect
    }
  } catch {
    keyDown = () => false
    getCursorPhysical = null
    getWindowRectFn = null
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

/** Parse HWND from Electron desktopCapturer ids like `window:123456:0`. */
export function hwndFromSourceId(sourceId: string | undefined): number | null {
  if (!sourceId || !sourceId.startsWith('window:')) return null
  const parts = sourceId.split(':')
  if (parts.length < 2) return null
  const hwnd = Number.parseInt(parts[1], 10)
  return Number.isFinite(hwnd) && hwnd > 0 ? hwnd : null
}

/**
 * Map absolute screen point into normalized 0–1 frame coordinates
 * for the active capture source (full display or single window).
 */
export function mapPointerNormalized(
  snapshot: PointerSnapshot,
  ctx: PointerMapContext
): { x: number; y: number } {
  if (ctx.sourceType === 'window') {
    const hwnd = hwndFromSourceId(ctx.sourceId)
    if (hwnd != null && getWindowRectFn) {
      const rect = getWindowRectFn(hwnd)
      // Use physical cursor coords to match GetWindowRect (avoids DIP vs pixel mismatch)
      const cursor = getCursorPhysical
        ? getCursorPhysical()
        : { x: snapshot.screenX, y: snapshot.screenY }
      if (rect) {
        const w = rect.right - rect.left
        const h = rect.bottom - rect.top
        if (w > 0 && h > 0) {
          return {
            x: clamp01((cursor.x - rect.left) / w),
            y: clamp01((cursor.y - rect.top) / h)
          }
        }
      }
    }
  }

  const displays = screen.getAllDisplays()
  let display =
    (ctx.displayId != null ? displays.find((d) => d.id === ctx.displayId) : undefined) ??
    screen.getDisplayNearestPoint({ x: snapshot.screenX, y: snapshot.screenY })

  if (ctx.sourceType === 'screen' && ctx.displayId != null) {
    display = displays.find((d) => d.id === ctx.displayId) ?? display
  }

  const bounds = display.bounds
  return {
    x: clamp01((snapshot.screenX - bounds.x) / bounds.width),
    y: clamp01((snapshot.screenY - bounds.y) / bounds.height)
  }
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}
