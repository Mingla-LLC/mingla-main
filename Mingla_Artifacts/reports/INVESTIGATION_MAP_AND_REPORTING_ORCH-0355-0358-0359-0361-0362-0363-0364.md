# Investigation Report: Discover Map & Reporting Pipeline

> INV-015 | Forensic Investigator | 2026-04-10
> Issues: ORCH-0355, ORCH-0358, ORCH-0359, ORCH-0361, ORCH-0362, ORCH-0363, ORCH-0364

---

## Part A — Map Executive Summary

The discover map has four distinct defects. (1) User avatars disappear because `tracksViewChanges={false}` on Markers means failed image loads are permanent, and the 60-second refetch can temporarily empty the array during re-render. (2) The "friends of friends" filter option exists in the map controls UI but is missing from the account settings privacy page — the settings page only lists 4 of the 5 allowed values. The DB CHECK constraint *does* include `friends_of_friends`, so the mutation error may stem from the deployed DB being out of sync with the migration file. (3) The red dots are `PlacePin` markers — curated experience stop locations rendered as colored circles with category icons. They are NOT unexplained; they represent places, but have no label/tooltip on tap, only a bottom sheet with the card details. (4) When tapping "Profile" on a person, the `useFriendProfile` hook calls `.single()` on the profiles table, which fails for strangers/seeds because RLS blocks non-friend profile reads and seeds don't exist in the profiles table at all. The fallback error screen shows "This profile isn't available" — but the PersonBottomSheet itself displays `displayName` from the `get-nearby-people` edge function data, which the user may perceive as "generic" because it lacks bio, interests, and photo when avatar_url is null.

---

## Issue 1 (ORCH-0361): Avatar Disappearance

### Classification: 🟠 Contributing Factor (multiple causes)

### Finding 1a: `tracksViewChanges={false}` prevents image reload

- **File + line**: `app-mobile/src/components/map/PersonPin.tsx:92` (via `ReactNativeMapsProvider.tsx:142`)
- **Exact code**: `tracksViewChanges={false}` on the Marker wrapping `PersonPinContent`
- **What it does**: Renders the marker image ONCE and never updates it. If the avatar image fails to load on the first render (slow network, CDN timeout), the marker permanently shows the fallback initials or a blank space.
- **What it should do**: Either retry failed image loads, or use `tracksViewChanges={true}` briefly until the image loads.
- **Causal chain**: CDN timeout → Image component fails silently → `tracksViewChanges={false}` prevents re-render → avatar appears as initials/blank → user perceives "avatar disappeared"
- **Verification**: Set `tracksViewChanges={true}` temporarily; avatars should appear consistently (at cost of performance).

### Finding 1b: Clustering hides individual person markers

- **File + line**: `app-mobile/src/components/map/providers/ReactNativeMapsProvider.tsx:73`
- **Exact code**: `<ClusteredMapView ... radius={50} maxZoom={16}>`
- **What it does**: Clusters markers within 50px radius. Person markers use `cluster={false}` (line 152), but this only works if the library respects it — `react-native-map-clustering` may still cluster under certain zoom levels.
- **Verification**: Check if avatars reappear when zooming in.

### Finding 1c: 60-second refetch can cause flash

- **File + line**: `app-mobile/src/hooks/useNearbyPeople.ts:39`
- **Exact code**: `refetchInterval: 60_000, staleTime: 30_000`
- **What it does**: Refetches nearby people every 60s. During refetch, if the server returns a different set (someone went offline, visibility changed), markers are removed and re-added. The `key={person-${person.userId}}` ensures stable keys, but the data array itself can shrink.
- **Causal chain**: Refetch → person no longer in results (went offline/hidden) → marker removed → user perceives disappearance
- **This is partially "working as designed"** but feels like a bug when people pop in and out.

### Finding 1d: `enabled` toggle causes markers to vanish

