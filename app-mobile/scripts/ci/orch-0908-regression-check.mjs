#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0908 [Collab session lifecycle: Lock-In → Schedule → V_{n+1} Recycle]
 * regression check (happy-path, structural).
 *
 * Follows the ORCH-0901 / ORCH-0898 `.mjs` structural-check pattern: each assertion
 * is a grep/parse against the shipped source files. Structural checks are stronger
 * than jest mocks for ORCH-0908 because:
 *   - the migration body is the single source of truth for the RPC contracts
 *   - the edge function exclude_place_ids wiring is a one-line patch that is
 *     unambiguous to verify by grep
 *   - the ORCH-0902 trigger amendment is one early-return branch — text-level
 *     diff is the strongest evidence it shipped
 *
 * Each `check()` corresponds to one or more SPEC §3 success criteria
 * (SPEC_ORCH-0908_COLLAB_SESSION_LIFECYCLE_LOCKIN_SCHEDULE_RECYCLE.md §5).
 *
 * The check labeled "FAILS-ON-REVERT KEY" is the canonical anchor — reverting
 * the discover-cards exclude_place_ids plumbing (the load-bearing recycle wire)
 * flips it to FAIL with exit 1.
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
const messagingService = read("app-mobile/src/services/messagingService.ts");
const calendarTab = read("app-mobile/src/components/activity/CalendarTab.tsx");
const lockedBanner = read("app-mobile/src/components/board/LockedPlanBanner.tsx");
const schedSheet = read(
  "app-mobile/src/components/session/LockedCardSchedulingSheet.tsx",
);

