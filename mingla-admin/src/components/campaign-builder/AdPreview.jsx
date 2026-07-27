/**
 * ISSUE-1184: source-aware preview rail. Meta is a trusted provider iframe;
 * TikTok is a fresh provider link; Snap/Google are named approximations.
 */

import { useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { PUBLIC_WEB_ORIGIN } from "../../services/adDestinationsService";
import { requestVideoPreview } from "../../services/adEngineService";
import { PLATFORM_LABELS } from "../../lib/adBuilder/channelPlan";
import { VIDEO_API_AD_PREVIEWS_ENABLED } from "../../lib/adBuilder/flags";
import { previewRequestFingerprint } from "../../lib/adBuilder/preparationState";
import { Button } from "../ui/Button";

const PLACEMENTS = {
  meta: ["meta_feed_1x1", "meta_feed_4x5", "meta_reels_9x16", "meta_right_191x1"],
  tiktok: ["tiktok_infeed_9x16", "tiktok_1x1", "tiktok_16x9"],
  snapchat: ["snap_story_9x16"],
  google: ["google_display_1x1"],
};

function previewRequest({
  creativeId,
  platform,
  placement,
  destination,
  primary,
  headline,
  description,
  cta,
}) {
  if (!creativeId || !destination) return null;
  return {
    creative_library_id: creativeId,
    platform,
    lane: "consumer",
    placement_id: placement,
    destination: {
      page_type: destination.page_type,
      brand_slug: destination.brand_slug,
      ...(destination.page_type === "event" ? { entity_slug: destination.slug } : {}),
    },
    preview_input: {
      primary_text: primary || "Discover this Mingla experience",
      headline: headline || "Book on Mingla",
      description: description || "Public destination preview",
      call_to_action_type: cta || "LEARN_MORE",
    },
  };
}

function Approximation({ brandName, primary, headline, cta, imageUrl, destUrl }) {
  const fallbackHost = new URL(PUBLIC_WEB_ORIGIN).hostname.toUpperCase();
  let host = fallbackHost;
  try {
    if (destUrl) host = new URL(destUrl).hostname.toUpperCase();
  } catch {
    host = fallbackHost;
  }
  const muted = "text-[var(--color-text-tertiary)] italic";
  return (
    <div className="bg-[var(--color-background-primary)] border border-[var(--gray-200)] rounded-xl overflow-hidden shadow-[var(--shadow-sm)]">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-[var(--gray-100)]">
        <div aria-hidden="true" className="w-8 h-8 rounded-full bg-[var(--color-brand-100)]" />
        <div>
          <p className="text-xs font-semibold">{brandName || <span className={muted}>Brand name</span>}</p>
          <p className="text-[10px] text-[var(--color-text-tertiary)]">Sponsored</p>
        </div>
      </div>
      <div className="px-3 py-2 text-xs whitespace-pre-wrap break-words min-h-8">
        {primary || <span className={muted}>Primary text appears here…</span>}
      </div>
      {imageUrl
        ? <img src={imageUrl} alt="Ad creative" className="w-full aspect-square object-cover" />
        : <div className="w-full aspect-square bg-[var(--gray-100)] grid place-items-center text-xs text-[var(--color-text-tertiary)]">Creative preview</div>}
      <div className="px-3 py-2 flex items-center justify-between gap-2 bg-[var(--gray-50)]">
        <div className="min-w-0">
          <p className="text-[10px] text-[var(--color-text-tertiary)] truncate">{host}</p>
          <p className="text-xs font-semibold truncate">{headline || <span className={muted}>Headline</span>}</p>
        </div>
        <span className="shrink-0 text-[10px] font-semibold px-2.5 py-1.5 rounded-md bg-[var(--gray-200)]">
          {(cta || "LEARN_MORE").replaceAll("_", " ")}
        </span>
      </div>
    </div>
  );
}

export function AdPreview({
  brandName,
  primary,
  headline,
  description = "",
  cta,
  imageUrl,
  destUrl,
  creative = null,
  destination = null,
  fundedPlatforms = [],
  preparationRows = {},
}) {
  const platforms = fundedPlatforms.filter((p) => ["meta", "snapchat", "tiktok", "google"].includes(p));
  const [platform, setPlatform] = useState(platforms[0] ?? "meta");
  const activePlatform = platforms.includes(platform) ? platform : (platforms[0] ?? "meta");
  const [placement, setPlacement] = useState(PLACEMENTS[activePlatform]?.[0] ?? "");
  const [metaPreview, setMetaPreview] = useState({
    status: "idle",
    url: null,
    fingerprint: "",
  });
  const [metaPreviewNonce, setMetaPreviewNonce] = useState(0);
  const [tiktokPreview, setTiktokPreview] = useState({
    status: "idle",
    url: null,
    fingerprint: "",
  });
  const metaPreviewGeneration = useRef(0);
  const currentMetaFingerprint = useRef("");
  const currentTikTokFingerprint = useRef("");
  const isVideo = creative?.kind === "video";
  const metaRequestBody = previewRequest({
    creativeId: creative?.creativeRow?.id,
    platform: "meta",
    placement,
    destination,
    primary,
    headline,
    description,
    cta,
  });
  const metaRequestFingerprint = previewRequestFingerprint(metaRequestBody);
  const metaPreviewFingerprint = [
    activePlatform,
    preparationRows.meta?.state ?? "not_started",
    metaRequestFingerprint,
  ].join("::");
  const visibleMetaPreview = metaPreview.fingerprint === metaPreviewFingerprint
    ? metaPreview
    : { status: "idle", url: null };
  const tiktokPreviewFingerprint = [
    activePlatform,
    preparationRows.tiktok?.state ?? "not_started",
    metaRequestFingerprint,
  ].join("::");
  const visibleTikTokPreview =
    tiktokPreview.fingerprint === tiktokPreviewFingerprint
      ? tiktokPreview
      : { status: "idle", url: null };

  useEffect(() => {
    currentTikTokFingerprint.current = tiktokPreviewFingerprint;
  }, [tiktokPreviewFingerprint]);

  // Every identity/copy change invalidates the previous request immediately.
  // A slow provider response may update state only while its generation and
  // exact request fingerprint are still current.
  useEffect(() => {
    const generation = metaPreviewGeneration.current + 1;
    metaPreviewGeneration.current = generation;
    currentMetaFingerprint.current = metaPreviewFingerprint;
    if (
      !isVideo || activePlatform !== "meta" || !metaRequestFingerprint ||
      preparationRows.meta?.state !== "ready" || !VIDEO_API_AD_PREVIEWS_ENABLED.meta
    ) return undefined;
    const requestBody = JSON.parse(metaRequestFingerprint);
    const timer = window.setTimeout(async () => {
      if (metaPreviewGeneration.current !== generation) return;
      setMetaPreview({
        status: "loading",
        url: null,
        fingerprint: metaPreviewFingerprint,
      });
      const { data, error } = await requestVideoPreview(requestBody);
      if (
        metaPreviewGeneration.current !== generation ||
        currentMetaFingerprint.current !== metaPreviewFingerprint
      ) return;
      setMetaPreview(error
        ? {
          status: "failed",
          url: null,
          fingerprint: metaPreviewFingerprint,
        }
        : {
          status: "ready",
          url: data?.url ?? null,
          fingerprint: metaPreviewFingerprint,
        });
    }, 750);
    return () => {
      window.clearTimeout(timer);
      if (metaPreviewGeneration.current === generation) {
        metaPreviewGeneration.current += 1;
      }
    };
  }, [
    isVideo,
    activePlatform,
    metaRequestFingerprint,
    metaPreviewFingerprint,
    preparationRows.meta?.state,
    metaPreviewNonce,
  ]);

  const openTikTok = async () => {
    const requestFingerprint = tiktokPreviewFingerprint;
    const requestBody = previewRequest({
      creativeId: creative?.creativeRow?.id,
      platform: "tiktok",
      placement,
      destination,
      primary,
      headline,
      description,
      cta,
    });
    if (!requestBody || !VIDEO_API_AD_PREVIEWS_ENABLED.tiktok) return;
    setTiktokPreview({
      status: "loading",
      url: null,
      fingerprint: requestFingerprint,
    });
    const { data, error } = await requestVideoPreview(requestBody);
    if (currentTikTokFingerprint.current !== requestFingerprint) return;
    if (error || !data?.url) {
      setTiktokPreview({
        status: "failed",
        url: null,
        fingerprint: requestFingerprint,
      });
      return;
    }
    setTiktokPreview({
      status: "ready",
      url: data.url,
      fingerprint: requestFingerprint,
    });
    window.open(data.url, "_blank", "noopener,noreferrer");
  };

  const approximation = (
    <Approximation
      brandName={brandName}
      primary={primary}
      headline={headline}
      cta={cta}
      imageUrl={imageUrl}
      destUrl={destUrl}
    />
  );

  if (!isVideo) {
    return <div aria-label="Ad preview (Facebook mobile feed approximation)">{approximation}</div>;
  }

  const source = activePlatform === "meta"
    ? "Platform-rendered preview"
    : activePlatform === "tiktok"
    ? "Platform-rendered preview · opens on TikTok"
    : "Mingla approximation";

  return (
    <section className="space-y-2" aria-label="Ad preview">
      <h3 className="text-sm font-semibold">Ad preview</h3>
      <div role="tablist" aria-label="Preview platform" className="phase-a-preview-tabs">
        {platforms.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={activePlatform === item}
            onClick={() => {
              setPlatform(item);
              setPlacement(PLACEMENTS[item]?.[0] ?? "");
            }}
            className="phase-a-preview-tab"
          >
            {PLATFORM_LABELS[item] ?? item}
          </button>
        ))}
      </div>
      <select
        aria-label="Preview placement"
        className="w-full h-11 px-2 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] text-xs"
        value={placement}
        onChange={(event) => setPlacement(event.target.value)}
      >
        {(PLACEMENTS[activePlatform] ?? []).map((item) => <option key={item}>{item}</option>)}
      </select>
      <p className="text-xs font-semibold">{source}</p>

      {activePlatform === "meta" ? (
        preparationRows.meta?.state !== "ready" ? (
          <div className="aspect-[9/16] rounded-xl bg-[var(--gray-100)] grid place-items-center text-xs px-4 text-center">
            Prepare Meta to request its real preview.
          </div>
        ) : visibleMetaPreview.status === "ready" && visibleMetaPreview.url ? (
          <>
            <iframe
              src={visibleMetaPreview.url}
              title={`Meta ${placement} platform-rendered preview`}
              sandbox="allow-scripts allow-same-origin allow-presentation"
              referrerPolicy="no-referrer"
              allow="autoplay; fullscreen"
              className="w-full aspect-[9/16] rounded-xl border border-[var(--gray-200)]"
            />
            <a href={visibleMetaPreview.url} target="_blank" rel="noopener noreferrer" className="text-xs underline">
              Open preview in new tab <ExternalLink size={11} className="inline" />
            </a>
          </>
        ) : visibleMetaPreview.status === "failed" ? (
          <div className="space-y-2">
            {approximation}
            <p className="text-xs">Meta couldn’t render this preview. Your prepared video is still safe.</p>
            <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => setMetaPreviewNonce((value) => value + 1)}>
              Retry preview
            </Button>
          </div>
        ) : (
          <div className="aspect-[9/16] rounded-xl bg-[var(--gray-100)] grid place-items-center text-xs">
            Asking Meta to render this placement…
          </div>
        )
      ) : activePlatform === "tiktok" ? (
        <div className="space-y-2">
          {approximation}
          <Button
            className="w-full min-h-11"
            icon={visibleTikTokPreview.status === "failed" ? RefreshCw : ExternalLink}
            loading={visibleTikTokPreview.status === "loading"}
            disabled={
              preparationRows.tiktok?.state !== "ready" ||
              !VIDEO_API_AD_PREVIEWS_ENABLED.tiktok
            }
            onClick={openTikTok}
          >
            {visibleTikTokPreview.status === "failed" ? "Refresh TikTok preview" : "Open TikTok preview"}
          </Button>
          <p className="text-xs">This opens the preview returned by TikTok in a new tab. It does not create an ad.</p>
        </div>
      ) : (
        <div>
          {approximation}
          <p className="text-xs mt-1">
            {activePlatform === "snapchat"
              ? "Layout guide only. Snapchat does not provide a matching pre-create render here."
              : "Layout guide only. Google video creation is not in Phase A."}
          </p>
        </div>
      )}
    </section>
  );
}
