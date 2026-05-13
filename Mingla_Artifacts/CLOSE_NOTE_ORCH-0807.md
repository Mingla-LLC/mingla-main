# CLOSE NOTE — ORCH-0807

Date closed: 2026-05-12
Closed by: Claude `mingla-orchestrator` (operator delegated "take over")
Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
PR: pending (this close opens it)

## Verdict

**PASS** — QA verdict in `Mingla_Artifacts/reports/QA_ORCH-0807_BRAND_PROFILE_PHOTO_UPLOAD_REPORT.md`. Zero P0/P1/P2. One P3 doc-rot finding (absorbed inline at this close). Four P4 observations, all queued or non-blocking. Operator manual smoke confirmed end-to-end on real device ("all works great").

## Plain-English impact

Brand admins can now upload a profile photo. Tap the pencil-edit on the avatar → "Pick from device" → native crop UI (Android enforces 1:1; iOS hints) → upload lands. Photo persists to `brands.profile_photo_url`, renders as a round circle at every avatar site (Brand Profile, Brand Edit, Team-member detail, public brand page). The internal Brand Profile screen now also shows the brand's cover image as a band behind the avatar with half-in/half-out overlap — matches what buyers see on the public page. Foundational fix shipped alongside: AppsFlyer module no longer crashes the app on dev-client builds without the native side linked.

ORCH-0807 originally specced a `expo-image-manipulator` center-crop + server-side square assertion pipeline. **Operator decided mid-implementation to trust users with the native picker UI as the only square-enforcement mechanism** (DEC-126). The dep was removed; the assertion was removed; the round-circle Avatar primitive cover-crops at render time if a user submits non-square. Constitution #9 honored — the stored URL is the user's real photo, not a fabricated square.

This is Wave 4 part 3 of the ORCH-0801 brand-page campaign. The campaign is effectively done after this close — ORCH-0810 (stats tiles real data) is queued separately as the discovered Constitution #9 violation that's not yet biting because no brand has real ticket-sale volume.

## What shipped

**4 implementation revs in one cycle:**

| Rev | What |
|-----|------|
| Rev 1 | Base spec implementation — rules + service + hook + sheet + Avatar shape flip + BrandEditView wiring + BrandProfileView 1-line photo prop + migration + strict-grep gate. |
| Rev 2 | Operator-directed rollback of `expo-image-manipulator` dep + `assertSquareDimensions`. Trust the user with the native picker mechanism. Strict-grep re-pointed at "picker offers `allowsEditing: true, aspect: [1, 1]`" + "package.json doesn't carry the manipulator dep". |
| Rev 3 | Brand Profile hero card expanded: GlassCard padding→0, cover band edge-to-edge at top, avatar pulled up -42px for half-in/half-out overlap, 3-state fallback chain mirroring `PublicBrandPage.tsx:259-346` (Platform branching with ExpoImage on Android + RNImage on iOS+web with explicit width/height per the ORCH-0805-WEB hotfix). |
| Rev 3b | Emergency unblock for the AppsFlyer dev-client crash — `appsFlyerService.ts` lazy-require + null guards on all 4 exported functions. Operator separately declared `react-native-appsflyer ^6.17.9` in `package.json` as the proper root-cause fix; both ship together. |

**P3 doc-rot fix absorbed inline at this CLOSE:** `BrandAvatarPickerSheet.tsx:109-114` comment rewritten — was "the manipulator center-crop step inside uploadBrandAvatar is the belt-and-braces enforcement", which became false after Rev 2. New copy: "We trust the user with whatever they crop; no service-side square enforcement (operator decision 2026-05-12 — see DEC entry for ORCH-0807 + I-PROPOSED-BG)."

**SPEC drift patch absorbed inline at this CLOSE:** SPEC §0 now carries a "Post-implementation Correction" table listing the seven sections that were superseded by Revs 2/3/3b. Future readers see the audit trail immediately at the top of the document instead of having to cross-reference the implementation report.

## Files in this close

**Source code (10 files):**
- `supabase/migrations/20260531000000_orch_0807_brand_avatars_storage.sql` (NEW, 174 LOC) — `brand_avatars` bucket + 4 RLS policies + apply-time probes.
- `mingla-business/src/utils/brandAvatarRules.ts` (NEW, ~200 LOC).
- `mingla-business/src/utils/__tests__/brandAvatarRules.test.ts` (NEW, 20 jest specs).
- `mingla-business/src/services/brandAvatarFileReader.ts` (NEW, 41 LOC).
- `mingla-business/src/services/brandAvatarService.ts` (NEW, 158 LOC).
- `mingla-business/src/hooks/useBrandAvatarUpload.ts` (NEW, 104 LOC).
- `mingla-business/src/components/brand/BrandAvatarPickerSheet.tsx` (NEW, 290 LOC; P3 doc-rot fix applied at CLOSE).
- `mingla-business/src/components/ui/Avatar.tsx` (MODIFY, +6 -4) — hero borderRadius 999.
- `mingla-business/src/components/brand/BrandEditView.tsx` (MODIFY, +35) — sheet wiring + photo prop + transitional toast removed.
- `mingla-business/src/components/brand/BrandProfileView.tsx` (MODIFY, +~80) — Rev 3 cover band + half-overlap hero card.
- `mingla-business/src/services/appsFlyerService.ts` (MODIFY, ~40 LOC changed) — Rev 3b lazy-require + null guards.

