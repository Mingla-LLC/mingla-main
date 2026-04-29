/**
 * normalizeWebsiteUrl — single owner for sanitising user-supplied website
 * URLs before passing them into the in-app WebView (react-native-webview).
 *
 * Why this exists:
 *   iOS App Transport Security (ATS) blocks plain http:// requests in WebView.
 *   `place_pool.website` is sourced from Google Places and contains a mix of
 *   http:// and https:// URLs. Without normalization the WebView returns
 *   NSURLErrorDomain Error -1022 ("App Transport Security policy requires
 *   the use of a secure connection.").
 *
 * Hardening:
 *   - Trims surrounding whitespace
 *   - Case-insensitive scheme check (catches "HTTP://", "Http://" variants)
 *   - Bare hosts (no scheme) get https:// prefixed
 *   - Returns null for empty/null/undefined/whitespace-only input
 *
 * Used by:
 *   - app-mobile/src/components/expandedCard/ActionButtons.tsx
 *     (handlePoliciesAndReservations, single-place flow)
 *   - app-mobile/src/components/ExpandedCardModal.tsx
 *     (curated-stop "Policies & Reservations" button)
 *
 * Established by: ORCH-0649
 */
export function normalizeWebsiteUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (/^http:\/\//i.test(trimmed)) {
    return trimmed.replace(/^http:\/\//i, 'https://');
  }
  if (/^https:\/\//i.test(trimmed)) {
    return trimmed;
  }
  // Bare host or relative path — assume https.
  return `https://${trimmed}`;
}
