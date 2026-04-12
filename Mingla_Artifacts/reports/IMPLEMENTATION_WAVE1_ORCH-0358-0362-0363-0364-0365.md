# Implementation Report: Map & Reporting Wave 1

> AH-056 | Implementor | 2026-04-10
> Issues: ORCH-0358, ORCH-0362, ORCH-0363, ORCH-0364, ORCH-0365
> Investigation: INV-015 (APPROVED)

---

## Files Changed

| # | File | Change |
|---|------|--------|
| 1 | `app-mobile/src/hooks/useFriendProfile.ts` | Removed `phone` from interface, select, and return |
| 2 | `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx` | Removed phone line computation and InfoRow |
| 3 | `app-mobile/src/components/ConnectionsPage.tsx` | Removed premature `onBlockUser` call in handleReportUser |
| 4 | `app-mobile/src/components/map/MapPrivacySettings.tsx` | Added `friends_of_friends` to VISIBILITY_LEVELS and VISIBILITY_LABELS |
| 5 | `app-mobile/src/components/map/DiscoverMap.tsx` | Replaced broken inline report handler with ReportUserModal |
| 6 | `supabase/migrations/20260410000002_admin_user_reports_rls.sql` | New migration: admin SELECT + UPDATE policies for user_reports |
| 7 | `mingla-admin/src/pages/ReportsPage.jsx` | Fixed FK join hint (column-based instead of FK-name-based) |

---

## Old → New Receipts

### useFriendProfile.ts
**What it did before:** Selected `phone` from profiles table and returned it to the client. Any friend could see another friend's full phone number.
**What it does now:** No longer selects or returns `phone`. The field is removed from the `FriendProfileData` interface, the Supabase `.select()`, and the return object.
**Why:** ORCH-0365 — phone numbers are PII that must never be exposed to other users.
**Lines changed:** 3

### ViewFriendProfileScreen.tsx
**What it did before:** Displayed a "Phone" InfoRow showing the friend's full phone number (or "Not shared" if null).
**What it does now:** Phone row and its computation are removed. The About card now starts with Location.
**Why:** ORCH-0365 — phone PII removal from UI.
**Lines changed:** 7 removed

### ConnectionsPage.tsx
**What it did before:** `handleReportUser` called `onBlockUser?.(friend, true)` before opening the report modal, causing a premature block + network request + re-render delay. The user was then blocked AGAIN when the ReportUserModal submitted (double-block).
**What it does now:** `handleReportUser` only sets state for the modal. No premature block. The block happens once, correctly, inside ReportUserModal.handleSubmit.
**Why:** ORCH-0363 — eliminates double-block and modal delay.
**Lines changed:** 1 removed

### MapPrivacySettings.tsx
**What it did before:** `VISIBILITY_LEVELS` array had 4 values: `['off', 'paired', 'friends', 'everyone']`. The `friends_of_friends` option was missing from both the array and the labels object.
**What it does now:** All 5 visibility levels included: `['off', 'paired', 'friends', 'friends_of_friends', 'everyone']`. Label "Friends of friends" added.
**Why:** ORCH-0358 — the account settings privacy page now matches the map controls.
**Lines changed:** 2

### DiscoverMap.tsx
**What it did before:** `handleReportFromMap` did a raw `supabase.from('user_reports').insert()` with invalid enum value `'map_interaction'`, ignored the error, and showed a false "Reported" success alert. No report was ever saved.
**What it does now:** `handleReportFromMap` opens the `ReportUserModal` (sets `reportTargetUserId` state). The new `handleReportSubmit` callback uses `reportService.submitReport()` with proper enum validation. Success/failure alerts accurately reflect the DB result.
**Why:** ORCH-0362 — map report now uses the same validated pipeline as friend list reports.
**Lines changed:** ~25 (replaced handler + added state + added modal JSX)

### 20260410000002_admin_user_reports_rls.sql (NEW)
**What it did before:** No admin RLS policies existed on `user_reports`. The admin SELECT policy was commented out in the original migration. Admin saw zero reports.
**What it does now:** Two new policies: `is_admin_user()` SELECT and UPDATE. Admins can read all reports and update status/severity.
**Why:** ORCH-0364 — enables the admin moderation pipeline.

### ReportsPage.jsx
**What it did before:** FK join hint `profiles!user_reports_reporter_id_fkey` failed because the FK points to `auth.users`, not `profiles`. The fallback query ran without names.
**What it does now:** Uses column-based join hint `profiles!reporter_id` and `profiles!reported_user_id`. PostgREST resolves via `profiles.id = user_reports.reporter_id` since `profiles.id` = `auth.users.id`.
**Why:** ORCH-0364 — proper profile name display in admin reports table.
**Lines changed:** 1

