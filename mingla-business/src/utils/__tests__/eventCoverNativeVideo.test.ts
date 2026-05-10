import { describe, expect, test } from "@jest/globals";

import { validateNativeTrimmedEventCoverVideo } from "../eventCoverNativeVideo";

const limits = {
  maxDurationMs: 15_000,
  maxSourceBytes: 500 * 1024 * 1024,
};

describe("native trimmed event cover video validation", () => {
  test("builds upload-intent fields for a returned 8-second native-trimmed clip", () => {
    expect(
      validateNativeTrimmedEventCoverVideo(
        {
          duration: 8_000,
          fileSize: 12_345,
          uri: "file:///trimmed-cover.mov",
        },
        limits,
      ),
    ).toEqual({
      ok: true,
      uploadFields: {
        sourceBytes: 12_345,
        sourceDurationMs: 8_000,
        trimEndMs: 8_000,
        trimStartMs: 0,
      },
    });
  });

  test("rejects native picker output that is still over 15 seconds before upload-intent", () => {
    expect(
      validateNativeTrimmedEventCoverVideo(
        {
          duration: 16_000,
          fileSize: 12_345,
          uri: "file:///untrimmed-cover.mov",
        },
        limits,
      ),
    ).toMatchObject({
      code: "video_too_long",
      ok: false,
    });
  });

  test("rejects missing file size before upload-intent because edge validation requires positive source bytes", () => {
    expect(
      validateNativeTrimmedEventCoverVideo(
        {
          duration: 8_000,
          uri: "file:///trimmed-cover.mov",
        },
        limits,
      ),
    ).toMatchObject({
      code: "video_size_unknown",
      ok: false,
    });
  });
});
