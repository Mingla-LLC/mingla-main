// #4490 P4 — venue-offer-staff: the venue answers hire requests (approve with
// a price change, decline with a reason and dates, queue, more time, release)
// and blocks spaces. Every call acts for the verified staff user; authority is
// checked in the database.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createVenueOfferStaffHandler, type StaffClient } from "./index.ts";

const GROUP = "00000000-4490-4000-8000-0000000000e1";
const VENUE = "00000000-4490-4000-8000-0000000000a1";
const SPACE = "00000000-4490-4000-8000-0000000000b1";
const STAFF = "00000000-4490-4000-8000-0000000000f1";

type Call = { name: string; params: Record<string, unknown> };

function client(
  calls: Call[],
  result: (name: string) => { data: unknown; error: unknown },
  user: string | null = STAFF,
): () => StaffClient {
  return () => ({
    rpc: (name, params) => {
      calls.push({ name, params });
      return Promise.resolve(result(name) as { data: unknown; error: null });
    },
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: user ? { id: user } : null },
          error: user ? null : new Error("bad"),
        }),
    },
  });
}

function req(body: Record<string, unknown>, auth = true): Request {
  return new Request("http://local/venue-offer-staff", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: "Bearer staff.jwt.sig" } : {}),
    },
    body: JSON.stringify(body),
  });
}

Deno.test("approve with an edited price acts for the verified staff user", async () => {
  const calls: Call[] = [];
  const handle = createVenueOfferStaffHandler({
    client: client(calls, () => ({
      data: { state: "approved_payment_required", depositMinor: 365500000 },
      error: null,
    })),
  });
  const res = await handle(req({
    action: "approve",
    groupId: GROUP,
    expectedVersion: 3,
    idempotencyKey: "approve-key-1",
    quoteEdit: { baseMinor: 680000000, note: "Including the projector" },
    userId: "00000000-0000-4000-8000-000000000bad",
  }));
  assertEquals(res.status, 200);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "issue_4490_manage_request_for");
  // The user comes from the verified JWT, never from the body.
  assertEquals(calls[0].params.p_user_id, STAFF);
  assertEquals(calls[0].params.p_payload, {
    quoteEdit: { baseMinor: 680000000, note: "Including the projector" },
  });
  assertEquals(calls[0].params.p_expected_version, 3);
});

Deno.test("no JWT or an invalid JWT never reaches the database", async () => {
  const calls: Call[] = [];
  const handle = createVenueOfferStaffHandler({
    client: client(calls, () => ({ data: {}, error: null }), null),
  });
  assertEquals(
    (await handle(req({ action: "queue" }, false))).status,
    401,
  );
  assertEquals(
    (await handle(req({
      action: "queue",
      groupId: GROUP,
      expectedVersion: 1,
      idempotencyKey: "queue-key-1",
    }))).status,
    401,
  );
  assertEquals(calls.length, 0);
});

Deno.test("decline needs a reason; dates are YYYY-MM-DD, at most 3", async () => {
  const calls: Call[] = [];
  const handle = createVenueOfferStaffHandler({
    client: client(calls, () => ({ data: { state: "declined" }, error: null })),
  });
  const base = {
    action: "decline",
    groupId: GROUP,
    expectedVersion: 2,
    idempotencyKey: "decline-key-1",
  };
  assertEquals((await handle(req({ ...base, reason: "no" }))).status, 400);
  assertEquals(
    (await handle(req({
      ...base,
      reason: "We have a wedding",
      alternatives: ["13 Dec"],
    }))).status,
    400,
  );
  const ok = await handle(req({
    ...base,
    reason: "We have a wedding",
    alternatives: ["2026-12-20"],
  }));
  assertEquals(ok.status, 200);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].params.p_payload, {
    reason: "We have a wedding",
    alternatives: ["2026-12-20"],
  });
});

Deno.test("more time is 12, 24 or 48 hours only", async () => {
  const calls: Call[] = [];
  const handle = createVenueOfferStaffHandler({
    client: client(calls, () => ({ data: {}, error: null })),
  });
  const base = {
    action: "extend_hold",
    groupId: GROUP,
    expectedVersion: 2,
    idempotencyKey: "extend-key-1",
  };
  assertEquals((await handle(req({ ...base, hours: 10 }))).status, 400);
  assertEquals((await handle(req({ ...base, hours: 24 }))).status, 200);
  assertEquals(calls[0].params.p_payload, { hours: 24 });
});

Deno.test("a clash or the day's entry limit come back as plain codes", async () => {
  const handle = createVenueOfferStaffHandler({
    client: client([], () => ({
      data: null,
      error: {
        code: "PT409",
        message: "offer_capacity_conflict",
        details:
          '{"localDate":"2026-12-12","poolName":"Day","sold":60,"limitAfterHire":50}',
      },
    })),
  });
  const res = await handle(req({
    action: "approve",
    groupId: GROUP,
    expectedVersion: 1,
    idempotencyKey: "approve-key-2",
  }));
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.code, "offer_capacity_conflict");
  assertEquals(body.detail.limitAfterHire, 50);

  const taken = createVenueOfferStaffHandler({
    client: client([], () => ({
      data: null,
      error: { code: "PT409", message: "offer_space_taken" },
    })),
  });
  const res2 = await taken(req({
    action: "approve",
    groupId: GROUP,
    expectedVersion: 1,
    idempotencyKey: "approve-key-3",
  }));
  assertEquals(res2.status, 409);
  assertEquals((await res2.json()).code, "offer_space_taken");

  const raw = createVenueOfferStaffHandler({
    client: client([], () => ({
      data: null,
      error: { code: "XX000", message: "some internal failure detail" },
    })),
  });
  const res3 = await raw(req({
    action: "queue",
    groupId: GROUP,
    expectedVersion: 1,
    idempotencyKey: "queue-key-2",
  }));
  assertEquals(res3.status, 500);
  assertEquals((await res3.json()).code, "staff_action_failed");
});

Deno.test("block takes spaces or one combination, and a time range", async () => {
  const calls: Call[] = [];
  const handle = createVenueOfferStaffHandler({
    client: client(calls, () => ({ data: { claimIds: [] }, error: null })),
  });
  const base = {
    action: "block",
    venueId: VENUE,
    idempotencyKey: "block-key-1",
  };
  assertEquals(
    (await handle(req({ ...base, from: "2026-12-12T18:00:00Z", to: "x" })))
      .status,
    400,
  );
  assertEquals(
    (await handle(req({
      ...base,
      spaceIds: [SPACE],
      combinationId: SPACE,
      from: "2026-12-12T18:00:00Z",
      to: "2026-12-12T23:00:00Z",
    }))).status,
    400,
  );
  const ok = await handle(req({
    ...base,
    spaceIds: [SPACE],
    from: "2026-12-12T18:00:00Z",
    to: "2026-12-12T23:00:00Z",
    reason: "Deep clean",
  }));
  assertEquals(ok.status, 200);
  assertEquals(calls[0].name, "issue_4490_manage_block_for");
  assertEquals(calls[0].params.p_user_id, STAFF);
  assert((calls[0].params.p_payload as Record<string, unknown>).reason);
});
