/**
 * Issue #4261 amendment 1 (6.4) — what a tapped link is, decided in one place.
 *
 * Pure (no React Native): `InAppBrowserProvider` reads `classifyLink` to pick
 * Mingla's in-app browser (web pages), the in-app overlay (documents), the
 * system (phone, email, SMS) or a refusal (everything else). The normalising
 * to https (iOS ATS) happens here, on the call-site side, never inside
 * InAppBrowserModal (I-WEBVIEW-URL-NORMALIZED).
 *
 * `mapsWebUrl` is the https Google Maps form from `@mingla/offering-rendering`'s
 * `buildMapsDeepLink` (the one maps-URL owner), so "Open in Maps" opens the map
 * inside Mingla instead of handing off to a maps app.
 */
import { buildMapsDeepLink } from "@mingla/offering-rendering";
import { normalizeWebsiteUrl } from "./normalizeWebsiteUrl";

export type LinkClass =
  | { kind: "web"; url: string }
  | { kind: "document"; url: string }
  | { kind: "system"; url: string }
  | { kind: "invalid" };

const SYSTEM_SCHEME = /^(tel|mailto|sms):/i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WEB_SCHEME = /^https?:\/\//i;
/** A bare host with a dot ("example.com/menu"), no spaces. */
const BARE_HOST = /^[^\s/:@]+\.[^\s/:@]+(?:[/?#][^\s]*)?$/;

function isDocumentPath(url: string): boolean {
  try {
    return /\.pdf$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function hasWebHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.hostname.includes(".");
  } catch {
    return false;
  }
}

export function classifyLink(raw: string | null | undefined): LinkClass {
  const text = (raw ?? "").trim();
  if (!text) return { kind: "invalid" };
  if (SYSTEM_SCHEME.test(text)) {
    return text.replace(SYSTEM_SCHEME, "").trim() ? { kind: "system", url: text } : { kind: "invalid" };
  }
  const webLike = WEB_SCHEME.test(text) || (!ANY_SCHEME.test(text) && BARE_HOST.test(text));
  if (!webLike) return { kind: "invalid" };
  const url = normalizeWebsiteUrl(text);
  if (!url || !hasWebHost(url)) return { kind: "invalid" };
  return isDocumentPath(url) ? { kind: "document", url } : { kind: "web", url };
}

/** The https map of a place (coordinates first, else its name), or null when there is nothing to show. */
export function mapsWebUrl(input: {
  lat: number | null;
  lng: number | null;
  label: string | null;
  /** #4334 — a Google place id anchors the link (`query_place_id`). */
  googlePlaceId?: string | null;
}): string | null {
  const geo = input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng } : null;
  return buildMapsDeepLink({ geo, label: input.label, googlePlaceId: input.googlePlaceId ?? null, platform: "web" })?.url ?? null;
}
