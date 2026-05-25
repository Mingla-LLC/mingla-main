# SPEC — ORCH-0954 [Embedded onboarding cutover + Stripe-managed risk]

**Mode:** Claude `mingla-forensics` SPEC
**Date:** 2026-05-24
**Working tree:** `~/Desktop/mingla-orchs/ORCH-0954-[embedded-onboarding-cutover]/` on branch `ORCH-0954-embedded-onboarding-cutover`
**Predecessor INVESTIGATE:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-0954_EMBEDDED_ONBOARDING.md`
**Cross-ORCH coordination:** COMMS-0001 in `~/Desktop/mingla-main/COMMS_LEDGER.md`
**Confidence:** Implementor-ready. Two operator-confirmed pre-conditions (Q1 + Q2) baked in.

---

## §1 — Goal + success criteria

**Goal.** Cut Mingla over from the hosted Account Link onboarding flow (platform-liable Express controller, `losses_collector=application` / `fees_collector=application` / `dashboard=express`) to Stripe-managed-risk + embedded-components onboarding (`losses_collector=stripe` / `fees_collector=account` / `dashboard=none`) so the very first live brand can sign up. Reuse the existing Mingla-hosted Stripe Connect Embedded Components page (`mingla-business/app/connect-onboarding.tsx`) per I-PROPOSED-O Path B. Add a sibling account-management page. Do NOT touch the Tax dashboard (ORCH-0955 owns that, per COMMS-0001).

**Success criteria (objective, testable).**

1. `_shared/stripeBlueprintClient.ts` `createRecipientAccount` body contains literals `losses_collector: "stripe"`, `fees_collector: "account"`, `dashboard: "none"`. The literals `"application"` and `"express"` no longer appear in the controller-prop block (lines 133-139).
2. A new exported helper `createAccountSession(input)` exists in `_shared/stripeBlueprintClient.ts`, POSTs to `/v1/account_sessions`, follows the same `["STRIPE_RAK_ONBOARD", "STRIPE_SECRET_KEY"]` env-var pattern, and returns `{ client_secret, expires_at, components }`.
3. `supabase/functions/brand-stripe-onboard/index.ts` no longer calls `createRecipientAccountLink`. Instead, after the SCA upsert it calls `createAccountSession` with `components: { account_onboarding: { enabled: true, features: { external_account_collection: true } } }`, and returns `{ client_secret: <real>, account_id, onboarding_url: <Mingla-hosted URL> }` where the URL is `${BUSINESS_WEB_ORIGIN}/connect-onboarding?session=<client_secret>&brand_id=<brand_id>&return_to=<encoded RETURN_DEEP_LINK>`.
4. Every `controller_dashboard_type` literal write in the codebase reads `"none"` post-cutover. Three sites: `brand-stripe-onboard/index.ts:410`, `brand-stripe-onboard/index.ts:732` (audit), `_shared/stripeWebhookRouter.ts:180`.
5. `mingla-business/app/connect-onboarding.tsx` renders `<ConnectAccountOnboarding>` with `onExit`, `onStepChange`, and the three operator-supplied URL props (`fullTermsOfServiceUrl`, `recipientTermsOfServiceUrl`, `privacyPolicyUrl`). `collectionOptions={{ fields: "eventually_due" }}` is set explicitly.
6. A NEW page `mingla-business/app/connect-account-management.tsx` exists, mirrors the onboarding page structure, and renders `<ConnectAccountManagement>` (and co-mounts `<ConnectNotificationBanner>`) from a fresh account session with `components: { account_management: { enabled: true, features: { external_account_collection: true } }, notification_banner: { enabled: true, features: { external_account_collection: true } } }`.
7. A NEW edge function `brand-stripe-account-session` exists, behaves like `brand-stripe-onboard` minus the account-create step (it only mints sessions for an already-existing brand SCA), and is called from `BrandPaymentsView`'s "Manage Stripe account" CTA.
8. `BrandOnboardView.tsx` `handleStart` continues to open the returned `result.onboarding_url` in `expo-web-browser.openAuthSessionAsync(url, RETURN_DEEP_LINK)` — no RN-SDK adoption, no WebView wrap. I-PROPOSED-O stays ACTIVE.
9. The new `DEC-159` entry (text in §2 below) lands in `Mingla_Artifacts/DECISION_LOG.md` as part of the CLOSE commit.
10. Two new invariants are proposed (DRAFT → ACTIVE on CLOSE): `I-PROPOSED-CONTROLLER-PROPS-PINNED` and `I-PROPOSED-RAK-SCOPE-PINNED`. Both backed by strict-grep CI gates (§4).
11. ORCH-0840 §0.5 happy-path regression test and adversarial test both land at the paths specified in §5 and pass green in CI.
12. Live-fire validation gate (§6) is executed on a TEST-mode brand by tester before CLOSE; evidence captured in `Mingla_Artifacts/tests/`.

---

## §2 — DEC-159 (verbatim text to land in DECISION_LOG.md at CLOSE)

> **2026-05-24 — DEC-159 logged — ORCH-0954 [Embedded onboarding cutover + Stripe-managed risk] SPEC.** Decision: **reverses DEC-156 and re-affirms DEC-154.** During ORCH-0953 Phase A live-Stripe Connect Platform Setup on 2026-05-24, operator chose **Option 2 — Stripe-managed risk + embedded onboarding** at the Stripe Dashboard Platform Setup screen, selecting `losses_collector=stripe`, `fees_collector=account`, `dashboard=none`. This contradicts DEC-156's platform-liable Express amendment (`losses_collector=application` / `fees_collector=application` / `dashboard=express`) which was scoped under the prior decision tree. Operator accepted the multi-week embedded-components scope cost over the chargeback exposure of platform-liable losses. Net effect: (a) DEC-154 (original Stripe-managed-risk decision) returns to ACTIVE; (b) DEC-156 is marked REVERSED-2026-05-24 and frozen in the log for traceability; (c) all new live brand connected accounts post-ORCH-0954-CLOSE use Stripe-managed risk + Mingla-hosted embedded components (Path B per I-PROPOSED-O); (d) the 17 pre-existing TEST-mode connected accounts on sandbox `acct_1TTnt1PjlZyAYA40` stay frozen on their original platform-liable Express controller — no migration, no backfill (per F-15); (e) ORCH-0955 [Native Stripe Tax for Platforms] owns the embedded `tax_registrations` / `tax_settings` rewrite of `brand-stripe-tax-dashboard-link`, NOT this ORCH (COMMS-0001 in `mingla-main/COMMS_LEDGER.md`); (f) operator confirmed at 2026-05-24 that both test- and live-mode `STRIPE_RAK_ONBOARD` keys already carry `Account Sessions: Write` scope so no RAK rotation is required. Two new invariants land DRAFT → ACTIVE on ORCH-0954 CLOSE: `I-PROPOSED-CONTROLLER-PROPS-PINNED` (strict-grep gate pinning the three controller literals in `stripeBlueprintClient.ts`) and `I-PROPOSED-RAK-SCOPE-PINNED` (strict-grep gate ensuring `accountSessions` calls cite the RAK env-var ordering, not raw `STRIPE_SECRET_KEY`).

---

## §3 — Layer-by-layer changes

All paths relative to worktree root. Every change is precise; the implementor must not infer beyond what is written here.

### 3.1 `supabase/functions/_shared/stripeBlueprintClient.ts`

**3.1.a Controller-prop change (the launch-blocker fix).**

At lines 133-139, replace the existing `defaults` + `dashboard` block with:

```ts
defaults: {
  responsibilities: {
    losses_collector: "stripe",   // was: "application" — reversed by DEC-159
    fees_collector: "account",    // was: "application" — reversed by DEC-159
  },
},
dashboard: "none",                // was: "express" — reversed by DEC-159
```

These three string literals are pinned by `I-PROPOSED-CONTROLLER-PROPS-PINNED` (see §4). Hoist them into a typed `const` named `STRIPE_MANAGED_RISK_CONTROLLER` exported at the top of the file so the strict-grep gate has a single canonical anchor to inspect:

```ts
export const STRIPE_MANAGED_RISK_CONTROLLER = {
  defaults: { responsibilities: { losses_collector: "stripe", fees_collector: "account" } },
  dashboard: "none",
} as const;
```

The `createRecipientAccount` body spreads `...STRIPE_MANAGED_RISK_CONTROLLER`. Implementor must NOT inline the literals back into the body; the named constant IS the anchor the strict-grep gate looks for.

**3.1.b New `createAccountSession` helper.**

Add at the end of the file (after `createRecipientAccountLink`, before the final closing brace):

```ts
export interface AccountSessionComponents {
  account_onboarding?: { enabled: boolean; features?: { external_account_collection?: boolean; collection_options?: { fields?: "currently_due" | "eventually_due"; future_requirements?: "include" | "omit" } } };
  account_management?: { enabled: boolean; features?: { external_account_collection?: boolean; disable_stripe_user_authentication?: boolean } };
  notification_banner?: { enabled: boolean; features?: { external_account_collection?: boolean; disable_stripe_user_authentication?: boolean } };
}

