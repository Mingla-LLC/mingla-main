// #4273 tester adversarial suite — mixed-currency SMS quotes, the FX adapter,
// honest error codes, and group-preview draft selection.
// Run: deno test --allow-env --allow-net --allow-read supabase/functions/marketing-send/issue_4273_mixed_currency_sms.tester_adversarial.test.ts
// deno-lint-ignore-file no-explicit-any
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import * as Q from "../_shared/marketingBookQuote.ts";
import * as FX from "../_shared/marketingSmsFx.ts";
import * as MS from "./index.ts";
import * as GP from "./campaignGroupPreview.ts";

/**
 * The single-currency allocator exactly as origin/main b78b1f08d9 had it
 * (ceil of the exact rational sum; floors, then largest remainder, tie by key).
 * Single-currency money must stay identical to this.
 */
function originSingleCurrency(
  rows: Array<{ key: string; segments: number; num: number; den: number }>,
): { total: number; byKey: Map<string, number> } {
  const f = rows.map((row) => ({
    key: row.key,
    n: BigInt(row.segments) * BigInt(row.num),
    d: BigInt(row.den),
  }));
  let exactN = 0n, exactD = 1n, floor = 0n;
  for (const e of f) {
    floor += e.n / e.d;
    exactN = exactN * e.d + e.n * exactD;
    exactD *= e.d;
  }
  const total = (exactN + exactD - 1n) / exactD;
  const byKey = new Map(f.map((e) => [e.key, Number(e.n / e.d)]));
  let left = Number(total - floor);
  [...f].sort((l, r) => {
    const c = (l.n % l.d) * r.d - (r.n % r.d) * l.d;
    return c === 0n ? l.key.localeCompare(r.key) : c > 0n ? -1 : 1;
  }).forEach((e) => {
    if (left > 0) {
      byKey.set(e.key, (byKey.get(e.key) ?? 0) + 1);
      left -= 1;
    }
  });
  return { total: Number(total), byKey };
}

const NOW = new Date("2026-11-05T12:00:00.000Z");
const rate = (id: string, country: string, currency: string, n: number, d: number, provider = "twilio") => ({
  rateId: id, provider, country, currency, unit: "sms_segment",
  minorNumerator: n, minorDenominator: d,
  effectiveAt: "2026-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z",
  sourceReference: `${id}-card`,
});
const RATES: any[] = [
  rate("termii-ng", "NG", "NGN", 793, 3, "termii"),
  rate("twilio-us", "US", "USD", 79, 10),
  rate("twilio-gb", "GB", "GBP", 397, 7),
];
function person(i: number, country: string, bodyPad = 0) {
  const tail = String(1000 + i).padStart(4, "0");
  const phone = country === "NG" ? `+234801234${tail}` : country === "US" ? `+1415555${tail}` : `+44770090${tail}`;
  return { personKey: `k${String(i).padStart(4, "0")}`, brandPersonId: `p${i}`, contactMethodId: `m${i}`,
    normalizedContact: phone, allowed: true, safeReasonCode: "allowed", _pad: bodyPad };
}
function sms(countries: string[], body = "Doors at 9") {
  return { brandId: "brand", channel: "sms", selectedCount: countries.length,
    content: { kind: "sms", body }, candidates: countries.map((c, i) => person(i, c)) };
}
function linearFx(factors: Record<string, number>, id = "snap-1", calls: unknown[] = []): any {
  return {
    convert({ subtotals, targetCurrency, at }: any) {
      calls.push({ at: at.toISOString(), subtotals, targetCurrency });
      return Promise.resolve({ snapshotId: id, provider: "exchange_rate_api_open_v6",
        converted: subtotals.map((r: any) => ({ currency: r.currency, providerCostMinor: r.estimatedCostMinor,
          convertedCostMinor: r.currency === targetCurrency ? r.estimatedCostMinor
            : Math.max(r.estimatedCostMinor > 0 ? 1 : 0, Math.round(r.estimatedCostMinor * (factors[`${r.currency}>${targetCurrency}`] ?? 1))) })) });
    },
  };
}
const OPT: any = { smsCountryLive: () => true, smsRates: RATES, trackingOrigin: "https://x.test/m" };
function rng(seed: number) { return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }

Deno.test("ADV-1 property: 400 random mixed quotes — shares sum exactly to the total, never negative, per-currency groups sum to their converted part", async () => {
  const r = rng(4273);
  const bodies = ["Hi", "x".repeat(170), "Ünïcode ✓ " + "y".repeat(80), "z".repeat(400)];
  for (let t = 0; t < 400; t++) {
    const n = 2 + Math.floor(r() * 40);
    const countries = Array.from({ length: n }, () => ["NG", "US", "GB"][Math.floor(r() * 3)]);
    if (new Set(countries).size < 2) countries[0] = countries[1] === "NG" ? "US" : "NG";
    const target = ["NGN", "USD", "GBP"][Math.floor(r() * 3)];
    const factors = { "USD>NGN": 1583.3 * r() + 0.001, "GBP>NGN": 2000 * r() + 0.001, "NGN>USD": r() * 0.01,
      "NGN>GBP": r() * 0.01, "USD>GBP": r() * 2, "GBP>USD": r() * 2 };
    const q = await Q.buildMarketingBookQuote(sms(countries, bodies[t % 4]) as never, NOW,
      { ...OPT, costCurrency: target, fx: linearFx(factors) });
    const sum = q.candidates.reduce((s: number, c: any) => s + (c.allocatedCostMinor ?? 0), 0);
    assertEquals(sum, q.estimatedCostMinor, `trial ${t}`);
    assert(q.candidates.every((c: any) => c.allocatedCostMinor >= 0), `neg trial ${t}`);
    assertEquals(q.currency, target);
    for (const part of q.costBreakdown) {
      const ids = RATES.filter((x) => x.currency === part.currency).map((x) => x.rateId);
      const s = q.candidates.filter((c: any) => ids.includes(c.rateId)).reduce((a: number, c: any) => a + c.allocatedCostMinor, 0);
      assertEquals(s, part.convertedCostMinor, `group ${part.currency} trial ${t}`);
    }
    assertEquals(q.estimatedCostMinor, q.costBreakdown.reduce((a: number, p: any) => a + p.convertedCostMinor, 0));
  }
});

Deno.test("ADV-2 single currency keeps origin/main's money (200 random NG-only / US-only / GB-only), fx never called", async () => {
  const r = rng(99);
  for (let t = 0; t < 200; t++) {
    const c = ["NG", "US", "GB"][t % 3];
    const n = 1 + Math.floor(r() * 30);
    const input = sms(Array(n).fill(c), t % 2 ? "x".repeat(200) : "Doors");
    const calls: unknown[] = [];
    const providerRate = RATES.find((x) => x.country === c)!;
    for (const brandCur of ["NGN", "USD", "GBP", null]) {
      const a = await Q.buildMarketingBookQuote(structuredClone(input) as never, NOW, { ...OPT, costCurrency: brandCur, fx: linearFx({}, "s", calls) } as never);
      const ref = originSingleCurrency(a.candidates.map((x: any) => ({
        key: `${x.brandPersonId}:${x.contactMethodId}`,
        segments: x.segments,
        num: providerRate.minorNumerator,
        den: providerRate.minorDenominator,
      })));
      assertEquals(a.estimatedCostMinor, ref.total);
      assertEquals(a.currency, providerRate.currency); // provider currency, NOT converted (Q2 default)
      assertEquals(
        a.candidates.map((x: any) => x.allocatedCostMinor),
        a.candidates.map((x: any) => ref.byKey.get(`${x.brandPersonId}:${x.contactMethodId}`)),
      );
      assert(a.candidates.every((x: any) => x.rateId === providerRate.rateId));
      assertEquals(a.rateIds, [providerRate.rateId]);
      assertEquals(a.sourceReferences, [providerRate.sourceReference]);
      assertEquals(a.costBreakdown.length, 1);
      assertEquals(a.fxSnapshotId, null);
    }
    assertEquals(calls.length, 0);
  }
});

Deno.test("ADV-3 mixed: no brand currency / malformed currency / missing converter → fx_unavailable → COST_UNAVAILABLE (never STALE) on every mapper", async () => {
  for (const opts of [{ costCurrency: null, fx: linearFx({}) }, { costCurrency: "ngn", fx: linearFx({}) },
    { costCurrency: "NGN" }, { costCurrency: "" , fx: linearFx({})}]) {
    const err = await assertRejects(() => Q.buildMarketingBookQuote(sms(["NG", "US"]) as never, NOW, { ...OPT, ...opts } as never));
    assertEquals((err as Error).message, "cost_unavailable:fx_unavailable");
    assertEquals(MS.marketingBookQuoteErrorCode(err), "BOOK_BLAST_COST_UNAVAILABLE");
    assertEquals(MS.groupMethodErrorCode(err), "BOOK_BLAST_COST_UNAVAILABLE");
  }
});

