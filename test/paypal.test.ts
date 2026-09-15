import { describe, it, expect } from 'vitest'
import { normalizePaypalMeName, paypalPayUrl } from '../lib/paypal'

describe('normalizePaypalMeName', () => {
  it('accepts the forms a seller is likely to paste', () => {
    expect(normalizePaypalMeName('LikeGravy')).toBe('LikeGravy')
    expect(normalizePaypalMeName(' @LikeGravy ')).toBe('LikeGravy')
    expect(normalizePaypalMeName('paypal.me/LikeGravy')).toBe('LikeGravy')
    expect(normalizePaypalMeName('https://paypal.me/LikeGravy/25')).toBe('LikeGravy')
    expect(normalizePaypalMeName('https://www.paypal.com/paypalme/LikeGravy?locale.x=en_US')).toBe('LikeGravy')
  })

  it('rejects empty or invalid values', () => {
    expect(normalizePaypalMeName('')).toBeNull()
    expect(normalizePaypalMeName(undefined)).toBeNull()
    expect(normalizePaypalMeName('like gravy')).toBeNull()
    expect(normalizePaypalMeName('a"onmouseover')).toBeNull()
  })
})

describe('paypalPayUrl', () => {
  it('puts the amount in the path, rounded to cents', () => {
    expect(paypalPayUrl('LikeGravy', 62.649)).toBe('https://paypal.me/LikeGravy/62.65')
    expect(paypalPayUrl('LikeGravy', 40)).toBe('https://paypal.me/LikeGravy/40.00')
  })

  it('links to the profile alone when there is nothing to pay', () => {
    expect(paypalPayUrl('LikeGravy', 0)).toBe('https://paypal.me/LikeGravy')
  })
})
