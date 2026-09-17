/**
 * #3386 — how a host changes the details Mingla checks.
 *
 * Settings → "Edit venue details" used to open the BRAND page, which edits
 * none of the venue's own fields. There is no host-side editor for a venue's
 * name, address, category or contact details: `venue_listings` is written only
 * through reviewed server paths, and renaming a venue is deliberately guarded
 * (#2099). Until a direct editor and its review rule are decided, the honest
 * path is a prefilled request to Mingla support that names the venue exactly.
 *
 * Pure so the destination is testable: it must be a support email, never a
 * brand route, and it must identify the venue unambiguously.
 */

export const VENUE_DETAILS_SUPPORT_EMAIL = "support@usemingla.com";

export function venueDetailsChangeRequestUrl(input: {
  venueId: string;
  venueName: string | null;
}): string {
  const name = (input.venueName ?? "").trim() || "my venue";
  const subject = `Change venue details: ${name}`;
  const body = [
    `Venue: ${name}`,
    `Venue ID: ${input.venueId}`,
    "",
    "What should change (name, address, category or contact details):",
    "",
  ].join("\n");
  return `mailto:${VENUE_DETAILS_SUPPORT_EMAIL}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
}
