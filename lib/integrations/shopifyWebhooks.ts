import crypto from 'crypto'

// Verification for Shopify's webhooks — in practice the three mandatory
// compliance topics (see app/api/integrations/shopify/compliance/route.ts).
//
// Same reasoning as the eBay deletion endpoint: the handler deletes data and
// its URL is registered publicly with Shopify, so without verification anyone
// could POST a redact request and strip data out of a seller's orders.
//
// Shopify's scheme is simpler than eBay's — a shared secret rather than
// public-key crypto:
//   - header `X-Shopify-Hmac-SHA256`, base64
//   - HMAC-SHA256 over the **raw request body**, keyed with the app's client
//     secret (the same SHOPIFY_CLIENT_SECRET used for OAuth)
// The raw-body requirement is the trap: parsing and re-serialising changes the
// bytes and the digest will never match, so the route reads text() first and
// parses only after verifying.
const clientSecret = () => process.env.SHOPIFY_CLIENT_SECRET || ''

/**
 * True only if the body was signed with our app's client secret.
 *
 * Returns false rather than throwing for anything malformed — a wrong-length
 * or non-base64 header is a failed verification, not an error worth a 500.
 * The one case that throws is missing configuration, which the caller must
 * treat as "can't verify, don't act".
 */
export function verifyShopifyWebhook(rawBody: string, hmacHeader: string | null): boolean {
  if (!clientSecret()) {
    throw new Error('Shopify webhook verification needs SHOPIFY_CLIENT_SECRET.')
  }
  if (!hmacHeader) return false

  const expected = crypto.createHmac('sha256', clientSecret()).update(rawBody, 'utf8').digest()

  let received: Buffer
  try {
    received = Buffer.from(hmacHeader, 'base64')
  } catch {
    return false
  }

  // timingSafeEqual throws on a length mismatch, which would otherwise leak as
  // a 500 on any junk header — and the length itself is not a secret.
  if (received.length !== expected.length) return false
  return crypto.timingSafeEqual(expected, received)
}
