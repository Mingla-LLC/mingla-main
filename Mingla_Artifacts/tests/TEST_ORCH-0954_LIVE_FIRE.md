# TEST — ORCH-0954 [Embedded onboarding cutover + Stripe-managed risk] — RETEST 3

**Tester:** Claude `mingla-tester`
**Date:** 2026-05-25
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0954-[embedded-onboarding-cutover]/`
**Branch:** `ORCH-0954-embedded-onboarding-cutover` (HEAD `aded80628`)
**Verdict:** **CONDITIONAL PASS — SPEC §6 browser-render evidence satisfied; rework artifacts MUST BE COMMITTED + SSR-fix discrepancy resolved before CLOSE**

---

## Executive result

The stated retest goal (SPEC §6 / §A10 browser-render evidence now that edge behavior is green) is **met by the implementor's local-validation-host evidence**. Stripe embedded `<ConnectAccountOnboarding>`, `<ConnectAccountManagement>`, and two `<ConnectNotificationBanner>` instances were observed rendering iframes from `connect-js.stripe.com` against fresh TEST-mode Account Sessions, and interaction breadcrumbs show both primary buttons accepted clicks (`stripe_user_authentication` step on onboarding; loading-state on management). The known TEST-mode limitations (hidden banner on un-onboarded account, user-auth prompt on management) are expected Stripe behavior, NOT bugs.

However, three discipline issues block a clean PASS verdict and require operator/orchestrator action before CLOSE:

1. **All rework artifacts are uncommitted.** `git status` shows 5 IMPLEMENTATION reports, REVIEW report, new strict-grep gate, adversarial tests, and 19 evidence files as untracked. None of this appears in `git diff origin/main...HEAD --name-only` — the branch tip `aded80628` is the empty `[deploy]` commit. ORCH-0840 regression-test gate explicitly requires "both tests appear in `git diff origin/main...HEAD --name-only` for the closing PR." Currently violated.
2. **Implementor's claimed SSR-fix code changes do not exist in the actual code.** `IMPLEMENTATION_ORCH-0954_REWORK_BROWSER_RENDER_VALIDATION_HOST.md` line 23-26 claims the `@stripe/connect-js` static import was swapped to `@stripe/connect-js/pure` and that `@stripe/react-connect-js` is now a dynamic import. The actual files at `mingla-business/app/connect-onboarding.tsx:35-36` and `mingla-business/app/connect-account-management.tsx:17-18` still contain the static, non-pure imports — `git diff HEAD` returns empty for both files. Either the claim is wrong or the code change was lost before commit.
3. **The new strict-grep gate `orch-0954-connect-js-pure-import.mjs` FAILS against the actual code.** Local run output: `ORCH-0954 connect-js pure-import strict-grep FAILED: mingla-business/app/connect-onboarding.tsx must import loadConnectAndInitialize from @stripe/connect-js/pure.` If this gate is committed without the corresponding code change, CI fails and the close PR can't merge.

Together, these are P1 (high) findings. They do not invalidate the browser-render evidence — Stripe components did render and interact correctly. But the branch state is internally incoherent and must be repaired before the close PR opens.

---

## Inputs read

- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0954_REWORK_BROWSER_RENDER_VALIDATION_HOST.md` (untracked)
- `Mingla_Artifacts/tests/evidence/orch-0954-local-validation-browser-render-evidence.json` (untracked)
- `Mingla_Artifacts/reports/REVIEW_ORCH-0954_REWORK_EMBEDDED_ONBOARDING.md` (untracked — my prior orchestrator REVIEW)
- `Mingla_Artifacts/specs/SPEC_ORCH-0954_AMENDMENT_EMBEDDED_ONBOARDING.md` (committed; §6 + §A10)
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0954_REWORK_EMBEDDED_ONBOARDING.md` (committed at `061ee81d`)
- `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` — COMMS-0001, 0002, 0003 all WARN, factored in; `tester+claude (ORCH-0954)` ack will be appended

---

## Comms ledger

Read before work. No `BLOCK + OPEN` entries. COMMS-0001 still active (scope guard — `brand-stripe-tax-dashboard-link/` untouched ✓). COMMS-0002 active (ORCH-0863 gate — `ORCH_0954_BACKEND_ALLOWLIST` already extended). COMMS-0003 active (external-API docs verification — implementor cited Stripe docs URLs in the original amendment). All factored.

---

## Live deploy state (independently verified via `mcp__supabase__list_edge_functions`)

| Function | Version | verify_jwt | Source | Status |
|---|---|---|---|---|
| `brand-stripe-onboard` | 98 | `true` (preserved) | ORCH-0954 worktree | ACTIVE |
| `brand-stripe-account-session` | 6 | `true` (preserved) | ORCH-0954 worktree | ACTIVE |
| `stripe-webhook` | 139 (unchanged) | `false` (preserved) | anchor `main` | ACTIVE — not touched this round |
| `brand-stripe-tax-dashboard-link` | 67 (unchanged) | `true` | anchor `main` | scope guard held |

Edge behavior accepted as green per the implementor's prior round (commit `97844fd6`) and orchestrator REVIEW PASS (uncommitted but written 2026-05-25).

---

## Browser-render evidence (the retest scope)

### Screenshots verified present at expected paths

All 6 referenced PNG files exist under `Mingla_Artifacts/tests/evidence/`:
- `orch-0954-local-validation-connect-onboarding.png`
- `orch-0954-local-validation-connect-onboarding-before-click.png`
- `orch-0954-local-validation-connect-onboarding-after-click.png`
- `orch-0954-local-validation-connect-account-management.png`
- `orch-0954-local-validation-connect-account-management-before-click.png`
- `orch-0954-local-validation-connect-account-management-after-click.png`

### Stripe embedded frames observed (per implementor's JSON evidence, cross-referenced to Stripe's component naming)

- `stripe-connect-account-onboarding` — embed frame URL from `connect-js.stripe.com/ui_layer_*.html`, matches canonical Stripe identifier for `<ConnectAccountOnboarding>`
- `stripe-connect-account-management` — matches `<ConnectAccountManagement>`
- `stripe-connect-notification-banner` — observed on BOTH routes — matches `<ConnectNotificationBanner>`

### Interaction proof

- Onboarding primary button click → Stripe emitted `[connect-onboarding] Stripe onboarding step changed { step: stripe_user_authentication }` console breadcrumb. This is Stripe's documented next step for an un-authenticated TEST account, confirming the embedded flow advances correctly on click.
- Management primary button click → embedded Stripe button transitioned to loading state. Standard Stripe acknowledgment that the click was received and the component is processing.

### SC-A1..SC-A7 coverage matrix

| SPEC §A10 success criterion | Evidence | Result |
|---|---|---|
| SC-A1 — Stripe TEST `accounts.create` accepts corrected `STRIPE_MANAGED_RISK_CONTROLLER` | brand-stripe-onboard v98 ACTIVE + test brand `c5f0d96b-8a8e-43e0-904a-e6d5863bc97c` created successfully + Account Session minted (implicit, since the page rendered) | PASS |
| SC-A2 — Stripe TEST `accountSessions.create` accepts corrected onboarding payload | brand-stripe-account-session v6 ACTIVE + Account Session minted for both surfaces + embedded onboarding rendered without 400 from Stripe | PASS |
| SC-A3 — Embedded components render against TEST session | 6 screenshots + 4 component-frame URLs from `connect-js.stripe.com` observed | PASS |
| SC-A4 — Regression tests exist and are green | Implementor contract test at `supabase/functions/_shared/__tests__/stripeBlueprintClient.contract.test.ts` + adversarial tests at `supabase/functions/_shared/__tests__/businessWebOrigin.adversarial.test.ts` AND `supabase/functions/brand-stripe-onboard/__tests__/embeddedOnboarding.adversarial.test.ts` exist | **CONDITIONAL** — both adversarial tests are **untracked** in git; ORCH-0840 gate requires them to appear in the close-PR diff |
| SC-A5 — Amendment + REVIEW + implementation reports landed | Amendment at `specs/SPEC_ORCH-0954_AMENDMENT_EMBEDDED_ONBOARDING.md` is committed; 5 new IMPLEMENTATION reports + the REVIEW + this retest report are uncommitted | **CONDITIONAL** — must be committed before close PR |
| SC-A6 — Strict-grep controller gate updated | `.github/scripts/strict-grep/orch-0954-controller-props-pinned.mjs` asserts new enum + committed at `97844fd6` | PASS |
| SC-A7 — Option α preview key + origin override | `app.config.ts` per-env gate committed; Vercel Preview env var set 2026-05-25 (operator-verified via Vercel API); origin allowlist at `_shared/businessWebOrigin.ts` committed | PASS |

---

## P1 findings (block clean PASS, do NOT block CONDITIONAL PASS but MUST be resolved before CLOSE)

### P1-A — Uncommitted rework artifacts violate ORCH-0840 + worktree discipline

`git status --short | grep -v node_modules` shows the following untracked at HEAD `aded80628`:

```
?? .github/scripts/strict-grep/orch-0954-connect-js-pure-import.mjs
?? Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0954_REWORK_ACCOUNT_SESSIONS_FORM_ENCODING.md
?? Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0954_REWORK_BROWSER_RENDER_VALIDATION_HOST.md
?? Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0954_REWORK_DASHBOARD_NONE_PERSISTENCE.md
?? Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0954_REWORK_FIXED_EDGE_DEPLOY_SOURCE_MATCH.md
?? Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0954_REWORK_STALE_EDGE_DEPLOY_REFRESH.md
?? Mingla_Artifacts/reports/REVIEW_ORCH-0954_REWORK_EMBEDDED_ONBOARDING.md
?? Mingla_Artifacts/tests/evidence/orch-0954-*.{png,json}  (19 files)
?? supabase/functions/_shared/__tests__/businessWebOrigin.adversarial.test.ts
```

ORCH-0840 regression-test gate: "Both tests appear in `git diff origin/main...HEAD --name-only` for the closing PR (so they ship together with the fix; tests staged on a side branch and absorbed via merge magic don't count)." Currently the branch carries zero new test files. Must commit before close PR.

**Fix:** orchestrator (or implementor) commits all 8 report files + 19 evidence files + adversarial test + new strict-grep gate to the per-ORCH branch with `[deploy]` tag and (if any test file modifies existing tests with deletions) `[TEST-MOD-APPROVED ORCH-0954]` token in the commit body.

### P1-B — Implementor's claimed SSR-fix code changes do not exist in actual code

`IMPLEMENTATION_ORCH-0954_REWORK_BROWSER_RENDER_VALIDATION_HOST.md` lines 22-28 claim:
- "Replaced the browser-side-effectful top-level `@stripe/connect-js` import with `@stripe/connect-js/pure`."
- "Removed static top-level `@stripe/react-connect-js` component imports."
- "Dynamically imports `@stripe/react-connect-js` only after browser hydration."

Independent verification at the worktree HEAD `aded80628`:

```
mingla-business/app/connect-onboarding.tsx:35:  ConnectAccountOnboarding,
mingla-business/app/connect-onboarding.tsx:36: from "@stripe/react-connect-js";
mingla-business/app/connect-onboarding.tsx:36:import { loadConnectAndInitialize } from "@stripe/connect-js";

