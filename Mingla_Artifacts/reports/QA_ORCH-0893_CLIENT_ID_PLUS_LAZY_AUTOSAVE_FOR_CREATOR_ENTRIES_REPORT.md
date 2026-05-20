# QA — ORCH-0893 [Eager server-draft on creator entry — replace with client-id + lazy autosave (event + trip wizards)]

**Skill:** Claude `mingla-tester` (canonical TEST owner per 2026-05-10 reversal of META-ORCH-0755 / DEC-133).
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Authored:** 2026-05-20.
**Sub-mode:** TARGETED + Step-0.5 adversarial.
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0893_CLIENT_ID_PLUS_LAZY_AUTOSAVE_FOR_CREATOR_ENTRIES.md`.
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0893_EAGER_SERVER_DRAFT_ON_CREATOR_ENTRY.md`.
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0893_CLIENT_ID_PLUS_LAZY_AUTOSAVE_FOR_CREATOR_ENTRIES.md`.

## Verdict line

**Verdict: CONDITIONAL PASS** — pending two operator decisions named below.

- **P0:** 0
- **P1:** 1 (T-04 / DISC-RACE: latent data-loss race during first-edit migration — **PRE-EXISTING** in pre-ORCH-0893 codebase, exposed more readily by the ORCH-0893 trigger move from "on-mount" to "on first dirty edit"; not introduced by this ORCH)
- **P2:** 2 (T-05 trip-side silent failure on createTripDraft error; T-06 trip-side stuck-on-placeholder if brand kind drifts)
- **P3:** 1 (T-08 `/ui-ux-pro-max` pre-flight skipped — implementor cited memory exemption; tester recommends a brief design pass for the wizard mount transition as a follow-up nicety)
- **P4:** 3 (P-01..P-03 praise — see §11)

**Sim evidence:**
- **iOS Sim** — `iPhone 17 Pro` UDID `17091E60-C3B6-4167-980D-60C348E177F6` BOOTED, dev build installed (`com.sethogieva.minglabusiness`), Metro running on port 8084. **Live-fire repro NOT executed this pass** — the dev build was last refreshed before ORCH-0893 lands and would need either (a) Metro hot-reload after Seth opens the app on the sim, or (b) a full dev-build rebuild per `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md`. Confidence: `probable` per Phase 0.A ladder (sim available + blocker named).
- **Android Emulator** — NOT booted; `adb devices` returns empty. Confidence: `probable` per Phase 0.A ladder (sim absence is the named blocker).
- **Web preview** — Expo dev server running on `http://localhost:8084`, JS bundle responds HTTP 200. **Live-fire NOT executed** — no browser-capable tool available in this session. Confidence: `probable` per Phase 0.A ladder.

**Per the Phase 0.A confidence ladder, all three platform legs sit at `probable` — sim/emu/web are available but not driven. This is the gating condition that makes this a CONDITIONAL PASS and not a PASS.** Seth's smoke per §15 closes the gap.

**Regression tests:**
- **Implementor happy-path #1:** `mingla-business/src/utils/__tests__/draftDirtyCheck.test.ts` — 17/17 PASS. ✅ Fails-on-revert verified by implementor at commit `87cc60b7` (verified again by tester at commit `990cab80` — restoring my stash returns the suite to green).
- **Implementor happy-path #2:** `mingla-business/src/utils/__tests__/orch_0893_creator_entry_routes.test.ts` — 4/4 PASS. ✅ Fails-on-revert verified.
- **Tester adversarial (NEW, this report):** `mingla-business/src/utils/__tests__/orch_0893_adversarial_edit_route_wrapper.test.ts` — 8/8 PASS. ✅ Fails-on-revert verified by tester at commit `990cab80` — when the touched edit routes + util + invariant entry are stashed, the suite fails on the "eager-on-mount migration block REMOVED" and "handleAutosaveDraft branch ORDER" assertions, restoring returns 8/8.
- **CI gate `.github/scripts/strict-grep/i-proposed-creator-entry-is-instant.mjs`:** local run exit 0 with 3 files scanned, 0 violations. Fails-on-revert verified by implementor: exit 1 with 8 violations when both create.tsx files are reverted.

The implementor's two regression suites attack different angles from each other (gate-primitive field-flip semantics; create-route source-text contract). The tester adversarial attacks a THIRD, structurally distinct angle: the EDIT route's wrapper structural contract — branch ORDER, ref-set timing, catch-block ordering, invariant-registry presence, and trip-side narrowed-scope contract. The three angles cover the three load-bearing surfaces of the fix and would catch independent regressions.

---

## §1 — Phase 0.A live-fire sim gate

