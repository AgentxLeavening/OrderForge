import type { MarketplaceProvider, NormalizedOrder, ShopInfo, TokenSet } from './types'
import { currentYearStartISO } from './syncWindow'

// Etsy Open API v3, OAuth 2.0 + PKCE. Reference: https://developer.etsy.com/documentation/essentials/authentication
// Confirmed live 2026-09-03 against a real (freshly-approved) app:
//   - The OAuth authorize/token endpoints work exactly as documented —
//     client_id + PKCE, no shared secret needed there.
//   - Every v3/application/* resource-server call requires x-api-key to be
//     "<keystring>:<shared_secret>" (colon-joined), per Etsy's docs — plain
//     Keystring alone 403s. Confirmed against current docs 2026-09-03.
//     Scopes/receipt field shapes are still unverified beyond this point
//     (only OAuth + this header format have been exercised live).
const AUTHORIZE_URL = 'https://www.etsy.com/oauth/connect'
const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token'
const API_BASE = 'https://api.etsy.com/v3/application'
const SCOPES = 'transactions_r shops_r'

const clientId = () => process.env.ETSY_CLIENT_ID || ''
const redirectUri = () => process.env.ETSY_REDIRECT_URI || ''
const sharedSecret = () => process.env.ETSY_SHARED_SECRET || ''

function requireEnv() {
  if (!clientId() || !redirectUri()) {
    throw new Error('Etsy integration is not configured (ETSY_CLIENT_ID / ETSY_REDIRECT_URI missing).')
  }
}

// x-api-key for every v3/application/* call — see note above.
function apiKeyHeader() {
  if (!sharedSecret()) throw new Error('ETSY_SHARED_SECRET is not set — required for Etsy API calls.')
  return `${clientId()}:${sharedSecret()}`
}

function tokenSetFromResponse(json: any): TokenSet {
  const expiresAt = json.expires_in ? new Date(Date.now() + Number(json.expires_in) * 1000).toISOString() : null
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt,
    scope: json.token_type ? SCOPES : null,
  }
}

// Etsy access tokens embed the numeric user id before the first dot.
function etsyUserIdFromToken(accessToken: string): string {
  const id = accessToken.split('.')[0]
  if (!id) throw new Error('Unexpected Etsy access token format')
  return id
}

export const etsyProvider: MarketplaceProvider = {
  id: 'etsy',
  label: 'Etsy',

  buildAuthorizeUrl({ state, codeChallenge }) {
    requireEnv()
    const url = new URL(AUTHORIZE_URL)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('redirect_uri', redirectUri())
    url.searchParams.set('scope', SCOPES)
    url.searchParams.set('client_id', clientId())
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge', codeChallenge || '')
    url.searchParams.set('code_challenge_method', 'S256')
    return url.toString()
  },

  async exchangeCodeForToken({ code, codeVerifier }) {
    requireEnv()
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId(),
        redirect_uri: redirectUri(),
        code,
        code_verifier: codeVerifier || '',
      }),
    })
    if (!res.ok) throw new Error(`Etsy token exchange failed: ${res.status} ${await res.text()}`)
    return tokenSetFromResponse(await res.json())
  },

  async refreshAccessToken(refreshToken) {
    requireEnv()
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId(),
        refresh_token: refreshToken,
      }),
    })
    if (!res.ok) throw new Error(`Etsy token refresh failed: ${res.status} ${await res.text()}`)
    return tokenSetFromResponse(await res.json())
  },

  async fetchShopInfo(accessToken): Promise<ShopInfo> {
    const userId = etsyUserIdFromToken(accessToken)
    const res = await fetch(`${API_BASE}/users/${userId}/shops`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'x-api-key': apiKeyHeader() },
    })
    if (!res.ok) throw new Error(`Etsy shop lookup failed: ${res.status} ${await res.text()}`)
    const json = await res.json()
    // A single-shop response; multi-shop sellers aren't handled yet.
    return { externalShopId: String(json.shop_id), externalShopName: json.shop_name ?? null }
  },

  async fetchOrdersSince({ accessToken, shopId }): Promise<NormalizedOrder[]> {
    // Deliberately NOT filtering by sinceISO: Etsy's receipts endpoint
    // filters on creation date, not last-modified, so an already-imported
    // order that just shipped wouldn't show up in a window scoped to
    // *recent syncs* for sync.ts to notice the status change. min_created
    // below is a much wider, fixed window instead (since Jan 1 — see
    // currentYearStartISO), re-checked in full every sync; sync.ts skips
    // receipts that are unchanged, so this only costs API calls, not writes.
    const minCreated = Math.floor(new Date(currentYearStartISO()).getTime() / 1000)
    const limit = 100
    const receipts: any[] = []
    // Capped well above what a small shop could generate in a year — a
    // safety net against an unbounded loop, not a real limit in practice.
    for (let offset = 0; offset < 2000; offset += limit) {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset), min_created: String(minCreated) })
      const res = await fetch(`${API_BASE}/shops/${shopId}/receipts?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}`, 'x-api-key': apiKeyHeader() },
      })
      if (!res.ok) throw new Error(`Etsy receipts fetch failed: ${res.status} ${await res.text()}`)
      const json = await res.json()
      const page = (json.results || []) as any[]
      receipts.push(...page)
      if (page.length < limit) break
    }

    // Money fields confirmed live 2026-09-03 against a real receipt:
    // subtotal + total_shipping_cost + total_tax_cost + total_vat_cost +
    // gift_wrap_price − discount_amt = grandtotal, exactly.
    const money = (m: any) => (m?.amount ?? 0) / (m?.divisor || 100)

    return receipts.map((r): NormalizedOrder => {
      const items: NormalizedOrder['items'] = (r.transactions || []).map((t: any) => ({
        description: t.title || 'Etsy item',
        quantity: Number(t.quantity) || 1,
        unitPrice: money(t.price),
        itemType: 'product' as const,
      }))

      // Etsy's own subtotal field — item revenue only, excludes shipping/tax.
      const itemsSubtotal = money(r.subtotal)
      // Rounded to cents — summing several already-divided money() values
      // accumulates float noise otherwise (e.g. 6.640000000000001).
      const shippingAndTax = Math.round(
        (money(r.total_shipping_cost) + money(r.total_tax_cost) + money(r.total_vat_cost) + money(r.gift_wrap_price) - money(r.discount_amt)) * 100
      ) / 100
      if (shippingAndTax > 0.005) {
        items.push({ description: 'Shipping & tax', quantity: 1, unitPrice: shippingAndTax, itemType: 'shipping', buyerCovered: true })
      }

      return {
        externalOrderId: String(r.receipt_id),
        buyerName: r.name || null,
        status: r.is_shipped ? 'shipped' : 'in_progress',
        itemsSubtotal,
        shippingAndTax,
        buyerCoversShipping: true,
        createdAt: new Date((r.created_timestamp || Date.now() / 1000) * 1000).toISOString(),
        items,
      }
    })
  },
}
