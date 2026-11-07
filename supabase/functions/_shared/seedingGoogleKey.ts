/**
 * #4276: the Google key that city seeding and photo downloads spend.
 *
 * Seeding and photo downloads can run on their own Google Cloud project
 * (GOOGLE_SEEDING_API_KEY), so their spend stays off the key the rest of the
 * product uses. With no seeding key set, they keep using GOOGLE_MAPS_API_KEY.
 */
export function seedingGoogleApiKey(
  get: (name: string) => string | undefined = (name) => Deno.env.get(name),
): string {
  const seeding = get("GOOGLE_SEEDING_API_KEY")?.trim();
  if (seeding) return seeding;
  return get("GOOGLE_MAPS_API_KEY")?.trim() ?? "";
}
