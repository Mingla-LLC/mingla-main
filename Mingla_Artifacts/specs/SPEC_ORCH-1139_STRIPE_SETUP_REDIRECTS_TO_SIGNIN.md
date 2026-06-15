# SPEC — ORCH-1139 [Stripe setup redirects to business sign-in]

- **Phase:** SPEC (binding build contract — no product-code edits in this phase)
- **Date:** 2026-06-15
- **Skill:** mingla-forensics + claude (SPEC mode)
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1139-[stripe-connect-route-gate]/` on branch `ORCH-1139-stripe-connect-route-gate` (verified at parity with `origin/main`, head `1123cffb5`, 0 commits behind)
- **Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1139_STRIPE_SETUP_REDIRECTS_TO_SIGNIN.md` (root cause `probable`, git-pinned)
- **Comms ledger:** read on entry. **COMMS-0021** (WARN→ALL, Stripe seller-copy rename "Connect Stripe"→"Connect bank") factored — it renames user-facing COPY only; route PATHS and identifiers are unchanged, and NONE of the COMMS-0021 files are in this SPEC's allowlist. No new cross-ORCH discovery requiring a COMMS write.

---

## 1. Executive summary

A logged-in business user who taps "Set up payments" / "Connect bank" is bounced to the business sign-in screen instead of the Stripe Connect onboarding form. Root cause (ORCH-1139 investigation, `CONFIRMED ROOT CAUSE` F-1): the native CTA opens the **web** `/connect-onboarding` page in a sessionless in-app browser (`WebBrowser.openAuthSessionAsync`); ORCH-1102's route-agnostic root-layout gate redirects EVERY web route without a Supabase web session to `/` (sign-in); its only escape hatch is `PUBLIC_BUYER_ROUTE_PREFIXES`, which ORCH-1115 scoped to anon **buyer** routes and never extended to the self-authenticating Stripe-Connect **seller** routes. The connect pages need only their Stripe `session` client_secret (F-2 / Q3) — never a Supabase session.

The fix is an **allowlist extension only**: add two new, semantically-distinct exemption sets — Stripe-Connect seller routes and invite-accept routes — consumed by the same redirect predicate, mirroring exactly the ORCH-1115 segment-safe matcher. No CTA routing, edge function, or connect-page-body change. Plus a new DRAFT closure invariant (`I-PROPOSED-1139-ROUTE-GATE-CLOSURE`) that forces every top-level `app/` route into exactly one classified bucket so no future route silently inherits "redirect to sign-in."

---

## 2. Scope & non-goals

### In scope
1. Add a **Stripe-Connect seller** exemption set to `mingla-business/src/utils/coldLoadAuthGates.ts`.
2. Add an **invite-accept** exemption set to the same file (D-1 from the investigation, **folded in per Seth 2026-06-15**).
3. Wire BOTH sets into the existing redirect predicate `shouldRedirectToSignInFromRoute` AND the native `nativeRedirectToSignIn` path in `app/_layout.tsx`, via a single combined "exempt-from-sign-in-redirect" matcher.
4. Update the existing `orch_1115_anon_buyer_route_allowlist.test.ts` where it currently asserts now-exempt routes STILL redirect (`/connect-partner-onboarding`, `/stripe-onboarding-return` at lines 84-86).
5. Step-0.5 (a) implementor happy-path regression test (new file).
6. Step-0.5 (b) tester adversarial near-miss/segment-safety test (new file, different angle).
7. New DRAFT invariant `I-PROPOSED-1139-ROUTE-GATE-CLOSURE` + its fails-on-revert closure test.

