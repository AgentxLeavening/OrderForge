import type { MarketplaceProvider, NormalizedOrder, ShopInfo, TokenSet } from './types'

// eBay OAuth 2.0 (Authorization Code Grant, user-level token) + Fulfillment
// API. Reference: https://developer.ebay.com/api-docs/static/oauth-auth-code-grant.html
// VERIFY AGAINST CURRENT DOCS before going live — not tested against a live
// app yet:
//   - `redirect_uri` for eBay is NOT a raw URL — it's the "RuName" identifier
//     you configure in the dev portal (which itself points at your real
//     accepted-URL). EBAY_REDIRECT_URI below must hold that RuName, not a URL.
//   - Sandbox and production use entirely different hostnames; swap
//     EBAY_ENV=sandbox during development.
//   - Scope needed: https://api.ebay.com/oauth/api_scope/sell.fulfillment
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
  // Etsy has one) — there's no real shop lookup to do, so this just confirms
  // the token works and returns a placeholder identity.
  async fetchShopInfo(accessToken): Promise<ShopInfo> {
    const res = await fetch(`${API_HOST}/sell/account/v1/privilege`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) throw new Error(`eBay account check failed: ${res.status} ${await res.text()}`)
    const json = await res.json()
    return { externalShopId: json.sellerAccount?.username || 'ebay-account', externalShopName: null }
  },

  async fetchOrdersSince({ accessToken }): Promise<NormalizedOrder[]> {
    // Deliberately NOT filtering by sinceISO — same reasoning as Etsy's
    // fetchOrdersSince: a creation-date filter would hide status changes on
    // already-imported orders from sync.ts's update-detection. Re-check a
    // fixed recent window every sync instead; cheap at small-shop scale.
    // UNVERIFIED against a real eBay response — filter/pagination param
    // names and requiredness need confirming once credentials exist.
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    const filters = [`creationdate:[${since}..]`]
    const params = new URLSearchParams({ filter: filters.join(','), limit: '50' })

    const res = await fetch(`${API_HOST}/sell/fulfillment/v1/order?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) throw new Error(`eBay orders fetch failed: ${res.status} ${await res.text()}`)
    const json = await res.json()
    const orders = (json.orders || []) as any[]

    return orders.map((o): NormalizedOrder => {
      const items: NormalizedOrder['items'] = (o.lineItems || []).map((li: any) => ({
        description: li.title || 'eBay item',
        quantity: Number(li.quantity) || 1,
        unitPrice: Number(li.lineItemCost?.value ?? 0),
        itemType: 'product' as const,
      }))

      // UNVERIFIED — mirrors the same pattern confirmed live for Etsy
      // (pricingSummary.total minus item costs = shipping/tax gap), but this
      // exact field name/shape hasn't been checked against a real eBay
      // response yet. Re-check once eBay credentials exist.
      const total = Number(o.pricingSummary?.total?.value ?? 0)
      const itemsSubtotal = items.reduce((s, it) => s + it.quantity * it.unitPrice, 0)
      const shippingAndTax = Math.round((total - itemsSubtotal) * 100) / 100
      if (shippingAndTax > 0.005) {
        items.push({ description: 'Shipping & tax', quantity: 1, unitPrice: shippingAndTax, itemType: 'shipping', buyerCovered: true })
      }

      const complete = ['FULFILLED', 'PARTIALLY_FULFILLED'].includes(o.orderFulfillmentStatus)
      return {
        externalOrderId: String(o.orderId),
        buyerName: o.buyer?.username || null,
        status: complete ? 'complete' : 'in_progress',
        itemsSubtotal,
        shippingAndTax,
        buyerCoversShipping: true,
        createdAt: o.creationDate || new Date().toISOString(),
        items,
      }
    })
  },
}
