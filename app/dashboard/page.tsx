'use client'

import { useEffect, useState, useCallback, type MouseEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import NewOrderModal, { CHANNEL_OPTIONS } from '@/app/components/NewOrderModal'
import DashboardWidget from '@/app/components/DashboardWidget'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import Link from 'next/link'

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
  { key: 'complete', label: 'Complete' },
]

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
  const [channelStats, setChannelStats] = useState<{ name: string; total: number; count: number }[]>([])
  const [invoiceCounts, setInvoiceCounts] = useState<{ name: string; count: number }[]>([])
  const [selectedClientId, setSelectedClientId] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [layout, setLayout] = useState<string[]>(DEFAULT_LAYOUT)
  const [savingLayout, setSavingLayout] = useState(false)

  const fetchOrders = useCallback(async (userId: string) => {
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
    if (orderIds.length > 0) {
      const { data: items } = await supabase
        .from('order_items')
        .select('order_id, quantity, unit_price')
        .in('order_id', orderIds)

      const itemList = (items || []) as { order_id: string; quantity: number; unit_price: number }[]

      itemList.forEach(it => {
        const lineTotal = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0)
        orderTotals[it.order_id] = (orderTotals[it.order_id] || 0) + lineTotal
      })

      // Map order totals to client revenue
      ordersData.forEach(o => {
        const clientName = o.client_id
          ? (clients.find(c => c.id === o.client_id)?.name || 'Unassigned')
          : 'Unassigned'
        const amt = orderTotals[o.id] || 0
        revenueByClient[clientName] = (revenueByClient[clientName] || 0) + amt
      })
    }

    // Aggregate orders + revenue by sales channel — unlike the per-client
    // breakdowns, this counts one-off / no-client sales too.
    const channelAgg: Record<string, { total: number; count: number }> = {}
    ordersData.forEach(o => {
      const label = channelLabel(o.sales_channel)
      if (!channelAgg[label]) channelAgg[label] = { total: 0, count: 0 }
      channelAgg[label].total += orderTotals[o.id] || 0
      channelAgg[label].count += 1
    })
    setChannelStats(
      Object.entries(channelAgg)
        .map(([name, v]) => ({ name, total: v.total, count: v.count }))
        .sort((a, b) => b.total - a.total || b.count - a.count)
    )

    // Use invoices table to compute invoice counts per client (one invoice may exist per order)
    const { data: invoices } = await supabase
      .from('invoices')
      .select('id, order_id')
      .eq('user_id', userId)

    const invoiceList = (invoices || []) as { id: string; order_id: string }[]
    invoiceList.forEach(inv => {
      const order = ordersData.find(o => o.id === inv.order_id)
      const clientName = order?.client_id
        ? (clients.find(c => c.id === order.client_id)?.name || 'Unassigned')
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
  }, [clients])

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

      setProfile(data)
      setLayout(data?.dashboard_layout || DEFAULT_LAYOUT)
      setClients(clientData || [])
      await fetchOrders(user.id)
      setLoading(false)
    }
    init()
  }, [router, fetchOrders])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const onDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result
    if (!destination) return
    if (destination.droppableId === source.droppableId) return

    const newStatus = destination.droppableId

    // Optimistic update
    setOrders(prev =>
      prev.map(o => o.id === draggableId ? { ...o, status: newStatus } : o)
    )

    // Persist to Supabase
    await supabase
      .from('orders')
      .update({ status: newStatus })
      .eq('id', draggableId)
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

  const activeOrders = filteredOrders.filter(o => o.status !== 'complete').length
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
  const isOverdue = (due: string | null) => due && new Date(due) < new Date()

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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
          {channelStats.length > 0 ? (
            <ol className="space-y-2">
              {channelStats.map(c => (
                <li key={c.name} className="flex items-center justify-between">
                  <span className="text-white">{c.name}</span>
                  <span className="text-gray-400 text-sm">{c.count} {c.count === 1 ? 'order' : 'orders'} · ${c.total.toFixed(2)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-gray-400">No orders yet.</p>
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

  const renderKanban = () => (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {COLUMNS.map(col => {
          const colOrders = filteredOrders.filter(o => o.status === col.key)
          return (
            <div key={col.key} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              {/* Column Header */}
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white font-semibold">{col.label}</h2>
                <span className="bg-gray-800 text-gray-400 text-xs font-bold px-2 py-1 rounded-full">
                  {colOrders.length}
                </span>
              </div>

              {/* Droppable Column */}
              <Droppable droppableId={col.key}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`space-y-3 min-h-24 rounded-xl transition ${
                      snapshot.isDraggingOver ? 'bg-indigo-500/10 border border-indigo-500/30' : ''
                    }`}
                  >
                    {colOrders.length === 0 && !snapshot.isDraggingOver && (
                      <p className="text-gray-600 text-sm text-center py-6">No orders</p>
                    )}

                    {colOrders.map((order, index) => {
                      const clientName = Array.isArray(order.clients)
                        ? order.clients[0]?.name || ''
                        : (order.clients && (order.clients as { name?: string }).name) || ''
                      const clientIdLocal = order.client_id || ''

                      return (
                        <Draggable key={order.id} draggableId={order.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              onClick={() => router.push(`/dashboard/orders/${order.id}`)}
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={`bg-gray-800 border rounded-xl p-4 transition cursor-grab active:cursor-grabbing ${
                                snapshot.isDragging
                                  ? 'border-indigo-500 shadow-lg shadow-indigo-500/20 rotate-1'
                                  : 'border-gray-700 hover:border-indigo-500'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <span className="text-white text-sm font-medium leading-snug">{order.title}</span>
                                <span className="text-lg shrink-0">{TYPE_EMOJI[order.type] || '📋'}</span>
                              </div>

                              <p className="text-gray-500 text-xs mb-2">{order.order_number}</p>

                              <div className="mb-2">
                                {clientName ? (
                                  clientIdLocal ? (
                                    <Link
                                      href={`/dashboard/clients/${clientIdLocal}`}
                                      onClick={e => e.stopPropagation()}
                                      className="text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded-full hover:bg-indigo-500 hover:text-white transition"
                                    >
                                      {clientName}
                                    </Link>
                                  ) : (
                                    <span className="text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded-full">{clientName}</span>
                                  )
                                ) : (
                                  <span className="text-xs text-gray-400">Unassigned</span>
                                )}
                              </div>

                              {order.due_date && (
                                <p className={`text-xs ${isOverdue(order.due_date) ? 'text-red-400' : 'text-gray-400'}`}>
                                  Due {new Date(order.due_date).toLocaleDateString()}
                                  {isOverdue(order.due_date) && ' ⚠️'}
                                </p>
                              )}
                            </div>
                          )}
                        </Draggable>
                      )
                    })}
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
          onCreated={() => fetchOrders(profile.id)}
        />
      )}
    </div>
  )
}
