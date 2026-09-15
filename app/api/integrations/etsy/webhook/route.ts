import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { parseEtsyOrderEvent, verifyEtsyWebhook } from '@/lib/integrations/etsyWebhooks'
import { etsyProvider } from '@/lib/integrations/etsy'
import { syncSingleOrder } from '@/lib/integrations/sync'
import type { NormalizedOrder } from '@/lib/integrations/types'

// Etsy order webhooks: order.paid, order.canceled, order.shipped,
// order.delivered. Subscribed in Etsy's Webhook Portal (app dashboard), all
// four topics pointing at:
//   https://orderforge-eight.vercel.app/api/integrations/etsy/webhook
//
// A webhook is treated as "sync this one order now", never as data to write
// directly. The payload only names the receipt; the receipt is re-fetched from
// Etsy and run through syncSingleOrder, the same import path as the scheduled
// poll — so the status guard, never-clobber rules, inventory deduction and
// restock all apply. The poll stays on as the backstop for any missed delivery.
//
// Response codes: 401 bad signature, 500 when we couldn't verify or couldn't
// finish (Etsy retries, which is what we want), 200 for everything else —
// including events for shops nobody here has connected, which retrying won't fix.

// What each event adds on top of the receipt itself. The receipt has no
// delivery field, so order.delivered is the only route to Complete. Cancelled
// already comes through on the receipt's status; the floor just makes the
// intent explicit if Etsy's receipt lags the event.
const STATUS_FLOOR: Partial<Record<string, NormalizedOrder['status']>> = {
  'order.delivered': 'complete',
  'order.canceled': 'cancelled',
}

export async function POST(request: NextRequest) {
  // Raw body: the signature covers the exact bytes Etsy sent.
  const rawBody = await request.text()
  const webhookId = request.headers.get('webhook-id')

  let verified: boolean
  try {
    verified = verifyEtsyWebhook(rawBody, {
      id: webhookId,
      timestamp: request.headers.get('webhook-timestamp'),
      signature: request.headers.get('webhook-signature'),
    })
  } catch (e) {
    console.error('[etsy] webhook verification unavailable', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Verification unavailable' }, { status: 500 })
  }

  if (!verified) {
    console.warn('[etsy] rejected webhook with invalid or stale signature', { webhookId })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.warn('[etsy] webhook body was not valid JSON', { webhookId })
    return NextResponse.json({}, { status: 200 })
  }

  const event = parseEtsyOrderEvent(payload)
  if (!event) {
    console.warn('[etsy] unhandled webhook event', { webhookId, eventType: (payload as any)?.event_type })
    return NextResponse.json({}, { status: 200 })
  }

  const admin = createSupabaseAdminClient()
  const { data: connections, error } = await admin
    .from('marketplace_connections')
    .select('user_id')
    .eq('provider', 'etsy')
    .eq('external_shop_id', event.shopId)

  if (error) {
    console.error('[etsy] webhook connection lookup failed', { webhookId }, error.message)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }

  if (!connections?.length) {
    console.warn('[etsy] webhook for a shop with no connection', { webhookId, shopId: event.shopId })
    return NextResponse.json({}, { status: 200 })
  }

  // Normally one connection per shop; loop anyway so each owner's copy stays
  // correct. Any failure fails the delivery so Etsy retries — safe, because
  // the import is idempotent for the ones that already succeeded.
  let failed = false
  for (const conn of connections) {
    try {
      const result = await syncSingleOrder(etsyProvider, conn.user_id, event.receiptId, {
        statusFloor: STATUS_FLOOR[event.eventType],
      })
      console.log('[etsy] webhook handled', {
        webhookId,
        eventType: event.eventType,
        shopId: event.shopId,
        receiptId: event.receiptId,
        ...result,
      })
    } catch (e) {
      failed = true
      console.error('[etsy] webhook sync failed', { webhookId, eventType: event.eventType, receiptId: event.receiptId },
        e instanceof Error ? e.message : e)
    }
  }

  return failed
    ? NextResponse.json({ error: 'Processing failed' }, { status: 500 })
    : NextResponse.json({}, { status: 200 })
}
