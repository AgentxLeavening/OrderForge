'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  PAYMENT_METHODS,
  PAYMENT_STATUS_BADGE,
  amountDue,
  hasBalance,
  paymentMethodLabel,
  summarizePayments,
  type BillableLine,
} from '@/lib/payments'

type Payment = {
  id: string
  amount: number
  kind: 'payment' | 'refund'
  method: string
  paid_at: string
  note: string | null
}

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`
// Local calendar date, not UTC — an evening craft fair shouldn't log as tomorrow.
const todayLocal = () => new Date().toLocaleDateString('en-CA')

const SOURCE_LABEL = {
  invoice: 'from the latest invoice (incl. tax)',
  quote: 'from the accepted quote (incl. tax)',
  line_items: 'from line items',
} as const

/**
 * Payments card for the order page. `refreshKey` should change whenever the
 * page creates something that affects the amount due (an invoice), so the
 * balance re-reads it.
 */
export default function OrderPayments({
  orderId,
  lineItems,
  marketplaceLabel,
  refreshKey = 0,
}: {
  orderId: string
  lineItems: BillableLine[]
  marketplaceLabel: string | null
  refreshKey?: number
}) {
  const [payments, setPayments] = useState<Payment[]>([])
  const [invoiceTotal, setInvoiceTotal] = useState<number | null>(null)
  const [quoteTotal, setQuoteTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState<'payment' | 'refund'>('payment')
  const [method, setMethod] = useState('venmo')
  const [paidAt, setPaidAt] = useState(todayLocal())
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const [paymentsRes, invoiceRes, quoteRes] = await Promise.all([
      supabase.from('order_payments').select('id, amount, kind, method, paid_at, note')
        .eq('order_id', orderId).order('paid_at', { ascending: true }).order('created_at', { ascending: true }),
      supabase.from('invoices').select('total')
        .eq('order_id', orderId).order('created_at', { ascending: false }).limit(1),
      supabase.from('quotes').select('snapshot')
        .eq('order_id', orderId).eq('status', 'accepted').order('responded_at', { ascending: false }).limit(1),
    ])
    const firstError = paymentsRes.error || invoiceRes.error || quoteRes.error
    if (firstError) setError(firstError.message)
    setPayments((paymentsRes.data || []) as Payment[])
    setInvoiceTotal(invoiceRes.data?.[0]?.total ?? null)
    setQuoteTotal((quoteRes.data?.[0]?.snapshot as { total?: number } | undefined)?.total ?? null)
    setLoading(false)
  }, [orderId])

  useEffect(() => { load() }, [load, refreshKey])

  const due = amountDue({ lineItems, latestInvoiceTotal: invoiceTotal, acceptedQuoteTotal: quoteTotal })
  const summary = summarizePayments({ due: due.amount, payments, isMarketplace: !!marketplaceLabel })
  const badge = PAYMENT_STATUS_BADGE[summary.status]

  // `override` is the one-click "Mark paid in full" path: the remaining
  // balance, paid today, by the method currently selected. Venmo and PayPal
  // can't report payments back to us (no API for it), so recording is always
  // manual — this just removes the typing.
  const addPayment = async (override?: { amount: number; note?: string }) => {
    const value = override ? Math.round(override.amount * 100) / 100 : Math.round(Number(amount) * 100) / 100
    if (!(value > 0)) { setError('Enter an amount greater than zero.'); return }
    setSaving(true)
    setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not signed in.'); setSaving(false); return }

    const { error: insErr } = await supabase.from('order_payments').insert({
      user_id: user.id,
      order_id: orderId,
      amount: value,
      kind: override ? 'payment' : kind,
      method,
      paid_at: override ? todayLocal() : (paidAt || todayLocal()),
      note: (override ? override.note : note.trim()) || null,
    })
    if (insErr) {
      setError(insErr.message)
    } else {
      setAmount('')
      setNote('')
      setKind('payment')
      await load()
    }
    setSaving(false)
  }

  const removePayment = async (p: Payment) => {
    if (!confirm(`Remove this ${p.kind} of ${money(p.amount)}?`)) return
    const { error: delErr } = await supabase.from('order_payments').delete().eq('id', p.id)
    if (delErr) setError(delErr.message)
    else setPayments(prev => prev.filter(x => x.id !== p.id))
  }

  const inputClass = 'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500'

  if (marketplaceLabel) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-semibold">Payments</h2>
          <span className={`text-xs px-2 py-1 rounded-full ${badge.className}`}>Paid via {marketplaceLabel}</span>
        </div>
        <p className="text-gray-500 text-sm mt-2">{marketplaceLabel} collected payment from the buyer before this order was imported.</p>
      </div>
    )
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-white font-semibold">Payments</h2>
        {!loading && <span className={`text-xs px-2 py-1 rounded-full ${badge.className}`}>{badge.label}</span>}
      </div>

      {hasBalance(summary.balance) && (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <button
            type="button"
            onClick={() => addPayment({ amount: summary.balance, note: payments.length ? 'Balance paid' : 'Paid in full' })}
            disabled={saving}
            className="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
          >
            {saving ? 'Saving…' : `Mark ${money(summary.balance)} paid`}
          </button>
          <span className="text-gray-500 text-xs">
            Records today&apos;s date and the method selected below ({paymentMethodLabel(method)}).
          </span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-gray-500 text-xs">Amount due</p>
          <p className="text-white font-semibold">{money(summary.due)}</p>
          <p className="text-gray-600 text-[11px] mt-0.5">{SOURCE_LABEL[due.source]}</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-gray-500 text-xs">Received</p>
          <p className="text-white font-semibold">{money(summary.paid)}</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-gray-500 text-xs">{summary.balance < 0 ? 'Overpaid by' : 'Balance'}</p>
          <p className={`font-semibold ${hasBalance(summary.balance) ? 'text-amber-300' : hasBalance(-summary.balance) ? 'text-blue-300' : 'text-green-400'}`}>
            {money(Math.abs(summary.balance))}
          </p>
        </div>
      </div>

      {payments.length > 0 && (
        <div className="space-y-2 mb-4">
          {payments.map(p => (
            <div key={p.id} className="flex items-center gap-3 bg-gray-800 rounded-lg px-4 py-2.5 text-sm">
              <span className="text-gray-400 w-24 shrink-0">{new Date(`${p.paid_at}T00:00:00`).toLocaleDateString()}</span>
              <span className="text-gray-300 w-28 shrink-0">{paymentMethodLabel(p.method)}</span>
              <span className="text-gray-500 flex-1 truncate">{p.note}</span>
              <span className={p.kind === 'refund' ? 'text-red-400' : 'text-white'}>
                {p.kind === 'refund' ? '−' : ''}{money(p.amount)}
              </span>
              <button onClick={() => removePayment(p)} className="text-gray-600 hover:text-red-400 transition text-lg leading-none" aria-label="Remove payment">×</button>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-gray-800 pt-4">
        <div className="grid grid-cols-2 md:grid-cols-12 gap-2">
          <select value={kind} onChange={e => setKind(e.target.value as 'payment' | 'refund')} className={`${inputClass} md:col-span-2`}>
            <option value="payment">Payment</option>
            <option value="refund">Refund</option>
          </select>
          <input
            value={amount}
            onChange={e => setAmount(e.target.value)}
            type="number"
            min="0"
            step="0.01"
            placeholder={hasBalance(summary.balance) ? summary.balance.toFixed(2) : 'Amount'}
            className={`${inputClass} md:col-span-2 text-right`}
          />
          <select value={method} onChange={e => setMethod(e.target.value)} className={`${inputClass} md:col-span-2`}>
            {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} className={`${inputClass} md:col-span-2`} />
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (e.g. deposit)" className={`${inputClass} md:col-span-2`} />
          <button
            onClick={() => addPayment()}
            disabled={saving}
            className="md:col-span-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg transition text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : '+ Record'}
          </button>
        </div>
        {hasBalance(summary.balance) && (
          <button
            type="button"
            onClick={() => { setKind('payment'); setAmount(summary.balance.toFixed(2)) }}
            className="text-xs text-indigo-400 hover:text-indigo-300 mt-2"
          >
            Fill in remaining balance ({money(summary.balance)}) to edit the date or note
          </button>
        )}
        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
      </div>
    </div>
  )
}
