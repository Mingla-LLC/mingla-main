// Issue #4422 — the unreached-guest alert helper shared by rsvp-notify and
// notification-retry-sweeper: one email per claim, ids and codes only, and a
// failure is reported, never swallowed.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  alertUnreachedGuests,
  type UnreachedAlertClient,
} from "../unreachedGuestAlert.ts";
import type { OpsAlertEmailInput } from "../stripeOpsAlertEmail.ts";

function client(
  data: unknown,
  error: { code?: string } | null = null,
  calls: Array<Record<string, unknown>> = [],
): UnreachedAlertClient {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, ...args });
      return Promise.resolve({ data, error });
    },
  };
}

const rows = [
  {
    subject_id: "bbbbbbbb-0000-4000-8000-000000000002",
    event_id: "eeeeeeee-0000-4000-8000-000000000001",
    codes: "email_bounced_permanent,provider_unavailable",
  },
  {
    subject_id: "aaaaaaaa-0000-4000-8000-000000000001",
    event_id: null,
    codes: null,
  },
];

Deno.test("#4422 ticket buyers not reached: one email, ids and codes, stable key", async () => {
  const sent: OpsAlertEmailInput[] = [];
  const calls: Array<Record<string, unknown>> = [];
  const outcome = await alertUnreachedGuests(
    client(rows, null, calls),
    "ticket",
    {
      send: (input) => {
        sent.push(input);
        return Promise.resolve({ attempted: 1, succeeded: 1, failed: 0 });
      },
      recipients: () => ["ops@example.invalid"],
    },
  );
  assertEquals(outcome, "sent");
  assertEquals(calls, [{
    name: "issue_4422_claim_unreached_guest_alerts",
    p_source: "ticket",
    p_limit: 50,
  }]);
  assertEquals(sent.length, 1);
  assertEquals(sent[0].subject, "Ticket buyers not reached (2)");
  assertEquals(sent[0].paragraphs.slice(1), [
    "bbbbbbbb · event eeeeeeee-0000-4000-8000-000000000001 · email_bounced_permanent,provider_unavailable",
    "aaaaaaaa · event unknown · no code",
  ]);
  // The key is over the SORTED ids, so the same claim always maps to one key.
  const again: OpsAlertEmailInput[] = [];
  await alertUnreachedGuests(client([...rows].reverse()), "ticket", {
    send: (input) => {
      again.push(input);
      return Promise.resolve({ attempted: 1, succeeded: 1, failed: 0 });
    },
    recipients: () => ["ops@example.invalid"],
  });
  assertEquals(again[0].idempotencyKey, sent[0].idempotencyKey);
  assertEquals(sent[0].idempotencyKey?.startsWith("issue4422:ticket:"), true);
});

Deno.test("#4422 nothing to alert sends nothing", async () => {
  let sends = 0;
  const outcome = await alertUnreachedGuests(client([]), "rsvp", {
    send: () => {
      sends += 1;
      return Promise.resolve({ attempted: 0, succeeded: 0, failed: 0 });
    },
  });
  assertEquals(outcome, "none");
  assertEquals(sends, 0);
});

Deno.test("#4422 a failed send or claim is reported, not swallowed", async () => {
  const errors: string[] = [];
  const previous = console.error;
  console.error = (...args: unknown[]) =>
    errors.push(args.map(String).join(" "));
  try {
    const failed = await alertUnreachedGuests(client(rows), "rsvp", {
      send: () => Promise.resolve({ attempted: 1, succeeded: 0, failed: 1 }),
      recipients: () => ["ops@example.invalid"],
    });
    assertEquals(failed, "send_failed");
    const claimFailed = await alertUnreachedGuests(
      client(null, { code: "PGRST202" }),
      "rsvp",
    );
    assertEquals(claimFailed, "claim_failed");
  } finally {
    console.error = previous;
  }
  assertEquals(
    errors.some((line) => line.includes("unreached_guest_alert_failed")),
    true,
  );
  assertEquals(
    errors.some((line) => line.includes("unreached_guest_alert_claim_failed")),
    true,
  );
});
