// Issue #4238 wave 2 — T9: audience ids enter a plan only through the
// version's audience_selection, resolved server-side.
//
// MINGLA-INVARIANT: I-4238-AUDIENCE-SERVER-BOUND | issue #4238 | Provider audience ids enter an ad plan only through canonical_plan.audience_selection resolved server-side: create_version refuses a Host key outside the plan brand (or a hidden seed, or a lookalike outside its country), freeze_targeting strips every client includeAudienceIds / excludeAudienceIds / advantageAudience before compiling, and admin-ad-create-campaign refuses a snapshot whose ids are not exactly the selected, owned, ready audiences.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  audienceCountryMismatch,
  validateAudienceSelection,
} from "../../_shared/adListAudienceRules.ts";

const BRAND = "4238aaaa-0000-4000-8000-000000000001";
const OTHER = "4238bbbb-0000-4000-8000-000000000002";
const HOST = { id: "4238cccc-0000-4000-8000-000000000003", email: "host@t4238.test" };
const PLAN = "4238dddd-0000-4000-8000-000000000004";
const VERSION = "4238eeee-0000-4000-8000-000000000005";
const CONNECTION = "4238ffff-0000-4000-8000-000000000006";

Deno.test("T9 SC-7 a Host key for another brand is audience_not_owned", () => {
  const result = validateAudienceSelection({
    raw: { include_keys: [`brand:${OTHER}:guests`] },
    ownerKind: "host",
    planBrandId: BRAND,
  });
  assertEquals(result, { ok: false, detail: "audience_not_owned" });
});

Deno.test("T9 SC-7 a Host cannot select the hidden seed", () => {
  const result = validateAudienceSelection({
    raw: { include_keys: [`brand:${BRAND}:seed`] },
    ownerKind: "host",
    planBrandId: BRAND,
  });
  assertEquals(result, { ok: false, detail: "audience_not_owned" });
});

Deno.test("T9 a Host's own keys pass; absent means none; more than three or duplicates fail", () => {
  assertEquals(
    validateAudienceSelection({
      raw: { include_keys: [`brand:${BRAND}:guests`, `brand:${BRAND}:lookalike:NG`] },
      ownerKind: "host",
      planBrandId: BRAND,
    }),
    { ok: true, selection: { include_keys: [`brand:${BRAND}:guests`, `brand:${BRAND}:lookalike:NG`] } },
  );
  assertEquals(
    validateAudienceSelection({ raw: undefined, ownerKind: "host", planBrandId: BRAND }),
    { ok: true, selection: { include_keys: [] } },
  );
  for (const keys of [
    [`brand:${BRAND}:guests`, `brand:${BRAND}:guests`],
    ["a", "b", "c", "d"],
    ["not a key"],
  ]) {
    assertEquals(
      validateAudienceSelection({ raw: { include_keys: keys }, ownerKind: "host", planBrandId: BRAND }).ok,
      false,
    );
  }
  // Admin (mingla) plans may use Mingla-wide and any brand's keys.
  assertEquals(
    validateAudienceSelection({
      raw: { include_keys: ["mingla:everyone:cc_ng", `brand:${OTHER}:guests`] },
      ownerKind: "mingla",
      planBrandId: null,
    }).ok,
    true,
  );
});

Deno.test("T9 a lookalike only runs in its own single country", () => {
  const lal = {
    id: "1",
    audience_key: `brand:${BRAND}:lookalike:NG`,
    owner_kind: "host" as const,
    brand_id: BRAND,
    kind: "lookalike" as const,
    display_name: "L",
    lookalike_country: "NG",
    status: "active",
  };
  assertEquals(audienceCountryMismatch([lal], ["NG"]), false);
  assertEquals(audienceCountryMismatch([lal], ["GH"]), true);
  assertEquals(audienceCountryMismatch([lal], ["NG", "GH"]), true);
});

Deno.test("T9 create_version validates the selection and writes it before the plan is hashed", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const block = source.slice(
    source.indexOf('if (action === "create_version")'),
    source.indexOf('if (action === "freeze_targeting")'),
  );
  const validate = block.indexOf("validateAudienceSelection(");
  const written = block.indexOf("canonical.audience_selection = audienceSelection.selection");
  const persist = block.indexOf('db.rpc("ad_plan_create_version"');
  assert(validate > 0 && written > validate && persist > written);
  assert(block.includes('"audience_country_mismatch"'));
});

// ── freeze_targeting, end to end through the handler, fake db, no network ──

type Row = Record<string, unknown>;

