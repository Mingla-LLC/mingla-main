import { careersRobotsTxt } from '@/lib/careers-seo'

// #4339 round B — career.usemingla.com/robots.txt (middleware rewrites the
// careers host's /robots.txt here; the apex never reaches /careers/*).
export const dynamic = 'force-static'

export function GET(): Response {
  return new Response(careersRobotsTxt(), { headers: { 'content-type': 'text/plain; charset=utf-8' } })
}
