# INVESTIGATION — ORCH-0802: Stripe Connect Embedded Components RN SDK adoption

**Skill:** Claude `mingla-forensics` (INVESTIGATE mode)
**Date:** 2026-05-12
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0802_STRIPE_CONNECT_EMBEDDED_COMPONENTS.md` — PRIVATE_PROMPT_NOT_VERSIONED
**Prior context:** `Mingla_Artifacts/CLOSE_NOTE_ORCH-0804.md` (Wave 4 part 1 — Tax enablement; just merged via PR #84 + hotfix PR #85)

---

## TL;DR (read this first)

The framing that motivated ORCH-0802 — "we have ~3,000 LOC of custom RN code we can replace with Stripe's official RN SDK" — does not survive contact with reality. As of 2026-05-12, **Stripe's Connect Embedded Components RN SDK ships only 3 components, all in Preview status: Account Onboarding, Payments, Payouts.** The other 30+ components in the Connect Embedded Components catalogue (Balances, Payouts list, KYC notifications banner, Tax Settings, Tax Registrations, Account Management, Documents, Reports, Disputes, etc.) are **Web JS only**.

Of mingla-business's ~3,729 LOC of custom Stripe UI:
- **~250 LOC** could theoretically be replaced by RN SDK (Account Onboarding alone) — but we already use that Stripe component via Path B (Mingla-hosted web page + expo-web-browser system browser), and swapping Path B → Path A buys minor UX consistency at the cost of adopting a Preview SDK on a working live integration.
- **~50 LOC** could be replaced by RN SDK Payouts component (the embedded list inside BrandPaymentsView).
- **~3,400 LOC has no RN SDK equivalent.** Custom code stays custom regardless of what we ship in this cycle.

The real architectural choice is not "RN SDK yes/no." It is:

- **Path A (native RN):** Migrate Account Onboarding from Path B (current, GA Web JS) to Path A (Preview RN SDK). Net: ~250 LOC replaced, ~Preview-SDK risk added, marginal UX win.
- **Path B-expanded (web hub):** Build out a Mingla-hosted web page that embeds many more Web JS components (Balances, Payouts list, Documents, Tax Registrations) and link out to it from native screens. Net: potentially ~1,500 LOC of custom RN replaced, but moves user experience further from native.
- **Status quo with targeted wins (recommended):** Keep Path B onboarding, keep custom RN dashboards for the surfaces Stripe doesn't expose, narrow ORCH-0802 to a small ~1-week refactor that aligns with the strategy.

Detailed evidence below.

---

## 1. Investigation Manifest

Read order:

1. `Mingla_Artifacts/CLOSE_NOTE_ORCH-0804.md` — Wave 4 part 1 close, queued follow-ups (-A/-B/-C/-D, none of which ORCH-0802 should absorb).
2. Live Stripe docs (verified 2026-05-12):
   - https://docs.stripe.com/connect/supported-embedded-components — component matrix
   - https://docs.stripe.com/connect/get-started-connect-embedded-components — Account Sessions auth model
3. `mingla-business/` Stripe surface inventory via Explore agent (very thorough):
   - All `src/components/brand/*` files touching Stripe
   - All `src/hooks/useBrand*Stripe*` hooks
   - All `src/services/brand*Stripe*` services
   - `app/connect-onboarding.tsx` (existing Path B Mingla-hosted web page)
   - `app/stripe-onboarding-return.tsx` (HTTPS relay)
4. `Mingla_Artifacts/INVARIANT_REGISTRY.md` — I-PROPOSED-O (DRAFT post-B2a) which governs the SDK-vs-WebView choice.
5. `Mingla_Artifacts/DECISION_LOG.md` — DEC-112/113/114 (Express + brand-level + marketplace model locked), DEC-121/122/123 (B2a Path C V3 architecture).

---

## 2. Five-Layer Cross-Check

| Layer | What it says | Contradicts another layer? |
|-------|--------------|---------------------------|
| **Docs (Stripe 2026-05-12)** | 3 RN components in Preview; 30+ Web JS components in GA. Account Onboarding is GA on Web, Preview on RN. | — |
| **Docs (Mingla I-PROPOSED-O DRAFT)** | "Path A (native preview SDK) future, Path B (Mingla-hosted web + expo-web-browser) current. DIY WebView wrap FORBIDDEN." | — |
| **Schema** | No DB schema changes required. `stripe_connect_accounts` row already carries the data Account Sessions need (`stripe_account_id`, `controller_dashboard_type='express'`). | — |
| **Code (Mingla today)** | Already uses Stripe `<ConnectAccountOnboarding>` Web JS component via Path B at `app/connect-onboarding.tsx:252 LOC`. NOT using RN SDK anywhere yet. | — |
| **Runtime** | Path B onboarding live in production; brand creation working; no incidents on `brand-stripe-onboard` edge fn since B2a CLOSE. | — |
| **Data** | 5 brands have `stripe_connect_accounts` rows on Mingla-dev (= production per DEC-024); all `controller_dashboard_type='express'`. | — |

**No layer contradictions.** This is not a bug investigation — it's a strategy investigation, so the five-layer check is light.

---

## 3. Current custom Stripe UI inventory (mingla-business)

Mapped exhaustively by Explore agent. Grand total: **~3,729 LOC**.

### A. Onboarding (994 LOC)

| File | LOC | What it does | RN SDK equivalent? |
|------|-----|--------------|--------------------|
| `app/connect-onboarding.tsx` | 252 | **Already uses Stripe's `<ConnectAccountOnboarding>` Web JS component.** Mingla-hosted web page opened in expo-web-browser. | Same Stripe component, accessed via Path A RN SDK instead of Path B Web JS. |
| `src/components/brand/BrandOnboardView.tsx` | 250+ | RN state machine (9 states) wrapping the entry to Stripe onboarding: country picker, ToS gate, prerequisites card, haptics, accessibility. Launches A1 in system browser. | **No equivalent.** The RN SDK Account Onboarding component is the form itself, not the orchestration shell. |
| `src/components/brand/BrandStripeCountryPicker.tsx` | 409 | Mingla-curated 34-country picker per DEC-122 / I-PROPOSED-T. | **No equivalent.** Stripe Embedded Components don't expose a country picker. |
| `app/stripe-onboarding-return.tsx` | 83 | HTTPS deep-link relay back into the native app. | **No equivalent.** Infrastructure. |

**Verdict: only A1 (252 LOC) has a real RN SDK alternative. A2/A3/A4 stay custom regardless.**

### B. KYC remediation (149 LOC)

| File | LOC | What it does | RN SDK equivalent? |
|------|-----|--------------|--------------------|
| `src/components/brand/BrandStripeKycRemediationCard.tsx` | 149 | Maps Stripe requirement codes → friendly copy + severity-driven styling. | **Notifications banner** exists on Web JS only. NO RN equivalent. |

**Verdict: KYC card stays 100% custom. RN SDK does not help here.**

### C. Balance display (embedded in BrandPaymentsView, ~150 LOC of the 785)

| File | LOC | What it does | RN SDK equivalent? |
|------|-----|--------------|--------------------|
| `src/components/brand/BrandPaymentsView.tsx` (KPI tiles) | ~150 of 785 | Available / Pending / Last payout tiles. | **Balances** component is Web JS only. NO RN equivalent. |

**Verdict: balance tiles stay 100% custom. RN SDK does not help here.**

### D. Payouts list (embedded in BrandPaymentsView, ~50 LOC of the 785)

| File | LOC | What it does | RN SDK equivalent? |
|------|-----|--------------|--------------------|
| `src/components/brand/BrandPaymentsView.tsx` (payouts list) | ~50 of 785 | Recent payouts with status pill + relative time. | **Payouts** component on RN SDK (Preview status). Closest match in the RN catalogue. |

**Verdict: ~50 LOC could be replaced by RN SDK Payouts component. Preview-status risk applies.**

### E. Detach (109 LOC)

| File | LOC | What it does | RN SDK equivalent? |
|------|-----|--------------|--------------------|
| `src/hooks/useBrandStripeDetach.ts` + `src/services/brandStripeDetachService.ts` | 109 | Hook + service for soft-delete + Stripe `accounts.del`. NO UI button found in current codebase. | **No equivalent.** Mingla-specific business flow (soft-delete + audit + orphaned-refund pivot). |

**Verdict: detach stays 100% custom. RN SDK does not help here.**

### F. Brand switcher (447 LOC) — NOT IN SCOPE

| File | LOC | What it does | RN SDK equivalent? |
|------|-----|--------------|--------------------|
| `src/components/brand/BrandSwitcherSheet.tsx` | 447 | Switching between brands (business entities), not Stripe accounts. | N/A. |

**Verdict: ORCH-0802 dispatch text named "Switch account flow" as in-scope. The actual code is brand-entity switching, not Stripe-account switching. Re-scope: drop from ORCH-0802 entirely.**

### G. Refund flow (647 LOC)

| File | LOC | What it does | RN SDK equivalent? |
|------|-----|--------------|--------------------|
| `src/components/orders/RefundSheet.tsx` | 647 | Full + partial refund UI with line-item picker, qty stepper, reason validation, finance_manager gate, idempotency. Backed by `refund-order` edge fn (NOT a Stripe API; Mingla's RPC). | **No equivalent.** Refund management via Stripe is in the Web-only **Payment details** + **Disputes** components, and those manage Stripe-side refunds — not Mingla's order-level refund + reverse-transfer flow. |

**Verdict: refund flow stays 100% custom. RN SDK does not help here. The Stripe components target a different abstraction layer (payment refunds, not order refunds with reverse_transfer).**

### H. Tax CTA (out of scope — just shipped)

ORCH-0804 surface. Do not touch.

### I. Supporting components (591 LOC)

| File | LOC | What it does | RN SDK equivalent? |
|------|-----|--------------|--------------------|
| `BrandStripeBankSection.tsx` | 206 | Bank account verification with country-aware labels (IBAN vs sort code). | None. |
| `BrandStripeDeadlineBanner.tsx` | 198 | 7d/3d/1d deadline countdown above the KYC card. | None. |
| `BrandStripeOrphanedRefundsSection.tsx` | 187 | Post-detach refund history (read-only). | None. |

**Verdict: all 591 LOC stays custom.**

### Inventory grand total — replaceable LOC

| Surface | Total LOC | Replaceable by RN SDK |
|---------|-----------|----------------------|
| A1 Onboarding form | 252 | **252** (already Stripe component via Path B; swap to Path A possible) |
| A2 Onboarding shell | 250+ | 0 |
| A3 Country picker | 409 | 0 |
| A4 Return relay | 83 | 0 |
| B KYC card | 149 | 0 |
| C Balance tiles | ~150 | 0 |
| D Payouts list | ~50 | **~50** (RN SDK Payouts component, Preview) |
| E Detach | 109 | 0 |
| F Brand switcher | 447 | 0 (out of scope) |
| G Refund flow | 647 | 0 |
| I Supporting (bank+deadline+orphaned) | 591 | 0 |
| **Total replaceable** | | **~300 of 3,729 LOC = 8%** |

---

## 4. Stripe RN SDK — current state (verified live 2026-05-12)

Source: https://docs.stripe.com/connect/supported-embedded-components

| Component | Web JS | RN SDK | Status |
|-----------|--------|--------|--------|
| Account Onboarding | ✓ | ✓ | GA (Web), **Preview (RN)** |
| Payments | ✓ | ✓ | GA (Web), **Preview (RN)** |
| Payouts | ✓ | ✓ | GA (Web), **Preview (RN)** |
| Account Management | ✓ | ✗ | Web-only GA |
| Notifications Banner | ✓ | ✗ | Web-only GA |
| Balances | ✓ | ✗ | Web-only GA |
| Payouts List | ✓ | ✗ | Web-only GA |
| Payout Details | ✓ | ✗ | Web-only GA |
| Payment Details | ✓ | ✗ | Web-only GA |
| Disputes (list + per-payment) | ✓ | ✗ | Web-only GA |
| Documents | ✓ | ✗ | Web-only GA |
| Balance Report | ✓ | ✗ | Web-only GA |
| Payout Reconciliation | ✓ | ✗ | Web-only GA |
| Tax Settings | ✓ | ✗ | Web-only GA |
| Tax Registrations | ✓ | ✗ | Web-only GA |
| (… 15+ more Capital, Terminal, Treasury, Issuing components) | ✓ | ✗ | All Web-only |

**Critical observations:**
1. **Zero RN components are GA.** All three RN components are in Preview. Account Onboarding is GA on Web but Preview on RN.
2. **Beta SDK versions required** for Preview components per Stripe docs. Install with `@preview` tag (`npm install @stripe/connect-js@preview`). Beta header `embedded_connect_beta=v2` must be set on the backend.
3. **The gap between Web JS (33 components, mostly GA) and RN (3 components, all Preview) is enormous.** This isn't going to close fast — Stripe has been incrementally migrating components RN-side for ~2 years and the cadence is ~1 component every 6-12 months.

---

## 5. Auth model — Account Sessions API

Confirmed from https://docs.stripe.com/connect/get-started-connect-embedded-components.

**Backend flow:**
1. Brand-side request arrives at a new (or existing) edge function.
2. Edge function calls `POST /v1/account_sessions` with `account=<connected_account_id>` + `components={…enabled-feature-set…}`.
3. Stripe returns `{ client_secret: "..." }`.
4. Edge function returns the `client_secret` to the client.

**Key/permission:**
- Stripe recommends a **Restricted API key with `account_sessions:write` scope only.** This is NOT the same scope as `accounts:write` (which we mistakenly specified in ORCH-0804 SPEC).
- Account Sessions are **per-connected-account**, short-lived, auto-refresh via the `fetchClientSecret` callback.

**Client flow (RN):**
```jsx
<ConnectComponentsProvider connectInstance={stripeConnectInstance}>
  <ConnectAccountOnboarding /> {/* or ConnectPayments, ConnectPayouts */}
