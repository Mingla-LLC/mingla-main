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
// [TEST-MOD-APPROVED #3355] P2 adds the canonical brand readiness read and its
// brand-wide "not now" write pair, and registers the #3355 saved-campaign-draft
// readback the branch already shipped (176→180 tools / 188→192 capabilities).
// registered_unverified 175→179; in_flight 6→5 (campaign draft review is now a
// registered read).
// #3355 P6 follow-up adds tell_owner_in_brand_group, the confirmed
// brand-group note to the owner (180→181 tools / 192→193 capabilities).
// registered_unverified 179→180.
// #3355 P7 adds set_brand_payout_country, the confirmed Host-parity payout
// country pick (181→182 tools / 193→194 capabilities).
// registered_unverified 180→181.
// #4238 wave 2 adds list_ad_audiences, the brand's own ad audience names and
// rough sizes (182→183 tools / 194→195 capabilities).
// registered_unverified 181→182.
// #4304 adds end_discount and resume_discount, the confirmed versioned
// discount end and resume beside pause (183→185 tools / 195→197 capabilities).
// registered_unverified 182→184.
// #3355 Wave D renames save_memory_note to remember_note (ari.memory.save keeps
// its id; the tool name and its source owner move, so mappingDigest and
// sourceRefDigest are re-derived; counts unchanged).
// #3355 Wave B adds search_mingla_guide, Ari's Feature Guide read
// (185→186 tools / 197→198 capabilities). registered_unverified 184→185.
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
  "defer_readiness_item",
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
  "end_discount",
  "end_event_sales",
  "export_brand_people",
  "extract_listing_candidates",
  "fetch_public_listing_page",
  "forget_memory_note",
  "get_ad_campaign_report",
  "get_block_catalog",
  "get_brand_analytics",
  "get_brand_balances_reports",
  "get_brand_readiness",
  "get_brand_site",
  "get_buyer_notice_status",
  "get_campaign_draft",
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
  "list_ad_audiences",
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
  "remember_note",
  "request_account_deletion",
  "request_tools",
  "resume_discount",
  "retry_installment",
  "revoke_brand_invitation",
  "revoke_brand_member",
  "revoke_scanner_invitation",
  "rollback_site",
  "run_growth_tool",
  "run_site_design_checks",
  "save_site_plan_answers",
  "save_site_plan_design",
  "schedule_campaign",
  "search_capabilities",
  "search_mingla_guide",
  "search_public_web",
  "send_campaign_now",
  "send_installment_reminder",
  "send_venue_sms",
  "set_brand_payout_country",
  "set_brand_pricing_defaults",
  "set_event_cover",
  "set_event_guest_privacy",
  "set_pricing_switches",
  "set_refund_policy",
  "set_rsvp_guest_status",
  "start_brand_completeness_job",
  "submit_venue_claim",
  "tell_owner_in_brand_group",
  "transition_stay",
  "transition_venue_reservation",
  "undefer_readiness_item",
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
  capabilityCount: 198,
  statusBreakdown: Object.freeze({
    verified: 0,
    registered_unverified: 185,
    broken: 0,
    guided_handoff: 8,
    unsupported: 0,
    in_flight: 5,
  }),
  idDigest: "472fe88f449a62a250b2b36f11209e041fb0e7a414e1d11ef7bacf0f5e4b1cd5",
  statusDigest: "6078408d8a2c4044e640c784e6b8dddd30e1d42b4c4a2107c0b3a0dc76d64388",
  mappingDigest: "c7798203c86babeac0ba15b554ebfe0835667a503cb44e9116024ed123c348a6",
  sourceRefDigest: "03b8b58e944ed4ad01c5e246bae7ec762c85b7ee5a889eeb14323a1cd2e79eba",
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
  if (JSON.stringify(toolNames) !== JSON.stringify(EXPECTED_TOOL_NAMES)) failures.push("186-tool set changed");
  if (JSON.stringify(statusBreakdown) !== JSON.stringify(EXPECTED.statusBreakdown)) {
    failures.push("0/185/0/8/0/5 classification changed");
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

// #3355 P10 (SC-17) — ledger truth from live behaviour. Pinned independently of
// the gate: exactly these rows cite a live flow-eval run, each citation resolves
// to a recorded run where every named eval passed and covers the row, and no
// row is verified without one.
const LIVE_EVAL_RUNS_PATH = path.join(ROOT, "docs/contracts/ari-live-eval-runs.json");
const EXPECTED_LIVE_EVAL_ROWS = [
  "ari.brand.update_context",
  "ari.event.create",
  "ari.event.update",
  "ari.experience.create",
  "ari.stay.manage_inventory",
  "ari.ticket.upsert_tier",
  "ari.trip.create",
  "ari.venue.create_listing",
];

function liveEvalFailures(ledger, runs) {
  const failures = [];
  for (const row of ledger.capabilities) {
    if (row.status === "verified" && !row.live_eval) failures.push(`${row.id}: verified without live_eval`);
    if (!row.live_eval) continue;
    const run = runs.runs.find((entry) => entry.run_id === row.live_eval.run_id);
    if (!run) {
      failures.push(`${row.id}: unknown run`);
      continue;
    }
    for (const id of row.live_eval.evals ?? []) {
      const result = run.evals.find((entry) => entry.id === id);
      if (result?.verdict !== "pass") failures.push(`${row.id}: ${id} did not pass`);
      else if (!result.capabilities.includes(row.id)) failures.push(`${row.id}: ${id} does not cover it`);
    }
  }
  return failures;
}

function readRuns() {
  return JSON.parse(fs.readFileSync(LIVE_EVAL_RUNS_PATH, "utf8"));
}

test("tester pins the rows carrying live flow-eval evidence and resolves every citation", () => {
  const ledger = readLedger();
  const cited = ledger.capabilities.filter((row) => row.live_eval).map((row) => row.id).sort();
  assert.deepEqual(cited, EXPECTED_LIVE_EVAL_ROWS);
  assert.deepEqual(liveEvalFailures(ledger, readRuns()), []);
  // Local live evidence never stands in for production: no row flips to verified on it.
  assert.ok(ledger.capabilities.filter((row) => row.live_eval).every((row) => row.status === "registered_unverified"));
});

test("tester rejects a live_eval citing a run that never happened or an eval that failed", () => {
  const ledger = readLedger();
  const row = ledger.capabilities.find((capability) => capability.id === "ari.event.create");
  row.live_eval = { run_id: "flow-invented", evals: ["event_create_minimal"] };
  assert.match(liveEvalFailures(ledger, readRuns()).join("; "), /unknown run/);
  const runs = readRuns();
  const real = ledger.capabilities.find((capability) => capability.id === "ari.trip.create");
  runs.runs.find((entry) => entry.run_id === real.live_eval.run_id)
    .evals.find((entry) => entry.id === "trip_create_lagos_3day").verdict = "fail";
  assert.match(liveEvalFailures(readLedger(), runs).join("; "), /trip_create_lagos_3day did not pass/);
});

test("tester rejects a verified row without a live eval run", () => {
  const ledger = readLedger();
  ledger.capabilities.find((capability) => capability.id === "ari.operator.snapshot").status = "verified";
  assert.match(liveEvalFailures(ledger, readRuns()).join("; "), /verified without live_eval/);
});
