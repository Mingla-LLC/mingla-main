// Issue #4275 Part A — the open-chat recovery controller.
//
// invariant: I-CHAT-RECOVERY-CATCHUP — every return to SUBSCRIBED on an open chat
// runs a merge-only catch-up, and a library-recoverable error never re-creates a
// channel.
//
// FAILS-ON-REVERT: drop the requestCatchUp() from the SUBSCRIBED branch and T-A1
// and T-A2 fail. Call armRebuild for CHANNEL_ERROR and T-A2 and T-A3 fail. Move
// channels.delete after removeChannel and T-A10 fails.
//
// The library facts this rests on are pinned against the real package in
// issue_4275_realtime_library_semantics.implementor.test.ts.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CATCH_UP_BACKOFF_MS,
  CATCH_UP_MIN_INTERVAL_MS,
  MAX_POLLS_PER_EPISODE,
  MAX_REBUILDS_PER_EPISODE,
  REBUILD_BACKOFF_MS,
  STABLE_AFTER_MS,
  chatChannelBus,
  createChatChannelBus,
  createChatRecovery,
  type ChatChannelEvent,
  type ChatRecovery,
} from "../chatChannelRecovery.ts";

type Rig = {
  recovery: ChatRecovery;
  catchUps: () => number;
  rebuilds: string[];
  advance: (ms: number) => Promise<void>;
  setActive: (value: boolean) => void;
  setOnline: (value: boolean) => void;
  setState: (source: string, value: string | null) => void;
  pendingTimers: () => number;
  now: () => number;
  catchUpTimes: number[];
  rebuildTimes: number[];
  release: () => void;
};

function makeRig(options: { holdCatchUp?: boolean; failReads?: () => boolean } = {}): Rig {
  let time = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let active = true;
  let online = true;
  const states: Record<string, string | null> = { changes: "joined", broadcast: "joined" };
  const rebuilds: string[] = [];
  const catchUpTimes: number[] = [];
  const rebuildTimes: number[] = [];
  let releaseHeld: (() => void) | null = null;
  const flush = async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  };
  const recovery = createChatRecovery({
    catchUp: () => {
      catchUpTimes.push(time);
      if (options.failReads?.()) return Promise.reject(new Error("read timed out"));
      if (!options.holdCatchUp) return Promise.resolve();
      return new Promise<void>((resolve) => {
        releaseHeld = resolve;
      });
    },
    rebuild: (source) => {
      rebuilds.push(source);
      rebuildTimes.push(time);
    },
    channelState: (source) => states[source],
    isActive: () => active,
    isOnline: () => online,
    setTimer: (callback, ms) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, { at: time + ms, callback });
      return id;
    },
    clearTimer: (handle) => {
      timers.delete(handle as number);
    },
    now: () => time,
    random: () => 0.5, // no jitter
  });
  return {
    recovery,
    catchUps: () => catchUpTimes.length,
    rebuilds,
    catchUpTimes,
    rebuildTimes,
    advance: async (ms) => {
      const end = time + ms;
      await flush(); // a read settled just before this call arms its retry first
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        time = due[1].at;
        timers.delete(due[0]);
        due[1].callback();
        await flush();
      }
      time = end;
      await flush();
    },
    setActive: (value) => {
      active = value;
    },
    setOnline: (value) => {
      online = value;
    },
    setState: (source, value) => {
      states[source] = value;
    },
    pendingTimers: () => timers.size,
    now: () => time,
    release: () => {
      releaseHeld?.();
    },
  };
}

Deno.test("T-A1 first SUBSCRIBED runs one catch-up, closing the gap after the open read", async () => {
  const rig = makeRig();
  rig.recovery.onStatus("changes", "SUBSCRIBED");
  await rig.advance(0);
  assertEquals(rig.catchUps(), 1);
  assertEquals(rig.rebuilds, []);
});

