import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import type { YorkSettings } from '../shared/types'

const SETTINGS_FILE = (): string => join(app.getPath('userData'), 'settings.json')

function defaults(): YorkSettings {
  return {
    videoDir: join(app.getPath('videos'), 'York'),
    screenshotDir: join(app.getPath('pictures'), 'York')
  }
}

let cached: YorkSettings | null = null

export function loadSettings(): YorkSettings {
  if (cached) return cached
  const base = defaults()
  try {
    const raw = readFileSync(SETTINGS_FILE(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<YorkSettings>
    cached = {
      videoDir: typeof parsed.videoDir === 'string' && parsed.videoDir ? parsed.videoDir : base.videoDir,
      screenshotDir:
        typeof parsed.screenshotDir === 'string' && parsed.screenshotDir
          ? parsed.screenshotDir
          : base.screenshotDir
    }
  } catch {
    cached = base
  }
  return cached
}

export function saveSettings(partial: Partial<YorkSettings>): YorkSettings {
  const next = { ...loadSettings(), ...partial }
  cached = next
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(SETTINGS_FILE(), JSON.stringify(next, null, 2), 'utf8')
  } catch {
    // keep in-memory even if disk write fails
  }
  return next
}

export function ensureSettingsDirs(settings: YorkSettings = loadSettings()): YorkSettings {
  for (const dir of [settings.videoDir, settings.screenshotDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }
  return settings
}
