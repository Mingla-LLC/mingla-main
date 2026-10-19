/**
 * #3040 T-A7 [A-7] — native prepare is fast and visible: a correct SHA-256
 * computed a block at a time, the JS thread yielded after every 1 MiB read,
 * and a compressed cache file renamed (not copied) into place.
 *
 * Perf bar (run by the implementor, recorded on the PR): `node --jitless` over
 * the 16,788,202-byte fixture < 3000 ms (was 9207 ms in the investigation).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

// Node's own digest, the reference the JS implementation must equal.
const sha256Hex = (bytes: Uint8Array): string => {
  const hash = createHash("sha256");
  hash.write(bytes);
  hash.end();
  return (hash.read() as Buffer).toString("hex");
};

const FIXTURE_BYTES = 16_788_202;
const fixture = (() => {
  const bytes = new Uint8Array(FIXTURE_BYTES);
  for (let i = 0; i < FIXTURE_BYTES; i += 1) bytes[i] = (Math.imul(i, 2654435761) >>> 24) & 255;
  return bytes;
})();

const mockFs = {
  cacheDirectory: "file:///cache/",
  deleteAsync: jest.fn(async () => undefined),
  copyAsync: jest.fn(async () => undefined),
  moveAsync: jest.fn(async () => undefined),
};
jest.mock("expo-file-system/legacy", () => mockFs);
jest.mock("expo-file-system", () => ({
  File: class {
    open(): { readBytes: (n: number) => Uint8Array; close: () => void } {
      let offset = 0;
      return {
        readBytes: (n: number) => {
          const chunk = fixture.subarray(offset, Math.min(FIXTURE_BYTES, offset + n));
          offset += chunk.length;
          return chunk;
        },
        close: () => undefined,
      };
    }
  },
}));

import { prepareEventCoverVideoSource, Sha256 } from "../eventCoverVideoPreparedSource.native";

describe("#3040 T-A7 — prepare hashes correctly and yields", () => {
  let timeoutSpy: ReturnType<typeof jest.spyOn>;
  beforeEach(() => {
    jest.clearAllMocks();
    timeoutSpy = jest.spyOn(global, "setTimeout");
  });
  afterEach(() => timeoutSpy.mockRestore());

  test("the 16.8 MB digest equals Node crypto, with at least 16 UI-thread yields", async () => {
    const prepared = await prepareEventCoverVideoSource({
      uri: "file:///cache/compressed-output.mp4",
      bytes: FIXTURE_BYTES,
      durationMs: 60000,
      fileName: "op-1.mp4",
      mimeType: "video/mp4",
      operationId: "op-1",
      ownedTemporary: true,
    });
    expect(prepared.sha256).toBe(sha256Hex(fixture));
    const zeroDelayYields = (timeoutSpy.mock.calls as unknown[][]).filter((call) => call[1] === 0).length;
    expect(zeroDelayYields).toBeGreaterThanOrEqual(16);
    // B-C7(3) — the compressor's own file is renamed, never copied.
    expect(mockFs.moveAsync).toHaveBeenCalledTimes(1);
    expect(mockFs.copyAsync).not.toHaveBeenCalled();
  });

  test("a raw pick (the user's own file) is still copied", async () => {
    await prepareEventCoverVideoSource({
      uri: "file:///library/clip.mov",
      bytes: FIXTURE_BYTES,
      durationMs: 60000,
      fileName: "clip.mov",
      mimeType: "video/quicktime",
      operationId: "op-2",
    });
    expect(mockFs.copyAsync).toHaveBeenCalledTimes(1);
    expect(mockFs.moveAsync).not.toHaveBeenCalled();
  });

  test("streaming in odd-sized pieces gives the same digest as one shot", () => {
    for (const size of [0, 1, 55, 56, 63, 64, 65, 119, 120, 128, 1000]) {
      const part = fixture.subarray(0, size);
      const one = new Sha256();
      one.update(part);
      const many = new Sha256();
      for (let i = 0; i < size; i += 7) many.update(part.subarray(i, Math.min(size, i + 7)));
      const expected = sha256Hex(part);
      expect(one.digest()).toBe(expected);
      expect(many.digest()).toBe(expected);
    }
  });

  test("the hook shows Checking file (preparing) as soon as compression resolves", () => {
    const hook = readFileSync(join(__dirname, "..", "..", "hooks", "useEventCoverVideoUpload.ts"), "utf8");
    const start = hook.indexOf("const startInternal = useCallback(");
    const body = hook.slice(start, hook.indexOf("const start = useCallback(", start));
    const compressed = body.indexOf("const compressed = await compressVideoLocally(");
    const preparing = body.indexOf('projectPreparation({ phase: "preparing", percent: 0 });', compressed);
    const prepare = body.indexOf("prepared = await prepareEventCoverVideoSource(", compressed);
    expect(compressed).toBeGreaterThan(-1);
    expect(preparing).toBeGreaterThan(compressed);
    expect(prepare).toBeGreaterThan(preparing);
    expect(body).toContain("ownedTemporary: compressed.wasCompressed");
  });
});
