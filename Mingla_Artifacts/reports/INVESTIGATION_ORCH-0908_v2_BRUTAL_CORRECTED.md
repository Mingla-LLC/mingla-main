# INVESTIGATION v2 (BRUTAL CORRECTED) — ORCH-0908: Collab Session Lifecycle

**Date:** 2026-05-21
**Author:** Claude `mingla-forensics`
**Supersedes:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0908_COLLAB_SESSION_LIFECYCLE_LOCKIN_SCHEDULE_RECYCLE.md` (v1)
**Reason for v2:** v1 claimed several capabilities as "not built" or "needs SPEC decision" that turned out to ALREADY EXIST in production. Operator pushback on Q3 (Calendar tab), Q4 (deck exclusion), and Q2 (co-admin) triggered a brutal exhaustive sweep. This v2 corrects the record with file:line evidence on every existence claim and every gap.

**Verification standard for v2:** No capability is declared "missing" unless an Explore agent (or this author directly) exhaustively grepped the codebase for it across all surfaces (`app-mobile/`, `mingla-admin/`, `mingla-business/`, `supabase/migrations/`, `supabase/functions/`) and returned ZERO matches. No capability is declared "exists" unless cited with file:line.

---

## Layman summary

**The hard truth:** v1 of this investigation was wrong on at least four counts. The Mingla codebase has dramatically more of the feature you described already built than v1 admitted. Specifically:

- **Co-admin role + promotion UI** is fully shipped (ORCH-0520). Not partial. Not "schema-ready." Fully shipped, with multiple admin slots, demote support, and `isAdmin` already gating two state-transition buttons in `SessionViewModal`.
- **Calendar tab** exists as `<CalendarTab>` inside `LikesPage` — a 2100-line component with active/archive split, search, when-filter, category-filter, reschedule, delete, share, device-calendar sync, and unified rendering of solo + collaboration + business-event tickets.
- **Scheduling UI** exists — `ProposeDateTimeModal` is production-grade with `@react-native-community/datetimepicker`. Wired into both `SavedTab.handleSchedule` (schedule a saved card) and `CalendarTab.handleReschedule` (change an existing entry's date).
- **`excludeCardIds` parameter** is plumbed end-to-end through `useDeckCards` → `deckService` → `discover-cards` edge function. The function accepts it both in the solo branch (line 1454) and is supported by ORCH-0902's `query_servable_places_by_signal_union` (param 4).
- **Group chat for collab sessions** is fully shipped (ORCH-0898). Every session has a paired group conversation. Members auto-sync. System-message rendering pattern exists (`sender_id=NULL` + `isSystem` flag). No new chat substrate needed.
- **Auto-lock cascade is intact and notifications fire via realtime.** `onCardLocked` realtime event already propagates; existing UI consumers already react (RSVP buttons disable, "Locked In" badge appears, "Plan Locked In!" modal fires).

**What actually needs to be built:**

1. **Creator-manual lock RPC + UI button** (zero existing lock UI; ZERO existing direct writes to `is_locked` outside the trigger).
2. **Post-lock scheduling sheet UX** that lets the creator/co-admin pick a date/time and writes it to ALL participants' calendar_entries rows in one transaction.
3. **`locked → active` recycle transition + V_{n+1} mint on schedule-confirm** (no recycle path exists today; ORCH-0902 mints only on prefs/participant changes).
4. **Session-chat banner** showing the locked-in plan above the message list (no pinned-banner pattern exists in `BoardDiscussion.tsx`).
5. **Lock-in system message** in the group chat (`sender_id=NULL` insert into `messages` with appropriate `message_type` — generator doesn't exist today).
6. **Visual differentiation of session pill / SessionViewModal layout when `status='locked'`** (currently static — no layout branch on status today).
7. **Collab source badge styling fix in CalendarTab** (line 1586 applies solo badge style regardless of source; the `collaborationBadge` styles at lines 819-831 are dead code).
8. **The dead-stub `handleScheduleFromSaved` at `app/index.tsx:2107`** — currently `console.log` only; either delete or wire to real handler. Discovery, not strictly required for the feature.

**That's it. The whole feature is a thin layer of glue on top of an almost-complete substrate.**

---

## Phase 1 — Brutal corrected current-state by capability

For each capability, three columns: **EXISTS** (file:line evidence), **PARTIAL** (what's there + what's broken), **NOT BUILT** (negative-search evidence — what greps returned zero).

### Capability 1 — Session state machine (status enum + transitions)

**EXISTS:**
- Status enum (7 values): `'pending' | 'active' | 'voting' | 'locked' | 'completed' | 'archived' | 'dormant'` — [`baseline:7968`](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L7968)
- INSERT default `'pending'` — [`useSessionManagement.ts:369`](../../app-mobile/src/hooks/useSessionManagement.ts#L369)
- `pending → active` on accept — [`collaborationInviteService.ts:319`](../../app-mobile/src/services/collaborationInviteService.ts#L319)
- `active|voting → locked` via `check_card_lock_in` trigger (gang-consensus) — [`baseline:3649-3650`](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L3649-L3650)
- `active → voting` admin-gated — [`SessionViewModal.tsx:561-569`](../../app-mobile/src/components/SessionViewModal.tsx#L561-L569)
- `voting|active → completed` admin-gated — [`SessionViewModal.tsx:571-578`](../../app-mobile/src/components/SessionViewModal.tsx#L571-L578)
- `handle_collab_session_end` reads `status IN ('completed','archived')` for leaderboard cleanup — [`baseline:5170`](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L5170)

**PARTIAL:**
- `'dormant'` is in the CHECK constraint but NEVER written to DB by any code; only computed client-side at [`useSessionManagement.ts:240`](../../app-mobile/src/hooks/useSessionManagement.ts#L240) as a derived UI label
- `'archived'` is in the CHECK constraint but no explicit `UPDATE status='archived'` exists in any migration, RPC, edge function, or mobile call site (only `archived_at` timestamp is written)

**NOT BUILT:**
- No `locked → active` (or any recycle) transition anywhere in repo — Explore agent confirmed via exhaustive grep
- No state-machine document in `Mingla_Artifacts/`
- No formal lifecycle comment beyond the stale 3-state comment at [`baseline:7977`](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L7977)

### Capability 2 — Creator-manual "Lock it in" button + RPC

**EXISTS:** Nothing.

**PARTIAL:** Nothing.

**NOT BUILT:** Exhaustively confirmed by Explore agent:
- No UI button labeled "Lock", "Lock In", "Lock it in", "Confirm Plan", "Freeze", "Finalize" anywhere in `app-mobile/src/`
- No direct `.update({ is_locked: true })` from mobile/edge/admin — the trigger is the SOLE writer
- No RPC named anything like `rpc_admin_lock_card`, `rpc_force_lock`, `rpc_manual_lock`
- No edge function for unilateral lock
- RLS `bsc_insert_trigger_or_service_only` ([`baseline:15571`](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L15571)) blocks user-context INSERTs; UPDATE is participant-gated but no user-context code attempts it

### Capability 3 — Session co-admin role + promotion UI

**EXISTS — FULLY SHIPPED via ORCH-0520:**
- Column: `session_participants.is_admin boolean DEFAULT false` — [`baseline:9665`](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L9665)
- Comment: "creator is always admin regardless of this flag" — [`baseline:9677`](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L9677)
- Partial index on `(session_id, is_admin) WHERE is_admin=true` — [`baseline:12207`](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L12207)
- Promote UI: [`BoardSettingsDropdown.tsx:393`](../../app-mobile/src/components/board/BoardSettingsDropdown.tsx#L393) (`.update({ is_admin: true })`)
- Demote UI: [`BoardSettingsDropdown.tsx:371`](../../app-mobile/src/components/board/BoardSettingsDropdown.tsx#L371) (`.update({ is_admin: false })`)
- Multi-admin support: [`BoardSettingsDropdown.tsx:147`](../../app-mobile/src/components/board/BoardSettingsDropdown.tsx#L147) (filter + count, no slot cap)
- Permission gate: creator OR existing admin — [`BoardSettingsDropdown.tsx:163`](../../app-mobile/src/components/board/BoardSettingsDropdown.tsx#L163)
- `isAdmin` flag derived in `useBoardSession`: `isCreator || userParticipant?.is_admin === true` — [`useBoardSession.ts:177-181`](../../app-mobile/src/hooks/useBoardSession.ts#L177-L181)
- Already consumed by `advanceToVoting` and `markCompleted` — [`SessionViewModal.tsx:562,572`](../../app-mobile/src/components/SessionViewModal.tsx#L562)

**Net work for ORCH-0908:** ZERO. New RPCs (lock + schedule) just reuse the existing `isAdmin` flag. No new infrastructure.

### Capability 4 — Scheduling UI (date/time picker)

**EXISTS — FULLY SHIPPED:**
- Picker component: `ProposeDateTimeModal.tsx` with `@react-native-community/datetimepicker` — [`ProposeDateTimeModal.tsx:16`](../../app-mobile/src/components/activity/ProposeDateTimeModal.tsx#L16)
- iOS modal wrapper with Done button — [`ProposeDateTimeModal.tsx:684-701`](../../app-mobile/src/components/activity/ProposeDateTimeModal.tsx#L684-L701)
- Used for initial scheduling (solo): [`SavedTab.tsx:1056-1073`](../../app-mobile/src/components/activity/SavedTab.tsx#L1056-L1073)
- Used for reschedule (collab + solo): [`CalendarTab.tsx:590-702`](../../app-mobile/src/components/activity/CalendarTab.tsx#L590-L702)
- Reusable `MultiDayCalendar.tsx` exists for multi-date selection (available but not currently used for single-date scheduling) — [`ui/MultiDayCalendar.tsx`](../../app-mobile/src/components/ui/MultiDayCalendar.tsx)

**PARTIAL:**
- `handleScheduleFromSaved` at [`app/index.tsx:2107-2109`](../../app-mobile/app/index.tsx#L2107-L2109) is a `console.log` stub — passed as prop to LikesPage but never wired. The REAL handler is `SavedTab.handleSchedule` (internal). Dead stub.

**NOT BUILT:**
- No "schedule a LOCKED card" flow today. Today's lock auto-derives `scheduled_at` from `board_session_preferences.datetime_pref` via [`create_calendar_entries_on_lock:4259`](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L4259). There's no post-lock UI that lets the creator pick a date and write it to ALL participants' calendar_entries simultaneously.
- No multi-participant scheduled_at update RPC — `CalendarService.updateEntry` at [`calendarService.ts:264-292`](../../app-mobile/src/services/calendarService.ts#L264-L292) updates only the calling user's row (enforces `user_id` match)

### Capability 5 — Native device calendar write/update/delete

**EXISTS — FULLY SHIPPED:**
- `DeviceCalendarService.addEventToDeviceCalendar` — [`deviceCalendarService.ts:79-132`](../../app-mobile/src/services/deviceCalendarService.ts#L79-L132)
- `DeviceCalendarService.updateEventOnDeviceCalendar` — [`deviceCalendarService.ts:138-161`](../../app-mobile/src/services/deviceCalendarService.ts#L138-L161)
- `DeviceCalendarService.removeEventFromDeviceCalendar` — [`deviceCalendarService.ts:260-278`](../../app-mobile/src/services/deviceCalendarService.ts#L260-L278)
- `DeviceCalendarService.removeEventByTitleAndDate` fallback — [`deviceCalendarService.ts:284-330`](../../app-mobile/src/services/deviceCalendarService.ts#L284-L330)
- `device_calendar_event_id` stored in `calendar_entries` for direct update/delete — [`baseline:7880`](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L7880)
- Reschedule path direct-updates device event — [`CalendarTab.tsx:627-629`](../../app-mobile/src/components/activity/CalendarTab.tsx#L627-L629)
- Reschedule fallback: delete-and-recreate when `device_calendar_event_id` is NULL — [`CalendarTab.tsx:632-658`](../../app-mobile/src/components/activity/CalendarTab.tsx#L632-L658)

**PARTIAL:**
- Auto-created collab calendar_entries rows (via `create_calendar_entries_on_lock` trigger) do NOT have `device_calendar_event_id` populated — they're inserted with NULL. The reschedule path then takes the delete-and-recreate fallback for collab entries. Not broken; just suboptimal. Not in ORCH-0908 scope to fix.

**NOT BUILT:**
- No multi-participant device-calendar broadcast (today each participant writes their own device event via their own client; this is correct — `expo-calendar` is per-device per-user)

### Capability 6 — Calendar tab (in-app calendar view)

**EXISTS — FULLY SHIPPED:**
- Tab definition: `LikesTab = 'saved' | 'calendar'` — [`LikesPage.tsx:93-96`](../../app-mobile/src/components/LikesPage.tsx#L93-L96)
- Tab switching: [`LikesPage.tsx:143-150`](../../app-mobile/src/components/LikesPage.tsx#L143-L150)
- Conditional render: [`LikesPage.tsx:321-347`](../../app-mobile/src/components/LikesPage.tsx#L321-L347)
- Calendar entry rendering: [`CalendarTab.tsx:1488-1896`](../../app-mobile/src/components/activity/CalendarTab.tsx#L1488-L1896)
- Active/archive split by entry END time (ORCH-0850): [`CalendarTab.tsx:263-368`](../../app-mobile/src/components/activity/CalendarTab.tsx#L263-L368)
- Filters: search, when (today/week/month/upcoming/all), category, tier — [`CalendarTab.tsx:287-344`](../../app-mobile/src/components/activity/CalendarTab.tsx#L287-L344)
- Unified rendering of solo + collab + business events: [`CalendarTab.tsx:476-537`](../../app-mobile/src/components/activity/CalendarTab.tsx#L476-L537)
- Reschedule, delete, share actions all wired
- Collab entries pass through filter (no source-discrimination filter): [`CalendarTab.tsx:480-491`](../../app-mobile/src/components/activity/CalendarTab.tsx#L480-L491)
- Source label render: shows session name for collab entries — [`CalendarTab.tsx:1584-1594`](../../app-mobile/src/components/activity/CalendarTab.tsx#L1584-L1594)
- Calendar entries query: `useCalendarEntries` + `CalendarService.fetchConsumerCalendar` — [`useCalendarEntries.ts:161`](../../app-mobile/src/hooks/useCalendarEntries.ts#L161)
- Realtime updates: `useSocialRealtime.ts:113` subscribes to `calendar_entries` postgres_changes — [`useSocialRealtime.ts:113`](../../app-mobile/src/hooks/useSocialRealtime.ts#L113)

**PARTIAL:**
- Source badge STYLING for collab is dead code: `collaborationBadge` + `collaborationText` styles defined at [`CalendarTab.tsx:819-831`](../../app-mobile/src/components/activity/CalendarTab.tsx#L819-L831) but the rendering at [`CalendarTab.tsx:1586`](../../app-mobile/src/components/activity/CalendarTab.tsx#L1586) always applies the `soloBadge` style regardless of `entry.source`. **Bug — fix in ORCH-0908 SPEC scope.**

**NOT BUILT:**
- N/A — the surface is complete enough for ORCH-0908. No new tab structure needed.

### Capability 7 — Session-chat banner (locked-in plan + scheduled date strip)

**EXISTS:**
- Chat surface for sessions: `BoardDiscussion.tsx` mounts on `SessionViewModal` — [`BoardDiscussion.tsx:195`](../../app-mobile/src/components/BoardDiscussion.tsx#L195)
- Conversation lookup: `messagingService.getOrCreateGroupConversationForSession` — [`messagingService.ts:788-826`](../../app-mobile/src/services/messagingService.ts#L788-L826)
- Header above message list: [`BoardDiscussion.tsx:428-492`](../../app-mobile/src/components/BoardDiscussion.tsx#L428-L492)
- Message FlatList: [`BoardDiscussion.tsx:571`](../../app-mobile/src/components/BoardDiscussion.tsx#L571)
- Realtime message subscription: channel `conversation:${conversationId}` — [`useSessionDiscussion.ts:125`](../../app-mobile/src/hooks/useSessionDiscussion.ts#L125)

**PARTIAL:**
- System message RENDERING pattern exists at [`MessageBubble.tsx:156-163`](../../app-mobile/src/components/chat/MessageBubble.tsx#L156-L163) (centered, muted, no chrome) — but no GENERATOR writes system messages today (Explore confirmed `grep messages.sender_id = NULL` returned zero in mobile code)

**NOT BUILT:**
- No pinned-banner pattern above the message FlatList. The natural mount point is between [`BoardDiscussion.tsx:528`](../../app-mobile/src/components/BoardDiscussion.tsx#L528) (headerRow close) and [`BoardDiscussion.tsx:571`](../../app-mobile/src/components/BoardDiscussion.tsx#L571) (FlatList).
- No realtime subscription to `collaboration_sessions` from the chat surface — banner would need either (a) new subscription, or (b) poll on focus, or (c) propagate via `onSessionUpdated` callback already wired in `useBoardSession.ts`

### Capability 8 — V_{n+1} mint on schedule-confirm + deck-recycle

**EXISTS:**
- V_n versioning + `recompute_deck_version_after_prefs_change` trigger — [`migration 20260625000000:594-597`](../../supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql#L594-L597)
- `session_deck_versions` history table — [`migration 20260625000000:61-69`](../../supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql#L61-L69)
- `query_servable_places_by_signal_union(p_signal_id, p_filter_min, p_circles, p_exclude_place_ids, p_limit)` — exclude param exists at [`migration 20260625000000:354`](../../supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql#L354)
- `excludeCardIds` mobile plumbing: `useDeckCards.ts:61` → `deckService.ts:438` → `discover-cards/index.ts:1454` (solo path); collab path uses `pg_aggregate_collab_prefs` whose hash determines mint
- `discover-cards` collab branch reads session row + calls `pg_aggregate_collab_prefs` — [`discover-cards/index.ts:727-771`](../../supabase/functions/discover-cards/index.ts#L727-L771)

**PARTIAL:**
- V_{n+1} mint fires ONLY when the aggregation hash changes. Schedule-confirm does NOT naturally change the hash because `scheduled_at` is not part of `pg_aggregate_collab_prefs` output ([`migration 20260625000000:322-330`](../../supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql#L322-L330) shows what's hashed: categories+intents+dateWindows+selectedDates+datetimePref+circles+acceptedCount). Need a new mint trigger.
- All `excludeCardIds` call sites pass `[]` empty arrays today: [`RecommendationsContext.tsx:723,748,783,844,1106`](../../app-mobile/src/contexts/RecommendationsContext.tsx#L723) — the client never excludes anything. The server-side deck presumably relies on `board_user_swipe_states` for de-duplication (still need verify; Explore did not confirm).

**NOT BUILT:**
- No `locked → active` recycle path on `collaboration_sessions.status`
- No code that resets / archives `board_user_swipe_states` rows on V_{n+1} mint
- No "round counter" column on `collaboration_sessions`
- No mechanism to include the locked card's `place_id` in `p_exclude_place_ids` for the next mint

### Capability 9 — Lock-in notifications (push, email, in-app, system message)

**EXISTS:**
- `notify-session-match` edge function — fires on MATCH (not lock); sends push via `notify-dispatch` — [`notify-session-match/index.ts:1-224`](../../supabase/functions/notify-session-match/index.ts)
- `match_telemetry_events` rows written by `check_mutual_like` — [`baseline:3855-3863`](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L3855-L3863)
- `onCardLocked` realtime callback fires on `is_locked=true` transition — [`realtimeService.ts:602-619`](../../app-mobile/src/services/realtimeService.ts#L602-L619)
- "Plan Locked In!" prompt modal — [`SessionViewModal.tsx:889-913`](../../app-mobile/src/components/SessionViewModal.tsx#L889-L913)

**PARTIAL:**
- Realtime fires on lock but nothing else happens server-side (no push, no email, no in-app row)

**NOT BUILT:**
- No push notification on `is_locked` transition (Explore confirmed via grep `notify-`, `push`, `OneSignal`, `lock`, `locked` in edge functions — zero matches for lock-specific notifications)
- No email on lock-in
- No `notifications` table INSERT on lock-in
- No system message inserted into the group chat on lock-in
- No visual change on session pill when `status='locked'` — [`CollaborationSessions.tsx`](../../app-mobile/src/components/CollaborationSessions.tsx) doesn't read or branch on lock state
- No layout change in `SessionViewModal` when `status='locked'`

### Capability 10 — Auto-lock cascade (today's gang-consensus path)

**EXISTS — FULLY SHIPPED (operator wants to KEEP this as fallback or REMOVE per Q-A below):**
- Trigger: `check_card_lock_in` on `board_card_rsvps` AFTER INSERT/UPDATE — [`baseline:3600-3658`](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L3600-L3658)
- Per-card RSVP UI: [`useSessionVoting.ts:446-476`](../../app-mobile/src/hooks/useSessionVoting.ts#L446-L476) (yes/no/maybe upsert)
- Realtime board_card_rsvps subscription: [`realtimeService.ts:432-460`](../../app-mobile/src/services/realtimeService.ts#L432-L460)
- Locked badge in `SwipeableBoardCards` and `SwipeableSessionCards`: lines 225, 281, 333, 355, 492 and 232, 256-284
- Calendar-entry creation: `create_calendar_entries_on_lock` — [`baseline:4213-4267`](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L4213-L4267)

**Open Q-A for operator:** The current gang-consensus path is a SECOND path to lock. ORCH-0908 adds a creator-manual path. Do we (a) keep both — gang-consensus still locks if everyone RSVPs attending; creator-manual is an admin override; OR (b) remove the gang-consensus path — only creator-manual locks; RSVP becomes display-only? Default recommend (a) — keep both, since gang-consensus is correct UX for groups where the creator wants democratic decision; creator-manual is just an admin shortcut. SPEC author confirm with operator.

---

## Phase 2 — What ACTUALLY changes / What ACTUALLY gets built

### Things that DO NOT change at all (re-confirmed from v1)
- Co-admin role + promotion UI (already shipped — reuse `isAdmin`)
- Calendar tab surface + reschedule/delete actions (already shipped)
- `ProposeDateTimeModal` (already shipped — reuse for scheduling sheet)
- `DeviceCalendarService` add/update/remove (already shipped — reuse)
- `CalendarService` CRUD (already shipped — reuse with one addition: a service-role multi-participant update path or RPC)
- `excludeCardIds` plumbing (already shipped — just need to populate it)
- Group chat substrate, conversation auto-creation, member auto-sync (already shipped — reuse)
- System-message render pattern (already shipped — reuse with one new generator)
- Realtime channels for board sessions + conversations + calendar_entries (already shipped — reuse)
- Existing match → save_card → RSVP → auto-lock pipeline (decision: keep as second path; not in ORCH-0908 spec scope to remove)

### Things that CHANGE (modifications to existing code)
1. **Mint trigger expansion** — `recompute_deck_version_after_prefs_change` needs to ALSO fire on a new event (schedule-confirm). Either: (a) extend the trigger to fire on additional column changes, (b) call the trigger function directly from a new RPC, or (c) write a new sibling RPC `rpc_force_deck_recycle(session_id, exclude_place_ids[])` that increments deck_version and writes a new `session_deck_versions` row with the locked card excluded. Recommended: (c).
2. **CalendarTab source-badge styling fix** — change [`CalendarTab.tsx:1586`](../../app-mobile/src/components/activity/CalendarTab.tsx#L1586) to apply `collaborationBadge` style when `entry.source === 'collaboration'` (5-line change; dead styles at 819-831 become live).
3. **Session pill visual on `status='locked'`** — add a visual cue to [`CollaborationSessions.tsx`](../../app-mobile/src/components/CollaborationSessions.tsx) pill rendering. Pattern: lock-icon badge or color shift on the pill when session has a locked-in scheduled card.
4. **Delete the dead stub `handleScheduleFromSaved`** at [`app/index.tsx:2107-2109`](../../app-mobile/app/index.tsx#L2107-L2109) — or wire it properly. Discovery flagged; not strictly required.

### Things that get BUILT from scratch
1. **`rpc_admin_lock_card(p_session_id uuid, p_saved_card_id uuid) RETURNS jsonb`** — auth check (creator or is_admin); UPDATE `board_saved_cards.is_locked=true, locked_at=NOW(), locked_by_consensus=false`; UPDATE `collaboration_sessions.status='locked'` if not already. Downstream triggers (`create_calendar_entries_on_lock` + realtime `onCardLocked`) fire automatically.
2. **"Lock it in" button** in the SAVED CARDS view of a session (likely in `SwipeableBoardCards` or a per-card detail view) — admin-gated; calls the new RPC; haptic + toast on success.
3. **Post-lock scheduling sheet** — UX that opens after `onCardLocked` fires (or via a "Schedule" button on the locked card). Reuses `ProposeDateTimeModal`. On confirm, calls new RPC.
4. **`rpc_admin_schedule_locked_card(p_session_id uuid, p_saved_card_id uuid, p_scheduled_at timestamptz, p_duration_minutes int) RETURNS jsonb`** — auth check (creator or is_admin); SECURITY DEFINER; UPDATE `calendar_entries SET scheduled_at=p_scheduled_at, duration_minutes=p_duration_minutes WHERE board_card_id=p_saved_card_id AND source='collaboration'` (all participants in one statement); call `rpc_force_deck_recycle` inline OR via post-RPC client call; UPDATE `collaboration_sessions.status='active'` (recycle). After the RPC returns success, the client uses `DeviceCalendarService.updateEventOnDeviceCalendar` to update the per-user device calendar event (if `device_calendar_event_id` populated) or fall back to add-new.
5. **`rpc_force_deck_recycle(p_session_id uuid, p_exclude_place_ids uuid[]) RETURNS int (new deck_version)`** — auth check (creator or is_admin); reads current aggregation, generates new hash from `digest(agg::text || cycle_salt::text)` so hash differs; inserts new `session_deck_versions` row with `aggregated_params` augmented with `exclude_place_ids`; updates `collaboration_sessions.deck_version + deck_params_hash`. CR-4 history is preserved automatically. The locked card's place_id goes into the exclude list permanently (per recommendation in Q-7).
6. **`discover-cards` collab branch — read `exclude_place_ids` from the latest `session_deck_versions.aggregated_params`** — small edit to pass that array into `query_servable_places_by_signal_union(p_exclude_place_ids := ...)`. Already a parameter; just need to populate it.
7. **System-message generator on lock-in** — extend `rpc_admin_lock_card` to INSERT a row into `messages` for the session's conversation with `sender_id=NULL`, `message_type='text'` (or extend enum to `'system'`), `content='Plan locked in: {{card.title}}'` + `card_payload` referencing the locked card. Realtime propagates to all chat members.
8. **System-message generator on schedule-confirm** — extend `rpc_admin_schedule_locked_card` similarly: `content='Scheduled for {{formatted_date}}'`.
9. **Chat banner component** in `BoardDiscussion.tsx` between lines 528 and 571 — a persistent thin strip showing locked card + scheduled date. Subscribes to session state via the existing `useBoardSession` `session` object (no new realtime channel needed). Renders when `session.status === 'locked'` AND the latest locked card has `calendar_entries.scheduled_at`.
10. **`board_user_swipe_states` reset on V_{n+1} mint** — Q-OPEN: do we DELETE rows for the session, transition them to `'not_seen'`, or leave them? If we leave them, re-swiped-right cards would re-match instantly. Default recommend: **leave them** — `excludeCardIds` keeps the deck content unique to V_{n+1}; the locked card is now excluded forever; left-swipes stay seen. The user re-swipes a fresh deck minted with the exclude list. SPEC author confirm.

### Things explicitly OUT OF SCOPE for ORCH-0908
- Removing the gang-consensus auto-lock path (keep as fallback per Q-A above)
- Reschedule/cancel UX for a locked card AFTER the cycle has restarted (follow-on ORCH if needed — `CalendarTab.handleReschedule` works today on the per-user row, but doesn't broadcast to other participants in collab mode; that's a separate problem)
- Multi-day or recurring scheduled events (single-occurrence only)
- Idle-session timeout / auto-archive (defer)
- Admin-web override surface for support cases (operator excluded at INTAKE)

---

## Phase 3 — Open questions for SPEC (slimmed)

After the brutal sweep, only a few questions remain:

- **Q-A — Keep gang-consensus auto-lock as second path, or remove?** Recommend KEEP (operator confirm).
- **Q-B — `board_user_swipe_states` reset behavior on V_{n+1}?** Recommend LEAVE AS-IS (exclude list does the de-dup work; locked card forever excluded).
- **Q-C — Banner mounts in BoardDiscussion.tsx or also on the session pill?** Recommend both — banner inside chat surface, lock-icon badge on the pill.
- **Q-D — System message wording.** Two strings: "Plan locked in: {{title}}" and "Scheduled for {{date}} at {{time}}". SPEC author proposes; operator approves.
- **Q-E — Lock-in push notification?** Operator did not specify. Recommend yes (silent today is a UX gap). SPEC includes a new `notify-session-lock` edge function or extends `notify-session-match`.
- **Q-F — What status does the session flip to after schedule-confirm?** Recommend `'active'` (clean recycle). SPEC confirm.
- **Q-G — Routing: fold into ORCH-0902, or ship as follow-on?** Recommend follow-on. ORCH-0902 is SPEC complete and IMPLEMENT-ready; ORCH-0908 needs ORCH-0902 live first.

The rest of v1's open questions are answered or moot:
- Q-1 (single vs multiple co-admin): MULTIPLE — already exists, no slot cap
- Q-2 (co-admin can lock + schedule): YES for both — same `isAdmin` flag pattern
- Q-3 (promotion UX entry point): EXISTS in `BoardSettingsDropdown` — no new entry needed
- Q-4 (Calendar tab placement): EXISTS in `LikesPage` — no new surface needed
- Q-5 (Scheduling sheet UX): REUSE `ProposeDateTimeModal` — no new picker needed
- Q-10 (Time zone): `timestamptz` handles it correctly — no SPEC work
- Q-11 (Calendar permission denial fallback): banner + in-app calendar tab still work without permission — no SPEC work beyond UX confirm
- Q-13 (deck UI gating on session.status): the V_{n+1} mint via `rpc_force_deck_recycle` + status flip to `'active'` makes this moot — fresh deck appears under same session_id/new deck_version
- Q-14 (`calendarService.ts` exists?): YES — exhaustively read
- Q-15 (`handleScheduleFromSaved` — what does it do?): stub — `console.log` only. Real handler is internal to `SavedTab.handleSchedule`
- Q-17 (solo parity): solo flow is unchanged — `SavedTab.handleSchedule` still works for solo cards independently

---

## Phase 4 — Cross-Surface Impact Declaration (unchanged from v1)

| Surface | In scope | Notes |
|---|---|---|
| Consumer iOS | YES | All UI changes; mobile RPCs; `expo-calendar` writes |
| Consumer Android | YES | Parity automatic |
| Backend | YES | New RPCs, trigger, possibly notify edge fn |
| Buyer/anonymous Web | NO | Not exposed |
| Business iOS/Android/Web | NO | No collab feature |
| Admin Web | NO | Operator excluded |
| Business Web preview | NO | N/A |

---

## Phase 5 — Six-field evidence (corrected)

| Field | Evidence |
|---|---|
| **Symptom** | After a card matches and (gang-consensus) RSVPs lock it, the session has no way to start a new swipe round. No creator-manual lock exists today; no schedule UI for the locked card exists today; no V_{n+1} mint on schedule-confirm. |
| **Reproducer** | (a) Create collab session, ≥2 accept. (b) Swipe to match a card. (c) All RSVP attending → `check_card_lock_in` fires → `is_locked=true` + `status='locked'`. (d) "Plan Locked In!" modal shows. (e) After dismissing, the deck no longer serves cards — session dead-ends. |
| **Observed** | Source-only trace confirms terminal state. `session_deck_versions` mint trigger does not fire on `status` change ([`migration 20260625000000:594-597`](../../supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql#L594-L597)). No code path transitions `locked → active`. |
| **Expected (per operator)** | Creator taps "Lock it in" on a matched card (no need to wait for all RSVPs). Scheduling sheet appears. Creator picks date+time. All participants' calendar_entries update. Group chat banner + system message announce the plan. V_{n+1} mints immediately with the locked card excluded. Deck refreshes with fresh content. Cycle repeats indefinitely. |
| **Root cause (PROVEN structurally; PROBABLE at runtime)** | The session lifecycle was designed one-shot. `'locked'` is terminal. ORCH-0902's V_{n+1} mint trigger is hash-driven on aggregation contents — schedule is not part of aggregation. No code path exists to re-enter `'active'` after `'locked'`. Exhaustive grep confirmed zero recycle paths. |
| **Verification** | Live-fire repro on iOS sim with two test users (deferred to SPEC/IMPLEMENT — backend-dominant investigation, Prime Directive 7 exemption applies). E-2/E-3 probes still recommended for SPEC author. |

---

## Phase 6 — Confidence

| Finding | Confidence | Note |
|---|---|---|
| Co-admin role fully shipped | HIGH | Direct file reads + grep |
| Calendar tab fully shipped (with one styling bug) | HIGH | Direct file reads (CalendarTab.tsx 2100 lines) |
| `ProposeDateTimeModal` reusable | HIGH | Direct read |
| `excludeCardIds` plumbing end-to-end | HIGH | Direct grep + migration read |
| Group chat substrate via ORCH-0898 fully shipped | HIGH | Migration + Explore agent |
| System message rendering pattern exists, no generator | HIGH | Direct file read + grep |
| Lock-in is silent (no push/email/system message) | HIGH | Exhaustive grep |
| No recycle transition exists | HIGH | Exhaustive grep |
| `'dormant'` / `'archived'` are dead writes | HIGH | Exhaustive grep returned zero writers |
| Runtime "no way to continue" symptom | PROBABLE | Source-only; sim repro deferred |
| Q-A through Q-G recommendations | MEDIUM | Recommendations are operator-decision-gated |

---

## Recommended next phase

**Write SPEC immediately on top of this report.** v1's SPEC framing was over-scoped. v2 finds the actual work is:

- **2 new RPCs** (lock + schedule, both admin-gated, both SECURITY DEFINER)
- **1 new helper RPC** (`rpc_force_deck_recycle`) — could be inlined into `rpc_admin_schedule_locked_card`
- **1 edge-function tweak** (discover-cards collab branch reads `exclude_place_ids` from latest deck_version)
- **3 new mobile components/changes**: Lock-In button, post-lock scheduling sheet (wrapper around `ProposeDateTimeModal`), chat banner
- **1 styling bug fix** (CalendarTab collab badge)
- **1 system-message generator** (inline in the two new RPCs)
- **1 optional new edge function** (`notify-session-lock` for push notifications — Q-E)
- **1 session-pill visual tweak** (lock icon when status='locked')

Estimated SPEC size: **400-600 lines** (not 1000+ as v1 estimated). The substrate is so complete that the SPEC is mostly contracts on RPCs + UI wiring rather than greenfield design.

Routing recommendation unchanged: **follow-on ORCH after ORCH-0902 ships**, NOT fold-in.
