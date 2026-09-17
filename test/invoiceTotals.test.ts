import { describe, it, expect } from 'vitest'
import { billableLine, invoiceTotals } from '../lib/invoiceTotals'

const lines = [
  { description: 'Resin dice set', quantity: 2, unit_price: 25 },
  { description: 'Shipping & tax', quantity: 1, unit_price: 8, item_type: 'shipping', buyer_covered: true },
]

describe('billableLine', () => {
  it('bills a shipping line the seller absorbed at zero', () => {
    expect(billableLine({ quantity: 1, unit_price: 9, item_type: 'shipping', buyer_covered: false })).toBe(0)
    expect(billableLine({ quantity: 1, unit_price: 9, item_type: 'shipping', buyer_covered: true })).toBe(9)
    expect(billableLine({ quantity: 3, unit_price: '4.50' })).toBe(13.5)
  })
})

describe('invoiceTotals', () => {
  it('totals with tax and no payments', () => {
    expect(invoiceTotals(lines, 7)).toEqual({
      subtotal: 58, taxAmount: 4.06, total: 62.06, paid: 0, balance: 62.06, fullyPaid: false,
    })
  })

  it('bills only the balance after a deposit', () => {
    const totals = invoiceTotals(lines, 0, [{ amount: 29, kind: 'payment', method: 'venmo', paid_at: '2026-09-10' }])
    expect(totals).toMatchObject({ total: 58, paid: 29, balance: 29, fullyPaid: false })
  })

  it('reports paid in full once nothing is left', () => {
    const totals = invoiceTotals(lines, 0, [{ amount: 58, kind: 'payment' }])
    expect(totals).toMatchObject({ balance: 0, fullyPaid: true })
  })

  it('counts refunds back onto the balance, matching the order page', () => {
    const totals = invoiceTotals(lines, 0, [{ amount: 58, kind: 'payment' }, { amount: 10, kind: 'refund' }])
    expect(totals).toMatchObject({ paid: 48, balance: 10, fullyPaid: false })
  })

  it('excludes absorbed shipping from the amount billed', () => {
    const absorbed = [lines[0], { ...lines[1], buyer_covered: false }]
    expect(invoiceTotals(absorbed, 0).total).toBe(50)
  })

  it('tolerates a penny of rounding rather than showing a phantom balance', () => {
    const totals = invoiceTotals([{ quantity: 1, unit_price: 53.505 }], 0, [{ amount: 53.5, kind: 'payment' }])
    expect(totals.fullyPaid).toBe(true)
  })

  it('is not paid in full when nothing has been paid at all', () => {
    expect(invoiceTotals([{ quantity: 1, unit_price: 0 }], 0).fullyPaid).toBe(false)
  })
})
