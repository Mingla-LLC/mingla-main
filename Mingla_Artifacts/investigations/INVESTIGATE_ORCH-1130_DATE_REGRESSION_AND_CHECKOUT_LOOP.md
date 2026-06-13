# INVESTIGATE — ORCH-1130 device regressions: public-trip DATE regression + checkout infinite render loop

- **ORCH:** ORCH-1130 [trip-pay-structure]
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1130-[trip-pay-structure]/` on branch `ORCH-1130-trip-pay-structure` (commit `717d105c6`)
- **Combined failing build reference:** `/tmp/orch-1130/ota` on branch `orch-1130-1133-verify` (origin/main + ORCH-1130 + ORCH-1133, merge `c2431e121`)
- **Mode:** INVESTIGATE (read-only; proposes NOTHING beyond a minimal fix sketch the SPEC will own)
- **Comms ledger:** read on entry. No BLOCK open for forensics/ORCH-1130. COMMS-0029 + COMMS-0030 (WARN→ALL) factored in: ORCH-1119 trip-day-media + ORCH-1120 refund-deadline both re-emit `biz_update_live_trip`; this directly informs Issue #1's ownership.

---

## ISSUE #1 — Public trip page shows "Dates to be set" for a trip that HAS dates

### Symptom
On the public trip page (`/t/{brandSlug}/{tripSlug}`), the date pill renders the fallback **"Dates to be set"** even though the trip has real dates configured.

### Q-scorecard
- **Q1.** What field does the public page render for dates, and why is it falsy? → `trip.businessTrip.startAt` / `endAt`, sourced from `event.theme.business_trip.startAt|endAt`, which is **NULL** on prod live trips. **Verdict: proven.**
- **Q2.** Where do the dates actually live? → In `event_dates` (master row `is_master=true`), NOT in `theme.business_trip`. **Verdict: proven (prod data).**
- **Q3.** Ownership — ORCH-1130, origin/main, or merge? → **origin/main (pre-existing latent divergence; NOT ORCH-1130).** **Verdict: proven.**

### Root cause (file:line)
- **READ path (the falsy field):**
  - `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` renders `<TripPreview>`, which calls `formatTripDateRange(trip.businessTrip.startAt, trip.businessTrip.endAt)` at `mingla-business/src/components/trip/TripPreview.tsx:137-140`.
  - `packages/event-rendering/formatTripDateRange.ts:27` — `if (startAt === null || endAt === null) return fallback;` where `DEFAULT_FALLBACK = "Dates to be set"` (line 15).
  - The slug data hook `usePublicTripBySlug` maps the date field at `mingla-business/src/hooks/usePublicTripBySlug.ts:152,168` — `const bt = event.theme?.business_trip ...; startAt: typeof bt.startAt === "string" ? bt.startAt : null`.
  - The id-based getter is identical: `mingla-business/src/services/publicEventsService.ts:1317-1335` — `const bt = event.theme?.business_trip ...; businessTrip: { startAt: typeof bt.startAt === "string" ? bt.startAt : null, endAt: ... }`. **Neither trip getter reads `event_dates`.**
- **WRITE path (why the field is null) — the canonical store moved, the mirror was stripped:**
  - Live prod `biz_update_live_trip(uuid,jsonb,text)` §4b (verified via `pg_get_functiondef`, carries ORCH-1119 + ORCH-1120 markers): on any date-bearing edit it `UPDATE public.event_dates SET start_at=…, end_at=… WHERE is_master=true`, then **strips the dates from the theme patch**: `p_patch := p_patch #- '{theme,business_trip,startAt}'` and `… #- '{theme,business_trip,endAt}'`. So after a publish/live-edit, `theme.business_trip.startAt|endAt` are gone; the truth lives only in `event_dates`.
  - This event_dates-canonical + theme-strip behavior entered at **ORCH-0950** (`supabase/migrations/20260725000002_orch_0950_expanded_scope_dashboard_coherence.sql`) and persists through ORCH-1075/1119/1120 — all **long before ORCH-1130**.
  - The draft write path still mirrors dates into `theme.business_trip` (`mingla-business/src/services/tripsService.ts:922`), and `updateTripBasics` even THROWS if you try to write start/end on a non-draft trip (`tripsService.ts:901-906` — "trip start/end must route through updateLiveTripFields (writes event_dates)"). So the system already treats `event_dates` as canonical for non-draft trips; only the public READ path was never migrated.

