# IMPLEMENTATION — ORCH-1220 [business-reviewer-bypass]

App-Store / Play reviewer email-login bypass for the BUSINESS app. The reviewer
signs in with the fixed reviewer email + a secret code (no email is ever sent);
a server-side edge function mints a real Supabase session for the LOCKED reviewer
account only. Mechanism was proven live by the orchestrator and replicated here
exactly; this implementation hardens it securely.

Branch: `1220-business-reviewer-bypass`
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/1220-[business-reviewer-bypass]/`

---

## Files changed

| File | Change |
|---|---|
| `supabase/functions/reviewer-signin/index.ts` | **NEW** — public edge fn (verify_jwt=false) gated by secret code; mints reviewer session |
| `supabase/config.toml` | Registered `[functions.reviewer-signin] verify_jwt = false` |
| `mingla-business/src/context/AuthContext.tsx` | Reviewer routing in send-code + verify paths (surgical) |
| `.github/scripts/strict-grep/orch-1220-reviewer-bypass-locked.mjs` | **NEW** — CI regression gate |
| `.github/workflows/strict-grep-mingla-business.yml` | Wired the gate as job `orch-1220-reviewer-bypass-locked` |
| `mingla-business/src/context/__tests__/authContext.reviewerBypass.orch1220.test.ts` | **NEW** — jest defense-in-depth (7 tests) |

---

## Deliverable 1 — edge function

`supabase/functions/reviewer-signin/index.ts`

Flow (replicates the proven mechanism exactly):
1. service-role `admin.generateLink({ type: "magiclink", email: REVIEWER_EMAIL })`
   → `properties.email_otp` with NO email sent.
2. `POST {SUPABASE_URL}/auth/v1/verify` (type `email`, email + otp, `apikey` = anon)
   → real session `{ access_token, refresh_token }`, returned to the client.

Config read from env (nothing secret hardcoded): `REVIEWER_EMAIL`,
`REVIEWER_BYPASS_CODE`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_ANON_KEY`. Missing config → generic 500 (never silently degrades to an
open endpoint). CORS via shared `_shared/cors.ts`. Header comment cites ORCH-1220
+ reviewer-only intent. No tokens / code / which-field-failed ever logged.

## Deliverable 2 — AuthContext routing (`mingla-business/src/context/AuthContext.tsx`)

Added a non-secret routing constant near the top:

```ts
const REVIEWER_EMAIL = "appreview@usemingla.com";
const isReviewerEmail = (email: string): boolean =>
  email.trim().toLowerCase() === REVIEWER_EMAIL;
```

- **send-code path** (`signInWithEmail`): if `isReviewerEmail(trimmed)`, return
  `{ error: null }` BEFORE `supabase.auth.signInWithOtp(...)` — no stray email is
  sent and the UI advances to the code-entry screen. Non-reviewer emails unchanged.
- **verify path** (`verifyEmailOtp`): if `isReviewerEmail(trimmedEmail)` (placed
  BEFORE the `^\d{6}$` guard, since the bypass code is not a 6-digit OTP), call
  `supabase.functions.invoke("reviewer-signin", { body: { email, code } })`, then
  `await supabase.auth.setSession({ access_token, refresh_token })`. On function
  error / missing tokens / setSession error / thrown exception, return the SAME
  "That code didn't match or has expired. Try again." copy as a normal wrong OTP.
  Non-reviewer emails take the unchanged `verifyOtp` path.

No refactor of the auth context; all existing non-reviewer behavior preserved.
`tsc --noEmit` over `mingla-business` is clean for these files (only pre-existing,
unrelated `packages/phone-input` module-resolution errors remain; tsc exit 0).

## Security analysis — why this is NOT an open "log in as anyone" oracle

1. **Two-factor gate, both required.** The function returns a generic
   `401 { error: "invalid" }` unless `email` (lowercased/trimmed) EXACTLY equals
   env `REVIEWER_EMAIL` **AND** `code` EXACTLY equals env `REVIEWER_BYPASS_CODE`.
