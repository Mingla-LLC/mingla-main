// Issue #3040 (T-B9, B-9, C-22) — what the video reconciler records reaches the
// existing alert rail.
// MINGLA-INVARIANT: I-VIDEO-LANE-OBSERVED | issue #3040 | SLO breaches, ready-unclaimed jobs, reaper step failures and Bunny library config drift reach the existing alert rail
//
// FAILS ON REVERT: drop evaluateVideoLaneHealth (or the alert_on_degraded
// opt-in in computeEffectiveStatus) and a ready-unclaimed row never makes a
// failed tick, exactly the silence #3040 found (2 SLO breaches, 0 alerts).
import { computeEffectiveStatus, evaluateVideoLaneHealth } from "./logic.ts";

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};
const now = Date.UTC(2026, 9, 19, 12, 0, 0);
const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
const healthyLibrary = { ok: true as const, settings: { enabledResolutions: ["240p", "720p", "1080p"], mp4Fallback: true } };

Deno.test("#3040 a ready-unclaimed row in the window degrades bunny and fires the alert path", () => {
  const verdict = evaluateVideoLaneHealth({
    passiveRows: [{ checked_at: at(3), detail: { signal: "cover_video_ready_unclaimed", job_id: "j" } }],
    laneView: { ready_unclaimed_count: 0, stuck_nonterminal_count: 0, slo_breaches_1h: 0 },
    librarySettings: healthyLibrary,
    nowMs: now,
  });
  assert(verdict.status === "degraded" && verdict.reasons.includes("cover_video_ready_unclaimed"), JSON.stringify(verdict));
  const rollup = computeEffectiveStatus([
    { layer: "synthetic", status: "healthy", detail: {} },
    { layer: "passive", status: verdict.status, detail: verdict.detail },
  ]);
  assert(rollup.effectiveStatus === "degraded" && rollup.failedTick === true && rollup.failingLayer === "passive", JSON.stringify(rollup));
});

Deno.test("#3040 library drift away from 1080p MP4 is its own reason", () => {
  const no1080 = evaluateVideoLaneHealth({
    passiveRows: [], laneView: null, nowMs: now,
    librarySettings: { ok: true, settings: { enabledResolutions: ["240p", "720p"], mp4Fallback: true } },
  });
  assert(no1080.status === "degraded" && no1080.reasons.includes("bunny_library_config_drift"), JSON.stringify(no1080));
  const noMp4 = evaluateVideoLaneHealth({
    passiveRows: [], laneView: null, nowMs: now,
    librarySettings: { ok: true, settings: { enabledResolutions: ["1080p"], mp4Fallback: false } },
  });
  assert(noMp4.reasons.includes("bunny_library_config_drift"), "MP4 fallback off was not drift");
});

Deno.test("#3040 thresholds: more than two SLO breaches in 10 minutes, any step failure, anything stuck", () => {
  const breaches = (n: number, minutesAgo = 2) =>
    Array.from({ length: n }, () => ({ checked_at: at(minutesAgo), detail: { signal: "cover_video_processing_slo_breach" } }));
  const two = evaluateVideoLaneHealth({ passiveRows: breaches(2), laneView: null, librarySettings: healthyLibrary, nowMs: now });
  assert(two.status === "healthy", "two breaches alerted");
  const three = evaluateVideoLaneHealth({ passiveRows: breaches(3), laneView: null, librarySettings: healthyLibrary, nowMs: now });
  assert(three.status === "degraded" && three.reasons.includes("cover_video_processing_slo_breach"), JSON.stringify(three));
  const stale = evaluateVideoLaneHealth({ passiveRows: breaches(5, 30), laneView: null, librarySettings: healthyLibrary, nowMs: now });
  assert(stale.status === "healthy", "breaches outside the 10-minute window counted");
  const step = evaluateVideoLaneHealth({
    passiveRows: [{ checked_at: at(1), detail: { signal: "cover_video_reaper_step_failed", stage: "migration_not_applied" } }],
    laneView: null, librarySettings: healthyLibrary, nowMs: now,
  });
  assert(step.reasons.includes("cover_video_reaper_step_failed"), JSON.stringify(step));
  const stuck = evaluateVideoLaneHealth({ passiveRows: [], laneView: { stuck_nonterminal_count: "1" }, librarySettings: healthyLibrary, nowMs: now });
  assert(stuck.reasons.includes("cover_video_stuck_past_bound"), JSON.stringify(stuck));
  const quiet = evaluateVideoLaneHealth({ passiveRows: [], laneView: { ready_unclaimed_count: 0 }, librarySettings: healthyLibrary, nowMs: now });
  assert(quiet.status === "healthy" && quiet.detail.alert_on_degraded === false, JSON.stringify(quiet));
  const rollup = computeEffectiveStatus([{ layer: "passive", status: "healthy", detail: quiet.detail }]);
  assert(rollup.failedTick === false, "a healthy lane fired an alert");
});