---

## Verification Matrix

| SC | Criterion | Status | Verification |
|----|-----------|--------|-------------|
| SC-01 | MapPrivacySettings cycles through 5 levels | PASS | Code verified: array has 5 entries, labels has 5 keys |
| SC-02 | FoF from map controls no DB error | UNVERIFIED | Needs live DB constraint check — migration includes FoF but runtime may differ |
| SC-03 | FoF persists in user_map_settings | UNVERIFIED | Depends on SC-02 |
| SC-04 | Report on map person opens ReportUserModal | PASS | Code verified: `handleReportFromMap` sets `reportTargetUserId`, modal renders when truthy |
| SC-05 | Report creates row with valid enum | PASS | Code verified: uses `reportService.submitReport()` which validates enum |
| SC-06 | Alert reflects DB result | PASS | Code verified: checks `result.success` before showing success/failure |
| SC-07 | Old `map_interaction` code removed | PASS | Code verified: entire old handler replaced |
| SC-08 | Report modal opens immediately | PASS | Code verified: no blocking call before `setShowReportModal(true)` |
| SC-09 | Block happens once, not twice | PASS | Code verified: premature `onBlockUser` removed; ReportUserModal.handleSubmit still blocks once |
| SC-10 | Block still happens on submit | PASS | Code verified: ReportUserModal.tsx:75 unchanged, still calls `blockUser` |
| SC-11 | Admin sees all reports | UNVERIFIED | Needs migration deployed |
| SC-12 | Admin can update status | UNVERIFIED | Needs migration deployed |
| SC-13 | Profile names display correctly | UNVERIFIED | Needs runtime test with deployed migration |
| SC-14 | Non-admin can't see others' reports | PASS | Original SELECT policy unchanged: `auth.uid() = reporter_id` |
| SC-15 | Phone NOT displayed | PASS | Code verified: InfoRow removed |
| SC-16 | Phone NOT fetched | PASS | Code verified: `phone` removed from `.select()` |
| SC-17 | Profile still shows name/avatar/location/tier/interests | PASS | Code verified: all other InfoRows and sections untouched |
| SC-18 | No TS errors from removed field | PASS | Verified: `phone` removed from interface, select, and return. No references remain. |

**Summary:** 13 PASS, 5 UNVERIFIED (all depend on live DB / deployment)

---

## Regression Surface

1. **ViewFriendProfileScreen** — verify layout looks correct without the phone row (no gap/spacing issue)
2. **Friend list report flow** — verify report still works end-to-end after removing premature block
3. **Map controls visibility** — verify all 5 options work in the ActivityStatusPicker
4. **Admin Reports page** — verify it loads and filters work after join hint change (needs deployed migration)
5. **Map PersonBottomSheet** — verify Report button still works and opens the modal correctly

---

## Discoveries for Orchestrator

1. **Pre-existing TS errors in ConnectionsPage.tsx** — 5 errors at lines 347, 571, 1164, 1412, 1827. All predate this change. The file has type mismatches between `Friend` types (mock vs service) and `Conversation` types.

2. **DB CHECK constraint uncertainty** — The migration file includes `friends_of_friends` but the user's runtime log showed a constraint violation. Either (a) the live DB was created before this value was added, or (b) there's a different issue. The implementor created the migration with the correct constraint but recommends verifying the live DB state before closing ORCH-0358. If the live constraint is stale, apply: `ALTER TABLE user_map_settings DROP CONSTRAINT user_map_settings_visibility_level_check; ALTER TABLE user_map_settings ADD CONSTRAINT user_map_settings_visibility_level_check CHECK (visibility_level IN ('off', 'paired', 'friends', 'friends_of_friends', 'everyone'));`

3. **PostgREST join resolution uncertainty** — The column-based join hint `profiles!reporter_id` should work since `profiles.id` matches `user_reports.reporter_id` values. However, PostgREST may not resolve it because the FK constraint references `auth.users`, not `profiles`. The existing fallback query (lines 99-117 in ReportsPage.jsx) will catch this gracefully, showing UUIDs instead of names.

---

## Deploy Notes

- **Migration `20260410000002_admin_user_reports_rls.sql` must be applied** before the admin Reports page will show data. Apply via `supabase db push` or Supabase dashboard.
- The mobile changes (Fixes 1-4) can ship via OTA independently.
- No new npm packages added. No native module changes. OTA-safe.
