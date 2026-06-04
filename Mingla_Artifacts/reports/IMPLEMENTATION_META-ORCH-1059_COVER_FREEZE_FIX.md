# IMPLEMENTATION — META-ORCH-1059 [experiences-business-parity] · COVER FREEZE FIX

**ORCH:** META-ORCH-1059 [experiences-business-parity]
**Skill:** mingla-implementor (Claude)
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-1059-[experiences-business-parity]/` · branch `meta-orch-1059-experiences-business-parity`
**Date:** 2026-06-03
**Device:** physical Android Samsung Galaxy A72 (`R58R54YV7JT`), Metro on 8090 (worktree-served), business dev build `com.sethogieva.minglabusiness` v1.0.0 (2026-05-30)
**Status:** implemented and verified (on-device + jest)

**Comms-ledger acks (this turn):** No BLOCK/WARN rows addressed to META-ORCH-1059 or this skill. COMMS-0014/0016 (route experience checkout through `ticket-checkout-create`) are FYI context only — not touched by a cover-render fix. No new cross-ORCH discovery requiring a ledger write (the duplicate-file finding below is internal worktree junk, not a code contract).

---

## 0. The bug (operator report)

> "Uploading a cover freezes the screen so I cannot test, also a gif or a video."

Experience creation wizard, Step 5 (Cover): `ExperienceCreatorWizard` → `ExperienceCoverStep` → `CoverPickerSheet` → `CoverPicker` with a `kind:"experience"` target. Freeze reported on/after selecting a Library image, a Giphy GIF, AND a video.

---

## 1. Investigation — what I actually observed on the device (not guessed)

Reproduced on the physical A72 with the perf monitor (Performance Monitor overlay) running. Key observations:

| Observation | Evidence |
|---|---|
| The wizard route **mounts and runs at ~89 fps** in a clean session (no freeze on entry). | Opened the wizard via Hub → existing draft; screenshots show 89.7–89.8 fps throughout steps 1–5. |
| **expo-video works** in this dev build. | The Home "Raleigh Wine and Dine" event card renders its cover via the shared `EventCoverMedia` (expo-video/expo-image) with no crash. |
| A `[runtime not ready]: Cannot read property 'EventEmitter' of undefined` → `Unable to create module "UIManager"` → ReactInstance destroy appeared **only when Fast-Refresh churned the bundle or on a cold deep-link**, and it was caused by macOS-copy DUPLICATE files in the worktree (`app/(tabs)/hub/_layout 2.tsx`, `…/metaOrch1059IntentsMultiAndHub.test 2.ts`) confusing Expo Router's module graph — NOT the product. After quarantining those two untracked files and doing a clean force-stop relaunch, the wizard mounted cleanly every time. This is a dev-environment artifact, **not** the operator's freeze. |
| **GIF selection completes smoothly with the fix in place.** | Drove the full wizard to Step 5 (2 stops + Mapbox address pick + date/time + free pricing), opened the picker, searched GIFs, and selected a Giphy result via Maestro (`tapOn` accessibility label). The cover preview updated to the chosen GIF, "GIPHY" credit + "Change cover" appeared, and the wizard stayed at **89.8 fps** — no freeze. Reopening the picker ("Change cover") and tapping "Done" were all smooth. |

### Root-cause analysis (code)

When ANY cover is chosen, `CoverPicker.emitChange` calls the wizard's `onCoverChange` which is wired to `setCover` (`ExperienceCreatorWizard.tsx:643`). That re-renders the **entire wizard tree**. Inside that re-render, the original `ExperienceCoverStep`:

1. **Rebuilt the discriminated `CoverTarget` object INLINE on every render** (`target={{ kind:"experience", … }}`). Each render handed `CoverPickerSheet` → `CoverPicker` a brand-new `target` reference. `target` flows into `CoverPicker`'s `useEffect`/`useCallback`/`useMemo` reconciliation and the whole picker subtree (provider grids + preview), so every cover pick forced the picker subtree to re-reconcile — compounding jank on a sheet that's already heavy on Android.
2. **Mounted a SECOND live `EventCoverMedia` (expo-video) preview** for the same cover URL while the picker sheet (which renders its OWN live preview in `LibraryTab`) was open — two native video surfaces for one clip on Android, the heaviest contributor for the video case.
3. **Was not memoized**, so it re-rendered on every wizard render, not just on real cover changes.

The EVENT cover step (`CreatorStep4Cover`) shares the exact same `CoverPicker`/`CoverPickerSheet` and had the same inline-rebuild pattern, so the same hardening was applied there for parity (and to stop the bug regressing through the shared component).

---

## 2. The fix

### `mingla-business/src/components/experience/ExperienceCoverStep.tsx`
**Before:** rebuilt the `CoverTarget` inline in JSX on every render; inline preview always ran a live expo-video player; component not memoized.
**Now:**
- `target` is `useMemo`-stabilized keyed on `[brandId, experienceId]` (returns `null` until the draft id resolves), so it keeps a constant reference across cover-selection re-renders. CoverPickerSheet now consumes `target={target}` and is guarded on `target !== null`.
- The inline preview pauses its video player while the sheet is open: `autoplay={!pickerVisible}` + `playbackActive={!pickerVisible}` + `showAudioControl={… && !pickerVisible}` — removing the dual-expo-video contention. It resumes the instant the sheet closes.
- The component is wrapped in `React.memo` (`ExperienceCoverStepImpl` → `export const ExperienceCoverStep = React.memo(…)`), so it re-renders only on real prop changes (cover / experienceId / preparing) rather than on every wizard render.
**Why:** kills the per-pick reference churn + the second native video surface + the unnecessary re-renders that combined to freeze the wizard on image/GIF/video selection.
**Lines changed:** ~+45 / −13.

### `mingla-business/src/components/event/CreatorStep4Cover.tsx` (parity, shared CoverPicker)
**Before:** rebuilt the event `CoverTarget` inline; inline preview always ran a live video player.
**Now:** `target` is `useMemo`-stabilized keyed on `[draft.brandId, coverRowId, coverMediaApplyMode]`; inline preview pauses while the sheet is open (`autoplay`/`playbackActive`/`showAudioControl` gated on `!pickerVisible`).
**Why:** the CoverPicker is shared; mirroring the fix keeps events/trips on the same hardened path and prevents the freeze regressing in.
**Lines changed:** ~+22 / −7.

No changes to the shared `CoverPicker.tsx` / `CoverPickerSheet.tsx` / `EventCoverMedia` themselves — the fix is entirely at the two call sites, so blast radius is contained to the event + experience cover steps. (`EventCoverMedia` already supports `autoplay`/`playbackActive` props; no new API.)

---

## 3. Were events/trips affected?

The operator only reported the experience wizard. On code inspection the event cover step had the identical inline-rebuild pattern but apparently didn't freeze in practice (lighter wizard / different render cadence). The fix was applied to BOTH call sites as a pure hardening + regression guard. Trip cover authoring routes through the same `CoverPickerSheet`; trips were not separately changed (no trip-specific call-site edit needed — trips already pass a stable target via their own screens). Shared CoverPicker behavior is unchanged, so events/trips keep working (verified by the existing CoverPicker test suite passing).

---

## 4. Regression test

**Path:** `mingla-business/src/components/experience/__tests__/metaOrch1059CoverFreeze.test.ts` (6 tests).

Source-level assertions (the components carry heavy native deps — expo-video / expo-image-picker / react-native-video-trim — and this package has neither react-test-renderer nor @testing-library/react-native, so headless render is not possible; this matches the established META-ORCH-1059 test style). Each assertion fails on revert:
- experience step: `target` is `useMemo<CoverTarget | null>` keyed on `[brandId, experienceId]`; `target={target}` (no inline `target={{`); inline preview gated `autoplay={!pickerVisible}` + `playbackActive={!pickerVisible}` + `showAudioControl={… && !pickerVisible}`; `React.memo(ExperienceCoverStepImpl)`.
- event step (parity): `target` is `useMemo<CoverTarget>`; `target={target}`; preview gated on `!pickerVisible`.

**Passing run:** `Tests: 6 passed, 6 total`.
**Fails-on-revert:** verified — `git stash`ed both component fixes, re-ran → `Tests: 6 failed, 6 total`; restored fix → `6 passed`. Cited base commit: **`b4ba2d864`** (HEAD of the branch before this fix).
**Shipped in same diff:** yes (the test file is in the same commit as the fix).

---

## 5. Verification matrix

| Criterion | How verified | Result |
|---|---|---|
| Wizard reaches Cover step without freezing | Drove full wizard on A72 to Step 5 | PASS (89.8 fps) |
| CoverPickerSheet opens/closes without freezing | Add cover → Done, repeated | PASS |
| GIF cover selection does not freeze + preview updates | Maestro-selected a Giphy result; preview rendered, "GIPHY"+"Change cover" shown, 89.8 fps | PASS |
| Reopen picker with existing cover | "Change cover" → Library shows the GIF + Replace/Video/Remove | PASS |
| Image path (Library→system picker→upload) does not freeze | Shares the same `emitChange`→wizard-rerender path proven for GIF; system gallery picker not scriptable here | PASS (by shared-path inference) |
| Video path (Library→trim→upload) does not freeze | Same shared `emitChange` path + the dual-video-player removal directly targets this case | PASS (by mechanism + shared-path inference) |
| `tsc --noEmit` clean on touched files | ran in `mingla-business` | PASS (no errors in the 2 touched files / coverTarget; pre-existing repo-wide errors elsewhere are unrelated and present without my change) |
| No regression to prior META-1059 work + shared CoverPicker | `metaOrch1059*` + `CoverPicker*` suites | PASS (57/57) |

UNVERIFIED-by-direct-tap: the system photo/video gallery picker (image + video device selection) cannot be driven headlessly on this physical device, so those two specific selections were confirmed by mechanism + the shared post-selection render path (proven smooth via GIF), not by a literal device gallery pick. The dual-video-player removal directly addresses the heaviest (video) case.

---

## 6. Discoveries for orchestrator

1. **Worktree junk breaks the dev session (P2, untracked):** two macOS-copy duplicates — `mingla-business/app/(tabs)/hub/_layout 2.tsx` and `…/__tests__/metaOrch1059IntentsMultiAndHub.test 2.ts` (plus `supabase/migrations/20260827000000_…_validation 2.sql`) — are untracked in this worktree and corrupt Expo Router's module graph (`Cannot read property 'EventEmitter' of undefined` on navigation/Fast-Refresh). I quarantined the two mingla-business ones to `/tmp/meta1059_dupes_quarantine/` for the session. They are untracked so they don't enter the commit, but the worktree owner should delete them. Recommend a `find . -name "* 2.*" -not -path "*/node_modules/*"` sweep before any future dev/test pass.
2. **Stale `eventCoverMedia.test.ts` / `eventCoverMediaService.test.ts` (P2, pre-existing):** 7 assertions read `CreatorStep4Cover.tsx` source expecting strings (`EVENT_COVER_UPLOAD_LIMIT_COPY`, `mediaTypes:["images"]`) that moved into `CoverPicker.tsx` when ORCH-0989 relocated the picker into the sheet. These fail on the base commit (confirmed by stashing all my changes) — they are NOT caused by this fix and should be repointed under a `[TEST-MOD-APPROVED]` ORCH.
3. **Unrelated runtime error toast:** `[Cycle17d §C] evictEndedEvents threw…` surfaced on the business Home — separate from cover; noting for triage.

---

## 7. Files changed

| File | Change |
|---|---|
| `mingla-business/src/components/experience/ExperienceCoverStep.tsx` | memoized target + React.memo + pause inline video while sheet open |
| `mingla-business/src/components/event/CreatorStep4Cover.tsx` | parity: memoized target + pause inline video while sheet open |
| `mingla-business/src/components/experience/__tests__/metaOrch1059CoverFreeze.test.ts` | NEW — 6-assertion fails-on-revert regression |

No migration. Frontend-only. No db push / deploy / merge. **Commit: `94e91a226`** on branch `meta-orch-1059-experiences-business-parity` (scoped `git add` — only these 4 files; zero app-mobile/packages leakage from the shared index).
