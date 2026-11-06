/**
 * #2829 W10 / #2830 — where a same-site link goes inside a private preview:
 * the same page of the preview, on the same artifact
 * (`/preview?k=<key>&path=<page>`, or `/preview/share/<token>?path=<page>` on a
 * share link). Null for anything that isn't one of the site's pages (other
 * sites, runtime routes, media, in-page anchors), which then behaves as usual.
 */
const RUNTIME_PREFIXES = ["/api/", "/media/", "/om/", "/fonts/", "/map/", "/preview", "/_next/", "/.well-known/"];

/** Which preview a link stays inside. `frameAncestor` is the team preview's validated `fa`. */
export type PreviewLinkTarget =
  | { key: string; frameAncestor?: string | null; token?: undefined }
  | { token: string; key?: undefined; frameAncestor?: undefined };

/** A link's page is judged against this while rendering on the server, where no real origin is known. */
const RENDER_ORIGIN = "https://preview.invalid";

function previewBase(target: PreviewLinkTarget): { pathname: string; params: [string, string][] } {
  if (target.token !== undefined) return { pathname: `/preview/share/${target.token}`, params: [] };
  return {
    pathname: "/preview",
    params: [["k", target.key], ...(target.frameAncestor ? [["fa", target.frameAncestor] as [string, string]] : [])],
  };
}

function sitePageUrl(href: string, origin: string): URL | null {
  // A bare `#section` stays on the page already showing.
  if (href.startsWith("#")) return null;
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (RUNTIME_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return null;
  if (url.pathname === "/robots.txt" || url.pathname === "/sitemap.xml") return null;
  return url;
}

export function previewHref(href: string, origin: string, target: PreviewLinkTarget): string | null {
  const url = sitePageUrl(href, origin);
  if (!url) return null;
  const { pathname, params } = previewBase(target);
  const query = new URLSearchParams(params);
  const path = url.pathname.replace(/^\/+|\/+$/g, "");
  if (path) query.set("path", path);
  // A link can never change which preview it opens.
  for (const [name, value] of url.searchParams) if (name !== "path" && name !== "k" && name !== "fa") query.append(name, value);
  const search = query.toString();
  return `${pathname}${search ? `?${search}` : ""}${url.hash}`;
}

/** The same, while rendering: an address on another origin is left alone. */
export function previewRenderHref(href: string, target: PreviewLinkTarget): string {
  return previewHref(href, RENDER_ORIGIN, target) ?? href;
}

/**
 * Where a GET search form submits inside a preview. A GET form replaces the
 * action's query string, so what identifies the preview travels as fields.
 */
export function previewFormTarget(path: string, target: PreviewLinkTarget): { action: string; fields: [string, string][] } {
  const { pathname, params } = previewBase(target);
  const clean = path.replace(/^\/+|\/+$/g, "");
  return { action: pathname, fields: clean ? [...params, ["path", clean]] : params };
}

export function sharedPreviewHref(href: string, origin: string, token: string): string | null {
  return previewHref(href, origin, { token });
}
