// Payment tracking: what an order is owed, what's been paid, and what's left.
// Shared by the order page's Payments card and the dashboard's "owed to you"
// view so the two can't disagree about a balance. No money moves through
// OrderForge — these are records of payments taken elsewhere.

export const PAYMENT_METHODS = [
  { value: 'venmo', label: 'Venmo' },
  { value: 'cash', label: 'Cash' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'cash_app', label: 'Cash App' },
  { value: 'zelle', label: 'Zelle' },
  { value: 'card', label: 'Card' },
  { value: 'check', label: 'Check' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'other', label: 'Other' },
] as const

export const paymentMethodLabel = (value: string | null | undefined) =>
  PAYMENT_METHODS.find(m => m.value === value)?.label ?? 'Other'

export type PaymentRecord = {
  amount: number | string
  kind: 'payment' | 'refund' | string
}

export type BillableLine = {
  quantity: number | string | null
  unit_price: number | string | null
  item_type?: string | null
  buyer_covered?: boolean | null
}

export type DueSource = 'invoice' | 'quote' | 'line_items'

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * What the customer owes for this order, and where that number came from.
 *
 * In order of precedence:
 *   1. the latest invoice — what was actually billed, including tax
 *   2. the latest accepted quote — what the customer agreed to, including tax
 *   3. the order's line items — when neither document exists (a craft-fair
 *      sale, a Venmo commission agreed in messages)
 * Line items exclude tax, so an order that charges tax should be invoiced or
 * quoted for the balance to include it. The source is returned so the UI can
 * say which one it used rather than leaving the seller to guess.
 *
 * A shipping line the buyer isn't covering bills at zero — the same rule as
 * billableAmount on the order page and billableLineTotal in lib/quotes.ts.
 */
export function amountDue({
  lineItems,
  latestInvoiceTotal,
  acceptedQuoteTotal,
}: {
  lineItems: BillableLine[]
  latestInvoiceTotal?: number | null
  acceptedQuoteTotal?: number | null
}): { amount: number; source: DueSource } {
  if (latestInvoiceTotal != null) return { amount: round2(Number(latestInvoiceTotal) || 0), source: 'invoice' }
  if (acceptedQuoteTotal != null) return { amount: round2(Number(acceptedQuoteTotal) || 0), source: 'quote' }
  const total = lineItems.reduce((sum, li) => {
    if (li.item_type === 'shipping' && li.buyer_covered === false) return sum
    return sum + (Number(li.quantity) || 0) * (Number(li.unit_price) || 0)
  }, 0)
  return { amount: round2(total), source: 'line_items' }
}

/** Net received: payments minus refunds. */
export function netPaid(payments: PaymentRecord[]): number {
  return round2(payments.reduce((sum, p) => {
    const amount = Number(p.amount) || 0
    return p.kind === 'refund' ? sum - amount : sum + amount
  }, 0))
}

export type PaymentStatus = 'marketplace' | 'no_charge' | 'unpaid' | 'partial' | 'paid' | 'overpaid'

export type PaymentSummary = {
  status: PaymentStatus
  due: number
  paid: number
  balance: number // due − paid; negative when overpaid
}

// Up to one cent either way counts as settled. Invoice tax is computed
// unrounded (subtotal × rate), so a customer paying the displayed $53.50 on a
// $53.505 total would otherwise sit at "Deposit paid, $0.01 left" forever.
export const BALANCE_TOLERANCE = 0.01
export const hasBalance = (amount: number) => amount > BALANCE_TOLERANCE + 1e-9

/**
 * Marketplace orders (Etsy/eBay/Shopify imports) are paid by the buyer before
 * they ever reach OrderForge, so they're reported as such and never show a
 * balance — even though they have no payment rows.
 */
export function summarizePayments({
  due,
  payments,
  isMarketplace,
}: {
  due: number
  payments: PaymentRecord[]
  isMarketplace: boolean
}): PaymentSummary {
  const paid = netPaid(payments)
  if (isMarketplace) return { status: 'marketplace', due, paid: due, balance: 0 }

  const balance = round2(due - paid)
  let status: PaymentStatus
  if (due <= 0 && paid <= 0) status = 'no_charge'
  else if (hasBalance(balance) && paid <= 0) status = 'unpaid'
  else if (hasBalance(balance)) status = 'partial'
  else if (hasBalance(-balance)) status = 'overpaid'
  else status = 'paid'

  return { status, due, paid, balance }
}

export const PAYMENT_STATUS_BADGE: Record<PaymentStatus, { label: string; className: string }> = {
  marketplace: { label: 'Paid via marketplace', className: 'bg-gray-700 text-gray-300' },
  no_charge: { label: 'No charge', className: 'bg-gray-700 text-gray-400' },
  unpaid: { label: 'Unpaid', className: 'bg-red-500/15 text-red-400' },
  partial: { label: 'Deposit paid', className: 'bg-amber-500/15 text-amber-400' },
  paid: { label: 'Paid in full', className: 'bg-green-500/15 text-green-400' },
  overpaid: { label: 'Overpaid', className: 'bg-blue-500/15 text-blue-400' },
}

/**
 * Whether an order belongs on the "owed to you" list. Cancelled orders never
 * are (a refund, if any, is recorded on the order itself). At Inquiry or
 * Quoted nothing has been agreed yet, so an unpaid order isn't owed — but one
 * where a deposit was already taken is, since the customer has committed.
 */
export function isOwed(summary: PaymentSummary, orderStatus: string): boolean {
  if (orderStatus === 'cancelled') return false
  if (orderStatus === 'inquiry' || orderStatus === 'quoted') return summary.status === 'partial'
  return summary.status === 'unpaid' || summary.status === 'partial'
}
