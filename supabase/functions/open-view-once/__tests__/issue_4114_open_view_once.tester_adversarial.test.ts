// Issue #4114 Wave 4 — tester adversarial suite for open-view-once.
//
// The implementor suite covers one open, a second open, the sender, a stranger
// and the sweep happy path. This suite attacks the error and race paths:
//   * two opens racing from two devices hand out exactly ONE url;
//   * a failed view record never leaks the signed url (no free re-open);
//   * a failed sign records nothing (the recipient can try again);
//   * a recipient asking for an ordinary (not view-once) message, or naming a
//     once/ object through a different message, gets nothing signed;
//   * a user JWT can never trigger the sweep, and a failed delete never marks
//     messages purged (no "expired" lie while the object still exists);
//   * malformed bodies, wrong methods and a service-role bearer posing as a
//     user are refused before any read.
//
// FAILS-ON-REVERT: move recordView after the response is built, sign before
// the view_once check, drop the cron check, or mark purged after a failed
// remove, and this suite fails.

import {
  createOpenViewOnceHandler,
  type DueRow,
  type OpenViewOnceDeps,
  type ViewOnceMessage,
} from "../handler.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${e}`);
}

const CONV = "aaaaaaaa-1111-4111-8111-111111111111";
const ONCE = "bbbbbbbb-2222-4222-8222-222222222222";
const PLAIN = "cccccccc-3333-4333-8333-333333333333";
const SENDER = "dddddddd-4444-4444-8444-444444444444";
const FRIEND = "eeeeeeee-5555-4555-8555-555555555555";

type Knobs = {
  recordFails?: boolean;
  signFails?: boolean;
  removeFails?: boolean;
  slowRecord?: boolean;
};

function world(knobs: Knobs = {}) {
  const messages = new Map<string, ViewOnceMessage>([
    [ONCE, {
      id: ONCE, conversation_id: CONV, sender_id: SENDER, message_type: "video",
      file_url: `${CONV}/once/${ONCE}.mp4`, view_once: true, view_once_purged_at: null, deleted_at: null,
    }],
    // An ordinary message whose file_url names the view-once object (a forged
    // or buggy row). The edge function must not sign it.
    [PLAIN, {
      id: PLAIN, conversation_id: CONV, sender_id: FRIEND, message_type: "image",
      file_url: `${CONV}/once/${ONCE}.mp4`, view_once: false, view_once_purged_at: null, deleted_at: null,
    }],
  ]);
  const state = {
    views: new Set<string>(),
    signed: [] as string[],
    loads: 0,
    removed: [] as string[][],
    purged: [] as string[][],
    listed: 0,
    due: [] as DueRow[],
  };
  const deps: OpenViewOnceDeps = {
    userIdFor: async (authorization) => {
      const token = (authorization ?? "").replace(/^Bearer\s+/i, "");
      return token.startsWith("user:") ? token.slice(5) : null;
    },
    isCronCaller: async (authorization) => authorization === "Bearer service-role",
    loadMessage: async (id) => {
      state.loads += 1;
      return { data: messages.get(id) ?? null, error: null };
    },
    isParticipant: async (conversationId, userId) => ({
      data: conversationId === CONV && (userId === SENDER || userId === FRIEND),
      error: null,
    }),
    signUrl: async (path, seconds) => {
      if (knobs.signFails) return { data: null, error: "boom" };
      state.signed.push(path);
      return { data: `https://storage.test/${path}?ttl=${seconds}&n=${state.signed.length}`, error: null };
    },
    recordView: async (messageId, userId) => {
      if (knobs.slowRecord) await new Promise((resolve) => setTimeout(resolve, 5));
      if (knobs.recordFails) return { data: { inserted: false, viewedAt: null }, error: "db down" };
      const key = `${messageId}:${userId}`;
      if (state.views.has(key)) return { data: { inserted: false, viewedAt: null }, error: null };
      state.views.add(key);
      return { data: { inserted: true, viewedAt: "2026-10-26T10:00:00Z" }, error: null };
    },
    listDue: async () => {
      state.listed += 1;
      return { data: state.due, error: null };
    },
    removeObjects: async (paths) => {
      state.removed.push(paths);
      return { error: knobs.removeFails ? "storage 500" : null };
    },
    markPurged: async (ids) => {
      state.purged.push(ids);
      return { error: null };
    },
  };
  return { state, handler: createOpenViewOnceHandler(deps) };
}