Deno.test("T-A1 the broadcast channel never triggers a read: it carries no history", async () => {
  const rig = makeRig();
  rig.recovery.onStatus("broadcast", "SUBSCRIBED");
  await rig.advance(0);
  assertEquals(rig.catchUps(), 0);
});

for (const failure of ["CHANNEL_ERROR", "TIMED_OUT"]) {
  Deno.test(`T-A2 ${failure} then SUBSCRIBED: no rebuild, polling stops, one catch-up`, async () => {
    const rig = makeRig();
    rig.recovery.onStatus("changes", "SUBSCRIBED");
    await rig.advance(STABLE_AFTER_MS);
    const before = rig.catchUps();
    rig.recovery.onStatus("changes", failure);
    await rig.advance(1000);
    assertEquals(rig.catchUps(), before, "no read yet: the first poll is at 5 s");
    rig.recovery.onStatus("changes", "SUBSCRIBED");
    await rig.advance(0);
    assertEquals(rig.catchUps(), before + 1, "the return to SUBSCRIBED reads the gap");
    await rig.advance(600_000);
    assertEquals(rig.catchUps(), before + 1, "polling stopped");
    assertEquals(rig.rebuilds, [], "the library rejoins; we never re-create");
  });
}

Deno.test("T-A3 TIMED_OUT for 10 minutes: polls follow the backoff, stop at the cap, no rebuild", async () => {
  const rig = makeRig();
  rig.recovery.onStatus("changes", "TIMED_OUT");
  // The library keeps reporting while it retries; that must not restart or speed up polling.
  for (let elapsed = 0; elapsed < 600_000; elapsed += 10_000) {
    await rig.advance(10_000);
    rig.recovery.onStatus("changes", "TIMED_OUT");
  }
  assertEquals(rig.catchUps(), MAX_POLLS_PER_EPISODE);
  const expected: number[] = [];
  let at = 0;
  for (let i = 0; i < MAX_POLLS_PER_EPISODE; i += 1) {
    at += CATCH_UP_BACKOFF_MS[Math.min(i, CATCH_UP_BACKOFF_MS.length - 1)];
    expected.push(at);
  }
  assertEquals(rig.catchUpTimes, expected);
  assertEquals(rig.rebuilds, []);
});

Deno.test("T-A4 CLOSED rebuilds on the backoff and stops at the cap; polling also runs", async () => {
  const rig = makeRig();
  rig.recovery.onStatus("changes", "CLOSED");
  for (let i = 0; i < MAX_REBUILDS_PER_EPISODE + 2; i += 1) {
    const before = rig.rebuilds.length;
    await rig.advance(REBUILD_BACKOFF_MS[REBUILD_BACKOFF_MS.length - 1]);
    if (rig.rebuilds.length > before) rig.recovery.onStatus("changes", "CLOSED"); // the new channel closes too
  }
  assertEquals(rig.rebuilds.length, MAX_REBUILDS_PER_EPISODE);
  assert(rig.catchUps() > 0, "polling read during the outage");
  assertEquals(rig.rebuildTimes[0], REBUILD_BACKOFF_MS[0]);
});

Deno.test("T-A4 a broadcast CLOSED rebuilds only broadcast, with no read", async () => {
  const rig = makeRig();
  rig.recovery.onStatus("broadcast", "CLOSED");
  await rig.advance(REBUILD_BACKOFF_MS[0]);
  assertEquals(rig.rebuilds, ["broadcast"]);
  assertEquals(rig.catchUps(), 0);
});

Deno.test("T-A4 the rebuild count resets only after staying subscribed", async () => {
  const rig = makeRig();
  for (let i = 0; i < 3; i += 1) {
    rig.recovery.onStatus("changes", "CLOSED");
    await rig.advance(60_000);
  }
  assertEquals(rig.rebuilds.length, 3);
  // Back up, but drops again before STABLE_AFTER_MS: still on the same backoff step.
  rig.recovery.onStatus("changes", "SUBSCRIBED");
  await rig.advance(STABLE_AFTER_MS - 1);
  rig.recovery.onStatus("changes", "CLOSED");
  await rig.advance(REBUILD_BACKOFF_MS[3] - 1);
  assertEquals(rig.rebuilds.length, 3, "step 4 waits its 10 s");
  await rig.advance(1);
  assertEquals(rig.rebuilds.length, 4);
  // Now stable: the next failure starts at the first step again.
  rig.recovery.onStatus("changes", "SUBSCRIBED");
  await rig.advance(STABLE_AFTER_MS);
  rig.recovery.onStatus("changes", "CLOSED");
  await rig.advance(REBUILD_BACKOFF_MS[0]);
  assertEquals(rig.rebuilds.length, 5);
});

