// Path-based surface detection. Everything lives on the apex domain;
// organiser content is a /organisers/* slug, NOT a subdomain.
export type Surface = 'explorer' | 'organiser'

export const ORGANISER_PATH = '/organisers'

export function getSurfaceFromPath(pathname: string): Surface {
  return pathname.startsWith(ORGANISER_PATH) ? 'organiser' : 'explorer'
}
