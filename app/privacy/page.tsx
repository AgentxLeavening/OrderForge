import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Privacy Policy · OrderForge',
  description: 'What data OrderForge collects, why, and how to have it deleted.',
}

// Public (no auth — proxy.ts only guards /dashboard and /api/integrations), because
// marketplace developer portals require a reachable privacy policy URL. eBay's RuName
// setup form demands one before it will issue a production redirect identifier.
//
// Keep this factually accurate rather than boilerplate: it is a description of what the
// code actually does, so it has to be updated when data handling changes. In particular,
// the "What we receive from marketplaces" section below is true only while
// lib/integrations/*.ts store nothing more than a buyer display name — if buyer
// addresses, emails, or real names are ever imported, this page and the account
// deletion handler (app/api/integrations/ebay/deletion/route.ts) must both change.
const CONTACT_EMAIL = 'leavy.tyler@gmail.com'
const LAST_UPDATED = '9 September 2026'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-white mb-3">{title}</h2>
      <div className="space-y-3 text-gray-400 text-sm leading-relaxed">{children}</div>
    </section>
  )
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-950 px-6 py-12">
      <div className="max-w-2xl mx-auto">
        <Link href="/" className="text-indigo-400 hover:text-indigo-300 text-sm">
          ← OrderForge
        </Link>

        <h1 className="text-3xl font-bold text-white mt-6 mb-2">Privacy Policy</h1>
        <p className="text-gray-500 text-sm mb-10">Last updated {LAST_UPDATED}</p>

        <Section title="What OrderForge is">
          <p>
            OrderForge is an order, inventory, and pricing tool for independent makers and
            small shops. You sign up as a seller, record your own orders and stock, and
            optionally connect a marketplace account so your sales import automatically.
          </p>
        </Section>

        <Section title="Information you give us">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <span className="text-gray-300">Account details</span> — your email address
              and password. Passwords are handled by our authentication provider and are
              never visible to us in readable form.
            </li>
            <li>
              <span className="text-gray-300">Business settings</span> — things like your
              hourly rate, markup, fee percentage, and tax rate, used to calculate
              suggested prices.
            </li>
            <li>
              <span className="text-gray-300">Your business records</span> — orders,
              customers you enter, line items, products, inventory, and invoices.
            </li>
          </ul>
        </Section>

        <Section title="Connecting a marketplace">
          <p>
            If you connect Etsy, eBay, or Shopify, you are sent to that marketplace to sign
            in. We never see your marketplace password. The marketplace gives us an access
            token, which we store so we can fetch your orders on your behalf.
          </p>
          <p>
            These tokens are stored in a table that our own application servers can read
            only through a privileged key — they are not readable from the browser, and not
            readable by other users. Disconnecting a marketplace deletes the stored token.
          </p>
          <p>
            We request only the permission needed to read your orders. We do not list
            items, change prices, or message buyers on your behalf.
          </p>
        </Section>

        <Section title="What we receive from marketplaces">
          <p>
            When you sync, we import the order details needed to keep your books: the
            marketplace order number, item titles, quantities, prices, shipping and tax
            totals, order status, and the date it was placed.
          </p>
          <p>
            We also store the buyer&apos;s marketplace display name so you can tell your
            orders apart. We do not import or store buyers&apos; email addresses, postal
            addresses, phone numbers, or payment details.
          </p>
        </Section>

        <Section title="Who else sees your data">
          <p>
            We do not sell your data, and we do not share it for advertising. It is stored
            with service providers who run the product for us — a managed database and
            authentication provider, and a hosting provider. They process data on our
            instructions only.
          </p>
          <p>
            We may disclose information if the law requires it, or to investigate abuse of
            the service.
          </p>
        </Section>

        <Section title="Keeping and deleting data">
          <p>
            Your records are kept for as long as your account exists. You can delete
            individual orders, customers, and inventory at any time from within the app,
            and disconnecting a marketplace removes its stored access token immediately.
          </p>
          <p>
            To delete your account and everything in it, email us at{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-400 hover:text-indigo-300">
              {CONTACT_EMAIL}
            </a>
            . We also honour account closure notifications sent to us by connected
            marketplaces.
          </p>
        </Section>

        <Section title="Where data is held">
          <p>
            Data is stored on servers operated by our hosting and database providers and
            may be processed outside your country. We rely on our providers&apos; standard
            data protection terms for those transfers.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            If this policy changes in a way that affects how your data is handled, we will
            update the date at the top of this page.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about this policy, or about data we hold, can go to{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-400 hover:text-indigo-300">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </Section>
      </div>
    </div>
  )
}
