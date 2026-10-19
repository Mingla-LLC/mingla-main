// Issue #3040 (T-PKG server half, T-SQL-LANE) — one limits table.
// MINGLA-INVARIANT: I-VIDEO-LIMITS-PARITY | issue #3040 | duration, size and rendition limits are identical across edge defaults and DB CHECKs
//
// The client half (packages/video-upload/limits.js) is pinned by the package
// parity suite against these same edge defaults.
// FAILS ON REVERT: change any edge default or DB CHECK value alone.
import {
  AD_MIN_DURATION_MS,
  FINAL_MAX_BYTES,
  MAX_DURATION_MS,
  MAX_RENDITION_HEIGHT,
  MAX_SOURCE_VIDEO_BYTES,
} from "../eventCoverVideo.ts";
import { VIDEO_LANE_FINAL_MAX_BYTES } from "../videoLaneLimits.ts";
import { assert } from "./issue3040_fakeSupabase.ts";

const MIGRATION = new URL(
  "../../../migrations/20271108003040_issue_3040_video_lane_1080p_owners.sql",
  import.meta.url,
);
const INTENT = new URL("../../event-cover-video-upload-intent/index.ts", import.meta.url);

Deno.test("#3040 edge defaults are the binding numeric contract", () => {
  assert(MAX_DURATION_MS === 60_000, "duration");
  assert(MAX_SOURCE_VIDEO_BYTES === 104_857_600, "source bytes");
  assert(FINAL_MAX_BYTES === 67_108_864, "processed bytes");
  assert(AD_MIN_DURATION_MS === 5_000, "ad minimum");
  assert(MAX_RENDITION_HEIGHT === 1080, "rendition");
  assert(VIDEO_LANE_FINAL_MAX_BYTES === FINAL_MAX_BYTES, "the ads fetch cap drifted from the lane budget");
});

Deno.test("#3040 the DB CHECKs carry the same numbers", async () => {
  const sql = (await Deno.readTextFile(MIGRATION)).replace(/\s+/g, " ");
  assert(/processed_bytes IS NULL OR processed_bytes <= 67108864/.test(sql), "processed CHECK");
  assert(/source_bytes <= 104857600/.test(sql), "source CHECK");
  assert(/target_kind <> 'ad_creative' OR source_duration_ms >= 5000/.test(sql), "ad minimum CHECK");
  assert(/source_duration_ms > 60000/.test(sql), "duration trigger");
});

Deno.test("#3040 the intent response reports the real processed budget", async () => {
  const intent = await Deno.readTextFile(INTENT);
  assert(intent.includes("finalMaxBytes: FINAL_MAX_BYTES"), "intent no longer reports FINAL_MAX_BYTES");
  assert(!intent.includes("25 * 1024 * 1024"), "intent hardcodes the old 25 MiB budget");
});
