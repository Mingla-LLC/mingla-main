/**
 * #4238 B7/B8 — the Host ad media step adds several videos at once.
 *
 * The pure half of the ad media queue: which picked files may upload, where
 * each goes (this ad, or the library once the ad holds 5), which pick repeats a
 * clip the brand already has, and how an upload stage reads on a tile. React
 * and React Native stay out so every rule is tested for real.
 *
 * The upload itself is the existing `ad_creative` video lane: one
 * `useEventCoverVideoUpload` per file (`HostAdVideoUploadSlot`), each with its
 * own owner key, so the jobs run side by side. Ad videos never supersede each
 * other on the server, so parallel jobs for one draft are allowed.
 */
// The limits module alone: the package index carries the upload transport,
// which stays out of the boot bundle (#4238 bundle movement).
import { VIDEO_LIMITS } from "@mingla/video-upload/limits.js";

/** The most videos and photos one Host ad can carry. */
export const HOST_AD_MEDIA_MAX = 5;

export type HostAdPickedVideo = {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  /** Milliseconds, or null when the platform did not report it. */
  durationMs: number | null;
};

export type HostAdPickRefusal =
  | "unsupported"
  | "too_short"
  | "too_long"
  | "too_large"
  | "unreadable";

/** One picked file's verdict before any byte leaves the device. */
export function hostAdPickRefusal(
  file: HostAdPickedVideo,
  options: { isWeb: boolean },
): HostAdPickRefusal | null {
  const type = (file.mimeType ?? "").toLowerCase();
  if (type === "video/3gpp" || type === "video/3gpp2" || /\.3g[p2]$/i.test(file.fileName ?? "")) {
    return "unsupported";
  }
  if (type !== "" && !type.startsWith("video/")) return "unsupported";
  const duration = file.durationMs;
  if (duration === null || !Number.isFinite(duration) || duration <= 0) return "unreadable";
  if (duration < VIDEO_LIMITS.AD_MIN_DURATION_MS) return "too_short";
  // A phone's own "1 minute" recording (a few frames over 60 s) counts as 60 s.
  if (duration > VIDEO_LIMITS.MAX_DURATION_MS + 999) return "too_long";
  // Web uploads the raw file; native compresses first and checks after.
  if (options.isWeb && typeof file.fileSize === "number" && file.fileSize > VIDEO_LIMITS.SOURCE_MAX_BYTES) {
    return "too_large";
  }
  return null;
}

/** "TY06.mp4" → "TY06": the name the server gives the finished creative. */
export function hostAdCreativeNameFor(fileName: string | null | undefined): string {
  const raw = (fileName ?? "").trim();
  return raw.replace(/\.[A-Za-z0-9]{1,8}$/, "").trim().slice(0, 120);
}

export type HostAdLibraryClip = {
  id: string;
  name: string;
  kind: "video" | "image";
  duration_seconds: number | null;
};

/**
 * A library clip that is the same file as this pick: same name (the server
 * names a creative after its file) and the same length to within a second.
 */
export function hostAdLibraryMatch(
  file: HostAdPickedVideo,
  library: readonly HostAdLibraryClip[],
): HostAdLibraryClip | null {
  const name = hostAdCreativeNameFor(file.fileName);
  if (name.length === 0) return null;
  return (
    library.find((clip) => {
      if (clip.kind !== "video" || clip.name.trim() !== name) return false;
      if (clip.duration_seconds === null || file.durationMs === null) return true;
      return Math.abs(Number(clip.duration_seconds) * 1000 - file.durationMs) <= 1000;
    }) ?? null
  );
}

/** Two picks of the same file (name and size), in this pick or one still uploading. */
export const hostAdPickFingerprint = (file: HostAdPickedVideo): string =>
  `${(file.fileName ?? "").trim().toLowerCase()}|${file.fileSize ?? "?"}`;

export type HostAdPickPlan = {
  /** New uploads that go into this ad. */
  toAd: HostAdPickedVideo[];
  /** New uploads that go to the library because the ad is full. */
  toLibrary: HostAdPickedVideo[];
  /** Picks that repeat a library clip: the Host chooses (use it, or upload again). */
  duplicates: { file: HostAdPickedVideo; clip: HostAdLibraryClip }[];
  /** Picks already in this pick or already uploading: dropped, said once. */
  repeats: HostAdPickedVideo[];
  refused: { file: HostAdPickedVideo; reason: HostAdPickRefusal }[];
};

/** Sort one multi-select pick into what uploads where, before anything starts. */
export function planHostAdPick(input: {
  files: readonly HostAdPickedVideo[];
  /** Items the ad holds now, uploads included. */
  adCount: number;
  library: readonly HostAdLibraryClip[];
  /** Fingerprints of uploads already in flight. */
  inFlight: readonly string[];
  isWeb: boolean;
}): HostAdPickPlan {
  const plan: HostAdPickPlan = { toAd: [], toLibrary: [], duplicates: [], repeats: [], refused: [] };
  const seen = new Set(input.inFlight);
  let room = Math.max(0, HOST_AD_MEDIA_MAX - input.adCount);
  for (const file of input.files) {
    const reason = hostAdPickRefusal(file, { isWeb: input.isWeb });
    if (reason !== null) {
      plan.refused.push({ file, reason });
      continue;
    }
    const print = hostAdPickFingerprint(file);
    if (seen.has(print)) {
      plan.repeats.push(file);
      continue;
    }
    seen.add(print);
    const clip = hostAdLibraryMatch(file, input.library);
    if (clip !== null) {
      plan.duplicates.push({ file, clip });
      continue;
    }
    if (room > 0) {
      plan.toAd.push(file);
      room -= 1;
    } else {
      plan.toLibrary.push(file);
    }
  }
  return plan;
}

import type { HostAdUploadPhase } from "./hostAdUploadPhase";

export type { HostAdUploadPhase };

/** One background upload, as the media step tracks it. */
export type HostAdUploadItem = {
  key: string;
  ownerKey: string;
  file: HostAdPickedVideo;
  name: string;
  /** Where the clip belongs once ready. */
  placement: "ad" | "library";
  phase: HostAdUploadPhase;
  /** 0–100 while uploading, else null. */
  percent: number | null;
  /** Epoch ms when the server started preparing it. */
  preparingSince: number | null;
  /** The server's creative id once the clip is ready. */
  creativeId: string | null;
  failure: "network" | "file" | null;
  canRetry: boolean;
};

/**
 * The owner key for one upload of a draft: `host-ad:<draftId>-<token>`. A
 * fresh token per file keeps each job (and its saved resume record) apart, so
 * a reload never reattaches a new pick to an old upload.
 */
export function hostAdUploadOwnerKey(draftId: string, token: string): string {
  const safe = token.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16);
  return `host-ad:${draftId}-${safe}`;
}

/** Ids of creatives in this ad after removing some; never more than 5. */
export function hostAdRemoveFromAd(current: readonly string[], remove: readonly string[]): string[] {
  const drop = new Set(remove);
  return current.filter((id) => !drop.has(id));
}

/** Adds ids to this ad in order, skipping ones already there, up to 5. */
export function hostAdAddToAd(current: readonly string[], add: readonly string[]): string[] {
  const out = [...current];
  for (const id of add) {
    if (out.length >= HOST_AD_MEDIA_MAX) break;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** "0:42": time since the server started preparing, for the tile. */
export function hostAdElapsedLabel(sinceMs: number | null, nowMs: number): string {
  if (sinceMs === null) return "0:00";
  const seconds = Math.max(0, Math.floor((nowMs - sinceMs) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
