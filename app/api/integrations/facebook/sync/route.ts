import { handleSync } from '@/lib/integrations/routeHelpers'
import { facebookProvider } from '@/lib/integrations/facebook'

export async function POST() {
  return handleSync(facebookProvider)
}
