# SPEC AMENDMENT — ORCH-0954 [Embedded onboarding cutover + Stripe-managed risk]

**Author:** Claude `mingla-forensics`
**Date:** 2026-05-25
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0954-[embedded-onboarding-cutover]/`
**Branch:** `ORCH-0954-embedded-onboarding-cutover` (rebased onto `origin/main` at `3bd4241e`; original per-ORCH commits absorbed by squashed merge `b2866f0e`)
**Supersedes scope of:** `Mingla_Artifacts/specs/SPEC_ORCH-0954_EMBEDDED_ONBOARDING_CUTOVER.md` §3.1, §3.3, §3.4, §3.6, §6 (corrected here); other sections unchanged
**Trigger:** Tester FAIL on `Mingla_Artifacts/tests/TEST_ORCH-0954_LIVE_FIRE.md` (rerun, 2026-05-25) — three Stripe-side P1 blockers post-merge

---

## Preamble — why this amendment exists

ORCH-0954 merged to `main` at `b2866f0e` on 2026-05-25 03:45 UTC ahead of tester PASS (operator decision; zero live brands = low-cost rollback). Tester's second live-fire revealed three independent P1 Stripe-side bugs that the original SPEC + IMPLEMENT + REVIEW chain missed because no phase independently verified Stripe payloads against Stripe's actual docs. The shared root cause is captured in two new persistent memory rules created by the orchestrator on 2026-05-25:

- `feedback_stripe_skill_mandatory.md` — every Stripe-touching phase invokes `stripe-best-practices` skill.
- `feedback_external_api_docs_verified.md` — every external-API parameter cites provider docs URL inline at SPEC time.

This amendment is the first SPEC produced under those rules. Every Stripe parameter below cites the canonical Stripe doc URL that authorizes its value.

This amendment does NOT revert PR #204. Rework lands as a fresh commit on the rebased branch and ships as a new PR.

## Comms ledger acks

- `COMMS-0001` (Tax dashboard link → ORCH-0955) — still active, scope guard holds. This amendment touches NEITHER `brand-stripe-tax-dashboard-link/` NOR the Tax components.
- `COMMS-0002` (ORCH-0863 strict-grep gate blocks backend PRs) — factored in. Any new `supabase/functions/` paths introduced by the rework must extend `ORCH_0954_BACKEND_ALLOWLIST` (already added in the prior commit; will need updating if rework touches new files). This amendment introduces zero new files but modifies existing ones.

---

## §A1 — Corrected `STRIPE_MANAGED_RISK_CONTROLLER` constant

**Authoritative Stripe doc:** https://docs.stripe.com/connect/accounts-v2/connected-account-configuration.md

**Quoted Stripe enum spec for `defaults.responsibilities.fees_collector`:**
> - `application`: Your platform collects application fees from the connected account, and Stripe collects payment fees from your platform.
> - `stripe`: Stripe collects payment fees directly from the connected account.

Valid enum values are **`application | stripe`** — no other values exist. The 4-value list returned by tester's Stripe CLI error ("application, application_custom, application_express, stripe") was from a preview API surface; the canonical Accounts v2 API accepts only the two values above.

**Operator UI label vs API enum mapping (codified for future Stripe ORCHs):**
| Stripe Platform Setup UI label (2026-05-24) | API enum value | Semantics |
|---|---|---|
| "account" (under "Who pays processing fees") | `fees_collector: "stripe"` | Stripe collects payment fees directly from the connected account = seller pays processing |
| "platform" (under "Who pays processing fees") | `fees_collector: "application"` | Platform pays processing, claws back via application fees |
| "Stripe" (under "Who handles risk") | `losses_collector: "stripe"` | Stripe absorbs negative balances |
| "Platform" (under "Who handles risk") | `losses_collector: "application"` | Platform absorbs negative balances |
| "Stripe-hosted" (under "Dashboard") | `dashboard: "express"` | Express Dashboard |
| "Custom (embedded)" (under "Dashboard") | `dashboard: "none"` | Mingla provides all UI via embedded components |

Operator's 2026-05-24 selection at live Stripe Platform Setup was Stripe-managed risk + seller-pays-processing + embedded onboarding. The CORRECT API encoding is:

```ts
// supabase/functions/_shared/stripeBlueprintClient.ts
// Stripe docs: https://docs.stripe.com/connect/accounts-v2/connected-account-configuration.md
export const STRIPE_MANAGED_RISK_CONTROLLER = {
  defaults: {
    responsibilities: {
      losses_collector: "stripe", // Stripe absorbs negative balances
      fees_collector: "stripe",   // Stripe collects payment fees directly from connected account (= seller pays processing)
    },
  },
  dashboard: "none",              // Mingla provides all UI via embedded components
} as const;
```

**Constraint cross-check per Stripe docs:**
> If you set `losses_collector` to `application`, then you must also set `fees_collector` to `application`.

This restriction does NOT apply to our config (we use `losses_collector: "stripe"`), so `fees_collector` can be either `application` or `stripe`. We choose `stripe` per operator's intent.

> If you set `dashboard` to `express`, then you must also set both `losses_collector` and `fees_collector` to `application`.

Does NOT apply (`dashboard: "none"`).

**Implementor change:** one character — `fees_collector: "account"` → `fees_collector: "stripe"`. The named constant + strict-grep gate `orch-0954-controller-props-pinned.mjs` need to update their expected literal to `"stripe"`.

**Success criterion SC-A1:** A live Stripe TEST-mode `accounts.create` POST with the corrected `STRIPE_MANAGED_RISK_CONTROLLER` returns HTTP 200 + an account with `livemode:false` + the expected controller properties echoed back. Tester captures the Stripe API response inline.

---

## §A2 — Server-payload diffs removing `collection_options`

**Authoritative Stripe docs:**
- React component attribute: https://docs.stripe.com/connect/supported-embedded-components/account-onboarding.md (section "Requirements collection options")
- Server-side Account Sessions API: https://docs.stripe.com/api/account_sessions/create.md

**Quoted React component spec for `collectionOptions`:**
> When you collect information using the account onboarding component, it always collects `currently_due` requirements. You can use the `collectionOptions` attribute to also request any of the following: `eventually_due` requirements, future requirements, granular requirement restrictions.

`collectionOptions` is documented ONLY as a React component **attribute** (JSX prop). It is NOT a parameter on the server-side `accountSessions.create()` `components.account_onboarding.features` payload. Per Stripe's API docs the only `features` accepted under `account_onboarding` are:

- `external_account_collection` (boolean) — control whether the component collects external account info
- `disable_stripe_user_authentication` (boolean) — control whether Stripe user auth is required

There is no `collection_options` parameter at the server level. Tester proved Stripe rejects both nested locations:

```
parameter_unknown: Received unknown parameter: components[account_onboarding][features][collection_options]
parameter_unknown: Received unknown parameter: components[account_onboarding][collection_options]
```

**Required code changes (implementor scope):**

1. `supabase/functions/brand-stripe-onboard/index.ts:682-695` — DELETE `collection_options` from the `components.account_onboarding.features` payload. Keep ONLY `external_account_collection` and (optionally) `disable_stripe_user_authentication` per the per-config defaults Stripe documents.

2. `supabase/functions/brand-stripe-account-session/index.ts:81-92` — for the optional `account_onboarding` surface, same deletion. The `account_management` surface (line 95+) was already correct.

3. `mingla-business/app/connect-onboarding.tsx` — KEEP `collectionOptions` as a JSX prop on `<ConnectAccountOnboarding>`. The component-level prop is the supported surface and is where `eventually_due` + future-requirements opt-in correctly belongs.

**Success criterion SC-A2:** A live Stripe TEST-mode `accountSessions.create` POST with the corrected onboarding-surface payload returns HTTP 200 + a session whose `components.account_onboarding.enabled: true` + the two valid features echoed back. Tester captures the Stripe API response inline.

---

## §A3 — TEST-mode validation host strategy (REQUIRES OPERATOR DECISION)

**Problem statement:** `mingla-business/app.config.ts:88-94` throws at config-eval if `EAS_BUILD_PROFILE === "production"` and `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` does not start with `pk_live_`. This fail-close was added by ORCH-0953 [Stripe live-mode cutover] per `feedback_mingla_business_pk_live_in_production.md` as production-safety. The gate is intentional and correct — production must use live keys.

The consequence ORCH-0954 SPEC §6 missed: production-hosted embedded components running with `pk_live_` cannot authenticate Stripe TEST-mode Account Sessions. Stripe.js auto-detects test vs live from the publishable key prefix. Mismatched modes produce "Something went wrong. There was an error during authentication." — exactly what tester observed.

There is no path to TEST-mode embedded validation on `business.usemingla.com` without compromising the `pk_live_` gate. Three real options, each with trade-offs:

### Option α (RECOMMENDED) — Vercel Preview env with `pk_test_` + per-env `app.config.ts` gate

**Description:** Use Vercel's per-environment env var system to set:
- Production env: `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...`
- Preview env: `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...`
- Development env: `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...`

Modify `mingla-business/app.config.ts:88-94` gate to read `process.env.VERCEL_ENV` (Vercel's auto-injected env identifier — `"production" | "preview" | "development"`) and:
- If `VERCEL_ENV === "production"` → REQUIRE `pk_live_` (existing behavior preserved)
- If `VERCEL_ENV === "preview" || VERCEL_ENV === "development"` → REQUIRE `pk_test_` (new fail-close for the inverse)
- If `VERCEL_ENV` is undefined (local dev outside Vercel) → REQUIRE `pk_test_`

`BUSINESS_WEB_ORIGIN` Supabase secret also needs a parallel per-env story:
- Production deploy passes `BUSINESS_WEB_ORIGIN=https://business.usemingla.com` (current)
- Preview deploy needs `BUSINESS_WEB_ORIGIN` to point at the PR's preview URL so embedded session URLs returned by edge functions land on the preview host. This is harder because the preview URL is per-PR and minted by Vercel — not a single static value.

