// Issue #4114 Wave 4 retest — tester adversarial suite for open-view-once.
//
// The function must only ever sign the one object a view-once message can
// legitimately name: the exact private-bucket shape
// <conversation_id>/once/<uuid>.<ext>, inside the message's OWN conversation
// folder. Anything else (a path that is not in that exact shape, or a
// well-shaped path in another conversation's folder) is refused before any
// sign or view record.
//
// FAILS until openOnce checks the stored path before signing (at the retest
// commit it signs message.file_url as stored); fails again if that check is
// removed.

import {
  createOpenViewOnceHandler,
  type OpenViewOnceDeps,
  type ViewOnceMessage,
} from "../handler.ts";

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${e}`);
}

const CONV = "aaaaaaaa-1111-4111-8111-111111111111";
const OTHER_CONV = "abababab-1111-4111-8111-111111111111";
const OBJ = "bbbbbbbb-2222-4222-8222-222222222222";
const MSG = "cccccccc-3333-4333-8333-333333333333";
const SENDER = "dddddddd-4444-4444-8444-444444444444";
const FRIEND = "eeeeeeee-5555-4555-8555-555555555555";

function world(fileUrl: string) {
  const message: ViewOnceMessage = {
    id: MSG, conversation_id: CONV, sender_id: SENDER, message_type: "image",
    file_url: fileUrl, view_once: true, view_once_purged_at: null, deleted_at: null,
  };
  const state = { signed: [] as string[], recorded: 0 };
  const deps: OpenViewOnceDeps = {
    userIdFor: async (authorization) => {
      const token = (authorization ?? "").replace(/^Bearer\s+/i, "");
      return token.startsWith("user:") ? token.slice(5) : null;
    },
    isCronCaller: async () => false,
    loadMessage: async (id) => ({ data: id === MSG ? message : null, error: null }),
    isParticipant: async (conversationId, userId) => ({
      data: conversationId === CONV && (userId === SENDER || userId === FRIEND),
      error: null,
    }),
    signUrl: async (path) => {
      state.signed.push(path);
      return { data: `https://storage.test/${path}`, error: null };
    },
    recordView: async () => {
      state.recorded += 1;
      return { data: { inserted: true, viewedAt: "2026-10-26T10:00:00Z" }, error: null };
    },
    listDue: async () => ({ data: [], error: null }),
    removeObjects: async () => ({ error: null }),
    markPurged: async () => ({ error: null }),
  };
  return { state, handler: createOpenViewOnceHandler(deps) };
}

function open(): Request {
  return new Request("https://edge.test/open-view-once", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer user:${FRIEND}` },
    body: JSON.stringify({ message_id: MSG }),
  });
}

Deno.test("#4114 retest: the canonical view-once path still opens (control)", async () => {
  const { state, handler } = world(`${CONV}/once/${OBJ}.jpg`);
  const response = await handler(open());
  assertEquals(response.status, 200, "canonical path opens");
  assertEquals(state.signed, [`${CONV}/once/${OBJ}.jpg`], "signed exactly the stored path");
});

const NON_CANONICAL: Array<[string, string]> = [
  ["a dot segment", `${CONV}/once/./${OBJ}.jpg`],
  ["a doubled slash", `${CONV}/once//${OBJ}.jpg`],
  ["an encoded character", `${CONV}/once/${OBJ}%2Ejpg`],
  ["upper-case hex", `${CONV}/once/${OBJ.toUpperCase()}.jpg`],
  ["a trailing slash", `${CONV}/once/${OBJ}.jpg/`],
  ["a query suffix", `${CONV}/once/${OBJ}.jpg?x=1`],
];

for (const [label, path] of NON_CANONICAL) {
  Deno.test(`#4114 retest: a view-once path with ${label} is never signed`, async () => {
    const { state, handler } = world(path);
    const response = await handler(open());
    assertEquals(response.status >= 400, true, `refused (${label}), got ${response.status}`);
    assertEquals(state.signed, [], `nothing signed (${label})`);
    assertEquals(state.recorded, 0, `no view recorded (${label})`);
  });
}

Deno.test("#4114 retest: a well-shaped once/ path in another conversation's folder is never signed", async () => {
  const { state, handler } = world(`${OTHER_CONV}/once/${OBJ}.jpg`);
  const response = await handler(open());
  assertEquals(response.status >= 400, true, `refused, got ${response.status}`);
  assertEquals(state.signed, [], "nothing signed");
  assertEquals(state.recorded, 0, "no view recorded");
});
