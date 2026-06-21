# IMPLEMENTATION — ORCH-1192 [app analytics instrumentation gaps]

Follow-on to META-ORCH-1187 [Growth Analytics Hub] Phase 1. Adds TWO PostHog
events to BOTH native apps (consumer `app-mobile` + business `mingla-business`),
mirroring the EXISTING Phase-1 PostHog patterns via the same
`postHogService.capture(...)` facade (same masking / opt-out / consent posture,
no new analytics infra). NATIVE-ONLY — zero web-analytics changes.

Status: **implemented and verified** (typecheck + gates + happy-path regression
with fails-on-revert green; on-device smoke is PENDING the queued business +
consumer native builds — see COMMS-0052 / COMMS-0051 / COMMS-0047).

Working tree: `~/Desktop/mingla-orchs/ORCH-1192-[app-instrumentation-gaps]/`
on branch `ORCH-1192-app-instrumentation-gaps`. Rebased onto current
`origin/main` (`bce57a1a0`) before committing.

---

## 1. Summary (plain English)

The growth dashboards could not cleanly count daily/weekly/monthly active users
or measure checkout drop-off on the apps. Two events fix that:

- **`app_opened`** — fires every time someone opens or foregrounds either app
  (cold start + return-from-background). Today the dashboards proxy "active
  user" with `card_viewed`, which misses business-app users who never swipe a
  deck. Now both apps emit a real session event.
- **`checkout_started`** — fires the moment a buyer begins paying, BEFORE the
  existing `purchase_completed` success event. This is the native mirror of the
  web `web_checkout_started`, so checkout-start → purchase conversion can be
  measured on the apps too.

Nothing was removed; both events are added alongside the existing Phase-1
captures. The facade already honors the in-app analytics opt-out and no-ops when
the PostHog key is absent, so a opted-out or key-less build emits nothing and
never crashes.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Satisfied at (branch commit) |
|----|-----------|--------|------------------------------|
| SC-1 | `app_opened` fires on COLD start in consumer app, once after init | ✓ | `app-mobile/app/index.tsx:319` |
| SC-2 | `app_opened` fires on FOREGROUND (bg→active) in consumer app, no double-fire on first active | ✓ | `app-mobile/src/hooks/useForegroundRefresh.ts:140` |
| SC-3 | `app_opened` fires on COLD start in business app, once after init | ✓ | `mingla-business/app/_layout.tsx:484` |
| SC-4 | `app_opened` fires on FOREGROUND (bg→active) in business app, no double-fire on first active | ✓ | `mingla-business/app/_layout.tsx:596` (new `prevAppStateRef` guard) |
| SC-5 | `app_opened` props `{ cold_start, surface }` exactly | ✓ | all four sites |
| SC-6 | `checkout_started` fires in consumer event checkout BEFORE the payment sheet + BEFORE `purchase_completed` | ✓ | `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx:410` |
| SC-7 | `checkout_started` fires in business event/trip/experience checkout BEFORE pay + BEFORE `purchase_completed` | ✓ | `checkout/[eventId]/payment.tsx:349`, `checkout-trip/[tripEventId]/payment.tsx:379`, `checkout-experience/[experienceEventId]/payment.tsx:293` |
| SC-8 | `checkout_started` props match `purchase_completed` id/type props `{ event_id, offering_type, value?, currency }` | ✓ | all four checkout sites |
| SC-9 | Fires ONCE per checkout attempt (re-render/double-tap guarded) | ✓ | consumer `checkoutInFlight` early-return; business `if (processing) return;` |
| SC-10 | Uses the SAME `postHogService.capture(...)` facade; no new infra; opt-out/consent honored | ✓ | facade unchanged; all sites call it |
| SC-11 | Native-only; no web analytics touched; keys via `Constants.expoConfig.extra` (COMMS-0028) | ✓ | `git diff --name-only` = native files only; facade unchanged |
| SC-12 | I-PROPOSED-1187 gates (incl. NATIVE-MOUNTS-ANALYTICS, POSTHOG-KEY-STATIC-READ) still pass | ✓ | all 6 1187 gates PASS |

The whole branch is uncommitted-at-write-time; on commit the single ORCH-1192
commit hash satisfies every row above. (See chat return for the commit hash.)

---

## 3. Files changed

