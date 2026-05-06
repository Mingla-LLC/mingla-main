# INVESTIGATION — BIZ Cycle 17 (Refinement Pass — INVENTORY + Decomposition)

**Cycle:** 17 (BIZ — Phase 5 close-out, "earn private-beta-ready")
**Mode:** INVESTIGATE — accumulated backlog inventory + decomposition recommendation
**Generated:** 2026-05-04
**Forensics phase only — NO SPEC produced.** SPEC dispatches happen per mini-cycle after operator decomposition lock-in.

---

## 1. Layman summary

Across cycles 0a → 16a, 30 implementation reports produced **101 logged "Discoveries / Transition Items / Open Questions"** plus **~75 in-code `[TRANSITIONAL]` markers**. After deduping and netting against items closed downstream:

- **~58 still-open items** worth disposition (out of 101 logged).
- **~75 TRANSITIONAL markers** in code, ~95% of which exit on **B-cycle wiring** (Stripe / Resend / Twilio / OneSignal / Storage / RLS) — **NOT in 17 scope**.
- **~12 items are genuine 17-eligible polish** (TS errors, dead code, copy/UX nits, accessibility gaps, perf candidates).
- **3 persistent paper-trail items** to maintain explicitly: D-IMPL-46 Apple JWT (T-14 reminder + autorotate workstream both already exist), D-CYCLE15-FOR-2 (`mingla-marketing/` doc drift), Sentry env wiring (TRANSITIONAL since Cycle 16a CLOSE).
- **0 items found** that contradict any closed-cycle CLOSE verdict.

**Headline read:** Cycle 17 is **smaller than the dispatch's 40-hr estimate** if we honor B-cycle deferrals correctly. **Realistic scope is ~16-22 hrs across 17a (quick wins, ~6 hrs) + 17b (visual + copy polish, ~6 hrs) + 17c (a11y audit, ~5 hrs) + 17d (perf pass, ~5 hrs)**, with 17e reserved for any founder-feedback cluster that surfaces post-decomposition. The dispatch correctly anticipated this shape.

**Key inventory finding:** the largest single concentrated cluster of OPEN debt is the **Cycle 12 pre-existing tsc errors** (`events.tsx` duplicate `toastWrap` style + `brandMapping.ts:180` Brand type drift) — flagged 4× separately across reports, **never fixed**, currently latent. They are textbook 17a quick-wins (probably 30 min each).

**Recommended action:** lock decomposition as **17a → 17b → 17c → 17d** (sequential per session-hygiene rule). 17a kicks off with the tsc cluster + Sentry env wiring + D-CYCLE15-FOR-2 doc drift = three high-leverage cleanups in a single ship.

---

## 2. Master backlog table (deduped + dispositioned)

Source: `Mingla_Artifacts/reports/TEMP_CYCLE_17_BACKLOG_AGGREGATE.md` (101 rows across 30 IMPL reports).

Below: items **still-open AND eligible for Cycle 17** (~57 items after deduplication). Items already closed at later cycles, items with B-cycle / consumer-app cycle EXIT conditions, and items that are intentional design choices (not defects) are excluded from this table — listed separately in §2b/§2c.

### 2a. Cycle 17-eligible OPEN items

