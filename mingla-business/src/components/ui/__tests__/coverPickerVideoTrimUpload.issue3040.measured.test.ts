/**
 * #3040 T-A13b/c [A-13] — a stream-copy trim is MEASURED before upload, and
 * the output's own name and type are declared.
 */
import { describe, expect, test } from "@jest/globals";

import {
  buildTrimmedVideoUploadFile,
  resolveTrimmedDeclaredDurationMs,
  TrimOverCapError,
} from "../coverPickerVideoTrimUpload";

const trimResult = { outputPath: "/Documents/trimmedVideo_17.mp4", startTime: 0, endTime: 60_000, duration: 84_000 };
const statFile = async () => ({ exists: true, size: 41_000_000 });

describe("#3040 T-A13 — measured trims", () => {
  test("a 60,000 ms window measured at 60,900 ms is refused as trim_over_cap", async () => {
    await expect(buildTrimmedVideoUploadFile({ trimResult, statFile, measureDurationMs: async () => 60_900 }))
      .rejects.toBeInstanceOf(TrimOverCapError);
    try {
      resolveTrimmedDeclaredDurationMs(60_900, 60_000);
    } catch (error) {
      expect((error as TrimOverCapError).code).toBe("trim_over_cap");
      expect((error as TrimOverCapError).measuredMs).toBe(60_900);
    }
  });

  test("measured 60,300 ms is declared as exactly 60,000; under a minute declares the measurement", async () => {
    const declared = await buildTrimmedVideoUploadFile({ trimResult, statFile, measureDurationMs: async () => 60_300 });
    expect(declared.durationMs).toBe(60_000);
    expect(declared.trimEndMs).toBe(60_000);
    const shorter = await buildTrimmedVideoUploadFile({ trimResult, statFile, measureDurationMs: async () => 59.4 });
    expect(shorter.durationMs).toBe(59_400);
  });

  test("a .MOV original trimmed to .mp4 is declared as the mp4 it is", async () => {
    const declared = await buildTrimmedVideoUploadFile({
      trimResult, statFile, originalFileName: "IMG_0001.MOV", originalMimeType: "video/quicktime",
      measureDurationMs: async () => 42_000,
    });
    expect(declared.fileName).toBe("trimmedVideo_17.mp4");
    expect(declared.mimeType).toBe("video/mp4");
  });

  test("a measurement that fails falls back to the window", async () => {
    const declared = await buildTrimmedVideoUploadFile({ trimResult, statFile, measureDurationMs: async () => { throw new Error("no meta"); } });
    expect(declared.durationMs).toBe(60_000);
  });
});
