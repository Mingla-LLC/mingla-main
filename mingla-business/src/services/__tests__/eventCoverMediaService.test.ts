import { describe, expect, test } from "@jest/globals";

import {
  EventCoverMediaError,
  EVENT_COVER_MAX_BYTES,
  EVENT_COVER_MAX_VIDEO_DURATION_MS,
  classifyEventCoverMedia,
  validateEventCoverAsset,
} from "../../utils/eventCoverMediaRules";

describe("eventCoverMediaService", () => {
  test("classifies supported image, gif, and video covers", () => {
    expect(classifyEventCoverMedia("image/jpeg", "cover.jpg")).toBe("image");
    expect(classifyEventCoverMedia("image/gif", "cover.gif")).toBe("gif");
    expect(classifyEventCoverMedia("video/mp4", "cover.mp4")).toBe("video");
    expect(classifyEventCoverMedia(null, "cover.webm")).toBe("video");
  });

  test("rejects unsupported cover media types", () => {
    expect(() =>
      validateEventCoverAsset({ mimeType: "application/pdf", fileName: "x.pdf" }),
    ).toThrow(EventCoverMediaError);
  });

  test("rejects oversized cover assets", () => {
    expect(() =>
      validateEventCoverAsset({
        mimeType: "image/png",
        fileSize: EVENT_COVER_MAX_BYTES + 1,
      }),
    ).toThrow("Covers must be 30 MB or smaller.");
  });

  test("rejects over-duration video covers", () => {
    expect(() =>
      validateEventCoverAsset({
        mimeType: "video/mp4",
        durationMs: EVENT_COVER_MAX_VIDEO_DURATION_MS + 1,
      }),
    ).toThrow("Cover videos must be 15 seconds or shorter.");
  });

  test("rejects videos when duration metadata is missing", () => {
    expect(() =>
      validateEventCoverAsset({
        mimeType: "video/mp4",
        fileName: "cover.mp4",
      }),
    ).toThrow("Cover videos must include duration");
  });
});