Modified (8):
- `app-mobile/app/index.tsx` (+11/-1) — cold-start `app_opened`
- `app-mobile/src/hooks/useForegroundRefresh.ts` (+11) — foreground `app_opened` + import
- `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` (+13) — `checkout_started`
- `mingla-business/app/_layout.tsx` (+30/-1) — cold-start + foreground `app_opened` + resume guard
- `mingla-business/app/checkout/[eventId]/payment.tsx` (+20) — `checkout_started` (event) + import + dep
- `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` (+18) — `checkout_started` (trip) + import + dep
- `mingla-business/app/checkout-experience/[experienceEventId]/payment.tsx` (+18) — `checkout_started` (experience) + import + dep
- `.github/workflows/strict-grep-mingla-business.yml` (+11) — register the ORCH-1192 gate job

Added (2):
- `.github/scripts/strict-grep/orch-1192-app-events-wired.mjs` — CI gate (both apps, all 8 sites, fails-on-revert)
- `mingla-business/src/services/__tests__/postHogService.orch1192.test.ts` — ts-jest happy-path regression (11 tests)

Total: 8 modified + 2 added; ~130 insertions, 2 deletions.

---

## 4. Data-model changes applied

None. Pure client-side analytics instrumentation. No migration, no RLS, no
schema. (No `db push` command to emit.)

---

## 5. Edge functions touched

None. No `verify_jwt` changes.

---

## 6. Regression tests added — fails-on-revert proof

Two layers, both append-only (no existing test modified/deleted):

1. **CI gate** `.github/scripts/strict-grep/orch-1192-app-events-wired.mjs` —
   auto-discovered strict-grep gate (registered as workflow job
   `orch-1192-app-events-wired`). Asserts all 8 capture call sites across both
   apps with exact props + ordering (started-before-pay, started-before-
   completed) + the double-fire guards + that existing `purchase_completed`
   captures remain.
   - PASS: `OK: ORCH-1192-APP-EVENTS-WIRED — app_opened (cold+warm) + checkout_started wired across both native apps`
   - **fails-on-revert verified**: true LINE DELETION of the business foreground
     `app_opened` capture in `mingla-business/app/_layout.tsx` → gate EXIT 1
     (`foreground app_opened { cold_start:false, surface:"business_app" } NOT found`);
     restored → EXIT 0. Also independently verified by deleting the consumer
     cold-start capture (EXIT 1).

2. **Business ts-jest** `mingla-business/src/services/__tests__/postHogService.orch1192.test.ts`
   (11 tests, all PASS) — source-assertions for all 4 business call sites +
   a BEHAVIORAL test of the foreground-resume guard logic (no fire on first
   'active'/cold start, no fire on iOS inactive→active, fires once per genuine
   bg→active, fires again on a second cycle).
   - **fails-on-revert verified**: true LINE DELETION of the business event
     `checkout_started` block → 1 failed / 10 passed; restored → 11 passed.

`fails-on-revert verified at` the ORCH-1192 branch commit (see chat return).

The tester writes a SECOND adversarial test on a different angle (their job).

---

## 7. Old → New receipts

### app-mobile/app/index.tsx
- Before: cold-start boot effect called `void postHogService.initialize();` (no PostHog session event; Mixpanel cold-open only).
- Now: `void postHogService.initialize().then(() => postHogService.capture("app_opened", { cold_start: true, surface: "consumer_app" }));`
- Why: SC-1/SC-5 — real cold-start session event for DAU/WAU/MAU.
- Lines: +10.

### app-mobile/src/hooks/useForegroundRefresh.ts
- Before: the genuine-resume gate (`wasBackground && isNowActive`) fired only `mixpanelService.trackAppOpened({ source: 'warm' })`.
- Now: adds `postHogService.capture("app_opened", { cold_start: false, surface: "consumer_app" })` immediately after the mixpanel warm event (same gate → no double-fire with cold start, excludes iOS inactive→active).
- Why: SC-2/SC-5.
- Lines: +9 (incl. import).

### app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx
- Before: `handleBuy` validated, then `setCheckoutInFlight(true)` → `runNativeCheckout`, and on success fired `purchase_completed`.
- Now: after validation and before `setCheckoutInFlight(true)`, fires `checkout_started { event_id, offering_type:"event", value, currency, surface:"consumer_app" }`. The `if (checkoutInFlight) return;` at the top guards a double-fire.
- Why: SC-6/SC-8/SC-9.
- Lines: +13.

### mingla-business/app/_layout.tsx
- Before: boot init block called `void postHogService.initialize();`; the AppState effect only did `focusManager.setFocused(status === "active")` on every change.
- Now: (a) cold init chains `app_opened { cold_start:true, surface:"business_app" }`; (b) a new `prevAppStateRef` (seeded from `AppState.currentState`) makes the AppState handler fire `app_opened { cold_start:false, surface:"business_app" }` ONLY on background→active — so the very first 'active' (cold start) and iOS inactive→active never double-fire.
- Why: SC-3/SC-4/SC-5.
- Lines: +29.