Two solutions for the secret-vs-preview-URL gap:
- **(α-1)** Edge functions accept a per-request `business_web_origin_override` parameter that the mingla-business app passes when running on a preview host. Edge functions validate the override is a `*.vercel.app` URL or matches the production host before using it.
- **(α-2)** Edge functions read `BUSINESS_WEB_ORIGIN` from request `Origin` header when present and the request is from a recognized Vercel preview host pattern (`https://mingla-business-*.vercel.app`); fall back to the env var for production.

(α-1) is cleaner — explicit override beats inference from request headers. Implementor picks the exact shape.

**Pros:** No new infrastructure. Preview URL is auto-minted per PR. TEST-mode validation is automatic on every PR. Production safety preserved.
**Cons:** Vercel preview SSO still blocks unauthenticated curl access — tester needs a logged-in browser or a one-shot bypass token. Mobile sim WebBrowser cannot pass SSO either — but tester can run the embedded component on a desktop browser logged into Vercel, which IS sufficient for SPEC §6 visual + interaction validation. Full mobile-deep-link smoke (sim → WebBrowser → preview URL) remains untestable end-to-end without disabling preview SSO on the specific deployment.

### Option β — Separate `staging.business.usemingla.com` subdomain with TEST keys

**Description:** Provision a third Vercel project (or a third deployment of the same project) bound to `staging.business.usemingla.com` with TEST publishable keys, TEST Supabase project (or production Supabase with TEST Stripe keys), and matching `BUSINESS_WEB_ORIGIN` secret pointing at the staging host. Tester runs SPEC §6 against staging; production stays untouched.

