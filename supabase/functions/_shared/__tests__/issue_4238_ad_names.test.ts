// Issue #4238 W6c: statements and receipts name the ad (never "Ad 1…n").
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildAdCreditReceipt,
  buildAdCreditStatement,
  loadAdNames,
  type LedgerRow,
  type NameQuery,
} from "../adCreditStatements.ts";

const PLAN = "11111111-1111-4111-8111-111111111111";
const VERSION = "22222222-2222-4222-8222-222222222222";
const CAMP = "33333333-3333-4333-8333-333333333333";
const EVENT = "44444444-4444-4444-8444-444444444444";

const ledger = (over: Partial<LedgerRow>): LedgerRow => ({
  id: crypto.randomUUID(),
  entry_kind: "campaign_spend",
  amount_cents: -1000,
  balance_after_cents: 0,
  currency: "USD",
  created_at: "2026-11-02T10:00:00.000Z",
  ...over,
});

function fakeDb(tables: Record<string, unknown[]>): NameQuery {
  return (table, _cols, column, values) =>
    Promise.resolve(
      (tables[table] ?? []).filter((r) =>
        values.includes((r as Record<string, string>)[column])
      ),
    );
}

const db = fakeDb({
  ad_plan_versions: [{ id: VERSION, plan_id: PLAN }],
  ad_campaigns: [{
    id: CAMP,
    name: "Fallback campaign",
    plan_version_id: VERSION,
    dest_event_id: EVENT,
  }],
  events: [{ id: EVENT, title: "Rooftop Sunset Session" }],
});

Deno.test("W6c: plan-keyed and campaign-keyed rows resolve to the event title", async () => {
  const rows = [
    ledger({ metadata: { plan_id: PLAN } }),
    ledger({ campaign_id: CAMP, entry_kind: "unspend_return", amount_cents: 200 }),
  ];
  const names = await loadAdNames(db, rows);
  assertEquals(names.get(PLAN), "Rooftop Sunset Session");
  assertEquals(names.get(CAMP), "Rooftop Sunset Session");
  const statement = buildAdCreditStatement({
    month: "2026-11",
    before: null,
    rows,
    names,
  });
  assertEquals(statement.spend_by_ad.map((a) => a.ad_name), [
    "Rooftop Sunset Session",
    "Rooftop Sunset Session",
  ]);
  assertEquals(
    buildAdCreditReceipt(rows[0], names).ad_name,
    "Rooftop Sunset Session",
  );
});

Deno.test("W6c: an unknown ad is null, and a lookup failure never fails the statement", async () => {
  const names = await loadAdNames(db, [
    ledger({ metadata: { plan_id: "55555555-5555-4555-8555-555555555555" } }),
  ]);
  assertEquals(names.size, 0);
  const broken: NameQuery = () => {
    throw new Error("boom");
  };
  const none = await loadAdNames(broken, [ledger({ campaign_id: CAMP })]);
  assertEquals(none.size, 0);
  assertEquals(buildAdCreditReceipt(ledger({ campaign_id: CAMP })).ad_name, null);
});
