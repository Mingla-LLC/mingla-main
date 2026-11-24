import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { SitePageView } from "../../components/SitePageView";
import { wantsLessData } from "../../lib/siteVideo";
import { ariDraftPreviewPage, resolveSitePath } from "../../lib/pageRouting";
import { normalizeRequestSegments } from "../../contracts/generated/routes.ts";
import {
  loadPreviewArtifact,
  parsePreviewArtifactKey,
} from "../../lib/previewArtifact";
import { requestHost, resolveHostSite } from "../../lib/publication";
import { loadPageExtras } from "../../lib/pageExtras";
import { PreviewBridge } from "../../components/PreviewBridge";
import { loadPreviewSectionIds } from "../../lib/previewSections";
import { runtimeConfig } from "../../lib/config";
import { PreviewLinkScope, type PreviewScope } from "../../components/PreviewLinks";
import { withPreviewDetailKey, withPreviewMediaKey, withPreviewOfferingKey } from "../../lib/previewMedia";
import { resolveOfferingDetail } from "../../lib/offeringDetail";
import { isV2Artifact } from "../../lib/siteArtifact";
import { businessPreviewFrameAncestor } from "../../lib/origins";
import { PREVIEW_BANNER_STYLE, PREVIEW_BANNER_TEXT, PREVIEW_STRIP_CSS } from "../../lib/sharedBanner";

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
  referrer: "no-referrer",
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
  // #2830 — this page's pictures and videos come through the key, not the publication.
  artifact = withPreviewMediaKey(artifact, parsed.key);
  // #4453 m11 rework (spec v2.1 §3.3) — the owner's private preview also opens a Draft page from Ari
  // (disabled, never in a publish, share link or sitemap), so the editor can show it before it goes live.
  const ariDraft = ariDraftPreviewPage(artifact, previewPath);
  const resolved = ariDraft ? { kind: "page" as const, page: ariDraft } : resolveSitePath(artifact, previewPath);
  // #4453 milestone 9 — an offering detail page previews like the live site
  // (step 3b: the same flag and the same live data, for this artifact's site).
  const detailed = resolved.kind === "not_found" && isV2Artifact(artifact)
    ? await resolveOfferingDetail({ site: { site_id: artifact.site_id }, artifact, path: previewPath, search: params })
    : null;
  if (detailed?.kind === "detail") {
    const incomingDetail = await headers();
    return (
      <div data-preview="1" data-artifact-digest={parsed.digest} data-page={detailed.page.key}>
        <style nonce={incomingDetail.get("x-nonce") ?? undefined}>{PREVIEW_STRIP_CSS}</style>
        <p className="preview-banner" role="status" style={PREVIEW_BANNER_STYLE} title="Private preview — not live. Publishing is always a separate confirmation.">
          {PREVIEW_BANNER_TEXT}
        </p>
        <PreviewLinkScope scope={{
          target: { key: parsed.key, frameAncestor: businessPreviewFrameAncestor(Array.isArray(params.fa) ? params.fa[0] : params.fa) },
          path: previewPath,
          assetKey: parsed.key,
        }}>
          <SitePageView artifact={artifact} page={detailed.page} previewKey={parsed.key} live={withPreviewOfferingKey(detailed.live, parsed.key)} detail={withPreviewDetailKey(detailed.detail, parsed.key)} saveData={wantsLessData(incomingDetail)} nonce={incomingDetail.get("x-nonce") ?? undefined} />
        </PreviewLinkScope>
        {/* #4453 website workspace — an offering page has no sections to pick, but it still answers the workspace (ready, scroll, colours). */}
        <PreviewBridge localMode={previewLocalMode()} pagePath={previewPath} sections={[]} />
      </div>
    );
  }
  if (resolved.kind !== "page" && resolved.kind !== "entry") notFound();
  const entry = resolved.kind === "entry" ? resolved.entry : undefined;
  // #2829 W4/W5 — a draft's live grids show the brand's offerings as they are
  // now (the snapshot inside the preview artifact when Core is unreachable);
  // its forms are shown switched off (a preview never sends).
  /*
   * #4453 website workspace (build contract D) — which Studio section drew
   * each block of this page, from the list Studio stores beside the preview
   * artifact. Only a page of sections has one (a destination or story page
   * does not). Null (an older Studio, a failed read) means no section marks:
   * the page is drawn exactly as before.
   */
  const [{ live, forms }, sectionIds] = await Promise.all([
    loadPageExtras({
      site: { site_id: artifact.site_id },
      artifact,
      page: resolved.page,
      entry,
      search: params,
      preview: true,
    }),
    resolved.kind === "page" ? loadPreviewSectionIds(parsed, resolved.page) : Promise.resolve(null),
  ]);
  const page = sectionIds ? { ...resolved.page, previewSectionIds: sectionIds } : resolved.page;
  const sections = sectionIds ? resolved.page.blocks.map((block, index) => ({ id: sectionIds[index] ?? "", type: String(block.type) })) : [];
  const incoming = await headers();
  const scope: PreviewScope = {
    target: {
      key: parsed.key,
      // A frame on a Business preview deployment must survive the next page too.
      frameAncestor: businessPreviewFrameAncestor(Array.isArray(params.fa) ? params.fa[0] : params.fa),
    },
    path: previewPath,
    assetKey: parsed.key,
  };
  return (
    <div data-preview="1" data-artifact-digest={parsed.digest} data-page={resolved.page.key}>
      <style nonce={incoming.get("x-nonce") ?? undefined}>{PREVIEW_STRIP_CSS}</style>
      <p className="preview-banner" role="status" style={PREVIEW_BANNER_STYLE} title="Private preview — not live. Publishing is always a separate confirmation.">
        {PREVIEW_BANNER_TEXT}
      </p>
      <PreviewLinkScope scope={scope}>
        <SitePageView artifact={artifact} page={page} previewKey={parsed.key} live={withPreviewOfferingKey(live, parsed.key)} forms={forms} entry={entry} saveData={wantsLessData(incoming)} nonce={incoming.get("x-nonce") ?? undefined} />
      </PreviewLinkScope>
      {/* #4453 website workspace — the workspace's bridge (it also applies #2829 W9r's unsaved colours, shape and motion). */}
      <PreviewBridge localMode={previewLocalMode()} pagePath={previewPath} sections={sections} />
    </div>
  );
}