**Pros:** Stable host name. No SSO. Mobile sim can deep-link to the staging URL via a staging build of mingla-business. Full end-to-end smoke possible.
**Cons:** New infrastructure (Vercel project + DNS + Supabase secret triplet + EAS staging profile + per-env edge-function deploy). Significant scope expansion — could be its own ORCH.

### Option γ — Skip live-fire; rely on Stripe TEST-mode CLI proof + unit tests

**Description:** Treat SPEC §6 as satisfied by Stripe TEST-mode API proof (account-create + account-session-create returning HTTP 200 with the corrected payloads) plus the new regression tests in §A4. Skip the "open in browser, click around, capture screenshot" portion of SPEC §6.

**Pros:** Zero new infrastructure. Fastest path to PR re-open.
**Cons:** No visual evidence that `<ConnectAccountOnboarding>` and `<ConnectAccountManagement>` actually render correctly. Stripe explicitly flags `<ConnectAccountManagement>` as "Preview/Demo behaves differently than live mode" — meaning component behavior in production differs from what TEST mode shows. Smoke B's whole point was to catch this; skipping it inverts the safety story.

### Recommendation

Option α. Lowest friction, no new infrastructure, preserves production safety. The "preview SSO blocks mobile deep-link" caveat is acceptable because (i) the embedded component itself renders identically on desktop browser vs mobile WebBrowser (it's a webview either way), (ii) the sim-deep-link plumbing was already proven on the now-merged prod code (Smoke A's first-leg "browser opens" was OK before Finding 1 blocked KYC).

