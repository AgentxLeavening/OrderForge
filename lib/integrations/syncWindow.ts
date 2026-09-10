// Shared "how far back do we look" cutoff for every provider's
// fetchOrdersSince. One window does double duty: it's both how deep a
// first-connect backfill reaches, and how far back every subsequent sync
// re-checks already-imported orders for a status change (see the
// per-provider comments in ebay.ts/etsy.ts/shopify.ts on why sinceISO /
// last_synced_at isn't used for this instead).
//
// Anchored to the start of the current calendar year rather than a rolling
// N-day window, specifically so tax reporting (see app/dashboard/reports/
// tax-export) is never missing part of the year just because a channel got
// connected, or last synced, partway through it. The trade-off: an order
// from last year that's still open won't get its status re-checked once
// the year turns over — acceptable since tax reporting is itself
// year-scoped, and the seller can still update it by hand.
export function currentYearStartISO(): string {
  return new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)).toISOString()
}
