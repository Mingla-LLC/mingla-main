// Issue #4238 wave 2 rework 2 — implementor happy-path tests.
// (1) Ari's list_ad_audiences returns the Host app's size words, never a bare
//     number below 10, and nothing for a lookalike.
// (2) admin-ad-create-campaign runs the frozen-audience binding guard on
//     validate_only too, before any provider call.
// Fakes only: no provider, no database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ariAudienceSizeWords, DOMAIN_TOOLS } from "../agentDomainTools.ts";
import { validateOnlyAudienceBinding } from "../adAudienceBinding.ts";

const BRAND = "b4238000-0000-4000-8000-000000000001";
const RIVAL = "b4238000-0000-4000-8000-0000000000c9";

Deno.test("#4238 Ari size words match the Host app's rule", () => {
  const list = (approx_size: number | null, platforms: unknown[] = []) => ({ kind: "list", approx_size, platforms });
  assertEquals(ariAudienceSizeWords(list(0)), "No people yet");
  for (let n = 1; n <= 9; n += 1) assertEquals(ariAudienceSizeWords(list(n)), "Fewer than 10 people");
  assertEquals(ariAudienceSizeWords(list(10)), "About 10 people");
  assertEquals(ariAudienceSizeWords(list(2500)), "About 2,500 people");
  assertEquals(ariAudienceSizeWords(list(null)), "Building now");
  assertEquals(ariAudienceSizeWords(list(400, [{ state: "syncing" }])), "Building now");
  assertEquals(ariAudienceSizeWords({ kind: "lookalike", approx_size: 900, platforms: [] }), null);
});

Deno.test("#4238 list_ad_audiences returns words, no approx_size, and says to repeat them", async () => {
  const rows = [
    { audience_key: `brand:${BRAND}:contacts`, display_name: "Your contacts", kind: "list", approx_size: 1, lookalike_country: null, platforms: [] },
    { audience_key: `brand:${BRAND}:lookalike:NG`, display_name: "x", kind: "lookalike", approx_size: 5, lookalike_country: "NG", platforms: [{ platform: "meta", state: "ready" }] },
  ];
  const client = {
    rpc: (name: string) =>
      Promise.resolve(name === "host_ad_audiences" ? { data: rows, error: null } : { data: null, error: { message: "unexpected" } }),
  };
  const tool = DOMAIN_TOOLS.find((item) => item.name === "list_ad_audiences");
  assert(tool);
  assert(tool.description.includes("repeat it exactly as given"));
  assert(tool.description.includes("Fewer than 10 people"));
  const out = await tool.executor({ brand_id: BRAND }, client, "u1", {} as never) as {
    audiences: Record<string, unknown>[];
  };
  assertEquals(out.audiences.map((row) => row.size), ["Fewer than 10 people", null]);
  assert(out.audiences.every((row) => !("approx_size" in row)));
});

// ── validate_only binding guard ────────────────────────────────────────────

const VERSION = "a4238000-0000-4000-8000-000000000101";
const HASH = "f".repeat(64);
type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
  const reads: string[] = [];
  return {
    reads,
    from(table: string) {
      reads.push(table);
      const filters: ((row: Row) => boolean)[] = [];
      const run = () => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
      const q = {
        select: () => q,
        eq: (col: string, value: unknown) => {
          filters.push((row) => row[col] === value);
          return q;
        },
        in: (col: string, values: unknown[]) => {
          filters.push((row) => values.includes(row[col]));
          return q;
        },
        maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: run(), error: null }),
      };
      return q;
    },
  };
}

function tables(compiledIds: string[], defBrand = BRAND): Record<string, Row[]> {
  return {
    ad_plan_versions: [{
      id: VERSION, plan_id: "p1", plan_hash: HASH,
      canonical_plan: { audience_selection: { include_keys: [`brand:${BRAND}:guests`] } },
    }],
    ad_plans: [{ id: "p1", owner_kind: "host", brand_id: BRAND }],
    ad_plan_targeting_snapshots: [{
      plan_version_id: VERSION, platform: "meta",
      compiled_targeting: { custom_audiences: compiledIds.map((id) => ({ id })) },
    }],
    ad_list_audiences: [{ id: "d1", audience_key: `brand:${BRAND}:guests`, owner_kind: "host", brand_id: defBrand, status: "active" }],
    ad_list_audience_platforms: [{ audience_id: "d1", platform: "meta", state: "ready", provider_audience_id: "ca_1" }],
  };
}

const body = (extra: Record<string, unknown> = {}) => ({
  validate_only: true, plan_version_id: VERSION, plan_hash: HASH, targeting: { countries: ["NG"] }, ...extra,
});

Deno.test("#4238 validate_only passes a correctly bound frozen audience", async () => {
  const verdict = await validateOnlyAudienceBinding(fakeDb(tables(["ca_1"])), {
    platform: "meta", body: body(), ownerKind: "host", brandId: BRAND,
  });
  assertEquals(verdict, { ok: true, prospectingAudienceIds: ["ca_1"] });
});

Deno.test("#4238 validate_only refuses a tampered frozen snapshot", async () => {
  const verdict = await validateOnlyAudienceBinding(fakeDb(tables(["ca_1", "ca_rival"])), {
    platform: "meta", body: body(), ownerKind: "host", brandId: BRAND,
  });
  assertEquals(verdict, { ok: false, detail: "audience_binding_mismatch" });
});

Deno.test("#4238 validate_only refuses another brand's audience and a request-smuggled id", async () => {
  const rival = await validateOnlyAudienceBinding(fakeDb(tables(["ca_1"], RIVAL)), {
    platform: "meta", body: body(), ownerKind: "host", brandId: BRAND,
  });
  assertEquals(rival, { ok: false, detail: "audience_binding_mismatch" });
  const smuggled = await validateOnlyAudienceBinding(fakeDb(tables(["ca_1"])), {
    platform: "meta",
    body: body({ targeting: { countries: ["NG"], custom_audiences: [{ id: "ca_rival" }] } }),
    ownerKind: "host",
    brandId: BRAND,
  });
  assertEquals(smuggled, { ok: false, detail: "audience_binding_mismatch" });
});

Deno.test("#4238 validate_only with no plan may carry no audience ids", async () => {
  const db = fakeDb({});
  const clean = await validateOnlyAudienceBinding(db, {
    platform: "meta", body: { validate_only: true, targeting: { countries: ["NG"] } }, ownerKind: "mingla", brandId: null,
  });
  assertEquals(clean.ok, true);
  assertEquals(db.reads, []);
  const withIds = await validateOnlyAudienceBinding(db, {
    platform: "tiktok", body: { validate_only: true, targeting: { audience_ids: ["t1"] } }, ownerKind: "mingla", brandId: null,
  });
  assertEquals(withIds, { ok: false, detail: "audience_binding_mismatch" });
});

Deno.test("#4238 admin-ad-create-campaign runs the validate guard before any platform branch", async () => {
  const src = await Deno.readTextFile(new URL("../../admin-ad-create-campaign/index.ts", import.meta.url));
  const guard = src.indexOf("await validateOnlyAudienceBinding(supabase");
  const firstBranch = src.indexOf('if (platform === "google") {');
  assert(guard > 0, "validate_only binding guard is wired");
  assert(guard < firstBranch, "guard runs before any provider branch");
});
