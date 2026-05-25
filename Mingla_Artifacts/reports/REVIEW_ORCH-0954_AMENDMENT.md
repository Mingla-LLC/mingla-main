# REVIEW — ORCH-0954 SPEC AMENDMENT [Embedded onboarding cutover + Stripe-managed risk]

**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-25
**Verdict:** **APPROVED — DISPATCH AUTHORIZED with §A3 = Option α locked**
**Input reviewed:** `Mingla_Artifacts/specs/SPEC_ORCH-0954_AMENDMENT_EMBEDDED_ONBOARDING.md`

---

## REVIEW checklist

- [x] Root cause proven — three findings each backed by Stripe CLI evidence in TEST report + inline Stripe docs URL citations in the amendment
- [x] Scope held — amendment touches only §A1 enum, §A2 server payloads, §A3 host strategy, §A4 regression tests, §A5/A6/A7 docs; no `brand-stripe-tax-dashboard-link/`, no revert, no live-key validation, no code
- [x] Hidden fallback paths — amendment §A3 α-1 explicitly fail-closes on unrecognized origin override; per-env `app.config.ts` gate fail-closes when key prefix doesn't match `VERCEL_ENV`
- [x] Real fix, not symptom mask — controller-prop constant correction is structural; `collection_options` deletion is structural; per-env build gate is structural
- [x] Constitutional compliance — preserves I-PROPOSED-O (Path B unchanged), preserves existing pk_live_ fail-close as production-side behavior, adds I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED (DRAFT)
- [x] Evidence chain complete — every Stripe parameter in §A1 and §A2 cites the canonical Stripe docs URL inline (first SPEC to do so under the new memory rule [[external-api-docs-verified]])
- [x] Documents updated — amendment file written; DEC-159 amended text staged for CLOSE; new memory rules already landed by orchestrator on 2026-05-25

## §A3 host-strategy decision

**LOCKED: Option α — Vercel Preview env with `pk_test_` + per-env `app.config.ts` gate, α-1 origin-override.**

Rationale: lowest friction, no new infrastructure, preserves production safety, automatic per-PR. Operator's "take over" (2026-05-25) authorized the orchestrator to pick. Option β (separate staging subdomain) deferred to a future ORCH if α proves insufficient in practice. Option γ (CLI-only) rejected — Stripe's own docs flag `<ConnectAccountManagement>` as "Preview/Demo behaves differently than live mode," so visual evidence on the rendered component is required.

α-1 (explicit `business_web_origin_override` parameter) preferred over α-2 (request-header inference) per amendment §A3 — explicit beats inferred for security-sensitive routing. Implementor wires the override allowlist to accept only `https://business.usemingla.com` (production) and `https://mingla-business-*.vercel.app` (preview wildcard).

## Locked operator-decision inputs (for implementor dispatch)

- **Q1 §A1 enum:** `fees_collector: "stripe"` ✓ (corrected from prior `"account"`)
- **Q2 §A2 payloads:** delete `collection_options` from both edge functions ✓
- **Q3 §A3 host strategy:** Option α + α-1 ✓ (locked above)
- **Q4 §A4 tests:** EITHER real-API contract OR documented-error-shape mock — implementor picks based on Stripe TEST secret availability in CI
- **Q5 DEC-159:** amended text per §A6 — lands at CLOSE
- **Q6 COMMS-0003:** orchestrator writes pre-dispatch (this turn)

## Out of scope (re-confirmed)

- No revert of PR #204
- No touch to `brand-stripe-tax-dashboard-link/`
- No live-key validation
- No CI gate for I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED (deferred to future META-ORCH)
- No mobile native fail-close updates (`app-mobile/`)

## Routing

Codex `implementor-mingla` executes the rework. After implementor returns: orchestrator REVIEW → deploy 2 edge functions (`brand-stripe-onboard`, `brand-stripe-account-session`) → operator writes Vercel per-env env vars for `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` (Preview = `pk_test_...`, Production = `pk_live_...` already set) → Claude `mingla-tester` SPEC §6 retest against Vercel Preview URL with Playwright + Stripe TEST API → CLOSE.
