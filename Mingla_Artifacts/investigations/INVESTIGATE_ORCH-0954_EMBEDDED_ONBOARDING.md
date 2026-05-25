# INVESTIGATE — ORCH-0954 [Embedded onboarding cutover + Stripe-managed risk]

**Mode:** Claude `mingla-forensics` INVESTIGATE
**Date:** 2026-05-24
**Working tree:** `~/Desktop/mingla-orchs/ORCH-0954-[embedded-onboarding-cutover]/` on branch `ORCH-0954-embedded-onboarding-cutover`
**Stripe docs verified live:** 2026-05-24 (5 endpoints, see F-7..F-11)
**Status:** Read-only investigation complete. No code changes made.

---

## Executive summary

The cutover from hosted-Account-Link onboarding to Stripe-managed-risk + embedded-components is **architecturally less disruptive than feared** because most of the embedded surface already exists from B2a Path C / ORCH-0802 (DRAFT-ACTIVE I-PROPOSED-O). Five hard facts dominate scope:

1. The `accounts.create` payload in `_shared/stripeBlueprintClient.ts:104-152` will be rejected by live Stripe at the first invocation because its controller props (`losses_collector: "application"`, `fees_collector: "application"`, `dashboard: "express"`) contradict the live Platform Setup chosen by operator on 2026-05-24 (`stripe`, `account`, `none`).
2. A Mingla-hosted embedded onboarding page **already exists** at `mingla-business/app/connect-onboarding.tsx` with `@stripe/react-connect-js@3.4.1` + `@stripe/connect-js@3.4.2` already in dependencies. It renders `<ConnectAccountOnboarding>` from a `client_secret`. It is currently **unreachable** because `brand-stripe-onboard` returns `client_secret: null` and the UI navigates to the hosted Account Link URL instead.
3. **There is no React Native embedded-components SDK available to us today.** Stripe ships `@stripe/stripe-react-native` `<ConnectAccountOnboarding>` but it is **Private Preview, request-access-only** (verified 2026-05-24 at https://docs.stripe.com/connect/get-started-connect-embedded-components). I-PROPOSED-O (ACTIVE post-ORCH-0802) **forbids** RN-SDK adoption and **forbids** DIY-wrapping `@stripe/connect-js` in `react-native-webview`. The supported route is Path B: open the Mingla-hosted web page in `expo-web-browser.openAuthSessionAsync` — exactly what `BrandOnboardView.tsx:362` already does.
4. The hosted-redirect → Path B switch is therefore a **server-side rewrite + a UI URL change**, NOT a native-component build. The "embedded" experience users see is the Stripe widget rendered on `business.usemingla.com/connect-onboarding?session=...` inside an in-app browser.
5. Account Sessions API is **v1** (`POST /v1/account_sessions`), not v2 — adding a fourth raw-HTTP helper in `stripeBlueprintClient.ts` alongside `createRecipientAccount`/`createRecipientAccountLink` is the lowest-risk plumbing (v2 endpoints stay where they are; the new v1 call lives next to them with `Stripe-Version` set per the documented API version).

The "long pole" is **not** the technical port. It is two new product questions: (a) what to do for the buyer-web ticket-purchase surface that runs entirely outside the app shell (no embedded onboarding lives there, but no current code blocks ticket purchase on unonboarded brands either — F-12), and (b) what to do for Express-Dashboard semantics that disappear under `dashboard: "none"` — specifically `accounts.createLoginLink` (F-6) and the Stripe Tax registration flow (F-13) both currently rely on Express Dashboard and **break** when the controller specifies `dashboard: none`.

---

## F-1 — Current onboarding flow end-to-end (hosted Account Link)

**Claim:** Today's onboarding is a hosted-redirect flow. The mobile UI calls the edge function, which creates a v2 Account, upserts a `stripe_connect_accounts` row with `controller_dashboard_type='express'`, then creates a v2 Account Link (hosted Stripe-side page) and returns `{ client_secret: null, account_id, onboarding_url }`. The UI opens `onboarding_url` in `expo-web-browser.openAuthSessionAsync`, polls status on return.

**Evidence:**
- `supabase/functions/brand-stripe-onboard/index.ts:43-45` imports `createRecipientAccount` + `createRecipientAccountLink` from blueprint client.
- `supabase/functions/brand-stripe-onboard/index.ts:386-394` calls `createRecipientAccount({...})`.
- `supabase/functions/brand-stripe-onboard/index.ts:404-422` upserts `stripe_connect_accounts` with literal `controller_dashboard_type: "express"`.
- `supabase/functions/brand-stripe-onboard/index.ts:701-709` calls `createRecipientAccountLink({...})` to get hosted URL.
- `supabase/functions/brand-stripe-onboard/index.ts:744-748` returns `{ client_secret: null, account_id, onboarding_url: accountLink.url }`.
- `mingla-business/src/components/brand/BrandOnboardView.tsx:351-365` invokes `onboardMutation.mutateAsync({...})`, then `WebBrowser.openAuthSessionAsync(result.onboarding_url, RETURN_DEEP_LINK)`.
- Return URL: Stripe redirects to HTTPS relay at `mingla-business/app/stripe-onboarding-return.tsx:1-61`, which reads `return_to=mingla-business://onboarding-complete` and `window.location.href` redirects back to the native app.
- `mingla-business/src/components/brand/BrandOnboardView.tsx:97` constant `RETURN_DEEP_LINK = "mingla-business://onboarding-complete"`.
- After return, status is invalidated + refetched via `useBrandStripeStatus`; outcome classified by `classifyStripeOnboardingOutcome`.

**Blast radius:** This whole hosted-redirect path is going away. `onboarding_url` shape stays but it now points at `https://business.usemingla.com/connect-onboarding?session=...&brand_id=...&return_to=...` instead of `https://connect.stripe.com/...`. The HTTPS-relay return route (`stripe-onboarding-return.tsx`) becomes optional/dead — embedded onExit can redirect back to deep link directly.

**Confidence:** HIGH (direct file:line trace).

---

## F-2 — `_shared/stripeBlueprintClient.ts` controller-prop mismatch (the launch blocker)

**Claim:** The `createRecipientAccount` body in `stripeBlueprintClient.ts:104-152` will be **rejected at the first live `accounts.create` call** because three controller properties contradict the live Stripe Connect Platform Setup operator chose on 2026-05-24.

**Evidence:**
- `supabase/functions/_shared/stripeBlueprintClient.ts:133-138` — body contains:
  ```ts
  defaults: { responsibilities: { losses_collector: "application", fees_collector: "application" } },
  dashboard: "express",
  ```
- Live Platform Setup chose: `losses_collector=stripe`, `fees_collector=account`, `dashboard=none` (per INTAKE table line 19-23).
- `supabase/functions/_shared/stripeBlueprintClient.ts:140-146` — `include[]` list:
  ```
  ["configuration.merchant","configuration.recipient","identity","defaults","configuration.customer"]
  ```
- Capabilities requested at `stripeBlueprintClient.ts:113-130`: `stripe_balance.stripe_transfers` + `card_payments` (both still valid under Stripe-managed risk + dashboard:none).
- Idempotency key generated at `brand-stripe-onboard/index.ts:390-393` via `generateIdempotencyKey` + `buildStripeOnboardCreateOperation` — derives a stable per-country, per-prior-account ID. Safe to reuse for new payload; the existing 17 TEST accounts live on the sandbox key so they don't collide.
- RAK pattern: `envVarNames: ["STRIPE_RAK_ONBOARD", "STRIPE_SECRET_KEY"]` (line 110, 167). Resolves first-non-empty. `_shared/stripe.ts:52` mirrors with `stripeOnboard = () => createStripeClient("STRIPE_RAK_ONBOARD")`.

**Callsite map of v2 blueprint helpers:**
| Helper | Callsites |
|---|---|
| `createRecipientAccount` | `supabase/functions/brand-stripe-onboard/index.ts:386` |
| `createRecipientAccountLink` | `supabase/functions/brand-stripe-onboard/index.ts:701` |
| `stripeBlueprintRequest` | indirect via the two above + `_shared/__tests__/stripeBlueprintClient.test.ts` |

**Required new helper:** `createAccountSession(accountId, components, idempotencyKey)` — POST `/v1/account_sessions` (NOT `/v2/core/...`, per F-9). Returns `{ client_secret, expires_at, components }`. Uses the same RAK env pattern. Will need different `Stripe-Version` handling because v1 endpoints don't pin the `2026-04-22.preview` v2 version (see F-9).

**RAK scope concern:** Stripe restricted keys have per-resource permission lists. Today's `STRIPE_RAK_ONBOARD` was provisioned for v2 `core.accounts` create/read + v2 `core.account_links` create. Account Sessions (v1) needs explicit `account_sessions` write scope on the key. **Operator must verify** the RAK either has this scope or rotate to one that does, OR ORCH-0954 falls back to `STRIPE_SECRET_KEY` (existing helper already does this as second envVar resolution).

**Blast radius:** Entire onboarding pipeline. No live brand can sign up until this is corrected. Test-mode accounts (17 existing) are on a separate sandbox account and unaffected.

**Confidence:** HIGH.

---

## F-3 — `controller_dashboard_type` column carries 'express' literally in code

**Claim:** The `stripe_connect_accounts.controller_dashboard_type` column is a free-text mirror of Stripe's controller setting, and the edge function hard-codes `"express"` regardless of what Stripe was asked for. Under embedded onboarding the literal value must be `"none"` (or a new sentinel) to stay accurate.

**Evidence:**
- Migration `supabase/migrations/20260511000006_b2a_v3_account_type_rename.sql:23-24` comment: "Stripe controller.stripe_dashboard.type value (full|express|none). Renamed from 'account_type' 2026-05-06 per D-V3-14".
- `brand-stripe-onboard/index.ts:411` literal `controller_dashboard_type: "express"` on upsert.
- `brand-stripe-onboard/index.ts:732` literal `controller_dashboard_type: "express"` in audit emit.

**Blast radius:** Wherever this column is read for UX gating. SPEC must grep — at minimum, audit_log entries become technically incorrect, and any future report grouping by controller type miscategorizes new live accounts.

**Confidence:** HIGH.

---

## F-4 — Mingla-hosted embedded onboarding page already exists and is wired but unreachable

**Claim:** `mingla-business/app/connect-onboarding.tsx` (254 LOC) is a complete Expo-Web-only React DOM page that renders `<ConnectAccountOnboarding>` from a `session` URL param + the publishable key. It was built under B2a Path C / ORCH-0802 as the canonical Path B target. It is **currently unreachable** because (a) the edge function returns `null` for `client_secret`, and (b) `BrandOnboardView` navigates to the Stripe hosted-link URL.

**Evidence:**
- `mingla-business/app/connect-onboarding.tsx:1-30` header comment naming itself "Mingla-hosted Stripe Connect Embedded Components page" with explicit I-PROPOSED-O attribution.
- `mingla-business/app/connect-onboarding.tsx:31-36` imports:
  ```tsx
  import { ConnectAccountOnboarding, ConnectComponentsProvider } from "@stripe/react-connect-js";
  import { loadConnectAndInitialize } from "@stripe/connect-js";
  ```
- `mingla-business/app/connect-onboarding.tsx:43-58` reads `session`, `brand_id`, `return_to` from query params.
- `mingla-business/app/connect-onboarding.tsx:78-89` calls `loadConnectAndInitialize({ publishableKey, fetchClientSecret: async () => sessionClientSecret, appearance: { variables: { colorPrimary: MINGLA_BRAND_COLOR } } })`.
- `mingla-business/app/connect-onboarding.tsx:161-165` renders `<ConnectComponentsProvider connectInstance={stripeConnectInstance}><ConnectAccountOnboarding onExit={handleExit} /></ConnectComponentsProvider>`.
- `mingla-business/app/connect-onboarding.tsx:97-107` onExit → if `return_to` starts with `mingla-business://`, `window.location.href = returnTo` (deep link). Else `router.replace('/brand/{id}/payments')`.
- `mingla-business/package.json:52-53` confirms `@stripe/connect-js@3.4.2` + `@stripe/react-connect-js@3.4.1` already installed.

**Blast radius:** Implementation is mostly plumbing. SPEC needs to: (a) make `brand-stripe-onboard` return a real `client_secret` from `accounts.createSession`, (b) make `BrandOnboardView` build the `/connect-onboarding?session=...&brand_id=...&return_to=...` URL (or have the edge function build it server-side and return as `onboarding_url`), (c) optionally extend `onExit` UX (full ToS URL + privacy URL + onStepChange logging — see F-7 props).

**Confidence:** HIGH.

---

## F-5 — React Native embedded components are Private Preview; Path A still forbidden

**Claim:** Stripe ships `@stripe/stripe-react-native` `<ConnectAccountOnboarding>` but it is **Private Preview, request-access-only** as of 2026-05-24. ORCH-0802 ACTIVE invariant I-PROPOSED-O forbids native RN-SDK adoption AND forbids DIY-wrapping connect-js in WebView. Mingla has only one supported route today: **Path B (Mingla-hosted web page in expo-web-browser)**.

**Evidence:**
- WebFetch result `docs.stripe.com/connect/get-started-connect-embedded-components` (2026-05-24): "React Native — 🔒 Private Preview — Sign in to request access."
- WebFetch result `docs.stripe.com/connect/supported-embedded-components/account-onboarding` (2026-05-24): "React Native — Private Preview."
- Account Management embedded component on RN: **not listed in supported platforms** (Web JS + React only; F-8). Even if we had RN preview access for Onboarding, we'd still need Path B for Account Management.
- Notification Banner: **Web JS + React only** (F-10).
- I-PROPOSED-O (ACTIVE post-ORCH-0802 close): `Mingla_Artifacts/specs/SPEC_ORCH-0802_STRIPE_CONNECT_EMBEDDED_COMPONENTS.md:147-170` — strict-grep gate at `.github/scripts/strict-grep/orch-0802-stripe-embedded-components-routing.mjs` enforces (1) no `@stripe/connect-js` imports from `mingla-business/`, (2) no RN-SDK `ConnectComponentsProvider`, (3) no `WebView` + `connect.stripe.com` co-occurrence.

**Implication:** The "embedded onboarding UI in mingla-business" deliverable in INTAKE §1.2 means **expanding/finishing the existing Mingla-hosted web page**, not writing native RN Stripe components. The native-app UX is: `BrandOnboardView` opens the system browser → user completes embedded onboarding in the browser → onExit deep-links back. No RN component code is written.

**Blast radius:** Saves ~5-7 days of native RN integration work that was scoped in INTAKE. Forces SPEC to be explicit about Path B routing or the implementor may attempt RN-SDK adoption and fail the strict-grep gate. SPEC must also explicitly **not** flip the EXIT clause of I-PROPOSED-O (RN GA hasn't happened).

**Confidence:** HIGH (Stripe docs verified live; I-PROPOSED-O cited).

---

## F-6 — Express Dashboard login-link breaks under `dashboard: "none"`

**Claim:** The Tax-dashboard-link edge function (`brand-stripe-tax-dashboard-link`) calls `stripe.accounts.createLoginLink(stripeAccountId)`. Stripe's `accounts.createLoginLink` is **only valid for `controller.stripe_dashboard.type='express'`**. Under the new `dashboard: "none"` controller, this call **fails with a Stripe error** for every new live brand. This is a SECOND launch-blocker hiding behind the first.

**Evidence:**
- `supabase/functions/brand-stripe-tax-dashboard-link/index.ts:92-99` — calls `stripe.accounts.createLoginLink(account.stripe_account_id, ...)`.
- `_shared/stripe.ts:72` exports `stripeTaxDashboardLink` factory (RAK or fallback).
- File-level comment lines 6-19 explicitly describes the redirect target as "Stripe Express Dashboard": "The brand opens Stripe Express Dashboard via this login-link, navigates to 'Tax registrations'..."
- Stripe docs (live 2026-05-24, F-9): account_sessions supports a `tax_registrations` embedded component (no features). Replacement path exists.
- UI callsite: `mingla-business/src/components/brand/BrandPaymentsView.tsx` Tax section invokes this function (confirmed via grep "tax-dashboard" earlier).

**Blast radius:** The Tax registration UX is broken for every new live brand from day one. SPEC must either (a) replace with embedded `tax_registrations` + `tax_settings` components (preferred, same Path B Mingla-hosted page can host both), or (b) defer Tax UX to ORCH-0955 [Native Stripe Tax for Platforms] explicitly. Embedded tax_registrations is GA per F-9. Note ORCH-0802 SPEC explicitly excluded Tax (`§2 non-goals`) — that exclusion no longer holds because the underlying dashboard semantics break.

**Confidence:** HIGH.

---

## F-7 — Stripe Account Onboarding embedded component contract

**Claim:** `<ConnectAccountOnboarding>` (Web + React) is GA. AccountSession requires only `components[account_onboarding][enabled]=true`. Optional features: `disable_stripe_user_authentication`, `external_account_collection` (default true). Component-side props: `onExit`, `onStepChange({step})`, `fullTermsOfServiceUrl`, `recipientTermsOfServiceUrl`, `privacyPolicyUrl`, `collectionOptions`.

**Evidence:** WebFetch `docs.stripe.com/connect/supported-embedded-components/account-onboarding` 2026-05-24.

**Implication for SPEC:**
- The existing `connect-onboarding.tsx` already wires `onExit`. SPEC should add `onStepChange` for analytics/audit, plus the three ToS/privacy URLs (Mingla ToS + Stripe ToS + Mingla privacy policy URLs — operator-supplied).
- `external_account_collection: true` requires Stripe user auth popup — operator must accept that the onboarding flow includes a Stripe auth step. There is no way to skip this except `controller.requirement_collection='application'` mode, which is incompatible with `losses_collector='stripe'` (Stripe-managed risk = `requirement_collection='stripe'`). SPEC must document this.
- `collectionOptions.fields='currently_due'` is the default. For full collection set `'eventually_due'`. Stripe-managed risk likely wants `'eventually_due'` to minimize re-prompts (confirm at SPEC).

**Confidence:** HIGH.

---

## F-8 — Account Management embedded component is web-only + has limits

**Claim:** `<ConnectAccountManagement>` is **Web JS + React only** (no RN, no iOS, no Android). It allows account-detail editing (bank, tax info, business profile, persons) but is explicitly **NOT a full Express Dashboard replacement** — does not handle risk verifications. For risk-driven UX, Stripe directs to `<ConnectAccountOnboarding>` + `<ConnectNotificationBanner>`.

**Evidence:** WebFetch `docs.stripe.com/connect/supported-embedded-components/account-management` 2026-05-24.

**Implication for SPEC:** "Embedded account-management UI replacing Express Dashboard" (INTAKE §1.3) means building a second Mingla-hosted web page at e.g. `/connect-account-management?session=...` that renders `<ConnectAccountManagement>`, opened the same way (in-app browser from `BrandPaymentsView` "Manage Stripe account" CTA). Same Path B pattern as onboarding. Plus a separate page (or co-mounted on the same page) hosting `<ConnectNotificationBanner>` for KYC/payout-failure alerts.

**Doc note:** Stripe docs label Account Management as "Preview/Demo component that behaves differently than live mode usage." Operator should validate live behavior before treating this as the Stripe-Dashboard replacement. This is **the largest correctness risk in the embedded-management deliverable.**

**Confidence:** HIGH on platform support (Web-only); MEDIUM on "fully production-ready in live mode" — depends on Stripe's own GA timeline.

---

## F-9 — Account Sessions API is v1, not v2

**Claim:** `POST /v1/account_sessions` is a Stripe v1 endpoint (returns `client_secret` + `expires_at`). Adding it to `stripeBlueprintClient.ts` means a new helper that does NOT pin the `2026-04-22.preview` v2 header — or it pins a v1 stable API version. The 24 supported components include `account_onboarding`, `account_management`, `notification_banner`, `tax_registrations`, `tax_settings`, `balances`, `payouts`, `payments`, etc.

**Evidence:** WebFetch `docs.stripe.com/api/account_sessions/create` 2026-05-24. Endpoint path `/v1/account_sessions`. `account` param expects v1 `acct_ID` format.

**Implication for SPEC:**
- The existing v2 helpers in `stripeBlueprintClient.ts:60-95` (`stripeBlueprintRequest`) always set `Stripe-Version: 2026-04-22.preview`. Reusing this for v1 is technically allowed (v1 endpoints accept any API version) but cleaner to split: either (a) add a `apiVersion?` param to `stripeBlueprintRequest`, or (b) route the new helper through the existing SDK-backed `_shared/stripe.ts` client (already pinned for v1).
- v2 Account IDs and v1 acct_IDs: the v2 `accounts.create` response `id` field is the same format as v1 `acct_...` per the Stripe Connect blueprint (verified by reading the v2 doc structure during ORCH-0764A). Reusing the same `stripe_account_id` value into `account_sessions.create` is correct.
- **Open question for SPEC:** does Stripe's v1 `account_sessions` accept a v2-created account? Stripe docs do not explicitly answer. SPEC must require the implementor to live-fire test with one of the existing 17 TEST connected accounts before declaring success.

**Confidence:** HIGH on endpoint identity + components list; MEDIUM on v2-account ↔ v1-account_sessions compatibility (needs live verify).

---

## F-10 — Notification Banner is web-only

**Claim:** `<ConnectNotificationBanner>` is **JavaScript + React + HTML+JS only**. Surfaces risk interventions, onboarding requirements, currently_due, eventually_due, future requirements. AccountSession features: `external_account_collection`, `disable_stripe_user_authentication`. Configuration: `collectionOptions.fields`, `collectionOptions.futureRequirements`, `onNotificationsChange({total, actionRequired})` callback.

**Evidence:** WebFetch `docs.stripe.com/connect/supported-embedded-components/notification-banner` 2026-05-24.

**Implication for SPEC:** If we want in-app notification banners (KYC required, payouts failing), we must either (a) embed `<ConnectNotificationBanner>` on the same Mingla-hosted account-management page, OR (b) keep using our existing custom `BrandStripeKycRemediationCard.tsx` + `BrandStripeDeadlineBanner` components which already read `requirements` JSON from the local `stripe_connect_accounts` table (which gets populated by the existing `brand-stripe-refresh-status` + the existing `account.updated` webhook handler). The latter requires no new code; the former gives Stripe-canonical messaging at the cost of another web page.

**Recommendation to SPEC:** Keep the custom KYC card/banner (zero rework, already production-grade), defer `<ConnectNotificationBanner>` adoption to a follow-up ORCH. Status quo on this surface is fine post-cutover because `requirements` JSON shape doesn't depend on controller props.

**Confidence:** HIGH.

---

## F-11 — Tax registrations + Tax settings are GA embedded components (replaces Express Dashboard Tax UI)

**Claim:** `tax_registrations` and `tax_settings` are listed as supported embedded components in `account_sessions.create` (F-9). They have empty features sets. They are listed alongside other GA components.

**Evidence:** WebFetch `docs.stripe.com/api/account_sessions/create` 2026-05-24 — components list includes `tax_registrations` (item 20) and `tax_settings` (item 21).

**Implication for SPEC:** `brand-stripe-tax-dashboard-link` (F-6) can be rewritten to issue an Account Session with `components[tax_registrations][enabled]=true` (+ optionally `tax_settings`) and route the user to a Mingla-hosted page `/connect-tax-registrations?session=...` that renders Stripe's tax UI inline. This is the cleanest path. Alternative: defer to ORCH-0955.

**Confidence:** HIGH on component availability; MEDIUM on whether ORCH-0954 or ORCH-0955 owns the rewrite.

---

## F-12 — Buyer-side ticket purchase does NOT block on brand onboarding status

**Claim:** Searching the consumer code paths (`ticket-checkout-create/index.ts`, `ticket-checkout-confirm/index.ts`, `process-scheduled-installments/index.ts`) for `charges_enabled` checks returns ZERO results. The buyer flow assumes the order row has a `stripe_account_id` and proceeds; if Stripe rejects the PaymentIntent due to a non-onboarded brand, the buyer sees a generic checkout failure.

**Evidence:**
- `grep -rn "charges_enabled" supabase/functions/{ticket-checkout-create,ticket-checkout-confirm,process-scheduled-installments}/index.ts` → empty.
- `supabase/functions/ticket-checkout-confirm/index.ts:218` reads `session.stripe_account_id` only.
- `supabase/functions/process-scheduled-installments/index.ts:202` reads `stripe_account_id` only.

**Blast radius:** Pre-existing UX gap, NOT introduced by ORCH-0954. Mention as observation, but **out of scope** for this ORCH. SPEC should explicitly note "no buyer-side code change required — buyer-web ticket purchases continue to depend on `stripe_account_id` being present + Stripe accepting the charge; nothing about embedded vs. hosted onboarding changes that contract."

**Confidence:** HIGH.

---

## F-13 — Admin web has zero Stripe-status surface

**Claim:** Grepping `mingla-admin/src/` for `stripe_account_id`, `charges_enabled`, `payouts_enabled`, `stripeStatus`, `stripe_connect_id` returns **zero results**. Admin support reps have no view of brand Stripe onboarding state today.

**Evidence:**
- `grep -rln "stripe_account_id\|charges_enabled\|stripeStatus\|stripe_connect_id" mingla-admin/src/` → empty.

**Blast radius:** Pre-existing gap, not caused by ORCH-0954. INTAKE §6 asked whether admin will see embedded-onboarding progress; the answer is "admin sees nothing about Stripe today, which means nothing changes." If operator wants admin-side visibility, that's a separate ORCH (could plug into ORCH-0956 [Stripe ops alerts email] or stand alone). SPEC should explicitly note this as "OUT OF SCOPE — admin Stripe-status visibility is a pre-existing absence and not introduced by this cutover."

**Confidence:** HIGH.

---

## F-14 — STRIPE_RAK_ONBOARD scope needs `account_sessions:write`

**Claim:** Current `STRIPE_RAK_ONBOARD` was provisioned for v2 core account + account_link writes. Account Sessions is v1 and requires an explicit `account_sessions:write` (Stripe-internal scope label) permission. INTAKE §1.5 anticipated this. Operator must verify the live RAK has this scope or rotate.

**Evidence:**
- `_shared/stripeBlueprintClient.ts:110, 167` — both v2 helpers list `["STRIPE_RAK_ONBOARD", "STRIPE_SECRET_KEY"]` in that order. The new `createAccountSession` helper will follow the same pattern, so if the live RAK lacks scope, it falls back to `STRIPE_SECRET_KEY` (full unrestricted key) — functional but defeats the RAK's least-privilege purpose.

**Blast radius:** Either rotation (operator action, 5 min) or accept fallback to STRIPE_SECRET_KEY for onboarding cycle. SPEC should require RAK rotation, NOT silent fallback.

**Confidence:** MEDIUM (depends on what RAK scope dashboard shows live; operator must check).

---

## F-15 — Existing 17 TEST accounts continue to work; live onboarding is greenfield

**Claim:** INTAKE confirms 17 TEST mode accounts on sandbox `acct_1TTnt1PjlZyAYA40` and zero LIVE accounts on `acct_1TU23tIAdZKekynz`. TEST accounts continue under their original platform-liable Express controller — they don't migrate. Live brand onboarding starts at zero, so there is no data migration required by ORCH-0954.

**Evidence:** INTAKE doc lines 27-28; consistent with the platform-key-per-mode separation in `_shared/stripe.ts`.

**Blast radius:** Simplifies SPEC. No backfill migration. The hard part is purely the new flow for new live brands. TEST sandbox keeps the old flow working for QA/repro purposes.

**Confidence:** HIGH.

---

## Routing recommendation to SPEC

**SPEC must answer these open questions explicitly before IMPLEMENT dispatch:**

### Architecture
1. **RN strategy:** confirm SPEC adopts Path B (Mingla-hosted web in expo-web-browser) per I-PROPOSED-O. Forbid `@stripe/stripe-react-native` Connect imports. Forbid WebView wrapping. (Recommended: re-cite I-PROPOSED-O verbatim in SPEC §8.)
2. **`/connect-onboarding` page reuse:** confirm we extend the existing file rather than write a new one. Add `onStepChange`, ToS/privacy URLs, error retry path.
3. **Account-management page:** new file `mingla-business/app/connect-account-management.tsx` mirroring connect-onboarding.tsx structure. Decide whether to co-mount `<ConnectNotificationBanner>` on same page or keep custom `BrandStripeKycRemediationCard`.
4. **Tax UX:** does ORCH-0954 own the rewrite of `brand-stripe-tax-dashboard-link` to issue an Account Session with `tax_registrations` component? Or defer entirely to ORCH-0955 with a hard gate "tax UX broken between this ORCH and ORCH-0955"? **(operator decision — affects effort estimate by ~2 days)**.

### Stripe API plumbing
5. **`createAccountSession` helper:** add to `stripeBlueprintClient.ts`. v1 endpoint. RAK env-var pattern. SPEC must specify exact `components` map per page (onboarding-only for /connect-onboarding; management + optional notification_banner for /connect-account-management; tax_registrations [+ tax_settings] for /connect-tax-registrations if included).
6. **v2 account ID ↔ v1 account_sessions compatibility:** require IMPLEMENT to live-fire verify against a TEST account before declaring SUCCESS. Hard gate.
7. **`Stripe-Version` header for v1:** decide whether to drop the `2026-04-22.preview` pin for the new helper or keep it (Stripe accepts arbitrary versions on v1).
8. **RAK scope:** SPEC must require operator to confirm STRIPE_RAK_ONBOARD has `account_sessions:write` scope BEFORE merging; require rotation if absent (no silent fallback to STRIPE_SECRET_KEY).

### Edge function changes
9. **`brand-stripe-onboard` rewrite:** new payload (Stripe-managed risk, dashboard:none), then create Account Session right after the upsert, return `{ client_secret: <accountSession.client_secret>, account_id, onboarding_url: <Mingla-hosted URL with session+brand_id+return_to query> }`.
10. **`controller_dashboard_type` column value:** change literal from `"express"` to `"none"` at every write site (`brand-stripe-onboard/index.ts:411, 732`). Migration of pre-existing TEST sandbox rows: **not needed** (those rows stay 'express' truthfully).
11. **HTTPS-relay route deprecation:** `mingla-business/app/stripe-onboarding-return.tsx` becomes dead code under embedded flow. SPEC must decide: delete, or keep as fallback for the hosted-link path that still exists for sandbox/TEST? Recommend: keep for now, mark `@deprecated`.
12. **`brand-stripe-tax-dashboard-link` rewrite:** see #4 above.

### Invariants
13. **I-PROPOSED-O re-cite:** SPEC §8 should restate I-PROPOSED-O as STILL ACTIVE under new controller, no EXIT condition triggered.
14. **New invariant proposal:** "I-PROPOSED-XX — Stripe controller properties pinned to (losses_collector=stripe, fees_collector=account, dashboard=none) for all new live brand accounts." Strict-grep gate fails-on-revert if `dashboard: "express"` or `losses_collector: "application"` literal appears in `stripeBlueprintClient.ts` again. **This is the structural fix that prevents the launch-blocker from recurring.**
15. **DEC log:** write the DEC reversing DEC-156 + re-affirming DEC-154 per INTAKE §1.6.

### Highest-uncertainty area
**The single biggest unknown remaining** is whether `<ConnectAccountManagement>` is genuinely production-ready in live mode (F-8 doc note: "Preview/Demo component that behaves differently than live mode"). If it isn't, the "embedded account management UI" deliverable degrades to "use a combination of custom local UI (KYC card, balance tiles, refund history — all already exist) + a single embedded surface for bank-detail edit." SPEC must require IMPLEMENT to live-fire `<ConnectAccountManagement>` against a TEST account and document any divergence between docs and actual behavior before locking in the design.

### Out-of-scope reaffirmation (do not let scope creep in)
- Buyer-web ticket purchase code paths (F-12) — pre-existing, not introduced by this ORCH.
- Admin-web Stripe visibility (F-13) — pre-existing absence, separate ORCH if wanted.
- Consumer mobile (no onboarding there).
- Migration of TEST sandbox accounts (F-15).

---

**End of investigation. Routing to SPEC.**
