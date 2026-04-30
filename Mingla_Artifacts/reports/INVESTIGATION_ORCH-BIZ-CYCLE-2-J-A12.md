# Investigation — J-A12 Finance Reports + Cycle-2 Polish Bundle (FINAL Cycle 2)

> **Mode:** Forensics INVESTIGATE-THEN-SPEC (greenfield spec preparation + utility lift)
> **Issue ID:** ORCH-BIZ-CYCLE-2-J-A12
> **Codebase:** `mingla-business/`
> **Predecessor:** J-A10/J-A11 CLOSE (commit `b117c39e`); orchestrator handoff lock-in (`0f309f89`)
> **Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_2_J_A12_FINANCE_REPORTS.md`
> **Auditor turn:** 2026-04-30
> **Confidence:** **High** — Designer Handoff context + DEC-067 + design package FinanceReportsScreen verbatim read at lines 363-441; J-A7..J-A11 patterns confirmed; D-INV-A10-2/3 watch-points verified at threshold; existing `mingla-business/src/utils/` directory verified (currently 2 files: hapticFeedback.ts + responsive.ts — clean precedent for adding currency.ts + relativeTime.ts)

---

## 1. Symptom Summary

Greenfield spec preparation. No bug. The J-A7 BrandProfileView Operations row #4 currently fires `[TRANSITIONAL]` Toast `"Finance reports land in J-A12."` (operationsRows useMemo). The J-A11 BrandPaymentsView Export Button currently fires `[TRANSITIONAL]` Toast `"Finance reports land in J-A12."` (handleExport closure). J-A12 builds the actual finance reports surface.

**Strategic note:** J-A12 is the **FINAL Cycle-2 journey** (per roadmap §3.1 line 87 + §5 line 271). After J-A12 closes, Cycle 2 is DONE → Cycle 3 (event creator wizard).

**Bundled in this dispatch (Cycle-2 polish):**
- Utility lift — `formatGbp` (D-INV-A10-2 watch-point THRESHOLD HIT; 2 inline copies in J-A7 + J-A11) and `formatRelativeTime` + `formatJoinedDate` (D-INV-A10-3; 3 inline copies across J-A9 BrandTeamView + J-A9 BrandMemberDetailView + J-A11 BrandPaymentsView). Cleanest path: lift before J-A12 adds 4th copy.
- 2 J-A7/J-A11 TRANSITIONAL Toasts retire (Operations row #4 + Export Button)

**Expected post-J-A12 state:**
- Tap J-A7 Operations row "Finance reports" → navigates to `/brand/[id]/payments/reports`
- Tap J-A11 Export Button → navigates to `/brand/[id]/payments/reports`
- Reports screen renders period switcher + headline KPI card + breakdown rows + top events list + exports list per Designer FinanceReportsScreen
- 4 stub brands cover all states: SL has full data (period filter changes values); HR has historical (restricted but readable); LM/TLL have empty state
- 5 callers of formatGbp / formatRelativeTime / formatJoinedDate import from `src/utils/` instead of defining inline

**Current state:**
- `app/brand/[id]/payments/reports.tsx` does not exist
- `Brand` type (v8) lacks `events` array field
- BrandProfileView's Operations row #4 + BrandPaymentsView's Export Button still closure-scoped to Toast
- 5 inline copies of currency / relative-time formatters across 4 component files

---

## 2. Investigation Manifest

| File | Layer | Read | Notes |
|---|---|---|---|
| Dispatch `FORENSICS_BIZ_CYCLE_2_J_A12_FINANCE_REPORTS.md` | Spec input | ✅ | 8 architectural decisions surfaced + bundle rationale (J-A12 + utility lift + 2 retires) |
| `INVESTIGATION_ORCH-BIZ-CYCLE-2-J-A10.md` + `IMPLEMENTATION_BIZ_CYCLE_2_J_A10_PAYMENTS_SHELL.md` | J-A10/A11 baseline | ✅ (session) | D-INV-A10-2/3 watch-points + Export Toast handler; status banner pattern |
| `SPEC_ORCH-BIZ-CYCLE-2-J-A10_PAYMENTS_SHELL.md` | J-A10/A11 spec | ✅ (session) | Stripe-active-vs-restricted access policy; deferred utility lift authorization |
| `SPEC_BIZ_FRONTEND_JOURNEY_BUILD_ROADMAP.md` §3.1 line 87 | Roadmap | ✅ | J-A12 = "View finance reports" · "/brand/:id/payments/reports" · "KPI bars + breakdown + top events + CSV export action (stub)" |
| `SPEC_BIZ_FRONTEND_JOURNEY_BUILD_ROADMAP.md` §4 line 239 | Component map | ✅ | J-A12 source = `screens-brand.jsx (FinanceReportsScreen)` · NEW per DEC-067 · finance KPIs + breakdown + top events |
| `Mingla_Artifacts/specs/SPEC_BIZ_DESIGN_ABSORPTION.md` | Design absorption | ✅ (line 461 + 472-473 + 695 + 707) | Verdict KEEP per DEC-067; "KPI bars, breakdown by source, top events, Stripe-ready CSV exports" |
| `Mingla_Artifacts/design-package/.../screens-brand.jsx` line 363-441 | **Authoritative design source** | ✅ verbatim | Full FinanceReportsScreen layout read end-to-end |
| `Mingla_Artifacts/DECISION_LOG.md` | DEC entries | ✅ (session) | DEC-067 KPI vocabulary · DEC-070 Q-A8 adopted · DEC-079 closure · DEC-083 Avatar precedent |
| `mingla-business/src/store/currentBrandStore.ts` | Schema v8 | ✅ (session) | Brand v8 has stripeStatus + payouts + refunds + balances; no events array |
| `mingla-business/src/store/brandList.ts` | Stub data | ✅ (session) | 4 brands with v8 fields; no per-event records |
| `mingla-business/src/components/brand/BrandProfileView.tsx` | Wiring point | ✅ (session) | Operations row #4 onPress fires `fireToast("Finance reports land in J-A12.")` at operationsRows useMemo |
| `mingla-business/src/components/brand/BrandPaymentsView.tsx` | Wiring point | ✅ (session) | handleExport closure fires `fireToast("Finance reports land in J-A12.")` |
| `mingla-business/src/utils/` | Existing utility dir | ✅ (verified ls) | Currently 2 files: `hapticFeedback.ts` + `responsive.ts`. Clean precedent for adding currency.ts + relativeTime.ts |
| `mingla-business/src/components/ui/KpiTile.tsx` | Kit primitive | ✅ (session) | Currency-aware contract (caller formats via Intl.NumberFormat) |
| `mingla-business/src/components/ui/Pill.tsx` | Kit primitive | ✅ (session, J-A11 W-2) | variants live/draft/warn/accent/error/info |
| `mingla-business/src/components/ui/Icon.tsx` | Kit primitive | ✅ (session, J-A11 W-1) | `download` icon present (line 18-94 — used in design package's IconChrome right-slot of FinanceReportsScreen TopBar); `receipt` present |

`npx tsc --noEmit` baseline clean (verified post-J-A11 commit `b117c39e`).

---

## 3. Findings (classified)

### 🔴 Root Causes — None (greenfield + planned refactor)

### 🟠 Contributing Factors — None

### 🟡 Hidden Flaws (spec MUST address)

#### H-A12-1 — Brand schema v8 lacks `events` array

- File: [`mingla-business/src/store/currentBrandStore.ts`](mingla-business/src/store/currentBrandStore.ts)
- Current Brand v8 has stripeStatus + payouts + refunds + balances + lastPayoutAt (J-A10 schema). No per-event revenue / soldCount / heldAt records.
- Designer FinanceReportsScreen (line 411-417) shows 4 ranked top events with title + sub ("284 sold · in person") + revenue formatted GBP. This data CAN'T be derived from existing payouts/refunds (payouts are aggregate transfers, not per-event).
- Roadmap line 239 lists J-A12 source as "finance KPIs + breakdown + top events" — top events list is required.
- **Spec mitigation:** schema bump v8 → v9 with additive `events?: BrandEventStub[]` field + new type:
  ```typescript
  export interface BrandEventStub {
    id: string;
    title: string;
    /** Revenue from this event in GBP whole-units (gross — before fees/refunds). */
    revenueGbp: number;
    soldCount: number;
    /**
     * Status drives the sub-text label: "in person" / "brunch series" /
     * "ended" / "upcoming" — matches design package §design line 413-416.
     */
    status: "upcoming" | "in_progress" | "ended";
    /** ISO 8601 — when the event was held (or scheduled). */
    heldAt: string;
    /**
     * Optional context blurb for the row sub-text (e.g., "in person",
     * "brunch series"). When undefined, derived from status+soldCount.
     */
    contextLabel?: string;
  }
  ```
  Persist v8 → v9 passthrough (events field starts undefined, defaulted to `[]` at read sites).

#### H-A12-2 — J-A7 Operations row #4 + J-A11 Export Button closure-scoped to Toast

- Files:
  - [`mingla-business/src/components/brand/BrandProfileView.tsx`](mingla-business/src/components/brand/BrandProfileView.tsx) — operationsRows[3].onPress fires `fireToast("Finance reports land in J-A12.")`
  - [`mingla-business/src/components/brand/BrandPaymentsView.tsx`](mingla-business/src/components/brand/BrandPaymentsView.tsx) — handleExport closure fires `fireToast("Finance reports land in J-A12.")`
- Both Toast handlers retire when J-A12 lands.
- **Spec mitigation:**
  - BrandProfileView: add `onReports: (brandId: string) => void` prop. Modify operationsRows[3].onPress to call `onReports(brand.id)`. Continues the J-A8 onEdit / J-A9 onTeam / J-A10 onStripe+onPayments / J-A12 onReports navigation prop chain.
  - BrandPaymentsView: add `onOpenReports: () => void` prop. Modify handleExport to call `onOpenReports()` directly. (Or: keep separate; the dashboard's Export and the Operations row #4 both go to the same destination.)
  - Route file `app/brand/[id]/index.tsx` passes `handleOpenReports` that does router.push to `/brand/[id]/payments/reports`.
  - Route file `app/brand/[id]/payments/index.tsx` passes the same handler.

#### H-A12-3 — Currency formatter duplication (D-INV-A10-2 THRESHOLD HIT)

- Verified inline copies of `formatGbp`:
  - `BrandProfileView.tsx` (J-A7 KPI strip — formatGbp + formatCount inline)
  - `BrandPaymentsView.tsx` (J-A11 — formatGbp inline)
- Both use identical Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 }) — pixel-equivalent.
- J-A12 BrandFinanceReportsView would add a 3rd inline copy.
- **Spec mitigation:** lift to `mingla-business/src/utils/currency.ts` exporting:
  ```typescript
  /** Format a numeric GBP value as locale-aware currency string. */
  export const formatGbp = (value: number): string => /* ... */;
  /** Format a numeric count with thousands separators. */
  export const formatCount = (value: number): string => /* ... */;
  ```
  Replace 2 existing inline copies + import directly in BrandFinanceReportsView. `formatCount` lifted alongside since it lives next to formatGbp in BrandProfileView.

#### H-A12-4 — Relative-time formatter duplication (D-INV-A10-3 THRESHOLD HIT)

- Verified inline copies of `formatRelativeTime`:
  - `BrandTeamView.tsx` (J-A9 — formatRelativeTime inline at line 70-86)
  - `BrandMemberDetailView.tsx` (J-A9 — formatRelativeTime + formatJoinedDate inline at line 75-93)
  - `BrandPaymentsView.tsx` (J-A11 — formatRelativeTime inline)
- All use identical algorithm (just-now / Nm / Nh / yesterday / Nd / Nw / Mmm d).
- J-A12 BrandFinanceReportsView would NOT directly use formatRelativeTime (no per-event timestamp display in main flow), but the lift makes future J-* reuse cleaner.
- **Spec mitigation:** lift to `mingla-business/src/utils/relativeTime.ts` exporting:
  ```typescript
  /** Format an ISO timestamp as "just now" / "5m ago" / "3h ago" / etc. */
  export const formatRelativeTime = (iso: string): string => /* ... */;
  /** Format an ISO timestamp as "Mmm yyyy" (e.g., "Jul 2025"). */
  export const formatJoinedDate = (iso: string): string => /* ... */;
  ```
  Replace 3 existing inline copies (`formatRelativeTime`) + 1 (`formatJoinedDate`).

#### H-A12-5 — Period switcher state + filtering logic

- Designer FinanceReportsScreen (line 374-382) shows 5 period buttons: 7d / 30d / 90d / YTD / All. Default selected: 30d.
- Cycle 2 stub data is point-in-time (events have heldAt timestamps; no time-decay). Filtering means: for each period, sum revenueGbp of events whose heldAt falls within the period.
- For "YTD" — year-to-date from Jan 1 of current year. For "All" — no filter.
- **Spec mitigation:** local component state `period: TimeRange = "30d" | "7d" | "90d" | "ytd" | "all"`. `useMemo` derives filtered events based on period. Headline values computed from filtered set:
  - **Net revenue** = gross − refunds − Mingla fee (2% + £0.30/event) − Stripe processing (1.5% + £0.20)
  - **Gross sales** = sum of filtered events' revenueGbp
  - **Refunds** = sum of refunds where refundedAt falls within period
  - **Mingla fee** = 2% × gross + £0.30 × count of filtered events with revenueGbp > 0
  - **Stripe processing** = 1.5% × gross + £0.20 × count of filtered events with revenueGbp > 0
  - **Net to bank** = gross − refunds − Mingla fee − Stripe processing
  - All values formatted via lifted `formatGbp`.
  Note: fees calculated client-side stubbed; B2 wires real Stripe/Mingla fee data.

#### H-A12-6 — Headline sparkline visual

- Designer FinanceReportsScreen (line 391-397) shows a 30-bar sparkline with conditional coloring (last 5 bars accent, others muted) representing daily revenue.
- Cycle 2 stub has no daily revenue data; events are sparse.
- **Spec mitigation:** generate the sparkline data deterministically per brand from the filtered events:
  - Distribute revenueGbp evenly across `period` days (or use heldAt to bucket if events fall in the period)
  - For "30d", 30 bars; for "7d", 7 bars; for "90d", 30 bars (compress); for "ytd"/"all", 30 bars
  - Last 5 bars use accent.warm gradient; earlier bars use rgba(255,255,255,0.16) per design
  - Empty brands (LM, TLL): all bars at 0% height — render as faint baseline only OR omit sparkline entirely
- Recommendation: omit sparkline entirely when filtered events are empty (cleaner empty state).

#### H-A12-7 — Breakdown card with negative values

- Designer FinanceReportsScreen (line 402-408) shows 5 rows:
  - Gross sales · £20,420.00
  - Refunds · −£480.00 (tone="accent" = warm orange)
  - Mingla fee (2% + £0.30) · −£612.40 (tone implied — destructive or muted)
  - Stripe processing · −£607.20
  - Net to bank · £18,720.40 (last row, emphasized)
- **Spec mitigation:** 5-row table inline (no kit primitive). Negative values rendered with `−` prefix per Constitution #10. Last row "Net to bank" emphasized via separator line above + bolder text. All amounts formatted via lifted `formatGbp`.

#### H-A12-8 — Top events ranked list

- Designer FinanceReportsScreen (line 411-417) shows 4 ranked rows. Layout:
  - Title (medium weight, ellipsis on overflow)
  - Sub-text ("284 sold · in person")
  - Right-aligned amount (mono-style, bold)
- **Spec mitigation:** sort filtered events by `revenueGbp` DESC. Render up to top 5. Each row: title + `{soldCount} sold · {contextLabel ?? statusLabel}` + formatted GBP amount. No rank pill (design doesn't show one — just descending order). Visually inert (B2 wires per-event drill-in detail screen).

#### H-A12-9 — Exports list (3 row stub)

- Designer FinanceReportsScreen (line 420-425) shows 3 rows:
  - Stripe payouts CSV · "For Xero / QuickBooks"
  - Tax-ready (UK VAT) · "Quarterly summary"
  - All transactions · "Itemised CSV"
- All 3 rows fire TRANSITIONAL Toast "{label} export lands in B2." per row label. Row icons all `receipt` per design.
- **Spec mitigation:** 3-row Pressable list in GlassCard. Each row's onPress fires the per-row TRANSITIONAL Toast.

#### H-A12-10 — Restricted-state access policy

- HR is restricted (per J-A11 schema) but has 1 historical payout (£88).
- §5.3.7 says restricted state limits PAYOUTS, not history viewing.
- **Spec mitigation:** finance reports accessible to ALL stripe states (including restricted). For restricted, show small banner at top "Stripe restricted — historical only" + same content below. Empty brands (LM not_connected, TLL onboarding) show empty state copy.

#### H-A12-11 — Host-bg cascade (I-12)

- New route: `app/brand/[id]/payments/reports.tsx` lives outside `(tabs)/` → DOES NOT inherit canvas.discover from tabs layout
- **Spec mitigation:** route file MUST set `backgroundColor: canvas.discover` on host View. Code comment references invariant I-12.

#### H-A12-12 — Format-agnostic ID resolver (I-11)

- Same `[id]` segment pattern as J-A7..J-A11
- **Spec mitigation:** route uses `useLocalSearchParams<{id: string | string[]}>()` + `find((b) => b.id === idParam) ?? null` — same pattern.

### 🔵 Observations

#### O-A12-1 — TopBar right-slot uses `download` IconChrome per design

- Design line 367: `<TopBar leftKind="back" onBack={onBack} title="Finance" right={<IconChrome icon="download"/>}/>`
- Cycle 2 IconChrome primitive should support a download icon. Verify icon name presence (`download` confirmed in IconName union per Icon.tsx grep — "download" line 71).
- Tap on download IconChrome: where does it go? Per design intent, likely opens Exports section / triggers default export. **Recommendation:** scroll to Exports section anchor (cleanest no-Toast UX) OR fire a generic "Export options open" Toast — defer to spec.

#### O-A12-2 — Mono font class for headline value + amounts

- Design uses `className="mono"` on the £18,720.40 headline value + top event amounts.
- Mingla designSystem.ts likely has no `monoFontFamily` token (kit closure rule). Use `typography.statValue` (KpiTile's value style) OR `typography.h2` for the headline; use `typography.body` with fontWeight 700 for top event amounts.
- **Recommendation:** statValue for headline (already used on KpiTile), body 700 for amounts. Visually consistent with rest of payments dashboard.

#### O-A12-3 — Cycle-2 closure summary section

- This is the LAST Cycle-2 dispatch. Spec should include an explicit "Cycle 2 Closure" section enumerating:
  - All 7 journeys done (J-A6 audit · J-A7 view · J-A8 edit · J-A9 team · J-A10/A11 payments shell · J-A12 reports)
  - All schema bumps (v3 J-A7 · v4 J-A8 · v5+v6 polish · v7 J-A9 · v8 J-A10 · v9 J-A12)
  - Avatar carve-out (DEC-083) · Icon expansion (DEC-082 implicit) · TopSheet (DEC-080)
  - Watch-points retired in this dispatch (D-INV-A10-2/3) and what stays (D-INV-A10-1 StatusBanner; D-INV-A9-3 Avatar shipped; D-INV-A9-4 TextArea still 2 uses; D-INV-A9-5 relativeTime shipped via this lift; D-INV-A9-6 FAB still 1 use)
  - 11 TRANSITIONAL markers retired across J-A8/A9/A10/A12 cycles
  - What's deferred to Cycle 3 (event creator) and B1+ (backend)

#### O-A12-4 — Stub events distribution per brand

Per H-A12-1 + H-A12-7 spec needs:
- **Sunday Languor (active):** 4 events with realistic revenue
  - "Slow Burn vol. 4" — 284 sold, £8,420, ended, "in person", heldAt: 2026-04-26
  - "Sunday Languor — March brunches" — 248 sold, £5,420, ended, "brunch series", heldAt: 2026-03-30
  - "A Long Sit-Down" — 32 sold, £1,920, upcoming, undefined, heldAt: 2026-05-15
  - "Slow Burn vol. 3" — 392 sold, £2,960, ended, undefined, heldAt: 2026-03-15
- **Hidden Rooms (restricted):** 1 historical event
  - "Hidden Rooms — Studio" — 50 sold, £88, ended, undefined, heldAt: 2026-04-09
- **Lonely Moth (not_connected):** 0 events (empty state)
- **The Long Lunch (onboarding):** 0 events (empty state)

(Note: SL had `stats.events: 6` in J-A7 baseline. The events array doesn't need to match that count — `stats.events` is a separate aggregate counter; events array is just the recent ones.)

#### O-A12-5 — Default period selection

- Design shows 30d as default highlighted.
- Cycle 2: default period = "30d" matches design intent. Local state initialized to "30d".

#### O-A12-6 — Empty state copy variations

- Default empty (LM/TLL): "No data yet" / "Finance reports populate after your first event sells tickets."
- Restricted empty (theoretical: HR if all events outside selected period): "No data in this period" / "Try a different time range."
- Recommendation: keep both states distinct; spec calls them out.

#### O-A12-7 — TopBar download IconChrome onPress

- Per O-A12-1: scroll to Exports OR fire a Toast.
- **Recommendation:** make it inert (no onPress wired) for Cycle 2. The 3 Export rows below ARE the export affordance. The download icon is purely visual / future-Stripe-quick-export anchor.
- Alternative: fire TRANSITIONAL Toast "Quick export lands in B2." — also acceptable.
- Spec locks: inert (no onPress) — cleanest.

### Security findings — None

(No new tables in this dispatch — Brand schema additive only. No edge functions. No new RLS surface.)

---

## 4. Five-Layer Cross-Check

| Layer | Truth |
|---|---|
| **Docs (handoff §design FinanceReportsScreen line 363-441)** | Period switcher (5) · headline (net + delta + sparkline) · breakdown (5 rows) · top events · exports (3 rows) |
| **Docs (roadmap §3.1 line 87)** | "View finance reports" · "/brand/:id/payments/reports" · "KPI bars + breakdown + top events + CSV export action (stub)" |
| **Docs (roadmap §4 line 239)** | NEW per DEC-067 · finance KPIs + breakdown + top events |
| **Docs (DEC-067 + DEC-070 Q-A8)** | KEEP verdict; KPI vocabulary adopted |
| **Schema** | Brand v8 lacks events array; additive v9 migration required (H-A12-1) |
| **Code** | J-A7 Operations row #4 + J-A11 Export Button closure-scoped to Toast (H-A12-2) |
| **Runtime** | N/A |
| **Data** | AsyncStorage v8 → v9 passthrough |

**Layer agreement:** all docs (handoff design + roadmap + design absorption + DEC-067) align. Design package source code provides the most precise implementation contract — spec lifts the layout 1:1 with Mingla kit primitives.

---

## 5. Blast Radius

J-A12 + Cycle-2 polish bundle ships:

| Surface | Change |
|---|---|
| `app/brand/[id]/payments/reports.tsx` (NEW) | Reports route |
| `src/components/brand/BrandFinanceReportsView.tsx` (NEW) | Finance reports composition |
| `src/utils/currency.ts` (NEW) | formatGbp + formatCount lifted utility |
| `src/utils/relativeTime.ts` (NEW) | formatRelativeTime + formatJoinedDate lifted utility |
| `src/store/currentBrandStore.ts` (MOD) | Brand v8 → v9 + new BrandEventStub type |
| `src/store/brandList.ts` (MOD) | 4 stubs gain `events` array per O-A12-4 |
| `src/components/brand/BrandProfileView.tsx` (MOD) | Add `onReports` prop · Operations row #4 navigates · `formatGbp` + `formatCount` imports replace inline · 1 TRANSITIONAL Toast retired |
| `src/components/brand/BrandPaymentsView.tsx` (MOD) | Add `onOpenReports` prop · handleExport navigates instead of Toast · `formatGbp` + `formatRelativeTime` imports replace inline · 1 TRANSITIONAL Toast retired |
| `src/components/brand/BrandTeamView.tsx` (MOD) | `formatRelativeTime` import replaces inline |
| `src/components/brand/BrandMemberDetailView.tsx` (MOD) | `formatRelativeTime` + `formatJoinedDate` imports replace inline |
| `app/brand/[id]/index.tsx` (MOD) | Pass `handleOpenReports` handler |
| `app/brand/[id]/payments/index.tsx` (MOD) | Pass `handleOpenReports` handler |

**Total:** 12 files (4 new + 8 modified). Larger than typical due to utility-lift fan-out across 5 component callers.

**Other Cycle-2 surfaces (no changes):**
- BrandEditView · BrandInviteSheet · BrandMemberDetailView (only formatRelativeTime/formatJoinedDate touched) · RolePickerSheet · BrandOnboardView · Avatar · all kit primitives — unchanged

---

## 6. Invariant Check (preview — full list in spec)

| ID | Risk | Status |
|---|---|---|
| I-1 | designSystem.ts not modified | ✅ preserved |
| I-3 | iOS / Android / web execute | ✅ |
| I-4 | No `app-mobile/` imports | ✅ |
| I-6 | tsc strict — explicit return types | ⚠ implementor verifies |
| I-7 | TRANSITIONAL markers labeled | ⚠ 4 new (3 export Toasts × per-row + 1 events-stub-array note) − 2 retired = +2 net |
| I-9 | No animation timings | ✅ |
| I-11 | Format-agnostic ID resolver | ⚠ implementor verifies |
| I-12 | Host-bg cascade on new route | ⚠ implementor verifies |
| I-13 | Overlay-portal contract | ✅ no overlays in scope |
| DEC-071 | Frontend-first | ✅ no backend code |
| DEC-079 | Kit closure preserved | ✅ formatGbp + formatRelativeTime lifted to utils (NOT new primitives — utility functions live outside kit per existing precedent of hapticFeedback.ts + responsive.ts) |
| DEC-080 | TopSheet untouched | ✅ |
| DEC-081 | No mingla-web | ✅ |
| DEC-082 | Icon set unchanged — `download` + `receipt` already present | ✅ |
| DEC-083 | Avatar primitive | ✅ unused here |
| **Constitution #10 currency-aware** | ⚠ ALL currency rendering goes through lifted `formatGbp` — single source of truth |

**Carry-over hidden flaws:** HF-1/HF-2 not exercised (no ConfirmDialog / Sheet in scope).

---

## 7. Fix Strategy (direction only — spec carries detail)

1. **Lift utilities first** — create `src/utils/currency.ts` + `src/utils/relativeTime.ts`; replace 5 inline copies across 4 component files. tsc clean after migration.
2. **Schema bump v8 → v9** — add `BrandEventStub` type + `events?: BrandEventStub[]` to Brand. Persist v8 → v9 passthrough.
3. **Stub data** — add events arrays to 4 brands per O-A12-4.
4. **Build BrandFinanceReportsView** — period switcher + headline (net + delta + sparkline) + breakdown (5 rows) + top events (top 5) + exports (3 rows). Inline composition for sparkline + breakdown table + top event row + export row (each ~30-40 lines, all candidate kit-primitive watch-points but single-use this cycle).
5. **Create reports route** — `app/brand/[id]/payments/reports.tsx`. Format-agnostic ID + canvas.discover.
6. **Wire J-A7 Operations row #4** — modify BrandProfileView.tsx: add `onReports` prop, replace Toast Toast with `onReports(brand.id)` call, remove TRANSITIONAL marker line.
7. **Wire J-A11 Export Button** — modify BrandPaymentsView.tsx: add `onOpenReports` prop, replace handleExport's Toast with `onOpenReports()` call.
8. **Wire route handlers** — modify `app/brand/[id]/index.tsx` (pass onReports) + `app/brand/[id]/payments/index.tsx` (pass onOpenReports). Both push to `/brand/[id]/payments/reports`.
9. **tsc check** after every step.
10. **Implementation report** with Cycle-2 closure summary section.

---

## 8. Regression Prevention

- **Utility-lift completeness check** — implementor verifies via grep that all 5 inline `formatGbp` / `formatRelativeTime` / `formatJoinedDate` blocks are gone from the 4 modified files; only imports remain. Prevents drift where one consumer was missed.
- **Constitution #10 single-source enforcement** — code comment in `src/utils/currency.ts`: "ALL GBP rendering across mingla-business MUST import from here. Inline `Intl.NumberFormat` calls are forbidden post-Cycle-2 — use `formatGbp` from this util."
- **BrandProfileViewProps growing prop set documented** — interface comment lists 5 navigation props (onEdit · onTeam · onStripe · onPayments · onReports). After J-A12 closes, the navigation chain is complete for Cycle 2. Cycle 3 (event creator) introduces NEW props for event navigation — pattern continues.
- **Status-driven banner config record pattern (carryover from J-A10)** — already documented; reports screen uses simpler period state machine, no banner pattern reuse.
- **TRANSITIONAL marker churn** — net delta projection: +4 (3 export Toasts × per row + 1 events-stub-array note) − 2 retired (J-A7 ops row #4 + J-A11 export button) = +2 net.
- **Persist version bump discipline** — same pattern as J-A7..J-A11; header comment with v9 entry + passthrough migration.

---

## 9. Discoveries for Orchestrator

| ID | Description | Severity | Action |
|---|---|---|---|
| D-INV-A12-1 | Sparkline visual is 1 inline use here. If 2+ more surfaces want time-series visuals (Cycle 3 event detail dashboard, admin analytics), candidate for `Sparkline` kit primitive. | Info | Watch-point |
| D-INV-A12-2 | Period switcher (segmented control) is 1 inline use here. If 2+ more surfaces (events list filter, scanner activity time filter), candidate for `SegmentedControl` kit primitive. | Info | Watch-point |
| D-INV-A12-3 | Breakdown table (label + amount rows with last-row emphasis) is 1 inline use. If 2+ more (Tax breakdown, Subscription invoice), candidate for `BreakdownTable` kit primitive. | Info | Watch-point |
| D-INV-A12-4 | Constitution #10 enforcement opportunity — after this lift, consider adding a CI gate that greps `Intl.NumberFormat.*currency` outside `src/utils/currency.ts` and fails. Prevents regression. | Info | Process improvement; track for Cycle 3+ if drift recurs |
| D-INV-A12-5 | Mingla fee + Stripe processing rates are hard-coded (2% + £0.30 / 1.5% + £0.20). B2 should expose these via Brand schema or a global config when real Stripe is wired. | Info | Track for B2 |
| D-INV-A12-6 | Spark sparkline data is deterministically derived from filtered events — not a real per-day time series. B2 should populate per-day buckets from real Stripe transaction data. | Info | Track for B2 |
| D-INV-A12-7 | Cycle-2 closure summary belongs in the spec; J-A12 implementation report should mark Cycle 2 DONE and announce Cycle 3 (event creator wizard) as the next cycle. | Info | Spec includes "Cycle 2 Closure" section |
| D-INV-A12-8 | DEC-082 slot ambiguity (memory references DEC-082 for Icon expansion but DECISION_LOG only has DEC-081 + DEC-083 written). Carry-over from D-IMPL-AVATAR-1. | Info | Bookkeeping pass — could close as part of Cycle-2 wrap-up artifact sweep |

---

## 10. Confidence

**HIGH.** Designer FinanceReportsScreen read line-by-line at lines 363-441; all 9 visual sections quantified (TopBar · period switcher · headline card with sparkline · breakdown · top events · exports); 4 invariants confirmed (I-11, I-12, DEC-079, Constitution #10); J-A11 wiring points (Export Toast handler) located at code line; D-INV-A10-2/3 watch-points verified at threshold (5 inline copies across 4 files). Runtime verification deferred (greenfield, frontend-first).

---

## 11. Hand-off

Spec follows in `Mingla_Artifacts/specs/SPEC_ORCH-BIZ-CYCLE-2-J-A12_FINANCE_REPORTS.md`. Both files referenced in chat reply for orchestrator REVIEW. **This is the FINAL Cycle-2 dispatch — spec includes Cycle-2 closure section.**

---

**End of J-A12 + Cycle-2 polish bundle investigation.**