Deno.test("ADV-4 a lying converter (drops a row, wrong provider amount, negative, NaN, empty snapshot id) is refused fail-closed", async () => {
  const bad = [
    (s: any) => ({ snapshotId: "s", provider: "x", converted: s.slice(0, 1).map((r: any) => ({ currency: r.currency, providerCostMinor: r.estimatedCostMinor, convertedCostMinor: 1 })) }),
    (s: any) => ({ snapshotId: "s", provider: "x", converted: s.map((r: any) => ({ currency: r.currency, providerCostMinor: r.estimatedCostMinor + 1, convertedCostMinor: 1 })) }),
    (s: any) => ({ snapshotId: "s", provider: "x", converted: s.map((r: any) => ({ currency: r.currency, providerCostMinor: r.estimatedCostMinor, convertedCostMinor: -5 })) }),
    (s: any) => ({ snapshotId: "s", provider: "x", converted: s.map((r: any) => ({ currency: r.currency, providerCostMinor: r.estimatedCostMinor, convertedCostMinor: NaN })) }),
    (s: any) => ({ snapshotId: "", provider: "x", converted: s.map((r: any) => ({ currency: r.currency, providerCostMinor: r.estimatedCostMinor, convertedCostMinor: 1 })) }),
  ];
  for (const f of bad) {
    const fx = { convert: ({ subtotals }: any) => Promise.resolve(f(subtotals)) };
    const err = await assertRejects(() => Q.buildMarketingBookQuote(sms(["NG", "US"]) as never, NOW, { ...OPT, costCurrency: "NGN", fx } as never));
    assertEquals((err as Error).message, "cost_unavailable:fx_unavailable");
  }
});

Deno.test("ADV-5 preview == confirm: same quotedAt (sub-second jitter) → same hash; a later 'latest' snapshot does not leak in; converter is asked for quotedAt, not wall clock", async () => {
  const calls: any[] = [];
  const asOf: any = { convert: (i: any) => linearFx({ "USD>NGN": i.at < new Date("2026-11-05T12:00:30Z") ? 1500 : 1700 }, i.at < new Date("2026-11-05T12:00:30Z") ? "day1" : "day2", calls).convert(i) };
  const p = await Q.buildMarketingBookQuote(sms(["NG", "US", "US"]) as never, new Date("2026-11-05T12:00:00.900Z"), { ...OPT, costCurrency: "NGN", fx: asOf });
  const c = await Q.buildMarketingBookQuote(sms(["NG", "US", "US"]) as never, new Date(p.quotedAt), { ...OPT, costCurrency: "NGN", fx: asOf });
  assertEquals(c.quoteHash, p.quoteHash);
  assertEquals(calls.map((x) => x.at), ["2026-11-05T12:00:00.000Z", "2026-11-05T12:00:00.000Z"]);
  // brand currency changed between preview and confirm → hash/currency differ → the confirm compare goes STALE
  const g = await Q.buildMarketingBookQuote(sms(["NG", "US", "US"]) as never, new Date(p.quotedAt), { ...OPT, costCurrency: "GBP", fx: linearFx({ "USD>GBP": 0.8, "NGN>GBP": 0.0005 }) });
  assert(g.quoteHash !== p.quoteHash && g.currency !== p.currency);
});

Deno.test("ADV-6 fxSnapshotId never public; costBreakdown carries amounts only", async () => {
  const q = await Q.buildMarketingBookQuote(sms(["NG", "US"]) as never, NOW, { ...OPT, costCurrency: "NGN", fx: linearFx({ "USD>NGN": 1500 }, "secret-snap") });
  const pub = Q.publicMarketingBookQuote(q);
  assert(!JSON.stringify(pub).includes("secret-snap"));
  for (const row of pub.costBreakdown) assertEquals(Object.keys(row).sort(), ["convertedCostMinor", "currency", "providerCostMinor"]);
});

// ── dbSmsFxConverter against a recording stub ───────────────────────────────
function stubDb(snap: { data: unknown; error: unknown }, rpc: (args: any) => { data: unknown; error: unknown }) {
  const log: any[] = [];
  const chain: any = {};
  for (const m of ["select", "in", "lte", "gte", "order", "limit"]) chain[m] = (...a: unknown[]) => { log.push([m, ...a]); return chain; };
  chain.maybeSingle = () => Promise.resolve(snap);
  return { log, db: { from: (t: string) => { log.push(["from", t]); return chain; }, rpc: (name: string, args: any) => { log.push(["rpc", name, args]); return Promise.resolve(rpc(args)); } } };
}