Deno.test("T-A5 a system error rebuilds changes, and is ignored for broadcast", async () => {
  const rig = makeRig();
  rig.recovery.onSystemError("changes");
  await rig.advance(REBUILD_BACKOFF_MS[0]);
  assertEquals(rig.rebuilds, ["changes"]);
  const other = makeRig();
  other.recovery.onSystemError("broadcast");
  await other.advance(600_000);
  assertEquals(other.rebuilds, []);
});

Deno.test("T-A6 after dispose, all events and timers do nothing", async () => {
  const rig = makeRig();
  rig.recovery.onStatus("changes", "CLOSED");
  rig.recovery.onStatus("broadcast", "CLOSED");
  rig.recovery.onStatus("changes", "SUBSCRIBED");
  await rig.advance(0);
  const reads = rig.catchUps();
  rig.recovery.dispose();
  assertEquals(rig.pendingTimers(), 0, "dispose clears every timer");
  rig.recovery.onStatus("changes", "SUBSCRIBED");
  rig.recovery.onStatus("changes", "CLOSED");
  rig.recovery.onSystemError("changes");
  rig.recovery.onResume();
  await rig.advance(600_000);
  assertEquals(rig.catchUps(), reads);
  assertEquals(rig.rebuilds, []);
  assertEquals(rig.pendingTimers(), 0);
});

Deno.test("T-A6 a read in flight at dispose does not run its trailing read", async () => {
  const rig = makeRig({ holdCatchUp: true });
  rig.recovery.onStatus("changes", "SUBSCRIBED");
  rig.recovery.onResume();
  rig.recovery.dispose();
  rig.release();
  await rig.advance(60_000);
  assertEquals(rig.catchUps(), 1);
});

Deno.test("T-A7 three triggers within a second make one read and one trailing read", async () => {
  const rig = makeRig();
  rig.recovery.onStatus("changes", "SUBSCRIBED");
  await rig.advance(300);
  rig.recovery.onResume();
  await rig.advance(300);
  rig.recovery.onStatus("changes", "SUBSCRIBED");
  await rig.advance(300);
  assertEquals(rig.catchUps(), 1, "inside the interval");
  await rig.advance(CATCH_UP_MIN_INTERVAL_MS);
  assertEquals(rig.catchUps(), 2);
  assertEquals(rig.catchUpTimes[1], CATCH_UP_MIN_INTERVAL_MS, "the trailing run waits out the interval");
  await rig.advance(60_000);
  assertEquals(rig.catchUps(), 2);
});

Deno.test("T-A7 a trigger during a slow read shares one trailing read", async () => {
  const rig = makeRig({ holdCatchUp: true });
  rig.recovery.onStatus("changes", "SUBSCRIBED");
  await rig.advance(10_000);
  rig.recovery.onResume();
  rig.recovery.onStatus("changes", "SUBSCRIBED");
  await rig.advance(10_000);
  assertEquals(rig.catchUps(), 1, "only one read at a time");
  rig.release();
  await rig.advance(0);
  assertEquals(rig.catchUps(), 2);
});