### Evidence (prod, read-only)
All 3 live/scheduled trips on prod (project `gqnoajqerqhnvulmnyvv`) have NULL theme dates but populated `event_dates`:

| title | theme_start | theme_end | event_dates_start | event_dates_end |
|---|---|---|---|---|
| The DC Adventure | NULL | NULL | 2026-08-17 | 2026-08-22 |
| Untitled trip | NULL | NULL | 2026-05-19 | 2026-05-22 |
| The Sone | NULL | NULL | 2026-09-19 | 2026-09-22 |

Query: `select (theme->'business_trip'->>'startAt'), ed.start_at from events e left join event_dates ed on ed.event_id=e.id and ed.is_master=true where event_type='trip' and status in ('scheduled','live')`.

### Five-truth-layer reconciliation (contradiction)
- **Schema/Data:** canonical dates = `event_dates` master row (populated). `theme.business_trip.startAt` = NULL on all live trips.
- **Code (read):** public trip getters read ONLY `theme.business_trip.startAt`.
- **Contradiction:** READ layer reads the deprecated mirror; DATA layer holds truth in `event_dates`. The gap IS the bug. The event public page already reconciles this (`publicEventsService.ts:710-738` sources dates from `event_dates` via `master_start_at` view columns) — the trip public page was left behind.

### Ownership verdict
**origin/main — pre-existing latent divergence (ORCH-0950 era), NOT ORCH-1130 and NOT the merge.** `git diff origin/main...HEAD` for `mingla-business/app/t/`, `mingla-business/src/components/trip/TripPreview.tsx`, `packages/event-rendering/formatTripDateRange.ts`, and `publicEventsService.ts` is **EMPTY** — ORCH-1130 touched none of the date path. `git blame` dates the `bt.startAt` read to ORCH-0876 (`3189a6b10`, 2026-05-19). It surfaced now because the test trips were edited/published (moving dates fully to `event_dates`). The DC-test build merely made it visible. (COMMS-0029/0030: ORCH-1119/1120's `biz_update_live_trip` re-emissions preserve §4b's theme-strip, so they neither caused nor fixed this.)

### Proposed minimal fix (SPEC owns — DO NOT implement)
Make the trip public READ path source dates from `event_dates` (the canonical store) instead of (or with fallback after) `theme.business_trip`, mirroring the event page. Two precise options:
- **(Preferred)** In `getPublicTripById` (`publicEventsService.ts:~1244`) and `usePublicTripBySlug` (`usePublicTripBySlug.ts:~152`), read the master `event_dates` row (`start_at`/`end_at` where `is_master=true`) for `businessTrip.startAt|endAt`, falling back to `bt.startAt|endAt` only when no master date row exists. Both getters already fetch the event; add the master-date join/select.
- **(Alternative, smaller blast radius)** Have `biz_update_live_trip` §4b ALSO write the dates back into `theme.business_trip` (drop the two `#- '{theme,business_trip,startAt|endAt}'` strips and keep them in the deep-merge) so the mirror stays in sync — plus a one-time backfill of the 3 live trips' theme dates from `event_dates`. (Riskier: re-introduces dual-write divergence the strip was meant to kill.)

The READ-path fix is preferred (single source of truth = `event_dates`, matches the event page). A backfill is NOT required if the read path moves to `event_dates`.

---

## ISSUE #2 — Infinite render loop in trip checkout ("Maximum update depth exceeded")

### Symptom
Deterministic (per Seth): tap **Reserve my spot** → land in `/checkout-trip/{id}` → navigate BACK to the public page → tap Reserve AGAIN → crash. Stack: `NativeStackNavigator → CartProvider → CheckoutTripLayout → Route`; JS: `forceStoreRerender → commitHookEffectListMount → commitLayoutEffectOnFiber` (a screen-mount effect repeatedly firing a navigation-store update).

### Q-scorecard
- **Q4.** Is the CartContext `value`/snapshot unstable each render? → **No.** `value` is `useMemo`'d on `[state, …stable useCallback setters]` (`CartContext.tsx:353-374`); `state` only changes on dispatch. Ruled out as the driver. **Verdict: proven (RULED OUT).**
- **Q5.** Is there a single-component setState-in-effect self-loop? → **No** single-component loop; the loop is **cross-screen navigation** between `index` and `buyer`. **Verdict: probable.**
- **Q6.** What closes the cycle? → ORCH-1130's NEW single-tier **auto-skip effect** in `index.tsx` ⇄ the pre-existing empty-cart **guard effect** in `buyer.tsx`, when the cart reads empty on `/buyer`. **Verdict: probable.**
- **Q7.** Ownership? → **ORCH-1130** (the auto-skip effect is brand-new and is the half that closes a previously-open path). **Verdict: proven (the looping construct is new in ORCH-1130).**

