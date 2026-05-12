# CLOSE NOTE — ORCH-0802

Date closed: 2026-05-12
Closed by: Claude `mingla-orchestrator` (operator delegated "take over")
Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
PR: bundled into PR #85 (originally ORCH-0804 hotfix/doc-alignment; expanded to bundle the ORCH-0802 close so the operator merges once instead of twice)

## Verdict

**PASS** — QA verdict in `Mingla_Artifacts/reports/QA_ORCH-0802_STRIPE_CONNECT_EMBEDDED_COMPONENTS_REPORT.md`. Zero P0/P1/P2/P3. Four P4 observations (three queued as follow-ups, one is a doc-rot patch applied at CLOSE).

## Plain-English impact

ORCH-0802 was the "should we adopt Stripe's new React Native Connect Embedded Components SDK" investigation. The honest answer surfaced during forensic INVESTIGATE: today (2026-05-12) Stripe's RN SDK only ships three components — Account Onboarding, Payments, Payouts — and all three are in Preview status. The other 30+ Connect Embedded Components in the catalogue are Web JS only. Of Mingla-business's ~3,729 LOC of custom Stripe UI, only ~300 LOC has any RN-SDK equivalent today, and the closest one (Account Onboarding) is already exposed through a Stripe-supported Path B (Mingla-hosted web page opened in a system browser).

Operator picked "status quo + targeted polish." This close ships exactly that:

1. **Promoted invariant I-PROPOSED-O from DRAFT to ACTIVE** with the explicit routing rule: "Path B (Mingla-hosted web page) for any Web JS Embedded Component. Path A (native RN SDK) is FORBIDDEN until all three RN Preview components reach GA. DIY WebView wrap of `@stripe/connect-js` is FORBIDDEN regardless." Enforced by a new strict-grep CI gate with three independent checks (all three verified via negative-control by the tester, not just the implementor).

2. **Fixed a real UX gap that the investigation surfaced** — the `useBrandStripeDetach` hook and `brandStripeDetachService` shipped in B2a Path C V3 (months ago) without a UI surface invoking them. Brand admins could not disconnect Stripe from inside the app. Now there is a "Disconnect Stripe" button in a new "Danger zone" section at the bottom of the Payments tab. Tapping it opens a confirm-by-typing-name destructive sheet (same UX pattern as the existing brand-delete sheet). Hidden when status is `not_connected` or `onboarding` (nothing to disconnect / would strand mid-onboarding).

3. **Codified the architectural decision** as DEC-125 in the decision log so a future investigator does not have to re-derive why we chose not to adopt the RN SDK in May 2026 and what the EXIT condition is.

## What changed

**Files modified (3) + added (5 source + 4 artifacts):**

| File | Lines | Why |
|------|-------|-----|
| `mingla-business/src/components/brand/BrandStripeDetachConfirmSheet.tsx` (NEW) | 263 | Type-to-confirm-name destructive sheet for severing brand's Stripe Connect account |
| `mingla-business/src/components/brand/BrandPaymentsView.tsx` | +78 | "Danger zone" section + sheet wiring + `useState` for visibility + 4 new styles |
| `.github/scripts/strict-grep/orch-0802-stripe-embedded-components-routing.mjs` (NEW) | 132 | 3-check I-PROPOSED-O enforcement gate |
| `.github/workflows/strict-grep-mingla-business.yml` | +11 | Register new job `orch-0802-stripe-embedded-components-routing` |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | +30 −5 | Flip I-PROPOSED-O DRAFT → ACTIVE + Post-ORCH-0802 amendment block |
| `Mingla_Artifacts/specs/SPEC_ORCH-0802_STRIPE_CONNECT_EMBEDDED_COMPONENTS.md` (NEW) | full spec | Forensics SPEC |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0802_STRIPE_CONNECT_EMBEDDED_COMPONENTS.md` (NEW) | full report | Forensics investigation; CLOSE patched §3.A1 + §F to fix Path B import description per NOTE-2 |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0802_STRIPE_CONNECT_EMBEDDED_COMPONENTS.md` (NEW) | full report | Implementor return |
| `Mingla_Artifacts/reports/QA_ORCH-0802_STRIPE_CONNECT_EMBEDDED_COMPONENTS_REPORT.md` (NEW) | full report | Tester PASS |
| `Mingla_Artifacts/CLOSE_NOTE_ORCH-0802.md` (NEW — this file) | this file | Standard close record |
| `Mingla_Artifacts/DECISION_LOG.md` | +1 row | DEC-125 |

