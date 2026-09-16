import { describe, it, expect } from 'vitest'
import { expenseCategoryLabel, totalExpenses, totalsByCategory, withinRange } from '../lib/expenses'

const rows = [
  { amount: 45.5, category: 'materials', incurred_on: '2026-03-02' },
  { amount: '12.25', category: 'packaging', incurred_on: '2026-03-15' },
  { amount: 60, category: 'materials', incurred_on: '2026-06-01' },
  { amount: 30, category: 'booth_fees', incurred_on: '2025-12-31' },
]

describe('totalExpenses', () => {
  it('sums, tolerating string amounts from the database', () => {
    expect(totalExpenses(rows)).toBe(147.75)
    expect(totalExpenses([])).toBe(0)
  })
})

describe('totalsByCategory', () => {
  it('groups and sorts biggest first, with readable labels', () => {
    expect(totalsByCategory(rows)).toEqual([
      { category: 'materials', label: 'Materials & supplies', total: 105.5 },
      { category: 'booth_fees', label: 'Markets & booth fees', total: 30 },
      { category: 'packaging', label: 'Packaging', total: 12.25 },
    ])
  })

  it('treats a missing category as Other rather than dropping the money', () => {
    const totals = totalsByCategory([{ amount: 10, category: null, incurred_on: '2026-01-01' }])
    expect(totals).toEqual([{ category: 'other', label: 'Other', total: 10 }])
  })
})

describe('withinRange', () => {
  it('is inclusive of both ends', () => {
    expect(withinRange(rows, '2026-03-02', '2026-03-15')).toHaveLength(2)
  })

  it('compares dates as strings, so no timezone can shift a date column', () => {
    // The bug this avoids: parsing "2026-01-01" as UTC midnight puts it in the
    // previous year for anyone west of Greenwich.
    expect(withinRange([{ amount: 5, category: 'other', incurred_on: '2026-01-01' }], '2026-01-01', '2026-12-31')).toHaveLength(1)
  })

  it('ignores rows with no date', () => {
    expect(withinRange([{ amount: 5, category: 'other', incurred_on: null }], '2026-01-01', '2026-12-31')).toEqual([])
  })
})

describe('expenseCategoryLabel', () => {
  it('falls back to Other for anything unrecognised', () => {
    expect(expenseCategoryLabel('postage')).toBe('Postage & shipping')
    expect(expenseCategoryLabel('nonsense')).toBe('Other')
    expect(expenseCategoryLabel(null)).toBe('Other')
  })
})