### Non-goals (explicitly NOT in this SPEC)
- **Do NOT propagate the Supabase session into the in-app browser.** The pages don't need it (F-2/Q3); session propagation is higher-risk and out of scope.
- **Do NOT change the CTA routing** (`brandStripeOnboardingRoute` → `/brand/{id}/payments/onboard`), the `BrandOnboardView.handleStart` `WebBrowser.openAuthSessionAsync` call, the `brand-stripe-onboard` edge function, or any `brand-stripe-*` / connect edge function.
- **Do NOT modify any connect page component body** (`ConnectOnboardingBody.web.tsx` et al.) or the native fallbacks.
- **Do NOT modify the existing buyer allowlist** `PUBLIC_BUYER_ROUTE_PREFIXES` entries or `isPublicBuyerRoute` semantics. The 9 buyer prefixes stay exactly as they are (pinned by `orch_1115...test.ts` T-9).
- **Do NOT fold seller/invite routes into `PUBLIC_BUYER_ROUTE_PREFIXES`.** They are a different security class (self-authenticating via out-of-band credential, NOT anon-public-supply). A separate constant is mandatory (investigation Invariant-impact note + Seth-locked).
- **Do NOT touch COMMS-0021 files** (the copy-rename set).
- **No consumer-app (`app-mobile`) change** — different app, unaffected (investigation blast map).

### Assumptions
- The investigation's five-layer trace is accepted as the basis; no new investigation is performed inside this SPEC (SPEC hard rule).
- Route paths verified against the worktree's actual `app/` tree this turn (see §5).

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior demanded | Files touched here | Parity |
|---|---------|---------|--------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile`) | NO | n/a — different app; Stripe payouts here unrelated | none | n/a |
| 2 | Consumer Android (`app-mobile`) | NO | n/a — different app | none | n/a |
| 3 | Buyer/anonymous Web (`mingla-business` buyer routes) | NO (already fixed by ORCH-1115) | unchanged — buyer routes still render for anon | none (buyer allowlist untouched) | n/a |
| 4 | Business iOS | **YES** | Tapping "Set up payments"/"Connect bank" opens the Stripe onboarding form in the in-app browser — NOT the sign-in screen. Same for tax-registrations, account-management, partner onboarding/management, and invite-accept links. | `coldLoadAuthGates.ts` (shared) — the gate runs in the WEB bundle loaded by the native in-app browser | Automatic (shared gate file; one code path serves all web-rendered connect/invite routes) |
| 5 | Business Android | **YES** | Same as Business iOS (same `WebBrowser` → web-bundle path). | `coldLoadAuthGates.ts` (shared) | Automatic (shared) |
| 6 | Admin Web (`mingla-admin`, adjacent) | NO | n/a — separate app, separate gate | none | n/a |
| 7 | Business Web preview (adjacent) | **YES** | A direct sessionless visit to `/connect-*` / `/accept-*` renders the page (Stripe session / invite token in URL) instead of bouncing to `/`. | `coldLoadAuthGates.ts` + `app/_layout.tsx` (shared) | Automatic (shared gate) |

**Affected Surfaces (one line):** Business iOS in-app browser + Business Android in-app browser + Business Web preview (direct). All three are served by the SAME web bundle + the SAME `coldLoadAuthGates.ts` gate, so the single allowlist change fixes all three at once (parity automatic).

---

## 4. Layered specification

Only ONE layer is affected: the **client route gate** (`coldLoadAuthGates.ts`) and its **consumer** (`app/_layout.tsx`). No DB / RLS / edge / service / hook / realtime change. (`brand-stripe-onboard` already enforces auth server-side at link creation — investigation §reconciliation Schema/RLS row.)

### 4.1 `mingla-business/src/utils/coldLoadAuthGates.ts`

#### 4.1.1 New constant — Stripe-Connect seller routes

Insert AFTER the `isPublicBuyerRoute` function (after line 181) and BEFORE the `shouldRedirectToSignInFromRoute` doc-comment (line 183). The new constant + its sibling (4.1.2) + the combined matcher (4.1.3) form a contiguous new block.

```ts
export const SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES = [ ... ] as const;
```

Exact entries (each verified against an `app/` file in §5):

| Prefix | `app/` file that defines it |
|--------|-----------------------------|
| `"/connect-onboarding"` | `app/connect-onboarding.web.tsx` |
| `"/connect-account-management"` | `app/connect-account-management.web.tsx` |
| `"/connect-partner-onboarding"` | `app/connect-partner-onboarding.web.tsx` |
| `"/connect-partner-account-management"` | `app/connect-partner-account-management.web.tsx` |
| `"/connect-tax-registrations"` | `app/connect-tax-registrations/index.web.tsx` |
| `"/stripe-onboarding-return"` | `app/stripe-onboarding-return.tsx` |

> **Trailing-slash form:** these are written WITHOUT a trailing slash (unlike the buyer prefixes which carry one) because the combined matcher (4.1.3) normalizes a prefix to its no-trailing-slash `base` regardless. Writing them bare keeps the constant readable AND makes the bare route (`/connect-onboarding`, no sub-segment — the real arrival path) the literal first match. The matcher's `base + "/"` clause still makes any deeper path (`/connect-onboarding/foo`) match and a lookalike (`/connect-onboarding-evil`) NOT match. **Do NOT rely on a trailing slash being present** — the matcher must strip/normalize identically to ORCH-1115.

**Mandatory inline comment (constitutional caveat — verbatim intent, implementor may reflow):**

```
/**
 * SELF-AUTHENTICATING STRIPE-CONNECT SELLER ROUTES — ORCH-1139.
 *
 * Exempt from the ORCH-1102 route-agnostic sign-in redirect. These are NOT
 * anon-public buyer routes (do NOT add them to PUBLIC_BUYER_ROUTE_PREFIXES).
 * They are served by the WEB bundle and opened by the native "Set up payments"
 * CTA in a SESSIONLESS in-app browser (WebBrowser.openAuthSessionAsync), so they
 * carry NO Supabase web session and the route-agnostic gate would bounce them
 * to `/` (business sign-in) before the page can mount.
 *
 * CONSTITUTIONAL CAVEAT: this exemption is valid ONLY because each page carries
 * its OWN out-of-band credential in the URL — the Stripe AccountSession
 * client_secret (`?session=…`), minted by the auth-checked `brand-stripe-onboard`
 * edge function — and authenticates itself against Stripe (ConnectOnboardingBody
 * never reads a Supabase user). The exemption does NOT make seller account data
 * public: the page renders nothing without a valid Stripe client_secret. NEVER
 * add a route here that would instead read account data from an implicit Supabase
 * session — that would be a real data exposure. (See ORCH-1139 F-2 / Q3.)
 */
