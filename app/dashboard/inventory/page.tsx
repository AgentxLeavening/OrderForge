'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import HelpTour, { HelpButton } from '@/app/components/tour/HelpTour'
import { inventoryTour } from '@/app/components/tour/inventoryTour'
import { supabase } from '@/lib/supabase'
import { INVENTORY_CATEGORIES, INVENTORY_UNITS, categoryLabel, defaultUnitForCategory, unitShort, isLowStock, formatUnitCost } from '@/lib/inventory'

type Item = {
  id: string
  name: string
  sku?: string
  category?: string
  unit?: string
  quantity: number
  unit_cost: number
  reorder_threshold?: number | null
}

export default function InventoryPage() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Item | null>(null)
  const [showHelp, setShowHelp] = useState(false)

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
          <div className="flex items-center gap-4">
            <HelpButton onClick={() => setShowHelp(true)} />
            <button className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded" onClick={() => setEditing({} as any)}>
              + New Item
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-gray-400">Loading…</p>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            {/* Column headings belong to the desktop table only — on a phone
                each item is a stacked card, where headings would be noise. */}
            <div className="hidden md:grid grid-cols-12 gap-2 text-gray-400 text-xs uppercase tracking-wide px-2 mb-2">
              <div className="col-span-4">Name</div>
              <div className="col-span-2">Category</div>
              <div className="col-span-2">SKU</div>
              <div className="col-span-2 text-center">On hand</div>
              <div className="col-span-1 text-right">Cost</div>
              <div className="col-span-1" />
            </div>
            <div className="space-y-2">
              {items.map(it => (
                <div
                  key={it.id}
                  className="bg-gray-800 rounded-lg px-4 py-3 flex flex-col gap-2 md:grid md:grid-cols-12 md:gap-2 md:items-center md:space-y-0"
                >
                  {/* Phone: name and actions share the top line, so the
                      buttons have a fixed home instead of being squeezed into
                      a 1/12th column next to the cost. */}
                  <div className="flex items-start justify-between gap-2 md:contents">
                    <div className="md:col-span-4 text-white min-w-0 break-words">{it.name}</div>
                    <div className="flex items-center gap-3 shrink-0 md:col-span-1 md:order-last md:justify-end">
                      <button onClick={() => setEditing(it)} className="text-gray-400 hover:text-white text-sm">Edit</button>
                      <button onClick={() => remove(it.id)} className="text-red-500 hover:text-red-400 text-lg leading-none">×</button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 md:contents">
                    <div className="md:col-span-2">
                      <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">{categoryLabel(it.category).split(' ')[0]}</span>
                    </div>
                    <div className="md:col-span-2 text-gray-400 text-sm">
                      <span className="md:hidden text-gray-600">SKU </span>{it.sku || '—'}
                    </div>
                    <div className="md:col-span-2 md:text-center text-sm">
                      <span className={isLowStock(it) ? 'text-amber-400 font-medium' : 'text-white'}>{it.quantity}</span>
                      {' '}<span className="text-gray-500 text-xs">{unitShort(it.unit)}</span>
                      {isLowStock(it) && (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wide bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded-full">Low</span>
                      )}
                    </div>
                    <div className="md:col-span-1 md:text-right text-gray-400 text-sm">
                      ${formatUnitCost(it.unit_cost)}
                      <span className="md:hidden text-gray-600"> / {unitShort(it.unit)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sits under the list rather than in the header, where the arrow read
            as pointing at the Help button next to it. */}
        {!loading && (
          <div className="mt-3 flex justify-end">
            <Link href="/dashboard/reports/reorder" className="text-sm text-indigo-400 hover:text-indigo-300">Reorder list →</Link>
          </div>
        )}

        {showHelp && <HelpTour tour={inventoryTour} onClose={() => setShowHelp(false)} />}

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
  // What was paid for the whole amount on hand. Not stored — it only exists to
  // work out the cost per unit, so an existing item always opens with it blank.
  const [totalCost, setTotalCost] = useState('')
  const [reorderThreshold, setReorderThreshold] = useState(item?.reorder_threshold == null ? '' : String(item.reorder_threshold))

  const inputClass = 'w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500'
  const labelClass = 'text-sm text-gray-400 mb-1 block'

  // Picking a category snaps the unit to that category's default (user can still override).
  const onCategoryChange = (value: string) => {
    setCategory(value)
    setUnit(defaultUnitForCategory(value))
  }

  const u = unitShort(unit)

  // Sellers usually know what a spool or a roll cost them, not what a single
  // gram costs. Entering the total divides it by the quantity on hand; typing a
  // cost per unit yourself takes over again and clears the total, so the two
  // boxes can never disagree.
  const perUnit = (total: string, qty: string) => {
    const t = Number(total)
    const q = Number(qty)
    return total.trim() !== '' && t >= 0 && q > 0 ? String(Number((t / q).toFixed(6))) : null
  }
  const onQuantityChange = (v: string) => {
    setQuantity(v)
    const next = perUnit(totalCost, v)
    if (next !== null) setUnitCost(next)
  }
  const onTotalChange = (v: string) => {
    setTotalCost(v)
    const next = perUnit(v, quantity)
    if (next !== null) setUnitCost(next)
  }
  const onUnitCostChange = (v: string) => {
    setUnitCost(v)
    setTotalCost('')
  }

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

        <div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>Quantity on hand ({u})</label>
              <input value={quantity} onChange={e => onQuantityChange(e.target.value)} type="number" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Total paid ($) <span className="text-gray-600">(optional)</span></label>
              <input value={totalCost} onChange={e => onTotalChange(e.target.value)} type="number" step="any" placeholder="e.g. 15.00" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Cost per {u} ($)</label>
              <input value={unitCost} onChange={e => onUnitCostChange(e.target.value)} type="number" step="any" className={inputClass} />
            </div>
          </div>
          {totalCost.trim() === '' ? (
            <p className="text-gray-600 text-xs mt-1">Know the total you paid instead? Enter it and we&apos;ll work out the cost per {u}. Or type the cost per {u} yourself.</p>
          ) : perUnit(totalCost, quantity) !== null ? (
            <p className="text-indigo-300 text-xs mt-1">${totalCost} ÷ {quantity} {u} = ${formatUnitCost(perUnit(totalCost, quantity))} per {u}. Typing a cost per {u} yourself replaces this.</p>
          ) : (
            <p className="text-amber-400 text-xs mt-1">Enter the quantity on hand first, so the total can be divided.</p>
          )}
        </div>

        <div>
          <label className={labelClass}>Reorder threshold ({u}) <span className="text-gray-600">(optional)</span></label>
          <input value={reorderThreshold} onChange={e => setReorderThreshold(e.target.value)} type="number" placeholder="Leave blank for no alert" className={inputClass} />
          <p className="text-gray-600 text-xs mt-1">Warn on the dashboard when on-hand quantity drops to or below this.</p>
        </div>
      </div>

      <div className="flex gap-3">
        <button onClick={() => onSave({ id: item.id, name, sku, category, unit, quantity: Number(quantity || 0), unit_cost: Number(unitCost || 0), reorder_threshold: reorderThreshold.trim() === '' ? null : Number(reorderThreshold) })} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded">Save</button>
        <button onClick={onCancel} className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded">Cancel</button>
      </div>
    </div>
  )
}
