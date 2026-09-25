import type { Metadata } from 'next'
import Image from 'next/image'
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

// Photography lives in public/landing (web-sized copies of the originals kept
// in assets/). `position` is the CSS object-position that keeps the subject in
// frame once the photo is cropped to a portrait tile.
const PHOTO_ROW = [
  { src: '/landing/leather-tools.jpg', label: 'Leatherwork', position: '50% 50%', alt: 'Leatherworking tools and a finished card holder laid out on a cutting mat' },
  { src: '/landing/filament.jpg', label: '3D printing', position: '62% 50%', alt: 'Spools of green and orange 3D printer filament' },
  { src: '/landing/crochet.jpg', label: 'Fiber arts', position: '55% 55%', alt: 'A crochet hook resting in a ball of blue yarn' },
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
        <section className="relative overflow-hidden">
          {/* Yarn under a dark wash that fades into the page background, so the
              photo reads as atmosphere and the headline stays the loudest
              thing. The photo is a tall portrait, so object-position picks the
              slice of it that holds the yarn. */}
          <Image
            src="/landing/yarn-hero.jpg"
            alt=""
            fill
            sizes="100vw"
            className="object-cover"
            style={{ objectPosition: '50% 70%' }}
            loading="eager"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-gray-950/70 via-gray-950/75 to-gray-950" aria-hidden="true" />
          <div className="relative max-w-6xl mx-auto px-6 pt-20 pb-20 text-center">
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight max-w-3xl mx-auto">
              Know what you actually made on every order.
            </h1>
            <p className="text-gray-300 text-lg mt-5 max-w-2xl mx-auto">
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
                className="text-gray-200 hover:text-white font-semibold px-6 py-3 rounded-lg border border-gray-600 bg-gray-950/40 hover:border-gray-400 transition"
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>

        {/* The kinds of shop the product is built around, shown as the people
            it's for — so the first thing a visitor sees below the pitch is a
            workbench, not a dashboard mock-up. The middle frame sits lower on
            wider screens to break up the row. */}
        <section className="max-w-5xl mx-auto px-6 pb-20" aria-label="The makers OrderForge is built for">
          <div className="grid grid-cols-3 gap-3 sm:gap-5">
            {PHOTO_ROW.map((p, i) => (
              <figure
                key={p.src}
                className={`relative aspect-[3/4] sm:aspect-[4/5] rounded-2xl overflow-hidden border border-gray-800 ${i === 1 ? 'sm:mt-8' : ''}`}
              >
                <Image
                  src={p.src}
                  alt={p.alt}
                  fill
                  sizes="(max-width: 1024px) 33vw, 340px"
                  className="object-cover"
                  style={{ objectPosition: p.position }}
                  loading="eager"
                />
                <figcaption className="absolute bottom-2 left-2 sm:bottom-3 sm:left-3 bg-gray-950/75 backdrop-blur-sm text-gray-200 text-[11px] sm:text-xs font-medium px-2.5 py-1 rounded-full">
                  {p.label}
                </figcaption>
              </figure>
            ))}
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

        <section className="max-w-5xl mx-auto px-6 pb-20">
          <h2 className="text-2xl font-bold text-center mb-10">How it works</h2>
          <div className="grid md:grid-cols-5 gap-8 items-center">
            <div className="relative md:col-span-2 aspect-[4/5] rounded-2xl overflow-hidden border border-gray-800 max-h-[28rem] md:max-h-none">
              <Image
                src="/landing/leather-hands.jpg"
                alt="A maker's hands marking stitch holes in a piece of leather"
                fill
                sizes="(max-width: 768px) 100vw, 400px"
                className="object-cover"
              />
            </div>
            <ol className="md:col-span-3 space-y-8">
              {STEPS.map(s => (
                <li key={s.n} className="flex gap-4">
                  <div className="w-9 h-9 shrink-0 rounded-full bg-indigo-600/20 text-indigo-400 font-bold flex items-center justify-center">
                    {s.n}
                  </div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">{s.title}</h3>
                    <p className="text-gray-400 text-sm leading-relaxed">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-6 pb-24">
          <div className="relative overflow-hidden rounded-2xl border border-gray-800 p-10 sm:p-14 text-center">
            {/* A dark, low-contrast photo under a heavy wash, so the copy stays
                the loudest thing here. */}
            <Image
              src="/landing/leather-wallet.jpg"
              alt=""
              fill
              sizes="(max-width: 1152px) 100vw, 1152px"
              className="object-cover"
              style={{ objectPosition: '50% 38%' }}
            />
            <div className="absolute inset-0 bg-gray-950/65" aria-hidden="true" />
            <div className="relative">
              <h2 className="text-2xl font-bold mb-3">Start tracking your real profit — free</h2>
              <p className="text-gray-300 mb-6">No credit card. Set up your pricing in a few minutes.</p>
              <Link
                href="/signup"
                className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-3 rounded-lg transition"
              >
                Get started
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-800">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-gray-500">
          <span>© {new Date().getFullYear()} OrderForge</span>
          <span className="text-gray-600 text-xs text-center">
            Photos: Vlada Karpovich, Jakub Zerdzicki, M Kamran Arvi, Dilara Haziroglu, cottonbro studio, Lantip — via Pexels
          </span>
          <Link href="/privacy" className="hover:text-gray-300">
            Privacy Policy
          </Link>
        </div>
      </footer>
    </div>
  )
}
