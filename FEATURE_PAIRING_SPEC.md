# Feature Spec: Pairing

## Summary

Pairing replaces the Saved People feature entirely. Instead of manually adding people and recording voice descriptions, users send **pair requests** to friends (or invite non-Mingla users). When accepted, both users share their full activity data — swipes, saves, schedules, visits — and each user's Discover hero section and upcoming holidays show cards personalized to the paired person's actual tastes. No AI transcription, no voice recording, no generated descriptions. Real behavior data drives real personalization.

## User Story

As a Mingla user, I want to pair with someone I care about, so that I can discover experiences tailored to their actual preferences — what they swipe on, save, schedule, and visit — without having to describe them manually.

## Success Criteria

1. **Tier 1 (Friend):** User can send a pair request directly to any Mingla friend → push + in-app notification → accept/decline
2. **Tier 2 (Mingla, not friend):** User searches by phone number → sends friend request + pair request simultaneously. Pair request is **invisible to the receiver until they accept the friend request.** Sender sees a **greyed-out pill** ("Waiting for friend request").
3. **Tier 3 (Not on Mingla):** User enters phone number → invite sent (SMS + copy link option). Person is stored. Friend request + pair request are queued. Sender sees a **greyed-out pill** ("Waiting for {name} to join"). When the person joins and accepts the friend request, the pair request becomes visible and they get a push + in-app notification to accept it.
4. On pair acceptance, both users see each other as tappable pills on Discover tab
5. Selecting a paired person's pill shows hero cards blending holiday categories with that person's learned preferences
6. Custom holidays can be created for paired people (same as current saved people flow)
7. Either party can unpair instantly; personalized data (custom holidays, impressions) is discarded
8. Tapping a greyed-out pill shows status info + "Cancel" button to withdraw the pair request
9. All existing Saved People code (audio recording, process-person-audio, generate-person-experiences, person_audio_clips table) is removed
10. Pairing data comes from the paired user's real profile (name, avatar, birthday, gender) — always current

---

## User Flows

### Flow 1: Tier 1 — Pair with a Friend (already on Mingla, already friends)

```
Discover tab → "For You" section → tap "Add+" pill
    → PairRequestModal opens
        → Section 1: Friend list (friends table, status=accepted)
        → User taps a friend → confirmation prompt
        → "Send Pair Request" button
        → pair_requests row created (status=pending, visibility='visible')
        → send-pair-request edge function fires
            → Push notification to receiver via OneSignal
            → In-app notification created
        → Modal closes
        → Sender sees ACTIVE pill (full opacity) with "Pending" badge
        → Toast: "Pair request sent to {name}"
```

### Flow 2: Tier 2 — Pair with a Mingla User (not yet friends)

```
PairRequestModal → Section 2: "Add someone on Mingla"
    → Phone number input (E.164)
    → send-pair-and-friend-request edge function fires
        → Resolves phone → finds Mingla user
        → Creates friend_requests row (status=pending)
        → Creates pair_requests row (status=pending, visibility='hidden_until_friend')
        → Push notification for FRIEND request only (not pair request yet)
    → Modal closes
    → Sender sees GREYED-OUT pill: "{name}" with dimmed opacity
        → Tap → info card: "Waiting for {name} to accept friend request" + [Cancel] button

    When receiver accepts FRIEND request:
        → Trigger: pair_requests.visibility updates to 'visible'
        → Push notification: "{name} wants to pair with you"
        → In-app notification for pair request appears
        → Sender's pill stays greyed but updates to: "Waiting for {name} to accept pairing"

    When receiver accepts PAIR request:
        → pairings row created
        → Both pills become full-color, tappable, functional
```

### Flow 3: Tier 3 — Pair with Someone Not on Mingla

```
PairRequestModal → Section 3: "Invite someone new"
    → Phone number input (E.164) + [Copy Invite Link] button
    → send-pair-invite edge function fires
        → Creates pending_pair_invites row (stores phone, inviter_id)
        → Sends SMS via Twilio: "{name} wants to pair with you on Mingla!"
    → Modal closes
    → Sender sees GREYED-OUT pill: phone number or custom name
        → Tap → info card: "Waiting for them to join Mingla" + [Cancel] button

    When invited person signs up + verifies phone:
        → Trigger: auto-creates friend_requests row (status=pending)
        → Trigger: auto-creates pair_requests row (status=pending, visibility='hidden_until_friend')
        → pending_pair_invites.status → 'converted'
        → Sender's pill updates to show the user's real name/avatar (still greyed)

    When new user accepts FRIEND request:
        → Trigger: pair_requests.visibility → 'visible'
        → Push notification: "{senderName} wants to pair with you"
        → Sender's pill updates status text

    When new user accepts PAIR request:
        → pairings row created
        → Both pills become full-color, tappable, functional
```

### Flow 4: Receive and Accept Pair Request

```
Push notification: "{name} wants to pair with you"
    (Only fires AFTER friend request is already accepted — never before)
    → Tap → opens app → NotificationsModal shows pair_request
    → Accept button → accept_pair_request_atomic RPC
        → Updates pair_requests.status = 'accepted'
        → Creates pairings row (bidirectional)
    → Both users' Discover tabs now show the other as a full-color pill
    → React Query cache invalidated → pills refresh
```

### Flow 5: View Paired Person's Experiences

```
Discover tab → tap paired person's pill (full-color, active)
    → selectedPairedUserId state updates
    → PersonHolidayView renders (same component, new data source)
        → BirthdayHero: cards using paired user's birthday + blended categories
        → CustomDayHero[]: cards for custom holidays
        → HolidayRow[]: standard holidays filtered by paired user's gender
    → Hero cards blend:
        1. Holiday → category mapping (HOLIDAY_CATEGORY_MAP) — base categories
        2. Paired user's top learned preferences (user_preference_learning) — weighted boost
        → Combined category list → get-person-hero-cards edge function
```

