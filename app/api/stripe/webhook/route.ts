import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { stripeClient, stripeConfigured, fromStripeAmount, readAccountStatus } from '@/lib/stripe'

// POST /api/stripe/webhook — Stripe telling us a card payment completed.
//
// This is the whole point of Stripe over Venmo/PayPal: it's the one payment
// method that confirms itself, so the order marks itself paid instead of the
// seller remembering to.
//
// Verification is Stripe's own: HMAC over the RAW body with the endpoint's
// signing secret, plus a timestamp check, all inside constructEvent. Same
// raw-body discipline as the Etsy/Shopify/eBay webhooks — parse only after
// verifying, or the bytes won't match.
//
// Connect note: this endpoint must be registered in Stripe as a **Connect**
// webhook, so events fire for connected accounts; `event.account` names which.
export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!stripeConfigured() || !secret) {
    console.error('[stripe] webhook received but STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET missing')
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }

  const rawBody = await request.text()
  const signature = request.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  let event
  try {
    event = stripeClient().webhooks.constructEvent(rawBody, signature, secret)
  } catch (e) {
    console.warn('[stripe] rejected webhook with invalid signature', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as {
          id: string
          payment_status?: string
          amount_total?: number | null
          metadata?: Record<string, string> | null
        }
        // A completed session isn't always a paid one (delayed payment methods
        // finish later, via checkout.session.async_payment_succeeded).
        if (session.payment_status !== 'paid') break
        await recordPayment(admin, session)
        break
      }
      case 'checkout.session.async_payment_succeeded': {
        await recordPayment(admin, event.data.object as never)
        break
      }
      case 'account.updated': {
        // Onboarding finishing in the background, or Stripe later restricting
        // an account. Keeps the pay button honest without anyone revisiting
        // Settings.
        const account = event.data.object as { id: string; charges_enabled?: boolean; details_submitted?: boolean }
        await admin
          .from('stripe_accounts')
          .update({
            charges_enabled: account.charges_enabled ?? false,
            details_submitted: account.details_submitted ?? false,
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_account_id', account.id)
        break
      }
      case 'account.application.deauthorized': {
        // The seller disconnected OrderForge from their Stripe account.
        if (event.account) await admin.from('stripe_accounts').delete().eq('stripe_account_id', event.account)
        break
      }
      default: {
        // Accounts v2 reports account changes as `v2.core.account...` events
        // rather than v1's `account.updated`, and their payload shape differs
        // by API version. Rather than decode each one, take any v2 account
        // event as "something changed" and re-read the authoritative state.
        if (event.type.startsWith('v2.core.account') && event.account) {
          const status = await readAccountStatus(event.account)
          await admin
            .from('stripe_accounts')
            .update({
              charges_enabled: status.chargesEnabled,
              details_submitted: status.detailsSubmitted,
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_account_id', event.account)
        }
        break
      }
    }
    return NextResponse.json({ received: true })
  } catch (e) {
    // Non-2xx so Stripe retries: a payment that isn't recorded is worse than a
    // duplicate delivery, and recording is idempotent on the session id.
    console.error('[stripe] webhook processing failed', event.type, e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}

async function recordPayment(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  session: { id: string; amount_total?: number | null; metadata?: Record<string, string> | null }
) {
  const orderId = session.metadata?.orderforge_order_id
  const userId = session.metadata?.orderforge_user_id
  const amount = fromStripeAmount(session.amount_total ?? 0)
  if (!orderId || !userId || !(amount > 0)) {
    console.warn('[stripe] session without usable metadata', session.id)
    return
  }

  // Stripe retries, and a session can arrive twice across event types — the
  // session id is the natural idempotency key.
  const { data: existing } = await admin
    .from('order_payments')
    .select('id')
    .eq('external_reference', session.id)
    .maybeSingle()
  if (existing) return

  const { error } = await admin.from('order_payments').insert({
    user_id: userId,
    order_id: orderId,
    amount,
    kind: 'payment',
    method: 'card',
    paid_at: new Date().toISOString().slice(0, 10),
    note: session.metadata?.orderforge_kind === 'deposit' ? 'Deposit paid by card' : 'Paid by card',
    external_reference: session.id,
  })
  if (error) throw new Error(error.message)
  console.log('[stripe] payment recorded', { orderId, amount })
}
