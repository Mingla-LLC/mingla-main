#!/usr/bin/env node
/**
 * ORCH-1004 [Business web data reliability] — auth-scoped query readiness gate.
 *
 * WHY: business-web restores its Supabase session ASYNCHRONOUSLY while the
 * persisted brand/account/event id rehydrates SYNCHRONOUSLY from localStorage.
 * A React Query hook that gates `enabled` on the persisted id alone fires
 * BEFORE the auth token is attached. The RLS-scoped table returns HTTP 200 +
 * [] (a SUCCESS, not a 401), so React Query's error-only `retry` never fires
 * and the empty result is cached as success for the staleTime window. The user
 * sees empty pages / half-loaded dropdowns until a manual refresh wins the
 * <session-restore race. (Investigation RC-1/RC-2; SPEC ORCH-1004 Part 1.)
 *
 * RULE: every hook that reads an auth.uid()-scoped table / view / RPC / service
 * MUST fold `isAuthReady` (from `useAuth()`) into its React Query `enabled`
 * computation. isAuthReady ⟺ authStatus === "signed_in_ready" &&
 * session.access_token present (see src/utils/authReadiness.ts). A not-ready
 * query reads as loading (I-DISABLED-QUERY-IS-LOADING, ORCH-0889), so the UX
 * becomes "loading → data" instead of "empty".
 *
 * The proven template is `useEventOrders` (`enabled: !loading && session !==
 * null && eventId !== null`), generalized here to the canonical isAuthReady
 * signal.
 *
 * PUBLIC / DUAL-USE hooks are ALLOWLISTED below and must NOT be gated — the
 * anonymous buyer-web pages depend on their anon reads (events, brands, the
 * security-definer public views, and the anon-readable trip_intake_schemas
 * published-trip policy). Gating them would break buyer-web.
 *
 * The two lists are still curated (the auth-vs-public classification is a
 * security judgment a regex cannot make), but ORCH-1202 made the gate
 * FAIL-CLOSED: a completeness check (checkCompleteness, below) walks every
 * src/hooks query hook and FAILS CI if any is in NEITHER list. This is the
 * structural cure for the bug that shipped ORCH-1202: the curated list went
 * stale (~20 auth-scoped hooks added, none registered) and CI stayed green.
 * When a NEW query hook is added it MUST be registered in AUTH_SCOPED_HOOK_FILES
 * (then it MUST fold isAuthReady into enabled) or, if genuinely public/dual-use,
 * in PUBLIC_HOOK_ALLOWLIST with a one-line reason — otherwise CI fails.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const hooksDir = path.join(root, "mingla-business/src/hooks");

// ── Auth-scoped hook files (relative to mingla-business/src/hooks). Each MUST
//    fold isAuthReady into its query `enabled`. (SPEC ORCH-1004 Part 1.)
const AUTH_SCOPED_HOOK_FILES = [
  "useBusinessRecentReader.ts",
  "useVenueListings.ts",
  "useBrandReservationSettingsList.ts",
  "useTrips.ts",
  "useBusinessEvents.ts",
  "useServerDraftEvents.ts",
  "useBrandOfferingCounts.ts",
  "useAuditLog.ts",
  "useExperiencesByBrand.ts",
  "usePendingExperiences.ts",
  "useOrderInstallments.ts",
  "useTripOrders.ts",
  "useEventWaitlist.ts",
  "useBrands.ts",
  "useBrandStripeStatus.ts",
  "useBrandStripeBalances.ts",
  "useBrandStripeBankVerification.ts",
  "useBrandStripeOrphanedRefunds.ts",
  "useManualInstallmentActions.ts",
  "useAgentChat.ts",
  "useCurrentBrandRole.ts",
  "useEventOrders.ts", // the proven template — must stay gated
  "marketing/useAudienceList.ts",
  "marketing/useBrandCustomers.ts",
  "marketing/useEventBuyers.ts",
  "marketing/useMarketingOverview.ts",
  "marketing/useUserTemplates.ts",
  // ── ORCH-1202 DELTA-1 (20) — newly-fixed: folded isAuthReady into enabled.
  //    These had fired pre-auth on cold web load and cached the RLS-empty 200.
  "useBrandInvitations.ts",
  "useScannerInvitations.ts",
  "useBrandPaystack.ts",
  "useBrandTaxRegistration.ts",
  "useBusinessNotifications.ts",
  "useNotificationTypePrefs.ts",
  "useMinglaToSAcceptance.ts",
  "useAriPreferences.ts",
  "useConversationList.ts",
  "usePartnerSplits.ts",
  "usePartnerBrandLinks.ts",
  "useBrandPartnerLinks.ts",
  "usePartnerStripe.ts",
  "useTripEditLog.ts",
  "useTripHasWebPurchases.ts",
  "useVenueClaimFeedback.ts",
  "useCancelTripBooking.ts",
  "marketing/useCampaigns.ts",
  "marketing/useCampaignReport.ts",
  "marketing/useTemplate.ts",
  "marketing/useStarterTemplates.ts",
  // ── #873 — reads event-manager-only guest roster RPCs. Both the access
  //    probe and roster query fold isAuthReady into enabled so a cold web
  //    session cannot cache an RLS-empty/forbidden result as guest truth.
  "useGuestRoster.ts",
  // ── ORCH-1202 DELTA-2 (17) — already correctly gated (isAuthReady or the
  //    SESSION_GATE_EQUIVALENT pattern), registered now so a future edit that
  //    silently drops the gate is caught by CI (the per-file checkHook).
  "useBrandHours.ts",
  "useBrandPlacePipelineState.ts",
  "useCreatorAccount.ts",
  "useExperienceDetail.ts",
  "useExperienceSoldCount.ts",
  "useMenus.ts",
  "useRsvpApprovals.ts",
  "useSupportQueue.ts",
  "useSupportStaff.ts",
  "useSupportTickets.ts",
  "useVenueAvailability.ts",
  "useVenueCapacityRules.ts",
  "useVenueIntelligence.ts",
  "useVenueReservationSettings.ts",
  "useVenueReservations.ts",
  "useRsvpContributionRefunds.ts",
  "useVenueTables.ts",
  "useVenueWaitlist.ts",
  // ── #1789 (#1767 Phase 1) — both read brand-member-RLS-gated tables
  //    (qr_spots / venue_listings / menu_modifier_groups / menu_modifiers),
  //    so a pre-auth fire would cache the RLS-empty 200 the operator then
  //    reads as "you have no spots". Both fold isAuthReady into enabled.
  "useQrSpots.ts",
  "useMenuModifiers.ts",
  // ── #1791 (#1767 Phase 3) — the Orders queue and the venue's ordering
  //    switches. Both read brand-member-RLS-gated tables (venue_orders /
  //    venue_order_items / venue_ordering_settings), so a pre-auth fire would
  //    cache the RLS-empty 200 that a chef then reads as "no orders" while a
  //    guest is waiting for food they already paid for. Both fold isAuthReady
  //    into enabled.
  "useVenueOrders.ts",
  "useVenueOrderingSettings.ts",
  // ── #1792 (#1767 Phase 3b) — waiter mode. The pad reads the venue's own
  //    menus/menu_items/menu_modifier_groups and the open-tab summaries, all
  //    brand-member-RLS-gated. A pre-auth fire caches an RLS-empty 200, which a
  //    waiter standing at a table reads as "this venue has no menu" and "this
  //    table has no tab" — and then opens a SECOND tab on a table that already
  //    has one. Both fold isAuthReady into enabled.
  "useVenueOrderPad.ts",
  "useVenueOrderTabs.ts",
  // ── ORCH-1331 [partner Paystack payout rail] — reads the caller's OWN
  //    partner_paystack_accounts (auth.uid()-scoped via the partner-gated
  //    edge fn); the status hook folds isAuthReady into enabled
  //    (usePartnerStripe mirror).
  "usePartnerPaystack.ts",
  // ── #1180 [payout-ui-copy] — reads the brand's OWN payout ledger tables
  //    (brand_payout_releases / payout_transfer_legs / payout_ledger_adjustments
  //    / organiser_payout_debts), all RLS-gated at finance_manager rank
  //    (auth.uid()-scoped). Folds isAuthReady into enabled.
  "useBrandPayoutLedger.ts",
  // #865 — brand's own ad-conversion rollup, auth.uid()-scoped RPC
  // (brand_conversion_rollup self-authorizes via biz_is_brand_member_for_read_for_caller).
  "useBrandConversionRollup.ts",
  // ── Issue #1735 [growth-tools client] — reads the brand's OWN tool runs /
  //    competitor watch via the app-lane growth-tools functions (P-3 verified
  //    JWT + biz_is_brand_member_for_read on every door). Gates every query on
  //    the proven `!loading && session !== null` template (the useEventOrders/
  //    useVenueIntelligence idiom) + brand/subject completeness.
  "useGrowthTools.ts",
  // #2725 — the lazy competitor-intelligence slice uses the same authenticated
  // growth-tools doors and preserves the proven session-ready query template.
  "useCompetitorIntelligence.ts",
  //    #1735 CI rework — the eager read slice (latest-read + nudge fan-out),
  //    same auth-scoped growth-tools reads, same gating template.
  "useGrowthToolsReads.ts",
  // #874 — all three brand Analytics RPCs are active-member/auth.uid()-scoped.
  "useBrandAnalytics.ts",
  // ── #2101 [named-buyer checkout] — MANDATORY registry entry (this gate's own
  //    ORCH-1202 completeness clause requires every new query hook to declare
  //    itself). The file owns TWO queries and BOTH fold isAuthReady into
  //    enabled. The Business read is brand-owner/auth.uid()-scoped, so a
  //    pre-auth fire would cache a FORBIDDEN result as "you cannot configure
  //    this". The public eligibility read is anon-TOLERANT but must still wait
  //    for auth to settle, because its cache key carries the auth scope
  //    (`uid` or 'anon') — firing early would key one buyer's checkout decision
  //    under another's scope and then serve it from cache.
  "useEventTicketCheckoutAccess.ts",
  // #1384 — both reads are brand-team/auth.uid()-scoped. A pre-auth request
  // would cache an RLS-empty success and hide the canonical currency/range.
  "useBrandDiscoveryCurrency.ts",
  // Issue #1424: Stay authoring reads flags and inventory only after auth settles.
  "useFeatureFlag.ts",
  "useStayInventory.ts",
  "usePlaceDiscoveryPriceRange.ts",
  // #1390 — group/list reads are auth.uid()-owned Stay reservations.
  "useStayGuest.ts",
  // #1426 — staff queue/detail RPCs are accepted-brand/auth.uid()-scoped.
  "useStayStaffReservations.ts",
  // #1403 — private listing and exact-venue aggregate RPCs.
  "useListingInsights.ts",
  "useVenueReservationMetrics.ts",
  // #1795 — exact-brand/exact-venue member-authenticated order rollup;
  // both single and fanout query paths already wait for isAuthReady.
  "useVenueOrderMetrics.ts",
  // #1421 — exact-venue organic aggregate RPC is active-member/auth scoped.
  "useVenueOrganicInsights.ts",
  // #1775 — import status is actor/brand scoped and must not cache a pre-auth
  // not-found response as the batch's final state.
  "useContactImport.ts",
  // #1774 — canonical Brand People Book/detail RPCs are accepted-role and
  // auth.uid()-scoped; both queries wait for auth, brand and role truth.
  "marketing/useBrandPeople.ts",
  // #2395 — Manual-group list/detail/Book-picker RPCs read auth.uid() and
  // require an accepted rank-20 brand relationship. Every query waits for
  // auth readiness, a concrete user, its identifiers, and the caller's gate.
  "marketing/useManualGroups.ts",
  // #2395 — the route-scoped Manual-group detail reader has the same rank-20
  // RPC contract and independently folds auth/user/identifier readiness.
  "marketing/useManualGroupDetail.ts",
  // #2305 — the identity-conflict review queue. `biz_list_brand_person_conflicts`
  // reads auth.uid() and gates on biz_brand_effective_rank >= marketing_manager,
  // so the query folds isAuthReady, user, brandId and resolved role into
  // `enabled` exactly as useBrandPeople does.
  "marketing/useBrandPersonConflicts.ts",
];

// ── Public / dual-use hooks. These MUST NOT be gated — buyer-web anon reads
//    depend on them. Each entry carries the reason it is anon-safe.
const PUBLIC_HOOK_ALLOWLIST = [
  ["usePublicEvents.ts", "anon-readable events via security-definer public views (buyer-web feed)"],
  ["usePublicTripBySlug.ts", "anon-readable published trips via trip-sidecar anon RLS (buyer-web)"],
  ["usePublicTripById.ts", "anon-readable published trips by id (buyer-web)"],
  ["useBrand.ts", "brands has a 'Public can read non-deleted brands' anon RLS policy; useBrand single-by-id is the public brand shell"],
  ["useIntakeSchema.ts", "trip_intake_schemas has trip_intake_schemas_anon_select for published trips; the buyer checkout-trip intake pages read it anonymously (dual-use)"],
  // ── ORCH-1202 — newly-discovered genuinely-public/anon-safe hooks.
  ["useBrandStripeCountries.ts", "static 34-country list; no auth context, no auth.uid()-scoped read (anon-safe UI helper)"],
  ["useTripTierAllIn.ts", "fetchTierAllInCents → pg_public_event_tier_allin SECURITY DEFINER public RPC; anon buyer-web trip checkout route (ORCH-1147)"],
  ["usePublicExperience.ts", "anon-readable published experience via public read path; buyer-web experience page (no useAuth, no sign-in)"],
  ["usePublicVenueAvailability.ts", "anon-safe availability read via the canonical self-authorizing venue edge function on public venue pages (#1365)"],
  ["usePublicStayDetail.ts", "anon-safe verified Stay detail via the STAY_PUBLIC_PAGES-gated SECURITY DEFINER projection (#1390)"],
  ["usePublicMenuBundle.ts", "anon-safe verified-venue menu + its service windows via public_menus_view (SECURITY DEFINER, claim_status='verified'); the guest ordering surface reads it with no account at all (#1793)"],
  // ── #2101 [named-buyer checkout] — the platform-resolved route access
  //    adapter. Neither half calls useQuery: the web half DELEGATES to
  //    useEventTicketCheckoutAccess (registered above as auth-scoped, and the
  //    owner of the isAuthReady gate + the auth-scoped cache key), and the
  //    native half is a constant legacy pass-through. They must stay UNGATED
  //    themselves — the buyer routes are anon-tolerant and must never gate on
  //    auth (ORCH-1004's own rule).
  ["usePublicTicketCheckoutRouteAccess.ts", "delegates to useEventTicketCheckoutAccess, which owns the isAuthReady gate and the auth-scoped key; this adapter only projects the bounded server state onto a route action state (#2101)"],
  ["usePublicTicketCheckoutRouteAccess.native.ts", "typed legacy pass-through; imports no hook, no service and no Supabase, so there is nothing to gate (#2101)"],
];
const ALLOWLIST_SET = new Set(PUBLIC_HOOK_ALLOWLIST.map(([f]) => f));

// Observation-only hooks: neither public nor declarative auth reads. Their
// observer must stay disabled/fail-closed; the authenticated action owns fetch.
const NON_FETCHING_IMPERATIVE_HOOKS = [
  ["useTurnoutForecast.ts", "#1008 metered events runs are imperative-only"],
];
const NON_FETCHING_IMPERATIVE_SET = new Set(
  NON_FETCHING_IMPERATIVE_HOOKS.map(([f]) => f),
);

// useEventOrders gates via `!loading && session !== null` (the original proven
// template) which is the functional equivalent of isAuthReady. Treat that exact
// pattern as a satisfying gate so the template hook is not forced to churn.
const SESSION_GATE_EQUIVALENT =
  /enabled\s*=\s*!loading\s*&&\s*session\s*!==\s*null/;

// A gated hook must (a) read isAuthReady out of useAuth(), and (b) reference
// isAuthReady inside an `enabled` computation.
const READS_IS_AUTH_READY = /\bisAuthReady\b/;
// Matches the canonical fold `const enabled = isAuthReady && ...` AND the
// equivalent named-variable fold `const enabledQuery = isAuthReady && ...`
// (useSupportStaff.ts), plus the inline `enabled: isAuthReady && ...` shape.
const ENABLED_USES_IS_AUTH_READY =
  /const\s+enabled\w*\s*=\s*[^;]*\bisAuthReady\b|enabled:\s*[^,}\n]*\bisAuthReady\b/;

// ── ORCH-1202 fail-closed COMPLETENESS CHECK ────────────────────────────────
// The curated AUTH_SCOPED_HOOK_FILES list went stale: ~20 auth-scoped hooks
// were added after the ORCH-1004 fix and none were registered, so CI stayed
// green while the bug shipped (ORCH-1202). The structural cure is to invert the
// model from OPT-IN (authors must remember to register) to FAIL-CLOSED: every
// query hook MUST be classified into one of the two lists or CI fails.
//
// Detection signal: "the file calls useQuery or useInfiniteQuery". This is the
// reliable signal — many auth-scoped hooks route through service modules and do
// NOT import the supabase client directly (useTrips, useExperiencesByBrand), so
// an "imports supabase" signal would MISS them. The `[<(]` after the identifier
// requires a CALL (not just an import), and the `(?!Client)` negative-lookahead
// excludes `useQueryClient(` (imperative cache hooks like
// useEventCoverVideoUpload.ts are NOT query hooks).
const CALLS_USE_QUERY =
  /\buseQuery(?!Client)\s*[<(]/;
const CALLS_USE_INFINITE_QUERY = /\buseInfiniteQuery\s*[<(]/;

/** True if the source is a data-reading query hook that MUST be classified. */
const isQueryHookSource = (source) =>
  CALLS_USE_QUERY.test(source) || CALLS_USE_INFINITE_QUERY.test(source);

