# BACKEND SPEC — ORCH-0437: Near You Leaderboard

**Author:** Mingla Forensics
**Date:** 2026-04-15
**Status:** Complete — ready for orchestrator review
**Depends on:** Design spec `DESIGN_ORCH-0437_NEAR_YOU_LEADERBOARD.md`

---

## 1. Table Schemas

### 1.1 `leaderboard_presence` (NEW)

Single row per user. Upserted on each swipe. Rows older than 24h are filtered client-side and cleaned by cron.

```sql
CREATE TABLE public.leaderboard_presence (
  user_id         UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_discoverable BOOLEAN NOT NULL DEFAULT false,
  visibility_level TEXT NOT NULL DEFAULT 'friends'
    CHECK (visibility_level IN ('off','paired','friends','friends_of_friends','everyone')),

  -- Location (plain doubles — no PostGIS)
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,

  -- Status & intent
  activity_status TEXT,                          -- 'exploring', 'looking_for_plans', etc. or custom text
  preference_categories TEXT[] NOT NULL DEFAULT '{}',  -- categories from preferences sheet
  last_swiped_category TEXT,                     -- most recent swipe category (for Realtime pulse)

  -- Seats
  available_seats INTEGER NOT NULL DEFAULT 1
    CHECK (available_seats BETWEEN 0 AND 5),
  active_collab_session_id UUID REFERENCES public.collaboration_sessions(id) ON DELETE SET NULL,

  -- Activity metrics
  swipe_count     INTEGER NOT NULL DEFAULT 0,
  session_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_swipe_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Level (materialized — updated by trigger/RPC)
  user_level      INTEGER NOT NULL DEFAULT 1
    CHECK (user_level BETWEEN 1 AND 99),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for geographic bounding box queries (WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?)
CREATE INDEX idx_leaderboard_presence_geo
  ON public.leaderboard_presence (lat, lng)
  WHERE is_discoverable = true AND available_seats > 0;

-- Index for recency ranking
CREATE INDEX idx_leaderboard_presence_recency
  ON public.leaderboard_presence (last_swipe_at DESC)
  WHERE is_discoverable = true AND available_seats > 0;

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.leaderboard_presence;

-- RLS
ALTER TABLE public.leaderboard_presence ENABLE ROW LEVEL SECURITY;
```

**Design decisions:**
- **New table, not extending `user_map_settings`** — different lifecycle (presence is transient, map settings are persistent). Keeps separation of concerns.
- **Single row per user (upsert)** — avoids append-only log bloat. Each swipe does an UPSERT. The `last_swipe_at` timestamp determines recency ranking.
- **No PostGIS** — PostGIS is not enabled in this project. We use plain `lat`/`lng` with bounding-box index. Haversine distance is calculated in the edge function or client.
- **`last_swiped_category`** — updated on every swipe. Supabase Realtime broadcasts the UPDATE event including the new value. Client animates the category icon pulse. This is option (a) from the dispatch — simplest, leverages existing Realtime infrastructure.
- **`user_level` materialized** — stored on the row, updated by an RPC. Faster leaderboard ranking than computing on the fly.
- **24-hour expiry** — rows are NOT deleted. Client filters `WHERE last_swipe_at > now() - interval '24 hours'`. A daily cron job (`pg_cron`) cleans stale rows.

---

### 1.2 `tag_along_requests` (NEW)

```sql
CREATE TABLE public.tag_along_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','declined','expired','cancelled')),

  -- Collab session created on accept (NULL until accepted)
  collab_session_id UUID REFERENCES public.collaboration_sessions(id) ON DELETE SET NULL,

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),

  -- Cooldown enforcement: unique constraint prevents duplicate pending requests
  -- Declined requests have a cooldown — enforced by the edge function, not the constraint
  UNIQUE (sender_id, receiver_id, status)
    -- Partial unique index below replaces this for pending-only uniqueness
);

-- Only one pending request per sender→receiver pair
CREATE UNIQUE INDEX idx_tag_along_pending
  ON public.tag_along_requests (sender_id, receiver_id)
  WHERE status = 'pending';

-- For receiver's inbox
CREATE INDEX idx_tag_along_receiver_pending
  ON public.tag_along_requests (receiver_id, created_at DESC)
  WHERE status = 'pending';

-- Enable Realtime (for banner notifications)
ALTER PUBLICATION supabase_realtime ADD TABLE public.tag_along_requests;

ALTER TABLE public.tag_along_requests ENABLE ROW LEVEL SECURITY;
```

**Design decisions:**
- **Separate table from `friend_requests`** — different lifecycle, different fields (collab_session_id, expires_at, seats logic). Mixing would complicate both tables.
- **`expires_at` column** — set to `now() + 24h` on creation. The edge function checks this before allowing acceptance.
- **Partial unique index on pending** — prevents duplicate pending requests from same sender to same receiver. Allows historical rows (declined, expired, cancelled).
- **Cooldown enforcement** — the `accept-tag-along` edge function checks: no declined request from this sender to this receiver within the last 24 hours. This is a query check, not a constraint, because the 24h window is relative.

