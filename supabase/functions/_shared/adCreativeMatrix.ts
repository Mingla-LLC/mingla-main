/**
 * adCreativeMatrix.ts — the ISSUE-866 per-channel creative validation matrix.
 *
 * CONSTANTS SOURCE (Amendment A1-6b — BINDING): PIPELINE_BLUEPRINT §2 (§2.1–
 * §2.5) VERBATIM. This module ENCODES those rows; it does NOT re-derive
 * numbers. The tier posture is structural:
 *
 *   HARD-REJECT only on rows tagged [SPEC]/[OFFICIAL]. [CONSENSUS]/[3P]/
 *   [UNVERIFIED]/[SECONDARY]/[HOUSE] rows are WARN-only — "validating on a
 *   wrong constant is worse than not validating" (blueprint §0 rule 3; all of
 *   Reddit's pixel/byte numbers are [3P] ⇒ WARN). The downgrade is applied
 *   CENTRALLY in emit() so no individual row can bypass it.
 *
 * Three tiers (§1.5, including its exact operator messages):
 *   AUTO-FIX      — deterministic transforms (resize, re-encode, crop-to-ratio
 *                   from the master, per-ratio variant derivation). The Deno
 *                   edge runtime CANNOT transcode (no ffmpeg/ImageMagick/
 *                   canvas), so the auto-fix tier surfaces here as the TYPED
 *                   `needs_transcode` outcome instead of a half-transcoder
 *                   (dispatch rule; A1-3 stop-and-amend posture — flagged in
 *                   the WP3 report).
 *   HARD-REJECT   — the platform enforces it and no byte transform fixes it
 *                   without changing the creative's meaning: missing audio,
 *                   over-duration, over-cap bytes after re-encode, banned mime.
 *   WARN          — safe zones, [3P]/[UNVERIFIED] numbers, anything we cannot
 *                   reliably detect.
 *   NOT-EVALUABLE — rows the byte-probe cannot judge in this runtime (black-
 *                   bar edge-row luma, watermark detection, −16 LUFS loudness,
 *                   fps). Surfaced explicitly — never silently skipped, never
 *                   guessed.
 *
 * DO-NOT-BUILD rows honored (A1-7): NO Meta 20%-text-density check, NO Meta
 * video-bitrate constant (folklore — TikTok's ≥516 kbps IS official and IS
 * encoded), NO 60/90-second Reels caps, NO Google ±1% aspect tolerance.
 */

import type { Platform } from "./adChannel.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CheckLevel = "pass" | "warn" | "reject" | "needs_transcode" | "not_evaluable";

export type Confidence = "SPEC" | "OFFICIAL" | "LIVE" | "CONSENSUS" | "3P" | "UNVERIFIED" | "SECONDARY" | "HOUSE";

/** Confidences allowed to hard-reject (A1-6b). Everything else warns. */
const HARD_REJECT_CONFIDENCES: readonly Confidence[] = ["SPEC", "OFFICIAL"];

export interface CreativeCheck {
  platform: Platform;
  rule: string;
  level: CheckLevel;
  confidence: Confidence;
  message: string;
}

/** The probe-derived facts the matrix judges (never admin-supplied — A1-6a). */
export interface CreativeMediaFacts {
  kind: "image" | "video";
  mimeType: string | null;
  container: string | null;
  width: number | null;
  height: number | null;
  aspectRatio: number | null;
  durationSeconds: number | null;
  hasAudio: boolean | null;
  byteSize: number | null;
  overallBitrateKbps: number | null;
  /** poster_url present on the creative row (video thumbnail). */
  posterPresent: boolean;
  /** Ratio labels for which a pre-cropped variant slot exists (A1-6c). */
  variantRatios: readonly string[];
}

export interface ChannelValidationResult {
  platform: Platform;
  /** true ⇔ no reject-level check fired. */
  ok: boolean;
  /** true ⇔ at least one needs_transcode outcome (deterministic fix exists, runtime can't apply it). */
  needsTranscode: boolean;
  checks: CreativeCheck[];
}

// ── Ratio machinery ───────────────────────────────────────────────────────────

export const RATIO_SLOTS: Record<string, number> = {
  "9:16": 9 / 16,
  "1:1": 1,
  "4:5": 4 / 5,
  "16:9": 16 / 9,
  "1.91:1": 1.91,
};

