// Path-based surface detection. Everything lives on the apex domain;
// business content is a /business/* slug, NOT a subdomain.
// (ORCH-1224 renamed the route /organisers → /business; the internal
//  `surface` discriminator value stays 'organiser' — it is never user-visible.)
export type Surface = 'explorer' | 'organiser'

export const BUSINESS_PATH = '/business'

export function getSurfaceFromPath(pathname: string): Surface {
  return pathname.startsWith(BUSINESS_PATH) ? 'organiser' : 'explorer'
}
