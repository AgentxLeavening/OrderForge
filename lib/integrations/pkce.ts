import { randomBytes, createHash } from 'node:crypto'

const base64url = (buf: Buffer) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// PKCE pair for Etsy's OAuth 2.0 authorize flow.
export function generatePkcePair() {
  const codeVerifier = base64url(randomBytes(32))
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest())
  return { codeVerifier, codeChallenge }
}

export function generateState() {
  return base64url(randomBytes(16))
}
