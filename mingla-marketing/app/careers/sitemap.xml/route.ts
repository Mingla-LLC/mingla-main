import { listOpenRoles } from '@/lib/careers-data'
import { careersSitemapXml } from '@/lib/careers-seo'

// #4339 round B — career.usemingla.com/sitemap.xml: the index and every open
// role (middleware rewrites the careers host's /sitemap.xml here). If the
// roles cannot be read, the index alone is listed and the error is logged.
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  let roles: Awaited<ReturnType<typeof listOpenRoles>> = []
  try {
    roles = await listOpenRoles()
  } catch (error) {
    console.error('[careers sitemap] roles unavailable', error instanceof Error ? error.message : String(error))
  }
  return new Response(careersSitemapXml(roles), { headers: { 'content-type': 'application/xml; charset=utf-8' } })
}
