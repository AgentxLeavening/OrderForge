import type { MarketplaceProvider, NormalizedOrder, ShopInfo, TokenSet } from './types'

// Meta Commerce API (Facebook/Instagram Shops), via the Graph API.
// HEAVILY UNVERIFIED — no Facebook/Meta credentials tested yet. Two things
// make this the least certain provider here along with TikTok:
//   1. Meta's Commerce permissions (catalog_management,
//      commerce_account_read_orders or similar) typically require a formal
//      App Review before they work for anyone but the app's own admins/
//      testers — this may simply not work at all until that review clears,
//      independent of whether the code below is correct.
//   2. There's no single "shop ID" handed to you after OAuth the way Etsy's
//      shop lookup works — you have to discover a Commerce Account through
//      the seller's Business Manager (fetchShopInfo below assumes the first
//      commerce account found on the first business the token can see,
//      which is a real simplification for sellers with more than one).
// Reference: https://developers.facebook.com/docs/commerce-platform
const GRAPH_HOST = 'https://graph.facebook.com'
const GRAPH_VERSION = 'v19.0'
const AUTH_HOST = 'https://www.facebook.com'
// Scope names unverified — commerce-specific permissions change over time
// and most require App Review before they're usable outside dev/test mode.
const SCOPES = 'catalog_management,commerce_account_read_orders,business_management'

const clientId = () => process.env.FACEBOOK_CLIENT_ID || ''
const clientSecret = () => process.env.FACEBOOK_CLIENT_SECRET || ''
const redirectUri = () => process.env.FACEBOOK_REDIRECT_URI || ''

function requireEnv() {
  if (!clientId() || !clientSecret() || !redirectUri()) {
    throw new Error('Facebook integration is not configured (FACEBOOK_CLIENT_ID / FACEBOOK_CLIENT_SECRET / FACEBOOK_REDIRECT_URI missing).')
  }
}

function tokenSetFromResponse(json: any): TokenSet {
  const expiresAt = json.expires_in ? new Date(Date.now() + Number(json.expires_in) * 1000).toISOString() : null
  return {
    accessToken: json.access_token,
    refreshToken: null, // Meta uses long-lived token exchange, not a refresh token grant
    expiresAt,
    scope: json.scope ?? SCOPES,
  }
}

