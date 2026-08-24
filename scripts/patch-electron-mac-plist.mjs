/**
 * Electron.app ships without screen-capture usage strings. On modern macOS
 * ScreenCaptureKit then reports screen access as denied for `npm run dev`.
 * Packaged York.app gets these keys via electron-builder extendInfo.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

if (process.platform !== 'darwin') process.exit(0)

const require = createRequire(import.meta.url)
const electronPath = dirname(require.resolve('electron/package.json'))
const appPath = join(electronPath, 'dist/Electron.app')
const plistPath = join(appPath, 'Contents/Info.plist')

if (!existsSync(plistPath)) {
  console.warn('patch-electron-mac-plist: Electron.app Info.plist not found')
  process.exit(0)
}

const keys = {
  NSDesktopCaptureUsageDescription:
    'York needs screen recording permission to capture your screen or windows.',
  NSScreenCaptureUsageDescription:
    'York needs screen recording permission to capture your screen or windows.',
  NSAudioCaptureUsageDescription: 'York needs audio access to record your microphone.'
}

function plistPrint(key) {
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plistPath], {
      stdio: 'pipe'
    })
    return true
  } catch {
    return false
  }
}

let changed = false
for (const [key, value] of Object.entries(keys)) {
  if (plistPrint(key)) continue
  execFileSync('/usr/libexec/PlistBuddy', [
    '-c',
    `Add :${key} string ${JSON.stringify(value)}`,
    plistPath
  ])
  changed = true
}

if (changed) {
  execFileSync('codesign', ['--sign', '-', '--force', '--deep', appPath], { stdio: 'inherit' })
  console.log('Patched Electron.app with screen-capture usage strings (ad-hoc signed).')
}
