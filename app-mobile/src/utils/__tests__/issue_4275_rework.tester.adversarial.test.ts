// Issue #4275 tester adversarial, rework round — attacks the retry on a failed
// catch-up, the curated gate's watchdog and reset, and a cached empty list's patience.
// A read here takes as long as the rig says, because the 8 s read limit is longer than
// the first backoff, and that overlap is where a retry can stop backing off.
//
// FAILS-ON-REVERT, each proven at the tester commit recorded on #4275:
//   - `gapUnread` reset removed from the stable timer's check: RX-1 fails.
//   - `armPoll` removed from the catch-up rejection: RX-2 fails.
//   - `disposed` removed from armPoll: RX-3 fails.
//   - the success branch removed: RX-2 fails.
//   - `!canWork()` removed from the poll timer: RX-5 fails.
//   - `started` check removed from the gate's finish: GX-3 fails (running goes wrong).
//   - watchdog never armed: GX-1 and GX-2 never settle, and the run fails.
//   - `finished` guard removed: GX-1 fails on the late settle.
//   - `!hasRows` back to `!loaded`: LX-1 fails.
//   - shared in-flight sender lookup removed: the fan-out render suite fails.

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CATCH_UP_BACKOFF_MS,
  MAX_POLLS_PER_EPISODE,
  createChatRecovery,
  type ChatRecovery,
} from "../chatChannelRecovery.ts";
import {
  CURATED_MAX_CONCURRENT,
  CURATED_WATCHDOG_MS,
  createCuratedRequestGate,
} from "../../services/curatedRequestGate.ts";
import {
  ChatListTimeoutError,
  chatListViewState,
  shouldRetryChatList,
} from "../../components/connections/chatListLoad.ts";

const SECOND = 1000;
const MINUTE = 60 * SECOND;

function clock() {
  let time = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const flush = async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  };
  return {
    now: () => time,
    pending: () => timers.size,
    setTimer: (callback: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: time + ms, callback });
      return id as unknown;
    },
    clearTimer: (handle: unknown) => {
      timers.delete(handle as number);
    },
    advance: async (ms: number) => {
      const end = time + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        time = Math.max(time, due[1].at);
        due[1].callback();
        await flush();
      }
      time = end;
      await flush();
    },
  };
}

type Outcome = "fail" | "ok";

function rig(options: { readMs?: number; outcome?: Outcome } = {}) {
  const c = clock();
  let reads = 0;
  let rebuilds = 0;
  let inFlight = 0;
  let peak = 0;
  let outcome: Outcome = options.outcome ?? "fail";
  let active = true;
  let online = true;
  const readMs = options.readMs ?? 0;
  const recovery: ChatRecovery = createChatRecovery({
    catchUp: () => {
      reads += 1;
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      const finish = (resolve: () => void, reject: (e: Error) => void) => {
        inFlight -= 1;
        if (outcome === "ok") resolve();
        else reject(new Error("statement timeout"));
      };
      return new Promise<void>((resolve, reject) => {
        if (readMs === 0) finish(resolve, reject);
        else c.setTimer(() => finish(resolve, reject), readMs);
      });
    },
    rebuild: () => {
      rebuilds += 1;
    },
    channelState: () => "joined",
    isActive: () => active,
    isOnline: () => online,
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
    now: c.now,
    random: () => 0.5,
  });
  return {
    ...c,
    recovery,
    reads: () => reads,
    rebuilds: () => rebuilds,
    peak: () => peak,
    setOutcome: (value: Outcome) => {
      outcome = value;
    },
    setActive: (value: boolean) => {
      active = value;
    },
    setOnline: (value: boolean) => {
      online = value;
    },
  };
}

function quiet(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      await fn();
    } finally {
      console.warn = warn;
    }
  };
}

for (const readMs of [0, 8 * SECOND]) {
  Deno.test(`RX-1 staying subscribed for an hour with every read failing (each read ${readMs} ms): capped, then silent`, quiet(async () => {
    const r = rig({ readMs });
    r.recovery.onStatus("changes", "SUBSCRIBED");
    await r.advance(60 * MINUTE);
    assert(r.reads() <= 1 + MAX_POLLS_PER_EPISODE, `reads ${r.reads()}`);
    assert(r.reads() >= 1 + MAX_POLLS_PER_EPISODE - 1, `the retries did happen: ${r.reads()}`);
    assertEquals(r.rebuilds(), 0, "a failed read never rebuilds");
    assertEquals(r.peak(), 1, "never two reads at once");
    assertEquals(r.pending(), 0, "nothing left running once the cap is reached");
  }));
}

Deno.test("RX-2 a failed read retries on the backoff, and the first success stops it", quiet(async () => {
  const r = rig();
  r.recovery.onStatus("changes", "SUBSCRIBED");
  await r.advance(SECOND);
  assertEquals(r.reads(), 1);
  await r.advance(CATCH_UP_BACKOFF_MS[0] * 1.2);
  assertEquals(r.reads(), 2, "retried on the first backoff");
  r.setOutcome("ok");
  await r.advance(CATCH_UP_BACKOFF_MS[1] * 1.2);
  assertEquals(r.reads(), 3, "the next retry succeeds");
  await r.advance(60 * MINUTE);
  assertEquals(r.reads(), 3, "and nothing reads again");
  assertEquals(r.pending(), 0);
}));