---

### 1.3 `user_levels` (NEW — scoring inputs cache)

```sql
CREATE TABLE public.user_levels (
  user_id           UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  level             INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 99),
  xp_score          NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Cached input counts (updated by RPC)
  reviews_count     INTEGER NOT NULL DEFAULT 0,
  saves_count       INTEGER NOT NULL DEFAULT 0,
  scheduled_count   INTEGER NOT NULL DEFAULT 0,
  friends_count     INTEGER NOT NULL DEFAULT 0,
  collabs_count     INTEGER NOT NULL DEFAULT 0,
  account_age_days  INTEGER NOT NULL DEFAULT 0,

  last_calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_levels ENABLE ROW LEVEL SECURITY;
```

**Why a separate table:** The level calculation aggregates from 5+ tables. Doing this inline on every leaderboard query would be expensive. This table caches the result. Updated by RPC call when presence is upserted (lazy recalc — only recalculate if `last_calculated_at` is older than 1 hour).

---

## 2. RLS Policies

### 2.1 `leaderboard_presence` Policies

```sql
-- Users can read/write their own row always
CREATE POLICY "Users manage own presence"
  ON public.leaderboard_presence
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can read others' rows based on visibility level
-- This is the core privacy policy. Performance-optimized with a materialized helper.
CREATE POLICY "Users see discoverable presence"
  ON public.leaderboard_presence
  FOR SELECT
  USING (
    user_id = auth.uid()  -- always see yourself
    OR (
      is_discoverable = true
      AND available_seats > 0
      AND last_swipe_at > now() - interval '24 hours'
      AND (
        -- 'everyone': any authenticated user
        visibility_level = 'everyone'
        -- 'friends': direct friends only
        OR (visibility_level = 'friends' AND EXISTS (
          SELECT 1 FROM public.friends
          WHERE status = 'accepted'
            AND deleted_at IS NULL
            AND (
              (user_id = auth.uid() AND friend_user_id = leaderboard_presence.user_id)
              OR (friend_user_id = auth.uid() AND user_id = leaderboard_presence.user_id)
            )
        ))
        -- 'friends_of_friends': 2-hop via helper function
        OR (visibility_level = 'friends_of_friends' AND public.are_friends_or_fof(auth.uid(), leaderboard_presence.user_id))
        -- 'paired': only paired users (existing pairing check)
        OR (visibility_level = 'paired' AND EXISTS (
          SELECT 1 FROM public.friends
          WHERE status = 'accepted'
            AND deleted_at IS NULL
            AND (
              (user_id = auth.uid() AND friend_user_id = leaderboard_presence.user_id)
              OR (friend_user_id = auth.uid() AND user_id = leaderboard_presence.user_id)
            )
            -- Pairing is a subset of friends — check collaboration_sessions for paired sessions
            -- This is a simplification: "paired" = friends who have had a collab session together
        ))
        -- 'off' / 'nobody': never visible (already handled by is_discoverable = false)
      )
    )
  );
```

### 2.2 Friends-of-Friends Helper Function

The `friends_of_friends` 2-hop query is expensive if done inline in RLS. We create a stable SQL function with `SECURITY DEFINER` to avoid per-row evaluation overhead:

```sql
CREATE OR REPLACE FUNCTION public.are_friends_or_fof(viewer_id UUID, target_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Direct friends check
  SELECT EXISTS (
    SELECT 1 FROM friends
    WHERE status = 'accepted' AND deleted_at IS NULL
      AND (
        (user_id = viewer_id AND friend_user_id = target_id)
        OR (friend_user_id = viewer_id AND user_id = target_id)
      )
  )
  OR EXISTS (
    -- Friends of friends: viewer→mutual→target
    SELECT 1 FROM friends f1
    JOIN friends f2 ON (
      -- f1.friend is the mutual friend, f2 connects mutual to target
      CASE WHEN f1.user_id = viewer_id THEN f1.friend_user_id ELSE f1.user_id END
      = CASE WHEN f2.user_id = target_id THEN f2.friend_user_id ELSE f2.user_id END
    )
    WHERE f1.status = 'accepted' AND f1.deleted_at IS NULL
      AND f2.status = 'accepted' AND f2.deleted_at IS NULL
      AND (f1.user_id = viewer_id OR f1.friend_user_id = viewer_id)
      AND (f2.user_id = target_id OR f2.friend_user_id = target_id)
    LIMIT 1
  );
$$;
```

**Performance note:** The `friends` table has a UNIQUE index on `(user_id, friend_user_id)`. The direct-friends check hits the index. The FoF join is bounded by the user's friend count (typically < 100), making the 2-hop join small. For users with 500+ friends, this could get slow — but that's an extreme case. Monitor and add a materialized `friends_of_friends` table if needed.

