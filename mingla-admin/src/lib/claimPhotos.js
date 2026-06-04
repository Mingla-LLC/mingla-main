/**
 * META-ORCH-1062 — pure helper for the admin claim-review photo gallery.
 *
 * Merges the cover image + the deck stored_photo_urls + the venue-uploaded
 * business_gallery_urls into one ordered, deduped, falsy-filtered list for the
 * inline gallery + PhotoLightbox. Extracted from ClaimsPage.jsx so it is
 * unit-testable with `node --test` (no React/JSX import).
 *
 * @param {{ place_pool?: { stored_photo_urls?: unknown, business_gallery_urls?: unknown } } | null} bundle
 * @param {string | null | undefined} coverUrl
 * @returns {string[]}
 */
export function collectClaimPhotos(bundle, coverUrl) {
  const pp = (bundle && bundle.place_pool) || {};
  const all = [
    coverUrl,
    ...(Array.isArray(pp.stored_photo_urls) ? pp.stored_photo_urls : []),
    ...(Array.isArray(pp.business_gallery_urls) ? pp.business_gallery_urls : []),
  ];
  const seen = new Set();
  const out = [];
  for (const u of all) {
    if (typeof u === "string" && u.length > 0 && !seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}
