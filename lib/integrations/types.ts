// Shape every provider module normalizes its orders into, so the shared sync
// logic (lib/integrations/sync.ts) doesn't need to know Etsy from eBay.
export type NormalizedOrderItem = {
  description: string
  quantity: number
  unitPrice: number
  // 'shipping' covers shipping + tax + VAT + gift wrap − discounts, added so
  // line items always sum to the order total. buyerCovered defaults true —
  // a marketplace-reported total, by construction, is what the buyer paid —
  // but the seller can uncheck it per order if that's wrong for their case.
  itemType?: 'product' | 'shipping'
  buyerCovered?: boolean
}

export type NormalizedOrder = {
  externalOrderId: string
  buyerName: string | null
  status: 'in_progress' | 'complete'
  // Split, not a combined total — orders.suggested_price and
  // orders.estimated_shipping are separate fields feeding a profit formula
  // that only cancels shipping out of profit when it's in estimated_shipping
  // specifically. Folding shipping into a single "total" would silently
  // count it as pure profit (that was a real bug here, fixed 2026-09-03).
  itemsSubtotal: number
  shippingAndTax: number
  buyerCoversShipping: boolean
  createdAt: string // ISO
  items: NormalizedOrderItem[]
}

export type TokenSet = {
  accessToken: string
  refreshToken: string | null
  expiresAt: string | null // ISO, null = doesn't expire / unknown
  scope?: string | null
}

export type ShopInfo = {
  externalShopId: string
  externalShopName: string | null
}

export interface MarketplaceProvider {
  id: 'etsy' | 'ebay'
  buildAuthorizeUrl(params: { state: string; codeChallenge?: string }): string
  exchangeCodeForToken(params: { code: string; codeVerifier?: string }): Promise<TokenSet>
  refreshAccessToken(refreshToken: string): Promise<TokenSet>
  fetchShopInfo(accessToken: string): Promise<ShopInfo>
  fetchOrdersSince(params: { accessToken: string; shopId: string; sinceISO: string | null }): Promise<NormalizedOrder[]>
}
