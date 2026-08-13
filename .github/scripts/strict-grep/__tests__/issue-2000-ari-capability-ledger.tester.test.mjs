import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const LEDGER_PATH = path.join(ROOT, "docs/contracts/ari-capability-ledger.json");

const EXPECTED_TOOL_NAMES = [
  "cancel_campaign", "cancel_event", "cancel_order", "cancel_trip_booking",
  "create_brand", "create_event", "create_experience", "create_rsvp",
  "create_stay_reservation", "create_support_ticket", "create_trip",
  "create_venue_listing", "create_venue_reservation", "delete_brand",
  "delete_experience", "delete_trip", "disconnect_partner", "draft_campaign",
  "duplicate_event", "end_event_sales", "export_brand_people",
  "get_brand_analytics", "get_operator_snapshot", "get_partner_status",
  "get_payout_status", "get_tax_status", "invite_brand_member", "invite_scanner",
  "list_brands", "list_events", "list_guest_roster", "mark_claim_feedback_fixed",
  "patch_event_when", "publish_event", "publish_experience", "publish_rsvp",
  "publish_trip", "quote_stay", "refund_order", "refund_rsvp_contribution",
  "request_account_deletion", "retry_installment", "revoke_brand_member",
  "run_growth_tool", "schedule_campaign", "send_campaign_now", "send_venue_sms",
  "set_event_cover", "set_event_guest_privacy", "set_guest_approval",
  "set_pricing_switches", "set_rsvp_guest_status", "submit_venue_claim",
  "transition_stay", "transition_venue_reservation", "unpublish_event",
  "update_ari_prefs", "update_brand", "update_event", "update_experience",
  "update_notification_prefs", "update_trip", "upsert_ticket_tier",
  "venue_ops_action",
];

const EXPECTED = Object.freeze({
  capabilityCount: 114,
  statusBreakdown: Object.freeze({
    verified: 0,
    registered_unverified: 16,
    broken: 47,
    guided_handoff: 7,
    unsupported: 40,
    in_flight: 4,
  }),
  idDigest: "c6b5cb85772e402219e0e3403c06dc88cddfc0ed2050e7f2ea07d639513ddf82",
  statusDigest: "99fa0a6ead73c36c88ef9c120d2b0c984e38b99afd4891d97c9330ea5a3d1fba",
  mappingDigest: "4f9babfa94a8a97bdfd6f2043d5f6ebdf6a1ba4057d5321468341c3bcef6fe6f",
  sourceRefDigest: "9a82c3b4dc20842b6f6790a3f4384a8e65f3d0b87e515aeae6d814fd32c95de7",
});

function readLedger() {
  return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
}

function digest(lines) {
  return crypto.createHash("sha256").update([...lines].sort().join("\n")).digest("hex");
}

function independentlyValidateSnapshot(ledger) {
  const failures = [];
  const capabilities = ledger.capabilities ?? [];
  const ids = capabilities.map((capability) => capability.id);
  const mapped = capabilities.filter((capability) => capability.ari_tool !== null);
  const toolNames = mapped.map((capability) => capability.ari_tool).sort();
  const statusBreakdown = Object.fromEntries(
    Object.keys(EXPECTED.statusBreakdown).map((status) => [
      status,
      capabilities.filter((capability) => capability.status === status).length,
    ]),
  );

  if (capabilities.length !== EXPECTED.capabilityCount) failures.push("capability denominator changed");
  if (new Set(ids).size !== ids.length) failures.push("capability ids are not unique");
  if (JSON.stringify(toolNames) !== JSON.stringify(EXPECTED_TOOL_NAMES)) failures.push("64-tool set changed");
  if (JSON.stringify(statusBreakdown) !== JSON.stringify(EXPECTED.statusBreakdown)) failures.push("47/16/40/7/4/0 classification changed");
  if (digest(ids) !== EXPECTED.idDigest) failures.push("capability-id denominator changed");
  if (digest(capabilities.map((capability) => `${capability.id}\t${capability.status}`)) !== EXPECTED.statusDigest) failures.push("status assignment changed");
  if (digest(mapped.map((capability) => `${capability.ari_tool}\t${capability.id}`)) !== EXPECTED.mappingDigest) failures.push("tool-to-capability mapping changed");
  const refs = capabilities.flatMap((capability) =>
    (capability.owners?.source ?? []).map((ref) => `${capability.id}\t${ref.path}\t${ref.symbol}`),
  );
  if (digest(refs) !== EXPECTED.sourceRefDigest) failures.push("source path/symbol evidence changed");
  return failures;
}

test("tester independently pins the reviewed denominator, all mappings, statuses, and source evidence", () => {
  assert.deepEqual(independentlyValidateSnapshot(readLedger()), []);
});

test("tester rejects denominator deletion even when audit counters are laundered", () => {
  const ledger = readLedger();
  const removed = ledger.capabilities.pop();
  ledger.audit.capability_count--;
  ledger.audit.status_breakdown[removed.status]--;
  assert.match(independentlyValidateSnapshot(ledger).join("; "), /denominator changed/);
});

test("tester rejects a bijective but semantically swapped tool mapping", () => {
  const ledger = readLedger();
  const first = ledger.capabilities.find((capability) => capability.id === "ari.brand.create");
  const second = ledger.capabilities.find((capability) => capability.id === "ari.brand.delete");
  [first.ari_tool, second.ari_tool] = [second.ari_tool, first.ari_tool];
  assert.match(independentlyValidateSnapshot(ledger).join("; "), /tool-to-capability mapping changed/);
});

test("tester rejects broken-to-unverified status laundering with reconciled counters", () => {
  const ledger = readLedger();
  const row = ledger.capabilities.find((capability) => capability.id === "ari.event.publish");
  row.status = "registered_unverified";
  ledger.audit.status_breakdown.broken--;
  ledger.audit.status_breakdown.registered_unverified++;
  assert.match(independentlyValidateSnapshot(ledger).join("; "), /classification changed|status assignment changed/);
});

test("tester rejects an extant-but-wrong source token that a substring check would accept", () => {
  const ledger = readLedger();
  const row = ledger.capabilities.find((capability) => capability.id === "ari.brand.create");
  row.owners.source[0].symbol = "brand";
  assert.match(independentlyValidateSnapshot(ledger).join("; "), /source path\/symbol evidence changed/);
});
