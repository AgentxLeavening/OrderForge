import { handleDisconnect } from '@/lib/integrations/routeHelpers'
import { ebayProvider } from '@/lib/integrations/ebay'

export async function POST() {
  return handleDisconnect(ebayProvider)
}