/**
 * Classifies a probed ratio against a set of allowed slot labels within a
 * relative tolerance. Returns the matched label or null. The tolerance is a
 * MATCHING device, not a policy constant — Google publishes NO tolerance
 * (blueprint §2.4: "do not encode a constant against a source that doesn't
 * exist"), so Google classification uses the same neutral epsilon.
 */
export function classifyRatio(
  ratio: number | null,
  allowed: readonly string[],
  tolerance = 0.03,
): string | null {
  if (ratio === null || ratio <= 0) return null;
  let best: string | null = null;
  let bestDelta = Infinity;
  for (const label of allowed) {
    const target = RATIO_SLOTS[label];
    if (!target) continue;
    const delta = Math.abs(ratio - target) / target;
    if (delta <= tolerance && delta < bestDelta) {
      best = label;
      bestDelta = delta;
    }
  }
  return best;
}

const MB = 1024 * 1024;
const KB = 1024;

// ── Emit helper — the A1-6b tier downgrade is applied HERE, centrally ─────────

function emit(
  checks: CreativeCheck[],
  platform: Platform,
  rule: string,
  level: CheckLevel,
  confidence: Confidence,
  message: string,
): void {
  let effective = level;
  if (level === "reject" && !HARD_REJECT_CONFIDENCES.includes(confidence)) {
    // Blueprint §0 rule 3 / A1-6b: a non-[SPEC]/[OFFICIAL] number NEVER blocks.
    effective = "warn";
  }
  checks.push({ platform, rule, level: effective, confidence, message });
}

function fmtMb(bytes: number): string {
  return (bytes / MB).toFixed(1);
}

// ── §2.1 Meta ─────────────────────────────────────────────────────────────────

