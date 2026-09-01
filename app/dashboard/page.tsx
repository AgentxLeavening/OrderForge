'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import NewOrderModal from '@/app/components/NewOrderModal'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'

type Profile = {
  id: string
  name: string
  business_name: string
  plan: string
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
}

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

export default function DashboardPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)

  const fetchOrders = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('orders')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    setOrders(data || [])
  }, [])

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data } = await supabase
        .from('profiles')
        .select('id, name, business_name, plan')
        .eq('id', user.id)
        .single()

      setProfile(data)
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

  const activeOrders = orders.filter(o => o.status !== 'complete').length
  const isOverdue = (due: string | null) => due && new Date(due) < new Date()

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Nav */}
      <nav className="border-b border-gray-800 bg-gray-900 px-6 py-4 flex items-center justify-between">
        <span className="text-indigo-400 font-bold text-xl">OrderForge</span>
        <div className="flex items-center gap-4">
          <span className="text-gray-400 text-sm">{profile?.business_name || 'My Shop'}</span>
          <button onClick={handleSignOut} className="text-sm text-gray-500 hover:text-white transition">
            Sign out
          </button>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">Hey, {profile?.name || 'there'} 👋</h1>
            <p className="text-gray-400 mt-1">Here's what's going on with your orders.</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-5 py-3 rounded-lg transition"
          >
            + New Order
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-10">
          {[
            { label: 'Active Orders', value: activeOrders },
            { label: 'Unpaid Invoices', value: 0 },
            { label: 'Earned This Month', value: '$0' },
          ].map(stat => (
            <div key={stat.label} className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <p className="text-gray-400 text-sm mb-1">{stat.label}</p>
              <p className="text-white text-3xl font-bold">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Kanban Board */}
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {COLUMNS.map(col => {
              const colOrders = orders.filter(o => o.status === col.key)
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

                        {colOrders.map((order, index) => (
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

                                {order.due_date && (
                                  <p className={`text-xs ${isOverdue(order.due_date) ? 'text-red-400' : 'text-gray-400'}`}>
                                    Due {new Date(order.due_date).toLocaleDateString()}
                                    {isOverdue(order.due_date) && ' ⚠️'}
                                  </p>
                                )}
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              )
            })}
          </div>
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