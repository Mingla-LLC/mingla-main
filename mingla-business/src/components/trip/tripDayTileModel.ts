/**
 * #3040 B-C12 / Appendix A §6 — the trip-day media tile, as pure data.
 *
 * One tile per picked photo or video while it uploads, in seven states
 * (G-01…G-07). The sheet renders exactly what this model says, so every
 * state, label, live-region announcement and × behaviour is testable without
 * a renderer.
 *
 *   G-01 checking          scrim + spinner + "Checking"        × cancels
 *   G-02 uploading         scrim + 36 ring + "{n}%"             × cancels
 *   G-03 preparing         scrim + spinner + "Preparing"       × cancels
 *   G-04 paused            scrim + wifi-off + "Paused"         auto-resumes on reconnect
 *   G-05 ready             duration chip ▶ {m:ss}              tap opens the full-screen viewer
 *   G-06 failed_retryable  error ring + "Tap to retry" + ×     tap retries; × removes
 *   G-07 failed_terminal   error ring + "Can't use" + ×        × removes; the reason is shown
 */

import type { TripDayVideoUploadProgress } from "../../services/tripDayMediaService";

export type TripDayTileState =
  | "checking"
  | "uploading"
  | "preparing"
  | "paused"
  | "ready"
  | "failed_retryable"
  | "failed_terminal";

export type TripDayTile = {
  key: string;
  kind: "image" | "video";
  state: TripDayTileState;
  /** Byte-true upload percent (G-02 only); null = no honest number yet. */
  percent: number | null;
  durationMs: number | null;
  /** Host words for a failure (G-06/G-07); never a raw code. */
  reason: string | null;
  /** The finished item's URL (G-05), for the in-tile player. */
  mediaUrl: string | null;
};

export const TRIP_DAY_TILE_STATE_IDS: Record<TripDayTileState, string> = {
  checking: "G-01",
  uploading: "G-02",
  preparing: "G-03",
  paused: "G-04",
  ready: "G-05",
  failed_retryable: "G-06",
  failed_terminal: "G-07",
};

export const newTripDayTile = (input: {
  key: string;
  kind: "image" | "video";
  durationMs: number | null;
}): TripDayTile => ({
  key: input.key,
  kind: input.kind,
  state: "checking",
  percent: null,
  durationMs: input.durationMs,
  reason: null,
  mediaUrl: null,
});

/** The in-flight state a service progress event puts a tile in. */
export const tileFromProgress = (
  progress: TripDayVideoUploadProgress,
): Pick<TripDayTile, "state" | "percent"> => {
  switch (progress.phase) {
    case "checking":
      return { state: "checking", percent: null };
    case "uploading":
      // T1/T2 — byte-true only, never shown as 100 while still uploading.
      return {
        state: "uploading",
        percent: progress.percent === null ? null : Math.max(0, Math.min(99, Math.floor(progress.percent))),
      };
    case "confirming":
    case "processing":
      return { state: "preparing", percent: null };
  }
};

/**
 * Codes after which the SAME item can simply be tried again (our side, the
 * network, or a watch that ran out while the server kept working). Everything
 * else is a definite answer about the file itself.
 */
const RETRYABLE_CODES = new Set([
  "edge_error",
  "internal_error",
  "network_offline",
  "source_upload_failed",
  "source_upload_cancelled",
  "transport_integrity_failed",
  "transport_refresh_failed",
  "transport_lease_extend_failed",
  "transport_has_bytes",
  "upload_incomplete",
  "upload_initializing",
  "upload_temporarily_unavailable",
  "upload_verification_pending",
  "source_ack_timeout",
  "video_watch_deadline",
  "processed_video_missing",
  "job_not_ready",
  "upload_failed",
]);

/** Codes meaning the picked file can no longer be read: retry = pick again. */
const SOURCE_GONE_CODES = new Set([
  "video_source_unreadable",
  "video_source_size_changed",
  "empty_local_file",
  "source_file_gone",
]);

export const errorCodeOf = (error: unknown): string | null =>
  error !== null && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : null;

export type TileFailure = {
  state: "paused" | "failed_retryable" | "failed_terminal";
  /** True when the only way forward is choosing the file again. */
  sourceGone: boolean;
};

/**
 * Design T4 — "Paused" only when the device itself says it is offline; a
 * server or transport failure online is "Tap to retry", and a refusal about
 * the file is "Can't use".
 */
export const classifyTileFailure = (error: unknown, deviceOffline: boolean): TileFailure => {
  const code = errorCodeOf(error);
  if (code !== null && SOURCE_GONE_CODES.has(code)) {
    return { state: "failed_retryable", sourceGone: true };
  }
  const retryable = code === null || RETRYABLE_CODES.has(code);
  if (retryable && deviceOffline) return { state: "paused", sourceGone: false };
  return { state: retryable ? "failed_retryable" : "failed_terminal", sourceGone: false };
};

