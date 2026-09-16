import { describe, it, expect } from 'vitest'
import { computeDeposit } from '../lib/quotes'

describe('computeDeposit', () => {
  it('takes a percentage of the total, rounded to cents', () => {
    expect(computeDeposit(120, { type: 'percent', value: 50 })).toEqual({ amount: 60, percent: 50 })
    expect(computeDeposit(53.33, { type: 'percent', value: 33 })).toEqual({ amount: 17.6, percent: 33 })
  })

  it('takes a fixed amount, recording no percentage', () => {
    expect(computeDeposit(120, { type: 'fixed', value: 25 })).toEqual({ amount: 25, percent: null })
  })

  it('never asks for more than the total', () => {
    expect(computeDeposit(80, { type: 'fixed', value: 500 })?.amount).toBe(80)
    expect(computeDeposit(80, { type: 'percent', value: 150 })?.amount).toBe(80)
  })

  it('treats no deposit, zero, negatives and junk as no deposit', () => {
    expect(computeDeposit(120, { type: 'none' })).toBeNull()
    expect(computeDeposit(120, null)).toBeNull()
    expect(computeDeposit(120, undefined)).toBeNull()
    expect(computeDeposit(120, { type: 'percent', value: 0 })).toBeNull()
    expect(computeDeposit(120, { type: 'fixed', value: -5 })).toBeNull()
    expect(computeDeposit(120, { type: 'percent', value: Number.NaN })).toBeNull()
  })

  it('returns null on a zero-total quote rather than a zero deposit', () => {
    expect(computeDeposit(0, { type: 'percent', value: 50 })).toBeNull()
  })
})