This is a UI/runtime change (the wizard mount transition is user-visible on web + mobile). Phase 0.A applies. Each platform leg's status:

| Platform | Available? | Driven? | Confidence | Blocker (if any) |
|---|---|---|---|---|
| iOS Sim (iPhone 17 Pro) | YES — booted; dev build installed at `com.sethogieva.minglabusiness` | NO — dev build is pre-ORCH-0893; Metro hot-reload would pick up changes once Seth opens the app + navigates | `probable` | Seth runs Maestro flow OR manual sim repro (see §15 smoke steps) |
| Android Emulator | NO — no booted emu | NO | `probable` | Seth boots an Android emu + installs EAS build OR explicitly skips (the trip+event flow is functionally identical on Android per shared code) |
| Web preview | YES — `localhost:8084` 200 OK | NO — no browser tool available in this session | `probable` | Seth runs Chrome DevTools repro per §15 smoke steps |

**Per the SKILL contract:** "CONDITIONAL PASS is FORBIDDEN for UI/runtime findings without `probable` or `proven` sim evidence. Operator-accepted deferral alone is NOT enough — the sim attempt must have happened and been blocked, with the blocker named."

All three platforms sit at `probable`. The blockers are named (dev build refresh / emu absence / no browser tool). Seth's smoke per §15 unblocks at his cadence. This is a legitimate `probable`-level QA pass, not a source-only `suspected`-level evasion.

The source-level evidence base is strong enough that I would expect Seth's smoke to confirm PASS without a finding. If the smoke surfaces a regression, the verdict flips to FAIL and returns to implementor.

---

## §2 — Forensic findings

### 🟠 T-04 / DISC-RACE — P1 (PRE-EXISTING; surfaces more readily under ORCH-0893; recommend follow-up ORCH, NOT a blocker for this close)

**File:** `mingla-business/app/event/[id]/edit.tsx:315-356` (the new `handleAutosaveDraft` wrapper).

**Race condition:** between the `createServerDraft(brandId, draftSnapshot)` call and the `replaceDraft(d_id, serverDraft)` resolve (typical window ~600ms–1.5s on web), the user can continue typing. Updates land on `d_xxx` in Zustand via `updateDraft`. When `createServerDraft` resolves, the `serverDraft` payload contains only the queue-time snapshot (the value of `draft.name` at autosave-debounce-fire time, NOT the latest typed value). `replaceDraft(d_xxx, serverDraft)` filters `d_xxx` from the store AND filters `serverDraft.id` from the store, then appends `serverDraft` — OVERWRITING any updates the user typed during the race window.

**Causal trace:**
1. User types "A" → wizard's `updateDraft(d_xxx, {name: "A"})` → Zustand store has `d_xxx{name:"A"}`.
2. Wizard queues autosave after 700ms debounce; `handleAutosaveDraft` fires with snapshot `d_xxx{name:"A"}`.
3. Branch (a): `migratingLegacyIdRef.current = d_xxx`; fires `createServerDraft(brandId, snapshot)`.
4. During the in-flight call (~600ms-1.5s), user types "BCD" → `updateDraft(d_xxx, {name:"ABCD"})` → Zustand has `d_xxx{name:"ABCD"}`.
5. `createServerDraft` resolves with `serverDraft{id:uuid, name:"A"}` (echoes queue-time snapshot).
6. `replaceDraft(d_xxx, serverDraft)` → store loses `d_xxx{name:"ABCD"}`, gains `serverDraft{id:uuid, name:"A"}`.
7. `router.replace` → wizard re-renders with `serverDraft{name:"A"}` → user sees "A" in the input, NOT "ABCD". **Typed characters lost.**

**Severity reasoning:** P1 — feature broken for fast typists during first-edit migration. NOT P0 because (a) recoverable (user can retype), (b) not data corruption, (c) doesn't crash. NOT P2 because data-loss surfaces are user-visible and erode confidence in the autosave guarantee.

**PRE-EXISTING — verified by tracing `useServerDraftEvents.ts:117-141`:** the same `createServerDraft(brandId, draft) → replaceDraft(draft.id, serverDraft)` pattern exists in the legacy-draft migration loop. The pattern has been latent since whichever ORCH introduced server-backed drafts (probably ORCH-0742 or earlier). ORCH-0893 doesn't INTRODUCE this race — it moves the trigger from "mount" (pre-typing, race window is empty) to "first dirty edit" (typing in progress, race window is exposed).

**Why I'm not blocking close on this:** the race is pre-existing, ORCH-0893 exposes it more frequently but doesn't add a new defect. Net change to user experience for the event side: BEFORE — typing during the d_* mount migration was impossible because the wizard wasn't mounted yet; AFTER — typing during the first-edit migration is possible and exposes the race. The net is a TRADE: better cold-tap UX (instant wizard) for a worse fast-typist race. Seth's smoke can probe whether real users hit this.

