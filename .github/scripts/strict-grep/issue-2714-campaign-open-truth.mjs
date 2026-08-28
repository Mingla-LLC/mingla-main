#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const files = {
  migration:
    "supabase/migrations/20270606002714_issue_2714_campaign_open_tracking_truth.sql",
  send: "supabase/functions/marketing-send/index.ts",
  webhook: "supabase/functions/resend-webhook/index.ts",
  overviewService:
    "mingla-business/src/services/marketing/marketingOverviewService.ts",
  reportService:
    "mingla-business/src/services/marketing/marketingReportService.ts",
  overview: "mingla-business/app/(tabs)/marketing/index.tsx",
  report: "mingla-business/app/(tabs)/marketing/campaigns/[id].tsx",
  overviewNoRevenueTest:
    "mingla-business/app/(tabs)/marketing/__tests__/overview-no-revenue.test.ts",
  brandScopeTest:
    "mingla-business/src/services/marketing/__tests__/issue2514BrandScopedCampaigns.test.ts",
  issue1821DenoTest:
    "supabase/functions/marketing-send/issue-1821-accepted-email-sms-invites.test.ts",
  privacy: "mingla-marketing/lib/privacyContent.ts",
  invariant: "docs/INVARIANT_REGISTRY.md",
  ciManifest: ".github/ci-batch/MANIFEST.json",
  // Split the historical workflow stem so CI-batch provider discovery does
  // not mistake this gate's input path for an external provider declaration.
  workflow: [".github", "workflows", "issue-" + "1995-contact-book-blast.yml"]
    .join("/"),
};

const migrationPath = files.migration;
const migrationName = path.basename(migrationPath);
const migrationPrefix = migrationName.slice(0, 14);
const supersededMigrationName =
  "20270605002714_issue_2714_campaign_open_tracking_truth.sql";
// #2714 was applied after this exact then-current production predecessor. Seal
// that boundary instead of requiring #2714 to remain the newest migration
// forever: future forward-only migrations must sort after the applied receipt,
// while any later backfill inserted into this closed interval stays forbidden.
const expectedPredecessorPrefix = "20270605002728";
const expectedMigrationSha =
  "8f92c35319c91a16b45b5afbaa2ee5e8b2557b33fd337fb8f16e67f5441ee6e5";

let failures = 0;
const fail = (name, message) => {
  failures += 1;
  console.error(`FAIL [${name}] ${message}`);
};
const pass = (name) => console.log(`OK   [${name}]`);
const requireAll = (name, source, needles) => {
  const missing = needles.filter((needle) => !source.includes(needle));
  if (missing.length) fail(name, `missing: ${missing.join(", ")}`);
  else pass(name);
};
const requireAbsent = (name, source, needles) => {
  const found = needles.filter((needle) => source.includes(needle));
  if (found.length) fail(name, `forbidden: ${found.join(", ")}`);
  else pass(name);
};
const requireExactCount = (name, source, needle, expected) => {
  const count = source.split(needle).length - 1;
  if (count !== expected) {
    fail(
      name,
      `expected ${expected} occurrence(s) of ${needle}, found ${count}`,
    );
  } else pass(name);
};

