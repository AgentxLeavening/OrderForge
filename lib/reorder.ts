import { isLowStock } from './inventory'

// Reorder list (/dashboard/reports/reorder): low-stock items turned into a
// shopping list, sized from how fast each item is actually being used across
// every sales channel. Pure functions so the maths is testable without a DB.

export type ReorderItem = {
  id: string
  name: string
  sku?: string | null
  unit?: string | null
  quantity: number | null
  unit_cost: number | null
  reorder_threshold?: number | null
}

export type UsageTransaction = {
  inventory_item_id: string | null
  order_id: string | null
  change: number | null
  reason: string | null
  created_at: string
}

export type ItemUsage = {
  used: number
  byChannel: Record<string, number>
}

const DEDUCTION = 'order_template_deduction'
const RESTOCKS = new Set(['order_cancelled_restock', 'order_deleted_restock'])

/**
 * Units consumed per item over the last `windowDays`, from order deductions.
 *
 * Only order-driven usage counts. Manual edits are left out on purpose: a
 * manual decrease might be real usage, but it might equally be a stock-take
 * correction, and there's no way to tell — guessing would skew the rate.
 *
 * An order that was later restocked (cancelled or deleted) contributes nothing,
 * whenever the restock happened. Netting restocks against deductions inside the
 * window instead would go wrong at the edges: a restock inside the window for a
 * deduction before it would read as negative usage.
 */
export function computeUsage(
  transactions: UsageTransaction[],
  windowDays: number,
  channelByOrderId: Map<string, string | null> = new Map(),
  now: number = Date.now()
): Map<string, ItemUsage> {
  const since = now - windowDays * 24 * 60 * 60 * 1000
  const restockedOrders = new Set(
    transactions.filter(t => t.order_id && RESTOCKS.has(t.reason || '')).map(t => t.order_id as string)
  )

  const usage = new Map<string, ItemUsage>()
  for (const t of transactions) {
    if (t.reason !== DEDUCTION || !t.inventory_item_id) continue
    if (t.order_id && restockedOrders.has(t.order_id)) continue
    if (new Date(t.created_at).getTime() < since) continue
    const amount = -(Number(t.change) || 0)
    if (amount <= 0) continue

    const entry = usage.get(t.inventory_item_id) || { used: 0, byChannel: {} }
    entry.used += amount
    const channel = (t.order_id && channelByOrderId.get(t.order_id)) || 'unspecified'
    entry.byChannel[channel] = (entry.byChannel[channel] || 0) + amount
    usage.set(t.inventory_item_id, entry)
  }
  return usage
}

export type ReorderRow = {
  item: ReorderItem
  dailyRate: number          // units per day over the usage window
  daysLeft: number | null    // null = no recent usage to project from
  low: boolean               // at or below its reorder threshold
  suggestedQty: number
  estimatedCost: number
  byChannel: Record<string, number>
}

/**
 * Items that need buying, most urgent first.
 *
 * An item is on the list when it is already low (at/below its threshold) or,
 * at its current rate, will run out within `coverDays`. Items with no
 * threshold and no recent usage never appear — there's nothing to base a
 * suggestion on.
 *
 * Suggested quantity buys enough to get through `coverDays` of usage and still
 * be at the threshold afterwards: threshold + rate × coverDays − on hand.
 * A low item with no recent usage has a rate of zero, which would suggest
 * topping up exactly to the threshold and leave it flagged low; those get
 * brought up to twice the threshold instead.
 */
export function buildReorderList(
  items: ReorderItem[],
  usage: Map<string, ItemUsage>,
  { windowDays, coverDays }: { windowDays: number; coverDays: number }
): ReorderRow[] {
  const rows: ReorderRow[] = []

  for (const item of items) {
    const onHand = Math.max(0, Number(item.quantity) || 0)
    const threshold = item.reorder_threshold == null ? null : Number(item.reorder_threshold)
    const u = usage.get(item.id)
    const dailyRate = u ? u.used / windowDays : 0
    const daysLeft = dailyRate > 0 ? onHand / dailyRate : null
    const low = isLowStock(item)
    const runsOutSoon = daysLeft !== null && daysLeft <= coverDays

    if (!low && !runsOutSoon) continue

    let target = (threshold ?? 0) + dailyRate * coverDays
    if (low && threshold !== null && dailyRate === 0) target = Math.max(target, threshold * 2)
    const suggestedQty = Math.max(0, Math.ceil(target - onHand))

    rows.push({
      item,
      dailyRate,
      daysLeft,
      low,
      suggestedQty,
      estimatedCost: suggestedQty * (Number(item.unit_cost) || 0),
      byChannel: u?.byChannel || {},
    })
  }

  // Soonest to run out first; items with no usage to project from (null) go
  // after those, since they're low but not being consumed.
  return rows.sort((a, b) => {
    const da = a.daysLeft ?? Number.POSITIVE_INFINITY
    const db = b.daysLeft ?? Number.POSITIVE_INFINITY
    if (da !== db) return da - db
    return a.item.name.localeCompare(b.item.name)
  })
}
