import crypto from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { verifyEbayNotification } from '@/lib/integrations/ebayNotifications'

// eBay's "Marketplace Account Deletion / Closure Notification" webhook.
// eBay requires this endpoint to exist and pass a live verification
// handshake before it will keep a PRODUCTION keyset active for any OAuth
// scope that reads user data — including sell.fulfillment (see
// https://developer.ebay.com/marketplace-account-deletion). It is not
// needed for Sandbox.
//
// Setup order matters: deploy this route FIRST, then in the Developer
// Portal (Application → your app → Alerts & Notifications →
// "Marketplace Account Deletion") enter:
//   - Notification endpoint: EBAY_DELETION_ENDPOINT_URL below, exactly
//     (e.g. https://orderforge-eight.vercel.app/api/integrations/ebay/deletion)
//   - Verification token: EBAY_DELETION_VERIFICATION_TOKEN below (32-80
//     chars, alphanumeric + `_`/`-`; generate one, don't reuse a real secret)
// eBay GETs this route with `challenge_code` the moment you click Save in
// the portal and only accepts the config if the response matches — so both
// env vars must already be set on Vercel and deployed before you fill in
// the portal fields, not after.
const VERIFICATION_TOKEN = process.env.EBAY_DELETION_VERIFICATION_TOKEN || ''
const ENDPOINT_URL = process.env.EBAY_DELETION_ENDPOINT_URL || ''

// Emergency lever. Signature verification can't be exercised against a real
// eBay notification before going live (they only fire when someone actually
// closes an eBay account), so if it turns out to be wrong, eBay sees a stream
// of rejections and can deactivate the production keyset — taking the whole
// integration down with it.
//
// Setting EBAY_DELETION_ACK_ONLY=true makes this route verify and log as
// normal but always answer 200 and never scrub: back to the old behaviour,
// buying time to fix verification without eBay giving up on the endpoint.
//
// Note what it deliberately is NOT: a way to scrub on unverified payloads.
// That would leave a public endpoint able to strip buyer names from anyone's
// orders, which is a worse failure than the one it's protecting against. The
// only thing this disables is the deletion, never the verification.
const ACK_ONLY = process.env.EBAY_DELETION_ACK_ONLY === 'true'

export async function GET(request: NextRequest) {
  const challengeCode = new URL(request.url).searchParams.get('challenge_code')
  if (!challengeCode || !VERIFICATION_TOKEN || !ENDPOINT_URL) {
    return NextResponse.json({ error: 'eBay deletion endpoint not configured' }, { status: 400 })
  }
  // Per eBay's spec: sha256(challengeCode + verificationToken + endpointUrl), hex.
  const hash = crypto.createHash('sha256')
  hash.update(challengeCode)
  hash.update(VERIFICATION_TOKEN)
  hash.update(ENDPOINT_URL)
  return NextResponse.json({ challengeResponse: hash.digest('hex') })
}

/**
 * Remove every trace of one eBay user from imported order data.
 *
 * What we actually hold about an eBay *buyer* is their marketplace display
 * name, copied to orders.buyer_name at import (lib/integrations/ebay.ts maps
 * o.buyer?.username). No address, email, real name or payment detail is ever
 * requested or stored, so that single column is the whole footprint.
 *
 * The order itself is NOT deleted. It is the seller's own business record —
 * amounts, line items and dates they need for tax — and it stops identifying
 * anyone the moment the name is gone. So this anonymises rather than erases:
 * the buyer disappears, the seller's books stay intact.
 *
 * Runs across every user's orders, not one seller's: a deletion request is
 * global, and the same buyer may have bought from several sellers here.
 */
async function scrubEbayBuyer(username: string): Promise<number> {
  const admin = createSupabaseAdminClient()

  const { data, error } = await admin
    .from('orders')
    .update({ buyer_name: null, updated_at: new Date().toISOString() })
    .eq('external_source', 'ebay')
    .eq('buyer_name', username)
    .select('id')

  if (error) throw new Error(`Failed scrubbing eBay buyer: ${error.message}`)
  return (data || []).length
}

// eBay POSTs here when a user deletes/closes their eBay account, and expects a
// 200 within a few seconds (it retries on failure/timeout).
//
// Every non-2xx below is deliberate: eBay retries them, which is what we want
// whenever we could not confirm the request or could not complete the erasure.
// Returning 200 on a failure would quietly drop a legal deletion obligation.
export async function POST(request: NextRequest) {
  // Raw text, not request.json() — the signature covers the exact bytes sent,
  // and re-serialising a parsed object would not reproduce them.
  const rawBody = await request.text()
  const signatureHeader = request.headers.get('x-ebay-signature')

  let verified: boolean
  try {
    verified = await verifyEbayNotification(rawBody, signatureHeader)
    if (ACK_ONLY) {
      console.warn('[ebay] EBAY_DELETION_ACK_ONLY is set — acknowledging without scrubbing', { verified })
      return NextResponse.json({}, { status: 200 })
    }
  } catch (e) {
    if (ACK_ONLY) {
      console.warn('[ebay] EBAY_DELETION_ACK_ONLY is set — acknowledging despite verification error')
      return NextResponse.json({}, { status: 200 })
    }
    // Couldn't *attempt* verification (missing credentials, key fetch down).
    // Never scrub on an unverified payload — this endpoint is public, and
    // acting on it unverified would let anyone strip buyer names from a
    // seller's orders. 500 so eBay retries once we're healthy again.
    console.error('[ebay] deletion notification verification unavailable', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Verification unavailable' }, { status: 500 })
  }

  if (!verified) {
    // Signature absent or wrong: this did not come from eBay. eBay's own
    // guidance is to reject with 412 rather than accept.
    console.warn('[ebay] rejected deletion notification with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 412 })
  }

  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    // Verified as eBay's, but unparseable — retrying won't help, so ack it.
    console.warn('[ebay] deletion notification body was not valid JSON')
    return NextResponse.json({}, { status: 200 })
  }

  const username: string | undefined = body?.notification?.data?.username
  const notificationId: string | undefined = body?.notification?.notificationId

  if (!username) {
    // Nothing to match on. Acknowledge — retrying delivers the same payload.
    console.warn('[ebay] deletion notification had no username', { notificationId })
    return NextResponse.json({}, { status: 200 })
  }

  try {
    const scrubbed = await scrubEbayBuyer(username)
    // Never log the username itself — that's the very identifier we were just
    // asked to erase, and logs outlive the row. The id and count are enough to
    // prove the request was handled.
    console.log('[ebay] account deletion handled', { notificationId, ordersScrubbed: scrubbed })
    return NextResponse.json({}, { status: 200 })
  } catch (e) {
    console.error('[ebay] account deletion scrub failed', { notificationId }, e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Scrub failed' }, { status: 500 })
  }
}