function validateMeta(f: CreativeMediaFacts): CreativeCheck[] {
  const checks: CreativeCheck[] = [];
  const p: Platform = "meta";

  if (f.kind === "image") {
    // mime — jpeg|png ("recommend JPG or PNG"); static GIF "treat as unsupported" → REJECT.
    if (f.mimeType !== "image/jpeg" && f.mimeType !== "image/png") {
      emit(checks, p, "image.mime", "reject", "OFFICIAL",
        `Meta ad images must be JPG or PNG — got ${f.mimeType ?? "unknown"}. ` +
          (f.mimeType === "image/gif" ? "Static GIF is not in Meta's supported list — treat as unsupported." : ""));
    }
    // max bytes 30 MB — all placements [OFFICIAL].
    if (f.byteSize !== null && f.byteSize > 30 * MB) {
      emit(checks, p, "image.max_bytes", "reject", "OFFICIAL",
        `This image is ${fmtMb(f.byteSize)} MB — Meta's limit is 30 MB on all placements.`);
    }
    // min width 600 px — the API floor ("we require ≥600px width"; use 600, not the 500 UI figure).
    if (f.width !== null && f.width < 600) {
      emit(checks, p, "image.min_width", "reject", "OFFICIAL",
        `This image is ${f.width}px wide — Meta's API floor is 600px width.`);
    }
    // ratio ∈ {4:5, 1:1, 1.91:1, 9:16}; ±3% Feed/Search/In-Stream, ±1% IG.
    const metaRatios = ["4:5", "1:1", "1.91:1", "9:16"] as const;
    const within1 = classifyRatio(f.aspectRatio, metaRatios, 0.01);
    const within3 = classifyRatio(f.aspectRatio, metaRatios, 0.03);
    if (within3 === null) {
      // Off-list. The §1.5 auto-fix is "crop from master" — the edge runtime
      // cannot crop, so this is the TYPED needs_transcode outcome unless a
      // pre-cropped variant slot exists.
      const hasVariant = metaRatios.some((r) => f.variantRatios.includes(r));
      if (hasVariant) {
        emit(checks, p, "image.ratio", "warn", "OFFICIAL",
          `Master ratio ${f.aspectRatio ?? "unknown"} is off Meta's list (4:5, 1:1, 1.91:1, 9:16) — a pre-cropped variant slot will be used instead.`);
      } else {
        emit(checks, p, "image.ratio", "needs_transcode", "OFFICIAL",
          `Ratio ${f.aspectRatio ?? "unknown"} is not one of Meta's 4:5 / 1:1 / 1.91:1 / 9:16. ` +
            "A centre crop from the master fixes this deterministically, but the edge runtime cannot transcode — supply a pre-cropped variant slot.");
      }
    } else if (within1 === null) {
      emit(checks, p, "image.ratio_tolerance", "warn", "OFFICIAL",
        `Ratio ${f.aspectRatio} is within Meta's ±3% Feed tolerance of ${within3} but outside the ±1% IG Feed/Stories/Reels tolerance — IG placements may crop or reject it.`);
    }
    // recommended 1440×1800 (4:5) · 1440×2560 (9:16) — WARN below (not the blog 1080 figures).
    if (f.width !== null && f.width < 1440) {
      emit(checks, p, "image.recommended_res", "warn", "OFFICIAL",
        `Meta recommends 1440×1800 (4:5 feed) / 1440×2560 (9:16 vertical); this is ${f.width}×${f.height}. It will run, softer.`);
    }
  } else {
    // container MP4|MOV — REJECT.
    if (f.mimeType !== "video/mp4" && f.mimeType !== "video/quicktime") {
      emit(checks, p, "video.container", "reject", "OFFICIAL",
        `Meta video must be MP4 or MOV — got ${f.mimeType ?? "unknown"}.`);
    }
    // max bytes 4 GB (Ads Guide). The IG 2.3 GB figure is flagged/unreconciled → WARN band.
    if (f.byteSize !== null && f.byteSize > 4 * 1024 * MB) {
      emit(checks, p, "video.max_bytes", "reject", "OFFICIAL",
        `This video is ${fmtMb(f.byteSize)} MB — Meta's limit is 4 GB.`);
    } else if (f.byteSize !== null && f.byteSize > 2.3 * 1024 * MB) {
      emit(checks, p, "video.ig_ingestion_bytes", "warn", "OFFICIAL",
        "Over 2.3 GB: an IG ads-api doc gives a 2.3 GB cap on a distinct ingestion path (flagged, unreconciled with the 4 GB Ads Guide figure).");
    }
    // duration — Advantage+ placement intersection: min 5 s (FB In-Stream floor), max 180 s (FB Stories ceiling).
    // NO 60/90-second Reels caps (A1-7 #3: IG Reels = 15 min; FB Reels = no maximum).
    if (f.durationSeconds !== null && (f.durationSeconds < 5 || f.durationSeconds > 180)) {
      emit(checks, p, "video.duration", "reject", "OFFICIAL",
        `This video is ${Math.round(f.durationSeconds)}s. Under Advantage+ placements Meta enforces the intersection: minimum 5s (FB In-Stream floor), maximum 180s (FB Stories 3-minute ceiling).`);
    }
    // thumbnail — poster_url required (#866 OD-4 DB CHECK); no fixed official resolution exists.
    if (!f.posterPresent) {
      emit(checks, p, "video.thumbnail", "reject", "OFFICIAL",
        "A poster/thumbnail is required for video creatives (Meta video_data image_hash; match the video's ratio — no fixed official resolution exists).");
    }
    // codec — H.264/stereo AAC ≥128 kbps verbatim, but "WARN (can't always probe)".
    if (f.container !== null) {
      emit(checks, p, "video.codec", "warn", "OFFICIAL",
        "Meta wants H.264, square pixels, fixed frame rate, progressive scan, stereo AAC ≥128 kbps — codec details cannot be fully probed in the edge runtime; verify the export settings.");
    }
    // bitrate — NO RULE, DO NOT BUILD (A1-7 #2). Deliberately absent.
    // 9:16 safe zone — WARN (cannot detect text position).
    const ratio916 = classifyRatio(f.aspectRatio, ["9:16"], 0.03);
    if (ratio916 !== null) {
      emit(checks, p, "video.safe_zone_9_16", "warn", "OFFICIAL",
        "On Stories and Reels, the top 14% and bottom 35% of the frame sit under Instagram's own buttons. Your text looks close to that. Check the Story preview before you launch.");
    }
  }
  return checks;
}

// ── §2.2 TikTok ───────────────────────────────────────────────────────────────

