/**
 * #3040 T-A13a [A-13a] — the 500 ms one-minute tolerance applies on NATIVE as
 * well as web, so a phone's own "1 minute" recording does not open the trimmer.
 *
 * Invariant I-VIDEO-LIMITS-PARITY (declared in packages/video-upload/__tests__/purity_and_parity.test.mjs): duration, size and rendition limits are identical across client package, edge defaults and DB CHECKs
 */
import { describe, expect, test } from "@jest/globals";

import {
  EVENT_COVER_WEB_SOURCE_DURATION_TOLERANCE_MS,
  resolveRawCoverClipDurationMs,
} from "../eventCoverMediaRules";
import { VIDEO_LIMITS } from "@mingla/video-upload";

describe("#3040 T-A13a — native tolerance", () => {
  test("native 60,030 ms resolves to 60,000, so the trim decision is false", () => {
    const resolved = resolveRawCoverClipDurationMs(60_030, false);
    expect(resolved).toBe(60_000);
    const needsNativeTrim = resolved > 60_000;
    expect(needsNativeTrim).toBe(false);
  });

  test("past the band, native still trims and web still refuses", () => {
    expect(resolveRawCoverClipDurationMs(60_501, false)).toBe(60_501);
    expect(resolveRawCoverClipDurationMs(60_501, true)).toBe(60_501);
  });

  test("the rules literal equals the shared package (the eager-bundle copy cannot drift)", () => {
    expect(EVENT_COVER_WEB_SOURCE_DURATION_TOLERANCE_MS).toBe(VIDEO_LIMITS.SOURCE_DURATION_TOLERANCE_MS);
  });

});