- **File + line**: `app-mobile/src/components/map/DiscoverMap.tsx:138-139`
- **Exact code**: `useNearbyPeople(peopleLayerOn && !isHidden && !paused, userLocation)`
- **What it does**: When `peopleLayerOn` is toggled off, or user goes "dark" (`isHidden`), or the map is `paused`, the query is disabled and `nearbyPeople` defaults to `[]`. All person markers vanish.
- **This is by design** but may surprise the user if they don't realize they toggled something.

### Confidence: Medium — Multiple plausible causes. Image load failure (1a) is the most likely "intermittent" cause. Needs runtime confirmation.

---

## Issue 2 (ORCH-0358): Friends-of-Friends Filter Broken

### Classification: 🔴 Root Cause (two sub-problems)

### Finding 2a: MapPrivacySettings omits `friends_of_friends`

- **File + line**: `app-mobile/src/components/map/MapPrivacySettings.tsx:7`
- **Exact code**: `const VISIBILITY_LEVELS = ['off', 'paired', 'friends', 'everyone'] as const;`
- **What it does**: Only 4 visibility levels are listed. `friends_of_friends` is missing.
- **What it should do**: Include all 5 levels: `['off', 'paired', 'friends', 'friends_of_friends', 'everyone']`
- **Causal chain**: Settings page cycles through 4 values → user never sees "Friends of friends" option → cannot set it from privacy settings
- **Verification**: Add `'friends_of_friends'` to the array and corresponding label.

Additionally, `VISIBILITY_LABELS` (line 8) is also missing the label for `friends_of_friends`:
```typescript
const VISIBILITY_LABELS: Record<string, string> = {
  off: 'Hidden',
  paired: 'Paired only',
  friends: 'Friends',
  everyone: 'Everyone nearby',
  // MISSING: friends_of_friends: 'Friends of friends'
};
```

### Finding 2b: DB CHECK constraint vs runtime error contradiction

- **File + line**: `supabase/migrations/20260326000001_user_map_settings.sql:10`
- **Exact code**: `CHECK (visibility_level IN ('off', 'paired', 'friends', 'friends_of_friends', 'everyone'))`
- **What it does**: The migration DOES include `friends_of_friends` as a valid value.
- **Runtime contradiction**: The user's log shows `user_map_settings_visibility_level_check` constraint violation when selecting "Friends of friends" from the map controls (ActivityStatusPicker).
- **Probable explanation**: The deployed database may have an older version of the CHECK constraint that predates the addition of `friends_of_friends`. The migration file shows the correct value, but the live DB state may differ. This needs live DB verification: `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'user_map_settings_visibility_level_check';`
- **Alternative explanation**: If the user's `user_map_settings` row was never created (no row exists), the upsert INSERT path should work since all columns have defaults. Unless the deployed DB table definition differs.

### Finding 2c: ActivityStatusPicker DOES include the option (UI is correct here)

- **File + line**: `app-mobile/src/components/map/ActivityStatusPicker.tsx:18-24`
- **Exact code**: `VISIBILITY_OPTIONS` includes `{ key: 'friends_of_friends', label: 'Friends of friends', icon: 'people-circle-outline' }`
- **Conclusion**: The map controls UI is correct. The bug is (a) the DB constraint rejecting the value at runtime, and (b) the privacy settings page in account settings missing the option entirely.

### Confidence: High for 2a (code-proven). Medium for 2b (migration says one thing, runtime says another — needs live DB check).

---

## Issue 3 (ORCH-0359): Red Pin Mystery

### Classification: 🔴 Root Cause (proven — they ARE place pins, not red dots)

### Finding 3a: "Red pins" are PlacePin markers for experience cards

