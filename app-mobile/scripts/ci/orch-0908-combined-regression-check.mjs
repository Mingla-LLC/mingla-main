#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0908 COMBINED rework regression check (2026-05-21).
 *
 * Asserts the FINAL architecture after the operator-driven UX rework:
 *
 *   §C-1. Single atomic combined RPC: rpc_admin_lock_and_schedule_card.
 *         Old split RPCs (rpc_admin_lock_card + rpc_admin_schedule_locked_card)
 *         are DROPPED in migration 20260629000000.
 *
 *   §C-2. Chat message attributed to the locker (sender_id = v_uid, not NULL).
 *         message_type='card'. card_payload carries the saved_card.card_data
 *         + scheduled_at + duration_minutes + locker_user_id + event.
 *
 *   §C-3. SwipeableSessionCards "Lock it in" button opens the scheduling
 *         sheet WITHOUT firing any RPC. The atomic RPC fires only after
 *         the two-step (pick → summary confirm) in the sheet.
 *
 *   §C-4. LockedCardSchedulingSheet two-step: step='pick' shows the date
 *         picker; step='summary' shows locker name + card title + picked
 *         date/time + Confirm + Pick-different-time buttons.
 *
 *   §C-5. SessionViewModal.loadSavedCards filters is_locked=false (locked
 *         cards disappear from the active swipe list).
 *
 *   §C-6. useSocialRealtime auto-adds collab calendar_entries to the
 *         user's device calendar on realtime receipt (silent; "Add to
 *         Calendar" button is the per-participant fallback).
 *
 *   §C-7. boardSessionService exposes lockAndScheduleCard; old
 *         lockCardManually + scheduleLockedCard methods removed.
 *
 *   §C-8. notify-session-lock handles only 'plan_scheduled' (card_locked
 *         event removed — lock and schedule are atomic now).
 *
 *   §C-9. SessionViewModal no longer mounts LockedCardSchedulingSheet
 *         (sheet moved to SwipeableSessionCards) + no Plan Locked In modal.
 *
 * Supersedes the earlier orch-0908-regression-check.mjs +
 * orch-0908-adversarial-check.mjs assertions about the split-RPC
 * architecture. Those older checks remain in the repo as historical
 * audit trail — they assert what migration 20260626000000 SHIPPED, which
 * remains true at the file level (the later migration drops those
 * functions, but the migration file content is unchanged).
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

const combinedMigration = read(
  "supabase/migrations/20260629000000_orch_0908_combined_lock_schedule.sql",
);
const boardSessionService = read("app-mobile/src/services/boardSessionService.ts");
const schedSheet = read(
  "app-mobile/src/components/session/LockedCardSchedulingSheet.tsx",
);
const swipeable = read("app-mobile/src/components/board/SwipeableSessionCards.tsx");
const sessionViewModal = read("app-mobile/src/components/SessionViewModal.tsx");
const socialRealtime = read("app-mobile/src/hooks/useSocialRealtime.ts");
const notifyLock = read("supabase/functions/notify-session-lock/index.ts");

// ── §C-1: combined RPC + drops ──────────────────────────────────────────

check(
  "§C-1.1 — combined migration file exists",
  !!combinedMigration,
  "supabase/migrations/20260629000000_orch_0908_combined_lock_schedule.sql",
);

check(
  "§C-1.2 — migration DROPs rpc_admin_lock_card + rpc_admin_schedule_locked_card",
  !!combinedMigration &&
    /DROP FUNCTION IF EXISTS public\.rpc_admin_lock_card\(uuid, uuid\)/.test(combinedMigration) &&
    /DROP FUNCTION IF EXISTS public\.rpc_admin_schedule_locked_card\(uuid, uuid, timestamptz, int\)/.test(combinedMigration),
  "Both old RPCs must be DROPped — they're replaced by the combined RPC.",
);

