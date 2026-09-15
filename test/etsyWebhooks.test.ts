import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'
import { verifyEtsyWebhook, parseEtsyOrderEvent, TIMESTAMP_TOLERANCE_SECONDS } from '../lib/integrations/etsyWebhooks'
import { normalizeReceipt } from '../lib/integrations/etsy'

// The webhook endpoint is public and moves orders to Complete / Cancelled, so
// verification is what stops a stranger's POST doing that. Etsy can't be
// called from CI, so the signing scheme is pinned here with a known secret.

const KEY = crypto.randomBytes(24)
const SECRET = `whsec_${KEY.toString('base64')}`
const NOW = 1_800_000_000
const ID = 'msg_2abc'
const body = JSON.stringify({
  event_type: 'order.delivered',
  resource_url: 'https://api.etsy.com/v3/application/shops/12345/receipts/987654',
  shop_id: '12345',
})

const sign = (payload: string, { id = ID, ts = NOW, key = KEY } = {}) =>
  crypto.createHmac('sha256', key).update(`${id}.${ts}.${payload}`, 'utf8').digest('base64')

const headers = (signature: string | null, { id = ID, ts = NOW } = {}) =>
  ({ id, timestamp: String(ts), signature })

let previousSecret: string | undefined

beforeEach(() => {
  previousSecret = process.env.ETSY_WEBHOOK_SECRET
  process.env.ETSY_WEBHOOK_SECRET = SECRET
})

afterEach(() => {
  if (previousSecret === undefined) delete process.env.ETSY_WEBHOOK_SECRET
  else process.env.ETSY_WEBHOOK_SECRET = previousSecret
})

describe('verifyEtsyWebhook', () => {
  it('accepts a v1-prefixed signature (Standard Webhooks format)', () => {
    expect(verifyEtsyWebhook(body, headers(`v1,${sign(body)}`), NOW)).toBe(true)
  })

  it('accepts a bare base64 signature', () => {
    expect(verifyEtsyWebhook(body, headers(sign(body)), NOW)).toBe(true)
  })

  it('accepts when any one of several signatures matches (secret rotation)', () => {
    const stale = sign(body, { key: crypto.randomBytes(24) })
    expect(verifyEtsyWebhook(body, headers(`v1,${stale} v1,${sign(body)}`), NOW)).toBe(true)
  })

  it('rejects a body altered after signing', () => {
    // The attack that matters: keep the signature, change which order gets touched.
    const tampered = body.replace('987654', '111111')
    expect(verifyEtsyWebhook(tampered, headers(`v1,${sign(body)}`), NOW)).toBe(false)
  })

  it('rejects a signature bound to a different webhook-id', () => {
    expect(verifyEtsyWebhook(body, headers(`v1,${sign(body, { id: 'other' })}`), NOW)).toBe(false)
  })

  it('rejects a signature made with a different secret', () => {
    expect(verifyEtsyWebhook(body, headers(`v1,${sign(body, { key: crypto.randomBytes(24) })}`), NOW)).toBe(false)
  })

  it('rejects a replayed delivery outside the timestamp window', () => {
    const old = NOW - TIMESTAMP_TOLERANCE_SECONDS - 1
    expect(verifyEtsyWebhook(body, headers(`v1,${sign(body, { ts: old })}`, { ts: old }), NOW)).toBe(false)
  })

  it('rejects an unknown signature version rather than verifying it as v1', () => {
    expect(verifyEtsyWebhook(body, headers(`v2,${sign(body)}`), NOW)).toBe(false)
  })

  it('rejects missing headers and junk without throwing', () => {
    expect(verifyEtsyWebhook(body, headers(null), NOW)).toBe(false)
    expect(verifyEtsyWebhook(body, { id: null, timestamp: String(NOW), signature: sign(body) }, NOW)).toBe(false)
    expect(verifyEtsyWebhook(body, { id: ID, timestamp: 'soon', signature: sign(body) }, NOW)).toBe(false)
    expect(verifyEtsyWebhook(body, headers('v1,short'), NOW)).toBe(false)
  })

  it('throws when the secret is not configured, rather than passing', () => {
    delete process.env.ETSY_WEBHOOK_SECRET
    expect(() => verifyEtsyWebhook(body, headers(`v1,${sign(body)}`), NOW)).toThrow(/ETSY_WEBHOOK_SECRET/)
  })
})

describe('parseEtsyOrderEvent', () => {
  it('extracts shop and receipt ids', () => {
    expect(parseEtsyOrderEvent(JSON.parse(body))).toEqual({
      eventType: 'order.delivered',
      shopId: '12345',
      receiptId: '987654',
    })
  })

  it('accepts a numeric shop_id', () => {
    expect(parseEtsyOrderEvent({ ...JSON.parse(body), shop_id: 12345 })?.shopId).toBe('12345')
  })

  it('rejects a shop_id that disagrees with the resource URL', () => {
    expect(parseEtsyOrderEvent({ ...JSON.parse(body), shop_id: '99999' })).toBeNull()
  })

  it('ignores topics we do not handle and payloads without a receipt', () => {
    expect(parseEtsyOrderEvent({ ...JSON.parse(body), event_type: 'listing.updated' })).toBeNull()
    expect(parseEtsyOrderEvent({ event_type: 'order.paid', shop_id: '12345' })).toBeNull()
    expect(parseEtsyOrderEvent(null)).toBeNull()
  })
})

describe('normalizeReceipt status', () => {
  const base = { receipt_id: 1, transactions: [], subtotal: { amount: 1000, divisor: 100 } }

  it('maps a canceled receipt to cancelled, even if it was marked shipped', () => {
    expect(normalizeReceipt({ ...base, status: 'Canceled', is_shipped: true }).status).toBe('cancelled')
  })

  it('does not treat a refund as a cancellation', () => {
    expect(normalizeReceipt({ ...base, status: 'Fully Refunded', is_shipped: true }).status).toBe('shipped')
  })

  it('keeps the shipped flag mapping otherwise', () => {
    expect(normalizeReceipt({ ...base, status: 'Paid', is_shipped: false }).status).toBe('in_progress')
    expect(normalizeReceipt({ ...base, status: 'Completed', is_shipped: true }).status).toBe('shipped')
  })
})