class Q {
  private filters: ((row: Row) => boolean)[] = [];
  private patch: Row | null = null;
  private inserted: Row[] | null = null;
  constructor(private db: FreezeDb, private table: string) {}
  select() {
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push((r) => r[c] === v);
    return this;
  }
  in(c: string, v: unknown[]) {
    this.filters.push((r) => v.includes(r[c]));
    return this;
  }
  order() {
    return this;
  }
  update(patch: Row) {
    this.patch = patch;
    return this;
  }
  insert(rows: Row[]) {
    this.inserted = rows;
    this.db.inserts.push(...rows);
    return this;
  }
  maybeSingle() {
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }
  private rows() {
    return (this.db.tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
  }
  then<T>(resolve: (v: unknown) => T) {
    if (this.inserted) return Promise.resolve({ data: this.inserted, error: null }).then(resolve);
    const rows = this.rows();
    if (this.patch) rows.forEach((r) => Object.assign(r, this.patch));
    return Promise.resolve({ data: rows, error: null }).then(resolve);
  }
}

class FreezeDb {
  inserts: Row[] = [];
  auth = {
    getUser: () => Promise.resolve({ data: { user: HOST }, error: null }),
  };
  constructor(public tables: Record<string, Row[]>) {}
  from(table: string) {
    return new Q(this, table);
  }
  rpc(name: string) {
    return Promise.resolve(
      name === "ad_can_host_action" ? { data: true, error: null } : { data: null, error: { message: name } },
    );
  }
}

function freezeTables(state: string): Record<string, Row[]> {
  return {
    admin_users: [],
    ad_plans: [{ id: PLAN, owner_kind: "host", brand_id: BRAND, current_version_id: VERSION, destination_family: "public_mingla_page" }],
    ad_plan_versions: [{
      id: VERSION,
      plan_id: PLAN,
      canonical_plan: {
        platforms: ["meta"],
        audience_selection: { include_keys: [`brand:${BRAND}:guests`] },
      },
    }],
    ad_plan_targeting_snapshots: [],
    ad_plan_provider_allocations: [{ plan_version_id: VERSION, platform: "meta", connection_id: CONNECTION, provider_budget_cents: 5000 }],
    ad_connections: [{ id: CONNECTION, platform: "meta", extra: {} }],
    ad_list_audiences: [
      { id: "aud-own", audience_key: `brand:${BRAND}:guests`, owner_kind: "host", brand_id: BRAND, kind: "list", display_name: "Your past guests", lookalike_country: null, status: "active" },
      { id: "aud-other", audience_key: `brand:${OTHER}:guests`, owner_kind: "host", brand_id: OTHER, kind: "list", display_name: "Their guests", lookalike_country: null, status: "active" },
    ],
    ad_list_audience_platforms: [
      { audience_id: "aud-own", platform: "meta", state, provider_audience_id: "238400000000111" },
      { audience_id: "aud-other", platform: "meta", state: "ready", provider_audience_id: "238400000000999" },
    ],
  };
}

async function freeze(tables: Record<string, Row[]>) {
  Deno.env.set("SUPABASE_URL", Deno.env.get("SUPABASE_URL") || "https://edge.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "service-test");
  const { handleAdPlan } = await import("../index.ts");
  const db = new FreezeDb(tables);
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: Request | URL | string) =>
    Promise.reject(new TypeError(`blocked network: ${String(input)}`))) as typeof fetch;
  try {
    const response = await handleAdPlan(
      new Request("https://edge.test/ad-plan", {
        method: "POST",
        headers: { authorization: "Bearer host", "content-type": "application/json" },
        body: JSON.stringify({
          action: "freeze_targeting",
          plan_version_id: VERSION,
          audience_intent: { countries: ["NG"] },
          // A tampered client: another brand's audience, no exclusions, Advantage+ on.
          refs_by_platform: {
            meta: {
              includeAudienceIds: ["238400000000999"],
              excludeAudienceIds: [],
              advantageAudience: true,
            },
          },
        }),
      }),
      { db: db as never },
    );
    return { status: response.status, body: await response.json(), db };
  } finally {
    globalThis.fetch = realFetch;
  }
}

Deno.test("T9 SC-8 freeze_targeting ignores client audience refs and freezes only the selection", async () => {
  const { status, db } = await freeze(freezeTables("ready"));
  assertEquals(status, 201);
  const snapshot = db.inserts[0];
  const compiled = snapshot.compiled_targeting as Row;
  assertEquals(compiled.custom_audiences, [{ id: "238400000000111" }]);
  assert(!JSON.stringify(compiled).includes("238400000000999"), "another brand's id never frozen");
  assertEquals(compiled.excluded_custom_audiences, undefined);
  assertEquals(compiled.targeting_automation, undefined, "client Advantage+ stripped");
});

Deno.test("T9 a selected audience not ready on a platform blocks it with a plain reason", async () => {
  const { status, db } = await freeze(freezeTables("below_minimum"));
  assertEquals(status, 201);
  const snapshot = db.inserts[0];
  assertEquals(snapshot.verdict, "check_required");
  assertEquals(snapshot.checks_required, ["Your past guests isn't ready on Facebook & Instagram yet."]);
  assertEquals((snapshot.compiled_targeting as Row).custom_audiences, undefined);
});
