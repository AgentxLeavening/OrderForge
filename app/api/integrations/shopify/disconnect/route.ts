import { handleDisconnect } from '@/lib/integrations/routeHelpers'
import { shopifyProvider } from '@/lib/integrations/shopify'

export async function POST() {
  return handleDisconnect(shopifyProvider)
}
