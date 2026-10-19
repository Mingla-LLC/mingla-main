/**
 * #3040 T-A16 [A-16] — a player error on a saved VIDEO cover gets video copy
 * and a "Load preview again" action, never "Try another image or GIF".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

import { resolveRenderErrorCopy, RELOAD_PREVIEW_MAX_MS } from "../coverUploadCardModel";
import { describePreviewFailure } from "../coverPickerPreviewTelemetry";

describe("#3040 T-A16 — render error on an existing video", () => {
  test("video copy, with reloadPreview", () => {
    const copy = resolveRenderErrorCopy("video");
    expect(copy.title).toBe("We couldn't load the preview");
    expect(copy.body).toContain("Your video cover is still saved.");
    expect(`${copy.title} ${copy.body}`).not.toMatch(/image or GIF/i);
    expect(copy.action.id).toBe("reloadPreview");
    expect(copy.action.label).toBe("Load preview again");
  });

  test("second failure and photo variants", () => {
    expect(resolveRenderErrorCopy("video", 2).body).toBe("Still not loading. If guests report the same, replace the video.");
    expect(resolveRenderErrorCopy("photo").body).toContain("Your photo cover is still saved.");
    expect(RELOAD_PREVIEW_MAX_MS).toBe(8_000);
  });

  test("telemetry carries only the host and whether a guid is present", () => {
    expect(describePreviewFailure("https://vz-1.b-cdn.net/0f1e2d3c-aaaa/play_1080p.mp4", "video")).toEqual({
      mediaType: "video", host: "vz-1.b-cdn.net", guidPresent: true,
    });
    expect(describePreviewFailure("not a url", null)).toEqual({ mediaType: "unknown", host: "unknown", guidPresent: false });
  });

  test("the picker no longer shows the image-or-GIF sentence for a render error", () => {
    const picker = readFileSync(join(__dirname, "..", "CoverPicker.tsx"), "utf8");
    expect(picker).not.toContain("Uploaded, but this cover could not be displayed. Try another image or GIF.");
    expect(picker).toContain("reportCoverPreviewRenderError(event.mediaUrl, event.mediaType)");
  });
});
