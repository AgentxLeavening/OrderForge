import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { generateQuoteToken, billableLineTotal, type QuoteSnapshot } from '@/lib/quotes'

// POST /api/quotes/create  { orderId, message?, validUntil? }
//
// Builds the snapshot server-side from the order's own rows rather than
// trusting amounts sent by the browser — the quote is what the customer will
// be held to, so the client doesn't get to name the price.
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  let body: { orderId?: string; message?: string; validUntil?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!body.orderId) return NextResponse.json({ error: 'orderId is required' }, { status: 400 })

  // Read through the user's own session, so RLS confirms they own this order.
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('id, title, order_number, client_id, status')
    .eq('id', body.orderId)
    .maybeSingle()

  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const { data: items } = await supabase
    .from('order_items')
    .select('description, quantity, unit_price, item_type, buyer_covered')
    .eq('order_id', order.id)

  const lineItems = (items || []).map(it => ({
    description: it.description,
    quantity: Number(it.quantity) || 0,
    unitPrice: Number(it.unit_price) || 0,
    itemType: it.item_type ?? null,
    buyerCovered: it.buyer_covered ?? null,
  }))

  if (lineItems.length === 0) {
    return NextResponse.json({ error: 'Add at least one line item before sending a quote.' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, default_tax_rate')
    .eq('id', user.id)
    .maybeSingle()

  const { data: client } = order.client_id
    ? await supabase.from('clients').select('name').eq('id', order.client_id).maybeSingle()
    : { data: null }

  const subtotal = lineItems.reduce((sum, it) => sum + billableLineTotal(it), 0)
  const taxRate = Number(profile?.default_tax_rate) || 0
  const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100
  const total = Math.round((subtotal + taxAmount) * 100) / 100

  const snapshot: QuoteSnapshot = {
    items: lineItems,
    subtotal,
    taxRate,
    taxAmount,
    total,
    businessName: profile?.business_name || 'My Shop',
    clientName: client?.name ?? null,
    orderTitle: order.title,
    orderNumber: order.order_number,
  }

  // Service-role for the insert: `token` must be unique and unguessable, and
  // this keeps its generation server-side rather than anything the client
  // could influence.
  const admin = createSupabaseAdminClient()
  const token = generateQuoteToken()

  const { data: quote, error: insErr } = await admin
    .from('quotes')
    .insert({
      user_id: user.id,
      order_id: order.id,
      token,
      status: 'sent',
      valid_until: body.validUntil || null,
      snapshot,
      message: body.message?.trim() || null,
    })
    .select('id, token')
    .single()

  if (insErr || !quote) {
    return NextResponse.json({ error: insErr?.message || 'Could not create quote' }, { status: 500 })
  }

  // Sending a price *is* the quote, same rule the invoice button already
  // follows — but only ever forwards, and only from an earlier stage, so
  // re-quoting a job in progress can't drag it backwards.
  if (order.status === 'inquiry') {
    await supabase.from('orders').update({ status: 'quoted' }).eq('id', order.id)
  }

  return NextResponse.json({ id: quote.id, token: quote.token })
}
