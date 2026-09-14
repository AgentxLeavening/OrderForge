import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { verifyShopifyWebhook } from '@/lib/integrations/shopifyWebhooks'

// Shopify's three mandatory compliance webhooks. Implementing them is a
// precondition for distributing the app at all (App Store listing requires
// them), and they're the Shopify counterpart to eBay's account-deletion
// notification — see app/api/integrations/ebay/deletion/route.ts.
//
// All three topics share this one endpoint and are told apart by the
// `x-shopify-topic` header, so the Partner Dashboard can point all three
// mandatory URLs here:
//   https://orderforge-eight.vercel.app/api/integrations/shopify/compliance
//
// Shopify's rules, which differ from eBay's in ways worth not guessing at:
//   - an invalid HMAC must return **401** (eBay's equivalent wants 412)
//   - a valid request must get a 2xx, and the actual work has 30 days
//   - shop/redact arrives 48 hours AFTER an uninstall, not at uninstall
type ComplianceTopic = 'customers/data_request' | 'customers/redact' | 'shop/redact'

// Every payload identifies the store; that's how we find whose data this is.
// external_shop_id on marketplace_connections holds the myshopify.com domain
// (set at token exchange), so shop_domain maps straight onto it.
async function findConnectionsForShop(shopDomain: string) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('marketplace_connections')
    .select('id, user_id')
    .eq('provider', 'shopify')
    .eq('external_shop_id', shopDomain)

  if (error) throw new Error(`Failed looking up Shopify connection: ${error.message}`)
  return data || []
}

/**
 * customers/redact — a shopper asked the merchant to erase them.
 *
 * `orders_to_redact` carries Shopify's own order ids, which is exactly what we
 * store as orders.external_order_id, so this matches precisely rather than
 * guessing from names. As with eBay, we anonymise rather than delete: the
 * order is the seller's business record (needed for tax) and identifies nobody
 * once buyer_name is gone.
 *
 * Scoped to the user who owns that shop connection — an order id is only
 * unique within a shop, so an unscoped match could touch another seller's row.
 */
async function redactCustomer(shopDomain: string, payload: any): Promise<number> {
  const connections = await findConnectionsForShop(shopDomain)
  if (connections.length === 0) return 0

  const admin = createSupabaseAdminClient()
  const orderIds = ((payload?.orders_to_redact || []) as unknown[]).map(String).filter(Boolean)
  const customerEmail = typeof payload?.customer?.email === 'string' ? payload.customer.email.trim() : ''

  let redacted = 0
  for (const conn of connections) {
    if (orderIds.length > 0) {
      const { data, error } = await admin
        .from('orders')
        .update({ buyer_name: null, updated_at: new Date().toISOString() })
        .eq('user_id', conn.user_id)
        .eq('external_source', 'shopify')
        .in('external_order_id', orderIds)
        .select('id')
      if (error) throw new Error(`Failed redacting Shopify orders: ${error.message}`)
      redacted += (data || []).length
    }

    // Fallback for a customer with no orders in the payload. buyer_name falls
    // back to the email when Shopify gives us no name (see shopify.ts), so an
    // exact email match is precise — deliberately not a fuzzy name match,
    // which could erase the wrong person's row.
    if (customerEmail) {
      const { data, error } = await admin
        .from('orders')
        .update({ buyer_name: null, updated_at: new Date().toISOString() })
        .eq('user_id', conn.user_id)
        .eq('external_source', 'shopify')
        .eq('buyer_name', customerEmail)
        .select('id')
      if (error) throw new Error(`Failed redacting Shopify orders by email: ${error.message}`)
      redacted += (data || []).length
    }
  }
  return redacted
}

/**
 * shop/redact — 48 hours after the app was uninstalled, erase the store's data.
 *
 * What we hold *because of Shopify* is the connection row: OAuth token and
 * shop identifiers. That gets deleted, which also revokes our ability to read
 * anything further.
 *
 * Deliberately NOT deleted: the seller's OrderForge orders. They signed up
 * with us directly, independently of Shopify, and those rows are their own
 * business records — needed for their tax reporting and often predating the
 * Shopify connection entirely. Wiping a seller's books because they uninstalled
 * one sales channel would be destructive and is not what the topic is asking
 * for. If that reading is ever challenged, this is the line to revisit.
 */