### Flow 6: Tap Greyed-Out Pill (Pending State)

```
Discover tab → tap greyed-out pill
    → Info card appears (bottom sheet or popover):
        → If Tier 2, waiting for friend accept:
            "Waiting for {name} to accept your friend request"
        → If Tier 2, friend accepted, waiting for pair accept:
            "Waiting for {name} to accept your pairing request"
        → If Tier 3, waiting for signup:
            "Waiting for them to join Mingla"
        → If Tier 3, signed up, waiting for friend accept:
            "Waiting for {name} to accept your friend request"
        → [Cancel Pair Request] button
            → Cancels pair_request + friend_request (if created by this flow)
            → Pill disappears
```

### Flow 7: Unpair

```
Long-press paired person's pill (active) → "Unpair" option
    → Confirmation alert: "Unpair from {name}? Custom holidays will be removed."
    → unpair mutation:
        → Deletes pairings row (CASCADE: custom_holidays, archived_holidays, person_card_impressions)
        → Updates pair_requests.status = 'unpaired'
    → Pill disappears, view returns to "For You"
```

---

## Database Changes

### New Table: `pair_requests`

```sql
-- Migration: YYYYMMDD000001_create_pair_requests.sql

CREATE TABLE pair_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'unpaired')),
    visibility TEXT NOT NULL DEFAULT 'visible'
        CHECK (visibility IN ('visible', 'hidden_until_friend')),
    -- Tracks which friend_request this pair request is gated behind (Tier 2 & 3)
    gated_by_friend_request_id UUID REFERENCES friend_requests(id) ON DELETE SET NULL,
    -- For Tier 3: store display info before receiver has a Mingla profile
    pending_display_name TEXT,         -- Name sender entered or phone number
    pending_phone_e164 TEXT,           -- Phone for Tier 3 (before user joins)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pair_requests_no_self_pair CHECK (sender_id != receiver_id),
    CONSTRAINT pair_requests_unique_pending UNIQUE (sender_id, receiver_id)
);

CREATE INDEX idx_pair_requests_receiver ON pair_requests(receiver_id) WHERE status = 'pending';
CREATE INDEX idx_pair_requests_sender ON pair_requests(sender_id);
CREATE INDEX idx_pair_requests_gated ON pair_requests(gated_by_friend_request_id)
    WHERE visibility = 'hidden_until_friend';

-- RLS
ALTER TABLE pair_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own pair requests"
    ON pair_requests FOR SELECT
    USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- Receiver can only see pair requests that are visible (not hidden behind friend request)
-- Sender can always see their own (including greyed-out pending ones)
CREATE POLICY "Users can create pair requests"
    ON pair_requests FOR INSERT
    WITH CHECK (auth.uid() = sender_id AND status = 'pending');

CREATE POLICY "Sender can cancel their pair requests"
    ON pair_requests FOR UPDATE
    USING (auth.uid() = sender_id)
    WITH CHECK (status IN ('cancelled'));

CREATE POLICY "Receiver can accept or decline visible pair requests"
    ON pair_requests FOR UPDATE
    USING (auth.uid() = receiver_id AND visibility = 'visible')
    WITH CHECK (status IN ('accepted', 'declined'));

-- Updated_at trigger
CREATE TRIGGER pair_requests_updated_at
    BEFORE UPDATE ON pair_requests
    FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ============================================================
-- TRIGGER: When a friend request is accepted, reveal any hidden pair requests
-- This is the core mechanism for Tier 2 & 3 chaining.
-- ============================================================
CREATE OR REPLACE FUNCTION reveal_pair_requests_on_friend_accept()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
        -- Reveal all pair requests that were gated behind this friend request
        UPDATE pair_requests
        SET visibility = 'visible', updated_at = now()
        WHERE gated_by_friend_request_id = NEW.id
          AND visibility = 'hidden_until_friend'
          AND status = 'pending';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_friend_accept_reveal_pair_requests
    AFTER UPDATE OF status ON friend_requests
    FOR EACH ROW EXECUTE FUNCTION reveal_pair_requests_on_friend_accept();

-- ============================================================
-- TRIGGER: After pair request becomes visible, send push notification
-- (Handled by edge function invocation — see notify-pair-request-visible)
-- ============================================================
```

### New Table: `pairings`

```sql
-- In same migration

CREATE TABLE pairings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    user_b_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    pair_request_id UUID NOT NULL REFERENCES pair_requests(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pairings_no_self CHECK (user_a_id != user_b_id),
    CONSTRAINT pairings_unique UNIQUE (user_a_id, user_b_id),
    CONSTRAINT pairings_ordered CHECK (user_a_id < user_b_id)
);

-- Indexes for looking up "who am I paired with"
CREATE INDEX idx_pairings_user_a ON pairings(user_a_id);
CREATE INDEX idx_pairings_user_b ON pairings(user_b_id);

-- RLS
ALTER TABLE pairings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own pairings"
    ON pairings FOR SELECT
    USING (auth.uid() = user_a_id OR auth.uid() = user_b_id);

CREATE POLICY "Users can delete their own pairings (unpair)"
    ON pairings FOR DELETE
    USING (auth.uid() = user_a_id OR auth.uid() = user_b_id);
```

**Note on `pairings_ordered` constraint:** `user_a_id < user_b_id` ensures a canonical ordering — prevents duplicate pairings where (A,B) and (B,A) both exist. The `accept_pair_request_atomic` RPC handles ordering at insert time.

### New Table: `pending_pair_invites`

