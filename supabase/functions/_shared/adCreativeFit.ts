// Issue #3040 (design AD-04) — the per-platform fit of a video creative, in
// host words, computed by the SAME channel matrix every ads gate uses
// (`adCreativeMatrix.ts`). The Host app turns this into "Fits Meta and TikTok.
// Snapchat needs 1080×1920." It never re-derives a platform rule itself.
//
// A platform "fits" when the matrix raises no reject, no needs_transcode and no
// fail-safe not_evaluable for it (the rows the funding gate fails closed on).
// Each misfit names what the platform needs, as a short phrase.
// Invariant I-ADS-FIT-ONE-MATRIX (declared in supabase/functions/_shared/__tests__/adCreativeFit.issue3040.test.ts): Host fit text comes from adCreativeMatrix, never a client copy of its rules
import type { Platform } from "./adChannel.ts";
import {
  type CreativeCheck,
  type CreativeMediaFacts,
  validateCreativeForChannel,
} from "./adCreativeMatrix.ts";

export type CreativeFit = {
  platform: Platform;
  fits: boolean;
  /** Short host phrases, e.g. "1080×1920", "at least 5 seconds", "sound". */
  needs: string[];
};

/** The creative columns the fit reads. Every one is probe-derived server-side. */
export type CreativeFitRow = {
  kind?: unknown;
  mime_type?: unknown;
  width?: unknown;
  height?: unknown;
  aspect_ratio?: unknown;
  duration_seconds?: unknown;
  has_audio?: unknown;
  byte_size?: unknown;
  poster_url?: unknown;
  variants?: unknown;
};

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function creativeFitFacts(row: CreativeFitRow): CreativeMediaFacts {
  const byteSize = num(row.byte_size);
  const durationSeconds = num(row.duration_seconds);
  const variants = row.variants !== null && typeof row.variants === "object" &&
      !Array.isArray(row.variants)
    ? Object.keys(row.variants as Record<string, unknown>)
    : [];
  return {
    kind: row.kind === "image" ? "image" : "video",
    mimeType: typeof row.mime_type === "string" ? row.mime_type : null,
    container: null,
    width: num(row.width),
    height: num(row.height),
    aspectRatio: num(row.aspect_ratio),
    durationSeconds,
    hasAudio: typeof row.has_audio === "boolean" ? row.has_audio : null,
    byteSize,
    overallBitrateKbps: byteSize !== null && durationSeconds !== null &&
        durationSeconds > 0
      ? Math.round((byteSize * 8) / durationSeconds / 1000)
      : null,
    posterPresent: typeof row.poster_url === "string" &&
      row.poster_url.length > 0,
    variantRatios: variants,
  };
}

// Duration windows the matrix enforces per platform (minimum, maximum seconds).
const DURATION_WINDOW: Partial<Record<Platform, [number, number]>> = {
  meta: [5, 180],
  tiktok: [5, 60],
  snapchat: [3, 180],
};

const isBlocking = (check: CreativeCheck): boolean =>
  check.level === "reject" || check.level === "needs_transcode" ||
  (check.level === "not_evaluable" && check.failSafe === true);

/** The short "needs" phrase for one blocking check. */
export function fitNeedFor(
  check: CreativeCheck,
  facts: CreativeMediaFacts,
): string {
  switch (check.rule) {
    case "video.duration":
    case "video.duration_policy": {
      const window = DURATION_WINDOW[check.platform];
      if (window && facts.durationSeconds !== null) {
        return facts.durationSeconds < window[0]
          ? `at least ${window[0]} seconds`
          : `${window[1]} seconds or less`;
      }
      return "a different length";
    }
    case "video.audio_required":
      return "sound";
    case "video.resolution":
      return "1080×1920";
    case "video.aspect_ratio":
      return "9:16";
    case "video.ratio":
      return check.platform === "tiktok" ? "9:16, 1:1 or 16:9" : "9:16";
    case "video.min_resolution":
      return check.platform === "google" ? "720p or higher" : "a sharper video";
    case "video.container":
      return "MP4 or MOV";
    case "video.thumbnail":
    case "video.thumbnail_required":
      return "a poster image";
    case "video.max_bytes":
      return "a smaller file";
    case "video.min_bitrate":
      return "a higher-quality export";
    // #3697 — image rules get image words. An image judged by the image rows
    // of the matrix must never read "a different video".
    case "image.ratio":
    case "image.aspect_ratio":
      return IMAGE_RATIO_NEED[check.platform] ?? "9:16";
    case "image.resolution":
      return "1080×1920";
    case "image.min_width":
      return "600px wide or more";
    case "image.min_resolution":
      return "a larger image";
    case "image.max_bytes":
      return IMAGE_MAX_MB[check.platform]
        ? `a file under ${IMAGE_MAX_MB[check.platform]} MB`
        : "a smaller file";
    case "image.mime":
      return "JPG or PNG";
    default:
      return facts.kind === "image" ? "a different image" : "a different video";
  }
}

// The image ratios each platform takes (adCreativeMatrix.ts image rows).
const IMAGE_RATIO_NEED: Partial<Record<Platform, string>> = {
  meta: "9:16, 4:5, 1:1 or 1.91:1",
  google: "9:16, 4:5, 1:1 or 1.91:1",
  tiktok: "9:16, 1:1 or 16:9",
  snapchat: "9:16",
};

// The image byte caps the matrix rejects above, in MB.
const IMAGE_MAX_MB: Partial<Record<Platform, number>> = {
  meta: 30,
  tiktok: 100,
  google: 5,
  snapchat: 5,
};

export function summarizeCreativeFit(
  platforms: readonly Platform[],
  row: CreativeFitRow,
): CreativeFit[] {
  const facts = creativeFitFacts(row);
  const seen = new Set<Platform>();
  const out: CreativeFit[] = [];
  for (const platform of platforms) {
    if (seen.has(platform)) continue;
    seen.add(platform);
    const result = validateCreativeForChannel(platform, facts);
    const needs: string[] = [];
    for (const check of result.checks) {
      if (!isBlocking(check)) continue;
      const need = fitNeedFor(check, facts);
      if (!needs.includes(need)) needs.push(need);
    }
    out.push({ platform, fits: needs.length === 0, needs });
  }
  return out;
}

/**
 * The Host setup projection (`ad-plan` action `setup`): each creative gains
 * `fit` for the brand's connected platforms, in a fixed order. Media columns
 * the client never needed stay off the wire.
 */
const HOST_FIT_ORDER: readonly Platform[] = [
  "meta",
  "tiktok",
  "google",
  "snapchat",
  "reddit",
];
const FIT_ONLY_COLUMNS = [
  "width",
  "height",
  "has_audio",
  "mime_type",
  "byte_size",
  "variants",
] as const;

export function withHostCreativeFit(
  creatives: readonly Record<string, unknown>[],
  connections: readonly { platform?: unknown }[],
): Record<string, unknown>[] {
  const connected = new Set(
    connections.map((row) => row.platform).filter((p): p is Platform =>
      typeof p === "string" && (HOST_FIT_ORDER as readonly string[]).includes(p)
    ),
  );
  const platforms = HOST_FIT_ORDER.filter((p) => connected.has(p));
  return creatives.map((creative) => {
    const projected: Record<string, unknown> = { ...creative };
    for (const column of FIT_ONLY_COLUMNS) delete projected[column];
    projected.fit = summarizeCreativeFit(platforms, creative as CreativeFitRow);
    return projected;
  });
}
