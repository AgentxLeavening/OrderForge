import type { MarketplaceProvider, NormalizedOrder, ShopInfo, TokenSet } from './types'

// Shopify Admin API, OAuth 2.0 (authorization code grant). UNVERIFIED — no
// Shopify credentials tested yet, built from Shopify's documented flow:
// https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant
//
// Structurally different from Etsy/eBay: there's no single global authorize
// URL — every request is scoped to a specific "<shop>.myshopify.com" store,
// which the seller has to supply *before* OAuth can even start (see
// buildAuthorizeUrl's shopDomain param, threaded through by
// routeHelpers.ts/the Settings page's shop-domain input). Shopify's default
// "offline" access tokens don't expire and have no refresh flow.
const API_VERSION = '2024-10'
const SCOPES = 'read_orders'

const clientId = () => process.env.SHOPIFY_CLIENT_ID || ''
const clientSecret = () => process.env.SHOPIFY_CLIENT_SECRET || ''
const redirectUri = () => process.env.SHOPIFY_REDIRECT_URI || ''

function requireEnv() {
  if (!clientId() || !clientSecret() || !redirectUri()) {
    throw new Error('Shopify integration is not configured (SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET / SHOPIFY_REDIRECT_URI missing).')
  }
}

function normalizeShopDomain(shop: string): string {
  const bare = shop.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  return bare.endsWith('.myshopify.com') ? bare : `${bare}.myshopify.com`
}

export const shopifyProvider: MarketplaceProvider = {
  id: 'shopify',
  label: 'Shopify',

  buildAuthorizeUrl({ state, shopDomain }) {
    requireEnv()
    if (!shopDomain) throw new Error('Shopify requires a shop domain to connect.')
    const url = new URL(`https://${normalizeShopDomain(shopDomain)}/admin/oauth/authorize`)
    url.searchParams.set('client_id', clientId())
    url.searchParams.set('scope', SCOPES)
    url.searchParams.set('redirect_uri', redirectUri())
    url.searchParams.set('state', state)
    return url.toString()
  },

  async exchangeCodeForToken({ code, shopDomain }) {
    requireEnv()
    if (!shopDomain) throw new Error('Shopify token exchange requires a shop domain.')
    const shop = normalizeShopDomain(shopDomain)
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId(), client_secret: clientSecret(), code }),
    })
    if (!res.ok) throw new Error(`Shopify token exchange failed: ${res.status} ${await res.text()}`)
    const json = await res.json()
    return {
      accessToken: json.access_token,
      refreshToken: null,
      expiresAt: null, // offline tokens don't expire
      scope: json.scope ?? SCOPES,
      shopId: shop,
      shopName: shop,
    }
  },

  async refreshAccessToken(): Promise<TokenSet> {
    // No refresh flow for Shopify's offline tokens — if this is ever
    // called, the token was revoked/uninstalled and needs a fresh Connect.
    throw new Error('Shopify access tokens do not refresh — reconnect the store.')
  },

  async fetchShopInfo(accessToken, shopDomain): Promise<ShopInfo> {
    if (!shopDomain) throw new Error('Shopify shop lookup requires a shop domain.')
    const shop = normalizeShopDomain(shopDomain)
    const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/shop.json`, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    })
    if (!res.ok) throw new Error(`Shopify shop lookup failed: ${res.status} ${await res.text()}`)
    const json = await res.json()
    return { externalShopId: shop, externalShopName: json.shop?.name ?? shop }
  },

  async fetchOrdersSince({ accessToken, shopId }): Promise<NormalizedOrder[]> {
    // shopId here is the myshopify.com domain (see exchangeCodeForToken,
    // which persists it as external_shop_id immediately, so this is always
    // populated by the time sync.ts calls in — no lazy fetchShopInfo needed).
    if (!shopId) throw new Error('Shopify order fetch requires a shop domain.')
    const params = new URLSearchParams({ status: 'any', limit: '100', order: 'created_at desc' })
    const res = await fetch(`https://${shopId}/admin/api/${API_VERSION}/orders.json?${params.toString()}`, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    })
    if (!res.ok) throw new Error(`Shopify orders fetch failed: ${res.status} ${await res.text()}`)
    const json = await res.json()
    const orders = (json.orders || []) as any[]

    return orders.map((o): NormalizedOrder => {
      const items: NormalizedOrder['items'] = (o.line_items || []).map((li: any) => ({
        description: li.title || li.name || 'Shopify item',
        quantity: Number(li.quantity) || 1,
        unitPrice: Number(li.price) || 0,
        itemType: 'product' as const,
      }))

      const itemsSubtotal = o.subtotal_price != null
        ? Number(o.subtotal_price)
        : items.reduce((s, it) => s + it.quantity * it.unitPrice, 0)
      const shippingCost = (o.shipping_lines || []).reduce((s: number, sl: any) => s + Number(sl.price || 0), 0)
      const tax = Number(o.total_tax || 0)
      const shippingAndTax = Math.round((shippingCost + tax) * 100) / 100
      if (shippingAndTax > 0.005) {
        items.push({ description: 'Shipping & tax', quantity: 1, unitPrice: shippingAndTax, itemType: 'shipping', buyerCovered: true })
      }

      const shipped = o.fulfillment_status === 'fulfilled'
      const buyerName = [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ') || o.email || null

      return {
        externalOrderId: String(o.id),
        buyerName,
        status: shipped ? 'shipped' : 'in_progress',
        itemsSubtotal,
        shippingAndTax,
        buyerCoversShipping: true,
        createdAt: o.created_at || new Date().toISOString(),
        items,
      }
    })
  },
}
