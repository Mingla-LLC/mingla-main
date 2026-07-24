# EXECUTION SPEC — Bank-first partner invite funnel (#948 + #949)

**Status: PRE-BUILD. Grounded design + build spec complete and verified against `main`. BLOCKED on founder sign-off of 3 decisions + 1 scoping question (below). Do NOT start building until confirmed.**

This is the canonical, execution-grade spec. It is self-contained: any agent (Claude or Codex) can read this + the linked design and build #948/#949 to the letter. All file:line anchors and code snippets were extracted from the real codebase by three grounded forensic passes; where line numbers may have drifted, **grep the quoted string** — every string is verbatim.

#948 (single bank-first CTA) and #949 (offering-agnostic copy) are ONE build — same three surfaces (invite email, "Welcome to <brand>" page, connect-bank page).

### Design deliverable (interactive, 17 screens, every fork)
- **Repo (open locally):** `docs/design/948-949-bank-first-invite-funnel.html`
- **Artifact (founder view):** https://claude.ai/code/artifact/56370b4c-6374-4003-a704-d922a3939c78

### Goal
Collapse the invited-partner journey into ONE path — **accept → add bank → get the app** — with a quiet "I'll add it later" escape to the correct app store. Chase the bank ASAP (a partner without a bank can't take a cent). Rewrite all copy offering-agnostic (tickets AND venues AND trips): "get paid for what you sell", never "sell tickets". Mingla is an experiences platform, not a ticketing tool.

### This spec has three sections (posted as the next three comments / in the repo mirror)
1. **Build spec (grounded, wave-by-wave)** — the architecture trace, all 8 blockers with exact current code + precise fix + sibling pattern + fails-on-revert test, the email single-CTA change with the exact frozen-test assertions to rewrite, and the 4-wave plan with per-wave CI gates.
2. **#949 copy sweep (grounded inventory + guard)** — every ticket-only string with file:line, exact text, and replacement; the pinned tests to change in lockstep; the legal ToS line to route around; the "scan tickets at the door" SSOT nuance; and the new strict-grep guard spec with self-test + MANIFEST registration.
3. **Live Android end-to-end test runbook** — adb/CDP bring-up + the unauthorized-device fix, the clean-slate SELECTs with both accounts' real state, OTP-read method, per-node drive + 5 assertion classes for all 17 nodes, 5 forks, and a fill-in pass/fail matrix.

### The 8 blockers (one-liners — full detail in the build-spec section)
- **B-01** route allowlist has no `/brand/…` → a bank destination reached through sign-in is silently dropped. `nextRoute.ts` NEXT_ROUTE_ALLOWLIST.
- **B-02** no one-hop route into a bank *form* (the form URL `/connect-onboarding?session=…` EXISTS; the funnel just won't walk you there). Needs a new `/brand/[id]/connect` route (clickwrap ToS → mint → land in form).
- **B-03** only `partnerSetup && transferred` accepts reach the bank ask; every other accept is never asked for a bank.
- **B-04** rail hardcoded to GB; never reads `brands.country_code` (NG reachable only by manual picker).
- **B-05** accept response carries no country/provider/bank signal → "already connected" fork undetectable. **Zero-migration** (all 6 columns exist).
- **B-06** Stripe web hand-off broken both legs (popup blocked + dead `mingla-business://` return). Fix = same-tab `window.location.assign`.
- **B-07** `BusinessAppDownloadCta` web-only → native post-skip path has no download step (needs app build).
- **B-08** "we'll remind you" has no mechanism → **recommend cutting the copy for v1** (Option A).

### 4 waves (each independently shippable + testable; all web/email except W4)
- **W1 — Enablers** (backend + pure utils, OTA-safe): B-01, B-05, B-08(cut copy).
- **W2 — One-hop route + Stripe web fix** (web, `[deploy]`): B-02, B-06, B-04.
- **W3 — Screens + copy sweep** (accept routing + email): B-03, email single-CTA + frozen-test rewrite, the #949 sweep + guard.
- **W4 — Native gaps** (needs next app build; OTA forbidden): B-07 + native legs of B-02/B-06.

### 3 DECISIONS — founder only (recommendations)
1. **Bank push** — REC: quiet tertiary "I'll add it later" text link (not a competing button); skip routes through a confirm sheet stating the real cost.
2. **Bank before app download** — REC: yes (no deferred deep-link continuity, so the app genuinely can't come first).
3. **Nigeria vs Stripe inside one CTA** — REC: pre-resolve from `brands.country_code`, show a "Payouts in Nigeria · NGN" confirm row with a quiet Change.

### OPEN SCOPING QUESTION (do not silently resolve — from the build spec)
Does the single CTA "Claim & add your bank" apply to the **standard team-invite** variant too (scanner / event-manager have no bank to add), or only the **partner-setup / bank-first** variant? REC: partner-setup → "Claim & add your bank"; standard team-invite → keep "Accept invitation", also drop its "get the app" secondary (that step moves in-app). Confirm before W3.

### Ground-truth for the live test (verified against prod, read-only)
- **`sethogievabelgium@gmail.com` is ALREADY a clean slate** (0 owned brands, 0 live memberships, 0 invites) — use it for the happy path, **no write needed**.
- **`sethogieva@gmail.com`** needs exactly ONE row cleared: a dangling `brand_team_members` row (`id 9fcecfcd-84a7-46ed-a5fb-1c8fb19aaf6a`, `role=brand_owner`) on the already-soft-deleted "test Brand". Options in the runbook (safest = in-app / admin; guarded prod UPDATE as last resort, preview-first, founder GO).
- **0 NG/Paystack brands exist in prod** → the Nigeria fork (D3) is BLOCKED until an NG brand is provisioned.
- **The invite under test MUST be a partner-setup transfer** (not a plain team invite) or it never reaches the bank ask (B-03).
- Raw invite tokens are NOT recoverable (`brand_invitations.token_hash`) → the email link + OTP inbox access are mandatory.

### What's needed from Seth to drive the live test autonomously
1. Reconnect the Samsung (USB, unlocked, USB-debugging "Allow" accepted so `adb devices` reads `device`).
2. Both test accounts' Gmail signed in on the device (to read the 6-digit OTP), or founder relays each code.
3. `rambleawaypod@gmail.com` (MinglaDemo2026!) signed into business.usemingla.com on the phone (verified partner_enabled).
4. Authorize + pick the clean-slate method for `sethogieva@gmail.com`'s one dangling row.
5. Which brand to invite from, and whether to provision an NG brand for the Paystack fork.
6. The 3 decisions + the scoping question above.

### Standing build standard (every wave)
Dual regression tests (implementor happy-path + tester adversarial), each proven fails-on-revert; every new jest/Deno test registered in the jest-workflow + `MANIFEST.json` or the parity check fails; append-only test gate; mingla-business jest gate is now REQUIRED (#1062); `[deploy]` on the tip for web changes; `gh pr merge --squash --admin` only when all checks green; worktree-per-issue; native gaps (W4) ride the next app build (OTA forbidden for business).

---
I have everything needed. The CI-gate subagent is still running; I'll fold its exact paths into the Wave CI subsections when it returns, but the spec body is complete. Let me compose the deliverable now.

Here is the grounded, execution-grade build spec.

---

## #948 — Bank-first funnel build spec (grounded, wave-by-wave)

### 0. Architecture reality (verified trace, so the fix lands where the wire actually runs)

The invite→bank journey today, proven from code:

1. **Email** (`_shared/brandInviteEmail.ts`) sends TWO CTAs → accept URL `https://business.usemingla.com/accept-brand-invitation?token=…` + a "Get the Mingla Business app" button.
2. **`app/accept-brand-invitation.tsx`** — logged-out invitee gets "You're invited" → `handleSignIn` routes `/auth?next=/accept-brand-invitation?token=…` (`:143-144`). After sign-in the accept edge fn runs; on success it renders an inline card, OR (only when `partnerSetup && transferred`) redirects to the celebration screen (`:162-175`).
3. **`app/accept-brand-invitation/success.tsx`** — "Set up {brand} on the web →" button calls `router.replace('/brand/${brandId}/payments')` (`:114`) — the **dashboard**, not a form.
4. **`/brand/[id]/payments` → `BrandOnboardView`** — renders the ToS gate sheet (`MinglaToSAcceptanceGate`), then a **country picker**, then `handleStart` calls the `brand-stripe-onboard` edge fn which **mints a Stripe AccountSession client_secret** and returns `onboarding_url = ${BUSINESS_WEB_ORIGIN}/connect-onboarding?session=<secret>&brand_id=<id>&return_to=<url>` (`brand-stripe-onboard/index.ts:693-726`).
5. **`/connect-onboarding` web route** (`app/connect-onboarding.web.tsx` → `ConnectOnboardingBody.web.tsx`) renders the Stripe embedded `<ConnectAccountOnboarding>` **form**. This route is auth-exempt via `SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES` because it self-authenticates on the `?session=` secret.

So there is a real Mingla-hosted **bank form URL** (`/connect-onboarding?session=…`); the funnel today just refuses to walk anyone straight to it. Two edge fns matter: **`brand-stripe-onboard`** (mints the Stripe session) and **`brand-paystack-onboard`** (NG rail; `BrandPaystackOnboardView` renders an inline form, no session mint). `brand-stripe-onboard` **hard-requires** `brand_team_members.mingla_tos_accepted_at` (403 `mingla_tos_not_accepted`, `:309-326`) — so any one-hop route MUST record ToS acceptance before it can mint.

---

### B-01 — Route allowlist has no `/brand/…`

**(a) Current code (proof).** `mingla-business/src/utils/nextRoute.ts:42-47`:
```ts
export const NEXT_ROUTE_ALLOWLIST: readonly string[] = [
  "/accept-brand-invitation",
  "/accept-scanner-invitation",
  "/rsvp/create",
  "/event/create",
] as const;
```
`sanitizeNextRoute` returns `null` for any path not on this list (`:178-179`), and `/auth`'s resume hands `null` to `router.replace(AppRoutes.home)` (`app/auth/index.tsx:68-69`). So a `?next=/brand/<id>/connect` would be silently dropped and the invitee bounced home after sign-in — the exact silent-token-drop the whole `?next=` module exists to kill.

**(b) Precise fix.** Add ONE entry for the new one-hop bank route (B-02):
```ts
  "/brand",   // one-hop bank-connect resume target (#948) — see below
```
Segment-safe matching keeps this safe: `isAllowlistedPath` (`:121-131`) normalizes each prefix to a no-trailing-slash `base` and matches `normalized === base || normalized.startsWith(base + "/")`. This is the same discipline the file's own header cites from `coldLoadAuthGates.ts:283-300` (verified: `SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES` uses the identical matcher and the comment there spells out `/connect-onboarding-evil` does NOT match). Adding `/brand` authorises `/brand/<id>/connect`, `/brand/<id>/payments`, etc. — **but read the file's own security warning first** (`:33-37`): "Adding an entry here AUTHORISES A REDIRECT TARGET — do not add one without asking whether that route can ever carry a credential in its URL." `/brand/<id>/*` routes carry only a brand UUID (already the caller's own brand, RLS-guarded) — no credential in the URL — so it is a safe target. The dot-segment guard (`:110-114`, `:173-174`) independently blocks `/accept-brand-invitation/../brand/…` traversal, so `/brand` cannot be reached by smuggling either.
- **Carry path unchanged:** `app/accept-brand-invitation.tsx:handleSignIn` (`:143`) already builds `?next=` and routes to `/auth`; `authNextHandoff.ts` `captureNextRoute`/`consumeNextRoute` carries it across the OAuth round-trip; `/auth` STEP-2 re-validates through `sanitizeNextRoute` (`app/auth/index.tsx:59-70`). No change to those files — only the allowlist constant.

**Sibling pattern to follow:** `NEXT_ROUTE_ALLOWLIST` itself + `coldLoadAuthGates.ts` `SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES` (the trailing-comment convention: annotate the entry with the route file + why it's safe).

**(c) Risk / side-effects.** Broadening to `/brand` authorises **all** `/brand/*` sub-paths as post-sign-in redirect targets. Mitigation: the entry is a prefix by design; all `/brand/*` routes are auth-gated screens that read the caller's own RLS-scoped brand — none put a secret in the URL. If narrower is preferred, add the exact leaf (`"/brand"` prefix is unavoidable because the id segment is dynamic — a leaf like `/brand/connect` won't match `/brand/<uuid>/connect`). Document the decision in the entry comment. Existing `nextRoute.test.ts` traps (protocol-relative, dot-segment, double-encode) are unaffected.

**(d) Acceptance test (fail-on-revert).** In `src/utils/__tests__/nextRoute.test.ts` (append-only): `expect(sanitizeNextRoute('/brand/2b7c…/connect')).toBe('/brand/2b7c…/connect')` and `expect(sanitizeNextRoute('/brand-evil')).toBeNull()` and `expect(sanitizeNextRoute('/accept-brand-invitation/../brand/x/connect')).toBeNull()`. Reverting the allowlist entry makes the first assertion fail (returns `null`).

---

### B-02 — No one-hop route into a bank FORM

**(a) Current code (proof).** The only path to a form is the 4-hop chain: `success.tsx:114` `router.replace('/brand/${brandId}/payments')` → `BrandOnboardView` renders the **ToS sheet** (`MinglaToSAcceptanceGate` mounted at `:666-672`, blocks the CTA via `disabled={!tosPassed}` at `:721`) → **country picker** (`BrandStripeCountryPicker` at `:691-699`) → only then `handleStart` (`:366`) mints the session and opens the form. Nothing takes a `brandId` and lands on the Stripe embedded form in one hop.

**(b) Precise fix.** New route **`app/brand/[id]/connect.tsx`** (+ `.web.tsx` sibling only if web/native diverge — see B-06). Contract:
- **Input:** `id` (brandId) from the path; optional `provider` hint (`stripe|paystack`) and `bank` (`connected`) from B-05's widened accept response, passed as query params on the redirect that replaces `success.tsx:114`.
- **Rail pre-pick (folds B-04):** read `brands.country_code`/`payment_provider` (already loaded, or from the query hint). If NG/`paystack` → render `BrandPaystackOnboardView` inline immediately (same component `BrandOnboardView.tsx:579-585` already mounts) — that IS the bank form, no session to mint. Else Stripe path below.
- **Fold ToS to a legal line (clickwrap):** DO NOT render the blocking `MinglaToSAcceptanceGate` sheet. Instead render one legal line under the primary button — e.g. *"By connecting your bank you agree to Mingla's Business Terms."* — and on button press, FIRST fire `useAcceptMinglaToS().mutateAsync({ brandId, userId, version: CURRENT_MINGLA_TOS_VERSION })` (writes `mingla_tos_accepted_at`, satisfying `brand-stripe-onboard`'s `:321` guard), THEN mint. `useAcceptMinglaToS` is the exact same mutation the gate calls today (`MinglaToSAcceptanceGate.tsx:101`), so this is behavior-preserving, not a new legal posture.
- **Pre-mint + land in the form:** call `useStartBrandStripeOnboarding().mutateAsync({ brandId, returnUrl, country })` (which invokes **`brand-stripe-onboard`**, minting the AccountSession). On web, `window.location.assign(result.onboarding_url)` — a **same-tab full navigation** to `/connect-onboarding?session=…`, which lands the user directly on the Stripe embedded form (this also solves B-06's popup problem). On native, keep `WebBrowser.openAuthSessionAsync` (B-06 native leg is correct).
- **Edge fns named:** `brand-stripe-onboard` (Stripe session mint) and `brand-paystack-onboard` (NG). No new edge fn required.

**Sibling pattern to follow:** `BrandOnboardView.handleStart` (`:366-456`) is the reference for the ToS→mint→open sequence; `ConnectOnboardingBody.web.tsx:146-183 handleExit` is the reference for full-page-nav-not-SPA-replace on web. The new route should reuse `useStartBrandStripeOnboarding` + `settleStripeStatus` verbatim rather than re-rolling the mint.

**(c) Risk / side-effects.** Two ways to reach the form now (this new one-hop + the existing `/brand/[id]/payments` → `BrandOnboardView`). Keep both; the one-hop is additive. The clickwrap must record ToS BEFORE the mint or the edge fn 403s — sequence is load-bearing. `return_url` must pass `isValidReturnUrl` (`brand-stripe-onboard/index.ts:81-89`: accepts `mingla-business://` or `${businessWebOrigin}/`) — on web pass `${origin}/brand/${id}/payments`, on native pass `mingla-business://onboarding-complete`.

**(d) Acceptance test (fail-on-revert).** jest render test for `app/brand/[id]/connect.tsx`: mock `useAcceptMinglaToS` + `useStartBrandStripeOnboarding`; press "Connect your bank" and assert (1) `acceptMinglaToS` is called before `startBrandStripeOnboarding` (call-order spy), (2) on `Platform.OS==='web'` `window.location.assign` is called with a URL containing `/connect-onboarding?session=`. Reverting to the sheet-gated flow removes the accept-then-mint call and fails the order assertion.

---

### B-03 — Only `partnerSetup && transferred` reaches the bank ask

**(a) Current code (proof).** `app/accept-brand-invitation.tsx:162-175`:
```ts
useEffect(() => {
  if (phase.kind !== "success") return;
  if (!phase.result.partnerSetup) return;
  if (!phase.result.transferred) return;
  …
  router.replace(`/accept-brand-invitation/success?${params.toString()}` as never);
}, [phase, router]);
```
Every other success path renders the inline card (`:205-231`) whose only actions are "Go to team" (`:218`) and the web-only `BusinessAppDownloadCta` (`:227`) — no bank ask. A partner-setup accept that does NOT transfer (e.g. owner already correct), or any accept that should collect a bank, never sees the bank step.

**(b) Precise fix.** Route every should-collect-bank accept to the bank one-hop. Replace the `partnerSetup && transferred` predicate with a decision derived from the widened accept response (B-05): route to `/brand/${brandId}/connect` when the brand needs a bank (Stripe not `charges_enabled` AND no `paystack_subaccount_code`) AND the caller is a payments-capable role. Keep the celebration copy for the transfer case by threading `owner_name`/`brand` as query params into the connect route (or keep the celebration screen as an intermediate that itself routes to `/connect`). **Respect the dead-code invariant:** the redirect effect already correctly branches on the resolved `phase.kind === "success"` (a resolved outcome), NOT on `!isAuthReady` — do not reintroduce an `isAuthReady`/`!isAuthReady` gate. The screen's auth branching MUST stay on `authStatus` (`:103`, `:109`, `:268`, `:288`) per the header invariant (`:24-29`, proven by `orch_1373_mutual_exclusivity.test.ts`). The new predicate reads only `phase.result.*` fields — never `isAuthReady`.
- **D5 already-connected fork:** when the widened response says the bank is already connected (`stripe_charges_enabled` or `paystack_subaccount_code` present), SKIP the bank hop and go straight to the "get the app" step / team screen — the invitee doesn't re-connect.

**Sibling pattern to follow:** the existing effect's shape (`:162-175`) — a `phase.kind`-gated `useEffect` that builds `URLSearchParams` and `router.replace`s. Extend it; don't add an auth-gated branch.

**(c) Risk / side-effects.** The inline success card (`:205-231`) stays as the fallback for non-bank accepts (scanner/team joins). Must not send a scanner/event-manager (no payments permission) to `/connect` — gate the new predicate on role + on the brand actually needing a bank. Cross-surface: this screen is web + native (Expo) — the redirect fires on both.

**(d) Acceptance test (fail-on-revert).** jest test driving the success effect with 4 fixtures: (partner+transfer+no-bank)→`/brand/:id/connect`; (partner+no-transfer+no-bank)→`/brand/:id/connect`; (bank already connected)→team/app step, NOT `/connect`; (scanner join)→inline card. Reverting to the `partnerSetup && transferred` predicate fails fixture 2. Add a static assertion that the file contains no `!isAuthReady`/`isAuthReady` token in a routing branch (guards the dead-code invariant).

---

### B-04 — No rail pre-resolution (GB hardcoded)

**(a) Current code (proof).** `BrandOnboardView.tsx:100` `const DEFAULT_COUNTRY = "GB" as const;`, `:191` `useState<string>(DEFAULT_COUNTRY)`. The only country pre-fill is from an EXISTING Stripe account (`:220` `savedStripeCountry = statusQuery.data?.country`; `:240-243` effect). A brand-new invitee has no saved Stripe country, so the picker sits on GB and NG (`:212` `if (countryCode === "NG") setPaystackSelected(true)`) is only reachable by the user manually finding Nigeria in the picker.

**(b) Precise fix.** Pre-pick the rail from `brands.country_code` (confirmed column, `20260613000000_ve1_physical_venue_brand_onboarding.sql:16`). On the new `/connect` route (B-02) and/or in `BrandOnboardView`'s initial state derivation (`:177-184`):
- If `brands.country_code === 'NG'` (or `brands.payment_provider === 'paystack'`) → set `paystackSelected = true` on mount (render `BrandPaystackOnboardView` immediately, `:544-589`).
- Else seed `selectedCountry` from `brands.country_code` when it's on the Stripe allowlist (reuse `normalizeStripeCountry` from `_shared/stripeSupportedCountries.ts` client-side equivalent, or the existing `constants/stripeSupportedCountries.ts`), falling back to `GB` only when absent/unsupported.
- **Render a confirm row** (not a silent auto-submit): e.g. *"Paying out to a **Nigeria** bank — change"* so the pre-pick is correctable. This mirrors the existing helper/warning copy plumbing (`getStripeCountryReplaceableCopy`/`getStripeCountryLockedCopy`, `:228-236`).

**Sibling pattern to follow:** the existing `savedStripeCountry` pre-fill effect (`:240-243`) — same shape, new source (`brands.country_code` instead of `statusQuery.data.country`). The NG branch already exists (`:208-218`); you're just feeding it from data instead of a manual tap.

**(c) Risk / side-effects.** `country_code` is free-text and nullable — must normalize + allowlist-check before trusting it; unknown/unsupported → GB fallback (unchanged behavior). Do NOT auto-mint from the pre-pick without the confirm row (a wrong country locks the Stripe account per `decideStripeCountryReplacement`). The `countryTouched` guard (`:241`) must still let the user override.

**(d) Acceptance test (fail-on-revert).** jest: render `BrandOnboardView`/connect route with `brand.country_code='NG'` → asserts `paystackSelected` path renders `BrandPaystackOnboardView`; with `country_code='US'` → picker shows US pre-selected + confirm row; with `country_code=null` → GB. Reverting to hardcoded `DEFAULT_COUNTRY` fails the NG and US cases.

---

### B-05 — Accept response carries no country/provider/bank signal

**(a) Current code (proof).** `accept-brand-invitation/index.ts:360-364` selects only 3 brand columns:
```ts
const { data: brandRow } = await service
  .from("brands")
  .select("name, slug, partner_setup")
  .eq("id", brandId)
  .maybeSingle();
```
and the response (`:481-485`) is `{...rpcResult, brand_slug, new_owner_first_name}`. `success.tsx:88-91` selects only `name`:
```ts
const { data } = await supabase.from("brands").select("name").eq("id", brandId).maybeSingle();
```
The client result type `AcceptBrandInvitationResult` (`brandInvitationsService.ts:84-94`) has no bank/provider/country field.

**(b) Precise fix.** Widen the accept edge fn's existing brand select (`:362`) to:
```ts
.select("name, slug, partner_setup, country_code, payment_provider, stripe_charges_enabled, stripe_payouts_enabled, paystack_subaccount_code, stripe_connect_id")
```
and extend `responseBody` (`:481-485`) with:
```ts
country_code: resolvedCountryCode,
payment_provider: resolvedPaymentProvider,          // 'stripe' | 'paystack'
stripe_charges_enabled: resolvedStripeChargesEnabled, // boolean
stripe_payouts_enabled: resolvedStripePayoutsEnabled, // boolean
paystack_subaccount_code: resolvedPaystackSubaccount,  // string | null
```
Add the matching fields to `AcceptBrandInvitationResult` (`:84-94`) and both parse blocks (`:193-207`, `:239-253`) with safe null/false defaults. These fields power the **D5 already-connected fork** (B-03) and the **rail pre-pick** (B-04), so the client can decide route WITHOUT the extra `success.tsx:88-91` round-trip.

**Zero migration — confirmed.** All six columns exist on `public.brands`:
- `country_code text` — `20260613000000_ve1_physical_venue_brand_onboarding.sql:16`
- `payment_provider text NOT NULL DEFAULT 'stripe'` — `20260915000000_meta_orch_1076_p1_payment_provider.sql:38`
- `paystack_subaccount_code text` — same migration `:40`
- `stripe_connect_id text`, `stripe_payouts_enabled boolean NOT NULL`, `stripe_charges_enabled boolean NOT NULL` — baseline `20260505000000_baseline_squash_orch_0729.sql:7775-7777` (trigger-synced cache via `tg_sync_brand_stripe_cache`).

All on the `brands` row the fn already reads → **no new column, no join, no migration**.

**Sibling pattern to follow:** the existing `brand_slug`/`new_owner_first_name` resolution (`:339-369`, `:483-484`) — add the new fields to that same best-effort block with null defaults.

**(c) Risk / side-effects.** The brand read sits in a best-effort `try` (`:341-476`); on throw the new fields default null/false and the client falls back to the normal onboarding path (safe — never mis-routes to "already connected"). `stripe_charges_enabled` on `brands` is a denormalized cache — acceptable for a routing HINT (the authoritative gate stays server-side in `brand-stripe-onboard`), but do NOT use it as a payments-readiness authority (ORCH-1075 warns the SOURCE is `stripe_connect_accounts.charges_enabled`). Widening the response is additive; existing clients ignore unknown fields.

**(d) Acceptance test (fail-on-revert).** Deno test on the edge fn (or a unit test on the response builder): assert the 200 body includes `country_code`, `payment_provider`, `stripe_charges_enabled`, `paystack_subaccount_code`. Client-side jest: `acceptBrandInvitation` parses the new fields. Reverting the `.select("name, slug, partner_setup")` narrows the row and the new fields go undefined → assertion fails.

---

### B-06 — Stripe WEB hand-off broken both legs

**(a) Current code (proof).** `BrandOnboardView` is a **single shared component** (no `.web.tsx`; verified). On web, `handleStart` (`:366`) does:
```ts
const result = await onboardMutation.mutateAsync({...});   // :374  (async — gesture consumed)
setViewState("in-flight");                                  // :380
const browserResult = await WebBrowser.openAuthSessionAsync(  // :385
  result.onboarding_url, RETURN_DEEP_LINK);                   // :387
```
Leg 1 — the browser open at `:385` runs AFTER `await` at `:374`: on web `openAuthSessionAsync` maps to `window.open`, which — invoked outside the original click gesture — is **popup-blocked**. Leg 2 — `RETURN_DEEP_LINK = "mingla-business://onboarding-complete"` (`:99`, passed at `:376` and `:387`) is a **native scheme**, dead in a browser, and `WebBrowser.maybeCompleteAuthSession()` is **never called** (verified: 0 occurrences in `src`/`app`).

**(b) Precise fix.** Branch web vs native in `handleStart` (or in the new `/connect` route):
- **Web:** do NOT use `openAuthSessionAsync`. After minting, `window.location.assign(result.onboarding_url)` — a **same-tab full navigation** to `/connect-onboarding?session=…`. No popup → no blocker; no gesture dependency. Pass `return_url = ${origin}/brand/${brandId}/payments` (an HTTPS URL `isValidReturnUrl` accepts, `brand-stripe-onboard/index.ts:87`), so `ConnectOnboardingBody.web.tsx handleExit` (`:146-183`) full-page-navigates back (it already does `window.location.assign`, and the `/stripe-onboarding-return` relay exists as the sessionless fallback, `:60`, `app/stripe-onboarding-return.tsx` confirmed). If a NEW tab is required instead of same-tab, use the **synchronous pre-open** pattern: open a blank tab in the click handler BEFORE the await, then set `win.location = onboarding_url` after the mint (the classic gesture-safe popup workaround).
- **Native:** keep `openAuthSessionAsync(onboarding_url, "mingla-business://onboarding-complete")` unchanged — correct there.

**Prior art (cite, follow):** ORCH-1381/1382 double-nav learning — a `noopener`/`noreferrer` `window.open` returns **null even on success**, so a `if (!win)` fallback fires on every tap (documented at `BusinessAppDownloadCta.tsx:44-47` and `services/guestFunnelLink.ts:192-196`, tested in `orch_1382_open_external_no_double_nav.test.ts`). The web owner of "open external" is `openExternal`/`buildBusinessInviteDownloadUrl` in `services/guestFunnelLink.ts` — reuse its null-safe handling rather than re-rolling `window.open`. The web return-path prior art is `ConnectOnboardingBody.web.tsx:146-183` (full-page nav, never SPA `router.replace` into an auth-gated route) + `SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES` (`coldLoadAuthGates.ts`).

**(c) Risk / side-effects.** Same-tab nav leaves the SPA — acceptable (Stripe embedded page is a full page; return re-establishes the Supabase session on reload, exactly as the ORCH-1234 note at `ConnectOnboardingBody.web.tsx:41-51` describes). Must NOT pass `mingla-business://` as `return_url` on web. The native leg must be untouched. `maybeCompleteAuthSession()` is only needed for the native `openAuthSessionAsync` completion on some platforms — add it at web module top-level guarded by `Platform.OS`, or omit on web since we no longer use the auth-session API there.

**(d) Acceptance test (fail-on-revert).** jest with `Platform.OS='web'`: press "Connect/Set up payments" → assert `WebBrowser.openAuthSessionAsync` is NOT called and `window.location.assign` IS called with `/connect-onboarding?session=`; assert the `return_url` sent to the mint is an `https://` URL, never `mingla-business://`. With `Platform.OS='ios'`: assert `openAuthSessionAsync` IS called with the `mingla-business://` return. Reverting to the shared `openAuthSessionAsync`-after-await path fails the web assertions.

---

### B-07 — `BusinessAppDownloadCta` is web-only; native post-skip has no download step

**(a) Current code (proof).** `BusinessAppDownloadCta.tsx:82` `if (Platform.OS !== "web") return null;` — renders nothing on native. Its header (`:28-31`) states "Renders on web only … On business native the user demonstrably ALREADY HAS the app." The single attributed URL is built once (`:68` `BUSINESS_INVITE_CTA_URL = buildBusinessInviteDownloadUrl()`) and opened via `openExternal` (`:78`); the attribution contract is documented `:15-27` — ONE OneLink URL, per-platform 301 does the device-awareness, **no client-side store branching** (branching destroys the `af_tranid` attribution).

**(b) Precise fix.** For the **post-skip in-app path** (user tapped "I'll add it later" inside the business app, then we show a "get the consumer app / share" step, OR a partner who onboarded on web needs the phone app), add a **native** download/share step. Because `BusinessAppDownloadCta` is business-native and the business user already has the business app, the native step is about the **consumer** app or a **shareable** OneLink, not re-downloading business. Whatever the target:
- **Attribution constraint (hard):** device-awareness stays **presentational only** — ONE OneLink href, no `Platform.OS`/store-URL branching for the *link*. Reuse `buildBusinessInviteDownloadUrl()` / the ONE `openExternal` owner (`guestFunnelLink.ts`). Factor **#1050**: business now sits on its own `biz.` OneLink domain (`biz.usemingla.com/ZSCW`, per memory) — the href must resolve through that business OneLink, not the consumer `go.usemingla.com` one.
- **Requires a native app build** — this is NEW native UI (a rendered step where `BusinessAppDownloadCta` currently returns null). **OTA is forbidden** for it: shipping a new native screen/module is not pure-JS-safe. Gate this item behind the next native build; do NOT attempt to OTA it.

**Sibling pattern to follow:** `BusinessAppDownloadCta` itself (the web render, `:84-99`) for copy/layout; `guestFunnelLink.ts openExternal` for the null-safe open; the `#1050` biz OneLink domain constant.

**(c) Risk / side-effects.** Getting the platform gate wrong re-introduces the "install CTA on a device that already has the app" nonsense the header warns against — scope the native step to the specific post-skip moment, not a blanket un-gate of `:82`. Any store-URL branching is a regression (kills attribution). Native-build dependency means this item cannot ship in the same web-only OTA as W1–W3.

**(d) Acceptance test (fail-on-revert).** jest with `Platform.OS='ios'`: render the post-skip step → assert exactly ONE outbound URL and that it equals `buildBusinessInviteDownloadUrl()` (the biz OneLink), with NO `Platform.OS` branch selecting a store URL. Assert `BusinessAppDownloadCta` web behavior is unchanged. Reverting the native step returns `null` and the "one link present on native" assertion fails.

---

### B-08 — "We'll remind you" has no mechanism

**(a) Current code (proof).** No reminder fires for "accepted the invite but never connected a bank." The one existing reminder, **`stripe-kyc-stall-reminder`**, only covers brands that have ALREADY started Stripe onboarding (it reads `stripe_connect_accounts` requirements-due and `kyc_stall_reminder_sent_at`, `20260509000002_b2_kyc_stall_reminder_column.sql:8`) — a brand with NO `stripe_connect_accounts` row (accepted, never started) is invisible to it. So any "I'll add it later → we'll remind you" copy would be a promise with no backing.

**(b) Options (pick one; I recommend Option A for v1).**
- **Option A (recommended for v1): cut the "we'll remind you" copy.** Say something truthful and self-service instead — e.g. *"Add your bank anytime from Payments."* No mechanism to build, no false promise, ships in the web OTA. The existing `stripe-kyc-stall-reminder` still covers anyone who DOES start onboarding and stalls.
- **Option B (follow-up, native-independent): a thin reminder cron.** Add an edge fn `bank-connect-reminder` + a `pg_cron` schedule following the EXACT proven pattern in the repo: `cron.schedule(...) → net.http_post(...)` (`20261112000001_orch_1161_subc_reminders_cron.sql:46-93` and `tr3_installments.sql:235`). It selects brands where the owner accepted ≥ N hours ago AND no bank is connected (Stripe not `charges_enabled` AND `paystack_subaccount_code IS NULL`), then reuses `dispatchNotification` with `emailVariant: "generic_notification"` and the deep link `mingla-business://brand/${brandId}/payments/onboard` — verbatim the harness in `stripe-kyc-stall-reminder/index.ts:17-63`. Add an idempotency column (`bank_reminder_sent_at`) so it fires once. This is pure backend (no native build) but adds a cron + edge fn + one migration.

**Sibling pattern to follow:** `stripe-kyc-stall-reminder/index.ts` (`notifyBrand`, `getBrandPaymentManagerUserIds`, `dispatchNotification`, `deadlineWarningTiers`) + the `pg_cron` schedule migrations above.

**(c) Risk / side-effects.** Option A: none (removes a claim). Option B: a cron that emails real owners — must be idempotent (the `*_sent_at` guard) and must clear on connect (mirror `kyc_stall_reminder_sent_at`'s webhook clear). Over-firing is the main hazard.

**(d) Acceptance test.** Option A: copy assertion that the "remind" string is absent and the truthful string present (fails-on-revert if the promise copy returns). Option B: Deno test on the selector (accepted-no-bank brand is returned; connected brand is excluded) + idempotency (second run with `*_sent_at` set returns 0).

---

### Email single-CTA change (`_shared/brandInviteEmail.ts` — one builder, both senders)

**Both senders share ONE builder — verified.** `invite-brand-member/index.ts:41,50` imports+re-exports `buildInviteEmail` from `_shared/brandInviteEmail.ts`; `partner-reissue-invitation/index.ts:46,298,312` calls the same `buildInviteEmail(...)` with `partnerSetup:true`. So editing `_shared/brandInviteEmail.ts` fixes both.

**(a) Current CTA markup (proof).** TWO CTAs:
- **Primary** (`:158`): `<a href="${sharedEscapeHtml(input.acceptUrl)}" …>${sharedEscapeHtml(ctaLabel)}</a>`, where `ctaLabel` (`:109-111`) = `partnerSetup ? "Accept & set up ${input.brandName}" : "Accept invitation"`.
- **Secondary** (`:170-176`): heading `"Get the Mingla Business app"` + `<a href="https://usemingla.com/business/download" …>Get the Mingla Business app</a>`.
- Text variants carry the download URL too (`:217` partner, `:229` standard: `${DOWNLOAD_URL}` where `DOWNLOAD_URL="https://usemingla.com/business/download"` `:201`).

**(b) The change.**
- **Delete the secondary CTA** block (`:170-176` `secondaryHeading`/`secondarySub`/`secondaryCta`) and remove `${secondaryCta}` from BOTH `bodyHtml` assemblies (`:186-187`). Remove the `DOWNLOAD_URL` lines from both text variants (`:217`, `:229`) and the `DOWNLOAD_URL` const (`:201`). The "get the app" step now lives AFTER bank, in-app (B-07).
- **New single CTA copy** = **"Claim & add your bank"** — brand name deliberately OUT of the button, one line. Set `ctaLabel` for the partner-setup/bank-first variant to `"Claim & add your bank"` (drop the `${input.brandName}` interpolation). Decide the standard team-invite variant (scanner/event-manager have no bank to add) — recommend keeping `"Accept invitation"` there, OR (if the funnel is uniformly bank-first) apply the same single CTA; flag as the one open scoping question (see below).

**(c) Lockstep test rewrite — the byte-frozen test `invite-brand-member/__tests__/orch-1329-invite-email.tester.test.ts`.** These pinned assertions BLOCK the deletion and must be rewritten in the same PR:
- `:81` `const DOWNLOAD_URL = "https://usemingla.com/business/download";`
- `:193-196` / `:281-284` `assertStringIncludes(p.html, '<a href="https://usemingla.com/business/download"')`
- `:200` `assertStringIncludes(p.html, '<a href="${ACCEPT_URL}"')` (KEEP — primary CTA still carries the accept URL)
- `:239` `assertStringIncludes(p.text, DOWNLOAD_URL)`
- `:277` `assertStringIncludes(p.html, "iPhone or Android")`
- `:321-322` `assertStringIncludes(p.html, DOWNLOAD_URL)` + `assertStringIncludes(p.text, DOWNLOAD_URL)`
- `:327` `assertStringIncludes(p.html, "Get the Mingla Business app")`
- The whole WRONG-TARGET suite (`:177-290`) and the ORCH-1381 copy suite (`:250-289`) are built around the secondary CTA existing.
Rewrite: DELETE the download-CTA assertions; INVERT them to assert **absence** (`assert(!p.html.includes("business/download"))`, `assert(!p.html.includes("Get the Mingla Business app"))`); ADD a positive assertion that the single CTA reads `"Claim & add your bank"` and still carries the accept token (`assertStringIncludes(p.html, '<a href="${ACCEPT_URL}"')`). **PRESERVE untouched:** the ESCAPE/XSS suite (`:113-171`), the AA-contrast `#C4471A`/`#FF6B2C`-border suite (`:336-384`), and the cross-surface non-regression suite (`:386-518`) — none reference the download CTA. Also update the implementor's happy-path companion `orch-1329-download-cta.test.ts` (named at `:5-6`) in lockstep.

**(d) Acceptance test (fail-on-revert).** New test: `buildInviteEmail({partnerSetup:true,…})` → `assertStringIncludes(p.html, "Claim &amp; add your bank")` (or the escaped form of `&`), `assert(!p.html.includes("business/download"))`, `assert(!p.html.includes("Get the Mingla Business app"))`, and the accept URL still present. Reverting the builder re-introduces the download anchor → the absence assertion fails.

---

### Waves (scope · files · acceptance · CI gates)

**W1 — Enablers (backend + pure utils; OTA-safe, no native).**
- **Scope:** B-01 allowlist entry; B-05 widen accept edge fn select + response + client type; B-08 Option A copy cut (or Option B backend if chosen).
- **Files:** `mingla-business/src/utils/nextRoute.ts`; `supabase/functions/accept-brand-invitation/index.ts`; `mingla-business/src/services/brandInvitationsService.ts` (result type + both parse blocks). (Option B adds `supabase/functions/bank-connect-reminder/` + one migration + cron.)
- **Acceptance:** B-01, B-05, B-08 tests above green; existing `nextRoute.test.ts` + accept-flow tests still green.
- **CI:** mingla-business jest gate (#1062, now REQUIRED) for the util/service changes; Deno function-test gate for the edge fn; append-only + MANIFEST/parity registration for any NEW test file; strict-grep registry unaffected (allowlist entry is data). No `[deploy]` needed (no web tip change ships yet) unless bundled.

**W2 — One-hop route + Stripe web hand-off (web behavior; `[deploy]`).**
- **Scope:** B-02 new `/brand/[id]/connect` route (clickwrap ToS + pre-mint + land-in-form); B-06 web hand-off (same-tab nav, drop popup/`mingla-business://` on web); B-04 rail pre-pick + confirm row.
- **Files:** `mingla-business/app/brand/[id]/connect.tsx` (+ `.web.tsx` if split); `mingla-business/src/components/brand/BrandOnboardView.tsx` (web branch in `handleStart`, pre-pick from `country_code`); reuse `useStartBrandStripeOnboarding`, `useAcceptMinglaToS`, `BrandPaystackOnboardView`, `guestFunnelLink.openExternal`. No edge-fn change (`brand-stripe-onboard`/`brand-paystack-onboard` reused).
- **Acceptance:** B-02/B-04/B-06 tests above; web e2e: `/brand/:id/connect` → same-tab `/connect-onboarding?session=` → exit returns to `/brand/:id/payments`.
- **CI:** mingla-business jest gate (#1062); **`[deploy]` on the PR tip** (Vercel web changes); MANIFEST/parity + append-only for new tests; web export builds clean (`--clear`).

**W3 — Screens + copy sweep (accept routing + email; OTA-safe web + backend email).**
- **Scope:** B-03 route-every-should-collect-bank accept to `/connect` + D5 already-connected fork; email single-CTA change + frozen-test rewrite.
- **Files:** `mingla-business/app/accept-brand-invitation.tsx`; `mingla-business/app/accept-brand-invitation/success.tsx` (drop the `/brand/:id/payments` dashboard hop at `:114` → route to `/connect`); `supabase/functions/_shared/brandInviteEmail.ts`; `supabase/functions/invite-brand-member/__tests__/orch-1329-invite-email.tester.test.ts` + `orch-1329-download-cta.test.ts` (lockstep).
- **Acceptance:** B-03 4-fixture test; email single-CTA test; dead-code-invariant static check on the accept screen.
- **CI:** mingla-business jest gate (#1062); Deno email-builder test gate (both rewritten tests must FAIL on revert of the builder); shell-singleton (ORCH-0785-D) + buyer-string-escape (ORCH-0785-C) email gates still green; MANIFEST/parity; `[deploy]` if the accept-screen web tip ships.

**W4 — Native gaps (needs native build; OTA forbidden).**
- **Scope:** B-07 native post-skip download/share step; the native leg of B-02/B-06 (`openAuthSessionAsync` + deep-link return) verified on device.
- **Files:** `mingla-business/src/components/invite/BusinessAppDownloadCta.tsx` (native step) or a new native component; native `/brand/[id]/connect.tsx` branch.
- **Acceptance:** B-07 native test (one biz-OneLink URL, no store branching); physical-device run of the native connect hand-off.
- **CI:** mingla-business jest gate (#1062); explicitly **NOT** an OTA — ships only in the next native build (Expo SDK 54 pinned); unified version parity gate (both apps bump together); device-first validation per testing rules.

**Standing CI standard for every wave:** dual regression tests — the implementor's happy-path test AND the tester's independent adversarial test — each proven **fails-on-revert**; every NEW jest/Deno test registered in the jest-workflow + `MANIFEST.json` or the parity check fails the PR; append-only test gate; strict-grep registry updated only if a new pinned invariant is added; all checks green before `gh pr merge --squash --admin`.

---

**Open scoping question (do not silently resolve):** does the single CTA "Claim & add your bank" apply to the **standard team-invite** variant too (scanner/event-manager have no bank to add), or only the **partner-setup/bank-first** variant? I recommend: partner-setup → "Claim & add your bank" + secondary deleted; standard team-invite → keep "Accept invitation", also delete its "get the app" secondary (that step moves in-app). Confirm before W3.

Let me fold in the CI subagent's exact gate paths when it returns to sharpen the per-wave CI subsections.
I have everything needed. One note: the referenced design HTML (`docs/design/948-949-bank-first-invite-funnel.html`) is not present in the repo (`docs/design/` is empty), so proposed replacements below are grounded in the codebase's own already-agnostic sibling copy (email step "so customers can pay you", the Paystack view's "receive payouts", "take payments") and the experiences positioning — not invented from the missing mock.

Here is the section.

---

## #949 — Offering-agnostic copy sweep (grounded inventory + guard)

### Method & scope

Grepped `mingla-business/{src,app}`, `supabase/functions`, and `mingla-marketing` for ticket-narrow language, then read every in-scope file verbatim. **In scope** = the invite → accept → bank/onboarding → payments journey, where the surface is cross-offering (Mingla sells tickets AND venue reservations AND trips/bookings) but the copy is written ticketing-only. **Out of scope / leave alone** = genuine ticketing features (door scanning, "End ticket sales" on an event, Reddit CTA enum), listed separately in §3.

Every string below is quoted verbatim from current code. All line numbers are current `main` (git clean at `350eaf61d`).

---

### 1. IN-SCOPE inventory (find-and-replace targets)

#### 1a. Invite email — `supabase/functions/_shared/brandInviteEmail.ts` (HTML + text, both variants)

| file:line | EXACT current string | Proposed offering-agnostic replacement | Note |
|---|---|---|---|
| `brandInviteEmail.ts:121` | `${...inviterName} built <span...>${...brandName}</span> for you on Mingla — your page, events and photos are done.` | `…for you on Mingla — your page, offerings and photos are done.` | partnerSetup HTML leadBlock. `events` → `offerings`. |
| `brandInviteEmail.ts:125` | `You're live` … `Your events open for tickets and the money lands in your account.` | `Your offerings open for bookings and the money lands in your account.` | partnerSetup HTML steps, step 3 body. |
| `brandInviteEmail.ts:143` | `${...brandName} runs its events, tickets and page on Mingla — you're now part of the team that makes it happen.` | `${brandName} runs its offerings and page on Mingla — you're now part of the team that makes it happen.` | standard-variant HTML contextLine. |
| `brandInviteEmail.ts:175` | `The Mingla Business app is where you'll do the work — scan guests in, check sales, run events. Get it on iPhone or Android, or open the web dashboard.` | `The Mingla Business app is where you'll do the work — take payments, manage bookings, and run the door. Get it on iPhone or Android, or open the web dashboard.` | standard secondarySub. **MUST keep "iPhone or Android"** (byte-frozen test, §5). See §4 for "run the door" vs SSOT "scan tickets at the door" nuance. |
| `brandInviteEmail.ts:209` | `…for you on Mingla — your page, events and photos are done.` | `…your page, offerings and photos are done.` | plain-text mirror of :121. |
| `brandInviteEmail.ts:213` | `3. You're live — your events open for tickets and you get paid.` | `3. You're live — your offerings open for bookings and you get paid.` | plain-text mirror of :125. |
| `brandInviteEmail.ts:227` | `\n${...brandName} runs its events, tickets and page on Mingla — you're now part of the team.\n\n` | `${brandName} runs its offerings and page on Mingla — you're now part of the team.` | plain-text mirror of :143. |

**Verified NOT-narrow in this file (leave):** subject `:94`, preheaders `:98`/`:99`, ctaLabel `:110`, trustNote `:129` (`Bank-secure…`), valueLine `:135`, secondaryHeading `:171`/`:172`, secondarySub partnerSetup `:174` (already agnostic: "Get the Mingla Business app on iPhone or Android — or open your dashboard on the web."), secondaryCta label `:176`, finePrint `:179`, plain-text steps 1–2 `:211`–`:212`, download line `:217`/`:229`. These carry no offering-narrow words.

**Role-capability phrases (`roleCanPhrase`, `:266`–`:283`) — borderline, see §1g:** `:269` brand_owner `"manage everything — events, payouts, team and settings"`, `:271` brand_admin `"manage events, the team and most brand settings"`, `:273` event_manager `"create and run events, and manage tickets and guests"` (**pinned by a test — §5**), `:279` scanner `"scan tickets and check guests in at the door"` (**leave — genuine, §3**).

#### 1b. Accept-success screens

| file:line | EXACT current string | Proposed replacement | Note |
|---|---|---|---|
| `mingla-business/app/accept-brand-invitation/success.tsx:132` | `The next step is connecting your bank so customers can buy tickets.` | `The next step is connecting your bank so customers can pay you.` | Matches the email's own step-2 wording ("so customers can pay you", `:212`). |
| `mingla-business/app/accept-brand-invitation.tsx` (errorCopyFor `:339`–`:403`) | — | **No change.** | The whole accept-invite error map (incl. `invite_currency_mismatch` → "Connect your bank first" / "Connect your bank to accept this brand.") is already offering-agnostic. Success card `:215`/`:216` ("Manage settings, team, and payouts…") is agnostic. Verdict: nothing ticket-narrow here. |

#### 1c. Business app download CTA — `mingla-business/src/components/invite/BusinessAppDownloadCta.tsx`

| file:line | EXACT current string | Proposed replacement | Note |
|---|---|---|---|
| `BusinessAppDownloadCta.tsx:88` | `Manage your brand, sell tickets, and scan guests in from your phone.` | `Manage your brand, take payments, and run the door from your phone.` | **Pinned** by `src/components/invite/__tests__/BusinessAppDownloadCta.test.ts:108` — must update in lockstep. "run the door" respects the §4 SSOT nuance (do NOT write "check guests in"). |

#### 1d. Stripe onboarding view — `mingla-business/src/components/brand/BrandOnboardView.tsx`

| file:line | EXACT current string | Proposed replacement | Note |
|---|---|---|---|
| `BrandOnboardView.tsx:678` | `Connect bank to start selling tickets` | `Connect your bank to start getting paid` | idle-state heading. Referenced (comment only, not asserted) by `__tests__/onboardBodyScrolls.orch1403.source.test.ts:7` — update that comment too. |
| `BrandOnboardView.tsx:682` | `Set up payments to publish events and receive money from ticket sales.` | `Set up payments to publish your offerings and get paid.` | idle-state sub. |
| `BrandOnboardView.tsx:253` | `Onboarding complete. You can publish events and accept payments now.` | `Onboarding complete. You can publish your offerings and accept payments now.` | a11y announcement. |
| `BrandOnboardView.tsx:634-636` | `Your Stripe account is active. You can publish events and accept payments.` | `…You can publish your offerings and accept payments.` | already-active stateSub. |
| `BrandOnboardView.tsx:790-791` | `You can publish events and accept payments now.` | `You can publish your offerings and accept payments now.` | complete-active stateSub. |

**Leave (agnostic):** permission-denied `:617`–:620, all Stripe error/verifying/cancelled/session states, prereq card, "Powered by Stripe" `:731`.

#### 1e. Paystack onboarding view — `mingla-business/src/components/brand/BrandPaystackOnboardView.tsx`

**No changes.** This view is already fully offering-agnostic ("Get paid in Nigeria", "Connect your bank account to receive payouts. Sales settle directly to this account…", "Connect bank & get paid"). It is the model the Stripe/payments copy should converge on.

#### 1f. Payments dashboard + shared banner state + danger zone

| file:line | EXACT current string | Proposed replacement | Note |
|---|---|---|---|
| `src/utils/brandStripeUiState.ts:45` | `title: "Connect bank to sell tickets"` | `title: "Connect your bank to get paid"` | `getBrandProfileStripeBannerCopy` (BrandProfileView banner). |
| `src/utils/brandStripeUiState.ts:46` | `sub: "Get paid for your events. Setup takes 5 minutes."` | `sub: "Get paid for what you sell. Setup takes 5 minutes."` | same. |
| `src/components/brand/BrandPaymentsView.tsx:98` | `title: "Connect bank to sell tickets",` | `title: "Connect your bank to get paid",` | `BANNER_CONFIG.not_connected`. |
| `src/components/brand/BrandPaymentsView.tsx:99` | `sub: "Get paid for your events. Setup takes 5 minutes.",` | `sub: "Get paid for what you sell. Setup takes 5 minutes.",` | same. |
| `src/components/brand/BrandPaymentsView.tsx:127` | `sub: "We need additional information before you can sell tickets.",` | `sub: "We need additional information before you can take payments.",` | `BANNER_CONFIG.restricted`. |
| `src/components/brand/BrandPaymentsView.tsx:705` | `Payouts arrive here once you start selling tickets.` | `Payouts arrive here once you start getting paid.` | empty-payouts state. |
| `src/components/brand/BrandPaymentsView.tsx:807-809` | `Disconnecting stops {brand.displayName} from selling tickets. Existing buyers keep their tickets; refunds remain visible under your refund history.` | `Disconnecting stops {brand.displayName} from taking payments. Existing buyers keep their bookings; refunds remain visible under your refund history.` | DANGER ZONE body. |
| `src/components/brand/BrandStripeDetachConfirmSheet.tsx:137` | `<Text style={styles.warnTitle}>This stops ticket sales</Text>` | `…>This stops incoming payments</Text>` | detach confirm sheet warn title. |
| `src/components/brand/BrandStripeDetachConfirmSheet.tsx:139` | `Disconnecting stops {brandName} from selling tickets. Existing buyers keep their tickets. Refunds for completed sales remain visible under your refund history.` | `Disconnecting stops {brandName} from taking payments. Existing buyers keep their bookings. Refunds for completed sales remain visible under your refund history.` | detach confirm sheet warn body. |

**Leave (agnostic):** `ACTIVE_STRIPE_BANNER_TITLE` "You're connected to Stripe", "Onboarding submitted — verifying", "Action required", KPI tiles, "Manage payouts & tax", "Tax & registrations", "Export finance report", country-locked copy `:29`–`:37`.

#### 1g. Role/permission strings + code comments (lower priority / borderline)

| file:line | EXACT current string | Proposed replacement | Note |
|---|---|---|---|
| `src/utils/brandRole.ts:65` (roleDescription, brand_admin) | `"Manage brand settings, team, events, and finances."` | `"Manage brand settings, team, offerings, and finances."` | Team-management UI (adjacent to invite). Borderline. |
| `src/utils/brandRole.ts:67` (event_manager) | `"Create and edit events; manage tickets and scanners."` | *keep* (role is literally event-scoped) | Borderline — leave unless product wants broadening. |
| `src/utils/brandRole.ts:73` (scanner) | `"Scan tickets at the door (event-scoped)."` | *keep* | Genuine (§3). |
| `src/utils/brandPayout.ts:6` (comment) | `"Connect bank to sell tickets" tile / publish gates / to-dos…` | update comment to match new tile copy | Non-user-facing; keep comment truthful. |
| `src/types/brand.ts:38` (comment) | `- active: fully verified, can sell tickets and receive payouts` | `…can take payments and receive payouts` | Non-user-facing doc comment. |
| `brandInviteEmail.ts:269` roleCanPhrase brand_owner | `"manage everything — events, payouts, team and settings"` | `"manage everything — offerings, payouts, team and settings"` | Borderline; renders in the invite email role-clarity line. |
| `brandInviteEmail.ts:271` roleCanPhrase brand_admin | `"manage events, the team and most brand settings"` | `"manage offerings, the team and most brand settings"` | Borderline. |

---

### 2. Cross-surface duplicate alert

`"Connect bank to sell tickets"` + `"Get paid for your events…"` exist as **two independent literals** (`brandStripeUiState.ts:45-46` AND `BrandPaymentsView.tsx:98-99`) — the banner copy is not de-duplicated. Both must be changed or the surfaces diverge. The guard in §6 scans both files so a half-fix fails CI.

---

### 3. LEAVE ALONE — legitimately ticket/event/scanner-specific (NOT in scope)

These are real ticketing features, not cross-offering surfaces:

- Door-scanning: `app/event/[id]/scanner/index.tsx` + `index.web.tsx` ("Scan tickets"), `src/components/offering/offeringDashboardTiles.ts:80/83`, `src/components/home/LiveOfferingCard.tsx:153`, `src/components/scanners/ScannerHome.tsx` (events-only by design).
- Scanner-invite funnel (separate from partner invite): `supabase/functions/invite-scanner/index.ts:160-180`, `app/accept-scanner-invitation.tsx:155-156`, `app/brand/[id]/scanners.tsx:234`, `src/components/scanners/InviteScannerSheet.tsx:291`.
- Event ticketing lifecycle: `app/event/[id]/index.tsx` ("End ticket sales" / "Ticket sales ended"), `app/(tabs)/hub/events.tsx`, `src/components/event/EndSalesSheet.tsx`, `src/components/event/EventManageMenu.tsx:215`, `src/utils/reconciliation.ts:199`, `src/services/businessEvents.ts:930`, `src/components/event/CreatorStep6Settings.tsx:168` ("Sell tickets at the door" Door-Sales tile).
- Reddit CTA enum DISPLAY STRINGS: `supabase/functions/_shared/reddit.ts` + `adChannel.ts` ("Buy Tickets") — must stay Title-Case exact.
- Event/audience/guest surfaces outside the funnel: `app/event/[id]/guests/index.tsx:503`, `app/brand/[id]/blasts.tsx:146`, `app/(tabs)/marketing/audiences/index.tsx`.
- Marketing site: `mingla-marketing/components/sections/organiser-home/audience-tabs.tsx`, `components/ui/waitlist-hero.tsx`, `supabase/functions/beta-access-lead-submit/index.ts:254/278` (already says "Sell tickets and take bookings").

**FLAG — legal, do NOT rewrite in the copy PR:** `src/components/onboarding/MinglaToSAcceptanceGate.tsx:57-61` — `"Mingla acts as the merchant of record for ticket sales…"` and `"Mingla collects an application fee on each ticket sale."` This is legal ToS text and renders inside the onboarding gate. Broadening it changes the legal meaning; route any change through a legal review, not a copy sweep.

---

### 4. Marketing SSOT conflict — `mingla-marketing/lib/business-app-target.ts:117-121`

Exact rule (verbatim):

```
 *  - "scan tickets at the door" — scanTicket() (the edge fn that actually validates
 *    and burns a ticket) has exactly ONE call site, in the NATIVE scanner screen;
 *    the web twin imports it zero times and already tells owners door scanning is
 *    app-only. Web CAN mark a name off a device-local list, so this says "scan
 *    tickets", NEVER "check guests in".
```

The SSOT copy constants (`:129-142`) that this rule governs:
- `moreNote: 'The app does more: scan tickets at the door and get push alerts. Everything else works on the web too.'`
- `desktopNote: 'The app is on iPhone and Android — scan tickets at the door, get push alerts. On a computer, use the web dashboard.'`

This is **doubly locked**: the `business-getapp-cta.tester.test.ts:178-183` assertion FAILS if any surface claims `"check guests in"` — because manual check-in is NOT app-exclusive (it exists on web, device-local). The verified app-exclusive claim is precisely `"scan tickets at the door"`.

**Reconciliation + recommendation — KEEP the SSOT, do NOT touch `business-app-target.ts`:**
The SSOT is an *app-exclusivity claim* (what the app does that web cannot), and door-scanning is genuinely ticket/event-scoped — venue reservations and trip bookings are not validated by burning a scanned ticket. Changing it to a generic "check guests in" / "run the door" would make it **false** and trip the existing gate. So #949 must **not** rewrite the SSOT. Instead:
1. Everywhere #949 broadens **offering nouns** (`events` → `offerings`, `sell tickets` → `take payments`), it never touches the door-scan claim.
2. The one invite-email line that today over-lists door work — `brandInviteEmail.ts:175` "scan guests in, check sales, run events" — is a *generic descriptor*, not an exclusivity claim. Replace the offering nouns but, if door language is retained, prefer the SSOT-aligned verb **"scan tickets at the door" / "run the door"** — and specifically **never introduce "check guests in"** (it would be the same falsehood the marketing gate bans). My §1a proposal uses "run the door" for exactly this reason; the new guard (§6) additionally bans "check guests in" from the invite surface to keep both surfaces truthful.

---

### 5. Byte-frozen email test — `supabase/functions/invite-brand-member/__tests__/orch-1329-invite-email.tester.test.ts`

The copy PR must keep these assertions green (each pins a string the rewrite might touch):

| Assertion (line) | What it pins | Constraint on #949 |
|---|---|---|
| `:193-196`, `:283` `assertStringIncludes(p.html, '<a href="https://usemingla.com/business/download"')` | The secondary CTA anchor, with the closing quote immediately after `download` (no query) | Keep the download href **byte-identical**; never append a query. |
| `:203-210`, `:285-288` `!p.html.includes("business/download?")` | No query string on the download href | same. |
| `:200`, `:238`, `:324-325` accept token `SECRET_TOKEN_9f3a` present in html AND text; `<a href="${ACCEPT_URL}"` | Primary CTA carries the accept token | Don't alter the primary anchor. |
| `:327` `assertStringIncludes(p.html, "Get the Mingla Business app")` | Secondary CTA **label** (all 6 roles × both variants) | Keep label "Get the Mingla Business app" verbatim. |
| `:263-274` bans `"everywhere else opens"`, `"everywhere else opens the web"`, `"everywhere else opens your dashboard on the web"` | ORCH-1381 copy-truthfulness | Rewrite of `:174`/`:175` secondarySub must not reintroduce any of these. |
| `:277` `assertStringIncludes(p.html, "iPhone or Android")` | Both secondarySub variants name both platforms | **Both** `:174` and `:175` rewrites MUST retain the literal "iPhone or Android". |
| `:352-367` `background:#C4471A` required; no `#FF6B2C`/`#F97316` **fill**; decorative borders kept | AA button contrast | Copy edits must not touch button colors. |

**Also pinned in a sibling (implementor) test:** `orch-1329-download-cta.test.ts:82` asserts the html contains `"you can create and run events, and manage tickets and guests"` — i.e. the **event_manager `roleCanPhrase`** (`brandInviteEmail.ts:273`). If #949 broadens that role phrase, this test must be updated in the same PR.

---

### 6. Regression guard spec — new strict-grep gate

Mirror `orch-1381-business-getapp-android-choice.mjs` (explicit file list + comment-strip + banned-regex loop + `--self-test`). This gate FAILS if any banned ticket-only phrase reappears on the invite/onboarding/payments surfaces.

**File:** `.github/scripts/strict-grep/issue-949-invite-onboarding-offering-agnostic.mjs`
**Invariant:** `I-PROPOSED-949-INVITE-ONBOARDING-OFFERING-AGNOSTIC` (DRAFT until CLOSE; flip ACTIVE in `docs/INVARIANT_REGISTRY.md` on close).

**Scanned files (exact list, like orch-1381's `SURFACES` — path-not-found = hard FAIL so the gate can't silently go dark):**
```
supabase/functions/_shared/brandInviteEmail.ts
mingla-business/app/accept-brand-invitation.tsx
mingla-business/app/accept-brand-invitation/success.tsx
mingla-business/src/components/invite/BusinessAppDownloadCta.tsx
mingla-business/src/components/brand/BrandOnboardView.tsx
mingla-business/src/components/brand/BrandPaymentsView.tsx
mingla-business/src/components/brand/BrandStripeDetachConfirmSheet.tsx
mingla-business/src/utils/brandStripeUiState.ts
```
(Deliberately **excludes** `BrandPaystackOnboardView.tsx` — already clean, nothing to guard — and `business-app-target.ts`, whose "scan tickets at the door" is the verified SSOT claim, §4.)

**Comment-strip** (verbatim from orch-1381): strip `/* */` and `//` before matching, so a banned phrase in a code comment never trips the gate.

**Banned phrases** (comment-stripped, case-insensitive) — tight enough to avoid firing on the genuine role phrases in the same file:
```js
const BANNED = [
  { re: /sell(?:ing)? tickets/i,           why: "narrows a cross-offering payment surface to ticketing — use 'take payments' / 'get paid'" },
  { re: /ticket sales/i,                    why: "narrows bank/payments copy to ticketing — use 'payments' / 'sales'" },
  { re: /buy tickets/i,                     why: "buyer-promise narrows the offering — use 'pay you' / 'pay for what you sell'" },
  { re: /get paid for your events/i,        why: "narrows to events — use 'get paid for what you sell'" },
  { re: /publish events\b/i,                why: "narrows to events — use 'publish your offerings'" },
  { re: /receive money from ticket/i,       why: "narrows to ticketing — use 'get paid'" },
  { re: /events open for tickets/i,         why: "narrows to ticketing — use 'offerings open for bookings'" },
  { re: /scan guests in/i,                  why: "not an app-exclusive claim + narrows — use 'run the door'; NEVER 'check guests in' (SSOT falsehood)" },
  { re: /check guests in/i,                 why: "FALSE app-exclusivity claim (web can check in device-local) — mirrors the marketing SSOT ban" },
  { re: /your page, events and photos/i,    why: "narrows the partner lead line — use 'your page, offerings and photos'" },
  { re: /events,?\s*tickets and (?:a )?page/i, why: "narrows the context line — use 'offerings and page'" },
];
```
Note this list intentionally does **not** ban bare `run events` / `manage tickets and guests`, so the genuine role phrases (`roleCanPhrase` event_manager/scanner) do not false-positive. If product later broadens those, tighten the list then.

**Allowlist escape** (README pattern): a line carrying `// orch-strict-grep-allow invite-offering-agnostic — <reason>` immediately above is skipped — for a future genuinely-ticket exception (e.g., if a legal ToS line ever moves onto a scanned surface).

**`--self-test` (both directions, per README "a gate without a self-test is decoration"):**
- Compliant fixture (agnostic copy: "take payments", "your offerings open for bookings", "run the door", "get paid for what you sell") → 0 failures.
- One fixture per banned regex mutating the compliant string into the bad phrase → each fires exactly once.
- Banned phrase inside a `/* */` and a `//` comment → stripped → still passes (proves comment-strip).
- Banned phrase with the allowlist comment on the line above → passes (proves allowlist).
- Print `self-test PASS (N/N cases)` and `exit(0)`; on any miss, list failures and `exit(1)`.

**MANIFEST registration + append-only ratchets** (`.github/scripts/strict-grep/MANIFEST.json`):
- Add ONE `gates[]` entry (totality is machine-checked by `meta-1383-manifest-parity.mjs` P1/P2):
  ```jsonc
  { "script": ".github/scripts/strict-grep/issue-949-invite-onboarding-offering-agnostic.mjs",
    "kind": "file", "enforcement": "batch:A", "invocation": "node",
    "modes": ["self-test", "plain"], "selfTest": "wired", "jobKeys": [] }
  ```
- Bump `"expectedStrictGrepMjsFiles": 425 → 426` (P3 counts-parity else FAIL).
- Bump `"selfTestWiredFloor": 195 → 196` (ratchet is append-only / up-only; a new *wired* self-test raises it — `tests-append-only.yml` + P7/P8 enforce monotonic-up).
- Class **A** (`static-gates`) — pure node, no npm dep; do **not** add a workflow job (post-1383 registration lives in the manifest, not `jobs:`).
- Cross-reference the invariant in `docs/INVARIANT_REGISTRY.md` (add a "CI enforcement" line), staged DRAFT in the SPEC and flipped ACTIVE on CLOSE.

**Fails-on-revert proof for the SPEC:** after the copy PR lands, reverting any one replacement (e.g. `BrandPaymentsView.tsx:98` back to "Connect bank to sell tickets") makes the gate `exit(1)` on `sell(?:ing)? tickets`; restoring it passes.
I have comprehensive first-hand data. The Explore agent is still running, but the design doc (authoritative for target/baseline copy) plus my direct code + schema verifications are sufficient. Key confirmations: download OneLink literal is `https://biz.usemingla.com/ZSCW?pid=business_web&c=brand_invite_accept` (Android → `market://…minglabusiness`), and `brand_invitations.token_hash` means raw invite tokens are NOT recoverable from the DB — the email link is mandatory. Writing the runbook now.

Here is the deliverable.

---

## Live Android end-to-end test runbook

### Bank-first partner invite funnel (#948 single-CTA · #949 offering-agnostic copy)

> **READ THIS FIRST — what state the code is actually in.** The design at `docs/design/948-949-bank-first-invite-funnel.html` (recovered from commit `fbe90310d`; the file is not on `main`) is explicitly labelled **"Design deliverable · not implemented"** and carries **8 hard blockers** that "stop the bank-first funnel from being buildable as drawn." So this runbook is the **acceptance harness** for #948/#949, used two ways:
> - **Mode BASELINE (run against prod today):** documents the current, pre-build funnel. The old **two-CTA** invite email, the ticket-specific copy, and the missing one-hop bank route are the **expected pre-build state** — most #949 copy assertions and the `?next=`→bank routing assertion will (correctly) **FAIL** now. Capture them as the baseline.
> - **Mode GATE (run after #948/#949 ships to prod):** every assertion below is the **TARGET**; 100% green is the release gate.
>
> **Two structural preconditions that will silently sink the test if ignored:**
> 1. **The bank-ask only exists on a *partner-setup transfer* invite** (design blocker **B-03**, `app/accept-brand-invitation.tsx:162-175`). A plain "invite a team member" from business web mints a `partnerSetup:false` invite → the "You are on the team / Go to team" card, which **never asks for a bank**. The invite under test MUST be a partner-setup transfer (admin/partner tooling), not a team invite. Confirm with the founder (section 7).
> 2. **Raw invite tokens are not recoverable from the DB** — `brand_invitations.token_hash` stores only a hash. The single CTA link exists **only in the delivered email**. Inbox access to the invited address is therefore mandatory, not optional.

---

### 1. Preconditions & setup — bring the Samsung online for CDP driving

Device: Samsung Galaxy A72 (`SM-A725F`), driven over USB via adb + Chrome DevTools Protocol. adb binary is at `~/Library/Android/sdk/platform-tools/adb` (confirmed present).

**1.1 — Physical + adb bring-up**
1. Plug the Samsung into the Mac by USB. On the phone set USB mode to **File Transfer (MTP)**, not "Charging only" (charging-only blocks adb on some Samsung firmwares).
2. `~/Library/Android/sdk/platform-tools/adb devices`
   - Expected: one line ending in **`device`** (e.g. `RF8N…  device`).
3. Open **Chrome on the phone** and navigate to `https://business.usemingla.com` (the CDP endpoint only exposes tabs while Chrome is foregrounded at least once).

**1.2 — KNOWN RECURRING BLOCKER: device shows `unauthorized` (or `offline`), not `device`.** This is the failure that recurs. Exact resolution, in order:
1. Look at the **phone screen** for the "**Allow USB debugging?**" RSA dialog → tick **"Always allow from this computer"** → **Allow**.
2. If no dialog appears: Settings → Developer options → **Revoke USB debugging authorizations**, then toggle **USB debugging** off and back on.
3. Unplug/replug USB; then on the Mac: `~/Library/Android/sdk/platform-tools/adb kill-server && ~/Library/Android/sdk/platform-tools/adb start-server`.
4. `adb devices` again → must read **`device`**. If it reads `offline`, replug and re-approve the RSA prompt. Do not proceed to CDP until the state is `device`.
   *(Developer options + USB debugging must already be enabled: Settings → About phone → tap Build number 7×, then Settings → Developer options → USB debugging ON.)*

**1.3 — Attach CDP**
1. Forward the DevTools socket: `~/Library/Android/sdk/platform-tools/adb forward tcp:9222 localabstract:chrome_devtools_remote`
2. List tabs + websocket URLs: `curl -s http://localhost:9222/json` → each entry has a `webSocketDebuggerUrl` of the form `ws://localhost:9222/devtools/page/<ID>`. Pick the `business.usemingla.com` tab.

**1.4 — Drive via raw CDP (proven method).** Write a small Node script under the scratchpad. `ws` is unresolvable from `/tmp`, so **ESM-import the absolute path** `~/Desktop/mingla-main/mingla-business/node_modules/ws/index.js`. Per page, enable domains then drive:
- `Page.enable`, `Network.enable`, `Runtime.enable`, `Log.enable`
- **`Page.bringToFront` before every evaluate** — backgrounded Chrome tabs are frozen (timers/fetch hang). Add a hard `process.exit` watchdog timer and in-page `AbortController` timeouts so a probe can never hang the run.
- **Navigate:** `Page.navigate {url}` ; cold reload `Page.reload {ignoreCache:true}`.
- **Read DOM / assert:** `Runtime.evaluate {expression, returnByValue:true, awaitPromise:true, timeout:15000}`.
- **Tap:** prefer a real gesture — `Input.dispatchMouseEvent` (`mousePressed` then `mouseReleased` at x,y) OR `Input.dispatchTouchEvent`. A real Input event (not `element.click()`) is **required** on the Stripe hand-off nodes (D1/D2) because the popup must open inside the user-gesture tick (design blocker). For non-popup taps, `el.click()` via `Runtime.evaluate` is fine.
- **Screenshot each node:** device-level `~/Library/Android/sdk/platform-tools/adb exec-out screencap -p > <scratchpad>/node_<ID>.png` (most reliable), plus optional page-only `Page.captureScreenshot {format:"png"}`.

**1.5 — Reusable assertion probes** (paste as the `expression` in `Runtime.evaluate`):
- Horizontal overflow: `(()=>{const e=document.scrollingElement||document.documentElement;return{scrollW:e.scrollWidth,clientW:e.clientWidth,overflow:e.scrollWidth>e.clientWidth+1}})()`
- CTA is one line (by button text): `(()=>{const b=[...document.querySelectorAll('*')].find(n=>n.textContent.trim()===TEXT&&n.getClientRects().length);if(!b)return{found:false};const cs=getComputedStyle(b);return{found:true,nowrap:cs.whiteSpace==='nowrap',lineBoxes:b.getClientRects().length,overflows:b.scrollWidth>b.clientWidth+1}})()` — pass ⇔ `found && lineBoxes===1 && !overflows`.
- Copy present/absent (case-insensitive): `(()=>{const t=document.body.innerText.toLowerCase();return{present:MUST.every(p=>t.includes(p.toLowerCase())),banned:BANNED.filter(p=>t.includes(p.toLowerCase()))}})()` — pass ⇔ `present && banned.length===0`.
- URL: `location.href`.
- Spinner / infinite-load: assert a **content anchor** (a node-specific heading or button text) appears within the 15s timeout; if the anchor is still absent AND an `ActivityIndicator`/spinner node persists past timeout → **infinite spinner FAIL**. Probe: `(()=>{const anchorPresent=document.body.innerText.includes(ANCHOR);const spin=document.querySelector('[role="progressbar"],[aria-busy="true"],svg[class*="spin"],[class*="ActivityIndicator"]');return{anchorPresent,spinnerPresent:!!spin}})()`.

**BANNED ticket-only phrases** (the #949 offence list; assert absent on every partner-facing node): `sell tickets` · `selling tickets` · `buy tickets` · `start selling tickets` · `so customers can buy tickets` · `scan guests` · `scan guests in` · `check guests in` · `scan tickets` · `your events open for tickets` · `runs its events, tickets and page`.
**Agnostic replacements to assert present** (per node): `add your bank` · `get paid for what you sell` · `tables, tickets or trips` · `publish, take payments and run the door` · `run the door`.

---

### 2. Clean-slate method — make the two emails true first-run partners

**What "a business account" is, from the live schema (verified against prod, project `gqnoajqerqhnvulmnyvv`):**
- **Identity is a shared PK:** `creator_accounts.id` **=** `auth.users.id` **=** `brand_team_members.user_id` (confirmed true for both test accounts). Resolve by email in either `auth.users` or `creator_accounts.email`.
- **Brand ownership:** `brands.account_id → creator_accounts.id`. An owned, non-deleted brand (`brands.deleted_at IS NULL`) = the account is a business owner.
- **Team membership:** a live `brand_team_members` row (`removed_at IS NULL`), `role` in {`brand_owner`(60), lower roles}. A trigger (`biz_create_brand_owner_team_member`) auto-mints the `brand_owner` row on brand insert.
- **Account flags:** `creator_accounts.partner_enabled`, `creator_accounts.default_brand_id`, `creator_accounts.business_name`.
- **Invites:** `brand_invitations` keyed by `email` (`status`, `accepted_at`, `accepted_by_account_id`, `revoked_at`).

**2.1 — PREVIEW SELECTs (read-only; run and have the founder eyeball before any delete).** Replace the email in line 1; run for each of `sethogieva@gmail.com` and `sethogievabelgium@gmail.com`:

```sql
-- A) resolve identity + account flags
select u.id as auth_user_id, u.email,
       ca.id as account_id, (u.id = ca.id) as ids_match,
       ca.deleted_at, ca.partner_enabled, ca.default_brand_id, ca.business_name
from auth.users u
left join public.creator_accounts ca on ca.email = u.email
where lower(u.email) = lower('sethogieva@gmail.com');

-- B) brands OWNED (active + soft-deleted)
select b.id, b.name, b.slug, b.deleted_at, b.country_code, b.payment_provider, b.partner_setup
from public.brands b
where b.account_id = (select id from public.creator_accounts where lower(email)=lower('sethogieva@gmail.com'));

-- C) team MEMBERSHIPS (live only) with brand + role
select m.id as membership_id, m.brand_id, b.name as brand_name, m.role, m.accepted_at, m.removed_at,
       (b.account_id = m.user_id) as is_owner, b.deleted_at as brand_deleted_at
from public.brand_team_members m join public.brands b on b.id = m.brand_id
where m.user_id = (select id from auth.users where lower(email)=lower('sethogieva@gmail.com'))
  and m.removed_at is null;

-- D) invitations addressed to this email
select id, brand_id, role, status, accepted_at, expires_at, revoked_at, declined_at
from public.brand_invitations where lower(email) = lower('sethogieva@gmail.com');
```

**2.2 — CURRENT ACTUAL STATE (I ran the previews; here is what needs clearing):**
- **`sethogievabelgium@gmail.com`** (`485addca-58e0-400b-9ddc-7d2460210bc4`): **already a clean slate** — 0 owned active brands, **0** live memberships, 0 invitations, `partner_enabled=false`, `default_brand_id=null`. **No write required.** Use this account for the happy path with no cleanup.
- **`sethogieva@gmail.com`** (`b17e3e15-218d-475b-8c80-32d4948d6905`): 0 **active** brands, but **one dangling live membership** — `brand_team_members.id = 9fcecfcd-84a7-46ed-a5fb-1c8fb19aaf6a`, `role=brand_owner`, `removed_at=NULL`, on brand **"test Brand"** (`2731cd8b-8bc3-4550-8dd2-670d50ef3d37`, slug `testbrand`) — and that brand is **already soft-deleted** (`deleted_at = 2026-06-22`, from the prod test-wipe). `partner_enabled=false`, `default_brand_id=null`. The **only** residue to clear is that single membership row.

**2.3 — Deletion options, safest first (tester executes NONE of these):**

**(a) In-app self-service (safest, no DB write).** For `sethogievabelgium@gmail.com` nothing is needed. For `sethogieva@gmail.com`, in-app "leave brand" does **not** apply cleanly — the account is the *owner* of an *already-soft-deleted* brand, so there is no live brand surface from which to leave, and the business app's brand list already filters `deleted_at IS NULL` (so the UI likely already treats the account as brand-less). Verify by signing in on the business app and confirming an empty/first-run brand state. If the funnel behaves as first-run in this state, **no cleanup is needed** and options (b)/(c) can be skipped. Only if the dangling membership row causes the accept flow to route to "You are on the team" do you proceed to (b)/(c).

**(b) Admin console (mingla-admin).** Use the admin person/brand tooling (`admin_get_person`, ORCH-1272) to inspect the account and remove/detach the stale membership from the admin UI. Preferred over raw SQL because it goes through audited app paths. Founder or an admin-authorised operator performs it.

**(c) Targeted prod DELETE — ⚠️ GUARDED PROD WRITE. Requires explicit founder GO. Preview (2.1) must be re-run immediately before. The tester does NOT execute this.** Exact, minimal rows:
```sql
-- sethogieva@gmail.com — clear the one dangling membership. Prefer soft-remove (audit-preserving):
update public.brand_team_members
   set removed_at = now()
 where id = '9fcecfcd-84a7-46ed-a5fb-1c8fb19aaf6a';   -- exactly 1 row
-- (hard alternative, only if a truly pristine row count is required:)
-- delete from public.brand_team_members where id = '9fcecfcd-84a7-46ed-a5fb-1c8fb19aaf6a';

-- sethogievabelgium@gmail.com — NO WRITE. Already clean (0/0/0). Do not touch.
```
Do **not** delete the `creator_accounts`/`auth.users` rows: a brand-less signed-in account **is** a valid first-run partner, and deleting it forces a fresh OTP sign-up with no benefit. (Optional full reset, founder's call only: also `delete from public.creator_accounts where id='b17e3e15-…'` then the matching `auth.users` row — heavier, re-triggers signup; not recommended.) After any write, re-run 2.1 A–D and confirm C returns **0 rows** and B returns 0 active brands.

---

### 3. OTP read method — reading the 6-digit sign-in code

The sign-in code is a **6-digit email OTP** delivered by the Supabase-hosted auth template (design note B3: not in-repo; `supabase/config.toml` has no `auth.email.template` override). It lands in the **inbox of the address being signed in** — i.e. `sethogieva@gmail.com` or `sethogievabelgium@gmail.com`.

**Primary (on-device):** the Samsung is signed into the test Gmail. Read the code either from the **Gmail Android app** (screenshot via `adb exec-out screencap`) or, headlessly, open a **second Chrome tab** to `https://mail.google.com`, attach CDP to that tab, and `Runtime.evaluate` the message DOM to extract the 6 digits (regex `\b\d{6}\b` on the latest "Mingla" / auth sender message). Add **both** test accounts to the device Gmail up front, or sign in per-run, so either code is reachable.

**Fallback A (founder relay):** the founder opens the same Gmail on their own machine and reads the 6 digits aloud; the tester types them into the OTP field. Use when the device inbox is not set up.

**Fallback B (last resort, founder-run only):** Supabase Auth → Logs, or an app-password + IMAP fetch. Reading OTPs out of auth infrastructure borders on credential handling — **the tester does not do this**; it is founder-run and provided as a value. Note the raw invite **token** is *not* here either (`token_hash` only), so the email is the sole source of the CTA link regardless.

Practical timing: OTP and invite emails can lag 10–60s. Poll the inbox; don't assume instant delivery. The code typically expires in a few minutes and the invite link in **7 days** (email fine-print).

---

### 4. Per-node drive + assertions

For **every** node: (i) no infinite spinner, (ii) no horizontal overflow (`scrollWidth ≤ clientWidth`), (iii) correct agnostic copy + zero banned phrases, (iv) correct URL/routing, (v) rail auto-matches brand country (bank nodes). **Screenshot every node** (`node_<ID>.png`). "Action" = what to drive via CDP; "Target" = the #948/#949 expected result.

**A1 — Invite email (phone).** Action: open the invite email in the device inbox; screenshot; read the body DOM. Assertions: (iii) **exactly one** CTA, text **"Claim & add your bank"**, `white-space:nowrap`, one line regardless of brand-name length (brand name lives in subject/step 1/body, never the button); the secondary "Get the Mingla Business app / Download the app" card is **absent**; step 3 reads **"Tables, tickets or trips — whatever you sell"** (not "your events open for tickets"); step 2 does **not** name Stripe; footer disclaimer does **not** say "because you purchased tickets or requested an action." (iv) CTA href → `business.usemingla.com/accept-brand-invitation?token=…`; fine-print fallback URL matches. *Baseline note:* today's live email is the **two-CTA** layout with the download card and ticket copy — expect this node to FAIL in Mode BASELINE, and note the CI-frozen download href (`orch-1329-invite-email.tester.test.ts:193-208, 285-286`) must be rewritten in the build PR.

**A2 — Invite email (desktop).** Action: open the same email in desktop Gmail (or note it's identical). Assertion: desktop click lands on the **same** `/accept-brand-invitation` URL (no device fork here — the store fork happens only at E1). No second "download" CTA.

**B1 — Accept landing, not signed in.** Action: `Page.navigate` to the CTA link with a signed-out session. Assertions: (i) content anchor (invite headline) renders, no spinner hang; (iii) body names the job ("claim <brand>"), no banned phrases; (iv) URL is `/accept-brand-invitation?token=…`, and a **Sign in** control is present. *Design risk B1:* naming the brand pre-accept needs a token→brand-name source that doesn't exist today — if the brand name is blank/placeholder, record it (not a hard fail unless the redesign claims it).

**B2 — Sign in, email.** Action: tap Sign in → reach `app/auth/index.tsx`. Assertions: (i) email field + **"Send code"** render; (iii) no ticket copy; (iv) **critical routing** — the URL must carry `?next=/accept-brand-invitation` (ORCH-1375 capture; `captureNextRoute(sanitizeNextRoute(params.next))`). Enter the invited email, tap **Send code**. (v) n/a.

**B3 — Sign in, 6-digit code.** Action: read the OTP (section 3), type it into the 6-digit field. Assertions: (i) "We sent a 6-digit code to <email>" + resend timer render; (iii) no ticket copy; (iv) on submit, the session authenticates and **resumes to the captured `next`**. Assert post-auth `location.href` returns to `/accept-brand-invitation` (allowlisted). Record whether the sign-in OTP email itself carries branded shell / any ticket phrasing (design open question B3).

**B4 — "Accepting…".** Action: observe the transient state after OTP resume. Assertion: this is the **only legitimate spinner** — an accept call genuinely in flight. It must resolve to C1/D5/B6 within timeout; a spinner that never resolves = FAIL. Do **not** expect a `user===null` branch here (invariant: `!isAuthReady` is terminal for signed-out, `app/accept-brand-invitation.tsx:24-29`).

**B5 — Wrong account (fork; see §5).** Assertion when reached: a recovery affordance ("this invite was sent to a different address / sign out and switch") renders; no dead end.

**B6 — Invite not valid (fork; see §5).** Assertion: distinct copy per edge-fn code (`already used`, `expired`, `no bank`, `currency mismatch`, …), each with an icon and an actionable exit — **not** a silent dead end to an empty `/(tabs)/home`.

**C1 — Welcome to the brand.** Action: on a successful partner-setup accept, land on `app/accept-brand-invitation/success.tsx`. Assertions: (iii) **single** CTA **"Add your bank"** (the competing "Set up … on the web →" and the whole "Get the Mingla Business app / Download the app" block are **gone**); body reads **"add your bank so you can get paid for what you sell"** (not "so customers can buy tickets"); zero banned phrases. (iv) **the pivotal routing assertion** — "Add your bank" must land in an actual **bank form**, not the payments *dashboard*. Today it routes to `/brand/{id}/payments` (a dashboard), and there is **no one-hop route into a bank form** (blockers B-01, B-02). Assert the destination URL is the bank-entry route (D1/D3), and if the redesign resumes it via `?next=`, assert `NEXT_ROUTE_ALLOWLIST` (`src/utils/nextRoute.ts:42-47`) now **includes** that `/brand/…` path — it currently does **not** (verified: allowlist = `/accept-brand-invitation`, `/accept-scanner-invitation`, `/rsvp/create`, `/event/create`), so an un-allowlisted `?next=` is dropped to app home = FAIL. *Also assert the door is open for the right invites:* C1 is only reached when `partnerSetup && transferred` (B-03) — confirm the invite under test hits it.

**D1 — Add your bank (Stripe rail).** Action: from C1 "Add your bank". Assertions: (iii) headline **"Add your bank"** (not "Connect bank to start selling tickets"); body "every sale settles to this account — tables, tickets or trips"; top bar "Add your bank"; ToS folded to a legal line (no separate non-dismissible ToS gate). (iv) URL is the bank-entry route. (v) **rail/country auto-match** — assert a confirm row derived from `brands.country_code` (e.g. "Payouts in United Kingdom · GBP" with a quiet Change), **not** a `DEFAULT_COUNTRY="GB"` hardcode and **not** a 34-country picker as the first screen (blocker: `BrandOnboardView.tsx:100,191,220,240-243` reads nothing from the brand). (i) no spinner hang.

**D2 — Stripe embedded onboarding.** Action: tap "Add bank details" → the Mingla-chrome Connect page `business.usemingla.com/connect-onboarding?session=…` (`app/connect-onboarding.web.tsx`). Assertions: (i) the embedded Stripe form renders (no blocked popup / no network error) — **use a real `Input` gesture** to open it, because the shipped web hand-off opens the popup after an awaited call, outside the gesture tick, and gets blocked (blocker, `BrandOnboardView.tsx:374-388`); a blocked popup or dead `mingla-business://onboarding-complete` return (no web return leg, `:99,376,387`) = FAIL. (ii) no overflow; step counter/progress render. (iv) URL `?session=…`.

**D3 — Add your bank (Nigeria / Paystack rail).** ⚠️ **Not drivable on prod today** — verified **0** Paystack brands and **0** NG-country brands exist (11 active brands total). Only runnable if the founder provisions/points the invite at an NG brand (`country_code='NG'` / `payment_provider='paystack'`). When available: (iii) headline "Get paid in Nigeria", CTA "Connect bank & get paid", verified account-name panel; escape link present; no Stripe mention. (v) reached **directly** because the brand is NG (not via a country picker intercept). (i) keep the ScrollView at the screen owner — a nested `flex:1` ScrollView collapses (regression class fixed in #971, `BrandOnboardView.tsx:552-586`); assert the Connect button is reachable on a short viewport (no clipped footer).

**D4 — Skip for now (escape).** Action: tap the tertiary "I'll add it later" link. Assertions: (iii) a **confirm sheet** appears: "Skip for now?" + honest cost copy ("build your page and add listings … you just cannot take money until a bank is connected — so nothing can go on sale yet"), a reminder ribbon, primary **"Add my bank now"**, ghost **"Skip for now"**. Tapping ghost proceeds toward E1. (iv) skipping routes to E1/brand-home, **not** a silent Cancel/dead-drop. *Design blocker:* "We will remind you" has no backing reminder job — flag if the copy ships without a sender.

**D5 — Bank already connected (fork).** Action: reachable only if the invited brand already has a bank. Assertions: (iii) "…is ready to sell" + masked destination account ("PAYOUTS TO … ••••6789"); (iv) jumps **straight to E1**, skipping the bank step. *Blocker:* the accept response carries no bank signal today (`accept-brand-invitation/index.ts:479-485`) and success.tsx selects only `name` — so this fork is undetectable until the select is widened; if it never triggers, record as blocked-by-B, not a copy fail.

**D6 — Verifying / needs more.** Assertions: primary CTA is **"Get the app"** (not "Done"); copy "We are checking your details" (rail-neutral, no "Stripe is verifying"); reassurance that the rest is usable; must **not** block the app step.

**E1 — Get the app (Play redirect).** Action: reach the download step; on Android the device-aware button reads **"Get it on Google Play"**. Assertions: (iii) offering-agnostic "publish, take payments and run the door" (no "sell tickets, and scan guests in"); (iv) **one underlying href** — `https://biz.usemingla.com/ZSCW?pid=business_web&c=brand_invite_accept` — device-awareness is presentational only; on Android this 301s to `market://details/?id=com.sethogieva.minglabusiness` → opens the Play Store listing for **Mingla Business**. Assert the tap lands on the Play listing (screenshot the Play page). **Do not** assert a branched plain store URL — client-side branching destroys the `af_tranid`/Install-Referrer attribution (design risk, `BusinessAppDownloadCta.tsx:15-27`). *Blocker:* the CTA component is web-only (returns null on native), so a skip walked inside a native app has no E1 — n/a for this web-only prod test.

**F1 — Live in the app (done).** Action: (post-install, optional — the web funnel's job ends at the Play hand-off). If verifying the terminal web state: assert "Bank connected / Payouts settle to …", a checklist (Claim ✓, Add your bank ✓, Publish your first listing = Next), CTA "Add your first listing", and offering-agnostic caption "Tables, tickets or trips — whatever <brand> sells." Reaching the installed app itself is out of scope for the no-build web test (requires the store install).

---

### 5. Fork coverage — exact repro + expected result

**Happy path.** Clean account `sethogievabelgium@gmail.com`; partner-setup invite from `rambleawaypod@gmail.com`. Drive A1→B2→B3→B4→C1→D1→D2→D4(skip *or* complete)→E1. Expected: every node green on all five assertion classes; E1 lands on the Play listing.

**Wrong-account recovery (B5).** Repro: on the device, have Chrome/Gmail signed into the **other** Google account (e.g. open the invite for `sethogievabelgium@…` but sign in as `sethogieva@…`). Expected: the accept flow detects the mismatch (invite bound to a different address) and shows a recovery path — sign out and switch to the invited address, then resume the same invite to C1. Assert no data leak of the invited email beyond what the edge fn intentionally exposes (`WrongAccountRecovery.tsx`), and no dead end.

**Invalid state — consumed link ("already used", B6).** Repro: complete an accept once, then **re-open the same CTA link** (or `Page.navigate` to it again). Expected: the "already used / already accepted" copy renders ("This invitation has already been used. If that was not you, contact the brand owner."), with an actionable exit — not a spinner and not an empty-home dead end. (Also spot-check **expired**: an invite past `expires_at` shows the expiry copy — needs a founder-aged or admin-expired invite.)

**Skip → confirm sheet → Play (D4→E1).** Repro: at D1 tap "I'll add it later" → sheet → tap ghost "Skip for now". Expected: proceeds to E1; on Android the Play listing opens via the single OneLink; no money can go on sale (state consistent with "bank not connected").

**NG / Paystack (D3) — CONDITIONAL.** Only if the founder provisions an NG brand (`country_code='NG'`, `payment_provider='paystack'`) and points the partner-setup invite at it (none exist in prod today). Repro: accept that invite → expect **direct** entry to D3 (no country picker), verified account-name panel, "Connect bank & get paid", reachable Connect button on a short viewport. If no NG brand is provisioned, mark D3/NG **BLOCKED — no NG brand in prod** (not a fail).

---

### 6. Pass/fail matrix (driver fills in)

Legend: ✅ pass · ❌ fail · ⛔ blocked (state blocker) · — n/a. One row per node; the last five columns are the five assertion classes; SS = screenshot filename.

| Node | (i) No infinite spinner | (ii) No overflow / CTA one-line | (iii) Agnostic copy · 0 banned | (iv) URL / `?next=`→bank | (v) Rail auto-matches country | SS |
|------|:--:|:--:|:--:|:--:|:--:|----|
| A1 email (phone) |  |  |  |  | — | node_A1.png |
| A2 email (desktop) |  |  |  |  | — | node_A2.png |
| B1 accept, signed-out |  |  |  |  | — | node_B1.png |
| B2 sign-in email |  |  |  |  | — | node_B2.png |
| B3 OTP (6-digit) |  |  |  |  | — | node_B3.png |
| B4 accepting |  | — | — |  | — | node_B4.png |
| B5 wrong account |  |  |  |  | — | node_B5.png |
| B6 already used |  |  |  |  | — | node_B6.png |
| C1 welcome |  |  |  |  | — | node_C1.png |
| D1 bank (Stripe) |  |  |  |  |  | node_D1.png |
| D2 Stripe embedded |  |  |  |  |  | node_D2.png |
| D3 bank (NG/Paystack) |  |  |  |  |  | node_D3.png |
| D4 skip sheet |  |  |  |  | — | node_D4.png |
| D5 already connected |  |  |  |  | — | node_D5.png |
| D6 verifying |  |  |  |  | — | node_D6.png |
| E1 get the app (Play) |  |  |  |  | — | node_E1.png |
| F1 live (optional) |  |  |  |  | — | node_F1.png |

Also record, per fork: **Happy ✅/❌**, **Wrong-account ✅/❌**, **Already-used ✅/❌**, **Skip→Play ✅/❌**, **NG ✅/❌/⛔**.

**Definition of "100% verified":** every node **green on every applicable assertion**, across — at minimum — the **happy path + wrong-account recovery + skip→Play** forks, on a genuinely clean account, with a **screenshot per node** and the final Android hand-off proven to open the **Mingla Business Play listing** via the single `biz.usemingla.com/ZSCW…` OneLink (attribution intact). NG/Paystack is green only if an NG brand was provisioned (else explicitly ⛔ with reason). No assertion may be marked pass on source reasoning alone — each needs the on-device screenshot/DOM evidence.

---

### 7. What the driver needs from the founder (prerequisites)

1. **Device reconnected + authorized:** Samsung plugged in (MTP), Developer options + USB debugging ON, and the **"Allow USB debugging" RSA prompt accepted** so `adb devices` reads `device` (not `unauthorized`). This is the recurring blocker.
2. **OTP inbox access on the device:** the Samsung's Gmail signed into **both** `sethogieva@gmail.com` and `sethogievabelgium@gmail.com` (or founder relays each 6-digit code). Required because the invite **link** and the OTP both live only in email.
3. **Inviter ready:** `rambleawaypod@gmail.com` (MinglaDemo2026!) signed into `business.usemingla.com` on the phone — verified `partner_enabled=true` with a default brand, so it can send invites.
4. **Clean-slate authorization + method:** confirm which of §2 options to use. Reality check to relay: **`sethogievabelgium@gmail.com` is already clean — use it, no write needed.** `sethogieva@gmail.com` has exactly **one** dangling membership row (`brand_team_members.id 9fcecfcd-84a7-46ed-a5fb-1c8fb19aaf6a`, on the already-soft-deleted "test Brand"); clearing it (option b or the guarded UPDATE in c) needs an explicit **founder GO**, preview-first. Decide: minimal (soft-remove the row) vs full account reset (not recommended).
5. **Which brand / NG-or-not — and this is the make-or-break precondition:** confirm the invite under test is a **partner-setup transfer** invite (the only path that reaches the bank; a plain "invite a team member" does **not**). State exactly which tool/flow mints it. And decide the rail: a **Stripe** brand is available now (e.g. a US/GB brand); the **NG/Paystack** fork requires the founder to provision an NG brand first (none exist in prod), otherwise D3 is reported ⛔ blocked.
6. **Mode:** confirm whether this run is **BASELINE** (against current prod — expect the pre-build two-CTA email + ticket copy + un-allowlisted bank route to FAIL, captured as baseline) or **GATE** (after #948/#949 ships — 100% green required).

---

Sanity check performed: I confirmed the design doc source (commit `fbe90310d`, all 17 screens + 8 blockers), verified the ownership/membership/invite schema and the two test accounts' real state against prod (read-only), verified the `nextRoute` allowlist and the download OneLink literal first-hand in code, and confirmed adb is installed with no device currently attached. No code, git, or DB writes were made; no credentials were read. Runbook files referenced: design at `/Users/sethogieva/Desktop/mingla-main/docs/design/948-949-bank-first-invite-funnel.html` (in git `fbe90310d`; working copy extracted to the session scratchpad), allowlist at `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/utils/nextRoute.ts`, OneLink at `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/constants/storeLinks.ts:85`.

result: Execution-grade "Live Android end-to-end test runbook" delivered as markdown above — CDP/adb bring-up + the unauthorized-device fix, exact read-only clean-slate SELECTs with both accounts' real state (belgium already clean; main = one dangling membership row `9fcecfcd…`) and three ranked deletion options, OTP-read method, per-node drive + 5 assertion classes for all 17 nodes, 5 forks, a fill-in pass/fail matrix, and founder prerequisites; flags that #948/#949 is not-yet-implemented (8 blockers) so the runbook is the pre-build acceptance harness, and that NG/Paystack is not drivable on prod (0 NG brands).
