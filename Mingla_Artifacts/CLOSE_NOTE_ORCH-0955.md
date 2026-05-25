# CLOSE NOTE — ORCH-0955 [Native Stripe Tax for Platforms]

**Date:** 2026-05-25.
**Closer:** Claude `mingla-orchestrator` (routed from Codex `orchestrator-mingla`; per full Claude/Codex parity).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0955-[native-stripe-tax]/` on branch `ORCH-0955-native-stripe-tax` (HEAD `122000e6` pre-CLOSE; reaped post-merge).
**Verdict:** PASS Grade A.
**QA evidence:** `Mingla_Artifacts/reports/QA_ORCH-0955_NATIVE_STRIPE_TAX_RETEST_2_REPORT.md` (P0:0 P1:0 P2:0 P3:0 P4:1).

---

## What shipped (plain English)

Native paid checkout on consumer + business mobile apps now collects buyer billing address in the cart sheet, calls Stripe Tax for Platforms to compute the correct tax amount, charges the buyer a tax-inclusive total via PaymentSheet, commits the Stripe Tax transaction after successful payment, and reverses that transaction (full or partial) when an order is refunded. Brand admins manage their Stripe Tax registrations via a new Mingla-hosted page that mounts Stripe's embedded `<ConnectTaxRegistrations>` + `<ConnectTaxSettings>` components — the old Stripe Express Dashboard login-link flow is gone (it would have broken under ORCH-0954's dashboard:'none' cutover). Buyer email receipts now render a Tax row above the Total when tax was charged. The ORCH-0953 region gate (which disabled native paid in all countries pending tax support) is fully deleted; native paid is now universal across Stripe-supported countries.

## Step 0.5 — Regression-test gate SATISFIED

- **Implementor happy-path** at `supabase/functions/__tests__/orch_0955_native_stripe_tax.test.ts` — 17 tests covering T-IH-01..T-IH-13 + extensions. `fails-on-revert verified at d2106b21499a6b3c04e0259a2d76a4440f0cb2c4` (implementor's reverse-apply proof on a temp worktree confirmed all tests fail when the implementation is reverted while the test file is preserved).
- **Tester adversarial** at `supabase/functions/_shared/email/__tests__/shell.test.ts` — 10 tests attacking jurisdiction-label rendering in HTML + text email bodies, Tax-row scoping (only renders when `tax_amount_cents > 0`), and per-jurisdiction breakdown layout. Different angle from implementor's payload-shape happy path. Both immutable per append-only CI.

## Step 1.5 — DIAG marker reap

`grep -rn "\[ORCH-0955-DIAG\]" mingla-business/src mingla-business/app app-mobile/src supabase/functions mingla-admin/src` → **ZERO matches**. PASS.

## Step 5 Deprecation Extension — EXECUTED

ORCH-0955 deletes the `brand-stripe-tax-dashboard-link` edge function family and the ORCH-0953 region-gate helper. Triggers the 8-substep extension:

| Substep | Action | Status |
|---|---|---|
| 5a | NEW memory file `feedback_brand_stripe_tax_dashboard_link_decommissioned.md` (frontmatter `type: feedback`, status: ACTIVE) | DONE |
| 5b | `MEMORY.md` index updated — new entry under Product Positioning section; prior `feedback_stripe_native_paid_region_gated.md` entry flipped to SUPERSEDED | DONE |
| 5c | Existing memory file scan for `brand-stripe-tax-dashboard-link` / `stripeTaxDashboardLink` / `NATIVE_PAID_ALLOWED_REGIONS` / `isNativePaidAllowedForBrand` — only the region-gate memory entry referenced it; updated (5b above). No other live memory references | DONE |
| 5d | Skill definition reviews — grep `.claude/skills/*/SKILL.md` for the legacy tokens; no production references found (only example snippets in agent-prompts that are documentation-as-data) | DONE — preserve as-is |
| 5e | Invariant registry — `I-PROPOSED-EMBEDDED-TAX-UI` codified (and four siblings: `I-PROPOSED-NATIVE-TAX-COVERAGE`, `I-PROPOSED-TAX-COMMIT-ON-SUCCESS`, `I-PROPOSED-TAX-REVERSAL-ON-REFUND`, `I-PROPOSED-REGION-GATE-DELETED`) | DONE — see decision log entries |
| 5f | Decision log entries: (1) `brand-stripe-tax-dashboard-link` decommissioned per ORCH-0955 / operator decision COMMS-0001 2026-05-24. (2) `brand-stripe-tax-account-session` + embedded `<ConnectTaxRegistrations>` + `<ConnectTaxSettings>` is canonical brand-side tax-config UI. (3) `NATIVE_PAID_ALLOWED_REGIONS` env + `_shared/stripeTax.ts` are dead concepts; native paid is universal across Stripe-supported countries per operator decision 2026-05-24 | DONE |
| 5g | PRODUCT_SNAPSHOT + ROOT_CAUSE_REGISTER — neither described the deprecated system as live; no updates needed | N/A |
| 5h | Backup snapshot retention — none (no `_archive_orch_0955_*` table created) | N/A |

**Deployed `brand-stripe-tax-dashboard-link` v65 left platform-resident.** The CLI doesn't auto-delete edge functions when source is removed; the deployed function lingers but is unreachable from any caller (legacy-token scan returns zero hits in repo). Formal `supabase functions delete brand-stripe-tax-dashboard-link --project-ref gqnoajqerqhnvulmnyvv` is a future hygiene step or operator one-off cleanup. Not blocking close.

## Cross-surface scope

Per ORCH INTAKE Affected Surfaces:
- Consumer iOS / Android (`app-mobile/`): cart-sheet `CartTaxPreview` component, billing-address form, tax-inclusive PaymentSheet, receipt rendering.
- Business iOS / Android (`mingla-business/`): mirror cart-sheet/preview, plus brand-side `BrandPaymentsView` Tax CTA rewrite + new `/connect-tax-registrations` page.
- Buyer-anon web: NOT in scope (already taxed via ORCH-0804 `automatic_tax: { enabled: true }` on Checkout Sessions).
- Admin web: NOT in scope (no Stripe surface per ORCH-0954 F-13).
- Business web preview: NEW `/connect-tax-registrations` page is universal-route and rendered in the in-app browser session.

## DEPLOY status

- **Migration:** `20260727000000_orch_0955_native_stripe_tax.sql` applied to remote 2026-05-25. Verified via `supabase migration list --linked`.
- **5 edge functions deployed via local CLI** (Supabase production, TEST mode):
  - `ticket-checkout-create` v103 → **v110**
  - `refund-order` v70 → **v76**
  - `brand-stripe-tax-account-session` new → **v1**
  - `ticket-confirmation-dispatch` v91 → **v97**
  - `stripe-webhook` v128 → **v137** (`verify_jwt: false` preserved — critical)
- **HELD separately pending Seth authorization:** Stripe TEST→LIVE secret flip per ORCH-0953's `Stripe-live-values.md` (gitignored) batch command. ORCH-0955 ships under TEST mode; the production live-mode flip is the SEPARATE operator-authorized action that turns real-money tax collection on.

## Comms ledger

- **COMMS-0001 RESOLVED.** ORCH-0955 delivered the absorbed scope (`brand-stripe-tax-dashboard-link` rewrite). All 4 ORCH-0955 sides (forensics + orchestrator + implementor + tester) acked.
- **COMMS-0002 RESOLVED for ORCH-0955.** `ORCH_0955_BACKEND_ALLOWLIST` added to `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in the implementation commit; QA retest 1 + 2 confirmed C7 PASSES with the allowlist (including `shell.test.ts` added in retest fix). All ORCH-0955 sides acked.
- **COMMS-0003 RESOLVED for ORCH-0955.** SPEC §3 cites Stripe docs URLs inline for every parameter/enum (Tax for Tickets integration guide, Connect direct-charge tax docs, AccountSessions API); tester retest 2 verified embedded Tax components against Stripe API docs. Implementor + tester + orchestrator (this close) acked.

## Held items (carry-forward, NOT blocking close)

| Item | Owner | Trigger to close |
|---|---|---|
| Stripe TEST→LIVE secret flip | Seth | Operator-authorized batch action per `Stripe-live-values.md` |
| Live-fire end-to-end smoke against real-money brand | Seth + Codex `tester-mingla` | Post-secret-flip + first live brand (ORCH-0954 dependency partially resolved) |
| Platform-side delete of deployed `brand-stripe-tax-dashboard-link` v65 | Either orchestrator (future hygiene ORCH) | When operator confirms zero risk of stale-cached-client callers |
| Broad app typecheck debt (pre-existing in `mingla-business/`, `app-mobile/`) | Separate cleanup ORCH | Not introduced by ORCH-0955 (implementor verified scoped files clean) |

## Suggested commit message

```text
Close ORCH-0955 [Native Stripe Tax for Platforms]: 3-step Stripe Tax wired to native PI + embedded Tax UI

Closes: ORCH-0955
QA verdict: PASS Grade A (P0:0 P1:0 P2:0 P3:0 P4:1) at Mingla_Artifacts/reports/QA_ORCH-0955_NATIVE_STRIPE_TAX_RETEST_2_REPORT.md
Step 0.5: happy-path supabase/functions/__tests__/orch_0955_native_stripe_tax.test.ts (17 tests, fails-on-revert at d2106b21) + adversarial supabase/functions/_shared/email/__tests__/shell.test.ts (10 tests, jurisdiction-label angle)
DIAG reap: 0 ORCH-0955 markers
Step 5: brand-stripe-tax-dashboard-link decommissioned (memory + invariant + decision-log entries)
Deploy: migration 20260727000000 applied 2026-05-25; 5 edge fns deployed (verify_jwt preserved on stripe-webhook); Stripe TEST→LIVE secret flip held separately pending Seth authorization
COMMS: COMMS-0001 RESOLVED; COMMS-0002 + COMMS-0003 RESOLVED for ORCH-0955
Worktree: ~/Desktop/mingla-orchs/ORCH-0955-[native-stripe-tax]/ on branch ORCH-0955-native-stripe-tax (reaped post-merge)
```

`[deploy]` tag NOT required — ORCH-0955 touches `mingla-business/src/` + `app/connect-tax-registrations/`, BUT the buyer-web checkout path was NOT modified (web already taxed via ORCH-0804). The new `/connect-tax-registrations` page is universal-route and IS a Vercel-rendered surface for the in-app browser opening pattern. **Per the Vercel `[deploy]` decision matrix: YES, tag required** (mingla-business `app/` directory touched). Adjusting commit subject to `Close ORCH-0955 [deploy] [Native Stripe Tax for Platforms]`.

## Next dispatch

Per the dispatch instruction, live-deploy authorization is routed separately — not part of this CLOSE. After merge + reap, next priority work on the board returns to operator direction.
