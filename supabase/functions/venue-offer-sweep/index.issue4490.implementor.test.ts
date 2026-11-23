// #4490 P3 — venue-offer-sweep: only the service key may run it; it runs the
// sweep RPC once and reports its counts.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createVenueOfferSweepHandler } from "./index.ts";

const env = (name: string) =>
  ({
    SUPABASE_URL: "http://kong:8000",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  } as Record<string, string>)[name];

function req(auth?: string, method = "POST"): Request {
  return new Request("http://local/venue-offer-sweep", {
    method,
    headers: auth ? { authorization: auth } : {},
  });
}

Deno.test("only the service key may run the sweep", async () => {
  let calls = 0;
  const handle = createVenueOfferSweepHandler({
    env,
    client: () => ({
      rpc: () => {
        calls += 1;
        return Promise.resolve({ data: {}, error: null });
      },
    }),
  });
  assertEquals((await handle(req())).status, 401);
  assertEquals((await handle(req("Bearer anon-key"))).status, 401);
  assertEquals((await handle(req("Bearer service-key", "GET"))).status, 405);
  assertEquals(calls, 0);
});

Deno.test("the sweep runs once and reports reminders and overdue notices", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const handle = createVenueOfferSweepHandler({
    env,
    client: () => ({
      rpc: (name, params) => {
        seen.push({ name, ...params });
        return Promise.resolve({
          data: { reminders: 2, overdue: 1 },
          error: null,
        });
      },
    }),
  });
  const res = await handle(req("Bearer service-key"));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).result, { reminders: 2, overdue: 1 });
  // TEST-MOD-APPROVED #4490 (spec 08 O1): the same run also sweeps Till
  // rounds that never joined a check.
  // TEST-MOD-APPROVED #4490 (spec 08 O3 part A): and lists floor PDFs older
  // than 24 hours (none here, so nothing is removed).
  assertEquals(seen, [
    { name: "issue_4490_offer_sweep", p_limit: 200 },
    { name: "issue_4490_till_sweep_held_rounds", p_limit: 200 },
    { name: "issue_4490_floor_pdf_due", p_limit: 200 },
  ]);
});

Deno.test("08-O1 the Till held-round sweep runs even when the offer sweep fails, and reports its count", async () => {
  const seen: string[] = [];
  const handle = createVenueOfferSweepHandler({
    env,
    client: () => ({
      rpc: (name) => {
        seen.push(name);
        return Promise.resolve(
          name === "issue_4490_offer_sweep"
            ? { data: null, error: { code: "XX000", message: "boom" } }
            : { data: { cancelled: 3 }, error: null },
        );
      },
    }),
  });
  const failed = await handle(req("Bearer service-key"));
  assertEquals(failed.status, 500);
  // TEST-MOD-APPROVED #4490 (spec 08 O3 part A): the floor PDF step runs too.
  assertEquals(seen, ["issue_4490_offer_sweep", "issue_4490_till_sweep_held_rounds", "issue_4490_floor_pdf_due"]);

  const ok = createVenueOfferSweepHandler({
    env,
    client: () => ({
      rpc: (name) =>
        Promise.resolve({
          data: name === "issue_4490_offer_sweep" ? { reminders: 0 } : { cancelled: 3 },
          error: null,
        }),
    }),
  });
  const res = await ok(req("Bearer service-key"));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).tillHeldRounds, { cancelled: 3 });
});

Deno.test("a database failure is a 500 with no detail", async () => {
  const handle = createVenueOfferSweepHandler({
    env,
    client: () => ({
      rpc: () =>
        Promise.resolve({
          data: null,
          error: { code: "42501", message: "forbidden" },
        }),
    }),
  });
  const res = await handle(req("Bearer service-key"));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "sweep_failed" });
});
