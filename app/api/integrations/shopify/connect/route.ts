import type { NextRequest } from 'next/server'
import { handleConnect } from '@/lib/integrations/routeHelpers'
import { shopifyProvider } from '@/lib/integrations/shopify'

export async function GET(request: NextRequest) {
  return handleConnect(shopifyProvider, request)
}
