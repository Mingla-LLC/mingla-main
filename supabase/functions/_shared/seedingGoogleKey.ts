/**
 * #4276: the Google key that city seeding and photo downloads spend.
 *
 * Seeding and photo downloads run on their own Google Cloud project
 * (GOOGLE_SEEDING_API_KEY), so their spend stays off the key the rest of the
 * product uses. With no seeding key set, they keep using GOOGLE_MAPS_API_KEY.
 */
export type SeedingGoogleKeys = { seeding?: string; maps?: string };

export function seedingGoogleApiKey(
  keys: SeedingGoogleKeys = {
    seeding: Deno.env.get("GOOGLE_SEEDING_API_KEY"),
    maps: Deno.env.get("GOOGLE_MAPS_API_KEY"),
  },
): string {
  const seeding = keys.seeding?.trim();
  if (seeding) return seeding;
  return keys.maps?.trim() ?? "";
}
