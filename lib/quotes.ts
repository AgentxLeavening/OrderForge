import crypto from 'crypto'

// Shared types and helpers for customer-facing quotes. Kept out of the route
// files so the dashboard (which creates quotes) and the public page (which
// renders and responds to them) agree on the snapshot shape.

export type QuoteSnapshotItem = {
  description: string
  quantity: number
  unitPrice: number
  itemType?: string | null
  buyerCovered?: boolean | null
}

/**
 * A deposit asked for up front — "50% to book". Stored in the snapshot with
 * the percentage that produced it, so the quote records the terms as sent even
 * if the seller's defaults change later.
 */
export type QuoteDeposit = {
  amount: number
  /** null when the seller typed a fixed amount rather than a percentage. */
  percent: number | null
}

export type QuoteSnapshot = {
  items: QuoteSnapshotItem[]
  subtotal: number
  taxRate: number
  taxAmount: number
  total: number
  businessName: string
  clientName: string | null
  orderTitle: string
  orderNumber: string
  /** Absent on quotes sent before deposits existed, and on quotes with none. */
  deposit?: QuoteDeposit | null
}

export type DepositRequest =
  | { type: 'none' }
  | { type: 'percent'; value: number }
  | { type: 'fixed'; value: number }

/**
 * The deposit for a quote total, or null for none.
 *
 * Clamped to the total: asking for more up front than the job costs is always
 * a mistake, and a negative or unparseable value means "no deposit" rather
 * than an error the seller has to deal with mid-send. Rounded to cents so the
 * figure on the quote is exactly what the pay button asks for.
 */
export function computeDeposit(total: number, request: DepositRequest | null | undefined): QuoteDeposit | null {
  if (!request || request.type === 'none') return null
  const value = Number(request.value)
  if (!Number.isFinite(value) || value <= 0) return null

  const raw = request.type === 'percent' ? (Number(total) || 0) * (value / 100) : value
  const amount = Math.round(Math.min(raw, Number(total) || 0) * 100) / 100
  if (amount <= 0) return null
  return { amount, percent: request.type === 'percent' ? value : null }
}

export type QuoteStatus = 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired'

/**
 * The public URL is the only thing protecting a quote — the page is
 * deliberately unauthenticated so a customer can open it without an account.
 * 32 random bytes, base64url, is far past guessable.
 */
export function generateQuoteToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/**
 * A shipping line the buyer isn't covering is billed at zero — mirrors
 * billableAmount() on the order detail page, which is what the app shows the
 * seller. The quote must total the same as the order, or the two disagree in
 * front of a customer.
 */
export function billableLineTotal(item: QuoteSnapshotItem): number {
  if (item.itemType === 'shipping' && item.buyerCovered === false) return 0
  return (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)
}

/** A quote past its validity date can be read but not accepted. */
export function isExpired(validUntil: string | null, now = new Date()): boolean {
  if (!validUntil) return false
  // valid_until is a date; treat the whole of that day as still valid.
  const end = new Date(`${validUntil}T23:59:59.999Z`)
  return now.getTime() > end.getTime()
}

/**
 * Whether a customer can still act on this quote. Anything already responded
 * to stays final — a second click must not flip an accepted quote to declined.
 */
export function canRespond(status: QuoteStatus, validUntil: string | null, now = new Date()): boolean {
  if (status === 'accepted' || status === 'declined' || status === 'expired') return false
  return !isExpired(validUntil, now)
}

export const formatMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0)
