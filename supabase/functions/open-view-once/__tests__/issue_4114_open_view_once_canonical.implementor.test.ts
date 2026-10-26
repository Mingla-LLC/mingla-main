// Issue #4114 Wave 4 rework — open-view-once signs only the one object a
// view-once message can legitimately name.
//
//   * the stored path must be the canonical <conversation_id>/once/<uuid>.<ext>
//     shape, inside the message's own conversation folder;
//   * the object's uploader (looked up with the service role) must be the
//     message's sender; otherwise the open reads as expired (410) and nothing
//     is signed or recorded;
//   * the sweep only hands canonical paths to the deleter.
//
// FAILS-ON-REVERT: delete the parseAttachmentPath check in openOnce and the
// non-canonical / other-conversation cases sign; delete the owner comparison in
// createOwnerCheckedSignUrl and the foreign-uploader case signs; delete the
// canonical filter in sweep and the planted path is removed.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createOpenViewOnceHandler,
  createOwnerCheckedSignUrl,
  type DueRow,
  type OpenViewOnceDeps,
  parseAttachmentPath,
  type ViewOnceMessage,
} from "../handler.ts";

const CONV = "a1a1a1a1-1111-4111-8111-111111111111";
const OTHER = "b2b2b2b2-2222-4222-8222-222222222222";
const OBJ = "c3c3c3c3-3333-4333-8333-333333333333";
const MSG = "d4d4d4d4-4444-4444-8444-444444444444";
const SENDER = "e5e5e5e5-5555-4555-8555-555555555555";
const FRIEND = "f6f6f6f6-6666-4666-8666-666666666666";
const CANONICAL = `${CONV}/once/${OBJ}.jpg`;

function world(fileUrl: string, owners: Record<string, string> = { [CANONICAL]: SENDER }, due: DueRow[] = []) {
  const message: ViewOnceMessage = {
    id: MSG, conversation_id: CONV, sender_id: SENDER, message_type: "image",
    file_url: fileUrl, view_once: true, view_once_purged_at: null, deleted_at: null,
  };
  const state = { signed: [] as string[], recorded: 0, ownerLookups: [] as string[], removed: [] as string[][] };
  const deps: OpenViewOnceDeps = {
    userIdFor: async (authorization) => {
      const token = (authorization ?? "").replace(/^Bearer\s+/i, "");
      return token.startsWith("user:") ? token.slice(5) : null;
    },
    isCronCaller: async (authorization) => authorization === "Bearer service-role",
    loadMessage: async (id) => ({ data: id === MSG ? message : null, error: null }),
    isParticipant: async (conversationId, userId) => ({
      data: conversationId === CONV && (userId === SENDER || userId === FRIEND),
      error: null,
    }),
    signUrl: createOwnerCheckedSignUrl({
      objectOwner: async (path) => {
        state.ownerLookups.push(path);
        return { data: owners[path] ?? null, error: null };
      },
      sign: async (path) => {
        state.signed.push(path);
        return { data: `https://storage.test/${path}`, error: null };
      },
    }),
    recordView: async () => {
      state.recorded += 1;
      return { data: { inserted: true, viewedAt: "2026-10-26T10:00:00Z" }, error: null };
    },
    listDue: async () => ({ data: due, error: null }),
    removeObjects: async (paths) => {
      state.removed.push(paths);
      return { error: null };
    },
    markPurged: async () => ({ error: null }),
  };
  return { state, handler: createOpenViewOnceHandler(deps) };
}

function post(as: string, body: Record<string, unknown>): Request {
  return new Request("https://edge.test/open-view-once", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${as}` },
    body: JSON.stringify(body),
  });
}

Deno.test("#4114 canonical: the sender's own canonical once/ object opens once", async () => {
  const { state, handler } = world(CANONICAL);
  const response = await handler(post(`user:${FRIEND}`, { message_id: MSG }));
  assertEquals(response.status, 200);
  assertEquals(state.ownerLookups, [CANONICAL]);
  assertEquals(state.signed, [CANONICAL]);
  assertEquals(state.recorded, 1);
});

for (const [label, path] of [
  ["an ordinary (not once/) path", `${CONV}/${OBJ}.jpg`],
  ["a parent segment", `${CONV}/once/../${OBJ}.jpg`],
  ["another conversation's folder", `${OTHER}/once/${OBJ}.jpg`],
  ["a public URL", `https://example.test/${CONV}/once/${OBJ}.jpg`],
] as const) {
  Deno.test(`#4114 canonical: ${label} is refused as expired, nothing looked up or signed`, async () => {
    const { state, handler } = world(path, { [path]: SENDER });
    const response = await handler(post(`user:${FRIEND}`, { message_id: MSG }));
    assertEquals(response.status, 410);
    assertEquals((await response.json()).error, "gone");
    assertEquals(state.signed, []);
    assertEquals(state.recorded, 0);
  });
}

Deno.test("#4114 canonical: an object uploaded by someone else is refused as expired", async () => {
  const { state, handler } = world(CANONICAL, { [CANONICAL]: FRIEND });
  const response = await handler(post(`user:${FRIEND}`, { message_id: MSG }));
  assertEquals(response.status, 410);
  assertEquals((await response.json()).error, "gone");
  assertEquals(state.signed, []);
  assertEquals(state.recorded, 0);
});

Deno.test("#4114 canonical: a missing object (no uploader) is refused as expired", async () => {
  const { state, handler } = world(CANONICAL, {});
  const response = await handler(post(`user:${FRIEND}`, { message_id: MSG }));
  assertEquals(response.status, 410);
  assertEquals(state.signed, []);
  assertEquals(state.recorded, 0);
});

Deno.test("#4114 canonical: the sweep deletes only canonical paths", async () => {
  const due: DueRow[] = [
    { message_id: MSG, storage_path: CANONICAL, reason: "opened" },
    { message_id: null, storage_path: `${CONV}/../${OBJ}.jpg`, reason: "orphan" },
    { message_id: null, storage_path: `${CONV}/${OBJ}.JPG`, reason: "orphan" },
  ];
  const { state, handler } = world(CANONICAL, {}, due);
  const response = await handler(post("service-role", { action: "sweep" }));
  assertEquals(response.status, 200);
  assertEquals(state.removed, [[CANONICAL]]);
});

Deno.test("#4114 canonical: parseAttachmentPath matches the SQL shape exactly", () => {
  assertEquals(parseAttachmentPath(CANONICAL), { conversationId: CONV, once: true });
  assertEquals(parseAttachmentPath(`${CONV}/${OBJ}.pdf`), { conversationId: CONV, once: false });
  for (const bad of [
    `${CONV}/once//${OBJ}.jpg`, `${CONV}/once/./${OBJ}.jpg`, `${CONV}/once/${OBJ}%2Ejpg`,
    `${CONV}/once/${OBJ.toUpperCase()}.jpg`, `${CONV}/once/${OBJ}.jpg/`, `${CONV}/once/${OBJ}.jpg?x=1`,
    `/${CONV}/${OBJ}.jpg`, `${CONV}/${OBJ}.toolongext`, `${CONV}/once/once/${OBJ}.jpg`,
  ]) {
    assert(parseAttachmentPath(bad) === null, `refused: ${bad}`);
  }
});
