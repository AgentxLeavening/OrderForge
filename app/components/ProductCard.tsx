'use client'

import Link from 'next/link'
import { formatUnitCost } from '@/lib/inventory'

type ProductItem = {
  id?: string
  name: string
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

export default function ProductCard({ product, onEdit, onDelete, compact = false }: { product: Product, onEdit?: (p: any) => void, onDelete?: (p: any) => void, compact?: boolean }) {
  const totalCost = (product.items || []).reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_cost) || 0), 0)

  return (
    <div className={`bg-gray-900 border border-gray-800 rounded p-4 ${compact ? 'text-sm' : ''}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-white font-semibold">{product.name}</div>
          <div className="text-gray-400 text-xs">Material cost: ${totalCost.toFixed(2)}{product.suggested_price ? ` • Suggested: $${Number(product.suggested_price).toFixed(2)}` : ''}</div>
        </div>

        <div className="flex items-center gap-2">
          {onEdit && <button onClick={() => onEdit(product)} className="text-sm px-2 py-1 bg-gray-800 rounded hover:bg-gray-700">Edit</button>}
          {onDelete && <button onClick={() => onDelete(product)} className="text-sm px-2 py-1 bg-red-600 rounded hover:bg-red-700">Delete</button>}
        </div>
      </div>

      {!compact && (
        <div className="mt-3">
          <div className="text-gray-400 text-xs mb-2">Bill of materials</div>
          <ul className="space-y-1">
            {(product.items || []).map((it, i) => (
              <li key={i} className="flex items-center justify-between">
                <span className="text-gray-200">{it.name} × {it.quantity}</span>
                <span className="text-gray-400">${formatUnitCost(it.unit_cost)}</span>
              </li>
            ))}
            {(product.items || []).length === 0 && (
              <li className="text-gray-500">No items</li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