### 2.3 `tag_along_requests` Policies

```sql
-- Sender can see their own outgoing requests
CREATE POLICY "Sender sees own requests"
  ON public.tag_along_requests
  FOR SELECT
  USING (sender_id = auth.uid());

-- Receiver can see incoming requests
CREATE POLICY "Receiver sees incoming requests"
  ON public.tag_along_requests
  FOR SELECT
  USING (receiver_id = auth.uid());

-- Only edge functions insert/update (via service role)
-- No direct INSERT/UPDATE/DELETE for authenticated users
CREATE POLICY "Service role manages requests"
  ON public.tag_along_requests
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
```

### 2.4 `user_levels` Policies

```sql
-- Anyone can read anyone's level (public info)
CREATE POLICY "Levels are public"
  ON public.user_levels
  FOR SELECT
  USING (true);

-- Only service role writes (via RPC)
CREATE POLICY "Service role manages levels"
  ON public.user_levels
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
```

---

## 3. Edge Function Contracts

### 3.1 `upsert-leaderboard-presence`

Called on every swipe action. Also called on session start and preference changes.

```
POST /functions/v1/upsert-leaderboard-presence
Authorization: Bearer <JWT>

Request:
{
  lat: number,                    // required
  lng: number,                    // required
  swiped_category?: string,      // category of the card just swiped (for live pulse)
  preference_categories?: string[], // current preference sheet categories
  activity_status?: string,       // current status text
  available_seats?: number,       // 1-5
  is_discoverable?: boolean,      // master toggle
  visibility_level?: string       // 'everyone'|'friends'|...|'off'
}

Response (200):
{
  success: true,
  user_level: number,             // current level (may have been recalculated)
  swipe_count: number             // cumulative swipe count for this session
}

Response (401): { error: 'Unauthorized' }
Response (400): { error: string }  // validation failure
```

**Logic:**
1. Extract `user_id` from JWT
2. Validate inputs (lat/lng ranges, seats 1-5, visibility_level enum)
3. UPSERT into `leaderboard_presence`:
   - ON CONFLICT (user_id) DO UPDATE
   - Increment `swipe_count` by 1 (if `swiped_category` is provided)
   - Set `last_swipe_at = now()`
   - Set `last_swiped_category` = swiped_category (if provided)
   - Update all other provided fields
   - If `session_started_at` is NULL or more than 24h old, reset to `now()` and reset `swipe_count` to 1
4. Check `user_levels.last_calculated_at` — if older than 1 hour, call `recalculate-user-level` (inline, not separate function call)
5. Return current level + swipe count

