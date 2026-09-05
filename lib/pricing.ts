// Shared order-economics formula — used by the order detail page's Pricing &
// Margin card, the dashboard profit widget, and the cross-channel
// profitability report. Centralized after a real bug (2026-09-03) where
// duplicating this formula in two places let them drift: the first pass
// added buyer-covered shipping to revenue without also costing it, which
// silently counted shipping as pure profit on every imported order.
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
