# SPEC — ORCH-0933 [Profile "Your Circle" social graph section]

**Status:** DRAFT — awaiting orchestrator REVIEW
**Author:** Claude `mingla-forensics` (SPEC mode)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Dispatch source:** `Mingla_Artifacts/prompts/FORENSICS_SPEC_ORCH-0933_PROFILE_YOUR_CIRCLE_SECTION.md`
**Date:** 2026-05-23

---

## 1. Phase 0 Ingestion Log

All six ingestion items completed before spec authorship. Citations are concrete file paths and migration names — not hand-waved.

1. **Consumer Profile screen + "Your Interests" mount point**
   - File: [app-mobile/src/components/ProfilePage.tsx](app-mobile/src/components/ProfilePage.tsx)
   - "Your Interests" `GlassCard` wrapping `ProfileInterestsSection` lives at **lines 453–460**
   - Next sibling = Stats card at line 463
   - **New "Your Circle" GlassCard inserts as a sibling between line 460 and line 463**, inside the existing `KeyboardAwareScrollView` (line 426) with `contentRef` (line 427)
   - No layout refactor needed; mount point is a clean sibling slot

2. **Relationship tables (latest authoritative migrations)**
   - `pairings` — [supabase/migrations/20260505000000_baseline_squash_orch_0729.sql](supabase/migrations/20260505000000_baseline_squash_orch_0729.sql) lines 8603–8617. Bidirectional with `user_a_id < user_b_id` CHECK enforcement; RLS = `auth.uid() IN (user_a_id, user_b_id)`
   - `friends` — same migration, lines 8330–8339. Directional rows (acceptance creates two rows via `accept_friend_request_atomic()` RPC); `status IN ('accepted','pending','blocked')`; soft-delete via `deleted_at`; RLS = `auth.uid() = user_id`
   - `orders` — same migration. Holds `buyer_user_id`, `event_id`, `payment_status`. RLS = `auth.uid() = buyer_user_id` (or scanner roles). Co-attendance signal = paid orders sharing `event_id`
   - `events` — same migration. `event_type IN ('event','trip')` discriminates trips from regular events per I-1.2-UNIFIED-EVENT-TYPE
   - `profiles` — same migration, lines 9081–9156. Holds `display_name`, `first_name`, `last_name`, `username`, `avatar_url`, `photos[]`. RLS allows friend-visibility via `visibility_mode IN ('public','friends')` + EXISTS join

