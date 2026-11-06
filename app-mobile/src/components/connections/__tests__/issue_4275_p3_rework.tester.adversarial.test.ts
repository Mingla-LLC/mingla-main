// Issue #4275 tester adversarial, P3 rework round — the refresh awaiter and the
// sender-name merge rule, against the real @tanstack/query-core at the lockfile
// version with the query function wired exactly as useChatList wires it.
//
// FAILS-ON-REVERT, each proven at the tester commit recorded on #4275:
//   - refreshUntilFirstFailure back to awaiting the refetch: AW-2 fails (the awaiter
//     outlives the first failed attempt).
//   - waiters not keyed by user: AW-3 fails (one account's failure wakes another's).
//   - failureCount rule removed from chatListViewState: AW-5 fails.
//   - senderName line removed from overlay in mergeMessages: MG-1 and MG-2 fail.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ChatListTimeoutError,
  chatListViewState,
  noteChatListAttemptFailed,
  refreshUntilFirstFailure,
  shouldRetryChatList,
} from "../chatListLoad.ts";
import { UNKNOWN_SENDER_NAME, mergeMessages } from "../../../utils/mergeMessages.ts";

const lock = JSON.parse(
  Deno.readTextFileSync(new URL("../../../../package-lock.json", import.meta.url)),
) as { packages: Record<string, { version: string }> };
const rqVersion = lock.packages["node_modules/@tanstack/query-core"].version;
const { QueryClient, QueryObserver } = await import(`npm:@tanstack/query-core@${rqVersion}`);

type ListData = { conversations: Array<{ id: string }>; teamBrandIds: null };
const empty: ListData = { conversations: [], teamBrandIds: null };
const rows: ListData = { conversations: [{ id: "c1" }], teamBrandIds: null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Each attempt is a deferred the test settles, so the order of events is exact.
function rig(user: string, cached: ListData) {
  const client = new QueryClient();
  const key = ["chat-list", user];
  client.setQueryData(key, cached);
  const attempts: Array<ReturnType<typeof deferred<ListData>>> = [];
  const views: Array<ReturnType<typeof chatListViewState>> = [];
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: async () => {
      const attempt = deferred<ListData>();
      attempts.push(attempt);
      try {
        return await attempt.promise;
      } catch (error) {
        noteChatListAttemptFailed(user);
        throw error;
      }
    },
    retry: (count: number, error: unknown) => {
      const n = (client.getQueryData(key) as ListData | undefined)?.conversations.length ?? 0;
      return shouldRetryChatList(count, error, n > 0, false);
    },
    retryDelay: () => 5,
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe((result: Parameters<typeof chatListViewState>[0]) => {
    views.push(chatListViewState(result));
  });
  const refresh = () => refreshUntilFirstFailure(user, () => client.refetchQueries({ queryKey: key, exact: true }));
  return { client, key, attempts, views, unsubscribe, refresh, observer };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 2));
const until = async (test: () => boolean) => {
  for (let i = 0; i < 500 && !test(); i += 1) await tick();
  assert(test(), "condition never held");
};
function track<T>(promise: Promise<T>) {
  const state = { settled: false };
  promise.then(() => (state.settled = true), () => (state.settled = true));
  return state;
}

Deno.test({ name: "AW-1 pinned known limit: a late failure from a cancelled attempt settles every waiting refresh while the live attempt still runs", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const r = rig("u-aw1", empty);
  const first = track(r.refresh());
  await until(() => r.attempts.length === 1);
  const second = track(r.refresh()); // cancels attempt 1 (React Query's default) and starts attempt 2
  await until(() => r.attempts.length === 2);
  await tick();
  assertEquals(first.settled || second.settled, false, "both wait while attempt 2 runs");
  r.attempts[0].reject(new ChatListTimeoutError()); // the abandoned attempt fails late
  await until(() => first.settled && second.settled);
  // Attempt 2 is still running: the spinner stopped early, the fetch carries on.
  r.attempts[1].resolve(rows);
  await until(() => (r.client.getQueryData(r.key) as ListData).conversations.length === 1);
  r.unsubscribe();
} });

Deno.test({ name: "AW-2 two refreshes awaited at once both settle at the first failed attempt, and later failures wake nobody", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const r = rig("u-aw2", empty);
  const fetchPromise = r.client.refetchQueries({ queryKey: r.key, exact: true });
  await until(() => r.attempts.length === 1);
  const a = track(refreshUntilFirstFailure("u-aw2", () => fetchPromise));
  const b = track(refreshUntilFirstFailure("u-aw2", () => fetchPromise));
  r.attempts[0].reject(new Error("HTTP 500"));
  await until(() => a.settled && b.settled);
  await until(() => r.attempts.length === 2);
  noteChatListAttemptFailed("u-aw2"); // nothing left registered: a no-op
  r.attempts[1].resolve(rows);
  await fetchPromise;
  r.unsubscribe();
} });

