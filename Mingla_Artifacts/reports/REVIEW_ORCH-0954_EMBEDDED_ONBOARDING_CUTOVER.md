# REVIEW — ORCH-0954 [Embedded onboarding cutover + Stripe-managed risk]

**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-24
**Verdict:** **PASS — DEPLOY AUTHORIZED (subject to ordered preconditions)**
**Inputs reviewed:**
- `Mingla_Artifacts/specs/SPEC_ORCH-0954_EMBEDDED_ONBOARDING_CUTOVER.md`
- `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-0954_EMBEDDED_ONBOARDING.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0954_EMBEDDED_ONBOARDING_CUTOVER.md`
- Code at commit `316da320` + report commit `5517ca39`

---

## Verdict rationale

Codex implementor delivered all 12 SPEC success criteria with the two operator-deferred items (DEC-159 text → CLOSE; live-fire smokes → tester) correctly flagged as out-of-implementor-scope. Independent spot-checks against the actual code confirm the report's file:line evidence; no embellishment found.

## Spot-check ledger

| Claim | Verification | Result |
|---|---|---|
| `STRIPE_MANAGED_RISK_CONTROLLER` constant pins `losses_collector:"stripe"` + `fees_collector:"account"` + `dashboard:"none"` | grep `_shared/stripeBlueprintClient.ts:14-22`; spread used at line 189 inside `createRecipientAccount` | PASS |
| `createAccountSession()` uses `STRIPE_RAK_ONBOARD` only (no `STRIPE_SECRET_KEY` fallback) | `_shared/stripeBlueprintClient.ts:204-217` — `envVarNames: ["STRIPE_RAK_ONBOARD"]` is the only entry; preserves ORCH-0953 fail-close | PASS |
| All three `controller_dashboard_type` writes flipped from `"express"` to `"none"` | `brand-stripe-onboard/index.ts:391` + `brand-stripe-onboard/index.ts:728` + `_shared/stripeWebhookRouter.ts:204` | PASS |
| `brand-stripe-tax-dashboard-link/` untouched per COMMS-0001 | `git log --oneline -- supabase/functions/brand-stripe-tax-dashboard-link/` returns only the ORCH-0804 close; no ORCH-0954 commits | PASS |
| Locked CTA text **"Manage payouts & tax"** | `BrandPaymentsView.tsx:326` + `:344` + `accessibilityLabel:"Manage payouts and tax"` at `:350` | PASS |
| Locked legal URLs | `connect-onboarding.tsx:219-221` — exact strings `https://www.usemingla.com/terms-of-service/` (used for both `fullTermsOfServiceUrl` and `recipientTermsOfServiceUrl`) + `https://www.usemingla.com/privacy-policy/` | PASS |
| `BUSINESS_WEB_ORIGIN` fail-close-if-missing, no hard-coded fallback | `brand-stripe-onboard/index.ts:46-49` + `brand-stripe-account-session/index.ts:28-31` both throw on missing env | PASS |
| Two new strict-grep CI gates registered | `orch-0954-controller-props-pinned.mjs` + `orch-0954-rak-scope-pinned.mjs` exist; both registered in `.github/workflows/strict-grep-mingla-business.yml` at lines 1252 + 1263 | PASS |
| Happy-path regression test at real path | `supabase/functions/brand-stripe-onboard/__tests__/embeddedOnboarding.happy.test.ts` exists | PASS |
| Fails-on-revert proof captured | Implementation report §Verification documents revert at commit `316da320` → test FAILED with `Actual: application / Expected: stripe`, restored → test PASSED | PASS |

## ORCH-0840 Step 0.5 gate status

- **(a) Implementor happy-path regression** — PASS. Test path real, fails-on-revert verified.
- **(b) Tester adversarial regression** — DEFERRED to tester (correct downstream owner). Step 0.5 evaluated again at CLOSE; not a REVIEW blocker.

## REVIEW checklist

- [x] Root cause proven — controller-prop mismatch (F-2) + 3 write sites (F-3) + dead Mingla-hosted onboarding page (F-4) all closed
- [x] Scope held — Tax dashboard link explicitly untouched per COMMS-0001; consumer mobile untouched; no DB migration; no Stripe Dashboard mutations
- [x] No hidden fallback paths — `BUSINESS_WEB_ORIGIN` fail-close enforced in both edge functions; no `STRIPE_SECRET_KEY` shadow path
- [x] Response shape truthful — `connect-onboarding.tsx` ships `onExit` + `onLoadError` + `onStepChange`; `connect-account-management.tsx` ships error states + manual Done
- [x] Real fix, not symptom mask — controller constant pinned in source + 2 CI gates enforce the fix structurally
- [x] Constitutional compliance — Path B preserved (I-PROPOSED-O re-affirmed); embedded components mount in Mingla-hosted web pages opened via `expo-web-browser`
- [x] Evidence chain complete — file:line citations match real code
- [x] Documents updated — SPEC §8 resolved with operator answers; implementation report committed

