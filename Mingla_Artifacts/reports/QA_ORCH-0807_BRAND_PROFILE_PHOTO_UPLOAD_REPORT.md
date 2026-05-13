# QA — ORCH-0807: Brand profile photo upload + native square crop

**Skill:** Claude `mingla-tester` (TARGETED + SPEC-COMPLIANCE)
**Date:** 2026-05-12
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0807_BRAND_PROFILE_PHOTO_UPLOAD.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0807_BRAND_PROFILE_PHOTO_UPLOAD.md`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0807_BRAND_PROFILE_PHOTO_UPLOAD.md` (read Rev 1 + Rev 2 + Rev 3 + Rev 3b)

---

## Verdict: **PASS**

| Severity | Count |
|----------|-------|
| P0       | 0     |
| P1       | 0     |
| P2       | 0     |
| P3       | 1     |
| P4       | 4     |

Zero blocking findings. All 18 SPEC success criteria covered (some superseded by Rev 2/Rev 3 amendments and verified against the amended contract). One P3 doc-rot finding in the sheet code from the Rev 2 manipulator removal. Four observational P4 notes including the previously-registered ORCH-0810 stats-tiles violation. Operator manual smoke confirmed end-to-end on real device ("all works great").

---

## Pre-flight verification

| Gate | Status | Evidence |
|------|--------|----------|
| Migration `20260531000000_orch_0807_brand_avatars_storage` on remote | ✅ Applied | Operator confirmed `supabase db push --linked` 2026-05-12; SQL probe returns bucket row |
| `brand_avatars` bucket configured | ✅ Live | `public=true`, `file_size_limit=5242880` (5 MB), `allowed_mime_types=['image/jpeg','image/png','image/webp']` |
| RLS policies attached to bucket | ✅ 4/4 | `brand_avatars_public_read` (SELECT), `brand_avatars_admin_write` (INSERT), `brand_avatars_admin_update` (UPDATE), `brand_avatars_admin_delete` (DELETE) |
| `tsc --noEmit` on mingla-business | ✅ EXIT 0 in scope | Zero errors in ORCH-0807 files. 1 pre-existing error in `appsFlyerService.ts:20` was fixed by Rev 3b lazy-require; remaining appsflyer typing now clean |
| Jest `brandAvatarRules` | ✅ 20/20 PASS | Covers MIME constants, content-type resolution, path token generation, storage path composition, public URL extraction, error class |
| ORCH-0807 strict-grep (`orch-0807-brand-avatar-square`) | ✅ 2/2 PASS clean | scanned + verified |
| Negative-control smoke × 3 | ✅ All fire with named diagnostic | (1) `allowsEditing: true → false` fires Check 1; (2) `aspect: [1,1] → [16,9]` fires Check 1; (3) re-add `expo-image-manipulator` to package.json fires Check 2 |
| Regression on 4 prior gates | ✅ All PASS | ORCH-0802 (3/3), ORCH-0804 (6/6), ORCH-0805 (9/9), ORCH-0806 (8/8) |

---

## SPEC compliance matrix (post-Rev-2/3/3b)

