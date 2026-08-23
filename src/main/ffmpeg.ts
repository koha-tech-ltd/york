import { app } from 'electron'
import { createRequire } from 'module'
import { existsSync, statSync } from 'fs'
import ffmpeg from 'fluent-ffmpeg'

const require = createRequire(import.meta.url)

export function getFfmpegPath(): string {
  try {
    const installer = require('@ffmpeg-installer/ffmpeg') as { path: string }
    let ffmpegPath = installer.path
    if (app.isPackaged) {
      ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked')
    }
    return ffmpegPath
  } catch {
    return 'ffmpeg'
  }
}

export function convertWebmToMp4(inputPath: string, outputPath: string): Promise<void> {
  if (!existsSync(inputPath)) {
    return Promise.reject(new Error('Recording file missing'))
  }
  const size = statSync(inputPath).size
  if (size < 1024) {
    return Promise.reject(new Error('Recording was too short or empty — try recording a bit longer'))
  }

  const ffmpegPath = getFfmpegPath()
  ffmpeg.setFfmpegPath(ffmpegPath)

  // Chromium canvas.captureStream often stamps ~1000fps timestamps; force CFR 30
  // and even dimensions so Windows players open the file reliably.
  const common = [
    '-vf',
    'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-r',
    '30',
    '-vsync',
    'cfr',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart'
  ]

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([...common, '-map', '0:v:0', '-map', '0:a:0?', '-c:a', 'aac', '-b:a', '160k'])
      .on('end', () => {
        if (!existsSync(outputPath) || statSync(outputPath).size < 100) {
          reject(new Error('MP4 export produced an empty file'))
          return
        }
        resolve()
      })
      .on('error', (err: Error) => {
        ffmpeg(inputPath)
          .outputOptions([...common, '-map', '0:v:0', '-an'])
          .on('end', () => {
            if (!existsSync(outputPath) || statSync(outputPath).size < 100) {
              reject(new Error('MP4 export produced an empty file'))
              return
            }
            resolve()
          })
          .on('error', (err2: Error) => {
            reject(new Error(simplifyFfmpegError(err2.message || err.message)))
          })
          .save(outputPath)
      })
      .save(outputPath)
  })
}

function simplifyFfmpegError(message: string): string {
  if (/Invalid data found/i.test(message)) {
    return 'Recording file was incomplete. Try stopping after at least a couple of seconds.'
  }
  if (/Conversion failed/i.test(message)) {
    return 'Could not convert recording to MP4.'
  }
  const first = message.split('\n')[0]?.trim()
  return first || 'FFmpeg conversion failed'
}
