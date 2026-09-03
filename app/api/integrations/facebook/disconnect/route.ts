import { handleDisconnect } from '@/lib/integrations/routeHelpers'
import { facebookProvider } from '@/lib/integrations/facebook'

export async function POST() {
  return handleDisconnect(facebookProvider)
}
