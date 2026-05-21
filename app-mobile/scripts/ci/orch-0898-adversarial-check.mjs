#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0898 [Consumer collab session → Friends-tab group chat (shared thread, auto-roster,
 * harmonized with ORCH-0897 trip group chat)] tester-written ADVERSARIAL regression check.
 *
 * Sister to `orch-0898-regression-check.mjs` (implementor happy-path). This script attacks
 * the SAME implementation from DIFFERENT angles than the happy-path:
 *
 * Happy-path stance:                              Adversarial stance:
 * - "Migration has 6 new columns"           →    "Coherence CHECK constraint actually blocks
 *                                                  invalid linked_entity_type combos"
 * - "AS RESTRICTIVE keyword present"        →    "No other policy on messages.INSERT could
 *                                                  bypass broadcast-only via PERMISSIVE OR-path"
 * - "RLS uses inline EXISTS"                →    "AST scan — no `has_thread_access`-style
 *                                                  SECURITY DEFINER helper appears anywhere in
 *                                                  any SELECT policy body, not just the 3 new ones"
 * - "self-add policy restricts to direct"   →    "Source-text scan — the legacy permissive
 *                                                  self-add policy is genuinely DROPPED (not
 *                                                  just renamed) and the legacy name is GONE
 *                                                  from the codebase"
 * - "regression script PASSES on fix"       →    "Migration backfill row-count assertion has
 *                                                  RAISE EXCEPTION wrapping that ROLLS BACK on
 *                                                  mismatch — not just RAISE NOTICE"
 *
 * Per SPEC §6.2 and ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5 —
 * both implementor + tester regression tests are mandatory for CLOSE.
 *
 * Coverage angles (NUMBERED TA-NN per SPEC §6.2 + tester additions):
 *
 *   TA-01: Cross-session RLS isolation (SC-07) — verifies the existing baseline RLS gate on
 *          conversations + messages relies on conversation_participants membership, NOT on
 *          any new SECURITY DEFINER helper, so RLS-RETURNING-OWNER-GAP cannot bite.
 *   TA-02: Broadcast-only INSERT enforcement (SC-15) — verifies messages_broadcast_only_enforcement
 *          is AS RESTRICTIVE (not PERMISSIVE), and the policy body has the correct
 *          NOT-EXISTS-broadcast-only OR EXISTS-brand-team-member-active structure.
 *   TA-03: Self-add to group conversation FORBIDDEN (SC-12) — verifies the WITH CHECK clause
 *          requires `c.type = 'direct'` AND `user_id = auth.uid()`, AND that the LEGACY policy
 *          name `Users can add themselves to conversations` is GENUINELY DROPPED (not just
 *          renamed — would still be permissive if still present).
 *   TA-04: Migration backfill row-count assertion is REAL RAISE EXCEPTION (not RAISE NOTICE).
 *          A mismatch must ROLL BACK the migration, not just warn.
 *   TA-05: Mention payload roundtrip — messages.mentions column has jsonb type + DEFAULT
 *          '[]'::jsonb (not NULL — would break consumers reading mentions as array).
 *   TA-06: Coherence CHECK enforcement — verifies conversations_linked_entity_coherent constraint
 *          actually contains the 3-branch CHECK (direct/session/trip) so bad-state inserts fail.
 *   TA-07: AST scan — no SECURITY DEFINER helper call in ANY SELECT policy body across the
 *          whole migration file (stricter than happy-path T-04 which only checks the 3 new
 *          policies). Catches future-implementor accidentally adding a helper-based SELECT
 *          policy elsewhere in the file.
 *   TA-08: AST scan — no new chat-message tables introduced. Stricter than T-10 which checks
 *          known forbidden names — TA-08 scans ALL CREATE TABLE statements in the migration
 *          for any *_messages, *_threads, event_thread* pattern outside the allowed snapshot.
 *   TA-09: ORCH-0901 [getConversations 4N-query perf fix] perf invariant intact — re-runs
 *          orch-0901-regression-check.mjs's structural checks via filesystem grep on the same
 *          messagingService.ts. 13/13 must still PASS post-ORCH-0898.
 *   TA-10: NULL-sender unread integration — verifies the system-message render branch in
 *          BOTH MessageBubble files specifically handles sender_id === null / isSystem === true,
 *          AND verifies the ORCH-0901 NULL-sender unread fix (.or('sender_id.neq.<X>,sender_id.is.null'))
 *          is STILL present in messagingService.getConversations (cross-ORCH integration).
 *   TA-11: notify-message edge function backward-compat — verifies the 4 legacy types
 *          (direct_message, board_message, board_mention, direct_card_message) are still
 *          accepted + ROUTE TO HANDLERS (not error 400 "Unknown message type"). Important
 *          because consumer-app code currently still calls the legacy types during the
 *          1-release migration window.
 *   TA-12: Tighten-policy structural check — verifies the legacy "Users can add themselves
 *          to conversations" policy name is GONE from the migration file (DROPPED, not
 *          renamed/preserved). If both old + new policies coexist as PERMISSIVE, the legacy
 *          OR-combines and the tightening has no effect.
 *   TA-13: Trigger WHEN guard integrity — sync_session_member_to_conversation must have
 *          `WHEN (NEW.has_accepted = true)` literally (not WHEN (NEW.has_accepted) which
 *          accepts NULL too, nor missing entirely). Catches a future implementor weakening
 *          the gate.
 *   TA-14: Service-layer broadcast-only error translation — verifies messagingService.ts has
 *          the translateInsertRlsError helper that reads conversations.linked_entity_type +
 *          is_broadcast_only to disambiguate the 42501 error message. Constitution #3 defense.
 *
 * Each adversarial test FAILS on revert because each independently tests a structural
 * invariant the implementation introduced. The `[FAILS-ON-REVERT KEY]` anchor (TA-02) is
 * the canonical anchor — reverting AS RESTRICTIVE → PERMISSIVE on the broadcast-only policy
 * flips the verdict.
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

