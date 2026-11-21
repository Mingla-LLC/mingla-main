import { assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type GuestListClient,
  createVenueGuestListHandler,
} from "./index.ts";

const TOKEN = "ab".repeat(32);
const HASH = "cd".repeat(32);
const ENTRY = "00000000-4490-4000-8000-0000000000e1";
type Call = { name: string; params: Record<string, unknown> };

function handler(
  calls: Call[],
  response: { data: unknown; error: { message: string; code: string } | null } = {
    data: { ok: true },
    error: null,
  },
) {
  const client: GuestListClient = {
    rpc: (name, params) => {
      calls.push({ name, params });
      return Promise.resolve(response);
    },
  };
  return createVenueGuestListHandler({
    client: () => client,
    hashToken: () => Promise.resolve(HASH),
  });
}

function req(body: Record<string, unknown>): Request {
  return new Request("http://local/venue-guest-list", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("get hashes the promoter token and never sends the raw token", async () => {
  const calls: Call[] = [];
  const res = await handler(calls)(req({ action: "get", token: TOKEN }));
  assertEquals(res.status, 200);
  assertEquals(calls[0], {
    name: "issue_4490_guest_list_promoter_get",
    params: { p_token_hash: `\\x${HASH}` },
  });
  assertFalse(JSON.stringify(calls).includes(TOKEN));
});

Deno.test("add and remove send only the promoter-scoped payload", async () => {
  const calls: Call[] = [];
  const run = handler(calls);
  assertEquals((await run(req({
    action: "add",
    token: TOKEN,
    localDate: "2026-11-21",
    guestName: " Ada ",
    plusOnes: 2,
  }))).status, 200);
  assertEquals((await run(req({
    action: "remove",
    token: TOKEN,
    localDate: "2026-11-21",
    entryId: ENTRY,
  }))).status, 200);
  assertEquals(calls.map((call) => call.name), [
    "issue_4490_guest_list_promoter_write",
    "issue_4490_guest_list_promoter_write",
  ]);
  assertEquals(calls[0].params.p_payload, {
    localDate: "2026-11-21",
    guestName: "Ada",
    plusOnes: 2,
  });
  assertEquals(calls[1].params.p_payload, {
    localDate: "2026-11-21",
    entryId: ENTRY,
  });
});

Deno.test("closed lists return the approved public copy", async () => {
  const calls: Call[] = [];
  const res = await handler(calls, {
    data: null,
    error: { message: "guest_list_closed", code: "PT409" },
  })(req({
    action: "add",
    token: TOKEN,
    localDate: "2026-11-21",
    guestName: "Ada",
    plusOnes: 0,
  }));
  assertEquals(res.status, 409);
  assertEquals(await res.json(), {
    code: "guest_list_closed",
    message: "The list for tonight has closed.",
  });
});

Deno.test("malformed tokens, dates, names and foreign entry ids stop before RPC", async () => {
  const calls: Call[] = [];
  const run = handler(calls);
  const inputs = [
    { action: "get", token: "raw" },
    { action: "add", token: TOKEN, localDate: "tomorrow", guestName: "A" },
    { action: "add", token: TOKEN, localDate: "2026-11-21", guestName: "", plusOnes: 0 },
    { action: "remove", token: TOKEN, localDate: "2026-11-21", entryId: "nope" },
  ];
  for (const input of inputs) assertEquals((await run(req(input))).status, 400);
  assertEquals(calls.length, 0);
});
