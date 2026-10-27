// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 rework — cancelling a chat media send.
//   * a cancel while the upload runs cancels the task;
//   * a cancel before the upload starts makes that attempt refuse to start;
//   * a cancel AFTER the upload finished is a no-op: the client id is not left
//     marked cancelled, so the message's retry (same client id) is not refused;
//   * a failed upload stays cancellable on its retry.
//
// FAILS-ON-REVERT: delete `if (this.finished.has(clientId)) return 'finished';`
// in ChatUploadCancelRegistry.cancel → the after-finish cancel blocks the retry.

import { ChatUploadCancelRegistry } from "../chatMedia.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const task = () => {
  const state = { cancelled: 0 };
  return { state, cancelAsync: async () => { state.cancelled += 1; } };
};

Deno.test("#4114 rework: a running upload is cancelled", async () => {
  const uploads = new ChatUploadCancelRegistry();
  const t = task();
  uploads.begin("c1");
  const entry = uploads.start("c1", t);
  assert(uploads.isRunning("c1"), "running");
  assert((await uploads.cancel("c1")) === "running", "cancel hits the running task");
  assert(entry.cancelled && t.state.cancelled === 1, "the task was cancelled");
  uploads.settle("c1", false);
  assert(!uploads.isRunning("c1"), "settled");
});

Deno.test("#4114 rework: a cancel before start refuses that attempt once", async () => {
  const uploads = new ChatUploadCancelRegistry();
  assert((await uploads.cancel("c2")) === "pending", "nothing running yet");
  uploads.begin("c2");
  assert(uploads.takeCancelledBeforeStart("c2"), "the attempt sees the cancel");
  assert(!uploads.takeCancelledBeforeStart("c2"), "only once");
});

Deno.test("#4114 rework: a cancel after the upload finished never blocks the retry", async () => {
  const uploads = new ChatUploadCancelRegistry();
  uploads.begin("c3");
  uploads.start("c3", task());
  uploads.settle("c3", true); // the object is in storage; the message insert is next
  assert((await uploads.cancel("c3")) === "finished", "nothing left to cancel");
  uploads.begin("c3"); // the retry
  assert(!uploads.takeCancelledBeforeStart("c3"), "the retry is not refused as cancelled");
});

Deno.test("#4114 rework: a failed upload's retry can still be cancelled", async () => {
  const uploads = new ChatUploadCancelRegistry();
  uploads.begin("c4");
  uploads.start("c4", task());
  uploads.settle("c4", false); // network failure
  assert((await uploads.cancel("c4")) === "pending", "a cancel before the retry starts is recorded");
  uploads.begin("c4");
  assert(uploads.takeCancelledBeforeStart("c4"), "the retry honours it");
});