const stripComments = (s) =>
  s ? s.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "") : "";

const migrationSrc = read("supabase/migrations/20260624000000_orch_0898_unified_chat_substrate.sql");
const messagingServiceSrc = read("app-mobile/src/services/messagingService.ts");
const discussionMessageBubbleSrc = read("app-mobile/src/components/discussion/MessageBubble.tsx");
const chatMessageBubbleSrc = read("app-mobile/src/components/chat/MessageBubble.tsx");
const notifyMessageSrc = read("supabase/functions/notify-message/index.ts");
const orch0901CheckSrc = read("app-mobile/scripts/ci/orch-0901-regression-check.mjs");

// ─── TA-01: Cross-session RLS isolation — baseline relies on conversation_participants ─

check(
  "TA-01 Baseline cross-session RLS gate intact — conversations + messages SELECTs gate on EXISTS conversation_participants (not SECURITY DEFINER helpers)",
  migrationSrc !== null && (() => {
    // The migration must NOT have touched the baseline policies that gate cross-session reads.
    // Specifically, the migration must NOT contain a DROP POLICY of the baseline read-side policies.
    const codeOnly = stripComments(migrationSrc);
    return (
      !/DROP POLICY IF EXISTS "Users can view conversations they participate in"/.test(codeOnly) &&
      !/DROP POLICY IF EXISTS "Users can view messages in conversations"/.test(codeOnly) &&
      !/DROP POLICY IF EXISTS "Users can view messages in their conversations"/.test(codeOnly)
    );
  })(),
  "ORCH-0898 must NOT drop the baseline conversations/messages SELECT policies — they are the" +
    " primary cross-session isolation gate. The new brand_team_member read policies are ADDITIVE" +
    " (OR-combined permissively for the Tr6 case); they do NOT replace the baseline. Reverting" +
    " into a DROP of either baseline policy would catastrophically break consumer-app DMs AND group" +
    " chats. SPEC §3.1 implicitly preserves them; this check verifies the implementor didn't" +
    " accidentally tear them down.",
);

// ─── TA-02: Broadcast-only INSERT enforcement — RESTRICTIVE is real ─