Deno.test({ name: "AW-3 one account's failed attempt never settles another account's refresh", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const a = rig("u-aw3-a", empty);
  const b = rig("u-aw3-b", empty);
  const waitingA = track(a.refresh());
  const waitingB = track(b.refresh());
  await until(() => a.attempts.length === 1 && b.attempts.length === 1);
  b.attempts[0].reject(new Error("HTTP 500"));
  await until(() => waitingB.settled);
  await tick();
  assertEquals(waitingA.settled, false);
  a.attempts[0].resolve(rows);
  await until(() => waitingA.settled);
  a.unsubscribe();
  b.unsubscribe();
  b.client.clear();
} });

Deno.test({ name: "AW-4 sign-out: clearing the cache mid-refresh settles the awaiter, so no spinner is left waiting", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const r = rig("u-aw4", empty);
  const waiting = track(r.refresh());
  await until(() => r.attempts.length === 1);
  r.unsubscribe();
  r.client.clear();
  await until(() => waiting.settled);
  r.attempts[0].reject(new Error("late")); // the orphaned attempt fails afterwards: harmless
  await tick();
} });

Deno.test({ name: "AW-5 cached empty: error row after the first failure; tapping Try again shows no chats again until that attempt fails (pinned)", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const r = rig("u-aw5", empty);
  const first = track(r.refresh());
  await until(() => r.attempts.length === 1);
  r.attempts[0].reject(new Error("HTTP 500"));
  await until(() => first.settled);
  await until(() => chatListViewState(r.observer.getCurrentResult()).failed);
  // Tap "Try again": React Query resets failureCount when the new fetch starts.
  const before = r.attempts.length;
  const tap = track(r.refresh());
  await until(() => r.attempts.length > before);
  const during = chatListViewState(r.observer.getCurrentResult());
  assertEquals(during, { conversations: [], loaded: true, loading: false, failed: false }, "no chats shows while the retry's first attempt runs");
  r.attempts.at(-1)!.resolve(empty);
  await until(() => tap.settled);
  await until(() => !r.observer.getCurrentResult().isFetching);
  assertEquals(chatListViewState(r.observer.getCurrentResult()), { conversations: [], loaded: true, loading: false, failed: false }, "a healthy empty list still says no chats");
  r.unsubscribe();
} });

Deno.test({ name: "AW-6 rows on screen: a failing refresh never raises the error row while it retries, and never hides the rows", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const r = rig("u-aw6", rows);
  const waiting = track(r.refresh());
  await until(() => r.attempts.length === 1);
  r.attempts[0].reject(new ChatListTimeoutError());
  await until(() => waiting.settled);
  await tick();
  assert(r.views.every((v) => v.conversations?.length === 1), "rows stay on screen");
  assert(r.views.every((v) => !v.failed), "a timeout over rows stays silent");
  r.unsubscribe();
  r.client.clear();
} });

// ── The merge rule ───────────────────────────────────────────────────────

type Row = { id: string; clientId?: string; timestamp: string; senderName?: string; content?: string };
const msg = (over: Partial<Row>): Row => ({ id: "m1", timestamp: "2026-01-01T00:00:00Z", senderName: "Known", content: "hi", ...over });

Deno.test("MG-1 a failed read never blanks a known name, in any spelling of nothing", () => {
  for (const failed of [UNKNOWN_SENDER_NAME, "", " ", "\t", undefined]) {
    assertEquals(mergeMessages([msg({})], [msg({ senderName: failed, content: "edited" })])[0].senderName, "Known", JSON.stringify(failed));
  }
});

Deno.test("MG-2 the same rule holds when an optimistic copy and a stored copy fold together", () => {
  const optimistic = msg({ id: "temp-1", clientId: "c-1", senderName: "Known" });
  const stored = msg({ id: "m1", senderName: "Known" });
  const merged = mergeMessages([optimistic, stored], [msg({ id: "m1", clientId: "c-1", senderName: UNKNOWN_SENDER_NAME })]);
  assertEquals(merged.length, 1);
  assertEquals(merged[0].senderName, "Known");
});

Deno.test("MG-3 a real rename always lands, including to a name that merely contains Unknown", () => {
  assertEquals(mergeMessages([msg({})], [msg({ senderName: "Renamed" })])[0].senderName, "Renamed");
  assertEquals(mergeMessages([msg({})], [msg({ senderName: "Unknown Pleasures" })])[0].senderName, "Unknown Pleasures");
  assertEquals(mergeMessages([msg({ senderName: "" })], [msg({ senderName: "Real" })])[0].senderName, "Real");
});

Deno.test("MG-4 pinned trade-off: a sender whose account is gone (no profile row, a real Unknown) keeps the last stored name", () => {
  // getSenderName answers PGRST116 with "Unknown" and caches it as true. The merge cannot
  // tell that from a failed read, so a stored name wins. Pinned so a change is seen.
  assertEquals(mergeMessages([msg({ senderName: "Former Name" })], [msg({ senderName: UNKNOWN_SENDER_NAME })])[0].senderName, "Former Name");
});
