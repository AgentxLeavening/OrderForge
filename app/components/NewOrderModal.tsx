'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type ClientOption = {
  id: string
  name: string
}

type Props = {
  userId: string
  onClose: () => void
  onCreated: () => void
}

export default function NewOrderModal({ userId, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState('commission')
  const [selectedClientId, setSelectedClientId] = useState('')
  const [clients, setClients] = useState<ClientOption[]>([])
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const fetchClients = async () => {
      const { data } = await supabase
        .from('clients')
        .select('id, name')
        .eq('user_id', userId)
        .order('name', { ascending: true })

      setClients(data || [])
    }

    fetchClients()
  }, [userId])

  const handleCreate = async () => {
    if (!title.trim()) {
      setError('Order title is required')
      return
    }

    setLoading(true)
    setError('')

    const orderNumber = `ORD-${Date.now().toString().slice(-6)}`

    const { error } = await supabase.from('orders').insert({
      user_id: userId,
      client_id: selectedClientId || null,
      title,
      type,
      due_date: dueDate || null,
      notes,
      status: 'inquiry',
      order_number: orderNumber,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      onCreated()
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg p-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-white text-xl font-bold">New Order</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl leading-none">×</button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 mb-1 block">Order Title *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              placeholder="e.g. Custom resin tray for Sarah"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400 mb-1 block">Order Type</label>
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="commission">🎨 Commission / Craft</option>
              <option value="print_job">🖨️ 3D Print Job</option>
              <option value="card_lot">🃏 Card Lot</option>
              <option value="wholesale">📦 Wholesale</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="text-sm text-gray-400 mb-1 block">Client</label>
            <select
              value={selectedClientId}
              onChange={e => setSelectedClientId(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="">No client selected</option>
              {clients.map(client => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm text-gray-400 mb-1 block">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400 mb-1 block">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
              placeholder="Any details about the order..."
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-white font-semibold py-3 rounded-lg transition"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={loading}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Order'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}