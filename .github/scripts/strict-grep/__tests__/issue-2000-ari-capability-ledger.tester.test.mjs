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
  "get_payout_status", "get_tax_status", "get_trip_order_money", "invite_brand_member", "invite_scanner",
  "list_brands", "list_events", "list_guest_roster", "manage_trip_days",
  "manage_trip_inclusions", "manage_trip_tiers", "manage_trip_traveler_intake", "mark_claim_feedback_fixed",
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
  capabilityCount: 116,
  statusBreakdown: Object.freeze({
    verified: 0,
    registered_unverified: 25,
    broken: 43,
    guided_handoff: 7,
    unsupported: 37,
    in_flight: 4,
  }),
  idDigest: "a63afe467e81ac3fd2441d0ccbc92dcb8c8afea8fd8ee4327c3f6fdb1a8a95c0",
  statusDigest: "0593ee5b514d7b6cdb3ebc11bdf5b81d36a974cae414e5a20745bf18fd650b9a",
  mappingDigest: "7dee37c2743c9962604e3d815c2b8b9278afc975d34774ca56f86338bb932a1d",
  sourceRefDigest: "2e2c112c814af4b5bf9607e0d497d40bbba22e7234ff79317b95a8ef86f8dd6f",
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
  if (JSON.stringify(toolNames) !== JSON.stringify(EXPECTED_TOOL_NAMES)) failures.push("69-tool set changed");
  if (JSON.stringify(statusBreakdown) !== JSON.stringify(EXPECTED.statusBreakdown)) failures.push("43/25/37/7/4/0 classification changed");
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
