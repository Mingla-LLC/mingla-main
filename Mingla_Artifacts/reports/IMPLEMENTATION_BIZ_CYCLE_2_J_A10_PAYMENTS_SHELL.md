# Implementation Report — BIZ Cycle 2 J-A10 + J-A11 Payments Shell

**ORCH-ID:** ORCH-BIZ-CYCLE-2-J-A10
**Cycle:** 2 (Brands)
**Journeys:** J-A10 — Stripe Connect onboarding (UI shell) + J-A11 — View brand payments
**Codebase:** `mingla-business/`
**Predecessor commit:** `f39b5220` (J-A10 forensics handoff merge) → `c947c292` (Avatar carve-out CLOSE)
**Spec:** [SPEC_ORCH-BIZ-CYCLE-2-J-A10_PAYMENTS_SHELL.md](Mingla_Artifacts/specs/SPEC_ORCH-BIZ-CYCLE-2-J-A10_PAYMENTS_SHELL.md)
**Investigation:** [INVESTIGATION_ORCH-BIZ-CYCLE-2-J-A10.md](Mingla_Artifacts/reports/INVESTIGATION_ORCH-BIZ-CYCLE-2-J-A10.md)
**Dispatch:** [IMPL_BIZ_CYCLE_2_J_A10_PAYMENTS_SHELL.md](Mingla_Artifacts/prompts/IMPL_BIZ_CYCLE_2_J_A10_PAYMENTS_SHELL.md)
**Implementor turn:** 2026-04-30

---

## 1. Summary

Implemented J-A10 + J-A11 payments shell in mingla-business per spec — 4 NEW files (BrandPaymentsView · BrandOnboardView · 2 routes) + 4 MOD (currentBrandStore v7→v8 schema · brandList stub data · BrandProfileView with onStripe+onPayments wiring · `[id]/index.tsx` route handlers). All 18 implementation steps completed verbatim per spec §7. tsc strict exits 0 after every step (8 successive checkpoints). **Status: implemented, partially verified** (mechanical PASS; visual + interaction states require operator device smoke per spec T-A10-01..38). **Confidence: H** for code correctness; visual fidelity awaits operator confirmation.

---

## 2. Pre-flight gate results

### G-1 — Working tree state ✅
- Branch: `Seth` (canonical)
- HEAD before work: `f39b5220` (J-A10 forensics handoff merge)
- Dirty files at start: `Mingla_Artifacts/AGENT_HANDOFFS.md` (orchestrator) + `supabase/.temp/*` (untracked, ignored) + 3 J-A10 forensics artifacts (untracked, expected)
- No `mingla-business/` files dirty at start — clean baseline.

### G-2 — TypeScript baseline ✅
- `cd mingla-business && npx tsc --noEmit` → exit 0 at start
- 8 successive checkpoints (after each major step) all exit 0
- Final: exit 0

### G-3 — Required reads ✅
All files in dispatch G-3 list confirmed in session context: spec + investigation + currentBrandStore.ts (v7) + brandList.ts (4 stubs) + BrandProfileView.tsx (handleStripeBanner closure + operationsRows useMemo) + BrandTeamView.tsx (formatRelativeTime pattern reference) + Pill.tsx (variants confirmed) + KpiTile.tsx (currency-aware contract verified) + Spinner.tsx (size 24/36/48 confirmed exists).

### G-4 — Watch-point resolutions

#### W-1: `alert` icon
**Spec proposed:** `alert` icon (or `info` fallback).
**Actual kit:** Neither `alert` nor `info` exists in IconName union (verified by grep on Icon.tsx line 17-94).
**Resolution:** Used `flag` icon — represents "action needed" semantically and pairs naturally with `semantic.error` color emphasis on the restricted banner + onboarding-failed state. Documented in BrandPaymentsView BANNER_CONFIG comment + BrandOnboardView failed-state comment.

#### W-2: Pill variant for "PAID" payout status
**Spec recommended:** `live` (green dot — money safely landed).
**Resolution:** Used `live`. Money landing IS a positive event; the live variant's green dot reads as success without being celebratory. `info` for in_transit. `error` for failed.