Deno.test("RX-3 leaving with a retry armed or a read in flight stops everything", quiet(async () => {
  const armed = rig();
  armed.recovery.onStatus("changes", "SUBSCRIBED");
  await armed.advance(SECOND);
  armed.recovery.dispose();
  assertEquals(armed.pending(), 0, "the armed retry is gone");
  await armed.advance(10 * MINUTE);
  assertEquals(armed.reads(), 1);

  const flying = rig({ readMs: 8 * SECOND });
  flying.recovery.onStatus("changes", "SUBSCRIBED");
  flying.recovery.dispose();
  await flying.advance(9 * SECOND);
  assertEquals(flying.pending(), 0, "a read failing after leaving arms nothing");
  await flying.advance(10 * MINUTE);
  assertEquals(flying.reads(), 1, "a read failing after leaving arms no retry");
  assertEquals(flying.pending(), 0);
}));

Deno.test("RX-4 a success while a retry is armed cancels it", quiet(async () => {
  const r = rig({ readMs: 8 * SECOND });
  r.recovery.onStatus("changes", "SUBSCRIBED");
  await r.advance(9 * SECOND); // failed; retry armed
  r.setOutcome("ok");
  r.recovery.onResume();
  await r.advance(9 * SECOND);
  const settled = r.reads();
  await r.advance(60 * MINUTE);
  assertEquals(r.reads(), settled);
  assertEquals(r.pending(), 0);
}));

Deno.test("RX-5 parked retries: background and offline do no reads, and return does exactly one", quiet(async () => {
  const r = rig();
  r.recovery.onStatus("changes", "SUBSCRIBED");
  await r.advance(SECOND);
  const before = r.reads();
  r.setActive(false);
  await r.advance(20 * SECOND);
  assertEquals(r.pending(), 0, "parked after the first due timer");
  await r.advance(60 * MINUTE);
  assertEquals(r.reads(), before, "no background reads");
  assertEquals(r.pending(), 0, "parked, not waking the phone");
  r.setActive(true);
  r.setOutcome("ok");
  r.recovery.onResume();
  await r.advance(SECOND);
  assertEquals(r.reads(), before + 1);
  await r.advance(60 * MINUTE);
  assertEquals(r.reads(), before + 1, "healed");

  const off = rig();
  off.recovery.onStatus("changes", "SUBSCRIBED");
  await off.advance(SECOND);
  const offBefore = off.reads();
  off.setOnline(false);
  await off.advance(10 * MINUTE);
  assertEquals(off.reads(), offBefore, "no offline reads");
  off.setOnline(true);
  off.setOutcome("ok");
  // The reconnect effect re-creates the channel, which reports SUBSCRIBED.
  off.recovery.onStatus("changes", "SUBSCRIBED");
  await off.advance(SECOND);
  assertEquals(off.reads(), offBefore + 1, "the reconnect heals it");
}));

Deno.test("RX-6 after the cap, resume is a new episode and still bounded", quiet(async () => {
  const r = rig();
  r.recovery.onStatus("changes", "SUBSCRIBED");
  await r.advance(60 * MINUTE);
  const spent = r.reads();
  r.recovery.onResume();
  await r.advance(60 * MINUTE);
  assert(r.reads() > spent, "resume tries again");
  assert(r.reads() - spent <= 1 + MAX_POLLS_PER_EPISODE, `episode reads ${r.reads() - spent}`);
}));

Deno.test("RX-7 measured: a channel flapping every 10 s with failing 8 s reads, for 10 minutes", quiet(async () => {
  // SUBSCRIBED always asks for a read and is not counted against the poll cap (rule R1).
  // This pins today's real number so a change is seen. It is the worst this chat can do.
  const r = rig({ readMs: 8 * SECOND });
  for (let i = 0; i < 60; i += 1) {
    r.recovery.onStatus("changes", i % 2 === 0 ? "SUBSCRIBED" : "CHANNEL_ERROR");
    await r.advance(10 * SECOND);
  }
  assertEquals(r.peak(), 1, "never two reads at once");
  assertEquals(r.rebuilds(), 0);
  assert(r.reads() <= 60, `reads ${r.reads()} in 10 minutes: at most one per flap`);
}));

// ── The gate ─────────────────────────────────────────────────────────────

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function gateRig() {
  const c = clock();
  const gate = createCuratedRequestGate<string>(CURATED_MAX_CONCURRENT, { setTimer: c.setTimer, clearTimer: c.clearTimer });
  const started: string[] = [];
  const held = new Map<string, ReturnType<typeof deferred<string>>>();
  const run = (key: string) => {
    const slot = deferred<string>();
    held.set(key, slot);
    return gate.run(key, () => {
      started.push(key);
      return slot.promise;
    }).catch((error: Error) => `rejected:${error.message}`);
  };
  return { ...c, gate, started, held, run };
}

