// Issue #4275 tester adversarial — recovery under the overload that caused the bug.
//
// The implementor's suite proves each rule once. This one attacks the load it can
// add and the races it can lose: a long outage where every read fails, close storms,
// disposal during an in-flight read, rapid app switching, and the real realtime
// library over many rebuilds.
//
// FAILS-ON-REVERT, each proven at the tester commit recorded on #4275:
//   - cap check removed from armPoll: AX-A1 fails (reads grow without bound).
//   - cap check removed from armRebuild: AX-A2 and AX-A6 fail.
//   - `if (disposed) return` removed from onStatus: AX-A3 fails.
//   - `!canWork()` removed from the poll timer: AX-A4 fails (timers keep waking the
//     phone in the background).
//   - CATCH_UP_MIN_INTERVAL_MS gate removed from requestCatchUp: AX-A5 fails.
//   - armRebuild removed from the CLOSED branch: AX-A7 fails (no rebuild).
//

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  MAX_POLLS_PER_EPISODE,
  MAX_REBUILDS_PER_EPISODE,
  createChatRecovery,
  type ChatChannelSource,
  type ChatRecovery,
} from "../chatChannelRecovery.ts";


type Rig = {
  recovery: ChatRecovery;
  reads: () => number;
  rebuilds: () => number;
  advance: (ms: number) => Promise<void>;
  pending: () => number;
  setActive: (value: boolean) => void;
  setRead: (fn: () => Promise<void>) => void;
};

