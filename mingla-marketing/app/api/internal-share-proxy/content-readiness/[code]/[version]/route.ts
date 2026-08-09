import { contentShareReadiness } from '@/lib/content-share-readiness'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ code: string; version: string }> }) {
  const { code, version } = await context.params
  return contentShareReadiness(request, code, version)
}