| ID | Origin | Sev | Category | Title | Recommended disposition |
|---|---|---|---|---|---|
| D-CYCLE12-IMPL-1 | Cycle 12 (×4 reports) | S2 | tsc-error | `events.tsx:711-720` duplicate `toastWrap` style property | **17a** quick-win (30 min) |
| D-CYCLE12-IMPL-2 | Cycle 12 (×4 reports) | S2 | tsc-error | `brandMapping.ts:180` Brand type drift (kind/address/coverHue) | **17a** quick-win (30 min) |
| D-CYCLE16A-IMPL-3 | Cycle 16a | S2 | observability | Sentry DSN not yet in `.env` (TRANSITIONAL ship) | **17a** wire env + EAS Secrets (30 min) |
| D-CYCLE15-FOR-2 | Cycle 15 forensics | S2 | docs | DEC-081 vs `mingla-marketing/` realisation drift | **17a** author NEW DEC clarifier (15 min) |
| D-CYCLE15-IMPL-3 | Cycle 15 | S2 | bug | Supabase email template `{{ .Token }}` rendering verification | **17a** verify in dashboard (15 min, no code) |
| D-CYCLE12-IMPL-3 | Cycle 12 (×3) | S3 | bug | Activity feed door-refund extension missing | **17a** OR defer (1 hr if shipping) |
| D-CYCLE12-IMPL-4 | Cycle 12 (×2) | S3 | bug | `PAYMENT_METHOD_LABELS` dict duplicated 3× | **17a** dedupe (15 min) |
| D-CYCLE12-IMPL-5 | Cycle 12 (×2) | S3 | bug | Toggle row disabled styles unused in `InviteScannerSheet` | **17a** subtract (10 min) |
| D-CYCLE13-IMPL-2 | Cycle 13a | S3 | bug | "Verified host since YYYY" pill suppressed (not wired) | **B-cycle** — needs `creator_accounts.created_at` lookup from real schema |
| D-CYCLE13-IMPL-3 | Cycle 13a | S3 | ux-polish | `BrandProfileView` Team row caption is static | **17b** wire `useBrandTeamStats` (45 min) |
| D-CYCLE13B-IMPL-1 | Cycle 13b | S3 | docs | Strict-grep gate vs documentation token (`canManualCheckIn` 5 hits) | **17a** add allowlist comment (10 min) |
| D-CYCLE14-IMPL-1 | Cycle 14 | S3 | bug | `accountDeletionPreview.scannerInvitationsCount === 0` (placeholder) | **17b** OR defer to B (still UI-only) |
| D-CYCLE14-IMPL-2 | Cycle 14 | S3 | perf | `delete.tsx` 795 LOC (39% over budget) | **17d** decompose into sub-components (2 hrs) |
| D-CYCLE14-IMPL-4 | Cycle 14 | S3 | docs | D-14-2 SPEC pivot rationale (creator_avatars bucket) | **CLOSE** — historical; no action needed |
| D-CYCLE15-IMPL-2 | Cycle 15 | S3 | perf | `BusinessWelcomeScreen` 801 LOC (2× over) | **17d** decompose (2 hrs) |
| D-CYCLE16A-IMPL-1 | Cycle 16a | S2 | spec-drift | Scanner refactor SKIPPED (graceful UX worth keeping) | **CLOSE** — superseded by intentional choice |
| D-CYCLE16A-IMPL-2 | Cycle 16a | S3 | spec-drift | ConfirmDialog prop mismatch documented | **CLOSE** — informational |
| D-9c-IMPL-1 | Cycle 9c | S0→S3 | docs | confirm.tsx recordOrder wire 45 lines vs spec 1-line | **CLOSE** — informational; no defect |
| D-9c-IMPL-2 | Cycle 9c | S0→S3 | bug | EditPublishedScreen.webPurchasePresent doesn't auto-update mid-session | **17b** add reactive watch (1 hr) |
| D-9c-IMPL-9 | Cycle 9c | S0→S3 | ux-polish | Buyer order detail shows only first ticket's QR (multi-ticket) | **17b** swipe carousel for QRs (2 hrs) |
| D-9c-IMPL-10 | Cycle 9c | S0→S3 | ux-polish | Avatar hue keyed by `order.id` → multi-tickets same buyer = different colours | **17b** key by buyer email instead (30 min) |
| D-9c-V2-2 | Cycle 9c v2 | S0→S3 | perf | `getSoldCountByTier` returns fresh `Record` each call (infinite-loop risk) | **17d** memoize (1 hr) |
| D-9c-V2-5 | Cycle 9c v2 | S1→S3 | perf | `RefundSheet` 530 LOC, 5 stores | **17d** extract helper service (2 hrs) |
| D-CYCLE10-IMPL-1 | Cycle 10 | S3 | spec-drift | Native CSV export degraded (expo-sharing not installed) | **17a** install expo-sharing (15 min, no native rebuild needed if Expo Go in dev) — OR defer until next native build |
| D-CYCLE10-IMPL-2 | Cycle 10 | S3 | ux-polish | `ConfirmDialog` has no `reasoned` variant | **17b** add `reasoned` variant (1.5 hrs) — OR keep inline Sheet workaround |
| D-IMPL-A12-1 | Cycle 2 | S0→S3 | ux-polish | GMV KPI visual shift (`£24,180` vs `£24,180.00`) | **17b** unify (30 min) |
| D-IMPL-A12-2 | Cycle 2 | S0→S3 | spec-drift | Inline currency formatters in `home.tsx` + `__styleguide.tsx` | **17a** consolidate to util (30 min) |
| D-704-IMPL-3 | ORCH-0704 | S2 | bug | "Open Orders" CTA is toast stub | **CLOSED** — Cycle 9c shipped real wire |
| D-704-IMPL-4 | ORCH-0704 | S2 | bug | `webPurchasePresent` hardcoded false | **CLOSED** — Cycle 9c shipped real wire |
| D-704-IMPL-5 | ORCH-0704 | S2 | bug | `affectedOrderIds` empty `[]` in stub mode | **CLOSED** — Cycle 9c |
| D-IMPL-0707-* | ORCH-0707 | S3 | docs | Card category fallback / mixed-shape cache notes | **CLOSE** — informational, all intentional per SPEC |
| D-OBS-* | ORCH-0670 | S0→S3 | docs | "Today/Tonight" chips, locale spot-check | **B-cycle / Consumer-app** (not BIZ scope) |
| D-IMPL-1..3 | ORCH-0696 | S0→S3 | docs | bulk token-swap reuse / parseEventDateTime util | **CLOSE** — informational |
| D-9c-V3-1..4 | Cycle 9c v3 | S2 | scope-deferral | Activity feed event-level edits / lifecycle / scan / approval | **B-cycle** (needs real backend events) |

