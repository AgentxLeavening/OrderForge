import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'
import { verifyShopifyWebhook } from '../lib/integrations/shopifyWebhooks'

// The compliance endpoint these guard deletes data and is publicly reachable,
// so the verification is the only thing standing between a stranger's POST and
// a seller's order rows. It can't be exercised against Shopify in CI, so the
// HMAC path is pinned here instead.

const SECRET = 'shpss_test_secret_value'
const body = JSON.stringify({
  shop_id: 123,
  shop_domain: 'like-gravy-dev.myshopify.com',
  customer: { id: 1, email: 'buyer@example.com' },
  orders_to_redact: [5001, 5002],
})

const sign = (payload: string, secret = SECRET) =>
  crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('base64')

let previousSecret: string | undefined

beforeEach(() => {
  previousSecret = process.env.SHOPIFY_CLIENT_SECRET
  process.env.SHOPIFY_CLIENT_SECRET = SECRET
})

afterEach(() => {
  if (previousSecret === undefined) delete process.env.SHOPIFY_CLIENT_SECRET
  else process.env.SHOPIFY_CLIENT_SECRET = previousSecret
})

describe('verifyShopifyWebhook', () => {
  it('accepts a body signed with the app client secret', () => {
    expect(verifyShopifyWebhook(body, sign(body))).toBe(true)
  })

  it('rejects a body altered after signing', () => {
    // The attack that matters: keep the signature, change whose orders get wiped.
    const tampered = body.replace('5001', '9999')
    expect(verifyShopifyWebhook(tampered, sign(body))).toBe(false)
  })

  it('rejects a signature made with a different secret', () => {
    expect(verifyShopifyWebhook(body, sign(body, 'wrong-secret'))).toBe(false)
  })

  it('rejects a missing header', () => {
    expect(verifyShopifyWebhook(body, null)).toBe(false)
  })

  it('rejects a wrong-length digest without throwing', () => {
    // timingSafeEqual throws on length mismatch — that must not surface as a 500.
    expect(verifyShopifyWebhook(body, Buffer.from('short').toString('base64'))).toBe(false)
    expect(verifyShopifyWebhook(body, 'not base64 at all !!!')).toBe(false)
  })

  it('throws when the secret is not configured, rather than passing', () => {
    delete process.env.SHOPIFY_CLIENT_SECRET
    // Must be distinguishable from "invalid signature": the caller turns this
    // into a retryable 500, never a silent accept.
    expect(() => verifyShopifyWebhook(body, sign(body))).toThrow(/SHOPIFY_CLIENT_SECRET/)
  })
})
