import { createRequire } from 'module'
import { shell, systemPreferences } from 'electron'
import type { ScreenAccess } from './captureSources'

const require = createRequire(import.meta.url)

const PRIVACY_URLS = [
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture'
]

export function readScreenAccess(): ScreenAccess {
  if (process.platform !== 'darwin') return 'granted'
  try {
    const koffi = require('koffi') as typeof import('koffi')
    const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
    const preflight = cg.func('uint8_t CGPreflightScreenCaptureAccess(void)') as () => number
    if (preflight()) return 'granted'
  } catch {
    // fall through to Electron's TCC helper
  }
  try {
    return systemPreferences.getMediaAccessStatus('screen') as ScreenAccess
  } catch {
    return 'unknown'
  }
}

/** Prompt macOS TCC for screen capture. Returns whether access is currently granted. */
export function requestMacScreenCaptureAccess(): boolean {
  if (process.platform !== 'darwin') return true
  try {
    const koffi = require('koffi') as typeof import('koffi')
    const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
    const preflight = cg.func('uint8_t CGPreflightScreenCaptureAccess(void)') as () => number
    if (preflight()) return true
    const request = cg.func('uint8_t CGRequestScreenCaptureAccess(void)') as () => number
    return !!request()
  } catch {
    return readScreenAccess() === 'granted'
  }
}

export async function openMacScreenPrivacySettings(): Promise<void> {
  if (process.platform !== 'darwin') return
  for (const url of PRIVACY_URLS) {
    try {
      await shell.openExternal(url)
      return
    } catch {
      // try next URL scheme
    }
  }
}
