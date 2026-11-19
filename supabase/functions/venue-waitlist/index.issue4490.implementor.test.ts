// #4490 P5 — venue-waitlist: a guest joins with no account, reads and leaves
// their place only with the private token (or as the signed-in guest who
// joined). The token is returned once and only its SHA-256 reaches the
// database.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createVenueWaitlistHandler,
  randomWaitlistToken,
  WAITLIST_TOKEN_RE,
  type WaitlistClient,
  waitlistTokenHashParam,
} from "./index.ts";

const VENUE = "00000000-4490-4000-8000-0000000000a1";
const ENTRY = "00000000-4490-4000-8000-0000000000e1";
const USER = "00000000-4490-4000-8000-0000000000f1";
const TOKEN = "a".repeat(43);

type Call = { name: string; params: Record<string, unknown> };

function client(
  calls: Call[],
  result: (name: string) => { data: unknown; error: unknown },
  user: string | null = null,
): () => WaitlistClient {
  return () => ({
    rpc: (name, params) => {
      calls.push({ name, params });
      return Promise.resolve(
        result(name) as { data: unknown; error: { message: string } | null },
      );
    },
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: user ? { id: user } : null },
          error: user ? null : { message: "bad" },
        }),
    },
  });
}

function jwt(role: string): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(
      /\//g,
      "_",
    );
  return `${b64({ alg: "HS256" })}.${b64({ role, sub: USER })}.sig`;
}

function post(body: unknown, auth?: string, ip = "10.0.0.1"): Request {
  return new Request("http://x/venue-waitlist", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

Deno.test("join: a signed-out guest gets a token once; only its hash is sent", async () => {
  const calls: Call[] = [];
  const handler = createVenueWaitlistHandler({
    client: client(calls, () => ({
      data: { waitlistId: ENTRY, status: "waiting", position: 2 },
      error: null,
    })),
    newToken: () => TOKEN,
  });
  const res = await handler(post(
    {
      action: "join",
      venueId: VENUE,
      partySize: 4,
      date: "2026-11-21",
      from: "19:00",
      to: "21:00",
      guest: { name: "Ada Obi", email: "ada@example.test" },
    },
    jwt("anon"),
    "10.0.0.2",
  ));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data.token, TOKEN);
  assertEquals(body.data.visitPath, `/visit/waitlist/${ENTRY}`);
  assertEquals(calls[0].name, "pg_join_venue_waitlist");
  assertEquals(
    calls[0].params.p_token_hash,
    await waitlistTokenHashParam(TOKEN),
  );
  assertEquals(calls[0].params.p_user_id, null);
  assert(!JSON.stringify(calls[0].params).includes(TOKEN));
});

Deno.test("join: a time range needs both ends; unknown guest fields are refused", async () => {
  const calls: Call[] = [];
  const handler = createVenueWaitlistHandler({
    client: client(calls, () => ({ data: {}, error: null })),
  });
  const one = await handler(post(
    {
      action: "join",
      venueId: VENUE,
      partySize: 2,
      date: "2026-11-21",
      from: "19:00",
      guest: { name: "Ada" },
    },
    undefined,
    "10.0.0.3",
  ));
  assertEquals(one.status, 400);
  const extra = await handler(post(
    {
      action: "join",
      venueId: VENUE,
      partySize: 2,
      date: "2026-11-21",
      guest: { name: "Ada", role: "admin" },
    },
    undefined,
    "10.0.0.3",
  ));
  assertEquals(extra.status, 400);
  assertEquals(calls.length, 0);
});

Deno.test("get: no token and no account -> 401; a stranger's account is passed through and refused by the database", async () => {
  const calls: Call[] = [];
  const handler = createVenueWaitlistHandler({
    client: client(
      calls,
      () => ({
        data: null,
        error: { message: "waitlist_not_found", code: "P0002" },
      }),
      USER,
    ),
  });
  const anon = await handler(
    post({ action: "get", waitlistId: ENTRY }, jwt("anon"), "10.0.0.4"),
  );
  assertEquals(anon.status, 401);
  assertEquals((await anon.json()).code, "waitlist_token_required");
  const stranger = await handler(
    post(
      { action: "get", waitlistId: ENTRY },
      jwt("authenticated"),
      "10.0.0.4",
    ),
  );
  assertEquals(stranger.status, 404);
  assertEquals((await stranger.json()).code, "waitlist_not_found");
  assertEquals(calls[0].params.p_user_id, USER);
  assertEquals(calls[0].params.p_token_hash, null);
});

Deno.test("leave with the token", async () => {
  const calls: Call[] = [];
  const handler = createVenueWaitlistHandler({
    client: client(calls, () => ({
      data: { waitlistId: ENTRY, status: "left" },
      error: null,
    })),
  });
  const res = await handler(
    post(
      { action: "leave", waitlistId: ENTRY, token: TOKEN },
      undefined,
      "10.0.0.5",
    ),
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).data.status, "left");
  assertEquals(calls[0].name, "pg_leave_venue_waitlist");
});

Deno.test("join is rate limited per IP", async () => {
  const handler = createVenueWaitlistHandler({
    client: client([], () => ({
      data: null,
      error: { message: "waitlist_closed", code: "P0001" },
    })),
  });
  let last = 0;
  for (let i = 0; i < 11; i++) {
    const res = await handler(post(
      {
        action: "join",
        venueId: VENUE,
        partySize: 2,
        date: "2026-11-21",
        guest: { name: "Ada", email: "a@example.test" },
      },
      undefined,
      "10.0.0.9",
    ));
    last = res.status;
    await res.body?.cancel();
  }
  assertEquals(last, 429);
});

Deno.test("tokens are 43 url-safe characters", () => {
  assert(WAITLIST_TOKEN_RE.test(randomWaitlistToken()));
});