```

#### 4.1.2 New constant — invite-accept routes

Immediately after 4.1.1:

```ts
export const INVITE_ACCEPT_ROUTE_PREFIXES = [ ... ] as const;
```

Exact entries (each verified in §5):

| Prefix | `app/` file that defines it | Covers |
|--------|-----------------------------|--------|
| `"/accept-brand-invitation"` | `app/accept-brand-invitation.tsx` | the bare accept page AND `app/accept-brand-invitation/success.tsx` (`/accept-brand-invitation/success`), because the segment-safe matcher's `base + "/"` clause matches the sub-route |
| `"/accept-scanner-invitation"` | `app/accept-scanner-invitation.tsx` | the scanner-invite accept page |

**Mandatory inline comment (constitutional caveat — verbatim intent, implementor may reflow):**

```
/**
 * INVITE-ACCEPT ROUTES — ORCH-1139 (D-1, Seth-folded-in 2026-06-15).
 *
 * Exempt from the sign-in redirect for the SAME reason as the connect routes:
 * a logged-OUT invitee opening an emailed invite link must reach the accept
 * page, not the sign-in wall. CONSTITUTIONAL CAVEAT: valid ONLY because each
 * page carries its OWN out-of-band credential — the invite TOKEN in the URL —
 * and performs its own authorization against that token. The exemption does NOT
 * make any brand/scanner data public; the page resolves nothing without a valid
 * invite token. Kept DISTINCT from the connect set and the buyer set so a
 * reviewer can reason about each class independently.
 */
