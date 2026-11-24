/**
 * #4572 item 4 — the fields the server accepts as "doesn't apply"
 * (brand_context_mark_not_applicable). Never a required field. One list for
 * the Brand step and the Build step's "Still needed" rows.
 */
export const NOT_APPLICABLE_KEYS: ReadonlySet<string> = new Set([
  "venue_descriptor", "contact_email", "contact_phone", "address", "city_country",
  "social_links", "profile_photo", "cover_media", "theme",
]);
