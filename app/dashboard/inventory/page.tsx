'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { INVENTORY_CATEGORIES, INVENTORY_UNITS, categoryLabel, defaultUnitForCategory, unitShort } from '@/lib/inventory'

type Item = {
  id: string
  name: string
  sku?: string
  category?: string
  unit?: string
  quantity: number
  unit_cost: number
}

export default function InventoryPage() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Item | null>(null)

  const fetch = async () => {
    const { data } = await supabase.from('inventory_items').select('*').order('created_at', { ascending: false })
    setItems(data || [])
    setLoading(false)
  }

  useEffect(() => { fetch() }, [])

  const save = async (item: Partial<Item>) => {
    try {
      // determine current user for audit logging
      const { data: userData } = await supabase.auth.getUser()
      const userId = (userData as any)?.user?.id || null

      if (item.id) {
        // fetch previous row to record previous quantity
        const { data: prev } = await supabase.from('inventory_items').select('id, quantity, name, sku').eq('id', item.id).single()
        const prevQty = Number((prev as any)?.quantity ?? 0)

        const { data: updated, error: updErr } = await supabase.from('inventory_items').update(item).eq('id', item.id).select().single()
        if (updErr) {
          console.warn('Failed updating inventory item', updErr)
        } else {
          const newQty = Number((updated as any)?.quantity ?? 0)
          const change = Number(newQty) - Number(prevQty)
          // insert transaction
          try {
            await supabase.from('inventory_transactions').insert({
              inventory_item_id: item.id,
              user_id: userId,
              order_id: null,
              change,
              previous_quantity: prevQty,
              new_quantity: newQty,
              reason: 'manual_edit',
              metadata: { name: item.name || prev?.name, sku: item.sku || prev?.sku }
            })
          } catch (txErr) {
            console.warn('Failed inserting inventory transaction', txErr)
          }
        }
      } else {
        // insert new item and log creation (user_id is required — NOT NULL)
        if (!userId) {
          console.warn('Cannot create inventory item: no signed-in user')
          setEditing(null)
          return
        }
        const { data: insData, error: insErr } = await supabase.from('inventory_items').insert({ ...item, user_id: userId }).select().single()
        if (insErr) console.warn('Failed inserting inventory item', insErr)
        else {
          const newId = (insData as any)?.id
          const newQty = Number((insData as any)?.quantity ?? 0)
          try {
            await supabase.from('inventory_transactions').insert({
              inventory_item_id: newId,
              user_id: userId,
              order_id: null,
              change: newQty,
              previous_quantity: null,
              new_quantity: newQty,
              reason: 'manual_create',
              metadata: { name: insData.name, sku: insData.sku }
            })
          } catch (txErr) {
            console.warn('Failed inserting inventory transaction for new item', txErr)
          }
        }
      }
    } catch (e) {
      console.warn('Save inventory error', e)
    }

    setEditing(null)
    await fetch()
  }

  const remove = async (id: string) => {
    if (!confirm('Delete inventory item?')) return
    try {
      const { data: userData } = await supabase.auth.getUser()
      const userId = (userData as any)?.user?.id || null

      const { data: prev } = await supabase.from('inventory_items').select('id, quantity, name, sku').eq('id', id).single()
      const prevQty = Number((prev as any)?.quantity ?? 0)

      const { error } = await supabase.from('inventory_items').delete().eq('id', id)
      if (error) console.warn('Failed deleting inventory item', error)
      else {
        try {
          // The item is already gone, so we can't reference it via the FK
          // (inventory_item_id is nullable + ON DELETE SET NULL per migration 008).
          // The name/sku are preserved in metadata for the transactions viewer.
          await supabase.from('inventory_transactions').insert({
            inventory_item_id: null,
            user_id: userId,
            order_id: null,
            change: -Math.abs(prevQty),
            previous_quantity: prevQty,
            new_quantity: null,
            reason: 'manual_delete',
            metadata: { name: prev?.name, sku: prev?.sku }
          })
        } catch (txErr) {
          console.warn('Failed inserting deletion transaction', txErr)
        }
      }
    } catch (e) {
      console.warn('Remove inventory error', e)
    }

    await fetch()
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">Inventory</h1>
          <button className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded" onClick={() => setEditing({} as any)}>
            + New Item
          </button>
        </div>

        {loading ? (
          <p className="text-gray-400">Loading…</p>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <div className="grid grid-cols-12 gap-2 text-gray-400 text-xs uppercase tracking-wide px-2 mb-2">
              <div className="col-span-4">Name</div>
              <div className="col-span-2">Category</div>
              <div className="col-span-2">SKU</div>
              <div className="col-span-2 text-center">On hand</div>
              <div className="col-span-1 text-right">Cost</div>
              <div className="col-span-1" />
            </div>
            <div className="space-y-2">
              {items.map(it => (
                <div key={it.id} className="grid grid-cols-12 gap-2 items-center bg-gray-800 rounded-lg px-4 py-3">
                  <div className="col-span-4 text-white">{it.name}</div>
                  <div className="col-span-2">
                    <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">{categoryLabel(it.category).split(' ')[0]}</span>
                  </div>
                  <div className="col-span-2 text-gray-400">{it.sku || '—'}</div>
                  <div className="col-span-2 text-center text-white">{it.quantity} <span className="text-gray-500 text-xs">{unitShort(it.unit)}</span></div>
                  <div className="col-span-1 text-right text-gray-400">${Number(it.unit_cost || 0).toFixed(2)}</div>
                  <div className="col-span-1 flex items-center justify-end gap-2">
                    <button onClick={() => setEditing(it)} className="text-gray-400 hover:text-white">Edit</button>
                    <button onClick={() => remove(it.id)} className="text-red-500 hover:text-red-400">×</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {editing && (
          <div className="mt-6 bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <InventoryForm item={editing} onSave={save} onCancel={() => setEditing(null)} />
          </div>
        )}
      </div>
    </div>
  )
}

function InventoryForm({ item, onSave, onCancel }: { item: Partial<Item>, onSave: (i: Partial<Item>) => Promise<void>, onCancel: () => void }) {
  const [name, setName] = useState(item?.name || '')
  const [sku, setSku] = useState(item?.sku || '')
  const [category, setCategory] = useState(item?.category || 'material')
  const [unit, setUnit] = useState(item?.unit || defaultUnitForCategory(item?.category || 'material'))
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 0))
  const [unitCost, setUnitCost] = useState(String(item?.unit_cost ?? 0))

  const inputClass = 'w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500'
  const labelClass = 'text-sm text-gray-400 mb-1 block'

  // Picking a category snaps the unit to that category's default (user can still override).
  const onCategoryChange = (value: string) => {
    setCategory(value)
    setUnit(defaultUnitForCategory(value))
  }

  const u = unitShort(unit)

  return (
    <div>
      <h2 className="text-white font-semibold mb-4">{item?.id ? 'Edit item' : 'New item'}</h2>

      <div className="space-y-4 mb-6">
        <div>
          <label className={labelClass}>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Black PLA filament" className={inputClass} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Category</label>
            <select value={category} onChange={e => onCategoryChange(e.target.value)} className={inputClass}>
              {INVENTORY_CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Unit of measure</label>
            <select value={unit} onChange={e => setUnit(e.target.value)} className={inputClass}>
              {INVENTORY_UNITS.map(un => (
                <option key={un.value} value={un.value}>{un.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={labelClass}>SKU <span className="text-gray-600">(optional)</span></label>
          <input value={sku} onChange={e => setSku(e.target.value)} placeholder="Optional stock code" className={inputClass} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Quantity on hand ({u})</label>
            <input value={quantity} onChange={e => setQuantity(e.target.value)} type="number" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Cost per {u} ($)</label>
            <input value={unitCost} onChange={e => setUnitCost(e.target.value)} type="number" step="0.01" className={inputClass} />
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button onClick={() => onSave({ id: item.id, name, sku, category, unit, quantity: Number(quantity || 0), unit_cost: Number(unitCost || 0) })} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded">Save</button>
        <button onClick={onCancel} className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded">Cancel</button>
      </div>
    </div>
  )
}