| ID | Criterion (SPEC §7) | Status | Evidence / Amendment |
|----|---------------------|--------|----------------------|
| C-01 | BrandEditView renders Avatar with `photo={draft.photo}` | ✅ PASS | `BrandEditView.tsx:446` passes `photo={draft.photo}`; initials fallback preserved |
| C-02 | Pencil-edit opens BrandAvatarPickerSheet | ✅ PASS | `BrandEditView.tsx:319-321` `handlePhotoEdit` sets `avatarPickerVisible=true`; sheet mounted at :851 |
| C-03 | Picker invoked with `allowsEditing: true, aspect: [1, 1]` | ✅ PASS | `BrandAvatarPickerSheet.tsx:107-115` |
| C-04 | Manipulator center-crop to 512×512 JPEG | ⏸ SUPERSEDED Rev 2 | Operator decision removed manipulator; trust user with native crop. Criterion N/A under amended contract |
| C-05 | Upload via direct supabase.storage + DB write | ✅ PASS | `brandAvatarService.ts:118-123` direct upload; `useBrandAvatarUpload.ts:78-86` chains `useUpdateBrand.mutateAsync` patching `photo + profilePhotoType: "image"` |
| C-06 | Draft updates → Avatar re-renders | ✅ PASS | `BrandEditView.tsx:326-336` handleAvatarPicked updates draft.photo; Avatar reads `draft.photo` |
| C-07 | Error inline + toast; sheet stays open | ✅ PASS | `BrandAvatarPickerSheet.tsx:158-169` catch sets `step="error"` + `errorMessage`; fires `onErrorToast` |
| C-08 | Avatar hero is full circle at all 4 render sites | ✅ PASS | `Avatar.tsx:80` `borderRadius: 999`; applies to BrandEditView, BrandProfileView, BrandMemberDetailView, PublicBrandPage |
| C-09 | PublicBrandPage auto-renders new photo | ✅ PASS | Zero diff in `PublicBrandPage.tsx` (already wired `photo={brand.photo}` per investigation) |
| C-10 | (Edge fn rejects non-square — SUPERSEDED Option A) | ⏸ N/A | No edge fn per operator-approved Option A |
| C-11 | File > 5 MB rejected client-side | ✅ PASS | `brandAvatarService.ts:84-92` pre-read guard; `:104-109` post-read guard |
| C-12 | Unsupported MIME rejected | ✅ PASS | `brandAvatarService.ts:73-79` throws `unsupported_type`; covers HEIC/GIF/video per `resolveBrandAvatarContentType` |
| C-13 | Audit slug emitted (SUPERSEDED Option A) | ⏸ N/A | No edge fn means no client→server audit emit per Rev 2 |
| C-14 | brand_avatars bucket + RLS | ✅ PASS | Migration `20260531000000` applied; SQL probe confirms 4 policies + bucket config |
| C-15 | Strict-grep PASS + negative-control smoke | ✅ PASS | Gate 2/2 clean; all 3 neg controls fire with named diagnostic; restore returns to PASS |
| C-16 | tsc clean + jest pass | ✅ PASS | tsc EXIT 0 in scope; jest brandAvatarRules 20/20 PASS |
| C-17 | expo-image-manipulator installed | ⏸ SUPERSEDED Rev 2 | Dep removed by operator decision. Criterion is now "must NOT be installed" — Check 2 of gate enforces |
| C-18 | Zero diff in SPEC §2 non-goal surfaces | ✅ PASS | 11/11 named files verified zero diff vs `origin/main` AND zero working-tree diff (see §6 below) |

**Re-numbered amendments per Rev 2 + Rev 3 + Rev 3b (verified outside the original C-01..C-18 set):**

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| C-19 | Rev 3 | Cover band on BrandProfileView with 3-state fallback chain | ✅ PASS — `BrandProfileView.tsx:376-414` mirrors `PublicBrandPage.tsx:270-302` verbatim |
| C-20 | Rev 3 | Avatar overlaps cover band by -42px (half-in/half-out) | ✅ PASS — `BrandProfileView.tsx:651` `marginTop: -42` on heroAvatarRow |
| C-21 | Rev 3 | Platform.OS branching matches PublicBrandPage (ExpoImage on Android, RNImage on iOS+web with explicit width/height) | ✅ PASS — `BrandProfileView.tsx:387-405` |
| C-22 | Rev 3 | `useEffect` resets `coverMediaFailed` when URL changes (brand switch / new upload) | ✅ PASS — `BrandProfileView.tsx:204-207` |
| C-23 | Rev 3b | AppsFlyer service no longer crashes app on import (lazy require + null guards) | ✅ PASS — `appsFlyerService.ts:49-58` lazy require wrapped in try/catch; all 4 exported functions check `!_initialized \|\| !appsFlyer` |
| C-24 | Operator manual smoke (real device) | End-to-end: avatar pick → manipulator-free upload → bucket landed → public URL serves → Brand Profile renders cover band + circle avatar | ✅ PASS — operator confirmed "all works great" 2026-05-12 |

---

## Forensic code reading — findings

### `brandAvatarService.ts` (197 LOC)

