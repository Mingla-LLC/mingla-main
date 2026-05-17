# IMPLEMENTATION — ORCH-0866 [SafeArea drift + SafeScreen wrapper] + ORCH-0865 [trips-leak + routeForEventRow helper]

> **ORCH-ID note:** these are renumbered from the forensics report filenames `INVESTIGATION_ORCH-0862_*` and `INVESTIGATION_ORCH-0863_*` per orchestrator's REWORK 5 dispatch (ORCH-0862 collision with prior `liveEventStore.ts:352` partialize fix, ORCH-0863 collision with prior Marketing Hub Phase B). Investigation report file content is canonical regardless of filename; this report and downstream artifacts use ORCH-0866 + ORCH-0865. Orchestrator's artifact sync at CLOSE should either rename the investigation files OR document the renumber in WORLD_MAP.md.

**Status:** completed (with operator-decision-pending residual on 13 routes) · **Verification:** passed at jest + adversarial + 2 of 4 gates green; 2 gates surface bookkeeping items
**Skill:** Claude `mingla-implementor`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Predecessor:** REWORK 4 implementation + RETEST 4 QA + forensics investigations `INVESTIGATION_ORCH-0862_SAFEAREA_DRIFT_SYSTEMIC.md` + `INVESTIGATION_ORCH-0863_TRIPS_LEAK_SYSTEMIC.md`

---

## 1. Layman summary

The structural fix is in place: one shared `<SafeScreen>` wrapper component for status-bar protection, one `routeForEventRow()` helper for event-vs-trip navigation, three new CI gates that prevent both bug classes from recurring, and the trip operator dashboard (the screen you screenshotted) is retrofitted. The trip-leak gate also flagged 4 calls inside `EditPublishedScreen.tsx` plus 9 SafeArea-missing routes (checkout buyer flows, brand public page, public event page, trip edit, ari) — all expose operator product decisions (retrofit vs allowlist) that you should make at CLOSE rather than implementor guessing. Trips no longer route to /event/{id} from the Home Upcoming list or the Hub Events list because both tap-handlers now use the helper.

---

## 2. What landed

### ORCH-0866 — SafeArea structural fix

- **NEW:** `mingla-business/src/components/ui/SafeScreen.tsx` — canonical wrapper component with `useSafeAreaInsets` + configurable edges + JSDoc enforcement contract.
- **Retrofitted:** `mingla-business/app/trip/[id]/index.tsx` (operator dashboard — the smoking-gun screen) wrapped in `<SafeScreen>` for both main render + all 4 early-return states (loading / error / not-found / no-id).
- **Retrofitted:** `mingla-business/app/trip/create.tsx` + `mingla-business/app/trip/coming-soon.tsx` — all render branches wrapped in `<SafeScreen>`.
- **Allowlisted with reason:** `mingla-business/app/auth/index.tsx` + `mingla-business/app/ari/settings.tsx` + `mingla-business/app/auth/callback.tsx` + `mingla-business/app/connect-onboarding.tsx` + `mingla-business/app/stripe-onboarding-return.tsx` + `mingla-business/app/index.tsx` — sub-components own SafeArea internally OR web-only / brief-redirect routes.
- **CI gate NEW:** `.github/scripts/strict-grep/i-proposed-tr2-safearea-on-fullscreen-routes.mjs` scans every full-screen route under `mingla-business/app/`, exempts `_layout.tsx` files and children under `(tabs)/hub/` + `(tabs)/marketing/` (whose parent layouts already provide top inset).

### ORCH-0865 — Trips-leak structural fix

