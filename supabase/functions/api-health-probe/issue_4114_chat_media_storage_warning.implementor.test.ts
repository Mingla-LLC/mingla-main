// Issue #4114 Wave 7 — the chat media storage early warning alerts once per
// threshold.
//
// A fake "database" keeps the alert ledger exactly like
// issue_4114_chat_media_storage_due / _mark_alerted (the pg17 suite proves the
// SQL side), and the real runChatMediaStorageCheck drives it day after day:
//   * under 5 GB nothing is sent;
//   * passing 5 GB sends ONE email, and the next day sends nothing;
//   * passing 10 and 20 GB on the same day sends one email naming both;
//   * a send that reached nobody is not recorded, so the next day retries;
//   * a read or record failure is reported as an error, never as quiet.
//
// FAILS-ON-REVERT: delete the markAlerted call and the "next day" assertions
// fail (the same threshold alerts again); delete the `succeeded <= 0` guard and
// the retry test fails.
// MINGLA-INVARIANT: I-4114-CHAT-MEDIA-STORAGE-WARNING | issue #4114 | Each chat media storage threshold (5, 10, 20 GB) sends one ops alert, recorded only after a recipient accepted it.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { chatMediaStorageAlertCopy, type ChatMediaStorageDeps, runChatMediaStorageCheck } from "./chatMediaStorage.ts";

const GIB = 1024 * 1024 * 1024;

function world(initialGb: number) {
  const state = { bytes: initialGb * GIB, alerted: new Set<number>(), sent: [] as string[], deliver: true };
  const deps: ChatMediaStorageDeps = {
    due: async (thresholds) => ({
      data: {
        total_bytes: state.bytes,
        due_thresholds_gb: thresholds.filter((gb) => state.bytes >= gb * GIB && !state.alerted.has(gb)),
      },
      error: null,
    }),
    send: async (alert) => {
      if (!state.deliver) return { succeeded: 0 };
      state.sent.push(alert.subject);
      return { succeeded: 1 };
    },
    markAlerted: async (thresholds) => {
      thresholds.forEach((gb) => state.alerted.add(gb));
      return { error: null };
    },
  };
  return { state, deps };
}

Deno.test("#4114 W7: each storage threshold alerts once", async () => {
  const { state, deps } = world(3);
  assertEquals((await runChatMediaStorageCheck(deps)).status, "quiet");
  assertEquals(state.sent.length, 0);

  state.bytes = 6 * GIB;
  const first = await runChatMediaStorageCheck(deps);
  assertEquals(first.status, "alerted");
  assertEquals(state.sent, ["[STORAGE] Chat photos and videos passed 5 GB"]);

  // The next day, still above 5 GB: nothing new.
  assertEquals((await runChatMediaStorageCheck(deps)).status, "quiet");
  assertEquals(state.sent.length, 1);

  // A jump past 10 and 20 GB in one day: one email naming both.
  state.bytes = 21 * GIB;
  const jump = await runChatMediaStorageCheck(deps);
  assertEquals(jump.status === "alerted" ? jump.thresholdsGb : null, [10, 20]);
  assertEquals(state.sent.length, 2);
  assertEquals(state.sent[1], "[STORAGE] Chat photos and videos passed 20 GB");
  assertEquals((await runChatMediaStorageCheck(deps)).status, "quiet");
  assertEquals(state.sent.length, 2);
});

Deno.test("#4114 W7: an alert nobody received is retried the next day", async () => {
  const { state, deps } = world(6);
  state.deliver = false;
  assertEquals((await runChatMediaStorageCheck(deps)).status, "send_failed");
  assertEquals(state.alerted.size, 0);
  state.deliver = true;
  assertEquals((await runChatMediaStorageCheck(deps)).status, "alerted");
  assertEquals(state.sent.length, 1);
});

Deno.test("#4114 W7: read and record failures are errors, never quiet", async () => {
  const readFail: ChatMediaStorageDeps = {
    due: async () => ({ data: null, error: "permission denied" }),
    send: async () => ({ succeeded: 1 }),
    markAlerted: async () => ({ error: null }),
  };
  assertEquals((await runChatMediaStorageCheck(readFail)).status, "error");
  const { deps } = world(6);
  const recordFail: ChatMediaStorageDeps = { ...deps, markAlerted: async () => ({ error: "boom" }) };
  const outcome = await runChatMediaStorageCheck(recordFail);
  assertEquals(outcome.status === "error" ? outcome.stage : null, "record");
});

Deno.test("#4114 W7: the alert names the size and the guards", () => {
  const copy = chatMediaStorageAlertCopy(5.5 * GIB, [5]);
  assertEquals(copy.paragraphs[0].includes("5.5 GB"), true);
  assertEquals(copy.paragraphs[1], "Passed: 5 GB. Each threshold alerts once.");
});
