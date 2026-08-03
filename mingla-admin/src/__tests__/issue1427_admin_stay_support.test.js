import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const venueList = read("src/pages/VenuesConsolePage.jsx");
const venueDetail = read("src/pages/VenueDetailView.jsx");
const moneyLedger = read("src/pages/BusinessMoneyLedgerPage.jsx");
const stayVenue = read("src/components/stay/StayVenueSections.jsx");
const stayOps = read("src/components/stay/StayOperationsPanel.jsx");
const service = read("src/services/stayAdminService.js");
const migration = read("../supabase/migrations/20270204001448_issue_1427_admin_stay_support.sql");
const edge = read("../supabase/functions/admin-stay-operations/index.ts");

test("Stay support lives inside the existing Venues and Money shells", () => {
  assert.match(venueList, /value:\s*"stay",\s*label:\s*"Stay"/);
  assert.match(venueDetail, /venue\.venue_category === "stay"/);
  assert.match(venueDetail, /getAdminStayVenue/);
  assert.match(venueDetail, /buildStayVenueSections/);
  assert.match(moneyLedger, /id:\s*"stay",\s*label:\s*"Stay reconciliation"/);
  assert.match(moneyLedger, /<StayOperationsPanel\s+key="stay"\s*\/>/);
  assert.doesNotMatch(moneyLedger, /href=["']#\/admin-stay/);
});

test("Stay venue support renders Rooms, Places, photos, commercial truth, and readiness", () => {
  for (const token of [
    "Stay property and readiness",
    "Rooms & Places",
    "Bank rail",
    "Brand currency",
    "Provisional currency",
    "Currency reconciliation",
    "Confirmation",
    "Price",
    "Fees",
    "Policy",
    "Availability",
    "Photos",
    "Bulk creation failures",
    "Pause this offering",
  ]) assert.ok(stayVenue.includes(token), `missing ${token}`);
});

test("Admin Stay operations expose the required support evidence and safe actions", () => {
  for (const token of [
    "Guest (masked for support)",
    "Rooms & Places",
    "Hold and commitments",
    "Payments",
    "Refunds",
    "Money and payouts",
    "Notifications",
    "Immutable timeline",
    "Reconcile payment from provider",
    "Retry failed notifications",
    "Reconcile refund from provider",
    "Retry from retained schedule evidence",
  ]) assert.ok(stayOps.includes(token), `missing ${token}`);
  assert.match(stayOps, /actOnSourceRefund/);
  assert.match(service, /issue_1427_admin_list_stay_operations/);
  assert.match(service, /issue_1427_admin_stay_group_projection/);
  assert.match(service, /issue_1427_admin_retry_stay_materialization/);
  assert.match(service, /admin-stay-operations/);
});

test("database projections mask guest PII and omit raw payload/storage evidence", () => {
  assert.match(migration, /'name', CASE[\s\S]*'•••'/);
  assert.match(migration, /'email', CASE[\s\S]*'•••@'/);
  assert.match(migration, /'phone', CASE[\s\S]*'••••'/);
  assert.match(migration, /'publicUrl'/);
  const projection = migration.slice(
    migration.indexOf("issue_1427_admin_stay_group_projection"),
    migration.indexOf("issue_1427_admin_retry_stay_notification"),
  );
  for (const forbidden of [
    "guest_snapshot',",
    "'contact', outbox.contact",
    "'payload', outbox.payload",
    "'safeMetadata', event_row.safe_metadata",
    "storage_object_id",
    "checksum_sha256",
  ]) assert.ok(!projection.includes(forbidden), `projection leaks ${forbidden}`);
});

test("provider convergence rejects browser-owned financial truth and audits", () => {
  assert.match(edge, /exactKeys\(body, \["mode", "paymentAttemptId", "reason"\]\)/);
  assert.doesNotMatch(edge, /body\.(?:amount|amountMinor|currency|outcome|providerState|paymentRef)/);
  assert.match(edge, /stripe\.paymentIntents\.retrieve/);
  assert.match(edge, /paystackVerifyTransaction/);
  assert.match(edge, /metadata\.mingla_purpose !== "stay_reservation"/);
  assert.match(edge, /issue_1389_finalize_payment/);
  assert.match(edge, /admin_write_audit/);
});

test("operations alerts are append-only, forced-RLS, and service-only", () => {
  assert.match(migration, /ALTER TABLE public\.stay_operations_alerts FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /stay_operations_alerts_append_only/);
  assert.match(migration, /stay_operations_alert_resolutions_append_only/);
  assert.match(migration, /IF NOT public\.issue_1389_service_role\(\) THEN/);
  assert.match(migration, /REVOKE ALL ON public\.stay_operations_alerts[\s\S]*FROM public, anon, authenticated/);
  assert.match(migration, /GRANT SELECT, INSERT ON public\.stay_operations_alerts TO service_role/);
});