</ConnectComponentsProvider>
```

**Some components require Stripe-hosted auth popups** (Account Onboarding, Balances, Payouts, Notifications Banner, Account Management, Financial Account, Issuing Cards). On RN that means a system browser popup — same UX pattern as our current Path B. Not a degradation; not a meaningful improvement either.

**Mingla-side new infrastructure required to adopt the RN SDK for any component:**
1. New RAK `STRIPE_RAK_ACCOUNT_SESSIONS` with `account_sessions:write` scope.
2. New edge function `brand-stripe-account-session` returning `client_secret` per-component-set per-brand.
3. RN package dependency: `@stripe/stripe-react-native` (preview channel).
4. Audit-log emit on every Account Session creation (for parity with existing surfaces).
5. Cleanup/`logout()` call on brand switch.

This is ~1-2 days of edge-fn + service + hook work, plus the component integration itself.

---

## 6. Findings (classified)

### 🔵 OBSERVATION-1 — RN SDK scope is much smaller than the dispatch assumed
The ORCH-0802 dispatch (and the user's framing during brainstorm 2026-05-12) cited "3,000 LOC of custom UI replaceable by the RN SDK." The actual replaceable surface is ~300 LOC (8%). The dispatch was written before live Stripe doc verification. Classification: observation, not a defect — re-scope ORCH-0802 to match reality.

### 🟡 HIDDEN-FLAW-1 — I-PROPOSED-O is in DRAFT, not ACTIVE
The invariant governing Path A vs Path B vs WebView-wrap is `I-PROPOSED-O` in `_shared/stripe.ts` line 13-17 comment block, currently DRAFT post-B2a CLOSE. It never flipped to ACTIVE. ORCH-0802 close should formally promote it to ACTIVE with whatever architectural decision the operator makes.

### 🟡 HIDDEN-FLAW-2 — Detach has no UI button
Inventory found `useBrandStripeDetach` + `brandStripeDetachService` fully implemented (109 LOC), but **no UI surface invokes them**. Brand admins cannot detach their Stripe account from the app today. Either the button was never built, or it was removed and the hook left dangling. Not blocking ORCH-0802, but worth a registered follow-up (`ORCH-0802-followup-1`).

### 🟡 HIDDEN-FLAW-3 — F (Brand switcher) was misnamed in the ORCH-0802 dispatch
The dispatch named "Switch account flow" as in-scope, implying multiple Stripe accounts per brand. The actual `BrandSwitcherSheet.tsx` is brand-entity switching (one Mingla account → N brands → N Stripe accounts). Drop "Switch account flow" from ORCH-0802 scope.

### 🔵 OBSERVATION-2 — Mingla already uses a Stripe Embedded Component (via Path B)
`app/connect-onboarding.tsx` already renders `<ConnectAccountOnboarding>` using BOTH `@stripe/connect-js` (loader — `loadConnectAndInitialize`) AND `@stripe/react-connect-js` (component wrappers) inside a Mingla-hosted web page — the canonical Stripe Web JS Embedded Components pattern. **Post-implementation correction (2026-05-12, per IMPLEMENTATION report Deviation 1 + QA NOTE-2):** an earlier draft of this report described Path B's imports as `@stripe/react-connect-js` only; that was wrong. The full Path B uses both packages, and the strict-grep gate's Check 1 is scoped to `mingla-business/src/` (not all of `mingla-business/`) so that the legitimate Path B usage in `mingla-business/app/` is permitted. This is Path B per I-PROPOSED-O. ORCH-0802's potential "swap to RN SDK" is therefore Path A migration of a surface that already uses Stripe's component — the rest of the inventory is genuinely Mingla-custom code that has no Stripe equivalent.

### 🔵 OBSERVATION-3 — Path B-expanded would replace more custom code than Path A
If the goal is "delete custom UI in favour of Stripe-maintained surfaces," the Web JS SDK is where the leverage lives — it ships ~30 GA components. A Mingla-hosted `/brand/<id>/stripe-tools` web hub embedding Account Management + Notifications Banner + Balances + Payouts list + Documents + Tax Settings + Tax Registrations could potentially replace ~1,500 LOC of custom RN code, vs ~300 LOC for the native RN SDK path. Tradeoff: brand UX shifts from native to web-in-browser-tab for these surfaces.

---

## 7. Blast radius map

For each candidate replacement:

**Path A: migrate Account Onboarding from Path B (Web JS) to Path A (RN SDK)**
- Files changed: `BrandOnboardView.tsx` (launch sequence rewrite), new `BrandOnboardingEmbedded.tsx` component, new `brand-stripe-account-session` edge function, new RAK, new hook.
- Removed: `app/connect-onboarding.tsx`, `app/stripe-onboarding-return.tsx` (no longer need HTTPS relay if native), parts of `BrandOnboardView` state machine that handle web-browser modal.
- Risk: Account Onboarding is Preview-status on RN. Brand fails to onboard → brand cannot sell tickets → revenue impact.
- Audit log: every Account Session creation needs an audit event for parity with current `stripe_onboarding.session_started`.

**Path B-expanded: build a Mingla-hosted Stripe Tools web page**
- Files changed: new `app/brand/<id>/stripe-tools.tsx` (Mingla-hosted web page rendering ~7 Stripe Web JS components), modify `BrandPaymentsView.tsx` to add an "Open Stripe Tools" CTA, deprecate the KYC card / balance tiles / payouts list / orphaned refunds / deadline banner.
- Removed: ~1,500 LOC of custom RN.
- Risk: brand UX shifts from native-RN to web-page-in-system-browser for the Payments tab. Users may perceive this as a regression.
- Tax CTA (ORCH-0804) becomes redundant — Tax Settings + Tax Registrations Web JS components already exist in the same hub.

**Status quo with targeted wins**
- No big migration. Cherry-pick: add the missing detach button (HIDDEN-FLAW-2). Promote I-PROPOSED-O to ACTIVE with the explicit "stay on current Path B for onboarding + custom for everything else" decision.
- Risk: minimal.

---

## 8. Invariant analysis

| Invariant | Affected by ORCH-0802? | How |
|-----------|------------------------|-----|
| I-PROPOSED-O (DRAFT) Stripe Embedded Components routing | YES — this is the invariant ORCH-0802 mostly exists to ratify | Operator decision determines whether Path A is permitted alongside Path B |
| I-PROPOSED-BF STRIPE_TAX_ENABLED_ON_CHECKOUT (ACTIVE, ORCH-0804) | NO — Tax CTA is out of scope | — |
| I-PROPOSED-T STRIPE_COUNTRY_FROM_CANONICAL_ALLOWLIST (ACTIVE) | NO — 34-country picker stays custom | — |
| I-PROPOSED-R STRIPE_IDEMPOTENCY_KEY_ON_EVERY_CALL (ACTIVE) | YES — any new edge function calling Stripe must comply | — |
| I-PROPOSED-S STRIPE_AUDIT_LOG_ON_EVERY_EDGE_FN (ACTIVE) | YES — Account Session creation must emit audit | — |
| I-PROPOSED-Q STRIPE_API_VERSION_PINNED (ACTIVE) | YES — Account Sessions require beta header `embedded_connect_beta=v2` | Need to verify that doesn't conflict with our pinned `2026-04-22.dahlia` |

---

## 9. Discoveries for orchestrator

1. **HIDDEN-FLAW-2 (detach button missing).** Register as `ORCH-0802-followup-1` regardless of which path operator chooses. Brand admins should be able to detach their Stripe account from the app; today they can't.
2. **I-PROPOSED-O DRAFT promotion.** Whichever path operator picks, the close of ORCH-0802 should flip I-PROPOSED-O from DRAFT to ACTIVE with the explicit routing rule.
3. **Beta API version interaction.** Stripe requires `embedded_connect_beta=v2` header for Account Sessions. Our `STRIPE_API_VERSION = "2026-04-22.dahlia"` is stable. Confirm via Stripe support whether the beta header is additive (won't override the stable pin). If it does override, this is a real architectural concern — would mean preview embedded components run on a different API version than the rest of Mingla's Stripe calls.
4. **ORCH-0804 SPEC text alignment.** PR #85 (merging now) corrects the SPEC text for the tax dashboard RAK → secret-key swap. ORCH-0802 close should also note the broader pattern: "if a Stripe surface needs a RAK, verify the scope exists for the endpoint via direct Stripe probe BEFORE writing the SPEC." This is the second time in a week we've shipped a SPEC with the wrong RAK assumption (ORCH-0804 + the original B2 cycle balance scope).

---

## 10. Confidence

| Aspect | Confidence | Reasoning |
|--------|-----------|-----------|
| Custom UI inventory is complete | **HIGH** | Very-thorough Explore agent ran across all `src/components/brand/*` + hooks + services + `app/*` |
| RN SDK component matrix is accurate | **HIGH** | Verified live against Stripe docs 2026-05-12 |
| Path A would replace only ~300 LOC | **HIGH** | Direct mapping of replaceable surfaces against the component matrix |
| Path B-expanded would replace ~1,500 LOC | **MEDIUM** | Depends on which Web JS components actually fit each surface; haven't read individual component docs for Account Management + Notifications Banner in detail. Real number could be 1,200–1,800. |
| Status quo is a defensible choice | **HIGH** | RN SDK Preview-only status + 8% replaceable surface = poor cost/benefit ratio for native migration |
| Account Sessions auth model is well-understood | **HIGH** | Confirmed from Stripe docs and matches the existing Path B pattern we already implement |

---

## 11. Fix strategy (direction only — not a spec)

ORCH-0802 should NOT be an "adopt the RN SDK to delete 3,000 LOC" cycle. The shape that fits reality is one of:

**Option 1 — Status quo + targeted polish (recommended for now):**
- Promote I-PROPOSED-O from DRAFT to ACTIVE with the rule: "Stripe Embedded Components are exposed via Path B (Mingla-hosted web page + expo-web-browser) for any surface that needs them. Path A (native RN SDK) is on hold until all 3 Preview components reach GA. DIY WebView wraps remain FORBIDDEN."
- Add the missing detach button (HIDDEN-FLAW-2) as a small follow-up.
- Decision-log entry: "Stripe RN SDK preview status + 8% replaceable surface = wait for GA; revisit when Account Onboarding flips GA on RN."
- Cost: 1-2 days. Wins: zero new SDK risk, clarifies architecture for future investigators.

**Option 2 — Expand Path B (the bigger lever, more strategic):**
- Build `app/brand-stripe-tools.tsx` — a Mingla-hosted web page that embeds the Web JS Embedded Components for surfaces where no RN equivalent exists: Account Management, Notifications Banner, Balances, Payouts list, Payout Details, Documents, Tax Settings, Tax Registrations.
- Add an "Open Stripe Tools" CTA on the BrandPaymentsView (similar pattern to the existing Tax CTA).
- Replace ~1,500 LOC of custom RN (KYC card, balance tiles, payouts list, deadline banner, bank section, orphaned refunds) with a "this lives in Stripe Tools now" footer note.
- Keep the native top-line metrics (e.g. KPI tiles can still show available balance via `brand-stripe-balances`) but stop owning the deep surfaces.
- Cost: 2-3 weeks. Wins: ~40% custom UI reduction, much-improved Stripe-side surface (Stripe maintains, gets fixes for free), and we no longer have to ship new components when Stripe ships them.
- Risk: brand UX shifts from native to web-page-in-browser for the dashboard. Mitigation: pre-launch test with 3-5 brands; if UX regresses, fall back.

**Option 3 — Native RN SDK adoption for Account Onboarding only (smallest "real" migration):**
- Migrate just `connect-onboarding.tsx` (252 LOC) from Path B to Path A.
- Removes the HTTPS relay (`stripe-onboarding-return.tsx`, 83 LOC).
- Replaces ~250 LOC with native RN SDK code.
- Cost: 1 week. Wins: minor UX consistency (no system-browser pop for onboarding). Risk: Preview SDK on the most-critical flow (brand can't sell tickets without onboarding).
- **Not recommended** unless we have a strong UX-consistency mandate.

---

## 12. Regression prevention

Whichever path is picked:
- New strict-grep gate enforcing whatever I-PROPOSED-O ratifies (e.g. "no WebView wrap of @stripe/connect-js").
- Verify new edge function (if any) follows I-PROPOSED-R (idempotency) + I-PROPOSED-S (audit log) before close.
- Account Session beta header compatibility verified via Stripe support before SPEC ratifies anything.

---

## End of investigation.

**Steering questions for operator are in the chat reply, not this artifact.**