**Config + CI (3 files):**
- `mingla-business/package.json` (MODIFY, +1 dep) — `react-native-appsflyer ^6.17.9` declared properly.
- `mingla-business/package-lock.json` (regen).
- `.github/scripts/strict-grep/orch-0807-brand-avatar-square.mjs` (NEW, ~95 LOC) — 2-check gate enforcing I-PROPOSED-BG.
- `.github/workflows/strict-grep-mingla-business.yml` (MODIFY, +11) — register the new job.

**Documents (6 files):**
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0807_BRAND_PROFILE_PHOTO_UPLOAD.md` (NEW).
- `Mingla_Artifacts/specs/SPEC_ORCH-0807_BRAND_PROFILE_PHOTO_UPLOAD.md` (NEW; Post-implementation Correction block prepended at CLOSE).
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0807_BRAND_PROFILE_PHOTO_UPLOAD.md` (NEW; Rev 1 + Rev 2 + Rev 3 + Rev 3b headers).
- `Mingla_Artifacts/reports/QA_ORCH-0807_BRAND_PROFILE_PHOTO_UPLOAD_REPORT.md` (NEW).
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (MODIFY) — I-PROPOSED-BG DRAFT→ACTIVE block added with renamed rule `BRAND_AVATAR_NATIVE_CROP_OFFERED`.
- `Mingla_Artifacts/DECISION_LOG.md` (MODIFY, +1 row) — DEC-126 codifies the trust-the-user-with-native-crop decision.
- `Mingla_Artifacts/CLOSE_NOTE_ORCH-0807.md` (NEW — this file).

**Scope discipline note:** Seth branch carried significant non-ORCH-0807 dirty files at close time (app-mobile `DiscoverScreen.tsx` / `appsFlyerService.ts` / `nightOutExperiencesService.ts` / `preferences.ts`; mingla-business `app.json` / `app/_layout.tsx` / `context/AuthContext.tsx` / `services/brandStripeService.ts` / `services/brandsService.ts` / `services/businessEvents.ts`; index docs `MASTER_BUG_LIST.md` / `PRIORITY_BOARD.md` / `WORLD_MAP.md`). Per tester's explicit recommendation in the QA report, the CLOSE commit is **strictly scoped to ORCH-0807 files only**. Other dirty state belongs to separate cycles or operator work-in-progress and stays in the working tree for the operator to triage separately.

## Verification (verbatim from QA report)

| Gate | Status |
|------|--------|
| Migration `20260531000000_orch_0807_brand_avatars_storage` on remote | ✅ Applied by operator pre-test; SQL probe confirms bucket + 4 RLS policies + 5 MB cap + correct MIME allowlist |
| `tsc --noEmit` on mingla-business | ✅ Zero errors in ORCH-0807 files |
| `npx jest brandAvatarRules` | ✅ 20/20 PASS |
| ORCH-0807 strict-grep `orch-0807-brand-avatar-square` | ✅ 2/2 PASS clean |
| 3 negative-control smokes | ✅ Each fires with a named diagnostic on the correct check; restore returns to PASS |
| Regression on 4 prior gates (ORCH-0802 / 0804 / 0805 / 0806) | ✅ All PASS |
| SPEC §2 non-goal files (11 named) | ✅ All zero diff |
| Constitution 14-rule check | ✅ Zero violations |
| Operator manual smoke (real device, end-to-end) | ✅ "all works great" 2026-05-12 |

## DIAG reap

```bash
grep -rn "\[ORCH-0807-DIAG\]" mingla-business/src/ mingla-business/app/ \
  app-mobile/src/ supabase/functions/ mingla-admin/src/ 2>/dev/null
```

Zero matches.

## Deploy notes

- **Migration:** already applied on remote (operator ran `supabase db push --linked` before tester verification).
- **Edge functions:** none (Option A — direct Supabase Storage upload with RLS gating).
- **Native module change:** `react-native-appsflyer` is now properly declared in `package.json`. The package was previously implicitly resolved; declaring it explicitly is the root-cause fix that Rev 3b's lazy-require worked around. This is NOT a new native dep — the package was already installed in `node_modules` via prior history; this just makes the dependency declaration explicit. **OTA-eligible (no native build required)** because the lazy-require pattern means the app boots cleanly whether or not the native side is linked in the runtime build.