export const formatTileClock = (ms: number | null): string | null => {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return null;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const noun = (tile: TripDayTile): string => (tile.kind === "video" ? "Video" : "Photo");

/** Appendix A §6 "Label (a11y)" column, exactly. */
export const tileA11yLabel = (tile: TripDayTile, index: number): string => {
  const name = `${noun(tile)} ${index + 1}`;
  switch (tile.state) {
    case "checking":
      return `${name}, checking file`;
    case "uploading":
      return tile.percent === null
        ? `${name}, uploading. Double tap to cancel.`
        : `${name}, uploading, ${tile.percent} percent. Double tap to cancel.`;
    case "preparing":
      return `${name}, preparing`;
    case "paused":
      return `${name}, paused offline`;
    case "ready": {
      const clock = formatTileClock(tile.durationMs);
      return clock === null ? name : `${name}, ${clock}`;
    }
    case "failed_retryable":
      return `${name}, upload failed. Double tap to retry.`;
    case "failed_terminal":
      return tile.reason ? `${name}, can't be used. ${tile.reason}` : `${name}, can't be used`;
  }
};

export type TileVisual = {
  stateId: string;
  /** What sits in the middle of the tile. */
  indicator: "spinner" | "ring" | "wifi_off" | "error" | "none";
  /** The micro label under the indicator (null = none). */
  label: string | null;
  /** The × in the corner, and what it does. */
  cancel: "abort" | "dismiss" | null;
  /** What a tap on the tile body does. */
  tap: "retry" | "view" | null;
  failedRing: boolean;
  scrim: boolean;
  durationChip: string | null;
};

export const tileVisual = (tile: TripDayTile): TileVisual => {
  const stateId = TRIP_DAY_TILE_STATE_IDS[tile.state];
  switch (tile.state) {
    case "checking":
      return { stateId, indicator: "spinner", label: "Checking", cancel: "abort", tap: null, failedRing: false, scrim: true, durationChip: null };
    case "uploading":
      return {
        stateId,
        indicator: tile.percent === null ? "spinner" : "ring",
        label: tile.percent === null ? "Uploading" : `${tile.percent}%`,
        cancel: "abort",
        tap: null,
        failedRing: false,
        scrim: true,
        durationChip: null,
      };
    case "preparing":
      return { stateId, indicator: "spinner", label: "Preparing", cancel: "abort", tap: null, failedRing: false, scrim: true, durationChip: null };
    case "paused":
      return { stateId, indicator: "wifi_off", label: "Paused", cancel: null, tap: null, failedRing: false, scrim: true, durationChip: null };
    case "ready": {
      const clock = tile.kind === "video" ? formatTileClock(tile.durationMs) : null;
      return {
        stateId,
        indicator: "none",
        label: null,
        cancel: null,
        tap: tile.kind === "video" && tile.mediaUrl !== null ? "view" : null,
        failedRing: false,
        scrim: false,
        durationChip: clock === null ? null : `▶ ${clock}`,
      };
    }
    case "failed_retryable":
      return { stateId, indicator: "error", label: "Tap to retry", cancel: "dismiss", tap: "retry", failedRing: true, scrim: true, durationChip: null };
    case "failed_terminal":
      return { stateId, indicator: "error", label: "Can’t use", cancel: "dismiss", tap: null, failedRing: true, scrim: true, durationChip: null };
  }
};

/**
 * Design §11 — the live region announces the state on change, never every
 * tick. #3040 (2026-10-19): it no longer carries a stepped "25/50/75 percent":
 * that text stayed in the accessibility tree between steps, so a tile showing
 * "99%" read "uploading, 75 percent". The one number assistive tech reads is
 * the tile's own label (`tileA11yLabel`), which is always the visible percent.
 */
export const tileAnnouncement = (tile: TripDayTile, index: number): string => {
  if (tile.state === "uploading") return `${noun(tile)} ${index + 1}, uploading`;
  return tileA11yLabel(tile, index).replace(/\.? Double tap to (cancel|retry)\.$/, "");
};

/** The one polite announcement for the whole grid (tiles in order). */
export const gridAnnouncement = (tiles: readonly TripDayTile[]): string =>
  tiles.map((tile, index) => tileAnnouncement(tile, index)).join(". ");

/** Tiles that still need the sheet open (work running, or a decision left). */
export const tileNeedsSheet = (tile: TripDayTile): boolean =>
  tile.state !== "ready";

/** Ring geometry (design §2: ring 36, stroke 3). */
export const TILE_RING = { size: 36, stroke: 3 } as const;
export const tileRingDashOffset = (percent: number | null): number => {
  const radius = (TILE_RING.size - TILE_RING.stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = percent === null ? 0 : Math.max(0, Math.min(100, percent)) / 100;
  return circumference * (1 - fraction);
};

/**
 * #3040 B-C12 — the day part of a trip-day video's resume key. The day's own
 * ordinal (stable while the host edits that day); its list position only when
 * the draft has no ordinal yet.
 */
export const tripDayMediaKey = (
  day: { ordinal?: number | null } | undefined,
  index: number,
): string =>
  typeof day?.ordinal === "number" && Number.isFinite(day.ordinal)
    ? `day-${day.ordinal}`
    : `day-index-${index + 1}`;

/** #3040 §6 G-05 — the saved day grid's video chip: "▶ 0:45", or "▶" with no length. */
export const tripDayVideoChip = (durationMs: number | null): string => {
  const clock = formatTileClock(durationMs);
  return clock === null ? "▶" : `▶ ${clock}`;
};

export const tripDayVideoChipLabel = (durationMs: number | null): string => {
  const clock = formatTileClock(durationMs);
  return clock === null ? "Video" : `Video, ${clock}`;
};