export interface CreateAccountSessionInput {
  accountId: string;              // v2 account.id; verified compatible with v1 account_sessions in §6 live-fire
  components: AccountSessionComponents;
  idempotencyKey: string;
}

export interface StripeAccountSession {
  client_secret: string;
  expires_at: number;
  components: Record<string, unknown>;
  account: string;
}

export function createAccountSession(
  input: CreateAccountSessionInput,
): Promise<StripeAccountSession> {
  return stripeBlueprintRequest<StripeAccountSession>({
    method: "POST",
    path: "/v1/account_sessions",            // v1 endpoint — see §3.1.c
    envVarNames: ["STRIPE_RAK_ONBOARD", "STRIPE_SECRET_KEY"],  // pinned by I-PROPOSED-RAK-SCOPE-PINNED
    idempotencyKey: input.idempotencyKey,
    body: {
      account: input.accountId,
      components: input.components,
    },
  });
}
```

**3.1.c API-version handling for v1.**

`stripeBlueprintRequest` currently pins `Stripe-Version: 2026-04-22.preview` (v2). v1 endpoints accept arbitrary versions, so reusing the preview header is technically safe but semantically wrong. Add an OPTIONAL `apiVersion?: string` parameter to `stripeBlueprintRequest`; when set, override the default header. In `createAccountSession`, pass `apiVersion: "2025-04-30.basil"` (the current stable v1 API version Mingla pins elsewhere — confirm operator-supplied env or fallback in `_shared/stripe.ts`). If implementor finds that mingla's v1 stable version is different, use whatever `_shared/stripe.ts` `STRIPE_API_VERSION` resolves to — never invent a version.

### 3.2 `controller_dashboard_type` column writes — 3 sites

All flip `"express"` → `"none"`:

- `supabase/functions/brand-stripe-onboard/index.ts:410` (upsert into `stripe_connect_accounts`)
- `supabase/functions/brand-stripe-onboard/index.ts:732` (audit-log emit, `after.controller_dashboard_type`)
- `supabase/functions/_shared/stripeWebhookRouter.ts:180` (account.updated webhook upsert)

No DB schema migration required — the column is free-text and was renamed to `controller_dashboard_type` in `20260511000006_b2a_v3_account_type_rename.sql`. Pre-existing TEST-mode rows stay literally `"express"` (truthful for them); new live rows write `"none"` (truthful for them). No backfill.

Also at `brand-stripe-onboard/index.ts:734`, change the audit `after.onboarding_surface` from `"stripe_hosted_account_link"` to `"mingla_hosted_embedded_components"` so audit trails distinguish the two eras.

### 3.3 `supabase/functions/brand-stripe-onboard/index.ts` — response-shape rewrite

**Delete:** lines 698-720 (the `createRecipientAccountLink` block). The helper itself stays in `stripeBlueprintClient.ts` (other future callers may want hosted-link flows for fallback/debug) but is unreferenced from this function.

**Replace with:**

```ts
// Mint embedded Account Session for the Mingla-hosted onboarding page.
let accountSession: { client_secret: string };
try {
  accountSession = await createAccountSession({
    accountId: stripeAccountId,
    components: {
      account_onboarding: {
        enabled: true,
        features: {
          external_account_collection: true,
          collection_options: { fields: "eventually_due", future_requirements: "include" },
        },
      },
    },
    idempotencyKey: generateIdempotencyKey(
      brand_id,
      buildStripeAccountSessionOperation(country, stripeAccountId),  // NEW helper in idempotency module
    ),
  });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[brand-stripe-onboard] account_session create failed:", message);
  return jsonResponse({ error: "stripe_api_error", detail: message }, 502);
}
```

**Build the Mingla-hosted URL server-side** (so the client doesn't need to know `BUSINESS_WEB_ORIGIN`):

```ts
const BUSINESS_WEB_ORIGIN = Deno.env.get("BUSINESS_WEB_ORIGIN") ?? "https://business.usemingla.com";
const onboardingUrl = `${BUSINESS_WEB_ORIGIN}/connect-onboarding`
  + `?session=${encodeURIComponent(accountSession.client_secret)}`
  + `&brand_id=${encodeURIComponent(brand_id)}`
  + `&return_to=${encodeURIComponent(return_url)}`;
