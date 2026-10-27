// Issue #4114 Wave 4, tester retest 3 — open-view-once canonical paths from
// angles the implementor suite does not cover.
//
//   * parseAttachmentPath refuses upper-case hex in either uuid, an upper-case
//     or double extension, an empty or missing extension, a 9-character
//     extension, Unicode lookalikes, a NUL byte, a trailing newline, a leading
//     space, a backslash separator, an upper-case ONCE folder, an un-hyphenated
//     uuid and very long names; it accepts exactly the canonical shapes.
//   * openOnce never looks up an owner, signs or records a view for any of
//     those names, nor for a legacy http(s) URL in any letter case, even one
//     whose path looks like <conv>/once/<uuid>.jpg.
//   * the owner check: a lookup error never signs (500), an owner that differs
//     only by letter case is not the sender, and the sign step is never reached
//     for a non-canonical path even if a caller skips openOnce's own check.
//   * the sweep never hands a lookalike or legacy URL to the deleter.
//
// FAILS-ON-REVERT: make CANONICAL_ATTACHMENT_PATH case-insensitive or drop its
// anchors, drop the parseAttachmentPath check in createOwnerCheckedSignUrl (the
// openOnce check is a second layer: removing it alone is caught by the signer),
// or compare owners case-insensitively.

import {
  CANONICAL_ATTACHMENT_PATH,
  createOpenViewOnceHandler,
  createOwnerCheckedSignUrl,
  type DueRow,
  type OpenViewOnceDeps,
  parseAttachmentPath,
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

const CONV = "a1a1a1a1-1111-4111-8111-111111111111";
const OBJ = "c3c3c3c3-3333-4333-8333-333333333333";
const MSG = "d4d4d4d4-4444-4444-8444-444444444444";
const SENDER = "e5e5e5e5-5555-4555-8555-555555555555";
const FRIEND = "f6f6f6f6-6666-4666-8666-666666666666";
const CANONICAL = `${CONV}/once/${OBJ}.jpg`;

const FUZZ: string[] = [
  `${CONV.toUpperCase()}/once/${OBJ}.jpg`,
  `${CONV}/once/${OBJ.toUpperCase()}.jpg`,
  `${CONV}/once/${OBJ}.JPG`,
  `${CONV}/once/${OBJ}.jpg.exe`,
  `${CONV}/once/${OBJ}.`,
  `${CONV}/once/${OBJ}`,
  `${CONV}/once/${OBJ}.abcdefghi`,
  `${CONV}/once/${OBJ.replace(/c/g, "с")}.jpg`, // Cyrillic es
  `${CONV}/once/${OBJ}.jp０`, // full-width digit
  `${CONV}∕once∕${OBJ}.jpg`, // division slash
  `${CONV}/once/${OBJ}．jpg`, // full-width dot
  `${CONV}/once/${OBJ}.jpg\u0000`,
  `${CONV}/once/${OBJ}\u0000.jpg`,
  `${CONV}/once/${OBJ}.jpg\n`,
  ` ${CONV}/once/${OBJ}.jpg`,
  `${CONV}\\once\\${OBJ}.jpg`,
  `${CONV}/ONCE/${OBJ}.jpg`,
  `${CONV.replace(/-/g, "")}/once/${OBJ}.jpg`,
  `${CONV}/once/${OBJ}.${"a".repeat(10_000)}`,
  `${CONV}/once/${OBJ.repeat(300)}.jpg`,
  `${CONV}/once/${OBJ}.jpg`.normalize("NFD") + "́",
];

const LEGACY: string[] = [
  `https://example.supabase.co/storage/v1/object/public/messages/${CANONICAL}`,
  `HTTPS://example.supabase.co/${CANONICAL}`,
  `http://example.test/${CANONICAL}`,
];

function world(fileUrl: string, owner: { data: string | null; error: string | null } = { data: SENDER, error: null }, due: DueRow[] = []) {
  const message: ViewOnceMessage = {
    id: MSG, conversation_id: CONV, sender_id: SENDER, message_type: "image",
    file_url: fileUrl, view_once: true, view_once_purged_at: null, deleted_at: null,
  };
  const state = { signed: [] as string[], recorded: 0, lookups: [] as string[], removed: [] as string[][] };
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
        state.lookups.push(path);
        return owner;
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

Deno.test("#4114 retest 3: parseAttachmentPath accepts exactly the canonical shapes", () => {
  assertEquals(parseAttachmentPath(CANONICAL), { conversationId: CONV, once: true }, "canonical once/");
  assertEquals(parseAttachmentPath(`${CONV}/${OBJ}.pdf`), { conversationId: CONV, once: false }, "canonical ordinary");
  assertEquals(parseAttachmentPath(`${CONV}/${OBJ}.abcdefgh`), { conversationId: CONV, once: false }, "8-char extension");
  assert(!CANONICAL_ATTACHMENT_PATH.flags.includes("i"), "the shape is case-sensitive");
  assert(!CANONICAL_ATTACHMENT_PATH.flags.includes("m"), "the anchors are whole-string");
  for (const bad of [...FUZZ, ...LEGACY, "", null, undefined, 42, { toString: () => CANONICAL }]) {
    assert(parseAttachmentPath(bad) === null, `refused: ${JSON.stringify(typeof bad === "string" ? bad.slice(0, 90) : bad)}`);
  }
});

for (const [index, path] of [...FUZZ, ...LEGACY].entries()) {
  Deno.test(`#4114 retest 3: open refuses fuzz/legacy name #${index} with nothing looked up, signed or recorded`, async () => {
    const { state, handler } = world(path);
    const response = await handler(post(`user:${FRIEND}`, { message_id: MSG }));
    assertEquals(response.status, 410, "reads as expired");
    assertEquals((await response.json()).error, "gone", "gone");
    assertEquals(state.lookups, [], "no owner lookup");
    assertEquals(state.signed, [], "nothing signed");
    assertEquals(state.recorded, 0, "no view recorded");
  });
}

Deno.test("#4114 retest 3: an owner lookup error never signs and never records", async () => {
  const { state, handler } = world(CANONICAL, { data: null, error: "rpc failed" });
  const response = await handler(post(`user:${FRIEND}`, { message_id: MSG }));
  assertEquals(response.status, 500, "a failed lookup is a server error, not a signed URL");
  assertEquals(state.signed, [], "nothing signed");
  assertEquals(state.recorded, 0, "no view recorded");
});

Deno.test("#4114 retest 3: an owner differing only by letter case is not the sender", async () => {
  const { state, handler } = world(CANONICAL, { data: SENDER.toUpperCase(), error: null });
  const response = await handler(post(`user:${FRIEND}`, { message_id: MSG }));
  assertEquals(response.status, 410, "refused as expired");
  assertEquals(state.signed, [], "nothing signed");
});

Deno.test("#4114 retest 3: the owner-checked signer refuses a non-canonical path on its own", async () => {
  const lookups: string[] = [];
  const signed: string[] = [];
  const signUrl = createOwnerCheckedSignUrl({
    objectOwner: async (path) => {
      lookups.push(path);
      return { data: SENDER, error: null };
    },
    sign: async (path) => {
      signed.push(path);
      return { data: "x", error: null };
    },
  });
  for (const path of [...FUZZ, ...LEGACY]) {
    const result = await signUrl(path, 60, SENDER);
    assertEquals(result.data, null, `no URL for ${path.slice(0, 60)}`);
  }
  assertEquals(lookups, [], "never looked up");
  assertEquals(signed, [], "never signed");
});

Deno.test("#4114 retest 3: the sweep never hands a lookalike or legacy URL to the deleter", async () => {
  const due: DueRow[] = [
    { message_id: MSG, storage_path: CANONICAL, reason: "opened" },
    ...[...FUZZ, ...LEGACY].map((storage_path) => ({ message_id: null, storage_path, reason: "orphan" })),
  ];
  const { state, handler } = world(CANONICAL, { data: SENDER, error: null }, due);
  const response = await handler(post("service-role", { action: "sweep" }));
  assertEquals(response.status, 200, "sweep runs");
  assertEquals(state.removed, [[CANONICAL]], "only the canonical path is removed");
});