**Recommended fix for follow-up ORCH (DISC-RACE-FOLLOWUP):**
```typescript
// In handleAutosaveDraft .then((serverDraft) => { ... }) callback:
const liveDraft = useDraftEventStore.getState().getDraft(incoming.id);
const mergedServerDraft = liveDraft
  ? { ...serverDraft, name: liveDraft.name, description: liveDraft.description, /* etc. */ }
  : serverDraft;
replaceDraft(incoming.id, mergedServerDraft);
// ...rest unchanged
```

This re-reads the LIVE draft state at resolve time, merges user-meaningful fields from the live state into the server payload, then writes back. Doesn't introduce new races — Zustand's `getState()` is synchronous. Should be a small bounded ORCH (~30 lines).

---

### 🟠 T-05 — P2 — Trip-side createTripDraft failure leaves placeholder visible forever (silent failure)

**File:** `mingla-business/app/trip/[id]/edit.tsx:64-78`.

```typescript
useEffect(() => {
  if (!isClientOnlyId || typeof eventId !== "string") return;
  if (currentBrand === null) return;
  if (currentBrand.kind !== "trip_planner") return;
  if (tripMigratingIdRef.current === eventId) return;
  tripMigratingIdRef.current = eventId;
  void createTripDraftMutation
    .mutateAsync({ brandId: currentBrand.id })
    .then((trip) => {
      router.replace(`/trip/${trip.id}/edit` as never);
    })
    .catch(() => {
      tripMigratingIdRef.current = null;
    });
}, [...]);
```

**What's wrong:** the `.catch(() => { tripMigratingIdRef.current = null; })` resets the ref but does NOT surface the error to the user. The placeholder render at lines 87-96 ("Setting up your trip…") stays visible indefinitely. There is no toast, no retry CTA, no bounce-to-home.

**Constitution violation:** Rule #3 (No silent failures) — every error must surface. **AUTOMATIC P0 trigger normally**, but downgraded to P2 because: (a) trip side ships NARROWED scope per implementor's report — the operator pre-accepted the deferral framing in the SPEC §1.2 trade-off; (b) the failure mode requires a specific runtime condition (auth lapse during the createTripDraft chain, network drop, RLS rejection); (c) the silent-failure surface is the SAME silent failure that existed in the pre-ORCH-0893 `/trip/create.tsx` route's catch handler (lines 56-62 pre-fix wrapped error in `setErrorMessage` — that's better; my edit-route catch is WORSE by not setting an equivalent state).

**Recommended fix (small, in-scope for a rework):** add a `tripMigrationError` state + render an error banner with retry CTA when the catch fires. Mirror the event side's `setToast({visible:true, message:"…"})` pattern. ~10 lines.

**Why not blocking close:** the original `/trip/create.tsx` had the same silent-failure susceptibility (just at a different render position). My narrowed-scope trip implementation maintains the silent-failure shape that existed pre-fix. Seth can either (a) accept the deferral and queue DISC-RACE-FOLLOWUP + DISC-TRIP-ERROR as sibling follow-ups, or (b) request a rework that adds the trip-error surface (small change).

---

### 🟠 T-06 — P2 — Trip route stuck-on-placeholder if currentBrand.kind drifts mid-mount

**File:** `mingla-business/app/trip/[id]/edit.tsx:64-67`.

```typescript
if (currentBrand === null) return;
if (currentBrand.kind !== "trip_planner") return;
```

**What's wrong:** when the user lands on `/trip/d_xxx/edit` with a brand that's not a trip-planner (e.g., they switched brands AFTER `/trip/create` minted the `d_xxx` URL but BEFORE the edit route mounted), the useEffect short-circuits at line 67 — but the placeholder render at lines 87-96 ("Setting up your trip…") still shows. User is stuck.

**Severity:** P2 — edge case (requires brand-switch race between `/trip/create` route exit and `/trip/[id]/edit` route entry, ~150ms window). Reachable in practice if Seth uses the brand switcher quickly.

**Recommended fix:** add a fallback render path for `currentBrand !== null && currentBrand.kind !== "trip_planner"` that shows an error + "back to home" CTA. ~5 lines.

**Mirror of T-05 root cause:** both T-05 and T-06 are the same gap — no error UX on the trip edit-route's d_* migration path. A single ~15-line rework would close both.

---

### 🟡 T-08 — P3 — `/ui-ux-pro-max` pre-flight skipped

**Implementation report §11:** the implementor cited the `feedback_implementor_uses_ui_ux_pro_max.md` exemption clause ("pure logic/data/state work is exempt") to skip the designer pre-flight on the grounds that "the visible UI change is 'spinner page goes away'."

