// PayPal.Me pay links for the public quote page — the PayPal counterpart to
// lib/venmo.ts.
//
// Format: https://paypal.me/<name>/<amount>. Unlike Venmo's query-string
// links, the amount path is a documented PayPal.Me feature. PayPal.Me has no
// way to prefill the payment note, so the quote page shows the order reference
// as text for the customer to add.

const NAME = /^[A-Za-z0-9._-]{1,64}$/

/**
 * Accepts "LikeGravy", "@LikeGravy", "paypal.me/LikeGravy",
 * "https://www.paypal.com/paypalme/LikeGravy/10" — returns the bare PayPal.Me
 * name, or null if it isn't one.
 */
export function normalizePaypalMeName(input: string | null | undefined): string | null {
  let value = (input || '').trim()
  if (!value) return null
  const fromUrl = value.match(/(?:paypal\.me|paypal\.com\/paypalme)\/([^/?#\s]+)/i)
  if (fromUrl) value = fromUrl[1]
  value = value.replace(/^@/, '')
  return NAME.test(value) ? value : null
}

/** A PayPal.Me link with the amount filled in. A non-positive amount is left off. */
export function paypalPayUrl(name: string, amount: number): string {
  const base = `https://paypal.me/${encodeURIComponent(name)}`
  const cents = Math.round((Number(amount) || 0) * 100)
  return cents > 0 ? `${base}/${(cents / 100).toFixed(2)}` : base
}
