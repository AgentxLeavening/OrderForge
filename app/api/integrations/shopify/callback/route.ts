import type { NextRequest } from 'next/server'
import { handleCallback } from '@/lib/integrations/routeHelpers'
import { shopifyProvider } from '@/lib/integrations/shopify'

export async function GET(request: NextRequest) {
  return handleCallback(shopifyProvider, request)
}
