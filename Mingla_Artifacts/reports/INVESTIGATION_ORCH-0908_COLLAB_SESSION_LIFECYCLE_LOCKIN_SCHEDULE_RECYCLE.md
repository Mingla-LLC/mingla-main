# INVESTIGATION — ORCH-0908: Collab Session Lifecycle (Planning → Locked In → Schedule → V_{n+1} Recycle)

**Mode:** INVESTIGATE (no spec, no solutions, no code)
**Date:** 2026-05-21
**Author:** Claude `mingla-forensics`
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0908_COLLAB_SESSION_LIFECYCLE_LOCKIN_SCHEDULE_RECYCLE.md`
**Operator-locked product decisions (2026-05-21 AskUserQuestion):**
1. Lock-in trigger = creator manually taps "Lock it in" on a matched card (NOT auto on quorum)
2. Scheduler = creator OR creator-promoted "session co-admin"
3. Calendar writes target three surfaces: native device calendar via OS permission + thin-strip banner in session chat + in-app Calendar tab
4. Auto-restart = V_{n+1} mints immediately on schedule-confirm with fresh deck for everyone

---

## Layman summary

**Finding 1 — Almost everything you described is already built.** The lock-in trigger, the calendar-entry creation on lock, the realtime fire-back to mobile, the "Plan Locked In!" modal, the native device-calendar write via `expo-calendar`, the `session.status='locked'` transition, the `is_admin` field on participants — all exist in production today. This is a contour adjustment, not a new feature build.

**Finding 2 — Three surgical gaps separate today from what you want.**
- (a) **Lock-in is gang-consensus, not creator-manual.** Today the card locks only when ALL accepted participants RSVP `'attending'` to it ([`check_card_lock_in`](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L3600-L3658) trigger). You want the creator to tap "Lock it in" unilaterally on a matched card. The infrastructure is there — the gating predicate needs to change.
- (b) **Schedule is auto-derived, not user-picked.** Today `scheduled_at` defaults to `board_session_preferences.datetime_pref` or `NOW() + 1 day` ([line 4259](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L4259)). You want the creator (or co-admin) to pick a date and time on a scheduling UI post-lock. The `calendar_entries.scheduled_at` row already exists per-participant — the spec needs a scheduling UI + an RPC that updates it.
- (c) **Session dead-ends after lock.** Today `session.status='locked'` is effectively terminal — the deck doesn't continue, ORCH-0902's V_{n+1} mint trigger fires only on prefs/participant changes ([migration `20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql:594-597`](../../supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql#L594-L597)). You want schedule-confirm to be a NEW V_{n+1} trigger AND to flip session back to a planning state for the next round.

**Finding 3 — The "Calendar tab" question is non-trivial.** The consumer app has no tab structure today — `app-mobile/app/` contains only `_layout.tsx` and `index.tsx`. There's already a `scheduledCount` badge surfacing on the saved-cards view ([app/index.tsx:2497](../../app-mobile/app/index.tsx#L2497)) and a `calendar_entries` query path exists, but no dedicated Calendar tab. SPEC must decide: new route under `app/`, sub-screen of `index.tsx`, or a tab-bar refactor.

**Finding 4 — The "session chat banner" host exists.** ORCH-0898 [unified chat substrate] gives every collaboration session an associated group conversation via the `conversations.session_id` column + AFTER INSERT trigger on `collaboration_sessions`. The banner has a place to live — inside the existing group conversation view, no new chat surface needed.

**Finding 5 — Co-admin role is schema-ready.** `session_participants.is_admin boolean DEFAULT false` already exists ([line 9665](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L9665)). The session creator is admin-by-default per the comment at line 9677. `SessionViewModal.tsx:133, :562, :572` already gate `advanceToVoting` and `markCompleted` on `isAdmin`. To add co-admin promotion, a single RPC `UPDATE session_participants SET is_admin=true WHERE ...` + a promotion UI is sufficient.

**Finding 6 — ORCH-0902 has not yet shipped.** ORCH-0902 [collab deck deterministic rewrite] is in SPEC complete / ready-for-IMPLEMENT state per `Mingla_Artifacts/MEMORY.md`. Whether to fold ORCH-0908 into ORCH-0902's IMPLEMENT or ship as a follow-on amendment is the operator's routing call (recommended in §Phase 3).

---

## Phase 0 — Ingest log

### Files read in full
- `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0908_COLLAB_SESSION_LIFECYCLE_LOCKIN_SCHEDULE_RECYCLE.md` — this dispatch
- `Mingla_Artifacts/specs/SPEC_ORCH-0902_COLLAB_DECK_DETERMINISTIC_REWRITE.md` — header through §2A.4 (file is 29k tokens; full file exceeds single-read budget)
- `supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql` (688 lines, full)
- `app-mobile/src/hooks/useCollaborationCalendar.ts` (114 lines, full)
- `app-mobile/src/services/sessionService.ts` (156 lines, full)
- `app-mobile/src/services/deviceCalendarService.ts` (458 lines, full)

### Files read in targeted slices (cited inline)
- `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` (18,641 lines) — slices around `collaboration_sessions`, `session_participants`, `board_saved_cards`, `board_user_swipe_states`, `board_card_rsvps`, `calendar_entries`, `check_card_lock_in`, `check_mutual_like`, `create_calendar_entries_on_lock`, `board_session_preferences`, trigger registrations
- `app-mobile/src/components/SessionViewModal.tsx` (≥920 lines) — slices around 550-660, 800-920
- `app-mobile/src/components/CollaborationSessions.tsx` (1886 lines) — mapped via Explore sub-agent (results inlined and verified by direct grep for key claims)
- `app-mobile/src/hooks/useSessionVoting.ts` (≥500 lines) — slice 420-499
- `app-mobile/app/index.tsx` — targeted grep for `handleSchedule`, `scheduledCount`, `calendarEntries`
- `app-mobile/package.json` — confirmed `expo-calendar: ~15.0.8`

### Files referenced but not opened
- `app-mobile/src/services/calendarService.ts` (separate from `deviceCalendarService.ts`; likely the React Query layer for `calendar_entries`)
- `app-mobile/src/services/realtimeService.ts` lines 432-460 (board_card_rsvps subscribe — confirmed via grep but not opened)
- `app-mobile/src/services/collaborationInviteService.ts` (448 lines)
- `app-mobile/src/services/sessionMembershipService.ts` (182 lines)
- The remaining 1500+ lines of `CollaborationSessions.tsx` beyond the Explore-mapped sections
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0902_DEEP_COLLAB_DECK_CURRENT_STATE.md` (not opened — ORCH-0902 migration sufficient for V_{n+1} trigger context)
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0902_COLLAB_DECK_PARITY.md` (not opened — same reason)

### Memory references applied
- `feedback_collab_deck_determinism_contract.md` — ORCH-0902 contract loaded into reasoning
- `feedback_verify_db_column_names_before_writing_queries.md` — every column cited verified against `CREATE TABLE` source
- `feedback_solo_collab_parity.md` — flagged in Phase 3 open questions
- `feedback_always_simulator_repro_described_behaviour.md` — investigation is backend-heavy / SQL+schema dominant, exemption applies (per Prime Directive 7 last sentence). Runtime UI claim about "no way to continue swiping after match" is marked `probable` not `proven` — see confidence section.

### Files missing or not found
- No ORCH-0908-specific prior artifacts (this is the first investigation on this topic)
- No implementation report for ORCH-0902 yet (not shipped)

---

## Phase 1 — Current state (five-truth-layer evidence)

### Layer A — Schema (DB)

**`collaboration_sessions`** ([baseline:7951-7969](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L7951-L7969))

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text NOT NULL default `''` | |
| `created_by` | uuid | session owner |
| `status` | text default `'pending'` | CHECK enum: **`'pending', 'active', 'voting', 'locked', 'completed', 'archived', 'dormant'`** ([line 7968](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L7968)) |
| `session_type` | text default `'group_hangout'` | CHECK: `'group_hangout', 'date_night', 'squad_outing', 'business_meeting', 'board', 'collaboration'` |
| `participant_prefs` | jsonb default `'{}'` | Read by ORCH-0902 `pg_aggregate_collab_prefs` |
| `is_active` | boolean default true | Separate from status |
| `last_activity_at` | timestamptz | Used by `getActiveSession` |
| `archived_at` | timestamptz | Soft archive |
| `created_at`, `updated_at` | timestamptz | |
| `deck_version` | int default 0 | **ORCH-0902 — already applied** ([migration:39](../../supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql#L39)) |
| `deck_params_hash` | text | **ORCH-0902 — already applied** ([migration:40](../../supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql#L40)) |

**KEY FINDING A-1:** The status enum already includes `'locked'`, `'completed'`, `'archived'`, `'dormant'`. **No new status values are needed for the proposed feature.** "Planning" maps to existing `'active'` (or possibly `'voting'`). "Locked In" maps to existing `'locked'`. The cycle-back-to-planning can re-enter `'active'`.

**`session_participants`** ([baseline:9658-9669](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L9658-L9669))

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `session_id` | uuid NOT NULL | FK |
| `user_id` | uuid NOT NULL | |
| `role` | text default `'member'` | unused enum slot |
| `is_admin` | boolean default false | **"creator is always admin regardless of this flag" per [comment at 9677](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L9677)** |
| `has_accepted` | boolean default false | RSVP to the session invite (not per-card) |
| `notifications_muted` | boolean default false | ORCH-0520 |
| `joined_at`, `created_at`, `updated_at` | timestamptz | |

**KEY FINDING A-2:** Co-admin role is **already schema-supported**. Promotion = flipping `is_admin=true` for any accepted non-creator participant. No schema change required.

**`board_saved_cards`** ([baseline:7614-7625](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L7614-L7625))

| Column | Notes |
|---|---|
| `id`, `session_id`, `experience_id`, `saved_experience_id`, `card_data jsonb`, `saved_by`, `saved_at` | |
| `is_locked boolean default false NOT NULL` | The per-card lock flag |
| `locked_at timestamptz` | Set by `check_card_lock_in` on transition |
| `locked_by_consensus boolean default false NOT NULL` | True when all-participant RSVP path locked it |

**KEY FINDING A-3:** The lock-in is per-card. Each card swipe-matched can be locked independently. Today only the all-RSVP-consensus path sets `is_locked=true`; a manual creator/admin lock path would need new logic that sets the same column WITHOUT requiring full RSVP quorum.

**`board_card_rsvps`** ([baseline:7520-7529](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L7520-L7529))

```
session_id uuid, saved_card_id uuid, user_id uuid, rsvp_status text
CHECK rsvp_status IN ('attending', 'not_attending')
UNIQUE (session_id, saved_card_id, user_id)
```

**`calendar_entries`** ([baseline:7861-7884](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L7861-L7884))

| Column | Notes |
|---|---|
| `user_id`, `card_id text`, `board_card_id uuid` | Per-user, per-card |
| `source` CHECK `'solo' \| 'collaboration'` | |
| `card_data jsonb` NOT NULL | Frozen card payload |
| `status` CHECK `'pending' \| 'confirmed' \| 'completed' \| 'cancelled'` | |
| `scheduled_at timestamptz NOT NULL` | **REQUIRED — every entry has a date** |
| `duration_minutes int` | |
| `device_calendar_event_id text` | expo-calendar event ID for direct update/delete ([comment at 7890](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L7890)) |
| `feedback_status` CHECK `'pending' \| 'completed' \| 'skipped' \| 'rescheduled'` | |

**KEY FINDING A-4:** `calendar_entries` already has BOTH a `scheduled_at` (the date/time the user wants to do the thing) AND a `device_calendar_event_id` (the iOS/Android calendar event linkage). The schema is fully designed for the operator's feature — just the WRITE path (today auto-derived, tomorrow user-picked) needs adjustment.

**`board_session_preferences`** ([baseline:9037](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L9037))

Contains `datetime_pref timestamptz` — used as the default for `scheduled_at` in the auto-create trigger.

**`board_user_swipe_states`** ([baseline:7663-7673](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L7663-L7673))

`swipe_state` CHECK enum: `'not_seen', 'swiped_left', 'swiped_right'`. Storage scoped by `session_id, user_id, experience_id`. This is what the ORCH-0902 V_{n+1} mint will reset on re-cycle — see Phase 2 capability 8.

**`conversations` (ORCH-0898)**

Per the `20260624000000_orch_0898_unified_chat_substrate.sql` migration:
- `conversations.session_id` column exists ([comment at line 89 of ORCH-0898 migration](../../supabase/migrations/20260624000000_orch_0898_unified_chat_substrate.sql#L89))
- AFTER INSERT trigger on `collaboration_sessions` atomically creates a group conversation ([comment at line 181](../../supabase/migrations/20260624000000_orch_0898_unified_chat_substrate.sql#L181))
- Idempotent via partial UNIQUE index on `conversations.session_id`

**KEY FINDING A-5:** Every collab session has a group conversation. The "thin-strip banner in session chat" has a guaranteed host.

### Layer B — Code (mobile + backend)

#### Mobile entry points

**`CollaborationSessions.tsx`** (`1886 lines` (file removed per META-ORCH-0929)) — pill bar on HomePage. Per Explore-agent mapping (verified via targeted grep):
- Receives `collaborationSessions` array as prop from `app/index.tsx:673` (built via `useMemo` from realtime-subscribed `boardsSessions`)
- Per-pill render at lines 560-598; visually distinguishes invite vs active vs sent-invite **but NOT lifecycle phases** (planning/locked/scheduled — no UI exists)
- Tap → opens `SessionViewModal` for active sessions or invite modal for pending invites (lines 337-351)
- RSVP UI for SESSION-LEVEL invites is in this file (lines 1059-1085 inside invite modal); RSVP UI for PER-CARD attending/not_attending is in `useSessionVoting.ts:446-476`
- **No "Lock it in" button anywhere in this file** (confirmed via grep `grep -nE "session\.status|status === ['\"]"` returned only one friendship-status hit, line 778)
- **No scheduling/date-time-picker UI** (confirmed via grep; no `expo-calendar` import, no DateTimePicker)
- **No co-admin promotion UI** (confirmed via grep — no `is_admin` references in this file)

**`SessionViewModal.tsx`** (≥920 lines) — opens when user taps a session pill
- Destructures `isAdmin` from `useBoardSession` ([line 133](../../app-mobile/src/components/SessionViewModal.tsx#L133))
- **`advanceToVoting`** callback ([lines 561-569](../../app-mobile/src/components/SessionViewModal.tsx#L561-L569)) — gated on `isAdmin`, writes `status='voting'` to `collaboration_sessions`
- **`markCompleted`** callback ([lines 571-578](../../app-mobile/src/components/SessionViewModal.tsx#L571-L578)) — gated on `isAdmin`, writes `status='completed'`
- **No `markLocked` or `lockInCard` callback** (confirmed via grep)
- Mounts `useCollaborationCalendar(sessionId, user?.id)` ([line 585](../../app-mobile/src/components/SessionViewModal.tsx#L585))
- **"Plan Locked In!" modal** ([lines 889-913](../../app-mobile/src/components/SessionViewModal.tsx#L889-L913)) — renders when `showCalendarPrompt && lockedCalendarEntry` truthy; "Add to Calendar" button calls `syncToDeviceCalendar(lockedCalendarEntry)`; "Maybe Later" dismisses

**KEY FINDING B-1:** The manual-admin-action infrastructure (callbacks gated on `isAdmin`) already exists for `advanceToVoting` and `markCompleted`. A new `lockInCard(savedCardId)` callback following the same pattern is a clean fit.

**KEY FINDING B-2:** The "Plan Locked In!" modal already triggers user-facing on card lock. Today it ONLY prompts for device-calendar sync. The same modal (or an expanded variant) is the natural home for the proposed "pick a date/time" UI.

**`useCollaborationCalendar.ts`** ([114 lines](../../app-mobile/src/hooks/useCollaborationCalendar.ts), full)
- Subscribes to `realtimeService.subscribeToBoardSession(sessionId, { onCardLocked })` ([lines 70-83](../../app-mobile/src/hooks/useCollaborationCalendar.ts#L70-L83))
- On `onCardLocked(savedCardId)`: polls `calendar_entries` table (3 attempts × 300ms) for the matching `(board_card_id, user_id, source='collaboration')` row ([lines 32-66](../../app-mobile/src/hooks/useCollaborationCalendar.ts#L32-L66))
- `syncToDeviceCalendar(entry)` → calls `DeviceCalendarService.createEventFromCard(entry.card_data, scheduled_at, duration_minutes ?? 60)` → `DeviceCalendarService.addEventToDeviceCalendar(event)` ([lines 86-102](../../app-mobile/src/hooks/useCollaborationCalendar.ts#L86-L102))

**`DeviceCalendarService.ts`** ([458 lines](../../app-mobile/src/services/deviceCalendarService.ts), full)
- Production-grade `expo-calendar` wrapper: permissions request, default-calendar discovery, add/update/remove events, find-event-by-title-and-date fallback, Google Holidays calendar sync
- `createEventFromCard(card, scheduledAt, durationMinutes=120)` — title, startDate, endDate, notes (with description + highlights + price tier + rating), location, url, alarms (15m + 60m default)
- `addEventToDeviceCalendar(event)` returns the expo-calendar `eventId` for storage in `calendar_entries.device_calendar_event_id`
- Also has `createEventFromCuratedCard(card, startDate, totalDurationMinutes)` for multi-stop curated plans

**KEY FINDING B-3:** The mobile → native-calendar bridge is production-grade and complete. No new mobile-native code is needed for the "write to Apple/Google Calendar" requirement.

**`useSessionVoting.ts`** (≥500 lines) — RSVP write path
- Per-card "yes/no/maybe" UI writes to `board_card_rsvps` via `.upsert()` with conflict key `(session_id, saved_card_id, user_id)` ([lines 446-476](../../app-mobile/src/hooks/useSessionVoting.ts#L446-L476))
- On `rsvp_status='attending'` write, fires `notifyCardRsvp` notification to card-saver ([lines 478-498](../../app-mobile/src/hooks/useSessionVoting.ts#L478-L498))
- The upsert into `board_card_rsvps` is what triggers `check_card_lock_in` (which then triggers the lock cascade)

#### Backend — triggers and functions

**`check_mutual_like` trigger** ([baseline:3700-3867](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L3700-L3867)) — fires AFTER INSERT OR UPDATE on `board_user_swipe_states`
- ORCH-0558 v3 bulletproof match logic: advisory lock by (session_id, experience_id), idempotency guard, ON CONFLICT safety net
- On ≥2 right-swipes, inserts a row into `board_saved_cards` with `is_locked=false` (default)
- Does NOT directly lock anything — match-quorum produces a SAVED-CARD, not a LOCKED-IN card

**`check_card_lock_in` trigger** ([baseline:3600-3658](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L3600-L3658)) — fires AFTER INSERT OR UPDATE on `board_card_rsvps`
- If `NEW.rsvp_status != 'attending'`: skip
- If card already locked: skip
- Counts `session_participants WHERE has_accepted=true` → `v_total_participants`
- Counts `board_card_rsvps WHERE session_id, saved_card_id, rsvp_status='attending'` → `v_attending_count`
- **IF `v_attending_count >= v_total_participants AND v_total_participants > 0`**:
  - `UPDATE board_saved_cards SET is_locked=true, locked_at=NOW(), locked_by_consensus=true WHERE id = saved_card_id`
  - `UPDATE collaboration_sessions SET status='locked' WHERE id = session_id AND status IN ('active', 'voting')`

**KEY FINDING B-4:** This is the gang-consensus lock path. The operator's manual lock path is a SECOND code path that needs to bypass the RSVP-counting predicate. The downstream `create_calendar_entries_on_lock` trigger fires on `is_locked` flipping false→true regardless of WHO set it.

**`create_calendar_entries_on_lock` trigger** ([baseline:4213-4267](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L4213-L4267)) — fires AFTER UPDATE on `board_saved_cards` WHEN `(OLD.is_locked=false AND NEW.is_locked=true)` ([trigger registration at line 12719](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L12719))
- For EACH accepted participant in the session:
  - `INSERT INTO calendar_entries (user_id, board_card_id, source='collaboration', card_data=NEW.card_data, status='confirmed', scheduled_at=COALESCE(board_session_preferences.datetime_pref, NOW()+1 day), duration_minutes=60) ON CONFLICT DO NOTHING`

**KEY FINDING B-5:** This trigger writes a per-participant `calendar_entries` row at lock time with an auto-derived `scheduled_at`. The operator's manual-schedule flow needs to either (a) suppress this auto-write and rely on a post-lock scheduling RPC instead, or (b) let it write a placeholder date and then UPDATE every participant's row to the user-picked date in a single RPC.

**ORCH-0902 V_{n+1} mint** ([migration:594-597](../../supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql#L594-L597))

```sql
CREATE TRIGGER recompute_deck_version_after_update
  AFTER UPDATE OF participant_prefs, updated_at ON public.collaboration_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.recompute_deck_version_after_prefs_change();
