import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { canRespond, type QuoteStatus } from '@/lib/quotes'

// POST /api/quotes/<token>/respond  { decision: 'accepted' | 'declined', note? }
//
// Deliberately unauthenticated — the customer has no account, and the token in
// the URL is what stands in for one. Same discipline as the marketplace
// webhooks: the endpoint is public, so it must be narrow. It can only ever
// move ONE quote (identified by an unguessable token) from an open state to a
// final one, and it never reveals anything about quotes it isn't given.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  let body: { decision?: string; note?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const decision = body.decision
  if (decision !== 'accepted' && decision !== 'declined') {
    return NextResponse.json({ error: 'decision must be accepted or declined' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const { data: quote } = await admin
    .from('quotes')
    .select('id, order_id, status, valid_until')
    .eq('token', token)
    .maybeSingle()

  // Same 404 for "no such token" and "expired token" would be tidier, but an
  // expired quote is worth telling the customer about — they may want to ask
  // for a new one rather than assume the link is broken.
  if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

  if (!canRespond(quote.status as QuoteStatus, quote.valid_until)) {
    return NextResponse.json(
      { error: 'This quote can no longer be answered.', status: quote.status },
      { status: 409 }
    )
  }

  const { error: updErr } = await admin
    .from('quotes')
    .update({
      status: decision,
      responded_at: new Date().toISOString(),
      response_note: body.note?.trim()?.slice(0, 2000) || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', quote.id)
    // Only transition a quote that is still open. Two clicks arriving at once
    // must not let the second overwrite the first's answer.
    .in('status', ['sent', 'viewed'])

  if (updErr) return NextResponse.json({ error: 'Could not record your response' }, { status: 500 })

  // Acceptance is a real signal from the customer, not an assumption, so it's
  // allowed to move the order on — but forward only, and only from the stages
  // that precede work starting. An accepted quote must never drag an order
  // that's already shipped or complete backwards (same rule as the sync's
  // status-rank guard and the tracking-number auto-advance).
  if (decision === 'accepted') {
    const { data: order } = await admin
      .from('orders')
      .select('id, status')
      .eq('id', quote.order_id)
      .maybeSingle()

    if (order && ['inquiry', 'quoted'].includes(order.status)) {
      await admin
        .from('orders')
        .update({ status: 'in_progress', updated_at: new Date().toISOString() })
        .eq('id', order.id)
    }
  }

  return NextResponse.json({ status: decision })
}
