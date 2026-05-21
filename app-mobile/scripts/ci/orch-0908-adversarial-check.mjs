#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0908 [Collab session lifecycle: Lock-In → Schedule → V_{n+1} Recycle]
 * adversarial regression check (tester-authored, attacks DIFFERENT angles than
 * the implementor's happy-path structural assertions at
 * `orch-0908-regression-check.mjs`).
 *
 * Per ORCH-0840 Step 0.5 CLOSE gate: the tester's adversarial test must attack
 * edge cases, boundary conditions, error paths, malformed input, race
 * conditions, or invariant violations — NOT a renamed copy of the implementor's
 * happy-path tests.
 *
 * Attack vectors covered:
 *
 *   §A. NEGATIVE-pattern checks — assert FORBIDDEN patterns are absent
 *       (catches subtle re-reverts / regressions that "fix" the structure
 *       but break correctness).
 *
 *   §B. AUTH-PREDICATE structural verification — `OR` not `AND` (a sneaky
 *       privilege-tightening typo would make all admin RPCs uncallable).
 *
 *   §C. GUC-MECHANICS verification — `set_config(..., true)` MUST be
 *       transaction-local (third arg true). A false third arg leaks GUC
 *       across transactions, breaking concurrent isolation. This is the
 *       FAILS-ON-REVERT anchor — different angle than the implementor's
 *       T-IMPL-07 (discover-cards excludes wiring).
 *
 *   §D. CROSS-RPC CONSISTENCY — all three new RPCs must share the same
 *       defense-in-depth gates (auth.uid() IS NULL check, SECURITY DEFINER,
 *       search_path setting).
 *
 *   §E. INVARIANT-PRESERVATION checks for the ORCH-0902 trigger amendment
 *       — the new code must not erase the existing recursion guard or
 *       hash-diff short-circuit.
 *
 *   §F. CROSS-FILE CONSISTENCY — `notify-session-lock` invocation body
 *       shapes from the two call sites (SwipeableSessionCards + scheduling
 *       sheet) must match the edge function's expected destructure.
 *
 *   §G. AUDIT-METADATA verification — locked_by_consensus=false marker
 *       on admin-locks (distinguishes audit trail vs gang-consensus).
 *
 *   §H. CONSTITUTION #9 banner-data-fabrication guard — LockedPlanBanner
 *       returns null when scheduledAtIso is missing.
 *
 * Exit 1 on any FAIL.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(root, "..");

const read = (relFromRepoRoot) => {
  const abs = path.join(repoRoot, relFromRepoRoot);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
};

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
};

const migration = read(
  "supabase/migrations/20260626000000_orch_0908_admin_lock_schedule_recycle.sql",
);
const discoverCards = read("supabase/functions/discover-cards/index.ts");
const notifyLock = read("supabase/functions/notify-session-lock/index.ts");
const boardSessionService = read("app-mobile/src/services/boardSessionService.ts");
const swipeable = read("app-mobile/src/components/board/SwipeableSessionCards.tsx");
const sessionViewModal = read("app-mobile/src/components/SessionViewModal.tsx");
const boardDiscussionTab = read("app-mobile/src/components/board/BoardDiscussionTab.tsx");
const collabSessions = read("app-mobile/src/components/CollaborationSessions.tsx");
const messagingService = read("app-mobile/src/services/messagingService.ts");
const lockedBanner = read("app-mobile/src/components/board/LockedPlanBanner.tsx");
const schedSheet = read(
  "app-mobile/src/components/session/LockedCardSchedulingSheet.tsx",
);

// =====================================================================
// §A — NEGATIVE-PATTERN CHECKS (forbidden code that would break ORCH-0908)
// =====================================================================