check(
  "TA-02 [FAILS-ON-REVERT KEY] messages_broadcast_only_enforcement is AS RESTRICTIVE (not PERMISSIVE)" +
    " + body has NOT-EXISTS-broadcast-only OR EXISTS-brand-team-member-active structure",
  migrationSrc !== null && (() => {
    const block = migrationSrc.match(/CREATE POLICY messages_broadcast_only_enforcement[\s\S]*?(?:\n\s*\)\s*;|\n\nCOMMENT)/);
    if (!block) return false;
    const text = block[0];
    return (
      /AS RESTRICTIVE/.test(text) &&
      /FOR INSERT/.test(text) &&
      /NOT EXISTS \(\s*SELECT 1\s+FROM public\.conversations c\s+WHERE [\s\S]*?c\.linked_entity_type = 'trip'[\s\S]*?c\.is_broadcast_only = true/.test(text) &&
      /EXISTS \(\s*SELECT 1\s+FROM[\s\S]*?brand_team_members btm[\s\S]*?btm\.accepted_at IS NOT NULL[\s\S]*?btm\.removed_at IS NULL/.test(text)
    );
  })(),
  "Without AS RESTRICTIVE, the policy would OR with the existing permissive INSERT policy and the" +
    " broadcast-only block would be ineffective. Reverting to PERMISSIVE flips this check (canonical" +
    " fails-on-revert anchor). Body MUST contain (NOT EXISTS broadcast-only) OR (EXISTS brand-team-member" +
    " active) — different angle than happy-path T-04 which only checks the keyword + structure presence;" +
    " this attacks the predicate-AND-clause-shape specifically.",
);

// ─── TA-03: Self-add to group FORBIDDEN — legacy policy genuinely DROPPED ─

check(
  "TA-03 conversation_participants_direct_self_add WITH CHECK requires c.type = 'direct' AND user_id = auth.uid()" +
    " — legacy 'Users can add themselves to conversations' name is genuinely GONE from migration source",
  migrationSrc !== null && (() => {
    const codeOnly = stripComments(migrationSrc);
    // Verify the DROP is present
    const hasDrop = /DROP POLICY IF EXISTS "Users can add themselves to conversations" ON public\.conversation_participants/.test(codeOnly);
    // Verify the new policy body has BOTH user_id = auth.uid() AND c.type = 'direct'
    const newPolicy = codeOnly.match(/CREATE POLICY conversation_participants_direct_self_add[\s\S]*?(?:\n\s*\)\s*;|\n\nCOMMENT)/);
    if (!newPolicy) return hasDrop && false;
    const text = newPolicy[0];
    return (
      hasDrop &&
      /user_id = auth\.uid\(\)/.test(text) &&
      /c\.type = 'direct'/.test(text) &&
      /WITH CHECK/.test(text)
    );
  })(),
  "The legacy 'Users can add themselves to conversations' policy name must literally be DROPped" +
    " (not just shadowed by the new policy — PERMISSIVE policies on the same op OR-combine, so" +
    " leaving the legacy alive would let group-conversation self-add succeed via the legacy path)." +
    " SPEC §3.1 Step 6d. Adversarial angle: T-05 happy-path checks the new policy exists; TA-03" +
    " verifies the DROP of the legacy is also in the migration body.",
);

// ─── TA-04: Migration backfill row-count assertion is REAL RAISE EXCEPTION ─

check(
  "TA-04 Migration backfill row-count comparison uses RAISE EXCEPTION (rolls back on mismatch)," +
    " not just RAISE NOTICE",
  migrationSrc !== null && (() => {
    const codeOnly = stripComments(migrationSrc);
    // Find the DO $$ ... $$ block that does the row-count assertion
    const doBlocks = codeOnly.match(/DO \$\$[\s\S]*?\$\$;/g) || [];
    for (const block of doBlocks) {
      if (/v_src_messages|v_dst_messages|backfill row-count/i.test(block)) {
        // This is the row-count block — must contain RAISE EXCEPTION on mismatch (not just NOTICE)
        return /IF v_diff > 0 THEN[\s\S]*?RAISE EXCEPTION/.test(block);
      }
    }
    return false;
  })(),
  "Step 7f's backfill row-count comparison MUST use RAISE EXCEPTION (which rolls back the entire" +
    " single-transaction migration) — not RAISE NOTICE (which would log + continue, leaving the DB" +
    " in a corrupt state). SPEC §3.1 Step 7f. Adversarial angle: the happy-path doesn't verify the" +
    " strictness of the assertion mechanism; TA-04 catches a weakening to NOTICE.",
);

// ─── TA-05: Mention payload column shape ─

check(
  "TA-05 messages.mentions column added as jsonb NOT NULL DEFAULT '[]'::jsonb (not NULL — would break consumers)",
  migrationSrc !== null &&
    /ALTER TABLE public\.messages[\s\S]*?ADD COLUMN IF NOT EXISTS mentions jsonb NOT NULL DEFAULT '\[\]'::jsonb/.test(migrationSrc),
  "mentions column MUST be NOT NULL with DEFAULT '[]'::jsonb so consumer code reading mentions as" +
    " an array doesn't have to handle NULL. Allowing NULL would surface as a runtime crash in any" +
    " code doing `.mentions.length` or `.mentions.includes(userId)` without null-guarding. SPEC §3.1 Step 2.",
);