```sql
-- Migration: YYYYMMDD000002_create_pending_pair_invites.sql

CREATE TABLE pending_pair_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inviter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    phone_e164 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'converted', 'cancelled')),
    converted_user_id UUID REFERENCES auth.users(id),
    converted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pending_pair_invites_unique UNIQUE (inviter_id, phone_e164)
);

ALTER TABLE pending_pair_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own pending pair invites"
    ON pending_pair_invites FOR SELECT
    USING (auth.uid() = inviter_id);

CREATE POLICY "Users can create pending pair invites"
    ON pending_pair_invites FOR INSERT
    WITH CHECK (auth.uid() = inviter_id AND status = 'pending');

-- Auto-conversion trigger: when a user verifies their phone, convert matching
-- pending_pair_invites into BOTH a friend_request AND a pair_request (hidden until friend accepted).
-- This mirrors the Tier 2 flow but triggered automatically on signup.
CREATE OR REPLACE FUNCTION convert_pending_pair_invites_on_phone_verified()
RETURNS TRIGGER AS $$
DECLARE
    v_invite RECORD;
    v_friend_request_id UUID;
BEGIN
    -- When a user sets/updates their phone number
    IF NEW.phone IS NOT NULL AND (OLD.phone IS NULL OR OLD.phone != NEW.phone) THEN
        FOR v_invite IN
            SELECT * FROM pending_pair_invites
            WHERE phone_e164 = NEW.phone AND status = 'pending'
        LOOP
            -- Step 1: Create friend request (if not already friends)
            INSERT INTO friend_requests (sender_id, receiver_id, status)
            VALUES (v_invite.inviter_id, NEW.id, 'pending')
            ON CONFLICT DO NOTHING
            RETURNING id INTO v_friend_request_id;

            -- If friend request already existed, look it up
            IF v_friend_request_id IS NULL THEN
                SELECT id INTO v_friend_request_id
                FROM friend_requests
                WHERE sender_id = v_invite.inviter_id AND receiver_id = NEW.id;
            END IF;

            -- Step 2: Create pair request, hidden until friend request is accepted
            INSERT INTO pair_requests (
                sender_id, receiver_id, status, visibility,
                gated_by_friend_request_id, pending_display_name, pending_phone_e164
            )
            VALUES (
                v_invite.inviter_id, NEW.id, 'pending', 'hidden_until_friend',
                v_friend_request_id, NULL, v_invite.phone_e164
            )
            ON CONFLICT (sender_id, receiver_id) DO NOTHING;

            -- Step 3: Mark invite as converted
            UPDATE pending_pair_invites
            SET status = 'converted', converted_user_id = NEW.id, converted_at = now()
            WHERE id = v_invite.id;
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_phone_verified_convert_pair_invites
    AFTER UPDATE OF phone ON profiles
    FOR EACH ROW EXECUTE FUNCTION convert_pending_pair_invites_on_phone_verified();
```

### Modify: `custom_holidays`

```sql
-- Migration: YYYYMMDD000003_custom_holidays_add_pairing.sql

-- Add pairing columns
ALTER TABLE custom_holidays ADD COLUMN pairing_id UUID REFERENCES pairings(id) ON DELETE CASCADE;
ALTER TABLE custom_holidays ADD COLUMN paired_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Migrate existing data: for each custom_holiday linked to a saved_person that has linked_user_id,
-- create a corresponding pairing if one exists, then update the custom_holiday.
-- This is a data migration — handle in the migration script.

-- Eventually: DROP the person_id column after full migration
-- ALTER TABLE custom_holidays DROP COLUMN person_id;
-- (Do this in a later migration after confirming no code references person_id)
```

### Modify: `person_card_impressions`

```sql
-- In same migration or separate

ALTER TABLE person_card_impressions ADD COLUMN paired_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Eventually drop person_id column after migration
```

### Modify: `archived_holidays`

```sql
ALTER TABLE archived_holidays ADD COLUMN pairing_id UUID REFERENCES pairings(id) ON DELETE CASCADE;
ALTER TABLE archived_holidays ADD COLUMN paired_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
```

### Atomic Accept RPC

```sql
-- Migration: YYYYMMDD000004_accept_pair_request_atomic.sql

CREATE OR REPLACE FUNCTION accept_pair_request_atomic(p_request_id UUID)
RETURNS JSON AS $$
DECLARE
    v_request pair_requests%ROWTYPE;
    v_pairing_id UUID;
    v_user_a UUID;
    v_user_b UUID;
BEGIN
    -- Lock the request row
    SELECT * INTO v_request
    FROM pair_requests
    WHERE id = p_request_id AND receiver_id = auth.uid()
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pair request not found or not authorized';
    END IF;

    IF v_request.status != 'pending' THEN
        RAISE EXCEPTION 'Pair request is no longer pending (status: %)', v_request.status;
    END IF;

    -- Update request status
    UPDATE pair_requests SET status = 'accepted', updated_at = now()
    WHERE id = p_request_id;

    -- Canonical ordering for pairings table
    IF v_request.sender_id < v_request.receiver_id THEN
        v_user_a := v_request.sender_id;
        v_user_b := v_request.receiver_id;
    ELSE
        v_user_a := v_request.receiver_id;
        v_user_b := v_request.sender_id;
    END IF;

    -- Create pairing (ignore if already exists — idempotent)
    INSERT INTO pairings (user_a_id, user_b_id, pair_request_id)
    VALUES (v_user_a, v_user_b, v_request.id)
    ON CONFLICT (user_a_id, user_b_id) DO NOTHING
    RETURNING id INTO v_pairing_id;

    RETURN json_build_object(
        'pairing_id', v_pairing_id,
        'paired_with_user_id', v_request.sender_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Cleanup Migration (Separate, Later)

```sql
-- Migration: YYYYMMDD000005_drop_saved_people_audio.sql

-- Drop tables that are no longer needed
DROP TABLE IF EXISTS person_audio_clips CASCADE;
DROP TABLE IF EXISTS person_experiences CASCADE;

-- Drop saved_people AFTER confirming all custom_holidays have been migrated
-- DROP TABLE IF EXISTS saved_people CASCADE;