function validateTiktok(f: CreativeMediaFacts): CreativeCheck[] {
  const checks: CreativeCheck[] = [];
  const p: Platform = "tiktok";
  const tiktokRatios = ["9:16", "1:1", "16:9"] as const;

  if (f.kind === "video") {
    // AUDIO REQUIRED — HARD-REJECT [OFFICIAL] ("The ad must contain audio…").
    // FAILS-ON-REVERT ANCHOR (WP3 regression contract): deleting this block
    // makes the audio-required tests fail. Silent video is also auto-rejected
    // by Snapchat as "Low-Quality Creative" — the §1.5 message covers both.
    if (f.hasAudio === false) {
      emit(checks, p, "video.audio_required", "reject", "OFFICIAL",
        "This video has no sound. Snapchat auto-rejects silent video as low-quality, and TikTok requires audio. " +
          "Add a soundtrack or a voiceover — a trending sound beats stock music on both.");
    } else if (f.hasAudio === null) {
      emit(checks, p, "video.audio_required", "not_evaluable", "OFFICIAL",
        "Audio-track presence could not be derived from the container — TikTok requires audio; verify manually.");
    }
    // duration — POLICY 5–60 s (NOT the 10-minute technical limit — THE TRAP).
    if (f.durationSeconds !== null && (f.durationSeconds < 5 || f.durationSeconds > 60)) {
      emit(checks, p, "video.duration_policy", "reject", "OFFICIAL",
        `This video is ${Math.round(f.durationSeconds)} seconds. TikTok's technical limit is 10 minutes but its advertising policy is 5–60 seconds — ` +
          "it'll upload fine, create fine, and then get rejected in review. Trim it to 60 seconds or under. (Sweet spot: 9–15 seconds.)");
    }
    // ratio ∈ {9:16, 1:1, 16:9} — nothing else. REJECT · AUTO crop → needs_transcode.
    const matched = classifyRatio(f.aspectRatio, tiktokRatios, 0.03);
    if (matched === null) {
      const hasVariant = tiktokRatios.some((r) => f.variantRatios.includes(r));
      emit(checks, p, "video.ratio", hasVariant ? "warn" : "needs_transcode", "OFFICIAL",
        `Ratio ${f.aspectRatio ?? "unknown"} is not one of TikTok's 9:16 / 1:1 / 16:9.` +
          (hasVariant
            ? " A pre-cropped variant slot will be used instead."
            : " A crop from the master fixes this deterministically, but the edge runtime cannot transcode — supply a pre-cropped variant slot."));
    } else {
      // min res per orientation — REJECT below floor; WARN below 720p recommended.
      const floors: Record<string, [number, number]> = {
        "9:16": [540, 960],
        "16:9": [960, 540],
        "1:1": [640, 640],
      };
      const recommended: Record<string, [number, number]> = {
        "9:16": [720, 1280],
        "16:9": [1280, 720],
        "1:1": [640, 640],
      };
      const floor = floors[matched];
      const rec = recommended[matched];
      if (f.width !== null && f.height !== null && floor) {
        if (f.width < floor[0] || f.height < floor[1]) {
          emit(checks, p, "video.min_resolution", "reject", "OFFICIAL",
            `${f.width}×${f.height} is below TikTok's ${matched} floor of ${floor[0]}×${floor[1]}.`);
        } else if (rec && (f.width < rec[0] || f.height < rec[1])) {
          emit(checks, p, "video.recommended_resolution", "warn", "OFFICIAL",
            `TikTok wants at least 720p; this is ${f.width}×${f.height}. Smart Fix (flaw_detect + auto_fix_enabled) can upscale to 1280×720 — it'll look softer than a native-resolution asset.`);
        }
      }
    }
    // max bytes ≤500 MB.
    if (f.byteSize !== null && f.byteSize > 500 * MB) {
      emit(checks, p, "video.max_bytes", "reject", "OFFICIAL",
        `This video is ${fmtMb(f.byteSize)} MB — TikTok's limit is 500 MB.`);
    }
    // bitrate ≥516 kbps — TikTok's number IS official (A1-7 #2 encodes exactly this one).
    if (f.overallBitrateKbps !== null && f.overallBitrateKbps < 516) {
      emit(checks, p, "video.min_bitrate", "reject", "OFFICIAL",
        `Overall bitrate ≈${f.overallBitrateKbps} kbps — TikTok requires ≥516 kbps.`);
    }
    // container .mp4/.mov/.mpeg/.3gp/.avi — probe parses MP4/MOV; others never reach here.
    // watermarks — prohibited; NOT detectable from bytes in this runtime.
    emit(checks, p, "video.watermarks", "not_evaluable", "OFFICIAL",
      "Blurred or masked third-party watermarks are prohibited (a standard rejection). Watermark detection is not possible in the edge runtime — use a clean export and verify visually.");
    // black bars / letterboxing — the #1 auto-reject; edge-row luma needs frame decode.
    emit(checks, p, "video.black_bars", "not_evaluable", "OFFICIAL",
      "A 16:9 video letterboxed into a vertical frame is the single most common TikTok auto-reject. Edge-row luma detection needs frame decoding, which the edge runtime cannot do — verify visually or supply the original for a proper crop.");
    // safe zone — caption-length-dependent; our engineering defaults, not TikTok constants.
    emit(checks, p, "video.safe_zone", "warn", "HOUSE",
      "TikTok's safe zone shrinks as your caption gets longer, and the right rail eats about 120 pixels. Keep key elements out of the top ~130px and bottom ~480–560px at 1080×1920 (our defaults, not TikTok constants).");
  } else {
    // Image formats .jpg/.jpeg/.png.
    if (f.mimeType !== "image/jpeg" && f.mimeType !== "image/png") {
      emit(checks, p, "image.mime", "reject", "OFFICIAL",
        `TikTok ad images must be JPG or PNG — got ${f.mimeType ?? "unknown"}.`);
    }
    // res per ratio: 9:16 ≥720×1280 · 16:9 ≥1280×720 · 1:1 ≥640×640.
    const matched = classifyRatio(f.aspectRatio, tiktokRatios, 0.03);
    const floors: Record<string, [number, number]> = {
      "9:16": [720, 1280],
      "16:9": [1280, 720],
      "1:1": [640, 640],
    };
    if (matched === null) {
      const hasVariant = tiktokRatios.some((r) => f.variantRatios.includes(r));
      emit(checks, p, "image.ratio", hasVariant ? "warn" : "needs_transcode", "OFFICIAL",
        `Ratio ${f.aspectRatio ?? "unknown"} is not one of TikTok's 9:16 / 1:1 / 16:9.` +
          (hasVariant ? " A pre-cropped variant slot will be used instead." : " Supply a pre-cropped variant slot — the edge runtime cannot crop."));
    } else if (f.width !== null && f.height !== null) {
      const floor = floors[matched];
      if (floor && (f.width < floor[0] || f.height < floor[1])) {
        emit(checks, p, "image.min_resolution", "reject", "OFFICIAL",
          `${f.width}×${f.height} is below TikTok's ${matched} image floor of ${floor[0]}×${floor[1]}.`);
      }
    }
    // max bytes ≤100 MB (GAB image). The 100 KB carousel figure is TikTok's own,
    // 1000× apart — per-format; carousel intake is not built here (WARN tier per A1 contradiction #6).
    if (f.byteSize !== null && f.byteSize > 100 * MB) {
      emit(checks, p, "image.max_bytes", "reject", "OFFICIAL",
        `This image is ${fmtMb(f.byteSize)} MB — TikTok's image cap is 100 MB.`);
    }
  }
  return checks;
}

