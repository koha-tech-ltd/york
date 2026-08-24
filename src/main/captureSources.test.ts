import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  listCaptureSources,
  overlayWindowOptions,
  screenAccessHelp,
  sourceTypeFromId,
  type DesktopSourceLike
} from './captureSources'

function fakeSource(partial: Partial<DesktopSourceLike> & { id: string; name: string }): DesktopSourceLike {
  return {
    display_id: '',
    thumbnail: { toDataURL: () => 'data:image/png;base64,AAA' },
    ...partial
  }
}

describe('sourceTypeFromId', () => {
  it('classifies Electron screen ids as screen', () => {
    assert.equal(sourceTypeFromId('screen:1:0'), 'screen')
  })

  it('classifies Electron window ids as window', () => {
    assert.equal(sourceTypeFromId('window:12345:0'), 'window')
  })
})

describe('listCaptureSources', () => {
  it('lists screens and windows with separate getSources calls when combined types fail', async () => {
    const calls: string[][] = []
    const result = await listCaptureSources({
      getSources: async (opts) => {
        calls.push([...opts.types])
        if (opts.types.length !== 1) {
          throw new Error('Failed to get sources.')
        }
        if (opts.types[0] === 'screen') {
          return [fakeSource({ id: 'screen:1:0', name: 'Built-in Retina Display', display_id: '1' })]
        }
        return [fakeSource({ id: 'window:99:0', name: 'Safari' })]
      }
    })

    assert.deepEqual(calls, [['screen'], ['window']])
    assert.equal(result.error, null)
    assert.deepEqual(
      result.sources.map((s) => ({ id: s.id, type: s.type, name: s.name })),
      [
        { id: 'screen:1:0', type: 'screen', name: 'Built-in Retina Display' },
        { id: 'window:99:0', type: 'window', name: 'Safari' }
      ]
    )
  })

  it('does not throw when getSources fails and explains Screen Recording permission', async () => {
    const result = await listCaptureSources(
      {
        getSources: async () => {
          throw new Error('Failed to get sources.')
        }
      },
      { screenAccess: 'denied' }
    )

    assert.equal(result.sources.length, 0)
    assert.match(result.error ?? '', /Screen Recording/)
  })

  it('retries a type without thumbnails if the first call fails', async () => {
    const sizes: Array<{ width: number; height: number }> = []
    const result = await listCaptureSources({
      getSources: async (opts) => {
        sizes.push(opts.thumbnailSize)
        if (opts.types[0] === 'screen' && opts.thumbnailSize.width > 0) {
          throw new Error('Failed to get sources.')
        }
        if (opts.types[0] === 'screen') {
          return [fakeSource({ id: 'screen:2:0', name: 'Display' })]
        }
        return []
      }
    })

    assert.ok(sizes.some((s) => s.width === 0 && s.height === 0))
    assert.equal(result.sources.length, 1)
    assert.equal(result.sources[0]?.id, 'screen:2:0')
  })
})

describe('screenAccessHelp', () => {
  it('tells the user to grant Screen Recording when access is missing', () => {
    const denied = screenAccessHelp('denied')
    const undetermined = screenAccessHelp('not-determined')
    assert.ok(denied)
    assert.ok(undetermined)
    assert.match(denied, /Screen Recording/)
    assert.match(undetermined, /Screen Recording/)
  })

  it('names Electron when running from source so the user enables the right app', () => {
    const msg = screenAccessHelp('denied', { appName: 'Electron' })
    assert.ok(msg)
    assert.match(msg, /Electron/)
  })

  it('names York when running a packaged build', () => {
    const msg = screenAccessHelp('denied', { appName: 'York' })
    assert.ok(msg)
    assert.match(msg, /York/)
  })

  it('is null when access is granted', () => {
    assert.equal(screenAccessHelp('granted'), null)
  })
})

describe('overlayWindowOptions', () => {
  it('uses an NSPanel on macOS so the camera bubble stays visible above other apps', () => {
    const opts = overlayWindowOptions('darwin')
    assert.equal(opts.type, 'panel')
    assert.equal(opts.roundedCorners, false)
  })

  it('does not force panel type on Windows', () => {
    const opts = overlayWindowOptions('win32')
    assert.equal(opts.type, undefined)
  })
})