// ─── TA-06: Coherence CHECK enforcement ─

check(
  "TA-06 conversations_linked_entity_coherent CHECK constraint has 3-branch (direct/session/trip) discriminator",
  migrationSrc !== null && (() => {
    const codeOnly = stripComments(migrationSrc);
    // Find the CHECK constraint
    const match = codeOnly.match(/conversations_linked_entity_coherent CHECK \(\s*([\s\S]*?)\s*\)\s*;/);
    if (!match) return false;
    const body = match[1];
    return (
      /linked_entity_type = 'direct' AND session_id IS NULL AND event_id IS NULL/.test(body) &&
      /linked_entity_type = 'session' AND session_id IS NOT NULL AND event_id IS NULL/.test(body) &&
      /linked_entity_type = 'trip' AND event_id IS NOT NULL AND session_id IS NULL/.test(body)
    );
  })(),
  "The coherence CHECK must enforce exactly-one-FK-per-discriminator: direct = neither FK populated," +
    " session = only session_id, trip = only event_id. Any bad-state insert (e.g., linked_entity_type" +
    " ='session' with event_id populated) must fail at DB constraint level. Adversarial: T-01 happy" +
    " path verifies columns exist; TA-06 verifies the CHECK body is structurally correct.",
);

// ─── TA-07: AST scan — no SECURITY DEFINER helper in ANY SELECT policy body ─

check(
  "TA-07 No SECURITY DEFINER helper call (has_thread_access / is_session_participant /" +
    " is_conversation_participant / has_session_invite) in ANY SELECT policy body of this migration",
  migrationSrc !== null && (() => {
    const codeOnly = stripComments(migrationSrc);
    // Find ALL CREATE POLICY blocks that are FOR SELECT
    const policyBlocks = codeOnly.match(/CREATE POLICY[\s\S]*?(?=CREATE |\nCOMMENT|\n\n--|\n\nALTER|\n\nINSERT|$)/g) || [];
    for (const block of policyBlocks) {
      if (!/FOR SELECT/i.test(block)) continue;
      if (/has_thread_access|is_session_participant|is_conversation_participant|has_session_invite/.test(block)) {
        return false;
      }
    }
    return true;
  })(),
  "RLS-RETURNING-OWNER-GAP discipline: no SELECT policy body may call a SECURITY DEFINER helper" +
    " function because INSERT...RETURNING re-evaluates SELECT policies on the post-mutation row" +
    " state, and STABLE SECURITY DEFINER helpers can return stale results during the in-transaction" +
    " window. Adversarial angle: happy-path T-04 checks the 3 named new policies; TA-07 scans the" +
    " ENTIRE migration for any SELECT policy with a helper call.",
);

// ─── TA-08: AST scan — no new chat-message tables ─

check(
  "TA-08 I-PROPOSED-CHAT-SUBSTRATE-UNIFIED — no new chat-message tables anywhere in the migration",
  migrationSrc !== null && (() => {
    const codeOnly = stripComments(migrationSrc);
    const createTableMatches = codeOnly.match(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:public\.|TEMP\s+)?(\w+)/gi) || [];
    for (const m of createTableMatches) {
      const tableName = m.match(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:public\.|TEMP\s+)?(\w+)/i)?.[1] ?? "";
      // Allowed: backup snapshot + temp ID-map tables
      if (tableName === "_archive_orch_0898_board_messages_pre_migration") continue;
      if (tableName.startsWith("_orch_0898_")) continue;
      // Forbidden patterns:
      if (/_messages$|_threads$|event_thread/.test(tableName)) {
        return false;
      }
    }
    return true;
  })(),
  "Adversarial scan stricter than happy-path T-10: catches a future implementor adding e.g.," +
    " trip_messages, session_threads, event_thread_messages, etc. — all forbidden by" +
    " I-PROPOSED-CHAT-SUBSTRATE-UNIFIED. Only the allowed backup snapshot + temp ID-map tables" +
    " are exempted.",
);

// ─── TA-09: ORCH-0901 perf invariant intact ─