**Operator decision required before §A4-§A7 implementor dispatch.** Implementor cannot pick α vs β vs γ without your call.

**Success criterion SC-A3:** Whatever option you pick, SPEC §6 retest must include (a) a Stripe TEST-mode CLI dump proving the corrected payloads are accepted, and (b) a desktop-browser render proof showing `<ConnectAccountOnboarding>` + `<ConnectNotificationBanner>` + `<ConnectAccountManagement>` rendering against a TEST-mode session — captured as Playwright screenshot or live screen recording.

---

## §A4 — Regression tests that actually exercise Stripe contracts

**Why the existing tests didn't catch the bugs:** the implementor's happy-path test in `supabase/functions/_shared/__tests__/stripeBlueprintClient_failclose.test.ts` and `supabase/functions/brand-stripe-onboard/__tests__/embeddedOnboarding.happy.test.ts` mock Stripe with `withStripeFetch()` that returns whatever the source code emits. These tests prove "the code emits the value the SPEC told it to emit" — they do NOT prove "the value Stripe will accept." If SPEC says `fees_collector: "account"`, the mock returns success, the test passes, but Stripe rejects it in production. This is a "source-shape mock" anti-pattern.

The tester's adversarial test `supabase/functions/brand-stripe-onboard/__tests__/embeddedOnboarding.adversarial.test.ts` attacked the env-var fail-close, NOT the payload shape — so it also did not catch the bugs.

**Required new regression coverage (implementor + tester scope):**

### Implementor-written happy-path (per ORCH-0840 Step 0.5(a)) — REWRITE

Path: `supabase/functions/_shared/__tests__/stripeBlueprintClient.contract.test.ts` (NEW file, not a modification of the existing mocked test).

**Choose one of two approaches (implementor picks based on test-env Stripe access):**

**(i) Real-API contract test.** Calls Stripe TEST-mode API directly (`fetch` against `https://api.stripe.com/v2/core/accounts` with `STRIPE_RAK_ONBOARD` test secret) and asserts:
- HTTP 200 response
- Response body's `controller.fees.payer.type === "stripe"` (or whatever Stripe echoes for the `fees_collector` choice)
- Response body's `dashboard === "none"`
- Cleanup: immediately call `accounts.delete` on the created test account
- Skip the test if `STRIPE_RAK_ONBOARD` is not set (CI env)

Pros: catches Stripe API drift; proves the payload is real.
Cons: requires Stripe TEST secrets in CI; slower; can hit Stripe rate limits.

**(ii) Documented-error-shape mock test.** Mocks Stripe with an HTTP 400 + `{error: {type: "invalid_request_error", param: "defaults.responsibilities.fees_collector", code: "parameter_unknown", message: "Unrecognized enum value 'account', valid values are: application, stripe"}}` AND asserts the payload Mingla actually sends matches the documented schema from https://docs.stripe.com/api/v2/core/accounts/create.md. The test must fail if the payload contains `fees_collector` outside `{application, stripe}` OR contains `collection_options` under `components.account_onboarding.features`.

Pros: no Stripe secrets needed; fast.
Cons: still a mock — drifts if Stripe changes the API shape without updating docs.

Either approach satisfies §A4. Both are stronger than the current source-shape mocks.

