// Issue #4422 — an RSVP text held by the Nigerian operator embargo comes back
// from the dispatcher as `deferred` with the window-reopen instant, never as
// `retryable` (which burned the RSVP retry ladder and dropped the text).
//
// Runs the real dispatchRsvpChannel and the real SMS adapter with the clock
// pinned inside and outside the embargo. Only Deno.env and fetch are replaced;
// any outbound request fails the test.
//
// fails-on-revert: map `deferred` back to `outcome: "retryable"` in
// dispatchRsvpChannel and the first test reds.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  dispatchRsvpChannel,
  type MinimalClient,
  type RsvpChannelInput,
} from "../notifyV2.ts";
import {
  __setNgEmbargoClock,
  nextNgGenericWindowOpen,
} from "../ngSmsEmbargo.ts";

const env: Record<string, string> = {
  SMS_LIVE_ENABLED_NG: "true",
  TERMII_API_KEY: "fixture-only",
};

function fakeClient(calls: string[]): MinimalClient {
  return {
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: table === "notification_categories"
                  ? {
                    key: "rsvp_pass",
                    active: true,
                    default_channels: ["inapp", "push", "email", "sms"],
                  }
                  : null,
                error: null,
              }),
          }),
        }),
        insert: () =>
          Object.assign(Promise.resolve({ data: null, error: null }), {}),
      };
    },
    rpc(fn: string) {
      calls.push(fn);
      return Promise.resolve({ data: true, error: null });
    },
  };
}

const input: RsvpChannelInput = {
  channel: "sms",
  user_id: null,
  contact: "+2348030000001",
  category_key: "rsvp_pass",
  payload: { brandName: "Fixture host" },
  idempotency_key: "fixture-key",
  title: "t",
  body: "b",
  sms_body:
    "Mingla: You RSVP'd to Fixture, Fri 27 Nov. Here's your pass: usemingla.com/c/ABCDEFGHJK",
  deep_link: "https://usemingla.com",
  delivery_id: "fixture-delivery",
  lease_id: "fixture-lease",
};

async function withFixture<T>(at: Date, work: () => Promise<T>): Promise<T> {
  const previousGet = Deno.env.get;
  const previousFetch = globalThis.fetch;
  Deno.env.get = (name: string) => env[name];
  globalThis.fetch = () => {
    throw new Error("Unexpected external request blocked");
  };
  __setNgEmbargoClock(() => at);
  try {
    return await work();
  } finally {
    __setNgEmbargoClock(null);
    Deno.env.get = previousGet;
    globalThis.fetch = previousFetch;
  }
}

Deno.test("#4422 a held Nigerian RSVP text is deferred to the window reopen, not retryable", async () => {
  // 23:00 WAT on 11 Nov = 22:00 UTC.
  const at = new Date("2026-11-11T22:00:00.000Z");
  const calls: string[] = [];
  const result = await withFixture(
    at,
    () => dispatchRsvpChannel(fakeClient(calls), input),
  );
  assertEquals(result.outcome, "deferred");
  assertEquals(result.providerMessageId, null);
  assertEquals(result.safeCode, "ng_operator_embargo");
  assertEquals(result.nextAttemptAt, nextNgGenericWindowOpen(at).toISOString());
  assertEquals(result.nextAttemptAt, "2026-11-12T07:00:00.000Z");
  assert(
    !calls.includes("mark_rsvp_notification_provider_io"),
    "a deferral must not mark provider I/O",
  );
});

Deno.test("#4422 every other RSVP outcome carries no reopen instant", async () => {
  const at = new Date("2026-11-11T22:00:00.000Z");
  const result = await withFixture(
    at,
    () =>
      dispatchRsvpChannel(fakeClient([]), {
        ...input,
        contact: null,
      }),
  );
  assertEquals(result.outcome, "terminal");
  assertEquals(result.nextAttemptAt, null);
});
