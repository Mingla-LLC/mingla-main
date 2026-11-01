import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const SOURCE = Deno.readTextFileSync(
  new URL("../index.ts", import.meta.url),
);

Deno.test("#4063 identity sweeps use their separate admission budget", () => {
  assertStringIncludes(SOURCE, 'p_kind: "identity"');
  assert(
    !SOURCE.includes('p_kind: "order"'),
    "the broad identity sweep must not consume the token-claim budget",
  );
});

Deno.test("#4063 returns the complete bounded sweep result", () => {
  const response = SOURCE.slice(SOURCE.indexOf("return json(200, {"));
  for (
    const field of [
      "count: claimed.length",
      "eventIds",
      "claims",
      "claimed",
      "more: result?.more === true",
    ]
  ) {
    assertStringIncludes(response, field);
  }
});

Deno.test("#4063 preserves order-only legacy fields", () => {
  assertStringIncludes(
    SOURCE,
    'entry.kind === "order" && typeof entry.eventId === "string"',
  );
  assertStringIncludes(SOURCE, "orderId: typeof entry.orderId");
  assertStringIncludes(SOURCE, "eventId: entry.eventId");
  assertStringIncludes(SOURCE, "chatJoined: entry.chatJoined === true");
  assertStringIncludes(SOURCE, "conversationId: typeof entry.conversationId");
});

Deno.test("#4063 success reflects every claimed kind, not only orders", () => {
  assertStringIncludes(
    SOURCE,
    'outcome = claimed.length > 0 ? "success" : "idempotent_success";',
  );
  assert(
    !SOURCE.includes(
      'outcome = eventIds.length > 0 ? "success" : "idempotent_success";',
    ),
    "a non-order claim must still record success",
  );
});

Deno.test("#4202 retained purchase history reconnects after usable admission claims", () => {
  const liveSweep = SOURCE.indexOf('"claim_attendance_by_verified_identity"');
  const retainedHistory = SOURCE.indexOf(
    '"issue_4202_reconnect_retained_orders"',
  );
  assert(liveSweep >= 0, "the usable-admission sweep must remain present");
  assert(
    retainedHistory > liveSweep,
    "history must reconnect only after the live sweep claims admission inventory",
  );
  assertStringIncludes(SOURCE, "if (retainedHistoryError) throw retainedHistoryError;");
});
