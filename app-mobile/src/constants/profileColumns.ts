/**
 * Issue #3969 — the profile fields any signed-in person may read about
 * someone else. Everything else on a profile (contact details, birthday,
 * location, settings) is read only through the owner's own read
 * (`get_my_profile`) or a purpose-built server lookup.
 *
 * One owner: every app's direct reads of `profiles` stay inside this list.
 * The source guard (src/constants/__tests__/issue_3969_profile_public_columns
 * .implementor.test.ts) scans Explorer, Host and Admin source against it.
 */
export const PUBLIC_PROFILE_COLUMNS = [
  "id",
  "display_name",
  "username",
  "first_name",
  "last_name",
  "avatar_url",
  "bio",
  "photos",
  "country",
  "visibility_mode",
  "show_activity",
  "share_location",
  "share_budget",
  "share_categories",
  "share_date_time",
  "active",
  "created_at",
  "updated_at",
] as const;

export type PublicProfileColumn = (typeof PUBLIC_PROFILE_COLUMNS)[number];

