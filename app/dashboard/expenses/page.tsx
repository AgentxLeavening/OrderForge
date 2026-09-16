'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { EXPENSE_CATEGORIES, expenseCategoryLabel, totalExpenses, totalsByCategory } from '@/lib/expenses'

type Expense = {
  id: string
  incurred_on: string
  amount: number
  category: string
  vendor: string | null
  note: string | null
  order_id: string | null
  orders?: { order_number: string } | null
}

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`
const todayLocal = () => new Date().toLocaleDateString('en-CA')
const yearOf = (date: string) => date.slice(0, 4)

export default function ExpensesPage() {
  const router = useRouter()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [categoryFilter, setCategoryFilter] = useState('all')

  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('materials')
  const [vendor, setVendor] = useState('')
  const [incurredOn, setIncurredOn] = useState(todayLocal())
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data, error: loadErr } = await supabase
      .from('expenses')
      .select('id, incurred_on, amount, category, vendor, note, order_id, orders(order_number)')
      .eq('user_id', user.id)
      .order('incurred_on', { ascending: false })
      .order('created_at', { ascending: false })
    if (loadErr) setError(loadErr.message)
    setExpenses((data || []) as unknown as Expense[])
    setLoading(false)
  }, [router])

  useEffect(() => { load() }, [load])

  const years = useMemo(() => {
    const set = new Set(expenses.map(e => yearOf(e.incurred_on)))
    set.add(String(new Date().getFullYear()))
    return [...set].sort().reverse()
  }, [expenses])

  const visible = expenses.filter(e =>
    yearOf(e.incurred_on) === year && (categoryFilter === 'all' || e.category === categoryFilter)
  )
  const yearTotal = totalExpenses(expenses.filter(e => yearOf(e.incurred_on) === year))
  const breakdown = totalsByCategory(expenses.filter(e => yearOf(e.incurred_on) === year))

  const addExpense = async () => {
    const value = Math.round(Number(amount) * 100) / 100
    if (!(value > 0)) { setError('Enter an amount greater than zero.'); return }
    setSaving(true)
    setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not signed in.'); setSaving(false); return }

    const { error: insErr } = await supabase.from('expenses').insert({
      user_id: user.id,
      amount: value,
      category,
      vendor: vendor.trim() || null,
      note: note.trim() || null,
      incurred_on: incurredOn || todayLocal(),
    })
    if (insErr) setError(insErr.message)
    else {
      setAmount(''); setVendor(''); setNote('')
      await load()
    }
    setSaving(false)
  }

  const removeExpense = async (expense: Expense) => {
    if (!confirm(`Delete this ${money(expense.amount)} expense?`)) return
    const { error: delErr } = await supabase.from('expenses').delete().eq('id', expense.id)
    if (delErr) setError(delErr.message)
    else setExpenses(prev => prev.filter(e => e.id !== expense.id))
  }

  const inputClass = 'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500'

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold text-white">Expenses</h1>
          <Link href="/dashboard/reports/tax-export" className="text-sm text-indigo-400 hover:text-indigo-300">Tax export →</Link>
        </div>
        <p className="text-gray-500 text-sm mb-6">
          Money going out: filament, packaging, postage, booth fees, tools, software. Orders already track what comes in.
        </p>

        {/* Add — first thing on the page, because this is a page you come to
            in order to type one line and leave. */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-12 gap-2">
            <input value={amount} onChange={e => setAmount(e.target.value)} type="number" min="0" step="0.01" placeholder="Amount" className={`${inputClass} md:col-span-2 text-right`} />
            <select value={category} onChange={e => setCategory(e.target.value)} className={`${inputClass} md:col-span-3`}>
              {EXPENSE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="Where from" className={`${inputClass} md:col-span-2`} />
            <input type="date" value={incurredOn} onChange={e => setIncurredOn(e.target.value)} className={`${inputClass} md:col-span-2`} />
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" className={`${inputClass} md:col-span-2`} />
            <button onClick={addExpense} disabled={saving} className="col-span-2 md:col-span-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg transition text-sm disabled:opacity-50">
              {saving ? '…' : 'Add'}
            </button>
          </div>
          {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <select value={year} onChange={e => setYear(e.target.value)} className={inputClass}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className={inputClass}>
            <option value="all">All categories</option>
            {EXPENSE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <p className="ml-auto text-gray-400 text-sm">
            {year} total <span className="text-white font-semibold">{money(yearTotal)}</span>
          </p>
        </div>

        {breakdown.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-4">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {breakdown.map(b => (
                <button
                  key={b.category}
                  onClick={() => setCategoryFilter(b.category === categoryFilter ? 'all' : b.category)}
                  className={`text-left ${b.category === categoryFilter ? 'text-indigo-300' : 'text-gray-400 hover:text-white'}`}
                >
                  {b.label} <span className="text-white">{money(b.total)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-gray-400">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 text-gray-400 text-sm">
            Nothing recorded for {year}{categoryFilter === 'all' ? '' : ` in ${expenseCategoryLabel(categoryFilter)}`}.
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2">
            {visible.map(e => (
              <div key={e.id} className="bg-gray-800 rounded-lg px-4 py-3 text-sm flex flex-col gap-1 md:flex-row md:items-center md:gap-4">
                <span className="text-gray-400 md:w-28 shrink-0">{new Date(`${e.incurred_on}T00:00:00`).toLocaleDateString()}</span>
                <span className="text-white md:w-52 shrink-0">{expenseCategoryLabel(e.category)}</span>
                <span className="text-gray-400 flex-1 min-w-0 truncate">
                  {[e.vendor, e.note].filter(Boolean).join(' · ')}
                  {e.orders?.order_number && (
                    <Link href={`/dashboard/orders/${e.order_id}`} className="text-indigo-400 hover:text-indigo-300 ml-2">{e.orders.order_number}</Link>
                  )}
                </span>
                <span className="text-white font-medium md:text-right">{money(e.amount)}</span>
                <button onClick={() => removeExpense(e)} className="text-gray-600 hover:text-red-400 transition text-lg leading-none self-end md:self-auto" aria-label="Delete expense">×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