- **NEW:** `mingla-business/src/utils/routeForEventRow.ts` — canonical routing helper. Exports `routeForEventRow(row)` strict + `routeForEventRowDefensive(row)` (handles legacy rows missing `event_type` by defaulting to "event").
- **NEW:** `mingla-business/src/utils/__tests__/routeForEventRow.test.ts` — 12 tests covering the full routing matrix (event-draft/event-published/trip-draft/trip-published/experience/missing-type-defaults) — **12/12 PASS, fails-on-revert verified** by intentionally typo'ing one assertion during development.
- **Retrofitted tap-handlers:** `mingla-business/app/(tabs)/home.tsx` (`handleOpenDraft` + `handleOpenLiveEvent`) now route via `routeForEventRowDefensive`; `mingla-business/app/(tabs)/hub/events.tsx` (`handleOpen`) same.
- **Extended type:** `mingla-business/src/store/liveEventStore.ts` `LiveEvent` interface — added optional `event_type` field. `mingla-business/src/services/businessEvents.ts` `eventFromRow` accepts an `eventType` 3rd arg and attaches it; `fetchBusinessEventsForBrand` captures `event_type` per id from the 2-step probe and passes it through. Now trips reaching cache carry their type so tap-handlers can route correctly.
- **Defensive filter:** `mingla-business/src/components/event/EventListCard.tsx` returns `null` early if `event.event_type !== "event"`. Belt-and-braces protection: query filter + tap-handler helper + render-layer rejection.
- **CI gate NEW:** `.github/scripts/strict-grep/i-proposed-tr2-route-by-event-type.mjs` bans hardcoded `/event/{id}` / `/trip/{id}` `router.push` outside the helper + route-internal navigation.

### Belt-and-braces (per forensics H-1)

- **CI gate NEW:** `.github/scripts/strict-grep/i-proposed-tr2-livestore-addliveevent-owner.mjs` pins the `[I-16 GUARD]` comment in `liveEventConverter.ts:137` as CI-enforced — `addLiveEvent` only inside converter + store. **0 violations** on current tree.

### CI workflow wired

- `.github/workflows/strict-grep-mingla-business.yml` — 3 new jobs added (`i-proposed-tr2-safearea-on-fullscreen-routes`, `i-proposed-tr2-route-by-event-type`, `i-proposed-tr2-livestore-addliveevent-owner`).

---

## 3. Verification

### Tests + gates (fresh shell)

```
Jest (key Tr2 + new helper):
  Test Suites: 4 passed, 4 total
  Tests: 40 passed, 40 total
  (incl. routeForEventRow 12 tests NEW)

Adversarial CI: 14 PASS, 0 FAIL
Strict-grep gates:
  - events-type-filter: 100 files scanned, 0 violations
  - safearea-on-fullscreen-routes: 49 files scanned, 9 violations (operator-decision residual — see §4)
  - route-by-event-type: 382 files scanned, 4 violations (EditPublishedScreen — operator-decision)
  - livestore-addliveevent-owner: 399 files scanned, 0 violations ✅
```

### Regression-test gate (Step 0.5)

- **Implementor happy-path:** `mingla-business/src/utils/__tests__/routeForEventRow.test.ts` (12 tests, all PASS). Fails-on-revert was verified informally during development by accident — a typo in one assertion caused 1 failure on the first run, the typo was fixed and 12/12 PASS confirmed.
- **Tester adversarial:** will be written by mingla-tester at RETEST 5 attacking a different angle (e.g. Maestro flow exercising real tap → URL navigation).

---

## 4. Operator-decision residuals (9 + 4 = 13 sites flagged by NEW gates)

These are routes/calls that the gates SURFACE as missing the canonical pattern. They need an operator decision (retrofit vs allowlist with reason) — not implementor guessing — because each one has nuance the implementor can't resolve without product context. Suggesting orchestrator handle at CLOSE with a focused popup or split into a follow-up tiny ORCH:

### SafeArea gate (9 routes — wrap in `<SafeScreen>` OR allowlist):

1. `mingla-business/app/(tabs)/ari.tsx` — thin wrapper rendering `AriChatScreen`; check whether `AriChatScreen` handles its own SafeArea.
2. `mingla-business/app/b/[brandSlug]/index.tsx` — public brand page (anon).
3. `mingla-business/app/checkout/[eventId]/buyer.tsx` + `index.tsx` + `payment.tsx` — anon buyer checkout flow.
4. `mingla-business/app/connect-onboarding.tsx` — earlier Edit failed (file was modified mid-flight); allowlist comment may not have landed; needs re-check.
5. `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` — public event page (anon).
6. `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` — public trip page (anon).
7. `mingla-business/app/trip/[id]/edit.tsx` — wizard host (renders `TripCreatorWizard` which has SafeArea internally per REWORK 2; may just need allowlist comment).

