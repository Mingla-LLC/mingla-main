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

import { createElement, useEffect, useState } from "react";
import { ShieldCheck, Image as ImageIcon, Film, ChevronDown, ChevronRight, X } from "lucide-react";
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
  parseEdgeError,
} from "../../services/adEngineService";
import { PLATFORM_LABELS } from "../../lib/adBuilder/channelPlan";
import { perPlacementReport, placementSummaryByPlatform } from "../../lib/adBuilder/placements";
import { humanizeCreativeCheck } from "../../lib/adBuilder/creativeCopy";
import {
  buildVideoSourcePayload,
} from "../../lib/adBuilder/preparationState";

/** Ratio slots the backend accepts as pre-cropped variants (VARIANT_RATIOS). */
const VARIANT_RATIOS = ["4:5", "1:1", "9:16", "1.91:1"];

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
    if (v && v.source_url) out[ratio] = { source_url: v.source_url, ...(v.storage_path ? { storage_path: v.storage_path } : {}) };
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
  const set = (patch) => onCreativeChange({ ...creative, ...patch });

  const isVideo = creative.kind === "video";
  const eligiblePlatforms = channelRows.filter((r) => r.eligible).map((r) => r.platform);
  // The report/preview cover the channels that will actually build (funded);
  // before budget or when empty, fall back to the eligible set.
  const reportPlatforms = fundedPlatforms.length > 0 ? fundedPlatforms : eligiblePlatforms;

  useEffect(() => {
    if (!isVideo || videoLibrary !== null) return undefined;
    let mounted = true;
    listAdCreatives().then(async ({ data, error }) => {
      if (!mounted) return;
      if (error) {
        const parsed = await parseEdgeError(error);
        setVideoLibraryError(
          parsed?.message ?? "The Creative Library could not be loaded.",
        );
        setVideoLibrary([]);
        return;
      }
      setVideoLibrary(
        (data?.creatives ?? []).filter(
          (row) =>
            row.kind === "video" &&
            row.status === "active" &&
            row.house_reuse_allowed === true,
        ),
      );
    });
    return () => {
      mounted = false;
    };
  }, [isVideo, videoLibrary]);

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
      setServerError({ message: err.message });
      addToast({ variant: "error", title: "Upload failed", description: err.message });
    }
    setUploading(false);
  };

  const selectLibraryVideo = async (creativeId) => {
    setSelectingVideoId(creativeId);
    setServerError(null);
    try {
      const { data, error } = await getAdCreativeForReuse(creativeId);
      if (error || !data?.creative) {
        const parsed = await parseEdgeError(error);
        throw new Error(
          parsed?.message ?? "The saved video could not be reused.",
        );
      }
      const row = data.creative;
      const validated = await creativeUpload({
        action: "validate",
        kind: "video",
        name: row.name,
        source_url: row.source_url,
        bunny_video_id: row.bunny_video_id,
        poster_url: row.poster_url,
        mp4_master_url: row.mp4_master_url,
        variants: row.variants ?? {},
        ai_generated: row.ai_generated === true,
        platforms: eligiblePlatforms.length > 0 ? eligiblePlatforms : undefined,
      });
      if (validated.error) {
        const parsed = await parseEdgeError(validated.error);
        throw new Error(
          parsed?.message ?? "The saved video no longer passes validation.",
        );
      }
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
        message: error instanceof Error ? error.message : String(error),
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
        variants: { ...(creative.variants ?? {}), [ratio]: { source_url: publicUrl, storage_path: path } },
        validation: null,
        creativeRow: null,
      });
    } catch (err) {
      addToast({ variant: "error", title: `${ratio} variant upload failed`, description: err.message });
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
    ? Boolean(creative.mp4MasterUrl && creative.bunnyVideoId && creative.posterUrl)
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
    const { data, error } = await creativeUpload({ action: "validate", ...buildPayload() });
    if (error) {
      const parsed = await parseEdgeError(error);
      setServerError({
        code: parsed?.body?.error,
        message: String(parsed?.body?.message ?? parsed?.body?.detail ?? parsed?.message ?? "Validation failed."),
      });
    } else {
      set({ validation: data?.validation ?? null });
      const channels = data?.validation?.channels ?? [];
      // ISSUE-995: a needs_transcode channel is NOT "ready" — resolveCreativeRef
      // blocks it at create, so it counts as a problem here too.
      const bad = channels.filter((c) => !c.ok || c.needsTranscode).length;
      addToast({
        variant: bad === 0 ? "success" : "warning",
        title: bad === 0
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
    const { data, error } = await creativeUpload({ action: "record", ...buildPayload() });
    if (error) {
      const parsed = await parseEdgeError(error);
      setServerError({
        code: parsed?.body?.error,
        message: String(parsed?.body?.message ?? parsed?.body?.detail ?? parsed?.message ?? "Recording failed."),
      });
    } else {
      set({ creativeRow: data?.creative ?? null, validation: data?.validation ?? creative.validation });
      addToast({ variant: "success", title: "Creative recorded to the library." });
    }
    setRecording(false);
  };

  const channels = creative.validation?.channels ?? null;
  const probe = creative.validation?.probe ?? null;
  const variantRatios = Object.keys(variantsPayload(creative.variants));
  const placementReport = perPlacementReport({ probe, platforms: reportPlatforms, variantRatios });
  const placementByPlatform = placementSummaryByPlatform(placementReport);
  // The local preview source: the image itself, or the video's poster frame.
  const previewSrc = isVideo ? creative.posterUrl : (creative.localPreviewUrl ?? creative.publicUrl);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">What are people going to see?</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          The server probes the actual bytes per channel — admin-supplied dimensions are never
          trusted. Fix rejects before a platform review cycle eats 24 hours.
        </p>
      </div>

      {/* Provider-native copies are launch work, never creative-step work. */}
      <div className="inline-flex rounded-lg border border-[var(--gray-200)] p-0.5" role="tablist" aria-label="Creative type">
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
            {createElement(icon, { className: "w-4 h-4", "aria-hidden": true })}
            {label}
          </button>
        ))}
      </div>

      {isVideo && (
        <AlertCard variant="info" title="One canonical video, safely reused">
          Mingla validates the canonical video and its placement fit here. Provider-native copies
          are created only after the exact plan is funded, reviewed and launch-confirmed; nothing
          is uploaded to an ad platform during this step.
        </AlertCard>
      )}

      {!isVideo && (
        <ImageUploader
          file={creative.file}
          previewUrl={creative.localPreviewUrl ?? creative.publicUrl}
          uploading={uploading}
          onFilePicked={handleFilePicked}
          onClear={() => set({ file: null, localPreviewUrl: null, publicUrl: null, path: null, validation: null, creativeRow: null, rightsConfirmed: false })}
        />
      )}

      {isVideo && (
        <div className="space-y-3 border border-[var(--gray-200)] rounded-xl p-3">
          <p className="text-xs text-[var(--color-text-secondary)]">
            Choose a ready video from Mingla&apos;s Creative Library. Storage IDs, master URLs and
            poster URLs stay server-owned and are never entered by an operator.
          </p>
          {videoLibrary === null ? (
            <p className="text-sm text-[var(--color-text-secondary)]">
              Loading ready videos…
            </p>
          ) : videoLibrary.length === 0 ? (
            <AlertCard variant="warning" title="No ready video in the library">
              Upload through Mingla&apos;s shared resumable media flow, then return here and choose
              the recorded video. Only Mingla-owned media is eligible for a house campaign;
              Host-owned media remains blocked pending Terms approval. The Ads builder does not
              create a parallel uploader.
            </AlertCard>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {videoLibrary.map((row) => {
                const selected = creative.creativeRow?.id === row.id;
                return (
                  <button
                    key={row.id}
                    type="button"
                    aria-pressed={selected}
                    disabled={selectingVideoId !== null}
                    onClick={() => selectLibraryVideo(row.id)}
                    className={[
                      "flex items-center gap-3 rounded-xl border p-2 text-left transition-colors",
                      selected
                        ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
                        : "border-[var(--gray-200)] hover:bg-[var(--gray-50)]",
                    ].join(" ")}
                  >
                    {row.preview_url ? (
                      <img
                        src={row.preview_url}
                        alt=""
                        className="h-16 w-12 rounded-lg object-cover"
                      />
                    ) : (
                      <span className="flex h-16 w-12 items-center justify-center rounded-lg bg-[var(--gray-100)]">
                        <Film className="h-5 w-5" aria-hidden="true" />
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        {row.name || "Untitled video"}
                      </span>
                      <span className="block text-xs text-[var(--color-text-secondary)]">
                        {row.duration_seconds ? `${row.duration_seconds}s · ` : ""}
                        {selected
                          ? "Selected"
                          : selectingVideoId === row.id
                            ? "Checking…"
                            : "Choose video"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {videoLibraryError && (
            <AlertCard variant="error" title="Creative Library unavailable">
              {videoLibraryError}
            </AlertCard>
          )}
          <a
            href="#/ad-engine?tab=creative-library"
            className="inline-flex text-xs font-medium text-[var(--color-brand-600)] hover:underline"
          >
            Open Creative Library
          </a>
        </div>
      )}

      {(mediaReady || creative.publicUrl || isVideo) && (
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
          <p className="text-sm font-medium">Per-placement variants (optional)</p>
          <p className="text-xs text-[var(--color-text-secondary)] mb-2">
            If your creative is the wrong shape for a placement, upload a pre-cropped version here.
            The server checks each one's ratio — a matching variant lets that placement pass.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {VARIANT_RATIOS.map((ratio) => {
              const slot = creative.variants?.[ratio];
              return (
                <div key={ratio} className="border border-[var(--gray-200)] rounded-lg p-2 text-center">
                  <p className="text-xs font-medium mb-1">{ratio}</p>
                  <div
                    className="mx-auto w-full max-w-[72px] rounded-md overflow-hidden border border-[var(--gray-100)] bg-[var(--gray-50)] flex items-center justify-center"
                    style={{ aspectRatio: aspectOf(ratio) }}
                  >
                    {slot?.source_url
                      ? <img src={slot.source_url} alt={`${ratio} variant`} className="w-full h-full object-cover" />
                      : <span className="text-[10px] text-[var(--color-text-tertiary)]">—</span>}
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
                          onChange={(e) => handleVariantPicked(ratio, e.target.files?.[0])}
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
          <Button variant="secondary" size="sm" icon={ShieldCheck} loading={validating} onClick={runValidate}>
            Validate per channel
          </Button>
          <Button
            size="sm"
            loading={recording}
            disabled={!creative.validation || Boolean(creative.creativeRow)}
            onClick={recordCreative}
          >
            {creative.creativeRow ? "Recorded ✓" : "Use this creative"}
          </Button>
        </div>
      )}

      {serverError && (
        <AlertCard variant="error" title={`Creative check failed${serverError.code ? ` — ${serverError.code}` : ""}`}>
          {serverError.message}
        </AlertCard>
      )}

      {/* ISSUE-995 PROCEED-WITH-PASSING: name the excluded channels; the build
          proceeds on the passing ones. */}
      {channels && creativeExcluded.length > 0 && creativeBuildable.length > 0 && (
        <AlertCard variant="warning" title="Some channels will be left out of this build">
          Building{" "}
          <span className="font-medium">
            {creativeBuildable.map((p) => PLATFORM_LABELS[p] ?? p).join(", ")}
          </span>
          . Leaving out{" "}
          {creativeExcluded.map((e, i) => (
            <span key={e.platform}>
              {i > 0 ? ", " : ""}
              <span className="font-medium">{PLATFORM_LABELS[e.platform] ?? e.platform}</span>
              {" "}({EXCLUSION_COPY[e.reason] ?? "a creative problem"})
            </span>
          ))}
          . Fix the problems below or add a variant to include them.
        </AlertCard>
      )}
      {channels && fundedPlatforms.length > 0 && creativeBuildable.length === 0 && (
        <AlertCard variant="error" title="No funded channel can run this creative yet">
          {isVideo
            ? "The recorded video does not fit any funded channel. Fix the media or add a matching variant to continue."
            : "Every funded channel has a problem below. Fix at least one — or add a pre-cropped variant — to build."}
        </AlertCard>
      )}

      {/* ISSUE-995: per-PLACEMENT report + local cropped preview. */}
      {probe && placementReport.length > 0 && (
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">How it fits each placement</h3>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Your creative is {probe.width}×{probe.height}. Each frame shows it cropped to that
              placement — a warning means you should resize or add a variant. (Platform-rendered
              previews arrive with the preview endpoint.)
            </p>
          </div>
          {placementByPlatform.map((group) => (
            <div key={group.platform} className="border border-[var(--gray-200)] rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant={group.failing.length === 0 ? "success" : "warning"} dot>
                  {group.platformName}
                </Badge>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {group.passing.length} of {group.passing.length + group.failing.length} placements fit
                </span>
              </div>
              <div className="flex flex-wrap gap-3">
                {[...group.passing, ...group.failing].map((v) => {
                  const meta = PLACEMENT_STATUS[v.status] ?? PLACEMENT_STATUS.crop;
                  return (
                    <div key={v.id} className="w-24" data-testid={`placement-${v.id}`}>
                      <div
                        className="w-full rounded-md overflow-hidden border border-[var(--gray-200)] bg-[var(--gray-50)] flex items-center justify-center"
                        style={{ aspectRatio: aspectOf(v.ratioLabel), maxHeight: "150px" }}
                      >
                        {previewSrc
                          ? <img src={previewSrc} alt={`${v.name} preview`} className="w-full h-full object-cover" />
                          : <span className="text-[10px] text-[var(--color-text-tertiary)]">preview</span>}
                      </div>
                      <p className="mt-1 text-[11px] font-medium leading-tight">{v.name}</p>
                      <p className="text-[10px] text-[var(--color-text-tertiary)]">{v.ratioLabel}</p>
                      <Badge variant={meta.badge} className="mt-0.5">{meta.label}</Badge>
                      {!v.ok && (
                        <p className="mt-0.5 text-[10px] text-[var(--color-text-secondary)] leading-tight">{v.reason}</p>
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
              <div key={channel.platform} className="border border-[var(--gray-200)] rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant={state.badge} dot>
                    {PLATFORM_LABELS[channel.platform] ?? channel.platform}
                  </Badge>
                  <span className="text-xs text-[var(--color-text-secondary)]">{state.label}</span>
                </div>
                <ul className="space-y-1.5">
                  {(channel.checks ?? []).map((check, i) => {
                    const { friendly, action, technical, badge, statusLabel } = humanizeCreativeCheck(check);
                    const key = `${channel.platform}:${check.rule}:${i}`;
                    const isOpen = expandedChecks.has(key);
                    return (
                      <li key={key} className="text-xs">
                        <div className="flex items-start gap-2">
                          <Badge variant={badge}>{statusLabel}</Badge>
                          <span>
                            {friendly}
                            {action && (
                              <span className="text-[var(--color-text-secondary)]"> {action}</span>
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
                            {isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
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
                    <li className="text-xs text-[var(--color-text-secondary)]">No findings — clean.</li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {destination && !mediaReady && !isVideo && (
        <p className="text-xs text-[var(--color-text-tertiary)]">
          Tip: the event's cover works as a starting point, but ads with a dedicated 4:5 or
          1:1 crop outperform reused covers.
        </p>
      )}
    </div>
  );
}
