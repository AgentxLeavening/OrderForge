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

// A first-connect backfill reaches at least this far back, even when the
// current year hasn't been running that long yet.
const FIRST_SYNC_MIN_DAYS = 90

// The window a provider's fetchOrdersSince should actually use.
//
// Every sync after the first uses the year start, exactly as above — that's
// what keeps tax reporting whole. But the year start is a *seasonal* depth:
// on 2 January it reaches back two days, so a seller connecting a shop then
// would import almost nothing and reasonably conclude the sync is broken.
// A first connect therefore reaches back whichever is further, the year
// start or FIRST_SYNC_MIN_DAYS ago. From roughly April onwards the year
// start is already the deeper of the two and this changes nothing.
//
// `lastSyncedAt` is marketplace_connections.last_synced_at, which is null
// until a connection's first successful sync — so "has this account synced
// before" needs no extra state.
//
// Consequence worth knowing: a January first sync pulls in orders from last
// year, and later syncs won't re-check those for status changes once the
// window snaps back to the year start. That's the same trade-off documented
// above, reached from the other direction, and those orders fall outside
// this year's tax scope anyway.
export function syncCutoffISO(lastSyncedAt: string | null): string {
  const yearStart = currentYearStartISO()
  if (lastSyncedAt) return yearStart

  const minBackfill = new Date(Date.now() - FIRST_SYNC_MIN_DAYS * 24 * 60 * 60 * 1000).toISOString()
  return minBackfill < yearStart ? minBackfill : yearStart
}