// ── §2.3 Snapchat ─────────────────────────────────────────────────────────────

function validateSnapchat(f: CreativeMediaFacts): CreativeCheck[] {
  const checks: CreativeCheck[] = [];
  const p: Platform = "snapchat";

  if (f.kind === "video") {
    // Top Snap ratio: 9:16 exact — |w/h − 0.5625| ≤ 0.01.
    if (f.aspectRatio !== null && Math.abs(f.aspectRatio - 0.5625) > 0.01) {
      const hasVariant = f.variantRatios.includes("9:16");
      emit(checks, p, "video.aspect_ratio", hasVariant ? "warn" : "needs_transcode", "OFFICIAL",
        `invalid_aspect_ratio: Snap Top Snaps are 9:16 exact (|w/h − 0.5625| ≤ 0.01); this is ${f.aspectRatio}.` +
          (hasVariant
            ? " A pre-cropped 9:16 variant slot will be used instead."
            : " Supply a pre-cropped 9:16 variant — otherwise top_snap_crop_position:OPTIMIZED silently crops it into garbage."));
    }
    // resolution 1080×1920 — reject below.
    if (f.width !== null && f.height !== null && (f.width < 1080 || f.height < 1920)) {
      emit(checks, p, "video.resolution", "reject", "OFFICIAL",
        `invalid_resolution: Snap Top Snap video is 1080×1920 minimum; this is ${f.width}×${f.height}.`);
    }
    // bytes: ≤32 MB standard · ≤1 GB chunked (32 × 32 MB).
    if (f.byteSize !== null && f.byteSize > 1024 * MB) {
      emit(checks, p, "video.max_bytes", "reject", "OFFICIAL",
        `video_too_large: ${fmtMb(f.byteSize)} MB exceeds Snap's 1 GB chunked-upload ceiling (32 chunks × 32 MB).`);
    } else if (f.byteSize !== null && f.byteSize > 32 * MB) {
      emit(checks, p, "video.chunked_path", "warn", "OFFICIAL",
        `${fmtMb(f.byteSize)} MB exceeds the 32 MB single-shot upload — the chunked multipart-upload-v2 path (INIT → ADD → FINALIZE) will be used; edge memory/time limits apply (A1-3 step 6).`);
    }
    // container MP4/MOV [OFFICIAL]; codec H.264 [secondary] → WARN via downgrade.
    if (f.mimeType !== "video/mp4" && f.mimeType !== "video/quicktime") {
      emit(checks, p, "video.container", "reject", "OFFICIAL",
        `Snap video must be MP4 or MOV — got ${f.mimeType ?? "unknown"}.`);
    }
    emit(checks, p, "video.codec", "reject", "SECONDARY",
      "Snap expects H.264 (secondary-confidence row — warn-only by the A1-6b posture); codec cannot be fully probed here.");
    // duration 3–180 s (A1 contradiction #3: media table renders 1800 s — most
    // likely LONGFORM_VIDEO; validate 3–180 for the Top Snap lane, confirm live).
    if (f.durationSeconds !== null && (f.durationSeconds < 3 || f.durationSeconds > 180)) {
      emit(checks, p, "video.duration", "reject", "OFFICIAL",
        `invalid_duration: Snapchat Top Snaps run 3 to 180 seconds. This one is ${Math.round(f.durationSeconds)}. (Snap ads under 10 seconds consistently outperform longer cuts.)`);
    }
    // AUDIO REQUIRED — silent video is auto-rejected as "Low-Quality Creative".
    if (f.hasAudio === false) {
      emit(checks, p, "video.audio_required", "reject", "OFFICIAL",
        "missing_audio: This video has no sound. Snapchat auto-rejects silent video as low-quality, and TikTok requires audio. " +
          "Add a soundtrack or a voiceover — a trending sound beats stock music on both.");
    } else if (f.hasAudio === null) {
      emit(checks, p, "video.audio_required", "not_evaluable", "OFFICIAL",
        "Audio-track presence could not be derived — Snap auto-rejects silent video; verify manually.");
    } else {
      // Presence provable; balance/−16 LUFS loudness is not probe-able here.
      emit(checks, p, "video.audio_loudness", "not_evaluable", "OFFICIAL",
        "Snap wants 2 balanced channels targeting −16 LUFS — loudness cannot be measured in the edge runtime; verify the mix.");
    }
    // safe zones — top/bottom 150 px (pixel policy; no API field expresses it).
    emit(checks, p, "video.safe_zone", "warn", "OFFICIAL",
      "Keep logos and text out of the top and bottom 150 pixels — Snapchat's own UI covers them.");
  } else {
    // Top Snap image: 9:16 · 1080×1920 · ≤5 MB · PNG/JPG.
    if (f.aspectRatio !== null && Math.abs(f.aspectRatio - 0.5625) > 0.01) {
      const hasVariant = f.variantRatios.includes("9:16");
      emit(checks, p, "image.aspect_ratio", hasVariant ? "warn" : "needs_transcode", "OFFICIAL",
        `Snap Top Snap images are 9:16 (1080×1920); this is ${f.aspectRatio}.` +
          (hasVariant ? " A pre-cropped 9:16 variant slot will be used instead." : " Supply a pre-cropped 9:16 variant — the edge runtime cannot crop."));
    }
    if (f.width !== null && f.height !== null && (f.width < 1080 || f.height < 1920)) {
      emit(checks, p, "image.resolution", "reject", "OFFICIAL",
        `Snap Top Snap images are 1080×1920 minimum; this is ${f.width}×${f.height}.`);
    }
    // ≤5 MB — ⚠ #864's bucket allows 30 MB = 6× this (the §1.5 consequence-3 trap).
    if (f.byteSize !== null && f.byteSize > 5 * MB) {
      emit(checks, p, "image.max_bytes", "reject", "OFFICIAL",
        `image_too_large: This image is ${fmtMb(f.byteSize)} MB. Google's limit is 5 MB and Snapchat's is 5 MB — re-encode it below 5 MB or use a smaller source. (The upload bucket allows 30 MB — 6× Snap's cap; passing our bucket does NOT mean passing Snap.)`);
    }
    if (f.mimeType !== "image/png" && f.mimeType !== "image/jpeg") {
      emit(checks, p, "image.mime", "reject", "OFFICIAL",
        `Snap Top Snap images are PNG or JPG — got ${f.mimeType ?? "unknown"}.`);
    }
    emit(checks, p, "image.safe_zone", "warn", "OFFICIAL",
      "Keep logos and text out of the top and bottom 150 pixels — Snapchat's own UI covers them.");
  }
  return checks;
}

