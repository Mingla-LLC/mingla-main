# SPEC — ORCH-1404 [accept-invite-web-error-recovery]

**Mode:** SPEC (build contract — NO code). Dispatched by mingla-orchestrator (conductor).
**Author:** mingla-forensics.
**Date:** 2026-07-18
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1404-[accept-invite-web-error-recovery]/` on branch `ORCH-1404-accept-invite-web-error-recovery`.
**Upstream investigation:** `Mingla_Artifacts/investigations/ORCH-1400-1403-invite-flow-issues-INVESTIGATION.md` (findings **F-1** wrong-account dead-end, **F-2** dead error-copy). Both proven on live prod (Samsung, CDP 9378).
**Downstream:** mingla-implementor → mingla-tester → orchestrator CLOSE.
**Deploy:** touches `mingla-business/` (web surface `business.usemingla.com`) → merge commit MUST carry `[deploy]` (Vercel gate). OTA N/A (this is the web export, not a native bundle).

---

## 1. Executive summary

Every failed brand-invite accept on the web today shows the same generic screen — **"Something went wrong (status 500) / Back to Mingla"** — no matter what actually happened. The real reasons ("this invite was sent to a different email", "already accepted", "expired", "revoked", "not found") are written and ready in the code but are **never shown**, because the client reads the HTTP status and error code from the wrong place on a Supabase edge-function error. The invitee never learns *why* it failed and, when they are simply signed in as the wrong account, has **no way to fix it** — the only button dumps them to the Mingla home page.

This spec does two things, web-only:

1. **Fix the error parse (foundation).** Read the status and error code from the correct field on a Supabase `FunctionsHttpError` so every real failure code reaches its already-written, specific copy.
2. **Make "wrong account" recoverable (the "#4" ask).** When the invite was sent to a different email than the one signed in, show a real **"Sign in with a different email"** action that signs the current user out and resumes the invite after they re-sign-in as the correct account — reusing the existing ORCH-1373/1375 `?next=` resume path and its single security validator (`sanitizeNextRoute`). No dead-end.

No backend, migration, native, funnel-redesign, or connect-bank-scroll work is in scope.

---

## 2. Scope & non-goals

### In scope (web accept-error surface only)
- **`mingla-business/src/services/brandInvitationsService.ts`** — replace the broken `extractStatus` / `extractErrorCode` internals with a `FunctionsHttpError`-aware parser so a 400/401/403/404/409/410 surfaces its real HTTP status and `{ error: "<code>" }` body code. This is shared by all five callers in that service (invite / accept / accept-my-pending / decline / list-my-pending), so the fix lands once and helps every one of them.
- **`mingla-business/app/accept-brand-invitation.tsx`** — (a) ensure every reachable error code has specific copy (add the one missing code, `unauthenticated`); (b) branch the error render so the **wrong-account** case renders a recovery screen instead of a Back-only dead-end.
- **`mingla-business/src/components/invite/WrongAccountRecovery.tsx`** (NEW) — a small presentational component for the wrong-account screen, extracted so the interactive recovery action is runtime-testable in isolation (per the interactive-elements-must-fire runtime-proof rule).
- **NEW append-only test files** (Section 9) proving both fixes fail-on-revert.

### Non-goals (explicitly OUT — with reason)
- **No `supabase/**` change.** The edge fn `accept-brand-invitation/index.ts` already returns the correct status codes and `{ error }` bodies (verified §4.0). This is purely client parse + UI.
- **No native freeze work (ORCH-1400 literal hang).** The web hard-freeze was NOT reproduced; the OAuth-callback lock swap and the native App-Link path are separate, un-sim-proven candidates. Out of this ORCH.
- **No connect-bank scroll fix (ORCH-1403).**
- **No invite-funnel / bank-first redesign or copy pass (ORCH-1401 / 1402).**
- **Do NOT edit `src/utils/authReadiness.ts`** (explicit dispatch guard).
- **Do NOT edit `src/utils/nextRoute.ts`, `authNextHandoff.ts`, `coldLoadAuthGates.ts`, or `app/auth/index.tsx`.** The recovery REUSES them unchanged (`sanitizeNextRoute` is the one validator; `/auth` already reads `?next=`). We add no new redirector.
- **Do NOT touch `scannerInvitationsService.ts` / `accept-scanner-invitation.tsx`.** See §4.6 — the scanner path carries the identical parse bug but is a *separate* file with 0 production rows; it is registered as a Discovery, not folded in.
- **No currency-mismatch (409) recovery action.** That screen keeps its existing copy ("Connect your bank first"); wiring a bank link needs a `brandId` the 403/409 body does not carry. Registered as a follow-up (§10).

### Assumptions
- The edge fn's HTTP contract (§4.0) is stable and authoritative.
- supabase-js `@supabase/functions-js` throws `FunctionsHttpError(response)` where `error.context` **is the `Response`** (verified against the vendored module, §4.1).
- `/auth` continues to consume `?next=` via `sanitizeNextRoute` + the sessionStorage handoff (verified §4.4).

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior demanded | Files touched here | Parity |
|---|---------|---------|-------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | **No** | n/a — brand invites are a business-app concept | none | n/a |
| 2 | Consumer Android (`app-mobile/`) | **No** | n/a | none | n/a |
| 3 | Buyer/anon Web (`mingla-business` web) | **Yes — primary** | Failed accept shows specific copy per code; wrong-account offers "Sign in with a different email" → sign-out → resume invite | `brandInvitationsService.ts`, `accept-brand-invitation.tsx`, `WrongAccountRecovery.tsx` | Shared code (all web) |
| 4 | Business iOS (`mingla-business` native) | **Incidental** | Same code compiles native; accept is a web-link landing so native rarely hits it, but the parse fix + copy apply if reached. `window`/`sessionStorage` guards already SSR/native-safe (`authNextHandoff.ts:43-52`). | same shared files | Automatic (shared) |
| 5 | Business Android (`mingla-business` native) | **Incidental** | Same as iOS | same shared files | Automatic (shared) |
| 6 | Admin Web (`mingla-admin/`, adjacent) | **No** | not involved in invite accept | none | n/a |
| 7 | Business Web preview (adjacent) | **No** | no preview surface for this route | none | n/a |

Primary target = **Surface 3 (business web)**. Surfaces 4/5 inherit the shared code automatically; no separate native path exists, so there is no manual-parity split. The recovery's `window`/`sessionStorage` use is already guarded for native (returns null, degrades to "go home"), so native cannot crash on it.

---

## 4. Layered specification

### 4.0 Backend contract (READ-ONLY — for reference; NOT edited)

`supabase/functions/accept-brand-invitation/index.ts` returns (verified verbatim):

| HTTP | body `error` | Meaning | Reachable on web token path |
|------|--------------|---------|-----------------------------|
| 200 | — (`{ brand_id, role, … }`) | success | yes |
| 400 | `validation` | bad/short token | yes |
| 401 | `unauthenticated` | missing/expired JWT mid-flow | yes (rare) |
| 403 | `invite_email_mismatch` | signed-in email ≠ invited email (or no `creator_accounts` row) | **yes — the wrong-account case** |
| 404 | `invite_not_found` | token/hash not found | yes |
| 409 | `invite_currency_mismatch` (+`partner_gate`) | partner Stripe can't settle brand currency | yes |
| 410 | `invite_already_used` \| `invite_expired` \| `invite_revoked` \| `invite_declined` | terminal states | yes |
| 410 | `invite_not_actionable` | in-app tokenless path only | **no** on web token path |
| 405 | `method_not_allowed` | non-POST | no (client always POSTs) |
| 500 | `server` | unexpected | yes |

**Conclusion:** the server already speaks the right codes. Every generic-500 the user sees is a *client parse* failure. No edge-fn change is warranted or permitted.

### 4.1 The parse bug (root cause, F-2) — verified

supabase-js throws at `FunctionsClient.js:266`: `if (!response.ok) throw new FunctionsHttpError(response)`. `FunctionsError`'s constructor stores its third arg as `this.context` (`types.js:14-17`), so for an HTTP error **`error.context` IS the `Response`**:
- Real status → **`error.context.status`** (NOT `error.context.response.status`).
- Real body → **`await error.context.json()`** — a Promise; the body is *not* consumed by supabase-js before the throw (it throws before the `response.json()` read), so it is safe to read once. supabase-js also returns `{ data: null, error }` on non-2xx, so **`data` is null** — `data.error` can never carry the code.

Current `extractStatus` reads `error.context?.response?.status` → `undefined` → falls to `error.status` (absent on `FunctionsHttpError`) → returns **500**. Current `extractErrorCode` reads `data.error` (null) → falls to `error.code` (absent) → returns **null → "server"**. Result: `errorCopyFor("server", 500)` → the `default` branch, always. (`brandInvitationsService.ts:364-387`.)

### 4.2 Service layer — `brandInvitationsService.ts`

**Replace** the two synchronous internals `extractStatus(error)` and `extractErrorCode(data, error)` with a **single async parser** (name suggestion: `parseFunctionsError`) with this contract:

- **Signature (contract, not code):** `async (error: unknown): Promise<{ status: number; code: string }>`.
- **When `error.context` looks like a `Response`** (has a numeric `.status` and a `.clone`/`.json` function):
  1. `status = error.context.status`.
  2. Read the body defensively: `body = await error.context.clone().json()` inside a `try` (clone so a second reader — logging, React Query — can never trip "body already read"; `catch` → `body = null`).
  3. `code = (typeof body?.error === "string" ? body.error : "server")`.
- **When `error.context` is NOT a Response** (e.g. `FunctionsFetchError` network failure, where context is the fetch error): `status = 0`, `code = "server"` (→ generic message, never a fake 500).
- **Legacy fallback (preserve):** if `error` has a numeric top-level `.status`, use it; if it has a string top-level `.code`, use it. This keeps `BrandInvitationServiceError` re-throws and any hand-constructed errors working. This is the "preserve the existing fallback so a genuinely-unknown error still maps to a sane message" requirement.

**Update all five call sites** that today do `const status = extractStatus(error); const code = extractErrorCode(data, error) ?? "server";` to instead `const { status, code } = await parseFunctionsError(error);` and construct `new BrandInvitationServiceError(code, status, error.message)`:
- `inviteBrandMember` (:154-158)
- `acceptBrandInvitation` (:173-177) — **the load-bearing one for this ORCH**
- `acceptMyPendingInvitation` (:215-219)
- `declineBrandInvitation` (:256-263) — preserve its `status === 410 || code === "invite_not_actionable"` → treat-as-success branch; it now receives the *correct* status/code, which only makes that branch more accurate.
- `listMyPendingInvites` (:303-307)

`extractErrorCode`'s second param `data` is dropped (it was always null on error). The `revokeBrandInvitation` / `listBrandInvitations` / `listBrandTeamMembers` paths use direct PostgREST (not `functions.invoke`) and are unchanged.

**Error contract unchanged:** these functions still *throw* `BrandInvitationServiceError`; only the `.status` / `.code` values it carries become correct.

### 4.3 Route layer — `accept-brand-invitation.tsx`

**4.3.1 `errorCopyFor` — complete the enumeration.** Keep all existing cases. **Add** `unauthenticated` (currently falls to `default`):

| code | title | body |
|------|-------|------|
| `unauthenticated` | "Sign in to continue" | "Your session ended. Sign in again to accept this invitation." |

All other reachable codes already have copy (`invite_not_found`, `invite_already_used`, `invite_expired`, `invite_email_mismatch`, `invite_revoked`, `invite_declined`, `invite_currency_mismatch`, `validation`). The `default` branch is now reached ONLY by truly-unmapped/unknown or network errors — its copy is revised to not surface a raw status number to users (see Open Question OQ-3 for exact wording; proposed: **"Something went wrong / We couldn't accept this invitation right now. Try again in a moment."**).

**4.3.2 Wrong-account recovery branch.** In the `phase.kind === "error"` render, branch on the code:
- **`phase.code === "invite_email_mismatch"`** → render `<WrongAccountRecovery>` (§4.5) instead of the single-button card.
- **all other codes** → the existing single "Back to Mingla" card, unchanged.

**4.3.3 New handler `handleSwitchAccount` (contract):**
1. Guard: `token.length > 0` (always true when we reached an accept error, but assert).
2. `await signOut()` — from `useAuth()`. **Sign out FIRST**, before navigating. Rationale (load-bearing): `/auth`'s STEP-2 resume effect (`auth/index.tsx:60-70`) fires whenever `!loading && user`, so navigating to `/auth?next=` while still signed in as the wrong account would immediately bounce back to the accept page and re-fail as the same account (a loop). Signing out first makes `user` null, so `/auth` renders the sign-in screen and *captures* `next`; after the user signs in as the correct account, the resume fires.
3. Build the resume target through the ONE validator and navigate:
   - candidate relative path = `/accept-brand-invitation?token=<token>` (path prefix hardcoded; only the token value varies).
   - `safe = sanitizeNextRoute(candidate)` — REUSE `src/utils/nextRoute.ts` unchanged. The path segment `/accept-brand-invitation` is on `NEXT_ROUTE_ALLOWLIST`, so a well-formed token returns the value; a malformed/traversal value returns `null`.
   - if `safe === null` → `router.replace("/auth" as never)` (still recoverable; no unvalidated redirect).
   - else → `router.replace(`/auth?next=${encodeURIComponent(safe)}` as never)`.
   - This is byte-for-byte the resume shape the existing `handleSignIn` (:132-139) already produces — the ONLY delta is the preceding `signOut()` and the defensive `sanitizeNextRoute` guard. No new redirector is introduced; security is enforced by `sanitizeNextRoute` here AND again at `/auth` consumption.
4. Keep `handleGoHome` (:171-173) as the secondary action ("Back to Mingla").

**4.3.4 `useAuth()` additions.** The route currently destructures only `authStatus`. Add `user` and `signOut`: `const { authStatus, user, signOut } = useAuth();`. Pass `user?.email ?? null` to `<WrongAccountRecovery signedInEmail=…>` (see §4.5 limitation on the invited email).

### 4.4 `?next=` resume path (REUSED — reference only, NOT edited)

- `sanitizeNextRoute` (`nextRoute.ts:143-184`): returns the sanitized relative path or `null`; rejects arrays, schemes, `//`, `/\`, `%2e%2e`/`..` traversal on raw AND decoded forms, and anything off the allowlist. `/accept-brand-invitation` is allowlisted (:43).
- `auth/index.tsx:47` captures `sanitizeNextRoute(params.next)` on mount; `:60-70` resumes to `fromUrl ?? sanitizeNextRoute(stored)` on `!loading && user`, else `AppRoutes.home`.
- `authNextHandoff.ts` carries `next` across the OAuth round-trip (sessionStorage, consume-once, native/SSR-safe).

The recovery relies on all of this being present and correct — it was shipped and verified by ORCH-1373/1375 (COMMS-0112). We add nothing to it.

### 4.5 Component — `WrongAccountRecovery.tsx` (NEW, presentational)

- **Path:** `mingla-business/src/components/invite/WrongAccountRecovery.tsx`.
- **Props:** `{ signedInEmail: string | null; onSwitchAccount: () => void; onGoHome: () => void }`.
- **Renders** (reusing the existing `styles.card` visual language from the route — same tokens: `glass.tint.profileBase`, `radiusTokens.lg`, `spacing.*`, `textTokens.*`):
  - Title: **"Wrong account"**.
  - Body: **"This invitation was sent to a different email. Sign in with the email that received the invite."** (verbatim from the existing `invite_email_mismatch` copy).
  - Optional context line, rendered only when `signedInEmail` is non-null: **"You're signed in as {signedInEmail}."** — secondary text style.
  - **Primary** `Button` (`variant="primary"`, `size="lg"`, `fullWidth`): label **"Sign in with a different email"**, `onPress={onSwitchAccount}`.
  - **Secondary** `Button` (`variant="ghost"`, `size="lg"`, `fullWidth`): label **"Back to Mingla"**, `onPress={onGoHome}`.
- **States:** single populated state (no async inside the component; the sign-out/nav happens in the route handler). Include `accessibilityRole="button"` labels via the existing `Button` (already a11y-compliant). Buttons ≥44pt (Button `size="lg"` satisfies WCAG target size).
- **Why a separate component:** it makes the interactive recovery action fire under a lightweight render test without mounting the whole route (expo-router + auth + query mocks). Keeps the route file lean.

**Limitation — the invited email is NOT shown.** The dispatch asked to "show whose email the invite was for vs who's signed in." The web 403 body is `{ error: "invite_email_mismatch" }` and carries **no email** — the edge fn deliberately does not leak the invited address to a token holder. We therefore show only the *signed-in* email (which we own via the JWT). Showing the invited email would require an edge-fn change (out of scope) and is a minor info-disclosure trade-off. Flagged as OQ-1.

### 4.6 Cross-surface: the scanner sibling (NOT edited)

`accept-scanner-invitation.tsx` imports `ScannerInvitationServiceError` from **`scannerInvitationsService.ts`** — a *different* file from `brandInvitationsService.ts`. (The dispatch's premise that `brandInvitationsService.ts` is "also used by accept-scanner-invitation.tsx" is inaccurate; corrected here.) `scannerInvitationsService.ts:220-241` carries the **byte-identical** buggy `extractStatus`/`extractErrorCode`, so the scanner accept has the same dead-copy defect. But: it is a separate module (our fix does not touch it — no harm, no help), and `scanner_invitations` = **0 production rows** (ORCH-1374). Fixing it here would widen scope past the dispatch. **Registered as a Discovery (§10) for its own ORCH.** Net for this ORCH: the scanner path is neither improved nor regressed.

---

## 5. Success criteria

All web (Surface 3); no manual per-surface split (shared code).

- **SC-1** — When the accept edge fn returns **403 `invite_email_mismatch`**, the parsed `BrandInvitationServiceError` has `.status === 403` and `.code === "invite_email_mismatch"` (NOT 500/"server").
- **SC-2** — The accept screen for a 403 mismatch renders **"Wrong account"** copy (NOT "Something went wrong (status 500)").
- **SC-3** — Each of 404 → "Invitation not found", 410 `invite_expired` → "Invitation expired", 410 `invite_already_used` → "Already accepted", 410 `invite_revoked` → "Invitation revoked", 410 `invite_declined` → "Invitation declined", 409 `invite_currency_mismatch` → "Connect your bank first", 400 `validation` → "Invalid link", 401 `unauthenticated` → "Sign in to continue" renders its specific title (NOT the generic default).
- **SC-4** — The wrong-account screen renders a **"Sign in with a different email"** primary button AND a "Back to Mingla" secondary button.
- **SC-5** — Pressing "Sign in with a different email" calls `signOut()` and THEN navigates via `router.replace` to `/auth?next=<encoded>` where the decoded `next` equals `/accept-brand-invitation?token=<the original token>`.
- **SC-6** — The `next` target is validated: `sanitizeNextRoute("/accept-brand-invitation?token=abc")` is non-null; `sanitizeNextRoute("//evil.com")` and `sanitizeNextRoute("/accept-brand-invitation/../brand/1/payments")` are both `null` (proving the recovery routes only through the safe validator).
- **SC-7** — After signing in as the invited email, `/auth` resumes to `/accept-brand-invitation?token=…` and the accept succeeds (integration/runtime check).
- **SC-8** — A genuinely-unknown error (network `FunctionsFetchError`, or an HTTP error whose body is unparseable) renders a sane generic message and does NOT surface a raw "status 500" number to the user.
- **SC-9** — The signed-in email line appears only when `user?.email` is non-null; when null, the screen still renders (no "signed in as null").
- **SC-10** — No regression to the success path, the `signed_out` "You're invited / Sign in" screen, or the `authStatus === "error"` retry screen.

---

## 6. Invariants

**Preserved:**
- **I-1373-AUTH-TERMINAL-STATE-IS-ACTIONABLE** — the route still branches on `authStatus`, never on `isAuthReady`; the recovery adds a phase-resolved error branch, not an auth-boolean gate. Preserved by leaving the auth-axis render (`:229-285`) untouched.
- **ORCH-1375 open-redirect safety** — the recovery routes only through `sanitizeNextRoute` (the ONE validator) and `/auth`; no raw `router.replace(next)`. Verified by SC-6.
- **Consume-once `?next=` handoff** — unchanged; `/auth` owns it.
- **`FunctionsHttpError` body-read safety** — the parser uses `.clone().json()` so no other reader can be starved.

**Proposed (DRAFT — orchestrator flips ACTIVE on CLOSE):**
- **I-PROPOSED-1404-FUNCTIONS-ERROR-PARSE-CANONICAL** — any client parse of a Supabase edge-function error MUST read the HTTP status from `error.context.status` and the code from the awaited `error.context.clone().json()` body; reading `error.context.response.status` or `data.error` on a non-2xx is forbidden. Enforced by the Section-9 fails-on-revert test.
- **I-PROPOSED-1404-WRONG-ACCOUNT-RECOVERABLE** — the accept-invite wrong-account screen (403 `invite_email_mismatch`) MUST offer a switch-account action that signs out and resumes via a `sanitizeNextRoute`-validated `?next=`; it must never be a "Back to Mingla"-only dead-end.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 | 403 mismatch parse (happy) | `functions.invoke` → `{ data:null, error: FunctionsHttpError(context=Response{status:403, json→{error:"invite_email_mismatch"}}) }` | thrown `BrandInvitationServiceError` `.status===403`, `.code==="invite_email_mismatch"` | service |
| T-2 | 404 / 410 / 409 parse | same shape, statuses 404/410/409 with matching bodies | `.status`/`.code` match each | service |
| T-3 | unparseable body (error) | Response `.clone().json()` rejects | `.status` = real status, `.code === "server"` | service |
| T-4 | network error (edge) | `FunctionsFetchError` (context not a Response) | `.status===0`, `.code==="server"` → generic copy | service |
| T-5 | legacy fallback | hand-thrown `{ status:410, code:"invite_declined" }` | `.status===410`, `.code==="invite_declined"` | service |
| T-6 | wrong-account render (happy) | `<WrongAccountRecovery signedInEmail="a@b.com" …>` | "Wrong account" + "Sign in with a different email" + "Back to Mingla" + "You're signed in as a@b.com." all present | component |
| T-7 | switch-account fires (happy) | press "Sign in with a different email" | `onSwitchAccount` called once | component |
| T-8 | handler routing (happy) | `handleSwitchAccount` with token `abc123`, spies on `signOut`/`router.replace` | `signOut` called; `router.replace` called with `/auth?next=` whose decoded next `=== "/accept-brand-invitation?token=abc123"` | route/unit |
| T-9 | next validation (adversarial) | `sanitizeNextRoute` on target vs `//evil.com` and `/accept-brand-invitation/../brand/1/payments` | target non-null; both attacks `null` | util (assert reuse) |
| T-10 | null email (edge) | `signedInEmail={null}` | renders; no "signed in as" line; no crash | component |
| T-11 | non-mismatch error unaffected | `phase.code="invite_expired"` | single "Back to Mingla" card, "Invitation expired" title, NO switch button | route |
| T-12 | success path unaffected (regression) | successful accept | "You're on the team" card renders | route |

---

## 8. Implementation order

1. **Service** — add `parseFunctionsError` in `brandInvitationsService.ts`; delete `extractStatus`/`extractErrorCode`; migrate the 5 call sites to `await parseFunctionsError(error)`. Run T-1..T-5.
2. **Component** — create `WrongAccountRecovery.tsx`. Run T-6, T-7, T-10.
3. **Route** — `accept-brand-invitation.tsx`: add `unauthenticated` copy + revise `default` copy; destructure `user`/`signOut`; add `handleSwitchAccount`; branch the error render on `invite_email_mismatch`. Run T-8, T-9, T-11, T-12.
4. **Tests** — land the append-only files (Section 9); prove fails-on-revert (revert each fix, watch the matching test go red, restore).
5. **Gates** — typecheck, lint, unit suite, strict-grep/MANIFEST parity. Confirm `[deploy]` on the eventual merge.

---

## 9. Regression prevention (fails-on-revert contract)

Two NEW **append-only** test files (new files never modify the append-only gate surface):

**(A) `mingla-business/src/services/__tests__/orch_1404_functions_error_parse.tester.test.ts`**
- Structural safeguard: proves the service reads status/code from the `FunctionsHttpError` shape.
- The load-bearing assertion (T-1): a simulated `FunctionsHttpError` with `context.status = 403` and body `{ error: "invite_email_mismatch" }`, fed through `acceptBrandInvitation` (with `supabase.functions.invoke` mocked to return `{ data: null, error }`), throws a `BrandInvitationServiceError` with `.status === 403` and `.code === "invite_email_mismatch"`.
- **Fails on revert:** the old `extractStatus` returns 500 and `extractErrorCode` returns "server" → the assertion `.status === 403` FAILS. Restoring the parser makes it PASS. Include T-2..T-5 for breadth.
- Protective comment: cite ORCH-1404 F-2, the `error.context.status` truth (`FunctionsClient.js:266` / `types.js:14-17`), and "do not revert to `context.response.status` / `data.error`".

**(B) `mingla-business/src/components/invite/__tests__/orch_1404_wrong_account_recovery.tester.test.tsx`** (+ a routing assertion, see below)
- Proves the wrong-account screen exposes the switch-account action and routes to a `sanitizeNextRoute`-validated target.
- T-6/T-7: render `WrongAccountRecovery`, assert the "Sign in with a different email" button exists and firing it calls `onSwitchAccount`.
- T-8 (routing): exercise the `handleSwitchAccount` construction (extract the target-building step as a tiny pure exported helper if a full-route render is impractical under the harness, e.g. `buildSwitchAccountResume(token)` → `/auth?next=…`, so the assertion is deterministic). Assert `signOut` runs before `router.replace`, and the decoded `next` equals `/accept-brand-invitation?token=<token>`.
- T-9: assert `sanitizeNextRoute` accepts the target and rejects `//evil.com` and the `..` traversal variant — proving the recovery reuses the safe validator, not a raw redirect.
- **Fails on revert:** the pre-1404 route renders only "Back to Mingla" for a mismatch → `getByText("Sign in with a different email")` throws → the test FAILS. Restoring the recovery makes it PASS.
- Protective comment: cite ORCH-1404 F-1 (dead-end), I-PROPOSED-1404-WRONG-ACCOUNT-RECOVERABLE, and "the mismatch screen must never be Back-only".

Both files are NEW (append-only). No existing test is modified. If any existing byte-frozen copy test asserts the *old* generic-500 default string, it must be located first — none was found for this route (the frozen invite tests are `orch-1329-invite-email.*` for the email, not the accept page), so no test edit is expected; if one surfaces, STOP-AND-AMEND rather than silently rewrite it.

---

## 10. Open questions (Seth decides)

- **OQ-1 (copy/UX):** Confirm the wrong-account screen shows only the *signed-in* email ("You're signed in as {email}."), NOT the invited email (the web 403 doesn't carry it; showing it needs an out-of-scope edge-fn change and leaks the invited address to a token holder). Proposed: show signed-in email only. **Default if no answer: signed-in only.**
- **OQ-2 (copy):** Exact label for the primary recovery button. Proposed: **"Sign in with a different email"**. Alternatives: "Switch account", "Use a different account".
- **OQ-3 (copy):** The generic `default` error copy — drop the raw "(status N)" number for users? Proposed: **"Something went wrong / We couldn't accept this invitation right now. Try again in a moment."** (no number). **Default if no answer: drop the number.**
- **OQ-4 (copy):** `unauthenticated` (401) copy + whether that screen should also offer a plain "Sign in" action (no sign-out, since they're effectively signed out) routing to `/auth?next=<accept>`. Proposed: yes, reuse the same resume, minus the `signOut`. Low frequency; can ship copy-only and defer the action. **Default: copy-only for 401 this pass.**
- **OQ-5 (discovery routing):** Register the scanner-service parse bug (`scannerInvitationsService.ts:220-241`, identical to F-2) and the currency-mismatch bank-link recovery as follow-up ORCHs? Recommended: yes.

---

## 11. Downstream routing

**Next = mingla-implementor** (this SPEC + the ORCH-1400-1403 investigation are the inputs).

- **Working tree:** `~/Desktop/mingla-orchs/ORCH-1404-[accept-invite-web-error-recovery]/` on branch `ORCH-1404-accept-invite-web-error-recovery`. Rebase on `origin/main` before work.
- **Allowlist (may modify):**
  - `mingla-business/src/services/brandInvitationsService.ts`
  - `mingla-business/app/accept-brand-invitation.tsx`
  - `mingla-business/src/components/invite/WrongAccountRecovery.tsx` (NEW)
  - `mingla-business/src/services/__tests__/orch_1404_functions_error_parse.tester.test.ts` (NEW)
  - `mingla-business/src/components/invite/__tests__/orch_1404_wrong_account_recovery.tester.test.tsx` (NEW)
- **DO-NOT-TOUCH:** `supabase/**`, `src/utils/authReadiness.ts`, `src/utils/nextRoute.ts`, `src/utils/authNextHandoff.ts`, `src/utils/coldLoadAuthGates.ts`, `app/auth/index.tsx`, `src/services/scannerInvitationsService.ts`, `app/accept-scanner-invitation.tsx`, `app/accept-brand-invitation/success.tsx`, the invite-email templates. Anything outside the allowlist = **STOP-AND-AMEND** (append here or `SPEC_AMENDMENT_ORCH-1404_*.md`), never silently widen.
- **Deploy:** merge commit carries `[deploy]` (Vercel web rebuild).
- Then → mingla-tester (verify SC-1..SC-10 + fails-on-revert on both test files, web) → orchestrator CLOSE (flip the two DRAFT invariants ACTIVE; register OQ-5 discoveries).
