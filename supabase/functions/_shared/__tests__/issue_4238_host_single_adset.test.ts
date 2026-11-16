// Issue #4238 W2 items 6b/6c — one Host ad set with 1–5 videos, and Meta's
// Advantage+ audience on unless a list/lookalike is attached or the Host set
// a top age, a gender or a language (amendment A decision 4).
//
// @invariant I-4238-HOST-ONE-ADSET (declared in issue_4238_host_floor_lock.test.ts;
//   extended here: the canonical creative list is 1–5 brand-owned videos)

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  hostCreativeLibraryIds,
  hostMetaAdvantageAudience,
  paidSocialStagesApply,
} from "../adHostPlanRules.ts";
import { freezeHostW2Fields } from "../../ad-plan/index.ts";

const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

Deno.test("6b: 1–5 distinct ids; 6 refused; the single id still works; the first must lead", () => {
  assertEquals(hostCreativeLibraryIds(undefined, ID(1)), {
    ok: true,
    ids: [ID(1)],
  });
  assertEquals(hostCreativeLibraryIds([ID(1), ID(2), ID(3)], ID(1)), {
    ok: true,
    ids: [ID(1), ID(2), ID(3)],
  });
  assertEquals(
    hostCreativeLibraryIds([1, 2, 3, 4, 5, 6].map(ID), ID(1)),
    { ok: false, detail: "creative_library_ids_too_many" },
  );
  assertEquals(hostCreativeLibraryIds([ID(1), ID(1)], ID(1)), {
    ok: false,
    detail: "creative_library_ids_duplicate",
  });
  assertEquals(hostCreativeLibraryIds([ID(2), ID(1)], ID(1)), {
    ok: false,
    detail: "creative_library_id_not_first",
  });
  assertEquals(hostCreativeLibraryIds([], ID(1)), {
    ok: false,
    detail: "creative_library_ids_invalid",
  });
  assertEquals(hostCreativeLibraryIds(["x"], undefined), {
    ok: false,
    detail: "creative_library_ids_invalid",
  });
});

Deno.test("SC-6.2 / decision 4: Advantage+ on by default; off with a list, a gender, a top age, a language or a minimum over 25", () => {
  assertEquals(
    hostMetaAdvantageAudience({
      listOrLookalikeAttached: false,
      targeting: { age_min: 18 },
    }),
    1,
  );
  assertEquals(
    hostMetaAdvantageAudience({
      listOrLookalikeAttached: false,
      targeting: { genders: [1, 2] },
    }),
    1,
  );
  assertEquals(
    hostMetaAdvantageAudience({
      listOrLookalikeAttached: false,
      targeting: { age_max: 65 },
    }),
    1,
  );
  assertEquals(
    hostMetaAdvantageAudience({ listOrLookalikeAttached: true, targeting: {} }),
    0,
  );
  assertEquals(
    hostMetaAdvantageAudience({
      listOrLookalikeAttached: false,
      targeting: { genders: [2] },
    }),
    0,
  );
  assertEquals(
    hostMetaAdvantageAudience({
      listOrLookalikeAttached: false,
      targeting: { age_max: 40 },
    }),
    0,
  );
  assertEquals(
    hostMetaAdvantageAudience({
      listOrLookalikeAttached: false,
      targeting: { locales: [6] },
    }),
    0,
  );
  assertEquals(
    hostMetaAdvantageAudience({
      listOrLookalikeAttached: false,
      targeting: { age_min: 30 },
    }),
    0,
  );
});

Deno.test("SC-6.3: Admin event ads still stage; Host and Ari never do", () => {
  assert(paidSocialStagesApply("mingla", "event-1"));
  assert(!paidSocialStagesApply("host", "event-1"));
});

