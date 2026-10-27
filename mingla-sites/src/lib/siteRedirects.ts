import {
  isReservedSegment,
  matchRedirect,
  normalizeRequestSegments,
  type RedirectStatus,
} from "../contracts/generated/routes.ts";
import { runtimeConfig } from "./config";
import { loadResolvedArtifact, requestHost, resolveHost } from "./publication";
import { siteRedirectRules } from "./pageRouting";

/**
 * #2829 AD-5 — the site's own redirect for a request path, or null.
 *
 * Read from the ACTIVE publication of the host the request arrived on (the
 * same verified artifact the page would render), never from the request. The
 * home page and the runtime's own routes are never redirected. Any failure to
 * resolve returns null so the page route makes its own decision; a redirect is
 * never invented.
 *
 * A relative target stays on the host the visitor used (the page route then
 * moves a non-primary host to the primary). The visitor's query string is
 * carried over unless the target names its own.
 */
export async function siteRedirectFor(
  headers: Headers,
  pathname: string,
  search: string,
  requestUrl: string,
): Promise<{ location: string; status: RedirectStatus } | null> {
  if (pathname === "/" || !pathname.startsWith("/")) return null;
  const segments = pathname.slice(1).split("/");
  if (isReservedSegment(segments[0] ?? "")) return null;
  const path = normalizeRequestSegments(segments);
  if (!path) return null;
  let redirects;
  let host: string;
  try {
    host = requestHost(headers);
    const resolved = await resolveHost(host);
    const artifact = await loadResolvedArtifact(resolved.value);
    redirects = siteRedirectRules(artifact);
  } catch {
    return null;
  }
  if (!redirects.length) return null;
  const match = matchRedirect(redirects, `/${path}`);
  if (!match) return null;
  if (!match.location.startsWith("/")) return match;
  // The validated host only (never a raw header); locally the dev port is kept.
  const local = runtimeConfig().mode === "local";
  const port = local
    ? (headers.get("host")?.match(/:([0-9]{2,5})$/)?.[1] ?? new URL(requestUrl).port)
    : "";
  const target = new URL(
    match.location,
    `${local ? "http" : "https"}://${host}${port ? `:${port}` : ""}`,
  );
  if (!target.search && search) target.search = search;
  return { location: target.toString(), status: match.status };
}
