'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const LINKS = [
  { href: '/dashboard', label: 'Dashboard', hint: 'Order board and what needs attention' },
  { href: '/dashboard/schedule', label: 'Schedule', hint: 'What’s late, due today, due this week' },
  { href: '/dashboard/clients', label: 'Clients', hint: 'Customers and what they owe' },
  { href: '/dashboard/products', label: 'Products', hint: 'Templates and their materials' },
  { href: '/dashboard/inventory', label: 'Inventory', hint: 'Stock on hand and low-stock alerts' },
  { href: '/dashboard/expenses', label: 'Expenses', hint: 'Money out, receipts, subscriptions' },
  { href: '/dashboard/reports', label: 'Reports', hint: 'Profitability, reorder list, tax export' },
  { href: '/dashboard/settings', label: 'Settings', hint: 'Pricing, payments, marketplaces' },
]

export default function DashboardNav() {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // Navigating closes the menu — without this it stays open over the page you
  // just asked for.
  useEffect(() => { setOpen(false) }, [pathname])

  // Escape and clicks outside close it, the two things people try when a menu
  // is in the way.
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

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Longest match wins, so /dashboard/expenses doesn't also light up Dashboard.
  const activeHref = LINKS
    .filter(l => pathname === l.href || pathname.startsWith(`${l.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href

  return (
    <header className="bg-gray-900 border-b border-gray-800 relative">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3" ref={panelRef}>
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            aria-controls="main-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="p-2 -ml-2 rounded-lg text-gray-300 hover:text-white hover:bg-gray-800 transition focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="w-5 h-5" aria-hidden="true">
              {open ? (
                <>
                  <line x1="5" y1="5" x2="15" y2="15" />
                  <line x1="15" y1="5" x2="5" y2="15" />
                </>
              ) : (
                <>
                  <line x1="3" y1="6" x2="17" y2="6" />
                  <line x1="3" y1="10" x2="17" y2="10" />
                  <line x1="3" y1="14" x2="17" y2="14" />
                </>
              )}
            </svg>
          </button>

          <Link href="/dashboard" className="text-indigo-400 font-bold">OrderForge</Link>

          {/* The current page's name, so the header still says where you are
              once the links are behind the menu. */}
          {activeHref && activeHref !== '/dashboard' && (
            <span className="text-gray-500 text-sm hidden sm:inline">
              · {LINKS.find(l => l.href === activeHref)?.label}
            </span>
          )}

          {open && (
            <div
              id="main-menu"
              className="absolute left-4 top-full mt-1 z-50 w-72 bg-gray-900 border border-gray-700 rounded-2xl shadow-xl shadow-black/40 p-2"
            >
              {LINKS.map(l => {
                const active = l.href === activeHref
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={`block px-3 py-2.5 rounded-xl transition ${
                      active ? 'bg-indigo-500/15 text-indigo-300' : 'text-gray-200 hover:bg-gray-800'
                    }`}
                  >
                    <span className="text-sm font-medium">{l.label}</span>
                    <span className="block text-xs text-gray-500">{l.hint}</span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        <button
          onClick={signOut}
          className="text-gray-400 hover:text-white text-sm border border-gray-700 hover:border-gray-500 rounded-lg px-3 py-1.5 transition shrink-0"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
