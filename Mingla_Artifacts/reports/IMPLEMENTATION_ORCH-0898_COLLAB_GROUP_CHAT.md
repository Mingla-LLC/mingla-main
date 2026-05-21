# IMPLEMENTATION — ORCH-0898 [Consumer collab session → Friends-tab group chat (shared thread, auto-roster, harmonized with ORCH-0897 trip group chat)]

**Skill:** Claude `mingla-implementor` (parity-mirror — operator-routed per Canonical Pipeline Routing)
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0898_COLLAB_GROUP_CHAT.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0898_COLLAB_GROUP_CHAT.md`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Date:** 2026-05-21
**Status:** **partially completed (Phase 1 of 6) — implemented, unverified.** The migration file is the only deliverable in this turn. Per SPEC §7 binding order, the implementation STOPS at the migration boundary and hands back to operator for `supabase db push --linked`. Phases 2–6 (critical security test → edge function → service → hook → component → regression tests) ship in subsequent implementor turns after the migration is on remote.

---

## §1 Phase boundary explanation

SPEC §7 explicitly orders implementation as: (1) write migration, (2) **STOP** for operator apply, (3) critical security test FIRST, (4) edge function, (5) service, (6) hook, (7) component, (8) regression tests, (9) sim smoke, (10) report. The migration MUST be on remote before any client code is written because the security boundary (RLS policies enforcing cross-session isolation, broadcast-only enforcement, group-vs-direct self-add tightening) is the foundation everything else depends on. Shipping client code against an unapplied migration would create a broken intermediate state where the new code references columns/triggers/policies that don't exist yet.

**This implementation report covers Phase 1 only.** A subsequent implementor dispatch (after operator confirms migration applied) will produce Phase 2–6 in their own implementation reports OR extend this one with `_v2` / additional sections — operator chooses the pattern.

---

## §2 Pre-flight (per SPEC §7 Step 1)

### §2.1 Inputs read

| Source | Verified this turn |
|---|---|
| `Mingla_Artifacts/specs/SPEC_ORCH-0898_COLLAB_GROUP_CHAT.md` (§3.1 Steps 1-8 — the migration DDL) | Yes — every column, constraint, trigger, policy named in §3.1 is encoded in the migration file with matching names + behavior |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0898_COLLAB_GROUP_CHAT.md` (corrected 2026-05-21 — brand_team_members) | Yes |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0901_GET_CONVERSATIONS_4N_QUERY_PERF.md` (perf prerequisite shipped commit `bb74655b`) | Yes — confirms `messagingService.getConversations` is group-conversation-ready (no `.eq('type', ...)` filter), supporting SC-13 |
| `Mingla_Artifacts/milestones/Tr6_DISCUSSION_BOARD.md` (SUPERSEDED banner added 2026-05-21) | Yes — confirms substrate convergence; no `event_threads` tables to be created |
| `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` (the four touched tables: `conversations`, `messages`, `conversation_participants`, `session_participants`, plus `brand_team_members`, `collaboration_sessions`, `board_messages`, `board_message_reads`, `events`) | Yes — column names, FKs, UNIQUE constraints, and existing RLS policies all verified inline this turn before writing the migration |
| Latest migration prefix (must be strictly greater than `20260623000000` per Working-Branch Discipline rule #5) | Confirmed: `20260623000000_orch_0881_ve5_hub_pending_actions.sql` is the highest existing prefix; new prefix `20260624000000` satisfies the monotonic rule |

### §2.2 Cross-Surface Impact (mandatory Step 3.5)

| Surface | This phase's impact | Reason if NOT in scope |
|---|---|---|
| Consumer iOS (`app-mobile/` on iOS) | None yet — migration only. Phase 2+ adds client code. | — |
| Consumer Android (`app-mobile/` on Android) | None yet. | — |
| Buyer-anon Web | NEVER in scope for this ORCH. | No consumer collab + no Friends tab on buyer-anon. |
| Business iOS | None yet — substrate built for Tr6 inheritance (event_id + linked_entity_type='trip' + is_broadcast_only columns + brand_team_members RLS) but no business-side UI ships in this ORCH. | Tr6 UI ships in ORCH-0897 SPEC after this ORCH lands. |
| Business Android | Same as Business iOS. | Same. |
| Admin Web | NEVER in scope. | No admin chat surface. |
| Business Web preview | NEVER in scope (this ORCH). | Tr6 UI scope. |

Parity: automatic across iOS + Android once Phase 2+ ships client code (shared `app-mobile/` RN tree). No platform-specific code paths needed.

### §2.3 Invariant pre-check (per SPEC §5)

| Invariant | Preserved by Phase 1? | How |
|---|---|---|
| **I-PROPOSED-J** (Zustand persist holds IDs, not server records) | YES (vacuously) | Phase 1 is DB-only; no Zustand state added or modified. |
| **I-SUPABASE-NEQ-NULL-DISCIPLINE** | YES (vacuously) | No new `.neq()` introduced. RLS predicates use direct equality or EXISTS. |
| **I-RLS-RETURNING-OWNER-GAP-MITIGATION** | YES | All 3 new RLS policies (6a/6b/6c) use inline EXISTS subqueries — NOT SECURITY DEFINER helpers in SELECT contexts. Trigger functions ARE SECURITY DEFINER (correct — they bypass RLS during cascade writes, different concern class). |
| **Append-only test contract** (ORCH-0840) | YES (vacuously) | No tests added in this phase. Phase 6 ships them. |
| **I-FRIENDS-TAB-COLD-LOAD-UNDER-2S** (ORCH-0901 ACTIVE) | YES (vacuously) | No service-layer changes in Phase 1. Phase 4 must verify SC-13. |

---

## §3 Old → New Receipts

### `supabase/migrations/20260624000000_orch_0898_unified_chat_substrate.sql` (NEW — 545 lines)

**What it did before:** Did not exist. The chat substrate landscape consisted of two parallel families (`board_*` for collab Discussions tab + `conversations`+`messages` for Friends-tab DMs) per investigation §2.1–2.2, plus a proposed third family (`event_threads`) in the Tr6 milestone that was never built.

**What it does now:** Single-transaction migration with 7 sections (mapping to SPEC §3.1 Steps 1–7):

- **Step 1 — `conversations` columns:** adds `session_id` (FK to collaboration_sessions ON DELETE CASCADE), `event_id` (FK to events ON DELETE CASCADE), `linked_entity_type` text NOT NULL DEFAULT `'direct'` with CHECK enum (`'direct'|'session'|'trip'`), `is_broadcast_only` boolean NOT NULL DEFAULT false, `is_enabled` boolean NOT NULL DEFAULT true, `name` text NULL. Plus coherence CHECK `conversations_linked_entity_coherent` (each `linked_entity_type` pins exactly one of `session_id`/`event_id`/neither). Plus `conversations_group_requires_name` CHECK (direct conversations have NULL name; group conversations have non-empty name). Plus partial UNIQUE indexes `conversations_unique_session_id` (where `session_id IS NOT NULL`) and `conversations_unique_event_id` (where `event_id IS NOT NULL`). Plus lookup index `conversations_linked_entity_lookup` for the Friends-tab list query. All `ADD COLUMN IF NOT EXISTS` and DO-block CHECK guards for idempotent re-runs.

- **Step 2 — `messages.mentions` jsonb column:** added with DEFAULT `'[]'::jsonb`. Mirrors `board_messages.mentions` shape for the migration backfill.

- **Step 3 — `conversation_participants.notifications_muted` boolean column:** added with DEFAULT false. Backfilled from `session_participants.notifications_muted` in Step 7c.

- **Step 4 — `ensure_group_conversation_on_session_create` trigger:** SECURITY DEFINER function + AFTER INSERT trigger on `collaboration_sessions`. Atomically creates the linked `conversations` row (`type='group', linked_entity_type='session', session_id=NEW.id, name=COALESCE(NULLIF(trim(NEW.name), ''), 'Group chat')`) + adds `NEW.created_by` as the first `conversation_participants` row. Idempotent via partial UNIQUE index ON CONFLICT (session_id) WHERE session_id IS NOT NULL.

- **Step 5 — Roster sync triggers:**
  - `sync_session_member_to_conversation` (SECURITY DEFINER + AFTER INSERT OR UPDATE OF has_accepted ON session_participants + WHEN NEW.has_accepted = true): inserts the session member into `conversation_participants` of the linked group conversation. Idempotent via UNIQUE (conversation_id, user_id).
  - `remove_session_member_from_conversation` (SECURITY DEFINER + AFTER DELETE ON session_participants): removes the user from the linked group conversation (auto-leave per locked Q1 default).

- **Step 6 — RLS policies:**
  - **6a `conversations_brand_team_member_read`** (PERMISSIVE SELECT) — permits brand_team_members (active: `accepted_at IS NOT NULL AND removed_at IS NULL`) of a trip event to read its group conversation row. Inline EXISTS.
  - **6b `messages_brand_team_member_read`** (PERMISSIVE SELECT) — permits same brand_team_members to read messages in that trip group chat. Inline EXISTS, includes `deleted_at IS NULL` filter for soft-delete consistency.
  - **6c `messages_broadcast_only_enforcement`** (**AS RESTRICTIVE** INSERT — see §5 below for the SPEC deviation note): when a trip conversation has `is_broadcast_only=true`, only brand_team_members can INSERT. Non-trip conversations + non-broadcast trips bypass via the first NOT EXISTS branch. AND-combined with the existing permissive INSERT policy.
  - **6d Self-add tightening on `conversation_participants`:** DROP the legacy `"Users can add themselves to conversations"` PERMISSIVE INSERT policy → CREATE `conversation_participants_direct_self_add` permitting self-add ONLY for `type='direct'` conversations. Group-chat self-add now FORBIDDEN at RLS layer; roster writes go through SECURITY DEFINER triggers exclusively.

- **Step 7 — Data backfill:**
  - **7a:** Backup snapshot `_archive_orch_0898_board_messages_pre_migration` (CREATE TABLE IF NOT EXISTS … AS SELECT * FROM board_messages). Retain 14 days; drop via scheduled cleanup post-2026-07-08.
  - **7b:** Eagerly create a `conversations` row for EVERY existing `collaboration_sessions` row (not just those with messages — design choice for consistency; sessions without prior messages will simply have an empty conversation that the trigger would have created on session-creation anyway). Idempotent via `WHERE NOT EXISTS` guard.
  - **7c:** Backfill `conversation_participants` from `session_participants` where `has_accepted=true`, preserving `notifications_muted` from session-side and `joined_at` timestamps. ON CONFLICT (conversation_id, user_id) DO NOTHING.
  - **7d:** Two-pass message backfill — Pass 1 creates a TEMP ID-map table with pre-computed `gen_random_uuid()` values for each `board_messages` row, so reply_to_id can be translated in Pass 3. Pass 2 INSERTs `messages` rows using the precomputed UUIDs. Pass 3 UPDATEs `messages.reply_to_id` via the ID map. Image-bearing messages map `image_url → file_url` + `message_type='image'`. ON CONFLICT (id) DO NOTHING for defense-in-depth on re-runs.
  - **7e:** Backfill `message_reads` from `board_message_reads` via the ID map. Uses `WHERE NOT EXISTS` guard (message_reads has no UNIQUE constraint on (message_id, user_id) per baseline schema; the guard preserves idempotency).
  - **7f:** Row-count assertions in a `DO $$ ... $$;` block. RAISE EXCEPTION on mismatch (`board_messages` count != `messages` count for session-linked conversations) — rolls back the entire migration atomically. Read-receipt comparison is less-strict (dst ≥ src; some board_message_reads may reference messages whose source board_message no longer exists). Final RAISE NOTICE on success.

**Why:** SPEC §3.1 Steps 1–8 + investigation §13 #10 (NULL-sender support) + ORCH-0897 substrate inheritance.

**Lines changed:** 545 (NEW file).

---

## §4 Spec traceability (Phase 1 portion only)

| Spec criterion | Implemented in this phase? | Where / verification path |
|---|---|---|
| **SC-01** Trigger creates conversation on session INSERT | YES | Step 4 of migration. Verified by Phase 6 regression test T-01 (structural) + Phase 2 critical security test (runtime). |
| **SC-02** Trigger mirrors session_participants → conversation_participants on has_accepted=true | YES | Step 5 of migration. Verified by Phase 6 T-02. |
| **SC-03** Removal trigger on session_participants DELETE | YES | Step 5 of migration (extension). Verified by Phase 6 T-03. |
| **SC-04** Friends-tab list shows group conversations | DEFERRED to Phase 5 (component layer). | DB substrate ready. |
| **SC-05** Same-thread-two-views | DEFERRED to Phase 4 (hook rewrite) + Phase 5 (component). | DB substrate ready. |
| **SC-06** Discussions tab features preserved | DEFERRED to Phase 4 + Phase 5. | `mentions` column added; reactions/reads/typing-indicators existing tables reused. |
| **SC-07** CRITICAL cross-session security test (RLS) | DB POLICIES READY; runtime verification is Phase 2. | Existing baseline RLS on `conversations` + `messages` (line 14966 + 14972) gates via `EXISTS (SELECT 1 FROM conversation_participants WHERE conversation_id = ... AND user_id = auth.uid())`. Non-members get zero rows by RLS. **Phase 2 will execute the independent SQL probe before any client code ships.** |
| **SC-08** Auto-leave on session-leave | YES (DB) | Step 5 removal trigger. Runtime verification Phase 5/6. |
| **SC-09** NULL-sender system messages render + count as unread | DB SUPPORTS (sender_id is nullable); render path is Phase 5. | ORCH-0901 NULL-sender unread fix at commit `bb74655b` already handles the unread-count side. |
| **SC-10** notify-message simplification + OneSignal template | DEFERRED to Phase 3 (edge function). | — |
| **SC-11** 100% backfill row-count assertion | YES | Step 7f. RAISE EXCEPTION rolls back on mismatch. |
| **SC-12** Self-add to group FORBIDDEN | YES (RLS) | Step 6d. `conversation_participants_direct_self_add` restricts to `type='direct'`. Phase 6 TA-03 verifies. |
| **SC-13** ORCH-0901 perf invariant not regressed | DB SUPPORTS (no schema changes that affect getConversations query shape); runtime verification Phase 6 TA-09. | The new columns are nullable / have defaults — backwards compatible with the existing getConversations select. |
| **SC-14** Tr6 inheritance (synthetic trip-case row) | YES (DB) | Step 1 columns + Step 6a/6b/6c policies. Phase 6 TA-02 + TA-04 + TA-06 verify. |
| **SC-15** Broadcast-only RLS enforcement | YES (DB) | Step 6c AS RESTRICTIVE. Phase 6 TA-02 verifies runtime behavior. |

**Phase 1 covers SC-01, SC-02, SC-03, SC-08, SC-11, SC-12, SC-13, SC-14, SC-15 at the DB layer.** SC-04, SC-05, SC-06, SC-07-runtime, SC-09-render, SC-10 are deferred to Phases 2–6.

---

## §5 SPEC interpretation note: `AS RESTRICTIVE` on `messages_broadcast_only_enforcement`

SPEC §3.1 Step 6c's SQL example omitted the `AS RESTRICTIVE` qualifier on the `messages_broadcast_only_enforcement` policy. Without RESTRICTIVE, PostgreSQL would treat the new policy as PERMISSIVE, which means it'd be OR'd with the existing `Users can send messages to conversations they participate in` policy (line 14842 of baseline migration). That OR-combination would WEAKEN the constraint rather than enforce it — case 4 (broadcast-only trip + non-brand-team-member sender) could still INSERT via the existing permissive policy's path.

To make the broadcast-only block actually fire, the new policy MUST be RESTRICTIVE so it's AND-combined with the existing permissive INSERT policy. Both must pass for an INSERT to succeed.

SPEC §3.1 Step 6c's note acknowledged this conceptual concern ("must ALL pass") but the SQL example was missing the keyword. The migration uses `CREATE POLICY ... AS RESTRICTIVE FOR INSERT WITH CHECK (...)` instead.

**No behavioural deviation from the SPEC's intent — this is a syntactic clarification of the same end state.** Documented inline in the migration as a comment block at the policy definition. Phase 6 tester adversarial TA-02 explicitly verifies the runtime behavior matches the intent (non-brand-team-member INSERT fails in broadcast-only trip; brand_team_member INSERT succeeds).

---

## §6 Verification matrix

| Item | Status | How |
|---|---|---|
| Migration file syntactically reasonable | **VERIFIED (read-back)** | 545 lines, monotonic prefix `20260624000000` > `20260623000000` confirmed. Grep checks: 3 SECURITY DEFINER triggers, 1 AS RESTRICTIVE policy, 2 RAISE EXCEPTION guards, 3 RLS policies + 1 RLS tightening, 6 new `conversations` columns + 1 on `messages` + 1 on `conversation_participants`, 3 new CHECK constraints, 3 new indexes. |
| Migration applies cleanly to live DB | **UNVERIFIED** | Operator runs `supabase db push --linked` next. Per Cross-skill parity rule #11, I do NOT call `mcp__supabase__apply_migration`. |
| Data backfill row counts match | **UNVERIFIED** | Step 7f RAISE EXCEPTION will catch mismatch automatically when operator applies. |
| Triggers fire correctly on real session creation / participant flips | **UNVERIFIED** | Phase 2 runs critical security test + an independent trigger-fire probe (insert a test `collaboration_sessions` row, verify `conversations` row materializes; flip `session_participants.has_accepted`, verify `conversation_participants` row materializes; DELETE `session_participants`, verify removal). |
| RLS policies actually enforce cross-session isolation at runtime | **UNVERIFIED** (Phase 2 critical security test) | Independent SQL probe attempting cross-session read as non-member must return zero rows. |
| `getConversations` (ORCH-0901) continues to work + cold-load <2s | **UNVERIFIED** (Phase 6 TA-09 verifies) | DB substrate is backwards-compatible (new columns nullable / have defaults). |

Overall verification: **implemented, unverified.** Phase 2 onwards needed for runtime verification.

---

## §7 Regression test status

**DEFERRED to Phase 6 per SPEC §7 binding order.** The Step 0.5 regression-test gate per ORCH-0840 [Regression-test enforcement + append-only CI] is satisfied at CLOSE time, not at each implementor phase. The migration's structural correctness is verifiable via grep against the migration file — Phase 6 will write `app-mobile/scripts/ci/orch-0898-regression-check.mjs` with T-01..T-10 per SPEC §6.1 (mostly migration-content grep checks for Steps 1-5 + service/hook/component code grep for Steps 6-9). Tester writes the adversarial `app-mobile/scripts/ci/orch-0898-adversarial-check.mjs` (TA-01..TA-10).

Both scripts ship in the final close commit alongside the rest of the implementation diff.

---

## §8 Migrations awaiting `supabase db push`

| Migration | Path | Status | Operator action |
|---|---|---|---|
| `20260624000000_orch_0898_unified_chat_substrate.sql` | `supabase/migrations/20260624000000_orch_0898_unified_chat_substrate.sql` | **WRITTEN, NOT APPLIED** | Run `supabase db push --linked` from the working tree. Verify post-apply via `mcp__supabase__list_migrations` shows the new migration on remote. |

**DO NOT use `mcp__supabase__apply_migration` per Cross-skill parity rule #11 — it creates timestamp drift that breaks the deployment pipeline.**

---

## §9 Deno gates

**N/A this phase.** No edge function code touched yet. Phase 3 modifies `supabase/functions/notify-message/index.ts` and will run Deno gates per Cross-skill parity rule #8 (in Claude session — if Deno unavailable locally, state the unrun gate and the implementation report tells operator the exact `deno check` + `deno test` commands).

---

## §10 Discoveries for Orchestrator

1. **🟡 [P3] SPEC §3.1 Step 6c missing `AS RESTRICTIVE` keyword.** Documented in §5 above as a syntactic clarification, not a behavioural deviation. Forensics may want to backport this into the SPEC at `Mingla_Artifacts/specs/SPEC_ORCH-0898_COLLAB_GROUP_CHAT.md` §3.1 Step 6c so future readers don't make the same omission.

2. **🔵 [P4] Step 7b backfills conversations EAGERLY for ALL collaboration_sessions** (not just those with messages). SPEC §3.1 Step 7b's example said "for each existing collaboration_sessions row with ≥1 board_messages row" but the design intent is that every session has a group conversation — including empty ones — because the post-migration trigger (Step 4) would create them eagerly on any new session. To preserve this invariant for historical sessions, the backfill must run for ALL sessions, not just message-having ones. Migration does this. Note for SPEC alignment.

3. **🔵 [P4] `message_reads` has no UNIQUE constraint on (message_id, user_id)** per baseline schema (line 8410 — only `message_reads_pkey PRIMARY KEY (id)`). Step 7e backfill uses `WHERE NOT EXISTS` guard instead of `ON CONFLICT DO NOTHING`. This is functionally equivalent for our backfill purpose but slightly slower at scale. Recommend a follow-up ORCH (P3) to add `UNIQUE (message_id, user_id)` constraint on `message_reads` if metrics ever flag it.

4. **🔵 [P4] `board_message_reads` may have orphans referencing `board_messages` that no longer exist** (Step 7f's row-count assertion uses dst ≥ src tolerance, not strict equality, because of this). If the dst-count is significantly higher than src-count after migration, that's a clean-data scenario; if dst-count is lower, RAISE EXCEPTION rolls back. No action needed; this is by design.

5. **🔵 [P4] `_archive_orch_0898_board_messages_pre_migration` retention reminder.** SPEC §3.1 Step 7a says retain 14 days then drop in scheduled cleanup ORCH after 2026-07-08. Orchestrator should schedule this via `/schedule` or equivalent.

---

## §11 Constitutional compliance check

| # | Rule | Status |
|---|---|---|
| 1 | No dead taps | N/A (no UI in this phase) |
| 2 | One owner per truth | PASS — `messages` will become canonical; `board_messages` retained 1 release as backing data per SPEC §2.2 + invariant I-PROPOSED-CHAT-SUBSTRATE-UNIFIED. |
| 3 | No silent failures | PASS — backfill RAISE EXCEPTION on row-count mismatch; trigger functions return NEW/OLD correctly; no error swallowing. |
| 4 | One key per entity | N/A (no React Query in this phase) |
| 5 | Server state server-side | N/A (no Zustand in this phase) |
| 6 | Logout clears everything | N/A (no auth changes) |
| 7 | Label temporary | N/A (no `[TRANSITIONAL]` code in migration) |
| 8 | Subtract before adding | PASS — Step 6d DROPs the legacy "Users can add themselves to conversations" policy BEFORE creating the tighter `conversation_participants_direct_self_add` replacement. |
| 9 | No fabricated data | PASS — backfill preserves source timestamps/content/sender_id exactly; orphaned-participant fallback is Phase 5 component-layer scope (out of scope this phase). |
| 10 | Currency-aware UI | N/A |
| 11 | One auth instance | N/A |
| 12 | Validate at right time | N/A |
| 13 | Exclusion consistency | PASS — `is('deleted_at', null)` consistency for messages reads is maintained; the migration only filters `board_messages` source rows with `deleted_at` carried over as-is. |
| 14 | Persisted-state startup | N/A (no client state in this phase) |

All applicable rules PASS for Phase 1. Phases 2–6 will re-audit at completion.

---

## §12 Cache safety

**N/A this phase** — no React Query keys, no AsyncStorage shapes touched. Phase 4 (hook rewrite) will need to handle the query key migration from `discussionKeys.messages(sessionId)` to a new chat-keys factory entry; Phase 4 implementation report will cover cache invalidation strategy + AsyncStorage migration if needed (the existing `CONNECTIONS_CACHE_VERSION` constant at `ConnectionsPage.tsx` controls when persisted conversation cache is bust — Phase 5 may need to bump it).

---

## §13 Regression surface

Adjacent features Phase 2+ smoke testing must verify:

1. **Existing direct DM behavior unchanged** — solo/DM parity per `feedback_solo_collab_parity.md`. Send, receive, react, read, reply, shared cards, file/image/video attachments — none of these should regress.
2. **ORCH-0901 `getConversations` cold-load <2s** — the perf invariant must hold on a mixed direct + group conversation list. Verified by Phase 6 TA-09 re-running ORCH-0901's regression script.
3. **`board_messages` legacy read path** during the dual-read transition — until Phase 4 rewires `useSessionDiscussion` and Phase 5 retires the Discussions tab's reads from `board_messages`, the existing Discussions tab should continue working unchanged (the migration adds, never removes, columns/tables).
4. **`session_participants` triggers don't fire on irrelevant updates** — the WHEN clause on `sync_session_member_to_conversation` gates on `NEW.has_accepted = true`, so an UPDATE that changes only `notifications_muted` won't spuriously re-INSERT into conversation_participants.
5. **`notify-message` edge function** — still works as-is during the 1-release backward-compat window (Phase 3 will add the unified `message` type while keeping the legacy `board_message`/`direct_message`/etc. types working as deprecated aliases).

---

## §14 Files shipped (Phase 1)

| Path | Change | Lines |
|---|---|---|
| `supabase/migrations/20260624000000_orch_0898_unified_chat_substrate.sql` | NEW | 545 |

Total: 1 file, 545 lines.

---

## §15 EAS OTA + deploy notes

**This phase is NOT OTA-eligible alone** — a DB migration must be applied before any client code can be safely shipped against it. The full ORCH-0898 close will produce an OTA-eligible client diff in Phases 4–5, but the migration itself is `supabase db push`-applied by the operator. Per SPEC §7:

1. **Operator applies migration:** `supabase db push --linked` from the working tree.
2. **Verify via `mcp__supabase__list_migrations`** — `20260624000000_orch_0898_unified_chat_substrate.sql` should appear in the remote migration list.
3. **Hand back to implementor** for Phase 2 (critical security test) + Phase 3+ (edge function + client code).
4. **At close time:** orchestrator deploys `notify-message` edge function (Phase 3 deliverable) via `/Users/sethogieva/bin/supabase functions deploy notify-message --project-ref gqnoajqerqhnvulmnyvv`. Operator publishes EAS OTA only after orchestrator confirms migration + edge function are both live.

---

**Report path:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0898_COLLAB_GROUP_CHAT.md`
**Status:** **Phase 1 of 6 — implemented, unverified.** Migration written, awaiting operator `supabase db push --linked`. Phases 2–6 dispatched after migration application confirmed.