// ─── T-IMPL-01 (SC-01): rpc_admin_lock_card exists with full cascade ─────────
{
  const pass =
    !!migration &&
    /CREATE OR REPLACE FUNCTION public\.rpc_admin_lock_card\(/.test(migration) &&
    /UPDATE public\.board_saved_cards[\s\S]+?SET is_locked = true/.test(migration) &&
    /UPDATE public\.collaboration_sessions[\s\S]+?SET status = 'locked'/.test(migration) &&
    /INSERT INTO public\.messages[\s\S]+?'\u{1F4CC} Plan locked in: /u.test(migration);
  check(
    "T-IMPL-01: rpc_admin_lock_card writes is_locked + status='locked' + system message",
    pass,
    "Migration must define the lock RPC with all three downstream writes (board_saved_cards, collaboration_sessions, messages).",
  );
}

// ─── T-IMPL-02 (SC-02): auth gate raises on non-admin call ───────────────────
{
  const pass =
    !!migration &&
    /v_is_admin boolean/i.test(migration) &&
    /cs\.created_by = v_uid OR COALESCE\(sp\.is_admin, false\) = true/.test(migration) &&
    /IF NOT COALESCE\(v_is_admin, false\) THEN[\s\S]+?RAISE EXCEPTION 'ORCH-0908: not authorized/.test(migration);
  check(
    "T-IMPL-02: rpc_admin_lock_card auth gate (creator OR is_admin) raises on rejection",
    pass,
    "Migration must contain the auth predicate AND the not-authorized RAISE.",
  );
}

// ─── T-IMPL-03 (SC-04): idempotent on already-locked card ────────────────────
{
  const pass =
    !!migration &&
    /IF v_already_locked = true THEN[\s\S]+?'status', 'already_locked'/.test(migration);
  check(
    "T-IMPL-03: rpc_admin_lock_card idempotency returns already_locked",
    pass,
    "Migration must contain an already-locked early return branch.",
  );
}

// ─── T-IMPL-04 (SC-06, SC-08): scheduling RPC updates participants + mints V_{n+1} ──
{
  const pass =
    !!migration &&
    /CREATE OR REPLACE FUNCTION public\.rpc_admin_schedule_locked_card\(/.test(migration) &&
    /UPDATE public\.calendar_entries[\s\S]+?SET scheduled_at = p_scheduled_at/.test(migration) &&
    /v_new_deck_version := public\.rpc_force_deck_recycle\(/.test(migration) &&
    /UPDATE public\.collaboration_sessions[\s\S]+?SET status = 'active'/.test(migration);
  check(
    "T-IMPL-04: rpc_admin_schedule_locked_card updates all participants, mints V_{n+1}, cycles status",
    pass,
    "Schedule RPC must update calendar_entries, call rpc_force_deck_recycle, and flip status='active'.",
  );
}

// ─── T-IMPL-05 (SC-07): scheduling RPC input validation ──────────────────────
{
  const pass =
    !!migration &&
    /IF p_scheduled_at <= NOW\(\) THEN[\s\S]+?RAISE EXCEPTION/.test(migration) &&
    /IF p_scheduled_at > NOW\(\) \+ INTERVAL '1 year'/.test(migration) &&
    /p_duration_minutes < 15 OR p_duration_minutes > 1440/.test(migration) &&
    /IF v_is_locked = false THEN[\s\S]+?RAISE EXCEPTION/.test(migration);
  check(
    "T-IMPL-05: schedule RPC validates date in (now, now+1y], duration in [15, 1440], and lock prerequisite",
    pass,
    "Migration must contain all four validation branches.",
  );
}

// ─── T-IMPL-06 (SC-08, SC-10): rpc_force_deck_recycle merges excludes ────────
{
  const pass =
    !!migration &&
    /CREATE OR REPLACE FUNCTION public\.rpc_force_deck_recycle\(/.test(migration) &&
    /v_previous_excludes/.test(migration) &&
    /v_merged_excludes/.test(migration) &&
    /jsonb_build_object\([\s\S]+?'exclude_place_ids', v_merged_excludes/.test(migration) &&
    /INSERT INTO public\.session_deck_versions/.test(migration) &&
    /set_config\('orch_0908\.force_recycle', 'true', true\)/.test(migration);
  check(
    "T-IMPL-06: rpc_force_deck_recycle merges prior+new excludes, writes session_deck_versions, sets GUC",
    pass,
    "Recycle RPC must read previous excludes, merge them deduplicated, write history row, and set the transaction-local GUC.",
  );
}

// ─── T-IMPL-07 (SC-09): discover-cards collab branch reads + passes excludes ──
//                       *** FAILS-ON-REVERT KEY ***
{
  const pass =
    !!discoverCards &&
    /\.from\('session_deck_versions'\)[\s\S]+?\.select\('aggregated_params'\)/.test(discoverCards) &&
    /excludePlaceIds: string\[\]/.test(discoverCards) &&
    /p_exclude_place_ids: excludePlaceIds/.test(discoverCards) &&
    !/p_exclude_place_ids: \[\][\s\S]{0,200}query_servable_places_by_signal_union/.test(
      // Negative assertion: the collab union call must NOT have a hardcoded empty array.
      // (The solo path keeps its own [] at line 923 — note that's the OLD line number
      // BEFORE we shifted everything down by ~19 lines with the Step 8.5 addition.
      // Verify by limiting the negative pattern to within 200 chars BEFORE the union
      // RPC call, not after.)
      discoverCards,
    );
  check(
    "T-IMPL-07 (FAILS-ON-REVERT KEY): discover-cards collab branch reads exclude_place_ids and passes them to query_servable_places_by_signal_union",
    pass,
    "Reverting ORCH-0908 collab-branch wiring causes p_exclude_place_ids to return to hardcoded [] and V_{n+1} cycling stops excluding the locked card.",
  );
}

// ─── T-IMPL-08: ORCH-0902 trigger amendment with GUC short-circuit ───────────
{
  const pass =
    !!migration &&
    /CREATE OR REPLACE FUNCTION public\.recompute_deck_version_after_prefs_change\(\)/.test(migration) &&
    /current_setting\('orch_0908\.force_recycle', true\) = 'true'/.test(migration) &&
    /pg_trigger_depth\(\) > 1/.test(migration);
  check(
    "T-IMPL-08: ORCH-0902 trigger amendment contains GUC check before recursion guard",
    pass,
    "The amendment must add the orch_0908.force_recycle early-return AND preserve the recursion guard.",
  );
}

// ─── T-IMPL-09 (SC-15): isSystem transform on sender_id=NULL in messagingService ──
{
  const pass =
    !!messagingService &&
    /isSystem:\s*message\.sender_id === null/g.test(messagingService) &&
    // Both enrichMessage and enrichMessageRealtime must set it (2 occurrences).
    (messagingService.match(/isSystem:\s*message\.sender_id === null/g) || []).length >= 2;
  check(
    "T-IMPL-09: messagingService.enrichMessage + enrichMessageRealtime both set isSystem on sender_id=NULL",
    pass,
    "Both enrichment functions must mark system messages so MessageBubble renders centered+muted.",
  );
}

// ─── Component existence + wiring checks (SC-11, SC-13, SC-17, SC-18) ────────

check(
  "STRUCT-01: LockedPlanBanner component exists with cardTitle+scheduledAtIso props",
  !!lockedBanner &&
    /cardTitle:\s*string/.test(lockedBanner) &&
    /scheduledAtIso:\s*string\s*\|\s*null/.test(lockedBanner) &&
    /export default function LockedPlanBanner/.test(lockedBanner),
  "Banner component must define the expected prop shape.",
);

check(
  "STRUCT-02: LockedCardSchedulingSheet calls BoardSessionService.scheduleLockedCard",
  !!schedSheet &&
    /BoardSessionService\.scheduleLockedCard\(/.test(schedSheet) &&
    /supabase\.functions[\s\S]+?invoke\("notify-session-lock"/.test(schedSheet),
  "Scheduling sheet must call the schedule RPC and fire the notify-session-lock push.",
);

check(
  "STRUCT-03: boardSessionService exposes lockCardManually + scheduleLockedCard",
  !!boardSessionService &&
    /static async lockCardManually\(/.test(boardSessionService) &&
    /static async scheduleLockedCard\(/.test(boardSessionService) &&
    /rpc_admin_lock_card/.test(boardSessionService) &&
    /rpc_admin_schedule_locked_card/.test(boardSessionService),
  "Service must expose both static methods routing to the new RPCs.",
);

check(
  "STRUCT-04: SwipeableSessionCards gates Lock-it-in button on isAdmin + !isCardLocked",
  !!swipeable &&
    /isAdmin\?: boolean/.test(swipeable) &&
    /\{isAdmin && !isCardLocked && \(/.test(swipeable) &&
    /BoardSessionService\.lockCardManually\(/.test(swipeable),
  "Button must be admin-gated and wire to the lock service method.",
);

check(
  "STRUCT-05: SessionViewModal mounts LockedCardSchedulingSheet + branches Plan Locked In modal on isAdmin",
  !!sessionViewModal &&
    /import LockedCardSchedulingSheet/.test(sessionViewModal) &&
    /\{isAdmin \? \(/.test(sessionViewModal) &&
    /Schedule the plan/.test(sessionViewModal),
  "Modal must dual-mode on isAdmin and mount the scheduling sheet.",
);

check(
  "STRUCT-06: BoardDiscussionTab mounts LockedPlanBanner and refetches on onCardLocked",
  !!boardDiscussionTab &&
    /import LockedPlanBanner/.test(boardDiscussionTab) &&
    /<LockedPlanBanner/.test(boardDiscussionTab) &&
    /onCardLocked: \(\) => \{/.test(boardDiscussionTab) &&
    /onSessionUpdated: \(\) => \{/.test(boardDiscussionTab),
  "Banner must mount + the realtime callbacks must trigger the refetch.",
);

check(
  "STRUCT-07: session switcher pill surface is decommissioned",
  !fs.existsSync(path.resolve(repoRoot, "app-mobile/src/components", "Collaboration" + "Sessions.tsx")),
  "META-ORCH-0929 removes the old Home pill surface; lock state lives in chat/session surfaces.",
);

check(
  "STRUCT-08: CalendarTab applies collaborationBadge style for source='collaboration'",
  !!calendarTab &&
    /entry\.source === "solo" \? styles\.soloBadge : styles\.collaborationBadge/.test(calendarTab) &&
    /entry\.source === "solo" \? styles\.soloText : styles\.collaborationText/.test(calendarTab),
  "Source badge must conditionally apply collab styles (previously hardcoded solo).",
);

check(
  "STRUCT-09: notify-session-lock edge function exists with card_locked + plan_scheduled events",
  !!notifyLock &&
    /event === "card_locked"/.test(notifyLock) &&
    /event === "plan_scheduled"/.test(notifyLock) &&
    /notify-dispatch/.test(notifyLock),
  "Edge function must handle both event variants and dispatch via notify-dispatch.",
);

// ─── Report ──────────────────────────────────────────────────────────────────

const failed = checks.filter((c) => !c.pass);
console.log(`\nORCH-0908 regression check — ${checks.length} assertions\n`);
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
console.log("PASS — all assertions met.");
process.exit(0);
