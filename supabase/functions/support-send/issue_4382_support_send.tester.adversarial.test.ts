// #4382 — independent tester adversarial proof for support-send's request
// shaping (sendLogic.ts). The implementor's suite covers the happy shapes;
// this one feeds the parser what a hostile or broken client would send.
// MINGLA-INVARIANT: I-4382-TESTER-SEND-PARSER-HOSTILE | issue #4382 | support-send refuses truthy-but-not-boolean isInternal, more than 11 distinct files, a wait on a note or in the past, and never echoes an unknown database error to the caller.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  mapPostError,
  MAX_ATTACHMENTS,
  parseSendRequest,
  staffOnlyViolation,
} from "./sendLogic.ts";

const TICKET = "4382f000-0000-4000-8000-000000000101";
const NOW = Date.parse("2026-11-10T12:00:00Z");
const id = (n: number) =>
  `4382f000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

Deno.test("#4382 tester: a string 'true' or 1 is not an internal-note flag", () => {
  for (const isInternal of ["true", 1, "yes", {}, []]) {
    const parsed = parseSendRequest({
      ticketId: TICKET,
      content: "hi",
      isInternal,
    }, NOW);
    assertEquals(parsed.ok, false, `isInternal=${JSON.stringify(isInternal)}`);
  }
  const parsed = parseSendRequest({
    ticketId: TICKET,
    content: "hi",
    isInternal: false,
  }, NOW);
  assert(parsed.ok && parsed.value.isInternal === false);
});

Deno.test("#4382 tester: 12 distinct files are refused, 12 copies of one file are one file", () => {
  const twelve = Array.from(
    { length: MAX_ATTACHMENTS + 1 },
    (_, i) => id(i + 1),
  );
  const refused = parseSendRequest(
    { ticketId: TICKET, attachmentIds: twelve },
    NOW,
  );
  assert(!refused.ok && refused.error === "too_many_attachments");
  const dupes = Array.from(
    { length: 12 },
    (_, i) => (i % 2 ? id(7).toUpperCase() : id(7)),
  );
  const accepted = parseSendRequest(
    { ticketId: TICKET, attachmentIds: dupes },
    NOW,
  );
  assert(accepted.ok);
  if (accepted.ok) assertEquals(accepted.value.attachmentIds, [id(7)]);
});

Deno.test("#4382 tester: malformed ids and whitespace-only bodies never reach the database", () => {
  for (
    const body of [
      { ticketId: `${TICKET}' OR 1=1 --`, content: "x" },
      { ticketId: TICKET, attachmentIds: ["../../other-ticket/file.png"] },
      { ticketId: TICKET, attachmentIds: id(1) },
      { ticketId: TICKET, content: "   \n\t  " },
      null,
      "ticketId",
    ]
  ) {
    assertEquals(parseSendRequest(body, NOW).ok, false, JSON.stringify(body));
  }
});

Deno.test("#4382 tester: Send and wait refuses a past, unparseable or note-borne promise", () => {
  const cases: [Record<string, unknown>, string][] = [
    [
      { nextUpdateAt: "2026-11-10T11:59:59Z", note: "later" },
      "next_update_must_be_future",
    ],
    [
      { nextUpdateAt: "tomorrow-ish", note: "later" },
      "next_update_must_be_future",
    ],
    [
      { nextUpdateAt: "2026-11-11T12:00:00Z", note: "   " },
      "next_update_note_required",
    ],
  ];
  for (const [setWaiting, error] of cases) {
    const parsed = parseSendRequest({
      ticketId: TICKET,
      content: "hi",
      setWaiting,
    }, NOW);
    assert(!parsed.ok && parsed.error === error, JSON.stringify(setWaiting));
  }
  const onNote = parseSendRequest({
    ticketId: TICKET,
    content: "hi",
    isInternal: true,
    setWaiting: { nextUpdateAt: "2026-11-11T12:00:00Z", note: "later" },
  }, NOW);
  assert(!onNote.ok && onNote.error === "wait_needs_a_customer_reply");
});

Deno.test("#4382 tester: a customer asking for staff-only options is refused before the write", () => {
  const note = parseSendRequest({
    ticketId: TICKET,
    content: "x",
    isInternal: true,
  }, NOW);
  assert(note.ok);
  if (note.ok) {
    assertEquals(
      staffOnlyViolation(note.value, false),
      "internal_notes_are_staff_only",
    );
    assertEquals(staffOnlyViolation(note.value, true), null);
  }
  const wait = parseSendRequest({
    ticketId: TICKET,
    content: "x",
    setWaiting: { nextUpdateAt: "2026-11-11T12:00:00Z", note: "later" },
  }, NOW);
  assert(wait.ok);
  if (wait.ok) {
    assertEquals(
      staffOnlyViolation(wait.value, false),
      "send_and_wait_is_staff_only",
    );
  }
});

Deno.test("#4382 tester: unknown database errors are not echoed; 40001 is not treated as a retryable conflict", () => {
  const leaky = mapPostError({
    code: "23505",
    message:
      'duplicate key value violates unique constraint "support_attachments_pkey" Key (id)=(secret)',
  });
  assertEquals(leaky, { status: 500, error: "send_failed" });
  assertEquals(
    mapPostError({ code: "40001", message: "could not serialize" }).status,
    500,
  );
  assertEquals(mapPostError({ code: "PT409", message: "ticket_closed" }), {
    status: 409,
    error: "ticket_closed",
  });
  assertEquals(mapPostError(null), { status: 500, error: "send_failed" });
});