check(
  "§C-1.3 — migration CREATEs rpc_admin_lock_and_schedule_card",
  !!combinedMigration &&
    /CREATE OR REPLACE FUNCTION public\.rpc_admin_lock_and_schedule_card\(/.test(combinedMigration) &&
    /p_session_id uuid,\s*p_saved_card_id uuid,\s*p_scheduled_at timestamptz,\s*p_duration_minutes int/.test(combinedMigration),
  "Combined RPC must be defined with the full 4-param signature.",
);

check(
  "§C-1.4 — combined RPC is SECURITY DEFINER with auth gate + idempotency reject",
  !!combinedMigration &&
    /SECURITY DEFINER/.test(combinedMigration) &&
    /IF v_uid IS NULL THEN[\s\S]+?RAISE EXCEPTION 'ORCH-0908: authentication required'/.test(combinedMigration) &&
    /cs\.created_by = v_uid OR COALESCE\(sp\.is_admin, false\) = true/.test(combinedMigration) &&
    /IF v_already_locked = true THEN[\s\S]+?RAISE EXCEPTION 'ORCH-0908: card is already locked/.test(combinedMigration),
  "Combined RPC must have full auth gate + reject already-locked cards.",
);

// ── §C-2: chat message attributed to locker, type=card ──────────────────

check(
  "§C-2.1 — chat message INSERT uses sender_id = v_uid (not NULL) + message_type='card'",
  !!combinedMigration &&
    (() => {
      const fnMatch = combinedMigration.match(
        /FUNCTION public\.rpc_admin_lock_and_schedule_card\([^)]*\)[\s\S]+?AS \$\$([\s\S]+?)\$\$;/,
      );
      if (!fnMatch) return false;
      const body = fnMatch[1];
      // The message INSERT must use v_uid (the actual locker) and 'card' type
      return (
        /INSERT INTO public\.messages[\s\S]+?VALUES \([\s\S]+?v_uid,[\s\S]+?'card'/.test(body) &&
        // Negative: must NOT use NULL as sender (system-message pattern dropped)
        !/INSERT INTO public\.messages[\s\S]+?VALUES \([\s\S]+?NULL,[\s\S]+?'text'/.test(body)
      );
    })(),
  "Chat message must be attributed to the locker (sender_id=v_uid) and use message_type='card' so MessageBubble renders it via ORCH-0667 card-bubble path.",
);

check(
  "§C-2.2 — card_payload carries card_data + scheduled_at + locker_user_id + event",
  !!combinedMigration &&
    /jsonb_build_object\([\s\S]+?'event', 'card_locked_and_scheduled'[\s\S]+?'card_data', v_card_data[\s\S]+?'scheduled_at', p_scheduled_at[\s\S]+?'locker_user_id', v_uid/.test(combinedMigration),
  "Card payload must include card_data + scheduled_at + locker_user_id + event so the chat renderer can show the right preview + locker attribution.",
);

// ── §C-3: SwipeableSessionCards Lock-it-in opens sheet (no RPC) ─────────

check(
  "§C-3.1 — SwipeableSessionCards handleLockIn does NOT call BoardSessionService directly",
  !!swipeable &&
    !/handleLockIn[\s\S]+?BoardSessionService\.(lockCardManually|lockAndScheduleCard)/.test(swipeable) &&
    /const \[cardToLock, setCardToLock\] = useState<SavedCard \| null>/.test(swipeable),
  "Lock-it-in button must NOT fire an RPC on tap; it must open the scheduling sheet via setCardToLock state.",
);

check(
  "§C-3.2 — SwipeableSessionCards mounts LockedCardSchedulingSheet locally",
  !!swipeable &&
    /import LockedCardSchedulingSheet from ['"]\.\.\/session\/LockedCardSchedulingSheet['"]/.test(swipeable) &&
    /<LockedCardSchedulingSheet[\s\S]+?cardData=\{cardToLock\.card_data/.test(swipeable),
  "Sheet mount must live inside SwipeableSessionCards so the per-card cardData is in scope.",
);

// ── §C-4: scheduling sheet two-step ──────────────────────────────────────

check(
  "§C-4.1 — LockedCardSchedulingSheet has Step type='pick' | 'summary' + two-step state machine",
  !!schedSheet &&
    /type Step = ['"]pick['"] \| ['"]summary['"]/.test(schedSheet) &&
    /const \[step, setStep\] = useState<Step>\(['"]pick['"]\)/.test(schedSheet) &&
    /setStep\(['"]summary['"]\)/.test(schedSheet),
  "Sheet must transition pick → summary; user does not lock until summary Confirm.",
);

check(
  "§C-4.2 — summary step shows locker name + Confirm button + Pick-different-time button",
  !!schedSheet &&
    /Locked in by/.test(schedSheet) &&
    /Confirm lock in/.test(schedSheet) &&
    /Pick a different time/.test(schedSheet),
  "Summary screen must clearly state who's locking, give a final confirm, and let user back out.",
);

check(
  "§C-4.3 — sheet only calls combined RPC on Confirm (not on date pick)",
  !!schedSheet &&
    (() => {
      // Extract the body of handleDatePicked specifically.
      const m = schedSheet.match(
        /const handleDatePicked = useCallback\(\([^)]*\) =>[\s\S]+?\}, \[[^\]]*\]\);/,
      );
      if (!m) return false;
      const datePickedBody = m[0];
      const confirmCallsRpc = /handleConfirm[\s\S]+?BoardSessionService\.lockAndScheduleCard/.test(schedSheet);
      const datePickedDoesntCallRpc =
        !/BoardSessionService\.lockAndScheduleCard/.test(datePickedBody);
      return confirmCallsRpc && datePickedDoesntCallRpc;
    })(),
  "RPC must fire from handleConfirm (summary step), NOT from handleDatePicked (pick step).",
);

// ── §C-5: locked cards disappear from saved list ────────────────────────

check(
  "§C-5.1 — SessionViewModal.loadSavedCards filters .eq('is_locked', false)",
  !!sessionViewModal &&
    /\.from\(['"]board_saved_cards['"]\)[\s\S]+?\.eq\(['"]is_locked['"], false\)/.test(sessionViewModal),
  "Locked cards must be filtered out so they disappear from the active swipe list.",
);

// ── §C-6: useSocialRealtime auto-add to device calendar ─────────────────

check(
  "§C-6.1 — useSocialRealtime auto-adds collab calendar_entries on realtime",
  !!socialRealtime &&
    /import \{ DeviceCalendarService \}/.test(socialRealtime) &&
    /import \{ CalendarService \}/.test(socialRealtime) &&
    /row\.source === ['"]collaboration['"][\s\S]+?row\.scheduled_at[\s\S]+?!row\.device_calendar_event_id/.test(socialRealtime) &&
    /DeviceCalendarService\.addEventToDeviceCalendar/.test(socialRealtime) &&
    /CalendarService\.updateEntry\(row\.id, userId, \{[\s\S]+?device_calendar_event_id: deviceEventId/.test(socialRealtime),
  "Realtime calendar_entries handler must opportunistically write to device calendar + persist device_calendar_event_id when (collab + scheduled + not-yet-added).",
);

// ── §C-7: boardSessionService combined method ───────────────────────────

check(
  "§C-7.1 — boardSessionService exposes lockAndScheduleCard (and drops old methods)",
  !!boardSessionService &&
    /static async lockAndScheduleCard\(/.test(boardSessionService) &&
    /rpc_admin_lock_and_schedule_card/.test(boardSessionService) &&
    !/static async lockCardManually\(/.test(boardSessionService) &&
    !/static async scheduleLockedCard\(/.test(boardSessionService),
  "Service must expose only the combined method; the split methods must be removed.",
);

// ── §C-8: notify-session-lock single event ──────────────────────────────

check(
  "§C-8.1 — notify-session-lock comment + handling reflects single plan_scheduled event",
  !!notifyLock &&
    /Single event variant/.test(notifyLock) &&
    /event === ['"]plan_scheduled['"]/.test(notifyLock),
  "Lock and schedule are atomic now — only one event variant should remain.",
);

// ── §C-9: SessionViewModal no longer hosts the sheet/modal ──────────────

check(
  "§C-9.1 — SessionViewModal does NOT import LockedCardSchedulingSheet (moved to SwipeableSessionCards)",
  !!sessionViewModal &&
    !/import LockedCardSchedulingSheet from/.test(sessionViewModal),
  "Sheet moved out of SessionViewModal; should not be imported here anymore.",
);

check(
  "§C-9.2 — SessionViewModal does NOT render the Plan Locked In modal (JSX + styles removed)",
  !!sessionViewModal &&
    // Negative: no actual rendered string. The literal "Plan Locked In!" as
    // a JSX text node (e.g., <Text...>Plan Locked In!</Text>). Comments
    // mentioning the removed feature for traceability are fine.
    !/>Plan Locked In!</.test(sessionViewModal) &&
    // Negative: no consumer of the old calendarPromptTitle/calendarPromptCard
    // style — i.e., no `styles.calendarPrompt` JSX reference. The style
    // definitions themselves were also removed.
    !/styles\.calendarPrompt/.test(sessionViewModal),
  "Plan Locked In modal removed — chat card message + chat banner + auto-add are the announcement vectors now.",
);

// ── Report ──────────────────────────────────────────────────────────────

const failed = checks.filter((c) => !c.pass);
console.log(`\nORCH-0908 COMBINED rework regression check — ${checks.length} assertions\n`);
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
console.log("PASS — all combined-rework assertions met.");
process.exit(0);
