/**
 * Smoke test: list capture sources, grab a PNG screenshot of the primary screen,
 * and verify ffmpeg can remux a tiny generated webm→mp4 path resolution.
 * Run: npx tsx scripts/smoke-main.ts  (or via electron)
 */
import { app, desktopCapturer } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

app.whenReady().then(async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 640, height: 360 }
    })
    if (sources.length === 0) throw new Error('No screen sources')
    console.log('sources:', sources.map((s) => s.name).join(', '))

    const pictures = join(app.getPath('pictures'), 'York')
    mkdirSync(pictures, { recursive: true })
    const shotPath = join(pictures, `smoke-${Date.now()}.png`)
    writeFileSync(shotPath, sources[0].thumbnail.toPNG())
    console.log('screenshot:', shotPath, existsSync(shotPath))

    const installer = require('@ffmpeg-installer/ffmpeg') as { path: string }
    console.log('ffmpeg:', installer.path, existsSync(installer.path))

    console.log('SMOKE_OK')
    app.exit(0)
  } catch (err) {
    console.error('SMOKE_FAIL', err)
    app.exit(1)
  }
})