/** Recursively collect *.ts query-hook files under hooksDir (POSIX relpaths). */
const collectQueryHookRelpaths = (dir) => {
  const out = [];
  const walk = (abs) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__") continue;
        walk(child);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      if (/\.(test|spec)\.ts$/.test(entry.name)) continue;
      const source = fs.readFileSync(child, "utf8");
      if (!isQueryHookSource(source)) continue;
      out.push(path.relative(dir, child).split(path.sep).join("/"));
    }
  };
  walk(dir);
  return out;
};

const checkCompleteness = (authSet, allowSet, nonFetchingSet, failures) => {
  if (!fs.existsSync(hooksDir)) {
    failures.push(`ORCH-1202 completeness: hooks dir not found at ${hooksDir}.`);
    return;
  }
  for (const relpath of collectQueryHookRelpaths(hooksDir)) {
    if (authSet.has(relpath) || allowSet.has(relpath) || nonFetchingSet.has(relpath)) continue;
    failures.push(
      `ORCH-1202 completeness: unregistered query hook "${relpath}" — it calls ` +
        `useQuery/useInfiniteQuery but is in neither AUTH_SCOPED_HOOK_FILES nor ` +
        `PUBLIC_HOOK_ALLOWLIST. Add it to AUTH_SCOPED_HOOK_FILES (if it reads an ` +
        `auth.uid()-scoped table/RPC/service — then it MUST fold isAuthReady into ` +
        `enabled) or to PUBLIC_HOOK_ALLOWLIST with a one-line anon-safe reason.`,
    );
  }
};

