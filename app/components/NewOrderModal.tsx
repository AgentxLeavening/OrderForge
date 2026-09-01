'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import ProductCard from '@/app/components/ProductCard'

type ClientOption = {
  id: string
  name: string
}

type ProductItem = {
  id?: string
  name: string
  quantity: number
  unit_cost: number
}

type Product = {
  id: string
  name: string
  suggested_price?: number | null
  est_time?: number | null
  items?: ProductItem[]
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
  const [products, setProducts] = useState<Product[]>([])
  const [selectedProductId, setSelectedProductId] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [markup, setMarkup] = useState(1.5)
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

    const fetchProducts = async () => {
      try {
        const { data, error } = await supabase
          .from('products')
          .select('id, name, suggested_price, est_time')
          .eq('user_id', userId)
          .order('name', { ascending: true })

        if (error) {
          console.warn('Products fetch error (table may not exist):', error.message)
          setProducts([])
          return
        }

        setProducts((data || []) as Product[])
      } catch (e) {
        console.warn('Products fetch failed (maybe table missing):', e)
        setProducts([])
      }
    }

    fetchProducts()
  }, [userId])

  const handleCreate = async () => {
    if (!title.trim()) {
      setError('Order title is required')
      return
    }

    setLoading(true)
    setError('')

    // compute material cost and chosen suggested price (markup or template)
    const materialCost = (selectedProduct?.items || []).reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_cost) || 0), 0)
    const computedMarkupPrice = Number((materialCost * markup).toFixed(2))
    const finalSuggestedPrice = selectedProduct?.suggested_price ? Number(selectedProduct.suggested_price) : computedMarkupPrice

    const orderNumber = `ORD-${Date.now().toString().slice(-6)}`

    const { data: createdOrder, error } = await supabase.from('orders').insert({
      user_id: userId,
      client_id: selectedClientId || null,
      title,
      type,
      due_date: dueDate || null,
      notes,
      status: 'inquiry',
      order_number: orderNumber,
      suggested_price: finalSuggestedPrice || null,
    }).select('id').single()

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    // insert order_items if template selected
    if (selectedProduct && selectedProduct.items && selectedProduct.items.length > 0) {
      try {
        const orderId = (createdOrder as any)?.id
        if (orderId) {
          const itemsToInsert = selectedProduct.items.map(it => ({
            order_id: orderId,
            name: it.name,
            quantity: it.quantity,
            unit_price: it.unit_cost,
          }))

          const { error: itemsErr } = await supabase.from('order_items').insert(itemsToInsert)
          if (itemsErr) console.warn('Failed inserting order_items from template', itemsErr)
          // Attempt to deduct inventory for each BOM item (best-effort)
          try {
            for (const it of selectedProduct.items) {
              const needed = Number(it.quantity) || 0
              if (!needed) continue

              // try to find inventory by SKU first, then by name
              let { data: invRows } = await supabase
                .from('inventory_items')
                .select('id, quantity')
                .eq('user_id', userId)
                .match(it.sku ? { sku: it.sku } : { name: it.name })

              const row = (invRows || [])[0]
              if (!row) {
                console.warn('No inventory item found for', it.name || it.sku)
                continue
              }

              const current = Number(row.quantity) || 0
              const newQty = Math.max(0, current - needed)
              const { error: invErr } = await supabase
                .from('inventory_items')
                .update({ quantity: newQty })
                .eq('id', row.id)

              if (invErr) console.warn('Failed updating inventory for', it.name, invErr)
              else {
                // Log the inventory transaction for auditing
                try {
                  const change = Number(newQty) - Number(current)
                  await supabase.from('inventory_transactions').insert({
                    inventory_item_id: row.id,
                    user_id: userId,
                    order_id: orderId,
                    change,
                    previous_quantity: current,
                    new_quantity: newQty,
                    reason: 'order_template_deduction',
                    metadata: {
                      product_id: selectedProduct?.id || null,
                      product_name: selectedProduct?.name || null,
                      bom_item_name: it.name || null,
                    },
                  })
                } catch (txErr) {
                  console.warn('Failed inserting inventory transaction for', it.name, txErr)
                }
              }
            }
          } catch (e) {
            console.warn('Inventory deduction failed', e)
          }
        }
      } catch (e) {
        console.warn('Template apply error', e)
      }
    }

    onCreated()
    onClose()
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
            <label className="text-sm text-gray-400 mb-1 block">Template (optional)</label>
            <select
              value={selectedProductId}
              onChange={async e => {
                const pid = e.target.value
                setSelectedProductId(pid)
                if (!pid) {
                  setSelectedProduct(null)
                  return
                }

                const { data } = await supabase
                  .from('product_items')
                  .select('id, name, quantity, unit_cost')
                  .eq('product_id', pid)

                const prod = products.find(p => p.id === pid) || null
                setSelectedProduct({ ...(prod as Product), items: (data || []) as ProductItem[] })
                if (!title && prod) setTitle(prod.name)
                if (prod?.suggested_price) setNotes(prev => prev + `\nSuggested price: $${Number(prod.suggested_price).toFixed(2)}`)
              }}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-indigo-500 mb-3"
            >
              <option value="">No template</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>

            {selectedProduct && (
              <div className="mb-3">
                <ProductCard product={selectedProduct} compact />
                <div className="mt-2 bg-gray-800 border border-gray-700 rounded p-3">
                <p className="text-gray-300 text-sm mb-2">Estimated material cost: <strong className="text-white">${(selectedProduct.items || []).reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_cost) || 0), 0).toFixed(2)}</strong></p>
                <p className="text-gray-400 text-xs mb-2">Pricing presets:</p>
                <div className="flex items-center gap-2 mb-2">
                  {[1.2, 1.5, 2].map(p => (
                    <button key={p} onClick={() => setMarkup(p)} className={`px-3 py-1 rounded ${markup === p ? 'bg-indigo-600' : 'bg-gray-700'}`}>
                      {Math.round((p - 1) * 100)}% markup
                    </button>
                  ))}
                  <button onClick={() => setMarkup(1)} className={`px-3 py-1 rounded ${markup === 1 ? 'bg-indigo-600' : 'bg-gray-700'}`}>No markup</button>
                </div>

                <p className="text-gray-300 text-sm">Suggested price (markup): <strong className="text-white">${((selectedProduct.items || []).reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_cost) || 0), 0) * markup).toFixed(2)}</strong></p>
                {selectedProduct.suggested_price && (
                  <p className="text-gray-400 text-xs mt-1">Template suggested price: <strong className="text-white">${Number(selectedProduct.suggested_price).toFixed(2)}</strong></p>
                )}
                </div>
              </div>
            )}

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