```

`BUSINESS_WEB_ORIGIN` must be added to Supabase function secrets (operator action, documented in §8). Default fallback is `https://business.usemingla.com` so the function works without the secret set but the fallback is the production origin.

**New response shape (replaces lines 744-748):**

```ts
return jsonResponse({
  client_secret: accountSession.client_secret,   // was always null pre-cutover
  account_id: stripeAccountId,
  onboarding_url: onboardingUrl,
});
```

Note: the `client_secret` is now non-null. `BrandOnboardView.tsx` does NOT need to consume it (the in-app browser fetches it via the URL). It is returned for parity with the type contract and for any future native-component caller. The TypeScript response type at the React Query hook side (`useBrandStripeOnboardMutation` or equivalent) must update from `client_secret: null` to `client_secret: string`. Implementor must run `tsc --noEmit` after.

### 3.4 `mingla-business/app/connect-onboarding.tsx` — extend the existing page

The existing page wires `<ConnectAccountOnboarding onExit={handleExit} />` at line 163. Add four mandatory props:

```tsx
<ConnectAccountOnboarding
  onExit={handleExit}
  onStepChange={handleStepChange}
  fullTermsOfServiceUrl="https://usemingla.com/legal/stripe-terms"
  recipientTermsOfServiceUrl="https://usemingla.com/legal/recipient-terms"
  privacyPolicyUrl="https://usemingla.com/legal/privacy"
  collectionOptions={{ fields: "eventually_due", futureRequirements: "include" }}
/>
```

