// Issue #4275 T-A11 — what the realtime library does, pinned against the REAL
// package at the exact version in app-mobile's lockfile, over a fake WebSocket.
//
// chatChannelRecovery.ts is built on these facts. A library upgrade that changes
// any of them makes this suite fail, which is the point: re-create a channel
// after CHANNEL_ERROR only if T1 or T2 stops holding, and so on.
//
// FAILS-ON-REVERT: this suite pins the library, not our code. It fails when the
// lockfile moves to a version with different semantics.

import { assert, assertEquals, assertNotStrictEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const lock = JSON.parse(
  Deno.readTextFileSync(new URL("../../../package-lock.json", import.meta.url)),
) as { packages: Record<string, { version: string }> };
const version = lock.packages["node_modules/@supabase/realtime-js"].version;
const specifier = `npm:@supabase/realtime-js@${version}`;
const { RealtimeClient } = await import(specifier);

type Frame = [string | null, string | null, string, string, Record<string, unknown>];

class FakeSocket {
  static instances: FakeSocket[] = [];
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
    FakeSocket.instances.push(this);
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
  /** The network went away: no clean close code. */
  drop(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: "", wasClean: false });
  }
  receive(frame: Frame): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

const socketNow = (): FakeSocket => FakeSocket.instances[FakeSocket.instances.length - 1];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(what: string, test: () => boolean, ms = 8000): Promise<void> {
  const started = Date.now();
  while (!test()) {
    if (Date.now() - started > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

function pendingJoin(topic: string, after = 0): Frame | undefined {
  return socketNow().sent.slice(after).find((frame) => frame[2] === topic && frame[3] === "phx_join");
}

function acceptJoin(topic: string, frame: Frame): void {
  socketNow().receive([frame[0], frame[1], topic, "phx_reply", { status: "ok", response: { postgres_changes: [] } }]);
}

function makeClient(timeout = 10000) {
  FakeSocket.instances = [];
  return new RealtimeClient("ws://fake.test/realtime/v1", {
    transport: FakeSocket,
    params: { apikey: "fake" },
    timeout,
    heartbeatIntervalMs: 3600000,
    reconnectAfterMs: () => 20,
    logger: () => {},
  });
}

async function joined(client: ReturnType<typeof makeClient>, name: string) {
  const statuses: string[] = [];
  const channel = client.channel(name);
  channel.subscribe((status: string) => statuses.push(status));
  const topic = `realtime:${name}`;
  await until("join sent", () => Boolean(socketNow()?.readyState === 1 && pendingJoin(topic)));
  acceptJoin(topic, pendingJoin(topic)!);
  await until("SUBSCRIBED", () => statuses.includes("SUBSCRIBED"));
  return { channel, statuses, topic };
}

const options = { sanitizeOps: false, sanitizeResources: false };

Deno.test({ name: `T1 socket drop: error, then SUBSCRIBED on the same instance, by itself (${specifier})`, ...options, fn: async () => {
  const client = makeClient();
  const { channel, statuses, topic } = await joined(client, "t1");
  const first = socketNow();
  first.drop();
  await until("CHANNEL_ERROR", () => statuses.includes("CHANNEL_ERROR"));
  await until("new socket open", () => socketNow() !== first && socketNow().readyState === 1);
  await until("rejoin sent", () => Boolean(pendingJoin(topic)));
  acceptJoin(topic, pendingJoin(topic)!);
  await until("second SUBSCRIBED", () => statuses.filter((s) => s === "SUBSCRIBED").length === 2);
  assertEquals(client.getChannels()[0], channel, "the same instance rejoined");
  await client.disconnect();
} });

Deno.test({ name: "T2 no join reply: TIMED_OUT, then SUBSCRIBED, by itself", ...options, fn: async () => {
  const client = makeClient(100);
  const statuses: string[] = [];
  client.channel("t2").subscribe((status: string) => statuses.push(status));
  const topic = "realtime:t2";
  await until("TIMED_OUT", () => statuses.includes("TIMED_OUT"));
  await until("a retry join is sent", () => socketNow().sent.filter((f) => f[2] === topic && f[3] === "phx_join").length >= 2);
  const joins = socketNow().sent.filter((f) => f[2] === topic && f[3] === "phx_join");
  acceptJoin(topic, joins[joins.length - 1]);
  await until("SUBSCRIBED", () => statuses.includes("SUBSCRIBED"));
  await client.disconnect();
} });

Deno.test({ name: "T3 setAuth while joined pushes access_token, with no rejoin and no status", ...options, fn: async () => {
  const client = makeClient();
  const { statuses, topic } = await joined(client, "t3");
  const sentBefore = socketNow().sent.length;
  const statusesBefore = statuses.length;
  await client.setAuth("new-token");
  await until("access_token pushed", () => socketNow().sent.slice(sentBefore).some((f) => f[2] === topic && f[3] === "access_token"));
  assertEquals(socketNow().sent.slice(sentBefore).filter((f) => f[3] === "phx_join").length, 0);
  assertEquals(statuses.length, statusesBefore);
  await client.disconnect();
} });

Deno.test({ name: "T4 removeChannel, then same name: closed at once and a new instance", ...options, fn: async () => {
  const client = makeClient();
  await joined(client, "keep-socket-up");
  const { channel } = await joined(client, "t4");
  void client.removeChannel(channel);
  assertEquals(channel.state, "closed");
  const next = client.channel("t4");
  assertNotStrictEquals(next, channel);
  await client.disconnect();
} });

Deno.test({ name: "T5 a deliberate removeChannel fires CLOSED synchronously inside the call", ...options, fn: async () => {
  const client = makeClient();
  await joined(client, "keep-socket-up");
  const { channel, statuses } = await joined(client, "t5");
  void client.removeChannel(channel);
  assert(statuses.includes("CLOSED"), `statuses right after the call: ${statuses}`);
  await client.disconnect();
} });

Deno.test({ name: "T6 server phx_close: CLOSED, closed, removed from the client, no rejoin", ...options, fn: async () => {
  const client = makeClient();
  await joined(client, "keep-socket-up");
  const { channel, statuses, topic } = await joined(client, "t6");
  const sentBefore = socketNow().sent.length;
  socketNow().receive([null, null, topic, "phx_close", {}]);
  await until("CLOSED", () => statuses.includes("CLOSED"));
  assertEquals(channel.state, "closed");
  assert(!client.getChannels().includes(channel), "removed from the client");
  await sleep(1300); // past the library's first 1 s rejoin step
  assertEquals(socketNow().sent.slice(sentBefore).filter((f) => f[2] === topic && f[3] === "phx_join").length, 0, "no rejoin");
  await client.disconnect();
} });

Deno.test({ name: "T7 system error: no status callback, state stays joined, visible only through on('system')", ...options, fn: async () => {
  const client = makeClient();
  const statuses: string[] = [];
  const systemEvents: Array<{ extension?: string; status?: string }> = [];
  const channel = client.channel("t7");
  channel.on("system", {}, (payload: { extension?: string; status?: string }) => systemEvents.push(payload));
  channel.subscribe((status: string) => statuses.push(status));
  const topic = "realtime:t7";
  await until("join sent", () => Boolean(socketNow()?.readyState === 1 && pendingJoin(topic)));
  acceptJoin(topic, pendingJoin(topic)!);
  await until("SUBSCRIBED", () => statuses.includes("SUBSCRIBED"));
  const statusesBefore = statuses.length;
  socketNow().receive([null, null, topic, "system", { extension: "postgres_changes", status: "error", message: "x" }]);
  await until("system event", () => systemEvents.length === 1);
  assertEquals(systemEvents[0].status, "error");
  assertEquals(systemEvents[0].extension, "postgres_changes");
  assertEquals(statuses.length, statusesBefore);
  assertEquals(channel.state, "joined");
  await client.disconnect();
} });
