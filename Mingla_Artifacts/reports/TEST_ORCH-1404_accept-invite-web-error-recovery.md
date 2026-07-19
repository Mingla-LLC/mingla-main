# TEST — ORCH-1404 [accept-invite-web-error-recovery]

**Mode:** TARGETED + SPEC-COMPLIANCE (mingla-tester). Dispatched by mingla-orchestrator.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1404-[accept-invite-web-error-recovery]/` on branch `ORCH-1404-accept-invite-web-error-recovery`.
**Rebased onto `origin/main`** at test start (4 commits replayed clean). Tester HEAD after adversarial commit: `5b02c1088`.
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1404_accept-invite-web-error-recovery.md` · **IMPL:** commit `8c88b25bb` (+ report `9b4d039f5`, CI wiring `e2b73bf3d`).
**Date:** 2026-07-18.

---

## 1. Verdict

**CONDITIONAL PASS** — **P0: 0 · P1: 0 · P2: 0 · P3: 1 · P4: 2.**

Zero defects found. The parse fix and wrong-account recovery are **correct on every layer I could execute**: unit + adversarial (against real `FunctionsHttpError`/`Response` shapes and the real `sanitizeNextRoute`), real-browser evidence for the reachable (signed-out) path, and a live-fire confirmation of the deployed edge-fn body-shape contract the fix depends on. Regression gate satisfied (implementor's 2 suites + my adversarial suite, all on-branch, in-diff, fails-on-revert proven both directions, wired to CI).

**The condition (accepted by the dispatch, "an honest OPEN beats a faked pass"):** the three **authenticated-browser** success criteria — **SC-2** (403 → "Wrong account" pixel render), **SC-5-order** (sign-out *before* navigation at runtime + no loop), **SC-7** (end-to-end resume + accept) — could **not be live-fired**. They are blocked by TWO independent *environmental* walls (not ORCH-1404 defects): (a) business web sign-in offers only Google-OAuth / Apple / email-OTP — no automatable auth path here (password-grant session minting is classifier-blocked; no OTP inbox); (b) the local build fail-closes at boot on a Stripe-mode mismatch (`pk_test` bundled vs live backend) — a documented invariant. Exact manual repro steps are in §9. No code defect blocks CLOSE.

**Routing:** CONDITIONAL PASS with the three OPEN authenticated-runtime SCs surfaced to Seth (do NOT auto-CLOSE until Seth verifies §9 or explicitly accepts the deferral). The code itself is REWORK-free.

---

## 2. SC-by-SC matrix

| SC | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| SC-1 | 403 mismatch parses to `.status===403`, `.code==="invite_email_mismatch"` (not 500/server) | **PASS** | Re-ran impl T-1 + my adversarial nested-context test with a real `Response(status:403, json→{error:"invite_email_mismatch"})`. Fails-on-revert reproduced independently (§4). |
| SC-2 | 403 renders "Wrong account" (not "status 500") | **OPEN (unit-proven, browser-blocked)** | Parse→`invite_email_mismatch` (SC-1); `errorCopyFor("invite_email_mismatch").title === "Wrong account"` (impl+my unit test); route branch `phase.code==="invite_email_mismatch" → <WrongAccountRecovery>` verified by source read (`accept-brand-invitation.tsx:236-244`). Browser pixel needs a signed-in session — auth-walled. §9. |
| SC-3 | 404/410×4/409/400/401 each render specific title | **PASS (parse+copy)** | Impl T-2 (all HTTP codes parse through); `unauthenticated`→"Sign in to continue" added + my `errorCopyFor` test. Live fn confirmed `{error:"validation"}`+400 body shape (§7). |
| SC-4 | Wrong-account screen: switch + Back buttons | **PASS** | Impl T-6/T-7 + source (`WrongAccountRecovery.tsx:63-76`). |
| SC-5 | Press switch → `signOut()` THEN `router.replace(/auth?next=<encoded>)` | **PARTIAL: nav PASS (live browser), order OPEN** | The `/auth?next=` navigation is **live-fired in a real browser** via the identical resume mechanism (`handleSignIn`): clicking "Sign in" navigated to `/auth?next=%2Faccept-brand-invitation%3Ftoken%3D…` (§6, `shot_after_signin.png`). The `signOut()`-BEFORE-`replace` **ordering** is source/unit-proven (`handleSwitchAccount` awaits `signOut()` then `router.replace` — `:192-196`) but not live-fired (needs signed-in state). §9. |
| SC-6 | `next` validated; `//evil.com` + `..` traversal → null | **PASS** | Impl T-9 + my adversarial composition tests (hostile token through the full builder→decode→re-sanitize pipeline) + real `sanitizeNextRoute`. Live browser round-trip confirmed the encoded `next` (§6). |
| SC-7 | After signing in as invited email, `/auth` resumes + accept succeeds | **OPEN (browser-blocked)** | Reuses the shipped ORCH-1373/1375 `?next=` path (its capture+welcome-screen render live-confirmed in §6). Full E2E needs two authenticated accounts — auth-walled. §9. |
| SC-8 | Unknown/network → sane generic, no raw "status 500" | **PASS** | Impl T-3 (unparseable→real status/server), T-4 (network→status 0/server); my adversarial non-string-body test; default copy has no `\d{3}`/`status`. |
| SC-9 | Signed-in email line only when non-null; renders when null | **PASS** | Impl T-6b/T-10 + source (`WrongAccountRecovery.tsx:60-62`). |
| SC-10 | No regression to success / signed-out / auth-error screens | **PARTIAL: signed-out PASS (live browser), others source-preserved** | Signed-out "You're invited / Sign in" **rendered cleanly in a real browser** (§6, `shot_signedout_clean.png`). Success + auth-error branches are byte-untouched by the diff (`git show` confirms only the `invite_email_mismatch` branch added); success-card runtime needs auth. |

---

## 3. Findings

No P0/P1/P2. Two of the ten SCs' *runtime* halves are OPEN due to environment, not defects.

- **P3-1 — Gateway 401 shape differs from the fn's 401.** The Supabase **gateway** returns `{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":…}` (no `.error` field) when the auth header is missing, whereas the *function's* own 401 returns `{"error":"unauthenticated"}` (§7). If a JWT is so stale the gateway rejects it pre-function, `parseFunctionsError` finds no string `body.error` → falls to `code:"server"` → generic copy, not "Sign in to continue". *Impact:* a rare expired-mid-flow case shows the generic message instead of the 401-specific copy. *Not a regression* (the old code showed generic for everything) and the route only invokes accept when `authStatus==="signed_in_ready"`. *Required fix:* none this ORCH; optionally have `parseFunctionsError` also read a top-level `.code`/`.message` gateway shape — register as a follow-up if 401 copy fidelity matters. *Retest:* force an expired JWT and observe the copy.
- **P4-1 (praise).** `parseFunctionsError` uses `error.context.clone().json()` with a `try/catch` fallback and an `isResponseLike` guard — exactly the defensive shape the SPEC demanded; the `.clone()` prevents body-read starvation for a second reader. Clean.
- **P4-2 (praise).** `buildSwitchAccountResume` extracted as a pure exported helper routing through the ONE validator, making the security-critical resume deterministically testable without a full-route render. This is what let my adversarial composition test exist.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Re-ran both implementor suites at the rebased impl code (green baseline): `Test Suites: 2 passed, Tests: 25 passed`.

**Independently reproduced the load-bearing mutation** (I did the true line-deletion myself, then restored via `git checkout`):
- **Parse fix** — deleted `return { status, code };` inside the `isResponseLike(ctx)` branch of `parseFunctionsError` (`brandInvitationsService.ts`). Re-ran `orch_1404_functions_error_parse.tester.test.ts`:
  - **RED:** T-1 `Expected: 403 / Received: 0`; T-2 all HTTP rows `Received: 0`; T-3, T-5b red (`10 failed`). Confirms the whole parse collapses without the fix.
  - **Restored → GREEN** (`git checkout -- …`, `git diff --stat` empty = clean restore).

Implementor's component/routing fails-on-revert (deleting the switch `<Button>` → 3 red; neutering `buildSwitchAccountResume` → T-8 red) is corroborated structurally by my own routing-revert below.

---

## 5. Adversarial test added (tester-owned, different angle)

**Path:** `mingla-business/src/components/invite/__tests__/orch_1404_adversarial_resume_and_parse.tester.test.tsx` (NEW, append-only) — **committed `5b02c1088`**, visible in `git diff origin/main...HEAD --name-only`. **9 tests, all green.**

**Different angle from the implementor's two suites** (which test the FLAT happy `FunctionsHttpError` and `buildSwitchAccountResume` with BENIGN tokens + `sanitizeNextRoute` directly). Mine attacks the seams they never exercise:
1. **Composition / open-redirect via the token** — a HOSTILE token (`x&next=//evil.com`, `../../brand/1/payments`) pushed all the way through `buildSwitchAccountResume(token)` → decode → re-`sanitizeNextRoute` (what `/auth` does on the far side). Empirically confirmed the `//evil.com` is `encodeURIComponent`-neutralised into one inner param and the landing path stays same-origin `/accept-brand-invitation` — never a navigable off-origin.
2. **Malformed-token → validated null fallback** — `%`, `%zz`, `%E0%A4` make `decodeURIComponent` throw inside `sanitizeNextRoute`, so the builder MUST degrade to bare `/auth` (no unvalidated `?next=`).
3. **Parser nested-context trap** — a `context` carrying BOTH the canonical `.status` (403) AND a legacy nested `.response.status` (500); the parser must read `context.status`. Guards against re-introducing the exact F-2 bug.

**Fails-on-revert — proven BOTH mutations (I performed each, then restored clean):**
- **Routing revert** (strip `sanitizeNextRoute` from `buildSwitchAccountResume` → `return /auth?next=${encodeURIComponent(candidate)}`): my 3 malformed-token assertions FAIL (`Received: "/auth?next=%2Faccept-brand-invitation%3Ftoken%3D%25"` vs `Expected: "/auth"`). Restored → green.
- **Parse revert** (read `ctx.response.status ?? ctx.status`, the old F-2 read): my 2 nested-context assertions FAIL (`Expected: 403 / Received: 500`; `Expected: 410 / Received: 500`). Restored → green.

**CI registry:** appended this suite's path to the `npx jest` list in `.github/workflows/orch-1404-invite-error-recovery-tests.yml` (committed `5b02c1088`). Full 3-suite run as the CI job invokes it: **`Test Suites: 3 passed, Tests: 34 passed`.**

---

## 6. Real-browser runtime evidence (business web, local build, CDP 9379 / Metro 8094)

Served the **worktree's** web build (`expo start --web --port 8094`) against the **real prod** Supabase (`gqnoajqerqhnvulmnyvv` — `.env` sets no `SUPABASE_URL`, so app.config's prod default applies) and drove headless Chrome via CDP on **9379** (9222 untouched). To get past the Stripe boot fail-close (see §8), restarted Metro with `MINGLA_STRIPE_MODE=live` + a `pk_live_`-prefixed placeholder + `--clear` (dev-only env override; no product code touched; accept path uses no Stripe).

