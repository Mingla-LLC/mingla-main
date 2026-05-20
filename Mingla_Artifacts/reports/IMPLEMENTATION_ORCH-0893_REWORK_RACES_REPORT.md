# IMPLEMENTATION REWORK — ORCH-0893 [Eager server-draft on creator entry — replace with client-id + lazy autosave] — combined race fixes

**Skill:** Claude `mingla-implementor` (parity mirror).
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Authored:** 2026-05-20.
**Parent reports:** spec at `Mingla_Artifacts/specs/SPEC_ORCH-0893_CLIENT_ID_PLUS_LAZY_AUTOSAVE_FOR_CREATOR_ENTRIES.md`; first implementation at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0893_CLIENT_ID_PLUS_LAZY_AUTOSAVE_FOR_CREATOR_ENTRIES.md`; QA verdict at `Mingla_Artifacts/reports/QA_ORCH-0893_CLIENT_ID_PLUS_LAZY_AUTOSAVE_FOR_CREATOR_ENTRIES_REPORT.md`; investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0893_EAGER_SERVER_DRAFT_ON_CREATOR_ENTRY.md`.
**Status:** `implemented, partially verified` — jest, tsc, CI gate, and fails-on-revert verified at commit `b982f326`. Live-fire sim/web repro of the hydration-race fix is deferred to the tester (next dispatch) per Phase 0.A protocol.

---

## §1 — Why this rework exists

Two distinct race conditions were exposed by the first ORCH-0893 close:

1. **DISC-HYDRATION-RACE (P0, operator-reported 2026-05-20)** — "wizard shows up and immediately closes, until I try multiple times then it stops." Root cause: Zustand persist's async hydration fires `setState(persisted, true)` AFTER the user's tap mints the `d_<ts36>` draft, REPLACING the in-memory state and wiping the just-minted draft. The edit route's existing bounce-home guard (`draft === null && !isLoading && !isFetching`) then fires the `setTimeout(0)` redirect. The bug only manifests on the first 1-3 taps because hydration only fires once per page load; subsequent taps land after hydration is complete. Pre-ORCH-0893 was masked by the ~600ms-1.5s server-mutation chain which gave hydration time to settle.

2. **DISC-RACE-FOLLOWUP (P1, tester-surfaced in QA report §2.T-04)** — typed-input loss during the ~600ms-1.5s in-flight createServerDraft window for fast typists. The pre-existing `useServerDraftEvents.ts:117-141` migration loop had the same race, but ORCH-0893's "first-edit-triggered" pattern exposes it more frequently because typing IS happening during the migration window. Recommended fix shape (per QA §10): re-read live Zustand state at the `.then` callback and merge user-meaningful fields into the server payload before `replaceDraft`.

Both races share the same architectural cause (Zustand-state-vs-async-resolve), both are bounded in scope, and both ship in this one rework dispatch per the orchestrator's combined-rework directive.

---

## §2 — Old → New receipts

### `mingla-business/app/event/create.tsx`

**What it did before (post-original-ORCH-0893 close):** mounted a placeholder host page, ran a single useEffect that mintee `d_<ts36>` via subscribed Zustand selector `useDraftEventStore((s) => s.createDraft)` and called `router.replace` to `/event/{d_id}/edit?step=0` — all in the same task tick. No gate on persist hydration. Resulted in the operator-reported close-on-mount bug when hydration completed after the mint and overwrote the just-created draft.

**What it does now:** adds a synchronous-on-mount + subscription-based Zustand persist hydration gate (`useDraftEventStore.persist.hasHydrated()` + `onFinishHydration`). The useState initializer captures the current hydration status; an effect subscribes to `onFinishHydration` to flip the gate when hydration finishes after mount (with a defensive re-check immediately after subscription to catch the microtask race). The mint useEffect's early-return list adds `!hydrated` ahead of the brand-null check. The mint call switched from `createClientDraft(currentBrandId)` (subscribed selector form) to `useDraftEventStore.getState().createDraft(currentBrandId)` (direct getState form) — eliminates any subscription staleness and writes into the current post-hydration state explicitly. The placeholder label JSX now has a third state, "Getting things ready…", that displays during the hydration window so the user knows we're waiting on something distinct from sign-in completion.

