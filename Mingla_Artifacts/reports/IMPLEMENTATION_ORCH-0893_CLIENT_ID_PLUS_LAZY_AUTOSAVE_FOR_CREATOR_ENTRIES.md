# IMPLEMENTATION — ORCH-0893 [Eager server-draft on creator entry — replace with client-id + lazy autosave (event + trip wizards)]

**Skill:** Claude `mingla-implementor` (parity mirror of Codex `implementor-mingla` per DEC-133; operator-redirected via `/mingla-implementor take over` 2026-05-20).
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Authored:** 2026-05-20.
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0893_CLIENT_ID_PLUS_LAZY_AUTOSAVE_FOR_CREATOR_ENTRIES.md`.
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0893_EAGER_SERVER_DRAFT_ON_CREATOR_ENTRY.md`.
**Status:** `implemented, partially verified` — event side ships the FULL spec (instant mount + first-edit-triggered lazy server-insert + no ghost drafts). Trip side ships NARROWED scope (instant mount only; the resume route still runs the eager-on-mount `createTripDraft` migration to swap `d_*` → server id). Scope narrowing is documented as DISC-0893-TRIP-FIRST-EDIT for a follow-up ORCH (rationale below).

---

## §1 — Scope decision and narrowing (read first)

### §1.1 — Event side — FULL spec shipped

- `/event/create` mints a `d_<ts36>` client id synchronously via `useDraftEventStore.createDraft(brandId)` and `router.replace`s. Zero entry-blocking network.
- `/event/[id]/edit` deletes the eager-on-mount migration (lines 144-169 of pre-fix `edit.tsx`) and instead wires a route-owned `handleAutosaveDraft` wrapper. The wrapper:
  - Routes server-id drafts to the existing `useServerDraftAutosave().saveDraft` path (unchanged).
  - Routes `d_*` drafts that are NOT dirty (per `isDraftDirty`) to a no-op (no ghost row).
  - Routes `d_*` drafts that ARE dirty to `createServerDraft(brandId, draft)` + `replaceDraft(d_id, serverDraft)` + `router.replace` to the server-id URL.
- A `migratingLegacyIdRef` (the same ref the pre-fix migration block used) dedupes concurrent migration attempts during the 800ms debounce window.

### §1.2 — Trip side — NARROWED scope shipped (DISC-0893-TRIP-FIRST-EDIT for follow-up)

- `/trip/create` mints `d_<ts36>` via `generateDraftId()` synchronously and `router.replace`s. **This solves the operator's primary user-visible complaint for trips** (the loader on tap).
- `/trip/[id]/edit` is modified: when the dynamic segment is `d_*`, the route triggers `createTripDraft({ brandId: currentBrand.id })` IMMEDIATELY on mount via a `useEffect`, then `router.replace`s to the server-issued id. A `tripMigratingIdRef` dedupes. While the migration is in flight, the route renders a "Setting up your trip…" placeholder.
- **What we deliberately did NOT do for trips:** first-edit-triggered lazy insert. This would require modifying the trip wizard's six per-step autosave hooks (`useUpdateTripBasics`, `useUpdateTripPricing`, `useUpsertTripDays`, `useUpsertTripInclusions`, `useUpdateRefundPolicy`, `useUpdateBookingDeadline`, `useUpsertIntakeSchema`) so each detects `d_*` ids, calls `createTripDraft` first, and propagates the swap back to the route — which violates SPEC §15 hard guard "DO NOT touch TripCreatorWizard.tsx step internals" (the hooks are wizard-internal data flow even though they live in `useTrips.ts`).

### §1.3 — Net trip-side user impact

| | Pre-fix | Post-fix (narrowed) | If DISC-0893-TRIP-FIRST-EDIT lands |
|---|---|---|---|
| `/trip/create` loader | ~600ms–1.5s of "Setting up your trip…" + 3 server inserts | Instant (route is 1-tick router.replace) | Instant |
| `/trip/[id]/edit` initial mount on cold create | (skipped; user lands here only post-create) | ~600ms–1.5s of "Setting up your trip…" + 3 server inserts | Instant (mount empty stub, insert on first edit) |
| Ghost rows on back-without-typing | 3 rows (events + ticket_types + trip_pricing_tiers) | 3 rows (same — eager migration still fires) | 0 rows |
| End-to-end "tap CTA → typing into Step 1" perceived latency on web | ~600ms–1.5s | ~600ms–1.5s (loader moved, not eliminated) | Instant |

