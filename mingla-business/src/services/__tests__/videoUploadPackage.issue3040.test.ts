/**
 * #3040 T-A8 (web) + T-PKG bridge — runs the shared `@mingla/video-upload`
 * package through THIS app's required jest gate, so the package's truth rules
 * are enforced in CI even though its node:test suites live beside it.
 *
 * MINGLA-INVARIANT: I-VIDEO-ONE-UPLOADER | issue #3040 | exactly one web TUS implementation exists (packages/video-upload); Host web imports it
 * MINGLA-INVARIANT: I-VIDEO-LIMITS-PARITY | issue #3040 | duration, size and rendition limits are identical across client package, edge defaults and DB CHECKs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  projectUploadPercent,
  uploadSourceWeb,
  VIDEO_LIMITS,
} from "@mingla/video-upload";

const businessRoot = join(__dirname, "..", "..", "..");

const makeServer = (): {
  state: { offset: number; heads: number };
  fetchImpl: (url: string, init: { method: string }) => Promise<{ ok: boolean; status: number; headers: { get: (n: string) => string | null } }>;
  FakeXhr: unknown;
} => {
  const state = { offset: 0, heads: 0 };
  const fetchImpl = async (_url: string, init: { method: string }) => {
    expect(init.method).toBe("HEAD");
    state.heads += 1;
    return { ok: true, status: 200, headers: { get: (n: string) => (n === "Upload-Offset" ? String(state.offset) : null) } };
  };
  class FakeXhr {
    upload: { onprogress?: (e: { loaded: number }) => void } = {};
    status = 0;
    onload?: () => void;
    open(): void {}
    setRequestHeader(): void {}
    getResponseHeader(): string { return String(state.offset); }
    abort(): void {}
    send(blob: { size: number }): void {
      this.upload.onprogress?.({ loaded: blob.size });
      void Promise.resolve().then(() => {
        state.offset += blob.size;
        this.status = 204;
        this.onload?.();
      });
    }
  }
  return { state, fetchImpl, FakeXhr };
};

describe("#3040 shared web uploader, run under the Business jest gate", () => {
  it("never reports 100 before the final PATCH and a HEAD equal to the total", async () => {
    const { state, fetchImpl, FakeXhr } = makeServer();
    const file = new Blob([new Uint8Array(20 * 1024)]);
    const events: Array<{ percent: number; serverOffset: number }> = [];
    await uploadSourceWeb({
      file,
      transport: { url: "https://tus.example/1", headers: {} },
      chunkBytes: 8 * 1024,
      fetchImpl,
      XhrImpl: FakeXhr,
      onProgress: (event) => events.push({ percent: event.percent, serverOffset: state.offset }),
    });
    const hundred = events.filter((event) => event.percent === 100);
    expect(hundred).toHaveLength(1);
    expect(events[events.length - 1].percent).toBe(100);
    expect(hundred[0].serverOffset).toBe(file.size);
    expect(events.slice(0, -1).every((event) => event.percent <= 99)).toBe(true);
    expect(projectUploadPercent({ confirmedBytes: 10, inflightLoaded: 0, total: 10 })).toBe(99);
  });

  it("Host web's processing service imports the package (no second uploader)", () => {
    const service = readFileSync(join(businessRoot, "src/services/eventCoverVideoProcessingService.ts"), "utf8");
    expect(service).toMatch(/from "@mingla\/video-upload"/);
    expect(service).toMatch(/uploadSourceWeb\(/);
    expect(service).not.toMatch(/new XMLHttpRequest\(/);
  });

  it("the Business package dependency is the local file: link and limits match §2", () => {
    const pkg = JSON.parse(readFileSync(join(businessRoot, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@mingla/video-upload"]).toBe("file:../packages/video-upload");
    expect(VIDEO_LIMITS.SOURCE_MAX_BYTES).toBe(104857600);
    expect(VIDEO_LIMITS.FINAL_MAX_BYTES).toBe(67108864);
    expect(VIDEO_LIMITS.AD_MIN_DURATION_MS).toBe(5000);
    expect(VIDEO_LIMITS.MAX_RENDITION_HEIGHT).toBe(1080);
  });
});