3. **Existing avatar primitive**
   - Closest match: [app-mobile/src/components/board/ParticipantAvatars.tsx](app-mobile/src/components/board/ParticipantAvatars.tsx) lines 40–127 — circular, configurable `size`, picture-or-initials fallback, hardcoded `#007AFF` initial bg (line 200), 2pt white border (line 204), initial extraction at lines 53–70
   - Secondary: [app-mobile/src/components/figma/ImageWithFallback.tsx](app-mobile/src/components/figma/ImageWithFallback.tsx) used by [ProfileHeroSection.tsx:155–164](app-mobile/src/components/profile/ProfileHeroSection.tsx#L155)
   - **Decision:** extract the avatar-with-initials-fallback core from `ParticipantAvatars.tsx` into a reusable primitive `<CircleAvatar>` colocated with the new feature (do NOT modify `ParticipantAvatars.tsx` — keep that group-of-avatars component untouched and lift its avatar internals into a new shared primitive). Rationale: the existing component bakes participant-list logic in; the new section needs the avatar piece without the list orchestration

4. **React Query key factory**
   - File: [app-mobile/src/hooks/queryKeys.ts](app-mobile/src/hooks/queryKeys.ts) — object-based factory with nested `as const` tuples (RQ v4+ pattern)
   - Related factories exist in feature-local files: `friendsKeys` in [app-mobile/src/hooks/useFriendsQuery.ts](app-mobile/src/hooks/useFriendsQuery.ts), `pairingKeys` in [app-mobile/src/hooks/usePairings.ts](app-mobile/src/hooks/usePairings.ts)
   - **Decision:** add `circleKeys` to the central `queryKeys.ts` (consolidating beats per-feature drift); pattern below in §5

5. **Person-detail navigation pattern**
   - File: [app-mobile/src/contexts/NavigationContext.tsx](app-mobile/src/contexts/NavigationContext.tsx) — imperative custom-navigation context (NOT React Navigation)
   - Friend-profile target: [app-mobile/src/components/profile/ViewFriendProfileScreen.tsx](app-mobile/src/components/profile/ViewFriendProfileScreen.tsx) accepting `{ userId, onBack, onMessage }` (lines 52–56)
   - There is NO named route token for "view user X" today — `ViewFriendProfileScreen` is composed by callers. Spec must locate the existing CALLER pattern (likely via a sheet or stack push) and reuse exactly. **Implementor task in §6 step 6:** grep for `<ViewFriendProfileScreen` usages in `app-mobile/src/` and document the canonical caller pattern, then replicate from the Circle avatar tap handler

6. **Business-badge / dual-app indicator precedent** — **NONE exists.** Only `briefcase-outline` lucide icon at [app-mobile/src/components/ui/Icon.tsx:203](app-mobile/src/components/ui/Icon.tsx#L203) is available. Spec defines a new badge primitive (§6) and implementor's `/ui-ux-pro-max` pre-flight finalizes the geometry

---

## 2. Cross-Surface Impact (Phase 2.5 — mandatory)

| Surface | Status | Reason |
|---|---|---|
| Consumer iOS | **Touched** | New section renders on `app-mobile/` iOS build |
| Consumer Android | **Touched** | New section renders on `app-mobile/` Android build (same RN code path) |
| Buyer/anonymous Web | NOT touched | No Profile screen in buyer-web flow (`/checkout`, `/e/`, `/b/` routes are anon-only) |
| Business iOS | NOT touched | Different app (`mingla-business/`); no consumer Profile screen analog |
| Business Android | NOT touched | Same as Business iOS |
| Admin Web | NOT touched | No user-facing Profile surface in admin |
| Business Web preview | NOT touched | Different app |

**Backend touches:**
- 1 new SECURITY DEFINER SQL RPC: `get_user_circle(viewer_user_id uuid, p_limit int, p_offset int)`
- 0 new tables, 0 new columns, 0 new edge functions

**Parity:** Automatic across iOS + Android (shared RN code path). Single success-criteria set covers both — no `SC-N-iOS`/`SC-N-Android` split needed.

---

## 3. Data Model

### 3.1 No new tables, no new columns

The feature reads from existing tables exclusively. Honors operator guidance "prefer view/RPC over new physical table."

### 3.2 New SECURITY DEFINER RPC

**Why an RPC is mandatory** (not "preferred"):
- `friends` RLS = `auth.uid() = user_id` → viewer CANNOT see friends-of-friends directly
- `orders` RLS = `auth.uid() = buyer_user_id` → viewer CANNOT see other buyers of shared events directly
- `profiles` RLS allows friend-of-friend visibility ONLY when `visibility_mode IN ('public','friends')` AND a `friends` EXISTS join succeeds. Tier 3 reaches users where neither holds
- Without an RPC, the entire Tier 3 (extended) population is unreachable from the client

**RPC contract:**

```sql
CREATE OR REPLACE FUNCTION public.get_user_circle(
  p_viewer_user_id uuid,
  p_limit int DEFAULT 60,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  user_id          uuid,
  tier             text,            -- 'close' | 'friend' | 'extended'
  display_name     text,
  username         text,
  avatar_url       text,
  has_business_app boolean,         -- true iff appsflyer_devices has both 'consumer' AND 'business' rows for this user
  sort_score       bigint           -- composite epoch-ms for keyset pagination ties (see §4)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  -- HARD GATE: viewer must be the authenticated caller (no impersonation)
  IF v_caller IS NULL OR v_caller <> p_viewer_user_id THEN
    RAISE EXCEPTION 'get_user_circle: unauthorized (caller=%, requested=%)', v_caller, p_viewer_user_id
      USING ERRCODE = '42501';
  END IF;

  IF p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'get_user_circle: p_limit out of range (must be 1..200)' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH
  -- consumer-app installer set (the universal filter)
  consumer_users AS (
    SELECT DISTINCT ad.user_id
    FROM public.appsflyer_devices ad
    WHERE ad.app = 'consumer'
  ),
  dual_app_users AS (
    SELECT DISTINCT ad.user_id
    FROM public.appsflyer_devices ad
    WHERE ad.app = 'business'
  ),
  -- Tier 1: paired friends
  tier_close AS (
    SELECT
      CASE WHEN p.user_a_id = p_viewer_user_id THEN p.user_b_id ELSE p.user_a_id END AS other_id,
      EXTRACT(EPOCH FROM p.created_at)::bigint * 1000 AS rel_created_ms
    FROM public.pairings p
    WHERE p_viewer_user_id IN (p.user_a_id, p.user_b_id)
  ),
  -- Tier 2: accepted friends, not already in Tier 1
  tier_friend AS (
    SELECT
      f.friend_user_id AS other_id,
      EXTRACT(EPOCH FROM f.updated_at)::bigint * 1000 AS rel_created_ms
    FROM public.friends f
    WHERE f.user_id = p_viewer_user_id
      AND f.status = 'accepted'
      AND f.deleted_at IS NULL
      AND f.friend_user_id NOT IN (SELECT other_id FROM tier_close)
  ),
  -- viewer's friend set (for FoF expansion)
  viewer_friends AS (
    SELECT f.friend_user_id AS fid
    FROM public.friends f
    WHERE f.user_id = p_viewer_user_id
      AND f.status = 'accepted'
      AND f.deleted_at IS NULL
  ),
  -- viewer's paid event/trip set (for co-attendee expansion)
  viewer_events AS (
    SELECT DISTINCT o.event_id AS eid
    FROM public.orders o
    WHERE o.buyer_user_id = p_viewer_user_id
      AND o.payment_status = 'paid'
  ),
  -- Tier 3a: friends-of-friends (excluding viewer, Tier 1, Tier 2)
  tier_fof AS (
    SELECT
      f2.friend_user_id AS other_id,
      MAX(EXTRACT(EPOCH FROM f2.updated_at)::bigint * 1000) AS rel_created_ms
    FROM public.friends f2
    WHERE f2.user_id IN (SELECT fid FROM viewer_friends)
      AND f2.status = 'accepted'
      AND f2.deleted_at IS NULL
      AND f2.friend_user_id <> p_viewer_user_id
      AND f2.friend_user_id NOT IN (SELECT other_id FROM tier_close)
      AND f2.friend_user_id NOT IN (SELECT other_id FROM tier_friend)
    GROUP BY f2.friend_user_id
  ),
  -- Tier 3b: co-event/trip buyers
  tier_coattendee AS (
    SELECT
      o2.buyer_user_id AS other_id,
      MAX(EXTRACT(EPOCH FROM COALESCE(e.end_at, e.start_at, o2.created_at))::bigint * 1000) AS rel_created_ms
    FROM public.orders o2
    JOIN public.events e ON e.id = o2.event_id
    WHERE o2.event_id IN (SELECT eid FROM viewer_events)
      AND o2.payment_status = 'paid'
      AND o2.buyer_user_id IS NOT NULL
      AND o2.buyer_user_id <> p_viewer_user_id
      AND o2.buyer_user_id NOT IN (SELECT other_id FROM tier_close)
      AND o2.buyer_user_id NOT IN (SELECT other_id FROM tier_friend)
    GROUP BY o2.buyer_user_id
  ),
  -- Tier 3 union: max rel_created_ms wins per user
  tier_extended AS (
    SELECT other_id, MAX(rel_created_ms) AS rel_created_ms
    FROM (
      SELECT * FROM tier_fof
      UNION ALL
      SELECT * FROM tier_coattendee
    ) u
    GROUP BY other_id
  ),
  -- combined, tier-labeled, deduped (precedence enforced by tier exclusion above)
  combined AS (
    SELECT other_id, 'close'::text   AS tier, rel_created_ms FROM tier_close
    UNION ALL
    SELECT other_id, 'friend'::text  AS tier, rel_created_ms FROM tier_friend
    UNION ALL
    SELECT other_id, 'extended'::text AS tier, rel_created_ms FROM tier_extended
  )
  SELECT
    c.other_id AS user_id,
    c.tier,
    pr.display_name,
    pr.username,
    pr.avatar_url,
    (c.other_id IN (SELECT user_id FROM dual_app_users)) AS has_business_app,
    -- composite sort_score: tier weight (3=close,2=friend,1=extended) << 50 | recency_ms
    -- ensures tier precedence first, then recency within tier
    ((CASE c.tier WHEN 'close' THEN 3 WHEN 'friend' THEN 2 ELSE 1 END)::bigint * (1::bigint << 50))
      + GREATEST(
          c.rel_created_ms,
          COALESCE((
            SELECT MAX(EXTRACT(EPOCH FROM COALESCE(e2.end_at, e2.start_at, o3.created_at))::bigint * 1000)
            FROM public.orders o3
            JOIN public.events e2 ON e2.id = o3.event_id
            WHERE o3.payment_status = 'paid'
              AND o3.buyer_user_id = c.other_id
              AND o3.event_id IN (SELECT eid FROM viewer_events)
          ), 0)
        ) AS sort_score
  FROM combined c
  JOIN public.profiles pr ON pr.id = c.other_id
  WHERE c.other_id IN (SELECT user_id FROM consumer_users)  -- HARD INCLUSION FILTER
    AND c.other_id <> p_viewer_user_id
  ORDER BY sort_score DESC, c.other_id ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_circle(uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_circle(uuid, int, int) TO authenticated;
```

**Implementor must:**
- Verify every column reference against the latest migration BEFORE writing the migration file (per [[verify-db-column-names-before-writing-queries]]). Specifically confirm: `events.end_at` and `events.start_at` exist (if not, fall back to whatever event-time column does exist — likely `start_time`/`end_time` based on prior ORCH-0850 naming); `appsflyer_devices.app` column exists per ORCH-0808 baseline
- Place migration at `supabase/migrations/<UTC-timestamp>_orch_0933_get_user_circle_rpc.sql`
- Migration is ADDITIVE only — no ALTER, no DROP, no data movement

### 3.3 Indexes (verify existing, add if missing)

These indexes are required for the RPC to be cheap. Confirm presence in latest migration; if any is missing, add to the same migration file as additive `CREATE INDEX IF NOT EXISTS`:

| Index | Table | Purpose | Already exists? |
|---|---|---|---|
| `idx_pairings_user_a` (user_a_id) | pairings | Tier 1 lookup | YES per Phase 0 |
| `idx_pairings_user_b` (user_b_id) | pairings | Tier 1 lookup | YES |
| `idx_friends_user_id` (user_id) | friends | Tier 2 + viewer_friends | YES |
| `idx_orders_buyer_user_id` (buyer_user_id) | orders | viewer_events | YES |
| `idx_orders_event_id` (event_id) | orders | co-attendee lookup | YES |
| `idx_appsflyer_devices_user_id_app` (user_id, app) | appsflyer_devices | consumer-app filter | YES per ORCH-0808 |
| `idx_friends_friend_user_id_status` (friend_user_id, status) WHERE deleted_at IS NULL | friends | FoF lookup | **VERIFY — add if missing** |

The last index in the list is the only one with non-trivial risk of absence; FoF query performance depends on it.

### 3.4 "Has consumer app" signal — final decision

Per Phase 0 finding: `appsflyer_devices.app = 'consumer'`. Added to ORCH-0808 baseline 2026-06-01. Cheap (covered index), atomic (consumer app calls `registerAppsFlyerDevice()` on launch), discriminates from business-only users.

**Edge cases declared, not designed around:**
- User uninstalled consumer app → row persists → still appears in Circle. **Accepted for v1.** A 30-day-recent-active gate could be added later; out of scope per §17.
- Brand-new account that hasn't launched either app → no row → does not appear. Correct.

---

## 4. Sort Scoring Formula

**Primary:** most-recent interaction
- Tier 1 (close): MAX(`pairings.created_at`, last shared paid event/trip end_at)
- Tier 2 (friend): MAX(`friends.updated_at`, last shared paid event/trip end_at)
- Tier 3 (extended): MAX(FoF friendship `updated_at`, last shared paid event/trip end_at)

**Tier precedence enforced via composite score:**
```
sort_score = (tier_weight × 2^50) + recency_ms
  where tier_weight: close=3, friend=2, extended=1
  and recency_ms = MAX(relationship_timestamp, last_shared_event_end_ms)
```

The `<< 50` shift guarantees any Tier-N row outranks any Tier-(N-1) row regardless of recency. Within a tier, most-recent wins.

**Tiebreaker requested:** "recently active" (last consumer-app session). The cheapest proxy is `appsflyer_devices.updated_at` (bumped on each launch's upsert). **Spec defers this to a secondary sort tiebreaker for spec v1.1** — base v1 uses `sort_score DESC, user_id ASC` (deterministic). Implementor MAY add `appsflyer_devices.updated_at DESC` as a third sort key if the cost is negligible; if expensive, leave it out and register a follow-up ORCH. State the choice in the implementation report.

**Worked example** (assume `2^50 ≈ 1.13e15`):
- Viewer's close-paired friend Alice (paired 2024-01-01, no shared events): `sort_score = 3·2^50 + 1704067200000 ≈ 3.38e15`
- Viewer's friend Bob (accepted yesterday, no shared events): `sort_score = 2·2^50 + 1716422400000 ≈ 2.26e15`
- Viewer's FoF Carol via Bob (Bob→Carol accepted last week, no shared events): `sort_score = 1·2^50 + 1715817600000 ≈ 1.13e15`
- Viewer's co-attendee Dan from event last month (no friend relationship): `sort_score = 1·2^50 + 1713312000000 ≈ 1.13e15`

Order: Alice → Bob → Carol → Dan. Correct.

---

## 5. React Query Key Family

Add to [app-mobile/src/hooks/queryKeys.ts](app-mobile/src/hooks/queryKeys.ts):

```ts
export const circleKeys = {
  all: ['circle'] as const,
  forUser: (viewerUserId: string) =>
    [...circleKeys.all, 'user', viewerUserId] as const,
  page: (viewerUserId: string, limit: number, offset: number) =>
    [...circleKeys.forUser(viewerUserId), { limit, offset }] as const,
};
```

**Cache policy:**
- `staleTime: 5 * 60 * 1000` (5 min — circle changes slowly; ok to serve cached)
- `gcTime: 30 * 60 * 1000` (30 min)
- `enabled: !!viewerUserId`

**Invalidation triggers** (the hook owner adds these where relevant — implementor identifies the touch points by grep):
- `acceptFriendRequest` success → `queryClient.invalidateQueries({ queryKey: circleKeys.all })`
- `removeFriend` success → same
- `pairings` insert (operator confirms which mutation triggers pairing creation) → same
- Successful event-ticket purchase that adds a new co-attendee relationship → same (use existing checkout success handler)

**Honor [[zustand-persist-no-server-snapshots]]:** circle data lives in React Query exclusively. Zero zustand persistence of person records.

---

## 6. Component Tree

### 6.1 New files

| File | Role |
|---|---|
| `app-mobile/src/components/profile/circle/YourCircleSection.tsx` | Top-level section component mounted in `ProfilePage.tsx` |
| `app-mobile/src/components/profile/circle/CircleGrid.tsx` | The 3-row column-major scrollable grid |
| `app-mobile/src/components/profile/circle/CircleAvatarTile.tsx` | Single avatar tile (picture/initials + ring + optional briefcase badge) |
| `app-mobile/src/components/profile/circle/CircleEmptyState.tsx` | Empty-state copy + illustration |
| `app-mobile/src/components/profile/circle/CircleSkeleton.tsx` | Loading skeleton (3 rows of placeholder circles) |
| `app-mobile/src/hooks/useUserCircle.ts` | React Query hook calling `get_user_circle` RPC with pagination |
| `app-mobile/src/services/circleService.ts` | Thin Supabase RPC wrapper; deserializes rows to typed `CirclePerson` |
| `app-mobile/src/types/circle.ts` | Type definitions: `CirclePerson`, `CircleTier` |

### 6.2 Modified files

| File | Edit |
|---|---|
| [app-mobile/src/components/ProfilePage.tsx](app-mobile/src/components/ProfilePage.tsx) | Insert `<YourCircleSection />` between line 460 and line 463 (after Interests `GlassCard`, before Stats `GlassCard`). Wrap in matching `GlassCard` for visual consistency |
| [app-mobile/src/hooks/queryKeys.ts](app-mobile/src/hooks/queryKeys.ts) | Add `circleKeys` per §5 |
| Hook(s) that own friend accept/remove + pairing creation | Add `circleKeys.all` to existing `onSuccess` invalidation lists (implementor identifies via grep — likely [app-mobile/src/hooks/useFriends.ts](app-mobile/src/hooks/useFriends.ts) and [app-mobile/src/hooks/usePairings.ts](app-mobile/src/hooks/usePairings.ts)) |

### 6.3 Props contracts

```ts
// types/circle.ts
export type CircleTier = 'close' | 'friend' | 'extended';

export interface CirclePerson {
  userId: string;
  tier: CircleTier;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  hasBusinessApp: boolean;
  sortScore: number;
}

// YourCircleSection.tsx — no props, reads viewer from useAuth()
export const YourCircleSection: React.FC = () => { /* ... */ };

// CircleGrid.tsx
interface CircleGridProps {
  people: CirclePerson[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  onEndReached: () => void;
  onPressPerson: (person: CirclePerson) => void;
}

// CircleAvatarTile.tsx
interface CircleAvatarTileProps {
  person: CirclePerson;
  size: number;        // diameter in pt; default from theme token
  ringThickness: number;
  onPress: () => void;
}
```

### 6.4 Briefcase badge

A new primitive `BusinessBadge` is colocated inside `CircleAvatarTile.tsx` (not exported globally — keep the precedent contained to this feature for v1; a future ORCH can promote it if reused). Uses `briefcase-outline` from [app-mobile/src/components/ui/Icon.tsx:203](app-mobile/src/components/ui/Icon.tsx#L203). Renders ONLY when `person.hasBusinessApp === true`. Geometry locked at implementor `/ui-ux-pro-max` pre-flight; spec target: ~16pt diameter, bottom-right corner, 2pt white outline ring for contrast against the avatar.

---

## 7. Layout Math

### 7.1 Section box

| Dimension | Target | Notes |
|---|---|---|
| Section total height | 200–220pt | Fixed, no expansion |
| Avatar diameter | 48pt | Locked by `/ui-ux-pro-max` pre-flight; spec range 44–56pt |
| Ring thickness | 2.5pt | Around avatar; tier color |
| Row gap | 8pt | Between rows |
| Column gap | 12pt | Between columns |
| Horizontal padding | 16pt (matches existing `GlassCard`) | Left + right |
| Section header height | ~32pt | Title "Your Circle" + optional subtitle |

Height check: `32 (header) + 16 (gap) + 3 × 48 (rows) + 2 × 8 (row gaps) + 16 (bottom pad) = 224pt`. Target ≤220pt → tighten header gap to 8pt or use 44pt avatars. Pre-flight finalizes.

### 7.2 Column-major fill

Avatars fill **column-by-column, top-to-bottom**. For a person list of length N rendered in 3 rows:
- Column index of person i (0-indexed): `Math.floor(i / 3)`
- Row index of person i: `i % 3`

Tier color ring is determined by `person.tier`, NOT by row position. Mid-column tier transitions are intentional and visually expected.

### 7.3 Scroll behavior

- Horizontal scroll, free (NOT snap) — `ScrollView` with `horizontal showsHorizontalScrollIndicator={false}`
- OR: use `FlatList` with `horizontal numColumns={3}` — **REJECTED**, `FlatList` does not support row-then-column inverse with `horizontal`
- **Decision:** custom column-major rendering — group `people` array into columns of 3, render each column as a vertical `View`, wrap all columns in a horizontal `ScrollView`. Implementor MUST virtualize columns when count > 30 (use `FlatList horizontal` of columns, where each column is a 3-avatar `View` — this gets virtualization for free while preserving column-major fill).

### 7.4 Pagination trigger

- Initial RPC call: `limit=60` (20 columns ≈ 4× viewport)
- `onEndReached` (FlatList) fires when user scrolls within 0.5 viewport widths of the end → fetch next page with `offset += 60`
- Stop fetching when last page returned < 60 rows

---

## 8. Tier Color Contract

Spec defines TOKEN NAMES only. Hex values picked by implementor's `/ui-ux-pro-max` pre-flight from the Mingla palette. Required tokens:

| Token | Tier | Constraint |
|---|---|---|
| `circle.tier.close.ring` | Close (paired) | Most saturated / "warmest" of the three — signals strongest bond |
| `circle.tier.friend.ring` | Friend | Mid-saturation — recognizable as friendship |
| `circle.tier.extended.ring` | Extended | Most muted — present but de-emphasized |

Pre-flight requirements:
- All three tokens MUST come from the existing Mingla palette (do not invent new hex)
- Contrast: ring must be visible against both light and dark profile pictures (test on white, mid-gray, and black backgrounds)
- Color-blind safe: tokens distinguishable to deuteranopia + protanopia users (use [coolors.co simulator](https://coolors.co/contrast-checker) or equivalent during pre-flight)
- Honor [[rn-color-formats]] — hex / rgb / hsl / hwb only; NEVER oklch/lab/lch/color-mix

---

## 9. Empty / Partial States

| State | Render |
|---|---|
| All tiers empty (new user, zero connections, zero co-attendance) | `<CircleEmptyState />` — illustration + copy: "Your circle will grow as you meet people through Mingla" |
| `isLoading && people.length === 0` | `<CircleSkeleton />` — 3 rows × 7 placeholder grey circles, subtle shimmer matching existing `LoadingShimmer` if one exists |
| `people.length > 0 && isLoadingMore` | Render existing people; append spinner column at end of grid |
| `error && people.length === 0` | Compact error card: "Couldn't load your circle. Pull to refresh." with tap-to-retry |
| `error && people.length > 0` | Render cached people silently; log error to Sentry-equivalent; do NOT show error UI (per Mingla pattern of cache-first display) |

**No "see all" CTA in v1.** The grid IS the entire interaction. Pagination via scroll is sufficient.

---

## 10. Performance

### 10.1 RPC cost estimate

For a viewer with 50 friends, 20 paid events, average event size 100 buyers:
- `tier_close`: 1 row × `idx_pairings_user_a` lookup ≈ <1ms
- `tier_friend`: 50 rows × `idx_friends_user_id` ≈ ~2ms
- `viewer_friends` subquery: 50 rows
- `tier_fof`: 50 viewer-friends × ~50 friends each = 2500 candidate rows; with idx_friends_user_id + GROUP BY ≈ ~10ms
- `viewer_events`: 20 rows
- `tier_coattendee`: 20 events × 100 buyers = 2000 rows via `idx_orders_event_id` ≈ ~10ms
- Final JOIN + sort + LIMIT 60: ~5ms
- **Total target: <50ms p95** at this scale

For viewers with >500 friends or >500 paid events, RPC cost can exceed 200ms. **Acceptable for v1**, but spec flags this as the future optimization surface (materialized view or hourly-refresh cache table). Out of scope per §17.

### 10.2 Client performance targets

| Metric | Target | Measurement |
|---|---|---|
| Section first-paint after Profile mount | <400ms p95 | Time from `ProfilePage` mount to skeleton visible |
| First avatars rendered | <800ms p95 | Time from mount to RPC response + first paint |
| Scroll FPS on mid-tier Android (e.g., Pixel 4a) | ≥55fps | While horizontally scrolling 60+ avatars |
| Memory footprint | <8MB | Sum of avatar `Image` bitmap cache for visible + 1-viewport-ahead column buffer |

Implementor MUST use `FastImage` (or `Image` with `cachePolicy="memory-disk"`) for avatars to avoid re-fetch on scroll.

### 10.3 Virtualization

`FlatList horizontal` with columns as items. Each list item = a 3-avatar vertical `View`. `windowSize=5`, `maxToRenderPerBatch=10`, `initialNumToRender=15` (covers ~viewport + a bit ahead).

---

## 11. Privacy Non-Features (Explicit Codification)

These are NON-FEATURES for ORCH-0933. Future ORCHs that attempt to add any of these require operator-approved scope expansion:

| Non-feature | Rationale |
|---|---|
| Per-user opt-out from appearing in others' circles | Operator-confirmed 2026-05-23: "all co-attendees visible" |
| Long-press to hide individual avatar | Not in v1 brief |
| "Mute" / "block from circle" gesture | Use existing block infrastructure if needed; circle reflects block automatically since blocked users have status='blocked' in `friends` (Tier 2 filter) and viewer's blocks should propagate to extended tier. **Implementor MUST add `WHERE NOT EXISTS (SELECT 1 FROM friends fb WHERE fb.user_id = p_viewer_user_id AND fb.friend_user_id = c.other_id AND fb.status = 'blocked' AND fb.deleted_at IS NULL)` to the final SELECT** so blocked users never appear |
| Discoverable-by-co-attendees user setting | Codified as not present; all co-attendees are visible |
| "Why is this person here?" tooltip / context attribution | Not in v1; the colored ring conveys tier and that is sufficient |
| Search / filter within the section | Not in v1; section is browse-only |
| Friend-add CTA inside section | Not in v1; avatar tap goes to person's profile, friend-add happens there |
| Messaging from the section | Not in v1; same path — tap → profile → message |

---

## 12. Tap Navigation

**On `CircleAvatarTile.onPress`:**

```ts
const handlePress = (person: CirclePerson) => {
  // navigate via existing custom-nav pattern; reuse the same caller invocation
  // used elsewhere in app-mobile to open ViewFriendProfileScreen
  navigation.navigate('ViewFriendProfile', { userId: person.userId });
};
```

**Implementor task:** grep for existing `<ViewFriendProfileScreen` instantiations and locate the canonical caller. Use the SAME mechanism (sheet, stack push, or context method) the existing code uses. Do NOT invent a new route.

**Edge cases:**
- Target user deleted account between RPC response and tap → `ViewFriendProfileScreen` handles missing profile (verify in Phase 0 follow-up; if it doesn't, implementor adds a graceful "this person is no longer on Mingla" toast and dismisses)
- Target user blocked viewer post-RPC → covered by §11 blocked filter at next refresh; tap-time stale state shows profile that errors on load; acceptable for v1

**Haptic feedback:** light impact (`expo-haptics ImpactFeedbackStyle.Light`) on tap — matches existing tappable-tile pattern in Profile.

---

## 13. Invariants Introduced

| ID | Description | Enforcement |
|---|---|---|
| **I-PROPOSED-YOUR-CIRCLE-CONSUMER-APP-FILTER** | Every avatar rendered in the section MUST correspond to a `profiles.id` where `appsflyer_devices` has at least one row with `app='consumer'` for that user_id. Enforced inside `get_user_circle` RPC. Client cannot bypass | RPC WHERE clause + grep gate §14 |
| **I-PROPOSED-YOUR-CIRCLE-COLUMN-MAJOR-FILL** | The grid fills column-by-column, top-to-bottom. Row-major fill is forbidden | Code structure; grep gate §14 |
| **I-PROPOSED-YOUR-CIRCLE-TIER-DETERMINISTIC** | Each user appears in EXACTLY ONE tier. Precedence: Close > Friend > Extended. Enforced via `NOT IN` exclusion in the RPC's tier CTEs | RPC structure + adversarial test §15 |
| **I-PROPOSED-YOUR-CIRCLE-BADGE-MEANS-DUAL-APP** | The briefcase badge renders IFF the user has rows in `appsflyer_devices` for BOTH `app='consumer'` AND `app='business'`. Never for consumer-only, never for business-only (business-only users don't appear at all) | RPC `has_business_app` field + render guard in `CircleAvatarTile` + adversarial test |
| **I-PROPOSED-YOUR-CIRCLE-RPC-SOLE-OWNER** | The `get_user_circle` RPC is the SOLE data path for the section. Client code MUST NOT independently query `friends`, `pairings`, or `orders` for circle composition | Grep gate §14 |
| **I-PROPOSED-YOUR-CIRCLE-BLOCKED-EXCLUDED** | Users whom the viewer has blocked (`friends.status='blocked'`) MUST NOT appear in any tier | RPC final SELECT WHERE NOT EXISTS clause + adversarial test |
| **I-PROPOSED-YOUR-CIRCLE-NO-IMPERSONATION** | RPC rejects calls where `auth.uid() <> p_viewer_user_id`. Viewers see ONLY their own circle | RPC guard at top of function body + adversarial test |

Add all 7 to `Mingla_Artifacts/INVARIANT_REGISTRY.md` at CLOSE.

---

## 14. Strict-Grep CI Gates

Per [[strict-grep-registry-pattern]], plug new gates into `.github/workflows/strict-grep-mingla-business.yml` as one script + one job per gate. Two new gates:

### Gate G-CIRCLE-RPC-SOLE-OWNER
File: `.github/scripts/strict-grep/circle-rpc-sole-owner.sh`

Forbids any file under `app-mobile/src/components/profile/circle/` or `app-mobile/src/hooks/useUserCircle.ts` or `app-mobile/src/services/circleService.ts` from referencing the strings `.from('friends')`, `.from('pairings')`, `.from('orders')`, or `accept_friend_request_atomic` directly. The only allowed Supabase access is `.rpc('get_user_circle'...)`.

```bash
#!/usr/bin/env bash
# Enforces I-PROPOSED-YOUR-CIRCLE-RPC-SOLE-OWNER
set -euo pipefail
SCOPE="app-mobile/src/components/profile/circle app-mobile/src/hooks/useUserCircle.ts app-mobile/src/services/circleService.ts"
PATTERN="\.from\(['\"](friends|pairings|orders)['\"]\)"
hits=$(grep -rEn "$PATTERN" $SCOPE 2>/dev/null || true)
if [ -n "$hits" ]; then
  echo "FAIL: Circle feature must use get_user_circle RPC, not direct table queries:"
  echo "$hits"
  exit 1
fi
echo "PASS: G-CIRCLE-RPC-SOLE-OWNER"
```

### Gate G-CIRCLE-BADGE-DUAL-APP
File: `.github/scripts/strict-grep/circle-badge-dual-app.sh`

Forbids any conditional rendering of `BusinessBadge` (or `briefcase-outline` icon inside the circle scope) that uses a condition other than `person.hasBusinessApp`. Prevents accidental "show badge if user is a brand admin" or other drift.

```bash
#!/usr/bin/env bash
# Enforces I-PROPOSED-YOUR-CIRCLE-BADGE-MEANS-DUAL-APP
set -euo pipefail
SCOPE="app-mobile/src/components/profile/circle"
# Find briefcase icon usage in scope; assert it's gated by hasBusinessApp
hits=$(grep -rn "briefcase" $SCOPE 2>/dev/null | grep -v "hasBusinessApp" || true)
if [ -n "$hits" ]; then
  echo "FAIL: briefcase badge must be gated by person.hasBusinessApp:"
  echo "$hits"
  exit 1
fi
echo "PASS: G-CIRCLE-BADGE-DUAL-APP"
```

Both gates added as jobs to the existing workflow file in the same PR as the implementation.

---

## 15. Test Plan

### 15.1 Implementor happy-path regression test (mandatory per CLOSE Step 0.5(a))

File: `app-mobile/src/components/profile/circle/__tests__/YourCircleSection.happy.test.tsx`

```ts
// Pseudocode contract — implementor writes the actual test
test('renders 3-row column-major grid with mixed tiers and a dual-app user', async () => {
  // Mock get_user_circle RPC to return 7 people:
  //   3 close (Alice, Bob, Carol)
  //   2 friend (Dan, Eve) — one of them (Eve) has_business_app=true
  //   2 extended (Frank, Grace)
  // Render <YourCircleSection /> with mocked useAuth
  // Assert:
  //   - 7 CircleAvatarTile components present
  //   - column[0] = [Alice, Bob, Carol] (rows 0,1,2)
  //   - column[1] = [Dan, Eve, Frank] (mid-column tier transition friend→extended at row 2)
  //   - column[2] = [Grace]
  //   - Eve's tile has briefcase badge; nobody else does
  //   - Ring colors: close ring on col[0], friend ring on Dan+Eve, extended ring on Frank+Grace
});

// Adversarial assertion: revert the column-major chunking logic (use row-major)
// → this test must FAIL. Documented in fails-on-revert log.
```

`fails-on-revert verified at <commit>` line required in implementation report.

### 15.2 Tester adversarial regression test (mandatory per CLOSE Step 0.5(b))

File: `app-mobile/src/components/profile/circle/__tests__/YourCircleSection.adversarial.test.tsx`

Different angle than 15.1. Attack the invariants:

```ts
test('I-PROPOSED-YOUR-CIRCLE-TIER-DETERMINISTIC — a user paired AND friend appears only as close', async () => {
  // Mock RPC to return same userId labeled both tier='close' and tier='friend' (simulates RPC bug)
  // Render. Assert: only ONE tile for that user, with close ring (not friend ring).
});

test('I-PROPOSED-YOUR-CIRCLE-BADGE-MEANS-DUAL-APP — badge does NOT render when has_business_app=false', async () => {
  // Mock 5 people with has_business_app=false
  // Render. Assert: zero briefcase badges visible.
});

test('I-PROPOSED-YOUR-CIRCLE-RPC-SOLE-OWNER — useUserCircle never touches friends/pairings/orders directly', async () => {
  // Spy on supabase.from. Render. Assert: no calls to from('friends'|'pairings'|'orders').
  // Only supabase.rpc('get_user_circle', ...) calls.
});

test('empty state renders when RPC returns []', async () => {
  // Mock RPC to return [].
  // Render. Assert: CircleEmptyState visible, no tiles.
});
```

Plus tester runs the RPC directly against the dev branch DB to verify:
- `auth.uid() <> p_viewer_user_id` is rejected with errcode 42501
- Blocked users do not appear
- Business-only user (no consumer-app row) does not appear in any tier
- Dual-app user has `has_business_app=true`
- Tier precedence: a user who is BOTH paired AND in a co-attended event appears as `tier='close'`, not `tier='extended'`

### 15.3 Cross-platform parity

Per tester-canonical-and-platform-parity rule (memory):
- iOS Simulator: render Profile, scroll to Circle section, verify 3-row column-major layout, tap an avatar → verify navigates to that person's profile, scroll horizontally → verify pagination fires
- Android Emulator: same checklist
- Web: N/A (consumer Profile not on web)

---

## 16. Success Criteria

Each is binary PASS/FAIL by the tester. Numbered for traceability.

| SC | Criterion |
|---|---|
| SC-01 | "Your Circle" section renders below "Your Interests" on consumer Profile screen, inside its own `GlassCard` matching surrounding visual treatment |
| SC-02 | Section is fixed-height (200–220pt range) and does not expand based on circle population |
| SC-03 | Avatars fill the grid column-by-column, top-to-bottom (column-major). Row-major fill is a FAIL |
| SC-04 | Each avatar wears a colored ring corresponding to its tier (close / friend / extended), using the three palette tokens defined in §8 |
| SC-05 | Users with both consumer AND business apps installed render a briefcase badge in the avatar's bottom-right corner. No other users render the badge |
| SC-06 | Users without the consumer app installed do NOT appear in the section under any tier |
| SC-07 | The `get_user_circle` RPC rejects callers where `auth.uid() <> p_viewer_user_id` with HTTP 403 / SQL errcode 42501 |
| SC-08 | A user who is both paired AND in viewer's friends table appears ONCE, as tier='close' (precedence) |
| SC-09 | A user blocked by viewer (friends.status='blocked') does NOT appear in any tier |
| SC-10 | Tapping any avatar opens that user's profile via the existing `ViewFriendProfileScreen` mechanism |
| SC-11 | When viewer has zero people in all tiers, `<CircleEmptyState />` renders with copy "Your circle will grow as you meet people through Mingla" |
| SC-12 | Initial RPC call uses `limit=60`. Subsequent scroll-triggered pages use `offset += 60` until last page < 60 rows |
| SC-13 | Within a tier, people sort by most-recent interaction descending (MAX of relationship timestamp and last shared paid event/trip end-time) |
| SC-14 | Tier precedence is enforced in sort: every close user appears before every friend user, every friend user before every extended user |
| SC-15 | Strict-grep gates G-CIRCLE-RPC-SOLE-OWNER and G-CIRCLE-BADGE-DUAL-APP both PASS in CI |
| SC-16 | Both regression tests (15.1 + 15.2) PASS in CI; happy-path test demonstrates `fails-on-revert` |
| SC-17 | iOS Simulator + Android Emulator parity verified by tester per §15.3 |
| SC-18 | Section first-paint < 400ms p95 on Profile mount (measured on dev build, mid-tier device) |
| SC-19 | Horizontal scroll maintains ≥55fps on mid-tier Android with 60+ avatars rendered |
| SC-20 | All 7 new invariants from §13 added to `Mingla_Artifacts/INVARIANT_REGISTRY.md` at CLOSE |

---

## 17. Out of Scope

Explicitly NOT in ORCH-0933. Future ORCHs required for any of these:

- "See all" / full-screen people list expansion
- Search within the section
- Filter by tier (e.g., "only show close friends")
- Long-press gestures (hide individual, mute, block)
- Tap-to-message directly from avatar
- Friend-add CTA from avatar
- "Recently active" presence indicator (green dot)
- Mutual-friend count badge
- Per-user opt-out from appearing in others' circles
- Discoverable-by-co-attendees setting
- Push notifications when someone joins your circle
- Per-ticket attendee tracking (today, only the buyer is a co-attendee; party-of-N attendees who didn't pay aren't tracked as user_ids — known limitation)
- Web rendering (consumer Profile is mobile-only)
- Materialized-view cache for performance at >500-friends scale
- Implementor's choice of `appsflyer_devices.updated_at` as a third sort tiebreaker is optional (§4); if used, document; if deferred, register as follow-up ORCH

---

## 18. Implementation Order

For the implementor:

1. **Migration first** — write `<UTC-timestamp>_orch_0933_get_user_circle_rpc.sql` per §3.2. Verify column names against latest baseline migration. Submit for `supabase db push --linked` (operator-gated)
2. **Verify migration on dev** — operator runs push; you confirm via `mcp__supabase__list_migrations` and probe the RPC with a real viewer's auth context
3. **Types** — `app-mobile/src/types/circle.ts`
4. **Service** — `circleService.ts` wrapping the RPC with typed deserialization
5. **Hook** — `useUserCircle.ts` with React Query infinite pagination
6. **Add `circleKeys`** to `queryKeys.ts`; add invalidation triggers to existing friend/pairing mutation `onSuccess` handlers
7. **`/ui-ux-pro-max` pre-flight** — finalize 3 tier color hex tokens, briefcase badge geometry, avatar diameter within spec range, ring thickness, section height. Capture in a short design note inline in the component file or as comments
8. **Components** — bottom-up: `CircleAvatarTile` → `CircleGrid` → `CircleSkeleton` → `CircleEmptyState` → `YourCircleSection`
9. **Mount** — edit `ProfilePage.tsx` between line 460 and 463
10. **Happy-path regression test** — write `YourCircleSection.happy.test.tsx` per §15.1; verify `fails-on-revert` by temporarily reverting the column-major chunking and confirming the test fails; restore and capture commit hashes
11. **Strict-grep gates** — add `circle-rpc-sole-owner.sh` and `circle-badge-dual-app.sh` to `.github/scripts/strict-grep/` and add corresponding jobs to `.github/workflows/strict-grep-mingla-business.yml`
12. **Local smoke** — run on iOS sim; verify the section renders, scrolls, paginates, and avatar taps open profiles
13. **Implementation report** at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0933_PROFILE_YOUR_CIRCLE_SECTION.md` with old→new receipts, test paths, fails-on-revert commit hash, pre-flight design notes, RPC EXPLAIN ANALYZE output for a sample viewer

---

## 19. Regression Prevention

The 7 invariants in §13 + 2 strict-grep gates in §14 + happy-path + adversarial tests in §15 form the regression-prevention surface. Specifically:

- Future drift toward client-side tier composition is blocked by G-CIRCLE-RPC-SOLE-OWNER
- Future "show badge for brand admins" drift is blocked by G-CIRCLE-BADGE-DUAL-APP
- Tier-precedence regression is caught by §15.2 test "user paired AND friend appears only as close"
- Column-major-fill regression is caught by §15.1 fails-on-revert
- RPC impersonation is caught by §15.2 RPC-direct test (errcode 42501)

---

## 20. Discoveries for Orchestrator (side issues found during Phase 0)

None that block ORCH-0933. Two observations worth registering but NOT in scope:

1. **Avatar primitive duplication risk** — `ParticipantAvatars.tsx` bakes avatar rendering inside a list component. This SPEC extracts the avatar core into a new feature-local primitive rather than refactoring `ParticipantAvatars.tsx`, because (a) refactoring is out of scope for ORCH-0933 and (b) the consumer of `ParticipantAvatars.tsx` is the board collab feature, untouched by this ORCH. Register follow-up ORCH "extract shared `CircleAvatar` primitive and refactor `ParticipantAvatars` to consume it" if a third consumer ever needs the same avatar+ring+badge composition

2. **`friendsKeys` and `pairingKeys` live in feature-local files, not `queryKeys.ts`** — this spec adds `circleKeys` to the central file (correct pattern). Existing keys could be consolidated; out of scope. Register follow-up ORCH if a query-key audit is desired

---

## 21. Confidence Level

**High** — Phase 0 ingestion was thorough; relationship tables and consumer-app signal are well-established (`pairings`, `friends`, `orders`, `appsflyer_devices` per ORCH-0808 baseline); RPC architecture is the unambiguous correct pattern given RLS posture; layout math is straightforward; the only Medium-confidence area is the existence of `idx_friends_friend_user_id_status` (§3.3) which the implementor verifies and adds if missing.

---

**End of SPEC_ORCH-0933.**
