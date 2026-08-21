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
    registered_unverified: 36,
    broken: 34,
    guided_handoff: 8,
    unsupported: 35,
    in_flight: 4,
  }),
  idDigest: "9366acdea4ba816a7b69b6cdc970b9b75ec705eba0832683013397bd9ad6e05b",
  statusDigest: "782a184917797c197e3a338d06bea87be31e1d3f65c4ee016b898c0f7675177f",
  mappingDigest: "e32941eda6386d12c2647f63919d3afe72bf92fe1698f0551970309635984210",
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
  if (JSON.stringify(toolNames) !== JSON.stringify(EXPECTED_TOOL_NAMES)) failures.push("71-tool set changed");
  if (JSON.stringify(statusBreakdown) !== JSON.stringify(EXPECTED.statusBreakdown)) failures.push("34/36/35/8/4/0 classification changed");
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
