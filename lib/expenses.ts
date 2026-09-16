// Business expenses — the deduction side of the books.
//
// Kept separate from an order's material/labour costs on purpose: those are
// what a job *consumed* (used for margin), while an expense is money that
// actually left the bank on a date (used for tax). A 1kg spool bought in
// March is one expense; the 25g it puts into an order in June is a cost.
// Double-counting the two would be wrong in both directions, so they never mix.

export const EXPENSE_CATEGORIES = [
  { value: 'materials', label: 'Materials & supplies' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'postage', label: 'Postage & shipping' },
  { value: 'marketplace_fees', label: 'Marketplace & payment fees' },
  { value: 'equipment', label: 'Tools & equipment' },
  { value: 'software', label: 'Software & subscriptions' },
  { value: 'booth_fees', label: 'Markets & booth fees' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'mileage', label: 'Mileage & travel' },
  { value: 'other', label: 'Other' },
] as const

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number]['value']

export const expenseCategoryLabel = (value: string | null | undefined) =>
  EXPENSE_CATEGORIES.find(c => c.value === value)?.label ?? 'Other'

export type ExpenseRecord = {
  amount: number | string | null
  category?: string | null
  incurred_on?: string | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Total spent. */
export function totalExpenses(expenses: ExpenseRecord[]): number {
  return round2(expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0))
}

/**
 * Totals per category, biggest first — the shape an accountant asks for and
 * the shape that shows a seller where the money actually goes.
 */
export function totalsByCategory(expenses: ExpenseRecord[]): { category: string; label: string; total: number }[] {
  const totals = new Map<string, number>()
  for (const e of expenses) {
    const key = e.category || 'other'
    totals.set(key, (totals.get(key) || 0) + (Number(e.amount) || 0))
  }
  return [...totals.entries()]
    .map(([category, total]) => ({ category, label: expenseCategoryLabel(category), total: round2(total) }))
    .sort((a, b) => b.total - a.total)
}

/**
 * Inclusive date-range filter over "YYYY-MM-DD" strings.
 *
 * Compared as strings deliberately: `incurred_on` is a date column with no
 * time or zone, and parsing it into a Date to compare would reintroduce the
 * UTC-midnight bug fixed in lib/schedule.ts.
 */
export function withinRange(expenses: ExpenseRecord[], startDate: string, endDate: string): ExpenseRecord[] {
  return expenses.filter(e => {
    const on = (e.incurred_on || '').slice(0, 10)
    return !!on && on >= startDate && on <= endDate
  })
}
