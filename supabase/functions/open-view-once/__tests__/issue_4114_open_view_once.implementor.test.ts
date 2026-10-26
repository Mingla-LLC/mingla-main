// Issue #4114 Wave 4 — open-view-once hands a view-once item out once.
//
// Drives the real handler with in-memory fakes for the database and storage:
//   * the first open by a recipient returns a 60-second signed URL and records
//     the view; a second open is refused with 409 and gets NO url;
//   * the sender is refused (403) and nothing is signed or recorded;
//   * a non-participant is refused (403), an expired item is 410, a bad id 400,
//     no user 401;
//   * the sweep only runs for the cron caller and deletes, then marks purged.
//
// FAILS-ON-REVERT: deleting the `!recorded.data.inserted` 409 branch returns a
// second URL; deleting the sender check signs a URL for the sender.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createOpenViewOnceHandler,
  type DueRow,
  type OpenViewOnceDeps,
  type ViewOnceMessage,
  VIEW_ONCE_URL_SECONDS,
} from "../handler.ts";

const CONV = "11111111-1111-4111-8111-111111111111";
const MSG = "22222222-2222-4222-8222-222222222222";
const SENDER = "33333333-3333-4333-8333-333333333333";
const FRIEND = "44444444-4444-4444-8444-444444444444";
const STRANGER = "55555555-5555-4555-8555-555555555555";

interface World {
  message: ViewOnceMessage;
  views: Set<string>;
  signed: string[];
  removed: string[][];
  purged: string[][];
  due: DueRow[];
}

function makeWorld(overrides: Partial<ViewOnceMessage> = {}): World {
  return {
    message: {
      id: MSG,
      conversation_id: CONV,
      sender_id: SENDER,
      message_type: "image",
      file_url: `${CONV}/once/${MSG}.jpg`,
      view_once: true,
      view_once_purged_at: null,
      deleted_at: null,
      ...overrides,
    },
    views: new Set(),
    signed: [],
    removed: [],
    purged: [],
    due: [],
  };
}

function deps(world: World): OpenViewOnceDeps {
  const members = new Set([SENDER, FRIEND]);
  return {
    userIdFor: async (authorization) => {
      const token = (authorization ?? "").replace(/^Bearer\s+/i, "");
      return token.startsWith("user:") ? token.slice(5) : null;
    },
    isCronCaller: async (authorization) => authorization === "Bearer service-role",
    loadMessage: async (id) => ({ data: id === world.message.id ? world.message : null, error: null }),
    isParticipant: async (conversationId, userId) => ({
      data: conversationId === CONV && members.has(userId),
      error: null,
    }),
    signUrl: async (path, seconds) => {
      world.signed.push(`${path}@${seconds}`);
      return { data: `https://storage.test/sign/${path}?ttl=${seconds}`, error: null };
    },
    recordView: async (messageId, userId) => {
      const key = `${messageId}:${userId}`;
      if (world.views.has(key)) return { data: { inserted: false, viewedAt: null }, error: null };
      world.views.add(key);
      return { data: { inserted: true, viewedAt: "2026-10-26T09:40:00Z" }, error: null };
    },
    listDue: async () => ({ data: world.due, error: null }),
    removeObjects: async (paths) => {
      world.removed.push(paths);
      return { error: null };
    },
    markPurged: async (ids) => {
      world.purged.push(ids);
      return { error: null };
    },
  };
}

function open(as: string | null, body: Record<string, unknown> = { message_id: MSG }): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (as) headers.Authorization = `Bearer ${as}`;
  return new Request("https://edge.test/open-view-once", { method: "POST", headers, body: JSON.stringify(body) });
}

Deno.test("a recipient opens a view-once item once; the second open is 409 with no url", async () => {
  const world = makeWorld();
  const handler = createOpenViewOnceHandler(deps(world));

  const first = await handler(open(`user:${FRIEND}`));
  assertEquals(first.status, 200);
  const firstBody = await first.json();
  assert(typeof firstBody.url === "string" && firstBody.url.includes(`${CONV}/once/${MSG}.jpg`));
  assertEquals(firstBody.expires_in, VIEW_ONCE_URL_SECONDS);
  assertEquals(VIEW_ONCE_URL_SECONDS, 60);
  assertEquals(firstBody.viewed_at, "2026-10-26T09:40:00Z");
  assert(world.views.has(`${MSG}:${FRIEND}`), "the view is recorded");

  const second = await handler(open(`user:${FRIEND}`));
  assertEquals(second.status, 409);
  const secondBody = await second.json();
  assertEquals(secondBody.error, "already_opened");
  assertEquals(secondBody.url, undefined, "a refused open never carries a url");
});

Deno.test("the sender cannot open their own view-once item", async () => {
  const world = makeWorld();
  const handler = createOpenViewOnceHandler(deps(world));
  const response = await handler(open(`user:${SENDER}`));
  assertEquals(response.status, 403);
  assertEquals((await response.json()).error, "sender_cannot_open");
  assertEquals(world.signed, [], "nothing is signed for the sender");
  assertEquals(world.views.size, 0, "no view is recorded for the sender");
});

Deno.test("non-participants, expired items, bad ids and missing users are refused", async () => {
  const world = makeWorld();
  const handler = createOpenViewOnceHandler(deps(world));
  assertEquals((await handler(open(`user:${STRANGER}`))).status, 403);
  assertEquals((await handler(open(null))).status, 401);
  assertEquals((await handler(open(`user:${FRIEND}`, { message_id: "not-a-uuid" }))).status, 400);

  const expired = makeWorld({ view_once_purged_at: "2026-10-20T00:00:00Z" });
  assertEquals((await createOpenViewOnceHandler(deps(expired))(open(`user:${FRIEND}`))).status, 410);
  const unsent = makeWorld({ deleted_at: "2026-10-20T00:00:00Z" });
  assertEquals((await createOpenViewOnceHandler(deps(unsent))(open(`user:${FRIEND}`))).status, 410);
  const normal = makeWorld({ view_once: false, file_url: `${CONV}/${MSG}.jpg` });
  assertEquals((await createOpenViewOnceHandler(deps(normal))(open(`user:${FRIEND}`))).status, 400);
  assertEquals(world.signed.length + expired.signed.length + unsent.signed.length + normal.signed.length, 0);
});

Deno.test("the sweep runs only for the cron caller, deletes through storage, then marks purged", async () => {
  const world = makeWorld();
  world.due = [
    { message_id: MSG, storage_path: `${CONV}/once/${MSG}.jpg`, reason: "opened" },
    { message_id: null, storage_path: `${CONV}/${FRIEND}.jpg`, reason: "orphan" },
  ];
  const handler = createOpenViewOnceHandler(deps(world));

  const refused = await handler(open(`user:${FRIEND}`, { action: "sweep" }));
  assertEquals(refused.status, 403);
  assertEquals(world.removed.length, 0);

  const response = await handler(open("service-role", { action: "sweep" }));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.removed, 2);
  assertEquals(body.purged, 1);
  assertEquals(world.removed, [[`${CONV}/once/${MSG}.jpg`, `${CONV}/${FRIEND}.jpg`]]);
  assertEquals(world.purged, [[MSG]], "only view-once rows are marked, after the delete");
});
