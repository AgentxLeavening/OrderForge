'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Item = {
  id: string
  name: string
  sku?: string
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
              <div className="col-span-5">Name</div>
              <div className="col-span-2">SKU</div>
              <div className="col-span-2 text-center">Qty</div>
              <div className="col-span-2 text-right">Unit</div>
              <div className="col-span-1" />
            </div>
            <div className="space-y-2">
              {items.map(it => (
                <div key={it.id} className="grid grid-cols-12 gap-2 items-center bg-gray-800 rounded-lg px-4 py-3">
                  <div className="col-span-5 text-white">{it.name}</div>
                  <div className="col-span-2 text-gray-400">{it.sku || '—'}</div>
                  <div className="col-span-2 text-center text-white">{it.quantity}</div>
                  <div className="col-span-2 text-right text-gray-400">${Number(it.unit_cost || 0).toFixed(2)}</div>
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
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 0))
  const [unitCost, setUnitCost] = useState(String(item?.unit_cost ?? 0))

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white" />
        <input value={sku} onChange={e => setSku(e.target.value)} placeholder="SKU" className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white" />
        <input value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="Quantity" type="number" className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white" />
        <input value={unitCost} onChange={e => setUnitCost(e.target.value)} placeholder="Unit cost" type="number" step="0.01" className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white" />
      </div>

      <div className="flex gap-3">
        <button onClick={() => onSave({ id: item.id, name, sku, quantity: Number(quantity || 0), unit_cost: Number(unitCost || 0) })} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded">Save</button>
        <button onClick={onCancel} className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded">Cancel</button>
      </div>
    </div>
  )
}