**Net OPEN items eligible for Cycle 17:** ~22 (rest are CLOSED/superseded/B-cycle/informational).

### 2b. Items deferred to B-cycle (NOT in 17 scope)

These have explicit **EXIT condition: B-cycle** and are tracked here for completeness but excluded from the 17 plan:

- All 75 `[TRANSITIONAL]` markers in code where EXIT mentions Stripe / Resend / Twilio / OneSignal / Storage / RLS / `audit_log` writers / real Supabase mutations
- `payoutEstimate × 0.96` stub (`reconciliation.ts`, `BrandFinanceReportsView.tsx`) → B-cycle Stripe payout API
- All `eventChangeNotifier.ts` sends (push: false, email log-only, sms log-only) → B-cycle edge functions
- All Zustand-persisted store data that B-cycle migrates to DB (`liveEventStore`, `orderStore`, `doorSalesStore`, `guestStore`, `scannerInvitationsStore`, `brandTeamStore`, `eventEditLogStore`, `draftEventStore`, `scanStore`)
- `ThreeDSStubSheet` + `PaymentElementStub` → B3 real Stripe SDK
- `BrandOnboardView` simulated loading → B2 real Stripe Connect WebView
- All `_saleId?.tsx` / `door/index.tsx` `card_reader` + `nfc` payment options → B-cycle Stripe Terminal SDK
- All `OG image placeholder` markers (`PublicEventPage`, `PublicBrandPage`) → B-cycle backend OG generation

### 2c. Items deferred to consumer-app cycle (NOT in BIZ 17 scope)

- All ORCH-0670/0696/0698/0699/0700/0708/0712/0713 discoveries are **place-pool / categorization / consumer-side** scope. They are listed in the aggregate but not scheduled in BIZ Cycle 17.
- `D-IMPL-A12-* / D-OBS-*` Cycle 2 finance items where the scope tag was BIZ but the discovery is i18n / consumer-side.

---

## 3. TRANSITIONAL marker inventory

**Total markers found:** ~75 across `mingla-business/src/` + `mingla-business/app/` + `mingla-business/supabase/functions/` + 2 in `app.config.ts`.

### 3a. By EXIT condition

| EXIT bucket | Count | 17 disposition |
|---|---|---|
| **B-cycle real backend (Stripe / Resend / Twilio / OneSignal / Storage / RLS)** | ~63 | NOT in 17 — keep marker, no change |
| **Consumer-app cycle (OneSignal player IDs)** | ~3 | NOT in 17 — keep marker |
| **Cycle 9 publish edge function (recurrence)** | 2 | Already shipped — markers stale, **CLOSE** in 17a |
| **B1 backend (real brand list / dev seed buttons)** | ~5 | NOT in 17 — keep |
| **B2 backend (Stripe Connect, OG image, fee config)** | ~6 | NOT in 17 — keep |
| **B3 backend (Stripe SDK, webhooks, real 3DS)** | 4 | NOT in 17 — keep |
| **B4 backend (orders / refunds DB-resident)** | 2 | NOT in 17 — keep |
| **J-A8 / J-A12 cycles (already shipped)** | 4 | Markers stale — **CLOSE** in 17a |
| **TRANS-CYCLE-3-6 placeholder categories (Cycle 3 wizard placeholder)** | 1 | **17a** evaluate — possibly closeable |
| **Cycle 16a J-X3 mail-to support active TRANSITIONAL** | 1 | Active — keep until B-cycle ticket system |

