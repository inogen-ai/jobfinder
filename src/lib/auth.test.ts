import { describe, it, expect } from 'vitest'
import { isAllowedEmail, displayName } from './auth'

describe('isAllowedEmail', () => {
  it.each(['michael.snow@inogen.ai', 'Mike@InoGen.AI'])('allows %s', (e) => expect(isAllowedEmail(e)).toBe(true))
  it.each([
    'eve@inogen.ai.evil.com', 'eve@notinogen.ai', 'eve@example.com', 'inogen.ai', '@inogen.ai', '', null, undefined,
  ])('refuses %s', (e) => expect(isAllowedEmail(e)).toBe(false))
})

describe('displayName', () => {
  it('uses the first name of an email', () => expect(displayName('herman.wigge@inogen.ai')).toBe('Herman'))
  it('labels the script writer', () => expect(displayName('claude-script')).toBe('Claude'))
  it('falls back', () => expect(displayName(null)).toBe('Someone'))
})
