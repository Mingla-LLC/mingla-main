#!/usr/bin/env node
// MINGLA-INVARIANT: I-1424-STAY-BUSINESS-AUTHORING | issue #1424 | Stay authoring is flag-gated, Stay-only in its five core destinations and server-owned for currency and publish; the venue Menu, Reservations and Waitlist screens reach a Stay only as the feature-driven Menu, Table reservations and Waitlist destinations, each imported once and rendered only for its own destination, statically like the venue route already loads them, and table times only through the same lazy Availability & pricing chunk, so the Stay shell adds nothing to the eager web bundle (#4490 spec 07 J and 13).
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { listLane } from "../ci-discovery/load-plan.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const paths = {
  picker: "mingla-business/src/components/brand/VenueCategoryPicker.tsx",
  create: "mingla-business/app/venue/create.tsx",
  claim: "mingla-business/src/components/venue/claim/ClaimStepCategory.tsx",
  management: "mingla-business/app/venue/[venueId]/index.tsx",
  shell: "mingla-business/src/components/stay/StaySuiteShell.tsx",
  readiness: "mingla-business/src/components/stay/staySettingsReadiness.ts",
  featureService: "mingla-business/src/services/featureFlagService.ts",
  inventoryService: "mingla-business/src/services/stayInventoryService.ts",
  edge: "supabase/functions/manage-stay-inventory/index.ts",
  provider: "supabase/functions/run-business-place-authoring-pipeline/index.ts",
  migration:
    "supabase/migrations/20270131014240_issue_1424_stay_authoring_publish.sql",
  sqlTest: "supabase/migrations/__tests__/issue_1424_stay_authoring.test.sql",
  businessTest:
    "mingla-business/src/components/stay/__tests__/stayAuthoring.issue1424.test.ts",
  edgeTest: "supabase/functions/manage-stay-inventory/index.test.ts",
  workflow: ".github/workflows/supabase-migrations-and-stripe-deno.yml",
};

const expectedSuites = [
  ["migrations", paths.sqlTest, "psql-pg17-post-replay"],
  ["migrations", "supabase/migrations/__tests__/issue_1424_stay_authoring.tester_adversarial.test.sql", "psql-pg17-post-replay"],
  ["stripe-deno", paths.edgeTest, "deno-1.46-stripe"],
];

function effectiveSuites() {
  return {
    migrations: listLane("migrations"),
    "stripe-deno": listLane("stripe-deno"),
  };
}

function need(source, token, label, failures) {
  if (!source.includes(token)) failures.push(`${label}: missing ${token}`);
}

function forbid(source, token, label, failures) {
  if (source.includes(token)) failures.push(`${label}: forbidden ${token}`);
}

// [TEST-MOD-APPROVED #4490] fix round 5 (spec 07 13): the Stay shell shows
// three venue screens as feature destinations. They are imported STATICALLY:
// the venue route chunk already holds them through VenueSuiteShell, and a
// React.lazy import would make each its own async chunk, which Expo's web
// serializer answers by hoisting the shared closure into the EAGER __common
// chunk (fix round 4 measured +58,157 B raw for Menu alone). Table times come
// through the ordinary shell's own lazy Availability & pricing chunk.
const STAY_VENUE_SCREENS = [
  { name: "VenueMenuModule", destination: "menu" },
  { name: "VenueReservationsModule", destination: "table_reservations" },
  { name: "VenueWaitlistModule", destination: "waitlist" },
];
const TABLE_TIMES_PATH = "../venue/features/VenueAvailabilityPricingModule";