// ── §2.4 Google ───────────────────────────────────────────────────────────────

/** The marketing-image ratio slots Google image assets are keyed on (A1-5). */
export const GOOGLE_IMAGE_SLOTS: Record<
  string,
  { recommended: [number, number]; minimum: [number, number] }
> = {
  "1.91:1": { recommended: [1200, 628], minimum: [600, 314] },
  "1:1": { recommended: [1200, 1200], minimum: [300, 300] }, // † doc conflict: use 1200×1200 universally
  "4:5": { recommended: [960, 1200], minimum: [480, 600] },
  "9:16": { recommended: [1080, 1920], minimum: [600, 1067] },
};

export const GOOGLE_IMAGE_MAX_BYTES = 5120 * KB; // 5,120 KB — every marketing slot

function validateGoogle(f: CreativeMediaFacts): CreativeCheck[] {
  const checks: CreativeCheck[] = [];
  const p: Platform = "google";

  if (f.kind === "image") {
    // GIF/WEBP — NOT accepted for marketing/logo assets despite the MimeType
    // enum being broader than the policy. JPG/PNG only.
    if (f.mimeType !== "image/jpeg" && f.mimeType !== "image/png") {
      emit(checks, p, "image.mime", "reject", "OFFICIAL",
        "Google only takes JPG or PNG for ad images — GIF and WEBP get rejected even though the format list suggests otherwise.");
    }
    // ≤5,120 KB on every marketing slot.
    if (f.byteSize !== null && f.byteSize > GOOGLE_IMAGE_MAX_BYTES) {
      emit(checks, p, "image.max_bytes", "reject", "OFFICIAL",
        `This image is ${fmtMb(f.byteSize)} MB. Google's limit is 5 MB and Snapchat's is 5 MB — re-encode below 5,120 KB or use a smaller source. (Re-encoding is not possible in the edge runtime — supply a smaller master or variant.)`);
    }
    // Ratio slot + minimums. NO published aspect tolerance exists — the ±1%
    // folklore is deliberately NOT encoded (classification epsilon only).
    const matched = classifyRatio(f.aspectRatio, Object.keys(GOOGLE_IMAGE_SLOTS), 0.03);
    if (matched === null) {
      const hasVariant = Object.keys(GOOGLE_IMAGE_SLOTS).some((r) => f.variantRatios.includes(r));
      emit(checks, p, "image.ratio", hasVariant ? "warn" : "needs_transcode", "OFFICIAL",
        `Ratio ${f.aspectRatio ?? "unknown"} matches none of Google's marketing slots (1.91:1, 1:1, 4:5, 9:16). ` +
          "Google's API has NO crop parameter and never fetches remote URLs — we must pass pre-cropped bytes." +
          (hasVariant ? " A pre-cropped variant slot will be used." : " Supply pre-cropped variant slots."));
    } else {
      const slot = GOOGLE_IMAGE_SLOTS[matched];
      if (f.width !== null && f.height !== null) {
        if (f.width < slot.minimum[0] || f.height < slot.minimum[1]) {
          emit(checks, p, "image.min_resolution", "reject", "OFFICIAL",
            `${f.width}×${f.height} is below Google's ${matched} minimum of ${slot.minimum[0]}×${slot.minimum[1]}.`);
        } else if (f.width < slot.recommended[0] || f.height < slot.recommended[1]) {
          emit(checks, p, "image.recommended_resolution", "warn", "OFFICIAL",
            `Google recommends ${slot.recommended[0]}×${slot.recommended[1]} for ${matched}; this is ${f.width}×${f.height}.`);
        }
      }
    }
  } else {
    // Video is YouTube-hosted only — the AUTO path (A1-4; not a blocker).
    emit(checks, p, "video.youtube_hosted", "warn", "OFFICIAL",
      "We'll upload this to YouTube for you — Google can only run YouTube-hosted video. It'll be unlisted.");
    // ratios 16:9 / 9:16 / 1:1 (4:3, 2:3 SD only) · min 720p.
    const matched = classifyRatio(f.aspectRatio, ["16:9", "9:16", "1:1"], 0.03);
    if (matched === null) {
      emit(checks, p, "video.ratio", "warn", "OFFICIAL",
        `Ratio ${f.aspectRatio ?? "unknown"} is not one of Google's primary 16:9 / 9:16 / 1:1 (4:3 and 2:3 are SD-only).`);
    }
    if (f.width !== null && f.height !== null && Math.min(f.width, f.height) < 720) {
      emit(checks, p, "video.min_resolution", "reject", "OFFICIAL",
        `Google video minimum is 720p; this is ${f.width}×${f.height}. (Recommended: 1080p.)`);
    }
    // max file 256 GB — encoded for totality; unreachable through our storage.
    if (f.byteSize !== null && f.byteSize > 256 * 1024 * MB) {
      emit(checks, p, "video.max_bytes", "reject", "OFFICIAL",
        "Over Google's 256 GB video ceiling.");
    }
  }
  return checks;
}

