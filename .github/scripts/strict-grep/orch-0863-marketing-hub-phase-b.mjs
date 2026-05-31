#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — ORCH-0863 [Marketing Hub Phase B — Overview + Audiences
 * + Templates tabs].
 *
 * Enforces the invariants pinned in SPEC §13 + §18:
 *   I-PROPOSED-MKT-OVERVIEW-NO-REVENUE-FABRICATION
 *     - Overview route MUST NOT contain `$` (Constitution #9, no UTM-to-
 *       campaign attribution yet).
 *     - Overview route MUST NOT contain "revenue" (case-insensitive).
 *     - Overview route MUST NOT render "Opened" as a funnel-card label
 *       (no Resend webhook ingest path; SPEC NG-8).
 *   I-PROPOSED-MKT-STARTER-TEMPLATES-READ-ONLY
 *     - marketingTemplateService.updateUserTemplate MUST contain a
 *       starter-pack defense-in-depth guard that throws before any UPDATE
 *       round-trip.
 *   Composer template-prefill wiring
 *     - compose.tsx useLocalSearchParams schema MUST include `template?:`.
 *   I-PROPOSED-MKT-PHASE-B-NO-NEW-TABLES
 *     - This ORCH MUST NOT introduce new files under supabase/migrations/
 *       or supabase/functions/. Diff-aware against origin/main when
 *       available; otherwise validates the current tree shape.
 *   Required service file presence
 *     - mingla-business/src/services/marketing/marketingOverviewService.ts
 *       MUST exist and MUST export getMarketingOverview.
 *
 * Exit codes:
 *   0 — all checks pass
 *   1 — at least one check failed
 *   2 — file system error
 *
 * Self-test mode (`--self-test`) validates the regex/checker behaviour
 * against inlined fixture strings and exits 1 if expectations are not met.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const OVERVIEW_ROUTE = path.join(
  REPO_ROOT,
  "mingla-business",
  "app",
  "(tabs)",
  "marketing",
  "index.tsx",
);
const TEMPLATE_SERVICE = path.join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "services",
  "marketing",
  "marketingTemplateService.ts",
);
const OVERVIEW_SERVICE = path.join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "services",
  "marketing",
  "marketingOverviewService.ts",
);
const COMPOSE_ROUTE = path.join(
  REPO_ROOT,
  "mingla-business",
  "app",
  "(tabs)",
  "marketing",
  "campaigns",
  "compose.tsx",
);

let failures = 0;
function fail(check, msg) {
  failures += 1;
  console.error(`FAIL [${check}] ${msg}`);
}
function ok(check, msg) {
  console.log(`OK   [${check}] ${msg}`);
}

function readSource(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`FATAL: could not read ${filePath}: ${err.message}`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Check 1: Overview route does NOT contain `$` (excluding template-literal interpolation ${...})
// ---------------------------------------------------------------------------
function checkOverviewNoDollar(source) {
  const lines = source.split("\n");
  const offenders = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;
    const stripped = line.replace(/\$\{[^}]*\}/g, "");
    if (stripped.includes("$")) {
      offenders.push(`L${i + 1}: ${line.trim()}`);
    }
  }
  if (offenders.length > 0) {
    fail(
      "C1: overview-no-dollar",
      `${OVERVIEW_ROUTE} contains a '$' literal (Constitution #9 — no revenue fabrication):\n  ${offenders.join("\n  ")}`,
    );
  } else {
    ok("C1: overview-no-dollar", "no '$' literal in Overview route");
  }
}

// ---------------------------------------------------------------------------
// Check 2: Overview route does NOT contain "revenue" (case-insensitive)
// ---------------------------------------------------------------------------
function checkOverviewNoRevenue(source) {
  if (source.toLowerCase().includes("revenue")) {
    fail(
      "C2: overview-no-revenue",
      `${OVERVIEW_ROUTE} contains the word 'revenue' (Constitution #9 — no UTM-to-campaign attribution exists yet)`,
    );
  } else {
    ok("C2: overview-no-revenue", "no 'revenue' substring in Overview route");
  }
}

// ---------------------------------------------------------------------------
// Check 3: Overview route does NOT render 'Opened' as a funnel-card label
// ---------------------------------------------------------------------------
function checkOverviewNoOpened(source) {
  if (
    source.includes('label="Opened"') ||
    source.includes('label="OPENED"') ||
    source.includes("label={'Opened'}") ||
    source.includes('label={"Opened"}')
  ) {
    fail(
      "C3: overview-no-opened",
      `${OVERVIEW_ROUTE} renders an 'Opened' funnel-card label (SPEC NG-8 — no Resend webhook ingest path)`,
    );
  } else {
    ok("C3: overview-no-opened", "no 'Opened' funnel-card label literal");
  }
}