```

#### 4.1.3 New combined matcher

Add a single matcher that the predicate consults, reusing the EXACT ORCH-1115 segment-safe normalization (trim → strip one trailing slash for `length > 1` → `normalized === base || normalized.startsWith(base + "/")`). It checks the union of the two new sets:

```ts
export const isSelfAuthenticatedExemptRoute = (
  pathname: string | null | undefined,
): boolean => { ... }
```

Behavioral contract (identical normalization to `isPublicBuyerRoute`, lines 166-181):
- `null` / `undefined` / `""` / whitespace-only → `false`.
- Trim; strip a single trailing slash only when `length > 1`.
- For each prefix `P` in `[...SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES, ...INVITE_ACCEPT_ROUTE_PREFIXES]`: let `base = P` without any trailing slash; match iff `normalized === base || normalized.startsWith(`${base}/`)`.
- Returns `true` if ANY prefix matches.

> The implementor MAY factor the shared normalization into a private helper used by both `isPublicBuyerRoute` and `isSelfAuthenticatedExemptRoute` IF it does not change `isPublicBuyerRoute`'s observable behavior (T-3/T-4/T-5 of the 1115 test must still pass unchanged). Otherwise duplicate the proven matcher verbatim — correctness over DRY here.

#### 4.1.4 Predicate change — `shouldRedirectToSignInFromRoute`

Current (lines 214-217):
```ts
shouldRedirectToSignIn({ isWeb, loading, hasUser, hasStoredWebSession }) &&
!isSignInRoute(pathname) &&
!isPublicBuyerRoute(pathname);
```

New — AND in the new exemption (an exemption can ONLY flip `true`→`false`, never introduce a redirect):
```ts
shouldRedirectToSignIn({ isWeb, loading, hasUser, hasStoredWebSession }) &&
!isSignInRoute(pathname) &&
!isPublicBuyerRoute(pathname) &&
!isSelfAuthenticatedExemptRoute(pathname);
```

Update the function's doc-comment to note the ORCH-1139 clause alongside the ORCH-1115 one (same "can only suppress, never cause" reasoning).

### 4.2 `mingla-business/app/_layout.tsx`

#### 4.2.1 Import

Add `isSelfAuthenticatedExemptRoute` to the existing import block from `coldLoadAuthGates` (currently importing `isPublicBuyerRoute`, `isSignInRoute`, `isWebAuthResolving`, `shouldRedirectToSignInFromRoute` at lines 79-82).

#### 4.2.2 Native path — `nativeRedirectToSignIn`

Current (lines 356-361):
```ts
const nativeRedirectToSignIn =
  !isWeb &&
  !loading &&
  user === null &&
  !isSignInRoute(pathname) &&
  !isPublicBuyerRoute(pathname);
```

New — AND in the same exemption so the native path stays in lockstep with the web predicate (this is a no-op on business-native today, which serves none of these routes, but it keeps the exemption set in ONE place and hardens against a future native connect/invite route — exactly the ORCH-1115 rationale at lines 350-355):
```ts
const nativeRedirectToSignIn =
  !isWeb &&
  !loading &&
  user === null &&
  !isSignInRoute(pathname) &&
  !isPublicBuyerRoute(pathname) &&
  !isSelfAuthenticatedExemptRoute(pathname);