### mingla-business/app/checkout/[eventId]/payment.tsx (+ trip + experience twins)
- Before: `handlePay` started with `if (processing) return; if (<id> === null) return;` then branched web/native, each firing `mixpanelService.track("ticket_checkout_pay_started")` inside its try; `purchase_completed` fired later on /confirm.
- Now: immediately after the guards (top of `handlePay`, before the web/native split), fires `checkout_started { event_id:<id>, offering_type:<event|trip|experience>, value? (allInPreviewCents/100 when present), currency: totals.currency, surface:"business_app" }`. `allInPreviewCents` + `totals.currency` added to the `useCallback` deps. The `if (processing) return;` guards a double-fire; free orders never reach payment.tsx so value is paid-only.
- Why: SC-7/SC-8/SC-9.
- Lines: +20 (event), +18 (trip), +18 (experience).

---

## 8. Cross-surface impact table

| Surface | Affected? | What changes / why not | Parity |
|---------|-----------|------------------------|--------|
| Consumer iOS | YES | cold + foreground `app_opened`; `checkout_started` on event checkout | automatic (shared RN) |
| Consumer Android | YES | same as iOS | automatic (shared RN) |
| Buyer/anonymous Web | NO | native `postHogService` is a web no-op; web analytics owned by `webAnalytics.web.ts` (untouched) | n/a |
| Business iOS | YES | cold + foreground `app_opened`; `checkout_started` on event/trip/experience checkout | automatic (shared RN) |
| Business Android | YES | same as iOS | automatic (shared RN) |
| Admin Web (adjacent) | NO | different codebase; no analytics change | n/a |
| Business Web preview (adjacent) | NO | `react-native-web` shims AppState, but the native facade no-ops on web → emits nothing | n/a |

No manual parity work needed — all affected surfaces share the RN code paths.

---

## 9. Smoke result

- TypeScript: `tsc --noEmit` on both apps → ZERO errors in any of the 7 touched
  source files (remaining repo-wide errors are pre-existing Deno-test/JSX
  baseline noise, unrelated).
- Gates: all 6 I-PROPOSED-1187 strict-grep gates PASS; new ORCH-1192 gate PASS.
- Jest: `postHogService.orch1192.test.ts` 11/11 PASS; existing
  `postHogService.orch1187*` 2 suites still PASS (18 total).
- Device/sim runtime smoke: **PENDING CI / native build.** Per COMMS-0052 the
  business app cannot be OTA'd and per COMMS-0051/0047 the consumer app cannot be
  OTA'd until fresh native builds ship (posthog-react-native +
  react-native-keyboard-controller native modules). These events are pure JS and
  will ride the NEXT native builds; on-device verification happens then.

---

## 10. Known issues / deferred

- No `[TRANSITIONAL]` markers introduced.
- On-device verification deferred to the queued native builds (COMMS-0052 /
  COMMS-0051 / COMMS-0047). The events emit correctly per static + behavioral
  tests; runtime emission to the PostHog project is unverified until then.
- `checkout_started.value` is omitted (not `null`) when the server all-in
  preview hasn't resolved yet on the business side — intentional (Constitution
  #9: no fabricated value). The consumer side always has `payload.totalCents`.

---

## 11. Operator action required

- No migration (`db push`): none.
- No edge-function deploy: none.
- Native builds (already tracked by COMMS-0052 / COMMS-0051 / COMMS-0047): the
  next business + consumer native builds will carry these events. No new build
  is required BY this ORCH beyond what those comms already mandate.
- COMMS-0052 (BLOCK, ALL) acknowledged on anchor `main`
  (`COMMS-0052 ack: mingla-implementor+claude (ORCH-1192)`): this skill performs
  NO OTA/deploy, so it complies by construction.

---

## 12. Discoveries for Orchestrator

- **Stale-base trap (re-confirmed memory lesson).** The worktree branch tip was
  behind the live `origin/main`; the initial `git rebase` reported "up to date"
  but `git diff --stat origin/main` then showed phantom deletions
  (ExperienceReservePicker / a deleted consumer test) that were actually
  origin/main moving FORWARD after the spawn base. Re-fetching + rebasing onto
  the CURRENT `origin/main` (`bce57a1a0`) cleared them. Always verify the diff
  against a freshly-fetched origin/main, not the spawn base (matches
  `feedback_verify_regressions_against_origin_not_anchor.md`).
- No unrelated bugs found in the touched files.