- **File + line**: `app-mobile/src/components/map/PlacePin.tsx:40-76`
- **Exact code**: `PlacePinContent` renders a colored circle with a white icon inside. The inner color comes from `getCategoryColor(card.category)`. The outer border color comes from `TIER_BORDER_COLORS` (green/blue/purple/gold based on price tier).
- **What it does**: Each place card on the map renders as a round pin with a category icon (wine glass, utensils, game controller, etc.) inside a colored circle. These are NOT "red dots" — they are category-colored pins. Some categories may use reddish colors (e.g., fine dining, live performance), which the user perceives as "red."
- **What happens on tap**: `onPress` calls `handlePinPress` in DiscoverMap.tsx:221, which sets `selectedCard` and opens the `MapBottomSheet` with card details.

### Finding 3b: Curated route stops render as larger pins

- **File + line**: `app-mobile/src/components/map/PlacePin.tsx:51-56`
- **Exact code**: `isCurated ? styles.wrapperLarge : styles.wrapper` — curated cards get 46px pins vs 32px for singles.
- **What it does**: Curated experience stops (from `map-cards-curated`) render as larger map pins with a map icon inside.

### Finding 3c: No label/tooltip on the pin itself

- **What's missing**: The pins have no text label, name, or tooltip visible on the map. The user must tap to see the card name in the bottom sheet. If the tap doesn't register cleanly (common with clustered or overlapping markers), the user sees a colored dot with no explanation.
- **This is a UX gap**, not a code bug. The pins convey category via color and icon, but require tap interaction to identify.

### Confidence: High — read all rendering code. The "red dots" are place pins rendered by PlacePinContent.

---

## Issue 4 (ORCH-0355): Generic Person Profile

### Classification: 🔴 Root Cause (proven — two distinct problems)

### Finding 4a: `useFriendProfile` uses `.single()` which fails for strangers

- **File + line**: `app-mobile/src/hooks/useFriendProfile.ts:29-32`
- **Exact code**:
  ```typescript
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, username, avatar_url, phone, country')
    .eq('id', userId!)
    .single();
  ```
- **What it does**: Queries the profiles table for a specific user ID with `.single()`. If RLS blocks the read (user is a stranger with `visibility_mode = 'private'`, or not a friend), the query returns 0 rows. `.single()` on 0 rows throws "Cannot coerce the result to a single JSON object."
- **What it should do**: Use `.maybeSingle()` and handle the null case gracefully.
- **Causal chain**: User taps person on map → taps "Profile" button → navigates to `ViewFriendProfileScreen` → `useFriendProfile(userId)` fires → `.single()` fails → `isError=true` → error screen: "This profile isn't available"

### Finding 4b: Profiles RLS blocks non-friend reads

- **File + line**: `supabase/migrations/20260310000004_profiles_friend_read_policy.sql:12-31`
- **Exact code**: Two SELECT policies:
  1. "Anyone can read public profiles" — `WHERE visibility_mode = 'public'`
  2. "Friends can read friend profiles" — `WHERE visibility_mode IN ('public', 'friends') AND EXISTS(friends...)`
- **What it does**: Strangers can only see profiles with `visibility_mode = 'public'`. If the target user's profile is set to 'friends' or 'private', RLS blocks the read. Seed users don't exist in the profiles table at all.
- **Causal chain**: RLS blocks read → 0 rows → `.single()` throws → profile screen shows error

### Finding 4c: Phone number exposed as PII in ViewFriendProfileScreen

- **File + line**: `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx:165-219`
- **Exact code**:
  ```typescript
  const phoneLine = profile.phone?.trim() ? profile.phone : 'Not shared';
  // ... rendered at line 217:
  <InfoRow icon="call-outline" label="Phone" value={phoneLine} muted={phoneMuted} />
  ```
- **What it does**: Displays the full phone number of the viewed user. This is fetched via `useFriendProfile` which selects `phone` from profiles.
- **What it should do**: Phone numbers should NEVER be shown to other users. This is PII.
- **Security impact**: Any friend can see another friend's phone number.

### Finding 4d: useFriendProfile returns phone to client

