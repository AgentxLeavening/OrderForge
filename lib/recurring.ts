// Recurring expenses — monthly subscriptions, a quarterly market pitch, a
// yearly domain or insurance renewal.
//
// The dropdown marks a TEMPLATE and its cycle. Each period's actual spend is
// still its own row, created only when the seller confirms it on the expenses
// page, so the books never contain money they didn't put there. Generated rows
// carry `recurring_source_id` back to their template, which is what makes "has
// this period been recorded yet?" answerable exactly rather than by guessing
// from matching amounts and vendors.

export type Recurrence = 'monthly' | 'quarterly' | 'yearly'

export const RECURRENCE_OPTIONS: { value: '' | Recurrence; label: string }[] = [
  { value: '', label: 'One-off' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
]

/** How many months apart each occurrence falls. */
export const RECURRENCE_MONTHS: Record<Recurrence, number> = { monthly: 1, quarterly: 3, yearly: 12 }

export const recurrenceLabel = (value: string | null | undefined) =>
  RECURRENCE_OPTIONS.find(o => o.value === (value || ''))?.label ?? 'One-off'

export type RecurringExpense = {
  id: string
  amount: number | string
  category: string
  vendor: string | null
  note: string | null
  incurred_on: string // YYYY-MM-DD
  recurrence?: string | null
  recurring_source_id?: string | null
}

/** "YYYY-MM" for grouping; string slicing, so no timezone can shift a date column. */
export const monthOf = (date: string) => date.slice(0, 7)

const toIndex = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return y * 12 + (m - 1)
}
const fromIndex = (index: number) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`

/**
 * The template's day-of-month, in the given month, clamped to that month's
 * length — a subscription billed on the 31st lands on the 30th in April and
 * the 28th in February rather than rolling into the next month.
 */
export function dateInMonth(templateDate: string, month: string): string {
  const day = Number(templateDate.slice(8, 10)) || 1
  const [y, m] = month.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return `${month}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

export type DueRecurring = {
  template: RecurringExpense
  months: string[] // "YYYY-MM", oldest first
}

// A seller who hasn't opened the page in a while shouldn't be handed a decade
// of backfill to eyeball; older gaps stay theirs to add by hand. Counted in
// occurrences, not months, so a yearly renewal still offers several years.
export const MAX_BACKFILL_OCCURRENCES = 12

/**
 * Templates with occurrences that have no expense recorded against them yet,
 * from the period after the template up to today, stepping by the template's
 * own cycle: monthly every month, quarterly every third, yearly every twelfth.
 *
 * A template only counts when it is the original (`recurring_source_id` null) —
 * generated copies never spawn chains of their own.
 */
export function dueRecurring(expenses: RecurringExpense[], now: Date = new Date()): DueRecurring[] {
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const nowIndex = toIndex(thisMonth)
  const templates = expenses.filter(e => e.recurrence && !e.recurring_source_id)

  const coveredByTemplate = new Map<string, Set<string>>()
  for (const e of expenses) {
    if (!e.recurring_source_id) continue
    const set = coveredByTemplate.get(e.recurring_source_id) || new Set<string>()
    set.add(monthOf(e.incurred_on))
    coveredByTemplate.set(e.recurring_source_id, set)
  }

  const due: DueRecurring[] = []
  for (const template of templates) {
    const step = RECURRENCE_MONTHS[template.recurrence as Recurrence]
    if (!step) continue
    const startIndex = toIndex(monthOf(template.incurred_on))
    if (startIndex > nowIndex) continue
    const covered = coveredByTemplate.get(template.id) || new Set<string>()
    covered.add(monthOf(template.incurred_on)) // the template is its own period's entry

    const months: string[] = []
    for (let i = startIndex + step; i <= nowIndex; i += step) {
      const month = fromIndex(i)
      if (!covered.has(month)) months.push(month)
    }
    const capped = months.slice(-MAX_BACKFILL_OCCURRENCES)
    if (capped.length) due.push({ template, months: capped })
  }
  return due
}

/** Rows to insert for a confirmed catch-up: one per missing period per template. */
export function buildRecurringRows(due: DueRecurring[], userId: string) {
  return due.flatMap(({ template, months }) =>
    months.map(month => ({
      user_id: userId,
      amount: Number(template.amount) || 0,
      category: template.category,
      vendor: template.vendor,
      note: template.note,
      incurred_on: dateInMonth(template.incurred_on, month),
      recurrence: null,
      recurring_source_id: template.id,
    }))
  )
}

/**
 * What the recurring commitments cost per month, with quarterly and yearly
 * amounts spread across their cycle — the run-rate a seller wants to see, and
 * comparable across cycles ($120/year is $10/month, not $120/month).
 */
export function monthlyCommitment(expenses: RecurringExpense[]): number {
  const total = expenses
    .filter(e => e.recurrence && !e.recurring_source_id)
    .reduce((sum, e) => sum + (Number(e.amount) || 0) / (RECURRENCE_MONTHS[e.recurrence as Recurrence] || 1), 0)
  return Math.round(total * 100) / 100
}