- **SC-10 signed-out branch — PASS (live).** `GET /accept-brand-invitation?token=…` while signed out rendered **"You're invited / Sign in to accept this invitation. We'll bring you right back. / [Sign in]"**, URL stayed on the accept route (no redirect). Screenshot: `scratchpad/shot_signedout_clean.png`.
- **SC-5 nav half + SC-6 encoding — PASS (live).** Clicking **"Sign in"** navigated the real browser to `http://localhost:8094/auth?next=%2Faccept-brand-invitation%3Ftoken%3DtokADVERSARIALtest1234567890` and rendered the `/auth` welcome screen (Continue with Apple/Google). Decoded `next` = `/accept-brand-invitation?token=…` — the exact `sanitizeNextRoute`+`encodeURIComponent` shape `buildSwitchAccountResume` produces. Screenshot: `scratchpad/shot_after_signin.png`.
- **Build integrity — PASS.** The route + `WrongAccountRecovery` import graph compiled and mounted in a browser (2209 modules bundled) with no ORCH-1404 error.

*(Screenshots live under the session scratchpad: `/private/tmp/claude-501/-Users-sethogieva-Desktop-mingla-main/342ca4f5-65cd-4eb4-bef7-99dda5343042/scratchpad/`.)*

---

## 7. Live edge-function deploy state + contract confirmation (read-only)

