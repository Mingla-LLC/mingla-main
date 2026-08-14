// Path-based surface detection. Everything lives on the apex domain;
// Host content is a /host/* slug, NOT a subdomain.
// (ORCH-1224 renamed the route /organisers → /host; the internal
//  `surface` discriminator value stays 'organiser' — it is never user-visible.)
export type Surface = 'explorer' | 'organiser'

export const BUSINESS_PATH = '/host'

export function getSurfaceFromPath(pathname: string): Surface {
  return pathname.startsWith(BUSINESS_PATH) ? 'organiser' : 'explorer'
}