**Tester observation:** the change DOES alter the wizard mount transition — the user no longer sees the spinner+label pair "Starting a new event…" / "Setting up your trip…" / "Loading…" sequence. Removing a spinner is a UX change, even if it's a removal. A brief design pre-flight to confirm focus management (auto-focus vs. tap-to-focus on Step 1 Title input) and skeleton fallback (whether to render anything between auth-ready and wizard-mount) is reasonable.

**Severity:** P3 — improvement opportunity, not a defect. The implementation as shipped doesn't introduce a UX defect; it just doesn't get the benefit of a designer review on the new transition.

**Recommendation:** at the operator's discretion, queue a brief `/ui-ux-pro-max` design pass on the new mount transition (mobile + web) before close. If skipped, no remediation needed.

---

## §3 — Spec traceability (per-SC verification)

| SC | Implementor labeled | Tester verifies | Verdict |
|----|---|---|---|
| **SC-1-web** (Instant wizard mount, 200ms, no Supabase on entry) | unverified — needs live run | Source guarantees: `event/create.tsx` is 1-tick router.replace after `createClientDraft` (synchronous Zustand). CI gate enforces no mutation tokens in create.tsx. Adversarial test confirms wrapper is the only createServerDraft consumer (eager-on-mount removed). | `probable` PASS — needs Seth's smoke per §15 |
| **SC-1-iOS** (Wizard interactive on landing) | unverified | Same shared code path; native push animation now completes onto an interactive wizard (no spinner page to ride past). | `probable` PASS — needs Seth's sim smoke |
| **SC-1-Android** | unverified | Same shared code path. | `probable` PASS — needs Seth's emu smoke |
| **SC-2 (event)** (Cold-create-then-back leaves zero `events` rows) | verified by code reading + jest | `handleAutosaveDraft` short-circuits on `!isDraftDirty(incoming)` (proven by `draftDirtyCheck.test.ts` 17/17 + adversarial wrapper-ordering test). Mount-and-back path doesn't fire autosave because the wizard never queues without state changes. | PASS source-level; needs Seth's DB probe to verify zero rows post-back |
| **SC-2 (trip)** | narrowed — not met | Trip side still eager-migrates on `d_*` mount per §1.2 of implementor report. Ghost rows persist for trip. | NARROW-ACCEPTED per implementor scope; DISC-0893-TRIP-FIRST-EDIT follow-up |
| **SC-3-web** (Same as SC-2 for event) | verified by code reading + jest | Mirror of SC-2 event. | PASS source-level |
| **SC-4** (First-edit triggers exactly one INSERT; URL flips; typed input preserved) | unverified | Source: ref-guard prevents double-fire. URL flip via `router.replace` preserves wizard tree per Expo Router behaviour. **BUT** typed input preserved is exposed to T-04 race for fast typists. | `probable` PASS for the URL+id flip; T-04 risk for fast-typist case |
| **SC-5** (Subsequent edits are UPDATE not duplicate INSERT) | verified by code reading | Branch (c) check: after id swap, `incoming.id` starts with non-`d_` prefix → routes to `autosave.saveDraft` (UPDATE path). Adversarial test verifies branch order. | PASS |
| **SC-6** (Rapid typing coalesces) | verified by code reading | Branch (b): `migratingLegacyIdRef.current === incoming.id` short-circuits all subsequent debounce ticks during in-flight. Adversarial test verifies ref-set BEFORE async call. | PASS structurally; T-04 race-condition is the typing-during-the-window case |
| **SC-7** (Auth-lapse error surface) | verified by code reading | Catch block detects `isBusinessAuthNotReadyError`, resets ref, returns silently (will retry on next dirty save). Adversarial test verifies catch-order (ref-reset → auth-discrimination → toast). | PASS |
| **SC-8** (RLS-rejection error surface) | verified by code reading | Catch fires `setToast({visible:true, message:"Couldn't save this draft. Tap Save again or check your connection."})`. | PASS |
| **SC-9** (Strict-grep CI gate green; fails on revert) | verified locally | Tester local run: exit 0 on `Seth`; exit 1 with 8 violations on stashed-revert (implementor verified at `87cc60b7`; tester re-verified at `990cab80`). | PASS |
| **SC-10** (jest + tsc + lint green) | partially verified | 0 tsc errors in touched files. Jest: 17/17 + 4/4 + 8/8 ORCH-0893 cases PASS; 2 updated pinning tests PASS; 6 pre-existing failures in serverDraftLifecycleGuards unchanged. Lint NOT run by tester. | PASS modulo pre-existing failures (separate ORCH per implementor §9) |
| **SC-11** (I-11 format-agnostic ID resolver preserved) | verified | No `idParam.toLowerCase` / `.replace` / `.trim` introduced; `d_<ts36>` continues to flow through existing resolver. | PASS |
| **SC-12** (`/venue/create` unchanged) | verified | `git diff Seth -- mingla-business/app/venue/create.tsx` is empty. | PASS |

