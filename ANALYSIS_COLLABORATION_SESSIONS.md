# Forensic Analysis: Collaboration Sessions

**Date:** 2026-03-12
**Scope:** Full-chain trace from database → edge functions → services → hooks → components
**Confidence:** High — every file in the chain was read in full

---

## 1. Executive Summary

Collaboration sessions are Mingla's group planning feature. A user creates a session, invites friends, each participant sets their own activity preferences, and the system generates place recommendation cards using a **rotation model** — one participant's categories/intents drive the deck at a time, while logistical preferences (budget, travel, price) are **aggregated across all participants**. Participants swipe, vote, and RSVP on shared cards until a consensus locks in a plan.

The system spans **10 database tables**, **2 edge functions** (notifications only — card generation reuses the solo `discover-cards` function), **6 services**, **7 hooks**, **3 utility modules**, and **7+ UI components**.

---

## 2. Database Layer

### 2.1 Core Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `collaboration_sessions` | The session itself | `id`, `name`, `created_by`, `status` (pending→active→voting→locked→completed→archived), `session_type` (group_hangout, date_night, etc.), `invite_code`, `invite_link`, `max_participants` (15), `rotation_order` (UUID[]), `active_preference_owner_id` (UUID) |
| `session_participants` | Membership roster | `session_id`, `user_id`, `has_accepted` (bool), `is_admin` (bool), `role` (member/admin) — UNIQUE(session_id, user_id) |
| `collaboration_invites` | Invite tracking | `session_id`, `inviter_id`, `invited_user_id`, `status` (pending/accepted/declined), `invite_method` (friends_list/link/qr_code/invite_code) — UNIQUE(session_id, invited_user_id) |
| `board_session_preferences` | Per-user prefs per session | `session_id`, `user_id`, same fields as solo `preferences` table (categories, intents, price_tiers, budget, travel, datetime, location) — UNIQUE(session_id, user_id) |
| `board_saved_cards` | Cards saved to the shared board | `session_id`, `experience_id`, `saved_experience_id`, `card_data` (JSONB snapshot), `saved_by` (user) |
| `pending_invites` | Phone invites for non-app users | `inviter_id`, `phone_e164`, `status` — converts to real invite when phone is verified |
| `pending_session_invites` | Session-specific phone invites | `session_id`, `phone_e164`, `status` |

### 2.2 Supporting Tables

| Table | Purpose |
|-------|---------|
| `board_messages` | Session group chat (content, mentions, reply_to_id) |
| `board_card_messages` | Per-card discussion threads |
| `board_participant_presence` | Online/offline status per user per session |
| `board_user_swipe_states` | Individual swipe tracking (not_seen/swiped_left/swiped_right) |
| `board_typing_indicators` | Real-time typing status |
| `board_collaborators` | Board-level access control (owner/collaborator) |

### 2.3 Triggers & Automation

| Trigger | Event | What It Does |
|---------|-------|--------------|
| Auto-generate invite code | BEFORE INSERT on collaboration_sessions | Generates `MINGLA-XXXXXX` code + `mingla://board/{code}` link |
| Auto-create presence | AFTER INSERT on session_participants | Creates board_participant_presence with is_online=true (SECURITY DEFINER) |
| Cleanup orphan sessions | AFTER INSERT/UPDATE/DELETE on session_participants | Deletes sessions with < 2 participants |
| Sync invite IDs | BEFORE INSERT/UPDATE on collaboration_invites | Keeps `invitee_id` ↔ `invited_user_id` in sync |
| Convert pending invites | AFTER UPDATE on profiles | When phone_e164 is set, converts pending_invites to real invites + friend_requests |

### 2.4 RLS Strategy

**Problem:** Direct subqueries in RLS policies cause circular dependency → infinite recursion.

**Solution:** Three SECURITY DEFINER helper functions break the recursion:
- `is_session_participant(session_id, user_id)` — checks membership
- `is_session_creator(session_id, user_id)` — checks ownership
- `has_session_invite(session_id, user_id)` — checks pending/accepted invite

All session-scoped tables use these functions in their policies. Pattern: participants can read/write within their own sessions only.

---

## 3. Session Lifecycle State Machine

```
                   ┌─────────────────────────────────────────────┐
                   │                                             │
  CREATE           ▼                                             │
  ──────►  [ pending ]                                           │
              │                                                  │
              │ 2+ members accept                                │
              ▼                                                  │
          [ active ] ◄──── cards generated, participants swipe   │
              │                                                  │
              │ creator advances                                 │
              ▼                                                  │
          [ voting ] ◄──── voting on saved cards                 │
              │                                                  │
              │ majority consensus                               │
              ▼                                                  │
          [ locked ] ◄──── winning card locked in                │
              │            calendar entry auto-created            │
              │                                                  │
              │ creator marks complete                            │
              ▼                                                  │
        [ completed ]                                            │
              │                                                  │
              ▼                                                  │
        [ archived ] ────────────────────────────────────────────┘
```

