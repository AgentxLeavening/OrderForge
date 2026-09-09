import crypto from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'

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

// eBay POSTs here when a real user deletes/closes their eBay account, and
// expects a 200 within a few seconds (it retries on failure/timeout).
//
// We currently retain no eBay buyer PII beyond a display username on
// imported orders (see lib/integrations/ebay.ts NormalizedOrder.buyerName)
// — no address, email, or real name — so there's no customer record to
// scrub yet. Just acknowledge receipt. If buyer PII storage is ever added,
// implement real deletion here keyed off notification.data.username/userId
// before shipping that feature — don't let this stay a no-op past that point.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    console.log('[ebay] account deletion notification received', {
      notificationId: body?.notificationId,
      username: body?.notification?.data?.username,
    })
  } catch {
    // Malformed/empty body — still acknowledge so eBay doesn't retry forever.
  }
  return NextResponse.json({}, { status: 200 })
}
