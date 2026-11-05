// Issue #4275 tester adversarial — the curated gate, the chat list's first load and
// the persisted error fix, against the REAL @tanstack/query-core at the lockfile
// version rather than hand-written state objects.
//
// FAILS-ON-REVERT, each proven at the tester commit recorded on #4275:
//   - `inFlight.delete(key)` removed from the gate: AX-G2 fails (a failure sticks).
//   - slot released on success only: AX-G3 fails (a rejected call wedges the Home
//     feed).
//   - `failed` back to ignoring a timeout with no list: AX-L1 fails.
//   - retry count raised or made unbounded: AX-L2 fails.
//   - `status === "error"` branch removed from serializePersistedQuery: AX-P1 fails.
//   - error-without-data rule removed from shouldDehydrateMinglaQuery: AX-P2 fails.

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CURATED_MAX_CONCURRENT, createCuratedRequestGate } from "../curatedRequestGate.ts";
import {
  CHAT_LIST_FIRST_LOAD_RETRIES,
  CHAT_LIST_FIRST_LOAD_TIMEOUT_MS,
  ChatListTimeoutError,
  chatListRetryDelayMs,
  chatListViewState,
  shouldRetryChatList,
} from "../../components/connections/chatListLoad.ts";
import { shouldDehydrateMinglaQuery } from "../../utils/queryPersistence.ts";
import { serializePersistedQuery } from "../../utils/queryPersistenceBudget.ts";

const lock = JSON.parse(
  Deno.readTextFileSync(new URL("../../../package-lock.json", import.meta.url)),
) as { packages: Record<string, { version: string }> };
const rqVersion = lock.packages["node_modules/@tanstack/query-core"].version;
const { QueryClient, QueryObserver, dehydrate, hydrate, onlineManager } = await import(`npm:@tanstack/query-core@${rqVersion}`);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const tick = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

// ── The gate ─────────────────────────────────────────────────────────────

Deno.test("AX-G1 six intents plus a map call: never more than the cap, first in first out", async () => {
  const gate = createCuratedRequestGate<number>();
  const held = Array.from({ length: 8 }, () => deferred<number>());
  const started: number[] = [];
  let running = 0;
  let peak = 0;
  const results = held.map((slot, index) =>
    gate.run(`k${index}`, () => {
      started.push(index);
      running += 1;
      peak = Math.max(peak, running);
      return slot.promise.finally(() => {
        running -= 1;
      });
    })
  );
  await tick();
  assertEquals(started, [0, 1, 2]);
  held[1].resolve(1);
  await tick();
  assertEquals(started, [0, 1, 2, 3]);
  held[0].reject(new Error("no"));
  held[2].resolve(2);
  await tick();
  assertEquals(started, [0, 1, 2, 3, 4, 5]);
  for (const slot of held) slot.resolve(0);
  await tick();
  await Promise.allSettled(results);
  assertEquals(peak, CURATED_MAX_CONCURRENT);
  assertEquals(started, [0, 1, 2, 3, 4, 5, 6, 7]);
});

Deno.test("AX-G2 identical requests share a failure, and the next identical request gets a fresh call", async () => {
  const gate = createCuratedRequestGate<string>();
  let calls = 0;
  const failing = deferred<string>();
  const one = gate.run("same", () => {
    calls += 1;
    return failing.promise;
  });
  const two = gate.run("same", () => {
    calls += 1;
    return Promise.resolve("never");
  });
  failing.reject(new Error("overload"));
  await assertRejects(() => one, Error, "overload");
  await assertRejects(() => two, Error, "overload");
  assertEquals(calls, 1);
  await tick();
  assertEquals(await gate.run("same", () => {
    calls += 1;
    return Promise.resolve("fresh");
  }), "fresh");
  assertEquals(calls, 2);
});