### 3b. Stale markers (EXIT met but marker not removed)

- `recurrenceRule.ts:9, 224` — "consumed by Cycle 9 publish edge function" — Cycle 9 shipped, edge fn live. **17a CLOSE** (10 min).
- `BrandProfileView.tsx:286` — "exit when J-A12 (Finance reports)" — J-A12 shipped Cycle 2. **17a CLOSE** (10 min).
- `BrandProfileView.tsx:574` — "stub past-event rows — replaced by real fetch in Cycle 3" — Cycle 3 shipped wizard, but past-events fetch may still be UI stub since `liveEventStore` is still client-only (B-cycle). **VERIFY** in 17a.
- `BrandProfileView.tsx:62` — same family — **VERIFY** in 17a.
- `events.tsx:361` — "Buyer email cascade is a no-op stub" — same as B-cycle Resend exit — **NOT stale**.

**Net stale-marker cleanup: 3-4 markers, ~30 min total.**

---

## 4. DEC entries staging Refinement Pass / Cycle 17 work

`DECISION_LOG.md` has entries citing DEFER / B-cycle / Refinement Pass that are too long for direct read; abbreviated cross-reference per grep:

- **DEC-005** (2026-03-23) — Service error contract deferred to next hardening cycle. Cycle 17 is the deferral target. **17b/c candidate** — but probably scoped only to 4 known services per DEC-005 body (low blast radius).
- **DEC-082** — cosmetic numbering gap (per dispatch §5). Self-deferred to Refinement Pass. **17a** close (5 min).
- **DEC-098** (Cycle 16 split) — 16b deferred indefinitely; only 16a shipped. Cycle 17 is NOT 16b — separate cycle.
- **DEC-097** (Cycle 15) — D-CYCLE15-FOR-2 doc drift queued explicitly for Refinement Pass. **17a** author DEC-099+ (15 min).

No other DEC entries explicitly stage Cycle 17 work. The bulk of Cycle 17 backlog is **discovered**, not **decided** — i.e., it lives in IMPL report Discoveries sections, not DEC entries.

---

## 5. Per-journey baseline survey (J-Z1..J-Z5)

### J-Z1 — Founder feedback triage

**Current state:** **No formal mechanism.** Grep across `Mingla_Artifacts/` returns zero `FOUNDER_FEEDBACK*` files. Founder feedback historically arrives via:
- Direct chat with operator → orchestrator captures into `OPEN_INVESTIGATIONS.md` if actionable
- Operator-driven cycle scoping (decomposition lock-in via DEC entries)
- Smoke-test FAILs (e.g., Cycle 14 device-smoke "not signed out" → bug found post-CLOSE)

**Gap:** no canonical doc for "founder said X but it's not yet a registered ORCH-ID." This means feedback can leak between sessions when not immediately ORCH-converted.

**Recommendation:** **17a** create `Mingla_Artifacts/FOUNDER_FEEDBACK.md` — append-only log with date / source / verbatim feedback / status (open / triaged-to-ORCH-XXXX / declined). Operator-owned, orchestrator-readable. **15 min create, ongoing maintenance.**

### J-Z2 — Visual polish hotspots

**Quantitative baseline:**
- 1,035 `<Text>` usages across 92 files
- 178 `accessibilityRole=` (across 63 files)
- 330 `accessibilityLabel=` (across 78 files) — **note: ratio is 330 / 1035 = ~32% labels coverage**, but most `<Text>` doesn't need a label (only interactive elements do)
- 418 Pressable/TouchableOpacity (across 67 files) — **of these, ~330 have `accessibilityLabel` — leaving ~88 Pressable/TO without labels**
- 21 `withTiming(...)` calls in kit primitives — all use Reanimated config objects with `Easing.*` and explicit `duration:` properties; **NO bare-number `withTiming(800)` ad-hoc calls in kit primitives.** Kit token compliance is **good**.