`handleStepChange` is a new callback that POSTs `{ brand_id, step }` to a new lightweight edge function `brand-stripe-onboard-step-log` (or, simpler, fire-and-forget via `navigator.sendBeacon` to an existing analytics endpoint). For SPEC v1 the simplest path is: console-log + window.localStorage breadcrumb for tester to inspect — implementor decides between beacon vs. console as long as the value gets captured somewhere visible to tester. Do NOT block the UI on the callback.

`onLoadError` must also be wired — when Stripe fails to initialize the embedded component, render the existing `errorCardStyle` block with the Stripe-supplied error message.

The three URLs above are placeholders pointing at `usemingla.com/legal/...`. Operator must confirm these are the canonical legal URLs OR provide replacements at IMPLEMENT time (open question §8.Q1).

### 3.5 New page `mingla-business/app/connect-account-management.tsx`

Mirror `connect-onboarding.tsx` structure (Expo-Web-only, raw DOM, inline styles, same MINGLA_BRAND_COLOR theme). Differences:

- Reads `session`, `brand_id`, `return_to` from query params (same).
- Mounts BOTH `<ConnectAccountManagement>` AND `<ConnectNotificationBanner>` inside the single `<ConnectComponentsProvider>`:

```tsx
<ConnectComponentsProvider connectInstance={stripeConnectInstance}>
  <ConnectNotificationBanner
    collectionOptions={{ fields: "eventually_due", futureRequirements: "include" }}
    onNotificationsChange={handleNotificationsChange}
  />
  <ConnectAccountManagement
    collectionOptions={{ fields: "eventually_due", futureRequirements: "include" }}
  />
</ConnectComponentsProvider>
```

- `handleNotificationsChange({ total, actionRequired })`: console-log for SPEC v1; future ORCH can wire to in-app badge.
- The page has NO `onExit` callback (account-management is not an end-state flow). Add a manual "Done" anchor in the header that triggers the same deep-link redirect as onboarding (`window.location.href = returnTo` if `mingla-business://` scheme).
- Add the orch-strict-grep-allow comment at the top, same shape as `connect-onboarding.tsx:27`.

### 3.6 New edge function `supabase/functions/brand-stripe-account-session/`

Mirrors `brand-stripe-onboard` minus the account-create step. Accepts `{ brand_id, surface: "account_management" | "onboarding" }`. Looks up the existing `stripe_connect_accounts` row by `brand_id` (must exist + not be `detached_at`); if missing, returns `404 brand_not_onboarded`. Calls `createAccountSession` with the components map appropriate for the surface:

- `surface === "account_management"`: components = `{ account_management: { enabled: true, features: { external_account_collection: true, disable_stripe_user_authentication: false } }, notification_banner: { enabled: true, features: { external_account_collection: true } } }`.
- `surface === "onboarding"`: components = the same map used in §3.3 (`account_onboarding`).

Returns `{ client_secret, account_id, target_url }` where `target_url` is the Mingla-hosted URL for the chosen surface (`/connect-onboarding` or `/connect-account-management`).

Why a separate function (not query-param to existing): keeps `brand-stripe-onboard` semantically about account creation. Account management is a different mental model and avoids accidental re-creation paths.

### 3.7 Mobile entry points

**Onboarding (no change beyond URL contents):** `BrandOnboardView.tsx:343-365` already calls `onboardMutation` then `WebBrowser.openAuthSessionAsync(result.onboarding_url, RETURN_DEEP_LINK)`. Because `onboarding_url` now points at `business.usemingla.com/connect-onboarding?session=...&...` instead of `connect.stripe.com/...`, NO change to this file is required. Path B per I-PROPOSED-O is preserved verbatim.

**Account management (new wiring):** `BrandPaymentsView.tsx` (mingla-business) currently has a "Manage Stripe account" CTA that calls `brand-stripe-tax-dashboard-link`. Re-point the CTA to a new mutation that calls `brand-stripe-account-session` with `surface: "account_management"`, then opens `target_url` in `expo-web-browser.openAuthSessionAsync(url, RETURN_DEEP_LINK)`. The Tax-specific dashboard-link CTA stays UNTOUCHED (ORCH-0955 owns it per COMMS-0001) — the new CTA sits alongside it OR replaces a generic "Stripe Dashboard" button if one exists. Implementor must grep `BrandPaymentsView.tsx` to identify the exact CTA + its current handler; SPEC pins the contract but leaves the layout decision to implementor + designer.

