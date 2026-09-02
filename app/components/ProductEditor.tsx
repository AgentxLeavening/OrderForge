'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { unitShort } from '@/lib/inventory'

type Props = {
  userId?: string | null
  product?: any
  onSaved?: () => void
  onCancel?: () => void
}

type InventoryOption = { id: string; name: string; sku?: string | null; unit?: string | null; unit_cost?: number | null }

export default function ProductEditor({ userId, product, onSaved, onCancel }: Props) {
  const [name, setName] = useState(product?.name || '')
  const [suggestedPrice, setSuggestedPrice] = useState(product?.suggested_price ?? '')
  const [estTime, setEstTime] = useState(product?.est_time ?? '')
  const [items, setItems] = useState<any[]>(product?.items || [])
  const [inventory, setInventory] = useState<InventoryOption[]>([])
  const [saving, setSaving] = useState(false)

  // Load the user's inventory (for the picker) and, when editing, this
  // template's existing BOM lines (ProductsPage doesn't fetch them).
  useEffect(() => {
    const load = async () => {
      const { data: inv } = await supabase
        .from('inventory_items')
        .select('id, name, sku, unit, unit_cost')
        .order('name', { ascending: true })
      setInventory((inv || []) as InventoryOption[])

      if (product?.id && !product?.items) {
        const { data: rows } = await supabase
          .from('product_items')
          .select('id, name, sku, quantity, unit_cost, inventory_item_id')
          .eq('product_id', product.id)
        setItems((rows || []) as any[])
      }
    }
    load()
  }, [product?.id, product?.items])

  const addItem = () => setItems(prev => [...prev, { name: '', quantity: 1, unit_cost: 0, inventory_item_id: null }])
  const updateItem = (idx: number, key: string, value: any) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, [key]: value } : it))
  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx))

  // Picking an inventory item snapshots its name/sku/cost onto the BOM line and
  // links it; "__custom" switches the line to a free-text name.
  const selectInventory = (idx: number, value: string) => {
    if (value === '__custom') {
      setItems(prev => prev.map((it, i) => i === idx ? { ...it, inventory_item_id: null, __custom: true } : it))
      return
    }
    if (!value) {
      setItems(prev => prev.map((it, i) => i === idx ? { ...it, inventory_item_id: null, __custom: false, name: '', sku: '' } : it))
      return
    }
    const inv = inventory.find(v => v.id === value)
    setItems(prev => prev.map((it, i) => i === idx ? {
      ...it,
      inventory_item_id: value,
      __custom: false,
      name: inv?.name || it.name,
      sku: inv?.sku || '',
      unit_cost: Number(inv?.unit_cost) || 0,
    } : it))
  }

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
      const normalizedItems = items
        .filter(it => (it.name && it.name.trim()) || it.inventory_item_id)
        .map(it => ({
          name: it.name,
          sku: it.sku || null,
          quantity: Number(it.quantity) || 0,
          unit_cost: Number(it.unit_cost) || 0,
          inventory_item_id: it.inventory_item_id || null,
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

  const inputClass = 'w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500'
  const cellClass = 'w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500'
  const labelClass = 'text-sm text-gray-400 mb-1 block'

  return (
    <div className="bg-gray-900 border border-gray-800 rounded p-4">
      <h2 className="text-white font-semibold mb-4">{product?.id ? 'Edit template' : 'New template'}</h2>

      <div className="space-y-4 mb-5">
        <div>
          <label className={labelClass}>Product name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Resin Trinket Tray" className={inputClass} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Suggested price ($) <span className="text-gray-600">(optional)</span></label>
            <input value={suggestedPrice} onChange={e => setSuggestedPrice(e.target.value)} type="number" step="0.01" placeholder="Auto from markup if blank" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Estimated time (hours) <span className="text-gray-600">(optional)</span></label>
            <input value={estTime} onChange={e => setEstTime(e.target.value)} type="number" step="0.25" placeholder="e.g. 1.5" className={inputClass} />
          </div>
        </div>
      </div>

      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-white font-semibold">Bill of Materials</h3>
          <button onClick={addItem} className="text-sm bg-indigo-600 hover:bg-indigo-700 px-2 py-1 rounded">+ Add item</button>
        </div>

        {items.length > 0 && (
          <div className="grid grid-cols-12 gap-2 px-1 mb-1 text-xs text-gray-500 uppercase tracking-wide">
            <div className="col-span-6">Item</div>
            <div className="col-span-2">Qty</div>
            <div className="col-span-3">Unit cost ($)</div>
            <div className="col-span-1" />
          </div>
        )}

        <div className="space-y-2">
          {items.map((it, idx) => {
            const linked = inventory.find(v => v.id === it.inventory_item_id)
            const isCustom = !it.inventory_item_id && (it.__custom || !!it.name)
            const u = linked ? unitShort(linked.unit) : ''
            return (
              <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                <div className="col-span-6 space-y-1">
                  <select
                    className={cellClass}
                    value={it.inventory_item_id || (isCustom ? '__custom' : '')}
                    onChange={e => selectInventory(idx, e.target.value)}
                  >
                    <option value="">Select inventory item…</option>
                    {inventory.map(v => (
                      <option key={v.id} value={v.id}>{v.name}{v.unit ? ` (${unitShort(v.unit)})` : ''}</option>
                    ))}
                    <option value="__custom">Custom item…</option>
                  </select>
                  {isCustom && (
                    <input className={cellClass} value={it.name} onChange={e => updateItem(idx, 'name', e.target.value)} placeholder="Custom item name" />
                  )}
                </div>
                <div className="col-span-2">
                  <input className={cellClass} value={it.quantity} onChange={e => updateItem(idx, 'quantity', Number(e.target.value))} type="number" />
                  {u && <span className="text-[10px] text-gray-500 pl-1">{u}</span>}
                </div>
                <input className={`col-span-3 ${cellClass}`} value={it.unit_cost} onChange={e => updateItem(idx, 'unit_cost', Number(e.target.value))} type="number" step="0.01" title={linked ? 'From inventory (editable)' : undefined} />
                <button className="col-span-1 text-red-500 hover:text-red-400 text-lg leading-none pt-1" onClick={() => removeItem(idx)} title="Remove">✕</button>
              </div>
            )
          })}
          {items.length === 0 && (
            <p className="text-gray-500 text-sm">No materials yet — add items to build the bill of materials.</p>
          )}
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="bg-gray-800 px-3 py-2 rounded">Cancel</button>
        <button onClick={handleSave} className="bg-indigo-600 px-3 py-2 rounded" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
      </div>
    </div>
  )
}
