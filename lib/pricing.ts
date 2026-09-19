// Shared order-economics formula — used by the order detail page's Pricing &
// Margin card, the dashboard profit widget, and the cross-channel
// profitability report. Centralized after a real bug (2026-09-03) where
// duplicating this formula in two places let them drift: the first pass
// added buyer-covered shipping to revenue without also costing it, which
// silently counted shipping as pure profit on every imported order.
/**
 * Marketplace fees differ enough per channel that one number can't serve all
 * three — eBay's cut is roughly double Shopify's. Falls back to the general
 * default (used for manual orders), then to nothing.
 */
export function channelFeePct(
  profile: {
    fee_pct_etsy?: number | null
    fee_pct_ebay?: number | null
    fee_pct_shopify?: number | null
    default_fee_pct?: number | null
  } | null | undefined,
  channel: string | null | undefined
): number | null {
  if (!profile) return null
  const perChannel = channel === 'etsy' ? profile.fee_pct_etsy
    : channel === 'ebay' ? profile.fee_pct_ebay
    : channel === 'shopify' ? profile.fee_pct_shopify
    : null
  const value = perChannel ?? profile.default_fee_pct
  return value == null ? null : Number(value)
}

/**
 * Three states, not two. An unrecorded cost is a different claim from a cost of
 * zero, and conflating them is what made imported orders read as pure profit.
 *
 * 'unknown' still counts as full profit in the totals — an undocumented cost
 * can't be deducted for tax anyway, so that's the safe direction — but it's
 * flagged so a seller can see how much of the figure is unverified.
 */
export type CostState = 'recorded' | 'none' | 'unknown'

export function costState(order: {
  material_cost?: number | null
  labor_cost?: number | null
  no_cost_basis?: boolean | null
}): CostState {
  if (order.material_cost != null || order.labor_cost != null) return 'recorded'
  return order.no_cost_basis ? 'none' : 'unknown'
}

export type PricingInputs = {
  suggested_price?: number | null
  material_cost?: number | null
  labor_cost?: number | null
  estimated_shipping?: number | null
  shipping_buyer_covered?: boolean | null
  fee_pct?: number | null
}

export type OrderEconomics = {
  price: number
  material: number
  labor: number
  shipping: number
  cost: number
  revenue: number
  feeAmt: number
  profit: number
  marginPct: number
}

// Shipping is always a real cost (postage gets paid either way). It's only
// ever added to revenue when the buyer covers it — which makes it a wash on
// profit (collected, then spent), aside from the marketplace fee still
// applying to that portion, same as the rest of the sale. When the seller
// covers it instead, it's a cost with no offsetting revenue, so it comes
// straight out of profit.
export function computeOrderEconomics(input: PricingInputs): OrderEconomics {
  const price = Number(input.suggested_price) || 0
  const material = Number(input.material_cost) || 0
  const labor = Number(input.labor_cost) || 0
  const shipping = Number(input.estimated_shipping) || 0
  const buyerCoversShipping = input.shipping_buyer_covered !== false

  const cost = material + labor + shipping
  const revenue = price + (buyerCoversShipping ? shipping : 0)
  const feeAmt = revenue * (Number(input.fee_pct) || 0) / 100
  const profit = revenue - cost - feeAmt
  const marginPct = revenue > 0 ? (profit / revenue) * 100 : 0

  return { price, material, labor, shipping, cost, revenue, feeAmt, profit, marginPct }
}