2. **Constant-time code compare.** `timingSafeEqual` folds the length difference
   into a single XOR accumulator and iterates the longer buffer, so neither the
   matched-prefix length nor the code length leaks via response timing.
3. **generateLink is anchored to the env reviewer email — never the caller's.**
   `admin.generateLink({ email: reviewerEmail })` uses the server-side env value,
   not the request body. Even if the secret code leaked, an attacker could ONLY
   ever mint a session for the one configured reviewer account — never an
   arbitrary user. The caller-supplied `email` is used solely in the equality gate.
4. **Useless without the secret.** No valid session is possible without
   `REVIEWER_BYPASS_CODE`, which lives only in Supabase function secrets.
5. **No information leak.** A single generic 401 never reveals which field failed;
   a failed bypass on the client surfaces the identical wrong-OTP copy, so the
   bypass is indistinguishable from a wrong-code attempt to anyone without the secret.
6. **No secret literals in source.** Only the public reviewer ADDRESS appears in
   source (a routing target, not a credential).

## Deliverable 3 — regression guard (CI-enforced)

Gate: `.github/scripts/strict-grep/orch-1220-reviewer-bypass-locked.mjs`
(invariant `I-PROPOSED-1220-REVIEWER-BYPASS-LOCKED`), wired into
`.github/workflows/strict-grep-mingla-business.yml` as job
`orch-1220-reviewer-bypass-locked` (self-test step + live step, matching the
1216/1219 pattern). It asserts:

- (a) `reviewer-signin/index.ts` reads `REVIEWER_EMAIL` + `REVIEWER_BYPASS_CODE`
  from `Deno.env`, uses `timingSafeEqual` for the code, and passes the env
  `reviewerEmail` variable (never a caller-supplied email) into `generateLink`.
- (b) `AuthContext.tsx` defines `REVIEWER_EMAIL = 'appreview@usemingla.com'`
  (exactly one literal), invokes `reviewer-signin`, and gates that invoke behind
  `isReviewerEmail(...)` (guard appears before the invoke in source order).

PASS proof (run from worktree root):
- `node ...orch-1220-reviewer-bypass-locked.mjs --self-test` → PASS (7/7 cases)
- `node ...orch-1220-reviewer-bypass-locked.mjs` → PASS (live)
- jest: `authContext.reviewerBypass.orch1220` → 7/7 PASS

FAIL-on-revert proof: see "Fails-on-revert" below.

A jest defense-in-depth test is also added
(`authContext.reviewerBypass.orch1220.test.ts`, 7 tests, all green) — but per
project memory business jest is NOT a blocking CI job, so the strict-grep gate is
the protection of record.

---

## Env vars the orchestrator MUST set (Supabase function secrets)

- `REVIEWER_EMAIL` = `appreview@usemingla.com`
- `REVIEWER_BYPASS_CODE` = (a strong secret of the orchestrator's choosing — this
  is what the reviewer enters in the 6-digit code field; it need NOT be 6 digits)

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` are already
present on the platform.

---

## Commit(s) on branch `1220-business-reviewer-bypass`

- `f989373ab` — ORCH-1220 implementation (all 6 deliverable files + this report).
  A trailing docs-only commit then pins the final branch HEAD (see below); both
  carry the identical code. Gate is GREEN on both.

## Fails-on-revert (cited hash)

- `819c1dd6b1db546c392789d8dd2dc400c109ab16` — temporary revert that makes
  `generateLink` use the caller-supplied `email` instead of the locked
  `reviewerEmail`. The gate fails RED on it:

  ```
  ORCH-1220 ... FAIL — ... lost a load-bearing security property ...
    supabase/functions/reviewer-signin/index.ts: missing/violated —
    passes the env reviewerEmail (NOT a caller-supplied email) into generateLink
  GATE_EXIT=1
  ```

  This commit was `git reset --hard` away immediately after (it survives only in
  reflog as proof); branch HEAD is the passing implementation `480079930`, on
  which the gate is GREEN (exit 0).
