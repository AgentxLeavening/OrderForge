import { describe, it, expect, afterEach, vi } from 'vitest'
import { syncCutoffISO } from '../lib/integrations/syncWindow'

// syncCutoffISO decides how far back a marketplace sync looks. The seasonal
// case is the whole reason it exists: anchoring purely to the year start
// means a shop connected in early January backfills almost nothing.
const at = (iso: string) => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('syncCutoffISO', () => {
  it('reaches back 90 days on a first connect in early January', () => {
    at('2026-01-02T12:00:00.000Z')
    const cutoff = syncCutoffISO(null)
    // Must cross back into the previous year rather than stopping at Jan 1.
    expect(cutoff < '2026-01-01T00:00:00.000Z').toBe(true)
    expect(cutoff.startsWith('2025-10-')).toBe(true)
  })

  it('still uses the year start for a repeat sync in early January', () => {
    at('2026-01-02T12:00:00.000Z')
    expect(syncCutoffISO('2026-01-01T09:00:00.000Z')).toBe('2026-01-01T00:00:00.000Z')
  })

  it('uses the year start once it is deeper than 90 days', () => {
    at('2026-09-14T12:00:00.000Z')
    expect(syncCutoffISO(null)).toBe('2026-01-01T00:00:00.000Z')
    expect(syncCutoffISO('2026-09-01T00:00:00.000Z')).toBe('2026-01-01T00:00:00.000Z')
  })

  it('never returns a shallower window for a first sync than a repeat one', () => {
    // The property that matters, checked across the seasonal boundary where
    // the two candidate windows swap places (around the start of April).
    for (const day of ['2026-01-15', '2026-02-20', '2026-03-31', '2026-04-02', '2026-07-04']) {
      at(`${day}T12:00:00.000Z`)
      expect(syncCutoffISO(null) <= syncCutoffISO('2026-01-05T00:00:00.000Z')).toBe(true)
    }
  })
})