### Root cause (file:line) — the closed cycle
1. `mingla-business/app/checkout-trip/[tripEventId]/index.tsx:205-227` — **NEW in ORCH-1130** single-tier auto-skip `useEffect` (deps `[tripEventId, trip, lines, router]`): when the trip has exactly one bookable tier and `lines` does not yet contain it, it calls `setLineQuantity({…, quantity:1})` (dispatch on the parent CartProvider) **and then** `router.replace('/checkout-trip/{id}/buyer')` — both synchronously in the same effect body.
2. `mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx:309-314` — **pre-existing (ORCH-0876, unchanged)** guard `useEffect` (deps `[hasNoLines, tripEventId, router]`): `if (hasNoLines && tripEventId !== null) router.replace('/checkout-trip/{id}')` — i.e. if `lines.length === 0` on `/buyer`, it bounces straight back to `index`.

**The cycle:** index auto-skip → `setLineQuantity` (state update scheduled on CartProvider, a separate fiber) + `router.replace('/buyer')` (navigation-store update, applied effectively synchronously by expo-router). If `/buyer` mounts and reads `lines` from the CartProvider **before** the `SET_LINE_QUANTITY` reducer update commits, `hasNoLines` is true → buyer's guard `router.replace('index')` → index remounts, `lines` still empty (the dispatch was abandoned with the unmounted index, or re-evaluated empty on the fresh mount) → auto-skip fires again → … Each `router.replace` is a `forceStoreRerender` on expo-router's `useSyncExternalStore` navigation store, fired from a screen-mount effect (`commitHookEffectListMount` inside `commitLayoutEffectOnFiber`) — exactly the reported stack → "Maximum update depth exceeded."

**Why the SECOND attempt and not the first:** on first entry the trip query is cold, so `index` renders its loading gate (`index.tsx:230` `isLoading || isFetching`) first; `trip` becomes non-null only after the fetch settles, by which time the dispatch/navigation ordering lands the line before `/buyer` reads it (first navigation is a clean `push`). On the second entry the React Query cache is warm (`usePublicTripById` `staleTime` 60s, `usePublicTripById.ts:25,46`), so `trip` is returned **synchronously on the first commit** and the auto-skip effect fires in the tightest possible window, racing the dispatch against the navigation-store mount of `/buyer` → the guard wins → ping-pong. The back-then-re-Reserve is what produces a warm-cache mount of a fresh CartProvider (`CheckoutTripLayout` remounts via `_layout.tsx`), which is the precise precondition.