Deno.test("T-A7 a failed read is reported and does not stop the next one", async () => {
  let calls = 0;
  const warnings: unknown[][] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  let fire: (() => void) | null = null;
  const recovery = createChatRecovery({
    catchUp: () => {
      calls += 1;
      return Promise.reject(new Error("read failed"));
    },
    rebuild: () => {},
    channelState: () => "joined",
    isActive: () => true,
    isOnline: () => true,
    setTimer: (callback) => {
      fire = callback;
      return 1;
    },
    clearTimer: () => {},
    now: () => calls * 10_000,
    random: () => 0.5,
  });
  try {
    recovery.onStatus("changes", "SUBSCRIBED");
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    assertEquals(warnings.length, 1);
    assert(fire !== null, "the stable timer was armed");
    recovery.onStatus("changes", "SUBSCRIBED");
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    assertEquals(calls, 2);
  } finally {
    console.warn = realWarn;
    recovery.dispose();
  }
});

async function quietly(run: () => Promise<void>): Promise<void> {
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    await run();
  } finally {
    console.warn = realWarn;
  }
}

Deno.test("T-A14 a failed catch-up retries on the backoff after the channel is back, and the first success stops it", () => quietly(async () => {
  let failing = true;
  const rig = makeRig({ failReads: () => failing });
  rig.recovery.onStatus("changes", "CHANNEL_ERROR");
  rig.recovery.onStatus("changes", "SUBSCRIBED");
  await rig.advance(0);
  assertEquals(rig.catchUps(), 1, "the read on SUBSCRIBED fails");
  await rig.advance(CATCH_UP_BACKOFF_MS[0]);
  assertEquals(rig.catchUps(), 2, "tried again on the first step");
  failing = false;
  await rig.advance(CATCH_UP_BACKOFF_MS[1]);
  assertEquals(rig.catchUps(), 3, "tried again on the second step, and it works");
  await rig.advance(600_000);
  assertEquals(rig.catchUps(), 3, "the first success stops the retries");
  assertEquals(rig.rebuilds, [], "a failed read is not a channel failure");
}));

Deno.test("T-A14 a read that keeps failing stops at the cap, also across staying subscribed, and resume starts again", () => quietly(async () => {
  let failing = true;
  const rig = makeRig({ failReads: () => failing });
  rig.recovery.onStatus("changes", "SUBSCRIBED");
  await rig.advance(3_600_000);
  assertEquals(rig.catchUps(), 1 + MAX_POLLS_PER_EPISODE, "bounded under overload");
  failing = false;
  rig.recovery.onResume();
  await rig.advance(0);
  assertEquals(rig.catchUps(), 2 + MAX_POLLS_PER_EPISODE, "resume reads again");
  await rig.advance(3_600_000);
  assertEquals(rig.catchUps(), 2 + MAX_POLLS_PER_EPISODE);
}));

Deno.test("T-A14 no retry after dispose, also for a read that fails after it", () => quietly(async () => {
  let reject: ((error: Error) => void) | null = null;
  let reads = 0;
  const timers: Array<() => void> = [];
  const recovery = createChatRecovery({
    catchUp: () => {
      reads += 1;
      return new Promise<void>((_resolve, rejectRead) => {
        reject = rejectRead;
      });
    },
    rebuild: () => {},
    channelState: () => "joined",
    isActive: () => true,
    isOnline: () => true,
    setTimer: (callback) => timers.push(callback),
    clearTimer: () => {},
    now: () => reads * 10_000,
    random: () => 0.5,
  });
  recovery.onStatus("changes", "SUBSCRIBED");
  const armedBefore = timers.length;
  recovery.dispose();
  (reject as unknown as (error: Error) => void)(new Error("late failure"));
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  assertEquals(timers.length, armedBefore, "nothing armed after leaving");
  assertEquals(reads, 1);
}));

Deno.test("T-A14 a failed read in the background parks, and resume picks it up", () => quietly(async () => {
  let failing = true;
  const rig = makeRig({ failReads: () => failing });
  rig.recovery.onStatus("changes", "SUBSCRIBED");
  await rig.advance(0);
  rig.setActive(false);
  await rig.advance(600_000);
  assertEquals(rig.catchUps(), 1, "no background traffic");
  failing = false;
  rig.setActive(true);
  rig.recovery.onResume();
  await rig.advance(0);
  assertEquals(rig.catchUps(), 2);
}));