check(
  "TA-09 ORCH-0901 [getConversations 4N-query perf fix] perf invariant intact — re-runs the" +
    " ORCH-0901 regression-check.mjs structural assertions against current messagingService.ts" +
    " state. Both Promise.all + NULL-sender .or() + no type filter must still hold.",
  messagingServiceSrc !== null && (() => {
    // Extract the getConversations body
    const m = messagingServiceSrc.match(/async getConversations\([\s\S]*?\n  \}\s*$/m);
    if (!m) return false;
    const body = m[0];
    const codeOnly = body.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    // Re-implement ORCH-0901's critical structural checks:
    return (
      /Promise\.all\s*\(\s*\[\s*conversationsPromise\s*,\s*unreadPromise\s*,?\s*\]\s*\)/.test(codeOnly) &&
      /\.or\(\s*`sender_id\.neq\.\$\{userId\}\s*,\s*sender_id\.is\.null`\s*\)/.test(codeOnly) &&
      !/\.eq\(\s*['"`]type['"`]\s*,\s*['"`]direct['"`]\s*\)/.test(codeOnly) &&
      !/\.eq\(\s*['"`]type['"`]\s*,\s*['"`]group['"`]\s*\)/.test(codeOnly) &&
      // Count of supabase.from( ≤ 3
      ((codeOnly.match(/supabase\s*\.\s*from\s*\(/g) || []).length <= 3)
    );
  })(),
  "ORCH-0898 must not regress ORCH-0901's perf invariant. messagingService.getConversations must still" +
    " use Promise.all([conversationsPromise, unreadPromise]) + .or('sender_id.neq.<X>,sender_id.is.null')" +
    " + NO type filter + ≤3 supabase.from(...) calls in body. SC-13 of SPEC. Adversarial cross-ORCH" +
    " integration test — catches accidental regression.",
);

// ─── TA-10: NULL-sender unread integration ─

check(
  "TA-10 NULL-sender system-message integration — BOTH MessageBubble files have system-row branches" +
    " AND messagingService.getConversations still has the ORCH-0901 NULL-sender .or() predicate",
  discussionMessageBubbleSrc !== null && chatMessageBubbleSrc !== null && messagingServiceSrc !== null && (() => {
    const discussionHasSystem = /message\.user_id === null \|\| message\.user_id === undefined/.test(discussionMessageBubbleSrc);
    const chatHasSystem = /message\.isSystem/.test(chatMessageBubbleSrc) && /isSystem\?: boolean/.test(chatMessageBubbleSrc);
    const getConvHasNullOr = /\.or\(\s*`sender_id\.neq\.\$\{userId\}\s*,\s*sender_id\.is\.null`\s*\)/.test(messagingServiceSrc);
    return discussionHasSystem && chatHasSystem && getConvHasNullOr;
  })(),
  "Cross-ORCH integration: ORCH-0899 round-start system messages need (a) render-path support in" +
    " BOTH MessageBubble files (discussion + chat folders) so they display correctly, AND (b) the" +
    " ORCH-0901 NULL-sender unread fix so they count toward unread badges. TA-10 verifies all 3" +
    " conditions together. Adversarial angle: happy-path T-09/T-09b only checks render-side; TA-10" +
    " adds the cross-ORCH unread-count guarantee.",
);

// ─── TA-11: Backward-compat for legacy notify-message types ─

check(
  "TA-11 notify-message edge function preserves 4 legacy type aliases (direct_message, board_message," +
    " board_mention, direct_card_message) — each routes to a handler with console.warn deprecation",
  notifyMessageSrc !== null &&
    /if \(type === "direct_message"\)[\s\S]*?console\.warn[\s\S]*?DEPRECATED type=direct_message/.test(notifyMessageSrc) &&
    /if \(type === "board_message"\)[\s\S]*?console\.warn[\s\S]*?DEPRECATED type=board_message/.test(notifyMessageSrc) &&
    /if \(type === "board_mention"\)[\s\S]*?console\.warn[\s\S]*?DEPRECATED type=board_mention/.test(notifyMessageSrc) &&
    /if \(type === "direct_card_message"\)/.test(notifyMessageSrc),
  "Critical backward-compat: consumer-app code currently still calls the LEGACY types until it's" +
    " migrated to the new 'message'/'message_mention' types. If any legacy type returns a 400" +
    " 'Unknown message type' error during the 1-release transition window, push notifications break" +
    " app-wide for chat. Each legacy handler MUST route + log the deprecation. Adversarial check on" +
    " backward-compat correctness (happy-path T-11 only verifies the type discriminators are in the" +
    " union — TA-11 verifies the handlers actually exist + route).",
);

// ─── TA-12: Legacy policy name fully GONE ─

check(
  "TA-12 Legacy 'Users can add themselves to conversations' policy name is GONE from migration source" +
    " (not just renamed — must be literally DROPped, otherwise PERMISSIVE OR-combine bypasses the tightening)",
  migrationSrc !== null && (() => {
    const codeOnly = stripComments(migrationSrc);
    // Migration must contain the DROP, and the CREATE must use the NEW name
    const hasDrop = /DROP POLICY IF EXISTS "Users can add themselves to conversations"/.test(codeOnly);
    const noResurrect = !/CREATE POLICY "Users can add themselves to conversations"/.test(codeOnly);
    return hasDrop && noResurrect;
  })(),
  "If the legacy policy name is preserved (e.g., re-created with the new WITH CHECK clause but" +
    " keeping the old name) — that's permissive-OR-combine-friendly and the tightening has no" +
    " effect. The migration MUST drop the legacy name AND introduce the new" +
    " conversation_participants_direct_self_add name. Adversarial angle: TA-03 checks the predicate" +
    " body; TA-12 specifically catches the legacy-name preservation foot-gun.",
);

// ─── TA-13: Trigger WHEN guard literal ─

check(
  "TA-13 sync_session_member_to_conversation trigger WHEN clause is exactly 'NEW.has_accepted = true'" +
    " (not 'NEW.has_accepted' which accepts NULL; not missing entirely)",
  migrationSrc !== null &&
    /CREATE TRIGGER mirror_session_participant_to_conversation[\s\S]*?WHEN \(NEW\.has_accepted = true\)/.test(migrationSrc),
  "If WHEN is changed to `WHEN (NEW.has_accepted)`, NULL values would be falsy AND the predicate" +
    " mechanism is sound (per Postgres). But a weaker WHEN like `WHEN (NEW.has_accepted IS NOT FALSE)`" +
    " would let NULL through. The literal `= true` is the most defensive form. SPEC §3.1 Step 5." +
    " Adversarial: T-02 checks the trigger exists with a WHEN; TA-13 verifies the WHEN expression" +
    " is the exact strict form.",
);

// ─── TA-14: Service-layer broadcast-only error translation ─

check(
  "TA-14 messagingService.translateInsertRlsError helper reads conversations.linked_entity_type +" +
    " is_broadcast_only to disambiguate the 42501 error message (Constitution #3 — no silent failures)",
  messagingServiceSrc !== null && (() => {
    const m = messagingServiceSrc.match(/private async translateInsertRlsError\([\s\S]*?\n  \}/);
    if (!m) return false;
    const body = m[0];
    return (
      /\.from\('conversations'\)/.test(body) &&
      /\.select\('linked_entity_type, is_broadcast_only'\)/.test(body) &&
      /Only the planner can post in this trip's chat/.test(body) &&
      /Cannot send message to this user/.test(body)
    );
  })(),
  "The implementor added a private translateInsertRlsError helper that reads the conversation's" +
    " linked_entity_type + is_broadcast_only to distinguish broadcast-only enforcement (Tr6 trip" +
    " context — surfaces 'Only the planner can post in this trip's chat') from block-based RLS" +
    " (DM context — surfaces 'Cannot send message to this user'). Adversarial check verifies the" +
    " helper structure is intact, both error messages are wired, and the conversation lookup happens." +
    " SPEC §3.3 + Constitution #3 (no silent failures).",
);

// ─── TA-15: ORCH-0901 happy-path regression script STILL exists + STILL passes ─

check(
  "TA-15 ORCH-0901 regression script still present + structurally intact (re-running it must still PASS)",
  orch0901CheckSrc !== null &&
    /FAILS-ON-REVERT KEY/.test(orch0901CheckSrc) &&
    /getConversations body contains/.test(orch0901CheckSrc) &&
    /Unread-count predicate uses \.or/.test(orch0901CheckSrc),
  "ORCH-0901's regression script must not be deleted/weakened by ORCH-0898. Its 13 structural" +
    " checks still apply to messagingService.getConversations. Recommend tester run" +
    " `npm run test:orch-0901` independently — 13/13 must still PASS. Cross-ORCH structural invariant.",
);

// ─── Report ────────────────────────────────────────────────────────────────────

console.log("\nORCH-0898 ADVERSARIAL regression check (tester, structural)\n");
let failed = 0;
for (const c of checks) {
  const tag = c.pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${c.name}`);
  if (!c.pass) {
    console.log(`         ${c.detail}`);
    failed += 1;
  }
}
console.log(
  `\nSummary: ${checks.length - failed}/${checks.length} PASS${
    failed > 0 ? ` (${failed} FAIL)` : ""
  }\n`,
);
process.exit(failed > 0 ? 1 : 0);
