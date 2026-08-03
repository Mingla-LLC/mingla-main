#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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

function need(source, token, label, failures) {
  if (!source.includes(token)) failures.push(`${label}: missing ${token}`);
}

function forbid(source, token, label, failures) {
  if (source.includes(token)) failures.push(`${label}: forbidden ${token}`);
}

export function check(files) {
  const failures = [];

  for (const token of [
    'id: "stay"',
    'label: "Stay"',
    "Hotels, resorts & short stays",
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
    "Menus",
    "Bank & currency",
    "Venue review",
    "router.push(`/brand/${brandId}/payments`",
    'currency.data?.authority === "settlement"',
    "canAcceptPaidReservations",
    "offering.hasOpenAvailability === true",
    'label={isActive ? "Stay is live" : "Publish Stay"}',
    "isStaySettingsComplete",
    "isStaySettingsFormValid",
  ]) {
    need(files.shell ?? "", token, "Stay management readiness", failures);
  }
  forbid(
    files.shell ?? "",
    'currencyCode ?? "USD"',
    "brand currency authority",
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
  need(
    files.workflow ?? "",
    "-f supabase/migrations/__tests__/issue_1424_stay_authoring.test.sql",
    "blocking migration-test wiring",
    failures,
  );
  need(
    files.workflow ?? "",
    "supabase/functions/manage-stay-inventory/index.test.ts",
    "blocking Edge-test wiring",
    failures,
  );
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
  const baseline = check(valid);
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
      "workflow",
      "-f supabase/migrations/__tests__/issue_1424_stay_authoring.test.sql",
      "-f /tmp/dark-issue-1424.sql",
      "issue_1424_stay_authoring.test.sql",
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
    if (!check(broken).some((failure) => failure.includes(expected))) {
      throw new Error(`true-source reversion escaped: ${expected}`);
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