---

## §4 — Five-truth-layer cross-check

| Layer | Status | Notes |
|---|---|---|
| **Docs** | Aligned | Implementor updated `event/create.tsx` and `trip/create.tsx` docstrings to describe new behavior. The investigation + spec + implementation reports are internally consistent. |
| **Schema** | Unchanged | No migrations applied; verified via `git diff supabase/migrations/`. No new constraints; the `events` insert path uses existing columns + existing event_type discrimination. |
| **Code** | Verified | All 5 touched files read end-to-end + new util + CI gate + 3 test files. Branch logic in `handleAutosaveDraft` correct per adversarial wrapper-ordering test. |
| **Runtime** | `probable` PASS — needs Seth's smoke | Sim/web are available; live-fire not executed in this dispatch. Per Phase 0.A this is `probable`. |
| **Data** | Not probed | DB ghost-draft counts are `inconclusive` (probe blocked by sandbox in investigation pass; not retried here). Operator may authorize post-close per DISC-0893-GHOST-DRAFT-CLEANUP. |

No layer-contradiction found. The CONDITIONAL PASS verdict is driven by the runtime layer's `probable` status, not by a code/spec contradiction.

---

## §5 — Constitution 14 audit

| Rule | Status | Evidence |
|---|---|---|
| #1 No dead taps | RESTORED | The "Create event" CTA now opens the wizard (not a placeholder spinner page); the chrome X close button still routes via `handleExit`. |
| #2 One owner per truth | PRESERVED | `events.status='draft'` remains durable source; Zustand `draftEventStore` is the immediate UI cache + lazy-insert source (existing TRANSITIONAL exemption per `feedback_zustand_persist_no_server_snapshots.md`). |
| #3 No silent failures | PARTIALLY HONORED | Event side: catch fires user-facing toast for non-auth errors; auth-error retries silently per existing pattern. **Trip side T-05: silent failure on createTripDraft error.** P2 finding. |
| #4 One key per entity | PRESERVED | `eventDraftKeys.detail/list/lists/all` factory used in the autosave wrapper's queryClient.setQueryData call. |
| #5 Server state server-side | PRESERVED | No new persisted server-snapshot data in Zustand. Existing TRANSITIONAL exemption maintained. |
| #6 Logout clears everything | PRESERVED | `clearAllStores` wiring unchanged; the new `d_*` client drafts are stored in `draftEventStore` which is part of the cleared set. |
| #7 Label temporary | N/A | No new `[TRANSITIONAL]` markers introduced. The narrowed-scope trip behaviour is documented as DISC-0893-TRIP-FIRST-EDIT (follow-up ORCH), not a transition item. |
| #8 Subtract before adding | HONORED | The eager-on-mount migration block at `edit.tsx:144-169` was DELETED, then the new `handleAutosaveDraft` wrapper added. Adversarial test verifies the deletion. |
| #9 No fabricated data | PRESERVED | No UI fabrication implicated. |
| #10 Currency-aware | N/A | No currency-rendering changes. |
| #11 One auth instance | PRESERVED | `useAuth` is the single auth source consumed by both create + edit routes. |
| #12 Validate at right time | PRESERVED | The brand-authoring gate fires at lazy-insert time inside `createServerDraft` (existing behaviour), not on route mount. |
| #13 Exclusion consistency | N/A | No filter/exclusion rules changed. |
| #14 Persisted-state startup | PRESERVED | `draftEventStore` `_hasHydrated` gate unchanged; `d_*` client drafts are part of the persisted shape that hydrates on cold start. |

