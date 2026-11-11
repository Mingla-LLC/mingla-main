// #4382 — support-send: files, internal notes, Send and wait, no promise gate.
//
// Replaces issue_3720_next_update_gate (#3720 required a future next-update
// promise before any staff reply; #4382 removes that gate: staff may reply
// with no promise, and "Send and wait" sets one). The display-name and
// dual-role assertions from that file live on here.
//
// Run:
//   deno test --allow-read supabase/functions/support-send/issue_4382_support_send.implementor.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  mapPostError,
  parseSendRequest,
  staffOnlyViolation,
} from "./sendLogic.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const TICKET = "43820000-0000-4000-8000-000000000101";
const FILE_A = "43820000-0000-4000-8000-0000000000f1";
const FILE_B = "43820000-0000-4000-8000-0000000000f2";
const NOW = Date.parse("2026-11-10T12:00:00Z");

Deno.test("a message may be images only; an empty message with no files is refused", () => {
  const imagesOnly = parseSendRequest({
    ticketId: TICKET,
    content: "",
    attachmentIds: [FILE_A, FILE_B],
  }, NOW);
  assert(imagesOnly.ok);
  if (imagesOnly.ok) {
    assertEquals(imagesOnly.value.attachmentIds, [FILE_A, FILE_B]);
  }
  const empty = parseSendRequest({ ticketId: TICKET, content: "   " }, NOW);
  assertEquals(empty, { ok: false, status: 400, error: "content_required" });
});

Deno.test("attachment ids are uuids, de-duplicated and capped at 11", () => {
  assertEquals(
    parseSendRequest({
      ticketId: TICKET,
      content: "x",
      attachmentIds: ["nope"],
    }, NOW),
    { ok: false, status: 400, error: "attachmentIds_invalid" },
  );
  const dup = parseSendRequest({
    ticketId: TICKET,
    content: "x",
    attachmentIds: [FILE_A, FILE_A],
  }, NOW);
  assert(dup.ok && dup.value.attachmentIds.length === 1);
  const many = Array.from(
    { length: 12 },
    (_, i) => `43820000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  );
  assertEquals(
    parseSendRequest(
      { ticketId: TICKET, content: "x", attachmentIds: many },
      NOW,
    ),
    { ok: false, status: 400, error: "too_many_attachments" },
  );
});

Deno.test("Send and wait needs a future time and a note, and is never an internal note", () => {
  const ok = parseSendRequest({
    ticketId: TICKET,
    content: "Settlement lands Friday",
    setWaiting: {
      nextUpdateAt: "2026-11-13T12:00:00Z",
      note: "We will confirm the payout",
    },
  }, NOW);
  assert(
    ok.ok && ok.value.setWaiting?.nextUpdateAt === "2026-11-13T12:00:00.000Z",
  );
  assertEquals(
    parseSendRequest({
      ticketId: TICKET,
      content: "x",
      setWaiting: { nextUpdateAt: "2026-11-09T00:00:00Z", note: "n" },
    }, NOW),
    { ok: false, status: 400, error: "next_update_must_be_future" },
  );
  assertEquals(
    parseSendRequest({
      ticketId: TICKET,
      content: "x",
      setWaiting: { nextUpdateAt: "2026-11-13T00:00:00Z", note: " " },
    }, NOW),
    { ok: false, status: 400, error: "next_update_note_required" },
  );
  assertEquals(
    parseSendRequest({
      ticketId: TICKET,
      content: "x",
      isInternal: true,
      setWaiting: { nextUpdateAt: "2026-11-13T00:00:00Z", note: "n" },
    }, NOW),
    { ok: false, status: 400, error: "wait_needs_a_customer_reply" },
  );
});

Deno.test("internal notes and Send and wait are staff only", () => {
  const note = parseSendRequest({
    ticketId: TICKET,
    content: "private",
    isInternal: true,
  }, NOW);
  assert(note.ok);
  if (!note.ok) return;
  assertEquals(
    staffOnlyViolation(note.value, false),
    "internal_notes_are_staff_only",
  );
  assertEquals(staffOnlyViolation(note.value, true), null);
  assertStringIncludes(
    source,
    "const staffOnly = staffOnlyViolation(send, senderIsStaff)",
  );
  assertStringIncludes(
    source,
    "if (staffOnly) return json({ error: staffOnly }, 403)",
  );
});

Deno.test("database refusals keep their meaning: closed is 409, never 500", () => {
  assertEquals(mapPostError({ code: "PT409", message: "ticket_closed" }), {
    status: 409,
    error: "ticket_closed",
  });
  assertEquals(mapPostError({ code: "42501", message: "forbidden" }), {
    status: 403,
    error: "forbidden",
  });
  assertEquals(
    mapPostError({ code: "22023", message: "attachment_not_available" }),
    { status: 400, error: "attachment_not_available" },
  );
  assertEquals(mapPostError({ code: "XX000", message: "boom" }), {
    status: 500,
    error: "send_failed",
  });
});

Deno.test("the send is one database write and staff replies need no promise", () => {
  assertStringIncludes(source, '"issue_4382_post_support_message"');
  assertStringIncludes(source, "p_attachment_ids: send.attachmentIds");
  assertStringIncludes(source, "p_is_internal: send.isInternal");
  assertStringIncludes(
    source,
    "p_wait_until: send.setWaiting?.nextUpdateAt ?? null",
  );
  assert(
    !source.includes("next_update_required"),
    "the #3720 promise gate is gone",
  );
  assert(!source.includes('.from("messages")'), "no direct message insert");
  // Internal notes notify nobody.
  const gate = source.indexOf("if (result.is_internal !== true)");
  const notify = source.indexOf("/functions/v1/notify-support");
  assert(gate > 0 && notify > gate);
});

Deno.test("a dual-role account uses the explicit surface mode", () => {
  assertStringIncludes(
    source,
    'const senderIsStaff = actorMode === "staff" || (actorMode === null && !isRequester && isStaff)',
  );
  assertStringIncludes(
    source,
    'if (actorMode === "staff" && !isStaff) return json({ error: "Forbidden" }, 403)',
  );
  assertStringIncludes(
    source,
    "const isRequester = isDirectRequester || isBrandRequester",
  );
  assertStringIncludes(source, 'ticket.visibility !== "internal" &&');
});

Deno.test("staff sender display name skips email-shaped candidates", () => {
  assertStringIncludes(source, '!value.includes("@")');
  const pick = source.indexOf("senderDisplayName = [");
  const fallback = source.indexOf('?? "Mingla teammate"', pick);
  assert(pick >= 0 && fallback > pick);
  assert(source.slice(pick, fallback).includes('!value.includes("@")'));
});
