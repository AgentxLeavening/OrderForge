import { handleSync } from '@/lib/integrations/routeHelpers'
import { shopifyProvider } from '@/lib/integrations/shopify'

export async function POST() {
  return handleSync(shopifyProvider)
}
