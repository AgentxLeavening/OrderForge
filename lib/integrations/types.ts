// Shape every provider module normalizes its orders into, so the shared sync
// logic (lib/integrations/sync.ts) doesn't need to know one marketplace from
// another.
export type NormalizedOrderItem = {
  description: string
  quantity: number
  unitPrice: number
  // 'shipping' covers shipping + tax (+ VAT/gift wrap/discounts where a
  // provider tracks them), added so line items always sum to the order
  // total. buyerCovered defaults true — a marketplace-reported total, by
  // construction, is what the buyer paid — but the seller can uncheck it
  // per order if that's wrong for their case.
  itemType?: 'product' | 'shipping'
  buyerCovered?: boolean
}

export type NormalizedOrder = {
  externalOrderId: string
  buyerName: string | null
  // 'shipped' — out for delivery but not otherwise closed out (reviewed, no
  // returns, etc.) — is a better fit than jumping straight to 'complete' for
  // marketplaces that only tell us shipment status. 'complete' is reached only
  // from a real delivery signal (Etsy's order.delivered webhook), never guessed.
  // 'cancelled' makes sync.ts restock whatever the import deducted.
  status: 'in_progress' | 'shipped' | 'complete' | 'cancelled'
  // Split, not a combined total — orders.suggested_price and
  // orders.estimated_shipping are separate fields feeding a profit formula
  // that only cancels shipping out of profit when it's in estimated_shipping
  // specifically. Folding shipping into a single "total" would silently
  // count it as pure profit (that was a real bug here, fixed 2026-09-03).
  itemsSubtotal: number
  shippingAndTax: number
  buyerCoversShipping: boolean
  createdAt: string // ISO
  // Carrier tracking number, where the provider hands it over in the orders
  // payload (Etsy's receipt `shipments`, Shopify's order `fulfillments`).
  // Undefined means "this provider didn't say", NOT "there is none" — eBay
  // keeps tracking on a separate endpoint, so it arrives via the optional
  // fetchTrackingNumber hook below instead. sync.ts only ever fills a blank
  // tracking number in; it never overwrites one already on the order.
  trackingNumber?: string | null
  items: NormalizedOrderItem[]
}

export type TokenSet = {
  accessToken: string
  refreshToken: string | null
  expiresAt: string | null // ISO, null = doesn't expire / unknown
  scope?: string | null
  // Set by a provider that already knows the shop/store identity at token
  // exchange time (Shopify — the shop domain is known before OAuth even
  // starts), so routeHelpers.ts can persist it immediately instead of
  // sync.ts resolving it lazily via fetchShopInfo on first sync.
  shopId?: string
  shopName?: string | null
}

export type ShopInfo = {
  externalShopId: string
  externalShopName: string | null
}

export type ProviderId = 'etsy' | 'ebay' | 'shopify' | 'tiktok' | 'facebook'

export interface MarketplaceProvider {
  id: ProviderId
  label: string
  buildAuthorizeUrl(params: { state: string; codeChallenge?: string; shopDomain?: string }): string
  exchangeCodeForToken(params: { code: string; codeVerifier?: string; shopDomain?: string }): Promise<TokenSet>
  refreshAccessToken(refreshToken: string): Promise<TokenSet>
  fetchShopInfo(accessToken: string, shopDomain?: string): Promise<ShopInfo>
  fetchOrdersSince(params: { accessToken: string; shopId: string; sinceISO: string | null }): Promise<NormalizedOrder[]>
  // Optional, for providers that don't include tracking in the orders payload.
  // eBay is the only one today: tracking lives on
  // /order/{orderId}/shipping_fulfillment, so reading it for every order on
  // every sync would mean an extra API call per order against a shared daily
  // quota. sync.ts therefore calls this lazily — only for an order that looks
  // shipped and has no tracking stored yet — so a given order costs one extra
  // call once, and nothing on subsequent syncs. Returns null when the
  // marketplace has no tracking for it (common: shipped without tracking).
  fetchTrackingNumber?(params: { accessToken: string; shopId: string; externalOrderId: string }): Promise<string | null>
  // Optional, for providers that push per-order webhooks (Etsy): fetch just the
  // one order the notification names, so it runs through the same import logic
  // as a full sync. Returns null when the marketplace no longer has it.
  fetchOrder?(params: { accessToken: string; shopId: string; externalOrderId: string }): Promise<NormalizedOrder | null>
}
