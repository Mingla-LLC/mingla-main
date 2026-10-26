// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 1 — tester adversarial suite for the one message merge.
//
// The implementor suite covers the happy paths (echo before/after the insert
// response, a refresh keeping a pending send). This suite attacks other angles:
//   * two rapid sends with IDENTICAL text stay two messages, whatever order the
//     echoes and responses land in (the old sender+text+5 s guess merged them);
//   * a retry whose first attempt already landed (23505 path) folds into the
//     one row and clears "failed";
//   * a late "failed" can never downgrade a confirmed row, even when it arrives
//     through a refresh snapshot;
//   * a refresh never resurrects a row the server deleted, and never drops a
//     newer realtime row the snapshot predates;
//   * rows with unparseable timestamps never crash or vanish;
//   * the list never holds two rows for one server id or one client id after a
//     long random interleaving (invariant I-4114-ONE-MESSAGE-PER-CLIENT-ID).
//
// Tester finding T-W1-1 (fixed in the #4114 rework): a paged refresh whose
// oldest row shares its created_at with a loaded row the page cut off must keep
// that loaded row; the oldest instant of an incomplete snapshot is its edge,
// not inside the window.
//
// FAILS-ON-REVERT: delete the `byClientId` lookup in mergeMessages.upsert and
// the identical-text case keeps two copies of one send; make `resolve` let a
// local copy overwrite a confirmed one and the late-failure cases fail.

import { mergeMessages, oldestConfirmedTimestamp } from "../mergeMessages.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${e}`);
}

type Msg = {
  id: string;
  clientId?: string;
  timestamp: string;
  content: string;
  failed?: boolean;
};

