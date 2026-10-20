/**
 * #3040 B-C12 / Appendix A §6 — trip-day media tiles G-01…G-07.
 * Pins every tile state's visual, label, × behaviour and tap; the failure
 * classification (paused only when the device is offline, T4); the live-region
 * thresholds (§11). The rendered sheet is driven in
 * TripDayMediaSheet.issue3040.tiles.test.tsx.
 * Invariant I-VIDEO-NO-RESURRECT (declared in supabase/functions/event-cover-video-status/__tests__/issue_3040_active_only.test.ts): a trip-day tile shows only its own item's truth
 * FAILS ON REVERT: collapse a state, drop the offline-only pause, announce
 * every %, or key a day by its list position while it has an ordinal.
 */
import {
  TRIP_DAY_TILE_STATE_IDS,
  classifyTileFailure,
  gridAnnouncement,
  newTripDayTile,
  tileA11yLabel,
  tileAnnouncement,
  tileFromProgress,
  tileNeedsSheet,
  tileRingDashOffset,
  tileVisual,
  tripDayMediaKey,
  type TripDayTile,
} from "../tripDayTileModel";

const video = (patch: Partial<TripDayTile>): TripDayTile => ({
  ...newTripDayTile({ key: "k", kind: "video", durationMs: 45_000 }),
  ...patch,
});
const coded = (code: string): Error & { code: string } => Object.assign(new Error(code), { code });

describe("#3040 trip-day tiles — the seven states", () => {
  it("has exactly G-01…G-07", () => {
    expect(Object.values(TRIP_DAY_TILE_STATE_IDS)).toEqual(["G-01", "G-02", "G-03", "G-04", "G-05", "G-06", "G-07"]);
  });

  it("G-01 Checking: spinner, 'Checking', × cancels", () => {
    expect(tileVisual(video({ state: "checking" }))).toMatchObject({ indicator: "spinner", label: "Checking", cancel: "abort", tap: null });
    expect(tileA11yLabel(video({ state: "checking" }), 0)).toBe("Video 1, checking file");
  });

  it("G-02 Uploading: 36 ring + '{n}%', × cancels", () => {
    const tile = video({ state: "uploading", percent: 42 });
    expect(tileVisual(tile)).toMatchObject({ indicator: "ring", label: "42%", cancel: "abort" });
    expect(tileA11yLabel(tile, 1)).toBe("Video 2, uploading, 42 percent. Double tap to cancel.");
  });

  it("G-03 Preparing: spinner, 'Preparing', × cancels", () => {
    expect(tileVisual(video({ state: "preparing" }))).toMatchObject({ indicator: "spinner", label: "Preparing", cancel: "abort" });
    expect(tileA11yLabel(video({ state: "preparing" }), 2)).toBe("Video 3, preparing");
  });

  it("G-04 Paused: wifi-off, 'Paused', no ×, no tap (auto-resumes)", () => {
    expect(tileVisual(video({ state: "paused" }))).toMatchObject({ indicator: "wifi_off", label: "Paused", cancel: null, tap: null });
    expect(tileA11yLabel(video({ state: "paused" }), 0)).toBe("Video 1, paused offline");
  });

  it("G-05 Ready: duration chip ▶ m:ss, tap opens the full-screen viewer, no scrim", () => {
    const tile = video({ state: "ready", mediaUrl: "https://cdn/x/play_1080p.mp4" });
    expect(tileVisual(tile)).toMatchObject({ indicator: "none", durationChip: "▶ 0:45", tap: "view", scrim: false, cancel: null });
    expect(tileA11yLabel(tile, 0)).toBe("Video 1, 0:45");
  });

  it("G-06 Failed retryable: error ring, 'Tap to retry', tap retries, × removes", () => {
    const tile = video({ state: "failed_retryable" });
    expect(tileVisual(tile)).toMatchObject({ failedRing: true, label: "Tap to retry", tap: "retry", cancel: "dismiss" });
    expect(tileA11yLabel(tile, 0)).toBe("Video 1, upload failed. Double tap to retry.");
  });

  it("G-07 Failed terminal: error ring, 'Can’t use', × only, the reason is read", () => {
    const tile = video({ state: "failed_terminal", reason: "That video is over 100 MB. Try a shorter clip." });
    expect(tileVisual(tile)).toMatchObject({ failedRing: true, label: "Can’t use", tap: null, cancel: "dismiss" });
    expect(tileA11yLabel(tile, 0)).toBe("Video 1, can't be used. That video is over 100 MB. Try a shorter clip.");
  });

  it("only a settled (ready) tile lets the sheet close", () => {
    expect(tileNeedsSheet(video({ state: "ready" }))).toBe(false);
    for (const state of ["checking", "uploading", "preparing", "paused", "failed_retryable", "failed_terminal"] as const) {
      expect(tileNeedsSheet(video({ state }))).toBe(true);
    }
  });
});

describe("#3040 trip-day tiles — truth rules", () => {
  it("upload % is byte-true and never 100 while uploading (T1/T2)", () => {
    expect(tileFromProgress({ phase: "uploading", percent: 100 })).toEqual({ state: "uploading", percent: 99 });
    expect(tileFromProgress({ phase: "uploading", percent: null })).toEqual({ state: "uploading", percent: null });
    expect(tileFromProgress({ phase: "confirming", percent: null }).state).toBe("preparing");
  });

  it("'Paused' only when the device itself is offline (T4)", () => {
    expect(classifyTileFailure(coded("source_upload_failed"), true).state).toBe("paused");
    expect(classifyTileFailure(coded("source_upload_failed"), false).state).toBe("failed_retryable");
    expect(classifyTileFailure(coded("edge_error"), false).state).toBe("failed_retryable");
  });

  it("a refusal about the file is terminal, even offline", () => {
    for (const code of ["validation_error", "video_file_too_large", "video_duration_over_cap", "client_version_required", "unsupported_type"]) {
      expect(classifyTileFailure(coded(code), true).state).toBe("failed_terminal");
    }
  });

  it("a source that can no longer be read retries by picking it again", () => {
    expect(classifyTileFailure(coded("video_source_unreadable"), false)).toEqual({ state: "failed_retryable", sourceGone: true });
  });

  it("live region: state on change, never every % (§11)", () => {
    const at = (percent: number) => tileAnnouncement(video({ state: "uploading", percent }), 0);
    expect(at(10)).toBe("Video 1, uploading");
    expect(at(24)).toBe(at(10));
    // [TEST-MOD-APPROVED #3040] 2026-10-19 (job 2ad825b6): the stepped
    // "75 percent" stayed in the accessibility tree while the tile showed
    // 99%. The live region now carries no number; the tile label carries the
    // visible one (tripDayTileLabelMatchesPercent.issue3040.test.ts).
    expect(at(26)).toBe(at(10));
    expect(at(99)).toBe(at(10));
    expect(gridAnnouncement([video({ state: "preparing" }), video({ state: "failed_retryable" })]))
      .toBe("Video 1, preparing. Video 2, upload failed");
  });

  it("ring arc: empty at 0, full at 100", () => {
    const circumference = 2 * Math.PI * ((36 - 3) / 2);
    expect(tileRingDashOffset(0)).toBeCloseTo(circumference);
    expect(tileRingDashOffset(100)).toBeCloseTo(0);
    expect(tileRingDashOffset(null)).toBeCloseTo(circumference);
  });

  it("dayKey comes from the day's ordinal", () => {
    expect(tripDayMediaKey({ ordinal: 3 }, 0)).toBe("day-3");
    expect(tripDayMediaKey(undefined, 1)).toBe("day-index-2");
  });
});
