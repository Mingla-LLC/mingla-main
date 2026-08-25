import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const LEDGER_PATH = path.join(ROOT, "docs/contracts/ari-capability-ledger.json");

// [TEST-MOD-APPROVED #1975+#1978+#1979] Additive: keep Stay + venue listing
// tools (77) and register three venue manage tools + ops/SMS repairs (77→80).
// Capability denominator stays 120; broken 27→25; registered_unverified 49→54;
// unsupported 32→29.
//
// [TEST-MOD-APPROVED #1971] Trip lifecycle. Five tools are registered
// (manage_trip_days / _inclusions / _tiers / _traveler_intake and the
// finance-gated get_trip_order_money), so the pinned tool census moves 80→85.
// Nine trip rows change status: the four repaired lifecycle rows leave broken
// (25→21) and the five previously tool-less rows leave unsupported (29→24), all
// landing in registered_unverified (54→63). The capability denominator is
// UNCHANGED at 120 — no operation was added to or removed from the reviewed
// universe. Exactly four assertions are invalidated and re-pinned:
// EXPECTED_TOOL_NAMES, EXPECTED.statusBreakdown (with its "N-tool"/classification
// messages), EXPECTED.statusDigest, EXPECTED.mappingDigest and
// EXPECTED.sourceRefDigest — the last because the nine rows now name their real
// canonical owners. EXPECTED.idDigest is deliberately unchanged, which is the
// independent proof that the denominator itself did not move. Every hostile
// mutant below still fires; the broken-laundering mutant is simply re-aimed at a
// row that is still broken.
//
// [TEST-MOD-APPROVED #424 ledger-truth] Fifteen Wave-3/#2593 repaired rows leave
// broken (16→1) into registered_unverified (69→84). ari.venue.organic_insights
// leaves unsupported for in_flight under #1796 (23→22 unsupported, 4→5 in_flight).
// Capability denominator and tool set are UNCHANGED at 120 / 86. Re-pin
// statusBreakdown, statusDigest, and the classification message; re-aim the
// broken-laundering mutant at ari.operator.snapshot.
//
// [TEST-MOD-APPROVED #424/#1983] ari.operator.snapshot leaves broken (1→0) into
// registered_unverified (84→85) after getOperatorSnapshot admits all accessible
// brands. Tool set and denominator UNCHANGED (86 / 120). Re-pin statusBreakdown,
// statusDigest, and classification message; re-aim the status-laundering mutant
// at unverified→broken (no broken rows remain to flip the other way).
//
// [TEST-MOD-APPROVED #1984] Register get_event_order_reconciliation (86→87).
// ari.analytics.orders_reconciliation leaves unsupported (22→21) into
// registered_unverified (85→86). Denominator stays 120. Re-pin tool names,
// statusBreakdown, statusDigest, mappingDigest, sourceRefDigest, and
// classification message.
//

