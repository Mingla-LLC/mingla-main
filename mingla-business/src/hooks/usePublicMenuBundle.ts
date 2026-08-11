/**
 * Issue #1793 (#1767 Phase 4) — the public menu, with its service windows.
 *
 * ANON-SAFE, and deliberately in its OWN module rather than beside
 * `usePublicMenus` in `useMenus.ts`: that module imports `AuthContext` at module
 * scope for the BRAND-side hooks that share the file, so every anon buyer route
 * reading a public menu drags the auth context in behind it. This one imports a
 * service and nothing else. `/b/{brand}/v/{venue}` is a route a diner reaches
 * with no account, and the fewer things it can accidentally wake up, the better.
 *
 * ONE query, the same one `usePublicMenus` already ran — the windows ride along
 * on rows the view was returning anyway (SPEC #1788 P-14 appended them at
 * #1789), so ordering costs the page no extra round trip.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  fetchPublicMenuBundle,
  type PublicMenuBundle,
} from "../services/publicMenusService";

export const publicMenuBundleKeys = {
  detail: (brandSlug: string, venueSlug: string) =>
    ["publicMenuBundle", brandSlug, venueSlug] as const,
};

const EMPTY: PublicMenuBundle = { groups: [], windows: {} };

export function usePublicMenuBundle(
  brandSlug: string | null,
  venueSlug: string | null,
): UseQueryResult<PublicMenuBundle> {
  const enabled = brandSlug !== null && brandSlug.length > 0 &&
    venueSlug !== null && venueSlug.length > 0;
  return useQuery<PublicMenuBundle>({
    queryKey: enabled
      ? publicMenuBundleKeys.detail(brandSlug, venueSlug)
      : (["publicMenuBundle", "disabled"] as const),
    enabled,
    staleTime: 60_000,
    queryFn: () =>
      enabled
        ? fetchPublicMenuBundle(brandSlug, venueSlug)
        : Promise.resolve(EMPTY),
  });
}