**Fails-on-revert proof:** the test MUST fail when `STRIPE_MANAGED_RISK_CONTROLLER.defaults.responsibilities.fees_collector` is reverted to `"account"` AND when `collection_options` is re-added to either edge function's session payload. Implementor captures both fails-on-revert proofs at the rework commit hash.

### Tester-written adversarial (per ORCH-0840 Step 0.5(b)) — NEW

Path: `supabase/functions/brand-stripe-account-session/__tests__/embeddedSession.adversarial.test.ts` (NEW file).

Tester attacks a DIFFERENT angle than the implementor's happy-path:
- Malformed `surface` parameter (not `account_onboarding | account_management`)
- Missing `account_id` on request body
- Wrong `account_id` format (e.g. `live_acct_xxx` against a test platform)
- Stripe returns HTTP 400 for one of these cases — assert the edge function surfaces the error to the client as a structured response (not a 500)
- Or attack the `BUSINESS_WEB_ORIGIN` validation: pass an injected origin-override that doesn't match the allowlist; assert rejection
- Fails-on-revert proof against a different anchor than the implementor's

**Success criterion SC-A4:** Both tests live at real paths, both pass green, both fails-on-revert anchors documented in implementation + QA reports. ORCH-0840 immutable-tests rule applies — any modification later requires `[TEST-MOD-APPROVED ORCH-NNNN]` token.

---

## §A5 — New invariant proposal `I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED`

**Status:** DRAFT — flips to ACTIVE on ORCH-0954 rework CLOSE.

**Invariant text:**

> Every external-API integration ORCH MUST, in SPEC §3 (layer-by-layer changes), cite the provider's docs URL inline for every parameter, enum value, payload shape, and endpoint introduced or modified. The citation takes the form of a comment or table cell linking to the canonical docs URL that authorizes the exact value used. For Stripe specifically, the SPEC must also confirm that the `stripe-best-practices` skill was invoked at SPEC start (see [[stripe-skill-mandatory]]).

**Scope:** every ORCH that touches any external API surface — Stripe, Supabase (the JS client), OpenAI, Google Places, Distance Matrix, OpenWeatherMap, BestTime, OneSignal, RevenueCat, AppsFlyer, Mixpanel, Twilio, Ticketmaster, Resend. Not just new integrations — modifications to existing integrations are equally bound.

**Enforcement:** SPEC review step at orchestrator REVIEW checks that every external-API parameter in SPEC §3 carries a docs URL citation. Absence is REVIEW REJECTED. There is no "this parameter is obvious" exception — the failure mode this prevents is exactly the "obvious" parameter that turns out wrong (e.g. `fees_collector: "account"` looked obvious from the UI label).

**CI gate (proposed, implementor scope to add):** a strict-grep gate `orch-0954-external-api-docs-cited.mjs` that scans SPEC files for sections referencing external APIs and asserts docs URLs are present. This is OUT OF SCOPE for the ORCH-0954 rework (would add multi-day effort + cross-ORCH coordination); ORCH-0954 rework only LANDS the invariant text. CI gate registration belongs to a future META-ORCH for invariant tooling.

**Memory rule cross-references:** [[stripe-skill-mandatory]], [[external-api-docs-verified]].

---

## §A6 — Amended DEC-159 text

DEC-159 was drafted in original SPEC §2 but never landed in `DECISION_LOG.md` (deferred to CLOSE per original SPEC; CLOSE never happened because tester FAILed). The amendment replaces the original draft with:

```
DEC-159 — Stripe Connect platform controller: Stripe-managed risk + seller-pays-processing + embedded onboarding
Date: 2026-05-25 (originally drafted 2026-05-24 with incorrect fees_collector enum)
Owner: Seth (operator)
Status: ACTIVE

Decision: For all new Stripe Connect connected accounts created via brand-stripe-onboard,
the platform controller properties are pinned at:
  - losses_collector: "stripe" (Stripe absorbs negative balances)
  - fees_collector: "stripe" (Stripe collects payment fees directly from connected account = seller pays processing)
  - dashboard: "none" (Mingla provides all UI via embedded components)

Source of truth: https://docs.stripe.com/connect/accounts-v2/connected-account-configuration.md

Reverses: DEC-156 (ORCH-0953 §10 platform-liable Express controller).
Re-affirms: DEC-154 (Stripe-managed risk + embedded onboarding cost-benefit accepted).

Rationale: Operator chose this configuration at the live Stripe Connect Platform Setup screen
on 2026-05-24. Original SPEC §3.1 encoded the choice with fees_collector: "account" because
the Stripe Dashboard UI labels the option "account" (referring to the connected account paying
the fees). Stripe's API enum for the same semantics is "stripe" (Stripe collects payment fees
directly FROM the connected account). The UI label and the API enum diverge — this is the
specific failure mode that drove the creation of new memory rules
feedback_external_api_docs_verified.md and feedback_stripe_skill_mandatory.md on 2026-05-25.
This amended DEC corrects the encoding to match Stripe's API.

Cross-references:
- I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED (this ORCH)
- I-PROPOSED-CONTROLLER-PROPS-PINNED (existing — strict-grep gate updated to assert "stripe" not "account")
- I-PROPOSED-RAK-SCOPE-PINNED (existing — unchanged)
- COMMS-0001 (ORCH-0955 owns Tax dashboard rewrite under dashboard:none)
- COMMS-0003 (orchestrator-to-write — ORCH-0955 + ORCH-0956 cross-ORCH validation reminder)
```

Implementor lands this verbatim in `Mingla_Artifacts/DECISION_LOG.md` as part of CLOSE — not in the rework commit.

---

## §A7 — Cross-ORCH note: ORCH-0955 + ORCH-0956 Stripe-parameter discipline

ORCH-0955 [Native Stripe Tax] and ORCH-0956 [Stripe ops alerts → email] are both touching Stripe surfaces in parallel chats. Both inherited the same "trust inputs without verifying against docs" pattern that ORCH-0954 fell into.

**Recommended action for orchestrator:** write `COMMS-0003` to the comms ledger before this amendment is approved, severity `WARN`, target `ALL`, subject "External-API integration ORCHs must cite provider docs URLs inline at SPEC time per I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED." Body summarizes the ORCH-0954 failure mode + points to the new memory rules + invariant. This is the bridge between this amendment landing and ORCH-0955/0956 picking up the rule.

Specific Stripe parameters in ORCH-0955 + ORCH-0956 worth flagging for forensics re-audit:

- **ORCH-0955 [Native Stripe Tax]** — embedded Tax components `<ConnectTaxRegistrations>` + `<ConnectTaxSettings>`. Stripe docs for both are at https://docs.stripe.com/connect/supported-embedded-components/tax-registrations.md and https://docs.stripe.com/connect/supported-embedded-components/tax-settings.md. Verify every parameter, especially server vs component-prop placement (same gotcha as `collectionOptions`).
- **ORCH-0956 [Stripe ops alerts]** — webhook event types being routed (charge.dispute.* family, etc.). Verify against https://docs.stripe.com/api/events/types.md — event name strings change occasionally and are stricter than they look.

This is FYI from ORCH-0954 forensics to ORCH-0955/0956 forensics — no blocking gate; the COMMS-0003 WARN does the actual routing.

---

## §A8 — Out of scope for this amendment

Explicitly NOT addressed here (per dispatch + scope discipline):
- `supabase/functions/brand-stripe-tax-dashboard-link/` — ORCH-0955 scope per COMMS-0001.
- Live-key validation strategies — dispatch forbids.
- Revert of PR #204 — operator chose rework-in-place.
- Code changes — implementor's phase.
- Specific Vercel project / per-env env-var configuration commands — operator decides which env var system path (α-1 vs α-2) and the implementor wires it.
- Mobile native app fail-close updates (`app-mobile/`) — out of ORCH-0954 surface envelope.
- CI gate for I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED — deferred to a future META-ORCH.

---

## §A9 — Implementation order (revised)

After operator decides §A3 (α vs β vs γ):