### 3.8 `mingla-business/app/stripe-onboarding-return.tsx` — keep, mark deprecated

This file handles the HTTPS-relay redirect from Stripe's hosted Account Link back to the deep link. Under embedded onboarding the redirect happens client-side from `connect-onboarding.tsx:97-107` (window.location.href). The relay file is therefore dead code for new live brands but still serves the 17 pre-existing TEST accounts on their original hosted flow if any are re-onboarded.

**Action:** Add a TSDoc `@deprecated` comment at the top of `stripe-onboarding-return.tsx` citing ORCH-0954 + DEC-159. Do NOT delete (TEST account re-onboarding paths still hit it).

### 3.9 DB schema changes

**None required.** `controller_dashboard_type` is free-text and already accepts `"none"`. `stripe_connect_accounts` has all needed columns. No new table.

### 3.10 Idempotency-key helper

Add `buildStripeAccountSessionOperation(country: string, stripeAccountId: string): string` to the existing idempotency-key module (alongside `buildStripeOnboardCreateOperation` and `buildStripeOnboardLinkOperation`). Returns e.g. `account_session:${country}:${stripeAccountId}`. Account Sessions are short-lived (expire ~30 min) so reusing the same idempotency key is fine within Stripe's 24h replay window — keeps audit logs clean when a user opens the page twice.

---

## §4 — Invariants (DRAFT → ACTIVE on CLOSE)

### I-PROPOSED-CONTROLLER-PROPS-PINNED

**Rule:** The exported constant `STRIPE_MANAGED_RISK_CONTROLLER` in `supabase/functions/_shared/stripeBlueprintClient.ts` MUST literally contain `losses_collector: "stripe"`, `fees_collector: "account"`, and `dashboard: "none"`. No other values are acceptable for live-brand account creation. The literal `"express"` and the literal `"application"` (as controller-prop values) MUST NOT appear anywhere in `supabase/functions/_shared/stripeBlueprintClient.ts`.

**Why it exists:** This exact triple-literal mismatch was the launch-blocker that prompted ORCH-0954. Pinning the constant in source + grep gating prevents silent regression in a hot-fix or merge conflict.

**Enforcement:** Strict-grep gate at `.github/scripts/strict-grep/orch-0954-controller-props-pinned.mjs`. Two checks:
1. Asserts `STRIPE_MANAGED_RISK_CONTROLLER` block in `stripeBlueprintClient.ts` matches a regex literally including the three pinned strings.
2. Asserts `\b(express|application)\b` does NOT appear within 5 lines of `losses_collector|fees_collector|dashboard:` in `stripeBlueprintClient.ts`.

Regression-test backup: happy-path test (§5) inspects the constant via import and asserts the three values.

### I-PROPOSED-RAK-SCOPE-PINNED

**Rule:** Every Stripe helper in `supabase/functions/_shared/stripeBlueprintClient.ts` that issues a Stripe API call (`createRecipientAccount`, `createRecipientAccountLink`, `createAccountSession`, and any future helper) MUST pass `envVarNames: ["STRIPE_RAK_ONBOARD", "STRIPE_SECRET_KEY"]` to `stripeBlueprintRequest` — in that exact order, RAK first. No helper may pass `["STRIPE_SECRET_KEY"]` alone, and no callsite outside this module may call Stripe with a hardcoded secret-key env-var name.

**Why it exists:** RAK least-privilege is the only thing keeping a leaked Supabase secret from becoming a full Stripe-account compromise. Helper functions tend to drift toward the unrestricted key under deadline pressure. Pinning the env-var ordering keeps least-privilege the default path; fallback to `STRIPE_SECRET_KEY` only fires when the RAK is missing (deploy-time misconfiguration).

**Enforcement:** Strict-grep gate at `.github/scripts/strict-grep/orch-0954-rak-scope-pinned.mjs`. Checks: every occurrence of `stripeBlueprintRequest({` in `stripeBlueprintClient.ts` is followed within 10 lines by the exact literal `envVarNames: ["STRIPE_RAK_ONBOARD", "STRIPE_SECRET_KEY"]`. Fails the build if any helper omits or reorders.

### Re-affirm I-PROPOSED-O (no flip needed)

I-PROPOSED-O (DRAFT-ACTIVE post-ORCH-0802) remains ACTIVE. The EXIT clause ("Stripe RN preview goes GA") has NOT triggered. SPEC §3.7 explicitly maintains Path B (`expo-web-browser.openAuthSessionAsync` on a Mingla-hosted DOM page). No RN-SDK Stripe Connect imports. No WebView + connect.stripe.com co-occurrence. The existing strict-grep gate at `.github/scripts/strict-grep/orch-0802-stripe-embedded-components-routing.mjs` continues to enforce this; implementor must NOT touch that gate.

---

## §5 — Test plan

