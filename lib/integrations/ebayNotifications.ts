import crypto from 'crypto'

// Verification for eBay's push notifications (we receive exactly one topic:
// MARKETPLACE_ACCOUNT_DELETION — see app/api/integrations/ebay/deletion/route.ts).
//
// This matters more than a typical "nice to have" signature check: the
// notification handler *deletes buyer data*. Without verification the endpoint
// is an unauthenticated, internet-facing way for anyone to wipe fields out of
// a seller's order history, since the URL is registered publicly with eBay.
//
// The scheme, confirmed against eBay's own SDK (eBay/eBay-Notification-SDK-Dot-Net-Core,
// Utils/SignatureValidatorImpl.cs) rather than reconstructed from prose:
//   1. `x-ebay-signature` header is base64 of a JSON object: { kid, signature }.
//   2. GET /commerce/notification/v1/public_key/{kid} (application token, i.e.
//      client_credentials — no user consent involved) returns
//      { key, algorithm: "ECDSA", digest: "SHA1" }.
//   3. Verify `signature` (base64, DER-encoded ECDSA) over the **raw request
//      body bytes** using <digest>with<algorithm>.
//
// Note step 3 says *raw* body. Re-serialising a parsed object would change
// whitespace/escaping and break verification, so the route reads text() and
// parses only after verifying.
const isSandbox = process.env.EBAY_ENV === 'sandbox'
const API_HOST = isSandbox ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com'

const clientId = () => process.env.EBAY_CLIENT_ID || ''
const clientSecret = () => process.env.EBAY_CLIENT_SECRET || ''

type EbayPublicKey = { key: string; algorithm: string; digest: string }

// eBay's public keys are long-lived and keyed by `kid`, so a process-local
// cache saves a token call + key fetch per notification. Deliberately
// unbounded-but-tiny: eBay rotates through a handful of key ids.
const publicKeyCache = new Map<string, EbayPublicKey>()

let appToken: { value: string; expiresAt: number } | null = null

// Application (client_credentials) token — not a user token. Getting one needs
// only the app's own credentials, which is why this works in a webhook where
// no seller session exists.
async function getApplicationToken(): Promise<string> {
  if (appToken && appToken.expiresAt > Date.now() + 60_000) return appToken.value
  if (!clientId() || !clientSecret()) {
    throw new Error('eBay notification verification needs EBAY_CLIENT_ID / EBAY_CLIENT_SECRET.')
  }

  const res = await fetch(`${API_HOST}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }),
  })
  if (!res.ok) throw new Error(`eBay application token failed: ${res.status} ${(await res.text()).slice(0, 200)}`)

  const json = await res.json()
  appToken = {
    value: json.access_token,
    expiresAt: Date.now() + (Number(json.expires_in) || 7200) * 1000,
  }
  return appToken.value
}

async function getPublicKey(kid: string): Promise<EbayPublicKey> {
  const cached = publicKeyCache.get(kid)
  if (cached) return cached

  const token = await getApplicationToken()
  const res = await fetch(`${API_HOST}/commerce/notification/v1/public_key/${encodeURIComponent(kid)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`eBay public key fetch failed for ${kid}: ${res.status} ${(await res.text()).slice(0, 200)}`)

  const json = (await res.json()) as EbayPublicKey
  if (!json?.key) throw new Error(`eBay public key response for ${kid} had no key`)
  publicKeyCache.set(kid, json)
  return json
}

// eBay returns the PEM as a single line — header, base64 and footer with no
// newlines at all (see Tests/data/public_key_response.json in their SDK).
// Node's crypto rejects that, so rebuild a properly wrapped PEM. Exported for
// testing: this reformatting is the least obvious part of the whole flow.
export function normalizePublicKeyPem(key: string): string {
  const base64 = key
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '')
  const wrapped = base64.match(/.{1,64}/g)?.join('\n') ?? ''
  return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----\n`
}

// Exported separately from the fetching so tests can exercise the crypto with
// a locally generated key instead of reaching eBay.
export function verifySignatureWithKey(
  rawBody: string,
  signatureBase64: string,
  publicKey: EbayPublicKey
): boolean {
  const verifier = crypto.createVerify(publicKey.digest || 'SHA1')
  verifier.update(rawBody, 'utf8')
  verifier.end()
  try {
    return verifier.verify(normalizePublicKeyPem(publicKey.key), signatureBase64, 'base64')
  } catch {
    // A malformed key or signature is a failed verification, not a crash.
    return false
  }
}

/**
 * True only if the body genuinely came from eBay. Throws if verification
 * couldn't be *attempted* (missing credentials, key fetch failed) — the caller
 * must treat that as "don't act on this notification" and return a non-2xx so
 * eBay retries, rather than silently skipping the deletion.
 */
export async function verifyEbayNotification(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader) return false

  let parsed: { kid?: string; signature?: string }
  try {
    parsed = JSON.parse(Buffer.from(signatureHeader, 'base64').toString('utf8'))
  } catch {
    return false
  }
  if (!parsed.kid || !parsed.signature) return false

  const publicKey = await getPublicKey(parsed.kid)
  return verifySignatureWithKey(rawBody, parsed.signature, publicKey)
}