```

Add a one-line ORCH-1139 comment above mirroring the ORCH-1115 note already there.

> NOTE: The `redirectToSignIn` (web) variable at line 327 calls `shouldRedirectToSignInFromRoute`, which already gains the exemption via 4.1.4 — no further change there. Only the native inline predicate (4.2.2) needs the explicit clause.

---

## 5. Verified route-path list (grep proof)

All routes verified against the worktree `app/` tree this turn:

```
$ ls -1 app/*.tsx app/*.web.tsx | sed 's#app/##' | sort -u
  accept-brand-invitation.tsx
  accept-scanner-invitation.tsx
  connect-account-management.tsx  + .web.tsx
  connect-onboarding.tsx          + .web.tsx
  connect-partner-account-management.tsx + .web.tsx
  connect-partner-onboarding.tsx  + .web.tsx
  index.tsx
  notifications.tsx
  stripe-onboarding-return.tsx
$ find app -maxdepth 1 -type d   (route segments)
  (tabs) account ari auth b booking brand checkout checkout-experience
  checkout-trip connect-tax-registrations e event exp experience o partner
  support t trip venue accept-brand-invitation
$ ls app/accept-brand-invitation/   → success.tsx   (→ /accept-brand-invitation/success)
$ ls app/connect-tax-registrations/ → index.tsx + index.web.tsx
$ head app/stripe-onboarding-return.tsx → "/stripe-onboarding-return — HTTPS relay for Stripe hosted onboarding"
$ head app/connect-onboarding.web.tsx   → "/connect-onboarding — Mingla-hosted Stripe Connect Embedded Components page"
$ head app/connect-account-management.web.tsx → "/connect-account-management — Mingla-hosted Stripe Connect management page"
$ head app/connect-partner-onboarding.web.tsx → "/connect-partner-onboarding — Mingla-hosted Stripe Connect Embedded"
$ head app/connect-partner-account-management.web.tsx → "/connect-partner-account-management — Mingla-hosted Stripe Connect"
$ head app/connect-tax-registrations/index.web.tsx → "/connect-tax-registrations — embedded Stripe Tax registrations + settings page"
$ ls app/accept-invite*  → no matches found   (the 1115 test's "/accept-invite" sample is NOT a real route)
```

**Final exempt list (all 8 confirmed to exist):**

Connect-seller (6): `/connect-onboarding`, `/connect-account-management`, `/connect-partner-onboarding`, `/connect-partner-account-management`, `/connect-tax-registrations`, `/stripe-onboarding-return`.

Invite-accept (2): `/accept-brand-invitation` (covers `/accept-brand-invitation/success` via segment match), `/accept-scanner-invitation`.

> **Deviation from the investigation's recommendation:** none on the route list. The investigation's "Recommended fix" named exactly the 6 connect routes and flagged the 2 invite routes (D-1) for a scope decision; Seth folded D-1 in, so this SPEC exempts all 8. The `/stripe-onboarding-return` route exists and is `@deprecated` (ORCH-0954) but still live for legacy TEST hosted-onboarding returns (investigation D-2) — it is exempted because its mount-time self-redirect would otherwise be bounced first.

---

## 6. Success criteria

- **SC-1 (web predicate):** For a logged-out web user (`isWeb:true, loading:false, hasUser:false, hasStoredWebSession:false`), `shouldRedirectToSignInFromRoute({ pathname })` returns `false` for every one of the 8 exempt routes (bare + a representative sub-path each).
- **SC-2 (still-gated):** For the same logged-out user, `shouldRedirectToSignInFromRoute` STILL returns `true` for a representative private route (`/account`, `/(tabs)/home`, `/brand/123`, `/notifications`).
- **SC-3 (segment-safety):** `isSelfAuthenticatedExemptRoute` returns `false` for near-miss/traversal lookalikes — `/connect-onboarding-evil`, `/connect-onboardingX`, `/x/connect-onboarding`, `/accept-brand-invitationX`, `/stripe-onboarding-return-fake` — and `shouldRedirectToSignInFromRoute` STILL returns `true` for each.
- **SC-4-iOS / SC-4-Android (runtime — tester device gate):** On a real device, tapping "Set up payments"/"Connect bank" opens the in-app browser to the Stripe onboarding form (NOT the business sign-in screen). Parity automatic via the shared gate; tester verifies at least one platform end-to-end and the other by code-path identity.
- **SC-5 (Web preview):** A direct sessionless browser visit to `https://business.…/connect-onboarding?session=…&brand_id=…` renders the Connect Embedded page, not `/`.
- **SC-6 (buyer untouched):** `PUBLIC_BUYER_ROUTE_PREFIXES` is byte-for-byte unchanged (the existing 1115 T-9 assertion of exactly 9 prefixes still passes).
- **SC-7 (single source of truth):** Each new constant is defined exactly once in `coldLoadAuthGates.ts`; both web and native redirect paths consult `isSelfAuthenticatedExemptRoute`.
- **SC-8 (closure):** Every top-level route under `mingla-business/app/` is classified into exactly one of {gated-default, buyer-exempt, connect-seller-exempt, invite-exempt}; the closure test fails the build if any unclassified route appears.

---

## 7. Invariants

### Preserved
- **I-PROPOSED-1115-PUBLIC-BUYER-ROUTE-ALLOWLIST** (`coldLoadAuthGates.ts:130`): preserved — `PUBLIC_BUYER_ROUTE_PREFIXES` and `isPublicBuyerRoute` are not modified; the new set is a distinct sibling. Verified by SC-6 + the unchanged 1115 test T-9.
- **ORCH-1103 self-redirect loop guard** (`isSignInRoute` ANDed first): preserved — the new clause composes after it and can only suppress, never add, a redirect. Verified by the 1115 test T-8 (kept) + SC carry-over.
- **META-ORCH-0972 Sub-B Android web-SDK quarantine** (`androidWebOnlyConnectRoutes.test.ts`): preserved — this SPEC touches neither the native connect route files nor metro config. (Run that test as a regression check.)

### New (DRAFT — orchestrator owns the ACTIVE flip at CLOSE)
- **I-PROPOSED-1139-ROUTE-GATE-CLOSURE (DRAFT):** Every top-level route under `mingla-business/app/` (`*.tsx` / `*.web.tsx` directly in `app/`, plus each immediate subdirectory of `app/` as a route segment) MUST be classified into exactly one explicit set: GATED-by-default, or one of the three exemption sets (buyer / connect-seller / invite). A new route added to `app/` that is not added to a classification list FAILS the build. This converts "a new route silently inherits redirect-to-sign-in" (the exact mechanism behind both ORCH-1115 and ORCH-1139) from a latent P0 into a CI failure. **Flips ACTIVE at CLOSE.**

---

## 8. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-A1 | logged-out, each connect route (bare) | `/connect-onboarding`, …×6 | `shouldRedirectToSignInFromRoute` → `false` | gate |
| T-A2 | logged-out, each connect route + sub-path | `/connect-onboarding/step2`, `/accept-brand-invitation/success` | `false` | gate |
| T-A3 | logged-out, each invite route | `/accept-brand-invitation`, `/accept-scanner-invitation` | `false` | gate |
| T-A4 | logged-out, private route still gated | `/account`, `/(tabs)/home`, `/brand/123`, `/notifications` | `true` | gate |
| T-A5 | logged-IN on exempt route | any exempt + `hasUser:true` | `false` (already; pins it) | gate |
| T-A6 | warming session on exempt route | exempt + `hasStoredWebSession:true,hasUser:false` | `false` | gate |
| T-B1 | near-miss suffix | `/connect-onboarding-evil`, `/connect-onboardingX` | `isSelfAuthenticatedExemptRoute` → `false`; redirect → `true` | gate |
| T-B2 | path-traversal prefix | `/x/connect-onboarding`, `/foo/accept-scanner-invitation` | `false`; redirect → `true` | gate |
| T-B3 | invite lookalike | `/accept-brand-invitationX`, `/accept-scanner` | `false`; redirect → `true` | gate |
| T-B4 | null/empty/whitespace | `null`, `""`, `" "` | `isSelfAuthenticatedExemptRoute` → `false` | gate |
| T-B5 | trailing-slash + bare both match | `/connect-onboarding/`, `/connect-onboarding`, `/accept-scanner-invitation/` | `true` | gate |
| T-C1 | closure — every app route classified | enumerate `app/` | each route in exactly one set; else FAIL | structural |
| T-C2 | closure fails-on-revert | remove a connect prefix | closure test FAILS | structural |

---

## 9. Implementation order

1. **`coldLoadAuthGates.ts`** — add `SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES` (4.1.1) + `INVITE_ACCEPT_ROUTE_PREFIXES` (4.1.2) + `isSelfAuthenticatedExemptRoute` (4.1.3), then AND the exemption into `shouldRedirectToSignInFromRoute` (4.1.4) + update its doc-comment.
2. **`app/_layout.tsx`** — import `isSelfAuthenticatedExemptRoute` (4.2.1) + AND it into `nativeRedirectToSignIn` (4.2.2) + one-line comment.
3. **Update `src/utils/__tests__/orch_1115_anon_buyer_route_allowlist.test.ts`** — remove `/connect-partner-onboarding` (line 84) and `/stripe-onboarding-return` (line 86) from `AUTHED_ONLY_ROUTE_SAMPLES` (they are now exempt and would make T-2 fail). Leave `/accept-invite` (line 85) — it is NOT a real route, so it correctly STILL redirects; keep it as a negative control. Mark the edit `[TEST-MOD-APPROVED ORCH-1139]` with a one-line why.
4. **Step-0.5 (a)** implementor happy-path test — new file (§ Regression).
5. **Step-0.5 (b)** tester adversarial test — new file (§ Regression).
6. **Closure invariant test** — new file (§ Regression).
7. Run the jest suite (`coldLoadAuthGates`, the 1115 test, `androidWebOnlyConnectRoutes`, the three new files) — all green; then prove fails-on-revert per §9 regression.

---

## 10. Regression prevention (fails-on-revert contract)

### Step-0.5 (a) — implementor happy-path test
**File:** `mingla-business/src/utils/__tests__/orch_1139_connect_seller_route_allowlist.test.ts` (mirrors the 1115 test's location + shape).
**Imports:** `SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES`, `INVITE_ACCEPT_ROUTE_PREFIXES`, `isSelfAuthenticatedExemptRoute`, `shouldRedirectToSignInFromRoute` from `../coldLoadAuthGates`.
**Asserts:** T-A1/A2/A3 (each exempt route + sub-path → redirect `false`), T-A4 (private routes still `true`), T-A5/A6 (logged-in + warming → `false`), plus structural: each constant defined exactly once; `_layout.tsx` consumes `isSelfAuthenticatedExemptRoute`; the web predicate ANDs `!isSelfAuthenticatedExemptRoute(pathname)`.
**Fails-on-revert:** delete the `&& !isSelfAuthenticatedExemptRoute(pathname)` clause from `shouldRedirectToSignInFromRoute` → T-A1/A2/A3 flip to `true` and FAIL, while T-A4 stays `true` and PASSES — proving the new allowlist (not a blanket change) is what suppresses the redirect. Restore → all PASS.

### Step-0.5 (b) — tester adversarial test (DIFFERENT angle: segment-safety / traversal)
**File:** `mingla-business/src/utils/__tests__/orch_1139_connect_route_segment_safety.test.ts`.
**Asserts:** T-B1/B2/B3 (near-miss suffix, path-traversal prefix, invite lookalike → `isSelfAuthenticatedExemptRoute` `false` AND `shouldRedirectToSignInFromRoute` STILL `true`), T-B4 (null/empty/whitespace → `false`), T-B5 (trailing-slash + bare both `true`).
**Fails-on-revert:** if the implementor uses a loose `includes`/`startsWith` without the segment-safe `base + "/"` boundary, T-B1/B2/B3 flip to `false`-exempt (wrongly exempting `/connect-onboarding-evil` and `/x/connect-onboarding`) and FAIL — proving the match is segment-safe, not a substring match. This is the tester's independent adversarial gate; it must be a SEPARATE file from (a) and written by tester, not implementor.

### Closure invariant test (I-PROPOSED-1139-ROUTE-GATE-CLOSURE)
**File:** `mingla-business/__tests__/orch_1139_route_gate_closure.test.ts` (sits alongside `androidWebOnlyConnectRoutes.test.ts`, which is the route-enumeration precedent).
**Mechanism:**
1. Enumerate top-level routes: `fs.readdirSync('mingla-business/app')` → for each `*.tsx`/`*.web.tsx` directly in `app/`, derive the route name by stripping `.web.tsx`/`.tsx` (dedupe `.tsx`+`.web.tsx` pairs); for each immediate SUBDIRECTORY, the dir name IS the route segment. EXCLUDE the special files `_layout`, `+html`, `+not-found`, `__styleguide` (Expo-router internals / dev-only).
2. Build the classification union from the actual exported constants: `GATED_DEFAULT` = the explicit gated set the test hardcodes (`(tabs)`, `account`, `ari`, `auth`, `b`*, `booking`*, `brand`, `checkout`*, `checkout-experience`*, `checkout-trip`*, `e`*, `event`, `exp`*, `experience`, `o`*, `partner`, `support`, `t`*, `trip`, `venue`, `index`, `notifications`) — where `*` routes are ALSO buyer-public but are gated-by-default at the directory level and exempted at the deeper buyer path; the test classifies by the buyer-prefix membership for those. To avoid double-counting: a route is "buyer-exempt" iff its `/segment/` is in `PUBLIC_BUYER_ROUTE_PREFIXES`, "connect-exempt" iff in `SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES`, "invite-exempt" iff in `INVITE_ACCEPT_ROUTE_PREFIXES`, else "gated-default".
3. Assert: every enumerated route maps to EXACTLY ONE bucket (no route unclassified, no route in two exemption sets). Build an explicit expected-classification map in the test and assert the live enumeration equals it.
**Where it lives + why:** `mingla-business/__tests__/` (top-level jest dir; same place as the existing connect-route enumeration test, so the route-listing fixtures stay together).
**Fails-on-revert:** (T-C2) removing a connect prefix from the constant moves that route from "connect-exempt" to "gated-default", which contradicts the expected map → FAIL. Adding a new file to `app/` without classifying it → the enumeration finds an unmapped route → FAIL. Restore → PASS.
**Caveat for the implementor:** the closure test reads the live `app/` directory, so it is sensitive to new routes. That is the POINT (it forces classification), but the implementor must seed the expected-map with the CURRENT inventory in §5 so the test is green on first run. If a route in §5 is missed, the test will redden — that is the safety net working.

---

## 11. Open questions

None. Seth locked the scope (connect-seller routes + invite routes folded in) on 2026-06-15. The only judgment calls — separate constants vs. one combined (→ two distinct constants), and whether `/stripe-onboarding-return` is exempted (→ yes, it exists and self-redirects) — are resolved above with evidence.

---

## 12. Downstream routing

**Next = mingla-implementor (business side).** Then mingla-tester (writes the Step-0.5 (b) adversarial test independently + runs device SC-4/SC-5). Then mingla-orchestrator CLOSE (flips `I-PROPOSED-1139-ROUTE-GATE-CLOSURE` to ACTIVE, registers in `INVARIANT_REGISTRY.md`, World-Map sync).

`Working tree: ~/Desktop/mingla-orchs/ORCH-1139-[stripe-connect-route-gate]/ on branch ORCH-1139-stripe-connect-route-gate` (rebased onto origin/main, 0 behind).

---

## Allowlist (implementor MAY change ONLY these)

1. `mingla-business/src/utils/coldLoadAuthGates.ts` — add 2 constants + 1 matcher + AND the exemption into `shouldRedirectToSignInFromRoute`.
2. `mingla-business/app/_layout.tsx` — import + AND the exemption into `nativeRedirectToSignIn`.
3. `mingla-business/src/utils/__tests__/orch_1115_anon_buyer_route_allowlist.test.ts` — remove the two now-exempt samples from `AUTHED_ONLY_ROUTE_SAMPLES` only (`[TEST-MOD-APPROVED ORCH-1139]`).
4. **CREATE** `mingla-business/src/utils/__tests__/orch_1139_connect_seller_route_allowlist.test.ts` (implementor happy-path).
5. **CREATE** `mingla-business/__tests__/orch_1139_route_gate_closure.test.ts` (closure invariant).
6. (tester) **CREATE** `mingla-business/src/utils/__tests__/orch_1139_connect_route_segment_safety.test.ts` (adversarial — tester writes this independently).

## DO-NOT-TOUCH

- `PUBLIC_BUYER_ROUTE_PREFIXES` / `isPublicBuyerRoute` (buyer allowlist — unchanged).
- `src/utils/paidPublishGuards.ts` `brandStripeOnboardingRoute` + all CTA routing.
- `src/components/brand/BrandOnboardView.tsx` (the `WebBrowser.openAuthSessionAsync` call).
- `supabase/functions/brand-stripe-onboard/` and every `brand-stripe-*` / connect edge function.
- All connect-page component bodies (`ConnectOnboardingBody.web.tsx`, the native fallbacks, `connect-*.tsx`/`.web.tsx` route files, `connect-tax-registrations/`).
- `metro.config.js`, `stripeConnectNativeStub.js`, `androidWebOnlyConnectRoutes.test.ts` (META-ORCH-0972 quarantine).
- The COMMS-0021 copy-rename file set.
- `app-mobile/` (consumer app — unaffected).

Anything outside the allowlist → **stop-and-amend** (request a SPEC amendment); never silently widen.