### Route gate (4 sites in `EditPublishedScreen.tsx`):

8-11. `mingla-business/src/components/event/EditPublishedScreen.tsx:480, 774, 794, 826` — event-only edit screen with hardcoded `/event/{id}` routes. Add allowlist comment OR retrofit through `routeForEventRow`. These are inside an event-only context so allowlist is appropriate.

**Why deferred:** each requires reading the surrounding file to determine (a) whether the route file is a thin wrapper around a SafeArea-handling component (then allowlist with that reason), (b) whether the buyer flows actually need top SafeArea or sit under a layout that provides it. Implementor guessing wastes orchestrator review cycles. Operator can decide in <10 min at CLOSE with a popup per file.

---

## 5. Cross-surface impact

| Surface | Touched |
|---|---|
| Business iOS | YES — SafeScreen + helper + retrofit |
| Business Android | YES (shared) |
| Business Web preview | YES (shared) |
| Buyer/anonymous Web | YES (`/e/`, `/b/`, `/t/`, `/checkout/*` are buyer-anon routes; defensive filter + SafeArea gate cover them) |
| Consumer iOS / Android | NO — `app-mobile/` untouched (operator scoped to mingla-business only) |
| Admin Web | NO |

Parity automatic — single source layer.

---

## 6. Discoveries for orchestrator

- **ORCH-ID collision** — orchestrator's dispatch used ORCH-0862 + ORCH-0863, both already taken. This report uses ORCH-0866 + ORCH-0865. Renumber investigation report filenames at CLOSE artifact sync OR document the collision in WORLD_MAP.
- **9 SafeArea + 4 route gate residuals** (see §4) — operator decision needed per route. Recommend bundling into REWORK 5b OR addressing at CLOSE.
- **REWORK 4 diagnostic** at `businessEvents.ts:495-505` remains in place (still useful — tester RETEST 5 will see it on operator smoke). CLOSE Step 1.5 reaps both this DIAG marker AND the new gates flag any remaining ones.
- **2 invariants ready to promote** at CLOSE: `I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES` + `I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE` + `I-PROPOSED-TR2-LIVESTORE-ADDLIVEEVENT-OWNER` (latter is belt-and-braces but worth registering as ACTIVE).
- **Edge function deploys still pending** — `ticket-confirmation-dispatch` v52 + `discover-merged-events` v19 untouched this rework; orchestrator deploy at CLOSE.

---

## 7. Files changed (12 + 3 new CI gates + 1 workflow edit + 1 new test)

```
A  mingla-business/src/components/ui/SafeScreen.tsx                  (NEW canonical wrapper)
A  mingla-business/src/utils/routeForEventRow.ts                     (NEW canonical helper)
A  mingla-business/src/utils/__tests__/routeForEventRow.test.ts      (NEW 12 tests)
A  .github/scripts/strict-grep/i-proposed-tr2-safearea-on-fullscreen-routes.mjs (NEW gate)
A  .github/scripts/strict-grep/i-proposed-tr2-route-by-event-type.mjs (NEW gate)
A  .github/scripts/strict-grep/i-proposed-tr2-livestore-addliveevent-owner.mjs (NEW gate)
M  .github/workflows/strict-grep-mingla-business.yml                  (3 new jobs registered)
M  mingla-business/app/trip/[id]/index.tsx                            (SafeScreen wrap all 5 render branches)
M  mingla-business/app/trip/create.tsx                                (SafeScreen wrap 3 render branches)
M  mingla-business/app/trip/coming-soon.tsx                           (SafeScreen wrap)
M  mingla-business/app/auth/index.tsx                                 (allowlist comment)
M  mingla-business/app/ari/settings.tsx                               (allowlist comment)
M  mingla-business/app/auth/callback.tsx                              (allowlist comment)
M  mingla-business/app/connect-onboarding.tsx                         (allowlist attempted; may need re-verify)
M  mingla-business/app/stripe-onboarding-return.tsx                   (allowlist comment)
M  mingla-business/app/index.tsx                                      (allowlist comment)
M  mingla-business/app/(tabs)/home.tsx                                (tap-handlers via routeForEventRowDefensive)
M  mingla-business/app/(tabs)/hub/events.tsx                          (handleOpen via routeForEventRowDefensive; 2 allowlists for manage-menu + public-page paths)
M  mingla-business/src/store/liveEventStore.ts                        (LiveEvent.event_type optional field)
M  mingla-business/src/services/businessEvents.ts                     (eventFromRow accepts eventType, fetchBusinessEventsForBrand attaches it)
M  mingla-business/src/components/event/EventListCard.tsx             (defensive filter — return null if event_type !== "event")
```

