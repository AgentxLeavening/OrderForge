'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { CHANNEL_OPTIONS } from '@/app/components/NewOrderModal'
import { unitShort } from '@/lib/inventory'
import { buildReorderList, computeUsage, type ReorderItem, type UsageTransaction } from '@/lib/reorder'

const channelLabel = (value: string) =>
  value === 'unspecified' ? 'Not specified' : CHANNEL_OPTIONS.find(o => o.value === value)?.label ?? value

const csvField = (value: string | number) => {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const WINDOW_OPTIONS = [30, 60, 90]
const COVER_OPTIONS = [14, 30, 60]

// PostgREST caps a response at 1000 rows by default; page through so a busy
// shop's usage isn't silently truncated.
async function fetchAllPages<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>) {
  const pageSize = 1000
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }
  return rows
}

const formatQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

export default function ReorderListPage() {
  const [windowDays, setWindowDays] = useState(30)
  const [coverDays, setCoverDays] = useState(30)
  const [items, setItems] = useState<ReorderItem[]>([])
  const [transactions, setTransactions] = useState<UsageTransaction[]>([])
  const [channels, setChannels] = useState<Map<string, string | null>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Seller's edits to suggested quantities, keyed by item id.
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState(false)

  // Always loads the widest window; switching 30/60/90 just re-filters.
  useEffect(() => {
    const load = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setError('Not signed in.'); return }

        const since = new Date(Date.now() - Math.max(...WINDOW_OPTIONS) * 864e5).toISOString()
        const [inv, deductions, restocks] = await Promise.all([
          fetchAllPages<ReorderItem>((from, to) =>
            supabase.from('inventory_items')
              .select('id, name, sku, unit, quantity, unit_cost, reorder_threshold')
              .eq('user_id', user.id).order('name').range(from, to)),
          fetchAllPages<UsageTransaction>((from, to) =>
            supabase.from('inventory_transactions')
              .select('inventory_item_id, order_id, change, reason, created_at')
              .eq('user_id', user.id).eq('reason', 'order_template_deduction').gte('created_at', since)
              .order('created_at').range(from, to)),
          // Restocks at any date: a deduction inside the window can be undone
          // by a restock at any later point (see computeUsage).
          fetchAllPages<UsageTransaction>((from, to) =>
            supabase.from('inventory_transactions')
              .select('inventory_item_id, order_id, change, reason, created_at')
              .eq('user_id', user.id).in('reason', ['order_cancelled_restock', 'order_deleted_restock'])
              .order('created_at').range(from, to)),
        ])

        const orderIds = [...new Set(deductions.map(t => t.order_id).filter((id): id is string => !!id))]
        const channelMap = new Map<string, string | null>()
        for (let i = 0; i < orderIds.length; i += 200) {
          const { data, error: ordersErr } = await supabase
            .from('orders').select('id, sales_channel').in('id', orderIds.slice(i, i + 200))
          if (ordersErr) throw ordersErr
          for (const o of data || []) channelMap.set(o.id, o.sales_channel)
        }

        setItems(inv)
        setTransactions([...deductions, ...restocks])
        setChannels(channelMap)
      } catch (e) {
        setError(e instanceof Error ? e.message : String((e as any)?.message ?? e))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const rows = useMemo(() => {
    const usage = computeUsage(transactions, windowDays, channels)
    return buildReorderList(items, usage, { windowDays, coverDays })
  }, [items, transactions, channels, windowDays, coverDays])

  const qtyFor = (id: string, suggested: number) => {
    const raw = overrides[id]
    if (raw === undefined) return suggested
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : 0
  }

  const lines = rows
    .map(r => ({ row: r, qty: qtyFor(r.item.id, r.suggestedQty) }))
    .filter(l => l.qty > 0)
  const totalCost = lines.reduce((s, l) => s + l.qty * (Number(l.row.item.unit_cost) || 0), 0)
  const missingCost = lines.some(l => !Number(l.row.item.unit_cost))

  const copyList = async () => {
    const text = [
      `Reorder list — ${new Date().toLocaleDateString()}`,
      ...lines.map(({ row, qty }) => {
        const cost = qty * (Number(row.item.unit_cost) || 0)
        return `- ${row.item.name}${row.item.sku ? ` (${row.item.sku})` : ''}: ${formatQty(qty)} ${unitShort(row.item.unit)}${cost ? ` ≈ $${cost.toFixed(2)}` : ''}`
      }),
      `Estimated total: $${totalCost.toFixed(2)}`,
    ].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy to the clipboard.')
    }
  }

  const downloadCsv = () => {
    const header = ['Item', 'SKU', 'Unit', 'On hand', 'Used per day', 'Days left', 'Order qty', 'Cost per unit', 'Estimated cost']
    const body = lines.map(({ row, qty }) => [
      row.item.name,
      row.item.sku || '',
      unitShort(row.item.unit),
      Number(row.item.quantity) || 0,
      row.dailyRate.toFixed(2),
      row.daysLeft === null ? '' : Math.floor(row.daysLeft),
      qty,
      (Number(row.item.unit_cost) || 0).toFixed(4),
      (qty * (Number(row.item.unit_cost) || 0)).toFixed(2),
    ].map(csvField).join(','))
    const blob = new Blob([[header.map(csvField).join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `orderforge-reorder-list-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const selectClass = 'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500'

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold text-white">Reorder List</h1>
          <Link href="/dashboard/reports" className="text-sm text-indigo-400 hover:text-indigo-300">← Reports</Link>
        </div>
        <p className="text-gray-500 text-sm mb-6">
          What to buy, and how much — based on how fast each item is actually used by orders across every channel.
          Items show up when they&apos;re at their reorder threshold or will run out within the period you plan for.
        </p>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-4 flex flex-wrap items-end gap-4">
          <label className="text-sm text-gray-400">
            <span className="block mb-1">Usage based on the last</span>
            <select value={windowDays} onChange={e => setWindowDays(Number(e.target.value))} className={selectClass}>
              {WINDOW_OPTIONS.map(d => <option key={d} value={d}>{d} days</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-400">
            <span className="block mb-1">Buy enough to last</span>
            <select value={coverDays} onChange={e => { setCoverDays(Number(e.target.value)); setOverrides({}) }} className={selectClass}>
              {COVER_OPTIONS.map(d => <option key={d} value={d}>{d} days</option>)}
            </select>
          </label>
          <div className="ml-auto flex gap-2">
            <button
              onClick={copyList}
              disabled={lines.length === 0}
              className="bg-gray-800 hover:bg-gray-700 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {copied ? 'Copied ✓' : 'Copy list'}
            </button>
            <button
              onClick={downloadCsv}
              disabled={lines.length === 0}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
            >
              Download CSV
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm mb-4">{error}</div>
        )}

        {loading ? (
          <p className="text-gray-400">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 text-gray-400 text-sm">
            Nothing to reorder — no item is at its threshold or on track to run out in the next {coverDays} days.
            Items without a reorder threshold only appear once orders start using them.{' '}
            <Link href="/dashboard/inventory" className="text-indigo-400 hover:text-indigo-300">Manage inventory →</Link>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-gray-400 text-xs uppercase tracking-wide text-left">
                  <th className="px-2 pb-2 font-normal">Item</th>
                  <th className="px-2 pb-2 font-normal text-right">On hand</th>
                  <th className="px-2 pb-2 font-normal text-right">Used / day</th>
                  <th className="px-2 pb-2 font-normal text-right">Runs out</th>
                  <th className="px-2 pb-2 font-normal text-right">Order qty</th>
                  <th className="px-2 pb-2 font-normal text-right">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const u = unitShort(r.item.unit)
                  const qty = qtyFor(r.item.id, r.suggestedQty)
                  const cost = qty * (Number(r.item.unit_cost) || 0)
                  const channelsUsed = Object.entries(r.byChannel).sort((a, b) => b[1] - a[1])
                  const used = channelsUsed.reduce((s, [, n]) => s + n, 0)
                  return (
                    <tr key={r.item.id} className="border-t border-gray-800 align-top">
                      <td className="px-2 py-3">
                        <div className="text-white">
                          {r.item.name}
                          {r.low && (
                            <span className="ml-1.5 text-[10px] uppercase tracking-wide bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded-full">Low</span>
                          )}
                        </div>
                        {r.item.sku && <div className="text-gray-500 text-xs">{r.item.sku}</div>}
                        {used > 0 && (
                          <div className="text-gray-500 text-xs mt-0.5">
                            {channelsUsed.map(([ch, n]) => `${channelLabel(ch)} ${Math.round((n / used) * 100)}%`).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-3 text-right text-white whitespace-nowrap">
                        {formatQty(Number(r.item.quantity) || 0)} <span className="text-gray-500 text-xs">{u}</span>
                      </td>
                      <td className="px-2 py-3 text-right text-gray-300 whitespace-nowrap">
                        {r.dailyRate > 0 ? <>{r.dailyRate.toFixed(r.dailyRate < 10 ? 1 : 0)} <span className="text-gray-500 text-xs">{u}</span></> : '—'}
                      </td>
                      <td className="px-2 py-3 text-right whitespace-nowrap">
                        {r.daysLeft === null
                          ? <span className="text-gray-500">not in use</span>
                          : <span className={r.daysLeft < 7 ? 'text-red-400' : 'text-amber-300'}>
                              {r.daysLeft < 1 ? 'now' : `~${Math.floor(r.daysLeft)} days`}
                            </span>}
                      </td>
                      <td className="px-2 py-3 text-right whitespace-nowrap">
                        <input
                          type="number"
                          min={0}
                          value={overrides[r.item.id] ?? String(r.suggestedQty)}
                          onChange={e => setOverrides(o => ({ ...o, [r.item.id]: e.target.value }))}
                          className="w-24 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-right text-white focus:outline-none focus:border-indigo-500"
                        />{' '}
                        <span className="text-gray-500 text-xs">{u}</span>
                      </td>
                      <td className="px-2 py-3 text-right text-white whitespace-nowrap">
                        {Number(r.item.unit_cost) ? `$${cost.toFixed(2)}` : <span className="text-gray-500">no cost set</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-700">
                  <td colSpan={5} className="px-2 pt-3 text-right text-gray-400">
                    Estimated total{missingCost && <span className="text-gray-500"> (excludes items with no cost set)</span>}
                  </td>
                  <td className="px-2 pt-3 text-right text-white font-semibold">${totalCost.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
