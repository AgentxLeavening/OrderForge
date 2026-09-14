import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { normalizePublicKeyPem, verifySignatureWithKey } from '../lib/integrations/ebayNotifications'

// eBay signs notifications with ECDSA/SHA1 and hands back a public key whose
// PEM has no line breaks. Both halves are worth pinning: the endpoint they
// guard deletes buyer data, and it can't be exercised against eBay in CI.

// A stand-in for eBay's signing key. P-256 + SHA1 matches what eBay uses
// (their public_key response reports algorithm "ECDSA", digest "SHA1").
function makeKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  return { privateKey, pem }
}

function sign(body: string, privateKey: crypto.KeyObject): string {
  const signer = crypto.createSign('SHA1')
  signer.update(body, 'utf8')
  signer.end()
  return signer.sign(privateKey).toString('base64')
}

// eBay's key arrives as one unbroken line, headers included.
const asEbayWouldSendIt = (pem: string) => pem.replace(/\n/g, '')

describe('normalizePublicKeyPem', () => {
  it('restores a PEM that arrived with no line breaks', () => {
    const { pem } = makeKeyPair()
    const normalized = normalizePublicKeyPem(asEbayWouldSendIt(pem))

    expect(normalized.startsWith('-----BEGIN PUBLIC KEY-----\n')).toBe(true)
    expect(normalized.trimEnd().endsWith('-----END PUBLIC KEY-----')).toBe(true)
    // Node only accepts it if the body is wrapped; a 64-char limit is the norm.
    const bodyLines = normalized.split('\n').slice(1, -2)
    expect(bodyLines.length).toBeGreaterThan(0)
    expect(bodyLines.every(l => l.length <= 64)).toBe(true)
    // Round-trips to a key Node will actually load.
    expect(() => crypto.createPublicKey(normalized)).not.toThrow()
  })

  it('leaves an already-wrapped PEM usable', () => {
    const { pem } = makeKeyPair()
    expect(() => crypto.createPublicKey(normalizePublicKeyPem(pem))).not.toThrow()
  })
})

describe('verifySignatureWithKey', () => {
  const body = JSON.stringify({
    metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION' },
    notification: { notificationId: 'n-1', data: { username: 'someuser', userId: 'abc' } },
  })

  it('accepts a signature eBay would have produced', () => {
    const { privateKey, pem } = makeKeyPair()
    const signature = sign(body, privateKey)

    expect(
      verifySignatureWithKey(body, signature, { key: asEbayWouldSendIt(pem), algorithm: 'ECDSA', digest: 'SHA1' })
    ).toBe(true)
  })

  it('rejects a body altered after signing', () => {
    const { privateKey, pem } = makeKeyPair()
    const signature = sign(body, privateKey)
    // The attack that matters: same signature, different username to scrub.
    const tampered = body.replace('someuser', 'victimuser')

    expect(
      verifySignatureWithKey(tampered, signature, { key: asEbayWouldSendIt(pem), algorithm: 'ECDSA', digest: 'SHA1' })
    ).toBe(false)
  })

  it('rejects a signature made by a different key', () => {
    const { pem } = makeKeyPair()
    const attacker = makeKeyPair()

    expect(
      verifySignatureWithKey(body, sign(body, attacker.privateKey), {
        key: asEbayWouldSendIt(pem),
        algorithm: 'ECDSA',
        digest: 'SHA1',
      })
    ).toBe(false)
  })

  it('returns false rather than throwing on a malformed key or signature', () => {
    const { pem } = makeKeyPair()
    expect(verifySignatureWithKey(body, 'not-base64-sig!!', { key: asEbayWouldSendIt(pem), algorithm: 'ECDSA', digest: 'SHA1' })).toBe(false)
    expect(verifySignatureWithKey(body, 'AAAA', { key: 'garbage', algorithm: 'ECDSA', digest: 'SHA1' })).toBe(false)
  })
})