function post(as: string | null, body: unknown, method = "POST"): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (as) headers.Authorization = `Bearer ${as}`;
  return new Request("https://edge.test/open-view-once", {
    method,
    headers,
    body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

Deno.test("#4114 W4 adversarial: two devices racing to open hand out exactly one url", async () => {
  const { state, handler } = world({ slowRecord: true });
  const responses = await Promise.all([
    handler(post(`user:${FRIEND}`, { message_id: ONCE })),
    handler(post(`user:${FRIEND}`, { message_id: ONCE })),
    handler(post(`user:${FRIEND}`, { message_id: ONCE })),
  ]);
  const bodies = await Promise.all(responses.map((response) => response.json()));
  const urls = bodies.filter((body) => typeof body.url === "string");
  assertEquals(urls.length, 1, "one url across racing opens");
  assertEquals(responses.map((r) => r.status).sort(), [200, 409, 409], "the others are already_opened");
  assertEquals(state.views.size, 1, "one view row");
});

Deno.test("#4114 W4 adversarial: a failed view record never leaks the url; a failed sign records nothing", async () => {
  const failingRecord = world({ recordFails: true });
  const response = await failingRecord.handler(post(`user:${FRIEND}`, { message_id: ONCE }));
  assertEquals(response.status, 500, "record failure is an error");
  const body = await response.json();
  assertEquals(body.url, undefined, "the signed url never leaves the function without a recorded view");
  assert(!JSON.stringify(body).includes("storage.test"), "no url anywhere in the error body");

  const failingSign = world({ signFails: true });
  const signed = await failingSign.handler(post(`user:${FRIEND}`, { message_id: ONCE }));
  assertEquals(signed.status, 500, "sign failure is an error");
  assertEquals(failingSign.state.views.size, 0, "no view recorded, so the recipient can still open it later");
});

Deno.test("#4114 W4 adversarial: a once/ object is never signed through an ordinary message", async () => {
  const { state, handler } = world();
  const response = await handler(post(`user:${SENDER}`, { message_id: PLAIN }));
  assertEquals(response.status, 400, "not_view_once");
  assertEquals(state.signed, [], "nothing signed for a non-view-once message, whoever asks");
});

Deno.test("#4114 W4 adversarial: only the cron caller sweeps, and a failed delete never marks purged", async () => {
  const { state, handler } = world({ removeFails: true });
  state.due = [
    { message_id: ONCE, storage_path: `${CONV}/once/${ONCE}.mp4`, reason: "opened" },
    { message_id: null, storage_path: `${CONV}/${PLAIN}.jpg`, reason: "orphan" },
  ];
  for (const as of [null, `user:${FRIEND}`, `user:${SENDER}`, "anon-key"]) {
    const refused = await handler(post(as, { action: "sweep" }));
    assertEquals(refused.status, 403, `sweep refused for ${as}`);
  }
  assertEquals(state.listed, 0, "a refused sweep lists nothing");
  const failed = await handler(post("service-role", { action: "sweep" }));
  assertEquals(failed.status, 500, "a storage failure is reported");
  assertEquals(state.purged, [], "messages are never marked purged while their object may still exist");
});

Deno.test("#4114 W4 adversarial: malformed requests are refused before any read", async () => {
  const { state, handler } = world();
  assertEquals((await handler(post(`user:${FRIEND}`, "not json"))).status, 400, "bad json");
  assertEquals((await handler(post(`user:${FRIEND}`, [ONCE]))).status, 400, "array body");
  assertEquals((await handler(post(`user:${FRIEND}`, { message_id: 42 }))).status, 400, "numeric id");
  assertEquals((await handler(post(`user:${FRIEND}`, { message_id: `${ONCE}' OR 1=1` }))).status, 400, "injection-shaped id");
  assertEquals((await handler(post(`user:${FRIEND}`, null, "GET"))).status, 405, "GET");
  assertEquals((await handler(post("service-role", { message_id: ONCE }))).status, 401, "the cron bearer is not a user");
  assertEquals(state.loads, 0, "no message was read for any malformed request");
});

Deno.test("#4114 W4 adversarial: the real entry point never treats the service-role key as a user", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assert(/token === serviceRoleKey\) return null/.test(source), "userIdFor refuses the service-role bearer");
  const policy = JSON.parse(await Deno.readTextFile(new URL("../function-policy.json", import.meta.url)));
  assertEquals(policy.verify_jwt, true, "the gateway keeps checking JWTs");
  assert(!/console\.(log|info|warn|error)\([^)]*(serviceRoleKey|signedUrl|authorization)/i.test(source), "no secret or url is logged");
});
