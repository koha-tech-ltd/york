import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isOptionDown, MAC_KEY_LEFT_OPTION, MAC_KEY_RIGHT_OPTION } from './optionKey'

describe('isOptionDown', () => {
  it('is true when the left Option key is held', () => {
    assert.equal(isOptionDown((code) => code === MAC_KEY_LEFT_OPTION), true)
  })

  it('is true when the right Option key is held', () => {
    assert.equal(isOptionDown((code) => code === MAC_KEY_RIGHT_OPTION), true)
  })

  it('is false when neither Option key is held', () => {
    assert.equal(isOptionDown(() => false), false)
  })
})
