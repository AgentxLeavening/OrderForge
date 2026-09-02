'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type Client = {
  id: string
  name: string
  email: string | null
  phone: string | null
  platform: string
  notes: string | null
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

export default function ClientsPage() {
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [userId, setUserId] = useState('')

  // New client form
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [platform, setPlatform] = useState('other')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const fetchClients = useCallback(async (uid: string) => {
    const { data } = await supabase
      .from('clients')
      .select('*')
      .eq('user_id', uid)
      .order('name', { ascending: true })
    setClients(data || [])
  }, [])

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUserId(user.id)
      await fetchClients(user.id)
      setLoading(false)
    }
    init()
  }, [router, fetchClients])

  const handleAddClient = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError('')

    const { error } = await supabase.from('clients').insert({
      user_id: userId,
      name,
      email: email || null,
      phone: phone || null,
      platform,
      notes: notes || null,
    })

    if (error) {
      setError(error.message)
      setSaving(false)
    } else {
      await fetchClients(userId)
      setShowModal(false)
      setName('')
      setEmail('')
      setPhone('')
      setPlatform('other')
      setNotes('')
      setSaving(false)
    }
  }

  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase()) ||
    c.platform.toLowerCase().includes(search.toLowerCase())
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
      <main className="max-w-5xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">Clients</h1>
            <p className="text-gray-400 mt-1">{clients.length} total clients</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-5 py-3 rounded-lg transition"
          >
            + Add Client
          </button>
        </div>

        {/* Search */}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search clients..."
          className="w-full bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 mb-6"
        />

        {/* Client List */}
        {filtered.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 text-center">
            <p className="text-4xl mb-3">👥</p>
            <h2 className="text-white font-semibold text-lg mb-1">No clients yet</h2>
            <p className="text-gray-400 text-sm mb-6">Add your first client to get started</p>
            <button
              onClick={() => setShowModal(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-3 rounded-lg transition"
            >
              + Add Client
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(client => (
              <Link
                key={client.id}
                href={`/dashboard/clients/${client.id}`}
                className="block bg-gray-900 border border-gray-800 hover:border-indigo-500 rounded-2xl px-6 py-5 transition"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                      {client.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-white font-semibold">{client.name}</p>
                      <p className="text-gray-400 text-sm">{client.email || 'No email'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {client.phone && (
                      <p className="text-gray-400 text-sm hidden sm:block">{client.phone}</p>
                    )}
                    <span className="text-xs bg-gray-800 text-gray-300 px-3 py-1 rounded-full">
                      {PLATFORM_LABELS[client.platform] || client.platform}
                    </span>
                    <span className="text-gray-600">→</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      {/* Add Client Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-white text-xl font-bold">Add Client</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-white text-2xl leading-none">×</button>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg mb-4 text-sm">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-400 mb-1 block">Name *</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                  placeholder="Customer name"
                />
              </div>
              <div>
                <label className="text-sm text-gray-400 mb-1 block">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                  placeholder="customer@example.com"
                />
              </div>
              <div>
                <label className="text-sm text-gray-400 mb-1 block">Phone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                  placeholder="(555) 000-0000"
                />
              </div>
              <div>
                <label className="text-sm text-gray-400 mb-1 block">Platform</label>
                <select
                  value={platform}
                  onChange={e => setPlatform(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="etsy">🛍️ Etsy</option>
                  <option value="ebay">📦 eBay</option>
                  <option value="tcgplayer">🃏 TCGPlayer</option>
                  <option value="local">🤝 Local</option>
                  <option value="website">🌐 Website</option>
                  <option value="other">📋 Other</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-400 mb-1 block">Notes</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
                  placeholder="Any notes about this client..."
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowModal(false)}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-white font-semibold py-3 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddClient}
                  disabled={saving}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50"
                >
                  {saving ? 'Adding...' : 'Add Client'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}