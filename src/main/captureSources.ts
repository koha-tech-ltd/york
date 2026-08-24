import type { CaptureSource } from '../shared/types'

export type ScreenAccess =
  | 'granted'
  | 'denied'
  | 'not-determined'
  | 'restricted'
  | 'unknown'

export interface DesktopSourceLike {
  id: string
  name: string
  display_id?: string
  thumbnail?: { toDataURL: () => string }
}

export interface GetSourcesOptions {
  types: Array<'screen' | 'window'>
  thumbnailSize: { width: number; height: number }
  fetchWindowIcons?: boolean
}

export interface Capturer {
  getSources: (opts: GetSourcesOptions) => Promise<DesktopSourceLike[]>
}

export interface ListedSources {
  sources: CaptureSource[]
  screenAccess: ScreenAccess
  error: string | null
}

const THUMB = { width: 320, height: 180 }
const NO_THUMB = { width: 0, height: 0 }
const INTERNAL_WINDOW_NAMES = new Set(['York', 'York Camera', 'York Compositor'])

export function sourceTypeFromId(id: string): 'screen' | 'window' {
  return id.startsWith('screen:') ? 'screen' : 'window'
}

export function screenAccessHelp(
  status: ScreenAccess,
  opts: { appName?: string } = {}
): string | null {
  if (status === 'granted') return null
  const appName = opts.appName ?? 'York'
  return `Grant Screen Recording to ${appName} in System Settings → Privacy & Security → Screen Recording. Then quit ${appName} from the tray and run York again.`
}

export function overlayWindowOptions(platform: NodeJS.Platform): {
  type?: 'panel'
  roundedCorners?: boolean
} {
  if (platform === 'darwin') {
    return { type: 'panel', roundedCorners: false }
  }
  return {}
}

export function mapDesktopSource(s: DesktopSourceLike): CaptureSource {
  const displayIdRaw = s.display_id
  const displayId =
    displayIdRaw && displayIdRaw !== '' ? Number.parseInt(displayIdRaw, 10) : undefined
  let thumbnailDataUrl = ''
  try {
    thumbnailDataUrl = s.thumbnail?.toDataURL() ?? ''
  } catch {
    thumbnailDataUrl = ''
  }
  return {
    id: s.id,
    name: s.name,
    type: sourceTypeFromId(s.id),
    thumbnailDataUrl,
    displayId: Number.isFinite(displayId) ? displayId : undefined
  }
}

async function getSourcesOfType(
  capturer: Capturer,
  type: 'screen' | 'window'
): Promise<DesktopSourceLike[]> {
  try {
    return await capturer.getSources({
      types: [type],
      thumbnailSize: THUMB,
      fetchWindowIcons: false
    })
  } catch {
    try {
      return await capturer.getSources({
        types: [type],
        thumbnailSize: NO_THUMB,
        fetchWindowIcons: false
      })
    } catch {
      return []
    }
  }
}

export async function fetchDesktopSources(capturer: Capturer): Promise<DesktopSourceLike[]> {
  // ScreenCaptureKit on macOS often throws "Failed to get sources" when
  // screen+window are requested together. Enumerate one type at a time.
  const screens = await getSourcesOfType(capturer, 'screen')
  const windows = await getSourcesOfType(capturer, 'window')
  return [...screens, ...windows]
}

export async function listCaptureSources(
  capturer: Capturer,
  opts: { screenAccess?: ScreenAccess; appName?: string } = {}
): Promise<ListedSources> {
  const screenAccess = opts.screenAccess ?? 'unknown'
  const raw = await fetchDesktopSources(capturer)
  const sources = raw
    .filter((s) => !INTERNAL_WINDOW_NAMES.has(s.name))
    .map(mapDesktopSource)

  let error: string | null = null
  if (sources.length === 0) {
    error =
      screenAccessHelp(screenAccess, { appName: opts.appName }) ??
      'Could not list screens or windows.'
  }

  return { sources, screenAccess, error }
}
