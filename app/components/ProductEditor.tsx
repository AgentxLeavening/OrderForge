'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

type Props = {
  userId?: string | null
  product?: any
  onSaved?: () => void
  onCancel?: () => void
}

export default function ProductEditor({ userId, product, onSaved, onCancel }: Props) {
  const [name, setName] = useState(product?.name || '')
  const [suggestedPrice, setSuggestedPrice] = useState(product?.suggested_price ?? '')
  const [estTime, setEstTime] = useState(product?.est_time ?? '')
  const [items, setItems] = useState<any[]>(product?.items || [])
  const [saving, setSaving] = useState(false)

  const addItem = () => setItems(prev => [...prev, { name: '', quantity: 1, unit_cost: 0 }])
  const updateItem = (idx: number, key: string, value: any) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, [key]: value } : it))
  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx))

  const handleSave = async () => {
    let effectiveUserId = userId
    if (!effectiveUserId) {
      try {
        const { data: ud } = await supabase.auth.getUser()
        effectiveUserId = (ud as any)?.user?.id || null
      } catch (e) {
        console.warn('failed getting user', e)
      }
    }

    if (!effectiveUserId) return alert('Sign in before creating a product template')
    setSaving(true)

    try {
      // normalize numeric fields
      const sp = suggestedPrice === '' || suggestedPrice == null ? null : Number(suggestedPrice)
      const et = estTime === '' || estTime == null ? null : Number(estTime)
      const normalizedItems = items.map(it => ({
        name: it.name,
        quantity: Number(it.quantity) || 0,
        unit_cost: Number(it.unit_cost) || 0,
      }))

      if (product?.id) {
        const { error: updErr } = await supabase.from('products').update({ name, suggested_price: sp, est_time: et }).eq('id', product.id)
        if (updErr) throw updErr

        const { error: delErr } = await supabase.from('product_items').delete().eq('product_id', product.id)
        if (delErr) throw delErr

        const inserts = normalizedItems.map(it => ({ product_id: product.id, ...it }))
        if (inserts.length) {
          const { error: insItemsErr } = await supabase.from('product_items').insert(inserts)
          if (insItemsErr) throw insItemsErr
        }
      } else {
        const { data: prodData, error: prodErr } = await supabase.from('products').insert({ user_id: effectiveUserId, name, suggested_price: sp, est_time: et }).select('id').single()
        if (prodErr) throw prodErr
        const prodId = (prodData as any)?.id
        if (prodId && normalizedItems.length) {
          const inserts = normalizedItems.map(it => ({ product_id: prodId, ...it }))
          const { error: insItemsErr } = await supabase.from('product_items').insert(inserts)
          if (insItemsErr) throw insItemsErr
        }
      }
      onSaved && onSaved()
    } catch (e) {
      console.warn('save product error', e)
      // try to show a helpful message
      const msg = (e && (e as any).message) ? (e as any).message : JSON.stringify(e)
      alert('Failed saving product: ' + msg)
    }

    setSaving(false)
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded p-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Product name" className="col-span-2 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white" />
        <input value={suggestedPrice} onChange={e => setSuggestedPrice(e.target.value)} placeholder="Suggested price" className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white" />
      </div>

      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-white font-semibold">Bill of Materials</h3>
          <button onClick={addItem} className="text-sm bg-indigo-600 px-2 py-1 rounded">Add item</button>
        </div>

        <div className="space-y-2">
          {items.map((it, idx) => (
            <div key={idx} className="grid grid-cols-5 gap-2 items-center">
              <input className="col-span-2 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white" value={it.name} onChange={e => updateItem(idx, 'name', e.target.value)} placeholder="Item name" />
              <input className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white" value={it.quantity} onChange={e => updateItem(idx, 'quantity', Number(e.target.value))} type="number" />
              <input className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white" value={it.unit_cost} onChange={e => updateItem(idx, 'unit_cost', Number(e.target.value))} type="number" />
              <button className="text-red-500" onClick={() => removeItem(idx)}>Remove</button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="bg-gray-800 px-3 py-2 rounded">Cancel</button>
        <button onClick={handleSave} className="bg-indigo-600 px-3 py-2 rounded" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
      </div>
    </div>
  )
}