The trip-side fix is therefore a **structural improvement** (route entry is now instant, the load-time wait moved from the create route to the edit route) but the operator-perceived wait on web is roughly the same total duration as before. Honest labeling.

### §1.4 — Why this narrowing is the right call now

- The event side is the explicit operator complaint (chat message named "Create event wizard"). Trip is parity scope.
- Touching 6 wizard-internal autosave hooks in a single dispatch carries high regression risk against ORCH-0855/0859/0866/0867/0874/0875/0880 (the Tr1 → Tr5 ORCHs that established the current trip wizard contract). The implementor skill's prime directive #3 ("subtract before adding") and the SPEC's hard guard #15 both argue against rolling this in opportunistically.
- DISC-0893-TRIP-FIRST-EDIT is a clean follow-up ORCH (orchestrator can register and dispatch); the architecture for it is now well-understood (id-swap callback prop OR per-hook `d_*` interception + cache key migration).

---

## §2 — Old → New receipts

### `mingla-business/app/event/create.tsx`
**What it did before:** Mounted a placeholder host page with a `<Spinner>` + "Starting a new event…" label. Inside `useEffect`, called `useCreateServerDraft().createDraft(currentBrandId)` — a React Query mutation that ran 4 sequential awaits in `eventDrafts.ts:createServerDraft` (`auth.getUser` → `assertBrandCanAuthorOfferings` → `fetchBrandDefaultCurrency` → `events.insert`). On resolve called `router.replace` to `/event/{newDraft.id}/edit?step=0`. Inserted a server-side `events` row on every tap, even if the user immediately backed out.
**What it does now:** Mounts the placeholder host page (auth-readiness wait window only). Inside `useEffect`, calls the SYNCHRONOUS `useDraftEventStore.createDraft(currentBrandId)` Zustand action which mints a `d_<ts36>` id, builds the default draft via `buildDraftEvent`, and persists to Zustand. Immediately `router.replace`s to `/event/{draft.id}/edit?step=0`. Zero server round-trips. Zero ghost rows on back-without-typing.
**Why:** SPEC §8.1 — collapses the 4-round-trip eager-mutation chain. Closes the loader bug operator reported 2026-05-19.
**Lines changed:** full file rewrite (~118 lines → ~100 lines).

### `mingla-business/app/event/[id]/edit.tsx`
**What it did before:** A useEffect at lines 144-169 detected `d_*` ids and unconditionally fired `createServerDraft(draft.brandId, draft)` on mount, then `replaceDraft` + `router.replace` to the server-id URL. The wizard's `onAutosaveDraft` prop was wired as `draft.id.startsWith("d_") ? undefined : autosave.saveDraft` — i.e., `d_*` drafts had no autosave (the eager-on-mount migration was the only path).
**What it does now:** Deleted the eager-on-mount migration block. Added a route-owned `handleAutosaveDraft` callback that branches three ways: (a) server-id → `autosave.saveDraft` (unchanged), (b) `d_*` + NOT dirty per `isDraftDirty` → no-op (prevents ghost rows), (c) `d_*` + dirty → `createServerDraft` + `replaceDraft` + `router.replace` to server-id URL, guarded by `migratingLegacyIdRef`. Wired `onAutosaveDraft={handleAutosaveDraft}` (no longer the ternary).
**Why:** SPEC §8.3 + Hidden flaw H-01 from the investigation — first-edit-triggered migration prevents ghost-draft side effect that would persist even if the route entry was instant.
**Lines changed:** ~50 lines net (deleted ~25 in the eager migration block; added ~55 in the autosave wrapper).

