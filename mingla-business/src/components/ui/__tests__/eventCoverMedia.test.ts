import { describe, expect, test } from "@jest/globals";

import { resolveEventCoverMediaPresentation } from "../../../utils/eventCoverMediaRules";

describe("EventCoverMedia presentation", () => {
  test("falls back to hue cover when media is missing or errors", () => {
    expect(resolveEventCoverMediaPresentation({ mediaUrl: null })).toBe("fallback");
    expect(
      resolveEventCoverMediaPresentation({
        mediaUrl: "https://cdn.example.com/cover.jpg",
        mediaType: "image",
        hasMediaError: true,
      }),
    ).toBe("fallback");
  });

  test("renders animated cover media types and respects reduced motion for video", () => {
    expect(
      resolveEventCoverMediaPresentation({
        mediaUrl: "https://cdn.example.com/cover.gif",
        mediaType: "gif",
      }),
    ).toBe("gif");
    expect(
      resolveEventCoverMediaPresentation({
        mediaUrl: "https://cdn.example.com/cover.mp4",
        mediaType: "video",
      }),
    ).toBe("video");
    expect(
      resolveEventCoverMediaPresentation({
        mediaUrl: "https://cdn.example.com/cover.mp4",
        mediaType: "video",
        reduceMotion: true,
      }),
    ).toBe("video_still");
  });
});
