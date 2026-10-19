// Issue #3040 — the video lane's processed-video byte budget as a pure
// constant, for modules that must not import the lane's Deno.env-reading
// shared helpers (the ads byte source). eventCoverVideo.ts FINAL_MAX_BYTES
// defaults to the same value; a parity suite pins the two together.
// MINGLA-INVARIANT: I-VIDEO-LIMITS-PARITY | issue #3040 | the ads video fetch cap is the lane processed budget
export const VIDEO_LANE_FINAL_MAX_BYTES = 67108864;