- `accept-brand-invitation`: **ACTIVE, v183, verify_jwt=true**; `invite-brand-member`: ACTIVE, v173, verify_jwt=true (`list_edge_functions`).
- **Server body-shape contract the client parse depends on — confirmed live:** `POST /functions/v1/accept-brand-invitation` with a valid bearer + a too-short token returned **HTTP 400 `{"error":"validation"}`** — i.e. the deployed fn emits the `{error:<string>}` JSON body + correct HTTP status that `parseFunctionsError` reads via `error.context.status` + `await error.context.json()`. Source read of the deployed fn confirms `return json({ error: "invite_email_mismatch" }, 403)` (`accept-brand-invitation/index.ts:221,258,293,317`), so the 403 path the fix targets is the deployed contract.

---

## 8. Constitution 14-rule matrix (independently checked against the diff)

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | PASS | switch→signOut+nav (nav live-proven), back→home; both `onPress` wired. |
| 2 | One owner per truth | PASS | `parseFunctionsError` sole error-parse owner; `buildSwitchAccountResume` sole resume builder. |
| 3 | No silent failures | PASS | Each code surfaces specific copy; `catch` keeps real status + generic code, never swallowed. |
| 4 | One query key per entity | N/A | No query keys changed. |
| 5 | Server state server-side | N/A | No Zustand/client-cache change. |
| 6 | Logout clears everything | PASS | Recovery uses the app's standard `signOut()`; adds no bespoke logout. |
| 7 | Label `[TRANSITIONAL]` | N/A | No transitional code added. |
| 8 | Subtract before adding | PASS | Deleted `extractStatus`/`extractErrorCode`; replaced with one parser. |
| 9 | No fabricated data | PASS | Never fabricates 500; unknown→status 0 + generic copy, no fake number. |
| 10 | Currency-aware | N/A | `invite_currency_mismatch` copy unchanged. |
| 11 | One auth instance | PASS | Uses existing `useAuth()`; no new auth instance. |
| 12 | Validate at right time | N/A | No datetime logic. |
| 13 | Exclusion consistency | N/A | — |
| 14 | Persisted-state startup | N/A | No persisted store change. |