- **File + line**: `app-mobile/src/hooks/useFriendProfile.ts:30`
- **Exact code**: `.select('id, first_name, last_name, username, avatar_url, phone, country')`
- **What it does**: Selects `phone` from the profiles table and returns it to the client.
- **What it should do**: Remove `phone` from the select — it should never leave the server for other users.

### Finding 4e: PersonBottomSheet shows basic info from NearbyPerson data

- **File + line**: `app-mobile/src/components/map/PersonBottomSheet.tsx:57-76`
- **What it does**: Shows avatar, displayName, relationship, activityStatus, taste match. Does NOT show bio, interests, or phone. This is the compact bottom sheet — not the full profile.
- **What the user sees as "generic"**: If `avatarUrl` is null, the fallback shows initials in a gray circle. Combined with just a name and "Nearby" label, it looks bare/generic. The user wants to see photo, bio, and interests here.
- **What's missing from NearbyPerson data**: The `get-nearby-people` edge function returns limited data. Bio and interests are not included in the NearbyPerson interface.

### Confidence: High — full chain traced from tap to error, all code read.

---

## Part B — Reporting Pipeline Executive Summary

The reporting pipeline is broken at three points. (1) The map report handler in `DiscoverMap.tsx` bypasses the `reportService` entirely, does a raw Supabase insert with an **invalid enum value** (`'map_interaction'` is not in the `report_reason` enum), and doesn't check the error response — so it silently fails while showing a "Reported" success alert. (2) The friend list report handler calls `onBlockUser` synchronously before opening the report modal, and the modal component itself (`ReportUserModal`) is a 95%-height full-screen modal that must mount and animate — this takes noticeable time. (3) The admin cannot see reports because the admin SELECT policy on `user_reports` is **commented out** in the migration. RLS blocks all reads. The admin uses the anon key (not service_role), so RLS applies fully.

---

## Database Schema: user_reports

- **Table**: `public.user_reports`
- **Migration**: `20250205000002_create_user_reports.sql`
- **Columns**: id (UUID PK), reporter_id (FK→auth.users), reported_user_id (FK→auth.users), reason (ENUM: spam, inappropriate-content, harassment, other), details (TEXT), status (ENUM: pending, reviewed, resolved, dismissed), severity (TEXT, added later), created_at, updated_at, reviewed_at, reviewed_by (FK→auth.users), resolution_notes
- **RLS**: Enabled
  - INSERT: `auth.uid() = reporter_id` ✅
  - SELECT: `auth.uid() = reporter_id` (own reports only) ⚠️
  - Admin SELECT: **COMMENTED OUT** 🔴
  - UPDATE for admins: **MISSING** 🔴
- **Constraint**: `no_self_report CHECK (reporter_id != reported_user_id)` ✅
- **Helper**: `has_recent_report()` RPC exists ✅

---

## Issue 5 (ORCH-0362): Map Report Broken

### Classification: 🔴 Root Cause (proven)

### Finding 5a: Map report handler sends invalid enum value

- **File + line**: `app-mobile/src/components/map/DiscoverMap.tsx:362-378`
- **Exact code**:
  ```typescript
  const handleReportFromMap = useCallback(async (userId: string) => {
    try {
      await supabase.from('user_reports').insert({
        reporter_id: user!.id,
        reported_user_id: userId,
        reason: 'map_interaction',       // ← INVALID ENUM VALUE
        details: 'Reported from map discovery',
      });
      Alert.alert('Reported', 'Thanks for helping keep Mingla safe.');
      personSheetRef.current?.close();
    } catch {
      Alert.alert('Error', 'Could not submit report. Try again later.');
    }
  }, [user]);
  ```
