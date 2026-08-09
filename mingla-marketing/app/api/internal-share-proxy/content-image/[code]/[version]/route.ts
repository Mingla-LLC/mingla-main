import { proxySharedCard } from '@/lib/shared-card-proxy'
export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: { params: Promise<{ code: string; version: string }> }) {
  const { code, version } = await context.params
  return proxySharedCard(request, code, 'content-image', fetch, version)
}
