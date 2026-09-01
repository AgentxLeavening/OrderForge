'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

type Client = {
  id: string
  name: string
  email: string | null
  phone: string | null
  platform: string
  notes: string | null
}

type Order = {
  id: string
  title: string
  type: string
  status: string
  order_number: string
  due_date: string | null
  created_at: string
}

const PLATFORM_LABELS: Record<string, string> = {
  etsy: '🛍️ Etsy',
  ebay: '📦 eBay',
  tcgplayer: '🃏 TCGPlayer',
  local: '🤝 Local',
  website: '🌐 Website',
  other: '📋 Other',
}

const STATUS_COLORS: Record<string, string> = {
  inquiry: 'bg-gray-700 text-gray-300',
  quoted: 'bg-yellow-500/20 text-yellow-400',
  in_progress: 'bg-blue-500/20 text-blue-400',
  complete: 'bg-green-500/20 text-green-400',
}

const TYPE_EMOJI: Record<string, string> = {
  commission: '🎨',
  print_job: '🖨️',
  card_lot: '🃏',
  wholesale: '📦',
  other: '📋',
}

export default function ClientDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [client, setClient] = useState<Client | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Editable fields
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [platform, setPlatform] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    const fetchClient = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: clientData } = await supabase
        .from('clients')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

      if (!clientData) { router.push('/dashboard/clients'); return }

      setClient(clientData)
      setName(clientData.name)
      setEmail(clientData.email || '')
      setPhone(clientData.phone || '')
      setPlatform(clientData.platform)
      setNotes(clientData.notes || '')

      const { data: orderData } = await supabase
        .from('orders')
        .select('*')
        .eq('client_id', id)
        .order('created_at', { ascending: false })

      setOrders(orderData || [])
      setLoading(false)
    }

    fetchClient()
  }, [id, router])

  const saveClient = async () => {
    setSaving(true)
    await supabase
      .from('clients')
      .update({
        name,
        email: email || null,
        phone: phone || null,
        platform,
        notes: notes || null,
      })
      .eq('id', id)

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const deleteClient = async () => {
    if (!confirm('Delete this client? Their orders will not be deleted.')) return
    await supabase.from('clients').delete().eq('id', id)
    router.push('/dashboard/clients')
  }

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
        <div className="flex items-center gap-3">
          <Link href="/dashboard/clients" className="text-gray-500 hover:text-white transition text-sm">
            ← Clients
          </Link>
          <span className="text-gray-700">|</span>
          <span className="text-indigo-400 font-bold">OrderForge</span>
        </div>
        <button
          onClick={deleteClient}
          className="text-red-400 hover:text-red-300 text-sm transition"
        >
          Delete Client
        </button>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex items-start justify-between mb-8 gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-xl shrink-0">
              {name.charAt(0).toUpperCase()}
            </div>
            <div>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                className="text-3xl font-bold text-white bg-transparent border-b border-transparent hover:border-gray-700 focus:border-indigo-500 focus:outline-none pb-1 transition"
              />
              <p className="text-gray-400 text-sm mt-1">{PLATFORM_LABELS[platform] || platform}</p>
            </div>
          </div>
          <button
            onClick={saveClient}
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-5 py-2.5 rounded-lg transition disabled:opacity-50 shrink-0"
          >
            {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Changes'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Contact Info */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
            <h2 className="text-white font-semibold">Contact Info</h2>

            <div>
              <label className="text-sm text-gray-400 mb-1 block">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                placeholder="customer@example.com"
              />
            </div>

            <div>
              <label className="text-sm text-gray-400 mb-1 block">Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                placeholder="(555) 000-0000"
              />
            </div>

            <div>
              <label className="text-sm text-gray-400 mb-1 block">Platform</label>
              <select
                value={platform}
                onChange={e => setPlatform(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="etsy">🛍️ Etsy</option>
                <option value="ebay">📦 eBay</option>
                <option value="tcgplayer">🃏 TCGPlayer</option>
                <option value="local">🤝 Local</option>
                <option value="website">🌐 Website</option>
                <option value="other">📋 Other</option>
              </select>
            </div>
          </div>

          {/* Notes */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="text-white font-semibold mb-4">Notes</h2>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={6}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
              placeholder="Notes about this client..."
            />
          </div>
        </div>

        {/* Orders */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h2 className="text-white font-semibold mb-4">
            Orders <span className="text-gray-500 font-normal text-sm ml-1">({orders.length})</span>
          </h2>

          {orders.length === 0 ? (
            <p className="text-gray-600 text-sm text-center py-6">No orders linked to this client yet</p>
          ) : (
            <div className="space-y-3">
              {orders.map(order => (
                <Link
                  key={order.id}
                  href={`/dashboard/orders/${order.id}`}
                  className="flex items-center justify-between bg-gray-800 hover:border-indigo-500 border border-gray-700 rounded-xl px-4 py-3 transition"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{TYPE_EMOJI[order.type] || '📋'}</span>
                    <div>
                      <p className="text-white text-sm font-medium">{order.title}</p>
                      <p className="text-gray-500 text-xs">{order.order_number}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {order.due_date && (
                      <p className="text-gray-400 text-xs hidden sm:block">
                        Due {new Date(order.due_date).toLocaleDateString()}
                      </p>
                    )}
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${STATUS_COLORS[order.status]}`}>
                      {order.status.replace('_', ' ')}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}