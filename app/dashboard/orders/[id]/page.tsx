'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { generateInvoicePdf } from '@/lib/generateInvoicePdf'
import { CHANNEL_OPTIONS } from '@/app/components/NewOrderModal'


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
  buyer_name: string | null
  suggested_price: number | null
  material_cost: number | null
  labor_cost: number | null
  markup: number | null
  fee_pct: number | null
}

type LineItem = {
  id: string
  description: string
  quantity: number
  unit_price: number
}

type ClientOption = {
  id: string
  name: string
}

const TYPE_OPTIONS = [
  { value: 'commission', label: '🎨 Commission / Craft' },
  { value: 'print_job', label: '🖨️ 3D Print Job' },
  { value: 'card_lot', label: '🃏 Card Lot' },
  { value: 'wholesale', label: '📦 Wholesale' },
  { value: 'other', label: '📋 Other' },
]

const STATUS_OPTIONS = [
  { value: 'inquiry', label: 'Inquiry' },
  { value: 'quoted', label: 'Quoted' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'complete', label: 'Complete' },
]

const STATUS_COLORS: Record<string, string> = {
  inquiry: 'bg-gray-700 text-gray-300',
  quoted: 'bg-yellow-500/20 text-yellow-400',
  in_progress: 'bg-blue-500/20 text-blue-400',
  complete: 'bg-green-500/20 text-green-400',
}

const channelLabel = (value: string | null | undefined) =>
  CHANNEL_OPTIONS.find(o => o.value === (value || ''))?.label ?? (value || '')

