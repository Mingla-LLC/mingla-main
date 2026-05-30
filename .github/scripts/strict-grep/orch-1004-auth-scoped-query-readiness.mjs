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
 * This gate is intentionally a CURATED list, not a heuristic AST walk: the set
 * of auth-scoped hooks is small, stable, and security-load-bearing, and a
 * curated list cannot silently miss a hook the way a fragile regex sweep can.
 * When a NEW auth-scoped read hook is added, register it in
 * AUTH_SCOPED_HOOK_FILES (or, if it is genuinely public/dual-use, in
 * PUBLIC_HOOK_ALLOWLIST with a one-line reason). CI then enforces the gate.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const hooksDir = path.join(root, "mingla-business/src/hooks");

// ── Auth-scoped hook files (relative to mingla-business/src/hooks). Each MUST
//    fold isAuthReady into its query `enabled`. (SPEC ORCH-1004 Part 1.)
const AUTH_SCOPED_HOOK_FILES = [
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
];

// ── Public / dual-use hooks. These MUST NOT be gated — buyer-web anon reads
//    depend on them. Each entry carries the reason it is anon-safe.
const PUBLIC_HOOK_ALLOWLIST = [
  ["usePublicEvents.ts", "anon-readable events via security-definer public views (buyer-web feed)"],
  ["usePublicTripBySlug.ts", "anon-readable published trips via trip-sidecar anon RLS (buyer-web)"],
  ["usePublicTripById.ts", "anon-readable published trips by id (buyer-web)"],
  ["useBrand.ts", "brands has a 'Public can read non-deleted brands' anon RLS policy; useBrand single-by-id is the public brand shell"],
  ["useIntakeSchema.ts", "trip_intake_schemas has trip_intake_schemas_anon_select for published trips; the buyer checkout-trip intake pages read it anonymously (dual-use)"],
];
const ALLOWLIST_SET = new Set(PUBLIC_HOOK_ALLOWLIST.map(([f]) => f));

// useEventOrders gates via `!loading && session !== null` (the original proven
// template) which is the functional equivalent of isAuthReady. Treat that exact
// pattern as a satisfying gate so the template hook is not forced to churn.
const SESSION_GATE_EQUIVALENT =
  /enabled\s*=\s*!loading\s*&&\s*session\s*!==\s*null/;

// A gated hook must (a) read isAuthReady out of useAuth(), and (b) reference
// isAuthReady inside an `enabled` computation.
const READS_IS_AUTH_READY = /\bisAuthReady\b/;
const ENABLED_USES_IS_AUTH_READY =
  /const\s+enabled\s*=\s*[^;]*\bisAuthReady\b|enabled:\s*[^,}\n]*\bisAuthReady\b/;

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
  // Allowlist-detection self-test: a public hook that gates must be FLAGGED.
  const publicGatedFlagged = ENABLED_USES_IS_AUTH_READY.test(
    'const enabled = isAuthReady && brandSlug !== null;',
  );
  if (!publicGatedFlagged) {
    selfFailures.push("SELF-TEST allowlist: a gated public hook must be detectable as gated");
  }
  if (selfFailures.length) {
    console.error("ORCH-1004 gate SELF-TEST FAILED:");
    selfFailures.forEach((f) => console.error("  - " + f));
    process.exit(1);
  }
  console.log("ORCH-1004 gate self-test PASS (6/6 cases).");
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
AUTH_SCOPED_HOOK_FILES.forEach((f) => checkHook(f, failures));
PUBLIC_HOOK_ALLOWLIST.forEach(([f, reason]) => checkPublicNotGated(f, reason, failures));
checkNpmWiring(failures);

// Cross-check: a file cannot be in both lists.
for (const f of AUTH_SCOPED_HOOK_FILES) {
  if (ALLOWLIST_SET.has(f)) {
    failures.push(`ORCH-1004: "${f}" is in BOTH the auth-scoped list and the public allowlist — resolve the conflict.`);
  }
}

if (failures.length) {
  console.error("ORCH-1004 auth-scoped query readiness gate FAILED:");
  failures.forEach((failure) => console.error("  - " + failure));
  process.exit(1);
}
console.log(
  `ORCH-1004 gate PASS: all ${AUTH_SCOPED_HOOK_FILES.length} auth-scoped hooks gate enabled on isAuthReady; ` +
    `${PUBLIC_HOOK_ALLOWLIST.length} public/dual-use hooks left ungated (buyer-web protected).`,
);