Deno.test("ADV-7 adapter: as-of window is keyed on quotedAt; same-currency never calls rpc; 0 converted for non-zero → 1; zero provider stays 0", async () => {
  const { db, log } = stubDb({ data: { id: "snapA" }, error: null }, (a) => ({ data: a.p_amount === 5 ? 0 : "123", error: null }));
  const out = await FX.dbSmsFxConverter(db).convert({ subtotals: [{ currency: "USD", estimatedCostMinor: 5 }, { currency: "NGN", estimatedCostMinor: 0 }, { currency: "GBP", estimatedCostMinor: 7 }], targetCurrency: "NGN", at: NOW });
  assertEquals(log.find((l) => l[0] === "lte"), ["lte", "fetched_at", NOW.toISOString()]);
  assertEquals(log.find((l) => l[0] === "gte"), ["gte", "expires_at", NOW.toISOString()]);
  assertEquals(log.find((l) => l[0] === "in"), ["in", "status", ["active", "superseded"]]);
  assertEquals(log.filter((l) => l[0] === "rpc").length, 2);
  assertEquals(out.converted, [
    { currency: "GBP", providerCostMinor: 7, convertedCostMinor: 123 },
    { currency: "NGN", providerCostMinor: 0, convertedCostMinor: 0 },
    { currency: "USD", providerCostMinor: 5, convertedCostMinor: 1 },
  ]);
});

Deno.test("ADV-8 adapter fails closed: no snapshot, snapshot error, rpc error, rpc null, rpc throws, non-integer", async () => {
  const cases: Array<[any, any]> = [
    [{ data: null, error: null }, () => ({ data: 1, error: null })],
    [{ data: null, error: { message: "boom" } }, () => ({ data: 1, error: null })],
    [{ data: { id: "s" }, error: null }, () => ({ data: null, error: { message: "fx_unavailable" } })],
    [{ data: { id: "s" }, error: null }, () => ({ data: null, error: null })],
    [{ data: { id: "s" }, error: null }, () => { throw new Error("network"); }],
    [{ data: { id: "s" }, error: null }, () => ({ data: 1.5, error: null })],
  ];
  for (const [snap, rpc] of cases) {
    const { db } = stubDb(snap, rpc);
    const err = await assertRejects(() => FX.dbSmsFxConverter(db).convert({ subtotals: [{ currency: "USD", estimatedCostMinor: 5 }], targetCurrency: "NGN", at: NOW }));
    assertEquals((err as Error).message, "cost_unavailable:fx_unavailable");
  }
});

Deno.test("ADV-9 STALE only for stale tokens; unknown/postgrest/brand/fx never STALE; circle_blast_forbidden → 403", () => {
  for (const t of ["book_blast_preview_stale", "manual_group_preview_stale", "circle_blast_snapshot_stale", "ERROR: book_blast_preview_stale (PT409)"]) {
    assertEquals(MS.bookRpcErrorEnvelope(t), { error: "BOOK_BLAST_PREVIEW_STALE", status: 409 });
  }
  for (const t of ["", "some postgrest text", "duplicate key value violates unique constraint", "canceling statement due to statement timeout", "follow_brand_lookup:x", "cost_unavailable:brand_lookup"]) {
    assertEquals(MS.bookRpcErrorEnvelope(t), { error: "BOOK_BLAST_PREVIEW_UNAVAILABLE", status: 503 });
    assert(MS.groupMethodErrorCode(new Error(t)) !== "BOOK_BLAST_PREVIEW_STALE");
  }
  assertEquals(MS.bookRpcErrorEnvelope("circle_blast_forbidden"), { error: "BOOK_BLAST_FORBIDDEN", status: 403 });
  assertEquals(MS.groupErrorStatus("BOOK_BLAST_COST_UNAVAILABLE"), 503);
  assertEquals(MS.groupErrorStatus("BOOK_BLAST_PREVIEW_UNAVAILABLE"), 503);
  assertEquals(MS.groupErrorStatus("SOMETHING_NEW"), 503);
});