// [TEST-MOD-APPROVED #1982] list_brand_team + revoke_scanner_invitation + manage_brand_people (92→95).
// [TEST-MOD-APPROVED #1981] Register charge_installment_now +
// send_installment_reminder (90→92). Two unsupported rows leave into
// registered_unverified (89→91, unsupported 18→16). Denominator stays 120.
// [TEST-MOD-APPROVED #1976] Three partner/payments reads (87→90):
// get_brand_balances_reports, list_partner_brand_links, list_partner_splits.
// unsupported 21→18; registered_unverified 86→89. Denominator stays 120.
const EXPECTED_TOOL_NAMES = [
  "cancel_campaign",
  "cancel_event",
  "cancel_order",
  "cancel_trip_booking",
  "charge_installment_now",
  "create_brand",
  "create_event",
  "create_experience",
  "create_rsvp",
  "create_stay_reservation",
  "create_support_ticket",
  "create_trip",
  "create_venue_listing",
  "create_venue_reservation",
  "delete_brand",
  "delete_experience",
  "delete_trip",
  "discard_event_draft",
  "disconnect_partner",
  "draft_campaign",
  "duplicate_event",
  "end_event_sales",
  "export_brand_people",
  "get_brand_analytics",
  "get_brand_balances_reports",
  "get_event_order_reconciliation",
  "get_operator_snapshot",
  "get_partner_status",
  "get_payout_status",
  "get_tax_status",
  "get_trip_order_money",
  "get_venue_listing_status",
  "invite_brand_member",
  "invite_scanner",
  "list_brand_audit_log",
  "list_brand_team",
  "list_brands",
  "list_events",
  "list_guest_roster",
  "list_partner_brand_links",
  "list_partner_splits",
  "list_venue_claim_feedback",
  "list_venue_listings",
  "manage_brand_discovery_currency",
  "manage_brand_hours",
  "manage_brand_people",
  "manage_experience_stops",
  "manage_stay_inventory",
  "manage_stay_policy_price_media",
  "manage_trip_days",
  "manage_trip_inclusions",
  "manage_trip_tiers",
  "manage_trip_traveler_intake",
  "manage_venue_availability",
  "manage_venue_menu",
  "manage_venue_waitlist",
  "mark_claim_feedback_fixed",
  "patch_event_when",
  "publish_event",
  "publish_experience",
  "publish_rsvp",
  "publish_stay",
  "publish_trip",
  "quote_stay",
  "refund_order",
  "refund_rsvp_contribution",
  "request_account_deletion",
  "retry_installment",
  "revoke_brand_member",
  "revoke_scanner_invitation",
  "run_growth_tool",
  "schedule_campaign",
  "send_campaign_now",
  "send_installment_reminder",
  "send_venue_sms",
  "set_brand_pricing_defaults",
  "set_event_cover",
  "set_event_guest_privacy",
  "set_pricing_switches",
  "set_rsvp_guest_status",
  "submit_venue_claim",
  "transition_stay",
  "transition_venue_reservation",
  "unpublish_event",
  "unpublish_experience",
  "update_ari_prefs",
  "update_brand",
  "update_event",
  "update_experience",
  "update_notification_prefs",
  "update_rsvp",
  "update_rsvp_contribution_settings",
  "update_trip",
  "upsert_ticket_tier",
  "venue_ops_action",
];

const EXPECTED = Object.freeze({
  capabilityCount: 120,
  statusBreakdown: Object.freeze({
    verified: 0,
    registered_unverified: 94,
    broken: 0,
    guided_handoff: 8,
    unsupported: 13,
    in_flight: 5,
  }),
  idDigest: "1fb5ded9fad7468ea6e74f573ad428d49b9e279d0078d5332088a82e6ce94580",
  statusDigest: "0162f1fbf587fc037d40bd8f62c71d82f3924bfda5ce6485f92aa07a8dd51f1f",
  mappingDigest: "0166940e425edeebac44eeac01f73c87b5c1417fb2d6dbbb405a3b1debcf1eff",
  sourceRefDigest: "59f32ff0f569f509cb91cf497c1fb14565ebee3acb307373f8294e4eb78194b6",
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
  if (JSON.stringify(toolNames) !== JSON.stringify(EXPECTED_TOOL_NAMES)) failures.push("95-tool set changed");
  if (JSON.stringify(statusBreakdown) !== JSON.stringify(EXPECTED.statusBreakdown)) {
    failures.push("94/0/13/8/5/0 classification changed");
  }
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

test("tester rejects status laundering with reconciled counters", () => {
  const ledger = readLedger();
  // [TEST-MOD-APPROVED #1978] pin a still-broken row after ticket pricing and
  // venue listing repairs moved prior targets out of broken.
  // [TEST-MOD-APPROVED #1971] Re-aimed from ari.trip.create (repaired here) to
  // ari.rsvp.create, which is still proven broken. The mutant is unchanged in
  // shape and still fires — only its target row moved.
  // [TEST-MOD-APPROVED #424 ledger-truth] Re-aimed from ari.rsvp.create to
  // ari.operator.snapshot after Wave-3 rows left broken.
  // [TEST-MOD-APPROVED #424/#1983] No broken rows remain; re-aim to
  // unverified→broken so statusDigest/classification still move.
  const row = ledger.capabilities.find((capability) => capability.id === "ari.operator.snapshot");
  row.status = "broken";
  ledger.audit.status_breakdown.registered_unverified--;
  ledger.audit.status_breakdown.broken++;
  assert.match(independentlyValidateSnapshot(ledger).join("; "), /classification changed|status assignment changed/);
});

test("tester rejects an extant-but-wrong source token that a substring check would accept", () => {
  const ledger = readLedger();
  const row = ledger.capabilities.find((capability) => capability.id === "ari.brand.create");
  row.owners.source[0].symbol = "brand";
  assert.match(independentlyValidateSnapshot(ledger).join("; "), /source path\/symbol evidence changed/);
});