**Security:**
- `user_id` MUST come from JWT, never from request body
- lat/lng validated: lat -90..90, lng -180..180
- Rate limit: no artificial limit (decision #15), but natural throttling by swipe frequency

---

### 3.2 `send-tag-along`

Called when a user indicates interest on a leaderboard card.

```
POST /functions/v1/send-tag-along
Authorization: Bearer <JWT>

Request:
{
  receiver_id: string             // user_id of the leaderboard person
}

Response (200):
{
  success: true,
  request_id: string,
  already_friends: boolean
}

Response (409): { error: 'pending_request_exists' }
Response (429): { error: 'cooldown_active', cooldown_ends_at: string }
Response (400): { error: string }
Response (404): { error: 'user_not_discoverable' }
```

**Logic:**
1. Extract `sender_id` from JWT
2. Verify `sender_id !== receiver_id`
3. Verify receiver exists in `leaderboard_presence` with `is_discoverable = true` and `available_seats > 0`
4. Check RLS visibility (can sender see receiver based on visibility_level?)
5. Check cooldown: no declined request from sender to receiver where `responded_at > now() - interval '24 hours'`
6. Check pending: no existing pending request from sender to receiver
7. Check expiry cleanup: expire any pending requests where `expires_at < now()`
8. INSERT into `tag_along_requests` (status: pending, expires_at: now()+24h)
9. Check if already friends (EXISTS in `friends` with status='accepted')
10. Send push notification via `notify-dispatch`:
    - type: `tag_along_received`
    - to: receiver_id
    - data: `{ request_id, sender_display_name, sender_level, sender_status, sender_avatar_url }`
    - deep_link: `mingla://discover?tab=near-you`
11. Return request_id + already_friends flag

---

### 3.3 `accept-tag-along`

Called when the leaderboard person accepts an interest request. **Atomic: creates friendship + collab session in one transaction.**

```
POST /functions/v1/accept-tag-along
Authorization: Bearer <JWT>

Request:
{
  request_id: string
}

Response (200):
{
  success: true,
  collab_session_id: string,
  session_name: string,
  friendship_created: boolean,    // true if they weren't already friends
  merged_categories: string[]     // union of both users' categories
}

Response (400): { error: 'request_expired' | 'request_not_pending' | 'no_seats_available' }
Response (403): { error: 'not_receiver' }
Response (404): { error: 'request_not_found' }
```

**Logic (all in a single Supabase transaction):**
1. Extract `receiver_id` from JWT
2. Read `tag_along_requests` WHERE id = request_id
3. Verify `receiver_id` matches request's receiver_id
4. Verify `status = 'pending'` and `expires_at > now()`
5. Read receiver's `leaderboard_presence` — verify `available_seats > 0`
6. Check `sender_id` is still in `leaderboard_presence` (they might have gone offline)

**Friendship step:**
7. Check if already friends in `friends` table
8. If NOT friends:
   a. INSERT into `friends` (user_id: receiver_id, friend_user_id: sender_id, status: 'accepted')
   b. INSERT reciprocal row (user_id: sender_id, friend_user_id: receiver_id, status: 'accepted')
   c. (Or upsert single row — depends on how `friends` table works. Current schema uses directional rows with unique(user_id, friend_user_id), so one INSERT is sufficient since the service queries both directions.)

**Collab session step:**
9. Read receiver's `preferences` (solo categories, intents, travel_mode, location)
10. Read sender's `preferences` (same fields)
11. Compute merged preferences:
    - `categories` = UNION of both users' categories (deduplicated)
    - `intents` = UNION of both users' intents (deduplicated)
    - `travel_mode` = most permissive (driving > transit > biking > walking)
    - `travel_constraint_value` = MAX of both
    - `location / lat / lng` = receiver's location (host decides venue)
    - `date_option` = receiver's date setting (host decides when)
12. Check if receiver already has an active collab from tag-alongs (`active_collab_session_id` on presence):
    - If YES: add sender as participant to EXISTING session + re-merge categories
    - If NO: create NEW session
13. Create collab session (if new):
    a. INSERT `collaboration_sessions` (name: "ReceiverName & SenderName", created_by: receiver_id, status: 'active', session_type: 'group_hangout')
    b. INSERT `session_participants` for receiver (has_accepted: true)
    c. INSERT `session_participants` for sender (has_accepted: true)
    d. INSERT `board_session_preferences` with merged values
    e. CREATE board + link to session (same pattern as existing `collaborationInviteService.acceptCollaborationInvite`)
14. If joining existing session:
    a. INSERT `session_participants` for sender
    b. UPDATE `board_session_preferences.categories` = existing ∪ sender's categories
    c. UPDATE `collaboration_sessions.name` — append sender's name
    d. INSERT `board_collaborators` for sender

**Presence update:**
15. Decrement receiver's `available_seats` in `leaderboard_presence`
16. Set receiver's `active_collab_session_id` = session_id
17. If `available_seats` reaches 0: the partial index (`WHERE available_seats > 0`) automatically excludes them from leaderboard queries

**Request update:**
18. UPDATE `tag_along_requests` SET status='accepted', responded_at=now(), collab_session_id=session_id

**Notifications:**
19. Send push to sender via `notify-dispatch`:
    - type: `tag_along_accepted`
    - data: `{ session_id, session_name, receiver_display_name, receiver_avatar_url }`
    - deep_link: `mingla://session?id=${session_id}`
20. Send push to receiver (confirmation):
    - type: `tag_along_match`
    - data: same

21. Return session details

---

### 3.4 `decline-tag-along`

```
POST /functions/v1/decline-tag-along
Authorization: Bearer <JWT>

Request:
{
  request_id: string
}

Response (200): { success: true }
Response (403): { error: 'not_receiver' }
Response (404): { error: 'request_not_found' }
```

**Logic:**
1. Extract `receiver_id` from JWT
2. Verify request exists and `receiver_id` matches
3. UPDATE `tag_along_requests` SET status='declined', responded_at=now()
4. No notification to sender (silent decline — less awkward)

---

### 3.5 `recalculate-user-level` (RPC, not HTTP edge function)

Called inline by `upsert-leaderboard-presence` when level data is stale (>1 hour old).

```sql
CREATE OR REPLACE FUNCTION public.recalculate_user_level(target_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reviews    INTEGER;
  v_saves      INTEGER;
  v_scheduled  INTEGER;
  v_friends    INTEGER;
  v_collabs    INTEGER;
  v_age_days   INTEGER;
  v_xp         NUMERIC(10,2);
  v_level      INTEGER;
BEGIN
  -- Count inputs
  SELECT count(*) INTO v_reviews FROM place_reviews WHERE user_id = target_user_id;
  SELECT count(*) INTO v_saves FROM saved_card WHERE profile_id = target_user_id;
  SELECT count(*) INTO v_scheduled FROM calendar_entries WHERE user_id = target_user_id;
  SELECT count(*) INTO v_friends FROM friends
    WHERE status = 'accepted' AND deleted_at IS NULL
      AND (user_id = target_user_id OR friend_user_id = target_user_id);
  SELECT count(DISTINCT session_id) INTO v_collabs FROM session_participants
    WHERE user_id = target_user_id AND has_accepted = true;
  SELECT EXTRACT(DAY FROM now() - created_at)::INTEGER INTO v_age_days
    FROM auth.users WHERE id = target_user_id;

  -- XP formula (proposed weights — subject to user approval)
  -- Reviews:   5 XP each (most effort)
  -- Saves:     2 XP each
  -- Scheduled: 3 XP each (intent to go)
  -- Friends:   3 XP each (social)
  -- Collabs:   4 XP each (active social)
  -- Age:       0.1 XP per day (tenure bonus, capped at 365 days)
  v_xp := (v_reviews * 5.0)
         + (v_saves * 2.0)
         + (v_scheduled * 3.0)
         + (v_friends * 3.0)
         + (v_collabs * 4.0)
         + (LEAST(v_age_days, 365) * 0.1);

  -- Level curve: logarithmic so early levels come fast, later ones require more
  -- Level 1 = 0 XP, Level 10 ≈ 50 XP, Level 25 ≈ 200 XP, Level 50 ≈ 800 XP, Level 99 ≈ 5000 XP
  -- Formula: level = floor(10 * ln(xp + 1)) + 1, clamped to [1, 99]
  v_level := GREATEST(1, LEAST(99, FLOOR(10.0 * LN(v_xp + 1)) + 1));

  -- Upsert into user_levels cache
  INSERT INTO user_levels (user_id, level, xp_score, reviews_count, saves_count,
    scheduled_count, friends_count, collabs_count, account_age_days, last_calculated_at)
  VALUES (target_user_id, v_level, v_xp, v_reviews, v_saves, v_scheduled,
    v_friends, v_collabs, v_age_days, now())
  ON CONFLICT (user_id) DO UPDATE SET
    level = v_level,
    xp_score = v_xp,
    reviews_count = v_reviews,
    saves_count = v_saves,
    scheduled_count = v_scheduled,
    friends_count = v_friends,
    collabs_count = v_collabs,
    account_age_days = v_age_days,
    last_calculated_at = now();

  -- Also update the materialized level on leaderboard_presence (if row exists)
  UPDATE leaderboard_presence SET user_level = v_level WHERE user_id = target_user_id;

  RETURN v_level;
END;
$$;
```

**Level curve examples (for user approval):**

| XP | Level | What it takes |
|----|-------|---------------|
| 0 | 1 | Brand new user |
| 10 | 4 | 2 reviews or 5 saves |
| 50 | 10 | ~10 saves + 3 reviews + 5 friends |
| 200 | 23 | Active user with ~20 saves, 10 reviews, 10 friends, 5 collabs |
| 800 | 38 | Power user, several months active |
| 2000 | 52 | Very engaged over 6+ months |
| 5000 | 69 | Year+ of heavy engagement |
| 10000 | 82 | Exceptional engagement |
| 50000 | 99 | Theoretical max — years of daily use |

**"Hours spent on Mingla":** Skipped intentionally. There's no session tracking mechanism today. Adding one would require a new table + background timer + battery concerns. The proxy metrics (reviews, saves, scheduled, collabs) already correlate strongly with engagement time. If hours-tracking is needed later, it can be added as a new XP input without changing the formula structure.

---

## 4. Realtime Subscription Plan

### 4.1 Leaderboard Presence Changes

```
Channel: postgres_changes
Table: leaderboard_presence
Events: INSERT, UPDATE, DELETE
Filter: None (client-side filtering by geo bounding box + visibility)
```

**Why no server-side geo filter:** Supabase Realtime `postgres_changes` supports equality filters only (e.g., `filter: 'user_id=eq.${id}'`). It does NOT support range filters (`lat BETWEEN ? AND ?`). Therefore, the client subscribes to ALL changes on `leaderboard_presence` and filters locally.

**Payload optimization:**
The Realtime payload includes the full row on INSERT/UPDATE. The row is compact (~500 bytes: UUID + 2 doubles + a few texts + an array + a few integers). For a city with 100 active users making 1 swipe/minute each, that's ~100 events/minute, ~50KB/minute — well within Realtime capacity.

**Client subscription pattern:**
```typescript
// In useLeaderboardPresence hook
const channel = supabase
  .channel('leaderboard')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'leaderboard_presence',
  }, (payload) => {
    // payload.new contains the full row
    // Client filters: is within radius? passes visibility RLS? not expired?
    // Note: RLS handles visibility — the client only receives rows it's allowed to see
    handlePresenceChange(payload);
  })
  .subscribe();
```

**Important RLS interaction:** Supabase Realtime respects RLS policies. The client will only receive events for rows that pass its SELECT policy. This means visibility filtering is automatic — a user with `visibility_level = 'friends'` will only broadcast to their friends.

### 4.2 Swipe Activity Pulses

**Mechanism:** When a user swipes, `upsert-leaderboard-presence` updates `last_swiped_category` on the row. This triggers a Realtime UPDATE event. The client receives the event, sees the new `last_swiped_category` value, and animates the corresponding icon on that user's card.

**Deduplication:** If a user swipes the same category twice quickly, the column value doesn't change (same text). Realtime may or may not fire an UPDATE for a no-op SET. To guarantee the pulse fires, append a monotonic counter: `last_swiped_category = 'drink:17'` where 17 is the swipe_count. Client splits on `:` and uses only the category name for animation.

**Throttle concern:** Users swipe ~1-3 cards per minute. Each swipe triggers an UPSERT → Realtime broadcast. At 100 users × 2 swipes/min = 200 events/min. This is fine — Supabase Realtime handles thousands of events/second.

### 4.3 Tag-Along Request Notifications

```
Channel: postgres_changes
Table: tag_along_requests
Events: INSERT, UPDATE
Filter: filter: 'receiver_id=eq.${userId}'  (or sender_id for sent-state updates)
```

Client subscribes to their own incoming requests. When a new INSERT arrives with `status='pending'`, the client shows the `TagAlongBanner`.

When the status changes to `accepted`/`declined`, the sender's client receives the UPDATE and updates the card state.

---

## 5. Stale Data Cleanup

### 5.1 Expired Presence Cleanup (pg_cron)

```sql
-- Run every hour: delete rows where last_swipe_at > 24h ago
SELECT cron.schedule(
  'cleanup-stale-leaderboard-presence',
  '0 * * * *',  -- every hour
  $$DELETE FROM public.leaderboard_presence WHERE last_swipe_at < now() - interval '24 hours'$$
);
```

### 5.2 Expired Tag-Along Requests Cleanup

```sql
-- Run every hour: expire pending requests past their expiry
SELECT cron.schedule(
  'expire-tag-along-requests',
  '0 * * * *',
  $$UPDATE public.tag_along_requests SET status = 'expired' WHERE status = 'pending' AND expires_at < now()$$
);
```

### 5.3 Collab Session End → Reappear on Leaderboard

When a collab session ends (status → 'completed' or 'archived'), the receiver should reappear on the leaderboard with their original solo preferences.

**Mechanism:** A database trigger on `collaboration_sessions` status change:

```sql
CREATE OR REPLACE FUNCTION public.handle_collab_session_end()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('completed', 'archived') AND OLD.status NOT IN ('completed', 'archived') THEN
    -- Reset all participants' leaderboard presence:
    -- Restore available_seats, clear active_collab_session_id
    UPDATE leaderboard_presence
    SET available_seats = COALESCE(
          (SELECT available_seats FROM user_map_settings WHERE user_id = leaderboard_presence.user_id),
          1
        ),
        active_collab_session_id = NULL,
        updated_at = now()
    WHERE active_collab_session_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_collab_session_end
  AFTER UPDATE OF status ON public.collaboration_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_collab_session_end();
```

**Note:** "Restore available_seats" uses the `user_map_settings` value as the source of truth for the user's original seat preference. The new preferences sheet writes `available_seats` to `user_map_settings` (persisted) AND `leaderboard_presence` (transient). When a collab ends, we restore from the persisted value.

This requires adding `available_seats` to `user_map_settings`:

```sql
ALTER TABLE public.user_map_settings
  ADD COLUMN IF NOT EXISTS available_seats INTEGER NOT NULL DEFAULT 1
    CHECK (available_seats BETWEEN 1 AND 5);

ALTER TABLE public.user_map_settings
  ADD COLUMN IF NOT EXISTS is_discoverable BOOLEAN NOT NULL DEFAULT false;
```

---

## 6. Migration Plan

Execute in this order:

| # | Migration File | What It Does |
|---|---------------|-------------|
| 1 | `20260416100001_orch0437_user_levels.sql` | Create `user_levels` table + `recalculate_user_level` RPC |
| 2 | `20260416100002_orch0437_leaderboard_presence.sql` | Create `leaderboard_presence` table + indexes + Realtime publication + RLS + `are_friends_or_fof` function |
| 3 | `20260416100003_orch0437_tag_along_requests.sql` | Create `tag_along_requests` table + indexes + Realtime + RLS |
| 4 | `20260416100004_orch0437_map_settings_seats.sql` | ALTER `user_map_settings` ADD `available_seats`, `is_discoverable` |
| 5 | `20260416100005_orch0437_collab_session_end_trigger.sql` | Create trigger for collab session end → leaderboard reappear |
| 6 | `20260416100006_orch0437_cron_cleanup.sql` | pg_cron schedules for stale presence + expired requests |

Edge functions (no migration, deploy via `supabase functions deploy`):
- `supabase/functions/upsert-leaderboard-presence/index.ts`
- `supabase/functions/send-tag-along/index.ts`
- `supabase/functions/accept-tag-along/index.ts`
- `supabase/functions/decline-tag-along/index.ts`

---

## 7. Integration Map

```
┌─────────────────────────────────────────────────────────────┐
│                         CLIENT                               │
│                                                              │
│  PreferencesSheet ──writes──→ user_map_settings              │
│       │                        (is_discoverable,             │
│       │                         available_seats,             │
│       │                         visibility_level,            │
│       └──also writes──→ leaderboard_presence                 │
│                          (via upsert-leaderboard-presence)   │
│                                                              │
│  SwipeableCards ──on swipe──→ upsert-leaderboard-presence    │
│       (sends: lat, lng, swiped_category)                     │
│                                                              │
│  LeaderboardFeed ──subscribes──→ Realtime: leaderboard_pres. │
│       │                                                      │
│       └──indicate interest──→ send-tag-along                 │
│                                                              │
│  TagAlongBanner ──subscribes──→ Realtime: tag_along_requests │
│       ├──accept──→ accept-tag-along                          │
│       └──decline──→ decline-tag-along                        │
│                                                              │
│  TagAlongMatchOverlay ←── push notification (tag_along_match)│
│       └──navigate──→ SessionViewModal                        │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                         BACKEND                              │
│                                                              │
│  upsert-leaderboard-presence                                 │
│       ├── UPSERT leaderboard_presence                        │
│       └── CALL recalculate_user_level (if stale > 1hr)       │
│             ├── READ place_reviews                           │
│             ├── READ saved_card                              │
│             ├── READ calendar_entries                         │
│             ├── READ friends                                 │
│             ├── READ session_participants                     │
│             ├── READ auth.users (created_at)                 │
│             └── UPSERT user_levels                           │
│                                                              │
│  send-tag-along                                              │
│       ├── READ leaderboard_presence (verify discoverable)    │
│       ├── CHECK tag_along_requests (cooldown + pending)      │
│       ├── INSERT tag_along_requests                          │
│       └── CALL notify-dispatch (push to receiver)            │
│                                                              │
│  accept-tag-along                                            │
│       ├── READ tag_along_requests                            │
│       ├── READ leaderboard_presence (check seats)            │
│       ├── READ friends (already friends?)                    │
│       ├── INSERT friends (if not already)                    │
│       ├── READ preferences (both users)                      │
│       ├── INSERT collaboration_sessions                      │
│       ├── INSERT session_participants (both)                 │
│       ├── INSERT board_session_preferences (merged)          │
│       ├── INSERT boards + board_collaborators                │
│       ├── UPDATE leaderboard_presence (decrement seats)      │
│       ├── UPDATE tag_along_requests (status → accepted)      │
│       └── CALL notify-dispatch (push to both)                │
│                                                              │
│  TRIGGER: handle_collab_session_end                          │
│       └── UPDATE leaderboard_presence (restore seats,        │
│           clear active_collab_session_id)                    │
│                                                              │
│  CRON: cleanup-stale-leaderboard-presence (hourly)           │
│  CRON: expire-tag-along-requests (hourly)                    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 8. Performance Considerations

| Concern | Mitigation |
|---------|-----------|
| **RLS on `leaderboard_presence`** — `friends_of_friends` requires a 2-hop join | `are_friends_or_fof` function is `STABLE` (cacheable within a transaction). The `friends` table has unique index on `(user_id, friend_user_id)`. For most users with < 100 friends, the join is fast. Monitor with `EXPLAIN ANALYZE` before launch. |
| **Realtime broadcast volume** — all updates on `leaderboard_presence` broadcast globally | Supabase Realtime applies RLS per-subscriber. Only visible rows broadcast to each client. For 100 users swiping 2x/min = 200 events/min — well within limits. |
| **`recalculate_user_level` aggregates 5 tables** | Only runs when stale (>1hr). Counts hit primary key indexes. Each query is `O(user's data)`, not `O(all data)`. Typical execution: < 50ms. |
| **Geo bounding-box queries** | Partial index on `(lat, lng) WHERE is_discoverable AND available_seats > 0` keeps the index small. Bounding-box filters (`lat BETWEEN ? AND ?`) are range scans on the B-tree index. |
| **`tag_along_requests` cooldown check** | Index on `(sender_id, receiver_id)` makes the cooldown query fast. |
| **FlashList re-renders on Realtime** | Client should batch Realtime events (debounce 200ms) before updating the list data. Prevents jank from rapid-fire updates. |

---

## 9. Security Considerations

| Vector | Mitigation |
|--------|-----------|
| **Location spoofing** | Server cannot verify GPS authenticity. Accept as-is. The leaderboard is social, not safety-critical. Spoofed location = wrong proximity ranking, no harm. |
| **Fake swipe activity** | `upsert-leaderboard-presence` requires JWT. Rate is naturally limited by actual swipe frequency. No artificial rate limit needed. |
| **Level inflation** | Level is server-calculated from actual database counts. Cannot be spoofed — counts come from authoritative tables with RLS. |
| **Seat manipulation** | `available_seats` is decremented by `accept-tag-along` (service role), not by the client. Client can only set the initial value via preferences. |
| **Tag-along spam** | Cooldown (24hr after decline) + expiry (24hr) + partial unique index (one pending per pair) prevents abuse. |
| **Visibility bypass** | RLS enforces visibility at the database level. Even if a client subscribes to all Realtime events, Supabase only sends rows that pass the SELECT policy for that user's JWT. |
| **Cross-user data exposure** | `leaderboard_presence` rows contain lat/lng. The design spec says to show proximity tiers ("Very close", "Nearby"), not exact distance. The CLIENT converts lat/lng to tier labels. The raw lat/lng is in the payload — this is acceptable because the user opted into discoverability. If this is a concern, compute distance server-side and return a tier label instead. |

---

## 10. Success Criteria

| # | Criterion | Testable Assertion |
|---|-----------|-------------------|
| SC-1 | Presence upsert works | Call `upsert-leaderboard-presence` with valid JWT → row exists in `leaderboard_presence` with matching user_id, lat, lng, category |
| SC-2 | Swipe count increments | Call upsert twice with `swiped_category` → `swipe_count` = 2, `last_swiped_category` = second category |
| SC-3 | Level is calculated | New user with 0 activity → level 1. User with 5 reviews + 10 saves → level > 1 |
| SC-4 | Visibility "friends" works | User A (friends) sets visibility=friends. User B (not friend) queries leaderboard → A not visible. User C (friend) queries → A visible. |
| SC-5 | Visibility "friends_of_friends" works | User A sets visibility=fof. User D (friend of friend) queries → A visible. User E (no connection) → A not visible. |
| SC-6 | Discoverability off hides user | User sets is_discoverable=false → not visible to anyone except themselves |
| SC-7 | Seats auto-removal works | User has 1 seat, tag-along accepted → `available_seats` = 0 → user not in leaderboard results (filtered by partial index) |
| SC-8 | Tag-along creates friendship + collab | Accept tag-along between non-friends → `friends` row with status=accepted exists + `collaboration_sessions` row exists with both as participants |
| SC-9 | Tag-along skips friend step for existing friends | Accept tag-along between existing friends → no duplicate friend row, just collab created |
| SC-10 | Cooldown enforced | Decline a tag-along → sender tries again within 24h → HTTP 429 with `cooldown_active` |
| SC-11 | Interest expiry works | Create tag-along, wait 24h (or manually set expires_at to past) → request status = 'expired' (after cron runs) |
| SC-12 | Collab end restores presence | End a collab session → participant's `available_seats` restored, `active_collab_session_id` = NULL |
| SC-13 | Multi-seat joins existing session | User has 3 seats, accepts 2 tag-alongs → both join SAME collab session, not separate ones |
| SC-14 | Merged categories are union | User A has [drink, play], User B has [play, nature] → collab has [drink, play, nature] |
| SC-15 | Realtime broadcasts on swipe | User swipes → Realtime listener on another client receives UPDATE with `last_swiped_category` |
| SC-16 | Stale presence cleaned | Row with `last_swipe_at` > 24h ago → deleted after cron runs |
| SC-17 | Push notification on tag-along | Send tag-along → receiver gets push notification with sender's name and level |
| SC-18 | Push notification on accept | Accept tag-along → sender gets push with session info |
| SC-19 | 24h presence window | User who swiped 20h ago is visible. User who swiped 25h ago is not (filtered by client + cleaned by cron). |
| SC-20 | Existing collab session grows | User with active collab from tag-along accepts another → sender added to existing session, categories re-merged |

---

## 11. Implementation Order

1. **Migration 1:** `user_levels` table + `recalculate_user_level` RPC
2. **Migration 2:** `leaderboard_presence` table + indexes + Realtime + RLS + `are_friends_or_fof`
3. **Migration 3:** `tag_along_requests` table + indexes + Realtime + RLS
4. **Migration 4:** ALTER `user_map_settings` ADD `available_seats`, `is_discoverable`
5. **Migration 5:** Collab session end trigger
6. **Migration 6:** pg_cron cleanup schedules
7. **Edge function:** `upsert-leaderboard-presence`
8. **Edge function:** `send-tag-along`
9. **Edge function:** `accept-tag-along`
10. **Edge function:** `decline-tag-along`
11. **Mobile hook:** `useLeaderboardPresence` (Realtime subscription + data)
12. **Mobile hook:** `useTagAlongRequests` (send/accept/decline mutations)
13. **Mobile service:** `leaderboardService.ts` (edge function calls)
14. **Mobile components:** LeaderboardFeed, LeaderboardCard, etc. (per design spec)
15. **Mobile:** PreferencesSheet Section 7 additions
16. **Mobile:** Wire swipe action → `upsert-leaderboard-presence` call
