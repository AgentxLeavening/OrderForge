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

// Accounts v2 (`/v2/core/accounts`) is what Stripe now steers new Connect
// platforms to; v1 `accounts.create` only works with the "Accounts v1 support"
// compatibility flag switched on in the dashboard. The v2 endpoints want a
// pinned dated API version, passed per request so v1 calls (Checkout, webhook
// construction) keep using the SDK's own default.
export const STRIPE_V2_API_VERSION = '2026-08-26.dahlia'

/** Per-request options pinning the version the v2 core endpoints expect. */
export const v2RequestOptions = { apiVersion: STRIPE_V2_API_VERSION } as const

/**
 * Whether a v2 account can take card payments.
 *
 * v1 answered this with a flat `charges_enabled`; v2 nests it per configuration
 * as a capability status, where only `active` means money can move (`pending`
 * is Stripe still checking, `unsupported`/`restricted` mean it can't).
 */
export function v2CardPaymentsActive(account: unknown): boolean {
  const status = (account as {
    configuration?: { merchant?: { capabilities?: { card_payments?: { status?: string } } } }
  })?.configuration?.merchant?.capabilities?.card_payments?.status
  return status === 'active'
}

export type AccountStatus = {
  chargesEnabled: boolean
  detailsSubmitted: boolean
  disabledReason: string | null
  requirements: string[]
}

/**
 * Current state of a connected account, whichever API created it.
 *
 * Reads v2 first (what new accounts are), falling back to v1 for accounts
 * created before the migration — including the one used for the test-mode run.
 * Both shapes exist in the wild, so both are handled rather than migrating
 * rows and hoping.
 */
export async function readAccountStatus(accountId: string): Promise<AccountStatus> {
  const stripe = stripeClient()
  try {
    const account = await stripe.v2.core.accounts.retrieve(
      accountId,
      { include: ['configuration.merchant', 'requirements'] } as never,
      v2RequestOptions
    )
    const requirements = (account as {
      requirements?: { entries?: { description?: string; awaiting_action_from?: string }[] }
    }).requirements?.entries ?? []
    return {
      chargesEnabled: v2CardPaymentsActive(account),
      detailsSubmitted: requirements.length === 0,
      disabledReason: null,
      requirements: requirements.map(r => r.description || 'information Stripe still needs').slice(0, 10),
    }
  } catch {
    // v1 account (or v2 not available on this platform yet).
    const account = await stripe.accounts.retrieve(accountId)
    const due = [
      ...(account.requirements?.currently_due ?? []),
      ...(account.requirements?.past_due ?? []),
    ]
    return {
      chargesEnabled: account.charges_enabled ?? false,
      detailsSubmitted: account.details_submitted ?? false,
      disabledReason: account.requirements?.disabled_reason ?? null,
      requirements: [...new Set(due)].slice(0, 10),
    }
  }
}

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