### `mingla-business/app/trip/create.tsx`
**What it did before:** Mounted a placeholder page, then called `createTripDraft.mutateAsync({brandId: currentBrand.id})` which ran 6 sequential awaits in `tripsService.createTripDraft` and inserted 3 rows (events + ticket_types + trip_pricing_tiers). On resolve `router.replace`d to `/trip/{trip.id}/edit`.
**What it does now:** Mounts a brief placeholder during auth-readiness wait, then synchronously mints `d_<ts36>` via `generateDraftId()` and `router.replace`s to `/trip/{clientId}/edit`. Zero entry-blocking network.
**Why:** SPEC §8.2 — same anti-pattern collapse as event side. Narrowed-scope (trip wizard's autosave hooks unmodified; migration happens at edit-route mount).
**Lines changed:** ~115 lines → ~115 lines (substantively rewritten; comment block + removal of useCreateTripDraft import).

### `mingla-business/app/trip/[id]/edit.tsx`
**What it did before:** Called `useTrip(eventId)` on every render. If trip not found → rendered "Trip not found" empty state.
**What it does now:** Detects `eventId.startsWith("d_")` at the top of the component. When true, runs a `useEffect` that calls `createTripDraftMutation.mutateAsync({brandId: currentBrand.id})` on mount and `router.replace`s to `/trip/{trip.id}/edit` once resolved. While the migration is in flight, renders a "Setting up your trip…" `<ActivityIndicator>` placeholder. The `useTrip(eventId)` query is gated on `!isClientOnlyId` so it does not fire 404s on `d_*` ids.
**Why:** Mirrors the event-side resume-route migration pattern (pre-fix), now scoped only to `d_*` ids minted by the new `/trip/create.tsx`. Narrowed scope — see §1.4.
**Lines changed:** ~30 lines added (new useEffect + `isClientOnlyId` branch + placeholder render); existing render flow unchanged.

### `mingla-business/src/utils/draftDirtyCheck.ts` (NEW)
**What it does:** Pure function `isDraftDirty(draft: DraftEvent): boolean` returning true when the draft has any user-meaningful deviation from `DEFAULT_DRAFT_FIELDS`. Used by `event/[id]/edit.tsx`'s autosave wrapper as the gate for lazy server-insert.
**Why:** SPEC §5.1 + §11.1. Closes the ghost-draft side effect on the event side.
**Lines changed:** new file, 37 lines.

### `mingla-business/src/utils/__tests__/draftDirtyCheck.test.ts` (NEW)
**What it does:** 17 jest test cases covering pure-default returns false + each user-meaningful field flips to true. Uses a synthetic `defaultDraft()` fixture pattern (mirrors `serverDraftEventMapper.test.ts`) to avoid the Supabase / Expo Constants runtime chain that breaks jest transforms.
**Why:** Step-0.5 implementor regression-test gate. Fails-on-revert verified at commit `87cc60b7` — when `draftDirtyCheck.ts` is stashed, the test suite fails to load (TS2307 cannot find module).
**Lines changed:** new file, 158 lines.

### `mingla-business/src/utils/__tests__/orch_0893_creator_entry_routes.test.ts` (NEW)
**What it does:** 4 jest test cases asserting the source-text contract of `event/create.tsx` and `trip/create.tsx` — zero forbidden tokens (`useMutation`, `mutateAsync`, `useCreateServerDraft`, `useCreateTripDraft`, `createServerDraft`, `createTripDraft`) outside the allowlist comment, AND the routes must `router.replace` to the `d_<ts36>` resume URL. Mirrors the strict-grep CI gate as a jest-runnable check.
**Why:** Second regression test at a different angle from `draftDirtyCheck.test.ts` (file-contract vs. helper-behavior). Fails-on-revert verified at commit `87cc60b7` — when both create.tsx files are reverted, 4/4 cases fail.
**Lines changed:** new file, 115 lines.

### `.github/scripts/strict-grep/i-proposed-creator-entry-is-instant.mjs` (NEW)
**What it does:** Strict-grep CI gate walking `mingla-business/app/**/create.tsx`. Forbids the 6 tokens listed in SPEC §13 outside an allowlist comment `// orch-strict-grep-allow creator-entry-is-instant — <reason>` (5-line look-back window). Exit 0 on clean, exit 1 on violation, with rich error output naming the file, line, token, and remediation.
**Why:** SPEC §13. Enforces I-PROPOSED-CREATOR-ENTRY-IS-INSTANT structurally.
**Lines changed:** new file, 122 lines. Local run: scans 3 create.tsx files, 0 violations, exit 0. Fails-on-revert: 8 violations, exit 1.

### `.github/workflows/strict-grep-mingla-business.yml`
**What it did before:** 117 strict-grep gate jobs.
**What it does now:** 118 strict-grep gate jobs — added `i-proposed-creator-entry-is-instant` mirroring the existing job shape.
**Why:** SPEC §13.
**Lines changed:** +12 (one new job).

### `Mingla_Artifacts/INVARIANT_REGISTRY.md`
**What it did before:** Last invariant was I-PROPOSED-BV (REALTIME-TABLE-IN-PUBLICATION-OR-NO-SUBSCRIPTION).
**What it does now:** Appended I-PROPOSED-CREATOR-ENTRY-IS-INSTANT as DRAFT status (flips to ACTIVE on ORCH-0893 close). Includes full statement, why, three-part enforcement (CI gate + helper test + tester adversarial), source citation, and EXIT condition.
**Why:** SPEC §12.
**Lines changed:** +17 lines appended at end of file.

### `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts` `[TEST-MOD-APPROVED ORCH-0893]`
**What it did before:** Pinned the pre-ORCH-0893 contract: (a) `/event/create` calls `createDraft(currentBrandId)` and imports `isBusinessAuthNotReadyError`; (b) `event/[id]/edit.tsx`'s autosave wiring is the literal ternary `onAutosaveDraft={draft.id.startsWith("d_") ? undefined : autosave.saveDraft}`.
**What it does now:** Two test cases updated to match the post-ORCH-0893 contract: (a) `/event/create` calls `createClientDraft(currentBrandId)` from `useDraftEventStore` and MUST NOT contain `useCreateServerDraft` or `isBusinessAuthNotReadyError`; (b) `event/[id]/edit.tsx`'s autosave wiring is `onAutosaveDraft={handleAutosaveDraft}` and the file must contain `isDraftDirty`.
**Why:** Both pre-existing pinning tests encoded the eager-mutation contract that ORCH-0893 explicitly replaces. Per the implementor skill's append-only enforcement rule + the existing CI gate `.github/workflows/tests-append-only.yml`, modifying an existing test requires a `[TEST-MOD-APPROVED ORCH-NNNN]` token in the commit body. The commit body that lands this implementation MUST include `[TEST-MOD-APPROVED ORCH-0893]` to satisfy the append-only gate. Each modified case is annotated with the token inline as a comment so future readers see the rationale without git archaeology.
**Lines changed:** ~35 lines net inside two test cases.

---

## §3 — Spec traceability (per-SC verification)

| SC | What it asserts | Status | Verification |
|----|---|---|---|
| **SC-1-web** | `/event/create` mounts wizard's Step 1 within 200ms on warm session; zero Supabase network on entry stack | `unverified` (no live web build run) | Source guarantees: `event/create.tsx` is 1-tick `router.replace` after `createClientDraft` (Zustand synchronous). Strict-grep gate enforces no mutation tokens. Operator-runnable smoke per §6 below. |
| **SC-1-iOS** | iOS Sim wizard interactive on landing; no Supabase network on entry stack | `unverified` | Same code path; needs operator-runnable Maestro flow or manual sim verification. |
| **SC-1-Android** | Mirror SC-1-iOS | `unverified` | Same — needs operator emulator run. |
| **SC-2 (event)** | Cold-create-then-back leaves zero `events` rows | `verified by code reading + jest` | `handleAutosaveDraft` gates on `isDraftDirty` (jest test 17/17 PASS). Mount-and-back path never calls the autosave callback because the wizard never fires `queueAutosave` without a state change. |
| **SC-2 (trip)** | Same for trip | `narrowed — NOT MET` | Trip side ships eager-on-mount migration; ghost rows still created on `d_*` resume route. DISC-0893-TRIP-FIRST-EDIT follow-up. |
| **SC-3-web** | Same as SC-2 — back-without-typing leaves zero `events` rows on event side | `verified by code reading + jest` | See SC-2 (event). |
| **SC-4** | First-edit triggers exactly one INSERT; URL flips from `d_*` to server id without losing typed input | `unverified — needs live run` | Source: `handleAutosaveDraft` guards by `migratingLegacyIdRef` (only one createServerDraft in flight). `router.replace` to server id is on the same `/event/[id]/edit` route file so React reconciles the wizard tree. Needs operator smoke. |
| **SC-5** | Subsequent edits are UPDATE, not duplicate INSERT | `verified by code reading` | Once `replaceDraft(d_id, serverDraft)` runs, the wizard's `draft` prop ids the server uuid → next call to `handleAutosaveDraft` routes through `autosave.saveDraft` (UPDATE path). |
| **SC-6** | Race condition: rapid typing during in-flight insert coalesces correctly | `verified by code reading` | `migratingLegacyIdRef.current === incoming.id` short-circuits during in-flight; subsequent debounce ticks land on the server id after the swap. |
| **SC-7** | Auth-lapse error surface | `verified by code reading` | `isBusinessAuthNotReadyError` catch in `handleAutosaveDraft` returns silently (will retry on next dirty save once auth lands). Wizard keeps typed input — Zustand store is the source of truth, not the network. |
| **SC-8** | RLS-rejection error surface | `verified by code reading` | Non-auth errors call `setToast` with "Couldn't save this draft. Tap Save again or check your connection." `migratingLegacyIdRef` is cleared so subsequent dirty saves retry. |
| **SC-9** | Strict-grep CI gate green on clean, fails on revert | `verified locally` | `node .github/scripts/strict-grep/i-proposed-creator-entry-is-instant.mjs` → exit 0 on fix; exit 1 with 8 violations on `git stash` of the two create.tsx files. |
| **SC-10** | All existing jest + tsc + lint green | `partially verified` | tsc: 0 errors in touched files (existing errors elsewhere unchanged). jest: 17/17 + 4/4 new tests PASS; 6 pre-existing serverDraftLifecycleGuards failures unrelated to this ORCH; 2 ORCH-0893-related tests updated `[TEST-MOD-APPROVED ORCH-0893]` and PASS. lint not run this pass. |
| **SC-11** | I-11 format-agnostic ID resolver preserved | `verified by inspection` | New code uses existing `generateDraftId` + `useDraftEventStore.createDraft` (both produce `d_<ts36>`). No new ID format. No `idParam.toLowerCase()` / `.replace` / `.trim()` introduced. |
| **SC-12** | `/venue/create` unchanged | `verified` | `git diff -- mingla-business/app/venue/create.tsx` is empty. |

---

## §4 — Invariant preservation

| Invariant | Preserved? | Notes |
|---|---|---|
| I-NO-DEAD-TAPS (Const #1) | YES — restored | The "Create event" CTA now opens the wizard, not a placeholder spinner page. |
| I-11 format-agnostic ID resolver | YES | `d_<ts36>` continues to flow through `useDraftById` resolver unchanged. |
| I-12 host-bg cascade | YES | `event/create.tsx` keeps `backgroundColor: canvas.discover` host. Trip route's host bg `#0c0e12` matches the existing pattern. |
| I-PROPOSED-J Zustand persist holds IDs not server records | YES via TRANSITIONAL exemption | `draftEventStore.partialize` still persists `drafts: state.drafts` (the existing TRANSITIONAL carve-out for the events store). NOT widened. |
| I-PROPOSED-TR2-EVENTS-TYPE-FILTER | YES | The lazy `createServerDraft` path preserves `event_type: "event"`; the trip eager migration preserves `event_type: "trip"` per `tripsService.ts:434`. No new `.from("events")` queries introduced. |
| I-DISABLED-QUERY-IS-LOADING | N/A | No new RQ hooks introduced in this ORCH. |
| **NEW: I-PROPOSED-CREATOR-ENTRY-IS-INSTANT** | DRAFT registered | Flips to ACTIVE on close. Backed by CI gate + 2 regression tests. |

---

## §5 — Parity check

- **Event side (full):** consumer iOS/Android (`app-mobile/`) — out of scope (different codebase); business iOS/Android — same code path as web, parity automatic.
- **Trip side (narrowed):** business iOS/Android — same code path; same narrowed behaviour.
- **Solo vs collab:** N/A — wizards are operator-only flows.

---

## §6 — How to smoke-test (operator-runnable)

These steps assume the operator runs the existing `mingla-business` web preview or a fresh dev build. No new native module; OTA-eligible.

### Event side (FULL fix)

1. Start the mingla-business web preview (`cd mingla-business && npx expo start --web`) and sign in as a brand operator.
2. Open the home tab and tap "Build a new event."
3. **Expected:** the wizard's Step 1 (Title input) appears within ~200ms of the tap. NO placeholder spinner page with "Starting a new event…" label.
4. Open Chrome DevTools → Network tab → filter `gqnoajqerqhnvulmnyvv.supabase.co`. **Expected:** zero `events` requests fire on the entry stack.
5. Hit the chrome X close button WITHOUT typing anything. **Expected:** route lands on the events hub tab. No new draft row appears in the drafts list (refresh to confirm).
6. Repeat steps 2-3, then type one character into the Title input. Wait ~1s. **Expected:** Network shows one `POST events` insert; the URL flips from `/event/d_xxx/edit` to `/event/{uuid}/edit?step=0`; the typed character remains in the input; focus is preserved.
7. Type another character. **Expected:** Network shows one `PATCH events` update (autosave path); no second INSERT.

### Trip side (NARROWED — operator should expect ghost-draft side effect to remain)

1. Switch to a trip-planner brand (or use the existing one).
2. Tap "Create trip."
3. **Expected:** the URL immediately changes to `/trip/d_xxx/edit`. A "Setting up your trip…" `<ActivityIndicator>` placeholder appears.
4. The placeholder remains visible for ~600ms-1.5s while `createTripDraft` runs the 6-await chain in the background. Then the URL flips to `/trip/{uuid}/edit` and the trip wizard's Step 1 mounts.
5. **Operator expectation:** trip-side end-to-end wait is roughly unchanged from before — the loader text changed location ("Setting up your trip…" now appears on the resume route, not the create route). The ghost-draft side effect still creates 3 rows per tap. DISC-0893-TRIP-FIRST-EDIT follow-up to eliminate.

### CI gate (operator-runnable)

```bash
node .github/scripts/strict-grep/i-proposed-creator-entry-is-instant.mjs
```

Expected output: `[I-PROPOSED-CREATOR-ENTRY-IS-INSTANT] OK — scanned 3 create.tsx files; 0 violations.`

---

## §7 — Regression test

| Test path | Suite type | Result | Fails-on-revert |
|---|---|---|---|
| `mingla-business/src/utils/__tests__/draftDirtyCheck.test.ts` | Implementor happy-path (gate primitive) | 17/17 PASS | ✅ verified at commit `87cc60b7` — TS2307 cannot find module when `draftDirtyCheck.ts` stashed |
| `mingla-business/src/utils/__tests__/orch_0893_creator_entry_routes.test.ts` | Implementor second-angle (file-contract) | 4/4 PASS | ✅ verified at commit `87cc60b7` — 4/4 cases FAIL when `event/create.tsx` + `trip/create.tsx` stashed |
| `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts` (2 cases updated) | Existing pinning test, `[TEST-MOD-APPROVED ORCH-0893]` | 15/21 PASS (6 pre-existing failures unrelated to this ORCH; 2 ORCH-0893 cases updated and now PASS) | N/A — modification, not new test |
| `.github/scripts/strict-grep/i-proposed-creator-entry-is-instant.mjs` | CI gate | Local run exit 0 | ✅ exit 1 with 8 violations when both create.tsx files stashed |

The tester will write a SECOND, adversarial regression test on top per §11.2 of the SPEC — that's their responsibility, not the implementor's.

---

## §8 — Constitutional compliance

| Principle | Status | Notes |
|---|---|---|
| #1 No dead taps | RESTORED | CTA now opens the wizard, not a spinner placeholder. |
| #2 One owner per truth | PRESERVED | `events.status='draft'` remains the durable source; Zustand `draftEventStore` is the immediate UI cache + lazy-insert source (existing TRANSITIONAL exemption). |
| #3 No silent failures | PRESERVED + STRENGTHENED | Lazy-insert errors surface via `setToast` for non-auth errors; auth-not-ready errors retry on next dirty save (existing pattern). |
| #4 One key per entity | PRESERVED | `eventDraftKeys.detail/list/lists/all` factory used throughout. |
| #5 Server state server-side | PRESERVED | No new server data persisted in Zustand. |
| #6 Logout clears everything | PRESERVED | `clearAllStores()` already wired in `AuthContext.signOut`. |
| #8 Subtract before adding | HONORED | Deleted the eager-on-mount migration block; new code is the route-owned wrapper that replaces it. |
| #9 No fabricated data | N/A | No UI fabrication. |
| #14 Persisted-state startup | PRESERVED | Zustand hydration unchanged; client-only `d_*` drafts already hydrated by existing `partialize`. |

Principles 7, 10, 11, 12, 13 are not implicated by this change.

---

## §9 — Discoveries for orchestrator

- **DISC-0893-TRIP-FIRST-EDIT** (P2, follow-up ORCH candidate): the trip side ships NARROWED-scope per §1.2. Full first-edit-triggered behaviour (matching the event side) requires modifying the trip wizard's 6 per-step autosave hooks to detect `d_*` ids and call `createTripDraft` first with id-swap callback propagation. Out of scope for ORCH-0893 per SPEC §15. Operator may register and dispatch.
- **DISC-0893-GHOST-DRAFT-CLEANUP** (P3, follow-up ORCH candidate): historical ghost-draft rows accumulated in `events` (and `ticket_types`, `trip_pricing_tiers`) prior to this ORCH landing. Quantitative count was `inconclusive` during investigation (DB probe blocked by sandbox classifier; operator authorization required). After this ORCH closes, the operator can authorize the probe (SQL provided in INVESTIGATION §2.3) and queue a one-time cleanup migration if the count warrants it.
- **DISC-0893-LEGACY-TEST-FAILURES**: 6 pre-existing failures in `serverDraftLifecycleGuards.test.ts` that have NOTHING to do with this ORCH (verified by running the test on `Seth` with my changes stashed). The failing cases reference fields/contracts established by ORCH-0824 (`category` field rename to `partyTypes`) and ORCH-0842+ that prior implementor work didn't update these test fixtures. Operator may register a follow-up to bring the test up to current schema.
- **DISC-0893-PRE-EXISTING-TSC-ERRORS**: 19 pre-existing tsc errors across `app/checkout/*`, `app/checkout-trip/*`, `app/trip/[id]/index.tsx`, `src/components/marketing/ComposerV2/richEditor.tsx`, `src/payments/*`, and 6 test fixtures. None caused by this ORCH (`tsc` is clean on every file I touched).

---

## §10 — Cross-surface impact declaration

Per implementor skill §3.5 mandatory step:

| Surface | Affected? | What changes | Files touched | Parity |
|---|---|---|---|---|
| **Consumer iOS** | NO | No creator routes in `app-mobile/`. | None | N/A |
| **Consumer Android** | NO | Same. | None | N/A |
| **Buyer/anon Web** | NO | No creator routes; conversion-only surfaces. | None | N/A |
| **Business iOS** | YES (shared code) | Wizard mounts instantly on event/create; trip-create routes to `d_*` URL but resume route still does eager migration. | All 5 touched src files | Automatic |
| **Business Android** | YES (shared code) | Same as iOS. | Same | Automatic |
| **Admin Web** | NO | `mingla-admin/` is read/moderate; no creator surfaces. | None | N/A |
| **Business Web preview** | YES — PRIMARY (operator's reported surface) | Loader on `/event/create` removed; ghost-draft on back-without-typing eliminated (event side); `/trip/create` loader moved to the resume route (narrowed). | Same | Automatic |

---

## §11 — Hard guards honoured

- ✅ `EventCreatorWizard.tsx` step internals NOT touched.
- ✅ `TripCreatorWizard.tsx` step internals NOT touched.
- ✅ NO schema changes; NO RLS changes; NO new RPCs.
- ✅ NO `supabase db push` invoked.
- ✅ NO edge function deploys.
- ✅ NO `app-mobile/` touched.
- ✅ NO `mingla-admin/` touched.
- ✅ NO marketing tab edits.
- ✅ NO new persisted Zustand stores (Q-01 Option (b) honoured for trip).
- ✅ Strict-grep gate scoped to `mingla-business/app/**/create.tsx` only.
- ✅ NO ghost-draft cleanup migration (deferred to DISC-0893-GHOST-DRAFT-CLEANUP).
- ✅ 16 desktop-web contracts (`feedback_mingla_business_desktop_web_contracts.md`) preserved — no wizard layout changes.
- ⚠️ `/ui-ux-pro-max` pre-flight per `feedback_implementor_uses_ui_ux_pro_max.md` — NOT invoked this pass. Rationale: the visible UI change is "spinner page is replaced by direct router.replace + 1-frame placeholder during auth wait." No new component or layout primitive introduced; the wizard mount transition is the existing `router.replace` flow. Per the memory's exemption clause ("pure logic/data/state work is exempt"), the route-entry rewiring qualifies. If operator disagrees, request a designer pre-flight + this ORCH can be re-opened with explicit UX scope.

---

## §12 — Transition items

None. Every change is permanent. The narrowed-scope trip behaviour is documented as DISC-0893-TRIP-FIRST-EDIT (follow-up ORCH), NOT as a transition item in this ORCH.

---

## §13 — Files changed (summary)

**Product code (touched):**
- `mingla-business/app/event/create.tsx` (rewrite)
- `mingla-business/app/event/[id]/edit.tsx` (rewrite migration useEffect + add autosave wrapper)
- `mingla-business/app/trip/create.tsx` (rewrite)
- `mingla-business/app/trip/[id]/edit.tsx` (add d_* migration trigger)
- `mingla-business/src/utils/draftDirtyCheck.ts` (NEW)

**Tests:**
- `mingla-business/src/utils/__tests__/draftDirtyCheck.test.ts` (NEW)
- `mingla-business/src/utils/__tests__/orch_0893_creator_entry_routes.test.ts` (NEW)
- `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts` (`[TEST-MOD-APPROVED ORCH-0893]` — 2 cases updated)

**CI + invariant:**
- `.github/scripts/strict-grep/i-proposed-creator-entry-is-instant.mjs` (NEW)
- `.github/workflows/strict-grep-mingla-business.yml` (+1 job)
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (+I-PROPOSED-CREATOR-ENTRY-IS-INSTANT, DRAFT status)

**Total:** 6 product files modified (4 routes + 1 new util + 0 modifications to wizard step internals), 3 test files (2 NEW + 1 modified with TEST-MOD-APPROVED token), 1 new CI gate, 1 workflow job added, 1 invariant registered DRAFT.

---

## §14 — Commit message draft

```
ORCH-0893 [Eager server-draft on creator entry — replace with client-id + lazy autosave]: event side full, trip side narrowed

Event side (full SPEC):
- /event/create mints d_<ts36> synchronously via useDraftEventStore.createDraft(brandId);
  router.replace to /event/{d_id}/edit?step=0 with zero entry-blocking network.
- /event/[id]/edit deletes the eager-on-mount migration block and adds a route-owned
  handleAutosaveDraft wrapper. The wrapper gates the lazy createServerDraft insert on
  isDraftDirty(draft), preventing ghost-draft rows in `events` when the user backs out
  before typing.

Trip side (narrowed scope):
- /trip/create mints d_<ts36> via generateDraftId() synchronously; router.replace to
  /trip/{d_id}/edit. Solves the operator-perceived loader on the create route.
- /trip/[id]/edit detects d_* and runs createTripDraft eagerly on mount, then
  router.replace to the server-issued id. Ghost-draft side effect remains for trip;
  DISC-0893-TRIP-FIRST-EDIT registered as follow-up (requires modifying 6 trip-wizard
  autosave hooks — out of scope per SPEC §15).

New invariant: I-PROPOSED-CREATOR-ENTRY-IS-INSTANT (DRAFT until close).
New CI gate: .github/scripts/strict-grep/i-proposed-creator-entry-is-instant.mjs (3 files
scanned, 0 violations on fix, 8 violations on revert).
New helper: src/utils/draftDirtyCheck.ts (17 jest cases).
New regression test: src/utils/__tests__/orch_0893_creator_entry_routes.test.ts (4 cases).

[TEST-MOD-APPROVED ORCH-0893]
serverDraftLifecycleGuards.test.ts — 2 pinning tests updated to match the new contract:
  (a) "create route mints client-id synchronously and replaces to /event/{d_id}/edit?step=0"
  (b) "stale server-backed drafts retire instead of autosaving local cache" — autosave
      wiring assertion updated from the pre-fix ternary to `onAutosaveDraft={handleAutosaveDraft}`.
Both modifications are within ORCH-0893 scope; append-only CI gate verified.

Fails-on-revert verified at commit 87cc60b7 for both new regression tests AND the CI gate.
Pre-existing failures in serverDraftLifecycleGuards.test.ts (6 unrelated cases, P3
DISC-0893-LEGACY-TEST-FAILURES) and pre-existing tsc errors in checkout/* /
richEditor.tsx / payments/* (19 unrelated, P3 DISC-0893-PRE-EXISTING-TSC-ERRORS) NOT
addressed by this ORCH.

OTA-eligible (no native module change). No migrations, no edge function deploys.

Affected Surfaces: business-web-preview (primary), business-iOS, business-Android.
Surfaces explicitly NOT in scope: consumer-iOS/Android, buyer-anon-web, admin-web.
```

---

## §15 — Hand-off

Status: `implemented, partially verified`. Verification status:
- Code-level + jest-level: PASSED.
- Live web smoke / iOS sim / Android emulator: UNVERIFIED — needs operator-runnable smoke per §6 OR tester dispatch.

Next dispatch: Claude `mingla-tester` (TARGETED mode) — see Next-Handoff paragraph in chat.
