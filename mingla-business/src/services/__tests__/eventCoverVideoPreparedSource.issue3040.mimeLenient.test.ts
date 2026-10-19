/**
 * #3040 T-A20 [A-20] — prepare accepts a valid clip whatever its name looks
 * like: MIME first, then extension, then the file's own first bytes. 3GPP is
 * refused by name.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

import { prepareEventCoverVideoSource } from "../eventCoverVideoPreparedSource";
import { resolveLaneVideoType, sniffLaneVideoType } from "../eventCoverVideoSourceType";

const ascii = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));
const mp4Head = new Uint8Array([0, 0, 0, 24, ...ascii("ftyp"), ...ascii("isom")]);
const movHead = new Uint8Array([0, 0, 0, 20, ...ascii("ftyp"), ...ascii("qt  ")]);

describe("#3040 T-A20 — lenient type resolution", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = (async () => ({
      ok: true,
      blob: async () => new Blob([mp4Head, new Uint8Array(100)]),
    })) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("{fileName: null, mimeType: video/mp4} prepares with extension mp4", async () => {
    const prepared = await prepareEventCoverVideoSource({
      uri: "blob:x", bytes: 112, durationMs: 8000, fileName: null, mimeType: "video/mp4", operationId: "op",
    });
    expect(prepared.extension).toBe("mp4");
    expect(prepared.fileName).toBe("video.mp4");
    expect(prepared.mimeType).toBe("video/mp4");
  });

  test("an empty MIME with a .mov name resolves to video/quicktime", () => {
    expect(resolveLaneVideoType({ mimeType: "", fileName: "clip.MOV" })).toEqual({ extension: "mov", mimeType: "video/quicktime", fileName: "clip.MOV" });
  });

  test("no MIME and no extension: the bytes decide", async () => {
    expect(sniffLaneVideoType(movHead)).toBe("mov");
    expect(sniffLaneVideoType(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))).toBe("webm");
    const prepared = await prepareEventCoverVideoSource({
      uri: "blob:x", bytes: 112, durationMs: 8000, fileName: "IMG_0001", mimeType: "", operationId: "op",
    });
    expect(prepared.extension).toBe("mp4");
  });

  test("3GPP is refused by name, never guessed", () => {
    expect(() => resolveLaneVideoType({ mimeType: "video/3gpp", fileName: "clip.3gp" })).toThrow("video_source_type_unsupported");
  });
});
