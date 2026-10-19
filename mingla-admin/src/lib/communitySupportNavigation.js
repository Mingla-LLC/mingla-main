/**
 * Parse the Community & Support deep link against the sections that are
 * actually present. Retired and unknown links safely fall back to Overview.
 */
export function communitySupportTabFromHash(hash, validTabIds) {
  const params = new URLSearchParams(String(hash || "").split("?")[1] || "");
  const requested = params.get("tab");
  return validTabIds.has(requested) ? requested : "overview";
}