Deno.test("ADV-10 resolveQuoteBrand: pricing → default fallback, case/space normalised, junk → null; non-SMS skips the read; missing brand fails closed", async () => {
  const mk = (row: unknown, error: unknown = null) => {
    let reads = 0;
    const c: any = { select: () => c, eq: () => c, maybeSingle: () => { reads++; return Promise.resolve({ data: row, error }); } };
    return { db: { from: () => c }, reads: () => reads };
  };
  const env = (include = false) => ({ brandId: "b", channel: "sms", content: { include_follow_cta: include } });
  assertEquals((await MS.resolveQuoteBrand(mk({ pricing_currency: " ngn ", default_currency: "USD", slug: "s", name: "N" }).db, env())).costCurrency, "NGN");
  assertEquals((await MS.resolveQuoteBrand(mk({ pricing_currency: null, default_currency: "GBP" }).db, env())).costCurrency, "GBP");
  assertEquals((await MS.resolveQuoteBrand(mk({ pricing_currency: "  ", default_currency: "usd" }).db, env())).costCurrency, "USD");
  assertEquals((await MS.resolveQuoteBrand(mk({ pricing_currency: null, default_currency: null }).db, env())).costCurrency, null);
  assertEquals((await MS.resolveQuoteBrand(mk({ pricing_currency: "NAIRA", default_currency: "NGN" }).db, env())).costCurrency, null);
  const e = mk(null);
  assertEquals(await MS.resolveQuoteBrand(e.db, { brandId: "b", channel: "email", content: {} }), { followBrand: null, costCurrency: null });
  assertEquals(e.reads(), 0);
  await assertRejects(() => MS.resolveQuoteBrand(mk(null).db, env()), Error, "cost_unavailable:brand_lookup");
  await assertRejects(() => MS.resolveQuoteBrand(mk(null, { message: "x" }).db, env()), Error, "cost_unavailable:brand_lookup");
});

Deno.test("ADV-11 campaign_ids validation and group draft selection", () => {
  const L = "42730000-0000-4000-8000-000000000001", S = "42730000-0000-4000-8000-000000000002", F = "42730000-0000-4000-8000-0000000000ff";
  assertEquals(MS.parseGroupCampaignIds(undefined, L), null);
  assertEquals(MS.parseGroupCampaignIds([S], L), "invalid");
  assertEquals(MS.parseGroupCampaignIds([L, L], L), "invalid");
  assertEquals(MS.parseGroupCampaignIds([L, S, F, "42730000-0000-4000-8000-000000000003"], L), "invalid");
  assertEquals(MS.parseGroupCampaignIds([L, "not-a-uuid"], L), "invalid");
  assertEquals(MS.parseGroupCampaignIds("L", L), "invalid");
  assertEquals(MS.parseGroupCampaignIds([L.toUpperCase(), S], L), [L, S]);
  // a foreign / non-draft id in the list is STALE, never priced
  let threw = "";
  try { MS.selectGroupDrafts([{ id: L, channel: "email" }, { id: S, channel: "sms" }], [L, F]); } catch (e) { threw = (e as Error).message; }
  assertEquals(threw, "book_blast_preview_stale");
  assertEquals(MS.selectGroupDrafts([{ id: L, channel: "email" }, { id: S, channel: "sms" }], [L]), { rows: [{ id: L, channel: "email" }], unlisted: [S] });
});

Deno.test("ADV-12 (P2-1) when the lead is a SIBLING draft opened from Drafts, the group head is never reported unlisted", () => {
  const H = "42730000-0000-4000-8000-0000000000a1"; // group head (original email campaign, still a draft)
  const S = "42730000-0000-4000-8000-0000000000a2"; // orphan SMS sibling, campaign_group_id = H
  // Server loadGroup: lead S → group = COALESCE(S.campaign_group_id, S.id) = H → drafts [H, S]. Client names [S].
  const out = MS.selectGroupDrafts([{ id: H, channel: "email" }, { id: S, channel: "sms" }], [S], H);
  assertEquals(out.rows, [{ id: S, channel: "sms" }]); // H is not priced
  assertEquals(out.unlisted, []); // and is never handed back for discarding
});

Deno.test("ADV-13 group figures: two metered quotes in different currencies → null cost, never a sum of unlike money", async () => {
  const sms1 = sms(["US"]), sms2 = sms(["NG"]);
  let i = 0;
  const preview = await GP.buildCampaignGroupPreview({
    loadGroup: () => Promise.resolve({ rows: [{ id: "a", channel: "sms" }, { id: "b", channel: "sms" }], unlisted: [] }),
    candidates: () => Promise.resolve(i++ === 0 ? sms1 : sms2),
    quoteBrand: () => Promise.resolve({ followBrand: null, costCurrency: "NGN" }),
    allowance: (_c: unknown, q: Record<string, unknown>) => Promise.resolve(q),
    errorCode: (e: unknown) => String(e),
    smsCountryLive: () => true, smsRates: RATES,
  } as never, "a", NOW);
  assertEquals(preview.group?.estimatedCostMinor, null);
  assertEquals(preview.group?.currency, null);
  assertEquals(preview.group?.costKind, "provider_estimate");
});
