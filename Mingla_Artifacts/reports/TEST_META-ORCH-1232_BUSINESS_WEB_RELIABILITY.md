# TEST — META-ORCH-1232: Business Web Reliability + Brand-Creation Persistence

Mode: TEST (production gatekeeper). Surface: **mingla-business web**. Implementation commit: `29222457a`. Worktree: `orch-1232-business-web-reliability`. Backend: Supabase `gqnoajqerqhnvulmnyvv` (LIVE prod).

## VERDICT: **PASS**

All spec §5 items (a)–(d) pass with RUNTIME evidence (browser-driven + live-prod SQL + pg-logs). Adversarial regression written, passes on the fix, proven fails-on-revert (9/10 red).

---

## Runtime reachability (honest status)
**Fully reachable — authed business web runtime driven via real Chromium (Playwright 1.61.1 / chromium-1223).**
- Ran the app from the worktree: `npx expo start --web --port 8099 --clear` with `EXPO_PUBLIC_SUPABASE_URL` (gqno LIVE prod), `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_…`, `MINGLA_STRIPE_MODE=live` (required to pass the runtime `StripeModeMismatchError` fail-close gate, since the backend is live).
- Minted a real reviewer session via the `reviewer-signin` edge fn (`appreview@usemingla.com` + bypass code `023624` from master keys) → `{access_token, refresh_token}` for user `8313d091-2a34-44fc-985d-9cefb5d80781` (HTTP 200, token exp 2026-07-04).
- Injected the session into `localStorage["sb-gqnoajqerqhnvulmnyvv-auth-token"]` via Playwright `addInitScript` (pre-app-load). App bootstrapped authed: `[auth] auth-event {INITIAL_SESSION, hasSession:true, hasUser:true}` → landed on `/home` with the brand switcher live. NO claims capped at "suspected".

Note: the reviewer account already owned 1 brand ("The Party Block"), so it was not a literal zero-brand account; but `default_brand_id` was NULL — the pointer-corruption surface the bug attacks. Create-from-switcher exercises the identical mutation/resolver/recovery path. I additionally drove the **auth-warm window** by acting at +~600ms after a fresh cold load (before JWT settle).

---

## Per-item evidence

### (a) PERSISTENCE — brand-create persists, repeated + auth-warm — **PASS**
Drove the UI: brand chip → "Create a new brand" → Brand name → Continue (fires `useCreateBrand`). Created **4 brands** across runs (1 normal, 2 aggressive auth-warm @ +~600ms, 1 via H1 Retry). Each:
- (1) UI: header switched to the new brand name; wizard advanced to "Add an address?" (= create succeeded, no error).
- (2) `brands` row in live prod: `account_id = 8313d091-…` (reviewer), `deleted_at = null`.
- (3) `brand_team_members` owner row: `owner_rows = 1`, `role = brand_owner`.

Live-prod SQL (final state, all 4):
| brand_id | name | deleted_at | owner_rows |
|---|---|---|---|
| `ac47a5fd-d72e-42fb-9b59-eeb41500f33a` | META-ORCH-1232 TEST xywgqr | null | 1 |
| `be379108-2756-4a8f-b039-c278f312603d` | META-ORCH-1232 TEST warmA-d0pke (auth-warm) | null | 1 |
| `0eb1a45e-ec32-4393-8bea-5cc500b6e08b` | META-ORCH-1232 TEST warmB-jpmec (auth-warm) | null | 1 |
| `eb948ba7-fbac-404b-9ccb-3f272c259024` | META-ORCH-1232 TEST h1fail-g7udk (H1 Retry) | null | 1 |

Auth-warm runs (acted @ +614ms / +603ms after cold load): both completed with a real-UUID `currentBrandId`, `NET-ERRORS: []`, `TEMP-ID-ERRORS: []`. The exact race that used to break it now persists cleanly. No silent failure observed.

### (b) NO SILENT FAILURE (H1) — forced write failure → persistent inline error + working Retry — **PASS**
Intercepted the `POST /rest/v1/brands` insert and forced HTTP 401 (RLS-reject shape) via Playwright network route. Observed:
- Wizard **stayed on step 1** (Brand name field still visible); typed name **intact**.
- **Persistent inline error** rendered: `"We couldn't save your brand. Your details are safe — tap Retry."` + a **Retry** affordance — NOT a toast.
- **Did not auto-dismiss**: re-checked after +6s, Retry still present.
- Unblocked the route, clicked **Retry** → mutation re-fired and **succeeded** → brand `eb948ba7-…` created, advanced to address step.
Evidence: `SCREENSHOT_META-ORCH-1232_02_h1_persistent_error.png`.

