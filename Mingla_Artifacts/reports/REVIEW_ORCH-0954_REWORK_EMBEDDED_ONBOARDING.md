# REVIEW — ORCH-0954 REWORK [Embedded onboarding cutover + Stripe-managed risk]

**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-25
**Verdict:** **PASS — DEPLOY AUTHORIZED AND EXECUTED**
**Inputs reviewed:**
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0954_REWORK_EMBEDDED_ONBOARDING.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0954_AMENDMENT_EMBEDDED_ONBOARDING.md`
- `Mingla_Artifacts/reports/REVIEW_ORCH-0954_AMENDMENT.md`
- `Mingla_Artifacts/tests/TEST_ORCH-0954_LIVE_FIRE.md`
- Branch HEAD `061ee81d` (report commit) + `97844fd6` (rework commit)

---

## Verdict rationale

Codex implementor delivered the three required fixes (§A1 enum flip, §A2 server-payload deletion, §A3 per-env build gate + α-1 origin override) plus the strict-grep gate update and the new contract test. Independent spot-checks against the actual rework commit confirm every claim in the implementation report; no embellishment found.

## Spot-check ledger

| Amendment requirement | Code verification | Result |
|---|---|---|
| §A1 `STRIPE_MANAGED_RISK_CONTROLLER` → `fees_collector: "stripe"` | grep `_shared/stripeBlueprintClient.ts:14-22` — all three values present: `losses_collector:"stripe"`, `fees_collector:"stripe"`, `dashboard:"none"` | PASS |
| §A2 server-side `collection_options` removed from `brand-stripe-onboard` | `brand-stripe-onboard/index.ts:696-704` — Account Session call ships ONLY `external_account_collection: true` under `features` | PASS |
| §A2 server-side `collection_options` removed from `brand-stripe-account-session` | `brand-stripe-account-session/index.ts:84-90` — onboarding-surface builder ships ONLY `external_account_collection: true` | PASS |
| §A2 `<ConnectAccountOnboarding>` keeps `collectionOptions` as JSX prop | `mingla-business/app/connect-onboarding.tsx` — file intentionally unchanged per implementor; React component support preserved | PASS |
| §A3 per-env `pk_live_`/`pk_test_` gate keyed by `VERCEL_ENV` | `mingla-business/app.config.ts:85-115` — production requires `pk_live_`, preview/development requires `pk_test_`, local dev requires `pk_test_`, all paths fail-close; unsupported `VERCEL_ENV` throws | PASS |
| §A3 α-1 explicit origin-override allowlist + fail-close | `_shared/businessWebOrigin.ts` — production literal `https://business.usemingla.com` + Vercel preview regex `^https://mingla-business-[a-z0-9-]+\.vercel\.app$`; non-string override → fail-close; unrecognized override → fail-close | PASS |
| §A3 override wired in both edge functions | `brand-stripe-onboard/index.ts:251` + `brand-stripe-account-session/index.ts:133` validate the override before URL construction | PASS |
| §A3 client passes override on both calls | `brandStripeService.ts:161` + `brandStripeAccountSessionService.ts:29` send `business_web_origin_override` when present | PASS |
| §A4 new implementor happy-path contract test | `supabase/functions/_shared/__tests__/stripeBlueprintClient.contract.test.ts` — happy-path asserts `fees_collector: "stripe"`; payload-shape assertion rejects server-side `collection_options` | PASS |
| §A4 fails-on-revert proof at different anchors | Implementation report §D documents (1) combined enum + collection_options revert → red, (2) collection_options-only revert → red, (3) restore → green | PASS |
| §A6 strict-grep gate updated to assert new enum | `.github/scripts/strict-grep/orch-0954-controller-props-pinned.mjs:28-40` asserts `losses_collector:"stripe"`, `fees_collector:"stripe"`, `dashboard:"none"` | PASS |
| §A6 ORCH-0863 backend allowlist extended | `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs:752` adds `_shared/businessWebOrigin.ts`, `:756` adds contract test path | PASS |
| Scope guard — `brand-stripe-tax-dashboard-link/` untouched | `git log -- supabase/functions/brand-stripe-tax-dashboard-link/` returns only ORCH-0804 close (commit `291f6e93`); no ORCH-0954 rework commits | PASS |
| Scope guard — no `supabase db push` | implementation report confirms no migrations created or modified | PASS |
| Scope guard — no secret writes, no key rotation | implementation report confirms; `BUSINESS_WEB_ORIGIN` is already set; no `STRIPE_RAK_ONBOARD` edits | PASS |

## REVIEW checklist