// A fake for the create_version freeze.
function fakeDb(
  creatives: Record<string, Record<string, unknown>>,
  dates: Record<string, unknown>[] = [],
) {
  // deno-lint-ignore no-explicit-any
  const db: any = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      // deno-lint-ignore no-explicit-any
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => ((filters[c] = v), q),
        is: () => q,
        in: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: () => {
          if (table === "ad_creatives") {
            return Promise.resolve({
              data: creatives[String(filters.id)] ?? null,
              error: null,
            });
          }
          if (table === "event_dates") {
            return Promise.resolve({
              data: dates.find((d) =>
                d.occurrence_key === filters.occurrence_key
              ) ?? null,
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return q;
    },
    rpc: () => Promise.resolve({ data: null, error: { message: "not wired" } }),
  };
  return db;
}

const video = (brand: string) => ({
  id: "x",
  brand_id: brand,
  kind: "video",
  status: "active",
  source: "brand",
  source_brand_id: brand,
  purged_at: null,
});
const plan = {
  id: "p1",
  owner_kind: "host",
  brand_id: "brand-a",
  client_kind: "host",
};

async function freeze(
  canonicalInput: Record<string, unknown>,
  creatives: Record<string, Record<string, unknown>>,
  extra: Record<string, unknown> = {},
) {
  const canonical = structuredClone(canonicalInput);
  const result = await freezeHostW2Fields(
    fakeDb(creatives, (extra.dates as Record<string, unknown>[]) ?? []),
    {
      // deno-lint-ignore no-explicit-any
      plan: plan as any,
      canonical,
      canonicalInput,
      platforms: ["meta"],
      destination: {
        event_id: "ev1",
        result_kind: "tickets",
        title: "Rooftop",
        page_type: "event",
      },
      optimizationMap: { meta: "visits" },
      rows: [],
      hostCurrency: "USD",
    },
  );
  return { result, canonical };
}

Deno.test("adversarial: another brand's creative is refused; a photo is refused (videos only until W3)", async () => {
  const other = await freeze(
    { creative_library_id: ID(1), creative_library_ids: [ID(1), ID(2)] },
    { [ID(2)]: video("brand-b") },
  );
  assertEquals(other.result.ok, false);
  const photo = await freeze(
    { creative_library_id: ID(1), creative_library_ids: [ID(1), ID(2)] },
    { [ID(2)]: { ...video("brand-a"), kind: "image" } },
  );
  assertEquals(photo.result, {
    ok: false,
    detail: "host_video_creative_required",
  });
});

Deno.test("freeze: 3 videos are frozen in order; last-tickets words drafted; a forged ladder is dropped", async () => {
  const { result, canonical } = await freeze(
    {
      creative_library_id: ID(1),
      creative_library_ids: [ID(1), ID(2), ID(3)],
      copy: { primary: "Come" },
      sales_ladder_by_platform: { meta: "purchase" },
      guidance_snapshot: { forged: true },
    },
    { [ID(2)]: video("brand-a"), [ID(3)]: video("brand-a") },
  );
  assertEquals(result, { ok: true });
  assertEquals(canonical.creative_library_ids, [ID(1), ID(2), ID(3)]);
  assertEquals(canonical.creative_library_id, ID(1));
  assertEquals(
    (canonical.copy as Record<string, unknown>).last_tickets,
    "Last tickets for Rooftop",
  );
  assertEquals(canonical.sales_ladder_by_platform, undefined);
  assertEquals(canonical.guidance_snapshot, undefined);
  assertEquals(canonical.occurrence_key, null);
});

Deno.test("5e: a one-date key must be a live date, and the run must end by that date", async () => {
  const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
  const dates = [{
    occurrence_key: "d1",
    start_at: future,
    end_at: future,
    status: "active",
  }];
  const bad = await freeze(
    { creative_library_id: ID(1), occurrence_key: "nope" },
    {},
    { dates },
  );
  assertEquals(bad.result, { ok: false, detail: "occurrence_key_invalid" });
  const late = await freeze(
    {
      creative_library_id: ID(1),
      occurrence_key: "d1",
      schedule: {
        ends_at: new Date(Date.now() + 9 * 86_400_000).toISOString(),
      },
    },
    {},
    { dates },
  );
  assertEquals(late.result, { ok: false, detail: "schedule_after_date_end" });
  const ok = await freeze(
    {
      creative_library_id: ID(1),
      occurrence_key: "d1",
      schedule: { ends_at: future },
    },
    {},
    { dates },
  );
  assertEquals(ok.result, { ok: true });
  assertEquals(ok.canonical.occurrence_key, "d1");
});

Deno.test("wiring: create_version freezes the W2 fields; create applies Advantage+ for Host only", async () => {
  const planSrc = await Deno.readTextFile(
    new URL("../../ad-plan/index.ts", import.meta.url),
  );
  assert(planSrc.includes("const w2 = await freezeHostW2Fields(db, {"));
  const create = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  assert(
    create.includes(
      'if (requestedOwnerKind === "host" && specialAdCategories.length === 0) {',
    ),
  );
  assert(create.includes("advantage_audience: hostMetaAdvantageAudience({"));
});
