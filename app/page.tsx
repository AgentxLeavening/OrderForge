import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'OrderForge — know what you actually made',
  description:
    'Order, inventory, and pricing management for makers and small shops. Track real profit per order — materials, labor, marketplace fees, and shipping included — across Etsy, eBay, Shopify, and one-off sales.',
}

// Public marketing page — no auth (proxy.ts only guards /dashboard and
// /api/integrations). Previously this route just redirected straight to
// /dashboard; now that redirect lives on /dashboard itself, so a signed-in
// visitor who lands here can still click through, and a signed-out one gets
// a real sell instead of bouncing straight to a login form.
const FEATURES = [
  {
    title: 'Know your real profit, per order',
    body:
      "Materials, labor, marketplace fees, and shipping — all folded into one number, not guessed at after the fact. Suggested price is (materials + labor) × markup, grossed up to cover the fee %, and profit accounts for whether the buyer actually covered shipping or you ate it.",
  },
  {
    title: 'Inventory that updates itself',
    body:
      'Link a product to its bill of materials once. Every sale — manual or synced from a marketplace — deducts stock automatically. Cancel an order and it restocks. Low-stock items surface on the dashboard before you run out mid-commission.',
  },
  {
    title: 'Sync Etsy, eBay & Shopify',
    body:
      "Connect your shops and new orders import themselves, matched to your products and deducting inventory on arrival — no re-typing an order you already have in three other places.",
  },
  {
    title: 'Invoices in one click',
    body: 'A clean PDF invoice for any order, whether it came from a marketplace, a commission, or a one-off sale with no client on file.',
  },
  {
    title: 'Reports that actually matter',
    body: 'Profitability by product, sales by channel, and a tax-season export scoped to the current year — so you know which listings are worth your time, not just which ones sold.',
  },
  {
    title: 'Built for makers, not generic retail',
    body: 'Commissions, 3D print jobs, resin, cards — order types and a pricing model built around time and materials, not SKUs and warehouses.',
  },
]

const STEPS = [
  { n: '1', title: 'Set your pricing once', body: 'Hourly rate, default markup, marketplace fee %, and tax rate — in Settings, applied to every quote after.' },
  { n: '2', title: 'Connect your shops (optional)', body: 'Etsy, eBay, and Shopify orders import and match to your products automatically. Or just enter orders by hand — either works.' },
  { n: '3', title: 'See what you actually made', body: 'Every order shows real profit after fees and materials. Reports roll it up by product and by channel.' },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="text-indigo-400 font-bold text-lg">OrderForge</span>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-gray-400 hover:text-white text-sm px-3 py-2">
              Sign in
            </Link>
            <Link
              href="/signup"
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
            >
              Get started — free
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight max-w-3xl mx-auto">
            Know what you actually made on every order.
          </h1>
          <p className="text-gray-400 text-lg mt-5 max-w-2xl mx-auto">
            Order, inventory, and pricing management built for Etsy and eBay sellers, 3D-print shops,
            and crafters — so a &ldquo;sold out&rdquo; listing and a profitable one aren&apos;t the same thing anymore.
          </p>
          <div className="flex items-center justify-center gap-4 mt-8">
            <Link
              href="/signup"
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-3 rounded-lg transition"
            >
              Get started — it&apos;s free
            </Link>
            <Link
              href="/login"
              className="text-gray-300 hover:text-white font-semibold px-6 py-3 rounded-lg border border-gray-800 hover:border-gray-600 transition"
            >
              Sign in
            </Link>
          </div>
        </section>

        <section className="max-w-4xl mx-auto px-6 pb-16">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
            <p className="text-gray-300 text-lg leading-relaxed">
              Spreadsheets don&apos;t know your Etsy fees. Your marketplace doesn&apos;t know what your
              materials cost. Somewhere between the two, most makers just stop tracking — and stop
              knowing which pieces are actually worth making again.
            </p>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-6 pb-20">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map(f => (
              <div key={f.title} className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <h3 className="font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="max-w-4xl mx-auto px-6 pb-20">
          <h2 className="text-2xl font-bold text-center mb-10">How it works</h2>
          <div className="grid sm:grid-cols-3 gap-8">
            {STEPS.map(s => (
              <div key={s.n} className="text-center">
                <div className="w-9 h-9 rounded-full bg-indigo-600/20 text-indigo-400 font-bold flex items-center justify-center mx-auto mb-4">
                  {s.n}
                </div>
                <h3 className="font-semibold text-white mb-2">{s.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-6 pb-24">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center">
            <h2 className="text-2xl font-bold mb-3">Start tracking your real profit — free</h2>
            <p className="text-gray-400 mb-6">No credit card. Set up your pricing in a few minutes.</p>
            <Link
              href="/signup"
              className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-3 rounded-lg transition"
            >
              Get started
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-800">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-gray-500">
          <span>© {new Date().getFullYear()} OrderForge</span>
          <Link href="/privacy" className="hover:text-gray-300">
            Privacy Policy
          </Link>
        </div>
      </footer>
    </div>
  )
}