function checkMigrationContract(
  sources,
  migrationEntries,
  migrationSha,
  targetMigrationName = migrationName,
) {
  const targetPrefix = targetMigrationName.slice(0, 14);
  const canonical = migrationEntries.filter((entry) =>
    /^\d{14}_.+\.sql$/.test(entry)
  );
  const targetCount = canonical.filter((entry) =>
    entry === targetMigrationName
  ).length;
  const prefixMatches = canonical.filter((entry) =>
    entry.startsWith(`${targetPrefix}_`)
  );
  const otherPrefixes = canonical
    .filter((entry) => entry !== targetMigrationName)
    .map((entry) => entry.slice(0, 14));
  const maxPredecessor = otherPrefixes
    .filter((prefix) => prefix < targetPrefix)
    .sort()
    .at(-1) ?? "00000000000000";

  if (targetCount !== 1) {
    fail(
      "migration-target",
      `expected one ${targetMigrationName}, found ${targetCount}`,
    );
  } else pass("migration-target");
  if (prefixMatches.length !== 1) {
    fail(
      "migration-prefix-unique",
      `expected one ${targetPrefix} prefix, found ${prefixMatches.length}`,
    );
  } else pass("migration-prefix-unique");
  if (
    targetPrefix <= expectedPredecessorPrefix ||
    maxPredecessor !== expectedPredecessorPrefix
  ) {
    fail(
      "migration-prefix-order",
      `${targetPrefix} must immediately follow sealed predecessor ${expectedPredecessorPrefix}; found ${maxPredecessor}`,
    );
  } else pass("migration-prefix-order");
  if (migrationSha !== expectedMigrationSha) {
    fail(
      "migration-sha",
      `expected ${expectedMigrationSha}, found ${migrationSha}`,
    );
  } else pass("migration-sha");

  for (const [key, needle] of [
    ["workflow-migration-reference", migrationPath],
    ["ci-manifest-migration-reference", migrationPath],
    ["invariant-migration-reference", migrationName],
  ]) {
    let sourceKey = "invariant";
    if (key.startsWith("workflow")) sourceKey = "workflow";
    else if (key.startsWith("ci-")) sourceKey = "ciManifest";
    requireExactCount(key, sources[sourceKey], needle, 1);
    requireAbsent(`${key}-superseded`, sources[sourceKey], [
      supersededMigrationName,
    ]);
  }
}

