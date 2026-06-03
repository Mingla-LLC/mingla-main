# IMPLEMENTATION — META-ORCH-1059 Sub-A · Stop-photo picker reuse + create-wizard footer bleed

**ORCH:** META-ORCH-1059 [experiences-business-parity] · Sub-A
**Skill:** mingla-implementor (Claude)
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-1059-[experiences-business-parity]/` on branch `meta-orch-1059-experiences-business-parity`
**Date:** 2026-06-02
**Status:** implemented and verified (tsc clean on touched files; regression test green + fails-on-revert)

---

## Scope (two operator-reported fixes)

1. **FIX 1** — per-stop "Photos" must use the app's EXISTING media picker (Library + GIFs + Photos), NOT raw `expo-image-picker`. No video tab/path for stops; multi-photo up to 5 per stop; returns public URLs into the stop's `imageUrls`.
2. **FIX 2** — create wizards' bottom Continue/Publish dock/footer must not bleed into the phone's bottom nav (Android gesture-nav + iOS home-indicator). Verify the already-applied experience-wizard fix; audit + fix the event and trip wizards.

No backend files touched (Giphy/Pexels edge functions already exist) → COMMS-0002 backend allowlist N/A. No migrations.

---

## Comms ledger

Read on entry. No `BLOCK`/`OPEN` rows target `mingla-implementor`, this skill, or META-ORCH-1059. COMMS-0002 (backend strict-grep allowlist) only applies if `supabase/functions/` files are added — none were. No new ledger entry needed (no cross-ORCH discovery beyond the pre-existing stale test noted below).

---

## FIX 1 — Integration approach

**Decision: build a focused `ExperienceStopPhotoSheet` (the dispatch's "Preferred" option)** rather than forking `CoverPicker`. `CoverPicker` is a heavy single-cover component carrying video upload (`useEventCoverVideoUpload` + trim editor), the 7-field `cover_media_*` persistence model, and brand/event/trip target routing — none of which fits stops (which own a plain `image_urls: string[]`, max 5, authored before any row exists, no video).

The new sheet REUSES, at the service level, exactly what CoverPicker uses:
- **GIFs tab** → `trendingGiphyCovers` (gallery-first) + `searchGiphyEventCovers` — GIPHY client-direct per ToS (`coverProviderBrowseService.ts`, `giphyEventCoverService.ts`).
- **Photos tab** → `curatedPexelsCovers` (gallery-first) + `searchPexelsEventCovers` — Pexels EDGE-PROXIED via `event-cover-pexels-curated` / `event-cover-pexels-search` (key stays server-side) (`coverProviderBrowseService.ts`, `pexelsEventCoverService.ts`).
- **Library tab** → device image/GIF upload via the brand-keyed `uploadExperienceStopImage` (`experienceStopImageService.ts`) — the author-time path that works before the experience row exists.

It presents the SAME three-tab segmented control, gallery-first browse, masonry grid, and the 5 provider states (idle/loading/populated/empty/error) as CoverPicker — minus the entire video path. No new external API surface (COMMS-0003 satisfied — services already docs-cited inline).

**Multi-select:** the Library picker uses `allowsMultipleSelection` + `selectionLimit: remaining` where `remaining = 5 − currentCount`, uploads sequentially, appends each verified URL, and never exceeds the cap. Provider (GIPHY/Pexels) selections add one URL per tap (single-tap-to-add, then sheet closes), gated so they no-op once the stop is full.

**Persistence model preserved:** chosen URLs flow `onAddPhoto(url)` → `appendPhotoToStop` → `stop.imageUrls` (`.slice(0,5)`), which `ExperienceCreatorWizard.buildPayload` already maps to each stop's `image_urls` for `biz_create_experience`. The `cover_media_*` column model is NOT touched — stops own their own `image_urls`, exactly as required.

**Bonus correctness fix (same surface):** the old thumb strip rendered empty `<View style={styles.thumb} />` placeholders — selected photos never actually displayed. Replaced with real `<Image source={{ uri }} />`. The "First photo is the one buyers see first" helper + the per-photo remove button are preserved unchanged.

Design tokens + the Android glass policy match CoverPicker/CoverPickerSheet (same `glass.tint.*`/`accent.*` tokens, opaque base fills, `overflow:'hidden'` rounded tiles). Sheet hosted in the canonical `Sheet` primitive and mounted as a JSX child of the stops host View (I-SUB-SHEET-INSIDE-PARENT).

---

## FIX 2 — Footer audit (all 3 create wizards)

| Wizard | Before | Verdict | Action |
|---|---|---|---|
| **Experience** (`ExperienceCreatorWizard.tsx`) | `footer` already had `paddingBottom: insets.bottom + spacing.lg` (orchestrator-applied) | CORRECT & COMPLETE | Verified only. `useSafeAreaInsets` imported, `insets` in scope, footer style's static `padding: spacing.lg` is correctly overridden on the bottom edge only. |
| **Event** (`EventCreatorWizard.tsx`) | Floating `dock` GlassCard with static `marginBottom: spacing.lg` (24px); host applied `paddingTop: insets.top` only | BLEEDS on Android gesture-nav / large iOS home-indicator (24px < typical bottom inset) | FIXED — dock `style` now `[styles.dock, { marginBottom: insets.bottom + spacing.lg }]`; removed the static `marginBottom` from the `dock` StyleSheet rule. `insets` already in scope. |
| **Trip** (`TripCreatorWizard.tsx`) | Identical floating `dock` with static `marginBottom: spacing.lg` | BLEEDS (same mechanism) | FIXED — same inline `marginBottom: insets.bottom + spacing.lg`; removed the static rule. `insets` already in scope. |

Spacing tokens confirmed: `spacing.lg = 24`. On the operator's physical Samsung A72 (gesture-nav) the bottom inset exceeds 24px, so the static-only margin let the Continue/Publish dock sit on/behind the gesture pill — matching the reported "Continue button bleeds into the phone menu." The inset-additive value clears the nav region while preserving the original 24px visual gap above it.

---

## Old → New Receipts

### `mingla-business/src/components/experience/ExperienceStopPhotoSheet.tsx` (NEW, ~770 lines)
**Before:** did not exist.
**Now:** the per-stop photo picker — `Sheet`-hosted, three tabs (Library / GIFs / Photos), gallery-first GIPHY trending + Pexels curated, additive search, masonry grid, 5 states, multi-select Library upload capped at remaining slots, provider single-tap-add. No video path.
**Why:** FIX 1 — reuse the existing Library/Giphy/Pexels picker for stops.

### `mingla-business/src/components/experience/ExperienceStopsStep.tsx` (~40 lines changed)
**Before:** imported `expo-image-picker` + `uploadExperienceStopImage`; `addPhoto` launched the raw single-photo library picker; thumbs rendered empty placeholder `<View>`s; tracked `uploadingIdx` with an inline spinner.
**Now:** imports `ExperienceStopPhotoSheet`; tracks `photoSheetIdx`; the add-tile opens the sheet; thumbs render real `<Image source={{ uri }}>`; `appendPhotoToStop` appends URLs (cap 5). Sheet mounted as JSX child of the host View. Remove-photo + "first photo" helper unchanged.
**Why:** FIX 1.

### `mingla-business/src/components/event/EventCreatorWizard.tsx` (~3 lines changed)
**Before:** dock `style={styles.dock}`; `dock` rule had static `marginBottom: spacing.lg`.
**Now:** dock `style={[styles.dock, { marginBottom: insets.bottom + spacing.lg }]}`; static `marginBottom` removed from the rule (comment added).
**Why:** FIX 2.

### `mingla-business/src/components/trip/TripCreatorWizard.tsx` (~3 lines changed)
**Before/Now/Why:** identical change to the event wizard dock.

### `mingla-business/src/components/experience/__tests__/metaOrch1059SubAFixes.test.ts` (NEW)
Regression guard for both fixes (10 assertions).

(`ExperienceCreatorWizard.tsx` carries the orchestrator's pre-applied footer fix — verified, not modified this turn beyond its existing diff.)

---

## Verification

- **tsc:** `npx tsc --noEmit` in `mingla-business` — 0 errors in any touched file or the `experience/`, `event/`, `trip/` component dirs. (242 total errors are pre-existing baseline noise in unrelated packages, e.g. `packages/phone-input` — present on main, not introduced here.)
- **Regression test:** `src/components/experience/__tests__/metaOrch1059SubAFixes.test.ts` → **10 passed**.
- **Fails-on-revert:** verified at commit `ea3fffcbb` (pre-fix HEAD). Per-fix proof: stashing only `EventCreatorWizard.tsx` makes the "event wizard dock adds insets.bottom" assertion FAIL (received source still shows static `marginBottom: spacing.lg`). Full-revert makes the suite error (0 total) because the reverted stops-step imports the removed sheet. Restored + re-ran green (10 passed).
- **Existing tests:** CoverPicker suites (4 files, 20 tests) PASS. `wizardDesktopLayout` PASS.

---

## Discoveries for Orchestrator

1. **Pre-existing stale test (NOT introduced here):** `mingla-business/src/components/trip/__tests__/TripCreatorWizard.cover.test.ts` › "Step1 renders shared `<CoverPicker>` with all 3 providers enabled" FAILS on the merged main baseline, independent of this turn's change (proven by stashing my dock edit — it still fails). It asserts `TripCreatorStep1Basics.tsx` source contains `import { CoverPicker, type CoverPatch }` + a `providers={["upload","giphy","pexels"]}` prop. The current unified CoverPicker (post-ORCH-0989) no longer exposes a `providers` prop, and Step1Basics appears to mount the cover via `CoverPickerSheet`, so this source-grep is outdated. Recommend an ORCH to repair/retire it under `[TEST-MOD-APPROVED]`.
2. **Thumb-render bug fixed in passing:** the stops step previously rendered empty placeholder Views instead of the selected photos — selected stop photos never showed. Fixed as part of FIX 1 (real `<Image>`). Flagging in case any earlier test asserted the placeholder shape.

---

## Cross-surface impact

Affected surfaces: **Business iOS + Business Android** (`mingla-business/` create wizards). Parity is automatic — both fixes live in shared `mingla-business` component code paths rendered identically on both platforms (no platform-split files). UNAFFECTED: Consumer iOS/Android (no experience-authoring flow), Buyer/anon Web + Admin Web (no create wizard), Business Web preview (renders the same components; the `Sheet` web-split + safe-area insets degrade gracefully — `insets.bottom` is 0 on web, so the footer keeps its `spacing.lg` gap).

---

## Handoff / deploy

No DB push, no edge deploy, no migration — frontend-only. A Metro dev server (port 8090) serving this worktree to a physical Android will hot-reload these changes; all edits are runtime-safe. Recommend on-device smoke: open Create → Experience → Stops, tap a stop's photo "+", confirm the three-tab Library/GIFs/Photos sheet (no Video tab), add a GIF + a Pexels photo + multiple library photos (capped at 5), confirm thumbnails render and remove works; then confirm the Continue/Publish dock clears the gesture nav on all three create wizards (experience/event/trip).