Per ORCH-0840 §0.5: implementor lands the happy-path regression in the same commit as the implementation; tester lands the adversarial regression at retest.

### §5.a Happy-path regression (implementor, in IMPLEMENT commit)

**Path:** `supabase/functions/brand-stripe-onboard/__tests__/embeddedOnboarding.happy.test.ts`

**Asserts:**
1. Mocks `stripeBlueprintRequest` to capture the body of both `createRecipientAccount` and `createAccountSession`.
2. Calls `brand-stripe-onboard` end-to-end with a TEST brand_id.
3. Captured account-create body deep-equals: `defaults.responsibilities.losses_collector === "stripe"`, `defaults.responsibilities.fees_collector === "account"`, `dashboard === "none"`.
4. Captured account-session body has `components.account_onboarding.enabled === true` AND `components.account_onboarding.features.collection_options.fields === "eventually_due"`.
5. Response shape: `{ client_secret: <string>, account_id: <string>, onboarding_url: <string starting with "https://business.usemingla.com/connect-onboarding?session="> }`.
6. `stripe_connect_accounts` row inserted with `controller_dashboard_type === "none"`.

**Fails-on-revert anchor:** the test MUST be proven to fail when `STRIPE_MANAGED_RISK_CONTROLLER` is reverted to the prior literals. Implementor flips the constant locally, re-runs the test, captures the failing output, commits the constant back, and notes the commit hash + the diff that triggered the failure in the test-file header comment (per ORCH-0840 pattern).

### §5.b Adversarial regression (tester, at TEST phase)

**Path:** `supabase/functions/brand-stripe-onboard/__tests__/embeddedOnboarding.adversarial.test.ts`

**Asserts (one per scenario):**
1. **RAK fallback path:** when `STRIPE_RAK_ONBOARD` env is unset, the call falls through to `STRIPE_SECRET_KEY` and STILL succeeds. (Confirms least-privilege default + emergency fallback both work.)
2. **Idempotency:** two back-to-back calls with the same brand_id + country produce the same Stripe account_id (not two new accounts). Verifies `buildStripeAccountSessionOperation` is deterministic.
3. **Stripe-side rejection:** mocked Stripe returns 400 on account_session create → function returns `502 stripe_api_error` (NOT 500), and the SCA row was already persisted (proves onboard isn't atomic across two API calls but doesn't lose data).
4. **`controller_dashboard_type` grep:** asserts the literal `"express"` does NOT appear in the new SCA row written during the call.
5. **Webhook upsert respects controller:** simulate `account.updated` webhook for a new live account → row update preserves `controller_dashboard_type === "none"` (i.e., `stripeWebhookRouter.ts:180` literal is `"none"` not `"express"`).

### §5.c UI regression (tester, at TEST phase)

**Path:** `mingla-business/app/__tests__/connect-onboarding.adversarial.test.tsx`

**Asserts:**
1. Renders `<ConnectAccountOnboarding>` with `onStepChange`, `fullTermsOfServiceUrl`, `recipientTermsOfServiceUrl`, `privacyPolicyUrl`, AND `collectionOptions={{ fields: "eventually_due" }}` props all set. Test reads the component props.
2. `handleExit` invoked → `window.location.href` is set to `returnTo` when scheme is `mingla-business://`.
3. Missing `session` query param renders the "Invalid onboarding link" error card.

Mirror `connect-account-management.adversarial.test.tsx` for the new page.

### §5.d Strict-grep CI gate validation

Both new gates (`orch-0954-controller-props-pinned.mjs` + `orch-0954-rak-scope-pinned.mjs`) are added to the existing `.github/workflows/strict-grep-mingla-business.yml` per the post-Cycle-17b registry pattern. Implementor MUST verify each gate fails the build when its guarded property is reverted (red-then-green test of the gate itself, captured in CI logs at implementation PR).

---

## §6 — Live-fire validation gate (MANDATORY before CLOSE)

F-7 (`<ConnectAccountManagement>` doc warning) + F-9 (v2-account-id ↔ v1-account-sessions compatibility unknown) means **the implementor and tester MUST NOT declare success on mocks alone.** Tester executes the following live-fire smoke against a fresh TEST-mode brand using the sandbox Stripe account `acct_1TTnt1PjlZyAYA40`:

**Smoke A — Onboarding end-to-end (one fresh brand).**
1. Create a new brand in mingla-business as a TEST operator.
2. Tap "Set up payments" → in-app browser opens `business.usemingla.com/connect-onboarding?session=...`.
3. Embedded `<ConnectAccountOnboarding>` renders within 5s of page load.
4. Complete Stripe's KYC form (TEST mode supplies pre-filled fake data — see Stripe docs).
5. On `onExit`, app deep-links back to `mingla-business://onboarding-complete`.
6. `useBrandStripeStatus` shows `charges_enabled: true` (or correct pending state).
7. Tester captures screen recording + DB row dump.

