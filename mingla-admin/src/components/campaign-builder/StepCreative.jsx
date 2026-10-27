/**
 * ISSUE-864 WP4 — Step: Creative (SPEC A4.c, blueprint §1.5). Upload ONE ad
 * creative, then run the #866 server-side BYTE-PROBE (admin-ad-creative-upload
 * action='validate') and render the per-channel validation panel.
 *
 * ISSUE-995 [Campaign Builder creative] Wave 3 of #977 adds:
 *   1. VIDEO — an image|video kind toggle. Operators choose an already-recorded
 *      canonical video from the Creative Library; Bunny ids, master URLs and
 *      poster URLs remain server-owned implementation details.
 *   2. PER-PLACEMENT report + local preview — "passes Feed 1:1, fails Reels
 *      9:16" made explicit, with the creative cropped to each placement so the
 *      operator can see + manually resize (placements.js). The platform-
 *      rendered preview API stays deferred (flags.API_AD_PREVIEWS_ENABLED).
 *   3. PROCEED-WITH-PASSING — a reject on one funded channel no longer blocks
 *      the whole build; the failing channels are named and excluded, the build
 *      proceeds on the passing ones (creativeGate.js, parent gate).
 *   4. VARIANT SLOTS — per-ratio pre-cropped uploads (4:5 / 1:1 / 9:16 /
 *      1.91:1) wired to the already-probed `variants` field, rescuing an
 *      off-ratio master without a re-upload.
 *   5. HUMANIZED rejects — the raw "550px < 600px floor / ratio 0.5046 …"
 *      strings become plain, actionable guidance; the raw is kept behind a
 *      "Technical details" toggle (creativeCopy.js — mirrors ISSUE-980).
 */

import { adsErrorWords } from "../../lib/systemPages";
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ShieldCheck,
  Image as ImageIcon,
  Film,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";
import { AlertCard } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input, Toggle } from "../ui/Input";
import { ImageUploader } from "../ui/ImageUploader";
import { useToast } from "../../context/ToastContext";
import { uploadAdImage } from "../../services/mediaUpload";
import {
  creativeUpload,
  getAdCreativeForReuse,
  listAdCreatives,
  listTikTokSparkPosts,
  parseEdgeError,
} from "../../services/adEngineService";
import { PLATFORM_LABELS } from "../../lib/adBuilder/channelPlan";
import {
  perPlacementReport,
  placementSummaryByPlatform,
} from "../../lib/adBuilder/placements";
import { humanizeCreativeCheck } from "../../lib/adBuilder/creativeCopy";
import { buildVideoSourcePayload } from "../../lib/adBuilder/preparationState";
import { CreativeDropZone } from "../ad-engine/CreativeDropZone";
import { VideoPickRow } from "../ad-engine/CreativeCard";
import { useAdminVideoUploads } from "../ad-engine/useAdminVideoUploads";
import {
  builderVideoRow,
  joinNames,
  platformName,
  refusalTitle,
  selectedVideoMisfitAlert,
} from "../ad-engine/creativeLibraryModel";
import { ADMIN_VIDEO_ACCEPT } from "../../services/adminVideoUpload";
import { resolveAdvertisablePage } from "../../services/adDestinationsService";
import {
  CREATIVE_STAGES,
  creativeFatigue,
  creativeRatios,
  MAX_CREATIVES_PER_STAGE,
  PAID_SOCIAL_PLATFORMS,
  validateStageCreativeSelection,
} from "../../lib/adBuilder/stageCreativeRules";

/** Ratio slots the backend accepts as pre-cropped variants (VARIANT_RATIOS). */
const VARIANT_RATIOS = ["4:5", "1:1", "9:16", "1.91:1"];
const EMPTY_STAGE_CREATIVE_IDS = Object.freeze({
  prospecting: [],
  retarget: [],
  abandoners: [],
});

const PLACEMENT_STATUS = {
  pass: { badge: "success", label: "Fits" },
  variant: { badge: "success", label: "Variant" },
  crop: { badge: "warning", label: "Needs crop" },
  small: { badge: "error", label: "Too small" },
};

const EXCLUSION_COPY = {
  needs_transcode: "the shape needs a crop or a variant we can't make here",
  blocked: "a hard rule blocks it",
  not_validated: "it hasn't been validated",
  video_not_creatable: "video ad creation isn't available yet",
};

/** ratioLabel "9:16" → CSS aspect-ratio "9 / 16" (accurate crop box). */
function aspectOf(ratioLabel) {
  return ratioLabel.replace(":", " / ");
}

/** variants state → the { ratio: { source_url, storage_path } } upload payload. */
function variantsPayload(variants) {
  const out = {};
  for (const [ratio, v] of Object.entries(variants ?? {})) {
    if (v && v.source_url)
      out[ratio] = {
        source_url: v.source_url,
        ...(v.storage_path ? { storage_path: v.storage_path } : {}),
      };
  }
  return out;
}

