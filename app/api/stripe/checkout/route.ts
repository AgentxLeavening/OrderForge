import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { stripeClient, stripeConfigured, toStripeAmount } from '@/lib/stripe'
import { canRespond, type QuoteSnapshot, type QuoteStatus } from '@/lib/quotes'

// POST /api/stripe/checkout  { token }
//
// Starts a card payment for an accepted quote and hands back Stripe's hosted
// checkout URL. Deliberately unauthenticated, like the quote page and the
// accept/decline route: the customer has no account, and the unguessable token
// stands in for one.
//
// Every amount is derived server-side from the quote's stored snapshot — the
// browser names a token, never a price. The charge is created on the SELLER's
// connected account (`stripeAccount`), so the money goes to them and never
// through OrderForge.
export async function POST(request: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: 'Card payments are not set up on this deployment.' }, { status: 503 })
  }

  let body: { token?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!body.token) return NextResponse.json({ error: 'token is required' }, { status: 400 })

  const admin = createSupabaseAdminClient()
  const { data: quote } = await admin
    .from('quotes')
    .select('id, user_id, order_id, token, status, valid_until, snapshot')
    .eq('token', body.token)
    .maybeSingle()

  if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

  // Paying is for work the customer has agreed to. An accepted quote is the
  // one state where that's true; anything still open goes through Accept first
  // (and a declined or expired one must not be payable at all).
  if (quote.status !== 'accepted' && canRespond(quote.status as QuoteStatus, quote.valid_until)) {
    return NextResponse.json({ error: 'Accept the quote before paying.' }, { status: 409 })
  }
  if (quote.status !== 'accepted') {
    return NextResponse.json({ error: 'This quote can no longer be paid.' }, { status: 409 })
  }

  const snapshot = quote.snapshot as QuoteSnapshot
  const deposit = snapshot.deposit?.amount && snapshot.deposit.amount > 0 ? snapshot.deposit.amount : null
  const amount = deposit ?? snapshot.total
  if (!(amount > 0)) return NextResponse.json({ error: 'Nothing to pay on this quote.' }, { status: 400 })

  const { data: account } = await admin
    .from('stripe_accounts')
    .select('stripe_account_id, charges_enabled')
    .eq('user_id', quote.user_id)
    .maybeSingle()

  // Existence isn't enough: Stripe withholds charging until identity and bank
  // details clear, and a session created against such an account fails anyway.
  if (!account?.charges_enabled) {
    return NextResponse.json({ error: 'This seller can’t take card payments yet.' }, { status: 409 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const quoteUrl = `${appUrl}/quote/${quote.token}`

  try {
    const session = await stripeClient().checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: toStripeAmount(amount),
            product_data: {
              name: deposit ? `Deposit — ${snapshot.orderTitle}` : snapshot.orderTitle,
              description: `Reference ${snapshot.orderNumber}`,
            },
          },
        }],
        success_url: `${quoteUrl}?paid=1`,
        cancel_url: quoteUrl,
        // Read back by the webhook to record the payment against the right
        // order. Metadata is the only thing that survives the round trip.
        metadata: {
          orderforge_order_id: quote.order_id,
          orderforge_user_id: quote.user_id,
          orderforge_quote_id: quote.id,
          orderforge_kind: deposit ? 'deposit' : 'full',
        },
      },
      { stripeAccount: account.stripe_account_id }
    )

    return NextResponse.json({ url: session.url })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[stripe] checkout session failed', message)
    return NextResponse.json({ error: 'Could not start the payment.' }, { status: 500 })
  }
}
