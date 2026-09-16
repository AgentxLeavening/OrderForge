// Due dates: what's late, what's due now, and what's coming.
//
// A ledger has no notion of a deadline; a workshop runs on them. This is the
// maths behind the dashboard's "due soon" strip and /dashboard/schedule.

export type ScheduleOrder = {
  id: string
  title: string
  status: string
  order_number: string
  due_date: string | null
}

export type DueBucket = 'overdue' | 'today' | 'this_week' | 'later' | 'no_date'

/** Orders that are finished aren't waiting on anyone, so they never appear. */
export const isOpenOrder = (status: string) => !['complete', 'cancelled'].includes(status)

/**
 * A `date` column comes back as "YYYY-MM-DD". Parsing that with `new Date()`
 * reads it as UTC midnight, which in a negative-offset timezone is the evening
 * *before* — an order due today would look overdue. Build a local date instead.
 */
export function parseDueDate(due: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(due)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

/** Whole days from today to the due date: negative is late, 0 is today. */
export function daysUntilDue(due: string, now: Date = new Date()): number | null {
  const date = parseDueDate(due)
  if (!date) return null
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((date.getTime() - today.getTime()) / 86400000)
}

/**
 * "This week" means the next seven days rather than the days left in the
 * calendar week: on a Saturday, a Monday deadline is the thing that matters,
 * and a week that empties itself every Sunday night would hide it.
 */
export function dueBucket(order: ScheduleOrder, now: Date = new Date()): DueBucket {
  if (!order.due_date) return 'no_date'
  const days = daysUntilDue(order.due_date, now)
  if (days == null) return 'no_date'
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  if (days <= 7) return 'this_week'
  return 'later'
}

/** "3 days late", "Today", "Tomorrow", "In 5 days", "12 Oct". */
export function dueLabel(due: string | null, now: Date = new Date()): string {
  if (!due) return 'No due date'
  const days = daysUntilDue(due, now)
  const date = parseDueDate(due)
  if (days == null || !date) return 'No due date'
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} late`
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days <= 7) return `In ${days} days`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export type ScheduleGroups = Record<DueBucket, ScheduleOrder[]>

/**
 * Open orders grouped by bucket, each group sorted by date (soonest first;
 * the undated group keeps its incoming order). Finished and cancelled orders
 * are dropped entirely.
 */
export function groupByDue(orders: ScheduleOrder[], now: Date = new Date()): ScheduleGroups {
  const groups: ScheduleGroups = { overdue: [], today: [], this_week: [], later: [], no_date: [] }
  for (const order of orders) {
    if (!isOpenOrder(order.status)) continue
    groups[dueBucket(order, now)].push(order)
  }
  for (const key of ['overdue', 'today', 'this_week', 'later'] as const) {
    groups[key].sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))
  }
  return groups
}

/** Everything needing attention now: late, due today, or due within the week. */
export function dueSoonCount(groups: ScheduleGroups): number {
  return groups.overdue.length + groups.today.length + groups.this_week.length
}