-- Drop unused columns from custom_holidays
-- ALTER TABLE custom_holidays DROP COLUMN IF EXISTS person_id;
-- ALTER TABLE person_card_impressions DROP COLUMN IF EXISTS person_id;
-- ALTER TABLE archived_holidays DROP COLUMN IF EXISTS person_id;
```

### RLS for Paired User Data Access

```sql
-- Migration: YYYYMMDD000006_pairing_data_access_policies.sql

-- Allow paired users to read each other's learned preferences
CREATE POLICY "Paired users can read partner preferences"
    ON user_preference_learning FOR SELECT
    USING (
        auth.uid() = user_id
        OR EXISTS (
            SELECT 1 FROM pairings
            WHERE (user_a_id = auth.uid() AND user_b_id = user_preference_learning.user_id)
               OR (user_b_id = auth.uid() AND user_a_id = user_preference_learning.user_id)
        )
    );
```

---

## Edge Functions

### New: `send-pair-request`

**Method:** POST
**Route:** `/send-pair-request`

Handles **all 3 tiers** in a single edge function. The `tier` is auto-detected from the input.

**Request:**
```typescript
interface SendPairRequestBody {
    // Exactly one of these must be provided:
    friendUserId?: string;   // Tier 1: UUID of existing friend
    phoneE164?: string;      // Tier 2 or 3: phone number to look up or invite
}
```

**Response:**
```typescript
interface SendPairRequestResponse {
    success: boolean;
    tier: 1 | 2 | 3;
    requestId?: string;       // pair_request ID (Tier 1 & 2)
    inviteId?: string;        // pending_pair_invites ID (Tier 3)
    message: string;
    pillState: 'pending_active' | 'greyed_waiting_friend' | 'greyed_waiting_signup';
}
```

**Logic:**

```
1. Auth: verify JWT, get sender profile (name, phone)
2. If friendUserId provided:
   → TIER 1: Direct pair request to friend
   a. Verify they are friends (query friends table)
   b. Check no existing pending/active pair_request
   c. INSERT pair_requests (status='pending', visibility='visible')
   d. Send push notification: "{name} wants to pair with you"
   e. Create in-app notification
   f. Return { tier: 1, requestId, pillState: 'pending_active' }

3. If phoneE164 provided:
   a. Validate E.164 format
   b. Check not sender's own phone
   c. Look up phone in profiles table:

   → If phone found (Mingla user exists):
     → TIER 2: Pair with Mingla user, not yet friends
     i.   Check if already friends → redirect to Tier 1 logic
     ii.  Check if friend_request already exists → reuse it
     iii. Otherwise: INSERT friend_requests (status='pending')
     iv.  INSERT pair_requests (status='pending', visibility='hidden_until_friend',
              gated_by_friend_request_id=<friend_request.id>)
     v.   Send push for FRIEND request only (NOT pair request)
     vi.  Return { tier: 2, requestId, pillState: 'greyed_waiting_friend' }

   → If phone NOT found (not on Mingla):
     → TIER 3: Invite non-Mingla user
     i.   Rate limit: max 10 pair invites per 24h
     ii.  UPSERT pending_pair_invites (inviter_id, phone_e164, status='pending')
     iii. Send SMS via Twilio: "{name} wants to pair with you on Mingla!"
     iv.  Return { tier: 3, inviteId, pillState: 'greyed_waiting_signup' }
```

**Errors:**
- 400: `"Cannot pair with yourself"`
- 400: `"Already have a pending pair request with this user"`
- 400: `"Already paired with this user"`
- 400: `"Must provide either friendUserId or phoneE164"`
- 403: `"User is not your friend"` (only for Tier 1 with friendUserId)
- 429: `"Too many pair invites. Try again tomorrow."` (Tier 3 rate limit)

### New: `notify-pair-request-visible`

**Method:** Called internally (via DB webhook or Supabase realtime trigger on pair_requests visibility change)

**Purpose:** When `reveal_pair_requests_on_friend_accept` trigger flips visibility from `hidden_until_friend` → `visible`, this function sends the push + in-app notification for the now-visible pair request.

**Logic:**
1. Receive pair_request ID where visibility just changed to 'visible'
2. Look up sender profile (name, avatar)
3. Send push to receiver: `"{senderName} wants to pair with you"`
4. Create in-app notification for receiver

### Modify: `get-person-hero-cards`

**Change:** Accept `paired_user_id` (in addition to or replacing `person_id`). When `paired_user_id` is provided:

1. Fetch paired user's top learned preferences from `user_preference_learning`:
   ```sql
   SELECT preference_key, preference_value
   FROM user_preference_learning
   WHERE user_id = paired_user_id
     AND preference_type = 'category'
     AND preference_value > 0
   ORDER BY preference_value DESC
   LIMIT 10;
   ```
2. Blend with incoming `categorySlugs` (from holiday mapping):
   - Start with holiday categories as base set
   - Add top 3 learned preference categories (if not already in set)
   - Weight the query: learned preference categories get priority in card selection
3. Rest of the flow (RPC query, gap-fill, dedup, impressions) stays the same
4. Use `paired_user_id` instead of `person_id` for impression tracking

**Updated request type:**
```typescript
interface GetPersonHeroCardsRequest {
    personId?: string;        // DEPRECATED — saved_people.id
    pairedUserId?: string;    // NEW — auth.users.id of paired user
    holidayKey: string;
    categorySlugs: string[];
    curatedExperienceType: string | null;
    location: { latitude: number; longitude: number };
}
```

### Remove: `process-person-audio`

Delete entirely. No longer needed — pairing uses real user data instead of voice transcription.

### Remove: `generate-person-experiences`

Delete entirely. Experiences are now driven by learned preferences + hero card pipeline, not AI-generated from descriptions.

---

## Mobile Implementation

### Services

#### New: `pairingService.ts`

**File:** `app-mobile/src/services/pairingService.ts`

```typescript
// Fetch all pairings + pending pair requests for the current user (for pill rendering)
export async function fetchPairingPills(userId: string): Promise<PairingPill[]>
// Returns BOTH active pairings AND outgoing pending requests (for greyed pills)
// Query:
//   1. Active pairings: JOIN pairings + profiles → pillState: 'active'
//   2. Outgoing pending pair_requests: JOIN profiles (if receiver exists) → pillState varies
//   3. Outgoing pending_pair_invites (Tier 3, not yet converted) → pillState: 'greyed_waiting_signup'
// Sorted: active pairings first, then pending (by createdAt desc)

