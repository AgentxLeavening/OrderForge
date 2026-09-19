import { describe, it, expect } from 'vitest'
import { channelFeePct, costState, computeOrderEconomics } from '../lib/pricing'

describe('channelFeePct', () => {
  const profile = { fee_pct_etsy: 6.5, fee_pct_ebay: 13.25, fee_pct_shopify: 2.9, default_fee_pct: 5 }

  it('uses the fee for that channel', () => {
    expect(channelFeePct(profile, 'ebay')).toBe(13.25)
    expect(channelFeePct(profile, 'etsy')).toBe(6.5)
    expect(channelFeePct(profile, 'shopify')).toBe(2.9)
  })

  it('falls back to the general default for other channels', () => {
    expect(channelFeePct(profile, 'direct')).toBe(5)
    expect(channelFeePct(profile, null)).toBe(5)
  })

  it('falls back when a channel has no fee of its own', () => {
    expect(channelFeePct({ fee_pct_ebay: null, default_fee_pct: 8 }, 'ebay')).toBe(8)
  })

  it('returns null when nothing is configured, rather than pretending fees are zero', () => {
    expect(channelFeePct({}, 'ebay')).toBeNull()
    expect(channelFeePct(null, 'ebay')).toBeNull()
  })

  it('keeps an explicit zero rather than falling through to the default', () => {
    expect(channelFeePct({ fee_pct_ebay: 0, default_fee_pct: 9 }, 'ebay')).toBe(0)
  })
})

describe('costState', () => {
  it('separates a recorded cost, a deliberate zero, and an unrecorded one', () => {
    expect(costState({ material_cost: 12 })).toBe('recorded')
    expect(costState({ labor_cost: 30 })).toBe('recorded')
    expect(costState({ material_cost: null, no_cost_basis: true })).toBe('none')
    expect(costState({ material_cost: null })).toBe('unknown')
    expect(costState({})).toBe('unknown')
  })

  it('treats a recorded zero as recorded, not unknown', () => {
    // Someone who typed 0 has answered the question; that must not be
    // re-flagged as "we don't know".
    expect(costState({ material_cost: 0 })).toBe('recorded')
  })
})

describe('computeOrderEconomics with a channel fee', () => {
  it('subtracts the marketplace fee an import now carries', () => {
    // $15 sale, $4.39 shipping the buyer paid, 13.25% eBay fee, no known cost.
    const e = computeOrderEconomics({
      suggested_price: 15, estimated_shipping: 4.39, shipping_buyer_covered: true, fee_pct: 13.25,
    })
    expect(e.revenue).toBeCloseTo(19.39)
    expect(e.feeAmt).toBeCloseTo(2.57, 2)
    // Shipping is a real cost even when the buyer covers it.
    expect(e.profit).toBeCloseTo(12.43, 2)
  })

  it('without a fee, profit is the whole sale — the behaviour that looked wrong', () => {
    const e = computeOrderEconomics({ suggested_price: 15, estimated_shipping: 4.39, shipping_buyer_covered: true })
    expect(e.profit).toBeCloseTo(15, 2)
  })
})
