import type { NextRequest } from 'next/server'
import { handleConnect } from '@/lib/integrations/routeHelpers'
import { ebayProvider } from '@/lib/integrations/ebay'

export async function GET(request: NextRequest) {
  return handleConnect(ebayProvider, request)
}
