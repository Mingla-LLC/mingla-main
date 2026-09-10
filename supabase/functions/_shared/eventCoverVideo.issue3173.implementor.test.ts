/**
 * #3173 — a provider progress of ZERO is the absence of progress, and must
 * never be dressed up as a determinate reading.
 *
 * Operator report (2026-09-10, production, job 0cd1ef4b-…): the cover sheet sat
 * on "Processing video — 0%" over an empty bar with no spinner for the whole
 * encode, then jumped straight to done. The upload itself was healthy — 73s end
 * to end, 5s of it upload — so nothing was actually stuck. What broke was the
 * reporting.
 *
 * Mechanism: Bunny's first encoding webhook carries `encodeProgress: 0`. The
 * webhook writes it, `cover_video_transition_job` latches it monotonically via
 * `greatest()`, and `mapEventCoverVideoStatus` accepted 0 as a real number —
 * which flipped `progressKind` from the stage's honest "indeterminate" to
 * "determinate". Every client keys its indeterminate treatment (spinner, "this
 * can take a while") on `percent === null`, so the 0 silently traded a live
 * spinner for a frozen number that could not move until the encode finished.
 *
 * These assertions fail on revert of the `> 0` floor in eventCoverVideo.ts.
 */
import { mapEventCoverVideoStatus } from "./eventCoverVideo.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const base = {
  id: "44444444-4444-4444-8444-444444444444",
  event_id: "55555555-5555-4555-8555-555555555555",
  brand_id: null,
  target_kind: "event",
  venue_id: null,
  draft_owner_key: null,
  client_operation_id: "66666666-6666-4666-8666-666666666666",
  apply_mode: "draft_auto",
  provider_progress: null,
  processed_url: null,
  processed_poster_url: null,
  processed_mime_type: null,
  processed_bytes: null,
  processed_duration_ms: null,
  failure_code: null,
  failure_message: null,
  created_at: "2026-09-10T06:36:26.723Z",
  updated_at: "2026-09-10T06:36:31.924Z",
  applied_at: null,
  cancelled_at: null,
  application_version: 0,
  application_receipt: null,
};

Deno.test("#3173 a provider progress of 0 stays indeterminate in both processing states", () => {
  for (const status of ["processing", "processing_queued"]) {
    const mapped = mapEventCoverVideoStatus(
      { ...base, status, provider_progress: 0 } as never,
    );
    assert(
      mapped.progressKind === "indeterminate",
      `${status} with progress 0 must stay indeterminate, got ${mapped.progressKind}`,
    );
    assert(
      mapped.progressPercent === null,
      `${status} with progress 0 must expose no percentage, got ${mapped.progressPercent}`,
    );
  }
});

Deno.test("#3173 the floor is exclusive: the first real reading is still trusted", () => {
  // The fix must not cost us real progress. One percent is a genuine reading
  // and has to survive as one, or the bar would never become determinate at all.
  for (const percent of [1, 42, 99, 100]) {
    const mapped = mapEventCoverVideoStatus(
      { ...base, status: "processing", provider_progress: percent } as never,
    );
    assert(
      mapped.progressKind === "determinate",
      `progress ${percent} must be determinate, got ${mapped.progressKind}`,
    );
    assert(
      mapped.progressPercent === percent,
      `progress ${percent} must map exactly, got ${mapped.progressPercent}`,
    );
  }
});

Deno.test("#3173 an out-of-band provider progress is still refused", () => {
  for (const percent of [-1, 101]) {
    const mapped = mapEventCoverVideoStatus(
      { ...base, status: "processing", provider_progress: percent } as never,
    );
    assert(
      mapped.progressKind === "indeterminate" &&
        mapped.progressPercent === null,
      `out-of-range progress ${percent} must not be trusted`,
    );
  }
});