// Fetch pending pair requests (incoming, visible only — for notifications)
export async function fetchIncomingPairRequests(userId: string): Promise<PairRequest[]>

// Send pair request (calls send-pair-request edge function — handles all 3 tiers)
export async function sendPairRequest(params: {
    friendUserId?: string;   // Tier 1
    phoneE164?: string;      // Tier 2 or 3
}): Promise<SendPairRequestResponse>

// Accept pair request (calls accept_pair_request_atomic RPC)
export async function acceptPairRequest(requestId: string): Promise<{ pairingId: string }>

// Decline pair request
export async function declinePairRequest(requestId: string): Promise<void>

// Cancel outgoing pair request (+ associated friend request if Tier 2/3)
export async function cancelPairRequest(requestId: string): Promise<void>

// Cancel pending invite (Tier 3, before conversion)
export async function cancelPairInvite(inviteId: string): Promise<void>

// Unpair (delete pairings row)
export async function unpair(pairingId: string): Promise<void>
```

**Types:**
```typescript
// Represents a pill in the Discover tab — either active pairing or pending request
export interface PairingPill {
    // Identity
    id: string;                      // pairingId, pair_request.id, or pending_pair_invite.id
    type: 'active' | 'pending_request' | 'pending_invite';

    // Display
    displayName: string;             // Profile name, or phone number (Tier 3 before signup)
    firstName: string | null;        // From profile (null for Tier 3 pre-signup)
    avatarUrl: string | null;        // From profile (null for Tier 3 pre-signup)
    initials: string;                // Computed from name or phone

    // State — drives pill appearance
    pillState:
        | 'active'                   // Full color, tappable → shows PersonHolidayView
        | 'pending_active'           // Full opacity, "Pending" badge (Tier 1: friend, awaiting pair accept)
        | 'greyed_waiting_friend'    // Dimmed (Tier 2: waiting for friend request acceptance)
        | 'greyed_waiting_pair'      // Dimmed (Tier 2: friend accepted, waiting for pair accept)
        | 'greyed_waiting_signup';   // Dimmed (Tier 3: waiting for person to join Mingla)

    // Status message for info card on tap (greyed pills only)
    statusMessage: string | null;

    // For active pairings
    pairedUserId: string | null;
    birthday: string | null;         // ISO date
    gender: string | null;
    pairingId: string | null;

    // For cancellation
    pairRequestId: string | null;
    pendingInviteId: string | null;

    createdAt: string;
}

export interface PairRequest {
    id: string;
    senderId: string;
    receiverId: string;
    senderName: string;
    senderAvatar: string | null;
    receiverName: string;
    receiverAvatar: string | null;
    status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'unpaired';
    visibility: 'visible' | 'hidden_until_friend';
    createdAt: string;
}

export interface SendPairRequestResponse {
    success: boolean;
    tier: 1 | 2 | 3;
    requestId?: string;
    inviteId?: string;
    message: string;
    pillState: 'pending_active' | 'greyed_waiting_friend' | 'greyed_waiting_signup';
}
```

#### Modify: `personHeroCardsService.ts`

**Change:** `fetchPersonHeroCards` to accept `pairedUserId` parameter instead of (or alongside) `personId`.

```typescript
export async function fetchPersonHeroCards({
    pairedUserId,    // NEW: replaces personId
    holidayKey,
    categorySlugs,
    curatedExperienceType,
    location,
}: {
    pairedUserId: string;
    holidayKey: string;
    categorySlugs: string[];
    curatedExperienceType: string | null;
    location: { latitude: number; longitude: number };
})
```

#### Remove: `personAudioService.ts`

Delete entirely.

#### Remove: `personAudioProcessingService.ts`

Delete entirely.

#### Modify: `savedPeopleService.ts` → Rename or refactor

Either rename to `pairingService.ts` (if no overlap) or extract pairing logic into the new service file. Remove all functions related to saved_people CRUD (createSavedPerson, updateSavedPerson, deleteSavedPerson, etc.).

#### Modify: `customHolidayService.ts`

Update to reference `pairing_id` and `paired_user_id` instead of `person_id`:

```typescript
export async function getCustomHolidays(userId: string, pairingId: string): Promise<CustomHoliday[]>
export async function createCustomHoliday(data: {
    user_id: string;
    pairing_id: string;
    paired_user_id: string;
    name: string;
    month: number;
    day: number;
    year?: number;
    description?: string;
    categories?: string[];
}): Promise<CustomHoliday>
```

### Hooks

#### New: `usePairings.ts`

**File:** `app-mobile/src/hooks/usePairings.ts`

```typescript
// Query keys
export const pairingKeys = {
    all: (userId: string) => ['pairings', userId] as const,
    pills: (userId: string) => ['pairings', 'pills', userId] as const,
    incomingRequests: (userId: string) => ['pairings', 'incoming', userId] as const,
};

// Queries
export function usePairingPills(userId: string)
// staleTime: 2 minutes (needs to reflect state changes: greyed → active)
// Returns: PairingPill[] (active pairings + outgoing pending requests + pending invites)

export function useIncomingPairRequests(userId: string)
// staleTime: 1 minute (check frequently)
// Returns: PairRequest[] (only visible ones — hidden_until_friend excluded)

