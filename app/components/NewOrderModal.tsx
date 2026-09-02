'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import ProductCard from '@/app/components/ProductCard'

type ClientOption = {
  id: string
  name: string
}

export const CHANNEL_OPTIONS = [
  { value: '', label: 'Not specified' },
  { value: 'etsy', label: 'Etsy' },
  { value: 'ebay', label: 'eBay' },
  { value: 'shopify', label: 'Shopify' },
  { value: 'direct', label: 'Direct / Website' },
  { value: 'in_person', label: 'In-person / Market' },
  { value: 'commission', label: 'Commission' },
  { value: 'other', label: 'Other' },
]

type ProductItem = {
  id?: string
  name: string
  sku?: string | null
  inventory_item_id?: string | null
  quantity: number
  unit_cost: number
}

type Product = {
  id?: string
  name: string
  suggested_price?: number | null
  est_time?: number | null
  items?: ProductItem[]
}

type InventoryOption = { id: string; name: string; category?: string | null; unit?: string | null; unit_cost?: number | null; sku?: string | null }

type Props = {
  userId: string
  onClose: () => void
  onCreated: () => void
}

export default function NewOrderModal({ userId, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState('commission')
  const [selectedClientId, setSelectedClientId] = useState('')
  const [salesChannel, setSalesChannel] = useState('')
  const [buyerName, setBuyerName] = useState('')
  const [clients, setClients] = useState<ClientOption[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [selectedProductId, setSelectedProductId] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [inventoryOptions, setInventoryOptions] = useState<InventoryOption[]>([])
  const [selectedInventoryId, setSelectedInventoryId] = useState('')
  const [directQty, setDirectQty] = useState(1)
  const [packHours, setPackHours] = useState(0)
  const [productQty, setProductQty] = useState(1)
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [markup, setMarkup] = useState(1.5)
  const [hourlyRate, setHourlyRate] = useState(0)
  const [feePct, setFeePct] = useState(0)
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

    const fetchInventory = async () => {
      const { data } = await supabase
        .from('inventory_items')
        .select('id, name, category, unit, unit_cost, sku')
        .eq('user_id', userId)
        .order('name', { ascending: true })
      setInventoryOptions((data || []) as InventoryOption[])
    }

    fetchInventory()

    const fetchProfile = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('hourly_rate, default_markup, default_fee_pct')
        .eq('id', userId)
        .single()
      if (data) {
        if (data.hourly_rate != null) setHourlyRate(Number(data.hourly_rate))
        if (data.default_markup != null) setMarkup(Number(data.default_markup))
        if (data.default_fee_pct != null) setFeePct(Number(data.default_fee_pct))
      }
    }

    fetchProfile()
  }, [userId])

  // Selecting an inventory item builds a synthetic one-line "template" so the
  // existing pricing + deduction logic works with no product template.
  const applyFinishedGood = (invId: string, qty: number, hours: number) => {
    const inv = inventoryOptions.find(i => i.id === invId)
    if (!inv) { setSelectedProduct(null); return }
    setSelectedProduct({
      name: inv.name,
      suggested_price: null,
      est_time: hours || 0,
      items: [{
        name: inv.name,
        sku: inv.sku,
        inventory_item_id: inv.id,
        quantity: qty || 0,
        unit_cost: Number(inv.unit_cost) || 0,
      }],
    })
    if (!title) setTitle(inv.name)
  }

  // Suggested price = (materials + labor) × markup, grossed up to cover fees.
  const hasLiveCost = (selectedProduct?.items || []).some(it => it.inventory_item_id)
  // A product template is priced per unit, so multiply by the order quantity.
  // The finished-good path already bakes its "quantity to sell" into the
  // synthetic BOM line and its packing hours, so it stays at 1 here.
  const isFinishedGood = !!selectedInventoryId
  const unitMultiplier = isFinishedGood ? 1 : (Number(productQty) || 1)
  const materialCost = unitMultiplier * (selectedProduct?.items || []).reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_cost) || 0), 0)
  const laborCost = unitMultiplier * (Number(selectedProduct?.est_time) || 0) * (Number(hourlyRate) || 0)
  const costSubtotal = materialCost + laborCost
  const afterMarkup = costSubtotal * markup
  const feeFrac = Math.min(Math.max(Number(feePct) || 0, 0), 99) / 100
  const computedPrice = Number((feeFrac > 0 ? afterMarkup / (1 - feeFrac) : afterMarkup).toFixed(2))
  // A template override price is per unit, so scale it by the order quantity too.
  const finalSuggestedPrice = selectedProduct?.suggested_price
    ? Number(selectedProduct.suggested_price) * unitMultiplier
    : computedPrice

  const handleCreate = async () => {
    if (!title.trim()) {
      setError('Order title is required')
      return
    }

    setLoading(true)
    setError('')

    const orderNumber = `ORD-${Date.now().toString().slice(-6)}`

    const { data: createdOrder, error } = await supabase.from('orders').insert({
      user_id: userId,
      client_id: selectedClientId || null,
      sales_channel: salesChannel || null,
      buyer_name: buyerName.trim() || null,
      title,
      type,
      due_date: dueDate || null,
      notes,
      status: 'inquiry',
      order_number: orderNumber,
      suggested_price: finalSuggestedPrice || null,
      material_cost: selectedProduct ? Number(materialCost.toFixed(2)) : null,
      labor_cost: selectedProduct ? Number(laborCost.toFixed(2)) : null,
      markup: selectedProduct ? markup : null,
      fee_pct: selectedProduct ? feePct : null,
    }).select('id').single()

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    // Record the sale as a single billing line at the suggested price, using the
    // same `description` column the order-detail line items use. The BOM is
    // internal cost detail (persisted as material_cost/labor_cost on the order);
    // billing each BOM line at its unit_cost would charge the customer our cost
    // rather than the sale price. Inventory is still deducted per BOM item below.
    if (selectedProduct && selectedProduct.items && selectedProduct.items.length > 0) {
      try {
        const orderId = (createdOrder as any)?.id
        if (orderId) {
          const billQty = isFinishedGood ? (Number(directQty) || 1) : (Number(productQty) || 1)
          const { error: itemsErr } = await supabase.from('order_items').insert({
            order_id: orderId,
            description: selectedProduct.name || title,
            quantity: billQty,
            unit_price: Number(((finalSuggestedPrice || 0) / billQty).toFixed(2)),
          })
          if (itemsErr) console.warn('Failed inserting order line item', itemsErr)
          // Attempt to deduct inventory for each BOM item (best-effort).
          // The decrement + audit-log happen atomically inside the
          // deduct_inventory_for_order DB function (row-locked) so concurrent
          // orders can't race and lose updates. See migration 007.
          try {
            for (const it of selectedProduct.items) {
              const needed = (Number(it.quantity) || 0) * unitMultiplier
              if (!needed) continue

              // Prefer the directly-linked inventory item; fall back to SKU, then name.
              const { data: invRows } = await supabase
                .from('inventory_items')
                .select('id')
                .eq('user_id', userId)
                .match(
                  it.inventory_item_id
                    ? { id: it.inventory_item_id }
                    : it.sku
                      ? { sku: it.sku }
                      : { name: it.name }
                )

              const row = (invRows || [])[0]
              if (!row) {
                console.warn('No inventory item found for', it.name || it.sku)
                continue
              }

              const { error: rpcErr } = await supabase.rpc('deduct_inventory_for_order', {
                p_order_id: orderId,
                p_inventory_item_id: row.id,
                p_quantity: needed,
                p_metadata: {
                  product_id: selectedProduct?.id || null,
                  product_name: selectedProduct?.name || null,
                  bom_item_name: it.name || null,
                },
              })
              if (rpcErr) console.warn('Failed deducting inventory for', it.name, rpcErr)
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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
          <h2 className="text-white text-xl font-bold">New Order</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-2">
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
                setSelectedInventoryId('')
                setProductQty(1)
                if (!pid) {
                  setSelectedProduct(null)
                  return
                }

                const { data } = await supabase
                  .from('product_items')
                  .select('id, name, sku, inventory_item_id, quantity, unit_cost, inventory_items(unit_cost)')
                  .eq('product_id', pid)

                // For linked BOM lines, price from the CURRENT inventory cost
                // rather than the value snapshotted onto the template.
                const items = ((data || []) as any[]).map(it => ({
                  ...it,
                  unit_cost: it.inventory_items?.unit_cost != null ? Number(it.inventory_items.unit_cost) : it.unit_cost,
                })) as ProductItem[]

                const prod = products.find(p => p.id === pid) || null
                setSelectedProduct({ ...(prod as Product), items })
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

            {!selectedProductId && (
              <div className="mb-3">
                <label className="text-sm text-gray-400 mb-1 block">…or sell an inventory item directly</label>
                <select
                  value={selectedInventoryId}
                  onChange={e => {
                    const id = e.target.value
                    setSelectedInventoryId(id)
                    setSelectedProductId('')
                    setDirectQty(1)
                    setPackHours(0)
                    applyFinishedGood(id, 1, 0)
                  }}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="">No inventory item</option>
                  {inventoryOptions.map(inv => (
                    <option key={inv.id} value={inv.id}>{inv.name}{inv.unit ? ` (${inv.unit})` : ''}</option>
                  ))}
                </select>

                {selectedInventoryId && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <label className="text-xs text-gray-400">Quantity to sell
                      <input value={directQty} onChange={e => { const q = Number(e.target.value); setDirectQty(q); applyFinishedGood(selectedInventoryId, q, packHours) }} type="number" className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-indigo-500" />
                    </label>
                    <label className="text-xs text-gray-400">Packing time (hours)
                      <input value={packHours} onChange={e => { const h = Number(e.target.value); setPackHours(h); applyFinishedGood(selectedInventoryId, directQty, h) }} type="number" step="0.25" className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-indigo-500" />
                    </label>
                  </div>
                )}
              </div>
            )}

            {selectedProduct && (
              <div className="mb-3">
                <ProductCard product={selectedProduct} compact />
                {selectedProductId && (
                  <label className="text-xs text-gray-400 block mt-2">Quantity
                    <input
                      value={productQty}
                      onChange={e => setProductQty(Number(e.target.value))}
                      type="number"
                      min="1"
                      className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </label>
                )}
                <div className="mt-2 bg-gray-800 border border-gray-700 rounded p-3 space-y-1.5">
                  <div className="flex justify-between text-sm text-gray-300"><span>Materials{hasLiveCost ? ' *' : ''}</span><span>${materialCost.toFixed(2)}</span></div>
                  <div className="flex justify-between text-sm text-gray-300">
                    <span>Labor {Number(selectedProduct.est_time) ? `(${Number(selectedProduct.est_time)}h × $${hourlyRate}/h)` : ''}</span>
                    <span>${laborCost.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-400 border-t border-gray-700 pt-1.5"><span>Cost subtotal</span><span>${costSubtotal.toFixed(2)}</span></div>

                  <p className="text-gray-400 text-xs pt-1">Markup:</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {[1.2, 1.5, 2].map(p => (
                      <button key={p} onClick={() => setMarkup(p)} className={`px-3 py-1 rounded text-sm ${markup === p ? 'bg-indigo-600' : 'bg-gray-700'}`}>
                        {Math.round((p - 1) * 100)}%
                      </button>
                    ))}
                    <button onClick={() => setMarkup(1)} className={`px-3 py-1 rounded text-sm ${markup === 1 ? 'bg-indigo-600' : 'bg-gray-700'}`}>None</button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <label className="text-xs text-gray-400">Hourly rate ($/h)
                      <input value={hourlyRate} onChange={e => setHourlyRate(Number(e.target.value))} type="number" step="0.01" className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-indigo-500" />
                    </label>
                    <label className="text-xs text-gray-400">Marketplace fee (%)
                      <input value={feePct} onChange={e => setFeePct(Number(e.target.value))} type="number" step="0.1" className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-indigo-500" />
                    </label>
                  </div>

                  <div className="flex justify-between text-sm border-t border-gray-700 pt-2 mt-1">
                    <span className="text-gray-300">Suggested price</span>
                    <strong className="text-white">${computedPrice.toFixed(2)}</strong>
                  </div>
                  {feeFrac > 0 && (
                    <p className="text-gray-500 text-xs">${afterMarkup.toFixed(2)} + {feePct}% fee cover</p>
                  )}
                  {selectedProduct.suggested_price && (
                    <p className="text-gray-400 text-xs pt-1">Template override in use: <strong className="text-white">${Number(selectedProduct.suggested_price).toFixed(2)}</strong></p>
                  )}
                  {hasLiveCost && (
                    <p className="text-gray-500 text-xs pt-1">* material costs reflect current inventory prices</p>
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
            <label className="text-sm text-gray-400 mb-1 block">Sales channel</label>
            <select
              value={salesChannel}
              onChange={e => setSalesChannel(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-indigo-500"
            >
              {CHANNEL_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm text-gray-400 mb-1 block">Buyer / handle</label>
            <input
              type="text"
              value={buyerName}
              onChange={e => setBuyerName(e.target.value)}
              placeholder="e.g. Etsy username (optional)"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400 mb-1 block">Client <span className="text-gray-600">(optional, for repeat/commission)</span></label>
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

        </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-800 flex-shrink-0">
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
  )
}