'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/dashboard/clients', label: 'Clients' },
  { href: '/dashboard/products', label: 'Products' },
  { href: '/dashboard/inventory', label: 'Inventory' },
  { href: '/dashboard/reports', label: 'Reports' },
  { href: '/dashboard/settings', label: 'Settings' },
]

export default function DashboardNav() {
  const router = useRouter()

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <header className="bg-gray-900 border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-wrap">
          <Link href="/dashboard" className="text-indigo-400 font-bold">OrderForge</Link>
          <nav className="flex items-center gap-3 flex-wrap">
            {LINKS.map(l => (
              <Link key={l.href} href={l.href} className="text-gray-400 hover:text-white text-sm">
                {l.label}
              </Link>
            ))}
          </nav>
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