## Minor non-blocking findings (CLOSE follow-ups)

1. **Investigation + SPEC files are untracked in git.** `git status --short` shows `Mingla_Artifacts/investigations/` and `SPEC_ORCH-0954_EMBEDDED_ONBOARDING_CUTOVER.md` as untracked in the worktree. They need to land in the CLOSE commit alongside the DEC-159 entry, the WORLD_MAP update, and the deploy artifact. Orchestrator owns this at CLOSE.
2. **`/ui-ux-pro-max` invocation not cited in implementor report.** Mingla memory rule requires pre-flight design via that skill for UI-touching work. Result looks sound (CTA placement + management page structure) but compliance is undocumented. Non-blocking; advise tester to verify visual hygiene against ui-ux-pro-max patterns during live-fire.
3. **Pre-existing TypeScript errors in `mingla-business`** noted in implementor's "Partial / Blocked Verification" section. Filtered rerun confirms zero ORCH-0954 file errors. Pre-existing tech debt — own as a separate ORCH if it ever becomes a launch blocker. Not in scope here.
4. **DEC-159 entry text exists in SPEC §2** but not yet written into `Mingla_Artifacts/DECISION_LOG.md`. Landing this is a CLOSE task per SPEC §2.

---

## Deploy authorization

REVIEW authorizes the following deploy sequence. Operator owns step 1 (secret write); orchestrator owns step 2 (edge-function deploys via local CLI). DO NOT run any step out of order.

### Step 1 — Operator writes the new Supabase secret (BEFORE step 2)

```bash
/Users/sethogieva/bin/supabase secrets set --project-ref gqnoajqerqhnvulmnyvv BUSINESS_WEB_ORIGIN="https://business.usemingla.com"
```

The new edge functions fail-close on missing secret, so deploying before this step would create a deploy that crashes on first invocation. Order matters.

### Step 2 — Orchestrator deploys edge functions (AFTER step 1)

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0954-[embedded-onboarding-cutover]" && \
  /Users/sethogieva/bin/supabase functions deploy brand-stripe-onboard --project-ref gqnoajqerqhnvulmnyvv && \
  /Users/sethogieva/bin/supabase functions deploy brand-stripe-account-session --project-ref gqnoajqerqhnvulmnyvv && \
  /Users/sethogieva/bin/supabase functions deploy stripe-webhook --project-ref gqnoajqerqhnvulmnyvv
```

- `stripe-webhook` is included because `_shared/stripeWebhookRouter.ts` changed (line 204 write-site flip). Per orchestrator deploy rule: any function whose source — directly or via `_shared/` import — was touched must be redeployed.
- DO NOT deploy `brand-stripe-tax-dashboard-link` — out of scope per COMMS-0001 + this REVIEW.

### Step 3 — Orchestrator verifies post-deploy

```bash
mcp__supabase__list_edge_functions
```

Confirm version bumps on the three deployed functions. Preserve each function's existing `verify_jwt` setting (the CLI does this automatically via `supabase/config.toml`; no manual override).

### NOT included in this deploy authorization

- No `supabase db push --linked` — SPEC confirms zero migrations required.
- No Stripe Dashboard mutations — RAK already carries `Account Sessions: Write` on both test and live keys (operator verified 2026-05-24).
- No EAS OTA — UI lives at `mingla-business` (web), not `app-mobile`. Vercel build is triggered by the CLOSE commit `[deploy]` tag, not by this REVIEW.

---

## Routing after deploy

1. Operator step 1 (secret) → orchestrator step 2 (deploys) → orchestrator step 3 (verify) → Claude `mingla-tester` for SPEC §6 live-fire validation on a fresh TEST brand (both smokes — onboarding + account management).
2. If tester returns PASS or CONDITIONAL PASS → orchestrator CLOSE (lands DEC-159 in DECISION_LOG, opens PR, satisfies pre-merge gate, merges, reaps worktree).
3. If tester returns FAIL on Smoke B specifically (the `<ConnectAccountManagement>` Preview/Demo risk per SPEC §6) → orchestrator + operator re-open scope reactively per resolved §8 Q4. No pre-spec'd fallback exists.