// §A.1 — discover-cards collab branch MUST NOT contain a hardcoded empty
// exclude array in the union-RPC call (a sneaky re-revert would put this
// back). The solo branch's separate p_exclude_place_ids: excludeCardIds
// at the OTHER call site is fine.
{
  // Anchor on the actual `.rpc(` call site (not the comment that mentions
  // the function name). Window-scoped check excludes the comment block.
  const pass =
    !!discoverCards &&
    (() => {
      const idx = discoverCards.indexOf(".rpc('query_servable_places_by_signal_union'");
      if (idx < 0) return false;
      const window = discoverCards.slice(idx, idx + 400);
      return (
        /p_exclude_place_ids: excludePlaceIds/.test(window) &&
        !/p_exclude_place_ids: \[\]/.test(window)
      );
    })();
  check(
    "§A.1 — discover-cards collab union call MUST NOT hardcode p_exclude_place_ids: []",
    pass,
    "Sneaky re-revert restores hardcoded [] and silently breaks recycle. Window-scoped check.",
  );
}

// §A.2 — Mobile code MUST NOT bypass the lock RPC by writing is_locked directly.
// (Mobile clients writing is_locked = true would bypass the cascade trigger
// + auth gate + system message generation. Production RLS blocks this but we
// catch attempted bypasses at the source level too.)
{
  const allMobileFiles = [
    boardSessionService,
    swipeable,
    sessionViewModal,
    boardDiscussionTab,
    collabSessions,
    schedSheet,
    lockedBanner,
  ];
  const violations = allMobileFiles
    .filter((src) => src)
    .filter((src) =>
      /\.update\(\s*\{\s*is_locked\s*:\s*true/.test(src),
    );
  check(
    "§A.2 — No mobile component bypasses rpc_admin_lock_card by writing is_locked directly",
    violations.length === 0,
    `Found ${violations.length} mobile files attempting direct is_locked write — must route through RPC.`,
  );
}

// §A.3 — Mobile code MUST NOT bypass the schedule RPC by multi-row updating
// calendar_entries.scheduled_at directly (broadcasting a schedule to all
// participants must go through the SECURITY DEFINER RPC; per-user reschedule
// via CalendarService.updateEntry remains fine).
{
  // Look for `.from('calendar_entries')...update({...scheduled_at` patterns
  // that DON'T use the SECURITY DEFINER RPC. The exact patterns to flag:
  //   - any .update() on calendar_entries that includes scheduled_at AND
  //     doesn't have user_id = currentUserId filter (multi-row update)
  // CalendarService.updateEntry enforces user_id match — see services/calendarService.ts.
  // We're only checking that NO new code introduces a multi-row scheduled_at
  // update path outside the RPC. The boardSessionService.scheduleLockedCard
  // calls the RPC (no direct UPDATE), so it should pass.
  const allMobileFiles = [
    boardSessionService,
    swipeable,
    sessionViewModal,
    boardDiscussionTab,
    schedSheet,
  ];
  // Find any direct .update with scheduled_at NOT preceded by user_id filter
  // within 600 chars. Heuristic but catches the obvious bypass.
  const violations = allMobileFiles.filter((src) => {
    if (!src) return false;
    const updateMatch = src.match(/\.update\([^)]*scheduled_at[^)]*\)/g);
    if (!updateMatch) return false;
    // For each match, check upstream context for user_id filter
    for (const m of updateMatch) {
      const idx = src.indexOf(m);
      const before = src.slice(Math.max(0, idx - 600), idx);
      if (!/\.eq\(['"]user_id['"]/.test(before)) {
        return true;
      }
    }
    return false;
  });
  check(
    "§A.3 — No mobile component performs multi-row UPDATE on calendar_entries.scheduled_at outside the RPC",
    violations.length === 0,
    `Found ${violations.length} files with potential multi-row scheduled_at write bypassing rpc_admin_schedule_locked_card.`,
  );
}

// =====================================================================
// §B — AUTH PREDICATE — must use OR, never AND (typo would lock out everyone)
// =====================================================================

// §B.1 — All three new RPCs must use the OR predicate (creator OR is_admin).
// An AND typo would make the gate require both — and the creator is rarely
// also a session_participants row with is_admin=true, so AND breaks every
// lock/schedule/recycle call in production.
{
  const rpcAuthPattern = /cs\.created_by = v_uid OR COALESCE\(sp\.is_admin, false\) = true/g;
  const occurrences = (migration?.match(rpcAuthPattern) || []).length;
  check(
    "§B.1 — Auth predicate uses OR (3 occurrences across 3 RPCs); no AND typo",
    occurrences === 3 && !/cs\.created_by = v_uid AND COALESCE\(sp\.is_admin, false\) = true/.test(migration || ""),
    `Expected 3 OR-based auth predicates; found ${occurrences}. AND would lock out all callers.`,
  );
}

// §B.2 — Defense in depth: each RPC must also raise 'authentication required'
// when auth.uid() returns NULL (catches service-role / anon callers BEFORE
// any other branch).
{
  const pattern = /IF v_uid IS NULL THEN[\s\S]+?RAISE EXCEPTION 'ORCH-0908: authentication required'/g;
  const occurrences = (migration?.match(pattern) || []).length;
  check(
    "§B.2 — All 3 RPCs raise 'authentication required' when auth.uid() IS NULL",
    occurrences === 3,
    `Expected 3 IS NULL raises; found ${occurrences}. Defense-in-depth must be uniform across all RPCs.`,
  );
}

// =====================================================================
// §C — GUC mechanics — FAILS-ON-REVERT KEY (different angle than implementor's)
// =====================================================================

// §C.1 (FAILS-ON-REVERT KEY) — set_config('orch_0908.force_recycle', 'true', true)
// MUST use third arg `true` (transaction-local). A false third arg leaks
// the GUC across transactions on the same connection, which under Supabase
// pooling means concurrent sessions could all see force_recycle=true and the
// ORCH-0902 trigger would never recompute hashes correctly. Silent corruption.
//
// This is a DIFFERENT angle than implementor's T-IMPL-07 (discover-cards
// excludes wiring). Reverting T-IMPL-07 breaks recycle CONTENT;
// reverting C.1 breaks recycle ISOLATION across concurrent sessions.
{
  const pass =
    !!migration &&
    /set_config\(\s*'orch_0908\.force_recycle'\s*,\s*'true'\s*,\s*true\s*\)/.test(migration) &&
    // Negative assertion: never set with is_local=false
    !/set_config\(\s*'orch_0908\.force_recycle'\s*,\s*'true'\s*,\s*false\s*\)/.test(migration);
  check(
    "§C.1 (FAILS-ON-REVERT KEY) — set_config(orch_0908.force_recycle, 'true', true) — third arg MUST be true (transaction-local)",
    pass,
    "If is_local=false, the GUC leaks across transactions on pooled connections and ORCH-0902 trigger never recomputes correctly. SILENT CORRUPTION.",
  );
}

// §C.2 — set_config must be called BEFORE the UPDATE collaboration_sessions
// statement inside rpc_force_deck_recycle. Setting it after would let the
// trigger fire with the GUC clean and overwrite the recycle hash.
{
  const pass = !!migration && (() => {
    // Find the rpc_force_deck_recycle function body
    const fnStart = migration.indexOf("FUNCTION public.rpc_force_deck_recycle");
    if (fnStart < 0) return false;
    const fnBody = migration.slice(fnStart, fnStart + 4000);
    const setConfigIdx = fnBody.indexOf("set_config('orch_0908.force_recycle'");
    const updateIdx = fnBody.indexOf("UPDATE public.collaboration_sessions");
    return setConfigIdx > 0 && updateIdx > 0 && setConfigIdx < updateIdx;
  })();
  check(
    "§C.2 — set_config() called BEFORE UPDATE collaboration_sessions in rpc_force_deck_recycle",
    pass,
    "Order matters: GUC must be set before the UPDATE so the trigger fires with force_recycle=true and short-circuits.",
  );
}

// §C.3 — recompute trigger must check the GUC BEFORE pg_trigger_depth()
// — if pg_trigger_depth check fires first on the recursive self-update, the
// GUC check becomes effectively unreachable for the inner call and the
// hash gets overwritten. Order matters.
{
  const pass = !!migration && (() => {
    const fnMatch = migration.match(/FUNCTION public\.recompute_deck_version_after_prefs_change\(\)[\s\S]+?BEGIN([\s\S]+?)END;/);
    if (!fnMatch) return false;
    const body = fnMatch[1];
    const gucIdx = body.indexOf("current_setting('orch_0908.force_recycle'");
    const depthIdx = body.indexOf("pg_trigger_depth()");
    return gucIdx > 0 && depthIdx > 0 && gucIdx < depthIdx;
  })();
  check(
    "§C.3 — GUC check appears BEFORE pg_trigger_depth() in recompute_deck_version_after_prefs_change",
    pass,
    "Order matters: GUC check must come first so the recycle-aware hash sticks.",
  );
}

// =====================================================================
// §D — Cross-RPC consistency
// =====================================================================

// §D.1 — All three RPCs declare SECURITY DEFINER + search_path
{
  const rpcNames = [
    "rpc_admin_lock_card",
    "rpc_admin_schedule_locked_card",
    "rpc_force_deck_recycle",
  ];
  const issues = [];
  for (const fn of rpcNames) {
    const fnMatch = migration?.match(
      new RegExp(`FUNCTION public\\.${fn}\\([^)]*\\)[\\s\\S]+?\\$\\$`),
    );
    if (!fnMatch) {
      issues.push(`${fn}: function block not found`);
      continue;
    }
    const header = fnMatch[0];
    if (!/SECURITY DEFINER/.test(header)) issues.push(`${fn}: missing SECURITY DEFINER`);
    if (!/SET search_path/.test(header)) issues.push(`${fn}: missing SET search_path`);
  }
  check(
    "§D.1 — All 3 RPCs declare SECURITY DEFINER + SET search_path",
    issues.length === 0,
    issues.join("; ") || "OK",
  );
}

// =====================================================================
// §E — ORCH-0902 trigger amendment INVARIANT preservation
// =====================================================================

// §E.1 — The amendment must preserve the recursion guard (pg_trigger_depth > 1).
// If a future "cleanup" deletes this branch while keeping the GUC check, the
// recycle self-UPDATE recurses infinitely.
{
  const pass = !!migration &&
    /CREATE OR REPLACE FUNCTION public\.recompute_deck_version_after_prefs_change/.test(migration) &&
    /IF pg_trigger_depth\(\) > 1 THEN[\s\S]+?RETURN NULL/.test(migration);
  check(
    "§E.1 — Trigger amendment preserves pg_trigger_depth() > 1 recursion guard",
    pass,
    "Deleting this guard while keeping the GUC short-circuit causes infinite recursion on self-UPDATE.",
  );
}

// §E.2 — The amendment must preserve the hash-diff short-circuit
// (`v_new_hash IS NOT DISTINCT FROM NEW.deck_params_hash RETURN NULL`).
// Without it, normal participant_prefs updates would mint duplicate versions.
{
  const pass = !!migration &&
    /v_new_hash IS NOT DISTINCT FROM NEW\.deck_params_hash[\s\S]+?RETURN NULL/.test(migration);
  check(
    "§E.2 — Trigger amendment preserves hash-diff short-circuit (no spurious mints)",
    pass,
    "Removing this short-circuit causes V_n+1 to mint on EVERY trigger fire, not just on real param changes.",
  );
}

// §E.3 — The amendment must still INSERT into session_deck_versions
// (CR-4 resume support — ORCH-0902 invariant).
{
  // Capture the BODY between AS $$ and the closing $$ (dollar-quoted block).
  const pass = !!migration &&
    (() => {
      const fnMatch = migration.match(
        /FUNCTION public\.recompute_deck_version_after_prefs_change\(\)[\s\S]+?AS \$\$([\s\S]+?)\$\$;/,
      );
      if (!fnMatch) return false;
      return /INSERT INTO public\.session_deck_versions/.test(fnMatch[1]);
    })();
  check(
    "§E.3 — Trigger amendment preserves session_deck_versions INSERT (CR-4 resume)",
    pass,
    "Without history INSERT, CR-4 deck resume on cold start breaks.",
  );
}

// =====================================================================
// §F — Cross-file consistency: notify-session-lock body shape
// =====================================================================

// §F.1 — Edge function destructures { sessionId, savedCardId, event, scheduledAtIso }.
// Mobile call sites (SwipeableSessionCards for card_locked, scheduling sheet for
// plan_scheduled) must use matching field names — JS property-name typos here
// would silently break push notifications.
{
  // From the edge fn body
  const edgeFnDestructure =
    !!notifyLock &&
    /const \{ sessionId, savedCardId, event(?:, scheduledAtIso)? \} = body/.test(notifyLock);

  // Mobile call site 1: SwipeableSessionCards (card_locked)
  const swipeableCall =
    !!swipeable &&
    /invoke\("notify-session-lock"[\s\S]+?body:[\s\S]+?\{[\s\S]+?sessionId[\s\S]+?savedCardId[\s\S]+?event:\s*"card_locked"/.test(swipeable);

  // Mobile call site 2: scheduling sheet (plan_scheduled with scheduledAtIso)
  const sheetCall =
    !!schedSheet &&
    /invoke\("notify-session-lock"[\s\S]+?body:[\s\S]+?\{[\s\S]+?sessionId[\s\S]+?savedCardId[\s\S]+?event:\s*"plan_scheduled"[\s\S]+?scheduledAtIso/.test(schedSheet);

  check(
    "§F.1 — notify-session-lock body shapes consistent across edge fn + 2 mobile call sites",
    edgeFnDestructure && swipeableCall && sheetCall,
    `edge=${edgeFnDestructure}, swipeable_card_locked=${swipeableCall}, sheet_plan_scheduled=${sheetCall}. Field-name drift here silently breaks push.`,
  );
}

// §F.2 — Edge fn must guard against missing scheduledAtIso when event='plan_scheduled'
{
  const pass =
    !!notifyLock &&
    /event === "plan_scheduled" && !scheduledAtIso[\s\S]+?return jsonResponse/.test(notifyLock);
  check(
    "§F.2 — notify-session-lock returns 400 when event=plan_scheduled without scheduledAtIso",
    pass,
    "Missing input guard would NaN-format the date and send garbage push.",
  );
}

// §F.3 — Edge fn must exclude the actor from recipient list (`.neq('user_id', user.id)`)
{
  const pass =
    !!notifyLock &&
    /\.neq\(\s*["']user_id["']\s*,\s*user\.id\s*\)/.test(notifyLock);
  check(
    "§F.3 — notify-session-lock excludes the actor from recipient list (no self-push)",
    pass,
    "Pushing the locker their own action is annoying + confusing.",
  );
}

// =====================================================================
// §G — Audit metadata: admin lock writes locked_by_consensus=false
// =====================================================================

// §G.1 — rpc_admin_lock_card writes locked_by_consensus=false (distinguishes
// from check_card_lock_in's locked_by_consensus=true for audit/analytics).
{
  const pass = !!migration && (() => {
    const fnMatch = migration.match(
      /FUNCTION public\.rpc_admin_lock_card\([^)]*\)[\s\S]+?AS \$\$([\s\S]+?)\$\$;/,
    );
    if (!fnMatch) return false;
    return /UPDATE public\.board_saved_cards[\s\S]+?locked_by_consensus = false/.test(fnMatch[1]);
  })();
  check(
    "§G.1 — rpc_admin_lock_card writes locked_by_consensus=false (audit distinction from gang-consensus)",
    pass,
    "Both lock paths set is_locked=true; the consensus flag is the audit/analytics differentiator.",
  );
}

// §G.2 — check_card_lock_in (gang-consensus) is NOT modified by this migration
// (it's a separate, parallel path that must remain intact per Q-A operator
// decision to keep both lock paths).
{
  const pass = !!migration &&
    !/CREATE OR REPLACE FUNCTION public\.check_card_lock_in/.test(migration);
  check(
    "§G.2 — ORCH-0908 migration does NOT modify check_card_lock_in (gang-consensus path preserved)",
    pass,
    "Operator Q-A decided to keep both lock paths. Migration must not redefine check_card_lock_in.",
  );
}

// =====================================================================
// §H — Constitution #9 — banner data fabrication guard
// =====================================================================

// §H.1 — LockedPlanBanner returns null when scheduledAtIso is missing
{
  const pass =
    !!lockedBanner &&
    /if \(!cardTitle \|\| !formattedDate\) \{\s*return null/.test(lockedBanner);
  check(
    "§H.1 — LockedPlanBanner returns null when title OR scheduled date missing (no placeholder rendering)",
    pass,
    "Constitution #9 — must not fabricate display when underlying data is incomplete.",
  );
}

// §H.2 — LockedPlanBanner formats date in user's local timezone
// (Intl.DateTimeFormat with no fixed timeZone). SC-10 / per-user TZ handling.
{
  const pass =
    !!lockedBanner &&
    /toLocaleString\(undefined,/.test(lockedBanner) &&
    !/timeZone:\s*['"]UTC['"]/.test(lockedBanner);
  check(
    "§H.2 — Banner formats date in user's local TZ (not hardcoded UTC)",
    pass,
    "Each participant must see the scheduled time in their own timezone.",
  );
}

// =====================================================================
// §I — Schedule RPC place_pool NULL-handling
// =====================================================================

// §I.1 — Schedule RPC handles NULL v_card_place_id gracefully (cards from
// non-place sources like business events would have no place_pool match)
{
  const pass = !!migration &&
    /IF v_card_place_id IS NULL THEN[\s\S]+?v_new_deck_version := public\.rpc_force_deck_recycle\(p_session_id, '\{\}'::uuid\[\]\)/.test(migration);
  check(
    "§I.1 — Schedule RPC handles NULL place_pool lookup (cycles without exclude)",
    pass,
    "Non-place cards (e.g., business events) have no place_pool row — must still cycle deck.",
  );
}

// =====================================================================
// §J — Schedule message format
// =====================================================================

// §J.1 — Schedule system message includes both formatted date AND time
{
  const pass = !!migration &&
    /to_char\(p_scheduled_at AT TIME ZONE 'UTC', 'Mon DD, HH24:MI'\)/.test(migration);
  check(
    "§J.1 — Schedule system message uses Mon DD, HH24:MI format (date + time)",
    pass,
    "Without time, participants can't plan around the event.",
  );
}

// =====================================================================
// Report
// =====================================================================

const failed = checks.filter((c) => !c.pass);
console.log(`\nORCH-0908 ADVERSARIAL regression check — ${checks.length} assertions\n`);
for (const c of checks) {
  console.log(`  ${c.pass ? "✅" : "❌"}  ${c.name}`);
  if (!c.pass) {
    console.log(`      ${c.detail}`);
  }
}
console.log(`\n${checks.length - failed.length}/${checks.length} PASS\n`);

if (failed.length > 0) {
  console.error(`FAIL — ${failed.length} assertion(s) failed. Exit 1.`);
  process.exit(1);
}
console.log("PASS — all adversarial assertions met. Different angles than implementor's regression.");
process.exit(0);
