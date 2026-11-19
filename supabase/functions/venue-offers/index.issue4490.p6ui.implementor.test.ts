// #4490 P5 follow-up (P6 UI round) — a guest moves a by-the-hour booking to a
// new start and length: the function makes that time's window first (as a
// flexible quote does) and hands only the window to the database, which
// checks it belongs to the booking's own offer. Bad input is refused before
// any write.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createVenueOffersHandler,
  resetVenueOffersRateLimitForTests,
  type ServiceClient,
} from "./index.ts";

const GROUP = "00000000-4490-4000-8000-0000000000b7";
const OFFER = "00000000-4490-4000-8000-0000000000a7";
const WINDOW = "00000000-4490-4000-8000-0000000000c7";
const TOKEN = "t".repeat(43);
const b64 = (o: unknown) =>
  btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const ANON = `${b64({ alg: "HS256" })}.${b64({ role: "anon" })}.sig`;

type Call = { name: string; params: Record<string, unknown> };

function fake(calls: Call[]): () => ServiceClient {
  return () => ({
    rpc: (name, params) => {
      calls.push({ name, params });
      if (name === "issue_4490_flexible_window") return Promise.resolve({ data: WINDOW, error: null });
      return Promise.resolve({ data: { amountMinor: 0, groupVersion: 3 }, error: null });
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
    auth: { getUser: () => Promise.resolve({ data: { user: null }, error: { message: "no" } }) },
  });
}

function post(body: Record<string, unknown>): Request {
  return new Request("http://local/venue-offers", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ANON}` },
    body: JSON.stringify(body),
  });
}

Deno.test("move a by-the-hour booking by start and length: the window is made first, only it reaches the change", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handle = createVenueOffersHandler({ client: fake(calls) });
  const res = await handle(post({
    action: "change_preview",
    groupId: GROUP,
    token: TOKEN,
    change: "move_date",
    payload: { offeringId: OFFER, startsAt: "2026-11-26T13:00:00.000Z", minutes: 120 },
  }));
  assertEquals(res.status, 200);
  assertEquals(calls[0].name, "issue_4490_flexible_window");
  assertEquals(calls[0].params, { p_offering_id: OFFER, p_starts_at: "2026-11-26T13:00:00.000Z", p_minutes: 120 });
  assertEquals(calls[1].name, "issue_4490_guest_change_booking");
  assertEquals(calls[1].params.p_payload, { windowId: WINDOW });
  assertEquals(calls[1].params.p_action, "move_date");
  assertEquals(calls[1].params.p_preview, true);
});

Deno.test("a move by start needs a real offer, a real time and 15 minutes to a day", async () => {
  for (const payload of [
    { offeringId: "not-a-uuid", startsAt: "2026-11-26T13:00:00Z", minutes: 120 },
    { offeringId: OFFER, startsAt: "soon", minutes: 120 },
    { offeringId: OFFER, startsAt: "2026-11-26T13:00:00Z", minutes: 5 },
    { offeringId: OFFER, startsAt: "2026-11-26T13:00:00Z", minutes: 2000 },
  ]) {
    resetVenueOffersRateLimitForTests();
    const calls: Call[] = [];
    const handle = createVenueOffersHandler({ client: fake(calls) });
    const res = await handle(post({ action: "change_preview", groupId: GROUP, token: TOKEN, change: "move_date", payload }));
    assertEquals(res.status, 400);
    assertEquals(calls.length, 0);
  }
});

Deno.test("a move by window still goes straight to the change (no window made)", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handle = createVenueOffersHandler({ client: fake(calls) });
  const res = await handle(post({ action: "change_preview", groupId: GROUP, token: TOKEN, change: "move_date", payload: { windowId: WINDOW } }));
  assertEquals(res.status, 200);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "issue_4490_guest_change_booking");
});