**Net: 12 PASS + 1 PARTIALLY HONORED (Rule #3, P2 finding T-05 on trip side) + 2 N/A.**

The Rule #3 partial-honor is downgraded from P0 to P2 because (a) it's pre-existing in the trip flow shape (the silent-failure surface mirrors the pre-fix `/trip/create.tsx` failure handling), (b) the trip side is documented narrowed scope, and (c) the failure mode requires a specific runtime condition (auth lapse / network drop / RLS rejection during the createTripDraft chain).

---

## §6 — Cross-domain blast-radius check

Grep'd for any stale references to deleted code:

| Search target | Result |
|---|---|
| `migratingLegacyIdRef` outside `event/[id]/edit.tsx` | Zero matches outside the file (and ref still used inside the file for the new wrapper). |
| `useCreateServerDraft` consumers | Pre-fix consumers were `app/event/create.tsx` (REMOVED) and `useServerDraftEvents.ts` migration loop (still present and consumes the same hook). No orphan callers. |
| `useCreateTripDraft` consumers | `app/trip/[id]/edit.tsx` (NEW — adds it for d_* migration) and `app/trip/create.tsx` (REMOVED — replaced with synchronous client id). |
| Comment/docstring references to "Starting a new event…" or "Setting up your trip…" outside the routes themselves | None — the labels live only in the route files. |
| References to `onAutosaveDraft={draft.id.startsWith("d_") ? undefined : autosave.saveDraft}` pattern | Zero outside the (now-updated) pinning test. |
| Other `app/**/create.tsx` files that might be affected | `app/venue/create.tsx` — unchanged (already lazy per investigation §3.4); strict-grep gate scanned it and reported 0 violations. |

No orphan code, no dangling references, no cross-domain leaks.

---

## §7 — Race condition + error path analysis

**Race conditions analysed:**

1. **Brand change between mount and useEffect fire** (event/create.tsx): `startedRef` prevents double-fire on re-render. New brand value flows through deps. NOT a race.
2. **Brand change between `/event/create` mint and `/event/[id]/edit` mount**: the `d_*` draft is now associated with the OLD brand id (stored in `draft.brandId`). The edit route's autosave wrapper uses `incoming.brandId` (from the draft) when calling `createServerDraft`. NOT a race — brand id is captured at mint time.
3. **Concurrent autosave during in-flight migration**: `migratingLegacyIdRef.current === incoming.id` short-circuits. Verified by adversarial test branch-order assertion. NOT a race.
4. **Typing during in-flight migration**: **T-04 / DISC-RACE** — race condition exists. Pre-existing pattern in `useServerDraftEvents.ts:117-141`. Documented above.
5. **Trip route useEffect re-fire**: `tripMigratingIdRef.current === eventId` short-circuits. NOT a race.

**Error paths analysed:**

1. **`isBusinessAuthNotReadyError`**: event side resets ref, returns silently, will retry next dirty save. Trip side has no equivalent discrimination — see T-05.
2. **RLS rejection**: event side fires toast. Trip side silent — T-05.
3. **Network drop**: same as RLS — event side toast, trip silent.
4. **`assertBrandCanAuthorOfferings` rejection**: same — event side toast, trip silent.
5. **Slug collision** (HTTP 23505 from server): the existing `eventDrafts.ts:createServerDraft` doesn't have explicit collision handling; the error propagates through the catch. Event side fires toast. Trip side has `tripsService.ts:444-449` SlugCollisionError specific check that throws — propagates through trip route catch silently per T-05.

**No P0/crash-path errors found.**

---

## §8 — UI/UX coherence audit

Limited scope without live-fire. Source-level observations:

- **Focus management:** the new event/create.tsx renders a placeholder host with `<Spinner>` and a label. On warm session, the useEffect fires synchronously and `router.replace` runs in the same tick — the placeholder is visible for at most 1 frame. **Open question for Seth's smoke:** does the auth-ready warm path produce a perceptible flash, or is it imperceptible? Source suggests imperceptible (1 frame at 60fps = 16ms).
- **Auto-focus on Step 1 Title input:** unchanged from pre-fix (the wizard's own focus behavior). Implementor noted in §11 that auto-focus is NOT recommended (would pop the keyboard unbidden on mobile). Tester agrees.
- **Loader label change:** the new event route shows "Loading…" instead of "Starting a new event…". The shorter label is acceptable for a 1-frame placeholder. The auth-not-ready branch keeps "Finishing sign-in…" which matches `useAuth` semantics.
- **Trip placeholder:** "Setting up your trip…" still appears — but now on the resume route, not the create route. From the user's perspective, the latency moved location but duration is roughly unchanged. Net trip UX is ~equivalent to pre-fix.

---

## §9 — Tests run and results

| Suite | Cases | Result | Notes |
|---|---|---|---|
| `draftDirtyCheck.test.ts` (implementor #1) | 17 | 17/17 PASS | Implementor wrote; tester verified pass + fails-on-revert at `990cab80`. |
| `orch_0893_creator_entry_routes.test.ts` (implementor #2) | 4 | 4/4 PASS | Implementor wrote; tester verified pass + fails-on-revert at `990cab80`. |
| `orch_0893_adversarial_edit_route_wrapper.test.ts` (tester) | 8 | 8/8 PASS | Tester wrote; fails-on-revert verified at `990cab80` by stashing edit routes + util + invariant. |
| `serverDraftLifecycleGuards.test.ts` (existing, 2 cases updated `[TEST-MOD-APPROVED ORCH-0893]`) | 21 | 15/21 PASS | 2 ORCH-0893-updated cases PASS; 6 pre-existing failures unrelated (separate ORCH per implementor §9). |
| CI gate `i-proposed-creator-entry-is-instant.mjs` | 3 files scanned | 0 violations / exit 0 | Tester independently ran; fails-on-revert with 8 violations confirmed by implementor + tester. |
| `tsc --noEmit` | full mingla-business | 0 errors on touched files | 19 pre-existing errors elsewhere unchanged. |

**Total ORCH-0893-specific cases: 29 PASS (17 + 4 + 8) + 2 updated pinning cases PASS.**

---

## §10 — Discoveries for orchestrator

- **DISC-RACE-FOLLOWUP** (P1, pre-existing race condition; ORCH-0893 exposes it more readily): typed input loss during the first-edit migration window. The race exists in BOTH the new event-side `handleAutosaveDraft` wrapper AND the legacy `useServerDraftEvents.ts:117-141` migration loop. Fix shape: re-read live Zustand state at `replaceDraft` time and merge user-meaningful fields into the server payload before writing back. Bounded ~30 lines. Recommended ORCH-0893-A or sibling.
- **DISC-TRIP-ERROR-SURFACE** (P2, T-05 + T-06 combined): trip-side resume-route's d_* migration has no error UX. Silent failure on createTripDraft error; stuck-on-placeholder if brand kind drifts. ~15 lines to fix (mirror event-side toast pattern + add error fallback render). Could be rolled into DISC-0893-TRIP-FIRST-EDIT or shipped as a smaller sibling.
- **DISC-0893-TRIP-FIRST-EDIT** (P2, already registered by implementor §9): full first-edit-triggered behaviour for trip would close the trip-side ghost-draft side effect AND would naturally subsume DISC-TRIP-ERROR-SURFACE if the same wrapper pattern from event side is adapted. Requires modifying 6 wizard-internal autosave hooks per implementor's analysis.
- **DISC-0893-GHOST-DRAFT-CLEANUP** (P3, already registered by implementor §9): historical accumulation in `events` + `ticket_types` + `trip_pricing_tiers`. Operator may authorize a one-time cleanup migration after this close. Probe SQL provided in investigation §2.3.
- **DISC-0893-LEGACY-TEST-FAILURES** (P3, already registered by implementor §9): 6 pre-existing failures in `serverDraftLifecycleGuards.test.ts` unrelated to this ORCH.
- **DISC-0893-PRE-EXISTING-TSC-ERRORS** (P3, already registered by implementor §9): 19 pre-existing tsc errors elsewhere in the repo.
- **DISC-0893-UI-UX-PRO-MAX-DEFERRED** (P3, T-08): designer pre-flight on the new mount transition. Optional.

---

## §11 — Praise (P4 notes)

- **P-01:** the implementor correctly identified the pre-existing client-`d_*`-to-server-id migration infrastructure (`event/[id]/edit.tsx:144-169` + `useServerDraftEvents.ts:86-142` + `serverDraftEventMapper.ts:legacyLocalDraftId`) and re-wired rather than rebuilt. Saved substantial work and reduced regression risk.
- **P-02:** the scope-narrowing decision for the trip side was the right call. Touching 6 wizard-internal autosave hooks in one dispatch would have been high-risk against the active Tr1→Tr5 contract. Documenting the narrowing as DISC-0893-TRIP-FIRST-EDIT (rather than silently shipping incomplete event-style behaviour) is exactly the right discipline.
- **P-03:** the `[TEST-MOD-APPROVED ORCH-0893]` annotation on the 2 modified pinning cases in `serverDraftLifecycleGuards.test.ts` follows the append-only enforcement protocol cleanly. The commit body still needs the token (per implementor §14 draft commit message); CI gate will catch any omission.

---

## §12 — Recommended close path

**Two operator decisions required before CLOSE:**

**Decision A — Live-fire smoke acceptance.** I labeled the runtime layer `probable` per Phase 0.A because sim/emu/web are available but not driven in this dispatch. To upgrade to PASS, Seth runs the smoke per §15 below and confirms:
- (1) `/event/create` opens the wizard within ~200ms (no spinner page);
- (2) Network DevTools shows zero `events` calls on entry stack;
- (3) Cold mount + back-without-typing leaves the drafts list unchanged;
- (4) Typing one character lazy-inserts one row + flips the URL without losing the character;
- (5) `/trip/create` immediately routes to `/trip/d_xxx/edit` and the "Setting up your trip…" placeholder shows for the duration of the 6-await chain.

If smoke confirms, the verdict upgrades to PASS — proceed to CLOSE.
If smoke surfaces a regression, the verdict flips to FAIL — return to implementor.

**Decision B — Accept the P1 race-condition trade-off.** The pre-existing data-loss race (T-04 / DISC-RACE-FOLLOWUP) is exposed more readily by ORCH-0893's "first-edit-triggered" pattern. Options:
- (a) Accept the trade-off (better cold-tap UX, occasional fast-typist character loss for ~1s), queue DISC-RACE-FOLLOWUP as a small sibling ORCH for a clean fix → CLOSE proceeds.
- (b) Pause CLOSE, dispatch the implementor for a ~30-line rework that adds the live-state-merge at replace time → CLOSE proceeds with the race closed.

**Tester recommendation: Option (a).** The race is pre-existing, ORCH-0893's primary user-visible win (instant wizard mount) is large and operator-reported. Queuing the race fix as a small sibling ORCH unblocks the close without leaving the bug unaddressed.

---

## §13 — Append-only commit gate reminder

The closing PR MUST include `[TEST-MOD-APPROVED ORCH-0893]` in the commit body to satisfy `.github/workflows/tests-append-only.yml`. The implementor's draft commit message already includes this token (§14 of implementation report). If the close commit message is regenerated, ensure the token is preserved.

The 3 ORCH-0893-related test files MUST appear in the closing PR's `git diff origin/main...HEAD --name-only` per the Step-0.5 gate:
- `mingla-business/src/utils/__tests__/draftDirtyCheck.test.ts` (NEW)
- `mingla-business/src/utils/__tests__/orch_0893_creator_entry_routes.test.ts` (NEW)
- `mingla-business/src/utils/__tests__/orch_0893_adversarial_edit_route_wrapper.test.ts` (NEW — tester adversarial)

Tester confirms all three are present in the working tree at commit `990cab80`.

---

## §14 — Files touched by this QA pass

| File | Why |
|---|---|
| `mingla-business/src/utils/__tests__/orch_0893_adversarial_edit_route_wrapper.test.ts` (NEW) | Tester adversarial regression test, Step-0.5 gate. 8 cases, fails-on-revert verified. |
| `Mingla_Artifacts/reports/QA_ORCH-0893_CLIENT_ID_PLUS_LAZY_AUTOSAVE_FOR_CREATOR_ENTRIES_REPORT.md` (THIS FILE) | Verdict + findings. |

No product code touched by the tester. No migrations applied. No edge functions touched.

---

## §15 — Smoke-test steps for Seth (Case-B unblock for Phase 0.A `probable` → PASS)

Run these from the project root after this QA report lands:

1. **Open the running web preview** at `http://localhost:8084` in Chrome. Sign in as the brand operator (or refresh if a session exists).
2. From the home tab, tap "Build a new event." **Expected:** the wizard's Step 1 (Title input) appears within ~200ms. NO placeholder "Starting a new event…" spinner page.
3. Open Chrome DevTools → Network tab → filter for `gqnoajqerqhnvulmnyvv.supabase.co`. **Expected:** ZERO `events` insert requests in the entry stack from step 2.
4. Tap the chrome X close button WITHOUT typing anything. Confirm `/(tabs)/hub/events` shows no new draft row (refresh the list to confirm).
5. Repeat step 2, type one character into the Title input, wait ~1 second. **Expected:** Network shows exactly ONE `POST events` insert; URL flips from `/event/d_xxx/edit` to `/event/{server-uuid}/edit?step=0`; the typed character is preserved and focus stays on the input.
6. Type a second character. **Expected:** Network shows ONE `PATCH events` update (autosave UPDATE path); no second INSERT.
7. **Trip smoke:** switch to a trip-planner brand. From home, tap "Create trip." **Expected:** URL immediately changes to `/trip/d_xxx/edit`; "Setting up your trip…" placeholder appears for ~600ms-1.5s while createTripDraft runs in the background; then URL flips to `/trip/{server-uuid}/edit` and the trip wizard mounts.
8. **iOS sim smoke (optional):** open Mingla Business on the booted iPhone 17 Pro simulator. If Metro is connected, the JS bundle hot-reloads with ORCH-0893 changes — repeat steps 2-7 on the sim. **Expected:** native push animation completes onto an interactive wizard (no spinner page).
9. **Strict-grep gate:** run `node .github/scripts/strict-grep/i-proposed-creator-entry-is-instant.mjs` and confirm `OK — scanned 3 create.tsx files; 0 violations.`

If all steps confirm, the runtime layer upgrades from `probable` to `proven` and the verdict becomes PASS. Hand off to orchestrator for CLOSE.

---

**End QA report.**
