import type { MarketplaceProvider, NormalizedOrder, ShopInfo, TokenSet } from './types'
import { syncCutoffISO } from './syncWindow'

// eBay OAuth 2.0 (Authorization Code Grant, user-level token) + Fulfillment
// API. Reference: https://developer.ebay.com/api-docs/static/oauth-auth-code-grant.html
// Live on production since 2026-09-09. Things that bit us getting there:
//   - `redirect_uri` for eBay is NOT a raw URL — it's the "RuName" identifier
//     you configure in the dev portal (which itself points at your real
//     accepted-URL). EBAY_REDIRECT_URI below must hold that RuName, not a URL.
//     A Production keyset does NOT inherit the Sandbox RuName; it needs its
//     own, created separately.
//   - Sandbox and production use entirely different hostnames; swap
//     EBAY_ENV=sandbox during development. If EBAY_ENV and EBAY_CLIENT_ID ever
//     disagree, eBay answers "The OAuth client was not found" — see the error
//     decoder in PROJECT_NOTES.md, which saves a lot of guessing.
//   - Scope needed: https://api.ebay.com/oauth/api_scope/sell.fulfillment
//   - Production additionally requires a working Marketplace Account Deletion
//     endpoint (app/api/integrations/ebay/deletion/route.ts) for any scope
//     that reads user data, or eBay deactivates the keyset.
const isSandbox = process.env.EBAY_ENV === 'sandbox'
const AUTHORIZE_HOST = isSandbox ? 'https://auth.sandbox.ebay.com' : 'https://auth.ebay.com'
const API_HOST = isSandbox ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com'
const SCOPE = 'https://api.ebay.com/oauth/api_scope/sell.fulfillment'

const clientId = () => process.env.EBAY_CLIENT_ID || ''
const clientSecret = () => process.env.EBAY_CLIENT_SECRET || ''
const ruName = () => process.env.EBAY_REDIRECT_URI || '' // the RuName, see note above

function requireEnv() {
  if (!clientId() || !clientSecret() || !ruName()) {
    throw new Error('eBay integration is not configured (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_REDIRECT_URI missing).')
  }
}

function basicAuthHeader() {
  return 'Basic ' + Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64')
}

function tokenSetFromResponse(json: any): TokenSet {
  const expiresAt = json.expires_in ? new Date(Date.now() + Number(json.expires_in) * 1000).toISOString() : null
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt,
    scope: json.scope ?? SCOPE,
  }
}

