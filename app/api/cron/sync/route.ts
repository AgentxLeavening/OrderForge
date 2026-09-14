import crypto from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { syncProviderOrders } from '@/lib/integrations/sync'
import { getSyncableProvider, SYNCABLE_PROVIDER_IDS } from '@/lib/integrations/registry'

// Scheduled marketplace sync, so orders arrive without anyone clicking
// "Sync now". Triggered externally rather than by Vercel Cron: on the Hobby
// plan cron fires at most once a day, which is too slow to be worth having.
// A GitHub Actions schedule calls this instead — see
// .github/workflows/scheduled-sync.yml.
//
// Auth is a shared secret in the Authorization header, because this runs with
// no user session and syncs *every* seller's connections. Without it, anyone
// could make the app hammer three marketplace APIs on demand.
const CRON_SECRET = process.env.CRON_SECRET || ''

// One provider per invocation by default. Vercel's published Hobby function
// timeout is inconsistent across their own docs (10s / 60s / 300s depending
// where you look), so this is built to stay comfortably inside the shortest
// of those rather than betting on the longest. The workflow calls the route
// once per provider; `?provider=` picks which.
function isAuthorized(request: NextRequest): boolean {
  if (!CRON_SECRET) return false

  const header = request.headers.get('authorization') || ''
  const presented = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!presented) return false

  const a = Buffer.from(presented)
  const b = Buffer.from(CRON_SECRET)
  // Length check first: timingSafeEqual throws on a mismatch, and the length
  // of a secret isn't itself a secret worth protecting.
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    // Deliberately terse: no hint about whether CRON_SECRET is set.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const requested = new URL(request.url).searchParams.get('provider')
  const providerIds = requested ? [requested] : SYNCABLE_PROVIDER_IDS

  const admin = createSupabaseAdminClient()
  const results: Array<Record<string, unknown>> = []

  for (const providerId of providerIds) {
    const provider = getSyncableProvider(providerId)
    if (!provider) {
      results.push({ provider: providerId, skipped: 'not a syncable provider' })
      continue
    }

    const { data: connections, error } = await admin
      .from('marketplace_connections')
      .select('user_id')
      .eq('provider', providerId)

    if (error) {
      results.push({ provider: providerId, error: error.message })
      continue
    }

    for (const conn of connections || []) {
      try {
        const result = await syncProviderOrders(provider, conn.user_id)
        results.push({ provider: providerId, ...result })
      } catch (e) {
        // One seller's broken connection must not stop everyone else's sync.
        // syncProviderOrders already records the reason on the connection row
        // (last_sync_error), which is where to look when one goes quiet —
        // easier than digging through function logs.
        const message = e instanceof Error ? e.message : String(e)
        console.warn(`[cron] ${providerId} sync failed for a connection`, message)
        results.push({ provider: providerId, error: message })
      }
    }
  }

  // User ids are deliberately absent from the response: this endpoint is
  // reachable by anything holding the secret, and it doesn't need to hand back
  // a roster of accounts to do its job.
  return NextResponse.json({ ranAt: new Date().toISOString(), results })
}
