#!/usr/bin/env node
// MINGLA-INVARIANT: I-1424-STAY-BUSINESS-AUTHORING | issue #1424 | Stay authoring is flag-gated, Stay-only in its five core destinations and server-owned for currency and publish; venue Menu, Reservations and Waitlist reach a Stay only as feature-driven destinations, each imported once and rendered only for its own destination, so the Stay shell adds nothing to the eager web bundle and the Stay core screens render no venue screen.
// Detail (#4490 spec 07 J and 13): the venue screens are imported statically like the venue route already loads them; table times come only through the same lazy Availability & pricing chunk; each Stay feature destination shows only its own venue module and only when the shared nav and capability filter allow it; no venue screen the venue route already holds statically is lazy-loaded by the Stay shell.
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
  // [TEST-MOD-APPROVED #4490] fix round 6 (R4J-N24): the gate also reads the
  // shared nav rule, the ordinary venue shell (to know which venue screens the
  // route chunk holds statically) and the three separate Stay core screens.
  venueNav: "mingla-business/src/components/venue/venueModules.ts",
  venueShell: "mingla-business/src/components/venue/VenueSuiteShell.tsx",
  stayInventory: "mingla-business/src/components/stay/StayInventoryManager.tsx",
  stayReservations: "mingla-business/src/components/stay/StayReservationsModule.tsx",
  stayStaffAvailability:
    "mingla-business/src/components/stay/StayStaffAvailabilityModule.tsx",
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
const TABLE_TIMES_LAZY = "(await loadVenueHostScreens()).VenueAvailabilityPricingModule";

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
    // #4490 venue owners: the module moved inside the one Host venue owner
    // chunk, so the shell's single lazy load is now through that owner's loader
    // (a separate import() of the module would hoist it into __common).
    if (shell.split(TABLE_TIMES_LAZY).length - 1 !== 1) {
      failures.push(`${label}: table times load through exactly one lazy load (${TABLE_TIMES_LAZY})`);
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

// [TEST-MOD-APPROVED #4490] fix round 6 (R4J-N24): three gaps the Round 4J
// retest proved by mutation.
//  1. Orders on a Stay only when the venue takes orders: every Stay feature
//     destination maps to its own venue module (table_reservations to the
//     venue reservations screen) and is shown only when the shared nav and
//     capability filter allow that module; visible = core + feature, nothing
//     spliced in; and the shared rule keeps Orders behind Menu / Table ordering.
//  2. The Stay core screens stay Stay-only: no venue *Module is statically
//     imported into the shell except the three feature screens, none renders
//     inside StayOverview or StaySettings, and the separate core screens
//     import no venue *Module at all.
//  3. A venue screen the venue route chunk already holds statically (an
//     import in VenueSuiteShell) is never React.lazy-loaded by the Stay shell:
//     that makes a second async chunk and Expo hoists the shared closure into
//     the eager __common chunk (fix round 5's measured cause).
const STAY_FEATURE_MAP = {
  offers: "offers",
  spaces: "spaces",
  today: "today",
  calendar: "calendar",
  requests: "requests",
  table_reservations: "reservations",
  waitlist: "waitlist",
  members: "members",
  // [TEST-MOD-APPROVED #4490] spec 08 O1: the Till is the thirteenth feature
  // destination; it shows the venue `till` module (which opens the Till route).
  till: "till",
  // [TEST-MOD-APPROVED #4490] spec 08 O3: Kitchen and bar shows the venue
  // `stations` module (which opens the station route).
  stations: "stations",
  // [TEST-MOD-APPROVED #4490] spec 08 O5 part B: Close the day shows the venue
  // `close` module.
  close: "close",
  checkin: "checkin",
  menu: "menu",
  orders: "orders",
  guestlist: "guestlist",
};
// [TEST-MOD-APPROVED #4490] spec 08 O1: the destination order is a product
// contract (Round 4J: Seth approved twelve after Stay's five on 21 Nov; spec 08
// puts the Till first among the floor tools, before Check-in, Menu and Orders,
// as the floor design's Operations rail does). Pinned exactly.
const STAY_FEATURE_ORDER = [
  "offers",
  "spaces",
  "today",
  "calendar",
  "requests",
  "table_reservations",
  "waitlist",
  "members",
  "till",
  // [TEST-MOD-APPROVED #4490] spec 08 O3: Kitchen and bar right after the Till
  // (the floor design's Operations rail: Till, Kitchen and bar, …).
  "stations",
  // [TEST-MOD-APPROVED #4490] spec 08 O5 part B: Close the day right after
  // Kitchen and bar, before Check-in.
  "close",
  "checkin",
  "menu",
  "orders",
  "guestlist",
];
const TILL_LAUNCHER_IMPORT = 'import { tillHref, TillLauncher } from "../venue/till/TillLauncher";';
const TILL_LAUNCHER_VENUE_IMPORT = 'import { tillHref, TillLauncher } from "./till/TillLauncher";';
const STATIONS_LAUNCHER_IMPORT = 'import { stationHref, StationsLauncher } from "../venue/station/StationsLauncher";';
const STATIONS_LAUNCHER_VENUE_IMPORT = 'import { stationHref, StationsLauncher } from "./station/StationsLauncher";';
const VENUE_SCREEN_SPEC = /["'](\.\.\/venue\/(?:[\w-]+\/)*Venue\w*Module)["']/;

function objectBody(source, name) {
  const start = source.indexOf(`const ${name}`);
  if (start < 0) return null;
  const open = source.indexOf("= {", start);
  const end = source.indexOf("};", open);
  return open < 0 || end < 0 ? null : source.slice(open, end);
}

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return null;
  const next = source.slice(start + 1).search(/\n(?:export )?function [A-Z]/);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

function checkStayFeatureScope(files, failures) {
  const shell = files.shell ?? "";
  const label = "Stay feature scope";
  const map = objectBody(shell, "STAY_FEATURE_VENUE_MODULE");
  if (map === null) {
    failures.push(`${label}: missing STAY_FEATURE_VENUE_MODULE`);
  } else {
    const pairs = [...map.matchAll(/^\s*([a-z_]+):\s*"([a-z_]+)",?\s*$/gm)]
      .map(([, key, value]) => `${key}:${value}`)
      .sort();
    const expected = Object.entries(STAY_FEATURE_MAP)
      .map(([key, value]) => `${key}:${value}`)
      .sort();
    if (pairs.join(",") !== expected.join(",")) {
      failures.push(
        `${label}: each Stay feature destination must show its own venue module (orders shows Orders only, table_reservations the venue reservations screen)`,
      );
    }
  }
  if (
    !/FEATURE_MODULES\.filter\(\(module\) =>\s*allowedVenueModules\.has\(STAY_FEATURE_VENUE_MODULE\[module\.id\]\),?\s*\)/
      .test(shell)
  ) {
    failures.push(
      `${label}: a Stay feature shows only when the shared nav and capability filter allow its venue module (filter bypassed)`,
    );
  }
  if (!/const allowedVenueModules = useMemo\([\s\S]*?filterVenueModulesForCapabilities\(\s*derived,/.test(shell)) {
    failures.push(`${label}: allowedVenueModules must come from deriveVenueNav through filterVenueModulesForCapabilities`);
  }
  if (!/const visibleModules = useMemo\(\(\) => \{\s*return \[\.\.\.coreModules, \.\.\.featureModules\];\s*\}/.test(shell)) {
    failures.push(`${label}: visible destinations must be exactly the Stay core list then the allowed feature list (nothing spliced in)`);
  }
  // [TEST-MOD-APPROVED #4490] spec 08 O1: the exact destination order, and the
  // Till launcher loaded the same (static) way in both shells, so the Stay
  // shell adds no second chunk for it (the W5/W6 __common hoisting trap).
  const order = listBody(shell, "STAY_FEATURE_MODULE_ORDER");
  const listed = order === null ? [] : [...order.matchAll(/"([a-z_]+)"/g)].map(([, key]) => key);
  if (listed.join(",") !== STAY_FEATURE_ORDER.join(",")) {
    failures.push(
      `${label}: STAY_FEATURE_MODULE_ORDER must be exactly ${STAY_FEATURE_ORDER.join(", ")} (the approved order; the Till sits before Check-in)`,
    );
  }
  const venueShellSource = files.venueShell ?? "";
  if (venueShellSource.includes(TILL_LAUNCHER_VENUE_IMPORT)) {
    if (shell.split(TILL_LAUNCHER_IMPORT).length - 1 !== 1) {
      failures.push(`${label}: the Stay shell imports TillLauncher statically exactly once, like VenueSuiteShell`);
    }
    if (/import\(\s*["']\.\.\/venue\/till\/TillLauncher["']/.test(shell)) {
      failures.push(`${label}: TillLauncher must not be lazy-loaded in the Stay shell (VenueSuiteShell imports it statically)`);
    }
  }
  // [TEST-MOD-APPROVED #4490] spec 08 O3: the Kitchen and bar launcher is
  // static in both shells too, and the station screen is its own route.
  if (venueShellSource.includes(STATIONS_LAUNCHER_VENUE_IMPORT)) {
    if (shell.split(STATIONS_LAUNCHER_IMPORT).length - 1 !== 1) {
      failures.push(`${label}: the Stay shell imports StationsLauncher statically exactly once, like VenueSuiteShell`);
    }
    if (/import\(\s*["']\.\.\/venue\/station\/StationsLauncher["']/.test(shell)) {
      failures.push(`${label}: StationsLauncher must not be lazy-loaded in the Stay shell (VenueSuiteShell imports it statically)`);
    }
  }
  if (/import\(\s*["']\.\.\/venue\/station\/StationScreen["']|from\s+["']\.\.\/venue\/station\/StationScreen["']/.test(shell)) {
    failures.push(`${label}: the station screen is its own route; the Stay shell must not load it`);
  }
  if (/import\(\s*["']\.\.\/venue\/till\/TillScreen["']|from\s+["']\.\.\/venue\/till\/TillScreen["']/.test(shell)) {
    failures.push(`${label}: the Till screen is its own route; the Stay shell must not load it`);
  }
  const nav = files.venueNav ?? "";
  if (
    !nav.includes('const orders = featureOn(features, "menu") || featureOn(features, "table_ordering");') ||
    (nav.match(/\["orders", orders\]/g) ?? []).length !== 2
  ) {
    failures.push(`${label}: Orders must stay behind Menu or Table ordering in deriveVenueNav`);
  }

  // 2. Stay core screens stay Stay-only.
  const allowedStatic = new Set(STAY_VENUE_SCREENS.map(({ name }) => `../venue/${name}`));
  for (const match of shell.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["'];/gm)) {
    const specifier = match[1];
    if (VENUE_SCREEN_SPEC.test(`"${specifier}"`) && !allowedStatic.has(specifier)) {
      failures.push(`${label}: ${specifier} must not be imported into the Stay shell (only the Menu, Reservations and Waitlist feature screens are)`);
    }
  }
  for (const core of ["StayOverview", "StaySettings"]) {
    const body = functionBody(shell, core);
    if (body === null) {
      failures.push(`${label}: missing ${core}`);
      continue;
    }
    const venueRender = /<(?:Lazy)?Venue\w*Module\b/.exec(body);
    if (venueRender !== null) {
      failures.push(`${label}: ${core} must not render a venue screen (${venueRender[0]})`);
    }
  }
  for (const key of ["stayInventory", "stayReservations", "stayStaffAvailability"]) {
    const source = files[key] ?? "";
    if (source.length === 0) {
      failures.push(`${label}: missing ${paths[key]}`);
      continue;
    }
    if (VENUE_SCREEN_SPEC.test(source) && /(?:from|import\()\s*["']\.\.\/venue\/(?:[\w-]+\/)*Venue\w*Module["']/.test(source)) {
      failures.push(`${label}: ${paths[key]} must not import a venue screen`);
    }
  }

  // 3. No lazy load of a venue screen the route chunk holds statically.
  const venueShell = files.venueShell ?? "";
  const routeStatic = new Set(
    [...venueShell.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']\.\/([^"']+)["'];/gm)]
      .map(([, rel]) => `../venue/${rel}`),
  );
  if (routeStatic.size === 0) {
    failures.push(`${label}: could not read VenueSuiteShell's static imports`);
  }
  for (const match of shell.matchAll(/import\(\s*["'](\.\.\/venue\/[^"']+)["']\s*\)/g)) {
    if (routeStatic.has(match[1])) {
      failures.push(
        `${label}: ${match[1]} must not be lazy-loaded here: VenueSuiteShell imports it statically, so a React.lazy chunk hoists its closure into the eager __common chunk (import it statically)`,
      );
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
  checkStayFeatureScope(files, failures);
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
    // [TEST-MOD-APPROVED #4490] fix round 6 (R4J-N24) reversions.
    ["shell", '  orders: "orders",', '  orders: "offers",', "must show its own venue module"],
    // [TEST-MOD-APPROVED #4490] spec 08 O1 reversions: the Till's map entry,
    // its place in the order, and the static launcher import.
    // [TEST-MOD-APPROVED #4490] spec 08 O3: Kitchen and bar now follows the Till in both lists.
    ["shell", '  till: "till",\n  stations: "stations",', '  till: "checkin",\n  stations: "stations",', "must show its own venue module"],
    ["shell", '  "till",\n  // #4490 spec 08 O3', '  // #4490 spec 08 O3', "STAY_FEATURE_MODULE_ORDER must be exactly"],
    ["shell", '  "members",\n  // #4490 spec 08 O1', '  // #4490 spec 08 O1', "STAY_FEATURE_MODULE_ORDER must be exactly"],
    [
      "shell",
      TILL_LAUNCHER_IMPORT,
      'const LazyTillLauncher = React.lazy(() => import("../venue/till/TillLauncher").then((m) => ({ default: m.TillLauncher })));',
      "TillLauncher must not be lazy-loaded",
    ],
    [
      "shell",
      TILL_LAUNCHER_IMPORT,
      TILL_LAUNCHER_IMPORT + '\nimport { TillScreen } from "../venue/till/TillScreen";',
      "the Till screen is its own route",
    ],
    // [TEST-MOD-APPROVED #4490] spec 08 O3 reversions: the Kitchen and bar map
    // entry, its place after the Till, and the static launcher import.
    ["shell", '  stations: "stations",\n  close: "close",', '  stations: "orders",\n  close: "close",', "must show its own venue module"],
    // [TEST-MOD-APPROVED #4490] spec 08 O5 part B reversions: Close the day's map entry and its place after Kitchen and bar.
    ["shell", '  close: "close",\n  checkin: "checkin",', '  close: "orders",\n  checkin: "checkin",', "must show its own venue module"],
    ["shell", '  "stations",\n  // #4490 spec 08 O5 part B', '  // #4490 spec 08 O5 part B', "STAY_FEATURE_MODULE_ORDER must be exactly"],
    ["shell", '  "close",\n  "checkin",\n  "menu",', '  "checkin",\n  "close",\n  "menu",', "STAY_FEATURE_MODULE_ORDER must be exactly"],
    [
      "shell",
      STATIONS_LAUNCHER_IMPORT,
      'const LazyStationsLauncher = React.lazy(() => import("../venue/station/StationsLauncher").then((m) => ({ default: m.StationsLauncher })));',
      "StationsLauncher must not be lazy-loaded",
    ],
    [
      "shell",
      STATIONS_LAUNCHER_IMPORT,
      STATIONS_LAUNCHER_IMPORT + '\nimport { StationScreen } from "../venue/station/StationScreen";',
      "the station screen is its own route",
    ],
    [
      "shell",
      "FEATURE_MODULES.filter((module) =>\n        allowedVenueModules.has(",
      'FEATURE_MODULES.filter((module) =>\n        module.id === "orders" || allowedVenueModules.has(',
      "filter bypassed",
    ],
    [
      "shell",
      "return [...coreModules, ...featureModules];",
      'return [...coreModules, ...FEATURE_MODULES.filter((module) => module.id === "menu"), ...featureModules];',
      "nothing spliced in",
    ],
    [
      "venueNav",
      'const orders = featureOn(features, "menu") || featureOn(features, "table_ordering");',
      "const orders = true;",
      "Orders must stay behind Menu",
    ],
    [
      "shell",
      'import { VenueMenuModule } from "../venue/VenueMenuModule";',
      'import { VenueMenuModule } from "../venue/VenueMenuModule";\nimport { VenueSettingsModule } from "../venue/VenueSettingsModule";',
      "../venue/VenueSettingsModule must not be imported into the Stay shell",
    ],
    [
      "shell",
      '<Text style={styles.pageTitle}>Stay settings</Text>',
      '<Text style={styles.pageTitle}>Stay settings</Text>\n        <LazyVenueTablesModule brandId={brandId} venueId={venueId} />',
      "StaySettings must not render a venue screen",
    ],
    [
      "shell",
      '<Text style={styles.pageTitle}>Stay overview</Text>',
      '<Text style={styles.pageTitle}>Stay overview</Text>\n          <VenueOrdersModule brandId={brandId} venueId={venueId} />',
      "StayOverview must not render a venue screen",
    ],
    [
      "stayInventory",
      'import React',
      'import { VenueTablesModule } from "../venue/VenueTablesModule";\nimport React',
      "StayInventoryManager.tsx must not import a venue screen",
    ],
    [
      "stayReservations",
      'import React',
      'const LazyTables = React.lazy(() => import("../venue/VenueTablesModule"));\nimport React',
      "StayReservationsModule.tsx must not import a venue screen",
    ],
    [
      "stayStaffAvailability",
      'import React',
      'import { VenueAvailabilityModule } from "../venue/VenueAvailabilityModule";\nimport React',
      "StayStaffAvailabilityModule.tsx must not import a venue screen",
    ],
    [
      "shell",
      'const LazyConfirmDialog = React.lazy(async () => {',
      'const LazyVenueTablesModule = React.lazy(async () => {\n  const mod = await import("../venue/VenueTablesModule");\n  return { default: mod.VenueTablesModule };\n});\nconst LazyConfirmDialog = React.lazy(async () => {',
      "../venue/VenueTablesModule must not be lazy-loaded here",
    ],
    [
      "shell",
      'const LazyConfirmDialog = React.lazy(async () => {',
      'const LazyVenueIntelligenceModule = React.lazy(() => import("../venue/VenueIntelligenceModule"));\nconst LazyConfirmDialog = React.lazy(async () => {',
      "../venue/VenueIntelligenceModule must not be lazy-loaded here",
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
