import Stripe from 'stripe'

// Stripe Connect, Standard accounts via Connect Onboarding (Stripe's current
// recommendation over the older OAuth flow for new platforms).
//
// The seller's own Stripe account takes the money; OrderForge never holds
// funds and charges no application fee. Authentication is the platform's
// secret key plus a `Stripe-Account` header naming the connected account —
// so there are no per-seller keys or tokens to store.
//
// Test mode vs live mode is decided entirely by which secret key is
// configured: an `sk_test_...` key produces test accounts where only Stripe's
// test card numbers work, and no real money can move.

let client: Stripe | null = null

export function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing).')
  if (!client) client = new Stripe(key)
  return client
}

export const stripeConfigured = () => !!process.env.STRIPE_SECRET_KEY

/** True while the platform runs on a test key — surfaced in the UI so a test connection is never mistaken for a live one. */
export const stripeTestMode = () => (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_')

export type StripeAccountRow = {
  stripe_account_id: string
  charges_enabled: boolean
  details_submitted: boolean
  livemode: boolean
}

/**
 * Whether this seller can actually be paid. An account exists from the moment
 * onboarding starts, but Stripe withholds charging until identity and bank
 * details clear — so existence is never the test, `charges_enabled` is.
 */
export const canAcceptCardPayments = (account: StripeAccountRow | null | undefined) =>
  !!account?.charges_enabled

/**
 * Stripe works in the currency's smallest unit. Rounding here (rather than
 * letting float noise through) is what keeps a $62.645 quote total from
 * becoming a charge that disagrees with the amount printed on the quote.
 */
export const toStripeAmount = (dollars: number) => Math.round((Number(dollars) || 0) * 100)

export const fromStripeAmount = (cents: number) => Math.round(Number(cents) || 0) / 100
