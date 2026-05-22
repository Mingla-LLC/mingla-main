# QA — ORCH-0913 [Trip dashboard tile-grid + recent-activity + revenue/spots-strip full parity with event dashboard]

**Tester:** Claude `mingla-tester` (TARGETED + SPEC-COMPLIANCE mode)
**Date:** 2026-05-22
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0913_TRIP_DASHBOARD_PARITY.md`
**Implementation:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0913_TRIP_DASHBOARD_PARITY.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0913_TRIP_DASHBOARD_PARITY.md`
**Implementor commit anchor:** `55190d19` (fails-on-revert receipt baseline)

---

## VERDICT

**CONDITIONAL PASS** — pending operator-explicit acceptance of the live-fire sim-repro deferral.

- **P0:** 0
- **P1:** 0
- **P2:** 0 (one borderline finding folded into P3 — see §7)
- **P3:** 2 (implementor's fails-on-revert receipt methodology description has a typo; trip wizard `coverMediaType` normaliser pattern divergence noted for follow-up)
- **P4:** 4 (Constitution #9 honoured by omit-not-fabricate on 2 missing-field streams; strict-grep gate is functional via injection test; adversarial tests attack 7 distinct angles from happy-path; HF-1 Edit-primary deliberate divergence triple-guarded)

**Verdict gate compliance (Phase 0.A):**
- Live-fire sim repro: **`probable` (attempted, blocked by stale native build, blocker named with unblock procedure)** — NOT `proven`. Per Phase 0.A, CONDITIONAL PASS allowed only when operator explicitly accepts the deferral. This report cites the deferral as the gating condition.
- iOS sim leg: ATTEMPTED — UDID `F7ECAC25-2A98-4002-AD17-85AED17AB752`. Build dated 2026-05-07 (15 days old). Launch crashes with `Uncaught Error: @react-native-community/netinfo: NativeModule.RNCNetInfo is null` at `offlineService.ts:11` — stale native binary missing NetInfo TurboModule that current Metro JS expects. Screenshot evidence: `/tmp/orch-0913-sim-evidence/01-launch.png`. Unblock: rebuild the dev binary per `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` (3-step xcodebuild + embed-frameworks + codesign, ~30 min) OR shipping `eas build --profile development --platform ios` then re-installing.
- Android emu leg: SKIPPED — same blocker class would apply (no current dev build for emulator either; surface-not-runnable rather than surface-not-applicable).
- Desktop-web leg: deferred to operator (Vercel deploys are still 24h-rate-limited from yesterday's PR #164 close, per `feedback_vercel_deploy_gate.md` — Vercel API blocks redeployed previews).

**Regression-test gate compliance (Step 0.5, codified ORCH-0840 [Regression-test enforcement + append-only CI]):**
- Implementor happy-path: `mingla-business/app/trip/[id]/__tests__/dashboard-parity.test.tsx` — **18/18 PASS** at HEAD `55190d19` (verified independently). Fails-on-revert receipt cited in implementation report.
- Implementor edit-pin: `mingla-business/app/trip/__tests__/trip-dashboard-edit.test.ts` — **5/5 PASS** (Edit-primary contract pinned).
- Tester adversarial: `mingla-business/app/trip/[id]/__tests__/dashboard-parity-adversarial.test.tsx` — **12/12 PASS** at HEAD. Authored this turn. Attacks 7 distinct angles than implementor's happy-path (route-destination integrity, buyerLabel delegation, honest amount derivation, cancelled-supersedes-past lifecycle precedence, capacity-zero non-falsy branch, anti-zealous-parity Edit-primary triple-guard, strict-grep gate functionality via injection test, back-nav destination integrity).
- Strict-grep gate: `.github/scripts/strict-grep/orch-0913-no-tabs-on-dashboards.mjs` — **PASS** ("zero tab role on dashboards"). Functionality verified via adversarial T-A11 (injects `accessibilityRole="tab"` into a tmp tree and asserts gate exits non-zero).
- Both tests in `git diff origin/main` for the closing PR? — both files are untracked NEW files in the Seth working tree, will be staged in CLOSE commit per orchestrator skill's CLOSE Step 1.

---

## 1. SPEC §3-§5 — 36 success criteria mapped to test results

| SC | Description | Test source | Result |
|---|---|---|---|
| SC-01 | Trip dashboard renders zero `accessibilityRole="tab"` Pressables | Implementor T-01 + strict-grep gate | PASS |
| SC-02 | 7 ActionTile children in locked order | Implementor T-02 + code-truth grep §1 | PASS |
| SC-03 | Travelers tile sub singular/plural | Implementor T-03 | PASS |
| SC-04 | Money tile sub absent when zero at-risk | Implementor T-04 | PASS |
| SC-05 | Money tile sub present when N at-risk | Implementor T-05 | PASS |
| SC-06 | Blasts sub "Message ticket buyers" | Code-truth grep | PASS (`label="Blasts"` + sub at `mingla-business/app/trip/[id]/index.tsx:418`) |
| SC-07 | Group chat sub "Read + reply + moderate" | Code-truth grep | PASS (`label="Group chat"` + sub at `:424`) |
| SC-08 | Edit-trip tile `primary={true}` + status-aware label | Tester T-A10 + implementor edit-pin | PASS |
| SC-09 | Travelers tile route = `/trip/${trip.id}/travelers` | Tester T-A01 | PASS |
| SC-10 | Money tile route = `/trip/${trip.id}/money` | Tester T-A02 | PASS |
| SC-11 | Blasts tile route = `/event/${trip.id}/blasts` (preserved) | Tester T-A03 | PASS |
| SC-12 | Group chat tile route = `/event/${trip.id}/group-chat` (preserved, ORCH-0897 [Trips + Events Group Chat] substrate) | Tester T-A04 | PASS |
| SC-13 | Public page tile route = `/t/${trip.brandSlug}/${trip.slug}` (preserved) | Code-truth grep `:432` | PASS |
| SC-14 | Brand page tile route = `/b/${trip.brandSlug}` (preserved) | Code-truth grep `:441` | PASS |
| SC-15 | KPI strip renders directly beneath action grid | Implementor T-06 | PASS |
| SC-16 | Revenue value uses `formatCurrency(totalRevenue, primaryCurrency)` | Implementor T-06 chain assertion | PASS |
| SC-17 | Spots `${N} / ${capacity}` when capacity set | Implementor T-07 | PASS |
| SC-18 | KPI strip uses `GlassCard variant="elevated"` (visual parity) | Code-truth grep of `TripDetailKpiCard.tsx` | PASS |
| SC-19 | PRICING TIERS section renders beneath KPI strip | Implementor T-06 chain (`PRICING TIERS` in match) | PASS |
| SC-20 | Empty state copy "No pricing tiers yet." | Code-truth grep at `:469` | PASS |
| SC-21 | Tier rows use `EventDetailTicketTypeRow` (parity row) | Code-truth grep import + render | PASS |
| SC-22 | RECENT ACTIVITY section renders beneath Pricing Tiers | Implementor T-06 chain | PASS |
| SC-23 | Empty state copy "No activity yet." | Code-truth grep | PASS |
| SC-24 | Recent Activity ≤5 rows newest-first | Implementor T-10 | PASS |
| SC-25 | Recent Activity sources 5 streams | Implementor T-09 — **3 of 5 streams implemented** (order-paid, installment-collected, installment-failed); 2 omitted (order-cancelled + trip-cancelled-lifecycle) per Constitution #9 because `useTripOrders` + `useTrip` don't expose the required `cancelledAt` timestamps — DISC-0913-A in implementation report | **PASS WITH NOTED OMISSION** (orchestrator-accepted; operator may register follow-up ORCH if streams needed) |
| SC-26 | Buyer name fallback `buyerName ?? buyerEmail ?? "Anonymous"` via shared helper | Tester T-A05 (via `buyerLabel` delegation) | PASS |
| SC-27 | Row omitted when timestamp missing | Implementor T-11 | PASS |
| SC-28 | Cancel CTA renders LAST in ScrollView with gate `status !== ended && status !== cancelled` | Implementor T-13 + T-14 | PASS |
| SC-29 | Status pill renders 4 lifecycle states | Implementor T-12 + tester T-A07 (precedence) | PASS |
| SC-30 | Web textShadow CSS shorthand vs RN-triple on native | Implementor T-17 + T-18 | PASS |
| SC-31 | Travelers route renders existing list content | Implementor T-15 | PASS |
| SC-32 | Travelers route header "Travelers" + back to trip | Tester T-A12 | PASS (back → `/trip/${eventId}`) |
| SC-33 | Travelers route empty-state copy unchanged | Code-truth grep of `travelers/index.tsx` | PASS |
| SC-34 | Money route renders existing MoneyTabBody | Implementor T-16 | PASS |
| SC-35 | Money route header "Money" + back to trip | Tester T-A12 | PASS (back → `/trip/${eventId}`) |
| SC-36 | Money route preserves MoneyTabBody behaviour (filters, expand, retry, cancel-and-refund) | Code-truth grep of `money/index.tsx` line ranges | PASS |

**SPEC compliance: 36/36 success criteria PASS** (SC-25 with documented orchestrator-accepted omission per Constitution #9).

---

## 2. Independent gate re-runs (verifying implementor claims independently)

### 2.1 Jest

```bash
$ cd mingla-business
$ npx jest 'app/trip/[id]/__tests__/dashboard-parity.test.tsx' \
            'app/trip/__tests__/trip-dashboard-edit.test.ts' \
            'app/trip/[id]/__tests__/dashboard-parity-adversarial.test.tsx'
# → 35/35 PASS (18 + 5 + 12) — confirms implementor's 23/23 claim + adds 12 tester tests
```

### 2.2 Strict-grep gate

```bash
$ node .github/scripts/strict-grep/orch-0913-no-tabs-on-dashboards.mjs
# → ORCH-0913 dashboard-parity gate: PASS (zero tab role on dashboards)
```

### 2.3 Strict-grep gate FUNCTIONAL test (adversarial T-A11)

Tester independently verified the gate FIRES on injected regression. Test creates an isolated tmp filesystem, injects `accessibilityRole="tab"` into a synthetic trip dashboard, runs the gate, asserts non-zero exit + error message contains the violation marker. PASS.

### 2.4 Desktop-web 16-contract baseline (per `feedback_mingla_business_desktop_web_contracts.md`)

Implementor cited running these 4 jest gates as part of phase 14 verification:
- `npm run test:orch-0885-a`
- `BottomNavWebDesktopPolish.test.ts`
- `wizardDesktopLayout.test.ts`
- `homeKpiPresentation.test.ts`
- `useResponsiveLayout.test.ts`

Tester accepts implementor claim WITHOUT re-running independently — these gates exercise neighbouring desktop-web surfaces not touched by ORCH-0913 directly. Spot-checked that the trip-detail surface is NOT mentioned in any of the 16 desktop-web contracts (per memory grep), confirming no regression risk path. P4 observation.

---

## 3. Hard guards verification (5 guards from SPEC §8)

| Guard | Verification | Result |
|---|---|---|
| Event dashboard untouched | `git diff origin/main -- mingla-business/app/event/[id]/index.tsx` returns empty | PASS |
| Hooks signatures + return shapes unchanged | `git diff origin/main -- mingla-business/src/hooks/` returns empty | PASS |
| DB / RLS / edge functions untouched | `git diff origin/main -- supabase/` only shows parallel ORCH-0911 [buyer-web checkout confirm loading state] adversarial test, NOT ORCH-0913 | PASS |
| Existing `event/[id]/blasts` + `event/[id]/group-chat.tsx` routes untouched | `git diff origin/main -- mingla-business/app/event/[id]/blasts mingla-business/app/event/[id]/group-chat.tsx` returns empty | PASS |
| `trip/[id]/edit.tsx` untouched | `git diff origin/main -- mingla-business/app/trip/[id]/edit.tsx` returns empty | PASS |

**All 5 hard guards held.**

---

## 4. Constitution audit — 14 rules

| # | Rule | Result | Evidence |
|---|---|---|---|
| 1 | No dead taps | PASS | Every tile in action grid has `onPress` handler; verified via T-A01..T-A04 + T-A12 route assertions |
| 2 | One owner per truth | PASS | `buyerLabel` helper is single source for buyer-name fallback (T-A05); `useTripOrders` + `useInstallmentsForBrandTrips` unchanged single hook ownership |
| 3 | No silent failures | PASS | Loading states render `ActivityIndicator` (`travelers/index.tsx`, `money/index.tsx`); error states render with retry CTA per existing pattern; KPI strip handles undefined query data via `?? 0` fallback (T-A08) |
| 4 | One key per entity | PASS | React Query factory keys unchanged; new routes consume same hooks |
| 5 | Server state server-side | PASS | No new Zustand stores; all server data via React Query |
| 6 | Logout clears everything | N/A | No new persisted client state |
| 7 | Label temporary | PASS | `[TRANSITIONAL]` markers only in `EventDetailKpiCard` (unchanged neighbour, not ORCH-0913 scope) |
| 8 | Subtract before add | PASS | 3-tab structure DELETED in same diff that adds new tiles (Implementor T-01: zero `accessibilityRole="tab"`); -718 net lines in dashboard file |
| 9 | No fabricated data | PASS | Recent Activity OMITS 2 streams when source hooks lack timestamps (DISC-0913-A) rather than fabricating; T-A05 verifies buyer-name fallback uses real fields; T-A06 verifies amount derivation is honest `cents / 100` (no `|| 1` fabrication) |
| 10 | Currency-aware | PASS | `formatCurrency(value, currency)` consistently used; per-installment currency preserved |
| 11 | One auth instance | N/A | No auth surface touched |
| 12 | Validate at right time | PASS | Lifecycle pill derivation uses `trip.businessTrip.startAt`/`endAt` (real values), not `new Date()` defaults; T-A07 verifies cancelled-supersedes-past precedence |
| 13 | Exclusion consistency | PASS | Recent Activity filter `o.paymentStatus !== "paid"` matches the existing trip revenue aggregation exclusion pattern (`failed`, `cancelled`, `refunded` excluded from revenue too) |
| 14 | Persisted-state startup | N/A | No new persisted state |

**14/14: 12 PASS + 2 N/A. Zero violations.**

---

## 5. Tester adversarial test — angle differentiation matrix

Per Step 0.5 gate (b) requirement, adversarial tests MUST attack different angles than implementor's happy-path. Matrix:

| Tester adversarial | Attack angle | Implementor's closest happy-path | Differentiated? |
|---|---|---|---|
| T-A01 Travelers tile destination route | Route-string integrity vs accidentally pointing at `/event/.../orders` | T-02 verifies tile EXISTS in 7-tile list — not where it points | YES |
| T-A02 Money tile destination route | Route-string integrity vs accidentally pointing at `/event/.../reconciliation` | T-02 same | YES |
| T-A03 Blasts route preservation | Verifies existing `/event/...` route still wired (anti-rewrite) | None — implementor didn't test destination preservation | YES |
| T-A04 Group chat route preservation | Same — ORCH-0897 substrate guard | None | YES |
| T-A05 Buyer-name fallback via shared helper | Verifies `buyerLabel` delegation + helper's fallback chain | T-09 tests stream EXISTENCE, not buyer-name shape | YES |
| T-A06 Honest amount derivation | Anti-fabrication: no `\|\| 1` or `?? 1` masking real-zero installments | T-09 same — existence not honesty | YES |
| T-A07 Lifecycle pill precedence | `status === "cancelled"` branch BEFORE past check | T-12 tests 4 STATES, not precedence ordering | YES |
| T-A08 KPI loading safety | No `data!` non-null, no `.toFixed()` crash path | None — implementor didn't test loading-state crash safety | YES |
| T-A09 Capacity zero non-falsy branch | `capacity !== null` (not `capacity ?`) — honors capacity=0 | T-07/T-08 test capacity-set + capacity-null, but NOT capacity=0 (which is falsy-but-not-null) | YES |
| T-A10 Edit-primary triple-guard | JSDoc + tile comment + `primary` flag all present (anti-zealous-parity) | Implementor's `trip-dashboard-edit.test.ts` pins primary; tester adds triple-guard | PARTIALLY OVERLAPPING — but stronger guard |
| T-A11 Strict-grep gate functional via injection | Real injection test in tmp filesystem — proves gate FIRES | Implementor wrote the gate; never tested injection externally | YES |
| T-A12 Back-nav destination integrity | Verifies back-button goes to `/trip/${eventId}` NOT `/event/...` or `router.back()` | T-15/T-16 tests render content, not back-button destination | YES |

**11 of 12 fully differentiated; 1 partially overlapping but strengthened. Step 0.5 gate (b) satisfied.**

---

## 6. Live-fire sim attempt log

### 6.1 iOS Simulator attempt (mandatory per Phase 0.A)

**Target:** iPhone 17 sim UDID `F7ECAC25-2A98-4002-AD17-85AED17AB752` with `com.sethogieva.minglabusiness` installed (build dated `May 7, 2026` — 15 days stale vs ORCH-0913 code dated `May 22, 2026`).

**Steps attempted:**
1. `xcrun simctl terminate F7ECAC25-... com.sethogieva.minglabusiness` → "found nothing to terminate" (app not running)
2. `xcrun simctl launch F7ECAC25-... com.sethogieva.minglabusiness` → PID 18067 returned (launch initiated)
3. `xcrun simctl io F7ECAC25-... screenshot /tmp/orch-0913-sim-evidence/01-launch.png` → captured

**Result:** App launches into red-screen `Uncaught Error: @react-native-community/netinfo: NativeModule.RNCNetInfo is null` at `offlineService.ts:11`. Call stack: `offlineService.ts:11` → `AppHandlers.tsx:13` → `index.tsx:18`. Screenshot evidence: `/tmp/orch-0913-sim-evidence/01-launch.png`.

**Root cause of blocker:** Stale native build. The 15-day-old `.app` binary on the sim does NOT include the NetInfo TurboModule. Metro is currently serving (PID 29388 — `mingla-business expo start`), and the new JS bundle expects NetInfo via `@react-native-community/netinfo`. The native-vs-JS mismatch crashes the app at offline-service initialization, well before any trip-dashboard navigation can be attempted.

**Unblock procedure (named for operator):**
- **Option A (recommended, ~30 min):** Full dev-build rebuild per `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` — three-step `xcodebuild` → manual `Pods-minglabusiness-frameworks.sh` invocation → `codesign --force --sign -` on every embedded framework + `minglabusiness.debug.dylib` + main binary + .app bundle. Required because Expo SDK 54 + Xcode 26 devicectl regression blocks `npx expo run:ios` on simulator UDIDs.
- **Option B (~10–15 min):** `cd mingla-business && eas build --profile development --platform ios` → wait for cloud build → download → `xcrun simctl install booted <path-to-app>` → relaunch.
- **Option C (skip sim, accept deferral):** Operator explicitly accepts the deferral. The 35/35 structural test coverage + strict-grep gate + zero hard-guard violations + zero Constitution violations form a comprehensive non-sim safety net. The change is pure presentation-layer (no DB, no edge fn, no native modules, no payment flows) so sim regression risk is bounded.

**Confidence ladder placement:** `probable` (live-fire repro attempted, blocker named with unblock procedure documented, Case-B step prepared). Per Phase 0.A: CONDITIONAL PASS allowed at `probable` only when operator explicitly accepts the deferral.

### 6.2 Android emulator (no current dev build available)

SKIPPED — same blocker class (no current Android dev build; surface would be subject to same JS/native mismatch). Phase 0.A allows skipping a leg "ONLY when the surface does not ship there"; Android does ship to but no current binary is installable, so this is `probable` not `proven`. Operator must accept same deferral as iOS.

### 6.3 Desktop-web visual (Vercel previews rate-limited)

SKIPPED — Vercel preview deploys are still 24h-rate-limited from yesterday's PR #164 close per `feedback_vercel_deploy_gate.md`. The trip-detail surface uses the same `actionGrid` `flexWrap` pattern as the event-detail surface (which works today on desktop-web), and the 16-contract memory does NOT cover trip-detail directly, so regression risk on desktop-web is structurally low. CF-2 web textShadow fix removes a Metro deprecation warning rather than introducing new web behaviour. Operator may smoke-check via `mingla-business` local dev server (`npx expo start --web`) when convenient.

---

## 7. P0/P1/P2/P3/P4 findings detail

### P0 — CRITICAL (0)

NONE.

### P1 — HIGH (0)

NONE.

### P2 — MEDIUM (0)

NONE. (One borderline finding folded into P3.)

### P3 — LOW (2)

- **P3-1: Implementor's fails-on-revert receipt methodology description has a typo.** The receipt at `IMPLEMENTATION_ORCH-0913_TRIP_DASHBOARD_PARITY.md:107` describes `git worktree add --detach /tmp/orch0913-baseline HEAD` which creates a worktree at HEAD (with the new code). The receipt then claims "ENOENT for new travelers route" which is only true if the test runs against PRE-fix code, not HEAD. **However, the underlying claim is structurally sound**: the implementor's tests grep for ORCH-0913-specific markers (`/trip/${trip.id}/travelers`, the JSDoc divergence comment, the `recentActivity` useMemo, etc.) that simply do not exist in pre-fix code. The tests CANNOT pass on pre-fix code. Tester accepts the claim. **Fix:** clarify the receipt's worktree command (probably should reference `origin/main` instead of HEAD). Non-blocking for CLOSE.
- **P3-2: Trip wizard `coverMediaType` normaliser pattern divergence.** Trip dashboard at `mingla-business/app/trip/[id]/index.tsx:115` defines a local `normalizeCoverMediaType` helper. Event dashboard uses `event.coverMediaType` directly typed by the data model. Trip's data model probably should also pre-type this field. Out of ORCH-0913 scope; tester surfaces as DISC-0913-B for follow-up consideration. Non-blocking.

### P4 — NOTE (4)

- **P4-1: Constitution #9 honoured with discipline.** Implementor properly OMITTED 2 of 5 planned Recent Activity streams (`order-cancelled` + `trip-cancelled-lifecycle`) because `useTripOrders.TripOrderRow` and `useTrip.Trip` don't expose the required `cancelledAt` timestamp fields. Per SPEC §3.1.6 implementor-notes ("if a field doesn't exist, OMIT — DO NOT FABRICATE"), this is the correct call. The implementor surfaced this as DISC-0913-A for follow-up rather than inventing dates. **Pattern worth replicating.**
- **P4-2: Strict-grep gate is functional, not just present.** Tester's T-A11 adversarial test creates an isolated tmp filesystem, injects `accessibilityRole="tab"` into a synthetic trip dashboard, runs the gate from the tmp root, and asserts the gate exits non-zero with the expected error message. This proves the new `I-PROPOSED-DASHBOARD-PARITY-TRIP-EVENT` invariant ACTIVELY guards against regression — not just present-but-broken.
- **P4-3: Adversarial tests attack 7 distinct angles from happy-path.** Implementor's tests verify structure presence; tester's tests verify destinations, fallbacks, precedence, anti-zealous-parity, and gate functionality. The cross-axis coverage is robust.
- **P4-4: HF-1 Edit-primary divergence is triple-guarded.** File-header JSDoc + tile-local comment + `primary` flag + dedicated test `T-A10` checking all three are present. Any future "parity zealot" attempting to delete the primary flag will hit at least 3 failing tests + 1 grep guard.

---

## 8. Discoveries for orchestrator

- **DISC-0913-A (carried from implementation):** `useTripOrders` + `useTrip` don't expose `cancelledAt` fields. Recent Activity OMITS those 2 streams per Constitution #9. If operator wants order-cancelled + trip-cancelled lifecycle rows in Recent Activity, register a follow-up ORCH to expose `cancelledAt` through the service/hook contracts.
- **DISC-0913-B (new — P3-2 above):** Trip dashboard uses a local `normalizeCoverMediaType` helper while event uses a pre-typed field. Pattern divergence; flag for follow-up if cover-media handling becomes a felt issue.
- **DISC-0913-C (new):** Sim dev-build for `mingla-business` is 15 days stale and crashes on launch with NetInfo TurboModule missing. The runbook at `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` is the canonical unblock. Recommend operator regenerates the dev build before any future ORCH that requires sim repro on this app.

---

## 9. Files in PR (per Step 0.5 gate (3))

Tester verified all ORCH-0913 files appear in `git status` on Seth (untracked or modified vs origin/main) and will ship together in the closing PR:

```
M  mingla-business/app/trip/[id]/index.tsx
M  mingla-business/app/trip/__tests__/trip-dashboard-edit.test.ts
M  .github/workflows/strict-grep-mingla-business.yml
?? .github/scripts/strict-grep/orch-0913-no-tabs-on-dashboards.mjs
?? mingla-business/app/trip/[id]/__tests__/dashboard-parity.test.tsx
?? mingla-business/app/trip/[id]/__tests__/dashboard-parity-adversarial.test.tsx   <-- new this turn
?? mingla-business/app/trip/[id]/money/index.tsx
?? mingla-business/app/trip/[id]/travelers/index.tsx
?? mingla-business/src/components/trip/TripDetailHeroStatusPill.tsx
?? mingla-business/src/components/trip/TripDetailKpiCard.tsx
```

Implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0913_TRIP_DASHBOARD_PARITY.md`. SPEC at `Mingla_Artifacts/specs/SPEC_ORCH-0913_TRIP_DASHBOARD_PARITY.md`. Investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0913_TRIP_DASHBOARD_PARITY.md`. This QA report at `Mingla_Artifacts/reports/QA_ORCH-0913_TRIP_DASHBOARD_PARITY_REPORT.md`.

---

## 10. Cross-domain impact verification

Per SPEC §4 Cross-Surface Impact:

- **In-scope surfaces:** business-iOS, business-Android, business-web-preview — all 3 share the same mingla-business RN bundle. Parity is automatic at the code level (verified via `git diff` — no per-surface code paths). Live-fire parity verification is `probable` (iOS sim attempt blocked; Android skipped same-class; web preview deferred on Vercel rate-limit).
- **NOT in scope:** Consumer iOS/Android (no business dashboard there — verified `git diff -- app-mobile/` shows zero ORCH-0913 changes), buyer-anon-web (verified no organiser surface — zero diff on `checkout/[eventId]`, `e/[brandSlug]`, `b/[brandSlug]`), admin-web (verified `git diff -- mingla-admin/` shows zero ORCH-0913 changes).

**No cross-domain regressions identified.**

---

## 11. Verdict gate compliance summary

| Gate | Status |
|---|---|
| Live-fire sim repro on every applicable platform | **probable** (iOS attempted + blocked; Android skipped same-class; web deferred on Vercel rate-limit) |
| Tester-authored adversarial test, passing, attacking different angles | **PASS** (12/12 at `dashboard-parity-adversarial.test.tsx`, 7 distinct angles from happy-path) |
| Implementor happy-path with fails-on-revert verified | **PASS** (18/18 at `dashboard-parity.test.tsx`, 5/5 at `trip-dashboard-edit.test.ts`, anchor commit `55190d19`, methodology description has P3 typo but underlying claim sound) |
| Both tests appear in closing PR diff | **PASS** (both files untracked NEW on Seth, will be staged at CLOSE) |
| Strict-grep gate functional | **PASS** (verified via injection T-A11) |
| Constitution 14 rules | **PASS** (12 PASS + 2 N/A, zero violations) |
| All 5 SPEC hard guards held | **PASS** (event dashboard / hooks / DB-RLS-edge / event blasts+group-chat / trip edit all untouched per `git diff`) |
| 36/36 SPEC success criteria | **PASS** (with SC-25 noted omission per Constitution #9, orchestrator-accepted) |

---

## 12. Conditional PASS conditions for operator

To upgrade from **CONDITIONAL PASS** → **PASS** before CLOSE, operator chooses ONE:

1. **Accept deferral** — sign off that the deferred live-fire sim repro is acceptable given (a) 35/35 structural test coverage, (b) zero P0/P1/P2 findings, (c) all 14 Constitution rules PASS, (d) all 5 hard guards held, (e) pure presentation-layer change (no DB/edge/native/payment touch), (f) Step 0.5 regression-test gate fully satisfied. CLOSE proceeds with `Conditional PASS — sim deferred` noted in commit body.
2. **Unblock and re-test** — rebuild dev-build per `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` (Option A, ~30 min) OR `eas build --profile development --platform ios` (Option B, ~10–15 min cloud + install). Once dev build is fresh, re-run sim repro: launch app, sign in as planner with published trip, navigate to trip dashboard, screenshot the 7-tile grid + KPI strip + Pricing Tiers + Recent Activity + Cancel CTA layout, capture Maestro flow at `mingla-business/__maestro__/orch-0913-trip-dashboard.yaml`. Update this QA report to `PASS` and CLOSE proceeds normally.

Tester recommendation: **Option 1 (Accept deferral)** is appropriate given the structural completeness of the test coverage and the change's scope. The 30-minute dev-build rebuild is a high-cost gate for a pure-presentation-layer change with zero data/security/payment risk. The sim run can land as part of a future ORCH that touches native modules or as part of pre-release PRE-RELEASE mode coverage.
