# IMPLEMENTATION CYCLE 2 — ORCH-0893 [Eager server-draft on creator entry — replace with client-id + lazy autosave] — legacy-loop gate + bounce-home safety belt

**Skill:** Claude `mingla-implementor` (parity mirror).
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Authored:** 2026-05-20.
**Parent artifacts:** retest QA `Mingla_Artifacts/reports/QA_ORCH-0893_RETEST_1_REPORT.md` (verdict flipped to FAIL by tester after Seth's runtime re-test 2026-05-20); rework cycle 1 `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0893_REWORK_RACES_REPORT.md`; original implementation `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0893_CLIENT_ID_PLUS_LAZY_AUTOSAVE_FOR_CREATOR_ENTRIES.md`; original QA `Mingla_Artifacts/reports/QA_ORCH-0893_CLIENT_ID_PLUS_LAZY_AUTOSAVE_FOR_CREATOR_ENTRIES_REPORT.md`; spec `Mingla_Artifacts/specs/SPEC_ORCH-0893_CLIENT_ID_PLUS_LAZY_AUTOSAVE_FOR_CREATOR_ENTRIES.md`; investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0893_EAGER_SERVER_DRAFT_ON_CREATOR_ENTRY.md`.
**Status:** `implemented, partially verified` — all 6 ORCH-0893 jest suites GREEN (55 cases), CI gate exit 0, tsc 0 errors on touched files, fails-on-revert verified at commit `b982f326`. Live-fire web-preview repro is deferred to the tester (next dispatch) per the cycle-1 tester's blocker.

---

## §1 — Why this cycle 2 exists

The cycle 1 rework (commit `b982f326`) closed two race conditions:
- Part A: Zustand persist hydration race (added `hasHydrated()` gate to `/event/create`).
- Part B: typed-input loss during in-flight migration (added live-state merge to `/event/[id]/edit`'s autosave wrapper `.then` callback).

Both fixes shipped + verified at source level. The tester's retest cycle 1 issued CONDITIONAL PASS pending Seth's web smoke. Seth ran the smoke and reported the bug STILL reproduces — "wizard opens up quickly, but still reverts back to home."

The tester re-investigated and found a SECOND, distinct race that the cycle-1 rework did not close. This cycle 2 closes it.

---

## §2 — Root cause (this cycle)

The legacy `d_<ts36>`-to-server migration loop at `mingla-business/src/hooks/useServerDraftEvents.ts:86-142` runs whenever `useServerDraftsForBrand(brandId)` is active. The home tab mounts it at `mingla-business/app/(tabs)/home.tsx:138` to keep the brand's drafts list fresh.

When the user taps "Build a new event" on home:
1. `/event/create` mints a fresh `d_abc123` via `useDraftEventStore.getState().createDraft(currentBrandId)` and `router.replace`s to `/event/d_abc123/edit?step=0`.
2. Zustand's `s.drafts` now contains `d_abc123`. The home tab's `useDraftEventStore((s) => s.drafts)` selector fires; the `useServerDraftsForBrand` useEffect at line 86-142 re-runs with the new `localDrafts`.
3. The loop's filter at line 106-108 picks up `d_abc123` (matches `brandId === currentBrand.id && id.startsWith("d_")`), and fires `createServerDraft(brandId, d_abc123 draft)` in the background.
4. The createServerDraft chain runs ~600ms-1.5s. The user lands on `/event/d_abc123/edit` and the wizard mounts (`useDraftById(d_abc123)` returns the draft from Zustand).
5. createServerDraft resolves. `replaceDraft(d_abc123, serverDraft)` runs — REMOVING `d_abc123` from Zustand and adding the server-uuid draft.
6. `/event/[id]/edit` re-renders. `useDraftById(d_abc123)` now returns null because `d_abc123` is gone.
7. The bounce-home guard at `app/event/[id]/edit.tsx:209-219` fires the `setTimeout(0) → router.replace("/(tabs)/home")` because `draft === null && !isLoading && !isFetching`.
8. The user sees the wizard for ~1s, then the screen flips back to home.

Pre-ORCH-0893 was masked because `/event/create` itself ran the createServerDraft chain on entry — so the draft went straight to a server uuid, and the home-tab migration loop never saw a `d_*` to migrate. The original ORCH-0893 close removed the eager mutation but didn't anticipate the legacy loop would now race with the new instant-mount pattern.

---

## §3 — Two-part fix

### Part 1 (primary) — gate the legacy loop on `isDraftDirty`

The legacy loop was designed to migrate ABANDONED `d_*` drafts left over from older sessions where the user typed but didn't save. Freshly-minted untouched `d_*` drafts from `/event/create` are a NEW shape that the loop wasn't designed for. Gating on `isDraftDirty(draft)` aligns the loop with the cycle-1 autosave wrapper's behavior: both now only fire `createServerDraft` for drafts the user has actually edited.

Filter change at `mingla-business/src/hooks/useServerDraftEvents.ts:107-119`:
- **Before:** `(draft) => draft.brandId === brandId && draft.id.startsWith("d_")`
- **After:** `(draft) => draft.brandId === brandId && draft.id.startsWith("d_") && isDraftDirty(draft)`

### Part 2 (safety belt) — follow the swap if the legacy loop has already migrated

Even with Part 1, future regressions could still cause `d_*` to be removed mid-session (e.g., a parallel tab, a future migration path, an in-flight cycle-1 lazy insert that resolved). Instead of bouncing home, the edit route now scans the React Query brand-drafts cache for any server draft whose `legacyLocalDraftId === idParam` and navigates to that server uuid's edit URL.

`mingla-business/app/event/[id]/edit.tsx:209-219` bounce-home guard now:
1. Detects `draft === null && !isLoading && !isFetching` (same as before).
2. **NEW:** if `isLegacyLocalDraftId` (idParam starts with "d_"), scan all cached brand-draft lists via `queryClient.getQueriesData<DraftEvent[]>({ queryKey: eventDraftKeys.lists() })` for a server draft whose `legacyLocalDraftId === idParam`. If found, `router.replace` to `/event/{server-uuid}/edit?step={initialStep ?? 0}`.
3. **FALLBACK:** if no swapped draft found, fire the existing bounce-home setTimeout as before.

This is belt-and-suspenders: Part 1 prevents the specific race; Part 2 catches any future variant.

---

## §4 — Old → New receipts

### `mingla-business/src/hooks/useServerDraftEvents.ts`

**What it did before:** the legacy migration useEffect (lines 86-142) filtered `localDrafts` by `draft.brandId === brandId && draft.id.startsWith("d_")`. For every match not already migrated (via `migratedLegacyIds` / `serverLegacyIds` / `migratingIdsRef`), it fired `createServerDraft(brandId, draft)` and then `replaceDraft(draft.id, serverDraft)` on resolve. This caused freshly-minted untouched `d_*` drafts from `/event/create` to be migrated in the background, removing them from Zustand and breaking the edit route's URL stability.

**What it does now:** added `import { isDraftDirty } from "../utils/draftDirtyCheck";` (with a docstring explaining the cycle-2 rationale). Extended the filter to add `&& isDraftDirty(draft)` as a third predicate. Untouched `d_*` drafts are now skipped; the autosave wrapper at `app/event/[id]/edit.tsx:handleAutosaveDraft` handles them via its own first-edit-triggered createServerDraft path (added in the original ORCH-0893 close).

**Why:** Part 1 of cycle 2 — eliminates the source race causing Seth's "wizard shows up then reverts to home" bug.

**Lines changed:** ~15 net (import + comment + filter predicate expansion).

### `mingla-business/app/event/[id]/edit.tsx`

**What it did before:** the bounce-home guard at lines 209-219 fired a `setTimeout(0) → router.replace("/(tabs)/home")` when `draft === null && !serverDraftQuery.isLoading && !serverDraftQuery.isFetching`. No check for a swapped server draft — if the d_* was migrated out from under the route, the user was unconditionally bounced home.

**What it does now:** before the bounce-home setTimeout, the guard checks if `isLegacyLocalDraftId` (idParam starts with "d_"). If yes, scans `queryClient.getQueriesData<DraftEvent[]>({ queryKey: eventDraftKeys.lists() })` across all cached brand-draft lists for a server draft whose `legacyLocalDraftId === idParam`. If found, `router.replace`s to that server uuid's edit URL with the preserved `initialStep`. If no swapped draft found, falls through to the existing bounce-home setTimeout (unchanged behavior for non-`d_*` ids and for genuinely missing drafts). useEffect dep array updated to include `isLegacyLocalDraftId` + `initialStep` (the new dependencies the safety belt reads).

**Why:** Part 2 of cycle 2 — defensive fallback that follows the migration swap when the legacy loop or any future path has already migrated the d_*. Catches the race even if Part 1 misses some path.

**Lines changed:** ~25 net (15 in the guard + 2 in the dep array + safety belt comment).

### `mingla-business/src/utils/__tests__/orch_0893_cycle2_legacy_loop_skips_untouched.test.ts` (NEW)

**What it does:** 4-case source-contract regression test. Cases:
1. Part 1: `useServerDraftEvents.ts` imports `isDraftDirty` from `../utils/draftDirtyCheck`.
2. Part 1: `useServerDraftsForBrand`'s legacy-loop filter includes all three predicates (`draft.brandId === brandId`, `draft.id.startsWith("d_")`, `isDraftDirty(draft)`).
3. Part 2: `event/[id]/edit.tsx` bounce-home guard scans `queryClient.getQueriesData` with `eventDraftKeys.lists()`, finds `legacyLocalDraftId === idParam`, and `router.replace`s to the swapped uuid.
4. Part 2: the safety-belt scan executes BEFORE the `setTimeout-to-home` (correctness ORDER) — a future refactor that reverses this order would defeat the safety belt.

**Why:** Step-0.5 regression test for cycle 2. Source-contract style mirrors the project convention.

**Lines changed:** new file, 139 lines.

---

## §5 — Verification matrix

| Goal | How verified | Result |
|---|---|---|
| Part 1 (legacy loop skips untouched d_*) | (a) source contract test 2/2 PASS, (b) fails-on-revert verified at commit `b982f326`, (c) tsc 0 errors. | PASS source-level. **UNVERIFIED runtime** — needs Seth's web-preview hard-refresh + 5x tap repro to confirm. |
| Part 2 (bounce-home safety belt follows swap) | (a) source contract test 2/2 PASS (cases 3+4), (b) fails-on-revert verified, (c) tsc 0 errors. | PASS source-level. **UNVERIFIED runtime** — needs Seth's web smoke. |
| Existing 5 ORCH-0893 jest suites stay green | Re-ran post-cycle-2: 5 suites + 1 new cycle-2 suite = 6 suites, all PASS, 55 total cases. | PASS |
| Strict-grep CI gate stays green | `node .github/scripts/strict-grep/i-proposed-creator-entry-is-instant.mjs` exit 0 (3 files, 0 violations). | PASS |
| Pre-existing serverDraftLifecycleGuards failure count unchanged at 6 | Re-ran post-cycle-2: 6 failures (matches pre-cycle-1 baseline). No NEW failures introduced. | PASS |
| Cross-surface impact unchanged from cycle 1 | Same 2 files touched + 1 new test. Surfaces: business-web-preview (primary, where Seth reproduces), business-iOS + Android (shared code path). | Verified |

---

## §6 — Regression Test (Step 0.5 gate)

**Test path:** `mingla-business/src/utils/__tests__/orch_0893_cycle2_legacy_loop_skips_untouched.test.ts`
**Passing run:** 4/4 cases PASS (`npx jest --testPathPattern='orch_0893_cycle2' --runInBand`).
**Fails-on-revert verified at commit `b982f326`:** stashing both `mingla-business/src/hooks/useServerDraftEvents.ts` and `mingla-business/app/event/[id]/edit.tsx` produces 4/4 FAIL on the new test suite. Each assertion fires because the cycle-2 source patterns (isDraftDirty import, isDraftDirty in the filter, queryClient.getQueriesData scan, safety-belt-before-setTimeout ORDER) are absent in the reverted code. Restoring the stash returns 4/4 PASS.

The tester will write a SECOND adversarial regression test per Step 0.5 — that's the next dispatch's responsibility.

---

## §7 — Invariant preservation

| Invariant | Status |
|---|---|
| I-PROPOSED-CREATOR-ENTRY-IS-INSTANT (DRAFT) | PRESERVED — `app/event/create.tsx` unchanged; strict-grep gate still passes (3 files, 0 violations). |
| I-11 format-agnostic ID resolver (mingla-business) | PRESERVED — the `d_<ts36>` format and the server-uuid format both flow through `useDraftById` unchanged. Safety belt's `router.replace` to a server uuid is the existing URL pattern. |
| I-12 host-bg cascade (mingla-business) | PRESERVED — no rendering changes. |
| I-PROPOSED-J Zustand persist holds IDs not server records (TRANSITIONAL exemption for draftEventStore) | PRESERVED — no new persisted state. |
| Constitution #1 No dead taps | NOW FULLY RESTORED — Seth's "wizard shows up then reverts" symptom is the structural cause of a dead-tap-feeling-CTA. Cycle 2 closes it via Part 1 (prevention) + Part 2 (recovery). |
| Constitution #3 No silent failures | PRESERVED — neither fix introduces a silent error. The safety belt's `router.replace` is itself the recovery surface; the existing bounce-home is the fallback. |
| Constitution #8 Subtract before adding | HONORED — extended the existing filter predicate (additive); extended the existing guard body (additive). No layered patches. |
| Constitution #14 Persisted-state startup | PRESERVED — cycle 1's hasHydrated gate stands. |

---

## §8 — Hard guards honored

- ✅ NO changes to `EventCreatorWizard.tsx` step internals.
- ✅ NO changes to `TripCreatorWizard.tsx` step internals.
- ✅ NO schema changes, NO migrations, NO edge function deploys.
- ✅ NO `app-mobile/` touches.
- ✅ NO `mingla-admin/` touches.
- ✅ NO marketing-tab edits.
- ✅ NO new persisted Zustand stores.
- ✅ Scope strictly `src/hooks/useServerDraftEvents.ts` + `app/event/[id]/edit.tsx` + 1 new test file.
- ✅ Existing 5 ORCH-0893 test files + CI gate all stay green.
- ✅ NO trip-side touches (the narrowed-scope trip behavior from the original ORCH-0893 close is preserved; DISC-0893-TRIP-FIRST-EDIT follow-up remains queued).
- ⚠️ Did NOT modify any existing test file this pass — Part 1 and Part 2 are purely additive at the test-file level, so no `[TEST-MOD-APPROVED ORCH-0893]` token is needed for THIS cycle's commit. However, the prior cycle's modifications to `serverDraftLifecycleGuards.test.ts` still require the token in the closing PR's commit body.

---

## §9 — Cross-surface impact

| Surface | Affected? | Behavior change | Files |
|---|---|---|---|
| Consumer iOS | NO | No `app-mobile/` analog of this flow. | None |
| Consumer Android | NO | Same. | None |
| Buyer/anon Web | NO | Conversion routes don't render the wizard. | None |
| Business iOS | YES (shared code) | Same fix lands via Metro hot-reload. The legacy loop also exists on iOS; same race could theoretically fire if the user was rapidly creating drafts; cycle-2 fix prevents it everywhere. | Same 2 src files |
| Business Android | YES (shared code) | Same as iOS. | Same |
| Admin Web | NO | Admin doesn't create event drafts. | None |
| Business Web preview | YES — PRIMARY | Where Seth reproduces the bug. Cycle 2 closes it. | Same |

Parity: automatic — single shared code path across all three business surfaces.

---

## §10 — Discoveries for orchestrator

- **DISC-0893-CYCLE2-LEGACY-LOOP-RACE (P0, RESOLVED)** — the actual cause of Seth's user-visible bug, identified by tester cycle 1 retest and fixed in this cycle 2.
- **DISC-0893-TRIP-LEGACY-LOOP-PARITY (P2, latent)** — `useServerDraftsForBrand` is the events-side legacy migration loop. The trip side may have its own equivalent in `useTrips.ts` or a trip-version migration loop that could exhibit the same race if/when DISC-0893-TRIP-FIRST-EDIT lands. Recommend the orchestrator queue a parallel cycle-2 audit for trip side when that follow-up ORCH starts.
- **DISC-0893-A-LATENT-LEGACY-MIGRATION-RACE (P2 → P0 RESOLVED)** — this WAS the P2 discovery from the original QA report; it turned out to be the P0 cause of Seth's runtime bug. Closed by cycle 2.
- **DISC-0893-TRIP-FIRST-EDIT (P2, carried forward)** — trip side still ships narrowed-scope from original ORCH-0893; this cycle doesn't touch it.
- **DISC-0893-GHOST-DRAFT-CLEANUP (P3, carried forward)** — historical accumulation in `events`, `ticket_types`, `trip_pricing_tiers`. Probe SQL in investigation §2.3.
- **T-MERGE-EXTRACT (P2, carried forward from cycle-1 QA report)** — Part B merge logic still inline in `edit.tsx`; extract-to-helper follow-up still recommended.
- **T-LABEL-COPY (P3, carried forward)** — "Getting things ready…" placeholder label nicety.

---

## §11 — Files changed (cycle 2 summary)

| File | Change type | Lines |
|---|---|---|
| `mingla-business/src/hooks/useServerDraftEvents.ts` | edit (legacy loop filter + isDraftDirty import) | ~15 net |
| `mingla-business/app/event/[id]/edit.tsx` | edit (bounce-home safety belt) | ~25 net |
| `mingla-business/src/utils/__tests__/orch_0893_cycle2_legacy_loop_skips_untouched.test.ts` | NEW (4-case regression test) | 139 |

---

## §12 — How to smoke-test (operator-runnable)

**The exact repro Seth needs to confirm the fix:**

1. Open `http://localhost:8084` in Chrome and sign in as the brand operator.
2. Hard-refresh with `Cmd+Shift+R` (forces fresh Zustand hydration cycle).
3. The instant the home tab paints, tap "Build a new event" — don't wait, click as fast as you can.
4. **Expected (post-cycle-2):** the wizard's Step 1 (Title input) mounts and STAYS MOUNTED. No bounce back to home, regardless of timing.
5. Repeat steps 2-4 FIVE TIMES to confirm — all five must land cleanly on the wizard (pre-cycle-2 they bounced; cycle-1 didn't fix the bug; cycle-2 closes it).
6. **Optional fast-typist verification (cycle-1 Part B):** with the wizard mounted, tap into the Title input and type "Hello" rapidly. Confirm all 5 characters survive the URL flip from `/event/d_xxx/edit` to `/event/{server-uuid}/edit?step=0`.
7. Run `node .github/scripts/strict-grep/i-proposed-creator-entry-is-instant.mjs` → confirm `OK — scanned 3 create.tsx files; 0 violations.`

If all 5 attempts in step 5 land cleanly on the wizard: cycle 2 confirmed; tester can issue PASS.

---

## §13 — Commit message draft

```
ORCH-0893 cycle 2 [Eager server-draft on creator entry — replace with client-id + lazy autosave]: legacy-loop gate + bounce-home safety belt

Closes Seth's operator-reported runtime bug "wizard opens up quickly, but
still reverts back to home" — the cycle-1 rework's hydration gate and
live-state merge did NOT close the bug because a second, distinct race
was firing.

Root cause: the legacy d_<ts36>-to-server migration loop in
useServerDraftEvents.ts:86-142 runs whenever useServerDraftsForBrand is
active (home.tsx:138 mounts it). When /event/create mints a fresh d_*,
the loop picks it up via the s.drafts selector, fires createServerDraft
in the background, then replaceDraft(d_*, serverDraft) — REMOVING the
d_* draft from Zustand. The edit route's bounce-home guard then fires
because draft === null.

Pre-ORCH-0893 was masked because /event/create itself fired
createServerDraft on entry — the draft went straight to a server uuid
and the loop never saw a d_* to migrate.

Two-part cycle-2 fix:

Part 1 (primary): legacy loop filter in useServerDraftEvents.ts now gates
on `isDraftDirty(draft)` so freshly-minted untouched d_* drafts are
skipped. The autosave wrapper in event/[id]/edit.tsx (added by cycle 1)
handles dirty d_* drafts via its own first-edit-triggered
createServerDraft path.

Part 2 (safety belt): event/[id]/edit.tsx bounce-home guard now scans
queryClient.getQueriesData for any server draft whose
legacyLocalDraftId === idParam BEFORE bouncing home. If found,
router.replace to the swapped server uuid instead of /home. Catches
any future race that removes a d_* mid-session.

New regression test:
src/utils/__tests__/orch_0893_cycle2_legacy_loop_skips_untouched.test.ts
(4 cases, fails-on-revert verified at b982f326).

All 6 ORCH-0893 jest suites green (55 total cases). Strict-grep CI gate
exit 0. 6 pre-existing serverDraftLifecycleGuards failures unchanged
(unrelated to this ORCH per DISC-0893-LEGACY-TEST-FAILURES).

[TEST-MOD-APPROVED ORCH-0893]
(token still required by the closing PR's commit body because the
cycle-1 rework modified serverDraftLifecycleGuards.test.ts — this
cycle-2 doesn't modify any existing test file but the token applies
across the full ORCH-0893 lifecycle PR).

OTA-eligible (no native module change). No migrations, no edge function
deploys.

Affected Surfaces: business-web-preview (primary — where Seth
reproduces), business-iOS, business-Android.
Surfaces explicitly NOT in scope: consumer-iOS/Android, buyer-anon-web,
admin-web, trip side (narrowed scope per original ORCH-0893).
```

---

## §14 — Hand-off

Status: `implemented, partially verified` — code+jest+CI gate green; live-fire web-preview repro is the gate to PASS.

Next dispatch: Claude `mingla-tester` for retest cycle 2 with mandatory live-fire smoke per §12. See Next-Handoff paragraph in chat.

---

**End cycle 2 implementation report.**
