import { useEffect, useRef, useState } from 'react'
import type { AppState } from '../../shared/types'
import { BUBBLE_SHADOW_PAD } from '../../shared/types'

export function BubbleApp(): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<AppState | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const dragRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    void window.york.getState().then(setState)
    return window.york.onStateChanged(setState)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function attach(): Promise<void> {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      if (!state?.cameraEnabled) {
        if (videoRef.current) videoRef.current.srcObject = null
        return
      }
      try {
        const constraints: MediaStreamConstraints = {
          video: state.selectedCameraId
            ? { deviceId: { exact: state.selectedCameraId } }
            : { facingMode: 'user' },
          audio: false
        }
        let stream: MediaStream | null = null
        let lastError: Error | null = null
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            stream = await navigator.mediaDevices.getUserMedia(constraints)
            break
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err))
            await new Promise((r) => setTimeout(r, 250 * (attempt + 1)))
          }
        }
        if (!stream) throw lastError ?? new Error('Could not open camera')
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
      } catch {
        // permission denied or no device — navy circle still visible
      }
    }

    void attach()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [state?.cameraEnabled, state?.selectedCameraId])

  const onPointerDown = (e: React.PointerEvent): void => {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { x: e.screenX, y: e.screenY }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    if (!dragRef.current) return
    const dx = e.screenX - dragRef.current.x
    const dy = e.screenY - dragRef.current.y
    dragRef.current = { x: e.screenX, y: e.screenY }
    window.york.bubbleDrag(dx, dy)
  }

  const onPointerUp = (): void => {
    dragRef.current = null
  }

  return (
    <div
      className="bubble"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="bubble-shadow">
        <div className="bubble-clip">
          <video ref={videoRef} muted playsInline autoPlay />
        </div>
      </div>
      <style>{`
        html, body, #root {
          margin: 0;
          padding: 0;
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: transparent !important;
        }
        .bubble {
          width: 100%;
          height: 100%;
          padding: ${BUBBLE_SHADOW_PAD}px;
          box-sizing: border-box;
          background: transparent;
          cursor: grab;
        }
        .bubble:active { cursor: grabbing; }
        /* Shadow ring — no overflow:hidden (that clips shadow + squares the preview on Windows) */
        .bubble-shadow {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          box-shadow: 0 10px 28px rgba(0, 0, 0, 0.38);
        }
        /* Clip video to a circle */
        .bubble-clip {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          overflow: hidden;
          clip-path: circle(50% at 50% 50%);
          -webkit-clip-path: circle(50% at 50% 50%);
          background: #0c2340;
          box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.88);
        }
        video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center;
          transform: scaleX(-1);
          pointer-events: none;
          display: block;
          background: transparent;
        }
      `}</style>
    </div>
  )
}
