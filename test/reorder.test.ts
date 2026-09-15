import { describe, it, expect } from 'vitest'
import { computeUsage, buildReorderList, type ReorderItem, type UsageTransaction } from '../lib/reorder'

const NOW = Date.UTC(2026, 8, 15)
const daysAgo = (n: number) => new Date(NOW - n * 864e5).toISOString()

const tx = (over: Partial<UsageTransaction>): UsageTransaction => ({
  inventory_item_id: 'pla',
  order_id: 'o1',
  change: -10,
  reason: 'order_template_deduction',
  created_at: daysAgo(1),
  ...over,
})

const item = (over: Partial<ReorderItem>): ReorderItem => ({
  id: 'pla', name: 'Black PLA', unit: 'g', quantity: 500, unit_cost: 0.02, reorder_threshold: 200, ...over,
})

describe('computeUsage', () => {
  it('sums order deductions inside the window, split by channel', () => {
    const channels = new Map([['o1', 'etsy'], ['o2', 'ebay']])
    const u = computeUsage([
      tx({ order_id: 'o1', change: -30 }),
      tx({ order_id: 'o2', change: -20 }),
      tx({ order_id: 'o3', change: -99, created_at: daysAgo(45) }), // outside 30d
    ], 30, channels, NOW)
    expect(u.get('pla')).toEqual({ used: 50, byChannel: { etsy: 30, ebay: 20 } })
  })

  it('ignores an order that was later restocked, even if the restock is outside the window', () => {
    const u = computeUsage([
      tx({ order_id: 'o1', change: -40, created_at: daysAgo(2) }),
      tx({ order_id: 'o1', change: 40, reason: 'order_cancelled_restock', created_at: daysAgo(1) }),
      tx({ order_id: 'o2', change: -40, created_at: daysAgo(40) }),
      tx({ order_id: 'o2', change: 40, reason: 'order_deleted_restock', created_at: daysAgo(5) }),
    ], 30, new Map(), NOW)
    // o2's restock sits inside the window but its deduction doesn't — it must
    // not show up as negative usage.
    expect(u.get('pla')).toBeUndefined()
  })

  it('does not count manual edits as usage', () => {
    const u = computeUsage([tx({ reason: 'manual_edit', order_id: null, change: -100 })], 30, new Map(), NOW)
    expect(u.size).toBe(0)
  })
})

describe('buildReorderList', () => {
  const opts = { windowDays: 30, coverDays: 30 }

  it('lists an item that will run out within the cover period, even above its threshold', () => {
    // 20 g/day, 500 on hand -> 25 days left
    const usage = new Map([['pla', { used: 600, byChannel: { etsy: 600 } }]])
    const [row] = buildReorderList([item({})], usage, opts)
    expect(row.low).toBe(false)
    expect(row.daysLeft).toBe(25)
    // threshold 200 + 20/day x 30 days - 500 on hand
    expect(row.suggestedQty).toBe(300)
    expect(row.estimatedCost).toBeCloseTo(6)
  })

  it('skips an item with plenty of stock for the cover period', () => {
    const usage = new Map([['pla', { used: 30, byChannel: {} }]]) // 1 g/day -> 500 days
    expect(buildReorderList([item({})], usage, opts)).toEqual([])
  })

  it('lists a low item with no usage, topping it up to twice the threshold', () => {
    const [row] = buildReorderList([item({ quantity: 150 })], new Map(), opts)
    expect(row.low).toBe(true)
    expect(row.daysLeft).toBeNull()
    expect(row.suggestedQty).toBe(250) // 2 x 200 - 150
  })

  it('never lists an item with no threshold and no usage', () => {
    expect(buildReorderList([item({ quantity: 0, reorder_threshold: null })], new Map(), opts)).toEqual([])
  })

  it('handles negative or missing quantities and costs', () => {
    const usage = new Map([['pla', { used: 300, byChannel: {} }]])
    const [row] = buildReorderList([item({ quantity: null, unit_cost: null, reorder_threshold: null })], usage, opts)
    expect(row.daysLeft).toBe(0)
    expect(row.suggestedQty).toBe(300)
    expect(row.estimatedCost).toBe(0)
  })

  it('orders by soonest to run out, then items with no usage', () => {
    const items = [
      item({ id: 'a', name: 'Idle low', quantity: 10, reorder_threshold: 50 }),
      item({ id: 'b', name: 'Slow', quantity: 100, reorder_threshold: null }),
      item({ id: 'c', name: 'Fast', quantity: 100, reorder_threshold: null }),
    ]
    const usage = new Map([
      ['b', { used: 150, byChannel: {} }], // 5/day -> 20 days
      ['c', { used: 600, byChannel: {} }], // 20/day -> 5 days
    ])
    expect(buildReorderList(items, usage, opts).map(r => r.item.name)).toEqual(['Fast', 'Slow', 'Idle low'])
  })
})