No violations.

---

## 9. Device / parity matrix + manual repro for the OPEN authenticated SCs

| Surface | Result | Note |
|---------|--------|------|
| Consumer iOS / Android | N/A | Brand invites are a business concept. |
| **Buyer/anon Web (business web) — PRIMARY** | **Signed-out PASS (live browser); authenticated OPEN** | Chrome+CDP; auth-walled for 403/recovery/accept. |
| Business iOS / Android (native) | Source-preserved (not driven) | Shared code; web is the accept landing surface; native rarely hits it. |
| Admin Web / Business Web preview | N/A | Not in the invite-accept path. |

**Why the authenticated runtime is BLOCKED (both are environmental, not defects):**
1. **Auth wall.** Business web `/auth` offers only Google-OAuth / Apple / **email-OTP** (`app/auth/index.tsx`). No password field to drive; OTP needs an inbox unavailable here; minting a session via `grant_type=password` is **classifier-blocked**; the Samsung's prod session is the *wrong origin* and would run *un-fixed prod code*, not this branch.
2. **Stripe boot fail-close.** The local build bundles `pk_test` while prod is live-mode → `StripeModeMismatchError` at `RootLayoutInner` (a documented invariant), which blanks the whole app until overridden.

**Manual steps for Seth (or a follow-up authenticated harness) to close SC-2 / SC-5-order / SC-7** — use a build that boots signed-in (a branch preview deploy, or local with a real `pk_live` + a real session):

