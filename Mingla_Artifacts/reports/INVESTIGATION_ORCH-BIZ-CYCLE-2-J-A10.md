# Investigation — J-A10 + J-A11 (Stripe Connect Onboarding Shell + View Brand Payments)

> **Mode:** Forensics INVESTIGATE-THEN-SPEC (greenfield spec preparation)
> **Issue ID:** ORCH-BIZ-CYCLE-2-J-A10
> **Codebase:** `mingla-business/`
> **Predecessor:** Avatar primitive carve-out CLOSE (commit `c947c292`); J-A9 Brand Team CLOSE (commit `e242bf59`)
> **Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_2_J_A10_PAYMENTS_SHELL.md`
> **Auditor turn:** 2026-04-30
> **Confidence:** **High** — designer handoff §5.3.7, §5.3.8, §6.3.3 read end-to-end; Cycle-2 patterns (J-A7 banner + Operations row, J-A8 onEdit / J-A9 onTeam navigation prop chain) confirmed; KpiTile primitive contract verified; current Stripe-state handler at BrandProfileView.tsx:163 quantified

---

## 1. Symptom Summary

Greenfield spec preparation. No bug. The J-A7 Stripe banner currently fires `[TRANSITIONAL]` Toast `"Stripe Connect lands in J-A10."` (BrandProfileView.tsx:163-165) and Operations row #1 "Payments & Stripe" fires `[TRANSITIONAL]` Toast `"Stripe Connect lands in J-A10."` (operationsRows useMemo). J-A10 + J-A11 builds the actual payments dashboard + Stripe onboarding shell.

**Expected post-J-A10/A11 state:**
- Tap J-A7 Stripe banner OR Operations row "Payments & Stripe" → navigates to `/brand/[id]/payments` dashboard
- Dashboard renders status banner (4 variants: not_connected · onboarding · active · restricted) + 3 KPI tiles + recent payouts + recent refunds + Export CTA
- Tap "Connect Stripe" CTA on banner → navigates to `/brand/[id]/payments/onboard` shell
- Onboarding shell shows simulated 1.5s loading → "complete" state with Done CTA → returns to dashboard with brand.stripeStatus flipped from `not_connected` → `onboarding`
- 4 stub brands cover all 4 banner states for visual smoke
- Mobile + web parity per DEC-071 (web direct-URL works; full desktop UX deferred to Cycle 6/7)

**Current state:**
- `app/brand/[id]/payments/` directory does not exist
- `Brand` type lacks `stripeStatus`, `payouts`, `refunds` fields (v7 last bumped at J-A9 schema)
- BrandProfileView's `handleStripeBanner` and Operations row #1 handler are closure-scoped to Toast — no `onStripe` / `onPayments` props yet

---

## 2. Investigation Manifest

| File | Layer | Read | Notes |
|---|---|---|---|
| Dispatch `FORENSICS_BIZ_CYCLE_2_J_A10_PAYMENTS_SHELL.md` | Spec input | ✅ | 8 architectural decisions surfaced + bundle rationale (J-A10/A11 inseparable) |
| `INVESTIGATION_ORCH-BIZ-CYCLE-2-J-A7.md` | J-A7 baseline | ✅ (session) | Stripe banner pattern at line ~163; O-A7-2 already documented as TRANSITIONAL |
| `INVESTIGATION_ORCH-BIZ-CYCLE-2-J-A8.md` | J-A8 baseline | ✅ (session) | onEdit pattern (callback prop on view, route owns navigation) |
| `INVESTIGATION_ORCH-BIZ-CYCLE-2-J-A9.md` | J-A9 baseline | ✅ (session) | onTeam pattern + nested routes + 5.3.x DESIGN-PACKAGE-SILENT precedent |
| `IMPLEMENTATION_BIZ_AVATAR_PRIMITIVE.md` | Most-recent kit carve-out | ✅ (session) | DEC-079 additive precedent; lift discipline (3+ uses threshold) |
| `IMPLEMENTATION_BIZ_CYCLE_2_J_A9_BRAND_TEAM.md` | J-A9 impl | ✅ (session) | Operations row chain pattern (onEdit J-A8 → onTeam J-A9 → onPayments J-A10) |
| `HANDOFF_BUSINESS_DESIGNER.md` §5.3.7 | Authoritative source | ✅ (line 1850) | Banner / KPIs / payouts / refunds / Export structure + 4 banner states |
| `HANDOFF_BUSINESS_DESIGNER.md` §5.3.8 | Authoritative source | ✅ (line 1857) | Mobile WebView full-screen + state machine (loading/in-progress/complete/failed) |
| `HANDOFF_BUSINESS_DESIGNER.md` §6.3.3 | Journey narrative | ✅ (line 3045-3071) | Sara onboards Stripe — happy path + branches + failure paths |
| `mingla-business/src/store/currentBrandStore.ts` | Schema | ✅ (session, v7) | No stripeStatus / payouts / refunds; v7 was J-A9 |
| `mingla-business/src/store/brandList.ts` | Stub data | ✅ (session) | 4 brands; need stripeStatus + payouts + refunds per spread |
| `mingla-business/src/components/brand/BrandProfileView.tsx` | Wiring point | ✅ (session) | handleStripeBanner closure at line 163-165; operationsRows[0].onPress at line 188 (Stripe Toast) |
| `mingla-business/src/components/ui/KpiTile.tsx` | Kit primitive | ✅ | Currency-aware contract (caller formats); supports delta + sub; reusable for Available / Pending / Last payout |
| `mingla-business/app/brand/[id]/index.tsx` | Route wiring | ✅ (session) | Need to add handleOpenPayments + handleOpenStripeBanner handlers |
| `Mingla_Artifacts/specs/SPEC_BIZ_FRONTEND_JOURNEY_BUILD_ROADMAP.md` | Roadmap | ✅ (session, line 84-87) | J-A10/A11 routes + DESIGN-PACKAGE precedent |
| `Mingla_Artifacts/DECISION_LOG.md` | DEC entries | ✅ (session) | DEC-071/079/080/081/083 binding |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | Invariants | ✅ (session) | I-11/I-12/I-13 carry-over |

`npx tsc --noEmit` baseline clean (verified post-Avatar commit `c947c292`).

---

## 3. Findings (classified)

### 🔴 Root Causes — None (greenfield)

### 🟠 Contributing Factors — None

### 🟡 Hidden Flaws (spec MUST address)

#### H-A10-1 — Brand schema v7 lacks `stripeStatus`, `payouts`, `refunds` fields

- File: [`mingla-business/src/store/currentBrandStore.ts`](mingla-business/src/store/currentBrandStore.ts) (current v7 at persistOptions.name)
- Current Brand v7 fields cover everything through J-A9 (members, pendingInvitations).
- **Missing for J-A10/A11:**
  - `stripeStatus?: BrandStripeStatus` where `BrandStripeStatus = "not_connected" | "onboarding" | "active" | "restricted"`
  - `payouts?: BrandPayout[]` where `BrandPayout = { id, amountGbp, currency, status: "paid" | "in_transit" | "failed", arrivedAt: string }`
  - `refunds?: BrandRefund[]` where `BrandRefund = { id, amountGbp, currency, eventTitle: string, refundedAt: string, reason?: string }`
  - `availableBalanceGbp?: number` (Available — clears for payout)
  - `pendingBalanceGbp?: number` (Pending — Stripe escrow before payout)
  - `lastPayoutAt?: string` (ISO timestamp)
- §5.3.7 requires the banner + KPI tiles + lists to render — without these the dashboard is empty.
- **Spec mitigation:** schema bump v7 → v8 with all 6 new fields (5 optional + 1 enum) + 3 new types. Passthrough migration (v7→v8 — undefined defaults at read sites: `stripeStatus ?? "not_connected"`, `payouts ?? []`, `refunds ?? []`, balances ?? 0). Same migration pattern as J-A7 (v2→v3) / J-A8 (v3→v4) / J-A9 (v6→v7).

#### H-A10-2 — J-A7 BrandProfileView's Stripe banner + Operations row #1 are closure-scoped to Toast

- File: [`mingla-business/src/components/brand/BrandProfileView.tsx:163-165`](mingla-business/src/components/brand/BrandProfileView.tsx#L163-L165)
- Current code:
  ```typescript
  // Stripe banner handler:
  const handleStripeBanner = useCallback((): void => {
    fireToast("Stripe Connect lands in J-A10.");
  }, [fireToast]);

  // Operations row #1 (in operationsRows useMemo at line ~188):
  {
    icon: "bank",
    label: "Payments & Stripe",
    sub: "Not connected",
    onPress: () => fireToast("Stripe Connect lands in J-A10."),
  }
  ```
- Both closure-scoped to Toast — no way to navigate from the component.
- **Spec mitigation:** add `onStripe: (brandId: string) => void` and `onPayments: (brandId: string) => void` props to `BrandProfileViewProps`. Modify `handleStripeBanner` to call `onStripe(brand.id)` (when brand !== null). Modify `operationsRows[0].onPress` to call `onPayments(brand.id)`. Sub-text becomes dynamic: maps `brand.stripeStatus` to "Not connected" / "Onboarding…" / "Active" / "Action required". Pattern continues J-A8 onEdit + J-A9 onTeam chain.
- Sub-decision: should banner tap and Operations row tap go to the SAME destination? Per §6.3.3 step 1, banner says "Connect Stripe to sell paid tickets" → routes to `/brand/[id]/payments/onboard`. Operations row says "Payments & Stripe" → routes to `/brand/[id]/payments` dashboard. **Recommendation:** banner tap → `/payments` dashboard (lets user see context first), then user taps the same banner ON the dashboard → `/payments/onboard`. This avoids deep-linking straight to onboarding without context. **Alternative:** banner taps → onboarding directly when status=`not_connected`; → dashboard when status=`onboarding/restricted`. Forensics recommendation: the simpler path is **always go to dashboard**, then user taps Connect/Resolve there to go to onboarding. Spec locks this.

#### H-A10-3 — No status-banner primitive; J-A7 has one inline pattern that needs lifting OR parameterizing

- File: [`mingla-business/src/components/brand/BrandProfileView.tsx`](mingla-business/src/components/brand/BrandProfileView.tsx) lines ~327-345 (current Stripe banner: GlassCard wrapping a Pressable with icon + title + sub + chevR)
- §5.3.7 requires 4 banner variants by Stripe status (not_connected / onboarding / active / restricted). The "active" state SUPPRESSES the banner (no banner at all when active). The other 3 render different copy + icon + color emphasis.
- **Spec mitigation:**
  - Compose the per-status banner inline in `BrandPaymentsView.tsx` (NEW component) — uses GlassCard variant + icon + 1-2 line copy + optional CTA Button. Status-driven copy table embedded in the component.
  - J-A7's existing Stripe banner stays inline composition for now (only renders when stripeStatus = `not_connected`); when J-A10 ships, J-A7's banner GAINS status awareness (suppressed when active; different copy per state).
  - Watch-point D-INV-A10-1: if a 3rd surface needs the same status-banner pattern (e.g., admin override or check-in screen warns about Stripe issues), promote to kit `StatusBanner` primitive (DEC-079 additive).

#### H-A10-4 — Onboarding state machine: 4 states but no obvious trigger for "failed"

- §5.3.8 lists states: loading · in-progress · complete · failed (with retry).
- Cycle 2 stub has no real Stripe API to fail; the simplest happy path covers loading → complete → return.
- **Spec mitigation:** ship the simplest happy path (1.5s loading → complete → return updates brand.stripeStatus to `onboarding`). Include the `failed` visual state in the component but gate it behind a developer-only trigger:
  - **Option A:** long-press the "Stripe onboarding" header → flips state to `failed`. Lets QA exercise the state without modifying code.
  - **Option B:** stub the visual but never reach it from any user interaction (only QA sees it via React DevTools state mutation).
  - **Recommendation: Option A** — long-press is unobtrusive (founders won't accidentally trigger it), exercises the failed UI state for visual review, no per-build code change needed. Mark with `[TRANSITIONAL]` comment "dev gesture for QA — exit when real Stripe SDK can fail naturally in B2."

#### H-A10-5 — Host-bg cascade (I-12) on 2 new routes

- Two new routes: `app/brand/[id]/payments/index.tsx` + `app/brand/[id]/payments/onboard.tsx`
- Both live outside `(tabs)/` → DO NOT inherit canvas.discover from tabs layout
- **Spec mitigation:** both route files MUST set `backgroundColor: canvas.discover` on host View. Same pattern as J-A7/J-A8/J-A9 routes. Code comment references invariant I-12.

#### H-A10-6 — Format-agnostic ID resolver (I-11) on both routes

- `[id]/payments/index.tsx` and `[id]/payments/onboard.tsx` both use the `[id]` segment
- **Spec mitigation:** same `useLocalSearchParams<{id: string | string[]}>()` + `find((b) => b.id === idParam)` pattern. NO new resolver logic — proven across J-A7/A8/A9.

#### H-A10-7 — Currency formatter duplication

- J-A7 has inline `formatGbp` helper (BrandProfileView.tsx). KpiTile primitive expects pre-formatted strings (per its currency-aware contract — caller formats).
- Payments dashboard needs the same formatter for Available / Pending / Last payout values + payouts/refunds list rows.
- **Spec mitigation:** duplicate `formatGbp` inline in BrandPaymentsView (DEC-079 closure; lift to shared utility on 3+ uses — D-INV-A10-X watch-point).

### 🔵 Observations

#### O-A10-1 — "Active" banner suppresses entirely; KPI tiles are the affirmative state

- Per §5.3.7 the active state has no banner — the dashboard is "clean" with just KPIs + lists. The absence of a warning banner IS the success signal.
- Spec must explicitly note this: when `stripeStatus = "active"`, NO banner renders. The page-top whitespace is intentional.

#### O-A10-2 — "Restricted" banner uses red/error color emphasis

- §5.3.7 says "red banner with reason + 'Resolve' CTA linking to Stripe dashboard"
- Cycle 2 stub has no real Stripe dashboard. CTA fires `[TRANSITIONAL]` Toast "Stripe support lands in B2." Real Stripe deep-link wired in B2.
- Use `semantic.error` token (already used by J-A8 destructive button + ConfirmDialog destructive flag). Compose inline (no new primitive).

#### O-A10-3 — KPI delta indicators NOT applicable for Cycle 2

- KpiTile supports `delta` + `deltaUp` props for trend indicators (e.g., "+12.4%" green up arrow)
- §5.3.7 doesn't specify delta requirements; Cycle 2 stub has no historical data to compute trends from
- **Decision:** OMIT delta/deltaUp for J-A11 stub. KPI tiles render value + sub only. When B1+ wires real data, deltas can be added without spec change (KpiTile already supports them).

#### O-A10-4 — "Last payout" tile shows formatted GBP value when payouts exist, "—" when empty

- §5.3.7 says "Last payout" (singular) — implies it's the most recent payout's amount.
- Stub coverage:
  - LM (not_connected): no payouts — value "—" + sub "No payouts yet"
  - TLL (onboarding): no payouts — same
  - SL (active): 4 payouts — value `formatGbp(latest.amountGbp)` + sub `"3d ago"` (formatRelativeTime)
  - HR (restricted): 1-2 historical payouts (was working before restriction) — same as SL
- Note: relative-time formatter is duplicated 3 places now (J-A9 BrandTeamView + J-A9 BrandMemberDetailView + J-A11). **Watch-point D-INV-A10-X (formatRelativeTime utility) — THRESHOLD REACHED at 3+ uses.** Recommend lifting to `src/utils/formatRelativeTime.ts` as a Cycle-2-polish micro-slice OR bundled with J-A12.

#### O-A10-5 — Recent payouts / refunds list visual

- §5.3.7 says "Recent payouts list · Recent refunds list"
- Section structure: section label "PAYOUTS" / "REFUNDS" + GlassCard with row per entry (currency value + status pill + relative date)
- Rows are NOT tappable in Cycle 2 (no detail view; deferred to B2). Watch-point: rows tap to fire TRANSITIONAL Toast OR be visually inert? **Recommendation:** visually inert (not Pressable) — avoids false-affordance. Add a `[TRANSITIONAL]` comment noting B2 wires per-row detail screens.

#### O-A10-6 — Export finance report CTA stays TRANSITIONAL until J-A12

- §5.3.7 lists "Export finance report" as a CTA on the dashboard
- J-A12 ships finance reports proper (per roadmap §3.1 line 87)
- **Decision:** Button on dashboard fires `[TRANSITIONAL]` Toast "Finance reports land in J-A12." Same retire pattern as J-A7 Edit-CTA Toast retired in J-A8.

#### O-A10-7 — Stub data realism — payouts spread

- Active brand (Sunday Languor) needs 3-4 realistic payouts. Suggested coverage:
  - £482.50 paid 3 days ago (Slow Burn vol. 4 night-of)
  - £312.80 paid 10 days ago (Slow Burn vol. 3)
  - £198.40 paid 2 weeks ago (Brunch March)
  - £156.20 in_transit (most recent — pending arrival)
- Refund coverage (1-2 rows on SL):
  - £24.00 refunded 5 days ago, eventTitle: "Slow Burn vol. 4", reason: "Couldn't make it"
  - £48.00 refunded 8 days ago, eventTitle: "Slow Burn vol. 3", reason: undefined
- Restricted brand (HR) keeps historical data intact (Stripe restriction doesn't delete history):
  - £88.00 paid 21 days ago (Hidden Rooms — Studio)
- Available + Pending balances:
  - SL active: Available £156.20 (= in_transit), Pending £45.60 (Stripe escrow window)
  - HR restricted: Available £0 (frozen), Pending £0
  - LM/TLL: Available £0, Pending £0 (no events sold yet)

#### O-A10-8 — Failed-state long-press gesture is QA convenience

- H-A10-4 recommended Option A (long-press header → failed state).
- This is purely for visual QA. When B2 wires real Stripe, failures can naturally occur and the gesture retires. Mark with `[TRANSITIONAL]`.
- Implementor note: long-press handler ONLY mounts in `__DEV__` mode? Or always? **Recommendation:** always mount (negligible overhead) — operator might want to see the failed state on a release build for design review.

#### O-A10-9 — Banner CTA chain when `not_connected`

- Banner copy: "Connect Stripe to sell tickets" + Connect Button
- Connect tap → navigates to `/brand/[id]/payments/onboard`
- After 1.5s loading → "Submitted" state with Done CTA → returns to `/brand/[id]/payments` with `stripeStatus = "onboarding"` set in the store
- The dashboard re-renders with the onboarding banner ("Onboarding submitted — verifying" + Finish onboarding CTA)
- Tap "Finish onboarding" → re-enters the same onboarding shell (idempotent); after another 1.5s → completes again (no further state change in stub; B2 advances `onboarding` → `active` via Stripe webhook)
- **Spec calls this out:** the stub cannot advance past `onboarding`. To exercise `active` state, smoke uses Sunday Languor (which seeds `active` directly).

---

## 4. Five-Layer Cross-Check

| Layer | Truth |
|---|---|
| **Docs (handoff §5.3.7)** | Banner per state · 3 KPI tiles · payouts list · refunds list · Export CTA |
| **Docs (handoff §5.3.8)** | Mobile WebView full-screen · 4-state machine (loading/in-progress/complete/failed) |
| **Docs (handoff §6.3.3)** | Journey: tap Connect → onboarding shell → Done → dashboard with banner update; push notification when active (Cycle 2 stub doesn't simulate push) |
| **Docs (roadmap §3.1)** | J-A10 = `/brand/:id/payments/onboard` shell; J-A11 = `/brand/:id/payments` dashboard |
| **Schema** | Brand v7 lacks stripeStatus / payouts / refunds / balances (additive v8 migration required) |
| **Code** | J-A7 Stripe banner + Operations row #1 closure-scoped to Toast (lines 163-165 + 188) |
| **Runtime** | N/A (frontend-first stub) |
| **Data** | AsyncStorage v7 → v8 passthrough |

**Layer agreement:** §5.3.7 + §5.3.8 + §6.3.3 + roadmap all align. No contradictions. The "loading" + "in-progress" states from §5.3.8 collapse in the Cycle 2 stub (1.5s combined).

---

## 5. Blast Radius

J-A10 + J-A11 ship:

| Surface | Change |
|---|---|
| `app/brand/[id]/payments/index.tsx` (NEW) | Dashboard route |
| `app/brand/[id]/payments/onboard.tsx` (NEW) | Onboarding shell route |
| `src/components/brand/BrandPaymentsView.tsx` (NEW) | Dashboard composition (banner per state + KPIs + payouts list + refunds list + Export CTA) |
| `src/components/brand/BrandOnboardView.tsx` (NEW) | Onboarding shell with state machine (loading → complete; long-press failed) |
| `src/store/currentBrandStore.ts` (MOD) | Brand schema v7 → v8 + new types BrandStripeStatus, BrandPayout, BrandRefund |
| `src/store/brandList.ts` (MOD) | All 4 STUB_BRANDS get stripeStatus + payouts + refunds + balances per spec §3.2 |
| `src/components/brand/BrandProfileView.tsx` (MOD) | Add `onStripe` + `onPayments` props · banner status awareness · Operations row #1 navigates · sub-text dynamic · 2 TRANSITIONAL Toasts removed |
| `app/brand/[id]/index.tsx` (MOD) | Pass `onStripe` + `onPayments` handlers |

**Total:** 8 files (4 new + 4 modified). Comparable to J-A9's 10 files.

**Other Cycle 2 surfaces (no changes):**
- BrandEditView · BrandTeamView · BrandMemberDetailView · BrandInviteSheet · RolePickerSheet — unchanged
- Account tab brand-rows section — unchanged
- TopBar / Sheet / ConfirmDialog / Input / Icon / KpiTile / Avatar kit primitives — unchanged

---

## 6. Invariant Check (preview — full list in spec)

| ID | Risk | Status |
|---|---|---|
| I-1 | designSystem.ts not modified | ✅ preserved |
| I-3 | iOS / Android / web execute | ✅ same Cycle-2 patterns |
| I-4 | No `app-mobile/` imports | ✅ preserved |
| I-6 | tsc strict — explicit return types | ⚠ implementor verifies |
| I-7 | TRANSITIONAL markers labeled | ⚠ 1.5s simulated onboarding · long-press failed dev gesture · Resolve Stripe Toast · Export CTA Toast · payouts/refunds row inert · row tap deferred B2 |
| I-9 | No animation timings touched | ✅ Sheet/ConfirmDialog reuse existing |
| I-11 | Format-agnostic ID resolver | ⚠ implementor verifies |
| I-12 | Host-bg cascade on both new routes | ⚠ implementor verifies |
| I-13 | Overlay-portal contract | ✅ no Sheets used here |
| DEC-071 | Frontend-first | ✅ no backend code |
| DEC-079 | Kit closure preserved | ✅ no new primitive (StatusBanner / formatGbp watch-points logged) |
| DEC-080 | TopSheet untouched | ✅ |
| DEC-081 | No mingla-web | ✅ |
| DEC-082 | Icon set unchanged | ✅ — `bank`, `chart`, `chevR`, `arrowL` already present |
| DEC-083 | Avatar primitive | ✅ unused here (no avatars on payments screens) |

**Carry-over hidden flaws:**
- **HF-1 (J-A8 polish)** — ConfirmDialog NOT portaled. Not exercised by J-A10/A11 (no confirms in this scope).
- **HF-2 (J-A8 polish)** — kit `./Modal` NOT portaled. Same — not exercised.

---

## 7. Fix Strategy (direction only — spec carries detail)

1. **Schema bump v7 → v8** — currentBrandStore.ts: add `BrandStripeStatus` enum, `BrandPayout`, `BrandRefund` types. Extend Brand with optional `stripeStatus`, `payouts`, `refunds`, `availableBalanceGbp`, `pendingBalanceGbp`, `lastPayoutAt`. Persist v7 → v8 passthrough.
2. **Stub data update** — brandList.ts: stripeStatus per brand (LM not_connected · TLL onboarding · SL active · HR restricted) + payouts/refunds spread per O-A10-7.
3. **Build BrandPaymentsView** — dashboard. Banner per state (inline composition; status-driven copy table). 3 KPI tiles via existing KpiTile primitive (Available / Pending / Last payout — formatted via inline `formatGbp`). Payouts list (visually inert rows). Refunds list (visually inert rows). Export Button (TRANSITIONAL Toast). Banner Connect/Finish/Resolve CTAs route to onboarding (or fire TRANSITIONAL for restricted's Stripe-dashboard link).
4. **Build BrandOnboardView** — onboarding shell. State machine: loading (1.5s simulated) → complete. Long-press header → failed visual. Done CTA on complete state mutates brand.stripeStatus from `not_connected`/`restricted` → `onboarding`, then calls onAfterDone (route navigates back to dashboard).
5. **Create dashboard route** — `app/brand/[id]/payments/index.tsx`. Format-agnostic ID + canvas.discover host-bg + onConnectStripe/onFinishOnboarding/onResolveRestricted/onExportReport handlers. handleBack via router.canGoBack.
6. **Create onboarding route** — `app/brand/[id]/payments/onboard.tsx`. Format-agnostic ID + canvas.discover. handleBack + handleAfterDone (mutates store, navigates back).
7. **Wire J-A7 BrandProfileView** — add `onStripe` + `onPayments` props. handleStripeBanner now calls `onStripe(brand.id)`. operationsRows[0].onPress now calls `onPayments(brand.id)`. Banner suppression when stripeStatus = `active`. Banner copy variant when stripeStatus = `onboarding` / `restricted`. Operations row sub-text dynamic per status. Remove 2 TRANSITIONAL Toasts.
8. **Wire route** — `app/brand/[id]/index.tsx` passes `handleOpenStripe` + `handleOpenPayments` handlers. Both navigate to `/brand/[id]/payments` (dashboard is the gateway; banner taps inside dashboard handle onboarding routing).

---

## 8. Regression Prevention

- **Operations row navigation pattern (continues)** — after J-A10 lands, BrandProfileViewProps will have `onEdit` (J-A8), `onTeam` (J-A9), `onPayments` + `onStripe` (J-A10). Future J-A12 adds `onReports`. Document in interface comment.
- **TRANSITIONAL marker churn** — J-A10 removes 2 markers from BrandProfileView (Stripe banner Toast + Operations row Toast) and adds new ones in BrandPaymentsView/BrandOnboardView. Net delta: ±0 to slightly positive (4 new − 2 removed = +2 net).
- **Status-banner pattern documented** — code comment in BrandPaymentsView calls out the status-driven copy table; future surfaces with similar banner patterns reference this comment.
- **Banner suppression discipline** — when stripeStatus = `active`, banner element is `null`. Implementor verifies no leftover spacing.
- **Persist version bump discipline** — same pattern as J-A7/A8/A9 (typed migration, header comment with version history).

---

## 9. Discoveries for Orchestrator

| ID | Description | Severity | Action |
|---|---|---|---|
| D-INV-A10-1 | Status-banner pattern (per-state copy + icon + color emphasis + CTA) inline composition. If Cycle 3+ surfaces a 3rd banner pattern (e.g., "Event publish gate failed"), candidate for `StatusBanner` kit primitive. | Info | Watch-point |
| D-INV-A10-2 | `formatGbp` inline helper duplicated (J-A7 + J-A11 + future J-A12). **THRESHOLD HIT (3+ uses).** Lift to `src/utils/formatGbp.ts` (or a `src/utils/currency.ts` covering Intl.NumberFormat + relative-time helpers together). | Info | Recommend Cycle-2-polish micro-slice OR bundle with J-A12 |
| D-INV-A10-3 | `formatRelativeTime` inline duplicated 3 places (J-A9 BrandTeamView + J-A9 BrandMemberDetailView + J-A11 payouts/refunds rows). **THRESHOLD HIT.** Same lift opportunity as D-INV-A10-2. | Info | Recommend Cycle-2-polish micro-slice |
| D-INV-A10-4 | Long-press dev gesture for failed state — purely TRANSITIONAL. Will retire when B2 wires real Stripe SDK that can fail naturally. | Info | Track for B2 cleanup |
| D-INV-A10-5 | Push notification "Stripe is ready" (per §6.3.3 step 5) deferred to B5 (OneSignal infrastructure). Cycle 2 stub doesn't simulate push. | Info | Track for B5 |
| D-INV-A10-6 | "Resolve" CTA on restricted banner deep-links to Stripe dashboard in B2; Cycle 2 fires TRANSITIONAL Toast. | Info | Track for B2 |
| D-INV-A10-7 | Real Stripe webhook flow (`onboarding` → `active` after Stripe completes verification) deferred to B2. Cycle 2 stub cannot advance past `onboarding`; smoke uses pre-seeded `active` brand to exercise that state. | Info | Spec calls this out explicitly |
| D-INV-A10-8 | Country support / KYC docs / "Identity verification incomplete" branches from §6.3.3 deferred to B2 (require real Stripe). | Info | Track for B2 |
| D-INV-A10-9 | DECISION_LOG slot ambiguity (memory references DEC-082 for Icon expansion but DECISION_LOG only has DEC-081 + DEC-083 written). Bookkeeping pass to retroactively write DEC-082 OR clean memory reference. | Info | Track for orchestrator bookkeeping |

---

## 10. Confidence

**HIGH.** Designer Handoff §5.3.7 + §5.3.8 + §6.3.3 read end-to-end; J-A7/A8/A9 patterns confirmed; KpiTile primitive contract verified (currency-aware); Brand schema gap quantified per-field; carve-outs from J-A6/J-A7/J-A8/J-A9 cross-referenced; kit primitive APIs verified (Button loading prop, GlassCard variants, KpiTile delta/sub, Pill error variant). Runtime verification deferred (greenfield, frontend-first).

---

## 11. Hand-off

Spec follows in `Mingla_Artifacts/specs/SPEC_ORCH-BIZ-CYCLE-2-J-A10_PAYMENTS_SHELL.md`. Both files referenced in chat reply for orchestrator REVIEW.

---

**End of J-A10 + J-A11 investigation.**
