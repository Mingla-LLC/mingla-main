/**
 * #2829 W10 — where a same-site link goes inside a private share link: the
 * same page of the preview (`/preview/share/<token>?path=<page>`). Null for
 * anything that isn't one of the site's pages (other sites, runtime routes,
 * media, in-page anchors), which then behaves as usual.
 */
const RUNTIME_PREFIXES = ["/api/", "/media/", "/om/", "/fonts/", "/map/", "/preview", "/_next/", "/.well-known/"];

export function sharedPreviewHref(href: string, origin: string, token: string): string | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (RUNTIME_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return null;
  if (url.pathname === "/robots.txt" || url.pathname === "/sitemap.xml") return null;
  const target = new URL(`/preview/share/${token}`, origin);
  const path = url.pathname.replace(/^\/+|\/+$/g, "");
  if (path) target.searchParams.set("path", path);
  for (const [name, value] of url.searchParams) if (name !== "path") target.searchParams.append(name, value);
  return `${target.pathname}${target.search}${url.hash}`;
}