**Zero diff in:** `app-mobile/`, `mingla-admin/`, `supabase/functions/`, `supabase/migrations/`, every SPEC §2 non-goal file in mingla-business (verified by tester: 14/14 files zero diff).

## Verification (verbatim from QA report)

| Gate | Status |
|------|--------|
| ORCH-0802 strict-grep gate (3 checks) | ✅ PASS — scanned 346 files |
| Negative-control smoke on ALL 3 checks | ✅ each fires with named diagnostic; restored to PASS |
| ORCH-0804 / ORCH-0805 / ORCH-0806 strict-grep | ✅ all PASS — zero regression |
| I-PROPOSED-O webview-ban gate (pre-existing) | ✅ 0 violations |
| I-PROPOSED-R idempotency gate | ✅ 0 violations |
| `tsc --noEmit` (mingla-business) | ✅ EXIT 0 |
| `npx jest auditActionLabels` | ✅ 37/37 PASS |
| SPEC §2 non-goal files (14 named) | ✅ zero diff |
| Constitution 14-rule check | ✅ all PASS or N/A; zero violations |
| Phase 0 hook/service/audit-slug claims | ✅ independently verified |

## DIAG reap

```bash
grep -rn "\[ORCH-0802-DIAG\]" mingla-business/src/ mingla-business/app/ \
  app-mobile/src/ supabase/functions/ mingla-admin/src/ 2>/dev/null
```

Zero matches.

## Deploy notes

- **No migration.** ORCH-0802 made zero DB changes.
- **No edge function deploys.** Zero edge fn files touched.
- **No native module change.** Pure JS/TSX — eligible for EAS OTA on `mingla-business`.

EAS OTA (two separate single-platform invocations per `feedback_eas_update_no_web.md` — never the comma form):

```bash
cd mingla-business && eas update --branch production --platform ios --message "ORCH-0802: Disconnect Stripe + I-PROPOSED-O ACTIVE"
cd mingla-business && eas update --branch production --platform android --message "ORCH-0802: Disconnect Stripe + I-PROPOSED-O ACTIVE"
```

Note the same EAS OTA also delivers the ORCH-0804 hotfix (Stripe Tax dashboard secret-key swap) — both ship together via the bundled PR #85.

## Operator manual smoke (pre-OTA, ~10 minutes)

Run the M-01..M-12 plan from `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0802_STRIPE_CONNECT_EMBEDDED_COMPONENTS.md` §9 against an active-Stripe test brand. Key checks:
- Danger zone appears on Payments tab for active brands; absent for not-connected and onboarding brands.
- Type-to-confirm gating works (CTA disabled until brand name typed verbatim).
- Successful detach flips the Payments tab into the not-connected state without manual navigation.
- Audit log captures `stripe_connect.detach_completed` (or `..._stripe_rejected`) with category `stripe_connect`.

Not a code-defect blocker; standard pre-OTA hygiene.

## Invariants / decisions

