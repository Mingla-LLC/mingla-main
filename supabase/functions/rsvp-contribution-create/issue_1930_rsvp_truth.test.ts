import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("#1930 RSVP contribution retries require caller identity", () => {
  assertStringIncludes(source, "callerIdempotencyKey");
  assertStringIncludes(source, "caller_idempotency_key");
  assert(!source.includes("mingla_contrib_${contributionId.replaceAll(\"-\", \"\")}_${Date.now()"));
});

Deno.test("#1930 RSVP revalidates immediately before both provider rails", () => {
  const guard = "contributionStillAuthorized(supabase, contributionId, eventId)";
  assert(source.split(guard).length - 1 >= 3);
  assert(
    source.indexOf(guard, source.indexOf("let init:")) <
      source.indexOf("await paystackInitializeTransaction"),
  );
  assertStringIncludes(source, 'visibility, deleted_at');
  assertStringIncludes(source, '"checkout_unavailable"');
});

// ── Chip-in → RSVP linkage ──────────────────────────────────────────────────
// Production 2026-09-15: every paid contribution had rsvp_id NULL because the
// handler persisted the raw body.rsvpId and no caller sent one. The host guest
// console attaches a contribution (and its refund control) to a guest through
// rsvp_id, so none of them showed. The server now resolves and verifies it.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  escapeLikePattern,
  resolveContributionRsvpId,
  type RsvpLinkReader,
  type RsvpLinkRow,
  rsvpBelongsToBuyer,
  supabaseRsvpLinkReader,
} from "./rsvpLink.ts";

const EVENT = "413fdcd0-5f33-40dc-b5a4-6a93897db01f";
const OTHER_EVENT = "8b84539d-cb88-43db-8d49-1af7e1ecfdf4";
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";

function fakeReader(rows: RsvpLinkRow[]): RsvpLinkReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    byId(id) {
      calls.push("byId");
      return Promise.resolve(rows.find((r) => r.id === id) ?? null);
    },
    byUser(eventId, userId) {
      calls.push("byUser");
      return Promise.resolve(
        rows.filter((r) => r.event_id === eventId && r.user_id === userId),
      );
    },
    byEmail(eventId, email) {
      calls.push("byEmail");
      return Promise.resolve(
        rows.filter((r) =>
          r.event_id === eventId && r.guest_email?.toLowerCase() === email
        ),
      );
    },
  };
}

const anonRsvp: RsvpLinkRow = {
  id: "f5f75b6a-3cd8-4056-a0f8-aaa4ba74482b",
  event_id: EVENT,
  user_id: null,
  guest_email: "Guest@Example.com",
};
const accountRsvp: RsvpLinkRow = {
  id: "bad493f6-6f6d-44b9-aa4c-b724e8703103",
  event_id: EVENT,
  user_id: USER,
  guest_email: "member@example.com",
};
const otherEventRsvp: RsvpLinkRow = {
  id: "6c381471-bf01-48c6-b905-e6a142b8c7b1",
  event_id: OTHER_EVENT,
  user_id: null,
  guest_email: "guest@example.com",
};

Deno.test("chip-in link: anonymous web guest with no rsvpId links by email (the production case)", async () => {
  const result = await resolveContributionRsvpId(
    fakeReader([anonRsvp, accountRsvp, otherEventRsvp]),
    { eventId: EVENT, userId: null, guestEmail: "  guest@example.COM ", claimedRsvpId: null },
  );
  assertEquals(result, { rsvpId: anonRsvp.id, source: "email", claimRejected: false });
});

Deno.test("chip-in link: signed-in buyer with rsvpId null (native app) links by account", async () => {
  const result = await resolveContributionRsvpId(
    fakeReader([anonRsvp, accountRsvp]),
    { eventId: EVENT, userId: USER, guestEmail: null, claimedRsvpId: null },
  );
  assertEquals(result, { rsvpId: accountRsvp.id, source: "user", claimRejected: false });
});

Deno.test("chip-in link: a claimed rsvpId is used only when it is this buyer's RSVP on this event", async () => {
  const reader = fakeReader([anonRsvp, accountRsvp, otherEventRsvp]);
  assertEquals(
    await resolveContributionRsvpId(reader, {
      eventId: EVENT, userId: null, guestEmail: "guest@example.com", claimedRsvpId: anonRsvp.id,
    }),
    { rsvpId: anonRsvp.id, source: "claimed", claimRejected: false },
  );
  // Another event's RSVP is never trusted; the buyer's own RSVP still links.
  assertEquals(
    await resolveContributionRsvpId(reader, {
      eventId: EVENT, userId: null, guestEmail: "guest@example.com", claimedRsvpId: otherEventRsvp.id,
    }),
    { rsvpId: anonRsvp.id, source: "email", claimRejected: true },
  );
  // Someone else's RSVP id is rejected, and nothing else matches this buyer.
  assertEquals(
    await resolveContributionRsvpId(reader, {
      eventId: EVENT, userId: OTHER_USER, guestEmail: "stranger@example.com", claimedRsvpId: accountRsvp.id,
    }),
    { rsvpId: null, source: "none", claimRejected: true },
  );
});

