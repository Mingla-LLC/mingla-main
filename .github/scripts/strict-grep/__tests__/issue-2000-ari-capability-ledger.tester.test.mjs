// [TEST-MOD-APPROVED #1984] census pin / ledger snapshot authorized for listing_conversion + reservation_metrics.
// [TEST-MOD-APPROVED #1982] census pin / ledger snapshot authorized for revoke_brand_invitation.
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

// [TEST-MOD-APPROVED #1978] manage_venue_gallery (107→108). unsupported 1→0.
// [TEST-MOD-APPROVED #1983] edit_profile_avatar + manage_ari_history + notifications + support inbox (103→107).
// [TEST-MOD-APPROVED #1980] manage_marketing_audiences + templates + get_campaign_report (100→103).
// [TEST-MOD-APPROVED #1972] manage_event_group_chat + door_sale + list_event_orders + waitlist + scanners (95→100).
// [TEST-MOD-APPROVED #1982] list_brand_team + revoke_scanner_invitation + manage_brand_people (92→95).
// [TEST-MOD-APPROVED #1981] Register charge_installment_now +
// send_installment_reminder (90→92). Two unsupported rows leave into
// registered_unverified (89→91, unsupported 18→16). Denominator stays 120.
// [TEST-MOD-APPROVED #1981] get_order_refund_preview + list_trip_installments
// (123→125 tools / 135→137 capabilities).
// [TEST-MOD-APPROVED #1976] Three partner/payments reads (87→90):
// get_brand_balances_reports, list_partner_brand_links, list_partner_splits.
// unsupported 21→18; registered_unverified 86→89. Denominator stays 120.
// [TEST-MOD-APPROVED #2830] Twelve new Website outcome families are both real
// Business operations and registered Ari tools, so the reviewed denominator
// moves 120→132, mapped tools 108→120, and registered_unverified 107→119. The exact
// id/status/mapping/source digests below are independently re-derived from the
// expanded canonical ledger; all hostile mutations remain unchanged in shape.
// [TEST-MOD-APPROVED #1984] get_listing_conversion + get_reservation_metrics
// (126→128 tools / 138→140 capabilities). registered_unverified 125→127.
// [TEST-MOD-APPROVED #3697] Host Ads tools (128→133 / 140→145). registered_unverified 127→132.
// [TEST-MOD-APPROVED #3872] Discount list/create/pause tools
// (133→136 / 145→148). registered_unverified 132→135.
// [TEST-MOD-APPROVED #3872] R2 referral list/create/invite and R3 guarded gig
// script drafting (136→140 / 148→152). registered_unverified 135→139.
// #2829 W9b Ari as the website designer: twelve new website tools, three
// website capabilities remapped to their typed replacements (140→152 tools /
// 152→164 capabilities). registered_unverified 139→151.
// #3355 adds 20 bounded autonomy, research, memory and verification tools
// (152→172 tools / 164→184 capabilities). registered_unverified 151→171.
// #2830 adds durable completeness, pre-draft design, bounded audit findings,
// and evidence-backed context writes (172→176 tools / 184→188 capabilities).
// registered_unverified 171→175.
const EXPECTED_TOOL_NAMES = [
  "approve_ad_plan",
  "build_host_onboarding_blueprint",
  "cancel_campaign",
  "cancel_event",
  "cancel_order",
  "cancel_trip_booking",
  "charge_installment_now",
  "confirm_site_review",
  "create_brand",
  "create_discount",
  "create_event",
  "create_experience",
  "create_referral_offer",
  "create_rsvp",
  "create_site_draft",
  "create_site_preview",
  "create_stay_reservation",
  "create_support_ticket",
  "create_trip",
  "create_venue_listing",
  "create_venue_reservation",
  "delete_brand",
  "delete_campaign_draft",
  "delete_experience",
  "delete_trip",
  "discard_event_draft",
  "disconnect_partner",
  "draft_campaign",
  "draft_gig_script",
  "duplicate_event",
  "edit_profile_avatar",
  "end_ad_campaign",
  "end_event_sales",
  "export_brand_people",
  "extract_listing_candidates",
  "fetch_public_listing_page",
  "forget_memory_note",
  "get_ad_campaign_report",
  "get_block_catalog",
  "get_brand_analytics",
  "get_brand_balances_reports",
  "get_brand_site",
  "get_buyer_notice_status",
  "get_campaign_report",
  "get_capability_inventory",
  "get_event_order_reconciliation",
  "get_growth_tool_report",
  "get_listing_conversion",
  "get_listing_type_capabilities",
  "get_market_rules",
  "get_onboarding_plan",
  "get_operator_snapshot",
  "get_order_refund_preview",
  "get_partner_status",
  "get_payout_status",
  "get_reservation_metrics",
  "get_site_operation_status",
  "get_site_page",
  "get_site_plan",
  "get_site_tokens",
  "get_tax_status",
  "get_trip_order_money",
  "get_venue_listing_status",
  "inspect_public_social_profile",
  "invite_brand_member",
  "invite_promoters",
  "invite_scanner",
  "list_brand_audit_log",
  "list_brand_team",
  "list_brands",
  "list_discounts",
  "list_event_orders",
  "list_events",
  "list_guest_roster",
  "list_memory_notes",
  "list_partner_brand_links",
  "list_partner_splits",
  "list_referral_offers",
  "list_site_designs",
  "list_site_pages",
  "list_site_versions",
  "list_trip_installments",
  "list_venue_claim_feedback",
  "list_venue_listings",
  "manage_agent_job",
  "manage_ari_history",
  "manage_brand_discovery_currency",
  "manage_brand_hours",
  "manage_brand_people",
  "manage_business_notifications",
  "manage_event_door_sale",
  "manage_event_group_chat",
  "manage_event_scanners",
  "manage_event_waitlist",
  "manage_experience_stops",
  "manage_marketing_audiences",
  "manage_marketing_templates",
  "manage_stay_inventory",
  "manage_stay_policy_price_media",
  "manage_support_inbox",
  "manage_trip_days",
  "manage_trip_inclusions",
  "manage_trip_tiers",
  "manage_trip_traveler_intake",
  "manage_venue_availability",
  "manage_venue_gallery",
  "manage_venue_menu",
  "manage_venue_waitlist",
  "mark_claim_feedback_fixed",
  "open_handoff",
  "patch_event_when",
  "pause_ad_campaign",
  "pause_discount",
  "propose_ad_plan",
  "propose_block_variant",
  "propose_site_collection_entry",
  "propose_site_composition",
  "propose_site_copy",
  "propose_site_imagery",
  "propose_site_tokens",
  "propose_trip_guide_update",
  "publish_event",
  "publish_experience",
  "publish_rsvp",
  "publish_site",
  "publish_stay",
  "publish_trip",
  "quote_stay",
  "read_public_url",
  "record_brand_context_finding",
  "refund_order",
  "refund_rsvp_contribution",
  "request_account_deletion",
  "request_tools",
  "retry_installment",
  "revoke_brand_invitation",
  "revoke_brand_member",
  "revoke_scanner_invitation",
  "rollback_site",
  "run_growth_tool",
  "run_site_design_checks",
  "save_memory_note",
  "save_site_plan_answers",
  "save_site_plan_design",
  "schedule_campaign",
  "search_capabilities",
  "search_public_web",
  "send_campaign_now",
  "send_installment_reminder",
  "send_venue_sms",
  "set_brand_pricing_defaults",
  "set_event_cover",
  "set_event_guest_privacy",
  "set_pricing_switches",
  "set_refund_policy",
  "set_rsvp_guest_status",
  "start_brand_completeness_job",
  "submit_venue_claim",
  "transition_stay",
  "transition_venue_reservation",
  "unpublish_event",
  "unpublish_experience",
  "update_ari_prefs",
  "update_brand",
  "update_brand_context",
  "update_campaign_draft",
  "update_event",
  "update_experience",
  "update_notification_prefs",
  "update_onboarding_plan",
  "update_rsvp",
  "update_rsvp_contribution_settings",
  "update_trip",
  "upsert_ticket_tier",
  "validate_site_draft",
  "venue_ops_action",
];

const EXPECTED = Object.freeze({
  capabilityCount: 188,
  statusBreakdown: Object.freeze({
    verified: 0,
    registered_unverified: 175,
    broken: 0,
    guided_handoff: 8,
    unsupported: 0,
    in_flight: 5,
  }),
  idDigest: "4162ea1724d4d1ec56854819cb4a57ff6660e1ad90737094d071e1627fa81bd5",
  statusDigest: "5a88bef584ecc692e20cd1b3177430a4b2e73c57a4e30fd4fb218d526ce3b64a",
  mappingDigest: "66cc9f1102a861f0d84c2dfcd530d3dbd3edc1b58d0025b46dc0d714bc68bde7",
  sourceRefDigest: "3a91c87a8aa031d89210b9b0a1b684041b0042d0ba5777bb45ede31b351f03aa",
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
  if (JSON.stringify(toolNames) !== JSON.stringify(EXPECTED_TOOL_NAMES)) failures.push("176-tool set changed");
  if (JSON.stringify(statusBreakdown) !== JSON.stringify(EXPECTED.statusBreakdown)) {
    failures.push("0/175/0/8/0/5 classification changed");
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