**Status transitions are gated by role:** Only the session creator (or admins) can advance status. The `useSessionStatus` hook exposes `canGenerateCards`, `canVote`, `canRSVP`, `isLocked`, `isCompleted` computed booleans.

---

## 4. Session Creation Flow

```
User taps "Create" pill on HomePage
       │
       ▼
CollaborationSessions.tsx → opens inline Create Modal
       │
       ├─ Step 1: Enter session name
       ├─ Step 2: Select friends (from linked friends) or invite by phone
       └─ Step 3: Review + confirm
              │
              ▼
       useSessionManagement.createSession()
              │
              ├─ INSERT collaboration_sessions (status='pending')
              ├─ INSERT session_participants for creator (has_accepted=true)
              ├─ INSERT session_participants for each friend (has_accepted=false)
              ├─ INSERT collaboration_invites for each friend (status='pending')
              ├─ buildSeedFromSoloPrefs() → INSERT board_session_preferences for creator
              │   (seeds collaboration prefs from user's solo preferences)
              ├─ initializeRotationOrder() → creator first, then by join date
              └─ CALL edge function send-collaboration-invite (push notification to each invitee)
```

### 4.1 Phone Invites (Non-App Users)

If the invited person isn't on Mingla:
1. INSERT into `pending_session_invites` (session_id + phone_e164)
2. INSERT into `pending_invites` (inviter_id + phone_e164)
3. When that person signs up and verifies their phone → DB trigger converts pending invites to real collaboration_invites + friend_requests

---

## 5. Invite & Join Flow

### 5.1 Accepting an Invite

```
Invitee sees invite (push notification, InvitesTab, or HomePage pills)
       │
       ▼
boardInviteService.acceptInvite(inviteId, userId)
       │
       ├─ UPDATE collaboration_invites SET status='accepted'
       ├─ UPSERT session_participants (has_accepted=true)
       ├─ buildSeedFromSoloPrefs() → UPSERT board_session_preferences
       │   (new participant's collab prefs seeded from their solo prefs)
       ├─ IF 2+ accepted → UPDATE collaboration_sessions SET status='active'
       ├─ CREATE board + board_collaborators (if not exists)
       └─ CALL edge function notify-invite-response (push to inviter: "{Name} is in!")
```

### 5.2 Joining by Code/Link

```
boardInviteService.joinByInviteCode(code, userId)
       │
       ├─ SELECT collaboration_sessions WHERE invite_code = code
       ├─ CHECK participant count < max_participants
       ├─ INSERT session_participants (has_accepted=true)
       └─ UPSERT collaboration_invites (status='accepted', method='invite_code')
```

### 5.3 Declining an Invite

```
boardInviteService.declineInvite(inviteId, userId)
       │
       ├─ UPDATE collaboration_invites SET status='declined'
       └─ CALL edge function notify-invite-response (push to inviter: "{Name} can't make it")
```

---

## 6. The Rotation System (How Collaboration Cards Differ from Solo)

This is the **critical architectural difference** between solo and collaboration mode.

### 6.1 Solo Mode

One user, one set of preferences → cards generated directly from those preferences.

```
User's preferences (categories, intents, budget, travel, location, datetime)
       │
       ▼
discover-cards edge function
       │
       ▼
Deck of cards (personal, only the user sees)
```

### 6.2 Collaboration Mode: Rotation + Aggregation

Each participant has their own `board_session_preferences`. Cards are generated using a **hybrid** of one participant's taste preferences and everyone's logistical preferences.

**Two types of preferences:**

| Type | Fields | How They're Used |
|------|--------|-----------------|
| **Rotating** (taste) | `categories`, `intents` | Come from the **active rotation participant** ONLY |
| **Non-rotating** (logistics) | `price_tiers`, `budget`, `travel_mode`, `travel_constraint_value`, `datetime_pref`, `location` | **Aggregated across ALL participants** |

### 6.3 Aggregation Rules (sessionPrefsUtils.ts)