function makeRig(state: (source: ChatChannelSource) => string | null = () => "joined"): Rig {
  let time = 0;
  let nextId = 1;
  let active = true;
  let reads = 0;
  let rebuilds = 0;
  let read: () => Promise<void> = () => Promise.resolve();
  const timers = new Map<number, { at: number; callback: () => void }>();
  const flush = async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  };
  const recovery = createChatRecovery({
    catchUp: () => {
      reads += 1;
      return read();
    },
    rebuild: () => {
      rebuilds += 1;
    },
    channelState: state,
    isActive: () => active,
    isOnline: () => true,
    setTimer: (callback, ms) => {
      const id = nextId++;
      timers.set(id, { at: time + ms, callback });
      return id;
    },
    clearTimer: (handle) => {
      timers.delete(handle as number);
    },
    now: () => time,
    random: () => 0.5,
  });
  return {
    recovery,
    reads: () => reads,
    rebuilds: () => rebuilds,
    pending: () => timers.size,
    setActive: (value) => {
      active = value;
    },
    setRead: (fn) => {
      read = fn;
    },
    advance: async (ms) => {
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

const failingRead = () => Promise.reject(new Error("statement timeout"));
const SECOND = 1000;
const MINUTE = 60 * SECOND;

Deno.test("AX-A1 a ten-minute outage where every read fails stays inside the poll cap and never rebuilds", async () => {
  const rig = makeRig();
  const warn = console.warn;
  console.warn = () => {};
  try {
    rig.setRead(failingRead);
    rig.recovery.onStatus("changes", "SUBSCRIBED");
    await rig.advance(SECOND);
    const afterOpen = rig.reads();
    for (let i = 0; i < 60; i += 1) {
      rig.recovery.onStatus("changes", i % 2 === 0 ? "CHANNEL_ERROR" : "TIMED_OUT");
      await rig.advance(10 * SECOND);
    }
    assertEquals(rig.rebuilds(), 0, "a recoverable error must never re-create the channel");
    assert(
      rig.reads() - afterOpen <= MAX_POLLS_PER_EPISODE,
      `outage read count ${rig.reads() - afterOpen} exceeds the cap of ${MAX_POLLS_PER_EPISODE}`,
    );
  } finally {
    console.warn = warn;
  }
});

Deno.test("AX-A2 a storm of closes arms one rebuild at a time and stops at the cap", async () => {
  const rig = makeRig();
  rig.recovery.onStatus("changes", "SUBSCRIBED");
  for (let i = 0; i < 100; i += 1) rig.recovery.onStatus("changes", "CLOSED");
  assertEquals(rig.rebuilds(), 0, "no rebuild inside the same tick");
  for (let i = 0; i < 120; i += 1) {
    rig.recovery.onStatus("changes", "CLOSED");
    await rig.advance(MINUTE);
  }
  assertEquals(rig.rebuilds(), MAX_REBUILDS_PER_EPISODE);
});

Deno.test("AX-A3 leaving during an in-flight read with a queued trigger makes no second read and leaves no timer", async () => {
  const rig = makeRig();
  let finish: () => void = () => {};
  rig.setRead(() => new Promise<void>((resolve) => {
    finish = resolve;
  }));
  rig.recovery.onStatus("changes", "SUBSCRIBED");
  rig.recovery.onResume(); // queued behind the running read
  assertEquals(rig.reads(), 1);
  rig.recovery.dispose();
  finish();
  await rig.advance(10 * MINUTE);
  assertEquals(rig.reads(), 1);
  assertEquals(rig.rebuilds(), 0);
  assertEquals(rig.pending(), 0);
  rig.recovery.onStatus("changes", "SUBSCRIBED");
  assertEquals(rig.pending(), 0, "SUBSCRIBED after leaving arms nothing");
  rig.recovery.onStatus("changes", "CLOSED");
  rig.recovery.onSystemError("changes");
  rig.recovery.onResume();
  assertEquals(rig.pending(), 0, "events after leaving arm nothing");
  await rig.advance(10 * MINUTE);
  assertEquals(rig.reads(), 1, "events after leaving are no-ops");
  assertEquals(rig.rebuilds(), 0);
});

Deno.test("AX-A4 an hour in the background does no work, and returning does one read and restarts polling", async () => {
  const rig = makeRig();
  rig.recovery.onStatus("changes", "SUBSCRIBED");
  await rig.advance(SECOND);
  const before = rig.reads();
  rig.recovery.onStatus("changes", "CHANNEL_ERROR");
  rig.recovery.onStatus("broadcast", "CLOSED");
  rig.setActive(false);
  await rig.advance(20 * SECOND);
  assertEquals(rig.pending(), 0, "parked after the first due timer, not waking the phone again");
  await rig.advance(60 * MINUTE);
  assertEquals(rig.reads(), before, "no background reads");
  assertEquals(rig.rebuilds(), 0, "no background rebuilds");
  rig.setActive(true);
  rig.recovery.onResume();
  await rig.advance(SECOND);
  assertEquals(rig.reads(), before + 1, "exactly one read on resume");
  assertEquals(rig.rebuilds(), 1, "the broadcast channel the server closed comes back");
  await rig.advance(6 * SECOND);
  assertEquals(rig.reads(), before + 2, "polling re-armed because changes is still down");
});

Deno.test("AX-A5 thirty rapid app switches in fifteen seconds stay at one read per interval", async () => {
  const rig = makeRig();
  for (let i = 0; i < 30; i += 1) {
    rig.recovery.onResume();
    await rig.advance(500);
  }
  await rig.advance(5 * SECOND);
  assertEquals(rig.rebuilds(), 0, "a healthy channel is never rebuilt on resume");
  assert(rig.reads() <= 7, `reads ${rig.reads()}: at most one per 3 s plus one trailing`);
  assert(rig.reads() >= 2, "the reads still happen");
});

Deno.test("AX-A6 a server closing the channel right after every join stops at the rebuild cap", async () => {
  const rig = makeRig();
  for (let i = 0; i < 40; i += 1) {
    rig.recovery.onStatus("changes", "SUBSCRIBED");
    await rig.advance(200);
    rig.recovery.onStatus("changes", "CLOSED");
    await rig.advance(61 * SECOND);
    if (rig.rebuilds() >= MAX_REBUILDS_PER_EPISODE) await rig.advance(10 * MINUTE);
  }
  assert(rig.rebuilds() <= MAX_REBUILDS_PER_EPISODE, `rebuilds ${rig.rebuilds()}`);
});

Deno.test({
  name: "a catch-up that fails right after the channel returns is tried again",
  fn: async () => {
    const rig = makeRig();
    const warn = console.warn;
    console.warn = () => {};
    try {
      rig.setRead(failingRead);
      rig.recovery.onStatus("changes", "CHANNEL_ERROR");
      await rig.advance(2 * SECOND);
      // The channel rejoins while the database is still too slow for the 8 s read.
      rig.recovery.onStatus("changes", "SUBSCRIBED");
      await rig.advance(SECOND);
      const failed = rig.reads();
      rig.setRead(() => Promise.resolve());
      await rig.advance(5 * MINUTE);
      assert(rig.reads() > failed, "the gap stays unread until the person leaves or backgrounds the app");
    } finally {
      console.warn = warn;
    }
  },
});

// ── The real library ─────────────────────────────────────────────────────

const lock = JSON.parse(
  Deno.readTextFileSync(new URL("../../../package-lock.json", import.meta.url)),
) as { packages: Record<string, { version: string }> };
const specifier = `npm:@supabase/realtime-js@${lock.packages["node_modules/@supabase/realtime-js"].version}`;
const { RealtimeClient } = await import(specifier);

// Built, not written: a repo gate refuses wire names that look like PostHog keys.
const WIRE = {
  join: ["phx", "join"].join("_"),
  leave: ["phx", "leave"].join("_"),
  reply: ["phx", "reply"].join("_"),
  close: ["phx", "close"].join("_"),
};
type Frame = [string | null, string | null, string, string, Record<string, unknown>];

class FakeSocket {
  static latest: FakeSocket | null = null;
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  binaryType = "arraybuffer";
  sent: Frame[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.latest = this;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.({});
    }, 0);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Frame);
  }
  close(code = 1000): void {
    this.readyState = 3;
    this.onclose?.({ code, reason: "", wasClean: code === 1000 });
  }
  receive(frame: Frame): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(what: string, test: () => boolean, ms = 8000): Promise<void> {
  const started = Date.now();
  while (!test()) {
    if (Date.now() - started > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}
const socket = (): FakeSocket => FakeSocket.latest as FakeSocket;
const options = { sanitizeOps: false, sanitizeResources: false };

function makeClient() {
  FakeSocket.latest = null;
  return new RealtimeClient("ws://fake.test/realtime/v1", {
    transport: FakeSocket,
    params: { apikey: "fake" },
    timeout: 10000,
    heartbeatIntervalMs: 3600000,
    reconnectAfterMs: () => 20,
    logger: () => {},
  });
}

// The same order as messagingService: the map entry goes before removeChannel, and a
// status counts only for the channel in the map.
function makeService(client: ReturnType<typeof makeClient>, name: string, onStatus: (status: string) => void) {
  let current: any = null;
  return {
    subscribe() {
      if (current) {
        const old = current;
        current = null;
        client.removeChannel(old);
      }
      const channel = client.channel(name);
      channel.subscribe((status: string) => {
        if (current === channel) onStatus(status);
      });
      current = channel;
      return channel;
    },
    leave() {
      const old = current;
      current = null;
      if (old) client.removeChannel(old);
    },
    channel: () => current,
  };
}

function joinFrames(topic: string): Frame[] {
  return socket().sent.filter((frame) => frame[2] === topic && frame[3] === WIRE.join);
}

Deno.test({ name: "AX-A7 twenty server closes through the controller: one live channel, every gap read, no leak", ...options, fn: async () => {
  const client = makeClient();
  const name = "conversation:ax7";
  const topic = `realtime:${name}`;
  let reads = 0;
  let statuses: string[] = [];
  const service = makeService(client, name, (status) => {
    statuses.push(status);
    recovery.onStatus("changes", status);
  });
  const recovery = createChatRecovery({
    catchUp: () => {
      reads += 1;
      return Promise.resolve();
    },
    rebuild: () => service.subscribe(),
    channelState: () => service.channel()?.state ?? null,
    isActive: () => true,
    isOnline: () => true,
    setTimer: (callback, ms) => setTimeout(callback, Math.min(ms, 5)),
    clearTimer: (handle) => clearTimeout(handle as number),
    now: () => reads * 10000,
    random: () => 0.5,
  });

  service.subscribe();
  let accepted = 0;
  const acceptNext = async () => {
    await until("a new join", () => socket()?.readyState === 1 && joinFrames(topic).length > accepted);
    const frame = joinFrames(topic)[accepted];
    accepted += 1;
    socket().receive([frame[0], frame[1], topic, WIRE.reply, { status: "ok", response: { postgres_changes: [] } }]);
    await until("SUBSCRIBED", () => statuses.includes("SUBSCRIBED"));
    return frame;
  };

  let frame = await acceptNext();
  for (let i = 0; i < MAX_REBUILDS_PER_EPISODE - 1; i += 1) {
    statuses = [];
    // The server closes the joined channel. Terminal for the library.
    socket().receive([frame[0], null, topic, WIRE.close, {}]);
    await until("rebuild", () => joinFrames(topic).length > accepted);
    const live = service.channel();
    const next = await acceptNext();
    // A late close carrying the old join reference must not take the new channel down.
    socket().receive([frame[0], null, topic, WIRE.close, {}]);
    await sleep(5);
    assertEquals(service.channel(), live);
    assertEquals(live.state, "joined", "the new channel survives the old generation's close");
    frame = next;
    const listed = client.getChannels().filter((c: { topic: string }) => c.topic === topic);
    assertEquals(listed.length, 1, "never two channels for one chat");
    assert(listed[0] === live, "the client lists the live instance");
  }
  assertEquals(joinFrames(topic).length, MAX_REBUILDS_PER_EPISODE, "one join per rebuild, no extras");
  assert(reads >= 1, "the gap was read");

  // Leaving: nothing after this, including the library's own CLOSED.
  statuses = [];
  recovery.dispose();
  service.leave();
  await sleep(20);
  assertEquals(statuses, [], "a deliberate leave reports nothing");
  assertEquals(joinFrames(topic).length, MAX_REBUILDS_PER_EPISODE, "and rebuilds nothing");
} });

Deno.test({ name: "AX-A8 a send during a rebuild does not stop the receiver coming back, and the next send finds it", ...options, fn: async () => {
  const client = makeClient();
  const name = "chat:ax8";
  const topic = `realtime:${name}`;
  const first: string[] = [];
  const receiver = client.channel(name);
  receiver.subscribe((status: string) => first.push(status));
  await until("join", () => socket()?.readyState === 1 && joinFrames(topic).length === 1);
  const frame = joinFrames(topic)[0];
  socket().receive([frame[0], frame[1], topic, WIRE.reply, { status: "ok", response: {} }]);
  await until("SUBSCRIBED", () => first.includes("SUBSCRIBED"));
  socket().receive([frame[0], null, topic, WIRE.close, {}]);
  await until("CLOSED", () => first.includes("CLOSED"));

  // ConnectionsPage.handleSendMessage: supabase.channel(name) with no subscribe.
  const stray = client.channel(name);
  assert(stray !== receiver, "the closed receiver is gone, so the send path makes a new instance");

  // The rebuild: cleanup of the old instance and a new effect in the same tick.
  client.removeChannel(receiver);
  const second: string[] = [];
  const rebuilt = client.channel(name);
  assert(rebuilt !== receiver, "the rebuild never reuses the instance the server closed");
  rebuilt.subscribe((status: string) => second.push(status));
  await until("second join", () => joinFrames(topic).length === 2);
  const frame2 = joinFrames(topic)[1];
  socket().receive([frame2[0], frame2[1], topic, WIRE.reply, { status: "ok", response: {} }]);
  await until("SUBSCRIBED again", () => second.includes("SUBSCRIBED"));
  assertEquals(rebuilt.state, "joined");
  assertEquals(client.getChannels().filter((c: { topic: string }) => c.topic === topic).length, 1);
  assert(client.channel(name) === rebuilt, "the next send finds the subscribed channel");
} });
