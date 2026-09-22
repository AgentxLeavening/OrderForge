'use client'

import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { CHANNEL_OPTIONS } from '@/app/components/NewOrderModal'
import { computeOrderEconomics } from '@/lib/pricing'
import { expenseCategoryLabel, totalExpenses, totalsByCategory } from '@/lib/expenses'

type ExpenseRow = {
  incurred_on: string
  amount: number
  category: string
  vendor: string | null
  note: string | null
  receipt_path: string | null
  orders?: { order_number: string } | null
}

const channelLabel = (value: string | null | undefined) =>
  CHANNEL_OPTIONS.find(o => o.value === (value || ''))?.label ?? (value || 'Not specified')

// Minimal CSV field escaping — wraps in quotes and doubles any embedded
// quotes whenever a value could otherwise break the format (comma, quote,
// or newline).
const csvField = (value: string | number) => {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const startOfYear = () => `${new Date().getFullYear()}-01-01`
const today = () => new Date().toISOString().slice(0, 10)

export default function TaxExportPage() {
  const [startDate, setStartDate] = useState(startOfYear())
  const [endDate, setEndDate] = useState(today())
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<{ count: number; revenue: number; profit: number; expenses: number; expenseCount: number } | null>(null)

  const download = async () => {
    setDownloading(true)
    setError('')
    setSummary(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError('Not signed in.'); return }

      const { data: orders, error: fetchErr } = await supabase
        .from('orders')
        .select('order_number, created_at, sales_channel, buyer_name, suggested_price, material_cost, labor_cost, estimated_shipping, shipping_buyer_covered, fee_pct, fee_fixed, status')
        .eq('user_id', user.id)
        .neq('status', 'cancelled')
        .gte('created_at', startDate)
        .lte('created_at', `${endDate}T23:59:59.999Z`)
        .order('created_at', { ascending: true })

      if (fetchErr) throw fetchErr
      const rows = orders || []

      const header = ['Order Number', 'Date', 'Channel', 'Buyer', 'Revenue', 'Materials', 'Labor', 'Shipping', 'Marketplace Fee', 'Profit']
      const lines = [header.map(csvField).join(',')]

      let totalRevenue = 0
      let totalProfit = 0
      for (const o of rows) {
        const { revenue, material, labor, shipping, feeAmt, profit } = computeOrderEconomics(o)
        totalRevenue += revenue
        totalProfit += profit
        lines.push([
          o.order_number || '',
          new Date(o.created_at).toLocaleDateString(),
          channelLabel(o.sales_channel),
          o.buyer_name || '',
          revenue.toFixed(2),
          material.toFixed(2),
          labor.toFixed(2),
          shipping.toFixed(2),
          feeAmt.toFixed(2),
          profit.toFixed(2),
        ].map(csvField).join(','))
      }

      // Expenses go in the same file, after the orders, under their own
      // heading. One download is what an accountant gets handed, and income
      // without deductions is only half the picture. Deliberately NOT summed
      // into the order rows: an order's material cost is what the job consumed,
      // while an expense is money that left the bank on a date — adding them
      // together would double-count a spool bought in March and used in June.
      const { data: expenseRows, error: expenseErr } = await supabase
        .from('expenses')
        .select('incurred_on, amount, category, vendor, note, receipt_path, orders(order_number)')
        .eq('user_id', user.id)
        .gte('incurred_on', startDate)
        .lte('incurred_on', endDate)
        .order('incurred_on', { ascending: true })

      if (expenseErr) throw expenseErr
      const expenses = (expenseRows || []) as unknown as ExpenseRow[]
      const expenseTotal = totalExpenses(expenses)

      if (expenses.length > 0) {
        lines.push('')
        lines.push(['Expenses'].map(csvField).join(','))
        // "Receipt" tells an accountant which lines have documentation behind
        // them — the question they ask about every deduction.
        lines.push(['Date', 'Category', 'Vendor', 'Note', 'Order', 'Amount', 'Receipt'].map(csvField).join(','))
        for (const e of expenses) {
          lines.push([
            new Date(`${e.incurred_on}T00:00:00`).toLocaleDateString(),
            expenseCategoryLabel(e.category),
            e.vendor || '',
            e.note || '',
            e.orders?.order_number || '',
            (Number(e.amount) || 0).toFixed(2),
            e.receipt_path ? 'yes' : '',
          ].map(csvField).join(','))
        }

        lines.push('')
        lines.push(['Expense totals by category'].map(csvField).join(','))
        for (const b of totalsByCategory(expenses)) {
          lines.push([b.label, b.total.toFixed(2)].map(csvField).join(','))
        }
        lines.push(['Total expenses', expenseTotal.toFixed(2)].map(csvField).join(','))
      }

      setSummary({ count: rows.length, revenue: totalRevenue, profit: totalProfit, expenses: expenseTotal, expenseCount: expenses.length })

      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `orderforge-tax-export-${startDate}-to-${endDate}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
    }
    setDownloading(false)
  }

  const inputClass = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500'
  const labelClass = 'text-sm text-gray-400 mb-1 block'

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold text-white">Tax Season Export</h1>
          <Link href="/dashboard/reports" className="text-sm text-indigo-400 hover:text-indigo-300">← Reports</Link>
        </div>
        <p className="text-gray-500 text-sm mb-6">
          One CSV of every order&apos;s revenue, cost basis, and profit for a date range — across every channel, cancelled orders excluded —
          followed by your <Link href="/dashboard/expenses" className="text-indigo-400 hover:text-indigo-300">expenses</Link> for the same
          range, itemised and totalled by category.
        </p>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Start date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>End date</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={inputClass} />
            </div>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm">{error}</div>
          )}

          {summary && (
            <div className="bg-green-500/10 border border-green-500/20 text-green-400 px-4 py-3 rounded-lg text-sm">
              Downloaded {summary.count} order{summary.count === 1 ? '' : 's'} — ${summary.revenue.toFixed(2)} revenue, ${summary.profit.toFixed(2)} profit
              {summary.expenseCount > 0
                ? ` · ${summary.expenseCount} expense${summary.expenseCount === 1 ? '' : 's'} totalling $${summary.expenses.toFixed(2)}.`
                : ' · no expenses recorded in this range.'}
            </div>
          )}

          <button
            onClick={download}
            disabled={downloading}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-5 py-2.5 rounded-lg transition disabled:opacity-50"
          >
            {downloading ? 'Preparing…' : 'Download CSV'}
          </button>
        </div>
      </div>
    </div>
  )
}