Deno.test("chip-in link: an email never links an anonymous buyer to an account-held RSVP", async () => {
  const reader = fakeReader([accountRsvp]);
  assertEquals(
    await resolveContributionRsvpId(reader, {
      eventId: EVENT, userId: null, guestEmail: "member@example.com", claimedRsvpId: accountRsvp.id,
    }),
    { rsvpId: null, source: "none", claimRejected: true },
  );
  assertEquals(rsvpBelongsToBuyer(accountRsvp, {
    eventId: EVENT, userId: USER, guestEmail: null, claimedRsvpId: null,
  }), true);
});

Deno.test("chip-in link: ambiguous, malformed, missing or failed lookups stay unlinked without throwing", async () => {
  const duplicate = { ...anonRsvp, id: "33333333-3333-4333-8333-333333333333" };
  assertEquals(
    (await resolveContributionRsvpId(fakeReader([anonRsvp, duplicate]), {
      eventId: EVENT, userId: null, guestEmail: "guest@example.com", claimedRsvpId: null,
    })).rsvpId,
    null,
  );
  const malformed = fakeReader([anonRsvp]);
  const rejected = await resolveContributionRsvpId(malformed, {
    eventId: EVENT, userId: null, guestEmail: null, claimedRsvpId: "not-a-uuid",
  });
  assertEquals(rejected, { rsvpId: null, source: "none", claimRejected: true });
  assertEquals(malformed.calls, []);
  const failing: RsvpLinkReader = {
    byId: () => Promise.resolve(null),
    byUser: () => Promise.resolve([]),
    byEmail: () => Promise.resolve([]),
  };
  assertEquals(
    await resolveContributionRsvpId(failing, {
      eventId: EVENT, userId: USER, guestEmail: "guest@example.com", claimedRsvpId: anonRsvp.id,
    }),
    { rsvpId: null, source: "none", claimRejected: true },
  );
});

Deno.test("chip-in link: supabase reader matches the email literally and swallows read errors", async () => {
  const filters: Array<[string, string, string]> = [];
  const builder = (result: { data: unknown; error: unknown }) => {
    const chain: Record<string, unknown> = {};
    for (const op of ["select", "eq", "ilike", "limit"]) {
      chain[op] = (col: string, value: string) => {
        if (op === "eq" || op === "ilike") filters.push([op, col, value]);
        return op === "limit" ? Promise.resolve(result) : chain;
      };
    }
    chain.maybeSingle = () => Promise.resolve(result);
    return chain;
  };
  const ok = supabaseRsvpLinkReader({
    from: (table: string) => {
      assertEquals(table, "event_rsvps");
      return builder({ data: [anonRsvp], error: null });
    },
  });
  assertEquals(await ok.byEmail(EVENT, "first_last%x@example.com"), [anonRsvp]);
  assertEquals(filters, [
    ["eq", "event_id", EVENT],
    ["ilike", "guest_email", "first\\_last\\%x@example.com"],
  ]);
  assertEquals(escapeLikePattern("a\\b"), "a\\\\b");
  const broken = supabaseRsvpLinkReader({
    from: () => builder({ data: null, error: { message: "boom" } }),
  });
  assertEquals(await broken.byId(anonRsvp.id), null);
  assertEquals(await broken.byUser(EVENT, USER), []);
  assertEquals(await broken.byEmail(EVENT, "guest@example.com"), []);
});

Deno.test("chip-in link: both rails persist the server-resolved rsvp_id, never the raw body value", () => {
  assert(!/const rsvpId\s*=\s*optionalTrimmed\(body\.rsvpId\)/.test(source));
  const resolved = source.indexOf("const rsvpId = rsvpLink.rsvpId;");
  const resolverCall = source.indexOf("await resolveContributionRsvpId(");
  assert(resolverCall > 0 && resolved > resolverCall);
  const inserts = [...source.matchAll(/rsvp_id: rsvpId,/g)].map((m) => m.index ?? -1);
  assertEquals(inserts.length, 2);
  for (const at of inserts) assert(at > resolved);
  assert(source.indexOf('provider: "paystack"') > resolved);
  assert(source.indexOf('provider: "stripe"') > resolved);
});