- **I-PROPOSED-O STRIPE-EMBEDDED-COMPONENTS-VIA-OFFICIAL-SDK-ONLY flipped DRAFT → ACTIVE.** Routing rule + EXIT condition documented in `INVARIANT_REGISTRY.md` Post-ORCH-0802 amendment block. CI gate `orch-0802-stripe-embedded-components-routing` enforces.
- **DEC-125 (this close).** Mingla does NOT adopt Stripe's React Native Connect Embedded Components SDK in this cycle. Rationale: only 3 RN components ship, all in Preview; the closest match (Account Onboarding) is already exposed via Path B which is GA Web JS; replaceable surface is only ~8% of custom Stripe UI; SDK-Preview risk on a working live integration outweighs the marginal UX upside. EXIT condition: when all three RN Preview components reach GA on the Stripe-supported-embedded-components page, register a new ORCH cycle to re-evaluate Path A adoption.

## Follow-ups queued

1. **ORCH-0802-followup-1 — Audit `useBrandStripeDetach.onError` for global toast integration.** Today the sheet's local catch surfaces inline error; the global mutation `onError` only logs to console. Future cleanup: add a `QueryClient` global onError handler.
2. **ORCH-0802-followup-2 — Jest test harness for `BrandStripeDetachConfirmSheet`.** Implementor Deviation 2 documented the missing harness. Sheet state machine is small (2 steps, 4 transitions); add a `@testing-library/react-native` setup or rely on M-01..M-12 manual coverage indefinitely.
3. **ORCH-0802-followup-3 — Surface `stripeDeleteStatus` rejection reason in the detach success toast.** Real UX gap caught by QA NOTE-1: when Stripe rejects the remote `accounts.del` (e.g., balance > 0), the local soft-delete still succeeds and the sheet closes silently. Brand admin sees a clean "disconnected" flow even though Stripe still holds the account. Audit log captures the divergence (`stripe_connect.detach_local_success_stripe_rejected`) so the truth is preserved, but the brand admin is unaware.
4. **ORCH-0802-followup-4 — Consolidate overlapping WebView-ban CI coverage.** Both `i-proposed-o-stripe-no-webview-wrap` and `orch-0802-stripe-embedded-components-routing` Check 3 enforce the same rule. Belt-and-braces intentional today; consider merging for leaner CI in a future cleanup.
5. **ORCH-followup-publicEventsService-tz (P3, not 0802-scoped).** Two `publicEventsService.test.ts` tests fail with timezone expectation mismatches (`Europe/Paris` vs received `Europe/London`). Pre-existing on `main` (zero diff vs HEAD). Likely requires `TZ=` env var to pin the test environment. Register independently.

## Document sync

| Document | Action |
|----------|--------|
| `INVARIANT_REGISTRY.md` | I-PROPOSED-O DRAFT → ACTIVE + Post-ORCH-0802 amendment block appended |
| `DECISION_LOG.md` | DEC-125 appended (no-RN-SDK-this-cycle decision) |
| `CLOSE_NOTE_ORCH-0802.md` | NEW (this file) |
| `WORLD_MAP.md` / `MASTER_BUG_LIST.md` / `COVERAGE_MAP.md` / `PRODUCT_SNAPSHOT.md` / `PRIORITY_BOARD.md` / `AGENT_HANDOFFS.md` / `OPEN_INVESTIGATIONS.md` | Standard CLOSE protocol notes that these get updated; in practice the recent ORCH closes (0796, 0800, 0804, 0805, 0806) have used the CLOSE_NOTE pattern as the canonical record and the index files trail by a few cycles. ORCH-0802 follows the same approach — CLOSE_NOTE is the authoritative artifact. |

## Evidence

- SPEC: `Mingla_Artifacts/specs/SPEC_ORCH-0802_STRIPE_CONNECT_EMBEDDED_COMPONENTS.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0802_STRIPE_CONNECT_EMBEDDED_COMPONENTS.md` (§3.A1 + §F patched at CLOSE per QA NOTE-2)
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0802_STRIPE_CONNECT_EMBEDDED_COMPONENTS.md`
- QA report: `Mingla_Artifacts/reports/QA_ORCH-0802_STRIPE_CONNECT_EMBEDDED_COMPONENTS_REPORT.md`
- Commits on `Seth`: see `git log --oneline origin/main..Seth` after CLOSE push
