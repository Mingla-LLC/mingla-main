#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0908 HOTFIX bundle regression check (additive — leaves the original
 * orch-0908-regression-check.mjs immutable per ORCH-0840 append-only CI).
 *
 * Asserts three correctness boundaries shipped in the hotfix migration
 * `20260628000000_orch_0908_hotfix_calendar_trigger_dead_ref.sql` and the
 * accompanying mobile + admin + edge-fn cleanup:
 *
 *   §HF-A. calendar_entries.scheduled_at is now NULLABLE; trigger writes
 *          NULL + status='pending' (Constitution #9 — no fabricated dates).
 *
 *   §HF-B. rpc_admin_schedule_locked_card flips status='pending' → 'confirmed'
 *          atomically with the schedule write.
 *
 *   §HF-C. ALL board_session_preferences dead references removed across
 *          mobile + admin + edge functions, and reads of scheduled_at are
 *          NULL-safe.
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

const hotfixMigration = read(
  "supabase/migrations/20260628000000_orch_0908_hotfix_calendar_trigger_dead_ref.sql",
);
const curatedFn = read("supabase/functions/generate-curated-experiences/index.ts");
const realtimeService = read("app-mobile/src/services/realtimeService.ts");
const collabInviteSvc = read("app-mobile/src/services/collaborationInviteService.ts");
const preferencesSheet = read("app-mobile/src/components/PreferencesSheet.tsx");
const userMgmtAdmin = read("mingla-admin/src/pages/UserManagementPage.jsx");
const appStateMgr = read("app-mobile/src/components/AppStateManager.tsx");
const useCollabCal = read("app-mobile/src/hooks/useCollaborationCalendar.ts");

// =====================================================================
// §HF-A: schema NULLABLE + trigger writes NULL + status='pending'
// =====================================================================

check(
  "§HF-A.1 — hotfix migration file exists at expected path",
  !!hotfixMigration,
  "Migration must be at supabase/migrations/20260628000000_orch_0908_hotfix_calendar_trigger_dead_ref.sql",
);

check(
  "§HF-A.2 — ALTER calendar_entries.scheduled_at DROP NOT NULL",
  !!hotfixMigration &&
    /ALTER TABLE public\.calendar_entries[\s\S]+?ALTER COLUMN scheduled_at DROP NOT NULL/.test(hotfixMigration),
  "Migration must drop the NOT NULL on calendar_entries.scheduled_at so unscheduled collab rows can be NULL.",
);

check(
  "§HF-A.3 — create_calendar_entries_on_lock writes NULL + 'pending' (no placeholder, no dead-ref)",
  !!hotfixMigration &&
    (() => {
      const fnMatch = hotfixMigration.match(
        /FUNCTION public\.create_calendar_entries_on_lock\(\)[\s\S]+?AS \$\$([\s\S]+?)\$\$;/,
      );
      if (!fnMatch) return false;
      const body = fnMatch[1];
      // Look at the VALUES clause specifically: must contain 'pending' followed
      // by NULL on the next line (status='pending', scheduled_at=NULL). The
      // function's prose comments may mention 'confirmed' (e.g., "not confirmed"),
      // so only assert the absence of confirmed-as-a-VALUES literal.
      const valuesClauseMatch = body.match(/VALUES \([\s\S]+?\)/);
      const valuesClause = valuesClauseMatch ? valuesClauseMatch[0] : "";
      return (
        /'pending',\s*\n\s*NULL,/.test(valuesClause) &&
        !/'confirmed'/.test(valuesClause) &&
        !/NOW\(\) \+ INTERVAL '1 day'/.test(body) &&
        // Negative: must not contain the LEFT JOIN SQL on the dead table.
        // Comments mentioning "board_session_preferences" are fine
        // (intentionally document the removal — see hotfix migration header).
        !/LEFT JOIN public\.board_session_preferences/i.test(body) &&
        !/FROM\s+public\.board_session_preferences/i.test(body)
      );
    })(),
  "Trigger VALUES clause must INSERT status='pending' then scheduled_at=NULL; no placeholder NOW()+1day; no board_session_preferences ref.",
);

// =====================================================================
// §HF-B: schedule RPC atomically flips status='confirmed'
// =====================================================================

check(
  "§HF-B.1 — rpc_admin_schedule_locked_card writes status='confirmed' on UPDATE calendar_entries",
  !!hotfixMigration &&
    (() => {
      const fnMatch = hotfixMigration.match(
        /FUNCTION public\.rpc_admin_schedule_locked_card\([^)]*\)[\s\S]+?AS \$\$([\s\S]+?)\$\$;/,
      );
      if (!fnMatch) return false;
      const body = fnMatch[1];
      return (
        /UPDATE public\.calendar_entries[\s\S]+?SET scheduled_at = p_scheduled_at,[\s\S]+?status = 'confirmed'/.test(body)
      );
    })(),
  "Schedule RPC must atomically flip status to 'confirmed' when writing scheduled_at (pending→confirmed in one UPDATE).",
);