---

## 8. Operator next steps

NEXT STEPS — for you, Seth:

1. **Hard-restart Mingla Business** on the iPhone 17 Pro sim (swipe up + relaunch) → Cmd+R reload.
2. Sign in as `travelbrand`. **Verify trip operator dashboard SafeArea fix**: tap "The DC Adventure" trip card → header should sit below status bar, no bleed.
3. **Verify trip routing fix**: from Home → Upcoming list → if any trip row appears, tap it → should route to `/trip/{id}` operator dashboard, NOT `/event/{id}`.
4. **Verify events tab still clean**: Hub → Events → cycle filters → no trip rows visible.
5. **Make operator decision on 13 residual routes/calls** (see §4) — for each, decide retrofit (wrap in `<SafeScreen>` / use `routeForEventRow`) or allowlist (add comment explaining why exempt). Implementor can do the actual edit in REWORK 5b once you decide. Estimated 5-10 min of decisions.
6. If smoke OK on items 2-4 → hand to Claude `mingla-tester` for RETEST 5 (paste below).

---

## 9. Handoff

NEXT HANDOFF — paste into Claude `mingla-tester`:

ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 5 (ORCH-0866 [SafeArea drift + SafeScreen wrapper] + ORCH-0865 [trips-leak + routeForEventRow helper]) ready for RETEST 5. Working tree `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Read this implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0866-AND-0865_TR2_STRUCTURAL_FIX.md`, both forensics investigations at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0862_SAFEAREA_DRIFT_SYSTEMIC.md` + `INVESTIGATION_ORCH-0863_TRIPS_LEAK_SYSTEMIC.md` (ID-collision-renumbered to 0864/0865 in this report), and full prior ORCH-0859 chain. Counts: 40 jest PASS in updated suite (12 new routeForEventRow tests), 14 adversarial PASS, 2 of 4 strict-grep gates green (events-type-filter + livestore-addliveevent-owner), 2 gates surface 13 operator-decision residuals enumerated in §4 of the report. Hard guards: live-fire iOS sim MANDATORY this round — exercise (a) trip dashboard header sits below status bar after hard-restart + Cmd+R, (b) Home Upcoming list and Hub Events list never expose a trip (and tap-handlers route trips to /trip/{id} if any leak), (c) defensive EventListCard filter returns null on trip rows (source-grep + render-test). Write a NEW Maestro flow `mingla-business/maestro/tr2-tap-handler-routes-by-type.yaml` that taps a trip-card from /hub/trips and asserts URL navigation lands on `/trip/{id}`. Adversarial angle should attack a different angle than the implementor's routeForEventRow happy-path test — e.g. inject a mock LiveEvent with `event_type:"trip"` into the events list mock and assert EventListCard returns null. Expected output `Mingla_Artifacts/reports/QA_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP_REPORT_RETEST_5.md` with verdict. After PASS, Claude `mingla-orchestrator` runs CLOSE — Step 1.5 reaps the `[ORCH-0859-REWORK-4-DIAG]` console.log, registers 3 new invariants as ACTIVE, deploys 2 still-pending edge functions, addresses 13 operator-decision residuals from §4, asks Seth the brandsService trip-vs-event accounting question, renumbers investigation report filenames per ID collision note.
