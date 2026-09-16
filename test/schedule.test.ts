import { describe, it, expect } from 'vitest'
import { daysUntilDue, dueBucket, dueLabel, groupByDue, dueSoonCount, isOpenOrder } from '../lib/schedule'

// Midday local time, so tests don't depend on the machine's timezone offset.
const NOW = new Date(2026, 8, 15, 12, 0, 0) // Tue 15 Sep 2026
const order = (over: Partial<Parameters<typeof dueBucket>[0]> = {}) => ({
  id: 'o1', title: 'Resin dice', status: 'in_progress', order_number: 'ORD-1', due_date: null, ...over,
})

describe('daysUntilDue', () => {
  it('counts whole days, negative when late', () => {
    expect(daysUntilDue('2026-09-15', NOW)).toBe(0)
    expect(daysUntilDue('2026-09-16', NOW)).toBe(1)
    expect(daysUntilDue('2026-09-12', NOW)).toBe(-3)
  })

  it('treats a date column as a local date, not UTC midnight', () => {
    // The bug this guards: new Date('2026-09-15') is UTC midnight, which is
    // the 14th in the Americas — an order due today would read as overdue.
    expect(daysUntilDue('2026-09-15', new Date(2026, 8, 15, 0, 30, 0))).toBe(0)
    expect(daysUntilDue('2026-09-15', new Date(2026, 8, 15, 23, 30, 0))).toBe(0)
  })
})

describe('dueBucket', () => {
  it('sorts orders into late, today, the next seven days, and later', () => {
    expect(dueBucket(order({ due_date: '2026-09-10' }), NOW)).toBe('overdue')
    expect(dueBucket(order({ due_date: '2026-09-15' }), NOW)).toBe('today')
    expect(dueBucket(order({ due_date: '2026-09-22' }), NOW)).toBe('this_week')
    expect(dueBucket(order({ due_date: '2026-09-23' }), NOW)).toBe('later')
    expect(dueBucket(order({ due_date: null }), NOW)).toBe('no_date')
  })
})

describe('dueLabel', () => {
  it('reads the way someone would say it', () => {
    expect(dueLabel('2026-09-14', NOW)).toBe('1 day late')
    expect(dueLabel('2026-09-12', NOW)).toBe('3 days late')
    expect(dueLabel('2026-09-15', NOW)).toBe('Today')
    expect(dueLabel('2026-09-16', NOW)).toBe('Tomorrow')
    expect(dueLabel('2026-09-19', NOW)).toBe('In 4 days')
    expect(dueLabel(null, NOW)).toBe('No due date')
  })
})

describe('groupByDue', () => {
  const orders = [
    order({ id: 'late', due_date: '2026-09-10' }),
    order({ id: 'today', due_date: '2026-09-15' }),
    order({ id: 'soon', due_date: '2026-09-18' }),
    order({ id: 'later', due_date: '2026-10-30' }),
    order({ id: 'undated' }),
    order({ id: 'done', due_date: '2026-09-11', status: 'complete' }),
    order({ id: 'cancelled', due_date: '2026-09-11', status: 'cancelled' }),
  ]

  it('drops finished and cancelled orders', () => {
    expect(isOpenOrder('complete')).toBe(false)
    const groups = groupByDue(orders, NOW)
    const ids = Object.values(groups).flat().map(o => o.id)
    expect(ids).not.toContain('done')
    expect(ids).not.toContain('cancelled')
  })

  it('groups and sorts soonest first', () => {
    const groups = groupByDue([
      order({ id: 'b', due_date: '2026-09-19' }),
      order({ id: 'a', due_date: '2026-09-17' }),
    ], NOW)
    expect(groups.this_week.map(o => o.id)).toEqual(['a', 'b'])
  })

  it('counts everything needing attention this week', () => {
    expect(dueSoonCount(groupByDue(orders, NOW))).toBe(3)
  })
})
