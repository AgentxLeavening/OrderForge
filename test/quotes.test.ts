import { describe, it, expect } from 'vitest'
import {
  generateQuoteToken,
  billableLineTotal,
  isExpired,
  canRespond,
  type QuoteStatus,
} from '../lib/quotes'

// The quote page is public and unauthenticated, so these rules are what stop a
// customer from accepting twice, accepting an expired quote, or seeing a total
// that disagrees with the seller's own order screen.

describe('generateQuoteToken', () => {
  it('produces URL-safe tokens with no collisions across many draws', () => {
    const tokens = new Set(Array.from({ length: 500 }, generateQuoteToken))
    expect(tokens.size).toBe(500)
    for (const t of tokens) {
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
      // 32 random bytes in base64url. The token is the only thing protecting
      // the quote, so shortening it is a security change, not a cosmetic one.
      expect(t.length).toBeGreaterThanOrEqual(43)
    }
  })
})

describe('billableLineTotal', () => {
  it('multiplies quantity by unit price', () => {
    expect(billableLineTotal({ description: 'Dice set', quantity: 3, unitPrice: 12.5 })).toBe(37.5)
  })

  it('bills a shipping line the buyer is not covering at zero', () => {
    // Mirrors billableAmount() on the order page. If these two ever disagree,
    // the customer sees a different total from the seller.
    expect(
      billableLineTotal({
        description: 'Shipping & tax',
        quantity: 1,
        unitPrice: 9.99,
        itemType: 'shipping',
        buyerCovered: false,
      })
    ).toBe(0)
  })

  it('still bills shipping the buyer IS covering', () => {
    expect(
      billableLineTotal({
        description: 'Shipping & tax',
        quantity: 1,
        unitPrice: 9.99,
        itemType: 'shipping',
        buyerCovered: true,
      })
    ).toBe(9.99)
  })
})

describe('isExpired', () => {
  const now = new Date('2026-09-20T12:00:00.000Z')

  it('treats the whole of the validity date as still valid', () => {
    // Someone opening a quote at 11pm on its last day should not be told it
    // expired that morning.
    expect(isExpired('2026-09-20', new Date('2026-09-20T23:30:00.000Z'))).toBe(false)
  })

  it('expires the day after', () => {
    expect(isExpired('2026-09-19', now)).toBe(true)
  })

  it('never expires without a date', () => {
    expect(isExpired(null, now)).toBe(false)
  })
})

describe('canRespond', () => {
  const now = new Date('2026-09-20T12:00:00.000Z')
  const open: QuoteStatus[] = ['sent', 'viewed']

  it('allows a response on an open, in-date quote', () => {
    for (const status of open) {
      expect(canRespond(status, '2026-09-30', now)).toBe(true)
      expect(canRespond(status, null, now)).toBe(true)
    }
  })

  it('refuses a second response once answered', () => {
    // The decision is final: a stray second click must not flip an accepted
    // quote to declined.
    expect(canRespond('accepted', null, now)).toBe(false)
    expect(canRespond('declined', null, now)).toBe(false)
  })

  it('refuses an expired quote even if never answered', () => {
    expect(canRespond('sent', '2026-09-01', now)).toBe(false)
  })

  it('refuses one already marked expired', () => {
    expect(canRespond('expired', '2026-12-31', now)).toBe(false)
  })
})
