/**
 * #3355 bug 18 — where Brand Edit goes after a save or Back.
 *
 * Brand Edit used to fall back to the Account tab whenever there was no back
 * history, which is exactly the case when Ari (or a link) opened
 * `/brand/<id>/edit?section=…` directly on web: the owner saved and landed on
 * Account. Now: back history first, then the opener's `returnTo` (internal
 * paths only), then the brand's own page. Never Account.
 *
 * Pure: no React, no router import.
 */

/** Only an in-app path: one leading "/", no scheme, no protocol-relative "//". */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  if (/[\s\\]/.test(trimmed)) return null;
  if (/^\/[^/?#]*:/.test(trimmed)) return null;
  return trimmed;
}

export type BrandEditReturn =
  | { kind: "back" }
  | { kind: "replace"; href: string };

export function brandEditReturnTarget(input: {
  canGoBack: boolean;
  returnTo: unknown;
  brandId: string | null;
}): BrandEditReturn {
  if (input.canGoBack) return { kind: "back" };
  const returnTo = safeReturnTo(input.returnTo);
  if (returnTo !== null) return { kind: "replace", href: returnTo };
  if (input.brandId !== null && input.brandId.length > 0) {
    return { kind: "replace", href: `/brand/${encodeURIComponent(input.brandId)}` };
  }
  return { kind: "replace", href: "/(tabs)/home" };
}

/** True for a Brand Edit route (`/brand/<id>/edit`, with or without a query). */
export function isBrandEditRoute(route: string): boolean {
  return /^\/brand\/[^/?#]+\/edit(?:[?#]|$)/.test(route);
}

/** Adds `returnTo` to a route's query (left alone when the path is unsafe). */
export function withReturnTo(route: string, returnTo: string): string {
  const safe = safeReturnTo(returnTo);
  if (safe === null) return route;
  const separator = route.includes("?") ? "&" : "?";
  return `${route}${separator}returnTo=${encodeURIComponent(safe)}`;
}

/** The Ari screen's own path, with the Website context it was opened with. */
export function ariReturnPath(input: {
  brandId: string | null | undefined;
  sitesIntent: string | null | undefined;
  setupPart: string | null | undefined;
}): string {
  const query: string[] = [];
  if (typeof input.brandId === "string" && input.brandId.length > 0) {
    query.push(`brandId=${encodeURIComponent(input.brandId)}`);
  }
  if (input.sitesIntent === "setup" || input.sitesIntent === "edit") {
    query.push(`sitesIntent=${input.sitesIntent}`);
  }
  if (typeof input.setupPart === "string" && input.setupPart.length > 0) {
    query.push(`setupPart=${encodeURIComponent(input.setupPart)}`);
  }
  return query.length > 0 ? `/(tabs)/ari?${query.join("&")}` : "/(tabs)/ari";
}