- [x] Root cause proven — three fixes each trace to specific tester-CLI proof + inline Stripe docs citations in the amendment
- [x] Scope held — only the 4 expected surfaces touched (controller constant, 2 edge-function payloads, 1 web app.config gate, 1 new shared origin module, 1 new contract test, 1 gate update)
- [x] No hidden fallback paths — every fail-close path verified; non-string + unrecognized override both reject; missing VERCEL_ENV variable + wrong prefix all throw at config-eval
- [x] Real fix, not symptom mask — controller constant + strict-grep gate make regression structurally impossible; per-env gate is keyed by `VERCEL_ENV` not by string-matching the key prefix in isolation
- [x] Constitutional compliance — I-PROPOSED-O (Path B) preserved; ORCH-0953 `pk_live_` fail-close preserved as production-side behavior with parallel `pk_test_` fail-close for preview/dev
- [x] Evidence chain complete — every §A10 success criterion has file:line evidence in implementation report; fails-on-revert proof captured at two different anchors (enum AND collection_options)
- [x] Documents updated — amendment + REVIEW (both phases) + implementation report all landed in worktree; DEC-159 amended text staged for CLOSE

## Post-REVIEW deploy execution (this turn)

Operator authorization carried from prior `take over` directive 2026-05-25. Orchestrator executed:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0954-[embedded-onboarding-cutover]" && \
  /Users/sethogieva/bin/supabase functions deploy brand-stripe-onboard --project-ref gqnoajqerqhnvulmnyvv && \
  /Users/sethogieva/bin/supabase functions deploy brand-stripe-account-session --project-ref gqnoajqerqhnvulmnyvv
```

Post-deploy version verification via `mcp__supabase__list_edge_functions`:

| Function | Version | verify_jwt | Source path | Updated |
|---|---|---|---|---|
| `brand-stripe-onboard` | **98** | `true` (preserved) | `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0954-[embedded-onboarding-cutover]/supabase/functions/brand-stripe-onboard/index.ts` | 2026-05-25 (just now) |
| `brand-stripe-account-session` | **6** | `true` (preserved) | `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0954-[embedded-onboarding-cutover]/supabase/functions/brand-stripe-account-session/index.ts` | 2026-05-25 (just now) |
| `stripe-webhook` | 139 (UNCHANGED) | `false` (preserved) | anchor `main` | not touched this round |
| `brand-stripe-tax-dashboard-link` | 67 (UNCHANGED) | `true` | anchor `main` | scope guard held |

Both deploys verify_jwt-preserved + sourced from the ORCH-0954 worktree. No out-of-scope function touched.

---

## Vercel per-env publishable-key checklist (operator-owned, BEFORE tester rerun)

The new per-env gate at `mingla-business/app.config.ts:85-115` requires both production AND preview/development to have correct env vars. Until they're set, Vercel Preview builds will fail at config-eval.

| Vercel environment | Variable | Required value | Status |
|---|---|---|---|
| Production | `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_...` | ALREADY SET (from ORCH-0953) — no action |
| Preview | `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_...` | **MUST BE SET BY OPERATOR** before tester rerun |
| Development | `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_...` | Recommended (covers local-via-Vercel-CLI) |

Operator step: Vercel Dashboard → mingla-business project → Settings → Environment Variables → Add new variable `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` with value `pk_test_...` (from Stripe test keys), scope to "Preview" environment ONLY (do NOT overwrite Production). Optionally add same for "Development" if you build via Vercel CLI locally.

After setting: trigger any new commit on the per-ORCH branch (or open a fresh PR) so Vercel builds the Preview with the corrected env var. The Preview URL becomes the validation host for SPEC §6 tester retest.

No Supabase secret write needed — `BUSINESS_WEB_ORIGIN` is already set and the new per-request `business_web_origin_override` handles preview routing.

No Stripe key edits / rotations.

---

## Routing — next two phases

1. **Operator step (required next):** set Vercel Preview `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...` per the checklist above.
2. **Orchestrator step (after operator):** push an empty commit on the ORCH-0954 branch (or rebuild last commit) to trigger Vercel Preview build with the new env var. Verify the Preview URL renders + the embedded components load against a TEST Account Session.
3. **Claude `mingla-tester` step (after preview is green):** run SPEC §6 against the Vercel Preview URL using Playwright for visual evidence + Stripe TEST API contract proof. Capture screenshots showing `<ConnectAccountOnboarding>` + `<ConnectNotificationBanner>` + `<ConnectAccountManagement>` rendering. Write the adversarial regression test per §A4 if not already covered.
4. **Orchestrator CLOSE (after tester PASS):** land amended DEC-159 in `DECISION_LOG.md`, update WORLD_MAP + MASTER_BUG_LIST + COVERAGE_MAP + PRODUCT_SNAPSHOT + PRIORITY_BOARD + AGENT_HANDOFFS, flip I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED to ACTIVE in `INVARIANT_REGISTRY.md`, open final PR → main with the rework commits, satisfy pre-merge gate, merge, reap worktree.

---

## Open follow-ups

- I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED CI gate deferred to future META-ORCH (per amendment §A5).
- Pre-existing TypeScript errors in `mingla-business` unrelated to ORCH-0954 surface — no action this ORCH.
- Worktree reap deferred to CLOSE Step 1.7.
