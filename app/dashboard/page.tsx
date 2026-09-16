'use client'

import { useEffect, useState, useCallback, type MouseEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import NewOrderModal, { CHANNEL_OPTIONS } from '@/app/components/NewOrderModal'
import DashboardWidget from '@/app/components/DashboardWidget'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { isLowStock, unitShort } from '@/lib/inventory'
import { computeOrderEconomics } from '@/lib/pricing'
import { amountDue, isOwed, summarizePayments, type BillableLine, type PaymentRecord } from '@/lib/payments'
import { daysUntilDue, dueLabel, groupByDue } from '@/lib/schedule'
import Link from 'next/link'

type OwedOrder = {
  id: string
  title: string
  balance: number
  partial: boolean // a deposit has been taken
}

type LowStockItem = {
  id: string
  name: string
  quantity: number
  unit?: string | null
  reorder_threshold: number
}

type Profile = {
  id: string
  name: string
  business_name: string
  plan: string
  dashboard_layout?: string[]
}

type ClientOption = {
  id: string
  name: string
}

type Order = {
  id: string
  title: string
  type: string
  status: string
  order_number: string
  due_date: string | null
  notes: string | null
  created_at: string
  client_id: string | null
  sales_channel: string | null
  buyer_name?: string | null
  suggested_price?: number | null
  material_cost?: number | null
  labor_cost?: number | null
  fee_pct?: number | null
  estimated_shipping?: number | null
  shipping_buyer_covered?: boolean
  external_source?: string | null
  clients?: {
    name: string
    id?: string
  }[] | null
}

const channelLabel = (value: string | null | undefined) =>
  CHANNEL_OPTIONS.find(o => o.value === (value || ''))?.label ?? (value || 'Not specified')

const COLUMNS = [
  { key: 'inquiry', label: 'Inquiry' },
  { key: 'quoted', label: 'Quoted' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'complete', label: 'Complete' },
  { key: 'cancelled', label: 'Cancelled' },
]

// The board proper is only the statuses with work left in them. Complete and
// Cancelled are finished states that accumulate forever — as full columns they
// ate a third of the board's width to show orders nobody needs to look at, so
// they live as collapsible sections beneath it instead. They stay drop targets
// (see the archive Droppables, which accept a drop even while collapsed),
// because dragging into Complete is exactly how an order gets there.
const ARCHIVE_STATUSES = ['complete', 'cancelled']
const ACTIVE_COLUMNS = COLUMNS.filter(c => !ARCHIVE_STATUSES.includes(c.key))
const ARCHIVE_COLUMNS = COLUMNS.filter(c => ARCHIVE_STATUSES.includes(c.key))

const TYPE_EMOJI: Record<string, string> = {
  commission: '🎨',
  print_job: '🖨️',
  card_lot: '🃏',
  wholesale: '📦',
  other: '📋',
}

const DEFAULT_LAYOUT = ['stats', 'kanban', 'analytics']

export default function DashboardPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [clients, setClients] = useState<ClientOption[]>([])
  const [topRevenueClients, setTopRevenueClients] = useState<{ name: string; total: number }[]>([])
  const [invoiceCounts, setInvoiceCounts] = useState<{ name: string; count: number }[]>([])
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([])
  const [owedOrders, setOwedOrders] = useState<OwedOrder[]>([])
  const [selectedClientId, setSelectedClientId] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [layout, setLayout] = useState<string[]>(DEFAULT_LAYOUT)
  const [savingLayout, setSavingLayout] = useState(false)
  // Kanban cards start collapsed — with marketplace orders importing, a column
  // like Shipped gets long enough that full cards make the board unusable to
  // scroll or drag across. Expansion is per-card and lasts for the session
  // only; it's a "let me peek at this one" gesture, not a saved preference.
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set())
  // Which archive sections (Complete / Cancelled) are open. Both start shut —
  // the point of moving them off the board is not having to look at them.
  const [openArchive, setOpenArchive] = useState<Set<string>>(new Set())

  const fetchOrders = useCallback(async (userId: string, clientList: ClientOption[]) => {
    const { data } = await supabase
      .from('orders')
      .select('*, clients(name)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    const ordersData = (data || []) as Order[]
    setOrders(ordersData)

    // Compute revenue per client from order_items (sum qty * unit_price per order)
    const orderIds = ordersData.map(o => o.id)
    const revenueByClient: Record<string, number> = {}
    const invoiceCountByClient: Record<string, number> = {}

    const orderTotals: Record<string, number> = {}
    const itemsByOrder: Record<string, BillableLine[]> = {}
    if (orderIds.length > 0) {
      const { data: items } = await supabase
        .from('order_items')
        .select('order_id, quantity, unit_price, item_type, buyer_covered')
        .in('order_id', orderIds)

      const itemList = (items || []) as ({ order_id: string; quantity: number; unit_price: number } & BillableLine)[]
      itemList.forEach(it => { (itemsByOrder[it.order_id] ||= []).push(it) })

      itemList.forEach(it => {
        const lineTotal = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0)
        orderTotals[it.order_id] = (orderTotals[it.order_id] || 0) + lineTotal
      })

      // Map order totals to client revenue (cancelled orders never billed)
      ordersData.filter(o => o.status !== 'cancelled').forEach(o => {
        const clientName = o.client_id
          ? (clientList.find(c => c.id === o.client_id)?.name || 'Unassigned')
          : 'Unassigned'
        const amt = orderTotals[o.id] || 0
        revenueByClient[clientName] = (revenueByClient[clientName] || 0) + amt
      })
    }

    // Use invoices table to compute invoice counts per client (one invoice may exist per order)
    const { data: invoices } = await supabase
      .from('invoices')
      .select('id, order_id, total, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })

    const invoiceList = (invoices || []) as { id: string; order_id: string; total: number | null; created_at: string }[]

    // Payment balances, using the same rules as the order page's Payments card
    // (lib/payments.ts). Ascending order above means the last write per order
    // wins, i.e. the latest invoice / most recently accepted quote.
    const [{ data: acceptedQuotes }, { data: payments }] = await Promise.all([
      supabase.from('quotes').select('order_id, snapshot, responded_at')
        .eq('user_id', userId).eq('status', 'accepted').order('responded_at', { ascending: true }),
      supabase.from('order_payments').select('order_id, amount, kind').eq('user_id', userId),
    ])
    const invoiceTotalByOrder: Record<string, number | null> = {}
    invoiceList.forEach(inv => { invoiceTotalByOrder[inv.order_id] = inv.total })
    const quoteTotalByOrder: Record<string, number | null> = {}
    ;(acceptedQuotes || []).forEach(q => {
      quoteTotalByOrder[q.order_id] = (q.snapshot as { total?: number } | null)?.total ?? null
    })
    const paymentsByOrder: Record<string, PaymentRecord[]> = {}
    ;(payments || []).forEach(p => { (paymentsByOrder[p.order_id] ||= []).push(p) })

    const owed: OwedOrder[] = []
    ordersData.forEach(o => {
      if (o.external_source) return
      const due = amountDue({
        lineItems: itemsByOrder[o.id] || [],
        latestInvoiceTotal: invoiceTotalByOrder[o.id],
        acceptedQuoteTotal: quoteTotalByOrder[o.id],
      })
      const summary = summarizePayments({ due: due.amount, payments: paymentsByOrder[o.id] || [], isMarketplace: false })
      if (isOwed(summary, o.status)) owed.push({ id: o.id, title: o.title, balance: summary.balance, partial: summary.status === 'partial' })
    })
    setOwedOrders(owed.sort((a, b) => b.balance - a.balance))
    invoiceList.forEach(inv => {
      const order = ordersData.find(o => o.id === inv.order_id)
      const clientName = order?.client_id
        ? (clientList.find(c => c.id === order.client_id)?.name || 'Unassigned')
        : 'Unassigned'
      invoiceCountByClient[clientName] = (invoiceCountByClient[clientName] || 0) + 1
    })

    setTopRevenueClients(Object.entries(revenueByClient)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, total]) => ({ name, total }))
    )

    setInvoiceCounts(Object.entries(invoiceCountByClient)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }))
    )
  }, [])

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data } = await supabase
        .from('profiles')
        .select('id, name, business_name, plan, dashboard_layout')
        .eq('id', user.id)
        .single()

      const { data: clientData } = await supabase
        .from('clients')
        .select('id, name')
        .eq('user_id', user.id)
        .order('name', { ascending: true })

      const { data: inventory } = await supabase
        .from('inventory_items')
        .select('id, name, quantity, unit, reorder_threshold')
        .eq('user_id', user.id)

      setProfile(data)
      setLayout(data?.dashboard_layout || DEFAULT_LAYOUT)
      setClients(clientData || [])
      setLowStockItems(((inventory || []) as LowStockItem[]).filter(isLowStock))
      await fetchOrders(user.id, clientData || [])
      setLoading(false)
    }
    init()
  }, [router, fetchOrders])

  const onDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result
    if (!destination) return
    if (destination.droppableId === source.droppableId) return

    const newStatus = destination.droppableId

    // Cancelled still confirms: it restocks materials, and undoing that means
    // fixing inventory by hand. Complete used to confirm as well — it's also a
    // one-way door for marketplace syncs (see syncProviderOrders' status-rank
    // guard) — but completing orders is routine and the prompt got in the way
    // of clearing a board. Dragging an order back out of Complete costs
    // nothing, so the warning wasn't worth the friction.
    if (newStatus === 'cancelled') {
      if (!confirm('Cancel this order?\n\nThis restocks any materials it deducted, and future marketplace syncs won\'t move it out of Cancelled automatically.')) return
    }

    // Optimistic update
    setOrders(prev =>
      prev.map(o => o.id === draggableId ? { ...o, status: newStatus } : o)
    )

    // Persist to Supabase
    await supabase
      .from('orders')
      .update({ status: newStatus })
      .eq('id', draggableId)

    // Dropping into Cancelled restocks any materials this order deducted.
    // The RPC is idempotent, so re-dropping (or later deleting) is safe.
    if (newStatus === 'cancelled') {
      const { error: restockErr } = await supabase.rpc('restock_inventory_for_order', {
        p_order_id: draggableId,
        p_reason: 'order_cancelled_restock',
      })
      if (restockErr) console.warn('Failed restocking cancelled order', restockErr)
    }
  }

  // Widget layout drag and drop
  const onLayoutDragEnd = async (result: DropResult) => {
    const { destination, source } = result
    if (!destination || destination.index === source.index) return

    const newLayout = Array.from(layout)
    const [moved] = newLayout.splice(source.index, 1)
    newLayout.splice(destination.index, 0, moved)

    setLayout(newLayout)
    setSavingLayout(true)

    await supabase
      .from('profiles')
      .update({ dashboard_layout: newLayout })
      .eq('id', profile?.id)

    setSavingLayout(false)
  }

  const filteredOrders = orders.filter(order => {
    const matchesClient = selectedClientId === 'all' || order.client_id === selectedClientId
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter
    const normalizedSearch = searchTerm.trim().toLowerCase()

    const clientName = Array.isArray(order.clients) ? order.clients[0]?.name || '' : (order.clients && (order.clients as { name?: string }).name) || ''

    const searchableValues = [
      order.title,
      order.order_number,
      clientName,
      order.buyer_name || '',
      order.sales_channel ? channelLabel(order.sales_channel) : '',
      ...(clientName ? clientName.split(/\s+/) : []),
    ]

    const matchesSearch = !normalizedSearch || searchableValues.some(value => {
      const normalizedValue = value.trim().toLowerCase()
      if (!normalizedValue) return false

      const words = normalizedValue.split(/\s+/)
      return words.some(word => word.startsWith(normalizedSearch))
        || normalizedValue.startsWith(normalizedSearch)
        || normalizedValue.includes(normalizedSearch)
    })

    return matchesClient && matchesStatus && matchesSearch
  })

  const activeOrders = filteredOrders.filter(o => o.status !== 'complete' && o.status !== 'cancelled').length
  const clientCount = new Set(filteredOrders.map(order => order.client_id).filter(Boolean)).size
  const clientCountsMap = filteredOrders.reduce((acc: Record<string, number>, o) => {
    const name = Array.isArray(o.clients)
      ? o.clients[0]?.name || 'Unassigned'
      : (o.clients && (o.clients as { name?: string }).name) || 'Unassigned'
    if (!name) return acc
    acc[name] = (acc[name] || 0) + 1
    return acc
  }, {})

  const topClients = Object.entries(clientCountsMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => ({ name, count }))
  // Prepare data for orders-per-client chart (top 5) with client ids
  const ordersPerClientTop = (() => {
    const map: Record<string, { name: string; count: number }> = {}
    filteredOrders.forEach(o => {
      const clientId = o.client_id || 'unassigned'
      const name = Array.isArray(o.clients)
        ? o.clients[0]?.name || 'Unassigned'
        : (o.clients && (o.clients as { name?: string }).name) || 'Unassigned'
      if (!map[clientId]) map[clientId] = { name, count: 0 }
      map[clientId].count += 1
    })

    return Object.entries(map)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([clientId, v]) => ({ clientId, name: v.name, count: v.count }))
  })()
  // Profit / margin economics from the persisted pricing breakdown — shared
  // formula (lib/pricing.ts) with the order-detail "Pricing & Margin" card,
  // so the two can never drift out of sync again. Computed from persisted
  // fields rather than order_items line totals, whose unit_price is the cost
  // basis for template-created orders and so would understate revenue.
  const pricedOrders = filteredOrders
    .filter(o => o.status !== 'cancelled')
    .map(o => {
      if (o.suggested_price == null && o.material_cost == null) return null
      const { revenue, cost, feeAmt, profit } = computeOrderEconomics(o)
      return { order: o, price: revenue, cost, feeAmt, profit }
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)

  const totalRevenue = pricedOrders.reduce((s, e) => s + e.price, 0)
  const totalProfit = pricedOrders.reduce((s, e) => s + e.profit, 0)
  const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0

  const topProfitClients = (() => {
    const map: Record<string, { name: string; profit: number }> = {}
    pricedOrders.forEach(({ order, profit }) => {
      const clientId = order.client_id || 'unassigned'
      const name = Array.isArray(order.clients)
        ? order.clients[0]?.name || 'Unassigned'
        : (order.clients && (order.clients as { name?: string }).name) || 'Unassigned'
      if (!map[clientId]) map[clientId] = { name, profit: 0 }
      map[clientId].profit += profit
    })
    return Object.values(map).sort((a, b) => b.profit - a.profit).slice(0, 3)
  })()

  const channelProfit = (() => {
    const map: Record<string, { revenue: number; profit: number; count: number }> = {}
    pricedOrders.forEach(({ order, price, profit }) => {
      const label = channelLabel(order.sales_channel)
      if (!map[label]) map[label] = { revenue: 0, profit: 0, count: 0 }
      map[label].revenue += price
      map[label].profit += profit
      map[label].count += 1
    })
    return Object.entries(map)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.profit - a.profit || b.count - a.count)
  })()

  // Kept in step with lib/schedule.ts: a "YYYY-MM-DD" date column parsed by
  // `new Date()` is UTC midnight, which reads as yesterday in the Americas —
  // an order due today would show as overdue.
  const isOverdue = (due: string | null) => !!due && (daysUntilDue(due) ?? 0) < 0

  // Widget render helpers
  const renderStats = () => (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
      {[
        { label: 'Active Orders', value: activeOrders },
        { label: 'Orders in View', value: filteredOrders.length },
        { label: 'Clients in View', value: clientCount },
      ].map(stat => (
        <div key={stat.label} className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <p className="text-gray-400 text-sm mb-1">{stat.label}</p>
          <p className="text-white text-2xl font-bold break-words">{stat.value}</p>
        </div>
      ))}
    </div>
  )

  const renderAnalytics = () => (
    <div className="grid grid-cols-1 gap-6">
      {/* Money summary — based on the persisted pricing breakdown (priced orders only) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Est. Revenue', value: `$${totalRevenue.toFixed(2)}`, tone: 'text-white' },
          {
            label: 'Est. Profit',
            value: `$${totalProfit.toFixed(2)}`,
            tone: totalProfit >= 0 ? 'text-green-400' : 'text-red-400',
          },
          { label: 'Avg. Margin', value: `${avgMargin.toFixed(0)}%`, tone: 'text-white' },
        ].map(stat => (
          <div key={stat.label} className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <p className="text-gray-400 text-sm mb-1">{stat.label}</p>
            <p className={`text-2xl font-bold break-words ${stat.tone}`}>{stat.value}</p>
          </div>
        ))}
      </div>
      {pricedOrders.length === 0 && (
        <p className="text-gray-500 text-xs -mt-2">
          Profit figures cover orders with a saved price breakdown. Create orders from a product template to populate them.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <p className="text-gray-400 text-sm mb-2">Top Clients (by orders)</p>
          {topClients.length > 0 ? (
            <ol className="space-y-2">
              {topClients.map((c, i) => (
                <li key={c.name} className="flex items-center justify-between">
                  <span className="text-white">{i + 1}. {c.name}</span>
                  <span className="text-gray-400 text-sm">{c.count} orders</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-gray-400">No client data in current view.</p>
          )}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <p className="text-gray-400 text-sm mb-2">Top Clients (by revenue)</p>
          {topRevenueClients.length > 0 ? (
            <ol className="space-y-2">
              {topRevenueClients.map((c, i) => (
                <li key={c.name} className="flex items-center justify-between">
                  <span className="text-white">{i + 1}. {c.name}</span>
                  <span className="text-gray-400 text-sm">${c.total.toFixed(2)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-gray-400">No revenue data in current view.</p>
          )}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <p className="text-gray-400 text-sm mb-2">Top Clients (by profit)</p>
          {topProfitClients.length > 0 ? (
            <ol className="space-y-2">
              {topProfitClients.map((c, i) => (
                <li key={c.name} className="flex items-center justify-between">
                  <span className="text-white">{i + 1}. {c.name}</span>
                  <span className={`text-sm ${c.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>${c.profit.toFixed(2)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-gray-400">No profit data in current view.</p>
          )}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <p className="text-gray-400 text-sm mb-2">Invoice Counts</p>
          {invoiceCounts.length > 0 ? (
            <ol className="space-y-2">
              {invoiceCounts.map(c => (
                <li key={c.name} className="flex items-center justify-between">
                  <span className="text-white">{c.name}</span>
                  <span className="text-gray-400 text-sm">{c.count}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-gray-400">No invoices in current view.</p>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-gray-200 font-semibold mb-3">Sales by Channel</h3>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          {channelProfit.length > 0 ? (
            <ol className="space-y-2">
              {channelProfit.map(c => (
                <li key={c.name} className="flex items-center justify-between gap-4">
                  <span className="text-white">{c.name}</span>
                  <span className="text-gray-400 text-sm text-right">
                    {c.count} {c.count === 1 ? 'order' : 'orders'} · ${c.revenue.toFixed(2)} rev ·{' '}
                    <span className={c.profit >= 0 ? 'text-green-400' : 'text-red-400'}>${c.profit.toFixed(2)} profit</span>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-gray-400">No priced orders in current view.</p>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-gray-200 font-semibold mb-3">Orders Per Client</h3>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          {ordersPerClientTop.length > 0 ? (
            <div className="w-full overflow-x-auto">
              <svg viewBox={`0 0 500 160`} width="100%" height="160" preserveAspectRatio="xMinYMid meet">
                {(() => {
                  const paddingLeft = 120
                  const chartWidth = 500 - paddingLeft - 20
                  const max = Math.max(...ordersPerClientTop.map(d => d.count), 1)
                  const barHeight = 22
                  const gap = 12
                  return ordersPerClientTop.map((d, i) => {
                    const y = i * (barHeight + gap) + 10
                    const barW = Math.round((d.count / max) * chartWidth)
                    const fill = selectedClientId === d.clientId ? '#7c3aed' : '#4f46e5'
                    const revenue = topRevenueClients.find(t => t.name === d.name)?.total || 0
                    const tooltip = `${d.name}: ${d.count} orders${revenue ? ` — $${revenue.toFixed(2)}` : ''}`
                    return (
                      <g
                        key={d.clientId}
                        onClick={() => {
                          setSelectedClientId(d.clientId === 'unassigned' ? 'all' : d.clientId)
                          setSearchTerm('')
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <title>{tooltip}</title>
                        <text x={10} y={y + 15} fill="#e5e7eb" fontSize={12}>{d.name}</text>
                        <rect x={paddingLeft} y={y} width={barW} height={barHeight} rx={6} fill={fill} style={{ transition: 'width 320ms ease, fill 180ms ease' }} />
                        <text x={paddingLeft + barW + 8} y={y + 15} fill="#9ca3af" fontSize={12}>{d.count}</text>

                        {selectedClientId === d.clientId && selectedClientId !== 'all' && (
                          <g
                            onClick={(e: MouseEvent) => {
                              e.stopPropagation()
                              setSelectedClientId('all')
                              setSearchTerm('')
                            }}
                            style={{ cursor: 'pointer' }}
                          >
                            <circle cx={paddingLeft + barW + 28} cy={y + barHeight / 2} r={9} fill="#ef4444" />
                            <text x={paddingLeft + barW + 28} y={y + barHeight / 2 + 4} fill="#fff" fontSize={10} textAnchor="middle">×</text>
                          </g>
                        )}
                      </g>
                    )
                  })
                })()}
              </svg>
            </div>
          ) : (
            <p className="text-gray-400">No orders to chart in current view.</p>
          )}
        </div>
      </div>
    </div>
  )

  const toggleOrderExpanded = (orderId: string) => {
    setExpandedOrders(prev => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  // Bulk version behind each column's expand/collapse-all control. Scoped to
  // the ids passed in rather than clearing the whole set, so expanding one
  // column doesn't collapse what's open in another.
  const setOrdersExpanded = (orderIds: string[], expanded: boolean) => {
    setExpandedOrders(prev => {
      const next = new Set(prev)
      for (const id of orderIds) {
        if (expanded) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  const toggleArchiveSection = (statusKey: string) => {
    setOpenArchive(prev => {
      const next = new Set(prev)
      if (next.has(statusKey)) next.delete(statusKey)
      else next.add(statusKey)
      return next
    })
  }

  // One card, used by both the board columns and the archive sections below.
  const owedById = new Map(owedOrders.map(o => [o.id, o]))

  const renderOrderCard = (order: Order, index: number) => {
    const clientName = Array.isArray(order.clients)
      ? order.clients[0]?.name || ''
      : (order.clients && (order.clients as { name?: string }).name) || ''
    const clientIdLocal = order.client_id || ''
    const isExpanded = expandedOrders.has(order.id)

    return (
      <Draggable key={order.id} draggableId={order.id} index={index}>
        {(provided, snapshot) => (
          <div
            onClick={() => router.push(`/dashboard/orders/${order.id}`)}
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            className={`bg-gray-800 border rounded-xl transition cursor-grab active:cursor-grabbing ${
              isExpanded ? 'p-4' : 'px-3 py-2.5'
            } ${
              snapshot.isDragging
                ? 'border-indigo-500 shadow-lg shadow-indigo-500/20 rotate-1'
                : 'border-gray-700 hover:border-indigo-500'
            }`}
          >
            {/* Always-visible row: at-a-glance identity, plus the
                expander. Collapsed, this is the whole card. */}
            <div className="flex items-center gap-2">
              <span className="text-base shrink-0">{TYPE_EMOJI[order.type] || '📋'}</span>

              <div className="min-w-0 flex-1">
                <p className="text-white text-sm font-medium leading-snug truncate">{order.title}</p>
                <div className="flex items-center gap-2 text-[11px] leading-tight">
                  <span className="text-gray-500 font-mono truncate">{order.order_number}</span>
                  {owedById.has(order.id) && (
                    <span className="shrink-0 text-emerald-400">Owes ${owedById.get(order.id)!.balance.toFixed(2)}</span>
                  )}
                  {order.due_date && (
                    <span className={`shrink-0 ${isOverdue(order.due_date) ? 'text-red-400' : 'text-gray-500'}`}>
                      Due {new Date(order.due_date).toLocaleDateString()}
                      {isOverdue(order.due_date) && ' ⚠️'}
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                aria-expanded={isExpanded}
                aria-label={isExpanded ? `Hide details for ${order.order_number}` : `Show details for ${order.order_number}`}
                // stopPropagation on click keeps the card's own
                // onClick from navigating to the order; on mousedown
                // it stops dnd treating a press here as a drag.
                onClick={e => { e.stopPropagation(); toggleOrderExpanded(order.id) }}
                onMouseDown={e => e.stopPropagation()}
                className="shrink-0 -mr-1 p-1 rounded text-gray-500 hover:text-white hover:bg-gray-700 transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                >
                  <polyline points="5,8 10,13 15,8" />
                </svg>
              </button>
            </div>

            {isExpanded && (
              <div className="mt-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {clientName ? (
                    clientIdLocal ? (
                      <Link
                        href={`/dashboard/clients/${clientIdLocal}`}
                        onClick={e => e.stopPropagation()}
                        className="text-xs bg-gray-900 text-gray-300 px-2 py-1 rounded-full hover:bg-indigo-500 hover:text-white transition"
                      >
                        {clientName}
                      </Link>
                    ) : (
                      <span className="text-xs bg-gray-900 text-gray-300 px-2 py-1 rounded-full">{clientName}</span>
                    )
                  ) : order.buyer_name ? (
                    <span className="text-xs bg-gray-900 text-gray-300 px-2 py-1 rounded-full">🛒 {order.buyer_name}</span>
                  ) : (
                    <span className="text-xs text-gray-400">Unassigned</span>
                  )}
                  {order.sales_channel && (
                    <span className="text-xs bg-indigo-500/15 text-indigo-300 px-2 py-0.5 rounded-full">{channelLabel(order.sales_channel)}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </Draggable>
    )
  }

  const renderKanban = () => (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {ACTIVE_COLUMNS.map(col => {
          const colOrders = filteredOrders.filter(o => o.status === col.key)
          const colOrderIds = colOrders.map(o => o.id)
          const allExpanded = colOrderIds.length > 0 && colOrderIds.every(id => expandedOrders.has(id))
          return (
            // flex column + a flex-1 Droppable below, so the drop target fills
            // the whole column instead of hugging its cards. Grid items stretch
            // to the tallest column, so without this a short column (Complete)
            // renders tall but only accepts drops in the top few inches —
            // impossible to use once a long column (Shipped) sets the height.
            <div key={col.key} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex flex-col">
              {/* Column Header */}
              <div className="flex items-center justify-between gap-1 mb-4">
                <h2 className="text-white font-semibold truncate">{col.label}</h2>
                {colOrderIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setOrdersExpanded(colOrderIds, !allExpanded)}
                    aria-label={allExpanded ? `Collapse all ${col.label} orders` : `Expand all ${col.label} orders`}
                    title={allExpanded ? 'Collapse all' : 'Expand all'}
                    className="ml-auto shrink-0 p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800 transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {/* Chevrons apart = will expand; pointing together = will
                        collapse. Stroked polylines rather than fill paths so the
                        two states are unmistakably different shapes. */}
                    <svg
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="w-4 h-4"
                    >
                      {allExpanded ? (
                        <>
                          <polyline points="6,4 10,8 14,4" />
                          <polyline points="6,16 10,12 14,16" />
                        </>
                      ) : (
                        <>
                          <polyline points="6,8 10,4 14,8" />
                          <polyline points="6,12 10,16 14,12" />
                        </>
                      )}
                    </svg>
                  </button>
                )}
                <span className="shrink-0 bg-gray-800 text-gray-400 text-xs font-bold px-2 py-1 rounded-full">
                  {colOrders.length}
                </span>
              </div>

              {/* Droppable Column */}
              <Droppable droppableId={col.key}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`space-y-3 min-h-24 flex-1 rounded-xl transition ${
                      snapshot.isDraggingOver ? 'bg-indigo-500/10 border border-indigo-500/30' : ''
                    }`}
                  >
                    {colOrders.length === 0 && !snapshot.isDraggingOver && (
                      <p className="text-gray-600 text-sm text-center py-6">No orders</p>
                    )}

                    {colOrders.map(renderOrderCard)}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          )
        })}
      </div>

      {/* Finished states, stacked below the board: Complete, then Cancelled. */}
      <div className="flex flex-col gap-4 mt-4">
        {ARCHIVE_COLUMNS.map(col => {
          const colOrders = filteredOrders.filter(o => o.status === col.key)
          const isOpen = openArchive.has(col.key)

          return (
            <div key={col.key} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <button
                type="button"
                onClick={() => toggleArchiveSection(col.key)}
                aria-expanded={isOpen}
                className="w-full flex items-center gap-3 text-left rounded-lg cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className={`w-4 h-4 shrink-0 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                >
                  <polyline points="5,8 10,13 15,8" />
                </svg>
                <h2 className="text-white font-semibold">{col.label}</h2>
                <span className="bg-gray-800 text-gray-400 text-xs font-bold px-2 py-1 rounded-full">
                  {colOrders.length}
                </span>
                <span className="ml-auto text-gray-600 text-xs">
                  {isOpen ? 'Hide' : colOrders.length === 1 ? 'Show 1 order' : `Show ${colOrders.length} orders`}
                </span>
              </button>

              {/* Stays a Droppable even while collapsed, so an order can still
                  be dragged in — the strip under the header is the target, and
                  it highlights on drag-over. Without this, closing the section
                  would make Complete unreachable by drag, which is the only
                  way an order gets there. */}
              <Droppable droppableId={col.key}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`rounded-xl transition ${isOpen ? 'mt-4 space-y-2' : 'mt-2'} ${
                      snapshot.isDraggingOver
                        ? 'bg-indigo-500/10 border border-dashed border-indigo-500/40 min-h-16'
                        : isOpen ? '' : 'min-h-2'
                    }`}
                  >
                    {isOpen && colOrders.length === 0 && !snapshot.isDraggingOver && (
                      <p className="text-gray-600 text-sm py-4">No orders</p>
                    )}
                    {isOpen && colOrders.map(renderOrderCard)}
                    {!isOpen && snapshot.isDraggingOver && (
                      <p className="text-indigo-300 text-xs text-center py-5">Drop to mark {col.label}</p>
                    )}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          )
        })}
      </div>
    </DragDropContext>
  )

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <main className="max-w-7xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold text-white">Hey, {profile?.name || 'there'} 👋</h1>
            <p className="text-gray-400 mt-1">Here is what is going on with your orders.</p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={selectedClientId}
              onChange={e => setSelectedClientId(e.target.value)}
              className="bg-gray-900 border border-gray-800 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All clients</option>
              {clients.map(client => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>

            <button
              onClick={() => setShowModal(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-5 py-3 rounded-lg transition"
            >
              + New Order
            </button>
          </div>
        </div>

        {/* Low-stock alert */}
        {lowStockItems.length > 0 && (
          <div className="mb-8 bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <p className="text-amber-300 font-semibold">
                  ⚠️ Low stock · {lowStockItems.length} {lowStockItems.length === 1 ? 'item' : 'items'}
                </p>
                <p className="text-amber-200/70 text-sm mt-0.5">
                  {lowStockItems.slice(0, 4).map(i => `${i.name} (${i.quantity} ${unitShort(i.unit)})`).join(', ')}
                  {lowStockItems.length > 4 && ` +${lowStockItems.length - 4} more`}
                </p>
              </div>
              <div className="flex gap-4">
                <Link
                  href="/dashboard/inventory"
                  className="text-amber-300 hover:text-amber-200 text-sm font-medium whitespace-nowrap"
                >
                  Manage inventory →
                </Link>
                <Link
                  href="/dashboard/reports/reorder"
                  className="text-amber-300 hover:text-amber-200 text-sm font-medium whitespace-nowrap"
                >
                  Reorder list →
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Due soon — late work first, then today, then the next seven days.
            Finished and cancelled orders never appear (see groupByDue). */}
        {(() => {
          const groups = groupByDue(orders)
          const soon = [...groups.overdue, ...groups.today, ...groups.this_week]
          if (soon.length === 0) return null
          return (
            <div className="mb-8 bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <p className="text-white font-semibold">
                  🗓️ Due soon · {soon.length} {soon.length === 1 ? 'order' : 'orders'}
                  {groups.overdue.length > 0 && (
                    <span className="text-red-400 font-normal"> · {groups.overdue.length} late</span>
                  )}
                </p>
                <Link href="/dashboard/schedule" className="text-indigo-400 hover:text-indigo-300 text-sm font-medium whitespace-nowrap">
                  Schedule →
                </Link>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm">
                {soon.slice(0, 5).map(o => (
                  <Link key={o.id} href={`/dashboard/orders/${o.id}`} className="text-gray-400 hover:text-white">
                    {o.title} — <span className={groups.overdue.some(x => x.id === o.id) ? 'text-red-400' : 'text-gray-500'}>{dueLabel(o.due_date)}</span>
                  </Link>
                ))}
                {soon.length > 5 && <span className="text-gray-600">+{soon.length - 5} more</span>}
              </div>
            </div>
          )
        })()}

        {/* Money owed — orders with an unpaid balance (see isOwed in lib/payments.ts) */}
        {owedOrders.length > 0 && (
          <div className="mb-8 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4">
            <p className="text-emerald-300 font-semibold">
              💵 ${owedOrders.reduce((s, o) => s + o.balance, 0).toFixed(2)} owed to you · {owedOrders.length} {owedOrders.length === 1 ? 'order' : 'orders'}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm">
              {owedOrders.slice(0, 5).map(o => (
                <Link key={o.id} href={`/dashboard/orders/${o.id}`} className="text-emerald-200/80 hover:text-emerald-100">
                  {o.title} — ${o.balance.toFixed(2)}{o.partial ? ' left' : ''}
                </Link>
              ))}
              {owedOrders.length > 5 && <span className="text-emerald-200/60">+{owedOrders.length - 5} more</span>}
            </div>
          </div>
        )}

        {/* Search + Status Filter */}
        <div className="flex flex-col md:flex-row gap-3 mb-10">
          <input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search orders or client names..."
            className="flex-1 bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-gray-900 border border-gray-800 text-white rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-indigo-500"
          >
            <option value="all">All statuses</option>
            {COLUMNS.map(column => (
              <option key={column.key} value={column.key}>{column.label}</option>
            ))}
          </select>
        </div>

        {/* Draggable Widget Layout */}
        <DragDropContext onDragEnd={onLayoutDragEnd}>
          <Droppable droppableId="dashboard-layout" direction="vertical">
            {provided => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className="space-y-8"
              >
                {layout.map((widgetId, index) => {
                  const WIDGETS: Record<string, { title: string; render: () => React.ReactNode }> = {
                    stats: { title: 'Stats', render: renderStats },
                    kanban: { title: 'Orders', render: renderKanban },
                    analytics: { title: 'Analytics', render: renderAnalytics },
                  }
                  const widget = WIDGETS[widgetId]
                  if (!widget) return null
                  return (
                    <DashboardWidget key={widgetId} id={widgetId} index={index} title={widget.title}>
                      {widget.render()}
                    </DashboardWidget>
                  )
                })}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </main>

      {/* New Order Modal */}
      {showModal && profile && (
        <NewOrderModal
          userId={profile.id}
          onClose={() => setShowModal(false)}
          onCreated={() => fetchOrders(profile.id, clients)}
        />
      )}
    </div>
  )
}
