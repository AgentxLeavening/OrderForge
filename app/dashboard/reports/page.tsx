'use client'

import Link from 'next/link'

const REPORTS = [
  {
    href: '/dashboard/products/profitability',
    title: 'Cross-Channel Profitability',
    description: 'Which products actually earn the most, and on which channel — real margin, not just revenue.',
  },
  {
    href: '/dashboard/reports/tax-export',
    title: 'Tax Season Export',
    description: 'Download revenue, cost basis, and profit for every order in a date range, across every channel, in one CSV.',
  },
]

export default function ReportsPage() {
  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-6">Reports</h1>
        <div className="space-y-3">
          {REPORTS.map(r => (
            <Link
              key={r.href}
              href={r.href}
              className="block bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-2xl p-5 transition"
            >
              <h2 className="text-white font-semibold mb-1">{r.title} →</h2>
              <p className="text-gray-500 text-sm">{r.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