| Field | Aggregation Method | Rationale |
|-------|-------------------|-----------|
| `price_tiers` | Union of all participants' tiers | If Alice wants "chill" and Bob wants "fancy", show both |
| `budget_min` | `Math.min()` across all | Widest range — nobody excluded |
| `budget_max` | `Math.max()` across all | Widest range — nobody excluded |
| `travel_mode` | Majority vote (fallback: 'walking') | Democratic — most people's preference wins |
| `travel_constraint_value` | Median (not min!) | Avoids extreme restriction from one outlier |
| `datetime_pref` | Earliest ISO string | Earliest availability wins |
| `location` | Midpoint of all custom coordinates | Geographic center — fair to everyone |

### 6.4 Rotation Order (sessionRotation.ts)

```
Rotation order: [Creator, Participant2 (by join date), Participant3, ...]
                    ▲
                    │ active_preference_owner_id points here
```

- **Initialization:** Creator goes first, then participants sorted by `joined_at`
- **Rotation:** `rotateToNext()` advances to the next participant **who has saved preferences** (skips those who haven't set prefs yet)
- **Display:** `getRotationLabel()` shows "Your picks" or "{Name}'s picks"
- **Queue:** `getQueuePosition()` returns 1-indexed distance from active position

### 6.5 Card Generation in Collaboration Mode

```
Active rotation participant = Alice
       │
       ├─ Alice's categories: ['Nature', 'Casual Eats']
       ├─ Alice's intents: ['adventurous']
       │
       ├─ Aggregated from ALL participants:
       │   ├─ priceTiers: union(['chill','comfy'], ['comfy','fancy']) = ['chill','comfy','fancy']
       │   ├─ budgetMax: max(500, 1000) = 1000
       │   ├─ travelMode: majority('walking','walking','driving') = 'walking'
       │   ├─ travelConstraintValue: median(15, 30, 45) = 30
       │   └─ location: midpoint of all custom coords
       │
       ▼
discover-cards edge function (SAME function as solo)
       │
       ▼
Cards saved to board_saved_cards (ALL participants see them)
       │
       ▼
ROTATE → Bob becomes active → Bob's categories/intents drive next batch
```

**Key insight:** The `discover-cards` edge function has NO knowledge of collaboration sessions. It receives a flat preferences payload. The collaboration logic lives entirely on the client side — the hooks/utils assemble the hybrid preferences (rotation participant's taste + aggregated logistics) and pass them to the same endpoint solo mode uses.

---

## 7. Preference Seeding: Solo → Collaboration

When a user creates or joins a session, their collaboration preferences are **seeded from their solo preferences** via `buildSeedFromSoloPrefs()` in `useSessionManagement.ts`:

```
Solo preferences (preferences table)
       │
       ├─ categories → board_session_preferences.categories
       ├─ intents → board_session_preferences.intents
       ├─ price_tiers → board_session_preferences.price_tiers
       ├─ budget_min/max → board_session_preferences.budget_min/max
       ├─ travel_mode → board_session_preferences.travel_mode
       ├─ travel_constraint_value → board_session_preferences.travel_constraint_value
       ├─ datetime_pref → board_session_preferences.datetime_pref
       ├─ date_option, time_slot, exact_time → same columns
       └─ use_gps_location, custom_location, custom_lat/lng → same columns
       │
       ▼
Normalized via normalizePreferencesForSave()
       │
       ├─ Clears time fields if date_option='now'
       ├─ Clears datetime_pref if date_option='today'/'weekend'
       ├─ GPS and custom_location are mutually exclusive
       └─ Validates exact_time format ("H:MM AM/PM")
```

After seeding, participants can independently modify their collaboration preferences without affecting their solo preferences.

---

## 8. Voting, RSVP & Lock-In

### 8.1 Voting (useSessionVoting.ts)

```
Participant taps 👍/👎 on a saved card
       │
       ├─ Optimistic update (local state)
       ├─ UPSERT board_user_swipe_states (session_id, user_id, saved_card_id, vote)
       ├─ Toggle behavior: tapping same vote again removes it
       └─ Broadcast via realtimeService → all participants see updated counts
```

**Vote counts structure:**
```typescript
{
  [cardId]: {
    yes: number,
    no: number,
    userVote: 'yes' | 'no' | null,
    voters: string[]   // user IDs who voted
  }
}
```

### 8.2 RSVP

```
Participant taps "I'm in" / "Can't make it"
       │
       ├─ Optimistic update
       ├─ UPSERT board_card_rsvps
       └─ When ALL participants RSVP 'yes' → DB trigger fires check_card_lock_in
```

### 8.3 Lock-In

```
All participants RSVP 'yes' on a card
       │
       ▼
DB trigger: check_card_lock_in
       │
       ├─ UPDATE board_saved_cards SET is_locked=true, locked_at=now()
       ├─ INSERT calendar_entries (source='collaboration')
       └─ Broadcast onCardLocked event
              │
              ▼
       useCollaborationCalendar hook detects lock-in
              │
              ├─ Polls for calendar_entry (up to 3 attempts, 300ms delay)
              └─ Prompts user to sync to device calendar
```

---

## 9. UI Components Map

### 9.1 HomePage Integration

```
HomePage.tsx
  │
  ├─ CollaborationSessions.tsx (pill bar below header)
  │   ├─ [Solo pill] ← always visible, switches to solo mode
  │   ├─ [Create pill] ← opens inline create modal
  │   ├─ [Session pill] ← one per active session (scrollable)
  │   │   └─ shows session name, participant count
  │   ├─ [Invite pill] ← one per pending invite (mail/hourglass icon)
  │   └─ Scroll arrows (left/right) when content overflows
  │
  ├─ SwipeableCards.tsx (main card deck)
  │   └─ Receives currentMode ('solo' or session ID)
  │       └─ In collab mode: uses rotation owner's categories + aggregated logistics
  │
  └─ Header options button
      └─ Orange icon when in collaboration mode
```

### 9.2 CollaborationModule.tsx (Full Modal — 1220 lines)

```
CollaborationModule (88% screen height modal)
  │
  ├─ Tab: SessionsTab.tsx (830 lines)
  │   ├─ Sub-tab: Active Sessions
  │   │   └─ SessionCard.tsx per session (name, status badge, members, cards, avatars)
  │   └─ Sub-tab: Pending Sessions
  │       └─ Pending invite cards
  │
  ├─ Tab: InvitesTab.tsx (842 lines)
  │   ├─ Sub-tab: Received Invites
  │   │   └─ Accept/Decline buttons, sender info, time received
  │   └─ Sub-tab: Sent Invites
  │       └─ Cancel button, expiration countdown, recipient info
  │
  └─ Tab: CreateTab.tsx (905 lines)
      ├─ Step 1: Session name + pre-selected friend
      ├─ Step 2: Friend picker
      └─ Step 3: Review + confirm + send
```

### 9.3 SessionCard.tsx (416 lines)

Displays individual session with:
- Name + color-coded status dot (green=active, yellow=voting, gray=locked)
- Stats: member count + card count
- Overlapping participant avatars (crown badge for admins)
- "Join Session" / "View Board" buttons
- Yellow warning if collaborative preferences not yet set

---

## 10. Real-Time Layer

All board session hooks subscribe via `realtimeService.subscribeToBoardSession(sessionId, callbacks)`:

| Event | Fired When | Handler |
|-------|-----------|---------|
| `onSessionUpdated` | Session metadata changes | Reload session data |
| `onParticipantJoined` | New member accepts | Update participants array |
| `onParticipantLeft` | Member removed/leaves | Update participants array |
| `onPreferencesChanged` | Any participant updates prefs | Reload all preferences |
| `onRotationChanged` | Active preference owner rotates | Reload session (new cards) |
| `onCardSaved` | Card saved to board | Update board cards |
| `onCardVoted` | Vote cast/changed | Reload vote counts |
| `onCardRSVP` | RSVP submitted | Reload RSVP counts |
| `onCardLocked` | All RSVPs in → auto-lock | Update locked state + calendar prompt |

---

## 11. Edge Functions (Collaboration-Specific)

Only **2 edge functions** are collaboration-specific — both handle push notifications:

### 11.1 `send-collaboration-invite`

- **Trigger:** Session creator invites a friend
- **Push to invitee:** "{InviterName} invited you to join '{SessionName}'"
- **Push to inviter:** "You invited {InvitedName} to join '{SessionName}'"
- **Handles non-app users:** Returns success with reason `user_not_on_platform_phone_stored`
- **Channel:** `collaboration-invites`

### 11.2 `notify-invite-response`

- **Trigger:** Invitee accepts or declines
- **Accepted push to inviter:** "{InvitedName} is in! They joined '{SessionName}'. Time to plan."
- **Declined push to inviter:** "{InvitedName} can't make it. They passed on '{SessionName}'."
- **Deep link:** `mingla://collaboration/session/{sessionId}`

**Card generation uses the exact same `discover-cards` edge function as solo mode.** No collaboration-aware server logic exists — the client assembles the hybrid preference payload.

---

## 12. Complete File Inventory

### Database Migrations
| File | What It Does |
|------|-------------|
| `20250126000007_schema_repair.sql` | Core collaboration_sessions + session_participants + collaboration_invites |
| `20250127000012_extend_collaboration_sessions.sql` | invite_code, invite_link, max_participants, is_active |
| `20250127000013_add_board_session_type.sql` | session_type column + board_id FK |
| `20250127000014_create_board_tables.sql` | board_saved_cards, board_messages, board_card_messages |
| `20250127000016_create_messaging_tables.sql` | Messaging schema |
| `20250127000017_create_presence_tables.sql` | board_participant_presence, board_typing_indicators |
| `20250127000028_fix_collaboration_sessions_rls.sql` | SECURITY DEFINER helper functions |
| `20250128000002_add_user_id_to_board_session_preferences.sql` | Per-user prefs (UNIQUE session_id+user_id) |
| `20250128000010_add_is_admin_to_session_participants.sql` | Admin promotion capability |
| `20250227000005_fix_all_session_rls_and_triggers.sql` | RLS recursion fix |
| `20250227000006_fix_invite_fk_and_interactions_trigger.sql` | invitee_id ↔ invited_user_id sync trigger |
| `20260227000001_auto_delete_sessions_under_two_participants.sql` | Orphan session cleanup |
| `20260303000002_add_intents_to_board_session_preferences.sql` | Intents column + separation from categories |
| `20260309000002_pending_invites.sql` | Phone-based pending invites |
| `20260311000002_add_missing_cols_board_session_preferences.sql` | time_slot, exact_time, use_gps_location, custom_location |
| `20260312000001_create_board_collaborators.sql` | Board access control |

### Services
| File | Purpose |
|------|---------|
| `sessionService.ts` | Switch sessions, get active session (by last_activity_at) |
| `boardSessionService.ts` | Fetch/transform sessions for board view (5s dedup cache) |
| `boardInviteService.ts` | Invite links, join by code, accept/decline |
| `boardService.ts` | Board CRUD, collaborator management |
| `preferencesService.ts` | Solo preference CRUD (for seeding) |
| `realtimeService.ts` | Supabase Realtime subscriptions |

### Hooks
| File | Purpose |
|------|---------|
| `useSessionManagement.ts` | Session CRUD, participant management, preference seeding |
| `useBoardSession.ts` | Load session + all participant prefs + realtime |
| `useSessionStatus.ts` | Status state machine + creator-only transitions |
| `useSessionVoting.ts` | Vote/RSVP with optimistic updates + concurrency guards |
| `useCollaborationCalendar.ts` | Calendar entry on lock-in + device sync |
| `useBoardQueries.ts` | React Query surface for boards |
| `useUserPreferences.ts` | Solo preferences (for seeding comparison) |

### Utilities
| File | Purpose |
|------|---------|
| `sessionPrefsUtils.ts` | Aggregation of non-rotating preferences across participants |
| `sessionRotation.ts` | Rotation order init, advance, label, queue position |
| `preferencesConverter.ts` | Normalize preferences + convert to request format |

### Components
| File | Lines | Purpose |
|------|-------|---------|
| `CollaborationSessions.tsx` | 1674 | HomePage pill bar + inline create modal |
| `CollaborationModule.tsx` | 1220 | Full management modal (3 tabs) |
| `SessionsTab.tsx` | 830 | Active/pending sessions tab |
| `InvitesTab.tsx` | 842 | Sent/received invites tab |
| `CreateTab.tsx` | 905 | Multi-step creation wizard |
| `SessionCard.tsx` | 416 | Individual session display card |
| `HomePage.tsx` | 658 | Integration point (sessions bar + card deck) |

---

## 13. Summary: Solo vs Collaboration Card Generation

| Dimension | Solo Mode | Collaboration Mode |
|-----------|-----------|-------------------|
| **Preferences table** | `preferences` (1 row per user) | `board_session_preferences` (1 row per user per session) |
| **Who sets preferences** | The user | Each participant independently |
| **Seeding** | N/A | Copied from user's solo prefs on create/join |
| **Categories & intents** | From the user | From the **active rotation participant** only |
| **Budget, price, travel, location, datetime** | From the user | **Aggregated across ALL participants** (union/min/max/median/midpoint) |
| **Card generation endpoint** | `discover-cards` | Same `discover-cards` (no server awareness of collaboration) |
| **Card visibility** | Personal deck | Shared board (`board_saved_cards`) |
| **Decision mechanism** | Solo swipe (save/dismiss) | Vote → RSVP → auto-lock when unanimous |
| **Rotation** | N/A | Creator → participants by join date; advances to next person with saved prefs |
| **Real-time** | N/A | Full Supabase Realtime (votes, RSVPs, prefs changes, participant joins, card locks) |