```

The V_{n+1} mint trigger fires on ANY update to `participant_prefs` OR `updated_at`. Critically, the trigger function recomputes the hash and ONLY bumps version if `v_new_hash IS DISTINCT FROM NEW.deck_params_hash` ([migration:556-558](../../supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql#L556-L558)).

**KEY FINDING B-6:** A naïve `UPDATE collaboration_sessions SET status='active', updated_at=NOW()` after schedule-confirm will fire the trigger BUT the hash will NOT differ (status is not part of the aggregation in `pg_aggregate_collab_prefs`), so no V_{n+1} mint. The SPEC must EITHER (a) include the schedule cycle counter in the aggregation hash input, OR (b) bypass the trigger and call a server-side mint helper directly, OR (c) add a "round counter" column to `collaboration_sessions` that's part of the aggregation, incremented on schedule-confirm.

### Layer C — Runtime behavior

**Reproducer (described by operator):** "When a collaboration session rsvps, there is no way to continue swiping."

**Source-traced runtime behavior** (confidence: `probable` — no live-fire sim repro this turn per Prime Directive 7 exemption for backend-dominant investigation):

1. Creator creates a session, invites 2 friends
2. Both friends accept the SESSION invite (`session_participants.has_accepted=true` rows written via existing accept flow)
3. ORCH-0902 V_1 mints (≥2 accepted threshold met per [migration:216-226](../../supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql#L216-L226))
4. All three swipe. A card gets ≥2 right-swipes → `check_mutual_like` promotes to `board_saved_cards` (is_locked=false)
5. The matched card now appears in the saved-cards / matches view. Each participant gets a per-card "Are you attending?" RSVP prompt (via `useSessionVoting`)
6. **Branch A** — If ALL accepted participants RSVP 'attending':
   - `check_card_lock_in` fires → `is_locked=true` + `session.status='locked'`
   - `create_calendar_entries_on_lock` fires → per-participant calendar_entries row with auto-derived `scheduled_at`
   - `onCardLocked` realtime event fires
   - `useCollaborationCalendar` polls for the entry → opens "Plan Locked In!" modal → "Add to Calendar" sync to native calendar
   - **`session.status='locked'` is effectively terminal — no UI continues swiping** (the deck UI presumably gates on `status IN ('pending','active','voting')`; I have NOT directly verified the deck-fetch gating in this investigation — marked as a Phase 3 open question)
7. **Branch B** — If only SOME accepted participants RSVP 'attending':
   - `is_locked` stays false; session stays `'active'` or `'voting'`
   - The matched card sits in the saved-cards list indefinitely
   - **Participants can continue swiping the V_1 deck**, but nothing forces a transition; the deck stays at V_1
   - Eventually deck exhausts → no replenishment because V_1 params haven't changed → empty deck dead-end
8. **Branch C** — If everyone declines or partial decline:
   - Card stays in saved-cards as unlocked; same as Branch B

**KEY FINDING C-1:** The "dead-end after RSVPs" is consistent with two failure modes:
- (a) All-RSVP-attending path → `session.status='locked'` → no V_{n+1} → terminal
- (b) Partial-RSVP path → no lock, no transition, V_1 deck exhausts → empty deck

Both match the operator's reported symptom. The proposed feature fixes both — creator-manual lock skips waiting on RSVPs, schedule-confirm triggers V_{n+1}, fresh deck appears.

### Layer D — Docs

- `Mingla_Artifacts/MEMORY.md` — `feedback_collab_deck_determinism_contract.md` describes ORCH-0902 contract (pref-change → V_{n+1}); does NOT describe schedule-confirm as a trigger (this is the contract amendment ORCH-0908 introduces)
- `SPEC_ORCH-0902` defines lifecycle behavior of the deterministic deck but does NOT define a session lifecycle state machine beyond `status IN ('pending', 'active', 'voting')` references in backfill ([migration:674](../../supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql#L674))
- `collaboration_sessions.status` baseline comment ([line 7977](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L7977)) is sparse: `'Session status: pending (initial state until at least 1 participant accepts), active (at least 1 accepted), archived (completed)'` — does NOT document `'voting'`, `'locked'`, `'completed'`, `'dormant'` despite the CHECK enum allowing them. **Schema docs are stale.**

**KEY FINDING D-1:** Docs are silent on the full state ladder. There is no canonical document describing what `'locked'`, `'completed'`, `'voting'`, `'dormant'` mean operationally. The proposed feature is a chance to canonicalize.

### Layer E — Data

**No live SQL probes run this turn** (investigation is design-mapping focused; data layer probe is more useful at SPEC-validation time to confirm assumptions about real session-status distributions). Probe deferred to SPEC phase or post-spec implementor pre-flight. Recommended probes for SPEC author:

```sql
-- Probe E-1: distribution of collaboration_sessions.status today
SELECT status, COUNT(*) FROM collaboration_sessions GROUP BY status;