- **What it does**: Inserts with `reason: 'map_interaction'`. The `reason` column is type `report_reason` (ENUM: 'spam', 'inappropriate-content', 'harassment', 'other'). `'map_interaction'` is NOT a valid enum value. PostgreSQL rejects the insert.
- **What it should do**: Use the `reportService.submitReport()` function which properly validates and uses valid enum values. Or open the `ReportUserModal` to let the user choose a reason.
- **Silent failure**: Supabase `.insert()` does NOT throw on error — it returns `{ data, error }`. The code uses `try/catch` but doesn't check `error`. The `catch` block only catches network-level exceptions, not Supabase query errors. So the insert fails silently, `Alert.alert('Reported', ...)` runs, and the user thinks the report was submitted.
- **Causal chain**: User taps Report on map → `handleReportFromMap` fires → insert with invalid enum → Supabase returns `{ error: {...} }` → code ignores error → success alert shown → no row in DB
- **Verification**: Check `user_reports` table for any rows with `reason = 'map_interaction'` — there will be none.

### Finding 5b: Map report bypasses the full report service

- **File + line**: Same as 5a
- **What it does**: The map handler does a raw `supabase.from().insert()` instead of calling `reportService.submitReport()`. This skips: (a) self-report validation, (b) duplicate report check via `has_recent_report`, (c) proper error handling, (d) valid enum enforcement.
- **Contrast**: The friend list report uses `reportService.submitReport()` (via `handleReportSubmit` in ConnectionsPage.tsx:1611-1613), which properly validates everything.

### Confidence: High — code-proven. Invalid enum + missing error check = silent failure.

---

## Issue 6 (ORCH-0363): Friend List Report Modal Delay

### Classification: 🟠 Contributing Factor (multiple causes)

### Finding 6a: `handleReportUser` calls `onBlockUser` before opening modal

- **File + line**: `app-mobile/src/components/ConnectionsPage.tsx:1605-1608`
- **Exact code**:
  ```typescript
  const handleReportUser = (friend: Friend) => {
    onBlockUser?.(friend, true);       // ← fires block action FIRST
    setSelectedUserToReport(friend);
    setShowReportModal(true);
  };
  ```
- **What it does**: Calls the parent's `onBlockUser` handler before setting modal state. If `onBlockUser` triggers any async work, re-renders, or navigation changes in the parent, it delays the modal appearance.
- **What it should do**: Open the report modal FIRST, then block after the report is submitted (the `ReportUserModal` already calls `blockUser` internally in `handleSubmit` at line 75 of `ReportUserModal.tsx`). So the block is being called TWICE — once before the modal opens and once after submit.

### Finding 6b: ReportUserModal is a large full-screen component

- **File + line**: `app-mobile/src/components/ReportUserModal.tsx:98-232`
- **What it does**: Full `<Modal>` component covering 95% of screen height (`minHeight: '95%'`). Contains ScrollView, 4 report option cards with icons, text input, footer buttons, and disclaimer. All this must mount, layout, and animate on `isOpen` becoming `true`.
- **Contributing to delay**: React must mount the entire component tree (TrackedTouchableOpacity wrappers, Icon components, StyleSheet calculations) before the modal becomes visible. The `animationType="fade"` adds animation delay.

### Finding 6c: Double-block problem

- The `handleReportUser` function calls `onBlockUser` immediately (line 1606), AND the `ReportUserModal.handleSubmit` also calls `blockUser` (line 75 of ReportUserModal.tsx). The user gets blocked twice — once on report tap, once on report submit. The first block call is unnecessary and may trigger network requests + cache invalidation + re-renders that delay the modal.

### Confidence: High for 6a and 6c (code-proven). Medium for 6b (mount delay is inferred, not measured).

---

## Issue 7 (ORCH-0364): Admin Reports Empty

### Classification: 🔴 Root Cause (proven — two independent breaks)

### Finding 7a: Admin SELECT policy on user_reports is COMMENTED OUT

- **File + line**: `supabase/migrations/20250205000002_create_user_reports.sql:66-73`
- **Exact code**:
  ```sql
  -- Admins/moderators can view all reports (you may need to adjust this based on your admin system)
  -- CREATE POLICY "Admins can view all reports" ON user_reports
  --   FOR SELECT USING (
  --     EXISTS (
  --       SELECT 1 FROM profiles
  --       WHERE profiles.id = auth.uid()
  --       AND profiles.role IN ('admin', 'moderator')
  --     )
  --   );
  ```