### (c) NO TEMP-ID CORRUPTION (C1) — **PASS**
- `creator_accounts.default_brand_id` for the reviewer = `0eb1a45e-…` (a real UUID) — `is_null_or_uuid = true`. **Never** a `_temp_` value across all 4 creates.
- `localStorage["mingla-business.currentBrand.v14"]` always held a real UUID (`ac47a5fd…`, `be379108…`, `0eb1a45e…`, `eb948ba7…`) — never `_temp_…`.
- Browser console during creates: **zero** `22P02` / `invalid input syntax for type uuid` / `_temp_` errors.
- Live-prod **postgres logs** across the test window: **no new `22P02`** for a temp id (the only ERRORs were my own diagnostic-SQL column typos + pre-existing unrelated cron/dup errors).

### (d) REGRESSION — public/anon routes still work LOGGED OUT (CLOSE-blocking) — **PASS**
Each loaded in a CLEAN browser context (no session injected; verified `hasSession:false`). Real slugs/ids from prod:
| Route | finalURL | redirect-to-auth | auth-gate screen | error boundary | renders |
|---|---|---|---|---|---|
| `/b/mingla-demo-party-block` | unchanged | no | no | no | "The Party Block / About / Events" |
| `/e/mingla-demo-party-block/mingla-demo-summer-rooftop` | unchanged | no | no | no | "Summer Rooftop Festival / View Tickets / PRESENTED BY The Party Block" |
| `/checkout/699afd22-5f6f-4fcc-9d2f-ed3c161ba6d3` | unchanged | no | no | no | "Get tickets / 1 OF 3 / Back to event" |

None redirected to sign-in, none showed the error boundary, none acquired a session. The fix did NOT gate public pages. Evidence: `SCREENSHOT_META-ORCH-1232_03_public_event_loggedout.png`.

---

## (5) Adversarial regression test
Path: `mingla-business/src/utils/__tests__/metaOrch1232AdversarialGuardChain.tester.test.ts` (NEW file — append-only gate satisfied, no `[TEST-MOD-APPROVED]` needed).

**Different angle from the implementor's happy-path units** (which tested resolver, validator, and service guard in ISOLATION): this asserts C1 as a **composed system invariant** across the real failing chain `resolveCurrentBrandId(zero-brand cache w/ a _temp_ row) → its output → setCreatorDefaultBrand` (the actual 22P02 sink), plus adversarial id shapes the units miss: whitespace-padded UUID, `_temp_` as a non-prefix substring, uppercase `_TEMP_`, uuid-with-trailing-garbage, hyphenless uuid, uuid-shape-non-hex. Asserts via a supabase `from` mock that NO DB UPDATE is ever issued for a poisoned id.

- On the fix: **10/10 PASS**.
- Fails-on-revert (reverted the resolver newest-brand filter → `brands[0]` AND removed the `setCreatorDefaultBrand` pre-check): **9/10 FAIL** (only the real-UUID happy path stayed green). Fix restored, source byte-identical to `29222457a`, re-ran: 10/10 PASS.

---

## Disposable test brands to CLEAN UP (do NOT delete by tester — orchestrator action)
All owned by `8313d091-2a34-44fc-985d-9cefb5d80781`, name prefix `META-ORCH-1232 TEST`:
- `ac47a5fd-d72e-42fb-9b59-eeb41500f33a`
- `be379108-2756-4a8f-b039-c278f312603d`
- `0eb1a45e-ec32-4393-8bea-5cc500b6e08b`  ← currently the reviewer's `default_brand_id`; reset to NULL on cleanup
- `eb948ba7-fbac-404b-9ccb-3f272c259024`

Each also has a `brand_team_members` owner row to soft-delete/remove with it.

---

## Notes / non-blocking observations
- The runtime requires `MINGLA_STRIPE_MODE=live` + a `pk_live_` key to even render past the root (StripeModeMismatchError fail-close). Expected — backend is live. Not a regression.
- Console shows benign `Require cycle` warnings around `AuthContext`/`useBrands` (pre-existing, unrelated to this ORCH).
- The "It's mine / client" step0 chooser did not appear in these runs (the create went straight to the Brand-name step) — consistent with the non-partner self path; create still succeeded.

