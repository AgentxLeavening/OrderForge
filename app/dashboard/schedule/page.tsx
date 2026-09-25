'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { CHANNEL_OPTIONS } from '@/app/components/NewOrderModal'
import OrderTypeIcon from '@/app/components/OrderTypeIcon'
import { dueLabel, groupByDue, type DueBucket, type ScheduleOrder } from '@/lib/schedule'

type Order = ScheduleOrder & {
  type: string
  client_id: string | null
  buyer_name: string | null
  sales_channel: string | null
  clients?: { name: string }[] | null
}

const STATUS_LABELS: Record<string, string> = {
  inquiry: 'Inquiry', quoted: 'Quoted', in_progress: 'In Progress', shipped: 'Shipped',
}

// Sections in the order a maker would work through them.
const SECTIONS: { key: DueBucket; title: string; hint: string; tone: string }[] = [
  { key: 'overdue', title: 'Late', hint: 'Past their due date and not finished', tone: 'text-red-400' },
  { key: 'today', title: 'Due today', hint: '', tone: 'text-amber-300' },
  { key: 'this_week', title: 'Next 7 days', hint: '', tone: 'text-white' },
  { key: 'later', title: 'Later', hint: '', tone: 'text-gray-300' },
  { key: 'no_date', title: 'No due date', hint: 'Give these a date to see them in the plan', tone: 'text-gray-400' },
]

const channelLabel = (value: string | null) =>
  CHANNEL_OPTIONS.find(o => o.value === (value || ''))?.label ?? value ?? ''

export default function SchedulePage() {
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data } = await supabase
      .from('orders')
      .select('id, title, status, order_number, due_date, type, client_id, buyer_name, sales_channel, clients(name)')
      .eq('user_id', user.id)
      .not('status', 'in', '("complete","cancelled")')
      .order('due_date', { ascending: true, nullsFirst: false })
    setOrders((data || []) as Order[])
    setLoading(false)
  }, [router])

  useEffect(() => { load() }, [load])

  // Editing the date here is the point of the page: triage a pile of undated
  // work without opening each order.
  const setDueDate = async (orderId: string, value: string) => {
    setSaving(orderId)
    const due = value || null
    setOrders(prev => prev.map(o => (o.id === orderId ? { ...o, due_date: due } : o)))
    const { error } = await supabase.from('orders').update({ due_date: due, updated_at: new Date().toISOString() }).eq('id', orderId)
    if (error) await load()
    setSaving(null)
  }

  const groups = groupByDue(orders)

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold text-white">Schedule</h1>
          <Link href="/dashboard" className="text-sm text-indigo-400 hover:text-indigo-300">← Dashboard</Link>
        </div>
        <p className="text-gray-500 text-sm mb-6">
          Every unfinished order by when it&apos;s due. Set a date on any row — it saves straight away.
        </p>

        {loading ? (
          <p className="text-gray-400">Loading…</p>
        ) : orders.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 text-gray-400 text-sm">
            Nothing open right now. Orders appear here until they&apos;re Complete or Cancelled.
          </div>
        ) : (
          <div className="space-y-6">
            {SECTIONS.map(section => {
              const rows = groups[section.key]
              if (rows.length === 0) return null
              return (
                <div key={section.key} className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                  <div className="flex items-baseline gap-3 mb-3">
                    <h2 className={`font-semibold ${section.tone}`}>{section.title}</h2>
                    <span className="text-gray-600 text-sm">{rows.length}</span>
                    {section.hint && <span className="text-gray-600 text-xs ml-auto">{section.hint}</span>}
                  </div>

                  <div className="space-y-2">
                    {rows.map(row => {
                      const order = orders.find(o => o.id === row.id)!
                      const clientName = Array.isArray(order.clients) ? order.clients[0]?.name : undefined
                      return (
                        <div key={order.id} className="flex flex-wrap items-center gap-3 bg-gray-800 rounded-xl px-4 py-3">
                          <OrderTypeIcon type={order.type} className="text-base shrink-0" />
                          <Link href={`/dashboard/orders/${order.id}`} className="min-w-0 flex-1">
                            <p className="text-white text-sm font-medium truncate hover:text-indigo-300 transition">{order.title}</p>
                            <p className="text-gray-500 text-xs truncate">
                              {order.order_number}
                              {clientName ? ` · ${clientName}` : order.buyer_name ? ` · ${order.buyer_name}` : ''}
                              {order.sales_channel ? ` · ${channelLabel(order.sales_channel)}` : ''}
                            </p>
                          </Link>
                          <span className="text-xs bg-gray-900 text-gray-400 px-2 py-1 rounded-full shrink-0">
                            {STATUS_LABELS[order.status] || order.status}
                          </span>
                          <span className={`text-xs shrink-0 w-24 text-right ${section.key === 'overdue' ? 'text-red-400' : section.key === 'today' ? 'text-amber-300' : 'text-gray-400'}`}>
                            {dueLabel(order.due_date)}
                          </span>
                          <input
                            type="date"
                            value={order.due_date || ''}
                            onChange={e => setDueDate(order.id, e.target.value)}
                            disabled={saving === order.id}
                            className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