Deno.test("T-A14 both page readers let a failure reach the controller", () => {
  const page = strip(read("components/ConnectionsPage.tsx"));
  const refresh = page.slice(page.indexOf("const refreshOpenConversation"), page.indexOf("const prevIsOfflineRef"));
  assert(/if \(msgError\) throw new Error\(msgError\);/.test(refresh), "an error result rejects");
  assert(!/catch/.test(refresh), "a timeout rejects");
  const brand = page.slice(page.indexOf("const fetchBrandChannelNewest"), page.indexOf("const loadBrandChannelNewest"));
  assert(/if \(msgError\) throw new Error\(msgError\);/.test(brand), "brand: an error result rejects");
  assert(/throw e;/.test(brand), "brand: a timeout rejects");
  assert(/channelKey: showMessageInterface && user\?\.id/.test(page), "sign-out disposes the controller");
});

Deno.test("T-A8 in the background due timers do no work; resume runs once and resets the caps", async () => {
  const rig = makeRig();
  rig.recovery.onStatus("changes", "CHANNEL_ERROR");
  rig.recovery.onSystemError("changes");
  rig.setActive(false);
  await rig.advance(600_000);
  rig.recovery.onStatus("changes", "SUBSCRIBED"); // the library rejoined in the background
  await rig.advance(1000);
  assertEquals(rig.catchUps(), 0, "no background traffic");
  assertEquals(rig.rebuilds, []);
  rig.recovery.onStatus("changes", "CHANNEL_ERROR");
  await rig.advance(600_000);
  assertEquals(rig.catchUps(), 0);

  rig.setActive(true);
  rig.recovery.onResume();
  await rig.advance(0);
  assertEquals(rig.catchUps(), 1, "one read on resume");
  // Polling is re-armed because the channel is still down, from the first step.
  await rig.advance(CATCH_UP_BACKOFF_MS[0]);
  assertEquals(rig.catchUps(), 2);
});

Deno.test("T-A8 offline counts as not working too", async () => {
  const rig = makeRig();
  rig.setOnline(false);
  rig.recovery.onStatus("changes", "CLOSED");
  await rig.advance(600_000);
  assertEquals(rig.catchUps(), 0);
  assertEquals(rig.rebuilds, []);
});

Deno.test("R5 resume rebuilds a closed or missing channel at once, and resets a spent cap", async () => {
  const rig = makeRig();
  rig.setState("changes", "closed");
  rig.setState("broadcast", null);
  rig.recovery.onResume();
  assertEquals(rig.rebuilds, ["changes", "broadcast"]);

  const spent = makeRig();
  for (let i = 0; i < MAX_REBUILDS_PER_EPISODE + 1; i += 1) {
    spent.recovery.onStatus("changes", "CLOSED");
    await spent.advance(60_000);
  }
  assertEquals(spent.rebuilds.length, MAX_REBUILDS_PER_EPISODE);
  spent.recovery.onResume();
  assertEquals(spent.rebuilds.length, MAX_REBUILDS_PER_EPISODE + 1, "the wanted rebuild runs on resume");
});

Deno.test("R5 resume leaves a healthy joined channel alone", async () => {
  const rig = makeRig();
  rig.recovery.onResume();
  await rig.advance(0);
  assertEquals(rig.rebuilds, []);
  assertEquals(rig.catchUps(), 1);
});

Deno.test("the bus reaches subscribers until they leave, and one bad listener cannot stop the others", () => {
  const bus = createChatChannelBus();
  const seen: ChatChannelEvent[] = [];
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    bus.subscribe(() => {
      throw new Error("bad listener");
    });
    const leave = bus.subscribe((event) => seen.push(event));
    const event: ChatChannelEvent = { kind: "status", source: "changes", conversationId: "c", status: "SUBSCRIBED" };
    bus.emit(event);
    assertEquals(seen, [event]);
    leave();
    bus.emit(event);
    assertEquals(seen.length, 1);
  } finally {
    console.warn = realWarn;
  }
  assert(typeof chatChannelBus.emit === "function");
});

