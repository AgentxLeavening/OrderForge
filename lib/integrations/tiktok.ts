import { createHmac } from 'node:crypto'
import type { MarketplaceProvider, NormalizedOrder, ShopInfo, TokenSet } from './types'

// TikTok Shop (Partner Center) Open API. HEAVILY UNVERIFIED — more so than
// any other provider here. No TikTok Shop credentials tested yet, and
// TikTok Shop's API differs from every other provider here in a way that's
// genuinely hard to get right without live testing: EVERY API call (not
// just OAuth) must be HMAC-SHA256 signed using the app secret, over a
// canonicalized string of the request path + sorted query params (+ body
// for POST). The exact canonicalization rule below (signRequest), the
// endpoint paths/versions (TikTok Shop has shipped several: 202309, 202312,
// etc., plus separate US/Global API hosts), and the authorize/token URLs
// are a best-effort reconstruction from general knowledge — NOT confirmed
// against current docs the way Etsy's were. Expect to need TikTok's actual
// current Partner Center docs open side-by-side the first time this runs
// for real, likely more corrections than any other provider took.
const AUTH_HOST = 'https://auth.tiktok-shops.com'
const API_HOST = 'https://open-api.tiktokglobalshop.com'

const appKey = () => process.env.TIKTOK_APP_KEY || ''
const appSecret = () => process.env.TIKTOK_APP_SECRET || ''
const redirectUri = () => process.env.TIKTOK_REDIRECT_URI || ''

function requireEnv() {
  if (!appKey() || !appSecret() || !redirectUri()) {
    throw new Error('TikTok Shop integration is not configured (TIKTOK_APP_KEY / TIKTOK_APP_SECRET / TIKTOK_REDIRECT_URI missing).')
  }
}

// Best-effort TikTok Shop request signature — UNVERIFIED, see module note.
function signRequest(path: string, params: Record<string, string>, body?: string): string {
  const sorted = Object.keys(params).sort().map(k => `${k}${params[k]}`).join('')
  const base = `${path}${sorted}${body || ''}`
  return createHmac('sha256', appSecret()).update(base).digest('hex')
}

function tokenSetFromResponse(json: any): TokenSet {
  const data = json.data || json
  const expiresAt = data.access_token_expire_in ? new Date(Number(data.access_token_expire_in) * 1000).toISOString() : null
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt,
    scope: null,
  }
}

export const tiktokProvider: MarketplaceProvider = {
  id: 'tiktok',
  label: 'TikTok Shop',

  buildAuthorizeUrl({ state }) {
    requireEnv()
    const url = new URL(`${AUTH_HOST}/oauth/authorize`)
    url.searchParams.set('app_key', appKey())
    url.searchParams.set('state', state)
    url.searchParams.set('redirect_uri', redirectUri())
    return url.toString()
  },

  async exchangeCodeForToken({ code }) {
    requireEnv()
    const url = new URL(`${AUTH_HOST}/api/v2/token/get`)
    url.searchParams.set('app_key', appKey())
    url.searchParams.set('app_secret', appSecret())
    url.searchParams.set('auth_code', code)
    url.searchParams.set('grant_type', 'authorized_code')
    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`TikTok Shop token exchange failed: ${res.status} ${await res.text()}`)
    return tokenSetFromResponse(await res.json())
  },

  async refreshAccessToken(refreshToken) {
    requireEnv()
    const url = new URL(`${AUTH_HOST}/api/v2/token/refresh`)
    url.searchParams.set('app_key', appKey())
    url.searchParams.set('app_secret', appSecret())
    url.searchParams.set('refresh_token', refreshToken)
    url.searchParams.set('grant_type', 'refresh_token')
    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`TikTok Shop token refresh failed: ${res.status} ${await res.text()}`)
    return tokenSetFromResponse(await res.json())
  },

  async fetchShopInfo(accessToken): Promise<ShopInfo> {
    const path = '/authorization/202309/shops'
    const timestamp = String(Math.floor(Date.now() / 1000))
    const params: Record<string, string> = { app_key: appKey(), timestamp }
    const sign = signRequest(path, params)
    const url = new URL(`${API_HOST}${path}`)
    Object.entries({ ...params, sign }).forEach(([k, v]) => url.searchParams.set(k, v))

    const res = await fetch(url.toString(), { headers: { 'x-tts-access-token': accessToken } })
    if (!res.ok) throw new Error(`TikTok Shop lookup failed: ${res.status} ${await res.text()}`)
    const json = await res.json()
    const shop = json.data?.shops?.[0]
    if (!shop) throw new Error('No TikTok Shop found for this authorization.')
    return { externalShopId: String(shop.shop_id), externalShopName: shop.shop_name ?? null }
  },

  async fetchOrdersSince({ accessToken, shopId }): Promise<NormalizedOrder[]> {
    const path = '/order/202309/orders/search'
    const timestamp = String(Math.floor(Date.now() / 1000))
    const params: Record<string, string> = { app_key: appKey(), timestamp, shop_id: shopId, page_size: '50' }
    const body = JSON.stringify({})
    const sign = signRequest(path, params, body)
    const url = new URL(`${API_HOST}${path}`)
    Object.entries({ ...params, sign }).forEach(([k, v]) => url.searchParams.set(k, v))

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'x-tts-access-token': accessToken, 'Content-Type': 'application/json' },
      body,
    })
    if (!res.ok) throw new Error(`TikTok Shop orders fetch failed: ${res.status} ${await res.text()}`)
    const json = await res.json()
    const orders = (json.data?.order_list || []) as any[]

    return orders.map((o): NormalizedOrder => {
      const items: NormalizedOrder['items'] = (o.line_items || o.order_line_list || []).map((li: any) => ({
        description: li.product_name || li.sku_name || 'TikTok Shop item',
        quantity: Number(li.quantity ?? 1),
        unitPrice: Number(li.sale_price ?? li.original_price ?? 0),
        itemType: 'product' as const,
      }))

      const itemsSubtotal = items.reduce((s, it) => s + it.quantity * it.unitPrice, 0)
      const total = Number(o.payment?.total_amount ?? o.payment_info?.total_amount ?? itemsSubtotal)
      const shippingAndTax = Math.round((total - itemsSubtotal) * 100) / 100
      if (shippingAndTax > 0.005) {
        items.push({ description: 'Shipping & tax', quantity: 1, unitPrice: shippingAndTax, itemType: 'shipping', buyerCovered: true })
      }

      // 'shipped' rather than 'complete' even for COMPLETED/DELIVERED — like
      // every provider here, unverified whether that status genuinely means
      // "fully closed out" vs. just delivered.
      const shipped = ['COMPLETED', 'DELIVERED'].includes(o.order_status || o.status)
      return {
        externalOrderId: String(o.order_id ?? o.id),
        buyerName: o.recipient_address?.name || o.buyer_name || null,
        status: shipped ? 'shipped' : 'in_progress',
        itemsSubtotal,
        shippingAndTax,
        buyerCoversShipping: true,
        createdAt: o.create_time ? new Date(Number(o.create_time) * 1000).toISOString() : new Date().toISOString(),
        items,
      }
    })
  },
}