### Evidence
- `index.tsx:217-225` (`setLineQuantity`) immediately followed by `index.tsx:225` (`router.replace('/buyer')`) inside one effect; guard `index.tsx:216` `if (lines.some(l => l.ticketTypeId === sole.id)) return;` only short-circuits AFTER the line is committed — it cannot prevent the race on the first post-mount commit.
- `buyer.tsx:309-314` empty-cart bounce to `index`.
- `git diff origin/main...HEAD -- .../index.tsx`: the entire `useEffect(… auto-skip …)` block is `+` (new). `git diff … -- .../buyer.tsx`: 0 matches for `hasNoLines`/`router.replace` (guard unchanged, pre-dates 1130 — blame `3189a6b10` ORCH-0876).
- `CartContext.tsx` diff is purely additive (new `SET_PAYMENT_PLAN_CHOICE` action + `paymentPlanChoice` field + setter); `value` memo deps unchanged → not the driver.
- The MERGED failing file (`/tmp/orch-1130/ota`) additionally adds `onAspectRatio={setCoverAspect}` (ORCH-1132) on `EventCoverMedia`, but that render branch is only reached AFTER the auto-skip guard for a single-tier trip, so it is NOT the deterministic single-tier loop driver (it is a separate potential setState-on-layout risk for multi-tier trips only; `onAspectRatio` does not even exist on the worktree's `EventCoverMedia` — merge-only).

### Repro status / confidence
- **Confidence: probable (NOT proven).** The closed cycle is fully traced in source and the looping construct is confirmed new-in-ORCH-1130. The exact first-vs-second timing is a commit-ordering race between a CartProvider reducer update and an expo-router navigation-store update — a runtime property I did not live-fire.
- **Named blocker (caps at probable):** confirming the race requires a full mingla-business iOS dev build (runbook is ~15-20 min + native embed/codesign) **plus operator sign-in plus a live single-tier paid trip** — the business app is not installed on the booted sim (`iPhone 17 Pro 17091E60`) and the dev build needs Seth's account. Source-only reasoning on a reproducer-bound bug is capped at probable per Prime Directive 7.
- **Top-2 candidate ranking** (if the race theory is not the exact trigger): (1) the index↔buyer `router.replace` ping-pong above (primary, ~90%); (2) the auto-skip effect re-running because `trip` and/or `router` is a fresh reference each render on the warm-cache mount while the `lines.some(...)` guard hasn't yet seen the committed line — same two files, same `router.replace` pair, slightly different trigger edge.

### Ownership verdict
**ORCH-1130.** The looping half (`index.tsx:205-227` auto-skip `useEffect`) is brand-new in ORCH-1130 (`git diff origin/main...HEAD`). It closed a cycle against the pre-existing (origin/main, ORCH-0876) buyer empty-cart guard. Before ORCH-1130 there was no effect on `index` that auto-navigated to `/buyer`, so the cycle could not form. The merge resolution (cover-aspect state) did not introduce it.

### Proposed minimal fix (SPEC owns — DO NOT implement)
Break the race so `/buyer` never sees an empty cart from a just-replaced `index`. Precise options:
- **(Preferred)** In `index.tsx:205-227`, make the auto-skip a one-shot that does NOT depend on `lines` for re-entry and does NOT race the dispatch: gate the navigation behind the line actually being present — e.g. dispatch `setLineQuantity` in the effect, and perform `router.replace('/buyer')` only once `lines.some(l => l.ticketTypeId === sole.id)` is true (a second effect keyed on `lines`), guarded by a `useRef` "already auto-skipped this mount" latch so it fires exactly once. This removes the empty-cart window on `/buyer`.
- **(Alternative)** Add the same one-shot `useRef` latch to the index auto-skip AND make `buyer.tsx:309-314` tolerate a one-frame empty cart (e.g. only bounce after `restoreChecked`-style settle or after a microtask), so a transient empty read does not ping back. The index-side latch is the smaller, more robust change.

Either way the fix is confined to ORCH-1130's own new auto-skip effect; the pre-existing buyer guard should not be widened.

---

## Discoveries for Orchestrator
- **D-1 (Issue #1 blast radius):** the trip public READ-vs-canonical-date divergence affects EVERY consumer of `usePublicTripBySlug` / `getPublicTripById` date fields — public trip page date pill AND the checkout-trip mini-card date line (`checkout-trip/[tripEventId]/index.tsx:353` `formatTripDateLine(trip.businessTrip.startAt, …)`) AND the consumer-app trip card/detail (shared `@mingla/event-rendering` `formatTripDateRange`). All show "Dates to be set"/blank for edited trips. Single root-cause fix in the trip getters covers all.
- **D-2:** the event public page already does the correct thing (sources dates from `event_dates` via `master_start_at`), so the trip getters are the only laggard — a parity gap, not a new design question.
- **D-3 (merge-only latent risk, out of scope for these two issues):** the combined build's `onAspectRatio={setCoverAspect}` on `EventCoverMedia` in `/tmp/orch-1130/ota` checkout index is a potential layout-effect setState path for MULTI-tier trips; harmless for the prod-universal single-tier case but worth a glance when ORCH-1132 closes.

## Confidence summary
- **Issue #1: proven** (prod data + empty diff + blame). Ownership: origin/main (pre-existing). 
- **Issue #2: probable** (cycle traced in source, construct confirmed new-in-1130; exact commit-ordering race not live-fired — named blocker: full dev build + operator sign-in). Ownership: ORCH-1130.

## Recommended next phase
SPEC both fixes (scope: Issue #1 = trip public-read date source → `event_dates`; Issue #2 = index auto-skip one-shot latch). Issue #2 SPEC should require the implementor/tester to live-fire the deterministic back-then-re-Reserve repro on a device build as the PASS gate.
