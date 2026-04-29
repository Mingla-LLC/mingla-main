/**
 * Mingla marketing zones — one per subdomain.
 *
 * Used by: middleware (host → zone resolution), AudienceSwitcher (active state),
 * layouts (zone-specific chrome).
 */

export type Zone = 'umbrella' | 'explore' | 'business';

export const ZONES: readonly Zone[] = ['umbrella', 'explore', 'business'] as const;

/** Production hostname for each zone. Used to build cross-zone URLs. */
export const ZONE_HOSTS: Record<Zone, string> = {
  umbrella: 'usemingla.com',
  explore: 'explore.usemingla.com',
  business: 'business.usemingla.com',
};

/** Local-dev hostname for each zone. */
export const ZONE_HOSTS_DEV: Record<Zone, string> = {
  umbrella: 'localhost:3000',
  explore: 'explore.localhost:3000',
  business: 'business.localhost:3000',
};

/** Display label for the audience switcher. Umbrella has no switcher pill. */
export const ZONE_LABEL: Record<Exclude<Zone, 'umbrella'>, string> = {
  explore: 'Explorers',
  business: 'Organisers',
};

/**
 * Build an absolute URL to the given zone. Uses production hosts unless
 * `isDev` is true. Always returns http for dev (localhost has no SSL),
 * https for prod.
 */
export function zoneUrl(zone: Zone, isDev: boolean = false): string {
  const host = isDev ? ZONE_HOSTS_DEV[zone] : ZONE_HOSTS[zone];
  const protocol = isDev ? 'http' : 'https';
  return `${protocol}://${host}`;
}
