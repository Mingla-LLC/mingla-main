#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const files = {
  migration: "supabase/migrations/20270605002714_issue_2714_campaign_open_tracking_truth.sql",
  send: "supabase/functions/marketing-send/index.ts",
  webhook: "supabase/functions/resend-webhook/index.ts",
  overviewService: "mingla-business/src/services/marketing/marketingOverviewService.ts",
  reportService: "mingla-business/src/services/marketing/marketingReportService.ts",
  overview: "mingla-business/app/(tabs)/marketing/index.tsx",
  report: "mingla-business/app/(tabs)/marketing/campaigns/[id].tsx",
  privacy: "mingla-marketing/lib/privacyContent.ts",
  invariant: "docs/INVARIANT_REGISTRY.md",
  workflow: ".github/workflows/issue-1995-contact-book-blast.yml",
};

let failures = 0;
const fail = (name, message) => { failures += 1; console.error(`FAIL [${name}] ${message}`); };
const pass = (name) => console.log(`OK   [${name}]`);
const requireAll = (name, source, needles) => {
  const missing = needles.filter((needle) => !source.includes(needle));
  if (missing.length) fail(name, `missing: ${missing.join(", ")}`); else pass(name);
};
const requireAbsent = (name, source, needles) => {
  const found = needles.filter((needle) => source.includes(needle));
  if (found.length) fail(name, `forbidden: ${found.join(", ")}`); else pass(name);
};

function check(sources) {
  const compact = Object.fromEntries(
    Object.entries(sources).map(([key, source]) => [key, source.replace(/\s+/g, " ")]),
  );
  requireAll("schema-and-reconcile", sources.migration, [
    "delivery_tracking_eligible_at", "open_tracking_eligible_at",
    "tracking_sender_domain = 'campaigns.usemingla.com'",
    "mkt_reconcile_email_event", "issue_2714_reconcile_provider_events",
    "mkt_campaign_email_event_health", "campaign_unmatched_stale",
  ]);
  requireAll("campaign-sender", sources.send, [
    "@campaigns.usemingla.com", "delivery_tracking_eligible_at: eligibleAt",
    "open_tracking_eligible_at: eligibleAt", 'tracking_sender_domain: "campaigns.usemingla.com"',
  ]);
  requireAbsent("campaign-sender-no-apex", sources.send, ["`${fromDisplay} <${fromLocal}@usemingla.com>`"]);
  requireAll("webhook-retry", sources.webhook, [
    'data === "campaign_unmatched"', 'data === "campaign_unmatched_stale"',
    "status: 500", "correlationHash",
  ]);
  for (const key of ["overviewService", "reportService"]) {
    requireAll(`${key}-truth`, sources[key], [
      "trackedDelivered", "hasDeliveryCoverage", "hasOpenCoverage",
      "mkt_campaign_email_event_health", ".order(\"id\"", ".range(",
    ]);
    requireAbsent(`${key}-legacy`, sources[key], ["hasEventCoverage"]);
  }
  requireAll("overview-ui", compact.overview, [
    "snap.funnel.opened / snap.funnel.trackedDelivered",
    '? "degraded"', ': "notMeasured"',
  ]);
  requireAll("report-ui", compact.report, [
    "recipientStats.opened / recipientStats.trackedDelivered",
    "What these numbers mean", "Opened is an estimate based on a tiny image in the email.",
    "Emails sent before open tracking was enabled show — because those opens were never measured.",
  ]);
  requireAll("privacy", sources.privacy, [
    "August 27, 2026", "Marketing email measurement",
    "campaigns.usemingla.com", "Resend",
  ]);
  requireAll("draft-invariant", sources.invariant, ["I-2714-CAMPAIGN-OPEN-TRUTH", "DRAFT"]);
  requireAll("workflow", sources.workflow, [
    "issue-2714-campaign-open-truth.mjs --self-test",
    "issue-2714-campaign-open-truth.mjs",
    "issue_2714_campaign_open_truth.happy.pg17.test.sql",
  ]);
}

if (process.argv.includes("--self-test")) {
  const good = Object.fromEntries(Object.keys(files).map((key) => [key, ""]));
  good.migration = "delivery_tracking_eligible_at open_tracking_eligible_at tracking_sender_domain = 'campaigns.usemingla.com' mkt_reconcile_email_event issue_2714_reconcile_provider_events mkt_campaign_email_event_health campaign_unmatched_stale";
  good.send = '@campaigns.usemingla.com delivery_tracking_eligible_at: eligibleAt open_tracking_eligible_at: eligibleAt tracking_sender_domain: "campaigns.usemingla.com"';
  good.webhook = 'data === "campaign_unmatched" data === "campaign_unmatched_stale" status: 500 correlationHash';
  good.overviewService = good.reportService = 'trackedDelivered hasDeliveryCoverage hasOpenCoverage mkt_campaign_email_event_health .order("id" .range(';
  good.overview = 'snap.funnel.opened / snap.funnel.trackedDelivered ? "degraded" : "notMeasured"';
  good.report = "recipientStats.opened / recipientStats.trackedDelivered What these numbers mean Opened is an estimate based on a tiny image in the email. Emails sent before open tracking was enabled show — because those opens were never measured.";
  good.privacy = "August 27, 2026 Marketing email measurement campaigns.usemingla.com Resend";
  good.invariant = "I-2714-CAMPAIGN-OPEN-TRUTH DRAFT";
  good.workflow = "issue-2714-campaign-open-truth.mjs --self-test issue-2714-campaign-open-truth.mjs issue_2714_campaign_open_truth.happy.pg17.test.sql";
  check(good);
  const before = failures;
  const original = console.error;
  console.error = () => {};
  requireAll("self-test-revert", good.send.replace("@campaigns.usemingla.com", "@usemingla.com"), ["@campaigns.usemingla.com"]);
  console.error = original;
  if (failures !== before + 1) fail("self-test", "functional sender revert was not rejected");
  failures = before;
  if (failures === 0) pass("self-test");
} else {
  const sources = {};
  for (const [key, relative] of Object.entries(files)) {
    try { sources[key] = fs.readFileSync(path.join(root, relative), "utf8"); }
    catch (error) { fail("read", `${relative}: ${error.message}`); sources[key] = ""; }
  }
  check(sources);
}

process.exitCode = failures === 0 ? 0 : 1;