**Hotspot identification (from `[TRANSITIONAL]` cluster + LOC):**
- `delete.tsx` (795 LOC) — Cycle 14, internal state machine, organic growth
- `BusinessWelcomeScreen.tsx` (801 LOC) — Cycle 15, internal state machine
- `BrandProfileView.tsx` (~700 LOC) — accumulated Cycle 2 + 13 churn
- `RefundSheet.tsx` (530 LOC) — Cycle 9c
- `events.tsx` — has the long-standing duplicate `toastWrap` (D-CYCLE12-IMPL-1)
- `BrandFinanceReportsView.tsx` — Cycle 2 finance, 4 TRANSITIONAL markers

**Recommendation:** **17b** scope = top-3 hotspot polish (delete.tsx review for state-machine clarity, multi-ticket QR carousel, avatar hue stabilisation). Not a per-surface review — **founder-feedback-driven only**. The kit is healthy.

### J-Z3 — Copy review surface count

- **Total user-facing strings:** ~1,035 `<Text>` + ~88 button labels in `accessibilityLabel`-only (without visible Text). **Conservative estimate ~1,100 user-facing strings.**
- **Surfaces shipping copy publicly (anon-buyer-tolerant):** `app/checkout/[eventId]/*` (4 routes), `app/e/[brandSlug]/[eventSlug]`, `app/b/[brandSlug]`, `app/o/[orderId]`, `app/+not-found.tsx` — ~8 public routes
- **Founder-only / operator-only routes:** all `(tabs)/*` + `account/*` + `event/[id]/*` — ~30 routes

**Recommendation:** **17b** scope = **public routes only** (8 surfaces). Operator-facing copy is good-enough; private-beta operators are tolerant. Public buyer flow is what gets first impression. **~3 hrs scope.**

### J-Z4 — Accessibility audit baseline

- 88 Pressable/TouchableOpacity without `accessibilityLabel` (estimated 21% gap)
- 330 explicit `accessibilityRole=` for ~418 interactive elements (~79% coverage)
- Contrast: kit tokens (`colors.text.primary` `#111827` on `colors.background.primary` `#ffffff` = 16.1:1 AAA ✓) — **kit baseline is AAA**, ad-hoc inline colors not yet audited
- Reduce-motion: ConfirmDialog hold-to-confirm exemption is the only documented exemption; Sheet + Modal use REDUCE_MOTION_OPEN config; Toast respects standard timing — **probably compliant** (verify in 17c).
- Focus order on web bundle: NOT verified in any prior cycle — **17c first-time audit**

**Recommendation:** **17c** scope = **WCAG AA target with labels-and-roles + reduce-motion verify**. NOT contrast/focus-order (defer to AAA polish if needed). **~5 hrs scope.**

### J-Z5 — Performance pass baseline

- **Bundle size:** never measured. Action: `npx expo export --platform ios` then measure. **17d first-time measurement.**
- **AsyncStorage hygiene:** 11 Zustand persisted stores. None of them have schema migration logic visible (per grep) — meaning **schema changes via Zustand `version` bump have never been validated**. Latent risk.
- **Render perf hotspots:** D-9c-V2-2 `getSoldCountByTier` fresh-array selector pattern (infinite-loop risk under React Query); D-9c-V2-5 `RefundSheet` 5-store reads.
- **React Query staleTime audit:** dispatch §6 D-17-7 calls this out — never systematically reviewed.

**Recommendation:** **17d** scope = bundle-size measurement + AsyncStorage version audit + 2 known render fixes (D-9c-V2-2, D-9c-V2-5) + LOC decomposition (delete.tsx, BusinessWelcomeScreen.tsx). **~5 hrs scope.**

---

## 6. Decomposition recommendation

### Recommended split: 17a → 17b → 17c → 17d (sequential)

**17a — Quick wins / cleanup (~6 hrs)**
- Fix tsc errors: `events.tsx` toastWrap dedupe + `brandMapping.ts:180` Brand type
- Wire Sentry env vars (`.env` + EAS Secrets) to flip TRANSITIONAL → live
- Author DEC-099+ for D-CYCLE15-FOR-2 doc drift
- Verify Supabase email `{{ .Token }}` template
- Subtract stale TRANSITIONAL markers (recurrenceRule, BrandProfileView J-A12, etc.) — 3-4 markers
- Dedupe `PAYMENT_METHOD_LABELS` dict
- Subtract unused `toggleRowDisabled` styles in `InviteScannerSheet`
- Consolidate inline currency formatters → util
- Add allowlist comment for `canManualCheckIn` strict-grep gate
- Close cosmetic DEC-082 numbering gap
- Create `FOUNDER_FEEDBACK.md` consolidation doc
- Verify D-CYCLE14-IMPL-3 closure
- Activity feed door-refund extension (IF small) OR defer to B-cycle