// =====================================================================
// §HF-C: dead board_session_preferences references removed everywhere
// =====================================================================

check(
  "§HF-C.1 — generate-curated-experiences uses pg_aggregate_collab_prefs (no board_session_preferences query)",
  !!curatedFn &&
    /supabaseAdmin\.rpc\(\s*['"]pg_aggregate_collab_prefs['"]/.test(curatedFn) &&
    !/\.from\(\s*['"]board_session_preferences['"]/.test(curatedFn),
  "Edge fn must replace .from('board_session_preferences') with the ORCH-0902 SQL helper RPC.",
);

check(
  "§HF-C.2 — realtimeService no longer subscribes to board_session_preferences",
  !!realtimeService &&
    !/table:\s*['"]board_session_preferences['"]/.test(realtimeService),
  "Realtime subscription block for the dead table must be removed.",
);

check(
  "§HF-C.3 — UserManagementPage no longer references board_session_preferences in delete list",
  !!userMgmtAdmin &&
    !/\{\s*table:\s*['"]board_session_preferences['"]/.test(userMgmtAdmin),
  "Admin user-cleanup delete list must not target the non-existent table.",
);

check(
  "§HF-C.4 — collaborationInviteService doc updated to acknowledge removal (no live seed call)",
  !!collabInviteSvc &&
    /collaboration_sessions\.participant_prefs/.test(collabInviteSvc) &&
    !/Seed the acceptor's board_session_preferences from their solo prefs/.test(collabInviteSvc),
  "Comment block must reflect the new path (participant_prefs JSONB), not the dead-table seeding step.",
);

check(
  "§HF-C.5 — PreferencesSheet comment updated to reflect new path",
  !!preferencesSheet &&
    /collaboration_sessions\.participant_prefs/.test(preferencesSheet),
  "Comment must point at the new collaboration_sessions.participant_prefs storage path.",
);

// =====================================================================
// §HF-D: NULL-safety on calendar_entries.scheduled_at readers
// =====================================================================

check(
  "§HF-D.1 — AppStateManager filters out rows with NULL scheduled_at",
  !!appStateMgr &&
    /\.filter\(\(record\) => record\.scheduled_at != null\)/.test(appStateMgr),
  "AppStateManager must skip rows where scheduled_at is NULL (pending collab locks awaiting admin schedule).",
);

check(
  "§HF-D.2 — useCollaborationCalendar.syncToDeviceCalendar guards against NULL scheduled_at",
  !!useCollabCal &&
    /if \(!entry\.scheduled_at\)/.test(useCollabCal) &&
    /CalendarEntryRecord[\s\S]+?scheduled_at: string \| null/.test(useCollabCal),
  "syncToDeviceCalendar must early-return when scheduled_at is NULL; interface must reflect the nullable type.",
);

// =====================================================================
// Report
// =====================================================================

const failed = checks.filter((c) => !c.pass);
console.log(`\nORCH-0908 HOTFIX bundle regression check — ${checks.length} assertions\n`);
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
console.log("PASS — all hotfix assertions met.");
process.exit(0);
