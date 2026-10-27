import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { SitePageView } from "../../../../components/SitePageView";
import { SharedPreviewLinks } from "../../../../components/SharedPreviewLinks";
import { wantsLessData } from "../../../../lib/siteVideo";
import { resolveSitePath } from "../../../../lib/pageRouting";
import { normalizeRequestSegments } from "../../../../contracts/generated/routes.ts";
import { requestHost } from "../../../../lib/publication";
import { loadPageExtras } from "../../../../lib/pageExtras";
import { SHARE_TOKEN, sharedPreviewForRequest } from "../../../../lib/shareLinks";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Private preview — not live",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/**
 * #2829 W10 (S2) — a private share-preview link: the site's newest preview,
 * for someone outside the team (an agency's client), without signing in.
 * Same renderer as the live site and the team preview; a standing "Private
 * preview" banner; forms say they work once the site is live; no analytics
 * (a preview publication is never counted). Noindex everywhere (meta and the
 * X-Robots-Tag proxy.ts sets). An expired, revoked or foreign link, or a
 * site with no preview yet, is not found.
 */
export default async function SharedPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  if (!SHARE_TOKEN.test(token)) notFound();
  const search = await searchParams;
  const rawPath = Array.isArray(search.path) ? search.path[0] : search.path;
  const previewPath = normalizeRequestSegments(
    typeof rawPath === "string" && rawPath.length <= 300 ? rawPath.split("/") : [],
  );
  if (previewPath === null) notFound();
  let shared;
  try {
    shared = await sharedPreviewForRequest(requestHost(await headers()), token);
  } catch {
    notFound();
  }
  const { artifact, key } = shared;
  const resolved = resolveSitePath(artifact, previewPath);
  if (resolved.kind !== "page" && resolved.kind !== "entry") notFound();
  const entry = resolved.kind === "entry" ? resolved.entry : undefined;
  const { live, forms } = await loadPageExtras({
    site: { site_id: artifact.site_id },
    artifact,
    page: resolved.page,
    entry,
    search,
    preview: true,
    shared: true,
  });
  return (
    <div data-preview="1" data-shared-preview="1" data-page={resolved.page.key}>
      <p className="preview-banner" role="status">
        Private preview — not live yet. Only people with this link can see it.
      </p>
      <SitePageView artifact={artifact} page={resolved.page} previewKey={key} live={live} forms={forms} entry={entry} saveData={wantsLessData(await headers())} />
      <SharedPreviewLinks token={token} />
    </div>
  );
}
