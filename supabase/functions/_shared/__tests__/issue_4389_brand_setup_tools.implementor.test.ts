// Issue #4389 — Ari brand setup tools.
// MINGLA-INVARIANT: I-4389-ARI-NO-SENSITIVE-DATA | issue #4389 | Ari's setup tools take no bank, ID or tax number; payments open the secure screen; a failed bank-country write is never reported as done (D7).
// FAILS-ON-REVERT: restoring the best-effort payout_country update (D7) fails
// test 1 (two writes / swallowed error); dropping the owner check in
// start_payments_onboarding fails test 3.
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  createBrandRefusal,
  executeSetBrandPayoutCountry,
  pendingActionBrandMismatch,
  startDoorSale,
  startPaymentsOnboarding,
  withBrandSetupTools,
} from "../agentBrandSetupTools.ts";
import { AGENT_TOOLS, READ_ONLY_TOOL_NAMES } from "../agentTools.ts";
import { FLOW_DEFINITIONS } from "../ariFlows/index.ts";
import { buildSystemPrompt } from "../agentSystemPrompt.ts";
import { READINESS_ACTIONS } from "../readinessCatalog.ts";

const BRAND = "43890000-0000-4000-b000-0000000000a1";
const EVENT = "43890000-0000-4000-e000-0000000000a1";
const TIER = "43890000-0000-4000-f000-0000000000a1";

type Rpc = (name: string, params: Record<string, unknown>) => { data: unknown; error: { message: string } | null };

function fake(rpc: Rpc, from: (table: string) => unknown = () => ({})) {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const invoked: string[] = [];
  return {
    calls,
    invoked,
    client: {
      rpc: (name: string, params: Record<string, unknown>) => {
        calls.push({ name, params });
        return Promise.resolve(rpc(name, params));
      },
      from,
      functions: {
        invoke: (name: string) => {
          invoked.push(name);
          return Promise.resolve({ data: {}, error: null });
        },
      },
    },
  };
}

Deno.test("#4389 1 — set_brand_payout_country is ONE RPC write and its refusal surfaces (D7)", async () => {
  const ok = fake(() => ({ data: { payout_country: "DE", default_currency: "EUR", payment_provider: "stripe" }, error: null }));
  const result = await executeSetBrandPayoutCountry({ brand_id: BRAND, country_code: "Germany" }, ok.client as never);
  assertEquals(ok.calls.map((c) => c.name), ["biz_set_brand_payout_country"]);
  assertEquals(ok.calls[0].params, { p_brand_id: BRAND, p_country: "DE" });
  assertEquals(result.currency, "EUR");
  const locked = fake(() => ({ data: null, error: { message: "payout_country_locked" } }));
  await assertRejects(
    () => executeSetBrandPayoutCountry({ brand_id: BRAND, country_code: "GB" }, locked.client as never),
    Error,
    "disconnect payments first",
  );
  const ng = fake(() => ({ data: { payout_country: "NG", default_currency: "NGN" }, error: null }));
  await executeSetBrandPayoutCountry({ brand_id: BRAND, country_code: "Nigeria" }, ng.client as never);
  assertEquals(ng.invoked, ["brand-paystack-onboard"]);
});

Deno.test("#4389 2 — an ambiguous or unsupported country is asked back, nothing is written (AR-4, AR-11)", async () => {
  const f = fake(() => ({ data: null, error: null }));
  await assertRejects(() => executeSetBrandPayoutCountry({ brand_id: BRAND, country_code: "Georgia" }, f.client as never), Error, "Ask which one");
  await assertRejects(() => executeSetBrandPayoutCountry({ brand_id: BRAND, country_code: "Kenya" }, f.client as never), Error, "can't pay out");
  assertEquals(f.calls.length, 0);
});

function readiness(states: Record<string, string>) {
  return {
    items: Object.entries(states).map(([key, state]) => ({ key, state })),
  };
}

Deno.test("#4389 3 — start_payments_onboarding: owner only, gates on country + terms, returns the secure screen", async () => {
  const notOwner = fake((name) => name === "biz_can_mutate_payouts_for_brand_for_caller"
    ? { data: false, error: null }
    : { data: readiness({}), error: null });
  const r1 = await startPaymentsOnboarding.executor({ brand_id: BRAND }, notOwner.client as never, "u", {} as never) as Record<string, unknown>;
  assertEquals(r1.requires_owner, true);
  assertEquals(r1.route, null);
  const noTerms = fake((name) => name === "biz_can_mutate_payouts_for_brand_for_caller"
    ? { data: true, error: null }
    : { data: readiness({ "brand.name": "verified", "money.market": "verified", "money.terms_member": "missing" }), error: null });
  const r2 = await startPaymentsOnboarding.executor({ brand_id: BRAND }, noTerms.client as never, "u", {} as never) as Record<string, unknown>;
  assertEquals(r2.ready, false);
  assertEquals(r2.route, `/brand/${BRAND}/setup?step=pay`);
  const ready = fake((name) => name === "biz_can_mutate_payouts_for_brand_for_caller"
    ? { data: true, error: null }
    : { data: readiness({ "money.market": "verified", "money.terms_member": "verified" }), error: null });
  const r3 = await startPaymentsOnboarding.executor({ brand_id: BRAND }, ready.client as never, "u", {} as never) as Record<string, unknown>;
  assertEquals(r3.ready, true);
  assertEquals(r3.route, `/brand/${BRAND}/setup?step=pay`);
  assert(!JSON.stringify(startPaymentsOnboarding.parameters).match(/account_number|iban|ssn|tax_id/i));
});

