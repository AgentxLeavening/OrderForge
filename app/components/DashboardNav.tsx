'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import NotificationBell from './NotificationBell'

// 20x20 stroke icons, one per link. In the collapsed rail they're all that's
// left, so each has to be recognisable on its own.
const ICONS: Record<string, ReactNode> = {
  '/dashboard': <><rect x="3" y="3" width="5.5" height="5.5" rx="1" /><rect x="11.5" y="3" width="5.5" height="5.5" rx="1" /><rect x="3" y="11.5" width="5.5" height="5.5" rx="1" /><rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1" /></>,
  '/dashboard/schedule': <><rect x="3" y="4.5" width="14" height="12.5" rx="1.5" /><line x1="3" y1="8.5" x2="17" y2="8.5" /><line x1="7" y1="2.5" x2="7" y2="6" /><line x1="13" y1="2.5" x2="13" y2="6" /></>,
  '/dashboard/clients': <><circle cx="10" cy="7" r="3" /><path d="M4 16.5c0-3 2.7-4.7 6-4.7s6 1.7 6 4.7" /></>,
  '/dashboard/products': <><path d="M10 2.5 16.5 6v8L10 17.5 3.5 14V6L10 2.5Z" /><path d="M3.5 6 10 9.5 16.5 6" /><line x1="10" y1="9.5" x2="10" y2="17.5" /></>,
  '/dashboard/inventory': <><path d="M10 3 17 6.5 10 10 3 6.5 10 3Z" /><path d="M3 10 10 13.5 17 10" /><path d="M3 13.5 10 17 17 13.5" /></>,
  '/dashboard/expenses': <><path d="M5 2.5h10v15l-2.5-1.5-2.5 1.5-2.5-1.5L5 17.5v-15Z" /><line x1="8" y1="7" x2="12" y2="7" /><line x1="8" y1="10.5" x2="12" y2="10.5" /></>,
  '/dashboard/reports': <><line x1="4.5" y1="16.5" x2="4.5" y2="10" /><line x1="10" y1="16.5" x2="10" y2="4" /><line x1="15.5" y1="16.5" x2="15.5" y2="8" /></>,
  '/dashboard/settings': <><line x1="3" y1="6" x2="17" y2="6" /><line x1="3" y1="14" x2="17" y2="14" /><circle cx="7" cy="6" r="1.8" fill="currentColor" /><circle cx="13" cy="14" r="1.8" fill="currentColor" /></>,
}

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

const STORAGE_KEY = 'orderforge.sidebar.collapsed'

// The collapsed choice lives outside React so it can be read from browser
// storage without a setState-in-effect flash. Storage can be blocked, so the
// in-memory override keeps the toggle working even when nothing persists.
const listeners = new Set<() => void>()
let override: boolean | null = null

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

// With nothing stored yet, phones start on the icon rail — a full-width
// sidebar would eat most of the screen.
function readCollapsed(): boolean {
  if (override !== null) return override
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null) return stored === '1'
  } catch { /* blocked storage: fall through to the default */ }
  return window.innerWidth < 768
}

function writeCollapsed(value: boolean) {
  override = value
  try { localStorage.setItem(STORAGE_KEY, value ? '1' : '0') } catch { /* fine without it */ }
  listeners.forEach(l => l())
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 shrink-0" aria-hidden="true">
      {children}
    </svg>
  )
}

export default function DashboardNav() {
  const router = useRouter()
  const pathname = usePathname()
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false)
  const toggle = () => writeCollapsed(!collapsed)

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Longest match wins, so /dashboard/expenses doesn't also light up Dashboard.
  const activeHref = LINKS
    .filter(l => pathname === l.href || pathname.startsWith(`${l.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href

  const rowBase = 'flex items-center gap-3 rounded-xl text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-500'
  const rowSize = collapsed ? 'justify-center p-2.5' : 'px-3 py-2.5'

  return (
    <aside
      className={`sticky top-0 h-screen shrink-0 flex flex-col bg-gray-900 border-r border-gray-800 transition-[width] duration-200 ${collapsed ? 'w-16' : 'w-60'}`}
    >
      <div className={`flex items-center py-3 ${collapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
        {!collapsed && <Link href="/dashboard" className="text-indigo-400 font-bold text-lg">OrderForge</Link>}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
          title={collapsed ? 'Expand menu' : 'Collapse menu'}
          className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
            <rect x="3" y="3.5" width="14" height="13" rx="2" />
            <line x1="8" y1="3.5" x2="8" y2="16.5" />
            {collapsed ? <path d="m11.5 8 2 2-2 2" /> : <path d="m13.5 8-2 2 2 2" />}
          </svg>
        </button>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
        {LINKS.map(l => {
          const active = l.href === activeHref
          return (
            <Link
              key={l.href}
              href={l.href}
              title={collapsed ? `${l.label} — ${l.hint}` : l.hint}
              aria-label={collapsed ? l.label : undefined}
              aria-current={active ? 'page' : undefined}
              className={`${rowBase} ${rowSize} ${
                active ? 'bg-indigo-500/15 text-indigo-300' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <Icon>{ICONS[l.href]}</Icon>
              {!collapsed && <span>{l.label}</span>}
            </Link>
          )
        })}
      </nav>

      <div className="px-2 py-3 border-t border-gray-800 space-y-1">
        <NotificationBell variant="sidebar" collapsed={collapsed} />
        <button
          onClick={signOut}
          title="Sign out"
          aria-label={collapsed ? 'Sign out' : undefined}
          className={`${rowBase} ${rowSize} w-full text-gray-400 hover:bg-gray-800 hover:text-white`}
        >
          <Icon>
            <path d="M8 3.5H5A1.5 1.5 0 0 0 3.5 5v10A1.5 1.5 0 0 0 5 16.5h3" />
            <path d="M12.5 6.5 16 10l-3.5 3.5" />
            <line x1="16" y1="10" x2="8" y2="10" />
          </Icon>
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </aside>
  )
}
