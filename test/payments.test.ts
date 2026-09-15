import { describe, it, expect } from 'vitest'
import { amountDue, netPaid, summarizePayments, isOwed } from '../lib/payments'

describe('amountDue', () => {
  const lineItems = [
    { quantity: 2, unit_price: 25 },
    { quantity: 1, unit_price: 8, item_type: 'shipping', buyer_covered: true },
    { quantity: 1, unit_price: 5, item_type: 'shipping', buyer_covered: false },
  ]

  it('uses line items when there is no invoice or accepted quote, skipping seller-covered shipping', () => {
    expect(amountDue({ lineItems })).toEqual({ amount: 58, source: 'line_items' })
  })

  it('prefers the latest invoice (which includes tax) over everything', () => {
    expect(amountDue({ lineItems, latestInvoiceTotal: 62.64, acceptedQuoteTotal: 60 })).toEqual({ amount: 62.64, source: 'invoice' })
  })

  it('falls back to the accepted quote before line items', () => {
    expect(amountDue({ lineItems, acceptedQuoteTotal: 60.5 })).toEqual({ amount: 60.5, source: 'quote' })
  })

  it('treats an invoice total of zero as a real invoice, not a missing one', () => {
    expect(amountDue({ lineItems, latestInvoiceTotal: 0 }).source).toBe('invoice')
  })
})

describe('netPaid', () => {
  it('subtracts refunds and tolerates string amounts from the database', () => {
    expect(netPaid([
      { amount: '20.00', kind: 'payment' },
      { amount: 38.1, kind: 'payment' },
      { amount: '5', kind: 'refund' },
    ])).toBe(53.1)
  })
})

describe('summarizePayments', () => {
  const s = (due: number, amounts: number[], isMarketplace = false) =>
    summarizePayments({ due, payments: amounts.map(a => ({ amount: a, kind: 'payment' })), isMarketplace })

  it('reports each status', () => {
    expect(s(50, []).status).toBe('unpaid')
    expect(s(50, [20]).status).toBe('partial')
    expect(s(50, [20, 30]).status).toBe('paid')
    expect(s(50, [60]).status).toBe('overpaid')
    expect(s(0, []).status).toBe('no_charge')
  })

  it('gives the remaining balance, negative when overpaid', () => {
    expect(s(50, [20]).balance).toBe(30)
    expect(s(50, [60]).balance).toBe(-10)
  })

  it('absorbs a cent of rounding between tax maths and what was entered', () => {
    expect(s(53.505, [53.5]).status).toBe('paid')
  })

  it('never shows a balance on marketplace orders', () => {
    expect(s(80, [], true)).toEqual({ status: 'marketplace', due: 80, paid: 80, balance: 0 })
  })

  it('counts a refund that leaves money outstanding as partial again', () => {
    const summary = summarizePayments({
      due: 50,
      payments: [{ amount: 50, kind: 'payment' }, { amount: 10, kind: 'refund' }],
      isMarketplace: false,
    })
    expect(summary).toMatchObject({ status: 'partial', balance: 10 })
  })
})

describe('isOwed', () => {
  const unpaid = summarizePayments({ due: 40, payments: [], isMarketplace: false })
  const deposit = summarizePayments({ due: 40, payments: [{ amount: 10, kind: 'payment' }], isMarketplace: false })
  const paid = summarizePayments({ due: 40, payments: [{ amount: 40, kind: 'payment' }], isMarketplace: false })

  it('counts unpaid and part-paid work that is under way or delivered', () => {
    for (const status of ['in_progress', 'shipped', 'complete']) {
      expect(isOwed(unpaid, status)).toBe(true)
      expect(isOwed(deposit, status)).toBe(true)
      expect(isOwed(paid, status)).toBe(false)
    }
  })

  it('does not count an unpaid inquiry or quote, but does once a deposit is taken', () => {
    expect(isOwed(unpaid, 'inquiry')).toBe(false)
    expect(isOwed(unpaid, 'quoted')).toBe(false)
    expect(isOwed(deposit, 'quoted')).toBe(true)
  })

  it('never counts cancelled orders', () => {
    expect(isOwed(deposit, 'cancelled')).toBe(false)
  })
})
