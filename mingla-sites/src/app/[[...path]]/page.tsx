import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { SitePageView } from "../../components/SitePageView";
import { wantsLessData } from "../../lib/siteVideo";
import { canonicalOrigin, loadPublication, primaryRedirectUrl, requestHost } from "../../lib/publication";
import { isV2Artifact } from "../../lib/siteArtifact";
import { loadPageExtras } from "../../lib/pageExtras";
import { resolveSitePath } from "../../lib/pageRouting";
import { buildPageMetadata } from "../../lib/seo";
import { pageStructuredData, serializeJsonLd } from "../../lib/structuredData";
import { hiddenWhileEmpty } from "../../lib/plannedPageIndexing";
import { normalizeRequestSegments } from "../../contracts/generated/routes.ts";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ path?: string[] }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

async function currentPublication() {
  const incoming = await headers();
  return loadPublication(requestHost(incoming));
}

/**
 * #2829 AD-5 — every page of every site, at any depth, through ONE route.
 *
 * Replaces the home route and the single-segment route. The runtime's own
 * routes (api, media, map, preview, robots, sitemap) are static segments and
 * win before this one, which is why no page may take their names. Resolution
 * order (redirects → page → collection detail → root story → not found) lives
 * in `resolveSitePath`, shared with the sitemap and preview.
 */
async function requestedPath({ params }: Params): Promise<string | null> {
  const { path } = await params;
  // Page addresses are plain lowercase ASCII, so an encoded segment simply
  // never matches a page (404) — nothing is decoded here.
  return normalizeRequestSegments(path);
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const notFoundMeta: Metadata = { title: "Not found", robots: { index: false, follow: false } };
  try {
    const path = await requestedPath(props);
    if (path === null) return notFoundMeta;
    const { artifact, resolution } = await currentPublication();
    const resolved = resolveSitePath(artifact, path);
    if (resolved.kind !== "page" && resolved.kind !== "entry") return notFoundMeta;
    const page = resolved.page;
    // #2829 W9a (SC-29) — an empty planned offering page stays out of search
    // until Mingla has something for it (no republish needed).
    const noindex = page.seo?.noindex === true ||
      (resolved.kind === "page" && await hiddenWhileEmpty(resolution, artifact, page).catch(() => false));
    // #2829 W10 — title template, description, canonical and social tags on
    // the site's CURRENT main address (W8), from the artifact only.
    return buildPageMetadata({
      artifact,
      page,
      entry: resolved.kind === "entry" ? resolved.entry : undefined,
      origin: canonicalOrigin(resolution),
      noindex,
    });
  } catch {
    return notFoundMeta;
  }
}

export default async function SitePage(props: Params) {
  const path = await requestedPath(props);
  if (path === null) notFound();
  let publication: Awaited<ReturnType<typeof currentPublication>>;
  try {
    publication = await currentPublication();
  } catch {
    notFound();
  }
  const { artifact, resolution } = publication;
  // #2829 — a non-primary or detaching host 308s to the same path on the
  // primary address. Outside the try above: the redirect signals by throwing.
  const primary = primaryRedirectUrl(resolution, path === "" ? "/" : `/${path}`, await headers());
  if (primary) permanentRedirect(primary);
  const resolved = resolveSitePath(artifact, path);
  if (resolved.kind === "redirect") {
    // The site's own redirect rules answer in the proxy (with the exact 301
    // or 308 the owner chose) before any render; this is the same table, so
    // a request that still reaches here goes where the owner said, as a 308.
    permanentRedirect(resolved.location);
  }
  if (resolved.kind !== "page" && resolved.kind !== "entry") notFound();
  const page = resolved.page;
  const entry = resolved.kind === "entry" ? resolved.entry : undefined;
  // #2829 W4/W5 — Mingla's live offerings and the form stamp, read only when
  // this page uses them, for the site Core resolved for THIS host (never an
  // id from the request).
  const { live, forms } = await loadPageExtras({
    site: resolution,
    artifact,
    page,
    entry,
    search: await props.searchParams,
  });
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // #2829 W10 — schema.org data from the artifact and Mingla's feed only,
  // escaped so nothing in it can close the element; carries the CSP nonce.
  const structured = isV2Artifact(artifact)
    ? serializeJsonLd(pageStructuredData({ artifact, page, entry, live, origin: canonicalOrigin(resolution) }))
    : null;
  return (
    <div
      data-publication-id={resolution.publication_id}
      data-artifact-digest={resolution.artifact_digest}
      data-page={page.key}
    >
      {structured ? <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: structured }} /> : null}
      <SitePageView artifact={artifact} page={page} live={live} forms={forms} entry={entry} saveData={wantsLessData(await headers())} nonce={nonce} />
    </div>
  );
}