function check(sources, migrationEntries, migrationSha) {
  checkMigrationContract(sources, migrationEntries, migrationSha);
  const compact = Object.fromEntries(
    Object.entries(sources).map((
      [key, source],
    ) => [key, source.replace(/\s+/g, " ")]),
  );
  requireAll("schema-and-reconcile", sources.migration, [
    "delivery_tracking_eligible_at",
    "open_tracking_eligible_at",
    "tracking_sender_domain = 'campaigns.usemingla.com'",
    "mkt_reconcile_email_event",
    "issue_2714_reconcile_provider_events",
    "mkt_campaign_email_event_health",
    "campaign_unmatched_stale",
  ]);
  requireAll("campaign-sender", sources.send, [
    "@campaigns.usemingla.com",
    "delivery_tracking_eligible_at: eligibleAt",
    "open_tracking_eligible_at: eligibleAt",
    'tracking_sender_domain: "campaigns.usemingla.com"',
    "id,status,provider_message_id,sent_at,delivery_tracking_eligible_at,open_tracking_eligible_at,tracking_sender_domain",
    "publicEmailAcceptedStatus(row.status)",
    "row.provider_message_id === providerMessageId",
    "row.sent_at !== null",
    "row.delivery_tracking_eligible_at !== null",
    "row.open_tracking_eligible_at !== null",
    'row.tracking_sender_domain === "campaigns.usemingla.com"',
  ]);
  requireAbsent("campaign-sender-no-apex", sources.send, [
    "`${fromDisplay} <${fromLocal}@usemingla.com>`",
    'row.status === "sent"',
  ]);
  requireAll("webhook-retry", sources.webhook, [
    'data === "campaign_unmatched"',
    'data === "campaign_unmatched_stale"',
    "status: 500",
    "correlationHash",
  ]);
  for (const key of ["overviewService", "reportService"]) {
    requireAll(`${key}-truth`, sources[key], [
      "trackedDelivered",
      "hasDeliveryCoverage",
      "hasOpenCoverage",
      "mkt_campaign_email_event_health",
      '.order("id"',
      ".range(",
    ]);
    requireAbsent(`${key}-legacy`, sources[key], ["hasEventCoverage"]);
  }
  requireAll("independent-coverage-formulas", compact.overviewService, [
    "hasDeliveryCoverage: health.delivery_healthy && deliveryEligible > 0",
    "hasOpenCoverage: health.open_healthy && trackedDelivered > 0",
  ]);
  requireExactCount(
    "overview-brand-scoped-whitelists",
    sources.overviewService,
    '.in("campaign_id", ids)',
    2,
  );
  requireAll("report-independent-coverage-formulas", compact.reportService, [
    "hasDeliveryCoverage: health.delivery_healthy && deliveryEligible.length > 0",
    "hasOpenCoverage: health.open_healthy && trackedDeliveredRows.length > 0",
  ]);
  requireAll("overview-ui", compact.overview, [
    "snap.funnel.opened / snap.funnel.trackedDelivered",
    '? "degraded"',
    ': "notMeasured"',
  ]);
  requireAll("report-ui", compact.report, [
    "recipientStats.opened / recipientStats.trackedDelivered",
    "What these numbers mean",
    "Opened is an estimate based on a tiny image in the email.",
    "Emails sent before open tracking was enabled show — because those opens were never measured.",
  ]);
  requireAll("privacy", sources.privacy, [
    "August 27, 2026",
    "Marketing email measurement",
    "campaigns.usemingla.com",
    "Resend",
  ]);
  requireAll("draft-invariant", sources.invariant, [
    "I-2714-CAMPAIGN-OPEN-TRUTH",
    "DRAFT",
  ]);
  requireAll("overview-test-independent-truth", sources.overviewNoRevenueTest, [
    "hasDeliveryCoverage",
    "hasOpenCoverage",
    "trackedDelivered",
    "openHealthy",
  ]);
  requireAbsent("overview-test-discovery", sources.overviewNoRevenueTest, [
    "describe.skip(",
    "describe.only(",
    "it.skip(",
    "it.only(",
    "test.skip(",
    "test.only(",
  ]);
  requireAll("brand-test-whitelist-truth", sources.brandScopeTest, [
    '.eq("brand_id", brandId)',
    "const windowCampaignIds = windowCampaigns.map((c) => c.id)",
    '.in("campaign_id", ids)',
    "loadWindowMessages",
    "loadClickedMessageIds",
  ]);
  requireAbsent("brand-test-discovery", sources.brandScopeTest, [
    "describe.skip(",
    "describe.only(",
    "it.skip(",
    "it.only(",
    "test.skip(",
    "test.only(",
  ]);
  requireAll("issue-1821-durable-readback-test", sources.issue1821DenoTest, [
    "id,status,provider_message_id,sent_at,delivery_tracking_eligible_at,open_tracking_eligible_at,tracking_sender_domain",
    "#1821 every explicit provider-accepted status preserves durable tracking truth",
    'tracking_sender_domain: "campaigns.usemingla.com"',
  ]);
  requireAbsent("issue-1821-test-discovery", sources.issue1821DenoTest, [
    "Deno.test.ignore",
    "Deno.test.only",
    "ignore: true",
    "only: true",
  ]);
  requireAll("workflow", sources.workflow, [
    "issue-2714-campaign-open-truth.mjs --self-test",
    "issue-2714-campaign-open-truth.mjs",
    "issue_2714_campaign_open_truth.happy.pg17.test.sql",
    "issue_2714_campaign_open_truth.tester_adversarial.pg17.test.sql",
    "issue_2714_campaign_open_truth.tester_adversarial.test.ts",
    "src/services/marketing/__tests__/marketingOverviewService.test.ts",
    "app/(tabs)/marketing/__tests__/overview-no-revenue.test.ts",
    "src/services/marketing/__tests__/issue2514BrandScopedCampaigns.test.ts",
    "npx jest --runTestsByPath",
    "marketingOverviewService\\.ts",
    "marketingReportService\\.ts",
    "OverviewMetricCard\\.tsx",
    "marketing/index\\.tsx",
    "marketing/campaigns/\\[id\\]\\.tsx",
    "issue_2714_campaign_open_truth\\.happy\\.test\\.ts",
    "deno test --allow-env --allow-read",
    "supabase/functions/marketing-send/issue-1821-accepted-email-sms-invites.test.ts",
  ]);
  requireExactCount(
    "workflow-overview-no-revenue-once",
    sources.workflow,
    "app/(tabs)/marketing/__tests__/overview-no-revenue.test.ts",
    1,
  );
  requireExactCount(
    "workflow-brand-scope-once",
    sources.workflow,
    "src/services/marketing/__tests__/issue2514BrandScopedCampaigns.test.ts",
    1,
  );
  requireExactCount(
    "workflow-issue-1821-full-deno-suite",
    sources.workflow,
    "supabase/functions/marketing-send/issue-1821-accepted-email-sms-invites.test.ts",
    2,
  );
}