export default function OrderDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [order, setOrder] = useState<Order | null>(null)
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Editable fields
  const [title, setTitle] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [clientId, setClientId] = useState('')
  const [salesChannel, setSalesChannel] = useState('')
  const [buyerName, setBuyerName] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')

  // New line item
  const [newDesc, setNewDesc] = useState('')
  const [newQty, setNewQty] = useState('1')
  const [newPrice, setNewPrice] = useState('')

  useEffect(() => {
    const fetchOrder = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: orderData } = await supabase
        .from('orders')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

      if (!orderData) { router.push('/dashboard'); return }

      const { data: clients } = await supabase
        .from('clients')
        .select('id, name')
        .eq('user_id', user.id)
        .order('name', { ascending: true })

      setClientOptions(clients || [])
      setOrder(orderData)
      setTitle(orderData.title)
      setType(orderData.type)
      setStatus(orderData.status)
      setClientId(orderData.client_id || '')
      setSalesChannel(orderData.sales_channel || '')
      setBuyerName(orderData.buyer_name || '')
      setDueDate(orderData.due_date || '')
      setNotes(orderData.notes || '')

      const { data: items } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', id)
        .order('created_at', { ascending: true })

      setLineItems(items || [])
      setLoading(false)
    }

    fetchOrder()
  }, [id, router])

  const saveOrder = async () => {
    setSaving(true)
    await supabase
      .from('orders')
      .update({
        title,
        type,
        status,
        client_id: clientId || null,
        sales_channel: salesChannel || null,
        buyer_name: buyerName.trim() || null,
        due_date: dueDate || null,
        notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const addLineItem = async () => {
    if (!newDesc.trim() || !newPrice) return

    const { data } = await supabase
      .from('order_items')
      .insert({
        order_id: id,
        description: newDesc,
        quantity: parseFloat(newQty),
        unit_price: parseFloat(newPrice),
      })
      .select()
      .single()

    if (data) {
      setLineItems(prev => [...prev, data])
      setNewDesc('')
      setNewQty('1')
      setNewPrice('')
    }
  }

  const removeLineItem = async (itemId: string) => {
    await supabase.from('order_items').delete().eq('id', itemId)
    setLineItems(prev => prev.filter(i => i.id !== itemId))
  }

  // Adjust a line's billing quantity after the fact. This only changes what the
  // order/invoice bills — it does not re-deduct inventory (that happened at
  // creation from the product BOM), so treat it as a manual billing correction.
  const updateLineItemQty = async (itemId: string, value: string) => {
    const qty = Math.max(1, Number(value) || 1)
    setLineItems(prev => prev.map(i => (i.id === itemId ? { ...i, quantity: qty } : i)))
    await supabase.from('order_items').update({ quantity: qty }).eq('id', itemId)
  }

  const total = lineItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </div>
    )
  }
const handleGenerateInvoice = async () => {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !order) return

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, business_name, default_tax_rate')
    .eq('id', user.id)
    .single()

  const { data: clientData } = clientId
    ? await supabase
        .from('clients')
        .select('name, email')
        .eq('id', clientId)
        .single()
    : { data: null }

  const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`
  const subtotal = lineItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
  const taxRate = profile?.default_tax_rate || 0
  const taxAmount = subtotal * (taxRate / 100)
  const total = subtotal + taxAmount

  // Save invoice to Supabase
  await supabase.from('invoices').insert({
    user_id: user.id,
    order_id: id,
    invoice_number: invoiceNumber,
    status: 'draft',
    subtotal,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    total,
    balance_due: total,
    due_date: dueDate || null,
    notes,
  })

  // Generate PDF
  const pdfBytes = await generateInvoicePdf({
    invoiceNumber,
    businessName: profile?.business_name || 'My Shop',
    ownerName: profile?.name || '',
    clientName: clientData?.name || buyerName || undefined,
    clientEmail: clientData?.email || undefined,
    salesChannel: salesChannel ? channelLabel(salesChannel) : undefined,
    createdAt: new Date().toLocaleDateString(),
    dueDate: dueDate ? new Date(dueDate).toLocaleDateString() : undefined,
    lineItems,
    notes: notes || undefined,
    taxRate,
  })

  // Download it
  const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${invoiceNumber}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}
  return (
    <div className="min-h-screen bg-gray-950">
      <main className="max-w-4xl mx-auto px-6 py-10">
        {/* Order Header */}
        <div className="flex items-start justify-between mb-8 gap-4">
          <div className="flex-1">
            <p className="text-gray-500 text-sm mb-1">{order?.order_number}</p>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="text-3xl font-bold text-white bg-transparent border-b border-transparent hover:border-gray-700 focus:border-indigo-500 focus:outline-none w-full pb-1 transition"
            />
            {(buyerName || salesChannel) && (
              <div className="flex flex-wrap items-center gap-2 mt-3">
                {buyerName && (
                  <span className="text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded-full">🛒 {buyerName}</span>
                )}
                {salesChannel && (
                  <span className="text-xs bg-indigo-500/15 text-indigo-300 px-2 py-1 rounded-full">{channelLabel(salesChannel)}</span>
                )}
              </div>
            )}
          </div>
          <button
            onClick={saveOrder}
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-5 py-2.5 rounded-lg transition disabled:opacity-50 shrink-0"
          >
            {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Changes'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Order Details */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
            <h2 className="text-white font-semibold mb-4">Order Details</h2>

            <div>
              <label className="text-sm text-gray-400 mb-1 block">Type</label>
              <select
                value={type}
                onChange={e => setType(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500"
              >
                {TYPE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm text-gray-400 mb-1 block">Sales channel</label>
              <select
                value={salesChannel}
                onChange={e => setSalesChannel(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500"
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
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="text-sm text-gray-400 mb-1 block">Client <span className="text-gray-600">(optional)</span></label>
              <select
                value={clientId}
                onChange={e => setClientId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">No client selected</option>
                {clientOptions.map(client => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm text-gray-400 mb-1 block">Status</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500"
              >
                {STATUS_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm text-gray-400 mb-1 block">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500"
              />
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
              placeholder="Order notes, customer requests, reference details..."
            />
          </div>
        </div>

        {/* Pricing & Margin (internal — from the suggested price basis) */}
        {order && (order.suggested_price != null || order.material_cost != null) && (() => {
          const price = Number(order.suggested_price) || 0
          const material = Number(order.material_cost) || 0
          const labor = Number(order.labor_cost) || 0
          const cost = material + labor
          const feeAmt = price * (Number(order.fee_pct) || 0) / 100
          const profit = price - cost - feeAmt
          const marginPct = price > 0 ? (profit / price) * 100 : 0
          return (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
              <h2 className="text-white font-semibold mb-4">Pricing &amp; Margin</h2>
              <div className="space-y-1.5 max-w-md">
                <div className="flex justify-between text-sm text-gray-300"><span>Materials</span><span>${material.toFixed(2)}</span></div>
                <div className="flex justify-between text-sm text-gray-300"><span>Labor</span><span>${labor.toFixed(2)}</span></div>
                <div className="flex justify-between text-sm text-gray-400 border-t border-gray-800 pt-1.5"><span>Cost</span><span>${cost.toFixed(2)}</span></div>
                {order.markup != null && <div className="flex justify-between text-sm text-gray-500"><span>Markup</span><span>×{Number(order.markup)}</span></div>}
                {order.fee_pct != null && <div className="flex justify-between text-sm text-gray-500"><span>Marketplace fee ({Number(order.fee_pct)}%)</span><span>−${feeAmt.toFixed(2)}</span></div>}
                <div className="flex justify-between text-sm text-gray-300 border-t border-gray-800 pt-1.5"><span>Suggested price</span><span className="text-white font-semibold">${price.toFixed(2)}</span></div>
                <div className="flex justify-between text-sm border-t border-gray-800 pt-1.5">
                  <span className="text-gray-300">Est. profit</span>
                  <span className={profit >= 0 ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>${profit.toFixed(2)} ({marginPct.toFixed(0)}%)</span>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Line Items */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
          <h2 className="text-white font-semibold mb-4">Line Items</h2>

          {/* Header */}
          {lineItems.length > 0 && (
            <div className="grid grid-cols-12 gap-2 mb-2 px-1">
              <p className="col-span-6 text-gray-500 text-xs uppercase tracking-wide">Description</p>
              <p className="col-span-2 text-gray-500 text-xs uppercase tracking-wide text-center">Qty</p>
              <p className="col-span-2 text-gray-500 text-xs uppercase tracking-wide text-right">Price</p>
              <p className="col-span-2 text-gray-500 text-xs uppercase tracking-wide text-right">Total</p>
            </div>
          )}

          {/* Items */}
          <div className="space-y-2 mb-4">
            {lineItems.length === 0 && (
              <p className="text-gray-600 text-sm text-center py-4">No line items yet — add one below</p>
            )}
            {lineItems.map(item => (
              <div key={item.id} className="grid grid-cols-12 gap-2 items-center bg-gray-800 rounded-lg px-4 py-3">
                <p className="col-span-6 text-white text-sm">{item.description}</p>
                <input
                  value={item.quantity}
                  onChange={e => updateLineItemQty(item.id, e.target.value)}
                  type="number"
                  min="1"
                  className="col-span-2 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-gray-200 text-sm text-center focus:outline-none focus:border-indigo-500"
                />
                <p className="col-span-2 text-gray-400 text-sm text-right">${item.unit_price.toFixed(2)}</p>
                <div className="col-span-2 flex items-center justify-end gap-2">
                  <p className="text-white text-sm font-medium">${(item.quantity * item.unit_price).toFixed(2)}</p>
                  <button
                    onClick={() => removeLineItem(item.id)}
                    className="text-gray-600 hover:text-red-400 transition text-lg leading-none"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Add Line Item */}
          <div className="grid grid-cols-12 gap-2 items-center border-t border-gray-800 pt-4">
            <input
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="Description"
              className="col-span-6 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500"
            />
            <input
              value={newQty}
              onChange={e => setNewQty(e.target.value)}
              placeholder="Qty"
              type="number"
              min="1"
              className="col-span-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500 text-center"
            />
            <input
              value={newPrice}
              onChange={e => setNewPrice(e.target.value)}
              placeholder="Price"
              type="number"
              min="0"
              step="0.01"
              className="col-span-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500 text-right"
            />
            <button
              onClick={addLineItem}
              className="col-span-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg transition text-sm"
            >
              + Add
            </button>
          </div>

          {/* Total */}
          {lineItems.length > 0 && (
            <div className="flex justify-end mt-4 pt-4 border-t border-gray-800">
              <div className="text-right">
                <p className="text-gray-400 text-sm">Order Total</p>
                <p className="text-white text-2xl font-bold">${total.toFixed(2)}</p>
              </div>
            </div>
          )}
        </div>

              {/* Invoice Button */}
        <div className="flex justify-end">
          <button
            onClick={handleGenerateInvoice}
            className="bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-3 rounded-lg transition"
          >
            Generate Invoice →
          </button>
        </div>
      </main>
    </div>
  )
}