export const ebayProvider: MarketplaceProvider = {
  id: 'ebay',
  label: 'eBay',

  buildAuthorizeUrl({ state }) {
    requireEnv()
    const url = new URL(`${AUTHORIZE_HOST}/oauth2/authorize`)
    url.searchParams.set('client_id', clientId())
    url.searchParams.set('redirect_uri', ruName())
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', SCOPE)
    url.searchParams.set('state', state)
    return url.toString()
  },

  async exchangeCodeForToken({ code }) {
    requireEnv()
    const res = await fetch(`${API_HOST}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: basicAuthHeader(),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: ruName(),
      }),
    })
    if (!res.ok) throw new Error(`eBay token exchange failed: ${res.status} ${await res.text()}`)
    return tokenSetFromResponse(await res.json())
  },

  async refreshAccessToken(refreshToken) {
    requireEnv()
    const res = await fetch(`${API_HOST}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: basicAuthHeader(),
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: SCOPE,
      }),
    })
    if (!res.ok) throw new Error(`eBay token refresh failed: ${res.status} ${await res.text()}`)
    return tokenSetFromResponse(await res.json())
  },

  // eBay's Fulfillment API is account-scoped (no separate "shop id" the way
  // Etsy has one), so there's no real shop lookup to do. This used to call
  // GET /sell/account/v1/privilege as a sanity-check + placeholder identity,
  // but that endpoint needs a different OAuth scope (sell.account) than what
  // we request (sell.fulfillment) and 403s — confirmed live 2026-09-04.
  // Skip the call entirely rather than requesting a scope we don't actually
  // need anything else from.
  async fetchShopInfo(): Promise<ShopInfo> {
    return { externalShopId: 'ebay-account', externalShopName: null }
  },

  async fetchOrdersSince({ accessToken, sinceISO }): Promise<NormalizedOrder[]> {
    // sinceISO is NOT used as the filter — a creation-date filter scoped to
    // recent syncs would hide status changes on already-imported orders from
    // sync.ts's update-detection. It's used only to tell a first connect from
    // a repeat sync, which is what decides how deep the fixed window below
    // reaches (see syncCutoffISO).
    // Confirmed working against real production orders 2026-09-09. Note a
    // first sync mostly imports already-FULFILLED orders from earlier this
    // year, so they land as 'shipped' — that is expected, not a bug.
    const since = syncCutoffISO(sinceISO)
    const filters = [`creationdate:[${since}..]`]
    const params = new URLSearchParams({ filter: filters.join(','), limit: '50' })

    // eBay paginates via a full `next` URL in the response body rather than
    // a Link header. Capped at 20 pages (1000 orders) as a safety net
    // against an unbounded loop, not a real limit for a small shop's year.
    let url: string | null = `${API_HOST}/sell/fulfillment/v1/order?${params.toString()}`
    const orders: any[] = []
    for (let page = 0; url && page < 20; page++) {
      const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!res.ok) throw new Error(`eBay orders fetch failed: ${res.status} ${await res.text()}`)
      const json: any = await res.json()
      orders.push(...((json.orders || []) as any[]))
      url = json.next || null
    }

    return orders.map((o): NormalizedOrder => {
      const items: NormalizedOrder['items'] = (o.lineItems || []).map((li: any) => ({
        description: li.title || 'eBay item',
        quantity: Number(li.quantity) || 1,
        unitPrice: Number(li.lineItemCost?.value ?? 0),
        itemType: 'product' as const,
      }))

      // Same pattern confirmed live for Etsy: pricingSummary.total minus the
      // item costs is the shipping/tax gap. Field shapes checked against the
      // Fulfillment API schema 2026-09-09 — pricingSummary.total and
      // lineItems[].lineItemCost are both Amount objects carrying a string
      // `value`. Deriving the gap by subtraction (rather than reading
      // pricingSummary.deliveryCost + .tax directly, which also exist) is
      // deliberate: it absorbs discounts, adjustments and fees we don't model,
      // so the line items always reconcile to what the buyer actually paid.
      const total = Number(o.pricingSummary?.total?.value ?? 0)
      const itemsSubtotal = items.reduce((s, it) => s + it.quantity * it.unitPrice, 0)
      const shippingAndTax = Math.round((total - itemsSubtotal) * 100) / 100
      if (shippingAndTax > 0.005) {
        items.push({ description: 'Shipping & tax', quantity: 1, unitPrice: shippingAndTax, itemType: 'shipping', buyerCovered: true })
      }

      // orderFulfillmentStatus is only ever NOT_STARTED | IN_PROGRESS |
      // FULFILLED (confirmed against the Fulfillment API schema 2026-09-09 —
      // an earlier guess at 'PARTIALLY_FULFILLED' was a value eBay never
      // sends). IN_PROGRESS means some but not all packages have shipped, so
      // it correctly falls through to 'in_progress' rather than 'shipped'.
      // eBay never reports *delivered* — there is no such status here, and
      // ShippingFulfillment carries only a tracking number, shipped date, and
      // carrier code. Orders therefore stop at 'shipped'; advancing them to
      // 'complete' would need a carrier tracking lookup (see PROJECT_NOTES.md).
      const shipped = o.orderFulfillmentStatus === 'FULFILLED'
      return {
        externalOrderId: String(o.orderId),
        buyerName: o.buyer?.username || null,
        status: shipped ? 'shipped' : 'in_progress',
        itemsSubtotal,
        shippingAndTax,
        buyerCoversShipping: true,
        createdAt: o.creationDate || new Date().toISOString(),
        items,
      }
    })
  },
}
