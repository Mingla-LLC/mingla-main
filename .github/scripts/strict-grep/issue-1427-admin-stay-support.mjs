#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const files = {
  migration: "supabase/migrations/20270204001448_issue_1427_admin_stay_support.sql",
  edge: "supabase/functions/admin-stay-operations/index.ts",
  reservationEdge: "supabase/functions/stay-reservations/index.ts",
  inventoryEdge: "supabase/functions/manage-stay-inventory/index.ts",
  venueList: "mingla-admin/src/pages/VenuesConsolePage.jsx",
  venueDetail: "mingla-admin/src/pages/VenueDetailView.jsx",
  moneyLedger: "mingla-admin/src/pages/BusinessMoneyLedgerPage.jsx",
  stayVenue: "mingla-admin/src/components/stay/StayVenueSections.jsx",
  stayOps: "mingla-admin/src/components/stay/StayOperationsPanel.jsx",
  service: "mingla-admin/src/services/stayAdminService.js",
  edgeTest: "supabase/functions/admin-stay-operations/index.test.ts",
  reservationAlertTest: "supabase/functions/stay-reservations/issue1427.alert.test.ts",
  inventoryAlertTest: "supabase/functions/manage-stay-inventory/issue1427.alert.test.ts",
  adminTest: "mingla-admin/src/__tests__/issue1427_admin_stay_support.test.js",
};

const required = {
  migration: [
    "CREATE TABLE public.stay_operations_alerts",
    "CREATE TABLE public.stay_operations_alert_resolutions",
    "FORCE ROW LEVEL SECURITY",
    "stay_operations_alerts_append_only",
    "stay_operations_alert_resolutions_append_only",
    "public.issue_1427_admin_stay_venue_projection",
    "public.issue_1427_admin_list_stay_operations",
    "public.issue_1427_admin_stay_group_projection",
    "public.issue_1427_admin_retry_stay_notification",
    "public.issue_1427_admin_pause_stay_offering",
    "public.issue_1427_admin_retry_stay_materialization",
    "public.admin_write_audit",
    "FROM public, anon",
    "TO authenticated, service_role",
  ],
  edge: [
    "createAdminStayOperationsHandler",
    'exactKeys(body, ["mode", "paymentAttemptId", "reason"])',
    "stripe.paymentIntents.retrieve",
    "paystackVerifyTransaction",
    'metadata.mingla_purpose !== "stay_reservation"',
    "hasProviderSubaccount",
    '"issue_1389_finalize_payment"',
    '"admin_write_audit"',
    "safeRpcCode",
  ],
  reservationEdge: [
    "captureInventoryChangedAlert",
    '"issue_1427_record_stay_operation_alert"',
    'p_alert_kind: "inventory_changed"',
  ],
  inventoryEdge: [
    "captureMaterializationAlert",
    "UUID.test(callerRequestId)",
    '"issue_1427_record_stay_operation_alert"',
    'p_alert_kind: "materialization_failed"',
  ],
  venueList: ['value: "stay", label: "Stay"'],
  venueDetail: [
    'venue.venue_category === "stay"',
    "getAdminStayVenue",
    "buildStayVenueSections",
  ],
  moneyLedger: [
    '{ id: "stay", label: "Stay reconciliation" }',
    '<StayOperationsPanel key="stay" />',
  ],
  stayVenue: [
    "Stay property and readiness",
    "Rooms & Places",
    "Provisional currency",
    "Photos",
    "Bulk creation failures",
    "Pause this offering",
  ],
  stayOps: [
    "Guest (masked for support)",
    "Hold and commitments",
    "Money and payouts",
    "Immutable timeline",
    "Reconcile payment from provider",
    "Retry failed notifications",
    "actOnSourceRefund",
  ],
  service: [
    "issue_1427_admin_stay_venue_projection",
    "issue_1427_admin_list_stay_operations",
    "issue_1427_admin_stay_group_projection",
    "issue_1427_admin_retry_stay_materialization",
    'invokeWithRefresh("admin-stay-operations"',
  ],
  edgeTest: [
    "rejects a missing active Admin session",
    "accepts only the bounded request shape",
    "trusts retrieved provider evidence and audits once",
    "Provider metadata mismatch cannot converge",
    "rejects a subaccount-settled Stay charge",
    "payment convergence failures never expose database detail",
  ],
  reservationAlertTest: ["inventory conflicts retain a safe operations alert"],
  inventoryAlertTest: ["materialization failures retain only replay-safe evidence"],
  adminTest: ["Stay support lives inside the existing Venues and Money shells"],
};

const adminFunctions = [
  "issue_1427_admin_stay_venue_projection",
  "issue_1427_admin_list_stay_operations",
  "issue_1427_admin_stay_group_projection",
  "issue_1427_admin_retry_stay_notification",
  "issue_1427_admin_pause_stay_offering",
  "issue_1427_admin_retry_stay_materialization",
];