- **What it does**: The policy that would allow admins to read all reports was never created. The only SELECT policy is `auth.uid() = reporter_id` — users can only see reports they submitted.
- **What it should do**: Create an admin SELECT policy using `is_admin_user()` (the function used by other admin RLS policies in this codebase).
- **Causal chain**: Admin logs in → navigates to Reports page → `ReportsPage.jsx` queries `user_reports` → RLS blocks all rows (admin is not the reporter) → empty table
- **Verification**: Run `SELECT * FROM user_reports;` with service_role key — if rows exist, RLS is the blocker.

### Finding 7b: Admin uses anon key, not service_role

- **File + line**: `mingla-admin/src/lib/supabase.js:4`
- **Exact code**: `const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;`
- **What it does**: Admin dashboard uses the anon key. RLS applies fully. Without an admin SELECT policy on `user_reports`, the admin sees nothing.
- **This is consistent** with how other admin pages work — they use `is_admin_user()` in RLS policies. The user_reports table just never got its admin policy.

### Finding 7c: Admin UPDATE policy also missing

- No UPDATE policy exists for admins on `user_reports`. The `ReportsPage.jsx` has status update functionality (lines 135-152: `updateStatus` calls `.update({ status, reviewed_at })`) — this would also fail silently because there's no UPDATE policy for admins.

### Finding 7d: FK join hint may fail

- **File + line**: `mingla-admin/src/pages/ReportsPage.jsx:77`
- **Exact code**: `reporter:profiles!user_reports_reporter_id_fkey(display_name, email)`
- **What it does**: Uses a FK hint to join profiles via the reporter FK. But `user_reports_reporter_id_fkey` points to `auth.users`, not `profiles`. PostgREST may not resolve this join correctly.
- **Fallback exists**: Lines 99-117 have a fallback query without joins that catches this error. So the page would still work without profile names — but the primary query fails.

### Confidence: High — RLS policy is verifiably commented out. Admin uses anon key. No admin SELECT or UPDATE policy exists.

---

## End-to-End Pipeline Diagram

```
MAP REPORT (broken):
  User taps Report on PersonBottomSheet
    → handleReportFromMap (DiscoverMap.tsx:362)
      → raw supabase.insert({ reason: 'map_interaction' })  ← INVALID ENUM
        → Supabase returns { error: ... }
          → error IGNORED (no .error check)
            → Alert.alert('Reported') shown falsely
              → NO row in user_reports

FRIEND LIST REPORT (works but delayed):
  User taps Report on FriendCard dropdown
    → handleReportUser (ConnectionsPage.tsx:1605)
      → onBlockUser(friend, true)  ← UNNECESSARY, causes delay
      → setShowReportModal(true)
        → ReportUserModal mounts (large component)
          → User selects reason, submits
            → reportService.submitReport()
              → supabase.insert({ reason: 'harassment' })  ← VALID ENUM
                → Row created in user_reports ✅
              → blockUser() called AGAIN (double-block)

ADMIN VIEW (broken):
  Admin navigates to Reports page
    → ReportsPage.jsx queries user_reports
      → Primary query with profile joins fails (FK hint mismatch)
        → Fallback query without joins fires
          → RLS blocks ALL rows (no admin SELECT policy)
            → Empty table shown
              → Admin sees "All clear — no reports to review."
```

---

## Marker Inventory

