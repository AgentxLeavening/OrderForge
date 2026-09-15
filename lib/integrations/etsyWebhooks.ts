import crypto from 'crypto'

// Verification for Etsy's order webhooks (app/api/integrations/etsy/webhook).
//
// The endpoint is public and its deliveries change order status and restock
// inventory, so without verification anyone could POST "order.canceled" and
// knock a seller's live orders over. That said, the payload carries only ids —
// the handler re-fetches the receipt from Etsy's API before writing anything —
// so verification mainly stops strangers triggering API calls and status
// floors ("delivered" -> Complete) that Etsy never sent.
//
// A third distinct scheme, next to eBay's ECDSA and Shopify's single-header
// HMAC. Etsy follows the Standard Webhooks pattern:
//   - headers `webhook-id`, `webhook-timestamp` (unix seconds), `webhook-signature`
//   - signed content: `${id}.${timestamp}.${rawBody}` — the raw bytes, so the
//     route must read text() and parse only after verifying
//   - HMAC-SHA256 keyed with the signing secret from Etsy's dashboard, which
//     looks like `whsec_<base64>`: strip the prefix and base64-decode for the key
//   - signature base64. Standard Webhooks sends it as a space-separated list of
//     `v1,<base64>` entries (several during secret rotation); Etsy's docs only
//     say "compare", so a bare base64 value is accepted too.
const signingSecret = () => process.env.ETSY_WEBHOOK_SECRET || ''

// Replay window. A captured delivery is valid forever otherwise, and Etsy's
// docs suggest 5 minutes.
export const TIMESTAMP_TOLERANCE_SECONDS = 300

export type EtsyWebhookHeaders = {
  id: string | null
  timestamp: string | null
  signature: string | null
}

function secretKey(): Buffer {
  const secret = signingSecret()
  if (!secret) throw new Error('Etsy webhook verification needs ETSY_WEBHOOK_SECRET.')
  const encoded = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret
  return Buffer.from(encoded, 'base64')
}

/**
 * True only if Etsy signed this exact body recently.
 *
 * Returns false rather than throwing for anything malformed or stale. The one
 * case that throws is missing configuration, which the caller must treat as
 * "can't verify, don't act".
 */
export function verifyEtsyWebhook(
  rawBody: string,
  headers: EtsyWebhookHeaders,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  const key = secretKey()
  const { id, timestamp, signature } = headers
  if (!id || !timestamp || !signature) return false

  const ts = Number(timestamp)
  if (!Number.isInteger(ts) || Math.abs(nowSeconds - ts) > TIMESTAMP_TOLERANCE_SECONDS) return false

  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`, 'utf8').digest()

  const candidates = signature
    .split(' ')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const comma = part.indexOf(',')
      if (comma === -1) return part
      // Only v1 (HMAC-SHA256) is defined; ignore other versions rather than
      // trying to verify them as if they were.
      return part.slice(0, comma) === 'v1' ? part.slice(comma + 1) : null
    })
    .filter((s): s is string => !!s)

  return candidates.some(candidate => {
    const received = Buffer.from(candidate, 'base64')
    // timingSafeEqual throws on a length mismatch; the length isn't secret.
    return received.length === expected.length && crypto.timingSafeEqual(expected, received)
  })
}

export type EtsyOrderEvent = {
  eventType: 'order.paid' | 'order.canceled' | 'order.shipped' | 'order.delivered'
  shopId: string
  receiptId: string
}

const ORDER_EVENTS = new Set(['order.paid', 'order.canceled', 'order.shipped', 'order.delivered'])

/**
 * Pulls the ids out of a (verified) payload:
 *   { event_type, shop_id, resource_url: ".../shops/{shop}/receipts/{receipt}" }
 * Returns null for a topic we don't handle or a payload missing the ids.
 * The receipt id comes from resource_url because that's the only place Etsy's
 * documented payload carries it.
 */
export function parseEtsyOrderEvent(payload: any): EtsyOrderEvent | null {
  const eventType = payload?.event_type
  if (typeof eventType !== 'string' || !ORDER_EVENTS.has(eventType)) return null

  const match = typeof payload?.resource_url === 'string'
    ? payload.resource_url.match(/\/shops\/(\d+)\/receipts\/(\d+)(?:[/?#]|$)/)
    : null
  if (!match) return null

  // Prefer the explicit shop_id; it must agree with the URL if both are there.
  const shopId = payload?.shop_id != null ? String(payload.shop_id) : match[1]
  if (shopId !== match[1]) return null

  return { eventType: eventType as EtsyOrderEvent['eventType'], shopId, receiptId: match[2] }
}
