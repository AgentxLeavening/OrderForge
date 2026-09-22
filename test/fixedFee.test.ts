import { describe, it, expect } from 'vitest'
import { channelFeeFixed, computeOrderEconomics } from '../lib/pricing'

describe('channelFeeFixed', () => {
  const profile = { fee_fixed_etsy: 0.2, fee_fixed_ebay: 0.4, fee_fixed_shopify: 0.3, default_fee_fixed: 0.25 }

  it('uses the flat fee for that channel', () => {
    expect(channelFeeFixed(profile, 'ebay')).toBe(0.4)
    expect(channelFeeFixed(profile, 'etsy')).toBe(0.2)
  })

  it('falls back to the general default, then to null', () => {
    expect(channelFeeFixed(profile, 'direct')).toBe(0.25)
    expect(channelFeeFixed({}, 'ebay')).toBeNull()
    expect(channelFeeFixed(null, 'ebay')).toBeNull()
  })

  it('keeps an explicit zero for a channel with no flat fee', () => {
    expect(channelFeeFixed({ fee_fixed_shopify: 0, default_fee_fixed: 0.3 }, 'shopify')).toBe(0)
  })
})

describe('computeOrderEconomics with a flat per-order fee', () => {
  it('charges the flat fee on top of the percentage', () => {
    const e = computeOrderEconomics({ suggested_price: 15, estimated_shipping: 4.39, shipping_buyer_covered: true, fee_pct: 13.25, fee_fixed: 0.4 })
    expect(e.feeAmt).toBeCloseTo(2.97, 2) // 2.57 + 0.40
    expect(e.profit).toBeCloseTo(12.03, 2)
  })

  it('dominates the percentage on a cheap sale — the case that was wrong', () => {
    // A $1 card with $0.78 shipping the buyer paid.
    const e = computeOrderEconomics({ suggested_price: 1, estimated_shipping: 0.78, shipping_buyer_covered: true, fee_pct: 13.25, fee_fixed: 0.4 })
    expect(e.revenue).toBeCloseTo(1.78)
    // 13.25% is 24 cents; the flat fee is 40 — bigger than the percentage.
    expect(e.feeAmt).toBeCloseTo(0.64, 2)
    // Postage still costs what it costs, so this order barely breaks even.
    expect(e.profit).toBeCloseTo(0.36, 2)
  })

  it('is unchanged when no flat fee is recorded', () => {
    const withNone = computeOrderEconomics({ suggested_price: 20, fee_pct: 10 })
    expect(withNone.feeAmt).toBeCloseTo(2)
  })
})