// ── §2.5 Reddit — HARD-BLOCK ONLY ON [SPEC]; every pixel/byte number is [3P] ──

function validateReddit(f: CreativeMediaFacts): CreativeCheck[] {
  const checks: CreativeCheck[] = [];
  const p: Platform = "reddit";

  // The one media-relevant [SPEC] row: thumbnail REQUIRED for VIDEO posts.
  if (f.kind === "video" && !f.posterPresent) {
    emit(checks, p, "video.thumbnail_required", "reject", "SPEC",
      "Reddit requires a thumbnail for VIDEO posts — supply a poster image.");
  }

  // Everything below is [3P] ⇒ WARN by the central downgrade — the OpenAPI spec
  // encodes ZERO pixel dimensions, byte caps, durations, or codecs; Reddit's
  // only machine feedback is async INVALID_MEDIA + prose (never regex it).
  if (f.kind === "image") {
    if (f.byteSize !== null && f.byteSize > 3 * MB) {
      emit(checks, p, "image.max_bytes", "reject", "3P",
        `~3 MB image cap per third-party sources ([3P] — warn only); this is ${fmtMb(f.byteSize)} MB. Reddit checks images after upload and only tells us in plain English. If it bounces, we'll show you exactly what Reddit said.`);
    }
    const matched = classifyRatio(f.aspectRatio, ["1:1", "4:5", "16:9"], 0.03);
    if (matched === null) {
      emit(checks, p, "image.dims", "reject", "3P",
        "Third-party sources list 1080×1080 (1:1), 1080×1350 (4:5 — recommended, Reddit is mobile-dominant), 1920×1080 (16:9) — [3P], warn only.");
    }
  } else {
    if (f.durationSeconds !== null && (f.durationSeconds < 2 || f.durationSeconds > 900)) {
      emit(checks, p, "video.duration", "reject", "3P",
        `2 s–15 min per third-party sources ([3P] — warn only); this is ${Math.round(f.durationSeconds ?? 0)}s. Recommended 5–30 s.`);
    }
    if (f.byteSize !== null && f.byteSize > 1024 * MB) {
      emit(checks, p, "video.max_bytes", "reject", "3P",
        "≤1 GB (recommended <512 MB) per third-party sources — [3P], warn only.");
    }
  }
  emit(checks, p, `${f.kind}.safe_zone`, "warn", "3P",
    "Reddit's upvote/comment bar overlays the bottom ~20% of the image. Keep text and logos out of it.");
  return checks;
}

// ── Entry points ──────────────────────────────────────────────────────────────

const VALIDATORS: Record<Platform, (f: CreativeMediaFacts) => CreativeCheck[]> = {
  meta: validateMeta,
  tiktok: validateTiktok,
  snapchat: validateSnapchat,
  google: validateGoogle,
  reddit: validateReddit,
};

export function validateCreativeForChannel(
  platform: Platform,
  facts: CreativeMediaFacts,
): ChannelValidationResult {
  const checks = VALIDATORS[platform](facts);
  return {
    platform,
    ok: !checks.some((c) => c.level === "reject"),
    needsTranscode: checks.some((c) => c.level === "needs_transcode"),
    checks,
  };
}

export function validateCreativeForChannels(
  platforms: readonly Platform[],
  facts: CreativeMediaFacts,
): ChannelValidationResult[] {
  return platforms.map((platform) => validateCreativeForChannel(platform, facts));
}
