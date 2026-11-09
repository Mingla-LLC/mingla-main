/**
 * #4334 (tester D-2) — the claim review's "Open in Google Maps" link.
 *
 * Google Maps URLs require `query` on a search link; `query_place_id` only
 * anchors it. A link with `query_place_id` alone can open a blank search.
 * https://developers.google.com/maps/documentation/urls/get-started#search-action
 *
 * The pool's own Maps URI wins. Otherwise: the place id anchors, and `query`
 * is the venue's coordinates when known (exact), else its name and address.
 */
export function claimMapsUri(detail) {
  if (!detail) return null;
  const poolUri = detail.place_pool?.google_maps_uri;
  if (typeof poolUri === "string" && poolUri.length > 0) return poolUri;
  const placeId = typeof detail.google_place_id === "string" ? detail.google_place_id.trim() : "";
  if (placeId.length === 0) return null;
  const lat = Number(detail.lat ?? detail.place_pool?.lat);
  const lng = Number(detail.lng ?? detail.place_pool?.lng);
  const hasPoint =
    detail.lat !== null && detail.lat !== undefined && Number.isFinite(lat) && Number.isFinite(lng);
  const label = [detail.name, detail.address]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0)
    .join(", ");
  const query = hasPoint ? `${lat},${lng}` : label.length > 0 ? label : placeId;
  return (
    "https://www.google.com/maps/search/?api=1" +
    `&query=${encodeURIComponent(query)}` +
    `&query_place_id=${encodeURIComponent(placeId)}`
  );
}

/**
 * A Google Maps link for a venue change request's proposed pin, so the admin
 * can check the spot. #4334 — when the host picked a Google place, its id
 * (`details_change_place_id`) anchors the link (Google shows the named place);
 * `query` stays the coordinate pair.
 */
export function proposedPinMapUrl(request) {
  const lat = request?.details_change_lat;
  const lng = request?.details_change_lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  const base = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  const placeId =
    typeof request?.details_change_place_id === "string" ? request.details_change_place_id.trim() : "";
  return /^[A-Za-z0-9_-]{10,}$/.test(placeId)
    ? `${base}&query_place_id=${encodeURIComponent(placeId)}`
    : base;
}
