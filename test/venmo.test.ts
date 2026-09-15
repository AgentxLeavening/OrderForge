import { describe, it, expect } from 'vitest'
import { normalizeVenmoUsername, venmoPayUrl } from '../lib/venmo'

describe('normalizeVenmoUsername', () => {
  it('accepts the forms a seller is likely to paste', () => {
    expect(normalizeVenmoUsername('Like-Gravy')).toBe('Like-Gravy')
    expect(normalizeVenmoUsername('  @Like-Gravy ')).toBe('Like-Gravy')
    expect(normalizeVenmoUsername('venmo.com/u/Like-Gravy')).toBe('Like-Gravy')
    expect(normalizeVenmoUsername('https://account.venmo.com/u/Like_Gravy?foo=1')).toBe('Like_Gravy')
    expect(normalizeVenmoUsername('https://venmo.com/LikeGravy')).toBe('LikeGravy')
  })

  it('rejects empty or invalid values rather than storing junk', () => {
    expect(normalizeVenmoUsername('')).toBeNull()
    expect(normalizeVenmoUsername(null)).toBeNull()
    expect(normalizeVenmoUsername('like gravy')).toBeNull()
    expect(normalizeVenmoUsername('name<script>')).toBeNull()
  })
})

describe('venmoPayUrl', () => {
  it('prefills amount to the cent and an encoded note', () => {
    const url = new URL(venmoPayUrl('Like-Gravy', 62.649, 'Order ORD-123 & thanks'))
    expect(url.origin + url.pathname).toBe('https://venmo.com/Like-Gravy')
    expect(url.searchParams.get('txn')).toBe('pay')
    expect(url.searchParams.get('amount')).toBe('62.65')
    expect(url.searchParams.get('note')).toBe('Order ORD-123 & thanks')
  })

  it('leaves the amount off when there is nothing to pay', () => {
    expect(new URL(venmoPayUrl('Like-Gravy', 0)).searchParams.has('amount')).toBe(false)
  })
})