// Mutations
export function useSendPairRequest()
// Calls send-pair-request edge function (handles all 3 tiers)
// onSuccess: invalidate pairingKeys.pills, show toast based on response.tier

export function useAcceptPairRequest()
// onSuccess: invalidate pairingKeys.all (pills + incoming)

export function useDeclinePairRequest()
// onSuccess: invalidate pairingKeys.incomingRequests

export function useCancelPairRequest()
// Cancels pair_request + associated friend_request if Tier 2/3
// onSuccess: invalidate pairingKeys.pills

export function useCancelPairInvite()
// Cancels pending_pair_invites row (Tier 3, before conversion)
// onSuccess: invalidate pairingKeys.pills

export function useUnpair()
// onSuccess: invalidate pairingKeys.pills, customHolidayKeys
```

#### Modify: `usePersonHeroCards.ts`

Update to accept `pairedUserId` instead of `personId`:

```typescript
export const personHeroCardKeys = {
    forPairedUserHoliday: (pairedUserId: string, holidayKey: string) =>
        ['personHeroCards', pairedUserId, holidayKey] as const,
};
```

#### Remove: `useSavedPeople.ts`

Replace with `usePairings.ts`. Remove all saved people queries and mutations.

#### New: Realtime subscription for pair requests

**Add to `useSocialRealtime.ts`:**

```typescript
// Subscribe to pair_requests changes for receiver_id = userId
// On INSERT (new request): invalidate pairingKeys.incomingRequests, show in-app notification
// On UPDATE (status change): invalidate pairingKeys.all
```

### Components

#### New: `PairRequestModal.tsx`

**File:** `app-mobile/src/components/PairRequestModal.tsx`

**Props:**
```typescript
interface PairRequestModalProps {
    visible: boolean;
    onClose: () => void;
    onPairRequestSent: (pill: PairingPill) => void;
}
```

**States:**
1. **Main view** (default): Three sections stacked vertically in a scrollable sheet.
2. **Sending**: Loading spinner on the tapped action button.
3. **Success**: Toast + modal closes.
4. **Error**: Inline error message (e.g., "Already paired with this person").
5. **Empty friends section**: No friends yet — section still shown but with "No friends yet" message. Phone input sections still functional.

**Layout:**
```
┌──────────────────────────────────┐
│  Pair with someone          [✕]  │
│──────────────────────────────────│
│                                  │
│  SECTION 1: Your Friends         │
│  (Tier 1 — direct pair request)  │
│  ┌────────────────────────────┐  │
│  │ 🟣 Sarah       [Pair →]   │  │
│  │ 🔵 Mike        [Paired ✓] │  │
│  │ 🟢 Alex        [Pair →]   │  │
│  │ 🟡 Jordan      [Pending]  │  │
│  └────────────────────────────┘  │
│                                  │
│  SECTION 2: Someone on Mingla    │
│  (Tier 2 — friend req + pair)    │
│  ┌────────────────────────────┐  │
│  │ 📱 Enter phone number      │  │
│  │    +1 (___) ___-____       │  │
│  │        [Pair & Add Friend] │  │
│  └────────────────────────────┘  │
│                                  │
│  SECTION 3: Invite to Mingla     │
│  (Tier 3 — invite + pair)        │
│  ┌────────────────────────────┐  │
│  │ 📱 Enter phone number      │  │
│  │    +1 (___) ___-____       │  │
│  │        [Invite & Pair]     │  │
│  │    ─── or ───              │  │
│  │    🔗 [Copy Invite Link]   │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

**UX note on Tier 2 vs 3 phone input:** Both sections use a phone input, but the edge function auto-detects whether the phone belongs to a Mingla user (→ Tier 2) or not (→ Tier 3). So in practice, **a single phone input field** could handle both — the edge function returns the tier in its response, and the modal shows the appropriate toast. Implementation choice: either one combined phone input below the friend list, or two separate sections. The single input is simpler; the two-section layout is clearer. **Recommend: single phone input section below friend list, labeled "Pair by phone number".** The edge function handles the rest.

#### Modify: `DiscoverScreen.tsx`

**Changes to the TabHeaderRow / person pills section:**

1. **Data source:** Replace `useSavedPeople()` with `usePairingPills()` (fetches from `fetchPairingPills`).
2. **Pill rendering — 3 visual states:**
   - **Active** (`pillState: 'active'`): Full opacity. Avatar + first name. Tappable → shows PersonHolidayView.
   - **Pending active** (`pillState: 'pending_active'`): Full opacity + small "Pending" badge. Tappable → shows info card (Tier 1 awaiting accept).
   - **Greyed out** (`pillState: 'greyed_*'`): 40% opacity, no interaction with PersonHolidayView. Tappable → shows info card with status message + Cancel button.
3. **"Add+" pill:** Opens `PairRequestModal` instead of `AddPersonModal`.
4. **Long-press menu:**
   - Active pills: "Unpair" + "Custom Holidays"
   - Greyed/pending pills: "Cancel Pair Request"
5. **Selection state:** `selectedPairedUserId` replaces `selectedPersonId`. Only active pills can be "selected" to show PersonHolidayView. Tapping greyed pills shows the info card overlay instead.

**Pill rendering logic:**
```typescript
const pillOpacity = pill.pillState.startsWith('greyed') ? 0.4 : 1.0;
const showPendingBadge = pill.pillState === 'pending_active';
const isTappableForHolidays = pill.pillState === 'active';
const isTappableForInfoCard = pill.pillState !== 'active';
```

**Changes to PersonHolidayView invocation:**

```typescript
// Before:
<PersonHolidayView person={selectedPerson} ... />

// After (only rendered for active pairings):
{selectedPill?.pillState === 'active' && (
    <PersonHolidayView
        pairedUserId={selectedPill.pairedUserId!}
        pairingId={selectedPill.pairingId!}
        birthday={selectedPill.birthday}
        gender={selectedPill.gender}
        displayName={selectedPill.displayName}
        ...
    />
)}
```

