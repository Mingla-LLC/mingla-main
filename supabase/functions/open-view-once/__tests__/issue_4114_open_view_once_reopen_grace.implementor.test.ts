// Issue #4114 simulator QA — a failed load must not use up the only view.
//
// The same recipient may be re-signed for VIEW_ONCE_REOPEN_GRACE_SECONDS after
// their FIRST open; the first-open time is never moved; after the window, or
// when the first-open time cannot be read, it is 409 already_opened as before.
// The sender and strangers are still refused.
//
// FAILS-ON-REVERT: drop the grace check and the reopen at +30 s returns 409;
// widen it (or ignore viewedAt) and the reopen at +121 s returns a URL.
// MINGLA-INVARIANT: I-4114-VIEW-ONCE-SERVER-ENFORCED | issue #4114 | A view-once item is handed out to a recipient only within VIEW_ONCE_REOPEN_GRACE_SECONDS of their first recorded open, never to its sender, and only as a short-lived signed URL recorded in message_media_views before it is returned.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createOpenViewOnceHandler,
  isWithinReopenGrace,
  type OpenViewOnceDeps,
  VIEW_ONCE_REOPEN_GRACE_SECONDS,
} from "../handler.ts";

const CONV = "11111111-1111-4111-8111-111111111111";
const MSG = "22222222-2222-4222-8222-222222222222";
const SENDER = "33333333-3333-4333-8333-333333333333";
const FRIEND = "44444444-4444-4444-8444-444444444444";
const FIRST_OPEN = "2026-10-26T10:00:00.000Z";
const T0 = Date.parse(FIRST_OPEN);

function world(clock: { now: number }, opts: { unreadable?: boolean } = {}) {
  const views = new Map<string, string>();
  const signed: string[] = [];
  const deps: OpenViewOnceDeps = {
    userIdFor: async (auth) => (auth === "Bearer friend" ? FRIEND : auth === "Bearer sender" ? SENDER : null),
    isCronCaller: async () => false,
    loadMessage: async () => ({
      data: {
        id: MSG, conversation_id: CONV, sender_id: SENDER, message_type: "image",
        file_url: `${CONV}/once/${MSG}.jpg`, view_once: true, view_once_purged_at: null, deleted_at: null,
      },
      error: null,
    }),
    isParticipant: async (_c, user) => ({ data: user === SENDER || user === FRIEND, error: null }),
    signUrl: async (path) => { signed.push(path); return { data: `https://signed/${signed.length}`, error: null }; },
    recordView: async (messageId, userId) => {
      const key = `${messageId}:${userId}`;
      const existing = views.get(key);
      if (existing) return { data: { inserted: false, viewedAt: opts.unreadable ? null : existing }, error: null };
      const at = new Date(clock.now).toISOString();
      views.set(key, at);
      return { data: { inserted: true, viewedAt: at }, error: null };
    },
    listDue: async () => ({ data: [], error: null }),
    removeObjects: async () => ({ error: null }),
    markPurged: async () => ({ error: null }),
    now: () => clock.now,
  };
  return { deps, views };
}

const open = (handler: (req: Request) => Promise<Response>, who: string) =>
  handler(new Request("http://x", {
    method: "POST",
    headers: { Authorization: `Bearer ${who}` },
    body: JSON.stringify({ message_id: MSG }),
  }));

Deno.test("QA2a the same recipient is re-signed inside the grace window; first open kept", async () => {
  const clock = { now: T0 };
  const { deps, views } = world(clock);
  const handler = createOpenViewOnceHandler(deps);
  assertEquals((await open(handler, "friend")).status, 200);
  clock.now = T0 + 30_000;
  const again = await open(handler, "friend");
  assertEquals(again.status, 200, "a reload after a failed load still gets a URL");
  const body = await again.json();
  assert(typeof body.url === "string" && body.url.length > 0, "a fresh signed url");
  assertEquals(body.viewed_at, FIRST_OPEN, "viewed_at stays the first open");
  assertEquals(views.get(`${MSG}:${FRIEND}`), FIRST_OPEN, "the stored first open is not moved");
});

Deno.test("QA2a after the window it is refused as before", async () => {
  const clock = { now: T0 };
  const { deps } = world(clock);
  const handler = createOpenViewOnceHandler(deps);
  assertEquals((await open(handler, "friend")).status, 200);
  clock.now = T0 + (VIEW_ONCE_REOPEN_GRACE_SECONDS + 1) * 1000;
  const late = await open(handler, "friend");
  assertEquals(late.status, 409);
  assertEquals((await late.json()).url, undefined, "no url after the window");
});

Deno.test("QA2a an unreadable first-open time refuses the reopen", async () => {
  const clock = { now: T0 };
  const { deps } = world(clock, { unreadable: true });
  const handler = createOpenViewOnceHandler(deps);
  assertEquals((await open(handler, "friend")).status, 200);
  clock.now = T0 + 5_000;
  assertEquals((await open(handler, "friend")).status, 409);
});

Deno.test("QA2a the sender is still refused inside the window", async () => {
  const clock = { now: T0 };
  const { deps } = world(clock);
  const handler = createOpenViewOnceHandler(deps);
  assertEquals((await open(handler, "sender")).status, 403);
});

Deno.test("QA2a grace edges", () => {
  assert(isWithinReopenGrace(FIRST_OPEN, T0), "at the first open");
  assert(isWithinReopenGrace(FIRST_OPEN, T0 + VIEW_ONCE_REOPEN_GRACE_SECONDS * 1000), "at the edge");
  assert(!isWithinReopenGrace(FIRST_OPEN, T0 + VIEW_ONCE_REOPEN_GRACE_SECONDS * 1000 + 1), "just past");
  assert(!isWithinReopenGrace(FIRST_OPEN, T0 - 1), "a first open in the future is refused");
  assert(!isWithinReopenGrace(null, T0), "unknown first open");
  assert(!isWithinReopenGrace("not a date", T0), "garbage first open");
});