1. Update `_shared/stripeBlueprintClient.ts` — change `fees_collector` enum, update named-constant string assertion in the strict-grep gate `.github/scripts/strict-grep/orch-0954-controller-props-pinned.mjs` (currently asserts `"account"`; flip to `"stripe"`).
2. Update `brand-stripe-onboard/index.ts:682-695` — remove `collection_options` from server payload.
3. Update `brand-stripe-account-session/index.ts:81-92` — remove `collection_options` from server payload for the `account_onboarding` surface.
4. If §A3 = α: update `mingla-business/app.config.ts:88-94` per-env gate per α-spec; add per-env env vars to Vercel; wire `business_web_origin_override` (α-1) into edge functions OR Origin-header detection (α-2).
5. If §A3 = β: spawn staging Vercel project + DNS + per-env Supabase secret + EAS staging profile.
6. If §A3 = γ: no host changes; tester runs CLI-only validation.
7. New regression tests per §A4 — implementor happy-path + tester adversarial.
8. Update existing tests in `_shared/__tests__/stripeBlueprintClient.test.ts` etc. to assert the new `"stripe"` value (covered by `[TEST-MOD-APPROVED ORCH-0954]` token already in the merged commit).
9. Update strict-grep gate `orch-0954-controller-props-pinned.mjs` to assert `fees_collector: "stripe"` literal (currently asserts `"account"` based on the broken merge).
10. Redeploy 2 edge functions (`brand-stripe-onboard`, `brand-stripe-account-session`) — `stripe-webhook` untouched.
11. Redeploy `mingla-business` (Vercel auto-builds on push with `[deploy]` tag).

`stripe-webhook` is OUT of redeploy scope for the rework — `_shared/stripeWebhookRouter.ts` is not modified by this amendment.

---

## §A10 — Success criteria (rework gate)

Tester PASS on the rework requires ALL of:

- SC-A1: Stripe TEST-mode `accounts.create` accepts corrected `STRIPE_MANAGED_RISK_CONTROLLER`. Evidence: Stripe API response captured inline.
- SC-A2: Stripe TEST-mode `accountSessions.create` accepts corrected onboarding payload (no `collection_options` server-side). Evidence: Stripe API response captured inline.
- SC-A3: Embedded `<ConnectAccountOnboarding>` + `<ConnectNotificationBanner>` + `<ConnectAccountManagement>` render against a TEST Account Session on the chosen validation host (α preview, β staging, or γ N/A). Evidence: Playwright screenshot or live recording.
- SC-A4: New implementor happy-path test + new tester adversarial test exist at real paths, both green, both with fails-on-revert proofs at different anchors.
- SC-A5: This amendment landed in `Mingla_Artifacts/specs/` (it has — current file). DEC-159 amended text in `Mingla_Artifacts/DECISION_LOG.md` at CLOSE.
- SC-A6: Strict-grep gate `orch-0954-controller-props-pinned.mjs` updated to assert `fees_collector: "stripe"`; CI gate passes against rework commit.
- SC-A7: If §A3 = α, `app.config.ts` per-env gate exists + Vercel per-env env vars configured + edge-function origin-override wired (per α-1 or α-2 choice). If §A3 = β, staging host reachable with TEST keys. If §A3 = γ, no SC-A3 visual evidence required.

---

## §A11 — Routing

This amendment returns to orchestrator (Claude `mingla-orchestrator`) for:
1. REVIEW of the amendment text.
2. Write `COMMS-0003` to anchor `main` ledger per §A7.
3. Operator decision on §A3 (α vs β vs γ).
4. Dispatch Codex `implementor-mingla` (or Claude `mingla-implementor`) for bounded rework targeting all §A1-§A4 fixes.
5. Orchestrator deploys 2 edge functions post-implement.
6. Claude `mingla-tester` for SPEC §6 retest against the chosen validation host.
7. CLOSE: amended DEC-159 + standard artifact updates + reap worktree.

Hard guards unchanged:
- No revert of PR #204.
- No live-key validation.
- No touch to `brand-stripe-tax-dashboard-link/`.
- No deploy until rework PASSes orchestrator REVIEW.

---

## Confidence

`proven` — all three findings backed by Stripe CLI evidence in tester's report; all three fixes backed by inline Stripe docs URL citations; the operator decision required (§A3) is named and bounded.