-- Probe E-2: confirm 'locked' is reached in production
SELECT id, status, created_at FROM collaboration_sessions
WHERE status = 'locked' ORDER BY created_at DESC LIMIT 10;

-- Probe E-3: are there sessions stuck in 'locked' with no calendar_entries follow-through?
SELECT s.id, s.status, COUNT(ce.id) as entries_count
FROM collaboration_sessions s
LEFT JOIN board_saved_cards bsc ON bsc.session_id = s.id AND bsc.is_locked = true
LEFT JOIN calendar_entries ce ON ce.board_card_id = bsc.id
WHERE s.status = 'locked'
GROUP BY s.id, s.status
HAVING COUNT(ce.id) = 0;

-- Probe E-4: confirm is_admin = true exists for any non-creator participant
SELECT s.id, s.created_by, sp.user_id, sp.is_admin
FROM collaboration_sessions s
JOIN session_participants sp ON sp.session_id = s.id
WHERE sp.is_admin = true AND sp.user_id != s.created_by
LIMIT 10;
```

---

## Phase 2 — Capability gap table

| # | Capability | Current state (cite paths) | Proposed end state | Gap | Net change scope |
|---|---|---|---|---|---|
| 1 | **Session state machine: Planning → Locked In → Scheduled → Planning(V_{n+1})** | Status enum already allows `pending → active → voting → locked → completed/archived/dormant` ([baseline:7968](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L7968)). `check_card_lock_in` transitions `active|voting → locked` ([baseline:3649-3653](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L3649-L3653)). No code transitions `locked → active` (recycle). | Same statuses, NEW transition: `locked → active` on schedule-confirm (or operator's choice of recycle status). | Missing one transition path: locked → active. ~5 lines of SQL in a new RPC. | XS |
| 2 | **"Lock it in" creator action on a matched card** | No UI button, no RPC. Closest existing code: `markCompleted` callback at `SessionViewModal.tsx:571-578` (admin-gated, writes status='completed'). | Creator/admin taps "Lock it in" on a per-card view → RPC sets `board_saved_cards.is_locked=true, locked_by_consensus=false, locked_at=NOW()` AND `collaboration_sessions.status='locked'`. | (a) New per-card action button UI. (b) New RPC `rpc_admin_lock_card(session_id, saved_card_id)` with creator-or-admin auth check. Existing downstream triggers (`create_calendar_entries_on_lock`) work unchanged. | S |
| 3 | **Session co-admin role** | `session_participants.is_admin boolean default false` exists ([baseline:9665](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L9665)). Comment says creator is implicit admin ([9677](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L9677)). `SessionViewModal.tsx:133` reads `isAdmin`. No promotion UI/RPC found. | Creator can promote one accepted participant to co-admin; co-admin can schedule and (per Lock-in trigger decision) optionally also lock. | (a) Promotion UI (settings/sheet inside session view). (b) `rpc_promote_session_admin(session_id, user_id)` with creator-only auth check. (c) Demote variant. (d) Decide single-slot vs multi-slot — SPEC open question. | S |
| 4 | **Scheduling UI — creator picks date/time** | `calendar_entries.scheduled_at timestamptz NOT NULL` exists ([baseline:7869](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L7869)). Today auto-derived in `create_calendar_entries_on_lock` ([baseline:4259](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L4259)). There IS an `onScheduleFromSaved` handler at `app/index.tsx:2107` for some scheduling flow — not investigated this turn. | After Lock-In, a date/time picker appears for creator/co-admin. On confirm, all participants' `calendar_entries.scheduled_at` updated to the picked time. | (a) New post-lock scheduling sheet (bottom-sheet or full-screen — SPEC question). (b) `rpc_admin_schedule_locked_card(saved_card_id, scheduled_at, duration_minutes)` that updates ALL accepted participants' calendar_entries rows + writes device-calendar events via mobile post-RPC. (c) Decide whether to suppress auto-write in `create_calendar_entries_on_lock` or accept the placeholder + UPDATE pattern. | M |
| 5 | **Native device calendar write** | `expo-calendar ~15.0.8` installed at `app-mobile/package.json:73`. `DeviceCalendarService.ts` is production-grade ([all 458 lines](../../app-mobile/src/services/deviceCalendarService.ts)). `useCollaborationCalendar.ts:86-102` calls it after lock. | Same write, but date/time comes from the user-picked schedule rather than auto-derived. The "Plan Locked In!" modal at `SessionViewModal.tsx:889-913` shows AFTER scheduling, not auto. | Zero new mobile-native code. Reorder existing UX: scheduling sheet first, then "Add to Calendar" prompt. | XS |
| 6 | **Session-chat banner host** | `conversations.session_id` + AFTER INSERT trigger from ORCH-0898 give every session an associated group conversation ([migration:89, 181](../../supabase/migrations/20260624000000_orch_0898_unified_chat_substrate.sql#L89)). Mobile chat UI exists at `app-mobile/src/components/chat/` (not opened this turn). | Thin-strip system banner inside the chat shows locked-in plan + scheduled date. Tapping deep-links to the calendar tab or the saved card. | (a) NEW banner component inside the chat conversation view. (b) Banner data source = subscribe to `board_saved_cards WHERE session_id=X AND is_locked=true` (latest). (c) System-message vs persistent header — SPEC question (recommend persistent header to match operator's "thin strip at top" description). | S |
| 7 | **In-app Calendar tab** | `app-mobile/app/` has only `_layout.tsx` + `index.tsx`. There is NO tab structure today. `calendar_entries` query path exists somewhere (referenced as `calendarEntries` in `app/index.tsx:2497`); `scheduledCount` badge exists. `calendarService.ts` exists in services but not opened this turn. | Each participant has a "Calendar" surface showing all their upcoming locked-in plans + solo scheduled experiences. Tap → expanded plan view + cancel/reschedule actions. | Large. (a) Route decision: new sub-screen of `index.tsx` (SPEC: bottom-sheet from home? full-screen modal? slide-in panel?), OR a tabs refactor (heavier). (b) Calendar list UI + empty state + day/week/month grouping (SPEC question). (c) Cancel + reschedule actions (SPEC scope question — must define). (d) Cross-source view (both `'solo'` and `'collaboration'` entries on same surface). | L |
| 8 | **V_{n+1} mint on schedule-confirm** | ORCH-0902 V_{n+1} fires only when `pg_aggregate_collab_prefs` hash changes ([migration:594-597, 556-558](../../supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql#L594-L597)). Schedule confirm changes `calendar_entries`, NOT prefs — so hash unchanged → no mint. | Immediate V_{n+1} mint on schedule-confirm; fresh deck appears for everyone. | Three options for SPEC: (a) Add `cycle_counter int` column to `collaboration_sessions`, include in aggregation hash, increment on schedule-confirm. (b) Add the locked-card's `experience_id` to the aggregation hash (and to a session-level "excluded experience_ids" array passed to `query_servable_places_by_signal_union` so the locked card doesn't re-appear). (c) Bypass trigger; call `pg_aggregate_collab_prefs` + direct UPDATE deck_version+hash in the RPC. Recommended: **(b)** — naturally excludes the locked card from the next round's deck. Also need to reset `board_user_swipe_states` for the session (DELETE or transition to `'not_seen'`) so participants can re-see cards if appropriate. | M |
| 9 | **Declined-invitee semantics across V_n cycles** | `session_participants.has_accepted=false` rows are NOT counted in `pg_aggregate_collab_prefs` ([migration:209-211](../../supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql#L209-L211)). Declined participants don't contribute circles or prefs. | Same — declined stays declined; not re-invited automatically on V_{n+1}. Creator manually re-invites if desired. | No code change needed; behavior already correct. SPEC just needs to make this explicit. | None |
| 10 | **Idle-session timeout (no Lock In tapped)** | No expiration today. Sessions linger indefinitely; `dormant` status exists in enum but is never written by any trigger or RPC I found (grep returned only the CHECK constraint definition). | SPEC question: should the session auto-archive after N days of inactivity post-match? Operator hasn't specified. | Open. Could reuse `dormant` status with a pg_cron job. Defer to SPEC scope decision (likely OUT OF SCOPE for first ORCH-0908 — keep tight). | None (defer) |

---

## Phase 3 — Open questions for SPEC

These are decisions the SPEC writer needs to make (or escalate to operator) that this investigation surfaced but cannot answer from code alone.

### Architecture / scope
- **Q-1 — Co-admin slot count:** Single slot per session, or multiple? Operator said "promote ONE other to co-admin" in the Q&A ("creator-promoted") — recommend single slot, but SPEC confirm.
- **Q-2 — Can co-admin also LOCK, or only SCHEDULE?** Operator answer covered scheduler role explicitly; lock-in trigger answer was "creator manually taps." Recommend: lock=creator-only, schedule=creator+co-admin. SPEC confirm.
- **Q-3 — Promotion UX entry point:** Settings sheet inside `SessionViewModal`? Long-press on participant pill? Three-dot menu? SPEC choose.
- **Q-4 — Calendar tab placement:** New tab (requires tab-bar refactor of `app/index.tsx`), new sub-screen of `index.tsx` reachable via a button/icon on home, or expand the existing `scheduledCount` badge into a full surface? Operator likely has a UX opinion — recommend SPEC author dispatch a `/mingla-designer` consult before locking.
- **Q-5 — Scheduling sheet UX:** Bottom sheet, full-screen modal, or inline on the saved-card detail view? `expo-calendar` provides no native picker; use `@react-native-community/datetimepicker` or build custom? SPEC choose.
- **Q-6 — Banner placement within chat:** Persistent header (always visible above messages), or a system message in the message stream, or both? Operator described "thin strip at top" — recommend persistent header. SPEC confirm.
- **Q-7 — V_{n+1} deck behavior post-schedule:** Does the new deck exclude (a) only the locked card, or (b) all previously-saved cards from V_n, or (c) all previously-right-swiped cards from V_n? Default recommend (a) — the locked card is the only "done" outcome; left-swipes and unmatched right-swipes can re-appear. SPEC choose.
- **Q-8 — board_user_swipe_states reset on V_{n+1}:** DELETE all rows for the session? Transition to `'not_seen'`? Leave as-is (cards already in `swiped_left`/`swiped_right` stay marked)? If left as-is, the same right-swiped card could re-match immediately — likely undesired. Recommend DELETE for the session on V_{n+1} mint. SPEC choose.

### State machine
- **Q-9 — After schedule-confirm, what status does the session move to?** Options: (a) back to `'active'` (clean cycle), (b) a new `'planning_round_2+'` status (requires CHECK enum amendment), (c) stay `'locked'` with a separate `cycle_phase` column. Recommend (a) for minimal schema churn. SPEC choose.
- **Q-10 — Time zone for `scheduled_at`:** `scheduled_at` is `timestamptz` so absolute moment is unambiguous. UI question: creator picks in their TZ; each participant's device calendar event renders in their TZ. Confirm with operator.
- **Q-11 — Calendar-permission denial fallback:** Operator chose "native device calendar" + "in-app calendar tab" + "session chat banner" all together. If a participant declines OS calendar permission, do they still get the banner + in-app calendar tab? (Yes by default; SPEC just confirm.) Should we offer a re-prompt? SPEC choose.
- **Q-12 — Reschedule + cancel semantics:** If creator changes the scheduled date later, every participant's `calendar_entries.scheduled_at` updates + every device calendar event updates via `DeviceCalendarService.updateEventOnDeviceCalendar` (already exists at [line 138](../../app-mobile/src/services/deviceCalendarService.ts#L138)). What about the session state? Stay locked? Cancel = `calendar_entries.status='cancelled'` + session reverts to... ? SPEC decide. Recommend: out-of-scope for first ORCH-0908, follow-on ORCH for reschedule/cancel UX.

### Verification needed in SPEC phase
- **Q-13 — Is the deck UI gated on `session.status`?** I did not directly verify which component file gates the deck render on session status. Could be `useBoardSession`, `RecommendationsContext`, `SwipeableCards`, or a derived `sessionStatus` check anywhere. SPEC author must trace this before the V_{n+1} cycle-back-to-active transition can be guaranteed to resume swiping.
- **Q-14 — What is `app-mobile/src/services/calendarService.ts`?** Not opened this turn. Possibly the React Query layer for `calendar_entries`. Whatever it does, the new "Calendar tab" likely depends on it. SPEC author read first.
- **Q-15 — What is `handleScheduleFromSaved` at `app/index.tsx:2107`?** Suggests scheduling already exists somewhere — possibly for solo cards. SPEC author must reconcile: is the proposed collab schedule UX the same as the existing solo flow, or different? Reuse vs separate?

### Cross-cutting
- **Q-16 — ORCH-0902 routing — fold or follow-on?** This investigation strongly recommends **follow-on**. ORCH-0902 is SPEC complete and IMPLEMENT-ready. Folding ORCH-0908 in would expand the IMPLEMENT scope by 6+ capabilities, risk delaying ORCH-0902 closure, and create one mega-PR where small-PR discipline serves better. The dependency is one-way: ORCH-0908 needs ORCH-0902's V_{n+1} machinery to exist. Operator confirm.
- **Q-17 — Solo parity:** `feedback_solo_collab_parity.md` says always check solo. Does solo today have a Lock In + Schedule + Calendar flow? Yes — `handleScheduleFromSaved` and `source='solo'` in `calendar_entries` suggest a solo equivalent exists. The collab version mostly inherits solo's calendar-write machinery. SPEC author confirm the solo flow is unchanged.

---

## Phase 4 — Cross-Surface Impact Declaration

| Surface | In scope | Why / What changes |
|---|---|---|
| **Consumer iOS** (`app-mobile/` on iOS) | YES | All UI: Lock-In button, schedule sheet, co-admin promotion UI, calendar-tab surface, chat banner. `expo-calendar` runs on iOS via CalendarKit. Primary surface. |
| **Consumer Android** (`app-mobile/` on Android) | YES | Parity automatic via React Native — same TypeScript runs. `expo-calendar` writes to Google Calendar / Android Calendar Provider. Tester must verify both simulators per ORCH-0902 SPEC §"Parity statement." |
| **Backend** (Supabase: migrations, edge fns, RPCs, triggers) | YES | New columns (possibly): `cycle_counter`, `last_locked_card_id`, etc. New RPCs: `rpc_admin_lock_card`, `rpc_admin_schedule_locked_card`, `rpc_promote_session_admin`. Trigger amendments: extend `pg_aggregate_collab_prefs` for V_{n+1} mint on schedule-confirm. Possibly amend `create_calendar_entries_on_lock`. |
| **Buyer/anonymous Web** (`mingla-business/` checkout, brand pages, event pages) | NO | Collab sessions are not exposed on buyer-anon routes. No surface to change. |
| **Business iOS** (`mingla-business/` on iOS) | NO | Mingla Business has no collab session feature. No surface to change. |
| **Business Android** | NO | Same as Business iOS. |
| **Admin Web** (`mingla-admin/`) | NO (per operator) | Operator explicitly excluded admin-web at INTAKE. If support needs to override-schedule a stuck session, that becomes a separate follow-up ORCH. Confirm at SPEC: do we want a read-only admin view of session lifecycle for support triage? Default NO; spawn follow-up if needed. |
| **Business Web preview** | NO | Out of scope. |

**Parity contract:** Backend changes (schema + triggers + RPCs) serve iOS and Android equally. Mobile changes ship in shared `app-mobile/src/` directories — parity automatic. Tester MUST exercise both simulators per the canonical TEST parity rule.

---

## Six-field evidence — Reported gap "no way to continue swiping after RSVPs"

| Field | Evidence |
|---|---|
| **Symptom** | After participants RSVP to a matched card in a collab session, the deck dead-ends — no way to keep swiping for the next outing within the same session. |
| **Reproducer** | (a) Create collab session, accept invites for ≥2 participants. (b) Each participant swipes; ≥2 right-swipes on same card → match. (c) Either all participants RSVP attending OR some do/don't. (d) Try to keep swiping — no deck content. |
| **Observed** | Two failure modes: (i) all RSVP 'attending' → `check_card_lock_in` ([baseline:3641-3653](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L3641-L3653)) flips `session.status='locked'` → deck UI presumably gates on status (Q-13 unverified) → no further deck served. (ii) partial RSVPs → no lock → session stays `'active'`/`'voting'`, V_1 deck exhausts → no V_{n+1} mint without a prefs change → empty deck. |
| **Expected (per operator)** | Session is a recurring container. Match → creator taps "Lock it in" → scheduling UI → schedule-confirm → V_{n+1} mints immediately → fresh deck appears. Cycle repeats indefinitely. |
| **Root cause hypothesis (PROBABLE)** | The current session lifecycle is designed as one-shot. `'locked'` and `'completed'` are terminal statuses with no recycle path. The ORCH-0902 V_{n+1} mint trigger only fires on `participant_prefs`/`updated_at` changes that produce a different aggregation hash; schedule-confirm doesn't naturally change the hash and so doesn't mint. There is no "lock the matched card and start over" code path. |
| **Verification step (deferred to SPEC + IMPLEMENT)** | (a) Run probe E-2 + E-3 to confirm `'locked'` sessions exist in production and stop receiving deck updates. (b) Open the deck-fetch service (`useDeckCards` / `RecommendationsContext`) and confirm whether it gates on `session.status`. (c) Live-fire repro on iOS sim with two test users: create session, accept, swipe to match, RSVP attending, try to keep swiping. Capture the dead-end state. |

**Confidence:** `probable` — root cause is consistent with the code paths read but not directly observed at runtime. Source-only reasoning ceiling per Prime Directive 7 is `suspected`; I'm at `probable` because the code paths from RSVP → status change → calendar entry creation are exhaustively traced and the missing-recycle-path is structurally evident. SPEC author should promote to `proven` via live-fire repro before locking the spec.

---

## Confidence per finding

| Finding | Confidence | Reason |
|---|---|---|
| A-1 — status enum already includes locked/completed/etc | HIGH | Direct CHECK constraint reading |
| A-2 — is_admin field exists | HIGH | Direct CREATE TABLE reading |
| A-3 — board_saved_cards.is_locked exists | HIGH | Direct CREATE TABLE reading |
| A-4 — calendar_entries schema | HIGH | Direct CREATE TABLE reading |
| A-5 — conversations.session_id from ORCH-0898 | HIGH | Migration comment direct quote |
| B-1 — advanceToVoting/markCompleted patterns | HIGH | Direct file read |
| B-2 — "Plan Locked In!" modal | HIGH | Direct file read |
| B-3 — DeviceCalendarService production-grade | HIGH | Full file read |
| B-4 — check_card_lock_in is gang-consensus | HIGH | Full function body read |
| B-5 — create_calendar_entries_on_lock auto-derives | HIGH | Full function body read |
| B-6 — V_{n+1} mint requires hash change | HIGH | Full trigger function read |
| C-1 — dead-end after RSVPs | PROBABLE | Source-only; sim repro not run this turn — deferred to SPEC/IMPLEMENT |
| D-1 — docs stale on full state ladder | HIGH | Comment text vs CHECK constraint divergence |

---

## Recommended next phase

**Dispatch:** SPEC mode owned by Claude `mingla-forensics`.

**SPEC dependencies to resolve before IMPLEMENT:** Q-1, Q-2, Q-4, Q-7, Q-9 are operator-decision-gated (recommend SPEC author bundle into a single AskUserQuestion in operator turn). Q-13, Q-14, Q-15 are verification work the SPEC author must complete by reading deck-gate code + `calendarService.ts` + `handleScheduleFromSaved`. Q-16 is the routing call — recommend operator decide via the SPEC author's recommendation (which this investigation has stated: follow-on ORCH, not fold-in).

**SPEC scope MUST include all 10 capabilities** from the Phase 2 table, with separate success criteria per capability and explicit per-surface coverage (Phase 4). The SPEC must also enumerate the V_{n+1} mint mechanism choice (option a/b/c from capability 8).

**Recommended routing:** After SPEC review, IMPLEMENT dispatches to Codex `implementor-mingla` (canonical IMPLEMENT owner per parity routing). TEST dispatches to Claude `mingla-tester` with explicit instruction to live-fire repro the cycle (create → swipe → match → lock → schedule → V_{n+1} → swipe again) on both iOS and Android simulators with two test users. CLOSE either orchestrator.

**Estimated SPEC size:** Large (~1000+ lines). Multiple layers, multiple RPCs, multi-surface UI. Equivalent in scope to ORCH-0898 [unified chat substrate].

---

## Discoveries for orchestrator

- **DISC-0908-1 — Status enum vs comment drift:** `collaboration_sessions.status` CHECK enum allows seven values (`pending|active|voting|locked|completed|archived|dormant`); the column comment ([baseline:7977](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L7977)) only documents three. SPEC phase should refresh this comment as part of CR-x. P3.
- **DISC-0908-2 — `dormant` status is unused:** Grep found CHECK constraint only — no trigger or RPC writes `'dormant'`. Either remove from enum or use it for the new idle-timeout idea (Q-Idle in Phase 3). P4.
- **DISC-0908-3 — `boardSessionPreferences.datetime_pref` is the auto-schedule source:** This column at [baseline:9037](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L9037) feeds `create_calendar_entries_on_lock`. If SPEC chooses to keep auto-create + UPDATE pattern, this column stays load-bearing. If SPEC chooses to suppress auto-write, this column becomes dead code in the collab path (still load-bearing for solo if applicable). Note for SPEC. P4.
- **DISC-0908-4 — Existing `handleScheduleFromSaved` at `app/index.tsx:2107`:** Suggests scheduling UX already exists for some flow. SPEC author MUST investigate before designing the proposed scheduling sheet — may be 80% reusable for collab. Could reduce capability-4 work from M to S. P3.
- **DISC-0908-5 — ORCH-0902 has not yet shipped per `MEMORY.md`:** ORCH-0908 implementation depends on ORCH-0902's V_{n+1} machinery being live. Routing implication: ORCH-0902 must merge first, OR ORCH-0908 must wait, OR the two ORCHs ship as a coordinated pair. Operator decision. P2.
- **DISC-0908-6 — `calendarService.ts` exists separately from `deviceCalendarService.ts`:** Not opened this turn. Likely the React Query layer for `calendar_entries`. SPEC author must open before scoping the Calendar tab capability. P3.
- **DISC-0908-7 — `scheduledCount` badge already surfaces on home:** `app/index.tsx:2497` reads `calendarEntries?.length` and shows a count. The Calendar tab is partially "implied" already — a list view that shows what the badge counts. P4.

---

## Next phase routing summary

This investigation finds that ORCH-0908 is **a contour adjustment, not a greenfield build**. ~80% of the infrastructure exists (`is_admin`, `'locked'` status, `is_locked` per-card, `check_card_lock_in` trigger, `create_calendar_entries_on_lock` trigger, `calendar_entries` schema, `DeviceCalendarService`, "Plan Locked In!" modal, conversations.session_id chat link, ORCH-0902 V_{n+1} machinery). The SPEC scope is the THREE surgical gaps (creator-manual lock, user-picked schedule, V_{n+1}-on-schedule-confirm) plus the FOUR UX additions (Lock In button, scheduling sheet, co-admin promotion UI, Calendar tab + chat banner).

Ready for SPEC dispatch.