const T0 = Date.parse("2026-10-26T09:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();
const local = (clientId: string, ms: number, content = "hey", failed = false): Msg => ({
  id: `temp-${clientId}`,
  clientId,
  timestamp: at(ms),
  content,
  ...(failed ? { failed: true } : {}),
});
const server = (id: string, clientId: string | undefined, ms: number, content = "hey"): Msg => ({
  id,
  ...(clientId ? { clientId } : {}),
  timestamp: at(ms),
  content,
});
const ids = (list: Msg[]) => list.map((m) => m.id);

function assertNoDuplicates(list: Msg[], label: string): void {
  const seenIds = new Set<string>();
  const seenClient = new Set<string>();
  for (const m of list) {
    assert(!seenIds.has(m.id), `${label}: duplicate id ${m.id}`);
    seenIds.add(m.id);
    if (m.clientId) {
      assert(!seenClient.has(m.clientId), `${label}: duplicate clientId ${m.clientId}`);
      seenClient.add(m.clientId);
    }
  }
}

Deno.test("#4114 W1 adversarial: two rapid sends with identical text stay two messages in every arrival order", () => {
  const a = "aaaaaaaa-0000-4000-8000-000000000001";
  const b = "bbbbbbbb-0000-4000-8000-000000000002";
  // Both optimistic bubbles first (sent 40 ms apart, same text).
  const base = mergeMessages<Msg>([], [local(a, 0), local(b, 40)]);
  // Every interleaving of: echo(a), echo(b), response(a), response(b).
  const events = [
    server("srv-a", a, 120),
    server("srv-b", b, 125),
    server("srv-a", a, 120),
    server("srv-b", b, 125),
  ];
  const orders = [
    [0, 1, 2, 3], [1, 0, 3, 2], [3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1], [0, 3, 1, 2],
  ];
  for (const order of orders) {
    let list = base;
    for (const i of order) list = mergeMessages(list, [events[i]]);
    assertEquals(ids(list), ["srv-a", "srv-b"], `order ${order.join(",")}: one row per send, both confirmed`);
    assertNoDuplicates(list, `order ${order.join(",")}`);
  }
});

Deno.test("#4114 W1 adversarial: a retry after the server row already landed folds into one confirmed row", () => {
  const c = "cccccccc-0000-4000-8000-000000000003";
  // First attempt's response was lost; the bubble is marked failed.
  let list = mergeMessages<Msg>([], [local(c, 0, "photo", true)]);
  // Retry: the 23505 path returns the row the first attempt created.
  list = mergeMessages(list, [server("srv-c", c, 90, "photo")]);
  assertEquals(list.length, 1, "one row after the retry");
  assertEquals(list[0].id, "srv-c", "the server row won");
  assert(list[0].failed !== true, "the confirmed row is not marked failed");
  // A second retry tap that also fails locally must not bring the failed bubble back.
  list = mergeMessages(list, [local(c, 200, "photo", true)]);
  assertEquals(ids(list), ["srv-c"], "a late local failure loses to the confirmed row");
  assert(list[0].failed !== true, "still not failed");
});

Deno.test("#4114 W1 adversarial: a refresh snapshot never downgrades or duplicates a confirmed row", () => {
  const c = "dddddddd-0000-4000-8000-000000000004";
  let list = mergeMessages<Msg>([], [server("srv-d", c, 10), server("srv-e", undefined, 20, "other")]);
  // A cached copy of the same server row without its client id (old cache shape).
  list = mergeMessages(list, [server("srv-d", undefined, 10)]);
  assertNoDuplicates(list, "cached copy");
  assertEquals(list.length, 2, "the clientless cached copy folds into the row");
  // A snapshot that covers both, then a stale local failure for one of them.
  list = mergeMessages(list, [server("srv-d", c, 10), server("srv-e", undefined, 20, "other")], { snapshot: { complete: true } });
  list = mergeMessages(list, [local(c, 30, "hey", true)]);
  assertEquals(ids(list), ["srv-d", "srv-e"], "no failed bubble, no duplicate");
});

Deno.test("#4114 W1 adversarial: a complete snapshot drops server-deleted rows but keeps pending, failed and newer rows", () => {
  const pending = "eeeeeeee-0000-4000-8000-000000000005";
  const failed = "ffffffff-0000-4000-8000-000000000006";
  let list = mergeMessages<Msg>([], [
    server("srv-1", undefined, 0),
    server("srv-2", undefined, 10), // deleted on the server
    server("srv-3", undefined, 20),
    local(pending, 25),
    local(failed, 26, "x", true),
    server("srv-4", undefined, 500), // arrived by realtime after the snapshot was read
  ]);
  list = mergeMessages(list, [server("srv-1", undefined, 0), server("srv-3", undefined, 20)], { snapshot: { complete: true } });
  assert(!ids(list).includes("srv-2"), "the deleted row is gone");
  assert(ids(list).includes("temp-" + pending), "the pending send survives");
  assert(ids(list).includes("temp-" + failed), "the failed send survives (retry stays possible)");
  assert(ids(list).includes("srv-4"), "a row newer than the snapshot survives");
  assertEquals(oldestConfirmedTimestamp(list), at(0), "paging cursor is the oldest confirmed row");
});

Deno.test("#4114 W1 adversarial: an incomplete snapshot never touches older loaded pages", () => {
  let list = mergeMessages<Msg>([], [server("old-1", undefined, 0), server("old-2", undefined, 5)]);
  list = mergeMessages(list, [server("new-1", undefined, 100), server("new-2", undefined, 110)], { snapshot: { complete: false } });
  assertEquals(ids(list), ["old-1", "old-2", "new-1", "new-2"], "older history stays, order by time");
});

Deno.test("#4114 W1 adversarial: unparseable timestamps never crash, vanish or reorder valid rows", () => {
  const bad: Msg = { id: "srv-bad", timestamp: "not-a-date", content: "?" };
  let list = mergeMessages<Msg>([], [server("srv-1", undefined, 0), bad, server("srv-2", undefined, 10)]);
  list = mergeMessages(list, [server("srv-1", undefined, 0)], { snapshot: { complete: true } });
  assert(ids(list).includes("srv-bad"), "a row with a bad timestamp is never dropped by the window");
  assertEquals(ids(list).slice(0, 1), ["srv-1"], "valid rows sort first");
});

Deno.test("#4114 W1 adversarial: a long random interleaving never yields two rows for one send", () => {
  let seed = 4114;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const sends = Array.from({ length: 12 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  const pool: Msg[] = [];
  sends.forEach((c, i) => {
    pool.push(local(c, i * 3, "same text"));
    pool.push(local(c, i * 3, "same text", true));
    pool.push(server(`srv-${i}`, c, i * 3 + 50, "same text"));
    pool.push(server(`srv-${i}`, undefined, i * 3 + 50, "same text"));
  });
  for (let round = 0; round < 50; round += 1) {
    let list: Msg[] = [];
    const shuffled = [...pool].sort(() => rand() - 0.5);
    for (const m of shuffled) list = mergeMessages(list, [m]);
    assertNoDuplicates(list, `round ${round}`);
    assertEquals(list.length, sends.length, `round ${round}: exactly one row per send`);
    assert(list.every((m) => m.id.startsWith("srv-")), `round ${round}: every send ends confirmed`);
  }
});

Deno.test({
  name: "#4114 W1 adversarial [T-W1-1]: a paged refresh with a created_at tie at its oldest edge keeps the cut-off row",
  fn: () => {
    // Loaded: x and y share one instant. The newest-page read (limit reached,
    // incomplete) returns y and newer rows, and cuts x off at the tie.
    let list = mergeMessages<Msg>([], [server("x", undefined, 0), server("y", undefined, 0), server("z", undefined, 10)]);
    list = mergeMessages(list, [server("y", undefined, 0), server("z", undefined, 10)], { snapshot: { complete: false } });
    assert(ids(list).includes("x"), "x was not deleted on the server; only the page boundary cut it off");
  },
});
