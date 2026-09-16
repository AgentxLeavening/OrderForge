import { describe, it, expect } from 'vitest'
import {
  buildRecurringRows, dateInMonth, dueRecurring, monthlyCommitment, recurrenceLabel, MAX_BACKFILL_OCCURRENCES,
} from '../lib/recurring'

const NOW = new Date(2026, 8, 16) // 16 Sep 2026
const tmpl = (over: Record<string, unknown> = {}) => ({
  id: 't1', amount: 12.99, category: 'software', vendor: 'Adobe', note: 'Photoshop',
  incurred_on: '2026-06-15', recurrence: 'monthly', recurring_source_id: null, ...over,
})

describe('dueRecurring', () => {
  it('steps monthly templates every month', () => {
    expect(dueRecurring([tmpl()], NOW)[0].months).toEqual(['2026-07', '2026-08', '2026-09'])
  })

  it('steps quarterly templates every third month', () => {
    const due = dueRecurring([tmpl({ incurred_on: '2025-12-10', recurrence: 'quarterly' })], NOW)
    expect(due[0].months).toEqual(['2026-03', '2026-06', '2026-09'])
  })

  it('steps yearly templates every twelfth month', () => {
    const due = dueRecurring([tmpl({ incurred_on: '2024-02-01', recurrence: 'yearly' })], NOW)
    expect(due[0].months).toEqual(['2025-02', '2026-02'])
  })

  it('does not ask again for a period already generated', () => {
    const due = dueRecurring([
      tmpl(),
      { ...tmpl(), id: 'c1', incurred_on: '2026-07-15', recurrence: null, recurring_source_id: 't1' },
    ], NOW)
    expect(due[0].months).toEqual(['2026-08', '2026-09'])
  })

  it('counts the template itself as its own period', () => {
    expect(dueRecurring([tmpl({ incurred_on: '2026-09-02' })], NOW)).toEqual([])
  })

  it('does not raise a yearly renewal before its anniversary', () => {
    // Paid Dec 2025, yearly: nothing is owed until Dec 2026.
    expect(dueRecurring([tmpl({ incurred_on: '2025-12-01', recurrence: 'yearly' })], NOW)).toEqual([])
  })

  it('ignores generated copies as templates, so chains cannot form', () => {
    const copy = { ...tmpl(), id: 'c1', incurred_on: '2026-07-15', recurrence: 'monthly', recurring_source_id: 't1' }
    expect(dueRecurring([tmpl({ incurred_on: '2026-09-01' }), copy], NOW)).toEqual([])
  })

  it('ignores one-off expenses, future templates and unknown cycles', () => {
    expect(dueRecurring([tmpl({ recurrence: null })], NOW)).toEqual([])
    expect(dueRecurring([tmpl({ incurred_on: '2026-11-01' })], NOW)).toEqual([])
    expect(dueRecurring([tmpl({ recurrence: 'fortnightly' })], NOW)).toEqual([])
  })

  it('caps a long backfill at the most recent occurrences', () => {
    const due = dueRecurring([tmpl({ incurred_on: '2020-01-10' })], NOW)
    expect(due[0].months).toHaveLength(MAX_BACKFILL_OCCURRENCES)
    expect(due[0].months.at(-1)).toBe('2026-09')
  })

  it('rolls the year over correctly', () => {
    const due = dueRecurring([tmpl({ incurred_on: '2025-11-20' })], new Date(2026, 0, 5))
    expect(due[0].months).toEqual(['2025-12', '2026-01'])
  })
})

describe('dateInMonth', () => {
  it('keeps the billing day, clamped to short months', () => {
    expect(dateInMonth('2026-01-31', '2026-02')).toBe('2026-02-28')
    expect(dateInMonth('2026-01-31', '2026-04')).toBe('2026-04-30')
    expect(dateInMonth('2026-03-05', '2026-07')).toBe('2026-07-05')
    expect(dateInMonth('2028-01-31', '2028-02')).toBe('2028-02-29') // leap year
  })
})

describe('buildRecurringRows', () => {
  it('copies the template into one row per missing period, linked back to it', () => {
    const rows = buildRecurringRows(dueRecurring([tmpl()], NOW), 'user-1')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({
      user_id: 'user-1', amount: 12.99, category: 'software', vendor: 'Adobe', note: 'Photoshop',
      incurred_on: '2026-07-15', recurrence: null, recurring_source_id: 't1',
    })
  })
})

describe('monthlyCommitment', () => {
  it('spreads quarterly and yearly costs across their cycle so they compare', () => {
    const total = monthlyCommitment([
      tmpl({ amount: 10 }),                                      // 10/month
      tmpl({ id: 't2', amount: 30, recurrence: 'quarterly' }),   // 10/month
      tmpl({ id: 't3', amount: '120', recurrence: 'yearly' }),   // 10/month
      { ...tmpl(), id: 'c1', recurrence: null, recurring_source_id: 't1' }, // copy, ignored
    ])
    expect(total).toBe(30)
  })
})

describe('recurrenceLabel', () => {
  it('reads plainly, defaulting to One-off', () => {
    expect(recurrenceLabel('quarterly')).toBe('Quarterly')
    expect(recurrenceLabel(null)).toBe('One-off')
    expect(recurrenceLabel('nonsense')).toBe('One-off')
  })
})
