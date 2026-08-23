import { useEffect, useRef } from 'react'
import type { PointerFrameState, RecordOptions } from '../../shared/types'
import { BUBBLE_SIZES } from '../../shared/types'

/**
 * Hidden compositor: captures screen/window + optional camera/mic,
 * draws camera as a rounded PiP, Alt-zoom toward cursor, click pulse,
 * and streams WebM chunks to main.
 */
export function CompositorApp(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const screenVideoRef = useRef<HTMLVideoElement>(null)
  const cameraVideoRef = useRef<HTMLVideoElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamsRef = useRef<{
    screen?: MediaStream
    camera?: MediaStream
    mic?: MediaStream
    mixed?: MediaStream
  }>({})
  const rafRef = useRef<number>(0)
  const pointerRef = useRef({
    nx: 0.5,
    ny: 0.5,
    zoom: 1,
    zoomTarget: 1,
    cursorScale: 1,
    clickBoost: 0
  })

  useEffect(() => {
    window.york.compositorReady()

    const stopAll = (): void => {
      cancelAnimationFrame(rafRef.current)
      recorderRef.current = null
      const s = streamsRef.current
      s.screen?.getTracks().forEach((t) => t.stop())
      s.camera?.getTracks().forEach((t) => t.stop())
      s.mic?.getTracks().forEach((t) => t.stop())
      streamsRef.current = {}
    }

    const unsubPointer = window.york.onPointerState((state: PointerFrameState) => {
      const p = pointerRef.current
      // state.x/y are normalized 0–1; converted to pixels each frame using canvas size
      p.nx = state.x
      p.ny = state.y
      p.zoomTarget = state.zoomTarget
      if (state.click) {
        p.clickBoost = 1
      }
    })

    const unsubStart = window.york.onCompositorStart((options) => {
      void start(options).catch((err: Error) => {
        window.york.sendError(err.message || 'Compositor failed')
        stopAll()
      })
    })

    const unsubStop = window.york.onCompositorStop(() => {
      const rec = recorderRef.current
      if (rec && rec.state !== 'inactive') {
        try {
          if (rec.state === 'recording') rec.requestData()
        } catch {
          // ignore
        }
        rec.stop()
      } else {
        window.york.sendDone()
        stopAll()
      }
    })

    async function start(options: RecordOptions): Promise<void> {
      stopAll()
      pointerRef.current = {
        nx: 0.5,
        ny: 0.5,
        zoom: 1,
        zoomTarget: 1,
        cursorScale: 1,
        clickBoost: 0
      }

      let screenStream: MediaStream
      try {
        screenStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: options.sourceId
            }
          } as unknown as MediaTrackConstraints
        })
      } catch {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false
        })
      }
      streamsRef.current.screen = screenStream

      const screenVideo = screenVideoRef.current!
      screenVideo.srcObject = screenStream
      await screenVideo.play()
      await waitForVideo(screenVideo)

      let cameraStream: MediaStream | undefined
      if (options.cameraEnabled) {
        try {
          cameraStream = await navigator.mediaDevices.getUserMedia({
            video: options.cameraDeviceId
              ? { deviceId: { exact: options.cameraDeviceId } }
              : true,
            audio: false
          })
          streamsRef.current.camera = cameraStream
          const camVideo = cameraVideoRef.current!
          camVideo.srcObject = cameraStream
          await camVideo.play()
          await waitForVideo(camVideo)
        } catch {
          cameraStream = undefined
        }
      }

      let micStream: MediaStream | undefined
      if (options.micEnabled) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: options.micDeviceId
              ? { deviceId: { exact: options.micDeviceId } }
              : true,
            video: false
          })
          streamsRef.current.mic = micStream
        } catch {
          micStream = undefined
        }
      }

      const canvas = canvasRef.current!
      const track = screenStream.getVideoTracks()[0]
      const settings = track.getSettings()
      // H.264 needs even dimensions
      const width = Math.floor((settings.width || screenVideo.videoWidth || 1280) / 2) * 2
      const height = Math.floor((settings.height || screenVideo.videoHeight || 720) / 2) * 2
      canvas.width = width
      canvas.height = height

      const ctx = canvas.getContext('2d')!
      const pipDiameter = Math.min(
        BUBBLE_SIZES[options.bubbleSize] * (width / 1280),
        height * 0.35
      )
      const pipX = options.pip.x * width
      const pipY = options.pip.y * height

      for (let i = 0; i < 5; i++) {
        ctx.drawImage(screenVideo, 0, 0, width, height)
        await new Promise((r) => requestAnimationFrame(() => r(undefined)))
      }

      const draw = (): void => {
        const p = pointerRef.current
        const focusX = p.nx * width
        const focusY = p.ny * height

        // Smooth zoom toward 200% while Alt held; ease back on release
        p.zoom += (p.zoomTarget - p.zoom) * 0.12
        if (Math.abs(p.zoom - p.zoomTarget) < 0.0015) p.zoom = p.zoomTarget

        // Click briefly enlarges the cursor ring
        const clickTarget = p.clickBoost > 0.04 ? 1.65 : 1
        p.cursorScale += (clickTarget - p.cursorScale) * 0.32
        p.clickBoost *= 0.84

        const z = Math.max(1, Math.min(2, p.zoom))
        const srcW = width / z
        const srcH = height / z
        const sx = clamp(focusX - srcW / 2, 0, Math.max(0, width - srcW))
        const sy = clamp(focusY - srcH / 2, 0, Math.max(0, height - srcH))

        ctx.clearRect(0, 0, width, height)
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(screenVideo, sx, sy, srcW, srcH, 0, 0, width, height)

        const outX = ((focusX - sx) / srcW) * width
        const outY = ((focusY - sy) / srcH) * height
        drawCursor(ctx, outX, outY, p.cursorScale, z > 1.02)

        if (cameraStream && cameraVideoRef.current) {
          drawCameraPip(ctx, cameraVideoRef.current, pipX, pipY, pipDiameter)
        }

        rafRef.current = requestAnimationFrame(draw)
      }
      draw()

      const canvasStream = canvas.captureStream(30)
      const hasAudio = !!(micStream && micStream.getAudioTracks().length > 0)
      const mixed = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...(hasAudio ? micStream!.getAudioTracks() : [])
      ])
      streamsRef.current.mixed = mixed

      const mime = pickMimeType(hasAudio)
      const recorderOptions: MediaRecorderOptions = {
        mimeType: mime,
        videoBitsPerSecond: 5_000_000
      }
      if (hasAudio) {
        recorderOptions.audioBitsPerSecond = 160_000
      }

      const recorder = new MediaRecorder(mixed, recorderOptions)
      recorderRef.current = recorder

      recorder.ondataavailable = (ev) => {
        if (!ev.data || ev.data.size === 0) return
        void ev.data.arrayBuffer().then((buf) => {
          window.york.sendChunk(buf)
        })
      }

      recorder.onstop = () => {
        cancelAnimationFrame(rafRef.current)
        // Always finish within 2s even if a chunk write stalls
        window.setTimeout(() => {
          window.york.sendDone()
          stopAll()
        }, 250)
      }

      recorder.onerror = () => {
        window.york.sendError('MediaRecorder error')
        stopAll()
      }

      recorder.start(1000)
    }

    return () => {
      unsubStart()
      unsubStop()
      unsubPointer()
      stopAll()
    }
  }, [])

  return (
    <div style={{ margin: 0, background: '#000', width: '100vw', height: '100vh' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
      <video ref={screenVideoRef} muted playsInline style={{ display: 'none' }} />
      <video ref={cameraVideoRef} muted playsInline style={{ display: 'none' }} />
    </div>
  )
}

function drawCameraPip(
  ctx: CanvasRenderingContext2D,
  cam: HTMLVideoElement,
  pipX: number,
  pipY: number,
  diameter: number
): void {
  const r = diameter / 2
  const cx = pipX + r
  const cy = pipY + r
  const vw = cam.videoWidth || diameter
  const vh = cam.videoHeight || diameter

  // object-fit: cover into the circle — crop, never stretch/distort
  const scale = Math.max(diameter / vw, diameter / vh)
  const tw = vw * scale
  const th = vh * scale
  const ox = pipX + (diameter - tw) / 2
  const oy = pipY + (diameter - th) / 2

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()

  // Mirror horizontally around the circle center
  ctx.translate(cx, cy)
  ctx.scale(-1, 1)
  ctx.translate(-cx, -cy)
  ctx.drawImage(cam, ox, oy, tw, th)
  ctx.restore()
}

function drawCursor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  zooming: boolean
): void {
  const base = 10 * scale
  ctx.save()
  ctx.translate(x, y)

  // Soft spotlight while zooming
  if (zooming) {
    const g = ctx.createRadialGradient(0, 0, 8, 0, 0, 90 * scale)
    g.addColorStop(0, 'rgba(255,255,255,0.10)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(0, 0, 90 * scale, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.beginPath()
  ctx.arc(0, 0, base + 4, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.lineWidth = 3
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(0, 0, base + 4, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(0, 0, 2.5 * scale, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(232,64,64,0.95)'
  ctx.fill()
  ctx.restore()
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function waitForVideo(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth > 0) return Promise.resolve()
  return new Promise((resolve) => {
    const onMeta = (): void => {
      video.removeEventListener('loadedmetadata', onMeta)
      resolve()
    }
    video.addEventListener('loadedmetadata', onMeta)
  })
}

function pickMimeType(hasAudio: boolean): string {
  const withAudio = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ]
  const videoOnly = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  const candidates = hasAudio ? withAudio : videoOnly
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c
  }
  return 'video/webm'
}