**Smoke B — Account management end-to-end.**
1. From the same TEST brand, navigate to BrandPaymentsView → "Manage Stripe account".
2. In-app browser opens `business.usemingla.com/connect-account-management?session=...`.
3. Both `<ConnectNotificationBanner>` AND `<ConnectAccountManagement>` render within 5s.
4. Tester can edit the brand's bank-account detail (TEST mode), save, and see the update reflected in `stripe_connect_accounts.requirements` JSON via the existing refresh-status path.
5. Tester captures screen recording + DB diff.

**Failure modes that BLOCK CLOSE:**
- `<ConnectAccountManagement>` "Preview/Demo behaves differently than live mode" warning materializes as actual broken behavior (e.g., bank-edit fails silently). → SPEC degrades: omit `<ConnectAccountManagement>` for now, keep custom `BrandStripeKycRemediationCard` as the management surface, defer full Stripe-canonical account-management UI to a follow-up ORCH. Operator must accept this degradation explicitly before re-running the smoke.
- v2 account ID rejected by v1 `account_sessions` → urgent operator escalation; SPEC was wrong about F-9 compatibility; ORCH-0954 enters REWORK with new investigation. (Recovery: implementor and forensics regroup; no rollback to hosted Account Link because operator already chose Option 2 at Platform Setup.)

**Evidence artifacts.** Tester writes `Mingla_Artifacts/tests/TEST_ORCH-0954_LIVE_FIRE.md` with:
- Smoke A pass/fail + screen-recording link.
- Smoke B pass/fail + screen-recording link.
- v2/v1 compatibility confirmed observation (yes Stripe accepts the v2 id, no it rejects with `<error>`).
- `<ConnectAccountManagement>` live-vs-docs divergence notes.

CLOSE is BLOCKED until this artifact exists with two PASS verdicts.

---

## §7 — Rollback plan

If embedded onboarding fails post-deploy with one or more live brands in-flight:

**Step 1 — Stop the bleed.** Revert `STRIPE_MANAGED_RISK_CONTROLLER` literals back to the pre-cutover values in `stripeBlueprintClient.ts` and redeploy `brand-stripe-onboard`. New account creates immediately revert to platform-liable Express controller behavior.

**Step 2 — In-flight live accounts.** Connected accounts already created during the failed window with `losses_collector=stripe, fees_collector=account, dashboard=none` controller settings **cannot be re-controllered.** Stripe's controller properties are immutable post-account-create. Those live accounts stay on Stripe-managed risk forever, even after the platform-level rollback. **SPEC says this out loud: rollback does NOT undo the controller assignment for in-flight accounts.**

**Step 3 — Operator decision tree.** If only test accounts were affected: rollback is clean. If >0 live accounts were created during the window: operator must choose between (a) accepting those live brands on Stripe-managed risk forever and proceeding to platform-wide platform-liable for everyone else (mixed-controller fleet, painful long-term), or (b) deleting those live accounts via Stripe Dashboard and asking those brands to re-onboard post-rollback. Option (b) requires no in-flight payouts on those accounts; if there are, the cost of refund + re-onboard is non-trivial.

**Step 4 — Document.** Whatever operator chooses, write a new DEC entry capturing the mixed-state, so future ORCHs aren't surprised.

**Likelihood:** LOW. The §6 live-fire gate against a TEST brand reduces the chance of post-deploy failure with live brands to near-zero. The fact that zero live brands exist at INTAKE means the first live brand IS the smoke test; if it fails, no other live brands exist yet and rollback is clean.

---

## §8 — Open questions for operator — RESOLVED 2026-05-24

All four resolved by operator (Seth) before IMPLEMENT dispatch. Implementor uses these values verbatim.

**Q1 — Legal URLs (RESOLVED).** Use these exact URLs in the `accountSessions.create()` payload:
- `fullTermsOfServiceUrl="https://www.usemingla.com/terms-of-service/"`
- `recipientTermsOfServiceUrl="https://www.usemingla.com/terms-of-service/"`
- `privacyPolicyUrl="https://www.usemingla.com/privacy-policy/"`

(Mingla uses a single ToS document for both account-holder + recipient surfaces; both fields point to the same URL.)

**Q2 — `BUSINESS_WEB_ORIGIN` (RESOLVED).** Value: `https://business.usemingla.com`. Operator will add this as a Supabase function secret during the deploy phase. Implementor codes against the secret with no hard-coded fallback (fail-close if missing).

**Q3 — `BrandPaymentsView.tsx` CTA layout (RESOLVED).** Labeled button with text **"Manage payouts & tax"**. Recommended placement: row at the top of the brand payments view with primary visual weight, so it's the first thing brands see when something is wrong with their payouts. Implementor + designer finalize exact spacing/iconography; the label text is locked.

