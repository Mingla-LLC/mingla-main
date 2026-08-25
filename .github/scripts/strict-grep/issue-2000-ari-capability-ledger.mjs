#!/usr/bin/env node

/**
 * Issue #2000 — canonical Ari capability-ledger contract.
 *
 * Registration is not verification. This gate keeps the Business operation
 * denominator, Ari registry, prompt advertisement, source references, status
 * semantics, and evidence tiers in one fail-closed contract.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const LEDGER_PATH = "docs/contracts/ari-capability-ledger.json";
const TOOL_PATHS = [
  "supabase/functions/_shared/agentTools.ts",
  "supabase/functions/_shared/agentDomainTools.ts",
];
const PROMPT_PATH = "supabase/functions/_shared/agentSystemPrompt.ts";

// Independently maintained operation-universe manifest. The ledger owns support
// truth; this manifest owns the reviewed denominator, so deleting a real
// operation and reconciling mutable audit counters still fails closed.
const REQUIRED_CAPABILITY_IDS = new Set(`
ari.brand.create
ari.brand.list
ari.brand.update
ari.brand.delete
ari.event.create
ari.event.list
ari.event.update
ari.experience.create
ari.event.publish
ari.event.unpublish
ari.event.cancel
ari.event.end_sales
ari.event.duplicate
ari.event.patch_when
ari.event.cover
ari.event.guest_privacy
ari.ticket.upsert_tier
ari.ticket.pricing_switches
ari.experience.publish
ari.experience.update
ari.experience.delete
ari.experience.unpublish
ari.trip.create
ari.trip.update
ari.trip.publish
ari.trip.delete
ari.rsvp.create
ari.rsvp.update
ari.rsvp.publish
ari.rsvp.bulk_status
ari.rsvp.refund_contribution
ari.stay.quote
ari.stay.create_reservation
ari.stay.transition
ari.venue.create_reservation
ari.venue.transition_reservation
ari.venue.create_listing
ari.venue.submit_claim
ari.venue.mark_claim_feedback
ari.venue.list_listings
ari.venue.get_listing_status
ari.venue.list_claim_feedback
ari.venue.ops
ari.venue.send_sms
ari.marketing.draft_campaign
ari.marketing.schedule_campaign
ari.marketing.send_now
ari.marketing.cancel_campaign
ari.growth.run_tool
ari.payout.status
ari.partner.status
ari.partner.disconnect
ari.tax.status_guidance
ari.order.refund
ari.order.cancel
ari.trip.cancel_booking
ari.installment.retry
ari.analytics.brand
ari.team.invite_member
ari.team.invite_scanner
ari.team.revoke_member
ari.guests.list_roster
ari.people.export
ari.settings.preferences
ari.settings.notifications
ari.support.create_ticket
ari.account.delete
ari.operator.snapshot
ari.brand.hours
ari.brand.pricing_defaults
ari.event.discard_draft
ari.event.group_chat
ari.event.scan_ticket
ari.media.pick_cover
ari.trip.manage_days
ari.trip.manage_inclusions
ari.trip.manage_tiers
ari.trip.quote_builder
ari.trip.quote_to_draft
ari.intelligence.four_tools
ari.venue.intelligence
ari.stay.manage_inventory
ari.stay.publish_offering
ari.stay.manage_policy_price_media
ari.venue.manage_availability
ari.venue.manage_menu
ari.venue.manage_waitlist
ari.marketing.manage_audiences
ari.marketing.manage_templates
ari.people.list_detail_add
ari.people.import_contacts
ari.payments.stripe_kyc
ari.payments.paystack_kyc
ari.payments.read_balances_reports
ari.team.list_manage_roles
ari.team.revoke_scanner
ari.account.edit_profile_avatar
ari.account.manage_ari_history
ari.notifications.read_manage
ari.support.read_reply
ari.analytics.orders_reconciliation
ari.venue.organic_insights
ari.marketing.campaign_reports
ari.brand.audit_log
ari.brand.discovery_currency
ari.event.door_sale
ari.event.order_management
ari.event.waitlist
ari.event.scanner_admin
ari.experience.snap_generation
ari.experience.manage_stops
ari.rsvp.scan_pass
ari.rsvp.contribution_settings
ari.trip.traveler_intake
ari.installment.charge_now
ari.installment.send_reminder
ari.trip.order_money
ari.venue.gallery
ari.partner.brand_links
ari.partner.splits
`.trim().split(/\s+/));

// Independent classification authority established by the source-contract
// reconciliation at this immutable revision, minus rows whose concrete defects
// are repaired by issue #1972, minus the four Stay/venue reservation rows
// whose envelope/role defects are repaired by issue #1975 (quote/create/
// transition stay + create_venue_reservation), minus the three venue write
// rows whose canonical-arity/role defects are repaired by issue #1978, minus
// ari.venue.ops / ari.venue.send_sms repaired by issue #1979 (venue_ops_action
// forwards exact venue-order-staff actions; send_venue_sms sends
// { waitlistId } only), and minus the four trip lifecycle rows repaired by
// issue #1971. Ledger prose may explain a remaining defect, but it cannot
// remove one from this set or create a new proven-broken claim.
// [TEST-MOD-APPROVED #1975+#1978+#1979] Proven-broken authority shrinks only for
// rows whose concrete defects these issues repair; no behavioral coverage removed.
//
// [TEST-MOD-APPROVED #1971] ari.trip.create/.update/.publish/.delete leave this
// set. Each named defect is repaired at source by
// supabase/migrations/20270509001971_issue_1971_ari_trip_lifecycle.sql plus the
// rewritten trip executors:
//   * create no longer inserts a bare events row — biz_create_trip_draft emits
//     the full canonical draft graph including the placeholder ticket and tier;
//   * update/publish/delete no longer depend on the owner-first guard the
//     original evidence cites (that seam was already replaced by #2019's
//     delegated adapter, and every trip command now enforces the event_manager
//     floor through biz_trip_require_manager);
//   * publish no longer sends `{}` — biz_publish_trip_command reconstructs the
//     payload from persisted state;
//   * delete no longer writes events.deleted_at directly — biz_soft_delete_trip
//     rejects any order outside failed/cancelled on every payment rail.
// No behavioural coverage is removed: those four rows move to
// registered_unverified, which the gate still holds to the verification-gap
// blocker rule, and the executable proofs live in
// supabase/migrations/__tests__/issue_1971_trip_lifecycle.implementor.happy.pg17.test.sql.
const PROVEN_BROKEN_AUDIT_SHA = "829c46fc319c34452e18876b728b6d840f95b904";
// [TEST-MOD-APPROVED #1977] 21 - 5 RSVP lifecycle rows (create/publish/bulk/
// refund + retired duplicate set_approval) = 16.
// [TEST-MOD-APPROVED #424 ledger-truth] 16 - 15 Wave-3/#2593 repaired money/
// people/marketing rows = 1. Each named defect is repaired at source in
// agentDomainTools.ts (+ delegated auth): canonical partner_brand_links,
// refund/cancel/trip-cancel payloads, brand_team_members revoke, invite-
// scanner, growth app-lane engines, roster pagination, and finance/marketing
// role gates. ari.operator.snapshot remains proven broken (owner-only brands
// filter). No behavioural coverage removed — flipped rows stay under the
// registered_unverified verification-gap blocker rule.
const PROVEN_BROKEN_CAPABILITY_IDS = new Set(`
ari.operator.snapshot
`.trim().split(/\s+/));

const STATUSES = new Set([
  "verified",
  "registered_unverified",
  "broken",
  "guided_handoff",
  "unsupported",
  "in_flight",
]);
const SAFETY = new Set(["read", "write", "money", "destructive"]);
const CONFIRMATION = new Set(["none", "standard", "type_to_confirm", "guided_handoff"]);
const PHASES = new Set(["pre_1986", "pr_1986", "post_1986", "open_work", "issue_1973"]);
const CONFIDENCE = new Set(["high", "medium", "low"]);
const SURFACES = new Set(["business_ios", "business_android", "business_web"]);
const EVIDENCE_TIERS = new Set([
  "registration",
  "source_contract",
  "regression",
  "deployed_runtime",
  "production_observation",
]);

function read(root, relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

export function extractRegisteredTools(toolSources) {
  const names = new Set();
  const patterns = [
    /^\s*name:\s*"([a-z][a-z0-9_]*)"\s*,/gm,
    /writeTool\(\s*"([a-z][a-z0-9_]*)"/g,
  ];
  for (const source of toolSources) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(source))) names.add(match[1]);
    }
  }
  return names;
}

export function extractPromptTools(promptSource) {
  const names = new Set();
  const pattern = /^-\s+([a-z][a-z0-9_]*)\s+—/gm;
  let match;
  while ((match = pattern.exec(promptSource))) names.add(match[1]);
  return names;
}

function addSetDiff(failures, left, right, message) {
  for (const value of left) {
    if (!right.has(value)) failures.push(`${message}: ${value}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function hasExactCodeSymbol(source, symbol) {
  const clean = stripComments(source);
  const prefixed = /^(?:const|let|var) ([A-Za-z_$][\w$]*)$/.exec(symbol);
  if (prefixed) {
    const [, identifier] = prefixed;
    return new RegExp(
      `^\\s*(?:export\\s+)?${symbol.split(" ")[0]}\\s+${escapeRegExp(identifier)}\\b`,
      "m",
    ).test(clean);
  }
  const member = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(symbol);
  if (member) {
    const [, owner, method] = member;
    const ownerDeclaration = new RegExp(
      `^\\s*export\\s+const\\s+${escapeRegExp(owner)}\\s*=\\s*\\{`,
      "m",
    );
    const memberDeclaration = new RegExp(`^\\s*${escapeRegExp(method)}\\s*\\(`, "m");
    return ownerDeclaration.test(clean) && memberDeclaration.test(clean);
  }
  if (!/^[A-Za-z_$][\w$]*$/.test(symbol)) return false;
  const identifier = escapeRegExp(symbol);
  const declaration = new RegExp(
    `^\\s*export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|class|interface|type|const|let|var|enum)\\s+${identifier}\\b`,
    "m",
  );
  const namedReexport = new RegExp(
    `^\\s*export\\s*\\{[^}]*\\b${identifier}\\b[^}]*\\}\\s*from\\s*["'][^"']+["']`,
    "m",
  );
  const defaultReexport = new RegExp(
    `^\\s*export\\s*\\{\\s*default\\s*\\}\\s*from\\s*["'][^"']*\\/${identifier}["']`,
    "m",
  );
  return declaration.test(clean) || namedReexport.test(clean) || defaultReexport.test(clean);
}

function readAtAuditSha(root, sha, relative) {
  try {
    return execFileSync("git", ["show", `${sha}:${relative}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function validateRef(root, auditSha, ref, label, failures, requireHistoricalRef = false) {
  if (!ref || typeof ref.path !== "string" || typeof ref.symbol !== "string") {
    failures.push(`${label}: source reference requires path + symbol`);
    return;
  }
  const absolute = path.join(root, ref.path);
  if (!fs.existsSync(absolute)) {
    failures.push(`${label}: source path does not exist: ${ref.path}`);
    return;
  }
  const currentSource = fs.readFileSync(absolute, "utf8");
  if (!hasExactCodeSymbol(currentSource, ref.symbol)) {
    failures.push(`${label}: exact code symbol "${ref.symbol}" is stale in ${ref.path}`);
  }
  if (!requireHistoricalRef) return;
  const auditedSource = readAtAuditSha(root, auditSha, ref.path);
  if (auditedSource === null) {
    failures.push(`${label}: source path is absent at audit SHA: ${ref.path}`);
  } else if (!hasExactCodeSymbol(auditedSource, ref.symbol)) {
    failures.push(`${label}: exact code symbol "${ref.symbol}" is absent at audit SHA in ${ref.path}`);
  }
}

export function validateLedger({ root, ledger, registered, advertised }) {
  const failures = [];
  // [TEST-MOD-APPROVED #424 ledger-truth] 16 - 15 Wave-3 rows = 1.
  if (PROVEN_BROKEN_CAPABILITY_IDS.size !== 1) {
    failures.push(
      `proven-broken authority must contain 1 audited IDs, found ${PROVEN_BROKEN_CAPABILITY_IDS.size}`,
    );
  }
  addSetDiff(
    failures,
    PROVEN_BROKEN_CAPABILITY_IDS,
    REQUIRED_CAPABILITY_IDS,
    "proven-broken authority references an operation outside the reviewed universe",
  );
  if (ledger.schema_version !== 1) failures.push("schema_version must equal 1");
  if (!/^[0-9a-f]{40}$/.test(ledger.audit?.baseline_sha ?? "")) {
    failures.push("audit.baseline_sha must be a full immutable Git SHA");
  }
  if (ledger.audit?.baseline_sha !== PROVEN_BROKEN_AUDIT_SHA) {
    failures.push(
      `audit.baseline_sha must match proven-broken authority ${PROVEN_BROKEN_AUDIT_SHA}`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(ledger.audit?.verified_at ?? "")) {
    failures.push("audit.verified_at must be UTC second precision");
  }
  if (!Array.isArray(ledger.operation_universe?.source_roots) || ledger.operation_universe.source_roots.length === 0) {
    failures.push("operation_universe.source_roots must declare a non-empty denominator");
  } else {
    for (const sourceRoot of ledger.operation_universe.source_roots) {
      if (typeof sourceRoot !== "string" || !fs.existsSync(path.join(root, sourceRoot))) {
        failures.push(`operation universe source root is stale: ${sourceRoot}`);
      }
    }
  }
  if (!Array.isArray(ledger.operation_universe?.exclusions) || ledger.operation_universe.exclusions.length === 0) {
    failures.push("operation_universe.exclusions must be explicit");
  }
  if (!Array.isArray(ledger.capabilities) || ledger.capabilities.length === 0) {
    failures.push("capabilities must be a non-empty array");
    return failures;
  }

  const ids = new Set();
  const mappedTools = new Map();
  for (const capability of ledger.capabilities) {
    const label = capability?.id ?? "<missing-id>";
    if (!/^ari\.[a-z0-9]+(?:\.[a-z0-9_]+)+$/.test(label)) failures.push(`${label}: invalid stable capability id`);
    if (ids.has(label)) failures.push(`${label}: duplicate capability id`);
    ids.add(label);
    for (const field of ["domain", "outcome", "required_role", "verified_at"]) {
      if (typeof capability?.[field] !== "string" || capability[field].length === 0) failures.push(`${label}: missing ${field}`);
    }
    if (!STATUSES.has(capability.status)) failures.push(`${label}: invalid status ${capability.status}`);
    if (!SAFETY.has(capability.safety)) failures.push(`${label}: invalid safety ${capability.safety}`);
    if (!CONFIRMATION.has(capability.confirmation)) failures.push(`${label}: invalid confirmation ${capability.confirmation}`);
    if (!PHASES.has(capability.provenance?.phase)) failures.push(`${label}: invalid provenance phase`);
    if (!CONFIDENCE.has(capability.confidence)) failures.push(`${label}: invalid confidence`);
    if (!Array.isArray(capability.surfaces) || capability.surfaces.length === 0 || capability.surfaces.some((s) => !SURFACES.has(s))) {
      failures.push(`${label}: surfaces must use the declared Business surface set`);
    }
    if (!Array.isArray(capability.owners?.ui) || capability.owners.ui.length === 0) failures.push(`${label}: missing UI owner path`);
    else for (const uiPath of capability.owners.ui) if (!fs.existsSync(path.join(root, uiPath))) failures.push(`${label}: UI owner path is stale: ${uiPath}`);
    if (!Array.isArray(capability.owners?.source) || capability.owners.source.length === 0) failures.push(`${label}: missing canonical source owner`);
    else capability.owners.source.forEach((ref, index) =>
      validateRef(
        root,
        ledger.audit.baseline_sha,
        ref,
        `${label}.owners.source[${index}]`,
        failures,
        PROVEN_BROKEN_CAPABILITY_IDS.has(label),
      )
    );

    const tool = capability.ari_tool;
    if (tool !== null && typeof tool !== "string") failures.push(`${label}: ari_tool must be string or null`);
    if (typeof tool === "string") {
      const rows = mappedTools.get(tool) ?? [];
      rows.push(label);
      mappedTools.set(tool, rows);
      if (!registered.has(tool)) failures.push(`${label}: maps nonexistent registered tool ${tool}`);
      if (!advertised.has(tool)) failures.push(`${label}: mapped tool is absent from prompt ${tool}`);
    }

    if (["verified", "registered_unverified", "broken"].includes(capability.status) && typeof tool !== "string") {
      failures.push(`${label}: ${capability.status} requires a registered tool`);
    }
    if (["unsupported", "in_flight"].includes(capability.status) && tool !== null) {
      failures.push(`${label}: ${capability.status} cannot claim a registered tool`);
    }
    if (capability.status === "guided_handoff") {
      validateRef(
        root,
        ledger.audit.baseline_sha,
        capability.guided_handoff,
        `${label}.guided_handoff`,
        failures,
      );
      if (capability.confirmation !== "guided_handoff") failures.push(`${label}: guided handoff requires guided_handoff confirmation`);
    } else if (capability.guided_handoff != null) {
      failures.push(`${label}: only guided_handoff status may declare a handoff target`);
    }
    if (capability.status === "broken" && (!Array.isArray(capability.owning_issues) || capability.owning_issues.length === 0)) {
      failures.push(`${label}: broken status requires an owning issue`);
    }
    const blockers = Array.isArray(capability.blockers) ? capability.blockers : [];
    const verificationGap = blockers.length > 0 && blockers.every((blocker) =>
      typeof blocker === "string" &&
      /(?:runtime|surface|parity).*(?:proof|evidence|certification)|(?:proof|evidence|certification).*(?:runtime|surface|parity)/i.test(blocker)
    );
    if (capability.status === "registered_unverified" && !verificationGap) {
      failures.push(`${label}: registered_unverified blockers must describe verification gaps only`);
    }
    if (capability.status === "broken") {
      if (verificationGap || blockers.length === 0) failures.push(`${label}: broken requires a concrete defect blocker`);
      if (!capability.evidence?.some((e) => e.tier === "source_contract" || e.tier === "regression")) {
        failures.push(`${label}: broken requires source-contract or regression defect evidence`);
      }
    }
    if (capability.status === "in_flight") {
      if (!Array.isArray(capability.owning_issues) || capability.owning_issues.length === 0) failures.push(`${label}: in_flight requires an open owning issue reference`);
      if (capability.provenance?.phase !== "open_work") failures.push(`${label}: in_flight provenance must be open_work`);
    }
    if (!Array.isArray(capability.owning_issues) || capability.owning_issues.some((n) => !Number.isInteger(n) || n < 1)) {
      failures.push(`${label}: owning_issues must be positive issue numbers`);
    }
    if (!Array.isArray(capability.evidence) || capability.evidence.length === 0) failures.push(`${label}: evidence must not be empty`);
    else {
      for (const evidence of capability.evidence) {
        if (!EVIDENCE_TIERS.has(evidence.tier)) failures.push(`${label}: invalid evidence tier ${evidence.tier}`);
        if (!/^[0-9a-f]{40}$/.test(evidence.sha ?? "")) failures.push(`${label}: evidence requires an immutable SHA`);
        if (typeof evidence.reference !== "string" || evidence.reference.length === 0) failures.push(`${label}: evidence requires a reference`);
      }
    }

    if (capability.status === "verified") {
      const regressions = capability.evidence.filter((e) => e.tier === "regression");
      const roles = new Set(regressions.map((e) => e.guard_role));
      const guardRefs = new Set(regressions.map((e) => e.reference));
      if (!roles.has("implementor") || !roles.has("independent_tester") || guardRefs.size < 2) {
        failures.push(`${label}: verified requires distinct implementor + independent tester regression evidence`);
      }
      if (!capability.evidence.some((e) => e.tier === "deployed_runtime")) failures.push(`${label}: verified requires exact-revision deployed runtime evidence`);
      const observed = new Set(capability.evidence.filter((e) => e.tier === "production_observation").flatMap((e) => e.surfaces ?? []));
      for (const surface of capability.surfaces) if (!observed.has(surface)) failures.push(`${label}: verified lacks production observation for ${surface}`);
    }
  }

  addSetDiff(failures, REQUIRED_CAPABILITY_IDS, ids, "required Business operation is absent from ledger");
  addSetDiff(failures, ids, REQUIRED_CAPABILITY_IDS, "ledger operation is absent from reviewed operation manifest");
  const brokenIds = new Set(
    ledger.capabilities
      .filter((capability) => capability.status === "broken")
      .map((capability) => capability.id),
  );
  addSetDiff(
    failures,
    PROVEN_BROKEN_CAPABILITY_IDS,
    brokenIds,
    "proven-broken capability was laundered to another status",
  );
  addSetDiff(
    failures,
    brokenIds,
    PROVEN_BROKEN_CAPABILITY_IDS,
    "broken classification lacks proven-broken authority",
  );

  for (const [tool, rows] of mappedTools) {
    if (rows.length !== 1) failures.push(`registered tool ${tool} maps ${rows.length} times: ${rows.join(", ")}`);
  }
  addSetDiff(failures, registered, new Set(mappedTools.keys()), "registered tool is absent from ledger");
  addSetDiff(failures, advertised, registered, "prompt advertises nonexistent tool");
  addSetDiff(failures, registered, advertised, "registered tool is absent from prompt");
  if (ledger.audit?.registered_tool_count !== registered.size) failures.push(`audit.registered_tool_count ${ledger.audit?.registered_tool_count} != ${registered.size}`);
  if (ledger.audit?.capability_count !== ledger.capabilities.length) failures.push(`audit.capability_count ${ledger.audit?.capability_count} != ${ledger.capabilities.length}`);
  const actualBreakdown = Object.fromEntries([...STATUSES].map((status) => [status, ledger.capabilities.filter((c) => c.status === status).length]));
  for (const status of STATUSES) {
    if (ledger.audit?.status_breakdown?.[status] !== actualBreakdown[status]) failures.push(`audit.status_breakdown.${status} is stale`);
  }
  return failures;
}

export function audit(root = ROOT, overrides = {}) {
  const ledger = overrides.ledger ?? JSON.parse(read(root, LEDGER_PATH));
  const toolSources = overrides.toolSources ?? TOOL_PATHS.map((relative) => read(root, relative));
  const promptSource = overrides.promptSource ?? read(root, PROMPT_PATH);
  return validateLedger({
    root,
    ledger,
    registered: extractRegisteredTools(toolSources),
    advertised: extractPromptTools(promptSource),
  });
}

function expectMutation(name, mutate, predicate) {
  const ledger = JSON.parse(read(ROOT, LEDGER_PATH));
  const overrides = { ledger };
  mutate(overrides);
  const failures = audit(ROOT, overrides);
  if (!failures.some(predicate)) throw new Error(`${name}: mutation passed or wrong failure: ${failures.join("; ")}`);
}

function selfTest() {
  const clean = audit(ROOT);
  if (clean.length) throw new Error(`clean ledger failed: ${clean.join("; ")}`);
  expectMutation("missing tool mapping", ({ ledger }) => {
    const row = ledger.capabilities.find((c) => c.ari_tool);
    row.ari_tool = null;
  }, (failure) => failure.includes("requires a registered tool") || failure.includes("absent from ledger"));
  expectMutation("duplicate alias", ({ ledger }) => {
    ledger.capabilities.find((c) => c.ari_tool === null).ari_tool = ledger.capabilities.find((c) => c.ari_tool).ari_tool;
  }, (failure) => failure.includes("maps 2 times"));
  expectMutation("broken to verified laundering", ({ ledger }) => {
    ledger.capabilities.find((c) => c.status === "broken").status = "verified";
    ledger.audit.status_breakdown.broken--;
    ledger.audit.status_breakdown.verified++;
  }, (failure) => failure.includes("verified requires"));
  // [TEST-MOD-APPROVED #424 ledger-truth] Re-aimed from ari.guests.list_roster to ari.operator.snapshot.
  expectMutation("broken to unverified laundering", ({ ledger }) => {
    const row = ledger.capabilities.find((c) => c.id === "ari.operator.snapshot");
    row.status = "registered_unverified";
    row.blockers = ["No exact-revision runtime evidence on all required surfaces"];
    ledger.audit.status_breakdown.broken--;
    ledger.audit.status_breakdown.registered_unverified++;
  }, (failure) => failure.includes("proven-broken capability was laundered"));
  expectMutation("stale symbol", ({ ledger }) => {
    ledger.capabilities[0].owners.source[0].symbol = "symbol_that_does_not_exist";
  }, (failure) => failure.includes("symbol") && failure.includes("stale"));
  // [TEST-MOD-APPROVED #424 ledger-truth] Same re-aim onto ari.operator.snapshot.
  expectMutation("proven-broken historical source must exist", ({ ledger }) => {
    const broken = ledger.capabilities.find((c) => c.id === "ari.operator.snapshot");
    const postBaseline = ledger.capabilities.find((c) => c.id === "ari.experience.unpublish");
    broken.owners.source[0] = { ...postBaseline.owners.source[0] };
  }, (failure) => failure.includes("absent at audit SHA"));
  expectMutation("post-baseline current symbol remains exact", ({ ledger }) => {
    const postBaseline = ledger.capabilities.find((c) => c.id === "ari.experience.unpublish");
    postBaseline.owners.source[0].symbol = "symbol_that_does_not_exist";
  }, (failure) => failure.includes("symbol") && failure.includes("stale"));
  const postBaseline = JSON.parse(read(ROOT, LEDGER_PATH)).capabilities.find(
    (capability) => capability.id === "ari.experience.unpublish",
  );
  const postBaselineRef = postBaseline.owners.source[0];
  const postBaselineSource = readAtAuditSha(
    ROOT,
    PROVEN_BROKEN_AUDIT_SHA,
    postBaselineRef.path,
  );
  if (
    postBaselineSource !== null &&
    hasExactCodeSymbol(postBaselineSource, postBaselineRef.symbol)
  ) {
    throw new Error("post-baseline capability unexpectedly exists at the historical audit SHA");
  }
  expectMutation("extant generic token", ({ ledger }) => {
    ledger.capabilities.find((c) => c.id === "ari.brand.create").owners.source[0].symbol = "brand";
  }, (failure) => failure.includes("exact code symbol"));
  expectMutation("denominator deletion with laundered counters", ({ ledger }) => {
    const index = ledger.capabilities.findIndex((c) => c.id === "ari.installment.charge_now");
    const [removed] = ledger.capabilities.splice(index, 1);
    ledger.audit.capability_count--;
    ledger.audit.status_breakdown[removed.status]--;
  }, (failure) => failure.includes("required Business operation is absent"));
  expectMutation("missing guided route", ({ ledger }) => {
    ledger.capabilities.find((c) => c.status === "guided_handoff").guided_handoff.path = "missing/route.tsx";
  }, (failure) => failure.includes("source path does not exist"));
  expectMutation("duplicate id", ({ ledger }) => {
    ledger.capabilities[1].id = ledger.capabilities[0].id;
  }, (failure) => failure.includes("duplicate capability id"));
  const promptSource = read(ROOT, PROMPT_PATH);
  const firstTool = [...extractPromptTools(promptSource)][0];
  const promptWithoutTool = promptSource.replace(new RegExp(`^- ${firstTool} —.*$`, "m"), "");
  const promptFailures = audit(ROOT, { promptSource: promptWithoutTool });
  if (!promptFailures.some((failure) => failure.includes("absent from prompt"))) throw new Error("prompt drift mutation passed");
  console.log("[issue-2000-ari-capability-ledger] self-test PASS (12 hostile mutations + post-baseline control)");
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const failures = audit(ROOT);
  if (failures.length) {
    failures.forEach((failure) => console.error(`[issue-2000-ari-capability-ledger] FAIL: ${failure}`));
    process.exit(1);
  }
  const ledger = JSON.parse(read(ROOT, LEDGER_PATH));
  console.log(`[issue-2000-ari-capability-ledger] PASS: ${ledger.capabilities.length} capabilities, ${ledger.audit.registered_tool_count} registered tools, complete bijection`);
}