// ---------------------------------------------------------------------------
// Check 4: marketingTemplateService.updateUserTemplate has a starter-pack guard
// ---------------------------------------------------------------------------
function checkStarterPackGuard(source) {
  // Look for the assertNotStarterPack pre-check call inside updateUserTemplate
  // AND deleteUserTemplate. The helper must throw 'Cannot modify starter-pack template'.
  const guardPattern = /assertNotStarterPack\s*\(/g;
  const guardCalls = source.match(guardPattern);
  const throwsCorrectMessage = source.includes('"Cannot modify starter-pack template"') ||
    source.includes("'Cannot modify starter-pack template'");
  if (guardCalls === null || guardCalls.length < 2 || !throwsCorrectMessage) {
    fail(
      "C4: starter-pack-guard",
      `${TEMPLATE_SERVICE} updateUserTemplate / deleteUserTemplate missing defense-in-depth starter-pack guard (need assertNotStarterPack() in both + 'Cannot modify starter-pack template' throw)`,
    );
  } else {
    ok(
      "C4: starter-pack-guard",
      `defense-in-depth guard present (${guardCalls.length} assertNotStarterPack calls)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Check 5: compose.tsx useLocalSearchParams schema includes `template?:`
// ---------------------------------------------------------------------------
function checkComposeTemplateParam(source) {
  const schemaPattern = /useLocalSearchParams<\{[^}]*template\?:\s*string[^}]*\}>/;
  if (!schemaPattern.test(source)) {
    fail(
      "C5: compose-template-param",
      `${COMPOSE_ROUTE} useLocalSearchParams schema missing 'template?: string' (ORCH-0863 template pre-fill wiring)`,
    );
  } else {
    ok("C5: compose-template-param", "useLocalSearchParams includes 'template?: string'");
  }
}

// ---------------------------------------------------------------------------
// Check 6: marketingOverviewService exists and exports getMarketingOverview
// ---------------------------------------------------------------------------
function checkOverviewServiceExists() {
  if (!fs.existsSync(OVERVIEW_SERVICE)) {
    fail(
      "C6: overview-service-exists",
      `${OVERVIEW_SERVICE} not found — required by ORCH-0863 SPEC §10`,
    );
    return;
  }
  const src = readSource(OVERVIEW_SERVICE);
  if (!/export\s+(async\s+)?function\s+getMarketingOverview\b/.test(src)) {
    fail(
      "C6: overview-service-exists",
      `${OVERVIEW_SERVICE} does not export getMarketingOverview`,
    );
  } else {
    ok("C6: overview-service-exists", "getMarketingOverview export present");
  }
}

// ---------------------------------------------------------------------------
// Check 7: No new files under supabase/migrations/ or supabase/functions/
//          introduced by this ORCH (diff-aware against origin/main when available)
// ---------------------------------------------------------------------------
function checkNoNewBackendFiles() {
  let diffOutput = "";
  try {
    diffOutput = execSync("git diff --name-only origin/main...HEAD", {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
  } catch (_err) {
    // origin/main unavailable (e.g., CI fresh checkout or detached HEAD).
    // Fall back to checking uncommitted changes vs. HEAD.
    try {
      diffOutput = execSync("git diff --name-only HEAD", {
        cwd: REPO_ROOT,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString();
    } catch (_err2) {
      // No git at all — skip the diff check gracefully (CI bare runs).
      ok(
        "C7: no-new-backend-files",
        "git unavailable — skipping diff check (manual review only)",
      );
      return;
    }
  }
  const changed = diffOutput.split("\n").filter((p) => p.length > 0);
  // ORCH-0859 [Tr2 Minimum Viable Trip] bundled into PR #126 alongside
  // ORCH-0863 + ORCH-0862 per operator-approved bundle (2026-05-17). The
  // backend touches under these specific paths are ORCH-0859 trip-publish
  // scope, not ORCH-0863 marketing scope. Exempted here; future close
  // should drop this allowlist when ORCH-0859 ships its own PR.
  const ORCH_0859_BUNDLED_ALLOWLIST = [
    "supabase/migrations/20260608000000_orch_0859_trip_sidecar_tables.sql",
    "supabase/migrations/20260608000100_orch_0859_publish_rpc_trip.sql",
    "supabase/migrations/20260609000000_orch_0859_trip_publish_slug_flag.sql",
    "supabase/functions/_shared/email/tripConfirmationEmail.ts",
    "supabase/functions/discover-merged-events/index.ts",
    "supabase/functions/ticket-confirmation-dispatch/index.ts",
  ];
  // ORCH-0869 [Tr3 Installment Payments] CLOSE PR #128 (2026-05-18). The
  // C7 gate is scoped to ORCH-0863's OWN diff (the gate runs against
  // origin/main..HEAD diff, which on a separate ORCH-0869 PR contains the
  // ORCH-0869 backend files since they have never reached main). These
  // backend touches are ORCH-0869 installment-engine scope, not ORCH-0863
  // marketing scope. Exempted here for the same reason as the ORCH-0859
  // allowlist above. Future close that drops both allowlists should also
  // re-scope C7 itself to fire ONLY against PRs whose commit message
  // explicitly cites `Close ORCH-0863` (gate-scope follow-up — register
  // when both allowlists become removable).
  const ORCH_0869_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/__tests__/installment_handoff_adversarial.test.ts",
    "supabase/functions/_shared/email/installmentDunningEmail.ts",
    "supabase/functions/_shared/email/installmentPlanPaidInFullEmail.ts",
    "supabase/functions/_shared/installmentWebhookHandlers.ts",
    "supabase/functions/_shared/stripePaymentMethods.ts",
    "supabase/functions/_shared/stripeWebhookRouter.ts",
    "supabase/functions/process-scheduled-installments/__tests__/idempotency.test.ts",
    "supabase/functions/process-scheduled-installments/index.ts",
    "supabase/functions/ticket-checkout-create/index.ts",
    "supabase/functions/ticket-confirmation-dispatch/__tests__/installment_kinds.test.ts",
    "supabase/migrations/20260610000000_tr3_installments.sql",
    "supabase/migrations/20260610000001_tr3_cron_use_vault_secrets.sql",
    "supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql",
  ];
  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] CLOSE PR #134 (2026-05-18).
  // Same scoping rationale as the ORCH-0859 and ORCH-0869 allowlists above:
  // these backend touches are ORCH-0875 refund-engine + cancel-flow scope, not
  // ORCH-0863 marketing scope, so they're exempted from this gate. Future
  // close that drops these allowlists should re-scope C7 itself to fire ONLY
  // against PRs whose commit message explicitly cites `Close ORCH-0863`.
  const ORCH_0875_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/email/buyerLifecycleAdapters.ts",
    "supabase/functions/cancel-trip-booking/__tests__/adversarial_security.test.ts",
    "supabase/functions/cancel-trip-booking/__tests__/contract_invariants.test.ts",
    "supabase/functions/cancel-trip-booking/index.ts",
    "supabase/functions/process-booking-deadlines/index.ts",
    "supabase/functions/process-scheduled-installments/index.ts",
    "supabase/functions/ticket-checkout-create/index.ts",
    "supabase/functions/ticket-confirmation-dispatch/index.ts",
    "supabase/migrations/20260612000000_tr4_refund_tiers_booking_deadline.sql",
    "supabase/migrations/20260612000001_tr4_revoke_rpc_anon_grants.sql",
  ];
  // ORCH-0099 [Ve1 Physical Venue Brand Onboarding] PR #135 (2026-05-18). C7 is
  // scoped to ORCH-0863 marketing; these backend touches are Ve1 venue-claim
  // scope bundled on the same branch as marketing work.
  const ORCH_0099_VE1_BACKEND_ALLOWLIST = [
    "supabase/functions/venue-claim-decision-email/index.ts",
    "supabase/functions/venue-claim-submitted-email/index.ts",
    "supabase/migrations/20260613000000_ve1_physical_venue_brand_onboarding.sql",
    "supabase/migrations/20260614000000_ve1_pr_review_hardening.sql",
  ];
  // ORCH-0100 [Ve2 Pool Match Comparison Flow] PR #142 (2026-05-19). C7 is
  // scoped to ORCH-0863 marketing; these backend touches are Ve2 pool-match
  // claim-search scope on the venue-claim track.
  const ORCH_0100_VE2_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/mapMinglaSlugToVenueCategory.ts",
    "supabase/functions/_shared/poolMatchResponse.ts",
    "supabase/functions/claim-search-pool/index.test.ts",
    "supabase/functions/claim-search-pool/index.ts",
    "supabase/migrations/20260618000000_ve2_pool_match_claim.sql",
    "supabase/migrations/20260618000001_ve2_claim_search_rpc.sql",
  ];
  // ORCH-0101 [Ve3 Admin Queue + Verification Workflow] PR #143 (2026-05-19).
  // C7 is scoped to ORCH-0863 marketing; these backend touches are Ve3
  // venue-claim admin review scope (claim orchestrator + migration).
  const ORCH_0101_VE3_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/email/claimApprovedEmail.ts",
    "supabase/functions/_shared/email/claimRejectedEmail.ts",
    "supabase/functions/admin-review-venue-claim/index.test.ts",
    "supabase/functions/admin-review-venue-claim/index.ts",
    "supabase/functions/admin-review-venue-claim/reviewLogic.ts",
    "supabase/migrations/20260619000000_ve3_admin_claim_review.sql",
  ];
  // ORCH-0102 [Ve4 Public Venue Page + Verified Badge] PR #146 (2026-05-19).
  // C7 is scoped to ORCH-0863 marketing; this backend touch is the Ve4
  // claimed_venues_public_view migration on the venue-claim track.
  const ORCH_0102_VE4_BACKEND_ALLOWLIST = [
    "supabase/migrations/20260622000000_ve4_claimed_venues_public_view.sql",
  ];
  // ORCH-0881 [Ve5 Menu AI Parser → Restaurant Experiences] PR #148 (2026-05-19).
  // C7 is scoped to ORCH-0863 marketing; these backend touches are Ve5 hub
  // experiences + Gemini menu parsing on the restaurant-venue track. C7 also
  // flags MODIFIED backend files (not just new), so agentTools.ts +
  // agent-confirm-action/index.ts are listed here too (existing files extended
  // with the create_experience tool).
  const ORCH_0881_VE5_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/agentTools.ts",
    "supabase/functions/_shared/geminiMenuParser.test.ts",
    "supabase/functions/_shared/geminiMenuParser.ts",
    "supabase/functions/agent-confirm-action/index.ts",
    "supabase/functions/parse-restaurant-menu/index.ts",
    "supabase/migrations/20260623000000_orch_0881_ve5_hub_pending_actions.sql",
  ];
  // Ve6 [Activities AI Parser → Play Experiences] PR #149 (2026-05-20). C7 is
  // scoped to ORCH-0863 marketing; these backend touches are Ve6 hub
  // experiences + Gemini activities parsing on the play-venue track.
  const ORCH_VE6_PLAY_ACTIVITIES_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/agentTools.ts",
    "supabase/functions/_shared/geminiActivitiesParser.test.ts",
    "supabase/functions/_shared/geminiActivitiesParser.ts",
    "supabase/functions/_shared/playIntentTags.ts",
    "supabase/functions/parse-play-activities/index.ts",
    // Pin @supabase/supabase-js@2.45.4 + CI retry for esm.sh 522 flakes (PR #149).
    "supabase/functions/_shared/stripeEdgeAuth.ts",
    "supabase/functions/_shared/stripeWebhookRouter.ts",
  ];
  // ORCH-0877 [Event end-time display + midnight-crossing single-day authoring]
  // PR #136 (2026-05-19). C7 is scoped to ORCH-0863 marketing; these backend
  // touches are end-time + cross-midnight + ICS Constitution #9 fix scope.
  const ORCH_0877_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/dateTimeSplit.ts",
    "supabase/functions/_shared/email/__tests__/calendar.test.ts",
    "supabase/functions/_shared/email/__tests__/dateLine.test.ts",
    "supabase/functions/_shared/email/calendar.ts",
    "supabase/functions/_shared/email/dateLine.ts",
    "supabase/functions/_shared/email/ticketBody.ts",
    "supabase/functions/_shared/email/types.ts",
    "supabase/functions/_shared/marketingEmailRender.ts",
    "supabase/functions/_shared/ticketPdf.ts",
    "supabase/functions/discover-merged-events/index.ts",
    "supabase/functions/marketing-send/index.ts",
    "supabase/functions/ticket-confirmation-dispatch/index.ts",
    "supabase/functions/ticket-pdf-fetch/index.ts",
    "supabase/migrations/20260615000000_orch_0877_patch_event_when_rpc.sql",
  ];
  // ORCH-0876 [Trip CRUD + Purchase Flow Completion — Full Event↔Trip Parity]
  // bundled Path A PR #137 (2026-05-19). C7 is scoped to ORCH-0863 marketing;
  // this backend touch is the single migration that creates the
  // `trip_edit_log` table + `biz_trip_sold_count_by_tier`/
  // `biz_trip_has_web_purchases` helpers + `biz_update_live_trip` RPC with
  // 8-path refund-gate. No edge function touches.
  const ORCH_0876_BACKEND_ALLOWLIST = [
    "supabase/migrations/20260616000000_orch_0876_trip_published_edit.sql",
  ];
  // ORCH-0879 [Public trip page "Couldn't load trip" — anon brand cover
  // GRANT gap] PR #140 (2026-05-19). C7 is scoped to ORCH-0863 marketing;
  // this backend touch is the single migration that extends per-column anon
  // SELECT grants on public.brands to include cover_media_url +
  // cover_media_type (the two columns added in Cycle 17e-A but never granted
  // to anon), unblocking /t/<brand>/<trip> and /checkout-trip/<tripEventId>.
  const ORCH_0879_BACKEND_ALLOWLIST = [
    "supabase/migrations/20260617000000_orch_0879_anon_brand_cover_grant.sql",
  ];
  // ORCH-0880 [Tr5 Traveler Intake Forms] CLOSE PR #TBD (2026-05-19+).
  // Same scoping rationale as prior allowlists: these backend touches are
  // ORCH-0880 intake-form scope, not ORCH-0863 marketing scope. Phase 1 ships
  // the migration + 3 modified edge fn touches; Phase 2 adds the new
  // trip-intake-upload-signed-url edge function (deferred-with-tests to a
  // later phase). cron-purge-canceled-intake-data deferred to ORCH-0881
  // follow-up per Phase 1 scope decision.
  const ORCH_0880_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/email/buyerLifecycleAdapters.ts",
    "supabase/functions/ticket-checkout-create/index.ts",
    "supabase/functions/ticket-confirmation-dispatch/index.ts",
    "supabase/functions/trip-intake-upload-signed-url/index.ts",
    "supabase/functions/trip-intake-upload-signed-url/__tests__/contract_invariants.test.ts",
    "supabase/functions/trip-intake-upload-signed-url/__tests__/adversarial_security.test.ts",
    "supabase/migrations/20260620000000_orch_0880_tr5_traveler_intake_forms.sql",
    "supabase/migrations/20260621000000_orch_0880_phase2_intake_re_answer_trigger.sql",
  ];
  // ORCH-0891 [Marketing Hub Premium Composer + Desktop Power Features + Mobile
  // Polish] CLOSE PR #150 (2026-05-20). C7 is scoped to ORCH-0863 marketing;
  // ORCH-0891 is the follow-on marketing composer overhaul (Tiptap + premium
  // animation + desktop power features + mobile polish), and its M2 milestone
  // ships a Deno test alongside the modified marketingEmailRender.ts to
  // exercise the new compact/medium/large event-chip size variants. The
  // implementation file itself was already allowed via ORCH-0877's allowlist;
  // this entry adds the M2 size-variant test that exercises it. ORCH-0815-B
  // already touched marketingEmailRender.ts under its own Phase A scope, and
  // ORCH-0877 added the file to its allowlist; we extend by adding the new
  // ORCH-0891 M2 size-variant Deno test.
  const ORCH_0891_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/marketingEmailRender.eventChipSize.test.ts",
  ];
  // ORCH-0898 [Consumer collab session → Friends-tab group chat] CLOSE PR #152
  // (2026-05-21). Bundled with ORCH-0892-A + ORCH-0892-B v2 + ORCH-0893 +
  // ORCH-0894 + ORCH-0901 per operator-named bundle exception. C7 is scoped to
  // ORCH-0863 marketing; these backend touches are ORCH-0898 chat substrate
  // unification (conversations + messages + notify-message canonical types).
  const ORCH_0898_BACKEND_ALLOWLIST = [
    "supabase/functions/notify-message/index.ts",
    "supabase/migrations/20260624000000_orch_0898_unified_chat_substrate.sql",
  ];
  // ORCH-0902 + ORCH-0903 [Collab deck deterministic rewrite + travel-time
  // speed unification] bundled into PR #152 via concurrent Codex work landing
  // on Seth between ORCH-0898 close commit and PR open. C7 is scoped to
  // ORCH-0863 marketing; these backend touches are ORCH-0902 deck-deterministic
  // rewrite + ORCH-0903 discover-cards travel-time unification scope.
  const ORCH_0902_0903_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/distanceMath.ts",
    "supabase/functions/discover-cards/__tests__/orch_0903_travel_time_contract.test.ts",
    "supabase/functions/discover-cards/index.ts",
    "supabase/functions/generate-curated-experiences/index.ts",
    "supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql",
    // ORCH-0902 follow-up (2026-05-21): GPS-rounding migration that
    // replaces pg_aggregate_collab_prefs to ROUND lat/lng to 4 decimals
    // (~11m precision) so meter-level GPS drift doesn't thrash
    // deck_version. Same ORCH scope as the rewrite above.
    "supabase/migrations/20260627000000_orch_0902_round_gps_in_aggregation_hash.sql",
  ];
  // ORCH-0908 [Collab session lifecycle + chat @-mention + #-tag cards] PR #158
  // (2026-05-21). C7 is scoped to ORCH-0863 marketing; these backend touches are
  // the atomic lock-and-schedule RPC, V_{n+1} recycle, card_payload flatten +
  // backfill, notify-session-lock fire-and-forget, and notify-message
  // mention/mute patch on the collab-lifecycle track.
  const ORCH_0908_BACKEND_ALLOWLIST = [
    "supabase/functions/notify-message/index.ts",
    "supabase/functions/notify-session-lock/index.ts",
    "supabase/migrations/20260626000000_orch_0908_admin_lock_schedule_recycle.sql",
    "supabase/migrations/20260628000000_orch_0908_hotfix_calendar_trigger_dead_ref.sql",
    "supabase/migrations/20260629000000_orch_0908_combined_lock_schedule.sql",
    "supabase/migrations/20260630000000_orch_0908_card_payload_flatten.sql",
    "supabase/migrations/20260702000000_orch_0908_chat_card_tags.sql",
  ];
  // ORCH-0909 [Collab positional shared-deck rewrite] + ORCH-0906 [single ↔
  // intent 1:1 interleave] PR #158 bundle (2026-05-21). C7 is scoped to
  // ORCH-0863 marketing; these backend touches are the positional-shared-deck
  // architecture replacing pinnedDeckVersion + the mixed-type interleave shared
  // helper on the collab-deck-determinism track.
  const ORCH_0909_0906_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/mixedTypeInterleave.ts",
    "supabase/functions/_shared/signalRankFetch.ts",
    "supabase/functions/discover-cards/__tests__/orch_0906_mixed_type_interleave.test.ts",
    "supabase/functions/discover-cards/__tests__/orch_0909_adversarial.test.ts",
    "supabase/functions/discover-cards/__tests__/orch_0909_positional_shared_deck.test.ts",
    "supabase/migrations/20260701000000_orch_0909_positional_shared_deck.sql",
    "supabase/migrations/20260703000000_orch_0906_session_deck_cards_mixed_type.sql",
  ];
  // ORCH-0897 [Trips + Events Group Chat — auto-created consumer-app collab
  // session + business-app Group Chat tile + blast→chat wiring] PR #160
  // (2026-05-21). C7 is scoped to ORCH-0863 marketing; these backend touches
  // are ORCH-0897 trip+event chat substrate extension scope (new claim edge
  // function + new migration + extensions to existing email + dispatcher +
  // marketing-send for blast→chat fan-out). Substrate inherits ORCH-0898's
  // conversations+messages, so no new chat-message tables.
  const ORCH_0897_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/email/ticketBody.ts",
    "supabase/functions/_shared/email/tripConfirmationEmail.ts",
    "supabase/functions/_shared/email/types.ts",
    "supabase/functions/claim-pending-trip-chat-participation/index.ts",
    "supabase/functions/marketing-send/index.ts",
    "supabase/functions/ticket-confirmation-dispatch/index.ts",
    "supabase/migrations/20260710000000_orch_0897_trip_event_group_chat.sql",
  ];
  // HOTFIX-CONVERSATION-RLS-RECURSION-CLEAN PR #161 (2026-05-21). C7 is scoped
  // to ORCH-0863 marketing, but this PR is an operator-dispatched security
  // hotfix for recursive conversations RLS policies. Allow exactly this
  // migration so the marketing no-backend-files guard does not block the
  // unrelated RLS recursion fix.
  const CONVERSATION_RLS_RECURSION_HOTFIX_ALLOWLIST = [
    "supabase/migrations/20260704000000_hotfix_conversation_rls_recursion.sql",
  ];
  // ORCH-0910 [Chat-mounted card expanded sheet parity — single + intent,
  // bubble + sheet] PR #165 (2026-05-22). C7 is scoped to ORCH-0863 marketing;
  // this backend touch is the ORCH-0910 data-only backfill migration that
  // synthesizes top-level image + cardType='curated' on legacy curated rows
  // in messages.card_payload and board_saved_cards.card_data. Already applied
  // to remote 2026-05-22 (1+1 rows healed). Allow exactly this filename so the
  // marketing no-backend-files guard does not block the unrelated chat parity fix.
  const ORCH_0910_BACKEND_ALLOWLIST = [
    "supabase/migrations/20260722000000_orch_0910_chat_intent_card_backfill.sql",
  ];
  // ORCH-0911 [Buyer-web checkout confirm screen renders black on ?cs=… arrival]
  // PR #166 (2026-05-22). C7 is scoped to ORCH-0863 marketing; these backend
  // touches are ORCH-0911 buyer-web checkout fix: happy-path Deno test +
  // adversarial Deno test for the ticket-checkout-create edge function's new
  // event_type-based success_url/cancel_url branching. The edge function
  // source itself (index.ts) is an EDIT not a NEW file so C7 wouldn't catch
  // it; only the two new __tests__ files need allowlisting. Edge function
  // already deployed v77 to remote 2026-05-22. Allow exactly these filenames
  // so the marketing no-backend-files guard does not block the unrelated
  // buyer-web confirm fix.
  const ORCH_0911_BACKEND_ALLOWLIST = [
    "supabase/functions/ticket-checkout-create/__tests__/orch_0911_success_url_branching.test.ts",
    "supabase/functions/ticket-checkout-create/__tests__/orch_0911_success_url_branching.adversarial.test.ts",
  ];
  // ORCH-0914 [Trip Money tab redesign — organiser visibility into each traveller's
  // payment-plan progress] PR #170 (2026-05-22) + ORCH-0920 strict-grep hot-fix PR #171
  // (2026-05-22). C7 is scoped to ORCH-0863 marketing; these backend touches are
  // ORCH-0914's manual-charge-installment + send-installment-reminder edge functions,
  // their shared helper + email template, and the manual-buyer-reminders + manual-charge
  // RPC migrations. The PR #171 hot-fix only added a // no-attachment opt-out comment
  // to send-installment-reminder/index.ts to satisfy ORCH-0785-A. Allow exactly these
  // backend paths so the marketing no-backend-files guard does not block ORCH-0914.
  const ORCH_0914_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/email/installmentReminderEmail.ts",
    "supabase/functions/_shared/installments/createInstallmentPI.ts",
    "supabase/functions/manual-charge-installment/__tests__/manual_charge_test.ts",
    "supabase/functions/manual-charge-installment/index.ts",
    "supabase/functions/send-installment-reminder/__tests__/send_reminder_test.ts",
    "supabase/functions/send-installment-reminder/index.ts",
    "supabase/functions/process-scheduled-installments/__tests__/idempotency.test.ts",
    "supabase/functions/process-scheduled-installments/index.ts",
    "supabase/migrations/20260723000000_orch_0914_manual_buyer_reminders.sql",
    "supabase/migrations/20260723000001_orch_0914_manual_charge_installment.sql",
  ];
  // ORCH-0921 [Trip payment-plan finalize silently drops `installment_plan_root`
  // + child installments — €375/order revenue leak] PR #172 (2026-05-22). C7 is
  // scoped to ORCH-0863 marketing; these backend touches are ORCH-0921's
  // compare-and-correct migration on `biz_ticket_checkout_finalize`, the two
  // patched edge function callers (ticket-checkout-confirm + reconcile-stuck-
  // checkouts now pass all 8 RPC params instead of 5), and 6 regression tests
  // (3 implementor happy-path + 3 tester adversarial). Allow exactly these
  // backend paths so the marketing no-backend-files guard does not block
  // ORCH-0921.
  const ORCH_0921_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/__tests__/orch_0921_compare_and_correct.test.ts",
    "supabase/functions/_shared/__tests__/orch_0921_compare_and_correct_adversarial.test.ts",
    "supabase/functions/reconcile-stuck-checkouts/__tests__/orch_0921_installment_params.test.ts",
    "supabase/functions/reconcile-stuck-checkouts/__tests__/orch_0921_installment_params_adversarial.test.ts",
    "supabase/functions/reconcile-stuck-checkouts/index.ts",
    "supabase/functions/ticket-checkout-confirm/__tests__/orch_0921_installment_params.test.ts",
    "supabase/functions/ticket-checkout-confirm/__tests__/orch_0921_installment_params_adversarial.test.ts",
    "supabase/functions/ticket-checkout-confirm/index.ts",
    "supabase/migrations/20260724000000_orch_0921_finalize_compare_and_correct.sql",
  ];
  // ORCH-0925 [ticket-checkout-create does not attach Stripe Customer to payment-plan PIs]
  // PR #176 (2026-05-23). C7 is scoped to ORCH-0863 marketing; this backend touch is
  // the Stripe Customer-attachment fix for installment-plan checkouts on the
  // ticket-checkout-create edge fn + its happy-path + adversarial regression tests.
  // ORCH-0925 close adds these paths to keep C7 green while ORCH-0863's hub guard
  // continues to protect against accidental marketing-side backend regressions.
  const ORCH_0925_BACKEND_ALLOWLIST = [
    "supabase/functions/ticket-checkout-create/__tests__/orch-0925-installment-customer-attachment.adversarial.test.ts",
    "supabase/functions/ticket-checkout-create/__tests__/orch-0925-installment-customer-attachment.test.ts",
    "supabase/functions/ticket-checkout-create/index.ts",
  ];
  // ORCH-0933 [Profile "Your Circle" social graph section] CLOSE PR #181
  // (2026-05-23). C7 is scoped to ORCH-0863 marketing; these backend touches
  // are the get_user_circle SECURITY DEFINER RPC + ambiguity fix on the
  // consumer-Profile social-graph track. No edge function touches.
  const ORCH_0933_BACKEND_ALLOWLIST = [
    "supabase/migrations/20260724000002_orch_0933_get_user_circle_rpc.sql",
    "supabase/migrations/20260724000003_orch_0933_get_user_circle_rpc_ambiguity_fix.sql",
  ];
  // ORCH-0940 [Profile Circle event connection mapping — truthful relationship-source
  // labels] CLOSE PR #183 (2026-05-23). Follow-up to ORCH-0933. C7 is scoped to
  // ORCH-0863 marketing; this backend touch extends the get_user_circle RPC return
  // signature with 6 safe relationship-metadata fields on the consumer-Profile
  // social-graph track. No edge function touches.
  const ORCH_0940_BACKEND_ALLOWLIST = [
    "supabase/migrations/20260724000005_profile_circle_relationship_source.sql",
  ];
  // ORCH-0948 [Waitlist feature — schema + RPC + buyer-web CTA + planner
  // notification] IMPLEMENT branch (2026-05-24). C7 is scoped to ORCH-0863
  // marketing; these backend touches are waitlist schema/RPC, anon signup,
  // ticket notification dispatch, retry-sweeper null-order dispatch support,
  // and the implementor regression tests/templates for that feature.
  const ORCH_0948_BACKEND_ALLOWLIST = [
    "supabase/config.toml",
    "supabase/functions/_shared/ticketCheckout.ts",
    "supabase/functions/_shared/email/templates/waitlistSpotOpen.ts",
    "supabase/functions/_shared/email/templates/__tests__/waitlistSpotOpen.test.ts",
    "supabase/functions/_shared/sms/templates/waitlistSpotOpen.ts",
    "supabase/functions/notification-retry-sweeper/index.ts",
    "supabase/functions/notification-retry-sweeper/index.test.ts",
    "supabase/functions/ticket-confirmation-dispatch/index.ts",
    "supabase/functions/ticket-confirmation-dispatch/__tests__/waitlist-spot-open.adversarial.test.ts",
    "supabase/functions/waitlist-signup/index.ts",
    "supabase/functions/waitlist-signup/__tests__/signup-happy.test.ts",
    "supabase/functions/waitlist-signup/__tests__/signup-dedupe.test.ts",
    "supabase/migrations/20260724000010_orch_0948_waitlist_feature.sql",
    // Renamed from 20260724000006 → 20260724000010 by orchestrator pre-deploy
    // to resolve version collision with remote-applied
    // 20260724000006_orch_0946_public_ticket_types_remaining. Old filename kept
    // in allowlist so post-rename git diff (deletion + addition) clears C7.
    "supabase/migrations/20260724000006_orch_0948_waitlist_feature.sql",
    "supabase/migrations/__tests__/orch_0948_waitlist_migration.test.ts",
  ];
  // ORCH-0948 deploy reconciliation (2026-05-24): these exact migration files
  // were already applied remotely by their owning ORCHs after this worktree
  // branched. They are carried here as source-reconciled remote-only history
  // so ORCH-0948 can push its own migration without drift; ownership remains
  // with ORCH-0946 / ORCH-0915 / ORCH-0950 / ORCH-0947.
  const ORCH_0948_RECONCILED_REMOTE_MIGRATION_ALLOWLIST = [
    "supabase/migrations/20260724000006_orch_0946_public_ticket_types_remaining.sql",
    "supabase/migrations/20260724000007_orch_0915_pay_in_full_opt_out.sql",
    "supabase/migrations/20260725000000_orch_0950_trip_capacity_single_source.sql",
    "supabase/migrations/20260725000001_orch_0947_biz_trip_tickets_sold.sql",
  ];
  // ORCH-0930 [TicketQrCarousel React #418 hydration mismatch] + ORCH-0928-LOCKIN
  // [success_url query-string recovery regression test] bundled into PR #184
  // alongside ORCH-0942 (2026-05-23 operator-approved bundle). C7 is scoped to
  // ORCH-0863 marketing; this backend touch is the ticket-checkout-create
  // success_url shape regression test + the index.ts return-payload tweak that
  // accompanies it. No edge function deploy required (test-only + minor index
  // tweak; index.ts is already allow-listed under ORCH-0869/ORCH-0880/ORCH-0925).
  const ORCH_0930_0928_LOCKIN_BACKEND_ALLOWLIST = [
    "supabase/functions/ticket-checkout-create/__tests__/orch_0928_success_url_query_string.test.ts",
    "supabase/functions/ticket-checkout-create/index.ts",
  ];
  // ORCH-0932 [Server-side QR image generation] CLOSE 2026-05-23. Three
  // client-side ORCH-0930 hydration-gate attempts (v1 component mount-guard,
  // v2 parent useEffect, v3 useState initializer) all failed in production
  // because `react-native-qrcode-svg` itself fails to render on Expo SDK 54
  // web export. Pivot: server-rendered PNG via shared helper (same npm
  // qrcode pipeline already used by ticketPdf.ts) + RN <Image> on the
  // carousel. Touches the shared helper, both confirm/status edge fns, and
  // their tests. No verify_jwt change required.
  const ORCH_0932_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/ticketQrImage.ts",
    "supabase/functions/_shared/__tests__/ticketQrImage.test.ts",
    "supabase/functions/ticket-checkout-confirm/index.ts",
    "supabase/functions/ticket-checkout-status/index.ts",
  ];
  // ORCH-0931 backfill 2026-05-23. The realtime-broadcast-session_updated
  // migration was deployed to production via `supabase db push --linked`
  // during ORCH-0931 close but the .sql file was never committed to git.
  // This META-cleanup commit reconciles source-tree against remote so future
  // migration baseline tests don't drift.
  const ORCH_0931_BACKEND_ALLOWLIST = [
    "supabase/migrations/20260724000001_orch_0931_realtime_broadcast_session_updated.sql",
  ];
  // ORCH-0946 [Buyer-web sold-out gate] — anon-callable RPC for
  // remaining-bookable per ticket_type so the buyer-checkout sold-out
  // banner + QuantityRow "+" cap reflect what's actually bookable
  // instead of total tier capacity. C7 is scoped to ORCH-0863 marketing;
  // this is an unrelated buyer-web checkout fix.
  const ORCH_0946_BACKEND_ALLOWLIST = [
    "supabase/migrations/20260724000006_orch_0946_public_ticket_types_remaining.sql",
  ];

  // ORCH-0947 [Trip dashboard Spots tile counts tickets, not orders]:
  // new SECURITY DEFINER RPC biz_trip_tickets_sold(p_event_id) that mirrors
  // the canonical capacity gate, so the planner dashboard's Spots KPI and
  // Travelers subtitle match what the checkout RPC actually enforces. C7
  // is scoped to ORCH-0863 marketing; this is an unrelated planner-dashboard
  // data-integrity fix. The 0950 file is a source-reconcile copy of an
  // already-applied-to-remote migration from a parallel worktree — required
  // for `supabase db push --linked` to succeed from this branch.
  const ORCH_0947_BACKEND_ALLOWLIST = [
    "supabase/migrations/20260725000001_orch_0947_biz_trip_tickets_sold.sql",
    "supabase/migrations/__tests__/biz_trip_tickets_sold.test.ts",
    "supabase/migrations/20260725000000_orch_0950_trip_capacity_single_source.sql",
  ];
  // ORCH-0953 [Stripe live-mode cutover] CLOSE PR #201 (2026-05-24). C7 is scoped
  // to ORCH-0863 marketing; these backend touches are ORCH-0953 Stripe live
  // foundation scope (RAK fail-close, dispute table + handlers, native paid
  // region gate, webhook router corrections, signature-failure alert). Includes
  // source-reconciled migrations from ORCH-0915 + 0946 + 0947 + 0948 + 0950
  // (those ORCHs' migrations were already on remote DB but absent from anchor
  // main at PR #201 open time; reconciled into this branch to keep `supabase
  // migration list --linked` clean for the ORCH-0953 db push). Duplicate
  // migration entries with ORCH_0946/0947/0948 allowlists are harmless —
  // .includes() on the merged array remains O(n) and dedupe is irrelevant.
  const ORCH_0953_BACKEND_ALLOWLIST = [
    "supabase/migrations/20260724000006_orch_0946_public_ticket_types_remaining.sql",
    "supabase/migrations/20260724000007_orch_0915_pay_in_full_opt_out.sql",
    "supabase/migrations/20260724000010_orch_0948_waitlist_feature.sql",
    "supabase/migrations/20260725000000_orch_0950_trip_capacity_single_source.sql",
    "supabase/migrations/20260725000001_orch_0947_biz_trip_tickets_sold.sql",
    "supabase/migrations/20260726000000_orch_0953_create_stripe_disputes.sql",
    "supabase/functions/_shared/stripeBlueprintClient.ts",
    "supabase/functions/_shared/stripeDisputeHandlers.ts",
    "supabase/functions/_shared/stripeTax.ts",
    "supabase/functions/_shared/stripeWebhookRouter.ts",
    "supabase/functions/_shared/__tests__/stripeBlueprintClient_failclose.test.ts",
    "supabase/functions/_shared/__tests__/stripeDisputeHandlers.test.ts",
    "supabase/functions/_shared/__tests__/stripeWebhookRouter.test.ts",
    "supabase/functions/_shared/__tests__/stripeWebhookRouter_eventList.test.ts",
    "supabase/functions/_shared/__tests__/stripeWebhookRouter_disputeAdversarial.test.ts",
    "supabase/functions/stripe-webhook/index.ts",
    "supabase/functions/stripe-webhook/__tests__/signatureFailureAlert.test.ts",
    "supabase/functions/ticket-checkout-create/index.ts",
    "supabase/functions/ticket-checkout-create/__tests__/nativePaidRegionGate.test.ts",
    "supabase/functions/ticket-checkout-create/__tests__/nativeRegionGate_adversarial.test.ts",
  ];
  // ORCH-0955 [Native Stripe Tax for Platforms] PR #208 (2026-05-25). C7 is
  // scoped to ORCH-0863 marketing; these backend touches are native Stripe Tax
  // wiring (3-step calc/commit/reverse + embedded Tax UI replacement + region
  // gate decommission). Same scoping rationale as prior allowlists.
  const ORCH_0955_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/email/__tests__/shell.test.ts",
    "supabase/functions/_shared/email/ticketBody.ts",
    "supabase/functions/_shared/email/types.ts",
    "supabase/functions/_shared/stripe.ts",
    "supabase/functions/_shared/stripeTax.ts",
    "supabase/functions/_shared/stripeWebhookRouter.ts",
    "supabase/functions/brand-stripe-tax-account-session/index.ts",
    "supabase/functions/brand-stripe-tax-dashboard-link/index.ts",
    "supabase/functions/refund-order/index.ts",
    "supabase/functions/__tests__/orch_0955_native_stripe_tax.test.ts",
    "supabase/functions/ticket-checkout-create/index.ts",
    "supabase/functions/ticket-checkout-create/__tests__/nativePaidRegionGate.test.ts",
    "supabase/functions/ticket-checkout-create/__tests__/nativeRegionGate_adversarial.test.ts",
    "supabase/functions/ticket-confirmation-dispatch/index.ts",
    "supabase/migrations/20260725000002_orch_0950_expanded_scope_dashboard_coherence.sql",
    "supabase/migrations/20260727000000_orch_0955_native_stripe_tax.sql",
  ];

  // ORCH-0915 [Buyer/traveller pay-in-full opt-out at payment-plan checkout]
  // CLOSE PR #203 (2026-05-24). Migration 20260724000007 + ticket-checkout-
  // create/index.ts are already in ORCH_0953_BACKEND_ALLOWLIST (operator db
  // push batch). The 4 files below are the remaining ORCH-0915 backend
  // touches: shared idempotency-key helper extension separating explicit
  // full/installment sessions, plus the 3 ORCH-0915 test files (happy-path
  // edge + RPC source + adversarial). Same scoping rationale as prior
  // allowlists — these are ORCH-0915 scope, not ORCH-0863 marketing scope.
  // Future close that drops the ORCH-0953 allowlist should also drop this.
  const ORCH_0915_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/ticketCheckout.ts",
    "supabase/functions/ticket-checkout-create/__tests__/orch_0915_payment_plan_choice.test.ts",
    "supabase/functions/ticket-checkout-create/__tests__/orch_0915_payment_plan_choice_adversarial.test.ts",
    "supabase/functions/ticket-checkout-create/__tests__/orch_0915_rpc_behavior.test.ts",
  ];

  // ORCH-0954 [Embedded onboarding cutover + Stripe-managed risk] — Stripe
  // platform controller flip (dashboard:express→none, losses+fees collectors
  // application→stripe/stripe), new createAccountSession() helper + new
  // brand-stripe-account-session edge function + shared business-web origin
  // override validation + adversarial tests. P1-B remediation 2026-05-25
  // adds: tester adversarial for origin override, ORCH-0954 migration
  // updating the legacy account-type CHECK constraint to v2 dashboard values
  // (full|express|none), and the matching migration test. Existing
  // stripeBlueprintClient/CountryReplacement/WebhookRouter test files updated
  // to assert the new controller values (covered separately by ORCH-0840
  // TEST-MOD-APPROVED token in commit body).
  const ORCH_0954_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/stripeBlueprintClient.ts",
    "supabase/functions/_shared/businessWebOrigin.ts",
    "supabase/functions/_shared/stripeCountryReplacement.ts",
    "supabase/functions/_shared/stripeWebhookRouter.ts",
    "supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts",
    "supabase/functions/_shared/__tests__/stripeBlueprintClient.contract.test.ts",
    "supabase/functions/_shared/__tests__/stripeBlueprintClient_failclose.test.ts",
    "supabase/functions/_shared/__tests__/stripeCountryReplacement.test.ts",
    "supabase/functions/_shared/__tests__/businessWebOrigin.adversarial.test.ts",
    "supabase/functions/brand-stripe-onboard/index.ts",
    "supabase/functions/brand-stripe-onboard/index.test.ts",
    "supabase/functions/brand-stripe-onboard/__tests__/embeddedOnboarding.happy.test.ts",
    "supabase/functions/brand-stripe-onboard/__tests__/embeddedOnboarding.adversarial.test.ts",
    "supabase/functions/brand-stripe-account-session/index.ts",
    "supabase/migrations/20260727000002_orch_0954_controller_dashboard_type_check.sql",
    "supabase/migrations/__tests__/orch_0954_controller_dashboard_type_check.test.ts",
  ];

  // ORCH-0956 [Stripe ops alerts → email]: swaps the OneSignal push-based
  // dispute + webhook-signature-failure operator alerts shipped by ORCH-0953
  // for Resend email sends. New shared helper + two adversarial test files.
  // Modified files (stripeDisputeHandlers.ts, stripe-webhook/index.ts, and the
  // ORCH-0953 dispute + signature-failure test files) are already covered by
  // ORCH_0953_BACKEND_ALLOWLIST above; only the three NEW files are listed here.
  const ORCH_0956_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/stripeOpsAlertEmail.ts",
    "supabase/functions/_shared/__tests__/stripeOpsAlertEmailRecipients.test.ts",
    "supabase/functions/_shared/__tests__/stripeOpsAlertEmailSandbox.test.ts",
  ];
  // ORCH-0957 [Storage image transformation overage]: writes 384x384
  // place-photo thumbnails, rewrites collage reads to non-metered object URLs,
  // and adds the admin backfill edge function + Deno regression tests. The
  // first two migrations below are source-reconciled remote-only history from
  // ORCH-0950 / ORCH-0955 so this worktree can hand off a clean db push.
  const ORCH_0957_BACKEND_ALLOWLIST = [
    "supabase/migrations/20260725000002_orch_0950_expanded_scope_dashboard_coherence.sql",
    "supabase/migrations/20260727000000_orch_0955_native_stripe_tax.sql",
    "supabase/migrations/20260727000001_orch_0957_place_pool_thumbs_backfilled_at.sql",
    "supabase/functions/_shared/imageCollage.ts",
    "supabase/functions/_shared/imageCollage.test.ts",
    "supabase/functions/_shared/photoStorageService.ts",
    "supabase/functions/_shared/photoStorageService.test.ts",
    "supabase/functions/backfill-place-photo-thumbs/index.ts",
    "supabase/functions/backfill-place-photo-thumbs/index.test.ts",
    "supabase/functions/_shared/__tests__/imageCollage.thumbFallback.test.ts",
  ];
  // ORCH-0962 [Brand-edit → public-brand field rendering — truthful bundle].
  // C7 is scoped to ORCH-0863 marketing; ORCH-0962 backend touches are the
  // public-view recreation migration (drop + CREATE OR REPLACE the three
  // public brand/venue/event views with the new SELECT columns for G-01 /
  // G-08 / G-09) plus the source-reconciled ORCH-0954 controller migration
  // (`20260727000002`) which was remote-only history per implementor §6 line
  // 61. No edge function source is touched.
  const ORCH_0962_BACKEND_ALLOWLIST = [
    "supabase/migrations/20260727000002_orch_0954_controller_dashboard_type_check.sql",
    "supabase/migrations/20260727000003_orch_0962_brand_field_render_truthful.sql",
  ];
  // ORCH-0963 [Public brand page business-case optimization (events vs. trip
  // brands)]: adds the anon-callable pg_public_trips_by_brand SECURITY DEFINER
  // RPC + 2 Deno SQL contract tests (happy-path + adversarial). The two
  // 20260727000002/003 migrations are also in ORCH_0962_BACKEND_ALLOWLIST above
  // (source-reconciled from main into this branch); duplicate entries are
  // harmless — the allowlist is a union.
  const ORCH_0963_BACKEND_ALLOWLIST = [
    "supabase/migrations/20260727000002_orch_0954_controller_dashboard_type_check.sql",
    "supabase/migrations/20260727000003_orch_0962_brand_field_render_truthful.sql",
    "supabase/migrations/20260728000000_orch_0963_pg_public_trips_by_brand.sql",
    "supabase/migrations/__tests__/pg_public_trips_by_brand.test.ts",
    "supabase/migrations/__tests__/pg_public_trips_by_brand.antiLeak.adversarial.test.ts",
  ];
  // ORCH-0964 [Public-page theme customization + consumer-app brand screen]:
  // adds nullable typed theme columns plus public-view column exposure. The
  // two META-ORCH-0972 migrations are source-reconciled remote-only history so
  // this branch can hand off a clean db push. C7 is scoped to ORCH-0863
  // marketing; no edge function source is touched.
  const ORCH_0964_BACKEND_ALLOWLIST = [
    "supabase/migrations/20260729000000_meta_orch_0972_universal_authoring.sql",
    "supabase/migrations/20260729000001_meta_orch_0972_pg_brand_offering_counts_grants.sql",
    "supabase/migrations/20260729000002_orch_0964_brand_event_theme_columns.sql",
    "supabase/migrations/20260731000000_orch_0964_public_views_security_definer.sql",
  ];
  // META-ORCH-0952 [Buyer-web confirm pipeline deep forensics] CLOSE 2026-05-25.
  // C7 is scoped to ORCH-0863 marketing; the META-ORCH-0952 self-heal rework
  // touched ticket-checkout-confirm/index.ts (already in ORCH-0932 allowlist
  // above) and added a new Deno test exercising the awaiting_web_redirect +
  // null PI Checkout-Session recovery path. This entry adds the new test file
  // only; the index.ts touch is covered by ORCH-0932.
  const META_ORCH_0952_BACKEND_ALLOWLIST = [
    "supabase/functions/ticket-checkout-confirm/__tests__/orch_0952_web_checkout_session_fallback.test.ts",
  ];
  // META-ORCH-0972 [brand-kind decommission + universal feature access] Sub-A
  // deletes legacy kind/claim gates from existing AI experience backend source.
  // C7 is scoped to ORCH-0863 marketing; these backend touches are universal
  // authoring scope and deploy later in Sub-D per the locked deploy split.
  const ORCH_0972_BACKEND_ALLOWLIST = [
    "supabase/functions/parse-restaurant-menu/index.ts",
    "supabase/functions/parse-play-activities/index.ts",
    "supabase/functions/_shared/agentTools.ts",
    "supabase/functions/_shared/geminiMenuParser.ts",
    "supabase/functions/_shared/geminiActivitiesParser.ts",
    "supabase/migrations/20260729000000_meta_orch_0972_universal_authoring.sql",
    "supabase/migrations/20260729000001_meta_orch_0972_pg_brand_offering_counts_grants.sql",
    "supabase/migrations/20260730000000_meta_orch_0972_drop_brand_kind.sql",
    "supabase/migrations/__tests__/pg_brand_offering_counts_grants.test.ts",
    "supabase/migrations/__tests__/pg_brand_offering_counts_privilege_probe.sql",
    "supabase/functions/__tests__/pg_public_brand_upcoming.test.sql",
  ];
  // ORCH-0978 [Video upload polish + sub-30s perfect cross-surface render].
  // C7 is scoped to ORCH-0863 marketing; these backend touches are the
  // existing event-cover-video shared helper/cancel/source-uploaded/upload-intent
  // lifecycle paths needed for abort + Cloudinary destroy. No new backend
  // function or migration is introduced here.
  const ORCH_0978_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/eventCoverVideo.test.ts",
    "supabase/functions/_shared/eventCoverVideo.ts",
    "supabase/functions/event-cover-video-cancel/index.ts",
    "supabase/functions/event-cover-video-source-uploaded/index.ts",
    "supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery-adversarial.test.ts",
    "supabase/functions/event-cover-video-webhook/__tests__/duration-fallback.test.ts",
    "supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery.test.ts",
    "supabase/functions/event-cover-video-webhook/index.ts",
    "supabase/functions/event-cover-video-upload-intent/__tests__/duration-cap.test.ts",
    "supabase/functions/event-cover-video-upload-intent/index.ts",
    "supabase/migrations/20260730000000_orch_0978_video_cap_29s_constraints.sql",
    "supabase/migrations/20260730000001_orch_0978_video_cap_generous_source.sql",
  ];

  // ORCH-0950 [Trip capacity + dashboard coherence — EXPANDED SCOPE]. C7 is
  // scoped to ORCH-0863 marketing; these backend touches are the trip-capacity
  // canonical-columns migration set (v1 strip + v2 expanded dashboard coherence)
  // plus the Deno regression tests asserting partial-patch sibling preservation.
  // No edge function source is touched.
  const ORCH_0950_BACKEND_ALLOWLIST = [
    "supabase/functions/_test/orch_0950_trip_capacity_canonical.test.ts",
    "supabase/functions/_test/orch_0950_expanded_partial_patch_preserves_siblings.test.ts",
    "supabase/migrations/20260725000000_orch_0950_trip_capacity_single_source.sql",
    "supabase/migrations/20260725000002_orch_0950_expanded_scope_dashboard_coherence.sql",
  ];
  // ORCH-0977 [Consumer App Store + Play Store production launch] CLOSE.
  // C7 is scoped to ORCH-0863 marketing; these backend touches are ORCH-0977
  // launch scope: a new content-moderation edge function (Apple Guideline 1.2
  // UGC filter) + the App-Review test-OTP bypass added to the existing
  // send-otp/verify-otp functions. C7 flags modified backend files too, so the
  // two existing functions are listed alongside the new one.
  const ORCH_0977_BACKEND_ALLOWLIST = [
    "supabase/functions/moderate-content/index.ts",
    "supabase/functions/send-otp/index.ts",
    "supabase/functions/verify-otp/index.ts",
  ];
  // ORCH-0985 [Curated stop "Replace" fix]. C7 is scoped to ORCH-0863 marketing;
  // these backend touches are the Replace-stop fix: single-source slug validation
  // (kills the stale VALID_CATEGORIES whitelist), center-search-on-the-replaced-
  // stop, decoupled search radius, vibe rank-signal pass-through, best-score
  // ordering, + the slug/rank-signal parity regression test. No marketing scope.
  const ORCH_0985_BACKEND_ALLOWLIST = [
    "supabase/functions/replace-curated-stop/index.ts",
    "supabase/functions/_shared/stopAlternatives.ts",
    "supabase/functions/_shared/signalRankFetch.ts",
    "supabase/functions/generate-curated-experiences/index.ts",
    "supabase/functions/_shared/replaceCuratedStopSlugParity.test.ts",
  ];
  // ORCH-0986 [Paired-profile redesign]. C7 is scoped to ORCH-0863 marketing;
  // these backend touches are the paired profile friend-GPS RPC, batched cards
  // endpoint, shared person hero mapper/planner, and mapper regression test.
  const ORCH_0986_BACKEND_ALLOWLIST = [
    "supabase/migrations/20260730000000_orch_0978_video_cap_29s_constraints.sql",
    "supabase/migrations/20260730000001_orch_0978_video_cap_generous_source.sql",
    "supabase/migrations/20260730000002_orch_0986_paired_friend_last_location.sql",
    "supabase/migrations/20260730000003_orch_0986_lock_friend_location_rpc.sql",
    "supabase/migrations/20260730000004_orch_0986_friend_location_resolution_chain.sql",
    "supabase/functions/_shared/personHeroCards.ts",
    "supabase/functions/_shared/personHeroCards.test.ts",
    "supabase/functions/_shared/personHeroCards.adversarial.test.ts",
    "supabase/functions/get-paired-profile-cards/index.ts",
    "supabase/functions/get-person-hero-cards/index.ts",
    "supabase/functions/generate-curated-experiences/index.ts",
  ];
  // ORCH-0989 [Unified cover picker sheet]: brand-cover video target migration
  // + new Pexels curated edge fn + the 6 generalized event-cover-video fns +
  // shared helper (edits flagged by C7's modified-file detection). Per
  // SPEC_ORCH-0989 §9.4 + COMMS-0002.
  const ORCH_0989_BACKEND_ALLOWLIST = [
    "supabase/functions/event-cover-pexels-curated/index.ts",
    "supabase/migrations/20260801000000_orch_0989_brand_cover_video_target.sql",
    "supabase/functions/event-cover-video-upload-intent/index.ts",
    "supabase/functions/event-cover-video-source-uploaded/index.ts",
    "supabase/functions/event-cover-video-status/index.ts",
    "supabase/functions/event-cover-video-apply/index.ts",
    "supabase/functions/event-cover-video-cancel/index.ts",
    "supabase/functions/event-cover-video-webhook/index.ts",
    "supabase/functions/_shared/eventCoverVideo.ts",
    // ORCH-0989 tester-authored adversarial regressions. Ship with the close PR.
    // #1 curated edge fn error/boundary/no-orientation invariant.
    "supabase/functions/event-cover-pexels-curated/index.adversarial.test.ts",
    // #2 brand-cover-video target boundary (CHECK + RLS + apply gate).
    "supabase/functions/event-cover-video-apply/index.adversarial.test.ts",
  ];
  // ORCH-0990 [Curated "Flowers" stop resolves to real florists]. C7 is scoped to
  // ORCH-0863 marketing; these backend touches are the composite primary-type
  // florist gate: a read-only re-create of the fetch_local_signal_ranked RPC
  // (two new optional params, no-op at defaults), the shared signal-rank helper
  // (new gate map + resolver + floor 0), its Deno regression test, the stop-swap
  // resolver, and the curated generator call-site. No marketing scope.
  const ORCH_0990_BACKEND_ALLOWLIST = [
    "supabase/migrations/20260801000001_orch_0990_fetch_local_signal_ranked_primary_type_gate.sql",
    "supabase/functions/_shared/signalRankFetch.ts",
    "supabase/functions/_shared/signalRankFetch.flowers.test.ts",
    // ORCH-0990 tester-authored adversarial regression test (QA Step 0.5(b)) —
    // evaluates the composite gate predicate against adversarial rows (a different
    // angle than the implementor's SQL-text grep test). Same C7 rationale.
    "supabase/functions/_shared/signalRankFetch.flowers.adversarial.test.ts",
    "supabase/functions/_shared/stopAlternatives.ts",
    "supabase/functions/generate-curated-experiences/index.ts",
  ];
  // ORCH-1006 [Universal all-in pricing engine]. New shared money engine + its
  // regression test + the pricing migrations. Admin take-rate persistence uses
  // SECURITY DEFINER RPCs (no new edge function). Slice 3 Surface 4 adds the
  // read-only tax-registration probe edge fn for the authoring VAT row.
  // (META-ORCH-1009 Sub-B previously source-reconciled the migrations from this
  // branch to unblock db push; this merge supersedes that with the full list.)
  const ORCH_1006_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/allInPricingEngine.ts",
    "supabase/functions/_shared/__tests__/allInPricingEngine.test.ts",
    "supabase/functions/brand-tax-registrations-list/index.ts",
    "supabase/migrations/20260802000000_orch_1006_pricing_switches.sql",
    "supabase/migrations/20260802000001_orch_1006_pricing_views.sql",
    "supabase/migrations/20260802000002_orch_1006_finalize_copy_pricing_breakdown.sql",
    "supabase/migrations/20260805000000_orch_1006_public_event_tier_allin.sql",
  ];
  // ORCH-1008 [Admin shell prune + Intelligence Overview tab + remainder mode].
  // C7 is scoped to ORCH-0863 marketing; these backend touches are the new
  // place_intelligence_runs CHECK-constraint extension (adds 'remainder' to
  // the mode enum + sample_size consistency), the in-place edge fn extension
  // (handleStartRun branches on mode='remainder' + a new intelligence_coverage
  // action for the Overview tab), plus the Deno regression test asserting
  // remainder enqueues exactly servable - completed places. Per COMMS-0002.
  const ORCH_1008_BACKEND_ALLOWLIST = [
    "supabase/migrations/20260801000002_orch_1008_remainder_mode.sql",
    "supabase/functions/run-place-intelligence-trial/index.ts",
    "supabase/functions/run-place-intelligence-trial/__tests__/runRemainder.test.ts",
    "supabase/functions/run-place-intelligence-trial/__tests__/runRemainder_adversarial.test.ts",
  ];
  // ORCH-1013 [Place Intel control tower + coverage-math fix + admin Tailwind
  // drift]. Finding A patches handleIntelligenceCoverage to JOIN place_pool on
  // is_servable so the "evaluated" set excludes drifted rows; Finding C is
  // operational (no file edits). Per COMMS-0002.
  const ORCH_1013_BACKEND_ALLOWLIST = [
    "supabase/functions/run-place-intelligence-trial/index.ts",
    "supabase/functions/run-place-intelligence-trial/__tests__/coverage_servable_filter.test.ts",
    // ORCH-1013 QA adversarial tests (no production code touched)
    "supabase/functions/run-place-intelligence-trial/__tests__/coverage_adversarial.test.ts",
  ];
  // ORCH-1014 [Intelligence Trial consolidation — prune photo pages +
  // per-city Seed/Refresh readiness badges]. C7 is scoped to ORCH-0863
  // marketing; ORCH-1014's only backend touch is a read-only extension to
  // the intelligence_coverage action (6 new fields per city row + 2 new
  // place_pool fetches client-side aggregated) plus its Deno regression
  // test. No new external API surface (Supabase-only). Per COMMS-0003 the
  // existing Gemini-2.5-Flash citation block in the file is preserved.
  // The edge fn path is already in ORCH_1008_BACKEND_ALLOWLIST above;
  // duplicates here are harmless (ALLOWLIST is a union via .includes()).
  const ORCH_1014_BACKEND_ALLOWLIST = [
    "supabase/functions/run-place-intelligence-trial/index.ts",
    "supabase/functions/run-place-intelligence-trial/__tests__/intelligence_coverage_seed_refresh.test.ts",
  ];
  // ORCH-1015 — Intelligence Overview readiness ladder. Edge fn touched is
  // the existing intelligence_coverage action (3 new fields per city row +
  // 1 extended fetch column on seeding_cities). The Deno test file is
  // extended in-place (no new test file). Edge fn path duplicates
  // ORCH_1008/ORCH_1014 — harmless (ALLOWLIST is a union via .includes()).
  const ORCH_1015_BACKEND_ALLOWLIST = [
    "supabase/functions/run-place-intelligence-trial/index.ts",
    "supabase/functions/run-place-intelligence-trial/__tests__/intelligence_coverage_seed_refresh.test.ts",
  ];
  // META-ORCH-1009 Sub-A [ai-signal-scores schema]: adds the place_pool
  // ai_signal_scores JSONB column + GIN(jsonb_path_ops) index + one-shot
  // backfill from place_intelligence_trial_runs.q2_response; extends the
  // trial edge function with a non-fatal secondary write to mirror Q2 slice
  // into the new column. New Deno tests cover the slice helper + write-path
  // contract; new SQL probe covers post-apply backfill verification. The
  // edge-fn source path (`run-place-intelligence-trial/index.ts`) is already
  // listed in ORCH_1015_BACKEND_ALLOWLIST above — duplicated here for
  // explicit Sub-A ownership; the ALLOWLIST spread is a union so dup is
  // harmless. C7 is scoped to ORCH-0863 marketing; this entry covers the
  // Sub-A backend touches.
  const META_ORCH_1009_SUB_A_BACKEND_ALLOWLIST = [
    "supabase/migrations/20260802000003_meta_orch_1009_sub_a_ai_signal_scores.sql",
    "supabase/functions/run-place-intelligence-trial/index.ts",
    "supabase/functions/run-place-intelligence-trial/__tests__/ai_signal_scores_slice.test.ts",
    "supabase/functions/run-place-intelligence-trial/__tests__/ai_signal_scores_write_path.test.ts",
    // QA pass — adversarial coverage on slice + writer (5 new tests):
    "supabase/functions/run-place-intelligence-trial/__tests__/ai_signal_scores_adversarial.test.ts",
    "supabase/migrations/__tests__/meta_orch_1009_sub_a_ai_signal_scores_backfill.test.sql",
  ];
  // ORCH-1017 [Intelligence Trial "Couldn't load coverage" — Edge HTTP 546]:
  // moves the intelligence_coverage per-city aggregation out of JS (which pulled
  // ~79k place_pool rows into the edge fn and intermittently blew the Edge
  // WORKER_LIMIT) into the SECURITY DEFINER RPC pg_intelligence_coverage().
  // New migration + 2 new Deno tests; the 2 ORCH-1013 coverage tests have their
  // source-inspect halves repointed at the RPC/migration ([TEST-MOD-APPROVED
  // ORCH-1017]). The edge-fn source path is already covered by ORCH_1015 /
  // META_ORCH_1009_SUB_A above — listed here for explicit ORCH-1017 ownership;
  // the ALLOWLIST spread is a union so dups are harmless. C7 is scoped to
  // ORCH-0863 marketing; this entry covers the ORCH-1017 backend touches.
  const ORCH_1017_BACKEND_ALLOWLIST = [
    "supabase/migrations/20260807000000_orch_1017_pg_intelligence_coverage.sql",
    "supabase/functions/run-place-intelligence-trial/index.ts",
    "supabase/functions/run-place-intelligence-trial/__tests__/orch1017_coverage_rpc.test.ts",
    "supabase/functions/run-place-intelligence-trial/__tests__/orch1017_coverage_rpc_adversarial.test.ts",
    "supabase/functions/run-place-intelligence-trial/__tests__/coverage_servable_filter.test.ts",
    "supabase/functions/run-place-intelligence-trial/__tests__/coverage_adversarial.test.ts",
    "supabase/functions/run-place-intelligence-trial/__tests__/intelligence_coverage_seed_refresh.test.ts",
  ];
  // META-ORCH-1009 Sub-B [consumer ranker blend + reasoning-on-card-back]:
  // extends signalScorer.computeScore with AI blend + inappropriate_for veto,
  // wires run-signal-scorer to read place_pool.ai_signal_scores + DELETE
  // vetoed rows, surfaces ai_reasoning + ai_score_raw on the two consumer
  // RPCs via a new migration, threads the per-signal reasoning slice through
  // discover-cards + generate-curated-experiences + _shared/signalRankFetch.
  // Per-Sub-B contract: 5 backend code files + 1 migration + new Deno test
  // suites + 1 new strict-grep gate (registered separately in the workflow
  // file, not under supabase/). All consumer-ranker-only — admin paths
  // intentionally NOT in scope.
  // Migration rebumped 20260803→20260806 to land after ORCH-1006's already-
  // applied 20260805 (tester P2 F-01).
  // META-ORCH-1009 Sub-D [refresh cron + admin re-evaluate button]:
  // closes the staleness loop DEC-182 left open by adding a 15-min pg_cron
  // rescore-sweep + a Google-data-drift trigger on place_pool + a per-place
  // admin re-eval button + a 90-day all-cities backstop. Touches:
  //   - 1 new migration (cron + helper fns + drift trigger + column adds)
  //   - run-signal-scorer/index.ts (per-place mode + ai_signal_scores_at write)
  //   - _shared/signalScorer.ts (1-line evaluated_at passthrough)
  //   - run-place-intelligence-trial/index.ts (new admin_reeval_place action)
  //   - 5 new Deno + SQL tests under __tests__/
  // C7 is scoped to ORCH-0863 marketing; this entry covers the Sub-D backend
  // touches. See DEC-183 + I-AI-SCORE-STALENESS-AUTO-RECOVERED.
  const META_ORCH_1009_SUB_D_BACKEND_ALLOWLIST = [
    "supabase/migrations/20260808000000_meta_orch_1009_sub_d_refresh_cron.sql",
    "supabase/functions/run-signal-scorer/index.ts",
    "supabase/functions/_shared/signalScorer.ts",
    "supabase/functions/run-place-intelligence-trial/index.ts",
    "supabase/functions/run-signal-scorer/__tests__/per_place_mode.test.ts",
    "supabase/functions/_shared/__tests__/signalScorer.evaluated_at_passthrough.test.ts",
    "supabase/functions/run-place-intelligence-trial/__tests__/admin_reeval_place.test.ts",
    // Tester adversarial test (Sub-D QA pass) — pinned P0 drift trigger fix.
    "supabase/migrations/__tests__/meta_orch_1009_sub_d_adversarial.test.ts",
    "supabase/migrations/__tests__/sub_d_seed_idempotent.test.sql",
    // Admin UI regression test (note: lives outside supabase/ so the C7
    // backend-only forbid does not gate it; listed here for ORCH-trace).
    "mingla-admin/src/__tests__/orch1009_sub_d_reeval_button.test.js",
    // Strict-grep gate (also lives outside supabase/; listed for trace).
    ".github/scripts/strict-grep/meta-orch-1009-sub-d-ai-score-staleness-recovery.mjs",
  ];
  const META_ORCH_1009_SUB_B_BACKEND_ALLOWLIST = [
    "supabase/migrations/20260806000000_meta_orch_1009_sub_b_rpcs_with_reasoning.sql",
    "supabase/functions/_shared/signalScorer.ts",
    "supabase/functions/_shared/signalRankFetch.ts",
    "supabase/functions/run-signal-scorer/index.ts",
    "supabase/functions/discover-cards/index.ts",
    "supabase/functions/generate-curated-experiences/index.ts",
    "supabase/functions/_shared/__tests__/signalScorer.blend.test.ts",
    // [META-ORCH-1009 Sub-B tester adversarial] 10 additional edge-case tests
    // for the AI blend ranker — determinism, veto round-trip, NaN/Infinity
    // sanitization, snippet trimming, strict ===/case discriminators, clamp
    // floor. Lives next to the implementor's blend.test.ts; same gate.
    "supabase/functions/_shared/__tests__/signalScorer.blend.adversarial.test.ts",
    // [TEST-MOD-APPROVED META-ORCH-1009 Sub-B] 20 call sites in scorer.test.ts
    // updated to pass the new required signalId arg to computeScore. Mechanical
    // update; no existing test semantics altered. Inclusion in this allowlist
    // documents the modification under ORCH-0840 append-only convention.
    "supabase/functions/_shared/__tests__/scorer.test.ts",
    "supabase/functions/discover-cards/__tests__/ai_reasoning_passthrough.test.ts",
    "supabase/functions/discover-cards/__tests__/collab_determinism_under_ai_blend.test.ts",
    "supabase/functions/generate-curated-experiences/__tests__/ai_reasoning_passthrough.test.ts",
    "supabase/migrations/__tests__/meta_orch_1009_sub_b_rpc_reasoning_return.test.sql",
  ];
  // ORCH-1018 [Bouncer batch runner — memory-safe, resumable, non-aborting].
  // C7 is scoped to ORCH-0863 marketing; ORCH-1018's backend touches are the new
  // shared cursor-paged batch loop + its two Deno tests, plus the two Bouncer
  // edge functions rewired onto that loop (C7 flags modified backend files too,
  // so run-pre-photo-bouncer/run-bouncer are listed alongside the new helper).
  // No marketing scope. Per COMMS-0002.
  const ORCH_1018_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/bouncerBatch.ts",
    "supabase/functions/_shared/__tests__/bouncerBatch.test.ts",
    "supabase/functions/_shared/__tests__/bouncerBatch.adversarial.test.ts",
    "supabase/functions/run-pre-photo-bouncer/index.ts",
    "supabase/functions/run-bouncer/index.ts",
  ];
  // ORCH-1021 [Decisive scheduling availability].
  // C7 is scoped to ORCH-0863 marketing; ORCH-1021 only threads Google Places
  // utc_offset_minutes through existing card payloads so mobile scheduling can
  // evaluate the selected time in the venue's timezone.
  // No marketing scope. Per COMMS-0002.
  const ORCH_1021_BACKEND_ALLOWLIST = [
    "supabase/functions/discover-cards/index.ts",
    "supabase/functions/generate-curated-experiences/index.ts",
    "supabase/functions/generate-curated-experiences/__tests__/utc_offset_passthrough.test.ts",
  ];
  // ORCH-1024 [Photo backfill originals-only + separate thumbnail tab].
  // C7 is scoped to ORCH-0863 marketing; ORCH-1024 makes the main photo
  // backfill download+store ORIGINALS ONLY (the inline imagescript thumbnail
  // generation that crashed `backfill-place-photos` with "not enough compute
  // resources" is removed; thumbnails move to the separate
  // `backfill-place-photo-thumbs` function driven from a new admin tab). It also
  // carries the ORCH-1023 expired-name REFRESH fix + its process-path test.
  // No marketing scope. Per COMMS-0002.
  const ORCH_1024_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/photoStorageService.ts",
    "supabase/functions/_shared/photoStorageService.test.ts",
    "supabase/functions/backfill-place-photos/index.ts",
    "supabase/functions/backfill-place-photos/index.test.ts",
  ];
  const ALLOWLIST = [
    ...ORCH_1024_BACKEND_ALLOWLIST,
    ...ORCH_1021_BACKEND_ALLOWLIST,
    ...ORCH_1018_BACKEND_ALLOWLIST,
    ...ORCH_1017_BACKEND_ALLOWLIST,
    ...ORCH_1006_BACKEND_ALLOWLIST,
    ...ORCH_0989_BACKEND_ALLOWLIST,
    ...ORCH_0990_BACKEND_ALLOWLIST,
    ...ORCH_0986_BACKEND_ALLOWLIST,
    ...ORCH_0985_BACKEND_ALLOWLIST,
    ...META_ORCH_0952_BACKEND_ALLOWLIST,
    ...ORCH_0972_BACKEND_ALLOWLIST,
    ...ORCH_0954_BACKEND_ALLOWLIST,
    ...ORCH_0915_BACKEND_ALLOWLIST,
    ...ORCH_0933_BACKEND_ALLOWLIST,
    ...ORCH_0940_BACKEND_ALLOWLIST,
    ...ORCH_0948_BACKEND_ALLOWLIST,
    ...ORCH_0948_RECONCILED_REMOTE_MIGRATION_ALLOWLIST,
    ...ORCH_0930_0928_LOCKIN_BACKEND_ALLOWLIST,
    ...ORCH_0932_BACKEND_ALLOWLIST,
    ...ORCH_0931_BACKEND_ALLOWLIST,
    ...ORCH_0950_BACKEND_ALLOWLIST,
    ...ORCH_0859_BUNDLED_ALLOWLIST,
    ...ORCH_0869_BACKEND_ALLOWLIST,
    ...ORCH_0875_BACKEND_ALLOWLIST,
    ...ORCH_0099_VE1_BACKEND_ALLOWLIST,
    ...ORCH_0100_VE2_BACKEND_ALLOWLIST,
    ...ORCH_0101_VE3_BACKEND_ALLOWLIST,
    ...ORCH_0102_VE4_BACKEND_ALLOWLIST,
    ...ORCH_0881_VE5_BACKEND_ALLOWLIST,
    ...ORCH_VE6_PLAY_ACTIVITIES_BACKEND_ALLOWLIST,
    ...ORCH_0877_BACKEND_ALLOWLIST,
    ...ORCH_0876_BACKEND_ALLOWLIST,
    ...ORCH_0879_BACKEND_ALLOWLIST,
    ...ORCH_0880_BACKEND_ALLOWLIST,
    ...ORCH_0891_BACKEND_ALLOWLIST,
    ...ORCH_0898_BACKEND_ALLOWLIST,
    ...ORCH_0902_0903_BACKEND_ALLOWLIST,
    ...ORCH_0908_BACKEND_ALLOWLIST,
    ...ORCH_0909_0906_BACKEND_ALLOWLIST,
    ...ORCH_0897_BACKEND_ALLOWLIST,
    ...CONVERSATION_RLS_RECURSION_HOTFIX_ALLOWLIST,
    ...ORCH_0910_BACKEND_ALLOWLIST,
    ...ORCH_0911_BACKEND_ALLOWLIST,
    ...ORCH_0914_BACKEND_ALLOWLIST,
    ...ORCH_0921_BACKEND_ALLOWLIST,
    ...ORCH_0925_BACKEND_ALLOWLIST,
    ...ORCH_0946_BACKEND_ALLOWLIST,
    ...ORCH_0947_BACKEND_ALLOWLIST,
    ...ORCH_0953_BACKEND_ALLOWLIST,
    ...ORCH_0955_BACKEND_ALLOWLIST,
    ...ORCH_0956_BACKEND_ALLOWLIST,
    ...ORCH_0957_BACKEND_ALLOWLIST,
    ...ORCH_0962_BACKEND_ALLOWLIST,
    ...ORCH_0963_BACKEND_ALLOWLIST,
    ...ORCH_0964_BACKEND_ALLOWLIST,
    ...ORCH_0977_BACKEND_ALLOWLIST,
    ...ORCH_0978_BACKEND_ALLOWLIST,
    ...ORCH_1008_BACKEND_ALLOWLIST,
    ...ORCH_1013_BACKEND_ALLOWLIST,
    ...ORCH_1014_BACKEND_ALLOWLIST,
    ...ORCH_1015_BACKEND_ALLOWLIST,
    ...META_ORCH_1009_SUB_A_BACKEND_ALLOWLIST,
    ...META_ORCH_1009_SUB_B_BACKEND_ALLOWLIST,
    ...META_ORCH_1009_SUB_D_BACKEND_ALLOWLIST,
  ];
  const forbidden = changed.filter(
    (p) =>
      (p.startsWith("supabase/migrations/") ||
        p.startsWith("supabase/functions/")) &&
      !ALLOWLIST.includes(p),
  );
  if (forbidden.length > 0) {
    fail(
      "C7: no-new-backend-files",
      `ORCH-0863 must not touch supabase/migrations/ or supabase/functions/ (NG hard guard); offenders:\n  ${forbidden.join("\n  ")}`,
    );
  } else {
    ok(
      "C7: no-new-backend-files",
      `zero touches under supabase/migrations/ or supabase/functions/ (${changed.length} files changed total)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Self-test mode
// ---------------------------------------------------------------------------
function runSelfTest() {
  console.log("# Self-test mode");
  let selfFails = 0;
  function expect(cond, msg) {
    if (!cond) {
      console.error(`SELF-FAIL: ${msg}`);
      selfFails += 1;
    } else {
      console.log(`SELF-OK: ${msg}`);
    }
  }

  // C1 negative test: `$` literal triggers fail.
  const badOverview = "const cost = '$100';\n";
  const beforeC1 = failures;
  checkOverviewNoDollar(badOverview);
  expect(failures === beforeC1 + 1, "C1 catches literal $ in source");
  failures = beforeC1;

  // C1 positive test: `${expr}` interpolation is allowed.
  const goodOverview = "const t = `Hello ${name}`;\n";
  checkOverviewNoDollar(goodOverview);
  expect(failures === beforeC1, "C1 allows template-literal interpolation");

  // C2 case-insensitive match.
  const beforeC2 = failures;
  checkOverviewNoRevenue("// Total Revenue from blasts\n");
  expect(failures === beforeC2 + 1, "C2 catches 'Revenue' (case-insensitive)");
  failures = beforeC2;

  // C3 catches 'Opened' label.
  const beforeC3 = failures;
  checkOverviewNoOpened('label="Opened"');
  expect(failures === beforeC3 + 1, "C3 catches label=\"Opened\"");
  failures = beforeC3;

  // C4 missing-guard test.
  const beforeC4 = failures;
  checkStarterPackGuard("export function updateUserTemplate() {}");
  expect(failures === beforeC4 + 1, "C4 catches missing assertNotStarterPack");
  failures = beforeC4;

  // C4 positive: guard present in both methods.
  const goodTpl =
    "function updateUserTemplate() { assertNotStarterPack(); throw new Error(\"Cannot modify starter-pack template\"); }\n" +
    "function deleteUserTemplate() { assertNotStarterPack(); throw new Error(\"Cannot modify starter-pack template\"); }";
  checkStarterPackGuard(goodTpl);
  expect(failures === beforeC4, "C4 passes with assertNotStarterPack in 2 methods");

  // C5 catches missing template param.
  const beforeC5 = failures;
  checkComposeTemplateParam("useLocalSearchParams<{ audience?: string }>()");
  expect(failures === beforeC5 + 1, "C5 catches missing template? param");
  failures = beforeC5;

  if (selfFails > 0) {
    console.error(`# Self-test FAILED: ${selfFails} expectation(s) not met`);
    process.exit(1);
  }
  console.log("# Self-test PASSED");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
if (process.argv.includes("--self-test")) {
  runSelfTest();
}

console.log("# ORCH-0863 strict-grep gate — Marketing Hub Phase B");

const overviewSrc = readSource(OVERVIEW_ROUTE);
checkOverviewNoDollar(overviewSrc);
checkOverviewNoRevenue(overviewSrc);
checkOverviewNoOpened(overviewSrc);

const templateSvcSrc = readSource(TEMPLATE_SERVICE);
checkStarterPackGuard(templateSvcSrc);

const composeSrc = readSource(COMPOSE_ROUTE);
checkComposeTemplateParam(composeSrc);

checkOverviewServiceExists();

checkNoNewBackendFiles();

if (failures > 0) {
  console.error(`# ${failures} failure(s) — see above`);
  process.exit(1);
}
console.log("# All checks PASS");
process.exit(0);
