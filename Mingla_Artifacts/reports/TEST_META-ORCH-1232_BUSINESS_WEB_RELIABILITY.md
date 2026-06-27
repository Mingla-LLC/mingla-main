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
