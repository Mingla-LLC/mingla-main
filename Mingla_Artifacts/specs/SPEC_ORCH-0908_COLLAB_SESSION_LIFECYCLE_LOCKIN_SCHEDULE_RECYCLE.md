# SPEC — ORCH-0908: Collab Session Lifecycle (Lock-In → Schedule → V_{n+1} Recycle)

**Mode:** SPEC
**Date:** 2026-05-21
**Author:** Claude `mingla-forensics`
**Investigation source:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0908_v2_BRUTAL_CORRECTED.md`](../reports/INVESTIGATION_ORCH-0908_v2_BRUTAL_CORRECTED.md)
**Dependency:** ORCH-0902 [collab deck deterministic rewrite] MUST be live first.

---

## Scope and Non-Goals

**Scope.** Add three capabilities to the existing collab session pipeline:
1. **Creator-manual "Lock it in" action** — admin-gated RPC that flips `board_saved_cards.is_locked=true` directly without waiting for gang-consensus RSVPs.
2. **Post-lock scheduling** — UI sheet + admin-gated RPC that updates ALL participants' `calendar_entries.scheduled_at` for a locked card in one transaction.
3. **Session recycle on schedule-confirm** — flip `collaboration_sessions.status` back to `'active'` and force-mint V_{n+1} with the locked card's place_id added to the exclusion list, so the deck restarts fresh for everyone.

Plus the supporting UX:
4. Session-chat banner showing locked-in plan + scheduled date.
5. System messages in the group chat announcing lock + schedule events.
6. Session pill visual cue when `status='locked'`.
7. Push notification on lock-in (currently silent).
8. CalendarTab styling bug fix (collab badge dead code).

**Non-goals (out of scope, do NOT implement):**
- Removing the existing gang-consensus auto-lock path (`check_card_lock_in`). It REMAINS as a second path. Operator confirm Q-A.
- Reschedule/cancel UX for a locked card AFTER cycle restart (existing `CalendarTab.handleReschedule` works per-user only; broadcasting reschedule to all participants is a follow-on ORCH).
- Multi-day / recurring scheduled events (single occurrence only).
- Idle-session timeout / auto-archive (no change).
- Admin-web override surface (operator excluded at INTAKE).
- Co-admin promotion UI changes (already shipped via ORCH-0520; reuse `isAdmin`).
- Calendar tab structure (already shipped via `LikesPage` → `CalendarTab`; reuse).
- `ProposeDateTimeModal` rewrite (already shipped; reuse).
- `DeviceCalendarService` changes (already shipped; reuse).
- Group chat substrate changes (already shipped via ORCH-0898; reuse).
- Solo flow (unchanged).

**Assumptions:**
- ORCH-0902 ships first and the deterministic V_n machinery is live.
- `expo-calendar` runtime works on iOS Simulator and Android Emulator (verified at v1 investigation — package installed at `package.json:73`).
- Operator's iOS device build supports the existing `notify-dispatch` push pipeline.
- `is_admin` already covers creator AND any promoted admin (per `useBoardSession.ts:177-181`).

---

## Final Operator Decisions (defaults locked per investigation v2; flag any pushback)

The implementor MUST read this section before implementing. Defaults are sourced from the v2 investigation's Q-A through Q-G recommendations. If any of these are wrong, the operator pushes back BEFORE IMPLEMENT — not after.

| Q | Decision (LOCKED DEFAULT) | Source |
|---|---|---|
| Q-A — Keep gang-consensus auto-lock path? | **YES, keep both.** Gang-consensus = democratic default. Creator-manual = admin override. Both write `is_locked=true`; downstream cascade is identical. | Investigation §10 |
| Q-B — Reset `board_user_swipe_states` on V_{n+1}? | **NO, leave rows in place.** Exclude list on the new deck version handles the locked card permanently; previously left/right swipes stay as-is (the deck won't re-show the locked card; everything else is fair game). | Investigation §8 |
| Q-C — Banner placement? | **Both:** thin strip inside chat + lock-icon badge on session pill. | Investigation Phase 3 |
| Q-D — System message wording? | Two strings (operator may edit): `"📌 Plan locked in: {{title}}"` and `"📅 Scheduled for {{formattedDate}} at {{formattedTime}}"`. Note: emojis used here in user-facing chat copy only, not in code comments. | Investigation Phase 3 |
| Q-E — Push notification on lock-in? | **YES.** New event type for `notify-dispatch`. Title: `"{{sessionName}} locked in a plan!"` Body: `"{{lockerName}} locked in {{cardTitle}}"`. Tap deep-links to session view. | Investigation §9 (silent today = UX gap) |
| Q-F — Status after schedule-confirm? | **`'active'`** (clean recycle; no schema churn). | Investigation Phase 3 |
| Q-G — ORCH-0902 routing? | **Follow-on.** Ship ORCH-0902 first; ORCH-0908 IMPLEMENT dispatches after ORCH-0902 PASS. | Investigation §summary |

---

## Cross-Surface Impact (Phase 2.5)

| Surface | Covered | What changes |
|---|---|---|
| **Consumer iOS** (`app-mobile/` iOS) | YES | New "Lock it in" button on per-card detail; new scheduling sheet; new chat banner; pill visual cue; collab badge styling fix |
| **Consumer Android** | YES | Parity automatic via React Native; tester MUST run both simulators |
| **Backend** (Supabase) | YES | 3 new RPCs (lock, schedule, force-recycle), 1 edge-function tweak (`discover-cards` collab branch reads exclude list), optionally 1 new edge function (`notify-session-lock`), system-message generator inline in lock + schedule RPCs |
| **Buyer/anonymous Web** | NO | Collab not exposed on buyer-anon routes |
| **Business iOS/Android/Web** | NO | No collab feature |
| **Admin Web** | NO | Operator excluded at INTAKE |
| **Business Web preview** | NO | N/A |

**Parity contract:** Backend RPCs serve iOS + Android equally. Mobile code in shared `app-mobile/src/` → parity automatic. Tester MUST run BOTH simulators (`xcrun simctl` + `emulator`) with two test users to verify the full cycle (match → lock → schedule → V_{n+1} → swipe again → match again → repeat).

---

## §2A — Layered Change List

### Schema layer

#### 2A.1 — No new columns on `collaboration_sessions`

Existing `status` enum already supports the lifecycle: `pending → active → voting → locked → active(V_{n+1})`. Existing `deck_version` + `deck_params_hash` from ORCH-0902 handle deck versioning. No schema additions to this table.

#### 2A.2 — No new columns on `board_saved_cards` or `session_participants`

Existing `is_locked`, `locked_at`, `locked_by_consensus`, `is_admin` columns are sufficient. The creator-manual lock writes `locked_by_consensus=false` (semantic: "creator/admin lock," NOT "all-RSVP consensus lock"). Existing readers don't branch on this flag's value, just its presence.

#### 2A.3 — No new tables

`calendar_entries`, `board_card_rsvps`, `session_deck_versions`, `conversations`, `messages`, `conversation_participants` all sufficient as-shipped.

#### 2A.4 — Existing trigger behavior (`create_calendar_entries_on_lock`) — UNCHANGED

When the new `rpc_admin_lock_card` flips `is_locked=true`, the existing trigger at [`baseline:4213-4267`](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L4213-L4267) AUTOMATICALLY runs, inserting per-participant rows into `calendar_entries`. The auto-derived `scheduled_at` (currently `COALESCE(board_session_preferences.datetime_pref, NOW() + INTERVAL '1 day')`) becomes a **placeholder** — the post-lock scheduling sheet will UPDATE it to the user-picked value via `rpc_admin_schedule_locked_card`. NO trigger amendment needed.

### RPC layer

#### 2A.5 — `rpc_admin_lock_card(p_session_id uuid, p_saved_card_id uuid) RETURNS jsonb`

```sql
CREATE OR REPLACE FUNCTION public.rpc_admin_lock_card(
  p_session_id uuid,
  p_saved_card_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_already_locked boolean;
  v_card_title text;
  v_session_conversation_id uuid;
  v_session_name text;
BEGIN
  -- Auth: caller must be creator OR session_participants.is_admin=true
  SELECT (cs.created_by = v_uid OR sp.is_admin = true), cs.name
    INTO v_is_admin, v_session_name
    FROM public.collaboration_sessions cs
    LEFT JOIN public.session_participants sp
      ON sp.session_id = cs.id AND sp.user_id = v_uid
    WHERE cs.id = p_session_id;

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'ORCH-0908: not authorized (creator or session admin required)';
  END IF;

  -- Verify card belongs to this session and is not already locked
  SELECT is_locked, card_data->>'title'
    INTO v_already_locked, v_card_title
    FROM public.board_saved_cards
    WHERE id = p_saved_card_id AND session_id = p_session_id;

  IF v_already_locked IS NULL THEN
    RAISE EXCEPTION 'ORCH-0908: card not found in this session';
  END IF;

  IF v_already_locked = true THEN
    RETURN jsonb_build_object('status', 'already_locked', 'saved_card_id', p_saved_card_id);
  END IF;

  -- The lock cascade. Both UPDATEs fire downstream triggers:
  --   board_saved_cards UPDATE → create_calendar_entries_on_lock (per-participant rows)
  --                            → realtime onCardLocked broadcast
  --   collaboration_sessions UPDATE → existing realtime onSessionUpdated
  UPDATE public.board_saved_cards
    SET is_locked = true,
        locked_at = NOW(),
        locked_by_consensus = false  -- creator/admin lock, not gang-consensus
    WHERE id = p_saved_card_id;

  UPDATE public.collaboration_sessions
    SET status = 'locked',
        updated_at = NOW()
    WHERE id = p_session_id
      AND status IN ('pending', 'active', 'voting');

  -- Insert system message into the session's group conversation
  SELECT id INTO v_session_conversation_id
    FROM public.conversations
    WHERE session_id = p_session_id
      AND linked_entity_type = 'session'
    LIMIT 1;

  IF v_session_conversation_id IS NOT NULL THEN
    INSERT INTO public.messages (
      conversation_id, sender_id, content, message_type, card_payload
    ) VALUES (
      v_session_conversation_id,
      NULL,  -- system message
      '📌 Plan locked in: ' || COALESCE(v_card_title, 'a card'),
      'text',  -- isSystem inferred from sender_id=NULL at client transform layer
      jsonb_build_object('event', 'card_locked', 'saved_card_id', p_saved_card_id)
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'locked',
    'saved_card_id', p_saved_card_id,
    'session_id', p_session_id,
    'locked_at', NOW()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_admin_lock_card(uuid, uuid) TO authenticated;
```

**Notes:**
- `locked_by_consensus=false` distinguishes admin-lock from gang-lock for audit/telemetry (no UI branches on this value today; future analytics could).
- The system-message INSERT writes `sender_id=NULL` and `message_type='text'`. The client `MessageBubble.tsx:156-163` already renders sender_id=NULL as centered system style (need to confirm the transform layer maps `sender_id IS NULL → isSystem=true` — see SPEC §2A.13 below).
- The `card_payload` JSONB lets the chat renderer optionally show a card preview inline. Not required for v1 of the banner.

#### 2A.6 — `rpc_admin_schedule_locked_card(p_session_id uuid, p_saved_card_id uuid, p_scheduled_at timestamptz, p_duration_minutes int) RETURNS jsonb`

```sql
CREATE OR REPLACE FUNCTION public.rpc_admin_schedule_locked_card(
  p_session_id uuid,
  p_saved_card_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes int DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_is_locked boolean;
  v_card_title text;
  v_session_conversation_id uuid;
  v_new_deck_version int;
  v_updated_count int;
BEGIN
  -- Auth: same gate as lock RPC
  SELECT (cs.created_by = v_uid OR sp.is_admin = true)
    INTO v_is_admin
    FROM public.collaboration_sessions cs
    LEFT JOIN public.session_participants sp
      ON sp.session_id = cs.id AND sp.user_id = v_uid
    WHERE cs.id = p_session_id;

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'ORCH-0908: not authorized (creator or session admin required)';
  END IF;

  -- Verify card is locked
  SELECT is_locked, card_data->>'title'
    INTO v_is_locked, v_card_title
    FROM public.board_saved_cards
    WHERE id = p_saved_card_id AND session_id = p_session_id;

  IF v_is_locked IS NULL THEN
    RAISE EXCEPTION 'ORCH-0908: card not found in this session';
  END IF;

  IF v_is_locked = false THEN
    RAISE EXCEPTION 'ORCH-0908: card must be locked before scheduling (call rpc_admin_lock_card first)';
  END IF;

  -- Validate scheduled_at is in the future (allow up to 1 year out)
  IF p_scheduled_at <= NOW() THEN
    RAISE EXCEPTION 'ORCH-0908: scheduled_at must be in the future';
  END IF;
  IF p_scheduled_at > NOW() + INTERVAL '1 year' THEN
    RAISE EXCEPTION 'ORCH-0908: scheduled_at cannot be more than 1 year out';
  END IF;
  IF p_duration_minutes < 15 OR p_duration_minutes > 1440 THEN
    RAISE EXCEPTION 'ORCH-0908: duration_minutes must be 15..1440';
  END IF;

  -- Update ALL accepted participants' calendar_entries rows for this card
  UPDATE public.calendar_entries
    SET scheduled_at = p_scheduled_at,
        duration_minutes = p_duration_minutes,
        updated_at = NOW()
    WHERE board_card_id = p_saved_card_id
      AND source = 'collaboration';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  -- Recycle: force a new deck_version with the locked card excluded
  v_new_deck_version := public.rpc_force_deck_recycle(
    p_session_id,
    ARRAY[(SELECT pp.id
            FROM public.place_pool pp
            JOIN public.board_saved_cards bsc ON bsc.experience_id = pp.google_place_id
            WHERE bsc.id = p_saved_card_id
            LIMIT 1)]::uuid[]
  );

  -- Transition session back to 'active' for the next round
  UPDATE public.collaboration_sessions
    SET status = 'active',
        updated_at = NOW()
    WHERE id = p_session_id;

  -- System message
  SELECT id INTO v_session_conversation_id
    FROM public.conversations
    WHERE session_id = p_session_id
      AND linked_entity_type = 'session'
    LIMIT 1;

  IF v_session_conversation_id IS NOT NULL THEN
    INSERT INTO public.messages (
      conversation_id, sender_id, content, message_type, card_payload
    ) VALUES (
      v_session_conversation_id,
      NULL,
      '📅 Scheduled for ' || to_char(p_scheduled_at AT TIME ZONE 'UTC', 'Mon DD, HH24:MI') || ' UTC',
      'text',
      jsonb_build_object(
        'event', 'plan_scheduled',
        'saved_card_id', p_saved_card_id,
        'scheduled_at', p_scheduled_at
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'scheduled',
    'saved_card_id', p_saved_card_id,
    'session_id', p_session_id,
    'scheduled_at', p_scheduled_at,
    'duration_minutes', p_duration_minutes,
    'updated_participant_count', v_updated_count,
    'new_deck_version', v_new_deck_version
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_admin_schedule_locked_card(uuid, uuid, timestamptz, int) TO authenticated;
```

**Notes:**
- `place_pool.google_place_id = board_saved_cards.experience_id` is the join (per the existing `check_mutual_like` trigger's behavior; `experience_id` is the Google Place ID per [`baseline:7631`](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L7631) comment).
- The system message uses UTC formatting here; the SPEC author may choose to do per-user timezone formatting client-side instead — see SPEC §2A.14.
- The function returns `new_deck_version` so the client can update React Query cache key.

#### 2A.7 — `rpc_force_deck_recycle(p_session_id uuid, p_exclude_place_ids uuid[]) RETURNS int`

```sql
CREATE OR REPLACE FUNCTION public.rpc_force_deck_recycle(
  p_session_id uuid,
  p_exclude_place_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_current_version int;
  v_current_aggregated jsonb;
  v_previous_excludes jsonb;
  v_merged_excludes jsonb;
  v_new_aggregated jsonb;
  v_new_hash text;
  v_new_version int;
BEGIN
  -- Auth
  SELECT (cs.created_by = v_uid OR sp.is_admin = true)
    INTO v_is_admin
    FROM public.collaboration_sessions cs
    LEFT JOIN public.session_participants sp
      ON sp.session_id = cs.id AND sp.user_id = v_uid
    WHERE cs.id = p_session_id;

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'ORCH-0908: not authorized';
  END IF;

  -- Read current aggregation from session
  v_current_aggregated := public.pg_aggregate_collab_prefs(p_session_id);

  -- Read previous excludes from most recent session_deck_versions row (if any)
  SELECT COALESCE(aggregated_params->'exclude_place_ids', '[]'::jsonb)
    INTO v_previous_excludes
    FROM public.session_deck_versions
    WHERE session_id = p_session_id
    ORDER BY deck_version DESC
    LIMIT 1;

  -- Merge previous + new excludes (deduplicated)
  v_merged_excludes := (
    SELECT jsonb_agg(DISTINCT elem ORDER BY elem)
    FROM (
      SELECT jsonb_array_elements(COALESCE(v_previous_excludes, '[]'::jsonb)) AS elem
      UNION
      SELECT to_jsonb(uid)::jsonb FROM unnest(p_exclude_place_ids) AS uid
    ) s
  );

  -- Augment aggregation with exclude list. This makes the hash differ
  -- from the previous version, forcing V_{n+1} mint.
  v_new_aggregated := v_current_aggregated || jsonb_build_object(
    'exclude_place_ids', COALESCE(v_merged_excludes, '[]'::jsonb)
  );

  v_new_hash := encode(
    extensions.digest(v_new_aggregated::text, 'sha256'::text),
    'hex'
  );

  -- Increment version
  SELECT COALESCE(deck_version, 0) INTO v_current_version
    FROM public.collaboration_sessions
    WHERE id = p_session_id;

  v_new_version := v_current_version + 1;

  -- Insert frozen params history (CR-4)
  INSERT INTO public.session_deck_versions (
    session_id, deck_version, params_hash, aggregated_params
  ) VALUES (
    p_session_id, v_new_version, v_new_hash, v_new_aggregated
  );

  -- Bump parent row. NOTE: this will fire recompute_deck_version_after_prefs_change
  -- (the ORCH-0902 trigger). That trigger reads the table fresh and may attempt
  -- to overwrite with its OWN computed hash (which won't include excludes). To
  -- prevent overwrite, we set the hash AFTER the trigger via pg_trigger_depth() > 1
  -- guard (the ORCH-0902 trigger already has this guard at migration:538-540).
  --
  -- The ORCH-0902 trigger guard: IF pg_trigger_depth() > 1 THEN RETURN NULL.
  -- Our UPDATE here fires the trigger at depth 1 → trigger fires, computes its own
  -- hash, calls UPDATE on the same row at depth 2 → guard short-circuits → trigger
  -- exits. RESULT: our explicit hash WINS because we set it FIRST, then the trigger
  -- runs and overwrites because depth=1 first fire. We need a different mechanism.
  --
  -- SOLUTION: temporarily disable the trigger for THIS update, or use a
  -- session-local variable the trigger checks, OR call the trigger's hash logic
  -- inline. Simplest: use SET LOCAL or a session GUC.
  PERFORM set_config('orch_0908.force_recycle', 'true', true);  -- transaction-local
  UPDATE public.collaboration_sessions
    SET deck_version = v_new_version,
        deck_params_hash = v_new_hash,
        updated_at = NOW()
    WHERE id = p_session_id;

  RETURN v_new_version;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_force_deck_recycle(uuid, uuid[]) TO authenticated;
```

**Critical implementor note — trigger interaction.** The ORCH-0902 `recompute_deck_version_after_prefs_change` trigger fires on `UPDATE OF participant_prefs, updated_at`. When our RPC UPDATEs `updated_at` here, the trigger WILL fire and recompute hash WITHOUT exclude_place_ids → its hash will differ → it will overwrite our version.

**Mitigation options for implementor (pick one):**
- (a) **Add a transaction-local GUC** that the ORCH-0902 trigger checks: `IF current_setting('orch_0908.force_recycle', true) = 'true' THEN RETURN NULL`. Requires amending the ORCH-0902 trigger function (one-line addition). Cleanest.
- (b) **Issue the UPDATE inside a separate SECURITY DEFINER context that bypasses the trigger** via `ALTER TABLE ... DISABLE TRIGGER` for the connection. Risky — can leak to other sessions if pooled.
- (c) **Inline the ORCH-0902 trigger logic in `rpc_force_deck_recycle`** instead of relying on the trigger — compute hash directly and skip `UPDATE updated_at`. Best isolation but more code duplication.

**SPEC recommends (a).** Add one line to `recompute_deck_version_after_prefs_change` in a follow-on migration in the same PR:

```sql
-- AT TOP OF FUNCTION BODY:
IF current_setting('orch_0908.force_recycle', true) = 'true' THEN
  RETURN NULL;
END IF;
```

This is a small, well-scoped amendment to the ORCH-0902 trigger. Document it as ORCH-0908's amendment to ORCH-0902 in the migration header.

#### 2A.8 — `discover-cards` edge function — collab branch reads exclude list

In `supabase/functions/discover-cards/index.ts`, the `handleDeterministicV2` collab path (around line 727-800) needs to:

1. After loading `sessionRow` and calling `pg_aggregate_collab_prefs`, ALSO read `session_deck_versions.aggregated_params->'exclude_place_ids'` for the current `deck_version`:

```ts
const { data: deckVersionRow } = await supabaseAdmin
  .from('session_deck_versions')
  .select('aggregated_params')
  .eq('session_id', sessionId)
  .eq('deck_version', sessionRow.deck_version)
  .maybeSingle();

const excludePlaceIds: string[] = Array.isArray(deckVersionRow?.aggregated_params?.exclude_place_ids)
  ? deckVersionRow.aggregated_params.exclude_place_ids
  : [];
```

2. Pass `excludePlaceIds` to every `query_servable_places_by_signal_union` call in the collab branch:

```ts
supabaseAdmin.rpc('query_servable_places_by_signal_union', {
  p_signal_id: task.signalId,
  p_filter_min: task.filterMin,
  p_circles: agg.circles,
  p_exclude_place_ids: excludePlaceIds,
  p_limit: perChipRpcLimit,
})
```

Existing `query_servable_places_by_signal_union` already accepts `p_exclude_place_ids` at [`migration 20260625000000:354`](../../supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql#L354). Zero schema change; just populate the parameter.

### Mobile layer

#### 2A.9 — "Lock it in" button on matched cards

**File:** `app-mobile/src/components/board/SwipeableSessionCards.tsx` (the per-card detail surface where matched cards appear).

**Where to mount:** Beside the existing RSVP buttons (currently disabled when `isCardLocked` per lines 256-284). Add a new `<Pressable>` labeled "Lock it in" that:
- Renders ONLY when `isAdmin === true` AND `card.is_locked === false` AND the card has match-quorum (i.e., it's in `board_saved_cards`).
- On press: calls `boardSessionService.lockCardManually(sessionId, savedCardId)` (new service method — see §2A.11).
- Shows haptic feedback + loading state during RPC.
- On success: hide button (card flips to `is_locked=true`; existing onCardLocked realtime cascade fires).
- On error: toast with retry CTA.

**Copy:** "Lock it in" (button label). Confirmation modal copy: "Lock this in as the group's plan? Everyone will see it as the locked plan and the deck restarts after you schedule a date."

#### 2A.10 — Post-lock scheduling sheet

**File:** New component `app-mobile/src/components/session/LockedCardSchedulingSheet.tsx` (or co-locate in `SessionViewModal.tsx`).

**Trigger:** After `onCardLocked` fires (realtime event from the lock RPC), `useCollaborationCalendar` already opens the "Plan Locked In!" modal at [`SessionViewModal.tsx:889-913`](../../app-mobile/src/components/SessionViewModal.tsx#L889-L913). **MODIFY THIS MODAL** to:

- For `isAdmin` users: show "Schedule the plan" as primary CTA (instead of "Add to Calendar"). Tapping opens the new `LockedCardSchedulingSheet`.
- For non-admin users: show "Plan locked in — waiting for {{creatorName}} to schedule" as info text. Hide the "Add to Calendar" button until the admin schedules (i.e., until `calendar_entries.scheduled_at` is no longer the auto-placeholder).

**Sheet contents:**
- Card title + image (from `lockedCalendarEntry.card_data`)
- `ProposeDateTimeModal` embedded (reuse existing component) for date + time picking
- Duration field (default 120 min, range 15-1440)
- "Confirm" button → calls `boardSessionService.scheduleLockedCard(sessionId, savedCardId, scheduledAt, durationMinutes)`
- After RPC success:
  - Show second prompt: "Add to your phone's calendar?" → calls `DeviceCalendarService.addEventToDeviceCalendar` and updates `calendar_entries.device_calendar_event_id` for the current user
  - Dismiss sheet; the deck refreshes automatically because `deck_version` bumped (React Query cache key changes)

#### 2A.11 — New service methods

**File:** `app-mobile/src/services/boardSessionService.ts` (extends existing service).

```ts
async lockCardManually(sessionId: string, savedCardId: string) {
  const { data, error } = await supabase.rpc('rpc_admin_lock_card', {
    p_session_id: sessionId,
    p_saved_card_id: savedCardId,
  });
  if (error) throw new Error(`Lock failed: ${error.message}`);
  return data;
}

async scheduleLockedCard(
  sessionId: string,
  savedCardId: string,
  scheduledAt: Date,
  durationMinutes: number,
) {
  const { data, error } = await supabase.rpc('rpc_admin_schedule_locked_card', {
    p_session_id: sessionId,
    p_saved_card_id: savedCardId,
    p_scheduled_at: scheduledAt.toISOString(),
    p_duration_minutes: durationMinutes,
  });
  if (error) throw new Error(`Schedule failed: ${error.message}`);
  return data;  // { new_deck_version, scheduled_at, ... }
}
```

After `scheduleLockedCard` success, invalidate React Query caches:
- `['deck-cards', sessionId, ...]` — forces refetch with new deck_version
- `['session', sessionId]` — picks up status='active' + new deck_version
- `['calendarEntries', userId]` — picks up updated scheduled_at
- `['savedCards', sessionId]` — locked card may want a "Scheduled for X" badge

#### 2A.12 — Chat banner component

**File:** New component `app-mobile/src/components/board/LockedPlanBanner.tsx`.

**Mount point:** Inside `BoardDiscussion.tsx` between line 528 (header close) and line 571 (FlatList):

```tsx
{session?.status === 'locked' && lockedCardWithSchedule && (
  <LockedPlanBanner
    cardTitle={lockedCardWithSchedule.card_data.title}
    scheduledAt={lockedCardWithSchedule.scheduled_at}
    onTap={() => /* navigate to card detail or calendar tab */}
  />
)}
```

**Banner spec:**
- Thin (height ≈ 48px), full-width, pinned above message list (does NOT scroll with messages)
- Background: subtle accent color (e.g., `#FEF3C7` light amber or session theme color)
- Left: small lock icon
- Center: 2-line text — line 1 bold card title, line 2 muted "Mon, May 25 at 7:00 PM"
- Right: chevron-right icon
- Accessibility: `accessibilityLabel="Locked-in plan: {{title}} scheduled for {{date}}"`
- Disappears when `session.status` flips back to `'active'` (i.e., after schedule-confirm — the banner is for the LOCKED phase only). Operator confirm: should the banner persist post-schedule? Default: hide on status='active' (cycle has restarted).
- **Open question:** if the operator wants banner to PERSIST until the event date passes, change the condition to: `latestLockedCard.calendar_entries.scheduled_at > NOW()`. Spec author choose default; operator override.

#### 2A.13 — System-message client transform

**File:** `app-mobile/src/services/messagingService.ts` (the `enrichMessage` or equivalent transform layer that runs when messages are fetched).

Verify that the transform sets `isSystem: true` when `sender_id === null`. If not already, ADD this:

```ts
function enrichMessage(raw: MessageRow): EnrichedMessage {
  return {
    ...raw,
    isSystem: raw.sender_id === null,
    // ... other enrichments
  };
}
```

`MessageBubble.tsx:156-163` already renders system messages centered + muted. Confirm rendering with an end-to-end test.

#### 2A.14 — Per-user time-zone formatting

The SQL system message uses UTC formatting. Client should re-render the date+time in the local time zone using `Intl.DateTimeFormat` or `date-fns`. For chat banner: same — use local TZ.

**File:** Use existing date-formatting utilities. Search `app-mobile/src/utils/` for `formatDateTime`, `formatScheduledAt`, etc. — reuse the same formatter the existing `CalendarTab.tsx` uses for entry rendering (line ~1530 area).

#### 2A.15 — Session pill visual on `status='locked'`

**File:** `app-mobile/src/components/CollaborationSessions.tsx` per-pill render block (around line 560-598).

Add a small lock-icon badge to the pill when the session has `status === 'locked'`:

```tsx
{session.status === 'locked' && (
  <View style={styles.pillLockedBadge}>
    <Icon name="lock-closed" size={12} color="#10B981" />
  </View>
)}
```

Already there's an invite badge (lines 587-595); follow the same positioning + style pattern.

**Data flow:** The parent at `app/index.tsx:673` builds `collaborationSessions` from `boardsSessions`. Verify the transform passes `status` through. If not, add it to the prop type and the transform `useMemo`.

#### 2A.16 — CalendarTab collab badge styling fix

**File:** `app-mobile/src/components/activity/CalendarTab.tsx` line 1586.

Current code (dead style):
```tsx
<View style={styles.soloBadge}>
  <Text style={styles.soloText}>
    {entry.source === "solo" ? "Solo Discovery" : entry.sessionName}
  </Text>
</View>
```

Fix:
```tsx
<View style={entry.source === "solo" ? styles.soloBadge : styles.collaborationBadge}>
  <Text style={entry.source === "solo" ? styles.soloText : styles.collaborationText}>
    {entry.source === "solo" ? "Solo Discovery" : entry.sessionName}
  </Text>
</View>
```

Styles at lines 819-831 are already defined. Zero new design work.

### Notification layer

#### 2A.17 — Push notification on lock-in (Q-E: YES)

**Option A — extend `notify-session-match`:** Add a new event-type parameter (`event_type='card_locked'`) so the existing edge function can dispatch lock notifications.

**Option B — new `notify-session-lock` edge function:** Cleaner separation.

**SPEC recommends Option B** for cleanliness. New edge function `supabase/functions/notify-session-lock/`:

- HTTP POST endpoint
- Request: `{ session_id, saved_card_id, locked_by_user_id }`
- Auth: service-role internal — called by mobile after `rpc_admin_lock_card` returns success (or by a trigger; see below)
- Fetches session participants, card title, locker display name
- Calls `notify-dispatch` per participant (excluding the locker)
- Push payload: title `"{{sessionName}}"`, body `"{{lockerName}} locked in {{cardTitle}}"`, deep-link to session

**Trigger from RPC:** The cleanest path is for the mobile client to call this edge function AFTER `rpc_admin_lock_card` returns success (same pattern as `useSessionVoting:478-498` calls `notifyCardRsvp` after RSVP). Inline in `boardSessionService.lockCardManually`:

```ts
async lockCardManually(sessionId, savedCardId) {
  const { data, error } = await supabase.rpc('rpc_admin_lock_card', { ... });
  if (error) throw new Error(`Lock failed: ${error.message}`);
  
  // Fire-and-forget push notification
  supabase.functions.invoke('notify-session-lock', {
    body: { session_id: sessionId, saved_card_id: savedCardId, locked_by_user_id: currentUserId },
  }).catch((e) => console.warn('[lock notify] failed:', e));
  
  return data;
}
```

Similarly for `scheduleLockedCard` — fire `notify-session-schedule` (or one shared `notify-session-event`) — see SPEC §2A.18 below.

#### 2A.18 — Push notification on schedule-confirm (optional but recommended)

Same pattern as §2A.17. Payload: title `"{{sessionName}}"`, body `"Scheduled for {{date}}"`, deep-link to calendar entry. SPEC author decision: separate edge function or share `notify-session-event`. Recommend share.

---

## §3 — Success Criteria (testable, numbered, per-surface where parity matters)

### SC-01 — Creator-manual lock writes is_locked + status (backend)

GIVEN a collab session with `status='active'` and a `board_saved_cards` row with `is_locked=false`,
WHEN the session creator calls `rpc_admin_lock_card(session_id, saved_card_id)`,
THEN
- `board_saved_cards.is_locked` becomes `true`
- `board_saved_cards.locked_at` becomes `NOW()` (within 1 second)
- `board_saved_cards.locked_by_consensus` becomes `false`
- `collaboration_sessions.status` becomes `'locked'`
- The existing `create_calendar_entries_on_lock` trigger fires and inserts per-participant `calendar_entries` rows with placeholder `scheduled_at`
- A `messages` row with `sender_id=NULL, content='📌 Plan locked in: ...'` is inserted into the session's group conversation
- The RPC returns `{ status: 'locked', saved_card_id, session_id, locked_at }`

### SC-02 — Non-admin cannot lock (auth)

GIVEN a session_participant with `is_admin=false` AND not the creator,
WHEN they call `rpc_admin_lock_card`,
THEN RPC raises exception `'ORCH-0908: not authorized (creator or session admin required)'` and zero rows are mutated.

### SC-03 — Promoted co-admin CAN lock (auth)

GIVEN a session_participant promoted to `is_admin=true` via `BoardSettingsDropdown`,
WHEN they call `rpc_admin_lock_card`,
THEN SC-01 holds.

### SC-04 — Idempotent on already-locked card

GIVEN a card already with `is_locked=true`,
WHEN `rpc_admin_lock_card` is called,
THEN RPC returns `{ status: 'already_locked', saved_card_id }` and writes no rows.

### SC-05-iOS / SC-05-Android — Lock button appears for admin only

GIVEN a matched card in a session,
WHEN viewed by an admin user → "Lock it in" button visible beside RSVP buttons
WHEN viewed by a non-admin → button NOT rendered
On both iOS Simulator and Android Emulator.

### SC-06 — Schedule RPC updates all participants' calendar_entries

GIVEN a locked card with N accepted participants (N rows in calendar_entries),
WHEN admin calls `rpc_admin_schedule_locked_card(session_id, saved_card_id, scheduled_at, duration_minutes)`,
THEN all N `calendar_entries` rows update to the new `scheduled_at` and `duration_minutes` (verify via `updated_participant_count` in RPC response equals N).

### SC-07 — Schedule RPC validates inputs

WHEN scheduled_at <= NOW() → RPC raises exception
WHEN scheduled_at > NOW() + 1 year → raises exception
WHEN duration_minutes < 15 OR > 1440 → raises exception
WHEN card not locked → raises exception `'must be locked before scheduling'`

### SC-08 — V_{n+1} mints on schedule-confirm

GIVEN a session at `deck_version = K` with a locked card,
WHEN `rpc_admin_schedule_locked_card` succeeds,
THEN
- `collaboration_sessions.deck_version` becomes `K+1`
- `collaboration_sessions.deck_params_hash` becomes a new value (distinct from prior)
- `collaboration_sessions.status` becomes `'active'`
- A new `session_deck_versions` row is inserted with `deck_version=K+1` and `aggregated_params.exclude_place_ids` containing the locked card's `place_id`
- The ORCH-0902 `recompute_deck_version_after_prefs_change` trigger does NOT overwrite the new hash (verified by checking the deck_version stays at K+1 and hash matches the inserted history row)

### SC-09 — discover-cards collab branch reads exclude list

GIVEN session at deck_version K+1 with a non-empty `exclude_place_ids`,
WHEN any participant calls discover-cards with `{ session_id, expected_deck_version: K+1 }`,
THEN the response cards array does NOT include any card whose `place_id` is in the exclude list.

### SC-10 — Locked card never reappears across cycles

GIVEN sessions cycles N → N+1 → N+2 → N+3, locking different cards each cycle,
WHEN at cycle N+3 deck is fetched,
THEN exclude_place_ids contains all 3 previously locked cards (merged across versions per `rpc_force_deck_recycle` merge logic).

### SC-11-iOS / SC-11-Android — Scheduling sheet UX flow

WHEN admin sees the "Plan Locked In!" modal,
THEN primary CTA is "Schedule the plan" (not "Add to Calendar")
WHEN tapped → `LockedCardSchedulingSheet` opens with `ProposeDateTimeModal` embedded
WHEN admin picks a date + time + duration and taps Confirm → RPC fires → success toast → sheet dismisses → deck refreshes (fresh cards appear)
Both iOS + Android.

### SC-12-iOS / SC-12-Android — Non-admin sees waiting state

WHEN non-admin sees the "Plan Locked In!" modal,
THEN copy reads "Plan locked in — waiting for {{creatorName}} to schedule"
AND "Add to Calendar" button is hidden until scheduled_at is no longer placeholder
Both iOS + Android.

### SC-13 — Chat banner appears when status='locked' AND a scheduled card exists

GIVEN session.status='locked' AND a board_saved_card has is_locked=true AND a calendar_entries row has scheduled_at,
WHEN any participant opens the session group chat,
THEN the `LockedPlanBanner` is visible above the message list with card title and formatted scheduled date.

### SC-14 — Chat banner hides when session.status flips to 'active'

GIVEN cycle has restarted (status='active' post-schedule-confirm),
WHEN the chat is reopened,
THEN the banner is NOT visible (recycle hides the banner; the locked card's record persists in calendar_entries but the chat returns to standard view).

### SC-15 — System messages render as system style

GIVEN a system message row (`sender_id=NULL`) in the conversation,
WHEN the chat renders it,
THEN it appears centered, muted style per `MessageBubble.tsx:156-163` (no avatar, no chrome, no reactions, no swipe).

### SC-16 — Push notification fires on lock-in to OTHER participants

GIVEN admin locks a card via the RPC,
WHEN the mobile client invokes `notify-session-lock`,
THEN each OTHER accepted participant receives a push with title=session name, body containing locker name + card title.
The locker themselves does NOT receive a push.

### SC-17 — Session pill shows lock badge

WHEN a session's status='locked',
THEN the corresponding pill on HomePage's session bar shows a small lock-icon badge.

### SC-18 — CalendarTab styling fix renders collab entries correctly

GIVEN a calendar_entries row with `source='collaboration'`,
WHEN CalendarTab renders the entry,
THEN the badge uses `collaborationBadge` background + `collaborationText` style (purple per defined styles at 819-831), not the solo blue style.

### SC-19 — Full cycle round-trip

GIVEN a session with 3 accepted participants,
WHEN: (a) deck fetched at V1, (b) participants swipe, (c) match emerges on card X, (d) admin taps "Lock it in", (e) admin schedules for tomorrow 7pm, (f) deck refreshes,
THEN at step (f): deck_version is V2, exclude_place_ids contains card X's place_id, card X is NOT in the new deck, status='active', all 3 participants' calendar_entries have scheduled_at=tomorrow 7pm, group chat shows 2 system messages (lock + schedule), iOS + Android device calendars (if permission granted per user) have the event.

### SC-20 — Solo flow unchanged

Run all existing solo regression: solo deck fetch, solo card save, solo schedule via SavedTab, solo reschedule, solo calendar entry display.

---

## §4 — Invariants

**Preserve (existing, MUST hold):**
- **I-PROPOSED-COLLAB-DECK-VERSION-MONOTONIC** (ORCH-0902) — `deck_version` only ever increases. The new `rpc_force_deck_recycle` increments by 1; verified by SC-08.
- **I-CHECK-FOR-MATCH-COLUMN-ALIGNED** (ORCH-0558) — match detection still uses `experience_id`. No change.
- **I-SESSION-MUTE-DEFAULT-UNMUTED** (ORCH-0520) — `notifications_muted` semantics unchanged. New push notifications honor this flag (handled in existing `notify-dispatch`).
- **I-PROPOSED-J (Zustand persist no server snapshots)** — new code stores no server-fetched data in Zustand persist. React Query owns lock state.
- **I-NO-FABRICATED-DISPLAY-N/A** — banner does NOT show fake dates if scheduled_at is the placeholder; banner hides until real schedule lands.
- **I-PROPOSED-CHAT-SUBSTRATE-UNIFIED** (ORCH-0898) — new system messages go through the unified `messages` table.
- **I-PROPOSED-CHAT-RLS-INLINE-EXISTS** — system message INSERTs from SECURITY DEFINER RPC bypass RLS correctly; verified via test SC-15.
- **Constitution #2 — One owner per truth** — `deck_version` is single-owned by `collaboration_sessions`; `is_locked` is single-owned by `board_saved_cards`; `scheduled_at` per-user is single-owned by `calendar_entries`.
- **Constitution #3 — No silent failures** — every RPC error surfaces; mobile uses `edgeFunctionError` utility.
- **Constitution #9 — No fabricated data** — no fake dates, no fake locker names; render only what RPC returns.

**New invariants ratified DRAFT (flip ACTIVE on CLOSE):**
- **I-PROPOSED-COLLAB-LOCK-ADMIN-OR-CONSENSUS** — `board_saved_cards.is_locked=true` only via (a) `check_card_lock_in` (gang-consensus, RSVP path), or (b) `rpc_admin_lock_card` (admin path). No other writer permitted.
- **I-PROPOSED-COLLAB-SCHEDULE-ADMIN-ONLY** — `calendar_entries.scheduled_at` for collaboration rows can be admin-multi-updated ONLY via `rpc_admin_schedule_locked_card`. Per-user updates still permitted via existing `CalendarService.updateEntry` for personal reschedule.
- **I-PROPOSED-COLLAB-CYCLE-EXCLUDES-MERGED** — `session_deck_versions.aggregated_params.exclude_place_ids` is monotonically non-decreasing across versions (once excluded, always excluded).
- **I-PROPOSED-COLLAB-SYSTEM-MESSAGE-ON-LIFECYCLE-EVENT** — Lock + Schedule events MUST insert a system message row into the session's group conversation.

---

## §5 — Test Cases

### Implementor happy-path regression (per ORCH-0840 Step 0.5 gate)

**Path:** `app-mobile/scripts/ci/orch-0908-regression-check.mjs` (follow ORCH-0901/0898 pattern).

Tests:
- T-IMPL-01: RPC `rpc_admin_lock_card` happy path — creator locks card, verify all SC-01 effects via direct SQL probes
- T-IMPL-02: RPC `rpc_admin_lock_card` auth — non-admin call raises exception (SC-02)
- T-IMPL-03: RPC `rpc_admin_lock_card` idempotency — second call returns `already_locked` (SC-04)
- T-IMPL-04: RPC `rpc_admin_schedule_locked_card` happy path — updates all participants, returns new_deck_version (SC-06, SC-08)
- T-IMPL-05: RPC `rpc_admin_schedule_locked_card` input validation (SC-07)
- T-IMPL-06: RPC `rpc_force_deck_recycle` excludes merge correctly across multiple cycles (SC-10)
- T-IMPL-07: discover-cards collab branch excludes locked place_ids (SC-09)
- T-IMPL-08: ORCH-0902 trigger does NOT overwrite hash when `orch_0908.force_recycle=true` GUC is set
- T-IMPL-09: System messages render with sender_id=NULL (SC-15)

`fails-on-revert verified at <commit hash>` — revert PR diff, all 9 tests should FAIL or have collisions.

### Tester adversarial regression (per ORCH-0840)

**Path:** `app-mobile/scripts/ci/orch-0908-adversarial-check.mjs`.

Adversarial angles (must attack DIFFERENT angles than happy-path):
- T-ADV-01: Concurrent lock attempts — two admins call `rpc_admin_lock_card` simultaneously on the same card → only one succeeds; second returns `already_locked` (race/idempotency)
- T-ADV-02: Schedule before lock — admin calls schedule RPC on un-locked card → raises exception (SC-07 negative)
- T-ADV-03: Schedule with past date → raises exception
- T-ADV-04: Concurrent recycle attempts — `rpc_force_deck_recycle` called twice in parallel → deck_version increments correctly to V+2 (transactional safety)
- T-ADV-05: RLS — non-participant calls `rpc_admin_lock_card` → raises exception (not just "not authorized" but "not a participant")
- T-ADV-06: Cross-session lock — admin of session A tries to lock card in session B → raises "card not found in this session"
- T-ADV-07: System message visibility — non-participant subscribes to conversation realtime → RLS blocks (no message leak)
- T-ADV-08: GUC scope — `orch_0908.force_recycle` GUC must NOT leak across transactions (separate test session reads default empty value)
- T-ADV-09: Exclude list merge with NULL/empty edge cases — initial recycle on session with no prior deck_versions row works correctly

### Live-fire sim tests (mandatory per Prime Directive 7)

**Tools:** Maestro (per `feedback_sim_test_drivers_maestro_default.md`) for iOS sim + Android emu.

- T-SIM-01 (iOS + Android): Full happy-path cycle — 3 test users on 3 simulators, run the complete loop (match → lock → schedule → V_{n+1} → swipe again). All 20 success criteria verified visually.
- T-SIM-02: Non-admin attempting to lock — verify button is not rendered and RPC denial shows appropriate toast.
- T-SIM-03: Chat banner renders with correct copy on session lock; disappears on cycle restart.
- T-SIM-04: Push notification arrives on locker's co-participants (test with notification permission granted).
- T-SIM-05: Solo regression — solo save → schedule → reschedule → cancel still works as before.

### UX coherence checks

- UX-01: Lock button has loading state; disabled during RPC; haptic on press.
- UX-02: Scheduling sheet validates duration with helpful inline error.
- UX-03: Banner is readable in dark mode and light mode.
- UX-04: System messages timestamp display matches surrounding messages.
- UX-05: Lock-icon pill badge does not visually crowd the existing invite badges (consistent z-index, no overlap).

---

## §6 — Implementation Order

1. **Migration: new RPCs + ORCH-0902 trigger amendment** (single migration file `20260622000000_orch_0908_admin_lock_schedule_recycle.sql`)
   - Add `rpc_admin_lock_card`, `rpc_admin_schedule_locked_card`, `rpc_force_deck_recycle`
   - One-line amendment to `recompute_deck_version_after_prefs_change` (add GUC check at top)
   - GRANTs to authenticated role
2. **Edge function: discover-cards collab branch — read + pass exclude list** (~10 lines added to `handleDeterministicV2`)
3. **Edge function: `notify-session-lock` (or shared `notify-session-event`)** — new function with HTTP handler
4. **Mobile service: `boardSessionService` — add `lockCardManually` + `scheduleLockedCard`**
5. **Mobile component: `LockedCardSchedulingSheet`** (new file)
6. **Mobile component: `LockedPlanBanner`** (new file)
7. **Mobile edit: `SwipeableSessionCards.tsx` — add "Lock it in" button**
8. **Mobile edit: `SessionViewModal.tsx` (lines 889-913) — modify "Plan Locked In!" modal for admin vs non-admin paths**
9. **Mobile edit: `BoardDiscussion.tsx` (between 528 and 571) — mount banner**
10. **Mobile edit: `CollaborationSessions.tsx` per-pill render — add lock-icon badge**
11. **Mobile edit: `CalendarTab.tsx:1586` — fix collab badge styling**
12. **Mobile edit: `messagingService.ts` — confirm `isSystem` transform on sender_id=NULL**
13. **Regression tests: implementor (`orch-0908-regression-check.mjs`)**
14. **Stage migration for operator `supabase db push --linked`** (do NOT push from implementor)
15. **Orchestrator deploys edge functions** (`discover-cards`, `notify-session-lock`)
16. **Hand to tester for SIM + adversarial regression**

---

## §7 — Regression Prevention

- **Strict-grep CI gate:** new gate `.github/scripts/strict-grep/orch-0908-no-direct-is-locked-write.mjs` — fails CI if any client-side (`app-mobile/src/`, `mingla-admin/src/`, `mingla-business/src/`) code performs `.update({ is_locked: ... })` or `.update({ is_locked` directly. Must go through `rpc_admin_lock_card` or the existing `check_card_lock_in` cascade. INFORMATIONAL on first ORCH-0908 PR; BLOCK on follow-up PR (per ORCH-0892-C precedent).
- **Strict-grep CI gate:** `orch-0908-no-direct-schedule-broadcast.mjs` — fails if client-side code attempts to update multiple participants' `calendar_entries.scheduled_at` directly (must go through `rpc_admin_schedule_locked_card`).
- **Comment marker:** add `[ORCH-0908]` and `[I-PROPOSED-COLLAB-LOCK-ADMIN-OR-CONSENSUS]` markers at the top of `rpc_admin_lock_card`, `rpc_admin_schedule_locked_card`, `rpc_force_deck_recycle`, and the trigger amendment so future investigators see the invariant boundary.
- **`feedback_orch_0908_collab_session_lifecycle.md` memory entry** — DRAFT, flips ACTIVE on CLOSE. Documents the lock/schedule/recycle contract for future skills.
- **DECISION_LOG.md entry** — codify Q-A through Q-G decisions.
- **INVARIANT_REGISTRY.md** — add the four new I-PROPOSED-COLLAB-* invariants as DRAFT.

---

## §8 — Open Questions Remaining for Operator

These were defaulted in §"Final Operator Decisions" — operator may override before IMPLEMENT:

- **Q-A confirm:** Keep gang-consensus auto-lock as second path? (Default YES.)
- **Q-D confirm:** System-message wording approved? `"📌 Plan locked in: {{title}}"` and `"📅 Scheduled for {{date}} at {{time}}"` — open to operator copy edits.
- **Q-E confirm:** Push notification on lock-in? (Default YES; if NO, omit §2A.17 + SC-16.)
- **Q-banner-persist:** Should the chat banner persist post-schedule until the event date passes, or disappear immediately on cycle restart? (Default: disappear on cycle restart.)
- **Q-co-admin-lock:** Can co-admin lock (default YES per pattern), or only schedule (creator-only lock)? Operator can split if desired.

---

## §9 — Dependencies and Sequencing

- **Hard dependency:** ORCH-0902 MUST be merged + deployed first. ORCH-0908 IMPLEMENT cannot start until ORCH-0902 PASS.
- **Soft dependency:** ORCH-0898 [unified chat substrate] — already shipped (2026-05-21). System messages, conversations.session_id, and conversation_participants auto-sync all depend on this. Verified live.
- **PR strategy per `feedback_one_pr_per_close.md`:** ORCH-0908 ships its OWN PR `Seth → main`. NOT bundled with ORCH-0902.

---

## §10 — Estimated effort

- Migration (3 RPCs + trigger amendment): ~400 lines SQL
- Edge function: `discover-cards` ~15-line edit; new `notify-session-lock` ~150 lines TS
- Mobile new components: `LockedCardSchedulingSheet` ~200 lines, `LockedPlanBanner` ~80 lines
- Mobile edits: ~50 lines across 6 files
- Regression scripts: ~300 lines (implementor) + ~300 lines (tester)
- Strict-grep gates: ~100 lines

**Total SPEC size:** This document — ~700 lines (within the v2 investigation estimate of 400-600 ± 100 lines).
**Total implementation effort:** ~1500 lines of code across 12+ files. Single PR.

Ready for IMPLEMENT dispatch after operator review.
