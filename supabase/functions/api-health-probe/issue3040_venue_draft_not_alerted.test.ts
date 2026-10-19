// Issue #3040 (P1-2 rework, tester D-6) — a ready venue-draft video is
// client-owned and kept, so it is never "unclaimed": a row naming one never
// degrades the Bunny tile or fires the alert path. Every other target still
// does.
// MINGLA-INVARIANT: I-VENUE-DRAFT-VIDEO-RETAINED | issue #3040 | retained venue-draft videos never feed the ready-unclaimed alert
//
// FAILS ON REVERT: drop the venue_draft exclusion in evaluateVideoLaneHealth's
// passive-row count and the first case degrades.
import { evaluateVideoLaneHealth } from "./logic.ts";

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};
const now = Date.UTC(2026, 9, 19, 12, 0, 0);
const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
const healthyLibrary = { ok: true as const, settings: { enabledResolutions: ["720p", "1080p"], mp4Fallback: true } };
const lane = { ready_unclaimed_count: 0, stuck_nonterminal_count: 0, slo_breaches_1h: 0 };

Deno.test("#3040 a venue-draft ready row never degrades the lane", () => {
  const verdict = evaluateVideoLaneHealth({
    passiveRows: [{ checked_at: at(2), detail: { signal: "cover_video_ready_unclaimed", job_id: "vd", target_kind: "venue_draft" } }],
    laneView: lane, librarySettings: healthyLibrary, nowMs: now,
  });
  assert(verdict.status === "healthy" && verdict.reasons.length === 0, JSON.stringify(verdict));
});

Deno.test("#3040 any other unclaimed ready video still degrades the lane", () => {
  for (const kind of ["event", "brand", "venue", "trip_day_media"]) {
    const verdict = evaluateVideoLaneHealth({
      passiveRows: [{ checked_at: at(2), detail: { signal: "cover_video_ready_unclaimed", job_id: "j", target_kind: kind } }],
      laneView: lane, librarySettings: healthyLibrary, nowMs: now,
    });
    assert(verdict.status === "degraded" && verdict.reasons.includes("cover_video_ready_unclaimed"), `${kind}: ${JSON.stringify(verdict)}`);
  }
});