function listBody(source, name) {
  const start = source.indexOf(`const ${name}`);
  if (start < 0) return null;
  const end = source.indexOf("];", start);
  return end < 0 ? null : source.slice(start, end);
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The `if (activeModule === "<key>")` block a source offset sits in. */
function destinationAt(source, offset) {
  const before = source.slice(0, offset);
  const matches = [...before.matchAll(/if \(activeModule === "([a-z_]+)"\) \{/g)];
  return matches.length === 0 ? null : matches[matches.length - 1][1];
}

function checkFeatureVenueScreens(shell, failures) {
  const label = "Stay feature-driven venue screens";
  for (const { name, destination } of STAY_VENUE_SCREENS) {
    const specifier = `../venue/${name}`;
    const importLine = `import { ${name} } from "${specifier}";`;
    if (new RegExp(`import\\(\\s*["']${escapeRe(specifier)}["']`).test(shell)) {
      failures.push(
        `${label}: ${name} must not be dynamically imported (React.lazy hoists it into the eager __common chunk; import it statically like VenueSuiteShell)`,
      );
    }
    if (!shell.includes(name)) continue;
    if (shell.split(importLine).length - 1 !== 1) {
      failures.push(`${label}: expected exactly one ${importLine}`);
    }
    const rest = shell.split(importLine).join("");
    const uses = [...rest.matchAll(new RegExp(`\\b${name}\\b`, "g"))];
    const renders = [...rest.matchAll(new RegExp(`<${name}\\b`, "g"))];
    if (uses.length !== 1 || renders.length !== 1) {
      failures.push(
        `${label}: forbidden ${name} outside its one import and its one ${destination} render`,
      );
      continue;
    }
    if (destinationAt(rest, renders[0].index) !== destination) {
      failures.push(
        `${label}: ${name} must render once, only for activeModule === "${destination}"`,
      );
    }
  }
  if (shell.includes("VenueAvailabilityPricingModule")) {
    if (shell.split(`await import("${TABLE_TIMES_PATH}")`).length - 1 !== 1) {
      failures.push(`${label}: table times load through exactly one lazy import of ${TABLE_TIMES_PATH}`);
    }
    if (new RegExp(`from ["']${escapeRe(TABLE_TIMES_PATH)}["']`).test(shell)) {
      failures.push(`${label}: table times must not be a static import (it is its own lazy chunk)`);
    }
  }
  const core = listBody(shell, "CORE_MODULES");
  const feature = listBody(shell, "STAY_FEATURE_MODULE_ORDER");
  if (core === null || /"(menu|orders|table_reservations|waitlist)"/.test(core)) {
    failures.push(`${label}: menu, orders, table reservations and waitlist must not be Stay core destinations`);
  }
  for (const key of ["menu", "table_reservations", "waitlist"]) {
    if (feature === null || !feature.includes(`"${key}"`)) {
      failures.push(`${label}: ${key} must come from STAY_FEATURE_MODULE_ORDER`);
    }
  }
}

export function check(files, plans = effectiveSuites()) {
  const failures = [];

  for (const token of [
    'id: "stay"',
    'label: "Stay"',
    // [TEST-MOD-APPROVED #4490] nine-venue defect N14 (fix round 1): the Stay
    // card reads "and", not "&", like every other type description.
    "Hotels, resorts and short stays",
    "includeStay = false",
    'value === "stay"',
  ]) {
    need(files.picker ?? "", token, "canonical category picker", failures);
  }
  forbid(
    files.picker ?? "",
    'id: "hotel"',
    "canonical category picker",
    failures,
  );
  forbid(
    files.picker ?? "",
    'id: "resort"',
    "canonical category picker",
    failures,
  );

  for (const key of ["create", "claim"]) {
    need(
      files[key] ?? "",
      'useFeatureFlag("STAY_VENUE_AUTHORING")',
      `${key} feature gate`,
      failures,
    );
    need(files[key] ?? "", "stayDisabled=", `${key} feature gate`, failures);
  }
  for (const token of [
    '.from("feature_flags")',
    '.eq("flag_key", flagKey)',
    "return false",
  ]) {
    need(
      files.featureService ?? "",
      token,
      "server-owned fail-closed flag read",
      failures,
    );
  }

  for (const token of [
    'venue.venueCategory === "stay"',
    "<StaySuiteShell",
    "<VenueSuiteShell",
    'venue.venueCategory !== "stay"',
  ]) {
    need(files.management ?? "", token, "Stay-only management shell", failures);
  }
  for (const token of [
    "Stay basics",
    "Property type (optional)",
    "Amenities & accessibility",
    "Rooms & Places",
    "Availability & pricing",
    "Bank & currency",
    "Venue review",
    "router.push(`/brand/${brandId}/payments`",
    'currency.data?.authority === "settlement"',
    "canAcceptPaidReservations",
    "offering.hasOpenAvailability === true",
    "Manage your live Stay",
    "!isActive && isWideDesktop",
    "!isActive && !isWideDesktop",
    "isStaySettingsComplete",
    "isStaySettingsFormValid",
  ]) {
    need(files.shell ?? "", token, "Stay management readiness", failures);
  }
  // [TEST-MOD-APPROVED #4490] spec 07 J (approved 19 Nov 2026) adds Menu and
  // Orders to a Stay as feature-driven destinations that reuse the venue
  // modules; spec 07 13 (21 Nov 2026) adds Table reservations and Waitlist.
  // What still holds: no Menus core tab, no Stay-owned menu rail, and each
  // venue screen imported once and rendered only for its feature destination.
  // Fix round 5 replaced "lazy only" with "static, like the venue route": the
  // lazy form hoisted Menu into the eager bundle (see STAY_VENUE_SCREENS).
  for (const token of ['id: "menu"', 'label: "Menus"', "StayMenuModule"]) {
    forbid(files.shell ?? "", token, "Stay-only menu ownership", failures);
  }
  checkFeatureVenueScreens(files.shell ?? "", failures);
  forbid(
    files.shell ?? "",
    'currencyCode ?? "USD"',
    "brand currency authority",
    failures,
  );
  forbid(
    files.shell ?? "",
    'label={isActive ? "Stay is live" : "Publish Stay"}',
    "active Stay lifecycle honesty",
    failures,
  );
  forbid(
    files.readiness ?? "",
    "settings.property_kind !== null",
    "optional property metadata",
    failures,
  );
  forbid(
    files.readiness ?? "",
    "propertyKind !== null &&",
    "optional property metadata",
    failures,
  );

  for (const token of [
    'action: "save_settings"',
    'action: "publish_stay"',
    "expectedVersion: input.expectedVersion",
  ]) {
    need(
      files.inventoryService ?? "",
      token,
      "client authoring actions",
      failures,
    );
  }
  for (const token of [
    'body.action === "publish_stay"',
    'client.rpc("biz_publish_stay"',
    'body.action === "save_settings"',
    'client.rpc("biz_save_stay_settings_v2"',
    ': await client.rpc("biz_manage_stay_inventory"',
  ]) {
    need(files.edge ?? "", token, "exact RPC routing", failures);
  }

  for (const token of [
    "CREATE OR REPLACE FUNCTION public.biz_save_stay_settings_v2",
    "CREATE OR REPLACE FUNCTION public.biz_publish_stay",
    "issue_1424_guard_stay_activation",
    "STAY_VENUE_AUTHORING",
    "stay_authoring_disabled",
    "v_venue.claim_status <> 'verified'",
    "public.pg_brand_can_collect",
    "brand_currency_reconciliations",
    "price.currency_code = v_default_currency",
    "public.stay_room_nights",
    "public.stay_place_windows",
    "'hasOpenAvailability'",
    "'stay.publish'",
    "public.issue_1387_has_brand_capability",
    "GRANT EXECUTE ON FUNCTION public.biz_publish_stay",
    "TO authenticated",
  ]) {
    need(files.migration ?? "", token, "database publish boundary", failures);
  }
  forbid(
    files.migration ?? "",
    "GRANT EXECUTE ON FUNCTION public.biz_publish_stay(\n  uuid, bigint, uuid\n) TO anon",
    "database publish boundary",
    failures,
  );
  forbid(
    files.migration ?? "",
    "OR v_settings.property_kind IS NULL",
    "optional property metadata",
    failures,
  );
  need(
    files.provider ?? "",
    'if (category === "stay")',
    "provider-boundary Stay mapping",
    failures,
  );
  need(
    files.provider ?? "",
    'primaryType: "lodging"',
    "provider-boundary Stay mapping",
    failures,
  );

  for (const key of ["sqlTest", "businessTest", "edgeTest"]) {
    if (!(files[key] ?? "").includes("1424")) {
      failures.push(`${key}: missing executable issue marker`);
    }
  }
  for (const [lane, suitePath, profile] of expectedSuites) {
    const matches = (plans[lane] ?? []).filter((row) => row.path === suitePath && row.profile === profile);
    if (matches.length !== 1) {
      failures.push(`effective suite plan: expected exactly one ${lane}/${profile} row for ${suitePath}; found ${matches.length}`);
    }
  }
  return failures;
}

function readFiles() {
  return Object.fromEntries(
    Object.entries(paths).map(([key, relative]) => [
      key,
      fs.readFileSync(path.join(root, relative), "utf8"),
    ]),
  );
}

function selfTest() {
  const valid = readFiles();
  const plans = effectiveSuites();
  const baseline = check(valid, plans);
  if (baseline.length > 0) {
    throw new Error(`baseline invalid:\n${baseline.join("\n")}`);
  }
  const reversions = [
    ["picker", 'id: "stay"', 'id: "hotel"', 'id: "stay"'],
    [
      "create",
      'useFeatureFlag("STAY_VENUE_AUTHORING")',
      'useFeatureFlag("ALWAYS_ON")',
      "STAY_VENUE_AUTHORING",
    ],
    [
      "management",
      'venue.venueCategory === "stay"',
      "true",
      'venue.venueCategory === "stay"',
    ],
    [
      "shell",
      'currency.data?.authority === "settlement"',
      "true",
      "settlement",
    ],
    [
      "shell",
      "Manage your live Stay",
      "Ready to publish",
      "Manage your live Stay",
    ],
    [
      "shell",
      '{ id: "settings", label: "Settings", icon: "settings" }',
      '{ id: "menu", label: "Menus", icon: "menu" },\n  { id: "settings", label: "Settings", icon: "settings" }',
      'label: "Menus"',
    ],
    [
      "shell",
      'import { StayActionBar } from "./StayActionBar";',
      'import { StayActionBar } from "./StayActionBar";\nimport { VenueMenuModule } from "../venue/VenueMenuModule";',
      'expected exactly one import { VenueMenuModule }',
    ],
    [
      "shell",
      'import { VenueMenuModule } from "../venue/VenueMenuModule";',
      'const LazyVenueMenuModule = React.lazy(async () => {\n  const mod = await import("../venue/VenueMenuModule");\n  return { default: mod.VenueMenuModule };\n});',
      "VenueMenuModule must not be dynamically imported",
    ],
    [
      "shell",
      'import { VenueReservationsModule } from "../venue/VenueReservationsModule";',
      'const LazyVenueReservationsModule = React.lazy(() => import("../venue/VenueReservationsModule").then((m) => ({ default: m.VenueReservationsModule })));',
      "VenueReservationsModule must not be dynamically imported",
    ],
    [
      "shell",
      'if (activeModule === "waitlist") {',
      'if (activeModule === "overview") {',
      'VenueWaitlistModule must render once, only for activeModule === "waitlist"',
    ],
    [
      "shell",
      '  "table_reservations",\n  "waitlist",\n',
      '  "waitlist",\n',
      "table_reservations must come from STAY_FEATURE_MODULE_ORDER",
    ],
    [
      "shell",
      'import { Tabs } from "../ui/Tabs";',
      'import { Tabs } from "../ui/Tabs";\nimport { VenueAvailabilityPricingModule as StaticTableTimes } from "../venue/features/VenueAvailabilityPricingModule";',
      "table times must not be a static import",
    ],
    [
      "shell",
      '{ id: "settings", label: "Settings", icon: "settings" },\n];',
      '{ id: "settings", label: "Settings", icon: "settings" },\n  { id: "orders", label: "Orders", icon: "receipt" },\n];',
      "must not be Stay core destinations",
    ],
    [
      "shell",
      '{ id: "settings", label: "Settings", icon: "settings" },\n];',
      '{ id: "settings", label: "Settings", icon: "settings" },\n  { id: "table_reservations", label: "Table reservations", icon: "calendar" },\n];',
      "must not be Stay core destinations",
    ],
    [
      "shell",
      'if (activeModule === "menu") {',
      'if (activeModule === "overview") {',
      "only for activeModule",
    ],
    [
      "picker",
      "Hotels, resorts and short stays",
      "Hotels, resorts & short stays",
      "Hotels, resorts and short stays",
    ],
    [
      "edge",
      'client.rpc("biz_publish_stay"',
      'client.rpc("biz_manage_stay_inventory"',
      "biz_publish_stay",
    ],
    [
      "migration",
      "public.pg_brand_can_collect",
      "true",
      "pg_brand_can_collect",
    ],
    [
      "migration",
      "price.currency_code = v_default_currency",
      "true",
      "price.currency_code",
    ],
    [
      "readiness",
      "settings !== null &&",
      "settings !== null &&\n    settings.property_kind !== null &&",
      "settings.property_kind !== null",
    ],
    [
      "migration",
      "OR char_length(pg_catalog.btrim(COALESCE(v_settings.summary, ''))) < 20",
      "OR v_settings.property_kind IS NULL\n     OR char_length(pg_catalog.btrim(COALESCE(v_settings.summary, ''))) < 20",
      "property_kind",
    ],
  ];
  for (const [key, from, to, expected] of reversions) {
    const broken = { ...valid, [key]: valid[key].replace(from, to) };
    if (!check(broken, plans).some((failure) => failure.includes(expected))) {
      throw new Error(`true-source reversion escaped: ${expected}`);
    }
  }
  for (const [label, mutate] of [
    ["delete", (rows) => rows.filter((row) => row.path !== paths.sqlTest)],
    ["duplicate", (rows) => [...rows, rows.find((row) => row.path === paths.sqlTest)]],
    ["wrong-profile", (rows) => rows.map((row) => row.path === paths.sqlTest ? { ...row, profile: "deno-1.46-stripe" } : row)],
  ]) {
    const brokenPlans = { ...plans, migrations: mutate(plans.migrations) };
    if (!check(valid, brokenPlans).some((failure) => failure.includes(paths.sqlTest))) {
      throw new Error(`effective-plan ${label} reversion escaped`);
    }
  }
  console.log(
    `issue-1424 Stay business authoring self-test: PASS (${reversions.length} reversions)`,
  );
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const failures = check(readFiles());
  if (failures.length > 0) {
    console.error("I-1424-STAY-BUSINESS-AUTHORING violated:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(
    "I-1424-STAY-BUSINESS-AUTHORING: PASS (flag, shell, currency, publish, tests)",
  );
}
