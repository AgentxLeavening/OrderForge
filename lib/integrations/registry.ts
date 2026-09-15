import type { MarketplaceProvider, ProviderId } from './types'
import { etsyProvider } from './etsy'
import { ebayProvider } from './ebay'
import { shopifyProvider } from './shopify'

// Lookup from a provider id to its implementation, for code that discovers
// providers at runtime rather than importing one directly (the scheduled sync
// reads connection rows and needs whichever provider each row names).
//
// Deliberately only the three that are live and verified. TikTok Shop and
// Facebook are scaffolding that has never been exercised against real
// credentials — a background job must not be the first thing to find that out,
// unattended and on a schedule. Add them here once they're actually verified,
// which is the same bar `VISIBLE_PROVIDERS` in the Settings page applies.
export const SYNCABLE_PROVIDERS: Record<string, MarketplaceProvider> = {
  etsy: etsyProvider,
  ebay: ebayProvider,
  shopify: shopifyProvider,
}

export const SYNCABLE_PROVIDER_IDS = Object.keys(SYNCABLE_PROVIDERS) as ProviderId[]

export function getSyncableProvider(id: string): MarketplaceProvider | null {
  return SYNCABLE_PROVIDERS[id] ?? null
}