function query(rows: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "gt", "limit"]) q[m] = () => q;
  q.maybeSingle = () => Promise.resolve({ data: rows, error: null });
  q.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
  return q;
}

Deno.test("#4389 4 — start_door_sale hands off to the door sale with tickets prefilled; never takes payment", async () => {
  const f = fake(() => ({ data: null, error: null }), (table) =>
    table === "ticket_types" ? query({ id: TIER }) : query([]));
  const r = await startDoorSale.executor({ event_id: EVENT, ticket_type_id: TIER, quantity: 2 }, f.client as never, "u", {} as never) as Record<string, unknown>;
  assertEquals(r.takes_payment, false);
  const route = String(r.route);
  assert(route.startsWith(`/event/${EVENT}/door?sellAnother=1&draft=`), route);
  const draft = JSON.parse(atob(decodeURIComponent(route.split("draft=")[1])));
  assertEquals(draft.lines, [{ ticketTypeId: TIER, quantity: 2 }]);
  const soon = new Date(Date.now() + 3600_000).toISOString();
  const later = new Date(Date.now() + 7200_000).toISOString();
  const two = fake(() => ({ data: null, error: null }), () => query([
    { id: "e1", title: "One", status: "live", event_dates: [{ start_at: soon, end_at: later }] },
    { id: "e2", title: "Two", status: "scheduled", event_dates: [{ start_at: soon, end_at: later }] },
  ]));
  const pick = await startDoorSale.executor({ brand_id: BRAND }, two.client as never, "u", {} as never) as Record<string, unknown>;
  assertEquals((pick.choose_event as unknown[]).length, 2);
  const none = fake(() => ({ data: null, error: null }), () => query([]));
  assertEquals((await startDoorSale.executor({ brand_id: BRAND }, none.client as never, "u", {} as never) as Record<string, unknown>).route, null);
});

Deno.test("#4389 5 — registry, read-only lane, setup tools always present for a host with no bank country", () => {
  const names = AGENT_TOOLS.map((t) => t.name);
  assert(names.includes("start_payments_onboarding") && names.includes("start_door_sale"));
  assert(READ_ONLY_TOOL_NAMES.has("start_payments_onboarding") && READ_ONLY_TOOL_NAMES.has("start_door_sale"));
  const picked = withBrandSetupTools([], AGENT_TOOLS, null).map((t) => t.name).sort();
  assertEquals(picked, ["create_brand", "get_brand_readiness", "set_brand_payout_country", "start_payments_onboarding"]);
  assertEquals(withBrandSetupTools([], AGENT_TOOLS, { default_currency: "USD" }), []);
  const createParams = AGENT_TOOLS.find((t) => t.name === "create_brand")?.parameters as { properties: Record<string, unknown> };
  assert("payout_country" in createParams.properties);
});

Deno.test("#4389 6 — confirm is bound to its brand (AR-13); draft refusals name the brand to continue", () => {
  assert(pendingActionBrandMismatch("a", "b"));
  assert(!pendingActionBrandMismatch("a", "a"));
  assert(!pendingActionBrandMismatch(null, "b"));
  assert(!pendingActionBrandMismatch("a", undefined));
  const id = "43890000-0000-4000-b000-0000000000a9";
  assertEquals(createBrandRefusal(`draft_exists:${id}`)?.code, "DRAFT_EXISTS");
  assertEquals(createBrandRefusal(`existing_incomplete_brand:${id}`)?.code, "EXISTING_INCOMPLETE_BRAND");
  assertEquals(createBrandRefusal("nope"), null);
});

Deno.test("#4389 7 — the brand_setup flow is registered; the prompt carries the two principle lines", () => {
  assert(FLOW_DEFINITIONS.some((d) => d.key === "brand_setup"));
  assert((READINESS_ACTIONS as readonly string[]).includes("brand_setup"));
  const prompt = buildSystemPrompt(null, []);
  assert(prompt.includes("name → bank country → Organiser Terms and payment details on the secure screen"));
  assert(prompt.includes("Never ask for, and never accept, bank, ID or tax numbers"));
});