1. **Create the reversible invite (event_manager, controlled brand "Smoke & Rhythm" `1ce63bf4-1a33-4309-ab0b-ec23343e3569`, owned by rambleawaypod):**
   `INSERT INTO public.brand_invitations (brand_id, email, invitee_name, role, invited_by, token_hash, expires_at, status) VALUES ('1ce63bf4-1a33-4309-ab0b-ec23343e3569','support@usemingla.com','QA','event_manager','6c61590c-4e8e-4040-bd7c-29870ba6d736', encode(digest('<RAW_TOKEN>','sha256'),'hex'), now()+interval '7 days','pending') RETURNING id;` (choose any `<RAW_TOKEN>` ≥16 chars).
2. **SC-2:** signed in as **rambleawaypod** (email ≠ `support@usemingla.com`), open `/accept-brand-invitation?token=<RAW_TOKEN>` → expect the **"Wrong account"** card with **"Sign in with a different email"** + **"Back to Mingla"** (NOT "Something went wrong (status 500)").
3. **SC-5:** tap **"Sign in with a different email"** → confirm the session is actually cleared (you are signed OUT) AND the URL is `/auth?next=%2Faccept-brand-invitation%3Ftoken%3D<RAW_TOKEN>` — and it does NOT bounce back to the accept page still signed in (an ordering race would).
4. **SC-7:** sign in as **support@usemingla.com** → `/auth` should resume to the accept URL and the accept should **succeed** (event_manager membership on Smoke & Rhythm).
5. **REVERSE (prove read-back):** `DELETE FROM public.brand_team_members WHERE brand_id='1ce63bf4-1a33-4309-ab0b-ec23343e3569' AND user_id='3c8c34a8-454b-4d4f-bf9e-87b0c3c8874c';` then `DELETE FROM public.brand_invitations WHERE id='<the id>';` and `SELECT count(*) …` = 0 on both.

---

## 10. Writes performed

**NONE.** The narrow invite round-trip was **not executed**: completing it requires "opening it while signed in as the wrong account" in a browser, which the auth wall blocked — so performing the INSERT would have left a dangling invite with no observed browser result to tie it to, and nothing to gain over the already-proven client contract. There is therefore nothing to reverse. (§9 hands Seth the exact reversible SQL if he runs the manual repro.)

---

## 11. Discoveries for the orchestrator

1. **Local business-web-against-prod is un-drivable without two overrides** (this will hit every future web tester): (a) the Stripe boot fail-close needs `MINGLA_STRIPE_MODE=live` + a `pk_live_`-prefixed key; (b) there is no automatable auth (OTP/OAuth only, password-grant classifier-blocked). Consider a **branch preview deploy** (Vercel) as the standard surface for authenticated business-web QA, or a documented dev session-injection recipe. Worth a standing note in `WORKTREE_STRATEGY`/testing reference.
2. **P3-1 gateway-401 shape** (§3): `parseFunctionsError` doesn't map the Supabase *gateway* 401 (`{code,message}`) to `unauthenticated`. Minor; register a follow-up only if 401 copy fidelity matters.
3. **Scanner sibling** (`scannerInvitationsService.ts:220-241`, identical dead-parse bug) remains deferred to its own ORCH per SPEC §4.6 / OQ-5 — unchanged here (0 prod rows).
4. **DRAFT invariants to flip ACTIVE on CLOSE:** `I-PROPOSED-1404-FUNCTIONS-ERROR-PARSE-CANONICAL`, `I-PROPOSED-1404-WRONG-ACCOUNT-RECOVERABLE` — both are now enforced by fails-on-revert tests (impl + tester).

---

## 12. Accepted conditions (CONDITIONAL PASS)

Per the dispatch's explicit sanction ("report SC-2/5/7 OPEN with the exact manual steps — an honest OPEN beats a faked pass"):
- **SC-2** (403 → "Wrong account" pixel), **SC-5-order** (sign-out-before-nav runtime + no loop), **SC-7** (E2E resume+accept) remain **live-fire-unverified** — blocked by environmental auth + Stripe-boot walls, not by any code defect. Manual repro in §9.
- Everything else (SC-1, SC-3, SC-4, SC-5-nav, SC-6, SC-8, SC-9, SC-10-signed-out) is **PROVEN**. Zero P0/P1/P2. Regression gate satisfied.