function functionBody(source, name) {
  const start = source.search(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\b`, "i"));
  if (start < 0) return null;
  const tail = source.slice(start);
  const marker = /AS\s+(\$[A-Za-z0-9_]*\$)/i.exec(tail);
  if (!marker) return null;
  const bodyStart = marker.index + marker[0].length;
  const bodyEnd = tail.indexOf(marker[1], bodyStart);
  return bodyEnd < 0 ? null : tail.slice(bodyStart, bodyEnd);
}

function check(source) {
  const failures = [];
  for (const [key, needles] of Object.entries(required)) {
    for (const needle of needles) {
      if (!source[key]?.includes(needle)) failures.push(`${files[key]} missing ${JSON.stringify(needle)}`);
    }
  }

  for (const name of adminFunctions) {
    const body = functionBody(source.migration ?? "", name);
    if (!body) {
      failures.push(`missing Admin function body ${name}`);
      continue;
    }
    const begin = body.search(/\bBEGIN\b/i);
    const first = begin < 0 ? "" : body.slice(begin + 5).split(";")[0];
    if (!/IF\s+NOT\s+public\.is_admin_user\(\)\s+THEN/i.test(first)) {
      failures.push(`${name} does not guard active Admin as its first statement`);
    }
  }

  for (const name of [
    "issue_1427_admin_retry_stay_notification",
    "issue_1427_admin_pause_stay_offering",
    "issue_1427_admin_retry_stay_materialization",
  ]) {
    if (!/admin_write_audit\s*\(/i.test(functionBody(source.migration ?? "", name) ?? "")) {
      failures.push(`${name} does not write the Admin audit log`);
    }
  }

  const client = [source.venueList, source.venueDetail, source.moneyLedger, source.stayVenue, source.stayOps, source.service].join("\n");
  if (/\.from\(\s*["']stay_/u.test(client)) failures.push("Admin Stay UI bypasses the managed RPC boundary");
  if (/body\.(?:amount|amountMinor|currency|outcome|providerState|paymentRef)/u.test(source.edge ?? "")) {
    failures.push("Admin payment reconciliation trusts browser-owned financial truth");
  }
  if (/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.feature_flags/iu.test(source.migration ?? "")) {
    failures.push("Issue #1427 changes Stay launch flags");
  }
  const groupProjection = (source.migration ?? "").slice(
    (source.migration ?? "").indexOf("issue_1427_admin_stay_group_projection"),
    (source.migration ?? "").indexOf("issue_1427_admin_retry_stay_notification"),
  );
  for (const forbidden of ["'contact', outbox.contact", "'payload', outbox.payload", "storage_object_id", "checksum_sha256"]) {
    if (groupProjection.includes(forbidden)) failures.push(`Admin group projection exposes ${forbidden}`);
  }
  return failures;
}

function load() {
  return Object.fromEntries(Object.entries(files).map(([key, relative]) => [key, fs.readFileSync(path.join(root, relative), "utf8")]));
}

if (process.argv.includes("--self-test")) {
  const good = Object.fromEntries(Object.entries(required).map(([key, needles]) => [key, needles.join("\n")]));
  const guarded = adminFunctions.map((name) =>
    `CREATE OR REPLACE FUNCTION public.${name}() RETURNS jsonb LANGUAGE plpgsql AS $function$ BEGIN IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF; ${name.includes("retry") || name.includes("pause") ? "PERFORM public.admin_write_audit('x');" : ""} RETURN '{}'::jsonb; END; $function$;`,
  ).join("\n");
  good.migration += `\n${guarded}`;
  let failures = check(good);
  if (failures.length > 0) {
    console.error(`issue-1427 self-test fixture invalid:\n${failures.join("\n")}`);
    process.exit(2);
  }
  let reversions = 0;
  for (const [key, needles] of Object.entries(required)) {
    const bad = { ...good, [key]: good[key].replace(needles[0], "") };
    if (check(bad).length === 0) {
      console.error(`issue-1427 self-test missed ${key} reversion`);
      process.exit(1);
    }
    reversions += 1;
  }
  const browserMoney = { ...good, edge: `${good.edge}\nbody.amountMinor` };
  if (check(browserMoney).length === 0) process.exit(1);
  reversions += 1;
  const flagFlip = { ...good, migration: `${good.migration}\nUPDATE public.feature_flags SET is_enabled = true` };
  if (check(flagFlip).length === 0) process.exit(1);
  reversions += 1;
  console.log(`issue-1427 self-test PASS (${reversions} reversions)`);
  process.exit(0);
}

try {
  const failures = check(load());
  if (failures.length > 0) {
    console.error(["I-1427-ADMIN-STAY-SUPPORT violation:", ...failures.map((failure) => `- ${failure}`)].join("\n"));
    process.exit(1);
  }
  console.log("I-1427-ADMIN-STAY-SUPPORT PASS");
} catch (error) {
  console.error(`I-1427-ADMIN-STAY-SUPPORT inconclusive: ${error.message}`);
  process.exit(2);
}
