// Invariant I-VIDEO-LIMITS-PARITY (declared in packages/video-upload/__tests__/purity_and_parity.test.mjs): duration, size and rendition limits are identical across this package, the edge defaults and the DB CHECKs
//
// The single client copy of the shared video lane's numeric contract. Every
// value here is mirrored by `supabase/functions/_shared/eventCoverVideo.ts`
// (edge defaults) and by the lane migration's CHECK constraints; the parity
// test in __tests__/purity_and_parity.test.mjs reads both and fails on drift.

export const VIDEO_LIMITS = Object.freeze({
  /** Longest clip any lane target accepts. */
  MAX_DURATION_MS: 60000,
  /**
   * Client-only grace for a raw clip that runs a few frames past one minute.
   * A source of 60001–60500 ms is declared as exactly 60000; the server and
   * the database stay strict at 60000.
   */
  SOURCE_DURATION_TOLERANCE_MS: 500,
  /** Largest source that may be uploaded (web raw, native post-compression). */
  SOURCE_MAX_BYTES: 104857600,
  /** Shortest ad video (`ad_creative` target only). Covers have no minimum. */
  AD_MIN_DURATION_MS: 5000,
  /** Largest processed MP4 the lane will accept from the provider. */
  FINAL_MAX_BYTES: 67108864,
  /** Tallest provider rendition the lane serves. */
  MAX_RENDITION_HEIGHT: 1080,
  /** Native compression: long edge in pixels. */
  NATIVE_COMPRESSION_MAX_EDGE_PX: 1920,
  /** Native compression: target bitrate in bits per second. */
  NATIVE_COMPRESSION_BITRATE_BPS: 8000000,
  /** Native compression runs only for sources at or above this size. */
  NATIVE_COMPRESSION_MIN_SOURCE_BYTES: 5242880,
  /** Native TUS PATCH size: small enough that progress is honest. */
  TUS_CHUNK_NATIVE_BYTES: 2097152,
  /** Web TUS PATCH size. */
  TUS_CHUNK_WEB_BYTES: 8388608,
  /** Client acknowledgement deadline (unchanged). */
  ACK_DEADLINE_MS: 150000,
  /** Client watch: the server stall bound (10 min) plus one reaper tick. */
  WATCH_DEADLINE_MS: 660000,
});