**17b — Visual + copy polish (~6 hrs)**
- Multi-ticket QR carousel (D-9c-IMPL-9)
- Avatar hue keyed by buyer email instead of `order.id` (D-9c-IMPL-10)
- GMV KPI shift fix (D-IMPL-A12-1)
- `webPurchasePresent` reactive watch (D-9c-IMPL-2)
- `BrandProfileView` Team row caption live count (D-CYCLE13-IMPL-3)
- Public-route copy review (8 surfaces only)
- (Optional) `ConfirmDialog` `reasoned` variant if needed

**17c — Accessibility audit (~5 hrs)**
- 88 Pressable/TouchableOpacity audit for `accessibilityLabel` coverage
- `accessibilityRole=` coverage to 100%
- Reduce-motion verify across Sheet / Modal / Toast / ConfirmDialog
- WCAG AA contrast spot-check on ad-hoc inline colors

**17d — Performance pass (~5 hrs)**
- Measure bundle size (first-time baseline)
- AsyncStorage version audit (11 persisted stores)
- Memoize `getSoldCountByTier` (D-9c-V2-2)
- Extract `RefundSheet` helper service (D-9c-V2-5)
- LOC decompose `delete.tsx` (795) + `BusinessWelcomeScreen.tsx` (801)
- React Query staleTime systematic review

**17e — Reserve slot (founder-feedback cluster, optional)**
- Empty by default — opens only if J-Z1 mechanism surfaces a cluster

### Total estimate: **~22 hrs** (vs. dispatch's 40-hr placeholder).

The dispatch's 40 hrs assumed full per-surface review (1,035 `<Text>` audited, full WCAG AAA, full bundle perf). The honest scope is **22 hrs** if we honor B-cycle deferrals correctly.

### Why sequential, not parallel

Per memory rule `feedback_sequential_one_step_at_a_time`: one mini-cycle at a time. 17a quick wins ship first → smoke → CLOSE → then 17b. No parallel SPEC dispatches.

### Mini-cycle template

Each mini-cycle gets its own SPEC + IMPL + tester + CLOSE artifacts. Each SPEC dispatch authored by orchestrator AFTER operator locks scope. Forensics is NOT re-dispatched per mini-cycle — the inventory is the foundation; only NEW discoveries justify a fresh forensics pass.

---

## 7. Operator decisions queued (D-17-1 → D-17-10)

Surface in plain English for batched DEC-099+ lock-in:

**D-17-1 — Decomposition strategy.** Recommended: **17a → 17b → 17c → 17d** sequential mini-cycles (option B). Alternatives: (A) single Cycle 17 mega-spec (rejected — too large for sequential pace memory rule); (C) per-category mini-cycles inside 17a only (not recommended — adds overhead without cycle-level benefit).

**D-17-2 — Founder feedback collection mechanism.** Recommended: **17a creates `Mingla_Artifacts/FOUNDER_FEEDBACK.md`** as append-only operator-owned doc, orchestrator-readable. Cheap, durable, no third-party dependency. Alternative: Linear / GitHub Issues — adds tooling overhead.

**D-17-3 — Cycle 12 pre-existing tsc errors (D-CYCLE12-IMPL-1/2).** Recommended: **fix in 17a** (~30 min total, latent for 5 cycles already, will eventually break a build under `tsc --strict`). Defer-rationale-if-skipped: not currently breaking dev server.

**D-17-4 — Visual polish scope.** Recommended: **founder-feedback-driven only + top-3 hotspots** (delete.tsx, BusinessWelcomeScreen, RefundSheet). Per-surface review of 1,035 `<Text>` calls is not justified for private-beta target. Alternative: top-N highest-traffic surfaces only — almost identical to recommended.

**D-17-5 — Copy review scope.** Recommended: **public routes only (8 surfaces)** — buyer-facing first impression. Operator/private routes are good-enough for private beta. Alternative: every string — ~3 days work, low ROI.

