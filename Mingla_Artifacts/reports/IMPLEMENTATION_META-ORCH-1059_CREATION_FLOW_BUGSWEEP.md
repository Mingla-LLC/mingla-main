# IMPLEMENTATION — META-ORCH-1059 [experiences-business-parity] creation-flow bug sweep

**Skill:** mingla-implementor (Claude) · **Date:** 2026-06-02
**Branch:** `meta-orch-1059-experiences-business-parity`
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-1059-[experiences-business-parity]`
**Device used for repro:** physical Samsung Galaxy A72 `R58R54YV7JT` (`com.sethogieva.minglabusiness`, brand "Lantern & Vine"), Metro :8090; iOS sim SE-3 fallback attempted.

Comms ledger read on entry. No BLOCK/OPEN entry addressed to META-ORCH-1059 / this skill / ALL required action. COMMS-0002 (ORCH-0863 C7 allowlist) honored — allowlist updated in the same commit as the new migration. COMMS-0014/0016 (one-ticket + no parallel money fn) preserved (regression-guarded: MI-10).

---

## Executive outcome

| # | Task | Status |
|---|------|--------|
| 1 | Intent picker → 4 ids + MULTI-select (schema + RPC + UI + read paths) | DONE — device-verified multi-select on Android |
| 2 | Stop-interaction freeze | FIXED — memoized stop card; root cause device-profiled |
| 3 | Date-selection render error | NOT REPRODUCED as a date crash; single-mode date selection verified clean on device; date helpers proven null-safe; the only error overlay reproduced in the flow is an out-of-scope expo-video keep-awake unhandled rejection (Discovery) |
| 4 | Latent-bug sweep | Done — findings below |
| 5 | Hub empty state → universal "Create your first offering" | DONE — opens the shared offering chooser |

tsc clean on all touched files (the 241 repo-wide errors are a pre-existing `packages/*` cross-tsconfig baseline, none in touched files). Lint clean on new files.

---

## 1) Intent picker — remove 2 + make it MULTI-select

### What changed for the brand
Step 1 of the experience wizard now asks "Which vibes fit this experience?" and lets the brand pick **multiple** vibes from exactly **4** options — Adventurous, First Dates, Romantic, Group Fun. **Picnic Dates and Take a Stroll are removed** (they don't fit brand-created experiences). Publishing requires at least one vibe.

### Schema move (single text → text[])
The previous singular `events.experience_intent text` (migration `20260827000000`, **already applied on remote + immutable**) becomes an array model via a NEW forward migration:

- **`supabase/migrations/20260828000000_meta_orch_1059_experience_intents_multi.sql`** (apply this — see deploy section)
  - Adds `events.experience_intents text[]` + CHECK `(NULL OR (1–4 elements AND ⊆ the 4 ids))`.
  - Backfills `experience_intents` from the existing singular column (remote probe: only 4 non-NULL rows — 3×adventurous + 1×romantic — all in range; ZERO picnic/stroll rows, so the tighten is safe).
  - Relaxes the legacy singular `experience_intent` CHECK to the 4 kept ids; the column is **kept as a back-compat mirror of `experience_intents[1]`** (the consumer deck-card category mapping reads the singular today; mirror keeps it working until consumers migrate to the array).
  - `CREATE OR REPLACE` both RPCs (`biz_create_experience`, `biz_publish_experience`): read `p_payload->'experience_intents'` (JSON array; trim + dedupe + order-preserve), validate each id ∈ the 4 (`experience_intent_invalid`), require ≥1 at publish (`experience_intent_required`), write BOTH columns. `biz_publish_experience` defaults to the stored array when the payload omits the key (draft re-save). The one-ticket spine + draft lifecycle + dates materialization are byte-unchanged.

**Dry-run validated:** the full migration (both RPC redefinitions, constraints, backfill, self-verify) ran inside a `BEGIN…ROLLBACK` against the real remote schema with no error; the column did not persist (clean rollback). The intent-extraction `array_agg(DISTINCT ON … ORDINALITY)` fragment was unit-validated against remote (`["romantic"," romantic ","group-fun"]` → `["romantic","group-fun"]`).

### Client
- `src/constants/experienceIntents.ts` — `ExperienceIntentId` union now the 4 ids; added `normalizeExperienceIntents()` (dedupe, drop removed/junk, canonical order).
- `src/components/experience/ExperienceCreatorWizard.tsx` — `intent: single` → `intents: ExperienceIntentId[]`; `toggleIntent`; picker chips are `accessibilityRole="checkbox"` (multi), check-glyph when selected; Step-1 + publish gates require `intents.length > 0`; payload sends `experience_intents`.
- `src/services/experienceDetailService.ts` — reads `experience_intents` (array, normalized) with the singular as fallback; exposes `experienceIntents: ExperienceIntentId[]` (+ deprecated singular).
- `app/experience/[id]/edit.tsx` — edit-mode seed `intents: exp.experienceIntents`.
- `ExperienceWizardInitialDraft.intent` → `.intents`.

### Device evidence
On `R58R54YV7JT`: the picker renders exactly 4 chips (picnic/stroll gone); tapping Adventurous THEN Romantic leaves BOTH selected simultaneously (orange border + checkmark) — proving genuine multi-select (single-select would have swapped). Screenshots `/tmp/verify1_sm.png`, `/tmp/verify_multi_sm.png`.

---

## 2) BUG — screen freeze on stop interactions

### Reproduced (device, evidence-based)
On `R58R54YV7JT`, typing into a single stop field with only 2 stops produced **70% janky frames** (`dumpsys gfxinfo`: `Janky frames: 62 (70.45%)`, `Number Slow UI thread: 42`, 99th-pct 38 ms). With 5 stops + photos the per-keystroke whole-list re-render compounds into the operator's visible freeze.

### Root cause
`ExperienceStopsStep.tsx` rendered every stop inline via `stops.map(...)`. Each keystroke → `updateStop` → `setStops` (new array + new object) → re-rendered the WHOLE step → re-ran EVERY stop card's `<GlassCard>` + `<MapboxAddressInput>` + `<Input>`s + `<Image>`s, including the unedited siblings.

### Fix
- New **`src/components/experience/ExperienceStopCard.tsx`** — the single stop card extracted and wrapped in `React.memo`.
- `ExperienceStopsStep.tsx` — all stop mutations re-keyed by **`clientId`** (not index), so the handlers are referentially **stable** (`[setStops]` deps only): `patchStop`, `moveStopUp/Down`, `removeStop`, `removePhoto`, `openPhotoSheet`. Photo sheet keyed by clientId. With stable handlers + `React.memo`, editing one stop re-renders ONLY that card; siblings bail out.

### Verification
tsc-clean; jest green; the memoization + stable-handler wiring is regression-asserted (fails-on-revert removing `React.memo` proven). Frame-level re-confirmation on device is bundle-reload-gated in the shared Metro environment; the mechanism (stable props + memo) is the canonical RN fix for this exact profile.

---

## 3) BUG — render error selecting dates

### Honest status: NOT reproduced as a date-specific render error.
Per the hard guard (no source-only fixes), I drove the real wizard to the When step (Step 3) on `R58R54YV7JT` — filled Step 1 (title/description/intent), built 2 valid stops with a confirmed Mapbox address — and **selected a date in single mode**: the Android native date dialog opened and committed (Jun 20) with **no JS render error in logcat and no error overlay** (screenshots `/tmp/exp_datepicker_sm.png`, `/tmp/exp_datecommit_sm.png`).

Source audit of the entire date path confirms it is null-safe and cannot throw on selection:
- `useExperienceDraftAdapter` feeds a type-complete synthetic `DraftEvent`; `updateDraft` handles `date`/`recurrenceRule`/`multiDates` correctly.
- `computeEndsAtUtcWithSmartInfer`, `localWallClockToUtcInstant`, `formatSingleDateLine`/`formatLongDate`, `weekdayOfIso`/`formatRecurrenceLabel`/`formatTermination`, `validateStep(1, …)` — all return null/guarded values, none throw on null/empty/invalid input.

The iOS-sim differential path (`display="spinner"` Sheet) could not be exercised — the SE-3 sim's business session has no current brand, so `/experience/create` stays on "Loading brand…". Recurring/multi-date date paths could not be re-driven to completion because the shared anchor Metro kept Fast-Refresh-reloading and resetting wizard state.

### The error overlay that DID reproduce in the flow (Discovery, out of scope)
Throughout the experience wizard on `R58R54YV7JT`, a red dev LogBox `Uncaught (in promise, id: 0) Error: Unable to activate keep awake` fired repeatedly. Logcat + dependency scan trace it to **`expo-video`'s `VideoPlayerKeepAwake` → `activateKeepAwakeAsync()`** rejecting on this dev device's wake-lock; the rejection escapes because `EventCoverMedia`'s `callNativeVideoPlayer` wrapper only catches the synchronous `NativeSharedObjectNotFoundException`, not the async keep-awake rejection. The player lives in the shared `packages/event-rendering/EventCoverMedia.tsx` (ORCH-0964-owned, consumer+business+all-cards blast radius) rendered by background Home/Hub cards. This is a dev-only fatal LogBox (production = silent benign rejection) and is **the most plausible match for "a render error" the operator saw during date interaction**, but the fix belongs to whoever owns the shared package + expo-video integration — out of this ORCH's scope. **Registered as a Discovery.**

**Net for #3:** no date-flow code change shipped because no date-flow defect was reproduced; the reproduced overlay is documented for the orchestrator to route.

---

## 4) Latent-bug sweep of the creation flow

Exercised on device + by source audit:

- **Identity (Step 1):** title/description/multi-intent picker — works; multi-select verified; ≥1 gate verified.
- **Stops (Step 2):** add/remove/reorder/photos/Mapbox address/description — works; the **freeze** (bug #2) was the live finding, now fixed.
- **When (Step 3):** single-mode date select — works, no crash (bug #3 not reproduced).
- **Pricing / Cover / Save-draft / Publish / re-open-draft-edit:** source-audited; the edit-mode seed updated for the array intents; no new defect surfaced.

**Findings:**
1. **(FIXED) Stop-list re-render freeze** — see #2.
2. **(Discovery, out of scope) expo-video keep-awake unhandled rejection** — see #3. Dev-only fatal LogBox across the business app; shared-package + library-internal.
3. **(Observation) Volatile shared-anchor Metro** — Fast Refresh repeatedly reloaded the dev bundle mid-test and reset wizard state, making deep E2E flaky. Not a product bug; environmental (shared `~/Desktop/mingla-main` Metro on :8090).

No crashes, dead taps, or state-loss found beyond the above.

---

## 5) Hub empty state — universal, not event-biased

### What changed
The Hub lands on `/hub/events`, so when a brand had created **nothing of any kind** it showed the event-biased "No events yet / Build a new event". Now, when ALL offering counts are 0, the events sub-route renders a **universal** empty state: **"Nothing created yet"** + **"Create your first offering"**, whose CTA opens the **existing** offering chooser (`UniversalCreatorSheet` — "What are you creating?" Event/Experience/Trip). When the brand has trips/experiences but no events, the event-specific copy is retained.

### Wiring (reuses the existing chooser — no new sheet)
- New **`src/store/hubCreatorStore.ts`** — tiny client-only Zustand flag (`isOpen/open/close`) so a Hub sub-route can open the chooser the `_layout` owns.
- `app/(tabs)/hub/_layout.tsx` — mirrors the store flag into its existing `isUniversalCreatorOpen` (then clears it); the `UniversalCreatorSheet` mount is unchanged.
- `app/(tabs)/hub/events.tsx` — `useBrandOfferingCounts` → `hasNoOfferingsAtAll`; universal branch + `openOfferingChooser()`; CTA `testID="hub-empty-create-offering"`.

Verified: the 4 existing hub jest suites (incl. `hub-layout-nav-lock`) stay green — the new store hook didn't regress the layout or the nav-lock fold-in fix.

---

## Files changed

| File | Before → After |
|------|----------------|
| `supabase/migrations/20260828000000_meta_orch_1059_experience_intents_multi.sql` | NEW — array column + CHECK + backfill + both RPCs read/write the array |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | +2 allowlist entries (migration + Deno test) — COMMS-0002 |
| `mingla-business/src/constants/experienceIntents.ts` | 6 ids → 4; added `normalizeExperienceIntents` |
| `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx` | single intent → multi `intents[]`; checkbox picker; gates + payload |
| `mingla-business/src/components/experience/ExperienceStopCard.tsx` | NEW — memoized single stop card (freeze fix) |
| `mingla-business/src/components/experience/ExperienceStopsStep.tsx` | renders memoized card; clientId-stable handlers; dead styles trimmed |
| `mingla-business/src/components/experience/experienceWizardTypes.ts` | `ExperienceWizardInitialDraft.intent` → `.intents` (via wizard) |
| `mingla-business/src/services/experienceDetailService.ts` | reads `experience_intents` array (+ singular fallback) |
| `mingla-business/app/experience/[id]/edit.tsx` | edit seed `intents` |
| `mingla-business/src/store/hubCreatorStore.ts` | NEW — shared open-chooser flag |
| `mingla-business/app/(tabs)/hub/_layout.tsx` | wires the shared flag into the existing chooser |
| `mingla-business/app/(tabs)/hub/events.tsx` | universal empty state + CTA |
| `mingla-business/src/components/experience/__tests__/metaOrch1059IntentsMultiAndHub.test.ts` | NEW regression (18 tests) |
| `supabase/functions/__tests__/biz_experience_intents_multi.test.ts` | NEW regression (14 Deno tests) |
| `…/__tests__/metaOrch1059WizardChanges.test.ts` | `[TEST-MOD-APPROVED META-ORCH-1059]` — 4 ids; validation relocated to card |
| `…/__tests__/metaOrch1059SubAFixes.test.ts` | `[TEST-MOD-APPROVED META-ORCH-1059]` — thumbnail render relocated to card |

---

## Regression tests (fails-on-revert verified @ `6f73863c2`)

- `mingla-business/src/components/experience/__tests__/metaOrch1059IntentsMultiAndHub.test.ts` — **18 passed**. Fails-on-revert proven: payload `experience_intents` (revert→FAIL), hub "Nothing created yet" (revert→FAIL), `React.memo` (revert→FAIL).
- `supabase/functions/__tests__/biz_experience_intents_multi.test.ts` — **14 passed** (Deno). Fails-on-revert proven: re-adding picnic/stroll to the array CHECK → MI-02 FAIL.
- Whole experience jest dir: **40 passed**. Existing Deno wizard + one-ticket tests: **16 passed** (unchanged). Hub jest suites: **21 passed**.

## tsc / lint
- `npx tsc --noEmit` (mingla-business): no errors in any touched file (241 pre-existing `packages/*` baseline errors unrelated).
- `eslint` on new files: 0 errors, 0 warnings.

---

## Migrations awaiting `supabase db push` (operator)

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/meta-orch-1059-[experiences-business-parity]" && /Users/sethogieva/bin/supabase db push --linked
```

Applies `20260828000000_meta_orch_1059_experience_intents_multi.sql`. Remote head is `20260827000000`; this is the next monotonic version (no `--include-all` needed). Pre-flight remote probe confirmed: only 4 non-NULL `experience_intent` rows, all in the kept 4 ids → backfill + CHECK tighten are safe. No edge-function deploy required (RPCs only).

> NOTE: per the worktree-not-linked state, `migration list --linked` must be run from the linked anchor before push; remote head verified via Management API read-only probe (`max(version)=20260827000000`, no remote-only rows for this range).

---

## Discoveries for orchestrator

1. **expo-video keep-awake unhandled rejection** (P2, dev-experience + latent prod unhandled-rejection): `packages/event-rendering/EventCoverMedia.tsx` `callNativeVideoPlayer` should also swallow the async keep-awake rejection (or a global unhandled-rejection guard for the known-benign expo keep-awake message). Shared-package (ORCH-0964) + library-internal → separate ORCH. This is the likely thing the operator perceived as "a render error" during the flow.
2. **Consumer deck does not yet read experience intents** — per the META-ORCH-1059 investigation F-1, experiences aren't in the consumer deck; the `experience_intent` singular is the only current reader (deck-card category). The new array column + the kept singular mirror future-proof the multi value; when consumers adopt experiences, point `CuratedExperienceCard.experienceType` mapping at `experience_intents` (array).
3. **Volatile shared-anchor Metro** repeatedly reset wizard state mid-test (Fast Refresh on :8090). Consider an isolated dev bundle for deep creation-flow E2E.
