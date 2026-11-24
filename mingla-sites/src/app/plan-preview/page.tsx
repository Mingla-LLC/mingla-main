import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { SitePageView } from "../../components/SitePageView";
import { PreviewLinkScope, type PreviewScope } from "../../components/PreviewLinks";
import { normalizeRequestSegments } from "../../contracts/generated/routes.ts";
import { SAMPLE_STRIP } from "../../contracts/generated/planPreview.ts";
import { resolveSitePath } from "../../lib/pageRouting";
import { requestHost } from "../../lib/publication";
import { businessPreviewFrameAncestor } from "../../lib/origins";
import { PREVIEW_BANNER_STYLE, PREVIEW_STRIP_CSS } from "../../lib/sharedBanner";
import { loadPlanPreviewArtifact, sampleOfferings } from "../../lib/planPreviewArtifact";
import { offeringCard, offeringFilters, type LiveOfferings, type OfferingCard } from "../../lib/offeringCards";
import type { SiteOffering } from "../../contracts/generated/offerings.ts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Style preview — nothing built yet",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * #4453 milestone 10 (spec v2.1 §2.2 step 4) — the pre-build plan preview:
 * the brand's own name, plan and live Mingla listings drawn in one style,
 * through the SAME resolver and renderers as a published site, from an
 * ephemeral `plan-previews/` artifact. Reserved host only, noindex,
 * no-referrer, 24 h. No Core read happens here: the cards come from the feed
 * Studio froze into the artifact (real rows) plus, for a kind the brand has
 * none of, labelled sample listings. Forms are shown switched off.
 */
export default async function PlanPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawKey = Array.isArray(params.k) ? params.k[0] : params.k;
  const rawPath = Array.isArray(params.path) ? params.path[0] : params.path;
  const path = normalizeRequestSegments(typeof rawPath === "string" && rawPath.length <= 300 ? rawPath.split("/") : []);
  if (path === null) notFound();
  const incoming = await headers();
  let preview;
  try {
    preview = await loadPlanPreviewArtifact(rawKey, requestHost(incoming));
  } catch {
    notFound();
  }
  const { artifact, samples, key } = preview;
  const resolved = resolveSitePath(artifact, path);
  if (resolved.kind !== "page" && resolved.kind !== "entry") notFound();
  const now = new Date();
  // Real rows (covers are not re-encoded for a plan preview) and labelled samples.
  const real: SiteOffering[] = artifact.offerings_snapshot.map((row) => ({ ...row, cover: null }));
  const sampled = sampleOfferings(samples, now);
  const cards = new Map<string, OfferingCard>();
  for (const offering of real) cards.set(offering.id, await offeringCard(artifact.site_id, offering, now, artifact.language));
  for (const offering of sampled) {
    const card = await offeringCard(artifact.site_id, offering, now, artifact.language);
    // Every design shows the badge: "Sample". No date, no price, no Mingla link, not bookable.
    cards.set(offering.id, {
      ...card,
      dates: "",
      price: null,
      // No link at all (tester P3-4): the grid draws a sample's CTA as plain text.
      href: "",
      cta: "Sample listing",
      detailHref: null,
      sample: true,
      state: { ...card.state, bookable: false, badge: "Sample" as never },
    });
  }
  const live: LiveOfferings = {
    source: "snapshot",
    offerings: [...real, ...sampled],
    cards,
    now,
    filters: offeringFilters(params),
    detailPages: false,
  };
  const scope: PreviewScope = {
    target: { key: key.key, plan: true, frameAncestor: businessPreviewFrameAncestor(Array.isArray(params.fa) ? params.fa[0] : params.fa) },
    path,
    assetKey: key.key,
  };
  const forms = { renderedAt: now.getTime(), signature: "plan-preview", enquiries: "unknown" as const, notice: null, preview: true };
  return (
    <div data-preview="plan" data-page={resolved.page.key} data-design={artifact.design.key}>
      <style nonce={incoming.get("x-nonce") ?? undefined}>{PREVIEW_STRIP_CSS}</style>
      <p className="preview-banner" role="status" style={PREVIEW_BANNER_STYLE}>Preview · nothing built yet</p>
      {samples ? <p className="preview-banner preview-sample-strip" role="note" data-sample-strip="1">{SAMPLE_STRIP}</p> : null}
      <PreviewLinkScope scope={scope}>
        <SitePageView artifact={artifact} page={resolved.page} previewKey={key.key} live={live} forms={forms} entry={resolved.kind === "entry" ? resolved.entry : undefined} nonce={incoming.get("x-nonce") ?? undefined} />
      </PreviewLinkScope>
    </div>
  );
}
