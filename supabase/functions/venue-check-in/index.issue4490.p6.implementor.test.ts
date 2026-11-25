// #4490 P6 — venue-check-in: a member from the list (guests on guest passes),
// for the verified staff member; plain-word codes when the day is full or
// the passes are used up.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type CheckInClient, createVenueCheckInHandler } from "./index.ts";

const VENUE = "00000000-4490-4000-8000-0000000000a1";
const SUB = "00000000-4490-4000-8000-0000000000d6";
const STAFF = "00000000-4490-4000-8000-0000000000f1";

type Call = { name: string; params: Record<string, unknown> };

function client(
  calls: Call[],
  result: (name: string) => { data: unknown; error: unknown },
): () => CheckInClient {
  return () => ({
    rpc: (name, params) => {
      calls.push({ name, params });
      return Promise.resolve(result(name) as { data: unknown; error: null });
    },
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: STAFF } }, error: null }),
    },
  });
}

function req(body: Record<string, unknown>): Request {
  return new Request("http://local/venue-check-in", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer staff.jwt.sig" },
    body: JSON.stringify(body),
  });
}

Deno.test("admit_member lets a member in from the list as the verified staff member", async () => {
  const calls: Call[] = [];
  const res = await createVenueCheckInHandler({
    client: client(calls, () => ({ data: { result: "admitted", admitted: 2, kind: "member" }, error: null })),
  })(req({ action: "admit_member", venueId: VENUE, subscriptionId: SUB, guests: 1 }));
  assertEquals(res.status, 200);
  assertEquals(calls[0], {
    name: "issue_4490_check_in_member",
    params: { p_venue_id: VENUE, p_subscription_id: SUB, p_guests: 1, p_scanner_user_id: STAFF },
  });
});

Deno.test("admit_member refuses bad input before the database", async () => {
  const calls: Call[] = [];
  const handle = createVenueCheckInHandler({ client: client(calls, () => ({ data: null, error: null })) });
  assertEquals((await handle(req({ action: "admit_member", venueId: VENUE, subscriptionId: "x" }))).status, 400);
  assertEquals((await handle(req({ action: "admit_member", venueId: VENUE, subscriptionId: SUB, guests: 21 }))).status, 400);
  assertEquals(calls.length, 0);
});

Deno.test("a full day or used-up guest passes come back as plain codes", async () => {
  const full = await createVenueCheckInHandler({
    client: client([], () => ({
      data: null,
      error: { code: "PT409", message: "member_guests_day_full", details: '{"left":1}' },
    })),
  })(req({ action: "admit_member", venueId: VENUE, subscriptionId: SUB, guests: 3 }));
  assertEquals(full.status, 409);
  assertEquals(await full.json(), { code: "member_guests_day_full", left: 1 });
  const passes = await createVenueCheckInHandler({
    client: client([], () => ({
      data: null,
      error: { code: "PT409", message: "member_guest_passes_used_up", details: '{"left":0}' },
    })),
  })(req({ action: "admit_member", venueId: VENUE, subscriptionId: SUB, guests: 1 }));
  assertEquals((await passes.json()).code, "member_guest_passes_used_up");
});
