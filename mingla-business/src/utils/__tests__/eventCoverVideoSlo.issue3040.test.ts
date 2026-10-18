import { describe, expect, test } from "@jest/globals";

import {
  coverVideoProcessingTiming,
  EVENT_COVER_VIDEO_DELAYED_MS,
  EVENT_COVER_VIDEO_SLO_MS,
} from "../eventCoverVideoSlo";

describe("issue #3040 cover-video processing SLO", () => {
  const uploadedAt = "2026-10-17T12:00:00.000Z";
  const uploadedMs = Date.parse(uploadedAt);

  test("uses the final-byte clock and changes state at exact 30s/60s boundaries", () => {
    expect(EVENT_COVER_VIDEO_DELAYED_MS).toBe(30_000);
    expect(EVENT_COVER_VIDEO_SLO_MS).toBe(60_000);
    expect(coverVideoProcessingTiming(uploadedAt, uploadedMs + 29_999)).toBe("normal");
    expect(coverVideoProcessingTiming(uploadedAt, uploadedMs + 30_000)).toBe("delayed");
    expect(coverVideoProcessingTiming(uploadedAt, uploadedMs + 59_999)).toBe("delayed");
    expect(coverVideoProcessingTiming(uploadedAt, uploadedMs + 60_000)).toBe("breached");
  });

  test("missing, malformed, or future clocks never fabricate a breach", () => {
    expect(coverVideoProcessingTiming(null, uploadedMs + 90_000)).toBe("normal");
    expect(coverVideoProcessingTiming("not-a-date", uploadedMs + 90_000)).toBe("normal");
    expect(coverVideoProcessingTiming(uploadedAt, uploadedMs - 1)).toBe("normal");
  });
});