// ── Source contracts ─────────────────────────────────────────────────────

const srcRoot = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, srcRoot));
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

Deno.test("T-A9 no new code disconnects the socket or writes the seen set", () => {
  for (const path of [
    "utils/chatChannelRecovery.ts",
    "hooks/useOpenChatRecovery.ts",
    "hooks/useBroadcastReceiver.ts",
  ]) {
    const source = strip(read(path));
    assert(!/realtime\.(disconnect|connect)\b/.test(source), `${path} touches the socket`);
    assert(!/broadcastSeenIds\.current\.add\(/.test(source), `${path} writes the seen set`);
  }
  const page = strip(read("components/ConnectionsPage.tsx"));
  assert(!/realtime\.(disconnect|connect)\b/.test(page), "ConnectionsPage touches the socket");
  const refresh = page.slice(page.indexOf("const refreshOpenConversation"), page.indexOf("const prevIsOfflineRef"));
  assert(refresh.includes("writeConversationMessages("), "catch-up goes through the merge");
  assert(!refresh.includes("broadcastSeenIds"), "catch-up does not touch the seen set");
});

Deno.test("T-A10 a deliberate leave is never reported as a failure", () => {
  const service = strip(read("services/messagingService.ts"));
  const start = service.indexOf("unsubscribeFromConversation(conversationId: string)");
  const body = service.slice(start, service.indexOf("getSenderName", start));
  assert(body.indexOf("this.channels.delete(channelName)") >= 0, "the map entry is deleted");
  assert(body.indexOf("this.channels.delete(channelName)") < body.indexOf("supabase.removeChannel(channel)"),
    "delete from the map BEFORE removeChannel: CLOSED fires synchronously inside it");
  const receiver = strip(read("hooks/useBroadcastReceiver.ts"));
  assert(receiver.indexOf("released = true") >= 0 &&
    receiver.indexOf("released = true") < receiver.indexOf("supabase.removeChannel(channel)"),
    "the receiver marks itself released first");
  assert(/if \(released\) return;/.test(receiver), "a released receiver emits nothing");
});

Deno.test("T-A13 a brand channel catches up through its one per-conversation loader", () => {
  const page = strip(read("components/ConnectionsPage.tsx"));
  const hook = page.slice(page.indexOf("useOpenChatRecovery({"), page.indexOf("getChangesChannelState:"));
  assert(/activeBrandChannel \? conversationChannelKey\(brandChannelMemberIds\) : currentConversationId/.test(hook),
    "a brand channel recovers as one key");
  assert(/await fetchBrandChannelNewest\(brandChannel, user\.id\)/.test(hook), "brand catch-up");
  assert(/await refreshOpenConversation\(currentConversationId, user\.id\)/.test(hook), "chat catch-up");
  const loader = page.slice(page.indexOf("const fetchBrandChannelNewest"), page.indexOf("const handleOpenBrandChannel"));
  assert(/byConversation\.get\(raw\.conversation_id\)\?\.push/.test(loader), "rows land in their own conversation");
  assert(/onStatus: \(status: string\) => \{\s*chatChannelBus\.emit/.test(page), "the changes channel reports on the bus");
});

Deno.test("the hook resumes only from background, and rebuild commands name the selected chat", () => {
  const hook = strip(read("hooks/useOpenChatRecovery.ts"));
  assert(/previous === 'background' && next === 'active'/.test(hook), "inactive to active is not a resume");
  assert(/RESUME_DEBOUNCE_MS = 600/.test(hook));
  assert(!/realtimeEpoch/.test(hook));
  const receiver = strip(read("hooks/useBroadcastReceiver.ts"));
  assert(/event\.conversationId === conversationId/.test(receiver), "a rebuild for another chat is ignored");
  assert(/\[conversationId, currentUserId, rebuildNonce\]/.test(receiver));
});