#### New: `PairingInfoCard.tsx`

**File:** `app-mobile/src/components/PairingInfoCard.tsx`

Small bottom sheet or popover shown when tapping a greyed-out or pending pill.

**Props:**
```typescript
interface PairingInfoCardProps {
    pill: PairingPill;
    onCancel: () => void;
    onClose: () => void;
}
```

**Renders:**
```
┌──────────────────────────┐
│  {avatar}  {displayName} │
│                          │
│  {statusMessage}         │
│  e.g. "Waiting for Sarah │
│  to accept your friend   │
│  request"                │
│                          │
│  [Cancel Pair Request]   │
└──────────────────────────┘
```

#### Modify: `PersonHolidayView.tsx`

**Changes:**
1. Accept `pairedUser: PairedUser` prop instead of `person: SavedPerson`.
2. Birthday comes from `pairedUser.birthday` (profiles table) instead of `person.birthday`.
3. Gender filtering uses `pairedUser.gender` (profiles table).
4. Hero card fetching passes `pairedUserId` instead of `personId`.
5. Remove "Generate more suggestions" button (no description-based generation).
6. Custom holidays reference `pairingId` and `pairedUserId`.

#### Modify: `NotificationsModal.tsx`

**Add new notification type:** `"pair_request"`

```typescript
case 'pair_request':
    return (
        // Avatar + "{name} wants to pair with you"
        // Accept button (green gradient) → acceptPairRequest(requestId)
        // Decline button (gray X) → declinePairRequest(requestId)
    );
```

Pattern: identical to existing `friend_request` notification handling.

#### Remove: `AddPersonModal.tsx`

Delete entirely. Replaced by `PairRequestModal.tsx`.

#### Modify: `PersonEditSheet.tsx`

Simplify to only show "Unpair" and "Custom Holidays" options (no name/birthday/gender editing — that's the paired user's profile data).

---

## Implementation Order

1. **Database migrations** (pair_requests, pairings, pending_pair_invites, RLS policies, atomic RPC)
2. **Edge functions** (send-pair-request, send-pair-invite)
3. **Modify get-person-hero-cards** (accept pairedUserId, blend learned preferences)
4. **Mobile service layer** (pairingService.ts, modify personHeroCardsService.ts, customHolidayService.ts)
5. **Mobile hooks** (usePairings.ts, modify usePersonHeroCards.ts, add realtime subscription)
6. **Mobile components** (PairRequestModal.tsx, modify DiscoverScreen.tsx, PersonHolidayView.tsx, NotificationsModal.tsx)
7. **Cleanup** (remove AddPersonModal, personAudioService, personAudioProcessingService, useSavedPeople)
8. **Cleanup migrations** (drop person_audio_clips, person_experiences, eventually saved_people)
9. **Remove edge functions** (process-person-audio, generate-person-experiences)

---

## Test Cases

| # | Scenario | Input | Expected Result | Layer |
|---|----------|-------|-----------------|-------|
| 1 | Tier 1: Pair with friend | Tap friend → "Pair" | pair_requests (visible, pending), push sent, pill shows "Pending" badge | Service + Edge |
| 2 | Tier 2: Pair with Mingla non-friend | Enter phone of Mingla user | friend_request + pair_request (hidden_until_friend) created. Greyed pill. Push for friend request only. | Edge + DB |
| 3 | Tier 2: Friend accepts → pair request revealed | Receiver accepts friend request | Trigger flips visibility → 'visible'. Push for pair request fires. Pill updates to "Waiting for pair accept". | DB trigger |
| 4 | Tier 2: Friend accepts → then pair accepts | Full Tier 2 chain | Pairing created. Both pills become active. | Full stack |
| 5 | Tier 3: Invite non-Mingla user | Enter unknown phone | pending_pair_invites created, SMS sent, greyed pill "Waiting to join" | Edge + DB |
| 6 | Tier 3: Invited user signs up | User verifies phone | Auto: friend_request + pair_request (hidden) created. Pill updates to show real name. | DB trigger |
| 7 | Tier 3: Full chain | Invite → signup → friend accept → pair accept | Pairing active. Both see colored pills. | Full stack |
| 8 | Tap greyed pill | Tap dimmed pill | Info card with status message + Cancel button | Component |
| 9 | Cancel from greyed pill | Tap Cancel on info card | pair_request + friend_request cancelled. Pill disappears. | Service + DB |
| 10 | Send pair request to self | sender_id = receiver_id | 400 "Cannot pair with yourself" | DB constraint |
| 11 | Duplicate pair request | Send to same user twice | 400 "Already pending" | DB unique constraint |
| 12 | Accept pair request | Receiver taps Accept | pairings row created, both see active pills | RPC + Hook |
| 13 | Accept already-accepted | Double-tap Accept | Exception "no longer pending" | RPC |
| 14 | Decline pair request | Receiver taps Decline | Status → declined, no pairing created | Service |
| 15 | Unpair | Long-press → Unpair | pairings deleted (CASCADE), pill disappears | Service + DB |
| 16 | Hero cards for paired person | Select active pill | Cards blend holiday categories + learned preferences | Edge + Component |
| 17 | Paired person has no preferences | New user, 0 swipes | Falls back to holiday categories only | Edge |
| 18 | Profile data freshness | Partner changes name | Pill shows updated name on next fetch | Hook + Service |
| 19 | Gender-filtered holidays | Pair with gender="woman" | Father's Day hidden, Mother's Day shown | Component |
| 20 | Receiver only sees visible requests | Receiver checks notifications | Hidden pair requests (behind friend request) don't appear in notifications | RLS + Service |

---

## Common Mistakes

1. **Pairing ordering:** The `pairings` table uses `user_a_id < user_b_id` constraint. All insert logic must sort the two UUIDs before inserting. Forgetting this causes duplicate pairing attempts or constraint violations.