#### W-3: `Spinner` primitive
**Spec asked:** verify exists or fall back to ActivityIndicator.
**Resolution:** Spinner primitive EXISTS at [src/components/ui/Spinner.tsx](mingla-business/src/components/ui/Spinner.tsx) with sizes 24 | 36 | 48 + accent.warm default color. Used `<Spinner size={48} color={accent.warm} />` in onboarding loading state.

#### W-4: `check` icon
**Confirmed present** (used by RolePickerSheet on J-A9; Icon.tsx:128). Used in BrandOnboardView "complete" state success circle.

### G-5 — TRANSITIONAL inventory

**Baseline (pre-coding):** 33 markers across 13 files (confirmed end of Avatar carve-out close).
**Post-coding:** 40 markers across 15 files.
**Delta:** **+7** (vs spec-projected +3).

Reason for higher delta: new files (BrandOnboardView + BrandPaymentsView) have header docstrings that mention TRANSITIONAL semantics PLUS individual inline markers; brandList.ts header comment added "are deliberately TRANSITIONAL" line. Constitution #7 only requires labeling, not minimum count — all 7 net new markers are properly exit-conditioned (B1/B2/J-A12). No process violation.

Detailed accounting in §8.

---

## 3. Files changed (Old → New receipts)

### `mingla-business/src/store/currentBrandStore.ts` — MODIFIED
**Lines:** +90 / -3 / net +87
**What it did before:** v7 schema with `BrandRole`, `BrandMemberRole`, `InviteRole`, `BrandMember`, `BrandInvitation` types. Brand type carrying through `members?` + `pendingInvitations?` (J-A9 schema). Persist name `mingla-business.currentBrand.v7`, version 7.
**What it does now:** Adds 4 new types: `BrandStripeStatus` (4-tuple), `BrandPayoutStatus` (3-tuple), `BrandPayout` interface, `BrandRefund` interface (per spec §3.1 verbatim). Brand type extended with optional `stripeStatus`, `availableBalanceGbp`, `pendingBalanceGbp`, `lastPayoutAt`, `payouts`, `refunds`. Persist bumped to v8 with passthrough migration (v3→v4→v5→v6→v7→v8 all passthrough; new fields default at read sites: stripeStatus → "not_connected", balances → 0, payouts/refunds → [], lastPayoutAt → undefined). Header comment extended with v8 entry.
**Why:** Spec §3.1 schema requirements (AC#20 persist v7→v8 migration; types underpin all J-A10 components).

### `mingla-business/src/store/brandList.ts` — MODIFIED
**Lines:** +35 / -0 / net +35
**What it did before:** 4 stubs (lm, tll, sl, hr) with v7 fields (members + pendingInvitations).
**What it does now:** Each stub gains stripe state + balances + payouts + refunds per spec §3.2 verbatim. Coverage:
- LM: not_connected, all £0/empty
- TLL: onboarding, all £0/empty
- SL: active, £156.20 available + £45.60 pending + lastPayoutAt + 4 payouts (in_transit + 3 paid) + 2 refunds (with reason on 1)
- HR: restricted, £0/£0/£88 historical (1 paid payout 2026-04-09)
Header comment extended with v8 entry + coverage summary.
**Why:** Spec §3.2 stub data; AC#6-9 (4 banner state coverage) + AC#11 (active populated) + AC#26 (relative-time formatting).

### `mingla-business/src/components/brand/BrandPaymentsView.tsx` — NEW
**Lines:** +485
**What it does:** Payments dashboard composition. Inline `formatGbp` (Intl.NumberFormat en-GB) + `formatRelativeTime` (duplicated from J-A9 with TRANSITIONAL comments noting D-INV-A10-2/3 watch-point threshold hits). `BANNER_CONFIG: Record<BrandStripeStatus, BannerConfig | null>` table with status-driven copy/icon/CTA — `null` entry for `active` SUPPRESSES the banner entirely. `PAYOUT_PILL_VARIANT` + `PAYOUT_STATUS_LABEL` records for payout row pills. Section structure: TopBar back nav · status banner (when not null) · 3 KPI tiles (Available + Pending + Last payout) · Recent payouts (with empty-state card + visually-inert rows + status pills) · Recent refunds (entire section skipped when empty; refund amount prefixed with `−` on render) · Export Button. Toast at View root for Resolve + Export TRANSITIONAL feedback. Not-found state fallback.
**Why:** Spec §3.5 + AC#6-12, AC#15-16, AC#27, AC#28.

### `mingla-business/src/components/brand/BrandOnboardView.tsx` — NEW
**Lines:** +275
**What it does:** Stripe Connect onboarding shell with state machine (`OnboardingState = "loading" | "complete" | "failed"`). Auto-advances loading → complete after `SIMULATED_LOADING_MS = 1500`. Custom TopBar (Cancel ghost left + long-pressable centered title + empty right) — composed inline because kit TopBar primitive doesn't support long-press on title. Long-press header `delayLongPress={500}` flips state ↔ failed (TRANSITIONAL dev gesture). Loading state: Spinner size 48 + h3 title + TRANSITIONAL "real WebView in B2" sub. Complete state: 64px accent.warm circle with check icon + h2 "Onboarding submitted" + body + Done Button. Failed state: 64px semantic.error circle with `flag` icon (W-1 fallback) + h2 "Onboarding couldn't complete" + Try again + Cancel Buttons. Not-found fallback.
**Why:** Spec §3.6 + AC#13-18.

### `mingla-business/app/brand/[id]/payments/index.tsx` — NEW
**Lines:** +57
**What it does:** Dashboard route. Format-agnostic ID resolver (I-11). canvas.discover host-bg (I-12). handleBack with router.canGoBack guard. handleOpenOnboard pushes to `/brand/[id]/payments/onboard`.
**Why:** Spec §3.3.

### `mingla-business/app/brand/[id]/payments/onboard.tsx` — NEW
**Lines:** +75
**What it does:** Onboarding route. Format-agnostic resolver. canvas.discover. handleBack falls through `router.canGoBack` → `/brand/[id]/payments` → `/(tabs)/account`. handleAfterDone mutates `setBrands` to set `stripeStatus: "onboarding"` + mirrors to currentBrand if active + handleBack. Comment notes stub flow cannot reach "active" — only B2 webhooks advance to active.
**Why:** Spec §3.4 + AC#15.

### `mingla-business/src/components/brand/BrandProfileView.tsx` — MODIFIED
**Lines:** +60 / -25 / net +35
**What it did before:** `BrandProfileViewProps` had `onEdit` + `onTeam`. Always-on Stripe banner JSX (lines 327-345 — always rendered "Connect Stripe to sell tickets" + chevR). `handleStripeBanner` closure-scoped to TRANSITIONAL Toast `"Stripe Connect lands in J-A10."`. Operations row #1 in operationsRows useMemo with static sub `"Not connected"` and onPress firing TRANSITIONAL Toast `"Stripe Connect lands in J-A10."`. Comment block above banner: `{/* [TRANSITIONAL] always-on banner — replaced by stripe-state-driven banner in J-A10. */}`. Comment above handleStripeBanner: `// [TRANSITIONAL] Stripe banner — exit when Brand.stripeStatus field lands (J-A10).`
**What it does now:** `BrandProfileViewProps` adds `onStripe: (brandId) => void` + `onPayments: (brandId) => void` (4 navigation props now: onEdit + onTeam + onStripe + onPayments). Pattern note in interface comment updated to reflect chain. Status-driven banner via `J_A7_BANNER_COPY: Record<BrandStripeStatus, {title, sub} | null>` record — `null` entry for `active` SUPPRESSES banner entirely. Banner JSX wrapped in IIFE; renders nothing when bannerCopy === null; otherwise renders with status-aware icon color (`semantic.error` for restricted, `accent.warm` otherwise) + destructive border styling. `handleStripeBanner` calls `onStripe(brand.id)` (no Toast). Operations row #1 sub-text dynamic via `OPERATIONS_SUB_TEXT[stripeStatus]` ("Not connected" / "Onboarding…" / "Active" / "Action required"). Operations row #1 onPress calls `onPayments(brand.id)` (no Toast). 2 TRANSITIONAL comments REMOVED. Added `bannerDestructive` + `bannerIconWrapDestructive` styles + import `semantic` from designSystem + import `BrandStripeStatus` type.
**Why:** Spec §3.7 + AC#1-5.

### `mingla-business/app/brand/[id]/index.tsx` — MODIFIED
**Lines:** +14 / -2 / net +12
**What it did before:** `handleOpenEdit` + `handleOpenTeam` handlers. BrandProfileView with `onBack` + `onEdit` + `onTeam` props.
**What it does now:** Adds `handleOpenStripe` + `handleOpenPayments` handlers (both push to `/brand/${id}/payments` per spec §3.8 — banner taps inside dashboard handle onboarding routing). BrandProfileView gains `onStripe` + `onPayments` props. Comment notes the design choice (avoid deep-linking straight to onboarding without context).
**Why:** Spec §3.8 + AC#1-2.

---

## 4. Spec traceability — AC#1..28 verification

| AC | Verification mechanism | Status |
|---|---|---|
| AC#1 J-A7 banner navigates | Code: handleStripeBanner → onStripe(brand.id); index.tsx pushes /payments | ✅ READY |
| AC#2 J-A7 Operations row navigates | Code: operationsRows[0].onPress → onPayments(brand.id) | ✅ READY |
| AC#3 Operations row sub-text dynamic | Code: OPERATIONS_SUB_TEXT[stripeStatus] | ✅ READY |
| AC#4 Banner SUPPRESSED when active | Code: J_A7_BANNER_COPY.active = null; IIFE returns null | ✅ READY |
| AC#5 Banner restricted styling | Code: bannerDestructive style with rgba(239,68,68,0.45) border | ✅ READY |
| AC#6 LM not_connected layout | Stub data not_connected + Connect banner + £0 KPIs + empty payouts + no refunds + Export | ✅ READY |
| AC#7 TLL onboarding layout | Stub data onboarding + Verifying banner + £0 KPIs + empty | ✅ READY |
| AC#8 SL active layout | Stub data active + NO banner + £156.20/£45.60/£156.20 KPIs + 4 payouts + 2 refunds | ✅ READY |
| AC#9 HR restricted layout | Stub data restricted + red banner + £0/£0/£88 KPIs + 1 payout + no refunds | ✅ READY |
| AC#10 Connect/Finish navigates | Code: bannerConfig.ctaAction === "open_onboard" → onOpenOnboard | ✅ READY |
| AC#11 Resolve fires Toast | Code: handleResolveBanner → fireToast("Stripe support lands in B2.") | ✅ READY |
| AC#12 Export fires Toast | Code: handleExport → fireToast("Finance reports land in J-A12.") | ✅ READY |
| AC#13 Onboarding loading state | Code: state="loading" → Spinner + title + TRANSITIONAL sub | ✅ READY |
| AC#14 Onboarding complete state | Code: state="complete" → check circle + Done Button | ✅ READY |
| AC#15 Done mutates store | Code: handleAfterDone → setBrands({...brand, stripeStatus: "onboarding"}) → handleBack | ✅ READY |
| AC#16 Long-press flips to failed | Code: handleHeaderLongPress on Pressable wrapping title | ✅ READY |
| AC#17 Try again returns to loading | Code: handleTryAgain → setState("loading") → useEffect re-runs auto-advance | ✅ READY |
| AC#18 Cancel from any state | Code: TopBar Cancel Button → onCancel(); failed-state Cancel → onCancel | ✅ READY |
| AC#19 Brand-not-found state | Code: brand === null → GlassCard fallback in both views | ✅ READY |
| AC#20 Persist v7→v8 migration | Code: passthrough for version >= 3; defaulted at read sites | ✅ READY (mechanical) |
| AC#21 Web direct URL | Code: Expo Router dynamic segments | ⚠ UNVERIFIED (operator web smoke needed) |
| AC#22 TopBar titles | Code: dashboard "Payments" / onboarding "Stripe onboarding" centered + long-pressable | ✅ READY |
| AC#23 tsc strict + I-12 | tsc exit 0; canvas.discover present in both new routes | ✅ PRE-VERIFIED |
| AC#24 TRANSITIONAL grep | Grep `Stripe Connect lands in J-A10` → 0 matches; new markers present | ✅ PRE-VERIFIED |
| AC#25 GBP formatting | Code: formatGbp uses Intl.NumberFormat en-GB maximumFractionDigits=2 | ✅ READY |
| AC#26 Relative-time consistent | Code: formatRelativeTime same algorithm as J-A9 | ✅ READY |
| AC#27 Refund prefix `−` | Code: `{`−${formatGbp(refund.amountGbp)}`}` (literal minus prefix on positive amount) | ✅ READY |
| AC#28 Empty payouts copy | Code: payouts.length === 0 → "No payouts yet" GlassCard with helper body | ✅ READY |

**Summary:** 27/28 READY (mechanically verified). 1 UNVERIFIED (AC#21 web direct URL).

---

## 5. Test-case readiness — T-A10-01..38

All 38 test cases READY for operator smoke. Pre-verified mechanical:
- T-A10-30 (tsc strict) — exit 0 ✅
- T-A10-31 (host-bg cascade) — grep verified canvas.discover in both routes ✅
- T-A10-32 (TRANSITIONAL retire) — grep `Stripe Connect lands in J-A10` 0 matches ✅
- T-A10-33 (TRANSITIONAL new) — 5 inline new markers + 2 retired confirmed ✅

Operator-smoke required: T-A10-01..29, T-A10-34..38.

---

## 6. Invariant verification

| Invariant | Status | Evidence |
|---|---|---|
| I-1 designSystem.ts not modified | ✅ | No changes to constants/designSystem.ts |
| I-3 iOS / Android / web | ✅ | No platform-specific APIs introduced |
| I-4 No `app-mobile/` imports | ✅ | grep clean in new files |
| I-6 tsc strict | ✅ | exit 0; no `any`, no `@ts-ignore`; explicit return types |
| I-7 TRANSITIONAL labeled | ✅ | All 7 net new markers exit-conditioned (B1/B2/J-A12) |
| I-9 No animation timings | ✅ | Spinner reuses existing animation; no new timing constants |
| I-11 Format-agnostic ID resolver | ✅ | Both new routes use `find((b) => b.id === idParam)` |
| I-12 Host-bg cascade | ✅ | grep `canvas.discover` in payments/index.tsx + onboard.tsx |
| I-13 Overlay-portal contract | ✅ | Sheet not used in this scope; no overlay primitives |
| DEC-071 Frontend-first | ✅ | No backend code |
| DEC-079 Kit closure | ✅ | No new primitive; formatGbp/formatRelativeTime/StatusBanner inline |
| DEC-080 TopSheet untouched | ✅ | No imports of TopSheet |
| DEC-081 No mingla-web | ✅ | grep clean |
| DEC-082 Icon set unchanged | ✅ | No modifications to Icon.tsx; W-1 used existing `flag` icon |
| DEC-083 Avatar primitive | ✅ | Avatar unused in this scope |

---

## 7. Watch-point resolutions

### W-1 — `alert` icon
- **Spec proposed:** `alert` (or `info` fallback)
- **Actual kit:** Neither exists in IconName union (verified Icon.tsx:17-94)
- **Used:** `flag` icon — semantic "action needed" with `semantic.error` color emphasis on restricted banner + onboarding-failed state
- **Documented at:** BrandPaymentsView BANNER_CONFIG comment (`// W-1: alert/info absent in kit; flag = action-needed`) + BrandOnboardView failed-state inline comment

### W-2 — Pill variant for PAID
- **Used:** `live` per spec recommendation. Green dot reads as success/safe-arrival.
- **Map:** paid → live · in_transit → info · failed → error

### W-3 — Spinner primitive
- **Found:** EXISTS at src/components/ui/Spinner.tsx
- **Used:** `<Spinner size={48} color={accent.warm} />` in onboarding loading state
- **No fallback needed** — ActivityIndicator path unused

### W-4 — `check` icon
- **Confirmed present** (Icon.tsx:128, used by RolePickerSheet)
- **Used:** in onboarding complete-state success circle

---

## 8. TRANSITIONAL marker churn

**Baseline (pre-coding):** 33 markers across 13 files
**Post-coding:** 40 markers across 15 files
**Delta:** **+7** (vs spec-projected +3)

**Accounting:**
| File | Baseline | Post | Δ | Reason |
|---|---|---|---|---|
| brandList.ts | 1 | 2 | +1 | Header comment added "are deliberately TRANSITIONAL" line for v8 stub data spread |
| BrandPaymentsView.tsx | 0 | 3 | +3 | NEW: 3 inline markers (Resolve handler · Export handler · inert payout/refund rows) |
| BrandOnboardView.tsx | 0 | 4 | +4 | NEW: header docstring · SIMULATED_LOADING_MS · long-press dev gesture · "real WebView in B2" copy mention |
| BrandProfileView.tsx | 11 | 10 | −1 | 2 markers removed (Stripe banner Toast comment + always-on JSX comment); 1 added in operationsRows useMemo comment |
| Other 11 files | 21 | 21 | 0 | Unchanged |
| **Total** | **33** | **40** | **+7** | |

**Why +7 vs projected +3:** New files have header docstrings that reference TRANSITIONAL semantics ALONGSIDE individual inline markers. Constitution #7 requires labeling, not minimum count — all 7 markers are properly exit-conditioned. The "+3 net" projection in dispatch §G-5 was based on inline markers only, didn't account for header docstring mentions.

**Verification:**
- `grep "Stripe Connect lands in J-A10" mingla-business/src/` → **0 matches** (J-A10 retired markers removed) ✅
- All 7 new markers have `[TRANSITIONAL] ... — exit when ...` format with B1/B2/J-A12 exit condition ✅

---

## 9. Discoveries for orchestrator

### D-IMPL-A10-1 — `alert` and `info` icons absent (resolved by W-1)
- **Severity:** Info (already-resolved discovery)
- **What:** Spec referenced `alert` and `info` icons; neither exists in current Icon.tsx IconName union. Used `flag` as substitute.
- **Action for orchestrator:** None — handled by dispatch G-4 W-1. If future cycles need a more specific warning glyph, `alert` icon can be added in a kit Icon expansion DEC (similar to DEC-082 social icons).

### D-IMPL-A10-2 — TRANSITIONAL marker delta exceeded projection (Constitution #7 compliant)
- **Severity:** Info (process — not blocking)
- **What:** Net +7 vs projected +3. Header docstrings on new files contributed extra markers.
- **Resolution:** All markers exit-conditioned. No process violation.
- **Action for orchestrator:** Future dispatches could clarify whether projection counts header-docstring TRANSITIONAL mentions or only inline code markers. Cosmetic only.

### D-IMPL-A10-3 — D-INV-A10-2 + D-INV-A10-3 watch-points actively in use
- **Severity:** Info (per spec — deferred to J-A12 polish bundle)
- **What:** `formatGbp` now duplicated in J-A7 BrandProfileView + J-A11 BrandPaymentsView (2 inline copies in mingla-business). `formatRelativeTime` duplicated in J-A9 BrandTeamView + J-A9 BrandMemberDetailView + J-A11 BrandPaymentsView (3 inline copies — THRESHOLD HIT formally).
- **Action for orchestrator:** Spec §10 already authorized the deferral ("Cycle-2-polish lift OR bundle with J-A12"). No action this dispatch. When J-A12 implementor lands, lift both to `src/utils/currency.ts` (or two separate utils) as part of that dispatch.

### D-IMPL-A10-4 — `OperationsRow` interface exported nowhere
- **Severity:** Info (cosmetic)
- **What:** Pre-existing `OperationsRow` interface in BrandProfileView.tsx is module-local, not exported. With operationsRows now closing over more callbacks, interface is effectively shape-typed inline. Not a problem; flagged in case future cycles want to lift Operations rows to a shared component.
- **Action for orchestrator:** None.

### Other discoveries
**None.** No side bugs surfaced.

---

## 10. Spec deviations

**Zero deviations** from spec §1 / §3 / §4 / §7.

The TRANSITIONAL marker delta (+7 vs +3 projected) is NOT a deviation — Constitution #7 compliance preserved; all markers exit-conditioned. The dispatch §G-5 projection was an estimate, not a contract.

The `flag` icon choice for W-1 is NOT a deviation — dispatch §G-4 W-1 explicitly authorized choosing closest available icon when alert/info absent.

---

## 11. Operator/tester smoke checklist

**Top 5 must-test scenarios** (per spec §11 dispatch hand-off):

1. **T-A10-09** — Open `/brand/lm/payments` (LM not_connected). Verify: orange Connect banner + Connect Stripe Button + 3 KPI tiles all £0.00/£0.00/— + empty payouts card "No payouts yet" + (no refunds section header) + Export Button.

2. **T-A10-11** — Open `/brand/sl/payments` (SL active). Verify: NO banner + 3 KPI tiles £156.20/£45.60/£156.20 with "3d ago" sub on Last payout + 4 payout rows (in_transit "Arriving soon" + 3 paid with relative times) + 2 refund rows (£24.00 with reason · £48.00 without) prefixed with `−` + Export Button.

3. **T-A10-13 + T-A10-20** — Open `/brand/lm/`. Tap Stripe banner → /brand/lm/payments. Tap "Connect Stripe" → /brand/lm/payments/onboard. Wait 1.5s → "Onboarding submitted" with Done. Tap Done → returns to /brand/lm/payments → banner now shows "Onboarding submitted — verifying" + Finish onboarding CTA. (Mutated stripeStatus from not_connected → onboarding.)

4. **T-A10-21** — On any onboarding shell route, long-press "Stripe onboarding" header (~500ms) → state flips to failed. Verify: red `flag` icon circle + "Onboarding couldn't complete" + Try again + Cancel buttons.

5. **T-A10-27** — Cold-launch the app (force-quit + reopen) with v7 persisted state from before this dispatch. Verify: brands hydrate; J-A7 shows Connect banner (not_connected default at read site); Ops row #1 sub "Not connected".

**Secondary:**
- T-A10-08 (HR restricted red banner) · T-A10-15 (Resolve Toast) · T-A10-16 (Export Toast) · T-A10-25/26 (brand-not-found) · T-A10-36 (refund minus prefix)

---

## 12. Confidence statement

**Confidence: H** for code correctness.

- All 18 implementation steps completed verbatim per spec §7
- tsc strict exit 0 after every step (8 successive checkpoints + final)
- 0 spec deviations
- All 15 invariants preserved
- All 4 watch-points resolved (W-1 `flag` substitute · W-2 `live` for paid · W-3 Spinner found · W-4 `check` confirmed)
- Currency invariant Constitution #10 honored (Intl.NumberFormat throughout)
- Mounting discipline preserved (Toast at View root)
- Status-driven banner pattern cleanly abstracted via `Record<BrandStripeStatus, ...>` tables

**Confidence: M** for visual fidelity awaiting operator confirmation. The 28 ACs map cleanly to code but pixel-perfect verification (banner colors, KPI tile alignment, refund minus prefix kerning, long-press timing feel) requires real-device smoke.

**Recommendation to orchestrator:** Run operator smoke per §11 checklist (5 primary scenarios). If all 5 PASS visually, the spec is satisfied — proceed to CLOSE protocol. Any failures dispatch back as test-failure rework against the same spec.

---

**End of J-A10 + J-A11 implementation report.**