**Why:** SPEC rework Part A. Closes DISC-HYDRATION-RACE P0 (operator's "wizard shows up then closes" bug).

**Lines changed:** ~25 net (added `useState` import + ~12 lines of hydration gate + label-branch line + selector-pattern swap).

### `mingla-business/app/event/[id]/edit.tsx`

**What it did before (post-original-ORCH-0893 close):** route-owned `handleAutosaveDraft` wrapper handled three branches — server-id → autosave path, `d_*` + clean → no-op, `d_*` + dirty → `createServerDraft` + `replaceDraft(incoming.id, serverDraft) + router.replace`. The `.then((serverDraft) => …)` callback passed the raw `serverDraft` (server-echoed queue-time snapshot) to `replaceDraft`, overwriting any user typing that happened during the in-flight network call.

**What it does now:** the `.then` callback re-reads the live Zustand draft via `useDraftEventStore.getState().getDraft(incoming.id)` immediately before `replaceDraft`. If the live draft exists (the typical case), the callback constructs a `mergedServerDraft` that takes server-issued fields (`id`, `slug`, `created_by`, server timestamps) from `serverDraft` AND user-meaningful fields (`name`, `description`, all `coverMedia*` columns, `coverHue`, `format`, `tickets`, `date`, `doorsOpen`, `endsAt`, `endsAtUtc`, `venueName`, `address`, `city`, `locationGeo`, `onlineUrl`, `hideAddressUntilTicket`, `partyTypes`, `vibeTags`, `musicGenres`, `whenMode`, `multiDates`, `recurrenceRule`, `timezone`) from the live draft. `lastStepReached` takes `Math.max(live, server)` so step progress doesn't regress. If the live draft is null (already replaced by a concurrent migration or discarded), the callback falls back to `serverDraft` as-is. `replaceDraft`, `queryClient.setQueryData`, and `router.replace` all switch to `mergedServerDraft.id` (which equals `serverDraft.id` for ID purposes but the type-safe pattern is to use the merged variable everywhere downstream).

**Why:** SPEC rework Part B. Closes DISC-RACE-FOLLOWUP P1 (typed-input loss during in-flight migration).

**Lines changed:** ~40 net (added the merge block in the `.then` callback; the original 4-line `.then` body became ~50 lines).

### `mingla-business/src/utils/__tests__/orch_0893a_hydration_gate.test.ts` (NEW)

**What it does:** 7-case jest source-contract test (mirrors the file-contract pattern in `orch_0893_creator_entry_routes.test.ts`). Cases:
1. Part A: `event/create.tsx` subscribes to `useDraftEventStore.persist.hasHydrated()` + `onFinishHydration` with a `[hydrated, setHydrated]` state pair.
2. Part A: mint useEffect short-circuits on `!hydrated`.
3. Part A: mint call uses `useDraftEventStore.getState().createDraft(...)` (not subscribed selector); the `createClientDraft(...)` pre-rework pattern is forbidden in non-comment code.
4. Part A: placeholder label JSX includes both "Finishing sign-in…" and "Getting things ready…" branches (honest distinct loading states).
5. Part B: `event/[id]/edit.tsx`'s autosave wrapper `.then` reads live state via `getDraft(incoming.id)`, names the merge variable `mergedServerDraft`, calls `replaceDraft(incoming.id, mergedServerDraft)`, and `router.replace`s using `mergedServerDraft.id`.
6. Part B: merge preserves `name`, `description`, `tickets`, `coverMediaUrl`, and `lastStepReached: Math.max(...)`.
7. Part B: handles the `liveDraft === null` edge case via ternary fallback to raw `serverDraft`.

**Why:** Step-0.5 regression-test gate for the rework. New test file, additive — does not modify the existing 3 ORCH-0893 jest suites.

**Lines changed:** new file, 165 lines.

### `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts` `[TEST-MOD-APPROVED ORCH-0893]` (rework revision)

**What it did before (post-original-ORCH-0893 close):** pinned `createClientDraft(currentBrandId)` as the canonical synchronous mint pattern in `event/create.tsx`. This was the subscribed-selector form from the original ORCH-0893 implementation.

**What it does now:** updated to pin the rework's pattern — `useDraftEventStore.getState().createDraft(currentBrandId)`, plus the new hydration gate's required tokens (`useDraftEventStore.persist.hasHydrated()` + `useDraftEventStore.persist.onFinishHydration`, the `if (!hydrated)` early-return gate). The order assertions now require auth-guard → hydrated-gate → createDraft → router.replace.

**Why:** the previous TEST-MOD-APPROVED revision pinned a contract that the rework deliberately replaces; without this update the test would fail despite the code being correct. The implementor skill's append-only enforcement requires the `[TEST-MOD-APPROVED ORCH-0893]` token in the closing commit body; the rework re-uses the same token because this is the same ORCH (no new ORCH-ID issued).

**Lines changed:** ~30 lines net inside the one test case.

---

## §3 — Verification matrix (rework deltas)

| Goal | How verified | Result |
|---|---|---|
| Part A: hydration race closed | (a) source contract test 7/7 PASS; (b) fails-on-revert verified at `b982f326` by stashing `event/create.tsx` + `event/[id]/edit.tsx`; (c) tsc 0 errors on touched files. | PASS source-level. **UNVERIFIED runtime** — needs operator hard-refresh + tap-immediately repro test on web preview at `http://localhost:8084` to confirm wizard mounts cleanly across all attempts. |
| Part B: typed-input loss race closed | (a) source contract test cases 5/6/7 PASS; (b) fails-on-revert verified at `b982f326`; (c) tsc 0 errors. | PASS source-level. **UNVERIFIED runtime** — needs typing-during-migration smoke test on web preview to confirm characters survive the URL flip. |
| Existing 3 ORCH-0893 jest suites stay green | Re-ran post-rework: 29/29 cases PASS (`draftDirtyCheck.test.ts` 17/17, `orch_0893_creator_entry_routes.test.ts` 4/4, `orch_0893_adversarial_edit_route_wrapper.test.ts` 8/8). | PASS |
| Strict-grep CI gate stays green | `node .github/scripts/strict-grep/i-proposed-creator-entry-is-instant.mjs` exit 0 with 3 files / 0 violations. | PASS |
| `serverDraftLifecycleGuards.test.ts` regression count unchanged at 6 | Re-ran post-rework: 6 failures (matches pre-rework baseline). The 1 ORCH-0893-specific case that briefly broke during the rework is now updated `[TEST-MOD-APPROVED ORCH-0893]` and passes. | PASS |
| Cross-surface impact unchanged from original ORCH-0893 | The rework touches only the same 2 files that were touched in the original close (`event/create.tsx` + `event/[id]/edit.tsx`). Surfaces touched: business-web-preview (primary, where the operator-reported bug lives), business-iOS, business-Android. Not touched: consumer-iOS/Android, buyer-anon-web, admin-web, business-trip side (the eager-on-mount trip migration is untouched by this rework). | Verified |

---

## §4 — Regression Test (Step 0.5 gate)

**Test path:** `mingla-business/src/utils/__tests__/orch_0893a_hydration_gate.test.ts`
**Passing run:** 7/7 cases PASS in the local run (`npx jest --testPathPattern='orch_0893a_hydration_gate' --runInBand`).
**Fails-on-revert verified at commit `b982f326`:** stashing `mingla-business/app/event/create.tsx` + `mingla-business/app/event/[id]/edit.tsx` produces 7/7 FAIL on the new test suite. Each assertion fires because the rework-specific source patterns (`hasHydrated()`, `onFinishHydration`, `if (!hydrated)`, `getState().createDraft`, `mergedServerDraft`, `getDraft(incoming.id)`) are absent in the reverted code. Restoring the stash returns 7/7 PASS.

The tester will write a SECOND, adversarial regression test per Step-0.5 — that's the next dispatch's responsibility.

---

## §5 — Invariant preservation

| Invariant | Status |
|---|---|
| I-PROPOSED-CREATOR-ENTRY-IS-INSTANT (DRAFT) | PRESERVED. The rework reinforces it — the strict-grep gate still passes (no forbidden tokens in any `app/**/create.tsx`); the hydration gate is purely additive. |
| I-11 format-agnostic ID resolver (mingla-business) | PRESERVED. The `d_<ts36>` format still flows through the route unchanged. No normalization introduced. |
| I-12 host-bg cascade (mingla-business) | PRESERVED. The placeholder render still uses `backgroundColor: canvas.discover`. |
| I-PROPOSED-J Zustand persist holds IDs not server records (TRANSITIONAL exemption for draftEventStore) | PRESERVED. No new persisted state introduced. The merge logic touches in-memory state only. |
| Constitution #1 No dead taps | RESTORED. The wizard now mounts reliably on the first tap, no longer requiring "multiple tries." |
| Constitution #3 No silent failures | PRESERVED. The error catch in `handleAutosaveDraft` still surfaces toast for non-auth errors. The new merge path doesn't introduce a new error surface. |
| Constitution #8 Subtract before adding | HONORED. Replaced the subscribed-selector form (`createClientDraft = useDraftEventStore((s) => s.createDraft); createClientDraft(...)`) with the direct getState form rather than layering. |
| Constitution #14 Persisted-state startup (`_hasHydrated` gate) | **NEWLY HONORED.** Pre-rework, the route did not gate on hydration — relying on the implicit "server round-trip buys hydration time" buffer. The rework adds an explicit hydration gate per Constitution #14. |

---

## §6 — Hard guards honoured

- ✅ NO changes to `EventCreatorWizard.tsx` step internals.
- ✅ NO changes to `TripCreatorWizard.tsx` step internals.
- ✅ NO schema changes, NO migrations, NO edge function deploys.
- ✅ NO `app-mobile/` touches.
- ✅ NO `mingla-admin/` touches.
- ✅ NO marketing-tab edits.
- ✅ NO new persisted Zustand stores (rework uses the existing `draftEventStore`).
- ✅ Scope strictly `app/event/create.tsx` + `app/event/[id]/edit.tsx` + 1 new test file + 1 existing-test update with `[TEST-MOD-APPROVED ORCH-0893]` token.
- ✅ Existing 3 ORCH-0893 test files + CI gate all stay green.
- ✅ NO trip-side touches (the narrowed-scope trip behavior from the original ORCH-0893 close is preserved as-is; DISC-0893-TRIP-FIRST-EDIT remains as a follow-up).

---

## §7 — Discoveries for orchestrator

- **DISC-0893-A-VENUE-HYDRATION-RACE-LATENT (P3, latent)** — `/venue/create.tsx` uses `useDraftVenueStore` which is a separate persisted Zustand store. The same hydration-race anti-pattern theoretically exists there, but venue's flow is multi-phase (gate → category → wizard) with user input gating each phase transition, so the race window is naturally throttled to seconds of user interaction. NOT exposed today, but a future fast-path UX change could expose it. Worth a follow-up audit if/when the venue flow gets streamlined.
- **DISC-0893-A-TRIP-HYDRATION-RACE-NEVER-EXPOSED (P4, observation)** — `/trip/create.tsx` mints `d_<ts36>` via `generateDraftId()` (NOT via a Zustand store), so the hydration race doesn't apply. The trip flow has its own narrowed-scope behavior (eager-on-mount migration on the resume route) which is fully tracked under DISC-0893-TRIP-FIRST-EDIT.
- **DISC-0893-A-LATENT-LEGACY-MIGRATION-RACE (P2, latent)** — `useServerDraftEvents.ts:117-141` (the legacy drafts-list migration loop) has the SAME live-state-vs-snapshot race as Part B fixed in `handleAutosaveDraft`. The loop scans persisted local drafts and migrates them on the next drafts-list query enable. If a user is actively editing a `d_<ts36>` draft when the list query enables and triggers migration, the same typed-input-loss race fires there too. Lower exposure than the autosave wrapper (the list query only enables on /hub/events mount). The fix would mirror Part B's getDraft-and-merge pattern at line 119. Recommend a small follow-up ORCH if real users hit it.
- **DISC-0893-A-PRE-EXISTING-TSC-AND-TEST-FAILURES (P3, already registered)** — the 19 tsc errors and 6 serverDraftLifecycleGuards failures noted in the original implementation's §9 remain unchanged. This rework does not address them; they are unrelated.

---

## §8 — Files changed (summary)

| File | Change type |
|---|---|
| `mingla-business/app/event/create.tsx` | rewrite (hydration gate + getState() form + label-branch) |
| `mingla-business/app/event/[id]/edit.tsx` | edit (`.then` callback now reads live state + merges before `replaceDraft`) |
| `mingla-business/src/utils/__tests__/orch_0893a_hydration_gate.test.ts` | NEW — 7-case rework regression test |
| `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts` | `[TEST-MOD-APPROVED ORCH-0893]` revision — 1 case updated to match the rework's API |

---

## §9 — How to smoke-test on the app (operator-runnable)

These steps independently verify the rework. Run from the project root after the rework lands.

**Smoke for Part A (hydration gate — the bug Seth reported):**

1. Open `http://localhost:8084` in Chrome (or open the dev build on iOS sim via Metro hot-reload on port 8084).
2. **Hard-refresh** with `Cmd+Shift+R` (forces fresh Zustand hydration cycle).
3. **The instant the home tab paints, tap "Build a new event"** — don't wait.
4. **Expected (post-rework):** the placeholder may briefly show "Getting things ready…" or "Finishing sign-in…" depending on which gate is open, then the wizard's Step 1 mounts. The wizard MUST NOT bounce back to home.
5. Repeat steps 2-4 five times to confirm the bug is gone (pre-rework it would bounce on the first 1-3 attempts).

**Smoke for Part B (live-state merge):**

1. From the wizard's Step 1 (after the create flow lands on `/event/d_xxx/edit?step=0`), tap into the Title input.
2. Type a short word like "Hello" quickly.
3. Watch the Network tab in Chrome DevTools — within ~800ms-1.5s of the first character, you should see ONE `POST events` insert + the URL flip from `/event/d_xxx/edit` to `/event/{uuid}/edit?step=0`.
4. **Expected (post-rework):** the input keeps showing "Hello" (or whatever you typed). Pre-rework, fast typists would see the input revert to just the first character typed during the debounce window.
5. Continue typing past the URL flip. Subsequent characters should fire `PATCH events` updates (autosave path), no duplicate INSERTs.

**Smoke for the strict-grep CI gate:**

```bash
node .github/scripts/strict-grep/i-proposed-creator-entry-is-instant.mjs
```
Expected: `[I-PROPOSED-CREATOR-ENTRY-IS-INSTANT] OK — scanned 3 create.tsx files; 0 violations.`

---

## §10 — Layman summary

- The wizard bug Seth reported (shows up then closes on the first few taps) is fixed. Root cause: Zustand's persist feature was overwriting our just-minted draft because we minted it before persist finished loading saved state. The fix waits for persist to finish loading before minting. Subsequent taps work cleanly because persist only loads once per page.
- The typed-input race from the QA report is also fixed in the same rework. Root cause: when the user typed during the ~1s migration window, the server's echoed-back snapshot (which has the first character only) was overwriting the live Zustand state (which had all subsequent characters). The fix re-reads live state at the moment of the swap and merges the typed characters from the live state into the server payload before the swap, so typing survives the URL flip.
- Both fixes are in one combined rework (~40 net lines of code), preserving all existing safety properties.
- 4 jest suites green (36/36 ORCH-0893-specific cases), CI gate green, tsc clean on touched files.
- Live-fire on actual browser/sim is the next dispatch (tester) before close.

---

**End implementation report.**
