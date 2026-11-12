// Issue #3355 Wave A (A4) — every readiness handoff opens a screen that can
// fix the item.
//
// MINGLA-INVARIANT: I-ARI-HANDOFF-FIXABLE | issue #3355 | Every readiness item whose fix is a handoff (a route in public.brand_readiness_catalog) names a Host route that exists in mingla-business/app, and every field item names the control and the write that actually change its column; the Time zone item opens Brand profile's Time zone section, which writes brands.default_timezone. Routes are validated against the generated App Map (supabase/functions/_shared/generated/ariAppMap.json), and at runtime a route outside the map is dropped (ariAppMap.ts guardAriReplyRoutes).
//
// Production 2026-11-10: the Time zone item handed a Lagos host to Brand
// profile, which had no time zone field, so "It's done, check now" could
// never pass. This test reads the catalogue from the migrations (the
// catalogue's one home), so a new item, or a route moved to a screen that
// cannot write the column, fails CI.
//
// Also pins the single-zone country list in migration 20280628023355 to the
// edge's own list (MARKET_DEFAULT_TIMEZONES).
//
// Run: deno test --no-check --allow-read \
//   supabase/functions/_shared/__tests__/issue_3355_wave_a_handoff_fixable.implementor.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  ACTION_READINESS_ITEM_LABELS,
  BRAND_READINESS_ITEM_LABELS,
} from "../readinessCatalog.ts";
import { MARKET_DEFAULT_TIMEZONES } from "../payoutCountries.ts";
import { matchAriAppRoute } from "../ariAppMap.ts";

const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));
const exists = (path: string) => {
  try {
    return Deno.statSync(new URL(path, ROOT)).isFile;
  } catch {
    return false;
  }
};

interface CatalogueItem {
  key: string;
  owner_action: string;
  route: string | null;
  route_label: string;
}