const inspectNonFetchingImperative = (source) => {
  const start = source.search(/\buseQuery(?!Client)\s*(?:<[^;{}]*>)?\s*\(/);
  const end = source.indexOf("\n  });", start);
  const observer = start >= 0 && end >= 0 ? source.slice(start, end + 6) : "";
  const eventOwners = source.match(/\brunGrowthTool(?:<[^;{}]*>)?\s*\(\s*["']events["']/g) ?? [];
  const allOwners = source.match(/\brunGrowthTool(?:<[^;{}]*>)?\s*\(/g) ?? [];
  return {
    disabled: /\benabled\s*:\s*false\b/.test(observer),
    failClosed: /\bqueryFn\s*:\s*(?:async\s*)?\(\s*\)\s*=>\s*\{\s*throw\b/.test(observer),
    observerFetches: /\b(?:fetch|fetchQuery|runGrowthTool|readRunByClientRef)\s*(?:<[^;{}]*>)?\s*\(/.test(observer),
    imperativeOwner: /\bqueryClient\.fetchQuery\s*(?:<[^;{}]*>)?\s*\(/.test(source),
    soleEventsOwner: eventOwners.length === 1 && allOwners.length === 1,
  };
};

const checkNonFetchingImperative = (relFile, reason, failures) => {
  const abs = path.join(hooksDir, relFile);
  if (!fs.existsSync(abs)) {
    failures.push(`ORCH-1004: missing NON_FETCHING/IMPERATIVE hook ${relFile}.`);
    return;
  }
  const result = inspectNonFetchingImperative(fs.readFileSync(abs, "utf8"));
  if (!result.disabled) failures.push(`${relFile}: NON_FETCHING/IMPERATIVE observer must keep literal enabled:false — ${reason}.`);
  if (!result.failClosed || result.observerFetches) failures.push(`${relFile}: NON_FETCHING/IMPERATIVE observer queryFn must throw and never fetch — ${reason}.`);
  if (!result.imperativeOwner || !result.soleEventsOwner) failures.push(`${relFile}: queryClient.fetchQuery must remain sole runGrowthTool("events") owner — ${reason}.`);
};

const checkHook = (relFile, failures) => {
  const abs = path.join(hooksDir, relFile);
  if (!fs.existsSync(abs)) {
    failures.push(`ORCH-1004: expected auth-scoped hook "${relFile}" not found at ${abs} — list out of sync with source.`);
    return;
  }
  const source = fs.readFileSync(abs, "utf8");
  if (SESSION_GATE_EQUIVALENT.test(source)) return; // proven session-gate template
  if (!READS_IS_AUTH_READY.test(source)) {
    failures.push(
      `${relFile}: auth-scoped hook does not read isAuthReady from useAuth(). ` +
        `Fold isAuthReady into the React Query enabled so a pre-auth fire can't cache an RLS-empty result as success (ORCH-1004 Part 1).`,
    );
    return;
  }
  if (!ENABLED_USES_IS_AUTH_READY.test(source)) {
    failures.push(
      `${relFile}: isAuthReady is imported but not wired into an "enabled" computation. ` +
        `The gate must be "const enabled = isAuthReady && <existing predicate>" (or "enabled: isAuthReady && ...") (ORCH-1004 Part 1).`,
    );
  }
};

const checkPublicNotGated = (relFile, reason, failures) => {
  const abs = path.join(hooksDir, relFile);
  if (!fs.existsSync(abs)) return; // public hook may not exist in all checkouts
  const source = fs.readFileSync(abs, "utf8");
  if (ENABLED_USES_IS_AUTH_READY.test(source)) {
    failures.push(
      `${relFile}: PUBLIC/DUAL-USE hook must NOT gate enabled on isAuthReady — ${reason}. ` +
        `Gating it breaks the anonymous buyer-web read path (ORCH-1004 allowlist).`,
    );
  }
};

// ── Self-test (run with --self-test): proves the gate catches the bug class.
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const probe = (label, source, expectGated) => {
    const gated =
      SESSION_GATE_EQUIVALENT.test(source) ||
      (READS_IS_AUTH_READY.test(source) && ENABLED_USES_IS_AUTH_READY.test(source));
    if (gated !== expectGated) {
      selfFailures.push(`SELF-TEST "${label}": expected gated=${expectGated}, got ${gated}`);
    }
  };
  probe(
    "ungated id-only enabled (the bug)",
    'const enabled = brandId !== null && brandId.length > 0;\nuseQuery({ enabled });',
    false,
  );
  probe(
    "gated const enabled = isAuthReady && ...",
    'const { isAuthReady } = useAuth();\nconst enabled = isAuthReady && brandId !== null;\nuseQuery({ enabled });',
    true,
  );
  probe(
    "gated inline enabled: isAuthReady && ...",
    'const { isAuthReady } = useAuth();\nuseQuery({ enabled: isAuthReady && eventId.length > 0 });',
    true,
  );
  probe(
    "proven session-gate template (useEventOrders)",
    'const { loading, session } = useAuth();\nconst enabled = !loading && session !== null && eventId !== null;',
    true,
  );
  probe(
    "imports isAuthReady but never wires it into enabled (dead import)",
    'const { isAuthReady } = useAuth();\nconst enabled = brandId !== null;\nuseQuery({ enabled });',
    false,
  );
  probe(
    "named-variable fold (useSupportStaff: const enabledQuery = isAuthReady && ...)",
    'const { isAuthReady } = useAuth();\nconst enabledQuery = isAuthReady && userId !== null;\nuseQuery({ enabled: enabledQuery });',
    true,
  );
  // Allowlist-detection self-test: a public hook that gates must be FLAGGED.
  const publicGatedFlagged = ENABLED_USES_IS_AUTH_READY.test(
    'const enabled = isAuthReady && brandSlug !== null;',
  );
  if (!publicGatedFlagged) {
    selfFailures.push("SELF-TEST allowlist: a gated public hook must be detectable as gated");
  }
  const validImperative = `useQuery<Result>({ enabled: false, queryFn: async () => { throw new Error("imperative"); },
  });
    queryClient.fetchQuery({ queryFn: () => runGrowthTool<Result>("events", brandId, input) });`;
  const probeImperative = (label, source, expected) => {
    const r = inspectNonFetchingImperative(source);
    const clean = r.disabled && r.failClosed && !r.observerFetches && r.imperativeOwner && r.soleEventsOwner;
    if (clean !== expected) selfFailures.push(`SELF-TEST NON_FETCHING/IMPERATIVE ${label}: expected ${expected}, got ${clean}`);
  };
  probeImperative("valid", validImperative, true);
  probeImperative("enabled:true hostile", validImperative.replace("enabled: false", "enabled: true"), false);
  probeImperative("non-throwing hostile", validImperative.replace('throw new Error("imperative")', "return null"), false);
  probeImperative("fetching observer hostile", validImperative.replace('throw new Error("imperative")', 'return runGrowthTool("events", brandId, input)'), false);

  // ── ORCH-1202 completeness detection-robustness self-tests. ──────────────
  const probeQueryHook = (label, source, expectQueryHook) => {
    const got = isQueryHookSource(source);
    if (got !== expectQueryHook) {
      selfFailures.push(
        `SELF-TEST completeness "${label}": expected isQueryHook=${expectQueryHook}, got ${got}`,
      );
    }
  };
  // (a) useQuery<T>( classifies as a query hook.
  probeQueryHook("useQuery<T>( typed call", 'const q = useQuery<Row[]>({ queryKey });', true);
  // (b) useQuery({ classifies as a query hook.
  probeQueryHook("useQuery({ object call", 'const q = useQuery({ queryKey, queryFn });', true);
  // (c) useQueryClient() must NOT classify (imperative cache hook).
  probeQueryHook(
    "useQueryClient() imperative-only",
    'const qc = useQueryClient();\nqc.invalidateQueries({ queryKey });',
    false,
  );
  // (d) useMutation(-only must NOT classify.
  probeQueryHook(
    "useMutation-only",
    'const m = useMutation({ mutationFn: send });',
    false,
  );
  // (e) a re-export / shim must NOT classify.
  probeQueryHook("re-export shim", 'export { useBrands } from "./useBrands";', false);
  // (f) useInfiniteQuery( classifies.
  probeQueryHook("useInfiniteQuery(", 'const q = useInfiniteQuery({ queryKey });', true);

  // ── ORCH-1202 completeness algorithm self-test against a temp fixture set:
  //    an unregistered query-hook fixture MUST be reported; once allowlisted,
  //    it MUST be clean. (Proves the fail-closed behavior independent of disk.)
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orch1202-completeness-"));
    try {
      fs.writeFileSync(
        path.join(tmp, "useFixtureUnregistered.ts"),
        "const q = useQuery({ queryKey: ['x'] });\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(tmp, "useFixtureMutationOnly.ts"),
        "const m = useMutation({ mutationFn: x });\n",
        "utf8",
      );
      const found = collectQueryHookRelpaths(tmp);
      if (!found.includes("useFixtureUnregistered.ts")) {
        selfFailures.push(
          "SELF-TEST completeness: an unregistered useQuery fixture must be collected as a query hook",
        );
      }
      if (found.includes("useFixtureMutationOnly.ts")) {
        selfFailures.push(
          "SELF-TEST completeness: a useMutation-only fixture must NOT be collected as a query hook",
        );
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  if (selfFailures.length) {
    console.error("ORCH-1004 gate SELF-TEST FAILED:");
    selfFailures.forEach((f) => console.error("  - " + f));
    process.exit(1);
  }
  console.log("ORCH-1004 gate self-test PASS (all cases, incl. ORCH-1202 completeness + named-variable fold).");
  process.exit(0);
}

// ── npm wiring check: the gate must be wired into package.json.
const checkNpmWiring = (failures) => {
  const packageJsonPath = path.join(root, "mingla-business/package.json");
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch (error) {
    failures.push(`ORCH-1004 wiring: mingla-business/package.json parse failed: ${error.message}`);
    return;
  }
  const script = packageJson.scripts?.["test:orch-1004"];
  if (
    typeof script !== "string" ||
    !script.includes("orch-1004-auth-scoped-query-readiness.mjs")
  ) {
    failures.push(
      `ORCH-1004 wiring: mingla-business/package.json missing scripts["test:orch-1004"] pointing at the gate script.`,
    );
  }
};

const failures = [];
const AUTH_SCOPED_SET = new Set(AUTH_SCOPED_HOOK_FILES);
AUTH_SCOPED_HOOK_FILES.forEach((f) => checkHook(f, failures));
PUBLIC_HOOK_ALLOWLIST.forEach(([f, reason]) => checkPublicNotGated(f, reason, failures));
NON_FETCHING_IMPERATIVE_HOOKS.forEach(([f, reason]) => checkNonFetchingImperative(f, reason, failures));
checkNpmWiring(failures);

// Cross-check: a file cannot be in both lists.
for (const f of AUTH_SCOPED_HOOK_FILES) {
  if (ALLOWLIST_SET.has(f) || NON_FETCHING_IMPERATIVE_SET.has(f)) {
    failures.push(`ORCH-1004: "${f}" is in BOTH the auth-scoped list and the public allowlist — resolve the conflict.`);
  }
}
for (const [f] of PUBLIC_HOOK_ALLOWLIST) {
  if (NON_FETCHING_IMPERATIVE_SET.has(f)) failures.push(`ORCH-1004: "${f}" is BOTH public and NON_FETCHING/IMPERATIVE.`);
}

// ORCH-1202 fail-closed completeness check: every on-disk query hook must be
// classified into exactly one of the two lists, else CI fails.
checkCompleteness(AUTH_SCOPED_SET, ALLOWLIST_SET, NON_FETCHING_IMPERATIVE_SET, failures);

if (failures.length) {
  console.error("ORCH-1004 auth-scoped query readiness gate FAILED:");
  failures.forEach((failure) => console.error("  - " + failure));
  process.exit(1);
}
console.log(
  `ORCH-1004 gate PASS: all ${AUTH_SCOPED_HOOK_FILES.length} auth-scoped hooks gate enabled on isAuthReady; ` +
    `${PUBLIC_HOOK_ALLOWLIST.length} public/dual-use hooks left ungated (buyer-web protected). ` +
    `${NON_FETCHING_IMPERATIVE_HOOKS.length} non-fetching/imperative observer locked disabled/fail-closed. ` +
    `ORCH-1202 completeness: every src/hooks query hook is classified.`,
);