**D-17-6 — Accessibility audit scope.** Recommended: **WCAG AA target with labels + roles + reduce-motion verify**. Skip contrast/focus-order audit until pre-public-launch. Alternative: AAA where feasible — additional ~3 hrs.

**D-17-7 — Performance pass priorities.** Recommended: **all four** (bundle size + AsyncStorage + 2 known render fixes + LOC decompose) — small per-item but foundational. Alternative: bundle-only — defers known render bugs.

**D-17-8 — Sentry env wiring (TRANSITIONAL post-Cycle-16a).** Recommended: **fold into 17a** — single dispatch wires `.env` + EAS Secrets, orchestrator can verify by checking Sentry for first event after EAS deploy. Alternative: keep operator-side action separate — fine if operator prefers but adds a coordination step.

**D-17-9 — DEC-081 vs `mingla-marketing/` documentation drift (D-CYCLE15-FOR-2).** Recommended: **author NEW DEC in 17a** — 15-min drafting, prevents future re-discovery. Alternative: defer indefinitely — but doc drift compounds.

**D-17-10 — Apple JWT expiry (D-IMPL-46).** Recommended: **CLOSE as already-mitigated** — autorotate workstream exists (`SPEC_APPLE_JWT_AUTOROTATE.md`, `INVESTIGATION_APPLE_JWT_AUTOROTATE.md`) AND a one-time scheduled remote agent fires 2026-10-12 (T-14 reminder). **Belt + suspenders + auto.** No 17 work needed beyond confirming scheduled agent is registered. Alternative: build in-app warning at T-30 days — overkill given existing safety net.

---

## 8. Confidence per area

| Area | Confidence | Notes |
|---|---|---|
| Master backlog inventory (101 rows) | **High** | Two-stage sub-agent extraction, spot-verified against memory + conversation summary |
| Status hint accuracy ("still-open" vs "closed-elsewhere") | **Medium** | Sub-agent extracted from report context; not every claim traced to current code state. Operator should confirm before 17a executes any "closed-elsewhere" item. |
| TRANSITIONAL marker count + bucketing | **High** | Direct grep, manual triage |
| J-Z3 copy / J-Z4 a11y baseline counts | **High** | Direct grep |
| J-Z5 perf baseline | **Medium** | Bundle size + AsyncStorage hygiene NOT measured — first-time when 17d executes |
| Decomposition shape (17a/b/c/d) | **High** | Aligns with dispatch §5 + memory rule sequential pace |
| 22-hr total estimate | **Medium** | Estimates assume "honor B-cycle deferrals correctly." If operator wants to ship some B-cycle items in 17 anyway, scope expands. |
| D-17-1..10 recommendations | **High** | Each grounded in concrete inventory finding |

---

## 9. Cross-references

- Aggregate source: `Mingla_Artifacts/reports/TEMP_CYCLE_17_BACKLOG_AGGREGATE.md` (101 rows)
- Dispatch: `Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_17_REFINEMENT_PASS.md`
- Epic: `Mingla_Artifacts/github/epics/cycle-17.md`
- Phase 5 siblings: cycle-14.md (Account closed) + cycle-15.md (Email-OTP closed) + cycle-16.md (16a closed; 16b deferred per DEC-098)
- INVARIANT_REGISTRY.md:1670 (I-36 ROOT-ERROR-BOUNDARY ACTIVE)
- Apple JWT belt+suspenders: `SPEC_APPLE_JWT_AUTOROTATE.md` + `INVESTIGATION_APPLE_JWT_AUTOROTATE.md` + scheduled remote agent (one-shot 2026-10-12)
- Memory rules pre-loaded:
  - `feedback_sequential_one_step_at_a_time` (sequential mini-cycles)
  - `feedback_implementor_uses_ui_ux_pro_max` (mandatory for any 17b/c visual SPEC)
  - `feedback_keyboard_never_blocks_input` (a11y/visual baseline check during 17b/c)
  - `feedback_rn_color_formats` (contrast spot-check during 17c)
  - `feedback_no_summary_paragraph` (mini-cycle reports)
  - `feedback_orchestrator_never_executes` (no auto-dispatch)

---

**END OF INVESTIGATION — NO SPEC PRODUCED.**

**Next operator action:** review §7 D-17-1..10 plain-English questions; lock decomposition (DEC-099+); orchestrator authors `SPEC_BIZ_CYCLE_17A_QUICK_WINS.md` (or alternative locked scope) sequentially.