/** The catalogue as the migrations leave it: the seed, then route updates. */
function catalogue(): Map<string, CatalogueItem> {
  const seed = read(
    "supabase/migrations/20280307003355_issue_3355_brand_readiness.sql",
  );
  const items = new Map<string, CatalogueItem>();
  const row =
    /\('([a-z_.]+)','([a-z]+)','((?:[^']|'')+)',(\d+),'(brand|action)','([a-z]+)',\s*'(\{[^']*\})',\s*(NULL|'[^']*'),\s*'((?:[^']|'')+)'/g;
  for (const match of seed.matchAll(row)) {
    items.set(match[1], {
      key: match[1],
      owner_action: match[6],
      route: match[8] === "NULL" ? null : match[8].slice(1, -1),
      route_label: match[9].replace(/''/g, "'"),
    });
  }
  const migrations = [
    ...Deno.readDirSync(new URL("supabase/migrations/", ROOT)),
  ]
    .filter((entry) => entry.isFile && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
  const update =
    /UPDATE public\.brand_readiness_catalog\s+SET route_template = '([^']+)'[\s\S]*?WHERE key = '([^']+)'/g;
  for (const name of migrations) {
    const sql = read(`supabase/migrations/${name}`);
    for (const match of sql.matchAll(update)) {
      const item = items.get(match[2]);
      if (item) item.route = match[1];
    }
  }
  return items;
}

/**
 * "/brand/{brand_id}/edit?section=timezone" → the Host screen file, read from
 * the generated App Map (Wave B; it replaced Wave A's filesystem lookup).
 */
function routeFile(route: string): string | null {
  const entry = matchAriAppRoute(
    route.replace(/\{brand_id\}/g, "00000000-0000-4000-8000-000000000000"),
  );
  return entry && exists(entry.file) ? entry.file : null;
}

const EDIT_VIEW = "mingla-business/src/components/brand/BrandEditView.tsx";
const MAPPING = "mingla-business/src/services/brandMapping.ts";
const PLAN_API = "mingla-business/src/sites/planApi.ts";

/**
 * Per-item fix evidence (routes come from the App Map). Each field item: the control on
 * the screen and the write that changes its column. Flow items (payments
 * onboarding, team, venue, Website approval) hand off to a whole flow, so
 * only their screen must exist.
 */
const FIX: Record<
  string,
  { column: string | null; evidence: Array<[file: string, pattern: RegExp]> }
> = {
  name: {
    column: "name",
    evidence: [[EDIT_VIEW, /displayName: v/], [MAPPING, /out\.name =/]],
  },
  description: {
    column: "description",
    evidence: [[EDIT_VIEW, /bio: v/], [
      MAPPING,
      /out\.description = joinBrandDescription/,
    ]],
  },
  tagline: {
    column: "description",
    evidence: [[EDIT_VIEW, /tagline: boundedWebsiteTagline/], [
      MAPPING,
      /out\.description = joinBrandDescription/,
    ]],
  },
  profile_photo: {
    column: "profile_photo_url",
    evidence: [[EDIT_VIEW, /LazyBrandAvatarPickerSheet/], [
      MAPPING,
      /out\.profile_photo_url =/,
    ]],
  },
  cover_media: {
    column: "cover_media_url",
    evidence: [[EDIT_VIEW, /CoverPickerSheet/], [
      MAPPING,
      /out\.cover_media_url =/,
    ]],
  },
  contact_email: {
    column: "contact_email",
    evidence: [[EDIT_VIEW, /contact: \{ \.\.\.draft\.contact, email: v \}/], [
      MAPPING,
      /out\.contact_email =/,
    ]],
  },
  contact_phone: {
    column: "contact_phone",
    evidence: [[EDIT_VIEW, /setPhoneEdit/], [MAPPING, /out\.contact_phone =/]],
  },
  social_links: {
    column: "social_links",
    evidence: [[EDIT_VIEW, /links: \{ \.\.\.draft\.links, website: v \}/], [
      MAPPING,
      /out\.social_links =/,
    ]],
  },
  address: {
    column: "address",
    evidence: [[EDIT_VIEW, /LazyBrandEditAddressField/], [
      MAPPING,
      /out\.address = patch\.address/,
    ]],
  },
  city_country: {
    column: "country_code",
    evidence: [[EDIT_VIEW, /LazyBrandEditAddressField/], [
      MAPPING,
      /out\.city =/,
    ], [MAPPING, /out\.country_code =/]],
  },
  timezone: {
    column: "default_timezone",
    evidence: [
      [EDIT_VIEW, /handleSectionLayout\("timezone"\)/],
      [EDIT_VIEW, /LazyBrandEditTimezoneField/],
      [EDIT_VIEW, /defaultTimezone: zone/],
      [
        "mingla-business/src/components/brand/BrandEditTimezoneField.tsx",
        /onChange\(zone\)/,
      ],
      [
        "mingla-business/src/utils/brandPatch.ts",
        /patch\.defaultTimezone = draft\.defaultTimezone/,
      ],
      [MAPPING, /out\.default_timezone =/],
      ["mingla-business/app/brand/[id]/edit.tsx", /value === "timezone"/],
    ],
  },
  theme: {
    column: "theme_color",
    evidence: [[EDIT_VIEW, /ThemeControlRow/], [MAPPING, /out\.theme_color =/]],
  },
  offerings_selected: {
    column: "site plan offerings",
    evidence: [[PLAN_API, /offerings_selected\?: string\[\]/]],
  },
  design_key: {
    column: "site plan design",
    evidence: [[PLAN_API, /design_key: input\.designKey/]],
  },
  "story.who": {
    column: "site plan story",
    evidence: [[PLAN_API, /story\?: \{ who\?: string/]],
  },
  "story.why": {
    column: "site plan story",
    evidence: [[PLAN_API, /why\?: string/]],
  },
  "story.main_action": {
    column: "site plan story",
    evidence: [[PLAN_API, /main_action\?: string/]],
  },
  venue_descriptor: {
    column: "site plan venue descriptor",
    evidence: [[PLAN_API, /venue_descriptor\?: string \| null/]],
  },
  approved_plan: { column: null, evidence: [[PLAN_API, /approve\?: boolean/]] },
  "money.market": { column: null, evidence: [] },
  "money.currency": { column: null, evidence: [] },
  "money.currency_reconciliation": { column: null, evidence: [] },
  "money.can_sell": { column: null, evidence: [] },
  "money.can_be_paid_out": { column: null, evidence: [] },
  "money.provider_review": { column: null, evidence: [] },
  "money.tax_registration": { column: null, evidence: [] },
  "team.role": { column: null, evidence: [] },
  "venue.approved_exists": { column: null, evidence: [] },
  "stay.settings_complete": { column: null, evidence: [] },
};

Deno.test("I-ARI-HANDOFF-FIXABLE: the catalogue the test reads is the whole catalogue", () => {
  const items = catalogue();
  assertEquals(
    [...items.keys()].sort(),
    [
      ...Object.keys(BRAND_READINESS_ITEM_LABELS),
      ...Object.keys(ACTION_READINESS_ITEM_LABELS),
    ].sort(),
  );
});

Deno.test("I-ARI-HANDOFF-FIXABLE: every handoff route exists and every field handoff writes its column", () => {
  const problems: string[] = [];
  for (const item of catalogue().values()) {
    if (!item.route) continue; // no handoff (e.g. accepted at publish time)
    const fix = FIX[item.key];
    if (!fix) {
      problems.push(`${item.key}: new handoff with no entry in the fix map`);
      continue;
    }
    if (!routeFile(item.route)) {
      problems.push(`${item.key}: route ${item.route} has no Host screen`);
    }
    for (const [file, pattern] of fix.evidence) {
      if (!exists(file) || !pattern.test(read(file))) {
        problems.push(
          `${item.key}: ${file} lacks ${pattern} (writes ${fix.column})`,
        );
      }
    }
  }
  assertEquals(problems, []);
});

Deno.test("I-ARI-HANDOFF-FIXABLE: the Time zone handoff opens Brand profile's Time zone section", () => {
  const item = catalogue().get("timezone");
  assertEquals(item?.route, "/brand/{brand_id}/edit?section=timezone");
  assertEquals(
    routeFile(item!.route!),
    "mingla-business/app/brand/[id]/edit.tsx",
  );
  assert(FIX.timezone.evidence.length >= 6);
});

Deno.test("A4: the migration's single-zone countries are exactly the edge's", () => {
  const sql = read(
    "supabase/migrations/20280628023355_issue_3355_brand_timezone_from_country.sql",
  );
  const fromSql = Object.fromEntries(
    [...sql.matchAll(/\('([A-Z]{2})','([A-Za-z_/]+)'\)/g)].map((
      m,
    ) => [m[1], m[2]]),
  );
  const fromEdge = Object.fromEntries(
    Object.entries(MARKET_DEFAULT_TIMEZONES).filter(([, zone]) =>
      zone !== null
    ),
  );
  assertEquals(fromSql, fromEdge);
  assertEquals(fromSql.NG, "Africa/Lagos");
  assert(!("US" in fromSql), "a multi-zone country is never guessed");
});