Deno.test("AX-G3 a burst of rejected and throwing calls frees every slot", async () => {
  const gate = createCuratedRequestGate<number>();
  const outcomes = await Promise.allSettled(
    Array.from({ length: 12 }, (_, index) =>
      gate.run(`k${index}`, () => {
        if (index % 2) throw new Error("sync");
        return Promise.reject(new Error("async"));
      })),
  );
  assert(outcomes.every((outcome) => outcome.status === "rejected"));
  assertEquals(await gate.run("after", () => Promise.resolve(7)), 7);
});

// ── The first load, through a real query observer ────────────────────────

type ListData = { conversations: unknown[]; teamBrandIds: null };

function observe(queryFn: () => Promise<ListData>, client = new QueryClient()) {
  const seen: Array<ReturnType<typeof chatListViewState>> = [];
  const observer = new QueryObserver(client, {
    queryKey: ["chat-list", "u"],
    queryFn,
    // hasCachedList is what useChatList computes; retries are real, delays are not.
    retry: (count: number, error: unknown) =>
      shouldRetryChatList(count, error, client.getQueryData(["chat-list", "u"]) !== undefined, false),
    retryDelay: () => 1,
  });
  const unsubscribe = observer.subscribe((result: Parameters<typeof chatListViewState>[0]) => {
    seen.push(chatListViewState(result));
  });
  return { observer, seen, unsubscribe, client };
}
const until = async (test: () => boolean) => {
  for (let i = 0; i < 400 && !test(); i += 1) await new Promise((resolve) => setTimeout(resolve, 2));
  assert(test(), "condition never held");
};

for (const [label, error] of [
  ["timeout", new ChatListTimeoutError()],
  ["500", new Error("500 internal")],
] as const) {
  Deno.test(`AX-L1 ${label} on every attempt with no list: only loading, then failed, never the empty state`, async () => {
    let attempts = 0;
    const rig = observe(() => {
      attempts += 1;
      return Promise.reject(error);
    });
    await until(() => rig.seen.some((view) => view.failed));
    rig.unsubscribe();
    assertEquals(attempts, CHAT_LIST_FIRST_LOAD_RETRIES + 1);
    for (const view of rig.seen) {
      assertEquals(view.loaded, false, "no state may claim a list exists");
      assertEquals(view.conversations, null, "no state offers rows to render as none");
      assert(view.loading || view.failed, "always skeleton or error row");
    }
    assertEquals(rig.seen.at(-1)?.failed, true);
  });
}

Deno.test("AX-L1 offline with no list stays loading (paused), and comes back by itself", async () => {
  onlineManager.setOnline(false);
  try {
    let attempts = 0;
    // mount() is what the provider does in the app: it wires online and focus events.
    const client = new QueryClient();
    client.mount();
    const rig = observe(() => {
      attempts += 1;
      return Promise.resolve({ conversations: [], teamBrandIds: null });
    }, client);
    await tick();
    const paused = chatListViewState(rig.observer.getCurrentResult());
    assertEquals(paused, { conversations: null, loaded: false, loading: true, failed: false });
    assertEquals(attempts, 0);
    onlineManager.setOnline(true);
    await until(() => rig.seen.some((view) => view.loaded));
    rig.unsubscribe();
    client.unmount();
    assertEquals(attempts, 1);
  } finally {
    onlineManager.setOnline(true);
  }
});

Deno.test("AX-L2 the worst first load is bounded: five attempts, under two and a half minutes", () => {
  let attempts = 1;
  while (shouldRetryChatList(attempts - 1, new ChatListTimeoutError(), false, false)) {
    attempts += 1;
    assert(attempts < 50, "retry must be bounded");
  }
  assertEquals(attempts, 5);
  const waits = [0, 1, 2, 3].reduce((sum, attempt) => sum + chatListRetryDelayMs(attempt, () => 1), 0);
  const worst = attempts * CHAT_LIST_FIRST_LOAD_TIMEOUT_MS + waits;
  assert(worst <= 150_000, `worst case ${worst} ms`);
  assertEquals(shouldRetryChatList(0, new Error("401"), false, true), false, "an auth failure never retries");
});

