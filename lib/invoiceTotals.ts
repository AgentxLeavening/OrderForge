// What an invoice actually asks for, once payments already taken are counted.
//
// Before this existed the PDF billed the full total no matter what: a customer
// who had paid a 50% deposit got an invoice for the whole job, with no mention
// of the deposit — an easy way to be paid twice, or to look disorganised.

export type InvoiceLine = {
  description?: string
  quantity: number | string | null
  unit_price: number | string | null
  item_type?: string | null
  buyer_covered?: boolean | null
}

export type InvoicePayment = {
  amount: number | string
  kind?: string | null
  method?: string | null
  paid_at?: string | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * A shipping line the buyer isn't covering bills at zero — the same rule as
 * `billableAmount` on the order page and `billableLineTotal` in lib/quotes.ts.
 * The PDF used to ignore this, so an invoice could total more than the order
 * it came from.
 */
export function billableLine(line: InvoiceLine): number {
  if (line.item_type === 'shipping' && line.buyer_covered === false) return 0
  return (Number(line.quantity) || 0) * (Number(line.unit_price) || 0)
}

export type InvoiceTotals = {
  subtotal: number
  taxAmount: number
  total: number
  paid: number
  balance: number
  fullyPaid: boolean
}

/**
 * Totals for an invoice, including what's already been paid.
 *
 * Refunds subtract, matching `netPaid` in lib/payments.ts — an invoice must
 * agree with the order page, or the seller and the customer are reading
 * different numbers.
 */
export function invoiceTotals(
  lines: InvoiceLine[],
  taxRate: number | null | undefined,
  payments: InvoicePayment[] = []
): InvoiceTotals {
  const subtotal = round2(lines.reduce((sum, l) => sum + billableLine(l), 0))
  const taxAmount = round2(subtotal * ((Number(taxRate) || 0) / 100))
  const total = round2(subtotal + taxAmount)
  const paid = round2(payments.reduce((sum, p) => {
    const amount = Number(p.amount) || 0
    return p.kind === 'refund' ? sum - amount : sum + amount
  }, 0))
  const balance = round2(total - paid)
  // One cent of tolerance, same as BALANCE_TOLERANCE in lib/payments.ts:
  // invoice tax is stored unrounded, so paying the printed amount could
  // otherwise leave a phantom penny outstanding.
  return { subtotal, taxAmount, total, paid, balance, fullyPaid: paid > 0 && balance <= 0.01 }
}