2. **Visibility gate is the core mechanism:** The entire Tier 2/3 flow depends on `pair_requests.visibility` being `'hidden_until_friend'` and the `reveal_pair_requests_on_friend_accept` trigger flipping it. If this trigger fails silently, pair requests stay permanently hidden and the user never gets the notification. **Test this trigger in isolation.**

3. **Receiver must never see hidden pair requests:** The RLS policy and notification queries must filter by `visibility = 'visible'`. If a hidden pair request leaks to the receiver, they'll see a pair request from a stranger (before the friend request is even accepted). Double-check that `fetchIncomingPairRequests` filters on visibility.

4. **Push notification timing — two-phase for Tier 2/3:** When the edge function creates both friend_request and pair_request, it must only send a push for the **friend request**. The pair request push fires later, via `notify-pair-request-visible`, when the friend request is accepted. Sending both pushes at once would confuse the receiver.

5. **Cancel must cascade correctly:** When sender cancels a Tier 2 pair request, the associated friend request (if created by the pairing flow) should also be cancelled. But if the user sent a friend request independently before the pair request, cancelling the pair should NOT cancel the friend request. Use `gated_by_friend_request_id` to determine ownership.

6. **RLS for cross-user data:** Paired users need to read each other's `user_preference_learning` rows. Without the new RLS policy, the hero card personalization silently returns empty preferences — cards would work but wouldn't be personalized.

7. **Cache invalidation across users:** When User B accepts User A's friend request (revealing the pair request), User A's pill state must update from `greyed_waiting_friend` → `greyed_waiting_pair`. This requires realtime subscription on `pair_requests` changes, not just local cache invalidation.

8. **Profile data freshness:** Pills show real profile data. If a paired user changes their avatar or name, the pill should update. Using React Query with appropriate staleTime (2 min) handles this, but don't cache profile data separately — always JOIN to profiles.

9. **Phone number sanitization:** The auto-conversion trigger matches on exact `phone_e164`. Any format mismatch means invites never convert. Validate E.164 both client-side and server-side.

10. **Learned preferences cold start:** A user with < 10 interactions has sparse preference data. The hero card blending logic must gracefully handle empty/sparse preference arrays — fall back to holiday categories only.

11. **Greyed pill must show real profile data after conversion:** When a Tier 3 invited user signs up, the greyed pill should update from showing a phone number to showing their real name and avatar. The `fetchPairingPills` query must handle this transition (JOIN to profiles when `receiver_id` is populated).

---

## Regression Prevention

### Structural Safeguards
- `pairings_ordered` CHECK constraint prevents duplicate (A,B)/(B,A) pairings
- `pair_requests_no_self_pair` CHECK prevents self-pairing
- `pair_requests_unique_pending` UNIQUE prevents duplicate requests
- CASCADE deletes on pairings → custom_holidays/archived_holidays/impressions ensures clean unpair
- Atomic RPC with `FOR UPDATE` lock prevents race conditions on accept

### Validation Safeguards
- Edge function validates friendship before allowing pair request
- Phone format validated with E.164 regex at edge function boundary
- RPC validates request status is 'pending' before accepting

### Cache Safety
- Pairing list query key includes userId: `['pairings', 'list', userId]`
- Hero card query key includes pairedUserId + holidayKey: unique per paired person per holiday
- Realtime subscription on `pair_requests` ensures incoming requests appear immediately
- Accept/decline mutations invalidate both parties' caches

### Defensive Coding
- `ON CONFLICT DO NOTHING` on pairing insert (idempotent acceptance)
- Learned preferences query uses `preference_value > 0` filter (ignores negative/neutral)
- Profile JOIN in pairing query ensures stale profile data isn't cached separately

### Monitoring
- Edge functions log pair request creation/acceptance/decline
- Push notification failures logged but don't block the pairing flow
- Empty learned preferences logged as warning (helps debug cold-start issues)

### Regression Tests

| Test | Input | Expected Result |
|------|-------|-----------------|
| Concurrent accept attempts | Two simultaneous accept calls for same request | One succeeds, other gets "no longer pending" error |
| Unpair + re-pair | Unpair then send new request | New pair_request created (old is status='unpaired') |
| Phone invite auto-conversion | User signs up with invited phone | pair_request auto-created with status='pending' |
| Hero cards with empty preferences | Paired user has 0 interactions | Cards returned using holiday categories only, no error |
| Profile update reflection | Paired user changes display_name | Next pairing list fetch shows updated name |

---

## Handoff to Implementor

**What to build:** A 3-tier "Pairing" system that replaces Saved People. Tier 1 (friends) sends a direct pair request. Tier 2 (Mingla non-friends) sends a friend request + hidden pair request — pair request reveals when friendship is accepted. Tier 3 (non-Mingla) invites via phone/link, auto-creates friend + pair requests on signup. All pending pairings show as greyed-out pills with status info + cancel. Accepted pairings show as active pills driving personalized hero cards and holidays.

**Build order:** Database first (pair_requests with visibility column, pairings, pending_pair_invites, friend-accept trigger, atomic RPC) → edge function (single send-pair-request handling all 3 tiers, notify-pair-request-visible) → modify get-person-hero-cards → mobile services (pairingService with fetchPairingPills) → hooks (usePairingPills, useSendPairRequest) → components (PairRequestModal, PairingInfoCard, modify DiscoverScreen pill rendering + PersonHolidayView) → cleanup old code.

**Watch out for:** The `reveal_pair_requests_on_friend_accept` trigger is the linchpin — if it fails, Tier 2/3 pairings stay permanently invisible. The push notification must fire in two phases (friend request push first, pair request push only after friend accepted). Cancel must cascade friend requests only if they were created by the pairing flow (check `gated_by_friend_request_id`). Greyed pills must transition through states as the chain progresses (waiting for signup → waiting for friend → waiting for pair → active).
