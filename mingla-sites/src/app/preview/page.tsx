import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { SitePageView } from "../../components/SitePageView";
import { wantsLessData } from "../../lib/siteVideo";
import { resolveSitePath } from "../../lib/pageRouting";
import { normalizeRequestSegments } from "../../contracts/generated/routes.ts";
import {
  loadPreviewArtifact,
  parsePreviewArtifactKey,
} from "../../lib/previewArtifact";
import { requestHost, resolveHostSite } from "../../lib/publication";
import { loadPageExtras } from "../../lib/pageExtras";
import { PreviewTokenBridge } from "../../components/PreviewTokenBridge";
import { runtimeConfig } from "../../lib/config";

/** Local mode only when the runtime config says so (any doubt: production rules). */
function previewLocalMode(): boolean {
  try {
    return runtimeConfig().mode === "local";
  } catch {
    return false;
  }
}

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Private preview — not live",
  robots: { index: false, follow: false },
};

/**
 * #2830 — the ONE renderer, showing a draft.
 *
 * This route exists so "preview" and "published" cannot drift: both go through
 * `RestaurantV1` and the same stylesheet, from an artifact built by the same
 * builder. The only difference a viewer sees is the standing "not live" banner,
 * and the fact that nothing here is reachable from the public site.
 */
export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.k;
  const parsed = parsePreviewArtifactKey(Array.isArray(raw) ? raw[0] : raw);
  if (!parsed) notFound();
  /*
   * #2829 W2 — EVERY page can be previewed, not just home. `path` names a page
   * of THIS preview artifact (the same resolver the live site uses); it can
   * never reach another site or a published artifact, because the artifact is
   * fixed by the key above. Unknown paths 404 like the live site.
   */
  const rawPath = Array.isArray(params.path) ? params.path[0] : params.path;
  const previewPath = normalizeRequestSegments(
    typeof rawPath === "string" && rawPath.length <= 300 ? rawPath.split("/") : [],
  );
  if (previewPath === null) notFound();
  let artifact;
  try {
    const hostSite = await resolveHostSite(requestHost(await headers()));
    artifact = await loadPreviewArtifact(parsed, hostSite);
  } catch {
    notFound();
  }
  const resolved = resolveSitePath(artifact, previewPath);
  if (resolved.kind !== "page" && resolved.kind !== "entry") notFound();
  const entry = resolved.kind === "entry" ? resolved.entry : undefined;
  // #2829 W4/W5 — a draft's live grids show the brand's offerings as they are
  // now (the snapshot inside the preview artifact when Core is unreachable);
  // its forms are shown switched off (a preview never sends).
  const { live, forms } = await loadPageExtras({
    site: { site_id: artifact.site_id },
    artifact,
    page: resolved.page,
    entry,
    search: params,
    preview: true,
  });
  return (
    <div data-preview="1" data-artifact-digest={parsed.digest} data-page={resolved.page.key}>
      <p className="preview-banner" role="status">
        Private preview — not live. Publishing is always a separate confirmation.
      </p>
      <SitePageView artifact={artifact} page={resolved.page} previewKey={parsed.key} live={live} forms={forms} entry={entry} saveData={wantsLessData(await headers())} />
      {/* #2829 W9r — unsaved colours/shape/motion from the Business app's Website design. */}
      <PreviewTokenBridge localMode={previewLocalMode()} />
    </div>
  );
}
