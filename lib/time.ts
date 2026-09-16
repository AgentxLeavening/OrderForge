// Estimated vs actual time on an order.
//
// For commission and custom work, labour is the cost that matters — materials
// are often pennies next to the hours. This is where a maker finds out whether
// the hourly rate they price with is the rate they're actually getting.

export type TimeEntry = {
  minutes: number | string | null
  started_at: string | null
  ended_at: string | null
}

/** A running timer: started, never stopped, no minutes recorded. */
export const isRunning = (entry: TimeEntry) => entry.minutes == null && !!entry.started_at && !entry.ended_at

/**
 * Total minutes on an order, counting a running timer up to `now` so the
 * figure on screen moves while the clock does.
 */
export function totalMinutes(entries: TimeEntry[], now: number = Date.now()): number {
  return entries.reduce((sum, e) => {
    if (isRunning(e)) {
      const elapsed = (now - new Date(e.started_at as string).getTime()) / 60000
      return sum + Math.max(0, elapsed)
    }
    return sum + (Number(e.minutes) || 0)
  }, 0)
}

/** "2h 45m", "45m", "0m" — minutes rounded, hours only when there are some. */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  const hours = Math.floor(total / 60)
  const mins = total % 60
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
}

export type TimeComparison = {
  actualHours: number
  estimatedHours: number | null
  /** actual − estimated, in hours. Positive means over the estimate. */
  overBy: number | null
  /** actual ÷ estimated as a percentage, null when there's no estimate. */
  percentOfEstimate: number | null
}

export function compareToEstimate(minutes: number, estimatedHours: number | null | undefined): TimeComparison {
  const actualHours = Math.round((minutes / 60) * 100) / 100
  const estimate = estimatedHours == null ? null : Number(estimatedHours)
  if (estimate == null || !Number.isFinite(estimate) || estimate <= 0) {
    return { actualHours, estimatedHours: null, overBy: null, percentOfEstimate: null }
  }
  return {
    actualHours,
    estimatedHours: estimate,
    overBy: Math.round((actualHours - estimate) * 100) / 100,
    percentOfEstimate: Math.round((actualHours / estimate) * 100),
  }
}

/**
 * What the seller actually earned per hour of work on this order: everything
 * left after materials, shipping and fees, divided by the hours it really took.
 *
 * Deliberately not "profit ÷ hours": profit already has an estimated labour
 * cost subtracted, so dividing it by hours would charge the same work twice.
 * This is the number to compare against the hourly rate in Settings.
 */
export function effectiveHourlyRate({
  revenue,
  material,
  shipping,
  feeAmt,
  actualHours,
}: {
  revenue: number
  material: number
  shipping: number
  feeAmt: number
  actualHours: number
}): number | null {
  if (!(actualHours > 0)) return null
  const afterCosts = revenue - material - shipping - feeAmt
  return Math.round((afterCosts / actualHours) * 100) / 100
}