mingla-business/app/connect-account-management.tsx:17:  ConnectAccountManagement,
mingla-business/app/connect-account-management.tsx:18: from "@stripe/react-connect-js";
mingla-business/app/connect-account-management.tsx:18:import { loadConnectAndInitialize } from "@stripe/connect-js";
```

`git diff HEAD -- mingla-business/app/connect-onboarding.tsx mingla-business/app/connect-account-management.tsx` returns empty. The claimed SSR-fix is NOT applied.

The screenshots prove embedded components render with the current static imports — so either the SSR fix is unnecessary for Expo Web export, or the implementor applied the fix during testing and reverted before reporting. Either way, the report-vs-code mismatch must be resolved.

**Fix options:**
- (i) If SSR fix is needed: implementor re-applies the import changes per the report and commits.
- (ii) If SSR fix is unnecessary: implementor or orchestrator strikes the SSR-fix claim from the report and either drops or rewrites the new strict-grep gate (see P1-C).

### P1-C — New strict-grep gate `orch-0954-connect-js-pure-import.mjs` FAILS against actual code

Local run at HEAD `aded80628`:

```
$ node .github/scripts/strict-grep/orch-0954-connect-js-pure-import.mjs
ORCH-0954 connect-js pure-import strict-grep FAILED:
mingla-business/app/connect-onboarding.tsx must import loadConnectAndInitialize from @stripe/connect-js/pure.
```

If this gate is committed and registered in `.github/workflows/strict-grep-mingla-business.yml`, CI fails on every close PR. Direct dependency on P1-B — fix P1-B and this resolves.

**Fix:** depends on P1-B resolution. If (i), gate passes after import change. If (ii), drop the gate file before committing.

---

## P3 observations (informational, do NOT block CLOSE)

- The 19 evidence files in `Mingla_Artifacts/tests/evidence/` include several earlier debugging artifacts (e.g. `orch-0954-account-management-cli-session.png` from the original FAIL, `orch-0954-desktop-chrome-*` from the Vercel-SSO blocker era). These are historical and could be archived rather than committed to main, but the implementor's call.
- The implementor wrote 4 OTHER REWORK reports (account-sessions-form-encoding, dashboard-none-persistence, fixed-edge-deploy-source-match, stale-edge-deploy-refresh) that I did not read in this retest. They appear to document intermediate debugging steps the implementor took. Orchestrator should review whether they're worth preserving in the close commit or just summary-referenced.
- Stripe's documented Preview/Demo caveat for `<ConnectAccountManagement>` remained relevant: TEST account couldn't fully exercise bank-edit / payout-schedule / tax-registration UI because the account wasn't fully onboarded. This is expected Stripe behavior. A future ORCH could optionally walk a TEST brand all the way through KYC to capture deeper management-surface evidence, but the rendering evidence captured here is sufficient for SPEC §6 / §A10.

---

## What was NOT verified (and why)

- Full mobile sim deep-link to embedded onboarding via real `expo-web-browser`: out of scope per SPEC amendment §A3 — local validation host bypasses Vercel SSO but does not exercise mobile RN → WebBrowser deep-link. The amendment explicitly accepted this gap.
- Cross-platform parity (iOS sim + Android emu + web): Phase 0.A exemption — the routes affected here are `mingla-business` WEB ONLY; they don't render natively on iOS/Android (per the in-file comment at `connect-onboarding.tsx:27`). Web validation host evidence satisfies the parity requirement.
- Component-deep behaviors (bank update, payout schedule, tax registration UI): blocked by Stripe TEST-mode user-auth prompt on the un-onboarded TEST account. Operator-impact callout: this is normal Stripe behavior, not a bug. Deeper validation needs a fully-onboarded TEST account, which is out of this retest's scope.

---

## Verdict

**CONDITIONAL PASS.**

Browser-render evidence (the explicit retest goal) is satisfied. Three P1 discipline findings (P1-A uncommitted artifacts, P1-B SSR-fix code missing, P1-C new gate fails) block a clean PASS but do not invalidate the SPEC §6 evidence. Orchestrator can proceed toward CLOSE only after P1-A + P1-B + P1-C are resolved on the per-ORCH branch (committed code matches the gate, all artifacts in git diff, ORCH-0840 regression-test gate satisfied with both adversarial tests landed).

Severity counts: P0: 0 | P1: 3 | P2: 0 | P3: 3 | P4: 0

Confidence: **proven** for the browser-render goal (screenshots + interaction breadcrumbs + Stripe-canonical frame URLs match contract). **proven** for the P1 findings (file-level grep + gate output).

---

## Required remaining work (precise blocker for routing)

1. Decide P1-B path: apply the SSR-fix imports OR drop the SSR-fix claim from the implementor report + drop the new gate.
2. Stage and commit everything currently untracked that belongs to the ORCH-0954 rework (8 reports + REVIEW + adversarial test + new gate if kept + evidence files chosen for permanent archive).
3. Re-run the strict-grep gate suite locally and confirm GREEN against committed code:
   ```
   node .github/scripts/strict-grep/orch-0954-controller-props-pinned.mjs
   node .github/scripts/strict-grep/orch-0954-rak-scope-pinned.mjs
   node .github/scripts/strict-grep/orch-0954-connect-js-pure-import.mjs  # only if kept
   node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
   ```
4. Commit with `[deploy]` tag in subject (production web touch in scope) and `[TEST-MOD-APPROVED ORCH-0954]` token in body if any test file is modified with deletions.
5. Push branch, open close PR → main, satisfy pre-merge gate (all CI green + reviews + mergeable CLEAN), merge via squash, reap worktree.

---

## Routing

Per dispatch: CONDITIONAL PASS routes to **Codex orchestrator-mingla** for CLOSE with explicit operator deferral OR remediation of the 3 P1 findings before opening the close PR. Operator's call: accept the P1 findings as out-of-scope (state explicitly in the close commit body) or route the SSR-fix decision back to Codex implementor-mingla for one bounded commit before CLOSE.

If operator chooses remediation, the implementor's bounded blocker is:
> Decide P1-B (apply SSR-fix imports OR drop the claim) → if (i), update `mingla-business/app/connect-onboarding.tsx` lines 31-36 and `mingla-business/app/connect-account-management.tsx` lines 13-18 to import `loadConnectAndInitialize` from `@stripe/connect-js/pure` and dynamically import `@stripe/react-connect-js` after hydration → if (ii), delete `.github/scripts/strict-grep/orch-0954-connect-js-pure-import.mjs` and strike lines 22-28 + 33-41 from `IMPLEMENTATION_ORCH-0954_REWORK_BROWSER_RENDER_VALIDATION_HOST.md`. Then commit ALL outstanding artifacts in one `[deploy]`-tagged commit on the per-ORCH branch and push.

Hard guards held this retest: TEST mode only ✓ ; `brand-stripe-tax-dashboard-link/` untouched ✓ ; no secrets written ✓ ; no Stripe/Vercel production keys altered ✓ ; no tests weakened ✓.
