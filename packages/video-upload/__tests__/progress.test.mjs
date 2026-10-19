// #3040 T-A8 (web half) — upload progress tells the truth.
// MINGLA-INVARIANT: I-VIDEO-ONE-UPLOADER | issue #3040 | exactly one web TUS implementation exists (this package)
import { test } from "node:test";
import assert from "node:assert/strict";

import { projectUploadPercent, uploadSourceWeb } from "../index.js";

// A fake TUS server: PATCH stores bytes, HEAD returns the stored offset.
const makeServer = () => {
  const state = { offset: 0, heads: 0 };
  const fetchImpl = async (_url, init) => {
    assert.equal(init.method, "HEAD");
    state.heads += 1;
    return { ok: true, status: 200, headers: { get: (name) => (name === "Upload-Offset" ? String(state.offset) : null) } };
  };
  class FakeXhr {
    constructor() { this.upload = {}; this.headers = {}; this.status = 0; }
    open(method) { assert.equal(method, "PATCH"); }
    setRequestHeader(key, value) { this.headers[key] = value; }
    getResponseHeader(name) { return name === "Upload-Offset" ? String(state.offset) : null; }
    abort() {}
    send(blob) {
      const size = blob.size;
      // Two network progress events per chunk, the last one "all handed off".
      this.upload.onprogress?.({ loaded: Math.floor(size / 2) });
      this.upload.onprogress?.({ loaded: size });
      queueMicrotask(() => {
        assert.equal(Number(this.headers["Upload-Offset"]), state.offset);
        state.offset += size;
        this.status = 204;
        this.onload?.();
      });
    }
  }
  return { state, fetchImpl, FakeXhr };
};

test("projectUploadPercent never returns 100", () => {
  assert.equal(projectUploadPercent({ confirmedBytes: 1000, inflightLoaded: 0, total: 1000 }), 99);
  assert.equal(projectUploadPercent({ confirmedBytes: 0, inflightLoaded: 1000, total: 1000 }), 99);
  assert.equal(projectUploadPercent({ confirmedBytes: 500, inflightLoaded: 0, total: 1000 }), 49);
  assert.equal(projectUploadPercent({ confirmedBytes: 0, inflightLoaded: 0, total: 0 }), 0);
});

test("uploadSourceWeb reports 100 only after the final PATCH and a HEAD equal to the total", async () => {
  const { state, fetchImpl, FakeXhr } = makeServer();
  const file = new Blob([new Uint8Array(20 * 1024)]);
  const events = [];
  await uploadSourceWeb({
    file,
    transport: { url: "https://tus.example/upload/1", headers: { AuthorizationSignature: "sig" } },
    chunkBytes: 8 * 1024,
    fetchImpl,
    XhrImpl: FakeXhr,
    onProgress: (event) => events.push({ ...event, serverOffsetAtEmit: state.offset, headsAtEmit: state.heads }),
  });
  const hundred = events.filter((event) => event.percent === 100);
  assert.equal(hundred.length, 1, "exactly one 100%");
  assert.equal(hundred[0], events[events.length - 1], "100% is the last event");
  assert.equal(hundred[0].final, true);
  assert.equal(hundred[0].serverOffsetAtEmit, file.size, "every byte confirmed before 100%");
  // 1 initial HEAD + one confirming HEAD per chunk (3 chunks).
  assert.equal(hundred[0].headsAtEmit, 4);
  for (const event of events.slice(0, -1)) assert.ok(event.percent <= 99, `pre-final event at ${event.percent}`);
  // Progress is monotonic.
  for (let i = 1; i < events.length; i += 1) assert.ok(events[i].percent >= events[i - 1].percent);
});

test("uploadSourceWeb resumes from the server offset", async () => {
  const { state, fetchImpl, FakeXhr } = makeServer();
  state.offset = 12 * 1024;
  const file = new Blob([new Uint8Array(20 * 1024)]);
  let patches = 0;
  class CountingXhr extends FakeXhr { send(blob) { patches += 1; super.send(blob); } }
  await uploadSourceWeb({ file, transport: { url: "u", headers: {} }, chunkBytes: 8 * 1024, fetchImpl, XhrImpl: CountingXhr });
  assert.equal(patches, 1, "only the missing 8 KiB is sent");
  assert.equal(state.offset, file.size);
});

test("aborting cancels the transfer", async () => {
  const { fetchImpl } = makeServer();
  const controller = new AbortController();
  class HangingXhr { constructor() { this.upload = {}; } open() {} setRequestHeader() {} abort() { this.aborted = true; } send() { controller.abort(); } }
  await assert.rejects(
    () => uploadSourceWeb({ file: new Blob([new Uint8Array(10)]), transport: { url: "u", headers: {} }, signal: controller.signal, fetchImpl, XhrImpl: HangingXhr }),
    (error) => error.code === "source_upload_cancelled",
  );
});