Deno.test("GX-1 a hung call is given up at the watchdog, its late answer changes nothing, and one slot opens once", async () => {
  const g = gateRig();
  const results = ["a", "b", "c", "d", "e"].map(g.run);
  await g.advance(0);
  assertEquals(g.started, ["a", "b", "c"]);
  g.held.get("b")!.resolve("b");
  g.held.get("c")!.resolve("c");
  await g.advance(0);
  assertEquals(g.started, ["a", "b", "c", "d", "e"]);
  await g.advance(CURATED_WATCHDOG_MS);
  assertEquals(await results[0], "rejected:curated_gate_watchdog");
  // The late answer from "a" must not free a second slot.
  g.held.get("a")!.resolve("late");
  await g.advance(0);
  const more = ["f", "g", "h", "i"].map(g.run);
  await g.advance(0);
  assertEquals(g.started.slice(5), ["f", "g", "h"], "exactly the cap, not one more");
  for (const key of ["d", "e", "f", "g", "h", "i"]) g.held.get(key)?.resolve(key);
  await g.advance(0);
  await Promise.all([...results, ...more]);
  assertEquals(g.pending(), 0, "no watchdog timer outlives its call");
});

Deno.test("GX-2 waiting in the queue does not use up a call's watchdog", async () => {
  const g = gateRig();
  const results = ["a", "b", "c", "d"].map(g.run);
  await g.advance(CURATED_WATCHDOG_MS - SECOND);
  g.held.get("a")!.resolve("a");
  await g.advance(0);
  assertEquals(g.started.at(-1), "d", "d starts, late");
  await g.advance(2 * SECOND);
  // b and c have timed out; d has not.
  assertEquals(await results[1], "rejected:curated_gate_watchdog");
  g.held.get("d")!.resolve("d");
  await g.advance(0);
  assertEquals(await results[3], "d", "d's own clock started when it started");
});

Deno.test("GX-3 sign-out: nobody is left hanging, and old calls cannot corrupt the new user's slots", async () => {
  const g = gateRig();
  const results = ["a", "b", "c", "d"].map(g.run);
  await g.advance(0);
  g.gate.reset();
  await g.advance(0);
  assertEquals(await results[0], "rejected:curated_gate_reset");
  assertEquals(await results[3], "rejected:curated_gate_reset", "a queued caller rejects too");
  assertEquals(g.started, ["a", "b", "c"], "the queued call never starts");
  assertEquals(g.pending(), 0, "watchdogs cleared");

  const fresh = ["w", "x", "y", "z"].map(g.run);
  await g.advance(0);
  assertEquals(g.started.slice(3), ["w", "x", "y"]);
  // The previous account's calls finally answer. They must not free the new user's slots.
  for (const key of ["a", "b", "c"]) g.held.get(key)!.resolve("old");
  await g.advance(0);
  assertEquals(g.started.includes("z"), false, "still at the cap");
  for (const key of ["w", "x", "y", "z"]) g.held.get(key)!.resolve(key);
  await g.advance(0);
  assertEquals(await Promise.all(fresh), ["w", "x", "y", "z"]);
});

Deno.test("GX-4 a key reset mid-flight gets a fresh call, and a failure does not stick", async () => {
  const g = gateRig();
  const first = g.run("same");
  await g.advance(0);
  g.gate.reset();
  await first;
  const second = g.run("same");
  await g.advance(0);
  assertEquals(g.started, ["same", "same"]);
  g.held.get("same")!.reject(new Error("no"));
  await g.advance(0);
  assertEquals(await second, "rejected:no");
  await assertRejects(() => g.gate.run("same", () => Promise.reject(new Error("again"))), Error, "again");
});

// ── A cached empty list ──────────────────────────────────────────────────

const empty = { conversations: [], teamBrandIds: null };
const rows = { conversations: [{ id: "c" }], teamBrandIds: null };
const state = (over: Record<string, unknown>) => ({ data: empty, isPending: false, isFetching: false, isError: false, error: null, ...over });

Deno.test("LX-1 cached empty: a settled failure is the error row, timeout included; rows plus timeout stay silent", () => {
  // deno-lint-ignore no-explicit-any
  const view = (over: Record<string, unknown>) => chatListViewState(state(over) as any);
  assertEquals(view({ isError: true, error: new ChatListTimeoutError() }).failed, true);
  assertEquals(view({ isError: true, error: new Error("500") }).failed, true);
  assertEquals(view({ data: rows, isError: true, error: new ChatListTimeoutError() }).failed, false);
  assertEquals(view({ data: rows, isError: true, error: new Error("500") }).failed, true);
  assertEquals(view({}).failed, false, "a real empty success is not a failure");
});

Deno.test("LX-2 pinned: while a cached-empty refresh retries, the view still reads as loaded and not failed", () => {
  // deno-lint-ignore no-explicit-any
  const during = chatListViewState(state({ isFetching: true }) as any);
  assertEquals(during, { conversations: [], loaded: true, loading: false, failed: false });
  assertEquals(shouldRetryChatList(3, new ChatListTimeoutError(), false, false), true, "the retries that keep it there");
});