export function StepCreative({
  creative,
  onCreativeChange,
  channelRows,
  destination,
  fundedPlatforms = [],
  creativeExcluded = [],
  creativeBuildable = [],
  onChangePlatforms,
  audienceStages = {},
  onStageCreativeValidationChange,
}) {
  const { addToast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [variantBusy, setVariantBusy] = useState(null);
  const [validating, setValidating] = useState(false);
  const [recording, setRecording] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [expandedChecks, setExpandedChecks] = useState(() => new Set());
  const [videoLibrary, setVideoLibrary] = useState(null);
  const [videoLibraryError, setVideoLibraryError] = useState(null);
  const [selectingVideoId, setSelectingVideoId] = useState(null);
  const [videoRefusals, setVideoRefusals] = useState([]);
  const [announcement, setAnnouncement] = useState("");
  const [autoSelectId, setAutoSelectId] = useState(null);
  const [stageLibrary, setStageLibrary] = useState(null);
  const [stageBrandId, setStageBrandId] = useState(null);
  const [stageLibraryError, setStageLibraryError] = useState(null);
  const [sparkPosts, setSparkPosts] = useState(null);
  const [sparkPostsError, setSparkPostsError] = useState(null);
  const set = (patch) => onCreativeChange({ ...creative, ...patch });

  const isVideo = creative.kind === "video";
  const eligiblePlatforms = useMemo(
    () => channelRows.filter((r) => r.eligible).map((r) => r.platform),
    [channelRows],
  );
  // The report/preview cover the channels that will actually build (funded);
  // before budget or when empty, fall back to the eligible set.
  const reportPlatforms = useMemo(
    () => (fundedPlatforms.length > 0 ? fundedPlatforms : eligiblePlatforms),
    [eligiblePlatforms, fundedPlatforms],
  );
  const runsTikTok = reportPlatforms.includes("tiktok");
  const tiktokPlacement =
    creative.tiktokPlacement === "tiktok_pangle" ? "tiktok_pangle" : "tiktok";
  const usesTikTokSpark =
    runsTikTok && creative.tiktokCreativeSource === "spark";
  const sparkOnly =
    usesTikTokSpark &&
    reportPlatforms.every((platform) => platform === "tiktok");
  const selectedSparkPostIds = useMemo(
    () => creative.tiktokSparkPostIds ?? [],
    [creative.tiktokSparkPostIds],
  );
  const paidSocialPlatforms = useMemo(
    () =>
      reportPlatforms.filter((platform) =>
        PAID_SOCIAL_PLATFORMS.includes(platform),
      ),
    [reportPlatforms],
  );
  const libraryPaidSocialPlatforms = useMemo(
    () =>
      paidSocialPlatforms.filter(
        (platform) => !(platform === "tiktok" && usesTikTokSpark),
      ),
    [paidSocialPlatforms, usesTikTokSpark],
  );
  const stageCreativeIds =
    creative.stageCreativeIds ?? EMPTY_STAGE_CREATIVE_IDS;

  useEffect(() => {
    let active = true;
    if (libraryPaidSocialPlatforms.length === 0) {
      setStageLibrary([]);
      setStageBrandId(null);
      setStageLibraryError(null);
      return () => {
        active = false;
      };
    }
    setStageLibrary(null);
    setStageLibraryError(null);
    (async () => {
      try {
        const resolved = await resolveAdvertisablePage(destination);
        const brandId = resolved?.brand_id ?? null;
        if (!brandId) {
          throw new Error(
            "This destination has no authoritative brand assignment for its Creative Library.",
          );
        }
        const { data, error } = await listAdCreatives({
          status: "active",
          brand_id: brandId,
        });
        if (error) {
          const parsed = await parseEdgeError(error);
          throw new Error(
            parsed?.message ??
              "The brand Creative Library could not be loaded.",
          );
        }
        if (!active) return;
        setStageBrandId(brandId);
        setStageLibrary(data?.creatives ?? []);
      } catch (error) {
        if (!active) return;
        setStageBrandId(null);
        setStageLibrary([]);
        setStageLibraryError(
          adsErrorWords(error instanceof Error ? error.message : String(error)),
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [destination, libraryPaidSocialPlatforms]);

  useEffect(() => {
    let active = true;
    if (!usesTikTokSpark)
      return () => {
        active = false;
      };
    setSparkPosts(null);
    setSparkPostsError(null);
    listTikTokSparkPosts().then(async ({ data, error }) => {
      if (!active) return;
      if (error) {
        const parsed = await parseEdgeError(error);
        setSparkPosts([]);
        setSparkPostsError(
          adsErrorWords(parsed?.message, "The @usemingla TikTok posts could not be loaded."),
        );
        return;
      }
      setSparkPosts(data?.posts ?? []);
    });
    return () => {
      active = false;
    };
  }, [usesTikTokSpark]);

  useEffect(() => {
    const libraryResult =
      stageLibrary === null && libraryPaidSocialPlatforms.length > 0
        ? {
            ok: false,
            reason: "Loading the brand Creative Library.",
            stages: {},
          }
        : validateStageCreativeSelection({
            stageCreativeIds,
            rows: stageLibrary ?? [],
            enabledStages: audienceStages,
            platforms: libraryPaidSocialPlatforms,
            brandId: stageBrandId,
          });
    const sparkResult = !usesTikTokSpark
      ? { ok: true, reason: null, stages: {} }
      : sparkPosts === null
        ? { ok: false, reason: "Loading @usemingla TikTok posts.", stages: {} }
        : selectedSparkPostIds.length < 2 || selectedSparkPostIds.length > 4
          ? {
              ok: false,
              reason: "Choose 2–4 @usemingla posts for TikTok Spark Ads.",
              stages: {},
            }
          : { ok: true, reason: null, stages: {} };
    const result = libraryResult.ok ? sparkResult : libraryResult;
    onStageCreativeValidationChange?.(result);
  }, [
    audienceStages,
    onStageCreativeValidationChange,
    libraryPaidSocialPlatforms,
    selectedSparkPostIds,
    sparkPosts,
    stageBrandId,
    stageCreativeIds,
    stageLibrary,
    usesTikTokSpark,
  ]);

  const toggleSparkPost = (itemId) => {
    const next = selectedSparkPostIds.includes(itemId)
      ? selectedSparkPostIds.filter((id) => id !== itemId)
      : selectedSparkPostIds.length < 4
        ? [...selectedSparkPostIds, itemId]
        : selectedSparkPostIds;
    set({ tiktokSparkPostIds: next });
  };

  const toggleStageCreative = (stage, creativeId) => {
    const selected = stageCreativeIds[stage] ?? [];
    const next = selected.includes(creativeId)
      ? selected.filter((id) => id !== creativeId)
      : selected.length < MAX_CREATIVES_PER_STAGE
        ? [...selected, creativeId]
        : selected;
    set({
      stageCreativeIds: {
        ...stageCreativeIds,
        [stage]: next,
      },
    });
  };

  // #3697 — ready house videos plus this admin's in-flight uploads. A
  // permanently deleted creative never appears; archived ones stay out of new
  // selections.
  const [videoPending, setVideoPending] = useState([]);
  const loadVideoLibrary = useCallback(async () => {
    const { data, error } = await listAdCreatives({
      status: "active",
      kind: "video",
    });
    if (error) {
      const parsed = await parseEdgeError(error);
      setVideoLibraryError(
        adsErrorWords(parsed?.message, "The Creative Library could not be loaded."),
      );
      setVideoLibrary([]);
      return;
    }
    setVideoLibraryError(null);
    setVideoPending(data?.pending ?? []);
    setVideoLibrary(
      (data?.creatives ?? []).filter(
        (row) =>
          row.kind === "video" &&
          row.status === "active" &&
          row.house_reuse_allowed === true,
      ),
    );
  }, []);

  useEffect(() => {
    if (!isVideo || videoLibrary !== null) return;
    // Initial library read; state transitions live inside the async loader.
    void loadVideoLibrary();
  }, [isVideo, videoLibrary, loadVideoLibrary]);

  const uploads = useAdminVideoUploads({
    onFinished: ({ creativeId }) => {
      setAutoSelectId(creativeId ?? null);
      void loadVideoLibrary();
    },
  });

  const toggleExpanded = (key) =>
    setExpandedChecks((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const switchKind = (kind) => {
    if (kind === creative.kind) return;
    // Reset media-specific + validation state on a kind switch.
    onCreativeChange({
      ...creative,
      kind,
      file: null,
      localPreviewUrl: null,
      publicUrl: null,
      path: null,
      mp4MasterUrl: "",
      bunnyVideoId: "",
      posterUrl: null,
      posterPath: null,
      variants: {},
      validation: null,
      creativeRow: null,
      rightsConfirmed: false,
    });
    setServerError(null);
  };

  const handleFilePicked = async (file) => {
    setUploading(true);
    setServerError(null);
    try {
      const { publicUrl, path } = await uploadAdImage(file);
      set({
        file,
        localPreviewUrl: URL.createObjectURL(file),
        publicUrl,
        path,
        validation: null,
        creativeRow: null,
        rightsConfirmed: false,
        name: creative.name || file.name.replace(/\.[a-z]+$/i, ""),
      });
    } catch (err) {
      setServerError({ message: adsErrorWords(err?.message) });
      addToast({
        variant: "error",
        title: "Upload failed",
        description: adsErrorWords(err?.message),
      });
    }
    setUploading(false);
  };

  const selectLibraryVideo = async (creativeId) => {
    setSelectingVideoId(creativeId);
    setServerError(null);
    try {
      const { data, error } = await getAdCreativeForReuse(
        creativeId,
        reportPlatforms.length > 0 ? reportPlatforms : undefined,
      );
      if (error || !data?.creative) {
        const parsed = await parseEdgeError(error);
        throw new Error(
          parsed?.message ?? "The saved video could not be reused.",
        );
      }
      const row = data.creative;
      // #3697 — the per-channel report comes with the reuse answer, judged by
      // the server from the video's stored probe facts.
      const validated = { data: { validation: data.validation ?? null } };
      onCreativeChange({
        ...creative,
        kind: "video",
        file: null,
        localPreviewUrl: row.poster_url ?? null,
        publicUrl: null,
        path: row.storage_path ?? null,
        mp4MasterUrl: row.mp4_master_url ?? "",
        bunnyVideoId: row.bunny_video_id ?? "",
        posterUrl: row.poster_url ?? null,
        posterPath: null,
        variants: row.variants ?? {},
        validation: validated.data?.validation ?? null,
        creativeRow: row,
        aiGenerated: row.ai_generated === true,
        rightsConfirmed: false,
        name: row.name ?? "",
      });
    } catch (error) {
      setServerError({
        message: adsErrorWords(error instanceof Error ? error.message : String(error)),
      });
    } finally {
      setSelectingVideoId(null);
    }
  };

  const handleVariantPicked = async (ratio, file) => {
    if (!file) return;
    setVariantBusy(ratio);
    setServerError(null);
    try {
      const { publicUrl, path } = await uploadAdImage(file);
      set({
        variants: {
          ...(creative.variants ?? {}),
          [ratio]: { source_url: publicUrl, storage_path: path },
        },
        validation: null,
        creativeRow: null,
      });
    } catch (err) {
      addToast({
        variant: "error",
        title: `${ratio} variant upload failed`,
        description: adsErrorWords(err?.message),
      });
    }
    setVariantBusy(null);
  };

  const clearVariant = (ratio) => {
    const next = { ...(creative.variants ?? {}) };
    delete next[ratio];
    set({ variants: next, validation: null, creativeRow: null });
  };

  // The media is ready to send to the byte-probe.
  const mediaReady = isVideo
    ? Boolean(
        creative.mp4MasterUrl && creative.bunnyVideoId && creative.posterUrl,
      )
    : Boolean(creative.publicUrl);

  const buildPayload = () => {
    const variants = variantsPayload(creative.variants);
    const base = {
      kind: creative.kind,
      name: creative.name || "Campaign builder creative",
      platforms: eligiblePlatforms.length > 0 ? eligiblePlatforms : undefined,
      ai_generated: creative.aiGenerated,
      ...(Object.keys(variants).length > 0 ? { variants } : {}),
    };
    if (isVideo) {
      const videoSource = buildVideoSourcePayload({
        bunnyVideoId: creative.bunnyVideoId,
        mp4MasterUrl: creative.mp4MasterUrl,
        posterUrl: creative.posterUrl,
      });
      return {
        ...base,
        bunny_video_id: creative.bunnyVideoId,
        poster_url: creative.posterUrl,
        mp4_master_url: creative.mp4MasterUrl,
        source_url: videoSource.source_url,
      };
    }
    return {
      ...base,
      source_url: creative.publicUrl,
      storage_bucket: "meta-ad-creatives",
      storage_path: creative.path,
    };
  };

  const runValidate = async () => {
    if (!mediaReady) return;
    setValidating(true);
    setServerError(null);
    const { data, error } = isVideo
      ? await getAdCreativeForReuse(
          creative.creativeRow?.id,
          reportPlatforms.length > 0 ? reportPlatforms : undefined,
        )
      : await creativeUpload({ action: "validate", ...buildPayload() });
    if (error) {
      const parsed = await parseEdgeError(error);
      setServerError({
        code: parsed?.body?.error,
        message: String(
          parsed?.body?.message ??
            parsed?.body?.detail ??
            parsed?.message ??
            "Validation failed.",
        ),
      });
    } else {
      set({ validation: data?.validation ?? null });
      const channels = data?.validation?.channels ?? [];
      // ISSUE-995: a needs_transcode channel is NOT "ready" — resolveCreativeRef
      // blocks it at create, so it counts as a problem here too.
      const bad = channels.filter((c) => !c.ok || c.needsTranscode).length;
      addToast({
        variant: bad === 0 ? "success" : "warning",
        title:
          bad === 0
            ? `Ready on ${channels.length} of ${channels.length} channels.`
            : `${bad} channel${bad === 1 ? "" : "s"} with problems to fix.`,
      });
    }
    setValidating(false);
  };

  const recordCreative = async () => {
    if (!mediaReady) return;
    setRecording(true);
    setServerError(null);
    const { data, error } = await creativeUpload({
      action: "record",
      ...buildPayload(),
    });
    if (error) {
      const parsed = await parseEdgeError(error);
      setServerError({
        code: parsed?.body?.error,
        message: String(
          parsed?.body?.message ??
            parsed?.body?.detail ??
            parsed?.message ??
            "Recording failed.",
        ),
      });
    } else {
      set({
        creativeRow: data?.creative ?? null,
        validation: data?.validation ?? creative.validation,
      });
      addToast({
        variant: "success",
        title: "Creative recorded to the library.",
      });
    }
    setRecording(false);
  };

  // #3697 — inline upload: a new video that fits is selected and announced.
  useEffect(() => {
    if (!autoSelectId || !videoLibrary) return;
    const row = videoLibrary.find((item) => item.id === autoSelectId);
    if (!row) return;
    setAutoSelectId(null);
    if (builderVideoRow(row, reportPlatforms).selectable) {
      void selectLibraryVideo(row.id).then(() =>
        setAnnouncement("Video ready and selected."),
      );
    } else {
      setAnnouncement(
        "Video ready. It doesn't fit every platform in this campaign.",
      );
    }
    // selectLibraryVideo is recreated every render; this runs once per upload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSelectId, videoLibrary]);

  // #3697 — a platform change re-reads the chosen video's per-channel report.
  const platformKey = reportPlatforms.join(",");
  const selectedVideoId = isVideo ? (creative.creativeRow?.id ?? null) : null;
  useEffect(() => {
    if (!selectedVideoId) return undefined;
    let current = true;
    getAdCreativeForReuse(
      selectedVideoId,
      platformKey ? platformKey.split(",") : undefined,
    ).then(({ data, error }) => {
      if (!current) return;
      if (error || !data?.validation) {
        // The video can no longer be reused (archived or deleted elsewhere).
        onCreativeChange((existing) => ({ ...existing, validation: null }));
        return;
      }
      onCreativeChange((existing) =>
        existing.creativeRow?.id === selectedVideoId
          ? { ...existing, validation: data.validation }
          : existing,
      );
    });
    return () => {
      current = false;
    };
  }, [platformKey, selectedVideoId, onCreativeChange]);

  const selectedLibraryRow = isVideo
    ? ((videoLibrary ?? []).find(
        (row) => row.id === creative.creativeRow?.id,
      ) ?? null)
    : null;
  // The Builder is the one client place a misfit is blocked.
  const selectedMisfit = selectedLibraryRow
    ? selectedVideoMisfitAlert(selectedLibraryRow, reportPlatforms)
    : null;

  const channels = creative.validation?.channels ?? null;
  const probe = creative.validation?.probe ?? null;
  const variantRatios = Object.keys(variantsPayload(creative.variants));
  const placementReport = perPlacementReport({
    probe,
    platforms: reportPlatforms,
    variantRatios,
  });
  const placementByPlatform = placementSummaryByPlatform(placementReport);
  // The local preview source: the image itself, or the video's poster frame.
  const previewSrc = isVideo
    ? creative.posterUrl
    : (creative.localPreviewUrl ?? creative.publicUrl);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">What are people going to see?</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {sparkOnly
            ? "Choose existing @usemingla posts below. TikTok supplies the original video and caption."
            : "The server probes the actual bytes per channel — admin-supplied dimensions are never trusted. Fix rejects before a platform review cycle eats 24 hours."}
        </p>
      </div>

      {isVideo && !sparkOnly && (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-text-secondary)]">
          Running on
          {reportPlatforms.map((platform) => (
            <Badge key={platform}>{platformName(platform)}</Badge>
          ))}
          {onChangePlatforms && (
            <button
              type="button"
              onClick={onChangePlatforms}
              className="text-[13px] font-semibold text-[var(--color-brand-700)] hover:underline"
            >
              Change platforms
            </button>
          )}
        </div>
      )}

      {/* Provider-native copies are launch work, never creative-step work. */}
      {!sparkOnly && (
        <div
          className="inline-flex rounded-lg border border-[var(--gray-200)] p-0.5"
          role="tablist"
          aria-label="Creative type"
        >
          {[
            { kind: "image", label: "Image", icon: ImageIcon },
            { kind: "video", label: "Video", icon: Film },
          ].map(({ kind, label, icon }) => (
            <button
              key={kind}
              type="button"
              role="tab"
              aria-selected={creative.kind === kind}
              data-testid={`creative-kind-${kind}`}
              onClick={() => switchKind(kind)}
              className={[
                "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors",
                creative.kind === kind
                  ? "bg-[var(--color-brand-500)] text-white"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]",
              ].join(" ")}
            >
              {createElement(icon, {
                className: "w-4 h-4",
                "aria-hidden": true,
              })}
              {label}
            </button>
          ))}
        </div>
      )}

      {runsTikTok && (
        <div className="space-y-3">
          <fieldset className="space-y-2 rounded-xl border border-[var(--gray-200)] p-3">
            <legend className="px-1 text-sm font-semibold text-[var(--color-text-primary)]">
              TikTok creative source
            </legend>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Use the Creative Library, or boost 2–4 existing posts from the
              linked @usemingla account.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { value: "library", label: "Creative Library" },
                { value: "spark", label: "@usemingla posts (Spark)" },
              ].map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer gap-2 rounded-lg border border-[var(--gray-200)] p-3 text-sm"
                >
                  <input
                    type="radio"
                    name="tiktok-creative-source"
                    value={option.value}
                    checked={
                      (creative.tiktokCreativeSource ?? "library") ===
                      option.value
                    }
                    onChange={() =>
                      set({
                        tiktokCreativeSource: option.value,
                        ...(option.value === "spark"
                          ? { tiktokPlacement: "tiktok" }
                          : {}),
                      })
                    }
                  />
                  <span className="font-medium">{option.label}</span>
                </label>
              ))}
            </div>
            {usesTikTokSpark && (
              <div className="space-y-2 pt-2">
                {sparkPosts === null ? (
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    Loading @usemingla posts…
                  </p>
                ) : sparkPostsError ? (
                  <AlertCard variant="error" title="TikTok posts unavailable">
                    {sparkPostsError}
                  </AlertCard>
                ) : sparkPosts.length === 0 ? (
                  <AlertCard variant="warning" title="No eligible posts">
                    The linked @usemingla account returned no organic video
                    posts.
                  </AlertCard>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {sparkPosts.map((post) => {
                      const selected = selectedSparkPostIds.includes(
                        post.itemId,
                      );
                      return (
                        <label
                          key={post.itemId}
                          className="flex cursor-pointer gap-3 rounded-lg border border-[var(--gray-200)] p-2"
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={
                              !selected && selectedSparkPostIds.length >= 4
                            }
                            onChange={() => toggleSparkPost(post.itemId)}
                          />
                          {post.posterUrl && (
                            <img
                              src={post.posterUrl}
                              alt=""
                              className="h-14 w-10 rounded object-cover"
                            />
                          )}
                          <span className="min-w-0 text-xs text-[var(--color-text-secondary)]">
                            <span className="block truncate font-medium text-[var(--color-text-primary)]">
                              {post.text || "TikTok post"}
                            </span>
                            Post {post.itemId}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
                <p className="text-xs text-[var(--color-text-secondary)]">
                  {selectedSparkPostIds.length}/4 selected · the same reviewed
                  set rotates across each enabled stage.
                </p>
              </div>
            )}
          </fieldset>

          <fieldset className="space-y-2 rounded-xl border border-[var(--gray-200)] p-3">
            <legend className="px-1 text-sm font-semibold text-[var(--color-text-primary)]">
              TikTok placement
            </legend>
            <p className="text-xs text-[var(--color-text-secondary)]">
              {usesTikTokSpark
                ? "Spark Ads use the selected post's original video and stay on TikTok."
                : "TikTok-only ads require video. Choose TikTok + Pangle to use an image."}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                {
                  value: "tiktok",
                  label: "TikTok only",
                  detail: "Video only",
                },
                {
                  value: "tiktok_pangle",
                  label: "TikTok + Pangle",
                  detail: "Image or video",
                },
              ].map((option) => (
                <label
                  key={option.value}
                  className={[
                    "flex cursor-pointer items-start gap-2 rounded-lg border p-3",
                    tiktokPlacement === option.value
                      ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
                      : "border-[var(--gray-200)]",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    name="tiktok-placement"
                    value={option.value}
                    checked={tiktokPlacement === option.value}
                    disabled={usesTikTokSpark && option.value !== "tiktok"}
                    onChange={() => set({ tiktokPlacement: option.value })}
                  />
                  <span>
                    <span className="block text-sm font-semibold text-[var(--color-text-primary)]">
                      {option.label}
                    </span>
                    <span className="block text-xs text-[var(--color-text-secondary)]">
                      {option.detail}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {!usesTikTokSpark && !isVideo && tiktokPlacement === "tiktok" && (
              <AlertCard variant="error" title="TikTok-only needs a video">
                Pick a video, choose TikTok + Pangle, or remove TikTok from this
                campaign.
              </AlertCard>
            )}
          </fieldset>
        </div>
      )}

      {libraryPaidSocialPlatforms.length > 0 && (
        <section className="space-y-3 rounded-xl border border-[var(--gray-200)] p-3">
          <div>
            <h3 className="text-sm font-semibold">
              Creative rotation by stage
            </h3>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Choose 2–4 brand creatives for every enabled stage. Required sizes
              and audio are checked before Review.
            </p>
          </div>
          {stageLibrary === null ? (
            <p className="text-sm text-[var(--color-text-secondary)]">
              Loading brand creatives…
            </p>
          ) : stageLibraryError ? (
            <AlertCard
              variant="error"
              title="Brand Creative Library unavailable"
            >
              {stageLibraryError}
            </AlertCard>
          ) : stageLibrary.length === 0 ? (
            <AlertCard
              variant="warning"
              title="No active creatives for this brand"
            >
              Add and tag brand-owned media in the Creative Library before this
              campaign can continue.
            </AlertCard>
          ) : (
            CREATIVE_STAGES.filter(
              (stage) => audienceStages[stage] !== false,
            ).map((stage) => {
              const selected = stageCreativeIds[stage] ?? [];
              const validation = validateStageCreativeSelection({
                stageCreativeIds,
                rows: stageLibrary,
                enabledStages: audienceStages,
                platforms: paidSocialPlatforms,
                brandId: stageBrandId,
              }).stages[stage];
              return (
                <fieldset
                  key={stage}
                  className="space-y-2 rounded-lg border border-[var(--gray-200)] p-3"
                >
                  <legend className="px-1 text-sm font-semibold">
                    {stage[0].toUpperCase() + stage.slice(1)} ·{" "}
                    {selected.length}/4
                  </legend>
                  <div className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">
                    {stageLibrary.map((row) => {
                      const chosen = selected.includes(row.id);
                      const fatigue = creativeFatigue(row);
                      const ratios = creativeRatios(row);
                      return (
                        <button
                          key={row.id}
                          type="button"
                          aria-pressed={chosen}
                          disabled={
                            !chosen &&
                            selected.length >= MAX_CREATIVES_PER_STAGE
                          }
                          onClick={() => toggleStageCreative(stage, row.id)}
                          className={[
                            "flex min-w-0 gap-2 rounded-lg border p-2 text-left disabled:cursor-not-allowed disabled:opacity-50",
                            chosen
                              ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
                              : "border-[var(--gray-200)]",
                          ].join(" ")}
                        >
                          {row.preview_url ? (
                            <img
                              src={row.preview_url}
                              alt=""
                              className="h-14 w-12 shrink-0 rounded object-cover"
                            />
                          ) : (
                            <span className="grid h-14 w-12 shrink-0 place-items-center rounded bg-[var(--gray-100)]">
                              {row.kind === "video" ? (
                                <Film className="h-4 w-4" />
                              ) : (
                                <ImageIcon className="h-4 w-4" />
                              )}
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">
                              {row.name}
                            </span>
                            <span className="mt-1 flex flex-wrap gap-1">
                              {ratios.map((ratio) => (
                                <Badge key={ratio}>{ratio}</Badge>
                              ))}
                              <Badge
                                variant={
                                  row.has_audio === true ? "success" : "warning"
                                }
                              >
                                {row.has_audio === true ? "Audio" : "No audio"}
                              </Badge>
                              <Badge variant={fatigue.variant}>
                                {fatigue.label}
                              </Badge>
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {validation?.errors?.length > 0 && (
                    <ul className="space-y-1 text-xs text-[var(--color-error-700)]">
                      {validation.errors.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  )}
                </fieldset>
              );
            })
          )}
        </section>
      )}

      {!sparkOnly && !isVideo && (
        <ImageUploader
          file={creative.file}
          previewUrl={creative.localPreviewUrl ?? creative.publicUrl}
          uploading={uploading}
          onFilePicked={handleFilePicked}
          onClear={() =>
            set({
              file: null,
              localPreviewUrl: null,
              publicUrl: null,
              path: null,
              validation: null,
              creativeRow: null,
              rightsConfirmed: false,
            })
          }
        />
      )}

      {!sparkOnly && isVideo && (
        <div className="grid gap-2">
          <CreativeDropZone
            compact
            multiple={false}
            accept={ADMIN_VIDEO_ACCEPT}
            ariaLabel="Upload a new video. Drop it here or press Enter to browse."
            title="Upload a new video, or drop it here"
            sub="MP4, MOV, M4V or WebM · 5 seconds to 1 minute · Under 100 MB · Saved to the library too"
            onFiles={async (files) => {
              setVideoRefusals([]);
              const { refusals } = await uploads.addVideos(files.slice(0, 1));
              setVideoRefusals(refusals);
            }}
          />
          {videoRefusals.length > 0 && (
            <div role="alert">
              <AlertCard
                variant="error"
                title={refusalTitle(videoRefusals.length)}
              >
                <ul className="space-y-0.5">
                  {videoRefusals.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </AlertCard>
            </div>
          )}
          <p className="mt-2 text-xs font-semibold uppercase tracking-[.06em] text-[var(--color-text-tertiary-strong)]">
            From the library
          </p>
          {videoLibrary === null ? (
            <p className="text-sm text-[var(--color-text-secondary)]">
              Loading ready videos…
            </p>
          ) : (
            <div
              role="radiogroup"
              aria-label="Choose a video"
              className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr))]"
            >
              {uploads.entries.map((entry) => (
                <VideoPickRow
                  key={entry.localId}
                  upload={entry}
                  onCancelUpload={(item) => void uploads.cancel(item)}
                  onRetry={(item) => uploads.retry(item)}
                />
              ))}
              {videoPending
                .filter(
                  (item) =>
                    !uploads.entries.some(
                      (entry) => entry.record?.opId === item.clientOperationId,
                    ),
                )
                .map((item) => (
                  <VideoPickRow
                    key={item.jobId}
                    upload={{
                      localId: item.jobId,
                      name: item.fileName ?? "Video",
                      phase: "preparing",
                    }}
                  />
                ))}
              {videoLibrary.map((row) => {
                const state = builderVideoRow(row, reportPlatforms);
                const selected = creative.creativeRow?.id === row.id;
                return (
                  <VideoPickRow
                    key={row.id}
                    row={row}
                    selected={selected}
                    state={{
                      ...state,
                      fitsLine:
                        state.selectable && reportPlatforms.length > 0
                          ? `✓ Fits ${joinNames(reportPlatforms.map(platformName))}`
                          : null,
                    }}
                    onSelect={() => {
                      if (selectingVideoId === null)
                        void selectLibraryVideo(row.id);
                    }}
                    onChangePlatforms={onChangePlatforms}
                  />
                );
              })}
              {videoLibrary.length === 0 &&
                uploads.entries.length === 0 &&
                videoPending.length === 0 && (
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    No ready videos yet. Upload one above; it is saved to the
                    library too.
                  </p>
                )}
            </div>
          )}
          {selectedMisfit && (
            <AlertCard variant="error" title="Pick another video">
              {selectedMisfit}
            </AlertCard>
          )}
          <p className="sr-only" aria-live="polite">
            {announcement}
          </p>
          {videoLibraryError && (
            <AlertCard variant="error" title="Creative Library unavailable">
              {videoLibraryError}
            </AlertCard>
          )}
          <a
            href="#/ad-engine?tab=creative-library"
            className="inline-flex text-xs font-semibold text-[var(--color-brand-700)] hover:underline"
          >
            Open Creative Library
          </a>
        </div>
      )}

      {(usesTikTokSpark || mediaReady || creative.publicUrl || isVideo) && (
        <div className="space-y-3 rounded-xl border border-[var(--gray-200)] p-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
            <Input
              label="Creative name"
              value={creative.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="July London push — hero"
            />
            <div className="flex items-center gap-3">
              <Toggle
                label="AI-generated (discloses OPT_IN to Meta)"
                checked={creative.aiGenerated}
                onChange={(v) => set({ aiGenerated: v })}
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs font-medium">
              Rights basis
              <select
                value={creative.rightsBasis}
                onChange={(event) =>
                  set({
                    rightsBasis: event.target.value,
                    rightsConfirmed: false,
                  })
                }
                className="h-10 rounded-lg border border-[var(--gray-200)] bg-transparent px-3 text-sm"
              >
                <option value="owned">Owned by Mingla or the brand</option>
                <option value="licensed">Licensed for paid advertising</option>
                <option value="authorized_by_brand">
                  Authorized by the brand or creator
                </option>
              </select>
            </label>
            <label className="flex items-start gap-2 rounded-lg bg-[var(--gray-50)] p-3 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={creative.rightsConfirmed}
                onChange={(event) =>
                  set({ rightsConfirmed: event.target.checked })
                }
              />
              <span>
                I confirm this asset may be used in paid ads under the selected
                basis. This attestation does not authorize reuse in Mingla house
                campaigns.
              </span>
            </label>
          </div>
        </div>
      )}

      {/* ISSUE-995: per-ratio variant slots — rescue an off-ratio master. */}
      {(mediaReady || creative.publicUrl) && (
        <div className="border border-[var(--gray-200)] rounded-xl p-3">
          <p className="text-sm font-medium">
            Per-placement variants (optional)
          </p>
          <p className="text-xs text-[var(--color-text-secondary)] mb-2">
            If your creative is the wrong shape for a placement, upload a
            pre-cropped version here. The server checks each one's ratio — a
            matching variant lets that placement pass.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {VARIANT_RATIOS.map((ratio) => {
              const slot = creative.variants?.[ratio];
              return (
                <div
                  key={ratio}
                  className="border border-[var(--gray-200)] rounded-lg p-2 text-center"
                >
                  <p className="text-xs font-medium mb-1">{ratio}</p>
                  <div
                    className="mx-auto w-full max-w-[72px] rounded-md overflow-hidden border border-[var(--gray-100)] bg-[var(--gray-50)] flex items-center justify-center"
                    style={{ aspectRatio: aspectOf(ratio) }}
                  >
                    {slot?.source_url ? (
                      <img
                        src={slot.source_url}
                        alt={`${ratio} variant`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-[10px] text-[var(--color-text-tertiary)]">
                        —
                      </span>
                    )}
                  </div>
                  <div className="mt-1">
                    {slot?.source_url ? (
                      <button
                        type="button"
                        onClick={() => clearVariant(ratio)}
                        className="text-[10px] text-[var(--color-text-tertiary)] hover:text-[#ef4444] inline-flex items-center gap-0.5"
                      >
                        <X size={10} /> Remove
                      </button>
                    ) : (
                      <label className="text-[10px] text-[var(--color-brand-500)] cursor-pointer hover:underline">
                        {variantBusy === ratio ? "Uploading…" : "Add"}
                        <input
                          type="file"
                          accept="image/png,image/jpeg"
                          className="sr-only"
                          aria-label={`Upload ${ratio} variant`}
                          onChange={(e) =>
                            handleVariantPicked(ratio, e.target.files?.[0])
                          }
                        />
                      </label>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {mediaReady && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={ShieldCheck}
            loading={validating}
            onClick={runValidate}
          >
            Validate per channel
          </Button>
          {!isVideo && (
            <Button
              size="sm"
              loading={recording}
              disabled={!creative.validation || Boolean(creative.creativeRow)}
              onClick={recordCreative}
            >
              {creative.creativeRow ? "Recorded ✓" : "Use this creative"}
            </Button>
          )}
        </div>
      )}

      {serverError && (
        <AlertCard
          variant="error"
          title={`Creative check failed${serverError.code ? ` — ${serverError.code}` : ""}`}
        >
          {serverError.message}
        </AlertCard>
      )}

      {/* ISSUE-995 PROCEED-WITH-PASSING: name the excluded channels; the build
          proceeds on the passing ones. */}
      {/* #3697: a video never proceeds without a platform — the Builder blocks it. */}
      {channels &&
        !isVideo &&
        creativeExcluded.length > 0 &&
        creativeBuildable.length > 0 && (
          <AlertCard
            variant="warning"
            title="Some channels will be left out of this build"
          >
            Building{" "}
            <span className="font-medium">
              {creativeBuildable.map((p) => PLATFORM_LABELS[p] ?? p).join(", ")}
            </span>
            . Leaving out{" "}
            {creativeExcluded.map((e, i) => (
              <span key={e.platform}>
                {i > 0 ? ", " : ""}
                <span className="font-medium">
                  {PLATFORM_LABELS[e.platform] ?? e.platform}
                </span>{" "}
                ({EXCLUSION_COPY[e.reason] ?? "a creative problem"})
              </span>
            ))}
            . Fix the problems below or add a variant to include them.
          </AlertCard>
        )}
      {channels &&
        fundedPlatforms.length > 0 &&
        creativeBuildable.length === 0 && (
          <AlertCard
            variant="error"
            title="No funded channel can run this creative yet"
          >
            {isVideo
              ? "The recorded video does not fit any funded channel. Fix the media or add a matching variant to continue."
              : "Every funded channel has a problem below. Fix at least one — or add a pre-cropped variant — to build."}
          </AlertCard>
        )}

      {/* ISSUE-995: per-PLACEMENT report + local cropped preview. */}
      {probe && placementReport.length > 0 && (
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">
              How it fits each placement
            </h3>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Your creative is {probe.width}×{probe.height}. Each frame shows it
              cropped to that placement — a warning means you should resize or
              add a variant. (Platform-rendered previews arrive with the preview
              endpoint.)
            </p>
          </div>
          {placementByPlatform.map((group) => (
            <div
              key={group.platform}
              className="border border-[var(--gray-200)] rounded-xl p-3"
            >
              <div className="flex items-center gap-2 mb-2">
                <Badge
                  variant={group.failing.length === 0 ? "success" : "warning"}
                  dot
                >
                  {group.platformName}
                </Badge>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {group.passing.length} of{" "}
                  {group.passing.length + group.failing.length} placements fit
                </span>
              </div>
              <div className="flex flex-wrap gap-3">
                {[...group.passing, ...group.failing].map((v) => {
                  const meta =
                    PLACEMENT_STATUS[v.status] ?? PLACEMENT_STATUS.crop;
                  return (
                    <div
                      key={v.id}
                      className="w-24"
                      data-testid={`placement-${v.id}`}
                    >
                      <div
                        className="w-full rounded-md overflow-hidden border border-[var(--gray-200)] bg-[var(--gray-50)] flex items-center justify-center"
                        style={{
                          aspectRatio: aspectOf(v.ratioLabel),
                          maxHeight: "150px",
                        }}
                      >
                        {previewSrc ? (
                          <img
                            src={previewSrc}
                            alt={`${v.name} preview`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-[10px] text-[var(--color-text-tertiary)]">
                            preview
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] font-medium leading-tight">
                        {v.name}
                      </p>
                      <p className="text-[10px] text-[var(--color-text-tertiary)]">
                        {v.ratioLabel}
                      </p>
                      <Badge variant={meta.badge} className="mt-0.5">
                        {meta.label}
                      </Badge>
                      {!v.ok && (
                        <p className="mt-0.5 text-[10px] text-[var(--color-text-secondary)] leading-tight">
                          {v.reason}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Per-channel validation panel — HUMANIZED (raw behind a toggle). */}
      {channels && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Per-channel checks</h3>
          {channels.map((channel) => {
            // ISSUE-995: needs_transcode is NOT "ready" (resolveCreativeRef
            // blocks it at create) — surface it as its own state, not green.
            const state = channel.needsTranscode
              ? { badge: "warning", label: "needs a crop or variant" }
              : channel.ok
                ? { badge: "success", label: "ready" }
                : { badge: "error", label: "blocked" };
            return (
              <div
                key={channel.platform}
                className="border border-[var(--gray-200)] rounded-xl p-3"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant={state.badge} dot>
                    {PLATFORM_LABELS[channel.platform] ?? channel.platform}
                  </Badge>
                  <span className="text-xs text-[var(--color-text-secondary)]">
                    {state.label}
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {(channel.checks ?? []).map((check, i) => {
                    const { friendly, action, technical, badge, statusLabel } =
                      humanizeCreativeCheck(check);
                    const key = `${channel.platform}:${check.rule}:${i}`;
                    const isOpen = expandedChecks.has(key);
                    return (
                      <li key={key} className="text-xs">
                        <div className="flex items-start gap-2">
                          <Badge variant={badge}>{statusLabel}</Badge>
                          <span>
                            {friendly}
                            {action && (
                              <span className="text-[var(--color-text-secondary)]">
                                {" "}
                                {action}
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="pl-[8px] mt-0.5">
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            onClick={() => toggleExpanded(key)}
                            className="inline-flex items-center gap-0.5 text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                          >
                            {isOpen ? (
                              <ChevronDown size={10} />
                            ) : (
                              <ChevronRight size={10} />
                            )}
                            Technical details
                          </button>
                          {isOpen && (
                            <p className="mt-1 text-[10px] font-mono text-[var(--color-text-tertiary)] break-words">
                              {technical}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                  {(channel.checks ?? []).length === 0 && (
                    <li className="text-xs text-[var(--color-text-secondary)]">
                      No findings — clean.
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {destination && !mediaReady && !isVideo && (
        <p className="text-xs text-[var(--color-text-tertiary)]">
          Tip: the event's cover works as a starting point, but ads with a
          dedicated 4:5 or 1:1 crop outperform reused covers.
        </p>
      )}
    </div>
  );
}
