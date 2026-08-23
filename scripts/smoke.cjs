const { app, desktopCapturer } = require('electron')
const { join } = require('path')
const { existsSync, mkdirSync, writeFileSync } = require('fs')
const ffmpeg = require('@ffmpeg-installer/ffmpeg')

app.whenReady().then(async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 640, height: 360 }
    })
    console.log('SOURCES', sources.length, sources[0] && sources[0].name)
    const dir = join(app.getPath('pictures'), 'York')
    mkdirSync(dir, { recursive: true })
    const p = join(dir, 'smoke-' + Date.now() + '.png')
    writeFileSync(p, sources[0].thumbnail.toPNG())
    console.log('SHOT', p, existsSync(p))
    console.log('FFMPEG', ffmpeg.path, existsSync(ffmpeg.path))
    console.log('SMOKE_OK')
    app.exit(0)
  } catch (e) {
    console.error('SMOKE_FAIL', e)
    app.exit(1)
  }
})
