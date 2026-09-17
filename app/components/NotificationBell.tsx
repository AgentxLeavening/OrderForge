'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type Notification = {
  id: string
  kind: 'order_new' | 'order_status' | 'payment' | 'quote_response'
  title: string
  body: string | null
  order_id: string | null
  read_at: string | null
  created_at: string
}

const ICONS: Record<Notification['kind'], string> = {
  order_new: '🛒',
  order_status: '📦',
  payment: '💵',
  quote_response: '✍️',
}

/** "just now", "12m", "3h", "2d" — enough to judge freshness at a glance. */
function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/**
 * Notification bell: what happened while the seller wasn't looking.
 *
 * Only events they didn't cause themselves appear — marketplace imports,
 * customers answering quotes, card payments landing, statuses moving on their
 * own. That rule lives in the database triggers (migration 036), so every
 * source counts equally and nothing has to be repeated per code path.
 */
export default function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('notifications')
      .select('id, kind, title, body, order_id, read_at, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)
    setItems((data || []) as Notification[])
  }, [])

  useEffect(() => {
    load()
    // A poll rather than a live subscription: this is a dashboard someone
    // leaves open, and a minute's delay on "an order arrived" costs nothing.
    const timer = setInterval(load, 60_000)
    // Coming back to the tab is exactly when you want it current.
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [load])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick) }
  }, [open])

  const unread = items.filter(n => !n.read_at)

  const markAllRead = async () => {
    const ids = unread.map(n => n.id)
    if (ids.length === 0) return
    setItems(prev => prev.map(n => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })))
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids)
  }

  const markRead = async (id: string) => {
    setItems(prev => prev.map(n => (n.id === id ? { ...n, read_at: n.read_at || new Date().toISOString() } : n)))
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={unread.length > 0 ? `Notifications, ${unread.length} unread` : 'Notifications'}
        className="relative p-2 rounded-lg text-gray-300 hover:text-white hover:bg-gray-800 transition focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
          <path d="M10 3a4.5 4.5 0 0 0-4.5 4.5c0 3-1.2 4.2-1.7 4.7-.2.2-.06.55.22.55h11.96c.28 0 .42-.35.22-.55-.5-.5-1.7-1.7-1.7-4.7A4.5 4.5 0 0 0 10 3Z" />
          <path d="M8.3 15.2a1.9 1.9 0 0 0 3.4 0" />
        </svg>
        {unread.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-indigo-500 text-white text-[10px] font-semibold rounded-full flex items-center justify-center">
            {unread.length > 9 ? '9+' : unread.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-80 max-w-[calc(100vw-2rem)] bg-gray-900 border border-gray-700 rounded-2xl shadow-xl shadow-black/40 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800">
            <span className="text-white text-sm font-semibold">Activity</span>
            {unread.length > 0 && (
              <button onClick={markAllRead} className="text-xs text-indigo-400 hover:text-indigo-300">Mark all read</button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="text-gray-500 text-sm px-4 py-6 text-center">
              Nothing yet. Orders arriving, customers answering quotes and card payments all show up here.
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {items.map(n => {
                const row = (
                  <div className={`flex gap-3 px-4 py-3 border-b border-gray-800/70 ${n.read_at ? '' : 'bg-indigo-500/5'}`}>
                    <span className="text-base leading-none mt-0.5">{ICONS[n.kind]}</span>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm truncate ${n.read_at ? 'text-gray-300' : 'text-white font-medium'}`}>{n.title}</p>
                      {n.body && <p className="text-gray-500 text-xs truncate">{n.body}</p>}
                    </div>
                    <span className="text-gray-600 text-[11px] shrink-0">{ago(n.created_at)}</span>
                  </div>
                )
                return n.order_id ? (
                  <Link key={n.id} href={`/dashboard/orders/${n.order_id}`} onClick={() => markRead(n.id)} className="block hover:bg-gray-800/60 transition">
                    {row}
                  </Link>
                ) : (
                  <div key={n.id} onClick={() => markRead(n.id)} className="cursor-default">{row}</div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
