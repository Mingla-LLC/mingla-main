import { NextResponse, type NextRequest } from "next/server";

import { buildCsp } from "./lib/csp";
import { PREVIEW_KEY_HEADER } from "./lib/previewArtifact";
import { SHARE_TOKEN_HEADER, shareTokenFromPath } from "./lib/shareLinks";
import { siteRedirectFor } from "./lib/siteRedirects";
import { requestStreamVideoHosts } from "./lib/siteVideo";
import { runtimeConfig } from "./lib/config";

/** Local mode only when the runtime config says so (any doubt: production rules). */
function isLocalMode(): boolean {
  try {
    return runtimeConfig().mode === "local";
  } catch {
    return false;
  }
}

/*
 * A fresh nonce per request, which is why every page in this app is
 * force-dynamic: Next.js can only stamp a nonce onto its bootstrap scripts
 * while it is rendering a real request.
 *
 * #2829 AD-5 — before anything renders, the site's own redirect rules (up to
 * 200, 301 or 308, `:param` / `:path*` patterns) are applied to the request
 * path, so an old address answers with the owner's exact status instead of a
 * render. Anything that cannot be resolved falls through to the page, which
 * makes its own decision (usually a 404).
 */
/** `/preview` and everything under it (shared links) are private previews. */
export function isPrivatePreviewPath(pathname: string): boolean {
  return pathname === "/preview" || pathname.startsWith("/preview/");
}

export async function proxy(request: NextRequest) {
  const redirect = await siteRedirectFor(
    request.headers,
    request.nextUrl.pathname,
    request.nextUrl.search,
    request.url,
  );
  if (redirect) {
    return NextResponse.redirect(redirect.location, redirect.status);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp({
    nonce,
    pathname: request.nextUrl.pathname,
    dev: process.env.NODE_ENV === "development",
    // #2829 W6 — a stream-video host only for a site that plays one from an
    // allowed host (none unless SITES_VIDEO_CDN_HOSTS names it).
    streamHosts: await requestStreamVideoHosts(request.headers),
    localMode: isLocalMode(),
    // #2829 W9f — a Business Vercel preview deployment names itself (checked
    // against the one allowed pattern in frameAncestorsFor).
    frameAncestor: request.nextUrl.pathname === "/preview"
      ? request.nextUrl.searchParams.get("fa")
      : null,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // #2829 W3 — <html data-design> for a private preview comes from the draft,
  // so the layout needs the preview key; it is shape-checked again there. A
  // visitor-supplied copy of this header is always dropped first.
  requestHeaders.delete(PREVIEW_KEY_HEADER);
  if (request.nextUrl.pathname === "/preview") {
    const key = request.nextUrl.searchParams.get("k");
    if (key && key.length <= 256) requestHeaders.set(PREVIEW_KEY_HEADER, key);
  }
  // #2829 W10 — a private share-preview link: the layout needs its token to
  // load the draft's design (checked again there). Visitor copies are dropped.
  requestHeaders.delete(SHARE_TOKEN_HEADER);
  const shareToken = shareTokenFromPath(request.nextUrl.pathname);
  if (shareToken) requestHeaders.set(SHARE_TOKEN_HEADER, shareToken);
  // Next.js reads the nonce back out of this header to stamp its own scripts.
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  if (isPrivatePreviewPath(request.nextUrl.pathname)) {
    // #2829 W10 — every private preview (the team's and a shared link) stays
    // out of search, is never cached, and (shared links) never leaks its
    // address to a site a visitor follows a link to.
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set("Cache-Control", "private, no-store");
    if (shareToken !== null || request.nextUrl.pathname.startsWith("/preview/share/")) {
      response.headers.set("Referrer-Policy", "no-referrer");
    }
  }
  return response;
}

export const config = {
  matcher: [
    {
      // Everything except API routes and static assets. /preview is included
      // on purpose: the draft has to be interactive too.
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
