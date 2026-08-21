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
  "delete_experience", "delete_trip", "discard_event_draft", "disconnect_partner",
  "draft_campaign",
  "duplicate_event", "end_event_sales", "export_brand_people",
  "get_brand_analytics", "get_operator_snapshot", "get_partner_status",
  "get_payout_status", "get_tax_status", "invite_brand_member", "invite_scanner",
  "list_brand_audit_log", "list_brands", "list_events", "list_guest_roster",
  "manage_brand_discovery_currency", "manage_brand_hours", "manage_experience_stops",
  "mark_claim_feedback_fixed",
  "get_payout_status", "get_tax_status", "get_trip_order_money", "invite_brand_member", "invite_scanner",
  "list_brands", "list_events", "list_guest_roster", "manage_experience_stops", "manage_trip_days",
  "manage_trip_inclusions", "manage_trip_tiers", "manage_trip_traveler_intake", "mark_claim_feedback_fixed",
  "patch_event_when", "publish_event", "publish_experience", "publish_rsvp",
  "publish_trip", "quote_stay", "refund_order", "refund_rsvp_contribution",
  "request_account_deletion", "retry_installment", "revoke_brand_member",
  "run_growth_tool", "schedule_campaign", "send_campaign_now", "send_venue_sms",
  "set_brand_pricing_defaults", "set_event_cover", "set_event_guest_privacy", "set_guest_approval",
  "set_pricing_switches", "set_rsvp_guest_status", "submit_venue_claim",
  "transition_stay", "transition_venue_reservation", "unpublish_event",
  "unpublish_experience",
  "update_ari_prefs", "update_brand", "update_event", "update_experience",
  "update_notification_prefs", "update_trip", "upsert_ticket_tier",
  "venue_ops_action",
];

const EXPECTED = Object.freeze({
  capabilityCount: 117,
  statusBreakdown: Object.freeze({
    verified: 0,
    registered_unverified: 33,
    broken: 36,
    guided_handoff: 8,
    unsupported: 36,
    in_flight: 4,
  }),
  idDigest: "9366acdea4ba816a7b69b6cdc970b9b75ec705eba0832683013397bd9ad6e05b",
  statusDigest: "b550638521af91408a961e08c162222c0dd5772777fa80e354e3e7388af12387",
  mappingDigest: "d7e46c75cd8b5948a210c6938b9ac9e2e69d1afa73a9c16083b3729c5a9e8e57",
    registered_unverified: 39,
    broken: 32,
    unsupported: 34,
  statusDigest: "ac3be32a2dd17f3d85f8d97f6505d6871902b87763f71528e5181bc95cb5d90a",
  mappingDigest: "0d3d6a6f8a870a47630251d888b0c70d19d11fd7f174617f6f2ac243f9e5e5be",
  sourceRefDigest: "761d3cf68c6f5e0ff8060e8d7f070a452c1f1de15856467a40e0b6e175298012",
    broken: 34,
    unsupported: 38,
  statusDigest: "3f4d11a2b40cc4e650bdd9de49c5b4cd5de03759ac7dd5afa612ae6cfacc84fb",
  mappingDigest: "1d0131b018408d9251310ce4812ca7f01f6b7e83b42ae3db4864afd8430d8ab9",
  sourceRefDigest: "d1b3aef21f619445232f46ecdaed7a333f0a56a765819dba174a685addf87170",
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
  if (JSON.stringify(toolNames) !== JSON.stringify(EXPECTED_TOOL_NAMES)) failures.push("70-tool set changed");
  if (JSON.stringify(statusBreakdown) !== JSON.stringify(EXPECTED.statusBreakdown)) failures.push("36/33/36/8/4/0 classification changed");
  if (JSON.stringify(toolNames) !== JSON.stringify(EXPECTED_TOOL_NAMES)) failures.push("68-tool set changed");
  if (JSON.stringify(statusBreakdown) !== JSON.stringify(EXPECTED.statusBreakdown)) failures.push("34/33/38/8/4/0 classification changed");
  if (JSON.stringify(toolNames) !== JSON.stringify(EXPECTED_TOOL_NAMES)) failures.push("72-tool set changed");
  if (JSON.stringify(statusBreakdown) !== JSON.stringify(EXPECTED.statusBreakdown)) failures.push("32/39/34/8/4/0 classification changed");
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
  const row = ledger.capabilities.find((capability) => capability.id === "ari.trip.create");
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
