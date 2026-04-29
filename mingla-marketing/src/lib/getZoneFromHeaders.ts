import { headers } from 'next/headers';
import type { Zone } from '@/lib/zones';

/**
 * Read the active zone from the host header (server-only).
 * Falls back to 'umbrella' if host doesn't match a known zone.
 *
 * Pairs with middleware.ts — the middleware also rewrites to /_sites/[zone]/,
 * but layouts use this helper to know which zone they're rendering for so
 * they can pass the right `activeZone` to the AudienceSwitcher.
 */
export async function getZoneFromHeaders(): Promise<{ zone: Zone; isDev: boolean }> {
  const h = await headers();
  const host = h.get('host') ?? '';
  const isDev = host.includes('localhost') || host.includes('127.0.0.1');

  if (host.startsWith('explore.')) return { zone: 'explore', isDev };
  if (host.startsWith('business.')) return { zone: 'business', isDev };
  return { zone: 'umbrella', isDev };
}
