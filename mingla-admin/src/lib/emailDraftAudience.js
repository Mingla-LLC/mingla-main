// Issue #3720 — restoring a saved Admin email draft must never pre-select an
// audience that reaches Explorer users. Hosts are the default; "Everyone" and
// Explorer segments always need a fresh, explicit choice plus count review.

export const EMAIL_DRAFT_KEY = "mingla_admin_email_draft_v2";
export const EMAIL_DRAFT_VERSION = 2;
export const LEGACY_EMAIL_DRAFT_KEYS = ["mingla_admin_email_draft_v1"];

/**
 * Decide which audience a restored draft may pre-select.
 * Only host-only segments and a single chosen person are restored; anything
 * else falls back to the Hosts default.
 * @param {unknown} saved
 * @param {Record<string, string>} defaultFilters
 * @returns {{ audienceMode: "segment" | "person", filters: Record<string, string> }}
 */
export function restoreDraftAudience(saved, defaultFilters) {
  const hostDefault = { audienceMode: "segment", filters: { ...defaultFilters, userType: "host" } };
  if (!saved || typeof saved !== "object") return hostDefault;
  const savedFilters = saved.filters && typeof saved.filters === "object" ? saved.filters : {};
  if (saved.audienceMode === "segment" && savedFilters.userType === "host") {
    return { audienceMode: "segment", filters: { ...defaultFilters, ...savedFilters, userType: "host" } };
  }
  if (saved.audienceMode === "person" && saved.selectedRecipient?.profile_id) {
    return { audienceMode: "person", filters: { ...defaultFilters, userType: "host" } };
  }
  return hostDefault;
}