Deno.test("AX-L3 a real empty answer is the only way to the empty state", async () => {
  const rig = observe(() => Promise.resolve({ conversations: [], teamBrandIds: null }));
  await until(() => rig.seen.some((view) => view.loaded));
  rig.unsubscribe();
  assertEquals(rig.seen.at(-1), { conversations: [], loaded: true, loading: false, failed: false });
});

Deno.test("AX-L4 a cached empty list: a refresh that keeps failing holds its awaiter through every retry, and reads as empty meanwhile", async () => {
  // Pinned because the page awaits this in pull-to-refresh and in accepting an invite,
  // so with an empty list their spinners wait for all 5 attempts (about 130 s at worst).
  const client = new QueryClient();
  const key = ["chat-list", "u"];
  client.setQueryData(key, { conversations: [], teamBrandIds: null });
  let attempts = 0;
  const views: Array<ReturnType<typeof chatListViewState>> = [];
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: () => {
      attempts += 1;
      return Promise.reject(new ChatListTimeoutError());
    },
    retry: (count: number, error: unknown) => {
      const rows = (client.getQueryData(key) as { conversations: unknown[] } | undefined)?.conversations.length ?? 0;
      return shouldRetryChatList(count, error, rows > 0, false);
    },
    retryDelay: () => 1,
    enabled: false,
  });
  const unsubscribe = observer.subscribe((result: Parameters<typeof chatListViewState>[0]) => {
    views.push(chatListViewState(result));
  });
  await client.refetchQueries({ queryKey: key });
  unsubscribe();
  assertEquals(attempts, CHAT_LIST_FIRST_LOAD_RETRIES + 1, "the awaited promise settled only after every attempt");
  assert(views.some((view) => view.loaded && !view.failed && view.conversations?.length === 0), "empty state showing during retries");
  assertEquals(views.at(-1)?.failed, true, "and the error row once settled");
});

// ── Persistence, through real dehydrate and hydrate ──────────────────────

function roundTrip(client: InstanceType<typeof QueryClient>) {
  const state = dehydrate(client, {
    shouldDehydrateQuery: (query: Parameters<typeof shouldDehydrateMinglaQuery>[0]) => shouldDehydrateMinglaQuery(query, "user-1"),
  });
  const queries = state.queries.map((query: Parameters<typeof serializePersistedQuery>[0]) => JSON.parse(serializePersistedQuery(query)));
  const restored = new QueryClient();
  hydrate(restored, { mutations: [], queries });
  return { restored, count: queries.length };
}

Deno.test("AX-P1 good data whose last refresh failed restores as success with no fake error", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ["user-circle", "user-1"];
  await client.fetchQuery({ queryKey: key, queryFn: () => Promise.resolve({ people: [1, 2] }) });
  const before = client.getQueryState(key);
  await client.fetchQuery({ queryKey: key, queryFn: () => Promise.reject(new Error("offline")), staleTime: 0 }).catch(() => {});
  assertEquals(client.getQueryState(key)?.status, "error", "the setup must really have failed");
  const { restored, count } = roundTrip(client);
  assertEquals(count, 1);
  const state = restored.getQueryState(key);
  assertEquals(state?.status, "success");
  assertEquals(state?.error, null, "no restored `{}` for anyone to report");
  assertEquals(state?.fetchFailureReason, null);
  assertEquals(state?.data, { people: [1, 2] });
  assertEquals(state?.dataUpdatedAt, before?.dataUpdatedAt, "still reads as stale as it really is");
});

Deno.test("AX-P2 a failed query with no data is not persisted at all", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await client.fetchQuery({ queryKey: ["user-circle", "user-1"], queryFn: () => Promise.reject(new Error("offline")) }).catch(() => {});
  assertEquals(roundTrip(client).count, 0);
});
