// #4490 M — the door accepts the member's six-character fallback code,
// normalises its display spacing and returns the exact safe rate-limit code.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type CheckInClient, createVenueCheckInHandler } from "./index.ts";

const VENUE = "00000000-4490-4000-8000-0000000000a1";
const STAFF = "00000000-4490-4000-8000-0000000000f1";

type Call = { name: string; params: Record<string, unknown> };

function client(
  calls: Call[],
  result: () => { data: unknown; error: unknown },
): () => CheckInClient {
  return () => ({
    rpc: (name, params) => {
      calls.push({ name, params });
      return Promise.resolve(result() as { data: unknown; error: null });
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
    headers: {
      "content-type": "application/json",
      authorization: "Bearer staff.jwt.sig",
    },
    body: JSON.stringify(body),
  });
}

Deno.test("admit_code normalises display spacing before the venue-local RPC", async () => {
  const calls: Call[] = [];
  const response = await createVenueCheckInHandler({
    client: client(calls, () => ({
      data: { result: "admitted", kind: "member", admitted: 1 },
      error: null,
    })),
  })(req({ action: "admit_code", venueId: VENUE, memberCode: "k7p-4qx" }));

  assertEquals(response.status, 200);
  assertEquals(calls, [{
    name: "issue_4490_admit_member_by_code",
    params: {
      p_venue_id: VENUE,
      p_code: "K7P4QX",
      p_guests: 0,
      p_scanner_user_id: STAFF,
    },
  }]);
});

Deno.test("admit_code refuses ambiguous, short and excessive-guest input before the database", async () => {
  const calls: Call[] = [];
  const handle = createVenueCheckInHandler({
    client: client(calls, () => ({ data: null, error: null })),
  });
  assertEquals(
    (await handle(
      req({ action: "admit_code", venueId: VENUE, memberCode: "I0O1AA" }),
    )).status,
    400,
  );
  assertEquals(
    (await handle(
      req({ action: "admit_code", venueId: VENUE, memberCode: "K7P4Q" }),
    )).status,
    400,
  );
  assertEquals(
    (await handle(
      req({
        action: "admit_code",
        venueId: VENUE,
        memberCode: "K7P4QX",
        guests: 21,
      }),
    )).status,
    400,
  );
  assertEquals(calls.length, 0);
});

Deno.test("admit_code returns the safe 429 refusal after repeated misses", async () => {
  const response = await createVenueCheckInHandler({
    client: client([], () => ({
      data: null,
      error: { code: "PT429", message: "member_code_rate_limited" },
    })),
  })(req({ action: "admit_code", venueId: VENUE, memberCode: "K7P4QX" }));

  assertEquals(response.status, 429);
  assertEquals(await response.json(), { code: "member_code_rate_limited" });
});