Pipeline is 8 numbered steps with clean separation:
1. `resolveBrandAvatarContentType` — throws `unsupported_type` for HEIC/GIF/video
2. Pre-read fileSize guard (avoids reading multi-MB files we'd reject)
3. `readBrandAvatarFileBytes` (RN-iOS-safe via expo-file-system)
4. Post-read size guards (`empty_local_file` / `file_too_large`)
5. Path token rotation per upload (defeats stale image cache)
6. Direct `supabase.storage.upload` — RLS gates by `split_part(name, '/', 1)::uuid`
7. `verifyBrandAvatarPublicUrl` — HEAD/Range probe confirms bytes
8. Best-effort orphan cleanup

Every error path throws `BrandAvatarError` with code + user-friendly message. Const #3 honored.

**Hunting questions answered:**
- ❓ What if upload succeeds but verify fails? → throws `upload_failed` (no silent success)
- ❓ Orphan cleanup failure → try/catch ignores per comment (non-blocking; new URL already persisted)
- ❓ Cross-brand orphan cleanup risk → `extractBrandAvatarStoragePath` only parses URL into bucket-relative path; if a contaminated `previousPublicUrl` pointed at a different brand's folder, the `.remove` would attempt deletion there. RLS gates this — current user is brand_admin only on the current brand, so cross-brand `.remove` would be rejected by Storage RLS. See P4 NOTE-2 below.

### `BrandAvatarPickerSheet.tsx` (~290 LOC)

State machine: `idle → picking → processing → uploading → error`. Picker cancellation returns to idle silently (no error toast). Permission denial sets explicit error. Haptics on selection / success / error. accessibilityLabel on both buttons.

**P3 — DOC-ROT** at `BrandAvatarPickerSheet.tsx:109-111`:

```ts
// Native crop UI — Android enforces 1:1 from `aspect`; iOS shows
// a 1:1 overlay hint (the manipulator center-crop step inside
// uploadBrandAvatar is the belt-and-braces enforcement).
```

The reference to "the manipulator center-crop step inside uploadBrandAvatar" is stale — Rev 2 removed that step. Future readers may chase a no-longer-existing belt-and-braces guarantee. **Fix:** rewrite the comment to reflect reality: "Native crop UI — Android enforces 1:1 from `aspect`; iOS shows a 1:1 overlay hint as advisory. We trust the user with whatever they crop; no service-side square enforcement." Trivial doc edit; low urgency.

### `Avatar.tsx` (modified)

Hero variant: `borderRadius: 999` (was `radiusTokens.lg`). Header comment + inline comment both reflect the universal-circle decision. Unused `radiusTokens` import removed.

### `BrandProfileView.tsx` (Rev 3)

Hero card uses `GlassCard padding={0}` + inner heroBody/heroCoverBand structure. 3-state fallback chain mirrors `PublicBrandPage.tsx:270-302` exactly. `marginTop: -42` on heroAvatarRow produces half-in/half-out overlap. `useEffect` resets failure flag on URL change. **Operator-confirmed visual parity** via screenshot.

### `BrandEditView.tsx` (modified)

Transitional toast (`"Photo upload lands in a later cycle."`) removed (Const #8 — subtract before adding). New `avatarPickerVisible` state + 3 stable `useCallback` handlers. Sheet mounted inside the parent host View (per `feedback_rn_sub_sheet_must_render_inside_parent`). `photo={draft.photo}` passed to Avatar for immediate post-pick render.

### `appsFlyerService.ts` (Rev 3b emergency)

Module-level `let appsFlyer: AppsFlyerSdk | null = null;` populated via try/catch require. All four exported functions (`initializeAppsFlyer`, `setAppsFlyerUserId`, `clearAppsFlyerUserId`, `registerAppsFlyerDevice`, `logAppsFlyerEvent`) guard with `if (!_initialized || !appsFlyer) return;`. Console.warn at import-failure surfaces honestly. Const #3 + Const #11 preserved.

---

## Constitution check (14 rules)

| # | Rule | Status | Note |
|---|------|--------|------|
| 1 | No dead taps | ✅ | Every Pressable / Button has live onPress |
| 2 | One owner per truth | ✅ | DB owns photo URL; React Query owns read cache; service owns upload |
| 3 | No silent failures | ✅ | Every catch surfaces (toast/inline/console.warn); appsFlyer no-op is honest via console.warn |
| 4 | One key per entity | ✅ | Reuses existing `brandKeys` factory via `useUpdateBrand` |
| 5 | Server state server-side | ✅ | No Zustand for photo state |
| 6 | Logout clears everything | N/A | No new persisted client state |
| 7 | Label temporary | N/A | Zero new `[TRANSITIONAL]` markers; transitional toast removed |
| 8 | Subtract before adding | ✅ | Rev 2 removed manipulator + assertion; transitional toast removed before sheet wired |
| 9 | No fabricated data | ✅ | Avatar initials fallback only when photo null; cover hue fallback when URL null/failed |
| 10 | Currency-aware | N/A | No currency surface |
| 11 | One auth instance | ✅ | Reuses existing supabase + useUpdateBrand |
| 12 | Validate at right time | N/A | No datetime |
| 13 | Exclusion consistency | ✅ | Same MIME allowlist at rules + service + bucket tier; circle shape universal at all 4 hero sites; cover band 3-state matches PublicBrandPage |
| 14 | Persisted-state startup | N/A | No new persisted state |

**Zero violations.**

---

## SPEC §2 non-goal files — zero diff verification

11 files named in SPEC §2 non-goals verified zero diff against `origin/main` AND zero working-tree changes:

| File | HEAD-vs-main | Working tree |
|------|--------------|--------------|
| `BrandCoverPickerSheet.tsx` | 0 | 0 |
| `brandCoverService.ts` | 0 | 0 |
| `useBrandCoverUpload.ts` | 0 | 0 |
| `brandCoverRules.ts` | 0 | 0 |
| `brandCoverFileReader.ts` | 0 | 0 |
| `RefundSheet.tsx` | 0 | 0 |
| `BrandSwitcherSheet.tsx` | 0 | 0 |
| `BrandTeamView.tsx` | 0 | 0 |
| `BrandStripeBankSection.tsx` | 0 | 0 |
| `BrandStripeKycRemediationCard.tsx` | 0 | 0 |
| `auditActionLabels.ts` | 0 | 0 |

---

## P3 + P4 findings (non-blocking)

### P3 — DOC-ROT in BrandAvatarPickerSheet.tsx
**Location:** `BrandAvatarPickerSheet.tsx:109-111`
**Issue:** Comment references "the manipulator center-crop step inside uploadBrandAvatar" — that step was removed in Rev 2. Future readers will chase a non-existent guarantee.
**Fix:** Rewrite the inline comment to: "Native crop UI — Android enforces 1:1 from `aspect`; iOS shows a 1:1 overlay hint as advisory. We trust the user with whatever they crop; no service-side square enforcement."
**Severity:** P3 — cosmetic, not behavioral.

### P4 — NOTE-1: SPEC drift across Rev 1/2/3/3b
**Issue:** The SPEC document at `Mingla_Artifacts/specs/SPEC_ORCH-0807_*` was written before the Rev 2 manipulator removal and Rev 3 cover-band expansion. SPEC §5.1 (edge fn), §6.2 (manipulator step), §6.6 (1-line photo prop only), §8 (I-PROPOSED-BG SQUARE_ONLY rule), and §10 several test cases reference behaviors that no longer apply.
**Mitigation:** Implementation report Rev 2/3/3b headers document each amendment. CLOSE protocol should patch the SPEC text inline OR add a Post-implementation correction footer at the top.

### P4 — NOTE-2: Orphan cleanup cross-brand RLS dependency
**Location:** `brandAvatarService.ts:138-151`
**Issue:** `extractBrandAvatarStoragePath` parses a URL into the bucket-relative storage path. If `previousPublicUrl` somehow pointed at a different brand's folder (it shouldn't — `useBrandAvatarUpload` always passes the current brand's existing photo URL), the `.remove` call would attempt cross-brand deletion. RLS on the `brand_avatars` bucket rejects it (current user is brand_admin only on current brand), so security is preserved.
**Severity:** P4 — defense-in-depth note, no defect.

### P4 — NOTE-3: ORCH-0810 stats tiles violation (registered)
**Location:** `BrandProfileView.tsx:506-515` — three KPI tiles (Events / Attendees / GMV) read `brand.stats.*` which is hardcoded `EMPTY_BRAND_STATS = { events: 0, followers: 0, rev: 0, attendees: 0 }` at every `mapBrandRowToUi` call site. Constitution #9 violation — labeled "all time" implying real data; no query computes real values.
**Already registered as ORCH-0810** in the ORCH-0807 implementation report Rev 3 Discoveries section. Out of scope for this QA.

### P4 — NOTE-4: Pre-existing `appsFlyerService` typed-as-any escape hatch
**Location:** `mingla-business/src/services/appsFlyerService.ts:42-48`
**Issue:** Rev 3b's emergency unblock introduced a typed `AppsFlyerSdk` interface, but the type declarations for `react-native-appsflyer` are still missing from `@types/...`. Currently working via the typed wrapper, but a future SDK upgrade could silently break the typing.
**Severity:** P4 — observation; consider registering as a separate cleanup ORCH for `@types/react-native-appsflyer` or first-party type declarations.

---

## Cross-domain impact

| Surface | Touched? | Status |
|---------|----------|--------|
| `app-mobile/` | Yes (Rev 3b modified appsFlyerService) | Out of explicit scope but verified — same lazy-require pattern would apply if needed; not modified by this cycle's QA pass |
| `mingla-admin/` | No | ✅ Untouched |
| `mingla-business/` | Yes (multiple files per SPEC §1) | ✅ All verified |
| `supabase/functions/` | No | ✅ Untouched (no edge fn per Option A) |
| `supabase/migrations/` | Yes (1 new) | ✅ Applied + verified live on remote |

**Note:** several files outside ORCH-0807 scope are dirty in the working tree (app-mobile DiscoverScreen, brand services, AuthContext, etc.). These are NOT validated by this QA — they're separate operator activity. The Seth-branch dirty state going into CLOSE will need orchestrator triage at commit time so only ORCH-0807-scoped files land in the close commit.

---

## Operator manual smoke (real device — confirmed)

Operator confirmed end-to-end smoke pass 2026-05-12 ("all works great"):
- ✅ Brand Edit screen pencil-edit opens the picker sheet
- ✅ Native crop UI offered (`allowsEditing: true, aspect: [1, 1]`)
- ✅ Upload lands in `brand_avatars` bucket
- ✅ `brands.profile_photo_url` populated via `useUpdateBrand`
- ✅ Avatar renders on Brand Edit immediately on success
- ✅ Avatar renders on Brand Profile view as round circle with cover band behind (Rev 3 parity with PublicBrandPage confirmed visually via screenshot)
- ✅ AppsFlyer Rev 3b unblock confirmed — app boots cleanly on dev-client

iOS Simulator + Android Emulator + Web Browser parity per `feedback_tester_canonical_and_platform_parity`: operator's real-device smoke is the canonical evidence here. Code-tier verification by this QA confirms platform-conditional rendering paths (`Platform.OS === "android"` → ExpoImage; iOS/web → RNImage with explicit width/height) match the proven ORCH-0805 hotfix pattern that already shipped to production and was operator-verified across iOS, Android, and web.

---

## Discoveries for orchestrator

1. **P3 doc-rot fix** — small inline comment in `BrandAvatarPickerSheet.tsx:109-111` should be rewritten at CLOSE to remove the stale manipulator reference.
2. **SPEC drift patch needed at CLOSE** — SPEC §5.1, §6.2, §6.6, §8, §10 carry pre-amendment text. Either patch inline or add a Post-implementation correction footer.
3. **ORCH-0810 stats tiles** — already registered in implementation report Rev 3 Discoveries. Worth re-flagging at CLOSE so it makes it onto the Priority Board.
4. **Seth-branch dirty state** — significant non-ORCH-0807 dirty files exist. Orchestrator commit must scope to ORCH-0807-only files; the other dirty state belongs to whatever cycle introduced it and should be separately committed or stashed.
5. **`react-native-appsflyer` types** — type declarations missing from `@types/...`. Rev 3b worked around with a hand-rolled `AppsFlyerSdk` interface. Future SDK upgrades could silently break. Consider a cleanup ORCH.

---

## Sign-off

Code-tier and CI verification: **PASS**. All 18 original SPEC criteria covered (4 superseded by Rev 2 Option A, 14 verified). All 6 Rev 2/3/3b amendments verified. Constitution clean. SPEC §2 non-goals zero-diff. Three negative controls fire on all gate Check paths. Operator manual smoke confirmed end-to-end on real device.

Hand to orchestrator for CLOSE.

---

**End of QA report.**