**Q4 — `<ConnectAccountManagement>` degradation path (RESOLVED — REACTIVE).** Operator does NOT pre-approve a specific degraded design. Implementor builds ONLY the primary embedded path with `<ConnectAccountManagement>` + `<ConnectNotificationBanner>`. If §6 Smoke B catches a real live-mode glitch, the orchestrator re-opens scope at that moment with operator and a new fallback is designed reactively. Tester does NOT proceed to a fallback without explicit operator approval mid-test — if Smoke B fails, tester returns CONDITIONAL PASS with the failure evidence and the orchestrator + operator decide next steps.

---

## §9 — Cross-ORCH coordination

Per **COMMS-0001** in `~/Desktop/mingla-main/COMMS_LEDGER.md`:

- **ORCH-0954 (this SPEC)** owns: `_shared/stripeBlueprintClient.ts` controller-prop change + `createAccountSession` helper, `brand-stripe-onboard` rewrite, new `brand-stripe-account-session` function, `connect-onboarding.tsx` extension, new `connect-account-management.tsx` page, two new invariants + strict-grep gates, DEC-159.
- **ORCH-0954 explicitly does NOT touch** `supabase/functions/brand-stripe-tax-dashboard-link/` — neither index.ts nor any sibling file. Touching that function is an ORCH-0955 responsibility.
- **ORCH-0955 (Native Stripe Tax)** owns: rewriting `brand-stripe-tax-dashboard-link` to mint an embedded session with `tax_registrations` + `tax_settings` components, building the `/connect-tax-registrations` Mingla-hosted page, and re-pointing the Tax CTA in `BrandPaymentsView.tsx`.
- **Inter-ORCH gap.** Between ORCH-0954 CLOSE and ORCH-0955 CLOSE, brands have NO tax-settings UI. The tax-dashboard-link function will technically still call `accounts.createLoginLink` which will fail under `dashboard: "none"` for new live brands. Operator accepted this gap at INTAKE because zero live brands exist at the time of ORCH-0954 deployment. ORCH-0955 must close BEFORE the second live brand onboards (or at the latest, before any live brand attempts to add a tax registration).

If implementor finds a non-obvious dependency on `brand-stripe-tax-dashboard-link` (e.g., a shared helper module also used by onboard), they must STOP and write a COMMS-0001 update before proceeding — do NOT silently rewrite the shared helper here.

---

## §10 — Out-of-scope (explicit)

| Item | Reason |
|---|---|
| Rewrite of `brand-stripe-tax-dashboard-link` | Owned by ORCH-0955 (COMMS-0001). |
| Building `/connect-tax-registrations` Mingla-hosted page | Owned by ORCH-0955. |
| `STRIPE_RAK_ONBOARD` key rotation | Operator confirmed live + test RAKs already carry `Account Sessions: Write` (per Q2 baked into SPEC §3.1.b). |
| Migration of 17 TEST-mode pre-existing connected accounts | F-15 — TEST accounts stay frozen on sandbox; live brands start at zero; no data migration. |
| Buyer-web ticket-purchase gating on brand onboarding status | F-12 — pre-existing UX gap, not introduced by ORCH-0954. Separate ORCH if wanted. |
| Admin-web visibility of brand Stripe onboarding status | F-13 — pre-existing absence, not introduced by ORCH-0954. Separate ORCH (could plug into ORCH-0956 [Stripe ops alerts email]). |
| `<ConnectNotificationBanner>` adoption beyond the account-management page | SPEC mounts it on the management page only; full in-app banner adoption (e.g., on home dashboard) is a follow-up. The existing custom `BrandStripeKycRemediationCard` continues to serve in-app KYC alerts. |
| RN Stripe Connect SDK adoption (`@stripe/stripe-react-native` `<ConnectAccountOnboarding>`) | I-PROPOSED-O (ACTIVE) forbids. Stripe RN preview is request-access-only; EXIT clause not triggered. |
| Deletion of `stripe-onboarding-return.tsx` HTTPS-relay route | Kept and `@deprecated`-marked. TEST account re-onboarding paths still depend on it. |
| Stripe Dashboard configuration mutations | Operator already chose Option 2 at Platform Setup 2026-05-24. No further Dashboard changes needed during ORCH-0954. |
| Consumer mobile (`app-mobile`) changes | Consumers don't onboard. No code touches `app-mobile/`. |
| Native PaymentSheet / buyer payment flow changes | Separate Stripe domain. ORCH-0849 / ORCH-0944 / ORCH-0953 own buyer-payments. |

---

**End of SPEC. Routing to REVIEW → IMPLEMENT.**

**Author:** Claude `mingla-forensics` SPEC mode
**Pre-conditions baked in (operator-confirmed 2026-05-24):**
- Q1 (Tax dashboard out of scope, ORCH-0955 owns) → §9 + §10.
- Q2 (no RAK rotation) → §3.1.b + §10.
