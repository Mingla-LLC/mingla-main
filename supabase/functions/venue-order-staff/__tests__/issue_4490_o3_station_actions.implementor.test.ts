// #4490 spec 08 O3 part A — venue-order-staff's station actions.
// Run: deno test --allow-env --allow-read --no-check \
//   supabase/functions/venue-order-staff/__tests__/issue_4490_o3_station_actions.implementor.test.ts
// TEST-MOD-APPROVED #4490 (08-O3 fix 1, O3-T4): the `printed` action is gone; ST1 no longer
// lists it and ST6 proves a request for it reaches no RPC.
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleStationAction, STATION_ACTIONS } from "../stationActions.ts";

const VENUE = "44900900-0000-4000-9000-0000000000a1";
const ORDER = "44900900-0000-4000-e000-000000000001";
const ITEM = "44900900-0000-4000-e000-000000000003";
const USER = "44900900-0000-4000-8000-000000000002";

const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status });

function client(answer: { data?: unknown; error?: { code?: string; message?: string } | null } = {}) {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  return {
    calls,
    rpc: (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      return Promise.resolve({ data: answer.data ?? { ticket: { orderId: ORDER } }, error: answer.error ?? null });
    },
  };
}

Deno.test("ST1 each action calls its service-only RPC with the verified user as actor", async () => {
  const cases: Array<[string, Record<string, unknown>, string, Record<string, unknown>]> = [
    ["station_board", { venueId: VENUE, station: "all" }, "issue_4490_station_board", { p_venue_id: VENUE, p_station: "all", p_actor: USER }],
    ["station_accept", { orderId: ORDER, station: "kitchen" }, "issue_4490_station_accept", { p_order_id: ORDER, p_station: "kitchen", p_actor: USER }],
    ["item_ready", { orderItemId: ITEM }, "issue_4490_station_item_ready", { p_order_item_id: ITEM, p_actor: USER }],
    ["ticket_ready", { orderId: ORDER, station: "bar" }, "issue_4490_station_ticket_ready", { p_order_id: ORDER, p_station: "bar", p_actor: USER }],
    ["recall", { orderId: ORDER, station: "bar" }, "issue_4490_station_recall", { p_order_id: ORDER, p_station: "bar", p_actor: USER }],
    ["picked_up", { orderId: ORDER, station: "kitchen" }, "issue_4490_order_picked_up", { p_order_id: ORDER, p_station: "kitchen", p_actor: USER }],
  ];
  for (const [action, body, rpc, params] of cases) {
    const c = client();
    const res = await handleStationAction(c, action, { ...body, actor: "someone-else" }, USER, respond);
    assertEquals(res.status, 200, action);
    assertEquals(c.calls, [{ name: rpc, params }], action);
  }
  assertEquals([...STATION_ACTIONS].sort(), cases.map((c) => c[0]).sort());
});

Deno.test("ST2 bad payloads are 400 and reach no RPC (a station is kitchen or bar; the board also takes all)", async () => {
  for (const [action, body] of [
    ["station_board", { venueId: VENUE, station: "grill" }],
    ["station_board", { venueId: "x", station: "kitchen" }],
    ["station_accept", { orderId: ORDER, station: "all" }],
    ["ticket_ready", { orderId: "nope", station: "kitchen" }],
    ["item_ready", { orderItemId: 7 }],
  ] as Array<[string, Record<string, unknown>]>) {
    const c = client();
    const res = await handleStationAction(c, action, body, USER, respond);
    assertEquals(res.status, 400, `${action} ${JSON.stringify(body)}`);
    assertEquals(c.calls.length, 0);
  }
});

Deno.test("ST3 refusals keep their codes; anything else is a plain 500", async () => {
  for (const [code, status] of [
    ["not_authorized", 403], ["stations_not_enabled", 422], ["station_ticket_not_found", 404],
    ["station_ticket_closed", 409], ["station_ticket_not_ready", 409], ["station_invalid", 400],
  ] as Array<[string, number]>) {
    const res = await handleStationAction(client({ error: { code: "P0001", message: code } }), "station_accept",
      { orderId: ORDER, station: "kitchen" }, USER, respond);
    assertEquals(res.status, status, code);
    assertEquals(await res.json(), { error: code });
  }
  const res = await handleStationAction(client({ error: { code: "XX000", message: "relation secret" } }), "recall",
    { orderId: ORDER, station: "kitchen" }, USER, respond);
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "internal_error" });
});

Deno.test("ST4 a second accept answers who already accepted it (T14), and the board comes back whole", async () => {
  const already = await handleStationAction(client({ data: { already: true, alreadyAcceptedBy: "Ifeanyi" } }),
    "station_accept", { orderId: ORDER, station: "kitchen" }, USER, respond);
  assertEquals(await already.json(), { already: true, alreadyAcceptedBy: "Ifeanyi" });
  const board = await handleStationAction(client({ data: { tickets: [], venueName: "Palm" } }), "station_board",
    { venueId: VENUE, station: "kitchen" }, USER, respond);
  assertEquals(await board.json(), { board: { tickets: [], venueName: "Palm" } });
});

Deno.test("ST5 the function routes every station action here after the bearer check", async () => {
  const index = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const bearer = index.indexOf("const userId = await userIdFromAuthHeader(req);");
  const route = index.indexOf("return await handleStationAction(");
  for (const action of STATION_ACTIONS) assertStringIncludes(index, `case "${action}":`);
  assertEquals(bearer > 0 && route > bearer, true);
});

Deno.test("ST6 O3-T4: there is no printed action — the count rises only when venue-floor-pdf makes the PDF", async () => {
  assertEquals(STATION_ACTIONS.has("printed"), false);
  const c = client();
  const res = await handleStationAction(c, "printed", { orderId: ORDER, station: "kitchen" }, USER, respond);
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "unknown_action" });
  assertEquals(c.calls.length, 0);
  const index = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assertEquals(index.includes('case "printed":'), false);
  assertEquals(index.includes("issue_4490_station_mark_printed"), false);
});