export const facebookProvider: MarketplaceProvider = {
  id: 'facebook',
  label: 'Facebook & Instagram Shop',

  buildAuthorizeUrl({ state }) {
    requireEnv()
    const url = new URL(`${AUTH_HOST}/${GRAPH_VERSION}/dialog/oauth`)
    url.searchParams.set('client_id', clientId())
    url.searchParams.set('redirect_uri', redirectUri())
    url.searchParams.set('state', state)
    url.searchParams.set('scope', SCOPES)
    return url.toString()
  },

  async exchangeCodeForToken({ code }) {
    requireEnv()
    const shortLivedUrl = new URL(`${GRAPH_HOST}/${GRAPH_VERSION}/oauth/access_token`)
    shortLivedUrl.searchParams.set('client_id', clientId())
    shortLivedUrl.searchParams.set('client_secret', clientSecret())
    shortLivedUrl.searchParams.set('redirect_uri', redirectUri())
    shortLivedUrl.searchParams.set('code', code)

    const shortRes = await fetch(shortLivedUrl.toString())
    if (!shortRes.ok) throw new Error(`Facebook token exchange failed: ${shortRes.status} ${await shortRes.text()}`)
    const shortJson = await shortRes.json()

    // Exchange immediately for a long-lived token (~60 days vs. ~1-2 hours)
    // — Meta's recommended pattern; there's no separate refresh-token grant.
    const longLivedUrl = new URL(`${GRAPH_HOST}/${GRAPH_VERSION}/oauth/access_token`)
    longLivedUrl.searchParams.set('grant_type', 'fb_exchange_token')
    longLivedUrl.searchParams.set('client_id', clientId())
    longLivedUrl.searchParams.set('client_secret', clientSecret())
    longLivedUrl.searchParams.set('fb_exchange_token', shortJson.access_token)

    const longRes = await fetch(longLivedUrl.toString())
    if (!longRes.ok) throw new Error(`Facebook long-lived token exchange failed: ${longRes.status} ${await longRes.text()}`)
    return tokenSetFromResponse(await longRes.json())
  },

  async refreshAccessToken(): Promise<TokenSet> {
    // No refresh-token grant in Meta's model — long-lived tokens (see
    // exchangeCodeForToken) last ~60 days and must be re-obtained via a
    // fresh Connect once they expire; there's no token to hand this a
    // refresh_token for.
    throw new Error('Facebook access tokens do not use a refresh grant — reconnect once the long-lived token expires (~60 days).')
  },

  async fetchShopInfo(accessToken): Promise<ShopInfo> {
    // Simplification: takes the first business + first commerce account
    // found. A seller with multiple businesses/commerce accounts isn't
    // handled — genuinely uncertain this is even the right traversal path;
    // verify against the Commerce API docs once credentials exist.
    const bizRes = await fetch(`${GRAPH_HOST}/${GRAPH_VERSION}/me/businesses?access_token=${accessToken}`)
    if (!bizRes.ok) throw new Error(`Facebook business lookup failed: ${bizRes.status} ${await bizRes.text()}`)
    const bizJson = await bizRes.json()
    const business = bizJson.data?.[0]
    if (!business) throw new Error('No Facebook Business found for this account.')

    const caRes = await fetch(`${GRAPH_HOST}/${GRAPH_VERSION}/${business.id}/owned_commerce_merchant_settings?access_token=${accessToken}`)
    if (!caRes.ok) throw new Error(`Facebook commerce account lookup failed: ${caRes.status} ${await caRes.text()}`)
    const caJson = await caRes.json()
    const commerceAccount = caJson.data?.[0]
    if (!commerceAccount) throw new Error('No Commerce Account found for this Facebook Business.')

    return { externalShopId: commerceAccount.id, externalShopName: business.name ?? null }
  },

  async fetchOrdersSince({ accessToken, shopId }): Promise<NormalizedOrder[]> {
    const url = new URL(`${GRAPH_HOST}/${GRAPH_VERSION}/${shopId}/orders`)
    url.searchParams.set('access_token', accessToken)
    url.searchParams.set('state', 'IN_PROGRESS,COMPLETED,SHIPPED')

    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`Facebook orders fetch failed: ${res.status} ${await res.text()}`)
    const json = await res.json()
    const orders = (json.data || []) as any[]

    return orders.map((o): NormalizedOrder => {
      const items: NormalizedOrder['items'] = (o.items?.data || o.selected_items?.data || []).map((li: any) => ({
        description: li.product_name || li.retailer_id || 'Facebook Shop item',
        quantity: Number(li.quantity) || 1,
        unitPrice: Number(li.price_per_unit?.amount ?? 0) / 100,
        itemType: 'product' as const,
      }))

      const itemsSubtotal = items.reduce((s, it) => s + it.quantity * it.unitPrice, 0)
      const payment = o.estimated_payment_details || {}
      const shippingCents = Number(payment.shipping?.amount ?? 0)
      const taxCents = Number(payment.tax?.amount ?? 0)
      const shippingAndTax = Math.round((shippingCents + taxCents)) / 100
      if (shippingAndTax > 0.005) {
        items.push({ description: 'Shipping & tax', quantity: 1, unitPrice: shippingAndTax, itemType: 'shipping', buyerCovered: true })
      }

      const shipped = ['COMPLETED', 'SHIPPED'].includes(o.order_status?.state || o.state)
      return {
        externalOrderId: String(o.id),
        buyerName: o.buyer_details?.name || null,
        status: shipped ? 'shipped' : 'in_progress',
        itemsSubtotal,
        shippingAndTax,
        buyerCoversShipping: true,
        createdAt: o.created || new Date().toISOString(),
        items,
      }
    })
  },
}
