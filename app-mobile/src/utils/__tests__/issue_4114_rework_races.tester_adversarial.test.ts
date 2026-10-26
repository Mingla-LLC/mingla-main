// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
// Issue #4114 rework retest — tester adversarial suite for the two race fixes.
//
// SignedUrlCache (sign-out while a sign is running), angles the implementor's
// suites do not take:
//   * a sign for the NEW account that starts while the OLD account's sign is
//     still running is its own call, never the old promise;
//   * the old sign settling late (resolve or reject) never evicts or
//     overwrites the new account's in-flight or cached link.
//
// mergeMessages (the edge-instant rule for an incomplete page):
//   * a row deleted on the server that sits exactly on an incomplete page's
//     oldest instant is kept (the documented trade-off), but the next page
//     whose window moves past it, or any complete snapshot, removes it — the
//     ghost never outlives the boundary;
//   * a row strictly inside an incomplete page's window that the page lacks
//     is still removed (the rule did not weaken deletes in general).
//
// FAILS-ON-REVERT: make the `.finally` in SignedUrlCache.get delete the path
// unconditionally, or drop the generation check, and the sign-out cases fail;
// make the incomplete-page lower bound `time < oldest` and the edge case fails;
// skip the window check for incomplete pages entirely and the inside-window
// case fails.

import { SignedUrlCache } from "../chatMedia.ts";
import { mergeMessages } from "../mergeMessages.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${e}`);
}

const PATH = "0b8b8f0e-3a5c-4b52-9a0b-6a3a1d2c9e11/7d3c2f2a-1b4e-4c9a-8f6b-2e1d0c9b8a77.jpg";

type Deferred = { resolve: (url: string) => void; reject: (error: Error) => void };

function controlledCache() {
  const calls: Deferred[] = [];
  const cache = new SignedUrlCache(
    () => new Promise<string>((resolve, reject) => { calls.push({ resolve, reject }); }),
    () => 0,
    3600,
  );
  return { cache, calls };
}

Deno.test("#4114 retest: after clear(), the new account's sign is its own call and wins over a late old sign", async () => {
  const { cache, calls } = controlledCache();
  const oldPending = cache.get(PATH).catch((error: Error) => error.message);
  cache.clear();
  const newPending = cache.get(PATH);
  assertEquals(calls.length, 2, "the new account starts its own sign, not the old promise");
  const third = cache.get(PATH);
  assertEquals(calls.length, 2, "a second new-account read shares the new in-flight sign");
  // The old account's sign lands late, after the new one started.
  calls[0].resolve("old-account-link");
  assertEquals(await oldPending, "signed_url_cache_cleared", "the old sign is refused");
  assertEquals(cache.peek(PATH), null, "the old link never lands in the cache");
  calls[1].resolve("new-account-link");
  assertEquals(await newPending, "new-account-link", "the new sign resolves");
  assertEquals(await third, "new-account-link", "the shared read resolves to the same link");
  assertEquals(cache.peek(PATH), "new-account-link", "the new link is cached");
});

Deno.test("#4114 retest: an old sign that FAILS after clear() never evicts the new account's in-flight sign", async () => {
  const { cache, calls } = controlledCache();
  const oldPending = cache.get(PATH).catch(() => "old-failed");
  cache.clear();
  const newPending = cache.get(PATH);
  calls[0].reject(new Error("network"));
  assertEquals(await oldPending, "old-failed", "old sign fails");
  // Still one in-flight sign for the new account: a read now must share it.
  const again = cache.get(PATH);
  assertEquals(calls.length, 2, "the old failure did not drop the new in-flight entry");
  calls[1].resolve("new-account-link");
  assertEquals(await newPending, "new-account-link", "new sign resolves");
  assertEquals(await again, "new-account-link", "shared read resolves");
});

Deno.test("#4114 retest: clear() twice while signing still drops the first account's link", async () => {
  const { cache, calls } = controlledCache();
  const first = cache.get(PATH).catch((error: Error) => error.message);
  cache.clear();
  cache.clear();
  calls[0].resolve("first-account-link");
  assertEquals(await first, "signed_url_cache_cleared", "refused after two clears");
  assertEquals(cache.peek(PATH), null, "nothing cached");
});

// ── mergeMessages: the edge-instant rule ─────────────────────────────────────

type Msg = { id: string; clientId?: string; timestamp: string; content: string };
const T0 = Date.parse("2026-10-26T09:00:00.000Z");
const row = (id: string, ms: number): Msg => ({ id, timestamp: new Date(T0 + ms).toISOString(), content: id });
const ids = (list: Msg[]) => list.map((m) => m.id);

Deno.test("#4114 retest: a server delete at the edge instant is kept only while it sits on the edge", () => {
  // x and y share the oldest instant; x is deleted on the server.
  let list = mergeMessages<Msg>([], [row("x", 0), row("y", 0), row("z", 10)]);
  // Incomplete page whose oldest instant is that tie: x may simply be cut off.
  list = mergeMessages(list, [row("y", 0), row("z", 10)], { snapshot: { complete: false } });
  assert(ids(list).includes("x"), "x on the edge is not judged missing (documented trade-off)");
  // A later incomplete page reaches further back (an older row w): x is now
  // strictly inside the window and absent, so it goes.
  const pageBack = mergeMessages(list, [row("w", -5), row("y", 0), row("z", 10)], { snapshot: { complete: false } });
  assert(!ids(pageBack).includes("x"), "once the window moves past the edge, the deleted row is removed");
  // A complete snapshot without x also removes it.
  const complete = mergeMessages(list, [row("y", 0), row("z", 10)], { snapshot: { complete: true } });
  assert(!ids(complete).includes("x"), "a complete snapshot removes the deleted edge row");
});

Deno.test("#4114 retest: a row strictly inside an incomplete page's window that the page lacks is removed", () => {
  let list = mergeMessages<Msg>([], [row("a", 0), row("b", 5), row("c", 10)]);
  list = mergeMessages(list, [row("a", 0), row("c", 10)], { snapshot: { complete: false } });
  assertEquals(ids(list), ["a", "c"], "b was deleted on the server and is inside the window");
});