async function redactShop(shopDomain: string): Promise<number> {
  const connections = await findConnectionsForShop(shopDomain)
  if (connections.length === 0) return 0

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('marketplace_connections')
    .delete()
    .in('id', connections.map(c => c.id))
    .select('id')

  if (error) throw new Error(`Failed deleting Shopify connection: ${error.message}`)
  return (data || []).length
}

/**
 * customers/data_request — the merchant must be given whatever we hold on a
 * shopper, so they can pass it on.
 *
 * Our entire footprint for a Shopify shopper is a display name on imported
 * orders; no address, email, phone or payment detail is ever stored. There's
 * no automated channel to hand that to the merchant yet, so this records the
 * request with the ids needed to fulfil it, well inside Shopify's 30-day
 * window. When a seller-facing view of these requests exists, surface it there
 * rather than leaving it in logs.
 */
async function recordDataRequest(shopDomain: string, payload: any): Promise<number> {
  const connections = await findConnectionsForShop(shopDomain)
  if (connections.length === 0) return 0

  const admin = createSupabaseAdminClient()
  const orderIds = ((payload?.orders_requested || []) as unknown[]).map(String).filter(Boolean)
  if (orderIds.length === 0) return 0

  const { data, error } = await admin
    .from('orders')
    .select('id, order_number, external_order_id')
    .in('user_id', connections.map(c => c.user_id))
    .eq('external_source', 'shopify')
    .in('external_order_id', orderIds)

  if (error) throw new Error(`Failed gathering Shopify customer data: ${error.message}`)
  return (data || []).length
}

export async function POST(request: NextRequest) {
  // Raw body: the HMAC covers the exact bytes Shopify sent, so parsing first
  // would guarantee a mismatch.
  const rawBody = await request.text()
  const topic = request.headers.get('x-shopify-topic') as ComplianceTopic | null
  const shopHeader = request.headers.get('x-shopify-shop-domain')

  let verified: boolean
  try {
    verified = verifyShopifyWebhook(rawBody, request.headers.get('x-shopify-hmac-sha256'))
  } catch (e) {
    // Couldn't attempt verification (no client secret configured). Never act on
    // an unverified payload — 500 so Shopify retries once we're healthy.
    console.error('[shopify] compliance webhook verification unavailable', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Verification unavailable' }, { status: 500 })
  }

  // Shopify specifically requires 401 here, not 403 or 412.
  if (!verified) {
    console.warn('[shopify] rejected compliance webhook with invalid HMAC', { topic })
    return NextResponse.json({ error: 'Invalid HMAC' }, { status: 401 })
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.warn('[shopify] compliance webhook body was not valid JSON', { topic })
    return NextResponse.json({}, { status: 200 })
  }

  const shopDomain: string = payload?.shop_domain || shopHeader || ''
  if (!shopDomain) {
    console.warn('[shopify] compliance webhook had no shop domain', { topic })
    return NextResponse.json({}, { status: 200 })
  }

  try {
    // Shop domains aren't secret, but customer emails and ids are exactly the
    // identifiers being erased — so they're never logged.
    switch (topic) {
      case 'customers/redact': {
        const redacted = await redactCustomer(shopDomain, payload)
        console.log('[shopify] customers/redact handled', { shopDomain, ordersRedacted: redacted })
        break
      }
      case 'shop/redact': {
        const removed = await redactShop(shopDomain)
        console.log('[shopify] shop/redact handled', { shopDomain, connectionsRemoved: removed })
        break
      }
      case 'customers/data_request': {
        const found = await recordDataRequest(shopDomain, payload)
        console.log('[shopify] customers/data_request received', {
          shopDomain,
          dataRequestId: payload?.data_request?.id,
          ordersHeld: found,
        })
        break
      }
      default: {
        // A topic we didn't expect, but verified as genuinely Shopify's.
        // Acknowledge — retrying delivers the same thing.
        console.warn('[shopify] unhandled compliance topic', { topic })
      }
    }
    return NextResponse.json({}, { status: 200 })
  } catch (e) {
    // Non-2xx so Shopify retries: the obligation is unmet until it succeeds.
    console.error('[shopify] compliance webhook failed', { topic, shopDomain }, e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}
