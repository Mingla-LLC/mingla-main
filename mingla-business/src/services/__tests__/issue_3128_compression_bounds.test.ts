/**
 * Issue #3128 — "Optimizing video…" must end, and must say what happened.
 *
 * The compressor was awaited with nothing guarding it: no timeout, no abort, no
 * progress requirement. Observed on a real iPhone, production build,
 * 2026-09-08: the sheet sat on "Optimizing video…" for 19 minutes and then
 * showed the generic "We couldn't finish this video upload" — with NO job row
 * ever created, so nothing was uploaded and the word "upload" named the wrong
 * step entirely.
 *
 * Fails-on-revert:
 *   - Remove the stall race -> T-3128-01 hangs and times out.
 *   - Remove the fallback -> T-3128-02 throws instead of returning the original.
 *   - Collapse the cause into a generic message -> T-3128-03 loses the detail
 *     that is the whole point of the failure path.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockCompress = jest.fn<(...args: unknown[]) => Promise<string>>();
const mockGetFileInfoAsync = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock("react-native-compressor", () => ({
  Video: { compress: (...args: unknown[]) => mockCompress(...args) },
}), { virtual: true });

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }), { virtual: true });

jest.mock("../platformFileSystem", () => ({
  getFileInfoAsync: (...args: unknown[]) => mockGetFileInfoAsync(...args),
}), { virtual: true });

import {
  compressVideoLocally,
  EventCoverVideoProcessingError,
} from "../eventCoverVideoProcessingService";

const BIG = 157_286_400; // 150 MB — over the 5 MB floor, so compression runs
const CAP = 104_857_600; // 100 MB pipeline contract

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  mockGetFileInfoAsync.mockResolvedValue({ exists: true, size: 40_000_000 });
});

describe("issue #3128 — local compression is bounded and honest", () => {
  test("T-3128-01 a compressor that never settles does not hang forever", async () => {
    jest.useFakeTimers();
    mockCompress.mockImplementation(() => new Promise<string>(() => {}));

    const settled = compressVideoLocally({
      uri: "file:///huge.mp4",
      bytes: BIG,
      durationMs: 15_000,
      maxUncompressedBytes: CAP,
    }).then(() => "resolved", (error: unknown) => error);

    // Past the stall window with no progress callback at all.
    await jest.advanceTimersByTimeAsync(95_000);
    const outcome = await settled;

    // BIG is over the cap, so there is no safe fallback: it must be a real,
    // typed, terminal failure rather than an open promise.
    expect(outcome).toBeInstanceOf(EventCoverVideoProcessingError);
    expect((outcome as EventCoverVideoProcessingError).code)
      .toBe("video_compression_failed");
    jest.useRealTimers();
  });

  test("T-3128-02 a failed compression of an already-small file uploads the original", async () => {
    mockCompress.mockRejectedValue(new Error("export session failed"));

    const result = await compressVideoLocally({
      uri: "file:///within-cap.mp4",
      bytes: 60_000_000, // under the cap: compression was only an optimisation
      durationMs: 15_000,
      maxUncompressedBytes: CAP,
    });

    expect(result).toMatchObject({
      uri: "file:///within-cap.mp4",
      bytes: 60_000_000,
      wasCompressed: false,
    });
  });

  test("T-3128-03 an unrecoverable failure carries the underlying cause", async () => {
    mockCompress.mockRejectedValue(new Error("AVAssetExportSessionStatusFailed"));

    const thrown = await compressVideoLocally({
      uri: "file:///huge.mp4",
      bytes: BIG,
      durationMs: 15_000,
      maxUncompressedBytes: CAP,
    }).then(() => null, (error: unknown) => error);

    expect(thrown).toBeInstanceOf(EventCoverVideoProcessingError);
    const message = (thrown as EventCoverVideoProcessingError).message;
    // The cause is the whole point — a generic message is what sent us round
    // this loop once already.
    expect(message).toContain("AVAssetExportSessionStatusFailed");
    expect(message).not.toContain("upload");
  });

  test("T-3128-04 a compression that keeps reporting progress is not killed", async () => {
    jest.useFakeTimers();
    mockCompress.mockImplementation((...args: unknown[]) => {
      const onProgress = args[2] as (value: number) => void;
      return new Promise<string>((resolve) => {
        let ticks = 0;
        const beat = setInterval(() => {
          ticks += 1;
          onProgress(ticks / 10);
          if (ticks >= 8) { clearInterval(beat); resolve("file:///compressed.mp4"); }
        }, 30_000);
      });
    });

    const settled = compressVideoLocally({
      uri: "file:///slow.mp4",
      bytes: BIG,
      durationMs: 15_000,
      maxUncompressedBytes: CAP,
    }).then((value) => value, (error: unknown) => error);

    // 4 minutes of steady progress — well past the 90s stall window, and it
    // must survive, because slow is not the same as stopped.
    await jest.advanceTimersByTimeAsync(240_000);
    const outcome = await settled;

    expect(outcome).toMatchObject({ wasCompressed: true, uri: "file:///compressed.mp4" });
    jest.useRealTimers();
  });
});
