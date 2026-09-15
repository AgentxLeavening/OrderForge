// Venmo pay links for the public quote page.
//
// Format: https://venmo.com/<username>?txn=pay&amount=12.34&note=...
// Widely used but not officially documented by Venmo, so it's built to degrade:
// if Venmo ever stops honouring the query string, the link still opens the
// seller's profile, and the quote page shows the @username and exact amount
// next to the button so the customer can pay by hand.

const USERNAME = /^[A-Za-z0-9_-]{1,64}$/

/**
 * Accepts what a seller is likely to paste — "@Like-Gravy", "venmo.com/u/Like-Gravy",
 * "https://account.venmo.com/u/Like-Gravy" — and returns the bare username,
 * or null if what's left isn't a valid one.
 */
export function normalizeVenmoUsername(input: string | null | undefined): string | null {
  let value = (input || '').trim()
  if (!value) return null
  const fromUrl = value.match(/venmo\.com\/(?:u\/)?([^/?#\s]+)/i)
  if (fromUrl) value = fromUrl[1]
  value = value.replace(/^@/, '')
  return USERNAME.test(value) ? value : null
}

/** A prefilled "pay this user" link. Amount is rounded to cents; a non-positive amount is left off. */
export function venmoPayUrl(username: string, amount: number, note?: string): string {
  const params = new URLSearchParams({ txn: 'pay' })
  const cents = Math.round((Number(amount) || 0) * 100)
  if (cents > 0) params.set('amount', (cents / 100).toFixed(2))
  if (note) params.set('note', note.slice(0, 280))
  return `https://venmo.com/${encodeURIComponent(username)}?${params.toString()}`
}