if (process.argv.includes("--self-test")) {
  const good = Object.fromEntries(Object.keys(files).map((key) => [key, ""]));
  good.migration =
    "delivery_tracking_eligible_at open_tracking_eligible_at tracking_sender_domain = 'campaigns.usemingla.com' mkt_reconcile_email_event issue_2714_reconcile_provider_events mkt_campaign_email_event_health campaign_unmatched_stale";
  good.send =
    '@campaigns.usemingla.com delivery_tracking_eligible_at: eligibleAt open_tracking_eligible_at: eligibleAt tracking_sender_domain: "campaigns.usemingla.com" id,status,provider_message_id,sent_at,delivery_tracking_eligible_at,open_tracking_eligible_at,tracking_sender_domain publicEmailAcceptedStatus(row.status) row.provider_message_id === providerMessageId row.sent_at !== null row.delivery_tracking_eligible_at !== null row.open_tracking_eligible_at !== null row.tracking_sender_domain === "campaigns.usemingla.com"';
  good.webhook =
    'data === "campaign_unmatched" data === "campaign_unmatched_stale" status: 500 correlationHash';
  good.overviewService =
    'trackedDelivered hasDeliveryCoverage hasOpenCoverage mkt_campaign_email_event_health .order("id" .range( hasDeliveryCoverage: health.delivery_healthy && deliveryEligible > 0 hasOpenCoverage: health.open_healthy && trackedDelivered > 0 .in("campaign_id", ids) .in("campaign_id", ids)';
  good.reportService =
    'trackedDelivered hasDeliveryCoverage hasOpenCoverage mkt_campaign_email_event_health .order("id" .range( hasDeliveryCoverage: health.delivery_healthy && deliveryEligible.length > 0 hasOpenCoverage: health.open_healthy && trackedDeliveredRows.length > 0';
  good.overview =
    'snap.funnel.opened / snap.funnel.trackedDelivered ? "degraded" : "notMeasured"';
  good.report =
    "recipientStats.opened / recipientStats.trackedDelivered What these numbers mean Opened is an estimate based on a tiny image in the email. Emails sent before open tracking was enabled show — because those opens were never measured.";
  good.privacy =
    "August 27, 2026 Marketing email measurement campaigns.usemingla.com Resend";
  good.invariant = `I-2714-CAMPAIGN-OPEN-TRUTH DRAFT ${migrationName}`;
  good.ciManifest = migrationPath;
  good.overviewNoRevenueTest =
    "hasDeliveryCoverage hasOpenCoverage trackedDelivered openHealthy";
  good.brandScopeTest =
    '.eq("brand_id", brandId) const windowCampaignIds = windowCampaigns.map((c) => c.id) .in("campaign_id", ids) loadWindowMessages loadClickedMessageIds';
  good.issue1821DenoTest =
    'id,status,provider_message_id,sent_at,delivery_tracking_eligible_at,open_tracking_eligible_at,tracking_sender_domain #1821 every explicit provider-accepted status preserves durable tracking truth tracking_sender_domain: "campaigns.usemingla.com"';
  good.workflow =
    `${migrationPath} issue-2714-campaign-open-truth.mjs --self-test issue-2714-campaign-open-truth.mjs issue_2714_campaign_open_truth.happy.pg17.test.sql issue_2714_campaign_open_truth.tester_adversarial.pg17.test.sql issue_2714_campaign_open_truth.tester_adversarial.test.ts src/services/marketing/__tests__/marketingOverviewService.test.ts app/(tabs)/marketing/__tests__/overview-no-revenue.test.ts src/services/marketing/__tests__/issue2514BrandScopedCampaigns.test.ts npx jest --runTestsByPath marketingOverviewService\\.ts marketingReportService\\.ts OverviewMetricCard\\.tsx marketing/index\\.tsx marketing/campaigns/\\[id\\]\\.tsx issue_2714_campaign_open_truth\\.happy\\.test\\.ts deno test --allow-env --allow-read supabase/functions/marketing-send/issue-1821-accepted-email-sms-invites.test.ts supabase/functions/marketing-send/issue-1821-accepted-email-sms-invites.test.ts`;
  const goodEntries = [
    "20270605002728_issue_2728_ticket_sold_count_namespace.sql",
    migrationName,
    "20270606002725_issue_2725_competitor_intelligence.sql",
    "20270606002726_issue_2725_amendment_8_budget.sql",
  ];
  check(good, goodEntries, expectedMigrationSha);
  const before = failures;
  const original = console.error;
  console.error = () => {};
  requireAll(
    "self-test-revert",
    good.send.replace("@campaigns.usemingla.com", "@usemingla.com"),
    ["@campaigns.usemingla.com"],
  );
  console.error = original;
  if (failures !== before + 1) {
    fail("self-test", "functional sender revert was not rejected");
  }
  failures = before;
  const proveMutation = (name, mutate) => {
    const fixture = {
      sources: structuredClone(good),
      entries: [...goodEntries],
      sha: expectedMigrationSha,
      targetName: migrationName,
    };
    const serializedBefore = JSON.stringify(fixture);
    mutate(fixture);
    if (JSON.stringify(fixture) === serializedBefore) {
      fail(name, "mutation did not alter its fixture");
      return;
    }
    const mutationBefore = failures;
    checkMigrationContract(
      fixture.sources,
      fixture.entries,
      fixture.sha,
      fixture.targetName,
    );
    if (failures === mutationBefore) fail(name, "mutation was not rejected");
    else pass(name);
    failures = mutationBefore;
  };
  console.error = () => {};
  proveMutation("self-test-superseded-prefix", (fixture) => {
    fixture.entries = [
      "20270605002728_issue_2728_ticket_sold_count_namespace.sql",
      supersededMigrationName,
    ];
    fixture.targetName = supersededMigrationName;
  });
  proveMutation("self-test-prefix-collision", (fixture) => {
    fixture.entries.push(`${migrationPrefix}_collision.sql`);
  });
  proveMutation("self-test-missing-target", (fixture) => {
    fixture.entries = fixture.entries.filter((entry) => entry !== migrationName);
  });
  proveMutation("self-test-forbidden-between-prefix", (fixture) => {
    fixture.entries.push("20270605595959_forbidden_backfill.sql");
  });
  proveMutation("self-test-missing-sealed-predecessor", (fixture) => {
    fixture.entries = fixture.entries.filter((entry) =>
      !entry.startsWith(`${expectedPredecessorPrefix}_`)
    );
  });
  for (const sourceKey of ["workflow", "ciManifest", "invariant"]) {
    proveMutation(`self-test-stale-${sourceKey}-reference`, (fixture) => {
      fixture.sources[sourceKey] = fixture.sources[sourceKey].replace(
        migrationName,
        supersededMigrationName,
      );
    });
  }
  proveMutation("self-test-migration-sha", (fixture) => {
    fixture.sha = "0".repeat(64);
  });
  console.error = original;
  if (failures === 0) pass("self-test");
} else {
  const sources = {};
  for (const [key, relative] of Object.entries(files)) {
    try {
      sources[key] = fs.readFileSync(path.join(root, relative), "utf8");
    } catch (error) {
      fail("read", `${relative}: ${error.message}`);
      sources[key] = "";
    }
  }
  const migrationDir = path.join(root, "supabase/migrations");
  let migrationEntries = [];
  try {
    migrationEntries = fs.readdirSync(migrationDir);
  } catch (error) {
    fail("migration-list", error.message);
  }
  const migrationSha = sources.migration
    ? crypto.createHash("sha256").update(sources.migration).digest("hex")
    : "missing";
  check(sources, migrationEntries, migrationSha);
}

process.exitCode = failures === 0 ? 0 : 1;
