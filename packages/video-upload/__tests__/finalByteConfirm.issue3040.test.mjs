// #3040 (2026-10-19, job 2ad825b6) — a finished upload is confirmed within
// seconds, and 99% is never shown while the bytes are still on the wire.
// Invariant I-VIDEO-ACK-NEVER-BEHIND-SIGN-IN (declared in mingla-business/src/services/__tests__/laneAckWithinTwoSeconds.issue3040.test.ts): the uploader hands over a finished transfer within 2 s of the server accepting the final byte
//
// FAILS ON REVERT:
//   W1  `inflightCap` removed (bytes handed to the browser reach 99 again)
//   W2  `confirm()` no longer bounded (a slow confirming HEAD holds the upload)
//   W3  the 99 emit after the final PATCH answer removed
import { test, mock } from "node:test";
import assert from "node:assert/strict";

import { CONFIRM_HEAD_TIMEOUT_MS, uploadSourceWeb } from "../index.js";

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

// A TUS server whose PATCH answers only when the test says the bytes landed,
// and whose HEAD can be made to hang.
const makeServer = ({ hangConfirmingHead = false } = {}) => {
  const state = { offset: 0, heads: 0, finishPatch: null };
  const fetchImpl = (_url, init) => {
    state.heads += 1;
    if (hangConfirmingHead && state.heads > 1) {
      return new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
    return Promise.resolve({ ok: true, status: 200, headers: { get: (name) => (name === "Upload-Offset" ? String(state.offset) : null) } });
  };
  class FakeXhr {
    constructor() { this.upload = {}; this.status = 0; }
    open() {}
    setRequestHeader() {}
    getResponseHeader(name) { return name === "Upload-Offset" ? String(state.offset) : null; }
    abort() {}
    send(blob) {
      // The browser "sends" the whole body at once, as Chromium reported in
      // production; the server only has it when finishPatch() runs.
      this.upload.onprogress?.({ loaded: blob.size });
      state.finishPatch = () => {
        state.offset += blob.size;
        this.status = 204;
        this.onload?.();
      };
    }
  }
  return { state, fetchImpl, FakeXhr };
};

test("W1/W3 bytes handed to the network never show 99; the server's answer does", async () => {
  const { state, fetchImpl, FakeXhr } = makeServer();
  const file = new Blob([new Uint8Array(6000)]);
  const events = [];
  const done = uploadSourceWeb({
    file, transport: { url: "u", headers: {} }, chunkBytes: 8000, fetchImpl, XhrImpl: FakeXhr,
    onProgress: (event) => events.push(event.percent),
  });
  await flush();
  assert.ok(state.finishPatch !== null, "the PATCH is on the wire");
  assert.ok(Math.max(...events) < 99, `showed ${Math.max(...events)}% before the server had the bytes`);
  state.finishPatch();
  await done;
  assert.deepEqual(events.slice(-2), [99, 100], "99 once the server accepted every byte, then 100");
});

test("W2 a hung confirming HEAD cannot hold a finished upload past its bound", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { state, fetchImpl, FakeXhr } = makeServer({ hangConfirmingHead: true });
    const file = new Blob([new Uint8Array(6000)]);
    let finished = false;
    const done = uploadSourceWeb({ file, transport: { url: "u", headers: {} }, chunkBytes: 8000, fetchImpl, XhrImpl: FakeXhr })
      .then((result) => { finished = true; return result; });
    await flush();
    state.finishPatch();
    await flush();
    mock.timers.tick(CONFIRM_HEAD_TIMEOUT_MS - 1);
    await flush();
    assert.equal(finished, false, "still inside the bound");
    mock.timers.tick(1);
    await flush();
    assert.equal(finished, true, "the PATCH's own offset confirmed the upload at the bound");
    assert.deepEqual(await done, { confirmedBytes: 6000, totalBytes: 6000 });
    assert.ok(CONFIRM_HEAD_TIMEOUT_MS <= 2000, "the bound fits the 2 s acknowledgement budget");
  } finally {
    mock.timers.reset();
  }
});

test("a PATCH that reports no offset still waits for the HEAD (no blind trust)", async () => {
  const { state, fetchImpl } = makeServer();
  class SilentXhr {
    constructor() { this.upload = {}; this.status = 0; }
    open() {}
    setRequestHeader() {}
    getResponseHeader() { return null; }
    abort() {}
    send(blob) { state.offset += blob.size; this.status = 204; queueMicrotask(() => this.onload?.()); }
  }
  await uploadSourceWeb({ file: new Blob([new Uint8Array(10)]), transport: { url: "u", headers: {} }, fetchImpl, XhrImpl: SilentXhr });
  assert.equal(state.heads, 2, "initial HEAD + the confirming HEAD");
});