EAS OTA (two separate single-platform invocations per `feedback_eas_update_no_web.md` — never the comma form):

```bash
cd mingla-business && eas update --branch production --platform ios --message "ORCH-0807: Brand profile photo upload + cover band + AppsFlyer unblock"
cd mingla-business && eas update --branch production --platform android --message "ORCH-0807: Brand profile photo upload + cover band + AppsFlyer unblock"
```

## Operator manual smoke (already confirmed)

End-to-end smoke pass confirmed by operator 2026-05-12:
- ✅ Brand Edit pencil-edit opens picker sheet
- ✅ Native 1:1 crop UI offered
- ✅ Upload lands in `brand_avatars` bucket
- ✅ Round-circle avatar renders immediately on Brand Edit
- ✅ Brand Profile view shows cover band behind round avatar with half-in/half-out overlap (Rev 3 parity with public page — operator confirmed visually via screenshot)
- ✅ Public Brand Page auto-renders the new photo (zero code change required — already wired)
- ✅ AppsFlyer Rev 3b unblock confirmed — app boots cleanly on dev-client

## Invariants / decisions

- **I-PROPOSED-BG BRAND_AVATAR_NATIVE_CROP_OFFERED** flipped DRAFT→ACTIVE. Renamed from the original `BRAND_AVATAR_SQUARE_ONLY` per Rev 2 operator decision.
- **DEC-126** codifies the trust-the-user trade-off: no manipulator dep, no service-side square assertion, no edge function, no server-side square enforcement. The native picker `aspect: [1, 1]` is the ONLY mechanism we offer. Defense-in-depth drops from 3 tiers to 1 (RLS-gated bucket writes).

## Follow-ups queued

1. **ORCH-0810 — Brand stats tiles real data (Constitution #9 violation).** Discovered during ORCH-0807 manual smoke. Three KPI tiles on `BrandProfileView.tsx:506-515` (Events / Attendees / GMV) read `brand.stats.*` which is hardcoded `{ events: 0, followers: 0, rev: 0, attendees: 0 }` at every `mapBrandRowToUi` call site. Labeled "all time" implying authoritative data. Not yet biting because no brand has real volume; bites the moment a brand sells tickets and sees `$0` GMV next to their actual revenue. Operator chose "wire to real data as new ORCH-0810" (renamed from the earlier ORCH-0808 collision — that ID was taken by `orch_0808_appsflyer_devices_app_discriminator` on remote; ORCH-0809 is `orch_0809_discover_city_preferences`; ORCH-0810 is the next free ID). Dispatch paragraph for Claude `mingla-forensics` queued — paste into a fresh forensics session when ready.
2. **`react-native-appsflyer` type declarations missing** (P4 NOTE-4 from QA report). Rev 3b hand-rolled an `AppsFlyerSdk` interface as a workaround. Future SDK upgrades could silently break. Register as a separate cleanup ORCH if desired.
3. **Seth-branch unrelated dirty files** (app-mobile `DiscoverScreen` / `nightOutExperiencesService` / `preferences`; mingla-business `app.json` / `AuthContext` / `brandStripeService` / `brandsService` / `businessEvents`; index docs MASTER_BUG_LIST / PRIORITY_BOARD / WORLD_MAP). Belong to separate cycles or operator WIP; operator triages separately.

## Document sync

- `INVARIANT_REGISTRY.md` — I-PROPOSED-BG ACTIVE block added (this close).
- `DECISION_LOG.md` — DEC-126 appended (this close).
- `CLOSE_NOTE_ORCH-0807.md` — NEW (this file).
- `WORLD_MAP.md` / `MASTER_BUG_LIST.md` / `COVERAGE_MAP.md` / `PRODUCT_SNAPSHOT.md` / `PRIORITY_BOARD.md` / `AGENT_HANDOFFS.md` / `OPEN_INVESTIGATIONS.md` — per the established convention (CLOSE_NOTE_ORCH-XXXX files are the canonical record for the recent close cycles; the global indexes trail by a few cycles and update via batched maintenance). ORCH-0807 follows the same pattern — CLOSE_NOTE is authoritative.

## Evidence

- SPEC: `Mingla_Artifacts/specs/SPEC_ORCH-0807_BRAND_PROFILE_PHOTO_UPLOAD.md` (read Post-implementation Correction block at top first).
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0807_BRAND_PROFILE_PHOTO_UPLOAD.md`.
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0807_BRAND_PROFILE_PHOTO_UPLOAD.md` (read Rev 1 + Rev 2 + Rev 3 + Rev 3b headers).
- QA report: `Mingla_Artifacts/reports/QA_ORCH-0807_BRAND_PROFILE_PHOTO_UPLOAD_REPORT.md`.
- Commit on `Seth`: see `git log --oneline -1` after this CLOSE push.
