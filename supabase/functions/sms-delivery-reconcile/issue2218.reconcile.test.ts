// ===========================================================================
// #2218 T-4 — `sent` STOPS BEING A RESTING STATE.
// ===========================================================================
// Production evidence this suite encodes: of seven SMS rows in
// notification_deliveries, ONE carried a `delivered_at`. A Nigerian send from
// 2026-08-04 with a perfectly ordinary numeric Termii id sat at `sent`,
// delivered_at NULL, failed_reason NULL — indistinguishable, as a database
// state, from a text the recipient was holding in their hand.
//
// The rules asserted here are the ones that make those two states different,
// and every one of them is a rule about NOT GUESSING:
//   • "Message Sent" is not a delivery. It is the provider saying it has no
//     report yet, which is precisely what this sweep exists to distrust.
//   • A failed lookup is not a delivery and not a failure. It is silence, and
//     silence waits for the deadline.
//   • An id we cannot look up gets its OWN terminal reason, distinct from one
//     we asked about properly and got no answer for — an integration fault and
//     a deliverability fault need different people.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  classifyTermiiHistoryStatus,
  deadlineVerdict,
  DELIVERY_CONFIRMATION_DEADLINE_MS,
  findHistoryStatus,
  isPastConfirmationDeadline,
} from "./logic.ts";

Deno.test("#2218 T-4a: only 'Delivered' is a delivery", () => {
  assertEquals(classifyTermiiHistoryStatus("Delivered").kind, "delivered");
  assertEquals(classifyTermiiHistoryStatus("delivered").kind, "delivered");
  assertEquals(classifyTermiiHistoryStatus("  DELIVERED ").kind, "delivered");

  // THE ONE THAT MATTERS MOST. Termii's delivery-report webhook classifies
  // "Message Sent" as success, which is defensible for a report it pushed to
  // us. It is NOT defensible as the answer to a question we asked, because it
  // means exactly "handed on, no report yet" — the state that produced this
  // issue. Treating it as delivered here would rebuild the bug inside its own
  // fix.
  assertEquals(classifyTermiiHistoryStatus("Message Sent").kind, "pending");

  for (const s of [
    "Rejected",
    "Expired",
    "Message Failed",
    "DND Active on Phone Number",
  ]) {
    const v = classifyTermiiHistoryStatus(s);
    assertEquals(v.kind, "failed", `${s} is terminal`);
    assert(v.kind === "failed" && v.reason.startsWith("termii_"));
  }

  // A status Termii adds tomorrow must land in `pending` — honest ignorance —
  // never be pattern-sniffed into a verdict nobody designed.
  assertEquals(classifyTermiiHistoryStatus("Queued For Retry").kind, "pending");
  assertEquals(classifyTermiiHistoryStatus("").kind, "pending");
});

Deno.test("#2218 T-4b: the deadline is 45 minutes and it is measured, not assumed", () => {
  assertEquals(DELIVERY_CONFIRMATION_DEADLINE_MS, 45 * 60 * 1000);
  const now = new Date("2026-08-18T06:00:00Z");
  assertEquals(
    isPastConfirmationDeadline({ sent_at: "2026-08-18T05:10:39Z" }, now),
    true,
    "the founder's confirmation is 49 minutes old and unconfirmed",
  );
  assertEquals(
    isPastConfirmationDeadline({ sent_at: "2026-08-18T05:20:00Z" }, now),
    false,
    "40 minutes is still inside normal Nigerian carrier report lag — declaring " +
      "it failed would corrupt the ledger in the other direction",
  );
  // Exactly on the boundary counts, so a row cannot sit one millisecond short
  // forever.
  assertEquals(
    isPastConfirmationDeadline({ sent_at: "2026-08-18T05:15:00Z" }, now),
    true,
  );
  // No sent_at is not a stale send; it is a row that never claimed one.
  assertEquals(isPastConfirmationDeadline({ sent_at: null }, now), false);
  assertEquals(isPastConfirmationDeadline({ sent_at: "not a date" }, now), false);
});

Deno.test("#2218 T-4c: the two terminal reasons stay distinct", () => {
  const row = {
    id: "n1",
    provider: "termii",
    provider_message_id: "sig_7678b296aa6240b4864a6dcb294124b4",
    sent_at: "2026-08-18T05:10:39Z",
  };
  const unaskable = deadlineVerdict(row, false);
  assertEquals(unaskable.kind, "unreconcilable");
  assert(
    unaskable.kind === "unreconcilable" &&
      unaskable.reason === "provider_message_id_unreconcilable:termii",
    "an id the provider's own APIs will not accept is an INTEGRATION fault — " +
      "an engineer must see it, and it must not read like a bad handset",
  );

  const asked = deadlineVerdict(
    { ...row, provider_message_id: "3017858407816658717238173" },
    true,
  );
  assertEquals(asked.kind, "failed");
  assert(
    asked.kind === "failed" &&
      asked.reason === "delivery_unconfirmed:termii",
    "we asked properly and got no confirmation — a DELIVERABILITY fault, and a " +
      "different person's problem",
  );
  assert(
    unaskable.kind === "unreconcilable" && asked.kind === "failed" &&
      unaskable.reason !== asked.reason,
    "collapsing the two would put the #2218 signal back in the dark within a month",
  );
});

Deno.test("#2218 T-4d: History is matched on the STRING id, never a coerced number", () => {
  // 25 digits. Round-tripping this through float64 yields
  // 3017858407816658700000000 — a different message, or none at all.
  const id = "3017858407816658717238173";
  assertEquals(
    findHistoryStatus([{ message_id: id, status: "Delivered" }], id),
    "Delivered",
  );
  // Termii renders it bare in some responses.
  assertEquals(
    findHistoryStatus({ data: [{ message_id: id, status: "Rejected" }] }, id),
    "Rejected",
  );
  // A neighbouring id that only differs beyond float64 precision must NOT match.
  assertEquals(
    findHistoryStatus(
      [{ message_id: "3017858407816658717238174", status: "Delivered" }],
      id,
    ),
    null,
    "matching the wrong message would stamp delivered_at from someone else's text",
  );
  assertEquals(findHistoryStatus([], id), null);
  assertEquals(findHistoryStatus(null, id), null);
  assertEquals(findHistoryStatus({ message: "no data key" }, id), null);
  assertEquals(
    findHistoryStatus([{ message_id: id, status: "" }], id),
    null,
    "an empty status is not a status",
  );
});