| Marker Type | Component | Data Source | onPress | Visual |
|-------------|-----------|------------|---------|--------|
| User (self) | `SelfPinContent` via Marker | `profile` from appStore + `userLocation` | Alert: "Hey, this is you" | Orange ring, avatar/initials, pulse |
| Person (friend/stranger) | `PersonPinContent` via Pressable+Marker | `useNearbyPeople` → `get-nearby-people` edge function | `handlePersonPinPress` → PersonBottomSheet | Blue/gray/orange ring, avatar/initials, status bubble, match badge |
| Place (single) | `PlacePinContent` via `AnimatedPlacePin` | `useMapCards` → `generate-curated-experiences` edge function | `handlePinPress` → MapBottomSheet | Colored circle with category icon, tier border |
| Place (curated) | Same as above, larger size | Same | Same | Larger pin (46px), map icon |
| Heatmap | `PlaceHeatmap` | `allCards` | None | Overlay |

---

## Reporting Break Point Map

| # | Point | Status | Evidence |
|---|-------|--------|----------|
| 1 | Map Report → insert | 🔴 BROKEN | Invalid enum `'map_interaction'`, error not checked |
| 2 | Friend List Report → modal | 🟡 SLOW | `onBlockUser` called first, large modal mount |
| 3 | Friend List Report → insert | ✅ WORKS | Uses `reportService.submitReport()` with valid enum |
| 4 | DB → user_reports table | ✅ EXISTS | Schema correct, RLS INSERT works for auth users |
| 5 | Admin → SELECT reports | 🔴 BROKEN | Admin SELECT policy commented out, no admin RLS |
| 6 | Admin → UPDATE status | 🔴 BROKEN | No admin UPDATE policy on user_reports |
| 7 | Admin → profile join | 🟡 FAILS | FK hint to auth.users, not profiles; fallback exists |

---

## Shared Infrastructure Notes

1. **PersonBottomSheet is a shared touchpoint** for Issues 4 (profile), 5 (report), and partially 1 (avatar). This component was recently modified for ORCH-0356 and ORCH-0360.

2. **Two separate report code paths**: The map uses a raw inline handler (broken). The friend list uses the proper `reportService` (works). These should be unified.

3. **RLS pattern gap**: Admin RLS policies exist for `profiles`, `beta_feedback`, `admin_users`, and other tables — but `user_reports` was missed. The commented-out policy in the migration is the original developer's TODO that was never completed.

4. **Phone PII exposure** (Finding 4c) is a security issue discovered during this investigation that affects `ViewFriendProfileScreen`. It's not part of the original 7 issues but is a 🟡 Hidden Flaw.

---

## Side Issues for Orchestrator

1. **🟡 PII: Phone number exposed in ViewFriendProfileScreen** — `useFriendProfile` selects `phone` from profiles and displays it to friends. Phone should never be shown to other users. File: `app-mobile/src/hooks/useFriendProfile.ts:30` and `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx:165,217`.

2. **🟡 Double-block on friend list report** — User gets blocked once on Report tap (ConnectionsPage.tsx:1606) and again on report submit (ReportUserModal.tsx:75). The first block is premature and should be removed.

3. **🟡 Admin UPDATE policy missing on user_reports** — Admin can read (once SELECT is fixed) but cannot update report status. Needs UPDATE policy with `is_admin_user()`.

---

## Confidence Assessment

| Issue | Confidence | Reasoning |
|-------|-----------|-----------|
| ORCH-0361 (avatars) | Medium | Multiple plausible causes identified. Image load failure most likely for "intermittent." Needs runtime testing. |
| ORCH-0358 (FoF filter) | High for MapPrivacySettings gap, Medium for DB constraint | Code proves settings page missing option. DB constraint contradiction needs live verification. |
| ORCH-0359 (red pins) | High | Full rendering chain read. Pins are PlacePinContent with category colors. |
| ORCH-0355 (generic profile) | High | `.single()` on RLS-blocked query proven. ViewFriendProfileScreen code read end-to-end. |
| ORCH-0362 (map report) | High | Invalid enum value proven in code. Error-ignoring pattern proven. |
| ORCH-0363 (modal delay) | High for code causes, Medium for perceived delay | Double-block and premature onBlockUser proven. Mount delay inferred. |
| ORCH-0364 (admin empty) | High | Admin SELECT policy verifiably commented out. Anon key confirmed. |