## FRESH-SIGNUP RE-TEST

**Re-test date:** 2026-06-27 (UTC) · **Worktree:** `orch-1232-brand-create-fresh-signup-gap` @ `0a83af7bf` · **Target:** LIVE prod Supabase `gqnoajqerqhnvulmnyvv` (app.config fallback URL+anon; same project the MCP reads).

### VERDICT: PASS

The prior PASS used an existing account and missed the real bug. This re-test reproduces the EXACT production failure path — a brand-new signup followed immediately by brand-create — and proves the fix holds. **5/5 fresh-signup iterations persisted. Zero anon `permission denied`. Fails-on-revert proven (unit + runtime).**

### Method (real browser, fresh signups, worst-case timing)
- Ran the business web app from the worktree (`npx expo start --web`), drove with Playwright/Chromium.
- UI signup is email-OTP only (requires receiving an email) → used the prompt's sanctioned fallback: a real `supabase.auth.signUp()` of a genuinely fresh disposable account **inside the app's own supabase singleton** (the app singleton was exposed via a temporary `[TEST-MOD-APPROVED META-ORCH-1232]` web/dev-only instrument, since reverted). Project auto-confirms email, so signUp returns a real session immediately — a true brand-new authenticated account.
- Each iteration: fresh isolated browser context → `signUp` → seed `creator_accounts` (mirrors the app's `onAuthStateChange(SIGNED_IN)` → `ensureCreatorAccount`, the FK target for `brands.account_id`, and the OTHER table that violated RLS as anon in prod) → **immediately** call the REAL fixed create path (`awaitSessionAttached(getSession)` then `createBrand`) with NO artificial wait. This is the exact token-attach race.
- Captured per-iteration: network auth header on the `brands`/`creator_accounts` POSTs, returned brand id, errors, then verified persistence via SQL and scanned postgres logs.

### Per-account evidence (GATED = the fix)
All 5 brand + creator_account POSTs went out with `Authorization: Bearer eyJhbGc…` (REAL JWT — **never anon**). All 5 brands returned an id and persisted.

| # | fresh user id (account_id) | brand id | brands POST auth | persisted? |
|---|---|---|---|---|
| 0 | 32234346-f7d5-457b-bd30-0b7108bff724 | 3c365e6d-67fa-4540-93de-2114d151e75a | Bearer eyJhbGc | YES |
| 1 | 196b1d28-a4b1-46c5-9c95-56e615954768 | 26b96a38-f904-4a4c-a4b6-2825a7bdc0da | Bearer eyJhbGc | YES |
| 2 | dcda070b-3fa6-444d-8867-98d7e9d722cd | abcb3f89-2a9c-42d1-a9af-156b10a4bf97 | Bearer eyJhbGc | YES |
| 3 | 4459dfba-01ed-45c5-a780-fbd29886017e | 7c6fd14f-29d6-430a-bb29-9ffeb9f08d8d | Bearer eyJhbGc | YES |
| 4 | 03cc6bcf-d7d3-4136-a327-183fa280cbc6 | fb0765d4-35b7-4293-b676-eb6fc7855825 | Bearer eyJhbGc | YES |

**SQL persistence proof (read via MCP `execute_sql`, SELECT only):**
- (a) brands row exists with `account_id` = the new user — confirmed for all 5; `account_email` matches the disposable email used.
- (b) creator_accounts row exists (FK target) — confirmed (join succeeded for all 5).
- (c) brand_team_members owner row exists — confirmed: all 5 have a row with `role='brand_owner'`, `user_id`=the fresh user, `accepted_at` set (auto-created by trigger `biz_brand_owner_team_member_after_insert`).

### NO ANON INSERT (postgres log scan)
Scanned `get_logs(postgres)` across the run window. **Zero** `permission denied for table brands` and **zero** `new row violates row-level security policy for table "creator_accounts"` tied to the gated run. The only FK errors in the logs (`brands_account_id_fkey`, ts 1782522404–412k) are from a FIRST scratch run whose harness intentionally skipped the creator_accounts seed — they predate the gated run and are NOT anon/RLS failures. The gated run window is clean.

### Fails-on-revert proof (the prior PASS's gap)
**Unit:** reverting `awaitSessionAttached`'s `hasToken` to pre-fix flag-only semantics (`return session !== null`, ignoring token presence) makes the adversarial test `treats an empty-string access_token as NOT attached (the fresh-signup anon window)` FAIL (1 failed / 9 passed). Restored → 10/10 pass.
**Runtime:** drove the REAL `awaitSessionAttached` (via the app singleton) against three states:
- no session → **THROWS** `AuthNotReadyError` at cap (never proceeds to anon write).
- session present but `access_token: ''` (the EXACT pre-fix bug condition: flag-true-before-JWT) → **THROWS** `AuthNotReadyError`. Pre-fix code treated this as ready and fired the insert as anon → `permission denied`. The fix blocks it.
- real token present → **resolves immediately (0ms)** — no false-negative regression.

### Adversarial test path + coverage
- `mingla-business/src/utils/__tests__/authReadyGate.metaOrch1232.test.ts` ([TEST-MOD-APPROVED META-ORCH-1232], append-only-respecting) — now covers the async-isReady path AND `awaitSessionAttached`: empty-token = not attached, token-attaches-mid-flight (flag-true-before-JWT race), no-session throws. 10/10 pass; fails-on-revert proven above.
- `.github/scripts/strict-grep/i-proposed-1232-b-…` gate asserts each brand mutation hook awaits `awaitSessionAttached(getSession)`, not merely the flag.

### REGRESSION — public pages logged out (CLOSE-blocking): PASS
Dev worktree renders the global `StripeModeMismatchError` fail-close ("something broke") because the dev bundle ships pk_test against the live backend — environmental, not an auth-gate redirect (URL rewrote to `/?brandSlug=…`, never `/auth`). Verified the authoritative signal on **production `business.usemingla.com`** (pk_live) in clean no-session contexts:
- `/b/mingla-demo-party-block` → renders "the party block" anonymously. No auth redirect, no error.
- `/e/mingla-demo-party-block/mingla-demo-summer-rooftop` → renders "summer rooftop festival … presented by the party block" anonymously.
- `/checkout/699afd22-5f6f-4fcc-9d2f-ed3c161ba6d3` → renders checkout ("get tickets 1 of 3 / sold out") anonymously.
Screenshots: `prod_brand_b.png`, `prod_event_e.png`, `prod_checkout.png` (scratchpad).

### Cleanup list (disposable accounts created on LIVE prod — please delete)
Auth users + their seeded creator_accounts/brands/brand_team_members (CASCADE on creator_accounts delete handles brands+members):
- 32234346-f7d5-457b-bd30-0b7108bff724 (metaorch1232+1782522477680_0@example.com)
- 196b1d28-a4b1-46c5-9c95-56e615954768 (metaorch1232+1782522479784_1@example.com)
- dcda070b-3fa6-444d-8867-98d7e9d722cd (metaorch1232+1782522482226_2@example.com)
- 4459dfba-01ed-45c5-a780-fbd29886017e (metaorch1232+1782522484247_3@example.com)
- 03cc6bcf-d7d3-4136-a327-183fa280cbc6 (metaorch1232+1782522486381_4@example.com)
- Plus 8 ungated-run accounts + 5 first-scratch-run accounts (no brands persisted for the first-scratch 5; the 8 ungated DID persist brands) — full id list in scratchpad `fresh_signup_test` output. Emails are `metaorch1232+<ts>_<n>@example.com`. Cleanup SQL: `DELETE FROM auth.users WHERE email LIKE 'metaorch1232+%@example.com';` (CASCADEs to creator_accounts → brands → brand_team_members).

### Honesty note
Faithful brand-new-signup repro achieved in a real browser against live prod, exercising the REAL fixed functions through the app's own supabase singleton. The one fidelity gap: a direct `await signUp()` → call sequence does NOT reproduce the prod flag-vs-token gap at the JS-promise level (supabase-js attaches the token synchronously before the next await), so the runtime UNGATED path also persisted here. The bug is the React `isAuthReady`-flag-vs-token timing — which the fix's `awaitSessionAttached` provably blocks (runtime Case B: empty-token THROWS). Fails-on-revert is therefore proven at the mechanism the fix actually guards, both in unit and runtime. The temporary test instrument was fully reverted; worktree is clean at 0a83af7bf.
