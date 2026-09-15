import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { isExpired, canRespond, type QuoteSnapshot, type QuoteStatus } from '@/lib/quotes'
import { normalizeVenmoUsername, venmoPayUrl } from '@/lib/venmo'
import { normalizePaypalMeName, paypalPayUrl } from '@/lib/paypal'
import QuoteResponse from './QuoteResponse'

export const metadata: Metadata = {
  title: 'Your quote',
  robots: { index: false, follow: false },
}

// The customer-facing quote. Public by design — the recipient has no account,
// and the unguessable token in the URL is what stands in for one. Read through
// the service-role client: `quotes` has RLS with no anonymous policy, because
// a policy permissive enough to fetch "the row matching this token" would also
// permit enumerating every row (the filter comes from the caller, not the
// policy). Filtering by token here, on the server, is the enforcement.
//
// Shows the customer only what concerns them: line items, totals, validity.
// Material costs, labour rate and markup are the seller's numbers and never
// appear.
export default async function QuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = createSupabaseAdminClient()

  const { data: quote } = await admin
    .from('quotes')
    .select('id, user_id, token, status, valid_until, snapshot, message, sent_at, responded_at')
    .eq('token', token)
    .maybeSingle()

  if (!quote) notFound()

  // Only the payment handles are read from the seller's profile — nothing else
  // about the seller reaches this public page.
  const { data: seller } = await admin
    .from('profiles')
    .select('venmo_username, paypal_me_name')
    .eq('id', quote.user_id)
    .maybeSingle()

  // First open marks it seen, so the seller can tell "not looked at yet" from
  // "read and ignored" — the question a quote actually raises.
  if (quote.status === 'sent') {
    await admin
      .from('quotes')
      .update({ status: 'viewed', viewed_at: new Date().toISOString() })
      .eq('id', quote.id)
      .eq('status', 'sent')
  }

  const snapshot = quote.snapshot as QuoteSnapshot
  const status = quote.status as QuoteStatus
  const expired = isExpired(quote.valid_until)
  const openForResponse = canRespond(status, quote.valid_until)

  // Re-validated at render: never put an unchecked value into a link.
  const venmo = normalizeVenmoUsername(seller?.venmo_username)
  const paypal = normalizePaypalMeName(seller?.paypal_me_name)

  const money = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0)

  return (
    <div className="font-sans min-h-screen bg-gray-950 text-white px-6 py-12">
      <div className="max-w-2xl mx-auto">
        <p className="text-indigo-400 text-sm font-medium tracking-wide uppercase">Quote</p>
        <h1 className="text-3xl font-bold mt-2 text-balance">{snapshot.orderTitle}</h1>
        <p className="text-gray-400 mt-2">
          From {snapshot.businessName}
          {snapshot.clientName ? ` · for ${snapshot.clientName}` : ''}
        </p>

        {(status === 'accepted' || status === 'declined') && (
          <div
            className={`mt-6 rounded-xl px-4 py-3 text-sm border ${
              status === 'accepted'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-gray-800 border-gray-700 text-gray-300'
            }`}
          >
            {status === 'accepted' ? 'You accepted this quote.' : 'You declined this quote.'}
            {quote.responded_at ? ` ${new Date(quote.responded_at).toLocaleDateString()}` : ''}
          </div>
        )}

        {expired && status !== 'accepted' && status !== 'declined' && (
          <div className="mt-6 rounded-xl px-4 py-3 text-sm bg-amber-500/10 border border-amber-500/30 text-amber-300">
            This quote expired on {new Date(quote.valid_until!).toLocaleDateString()}. Get in touch
            with {snapshot.businessName} for an up-to-date price.
          </div>
        )}

        {quote.message && (
          <div className="mt-6 bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{quote.message}</p>
          </div>
        )}

        <div className="mt-6 bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs uppercase tracking-wide">
                  <th className="text-left font-medium px-5 py-3">Item</th>
                  <th className="text-right font-medium px-5 py-3 whitespace-nowrap">Qty</th>
                  <th className="text-right font-medium px-5 py-3 whitespace-nowrap">Each</th>
                  <th className="text-right font-medium px-5 py-3 whitespace-nowrap">Amount</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.items.map((item, i) => {
                  const waived = item.itemType === 'shipping' && item.buyerCovered === false
                  const amount = waived ? 0 : item.quantity * item.unitPrice
                  return (
                    <tr key={i} className="border-t border-gray-800">
                      <td className="px-5 py-3 text-gray-200">{item.description}</td>
                      <td className="px-5 py-3 text-right text-gray-400 tabular-nums">{item.quantity}</td>
                      <td className="px-5 py-3 text-right text-gray-400 tabular-nums">{money(item.unitPrice)}</td>
                      <td className="px-5 py-3 text-right text-gray-200 tabular-nums">
                        {waived ? 'Included' : money(amount)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="border-t border-gray-800 px-5 py-4 space-y-2 text-sm">
            <div className="flex justify-between text-gray-400">
              <span>Subtotal</span>
              <span className="tabular-nums">{money(snapshot.subtotal)}</span>
            </div>
            {snapshot.taxRate > 0 && (
              <div className="flex justify-between text-gray-400">
                <span>Tax ({snapshot.taxRate}%)</span>
                <span className="tabular-nums">{money(snapshot.taxAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-white font-semibold text-base pt-2 border-t border-gray-800">
              <span>Total</span>
              <span className="tabular-nums">{money(snapshot.total)}</span>
            </div>
          </div>
        </div>

        {quote.valid_until && !expired && (
          <p className="text-gray-500 text-sm mt-4">
            Valid until {new Date(quote.valid_until).toLocaleDateString()}.
          </p>
        )}

        {openForResponse && <QuoteResponse token={quote.token} />}

        {/* Pay links once the customer has agreed — paying before accepting
            would be backwards. Handles, amount and reference are also shown
            as text: Venmo's prefilled links aren't officially documented, and
            PayPal.Me can't prefill a note, so the customer may need them. */}
        {status === 'accepted' && (venmo || paypal) && snapshot.total > 0 && (
          <div className="mt-6 bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <p className="text-white font-semibold">Ready to pay?</p>
            <p className="text-gray-400 text-sm mt-1">
              {snapshot.businessName} takes {[venmo && 'Venmo', paypal && 'PayPal'].filter(Boolean).join(' and ')}.
              {' '}Please include reference <span className="text-gray-200 font-medium">{snapshot.orderNumber}</span> with your payment.
            </p>
            <div className="flex flex-wrap gap-3 mt-4">
              {venmo && (
                <a
                  href={venmoPayUrl(venmo, snapshot.total, `${snapshot.orderTitle} (${snapshot.orderNumber})`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-[#008CFF] hover:bg-[#0074d4] text-white font-semibold px-5 py-2.5 rounded-xl transition"
                >
                  Pay {money(snapshot.total)} with Venmo
                </a>
              )}
              {paypal && (
                <a
                  href={paypalPayUrl(paypal, snapshot.total)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-[#FFC439] hover:bg-[#f2b72c] text-[#003087] font-semibold px-5 py-2.5 rounded-xl transition"
                >
                  Pay {money(snapshot.total)} with PayPal
                </a>
              )}
            </div>
            <ul className="text-gray-500 text-xs mt-3 space-y-1">
              {venmo && (
                <li>
                  Venmo: send to <span className="text-gray-300 font-medium">@{venmo}</span> — the button fills in the
                  amount and reference, if it doesn’t, add them by hand.
                </li>
              )}
              {paypal && (
                <li>
                  PayPal: <span className="text-gray-300 font-medium">paypal.me/{paypal}</span> — the amount is filled
                  in; add {snapshot.orderNumber} as the note.
                </li>
              )}
              <li>If you agreed on a deposit, you can change the amount before paying.</li>
            </ul>
          </div>
        )}

        <p className="text-gray-600 text-xs mt-12">
          Sent {new Date(quote.sent_at).toLocaleDateString()} · Reference {snapshot.orderNumber}
        </p>
      </div>
    </div>
  )
}
