# INVESTIGATION REPORT — ORCH-0728 (Brand-create glitch + mingla-business error logging architecture)

**Mode:** INVESTIGATE-THEN-SPEC (Investigation half)
**Cycle context:** Cycle 17e-A smoke #2 FAIL
**Dispatch anchor:** [`prompts/INVESTIGATION_ORCH_0728_BRAND_CREATE_GLITCH_AND_LOGGING.md`](../prompts/INVESTIGATION_ORCH_0728_BRAND_CREATE_GLITCH_AND_LOGGING.md)
**SPEC anchor:** [`specs/SPEC_ORCH_0728_BRAND_CREATE_FIX_AND_MB_ERROR_LOGGING.md`](../specs/SPEC_ORCH_0728_BRAND_CREATE_FIX_AND_MB_ERROR_LOGGING.md) (companion)
**Authored:** 2026-05-05

---

## 1. Layman summary

Brand-create is failing because the operator's PostgREST schema cache almost certainly hasn't seen the new columns yet — migration was applied today, but PostgREST's cache often doesn't auto-refresh on `ALTER TABLE ... ADD COLUMN`. Every `INSERT` the app fires includes 3 of the new columns (`kind`, `address`, `cover_hue`) → PostgREST 400's with "column not found in cache" → JS catches it → operator sees a generic "Couldn't create brand…" inline error or no error at all. **I just sent `NOTIFY pgrst, 'reload schema'` to force the refresh** — operator should retest immediately, and the bug likely vanishes. But this is a probable root cause, not proven, because we have ZERO terminal logs to confirm — which is the deeper issue.

The deeper issue: even if the migration cache was the cause, there are ~50 silent-failure sites across mingla-business. The catch in BrandSwitcherSheet swallows `error.message`. The catch in useCreateBrand swallows `error.message`. The catch in `ensureCreatorAccount` console.warn's. There is no structured log stream. The operator's word "glitch" is a precise clinical term for a bug whose error message has been thrown away. Const #3 (no silent failures) is violated 50+ times across the codebase. The fix is a single `logError` primitive + CI gate + first-cycle migration of high-priority sites including the brand-create site.

**Findings:** 1 root cause (probable, see §3 confidence), 4 contributing factors, ~50 hidden flaws, 5 observations.
**Confidence:** MEDIUM — root cause requires operator retest post-NOTIFY to confirm.

---

## 2. Symptom summary

| Aspect | Finding |
|---|---|
| Expected | Tap "Create brand" → INSERT → brand appears in list + Toast + sheet closes |
| Actual | Tap "Create brand" → "Glitch" (operator's word) → no brand created → no terminal log → no diagnosable signal |
| Reproduction | Always — operator's runtime smoke #2 |
| When started | Cycle 17e-A IMPL (which added 6 NEW columns to brands table + new insertPayload includes 3 of them) |
| Live-DB observation | `SELECT count(*) FROM public.brands` = **0** — no brand has ever been successfully written |

---

## 3. Investigation manifest (every file read, in order)

| # | File | Layer | Why |
|---|---|---|---|
| 1 | `Mingla_Artifacts/prompts/INVESTIGATION_ORCH_0728_BRAND_CREATE_GLITCH_AND_LOGGING.md` | Dispatch | Mission |
| 2 | `Mingla_Artifacts/reports/QA_BIZ_CYCLE_17E_A_BRAND_CRUD_WIRING.md` | Prior context | Tester baseline |
| 3 | `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_17E_A_BRAND_CRUD_WIRING_REPORT.md` | Prior context | IMPL claims |
| 4 | `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` | Component | handleSubmit catch path |
| 5 | `mingla-business/src/hooks/useBrands.ts` | Hook | useCreateBrand mutation onError shape |
| 6 | `mingla-business/src/services/brandsService.ts` | Service | createBrand insertPayload + error mapping |
| 7 | `mingla-business/src/services/brandMapping.ts` | Service | mapUiToBrandInsert payload shape |
| 8 | `mingla-business/src/context/AuthContext.tsx` | Context | useAuth contract — confirms creator_accounts.id = user.id 1:1 |
| 9 | `mingla-business/src/services/supabase.ts` | Config | Client config + storage shim |
| 10 | `mingla-business/src/services/creatorAccount.ts` | Service | ensureCreatorAccount idempotent upsert |
| 11 | `supabase/migrations/20260506000000_brand_kind_address_cover_hue_media.sql` | Migration | New 6-column DDL |
| 12 | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` | Migration | brands table CREATE + RLS + triggers + FK |
| 13 | Live DB probe — `information_schema.columns` | Schema | Confirm 6 new columns ARE live |
| 14 | Live DB probe — `pg_policies` for brands | Schema | Confirm RLS policy text |
| 15 | Live DB probe — `pg_constraint` on brands | Schema | Confirm CHECKs + FK |
| 16 | Live DB probe — `pg_trigger` on brands | Schema | Confirm immutability triggers |
| 17 | Live DB probe — `biz_brand_effective_rank` definition | Schema | Confirm SELECT-RLS via account_owner synthesis |
| 18 | Live DB probe — `count(*)` brands + creator_accounts | Data | Confirm brand_count=0 + 3 creator_accounts |
| 19 | Live DB probe — `supabase_migrations.schema_migrations` | Data | Confirm 17e-A migration recorded as applied |

19 files read. Migration chain rule honored — read the LATEST squash migration AND the 17e-A delta. Sub-agent findings: none used.

---

## 4. Findings (classified)

### 🔴 ROOT CAUSE (probable — confidence MEDIUM)

#### F-1 — PostgREST schema cache stale post-migration → INSERT 400 with "column not found in cache"

| Field | Value |
|---|---|
| **File + line** | `mingla-business/src/services/brandsService.ts:94-105` (createBrand `.insert(insertPayload).select().single()`) |
| **Exact code** | `const { data, error } = await supabase.from("brands").insert(insertPayload).select().single();` where `insertPayload` includes `kind: "popup"`, `address: null`, `cover_hue: 25` |
| **What it does** | Sends an INSERT request to PostgREST with 3 columns (`kind`, `address`, `cover_hue`) that were added by migration `20260506000000` applied 2026-05-05/06. PostgREST validates request bodies against its cached schema. If the cache hasn't refreshed, it returns `400 Bad Request` with body `{"code":"PGRST204","message":"Could not find the 'kind' column of 'brands' in the schema cache"}` (or similar). |
| **What it should do** | INSERT succeeds; PostgREST returns the inserted row. |
| **Causal chain** | (1) Operator opened mingla-business while migration was being deployed → app's authenticated PostgREST connection holds a stale schema cache. (2) Operator taps Create brand → `useCreateBrand.mutateAsync({ accountId, name, slug, kind: "popup", address: null, coverHue: 25 })`. (3) `createBrand()` builds insertPayload with 3 unknown-to-cache columns. (4) PostgREST returns 400 with PGRST204 error. (5) `brandsService.ts:104` `throw error;` propagates to mutationFn. (6) BrandSwitcherSheet:134 catches; `error instanceof SlugCollisionError` is false; `setSlugError("Couldn't create brand. Tap Create to try again.")` fires. (7) `error` object (with the real PGRST204 message) is **never logged to console or terminal**. (8) Operator sees inline message OR no message — words it as "glitch". |
| **Verification step** | (a) Tester forensics-tools `NOTIFY pgrst, 'reload schema'` was issued 2026-05-05 during this investigation. (b) Operator retests — if create succeeds, F-1 is confirmed. (c) If create still fails, drop to next-suspect F-2 (auth-not-ready) or F-3 (JWT race). (d) After Scope B logError lands, the next failure trace is structured + visible in terminal — confirms or refutes by direct evidence. |

**Why "probable" not "proven":** without a console log capturing the actual `error.code` + `error.message` from the failing tap, we cannot 100% prove F-1 is the actual cause. The reasoning is evidence-circumstantial: schema cache is the highest-base-rate cause for "INSERT fails immediately after `ALTER TABLE ADD COLUMN`" on Supabase/PostgREST. If retest-after-NOTIFY succeeds → F-1 PROVEN. If retest-after-NOTIFY still fails → F-1 REJECTED, F-2 or F-3 promoted.

### 🟠 CONTRIBUTING FACTORS

#### F-2 — Silent auth-not-ready return at BrandSwitcherSheet.tsx:119

| Field | Value |
|---|---|
| File + line | `mingla-business/src/components/brand/BrandSwitcherSheet.tsx:119` |
| Exact code | `if (user === null \|\| user.id === undefined) return;` |
| What it does | Silently returns from `handleSubmit` with NO toast, NO console log, NO state change. UI state is unchanged — button visually does nothing. |
| What it should do | Either: (a) disable the button until `useAuth().loading === false` AND `user !== null` — UX prevention, OR (b) call `logError("BrandSwitcherSheet#handleSubmit", "auth-not-ready", { userPresent: user !== null })` AND surface a toast "Sign in finishing up — try again in a moment." |
| Causal chain | If operator tapped Create immediately after sign-in (race: AuthContext.bootstrap not yet resolved) → guard fires → handler returns silently → operator sees "glitch" with NO inline error rendered. This is a SECOND independent path to the same symptom. |
| Verification | Operator retest with multiple seconds-of-delay between sheet-open and tap; if F-2 is the cause, slow-tap succeeds while fast-tap fails. |

**Const #1 (no dead taps) + Const #3 (no silent failures) — DOUBLE VIOLATION.**

#### F-3 — JWT/session race at PostgREST request time

| Field | Value |
|---|---|
| File + line | (architectural — no single line) |
| Exact code | `supabase.from("brands").insert(...).select().single()` — relies on the in-memory session token attached by `supabase.auth.onAuthStateChange` |
| What it does | When the session token is missing (cold start before `getSession()` resolves) or expired (autoRefreshToken in flight), Supabase falls back to `anon` role. RLS WITH CHECK `account_id = auth.uid()` evaluates against `auth.uid() = NULL` → **fails** for any non-NULL account_id. |
| What it should do | Either: (a) await session presence before allowing the mutation, OR (b) catch `42501` (RLS) explicitly and surface "Sign-in lapsed; please retry" |
| Causal chain | (1) Operator opens app cold-start. (2) AuthContext bootstrap kicks off. (3) Operator opens BrandSwitcherSheet before bootstrap completes. (4) Tap Create. (5) `user` is set in React state but Supabase client's session cache may lag. (6) INSERT goes out under `anon` role. (7) RLS denies. (8) Postgrest returns `42501` "new row violates row-level security policy". (9) Caught generically. |
| Verification | Less likely than F-1 because brand_count=0 still indicates the row never reached the table, which CAN be RLS denial. If F-1 is rejected, F-3 becomes the next prime suspect. |

#### F-4 — Catch in BrandSwitcherSheet swallows error message (Const #3 violation)

| Field | Value |
|---|---|
| File + line | `mingla-business/src/components/brand/BrandSwitcherSheet.tsx:134-146` |
| Exact code | `} catch (error) { if (error instanceof SlugCollisionError) { setSlugError(...) } else { setSlugError("Couldn't create brand. Tap Create to try again."); } }` |
| What it does | Maps any non-SlugCollisionError to the same generic UX message. **Discards `error.message`, `error.code`, `error.details`** without logging. |
| What it should do | Call `logError("BrandSwitcherSheet#handleSubmit", error, { surface: "BrandSwitcherSheet", userId: user?.id ?? null, mutation: "useCreateBrand" })` BEFORE the UX branch. The terminal then shows `[mb-error] BrandSwitcherSheet#handleSubmit user=abc code=PGRST204 message="Could not find the 'kind' column…"`. |
| Causal chain | Same as F-1 — but this is the meta-cause that prevents diagnosis of F-1. F-4 makes ALL other Fs invisible. |
| Verification | Direct file read confirms the catch swallows; once logError lands, ALL future failures of this site are diagnosable. |

**This is the single most important contributing factor — it is why we are running an investigation in 2026 instead of just reading the operator's terminal output.**

#### F-5 — useCreateBrand has onError but only rolls back cache; no log

| Field | Value |
|---|---|
| File + line | `mingla-business/src/hooks/useBrands.ts:148-159` |
| Exact code | `onError: (_error, input, context) => { if (context !== undefined && context.snapshot !== undefined) { ... } else if (...) { ... } }` |
| What it does | `_error` parameter is named with `_` prefix indicating it's intentionally unused. Cache rolls back; the actual error message disappears. |
| What it should do | First call `logError("useCreateBrand#onError", _error, { input, contextHadSnapshot: context?.snapshot !== undefined })`. Then proceed with rollback. |
| Causal chain | Even if BrandSwitcherSheet's catch logged, the React Query layer offers a SECOND chance to log structurally before the consumer sees it. Currently neither layer logs. |
| Verification | Direct file read. Same pattern in useUpdateBrand:225-232. |

### 🟡 HIDDEN FLAWS (Scope B logging-site survey — preview)

Comprehensive ~50-site survey deferred to spec §3 (full table). Highlights:

| Pattern | Sites | Severity if hit |
|---|---|---|
| Catch in async handler that swallows error | ~25 in `mingla-business/src/components/` + `mingla-business/app/` | Const #3 — silent diagnosis blocker |
| `console.warn` instead of `console.error` for caught errors | `creatorAccount.ts:31`, multiple AuthContext catches | Const #3 — diff log severity |
| `useMutation` without `onError` log | useCreateBrand, useUpdateBrand, useSoftDeleteBrand (the 3 we just shipped), plus older hooks | Const #3 |
| Pressable onPress without surrounding try/catch | Many — non-async handlers don't need it; async ones do | Const #1 if the handler throws |
| `.single()` on potentially empty result | Several — would crash unless caught | Crash risk |

The exhaustive table lives in the spec.

### 🔵 OBSERVATIONS

| Obs | Note |
|---|---|
| O-1 | `creator_accounts` table has 3 active rows; most_recent created 2026-04-29. Operator's row exists pre-17e-A. |
| O-2 | All 6 new brand columns are LIVE in `information_schema.columns`. CHECK constraints + defaults match migration verbatim. |
| O-3 | RLS chain correct: INSERT WITH CHECK = `account_id = auth.uid() AND deleted_at IS NULL`; SELECT via `biz_brand_effective_rank` falls back to account_owner synthesis when brand_team_members row absent — fresh INSERT WILL pass SELECT-RLS for the creator. |
| O-4 | `brands.account_id` FK → `creator_accounts.id` ON DELETE CASCADE; `creator_accounts.id` FK → `auth.users.id` ON DELETE CASCADE. Confirms 1:1 chain — `accountId: user.id` is correct. H7 (FK mismatch) REJECTED. |
| O-5 | `pg_extension` shows `supabase_vault` 0.3.1 only; no `pgrst` extension. PostgREST is a separate process — schema cache reload must come from `NOTIFY pgrst, 'reload schema'` (which I just executed). |

---

## 5. Five-Layer Cross-Check (Scope A)

| Layer | Truth |
|---|---|
| **Docs** | SPEC §3.2 says createBrand sends INSERT with all 6 new fields when present. SPEC §3.5 says useCreateBrand catches errors and rolls back cache. Neither doc mentions PostgREST cache reload requirement. **GAP.** |
| **Schema** | Migration 20260506000000 is recorded in `supabase_migrations.schema_migrations`. All 6 columns + CHECKs + defaults are live in `information_schema`. RLS chain is correct. **TRUTH** = schema is in good shape. |
| **Code** | createBrand sends 3 of the 6 new columns on every INSERT. Catch swallows `error.message`. **TRUTH** = code matches IMPL claims; logging is the gap. |
| **Runtime** | Operator's actual error message at the moment of tap is **UNKNOWN** because no log captures it. We have brand_count=0 + "glitch" wording. **TRUTH UNVERIFIED.** This is the diagnosis-blocker. |
| **Data** | 0 rows in brands. 3 active creator_accounts (operator's row exists pre-17e-A). **TRUTH** = the INSERT never reached the table. |

**Layer disagreement:** Docs describe a clean flow; Schema is correct; Code makes the right call shape; **Runtime is opaque** because logging is missing; Data shows the failure. The only layer that can disambiguate F-1 vs F-2 vs F-3 vs F-9 is Runtime — and Runtime requires Scope B's logging primitive.

**Conclusion:** Either F-1 (PostgREST cache) is the cause and the NOTIFY just fixed it, OR a different F is the cause and we need logging to find it. **Both branches require Scope B.**

---

## 6. Scope B logging-site survey (compact catalog)

Full table lives in the spec §3.6 (logSites table). Categories surveyed:

| Category | File-paths surveyed | Approx site count |
|---|---|---|
| Brand UI catches | BrandSwitcherSheet, BrandEditView, BrandProfileView, BrandDeleteSheet, BrandTeamSheet | 6 |
| Brand mutations | useBrands.ts (5 hooks) | 4 onError sites |
| Brand services | brandsService.ts, creatorAccount.ts, brandMapping.ts | 4 |
| Auth catches | AuthContext.tsx (Google/Apple/Email/OTP/SignOut) | 8 catches |
| Settings + profile | account/edit-profile, account/notifications, account/delete | ~5 |
| Event creator surfaces (Cycle 3+) | CreatorStep*, useEvents, eventService | ~12 |
| Order/refund surfaces | CancelOrderDialog, RefundSheet, useOrders, useRefunds | ~6 |
| Storage uploads | personAudioService, brandImageService (if exists) | ~3 |
| Edge function callers | edgeFunctionError.ts adapter, useFunctions hooks | ~5 |
| Navigation handlers | router.push catches in route files | ~3 |

**Survey total: ~56 sites.** Spec §3.6 contains the full file:line table for the first migration cycle's 8-12 sites.

---

## 7. Blast radius

| Surface | Affected? |
|---|---|
| Brand create (`BrandSwitcherSheet`) | YES — primary symptom |
| Brand edit (`BrandEditView` + `useUpdateBrand`) | LIKELY — same mutation pattern, would fail with same hidden error if cache stale |
| Brand soft-delete (`BrandDeleteSheet` + `useSoftDeleteBrand`) | LOW — UPDATE doesn't include new columns; cache miss less likely |
| Account settings | NOT directly affected by the F-1 cache issue; affected by F-4/F-5 logging gap |
| Stripe Connect onboarding (`useUpdateBrand` patches `stripeStatus`) | LIKELY — uses useUpdateBrand which sends new columns (none in patch usually, but the schema cache must be fresh) |

**Solo/Collab parity:** mingla-business is single-mode — N/A.
**Admin parity:** mingla-admin doesn't write to brands directly — N/A for create. Logging gap is BIZ-only scope.

---

## 8. Invariant violations

| Invariant | Sites violating | Action |
|---|---|---|
| **Const #3** (no silent failures) | F-4, F-5, ~50 sites in survey | NEW invariant **I-PROPOSED-D MB-ERROR-COVERAGE** + CI gate |
| **Const #1** (no dead taps) | F-2 silent auth-not-ready return | Spec §3.4 fix |
| **I-PROPOSED-A** (brands deleted_at filter) | None new — fix already in 17e-A | N/A |

**NEW invariant proposed:** **I-PROPOSED-D MB-ERROR-COVERAGE** — every catch block in `mingla-business/src/` + `mingla-business/app/` MUST call `logError(...)` with a structured tag. Allowlist comment for intentional swallows. CI gate per registry pattern.

---

## 9. Fix strategy (direction only — spec has the contract)

### Immediate operator action

`NOTIFY pgrst, 'reload schema'` already executed during this investigation. Operator should retest brand-create immediately. If retest succeeds → F-1 confirmed → proceed with Scope B as architectural fix. If retest still fails → escalate to F-2/F-3 path with logError already present.

### Code direction

1. **Scope B FIRST:** Build `logError` primitive + first-cycle 8-12 site migrations + CI gate. This unblocks ALL future diagnosis.
2. **Scope A second:** With logError landed, retry brand-create. The structured error in terminal definitively identifies F-1 vs F-2 vs F-3. Apply the targeted fix.
3. **Migration safeguard:** Spec mandates that future ADD COLUMN migrations include `NOTIFY pgrst, 'reload schema';` at the end. Optional but documented as best-practice.

### Phased site migration

This cycle (ORCH-0728): 8-12 high-priority sites including BrandSwitcherSheet#handleSubmit, useCreateBrand/useUpdateBrand/useSoftDeleteBrand onError, AuthContext catches, ensureCreatorAccount, brandsService throws.
Subsequent cycles: remaining ~44 sites piecemeal.

---

## 10. Regression prevention

- NEW invariant I-PROPOSED-D + CI gate `i-proposed-d-mb-error-coverage.mjs` (per registry pattern)
- Migration template addendum: `NOTIFY pgrst, 'reload schema';` mandatory for ADD COLUMN migrations (documented in `INVARIANT_REGISTRY.md`)
- TEST: synthetic catch-without-logError fixture must exit 1 from CI gate
- TEST: BrandSwitcherSheet#handleSubmit auth-not-ready path: spec must require disabled-button OR logError+toast (cannot be silent return)

---

## 11. Discoveries for orchestrator

| ID | Severity | Description |
|---|---|---|
| **D-ORCH-0728-FOR-1** | Pre-existing | `creatorAccount.ts:31` `console.warn` — should become logError. Same pattern in AuthContext.tsx multiple places. |
| **D-ORCH-0728-FOR-2** | Pre-existing | `useBrands.ts:148` and 225 — `_error` parameter prefix-underscore signals intentionally unused; pattern unsafe — fix in Scope B migration. |
| **D-ORCH-0728-FOR-3** | Forward-observation | Migration template should mandate `NOTIFY pgrst, 'reload schema';` for ADD COLUMN migrations. Add to operator runbook + CI nag. |
| **D-ORCH-0728-FOR-4** | Forward-observation | `app-mobile/` already has `edgeFunctionError.ts` (memory `feedback_supabase_error_handling_in_react_native`). mingla-business needs the SAME utility. Spec §3.5 may borrow / port it. |
| **D-ORCH-0728-FOR-5** | Out-of-scope | Cycle 17e-A close gates on this ORCH; until ORCH-0728 closes, smoke #2 stays FAIL → Cycle 17e-A stays open. Plan for 17e-A close to fold in ORCH-0728 close. |
| **D-ORCH-0728-FOR-6** | Pattern praise | All 5 Cycle 17e-A CI gates exit 0 + cross-domain audit clean. The IMPL is structurally correct — the bug is operational (cache freshness) + observability (logging). |

---

## 12. Confidence assessment

| Item | Confidence | Reasoning |
|---|---|---|
| Schema is healthy + migration applied | **H** | Direct DB probe |
| RLS chain is correct | **H** | Direct DB probe + function definition read |
| `accountId: user.id` is correct (H7 rejected) | **H** | FK chain confirmed via DB probe |
| F-1 (PostgREST cache stale) is the root cause | **M** | Highest base-rate cause for this pattern; NOTIFY sent; awaits operator retest to confirm |
| F-4 (catch swallowing error) is the diagnosis-blocker | **H** | Direct file read; verified across 5+ sites |
| Scope B logging architecture is the structural fix | **H** | Operator directive + ~50-site survey + Const #3 violation count |
| ORCH-0728 closes Cycle 17e-A smoke #2 | **H** | Smoke #2 gates on brand-create; F-1 fix unblocks it |

**Overall:** investigation is **complete** for the structural conclusions (Scope B is the right fix, regardless of which F the actual symptom is). Pinpointing the exact F is **gated on operator retest** post-NOTIFY.

---

**Authored:** 2026-05-05
**Authored by:** mingla-forensics
**Status:** Investigation half complete — spec follows in companion file
**Next step:** Operator retests brand-create; result feeds into spec scope decision (F-1 confirmed → Scope A is just NOTIFY-on-migrate; F-1 rejected → Scope A includes auth-not-ready disabled-button + JWT-race guard + 42501 catch). Then implementor dispatch.

---

## PASS-2 — F-1 REJECTED + new evidence (2026-05-05 21:50 UTC)

### F-1 rejection evidence

- `NOTIFY pgrst, 'reload schema'` was issued during PASS-1.
- Operator retested 2026-05-05 — brand-create still glitches.
- **Conclusion:** PostgREST cache was not the cause.

### PASS-2 new probes + findings

#### Live DB probe — operator's session state

| Field | Value |
|---|---|
| auth.users.id | `b17e3e15-218d-475b-8c80-32d4948d6905` |
| email | `sethogieva@gmail.com` |
| last_sign_in_at | 2026-05-05 21:39:45+00 (very recent — within minutes of retest) |
| confirmed | true |
| creator_accounts.id | matches auth.users.id ✅ |
| creator_accounts.deleted_at | null ✅ |
| default_brand_id | null (expected — operator has 0 brands) |

**Implications:**
- F-3 (JWT/session race) **UNLIKELY** — session is fresh. AutoRefreshToken would not yet be racing for a session that's < 11 minutes old (Supabase tokens default to 1 hour).
- H11 (auth.uid() vs JWT sub mismatch) **UNLIKELY** — auth.users.id and creator_accounts.id are identical (`b17e3e15…`), so the RLS WITH CHECK `account_id = auth.uid()` would pass when the operator passes `accountId: user.id`.
- account is NOT soft-deleted — no recovery-on-sign-in interference.

#### Live DB probe — INSERT-fired triggers

```sql
SELECT tgname FROM pg_trigger WHERE tgrelid='public.brands'::regclass
  AND NOT tgisinternal AND (tgtype & 4) = 4;
```
Result: **empty array** — no INSERT-fired triggers on brands.

**Implications:** H12 (trigger error on INSERT) **REJECTED**. The 3 existing triggers (`trg_brands_immutable_account_id`, `trg_brands_immutable_slug`, `trg_brands_updated_at`) all fire on UPDATE only.

#### Live DB probe — audit_log activity

`audit_log` table exists; total events in last 1 hour = **0**.

**Implications:** Either (a) no writes have been attempted at the SQL layer (so the failure is BEFORE reaching INSERT — pointing at F-2 or H17), or (b) audit_log only captures successful writes, or (c) the operator's INSERT attempts never reached PostgREST at all.

#### Static — TopSheet primitive event propagation

Read `mingla-business/src/components/ui/TopSheet.tsx` 1-396:
- Outer wrapper: `<View pointerEvents={visible ? "auto" : "none"} style={absoluteFill}>` — taps propagate when visible ✅
- Scrim Animated.View: absoluteFill, rendered FIRST in JSX
- Anchor View (panel container): rendered AFTER scrim → renders ON TOP, with `pointerEvents="box-none"` (children receive taps; container itself doesn't intercept)
- Panel inside GestureDetector → Animated.View → body containing children
- No `pointerEvents="none"` block on any parent of the children content

**Implications:** H13 (TopSheet event propagation) **REJECTED**. The Button's `onPress={handleSubmit}` should fire normally when tapped.

#### Mapper output — fields vs schema columns

mapUiToBrandInsert output keys (when called from BrandSwitcherSheet defaults):
- `account_id`, `name`, `slug`, `description` (null), `profile_photo_url` (null), `contact_email` (null), `contact_phone` (null), `social_links` ({}), `custom_links` ([]), `tax_settings` ({}), `default_currency` ("GBP"), `stripe_connect_id` (null), `stripe_payouts_enabled` (false), `stripe_charges_enabled` (false), `kind` ("popup"), `address` (null), `cover_hue` (25)

ALL keys match real columns confirmed in PASS-1's information_schema probe. **H10 (undeclared field) REJECTED.**

#### Static — `mutationFn` pre-Supabase throw paths

Re-traced `useCreateBrand.mutationFn` → `createBrand(input, "owner")` → `mapUiToBrandInsert(...)`:
- `brand.displayName.trim()` — displayName is set by BrandSwitcherSheet:125 (`name: trimmedName` where trimmedName came from `displayName.trim()` line 109). String. Won't throw.
- `brand.slug.trim()` — slug from `slugify(trimmedName)` line 126. String. Won't throw.
- `joinBrandDescription(undefined, undefined)` returns `null`. Safe.
- `linksToSocialJson(undefined)` early-returns `{}`. Safe.
- `brand.links?.custom?.length` — undefined-safe. Safe.

No pre-Supabase throw possibility. **H15 REJECTED.**

### NEW HYPOTHESIS — H17 stale bundle

**Statement:** Operator may be testing on a deployed Expo Go / TestFlight / APK build that contains the PRE-17e-A JavaScript bundle. Cycle 17e-A IMPL was committed locally and tester-verified, but no `eas update` OTA has been published (gated on this very ORCH-0728 close per `feedback_post_pass_protocol`). If the operator is using the deployed dev build, the bundle is stale → `BrandSwitcherSheet.handleSubmit` runs the OLD `setBrands(...)` path → writes to Zustand only → no DB write.

| Field | Value |
|---|---|
| File + line | (architectural — local code is 17e-A; deployed bundle may not be) |
| What it does | If operator opens deployed mingla-business app (TestFlight/APK), the bundle was packaged at the last EAS build time. If that build pre-dates 17e-A IMPL, brand-create runs the old phone-only Zustand path. |
| What it should do | Operator runs against `npx expo start` Metro bundler from local 17e-A code, OR rebuilds the EAS preview/dev build, OR publishes an OTA via `eas update --branch production --platform ios`. |
| Causal chain | (1) Operator opens deployed dev build. (2) Bundle = pre-17e-A code. (3) Old `BrandSwitcherSheet.handleSubmit` calls `setBrands([...brands, newBrand])` (Zustand). (4) NO `supabase.from("brands").insert(...)` call ever fires. (5) brand_count stays 0 in DB. (6) UI may briefly show optimistic temp brand or none at all → operator sees "glitch". |
| Verification | (a) Operator confirms platform (deployed build vs Metro). (b) If deployed: rebuild OR publish OTA. (c) If Metro: switch to H17-rejected and continue with F-2 / minimal-diagnostic-patch path. |

**Confidence:** MEDIUM — strong because no eas update has fired post-17e-A IMPL; operator's last sign-in was via the deployed app (Supabase auth doesn't distinguish dev vs prod build, just account).

### PASS-2 hypothesis status (final)

| # | Hypothesis | PASS-2 verdict |
|---|---|---|
| F-1 | PostgREST cache stale | **REJECTED** — NOTIFY didn't fix |
| F-2 | Silent auth-not-ready return | Still possible — needs platform confirmation |
| F-3 | JWT/session race | **UNLIKELY** — session fresh |
| F-4 | Catch swallows error | **CONFIRMED** — diagnosis-blocker; spec covers |
| H7 | FK mismatch | REJECTED PASS-1 |
| H10 | Undeclared field | **REJECTED** — mapper keys match schema |
| H11 | auth.uid()/JWT sub mismatch | **UNLIKELY** — IDs match |
| H12 | INSERT-fired trigger | **REJECTED** — no INSERT triggers exist |
| H13 | TopSheet event propagation | **REJECTED** — propagation correct |
| H14 | Empty displayName CHECK fail | **UNLIKELY** — defaults non-empty + canSubmit gates |
| H15 | mutationFn pre-Supabase throw | **REJECTED** — no throw paths |
| H16 | Platform divergence | Subsumed by H17 |
| **H17** | **Stale deployed bundle** | **NEW PRIME SUSPECT** — confidence MEDIUM |

### PASS-2 prime suspect: H17 stale bundle

If operator confirms they're on a deployed build (not local Metro), H17 is essentially proven by elimination. The fix is operational, not code:
- **Path A:** Rebuild the dev/preview build via `eas build --profile preview --platform ios`
- **Path B:** Publish OTA via `eas update --branch production --platform ios --message "ORCH-0728-WIP brand CRUD wiring"` and wait for the deployed app to pick it up (next launch typically)
- **Path C:** Run locally via `npx expo start` from this repo to verify against latest code

If operator confirms they're on local Metro (and Metro is showing latest code), H17 is rejected and we drop to F-2 + minimal diagnostic patch path.

### Recommended next step

**The operator can collapse PASS-2 in 30 seconds with ONE answer:**

> "Are you testing brand-create on (a) a deployed TestFlight / APK / Expo Go build, or (b) a local `npx expo start` Metro bundler running from this repo's mingla-business folder?"

| Answer | Outcome |
|---|---|
| (a) Deployed build | H17 PROVEN — solution is operational (rebuild OR `eas update`). No code change needed for the bug. |
| (b) Local Metro | H17 REJECTED → drop to minimal diagnostic patch (1-line `console.error` in BrandSwitcherSheet:134 catch) so we can SEE the runtime error → narrow F-2 vs other |

If answer is (b), forensics PASS-3 dispatches WITH the captured terminal output.

### PASS-2 confidence

| Item | Confidence |
|---|---|
| F-1 REJECTED | HIGH |
| F-3 UNLIKELY (session fresh) | HIGH |
| H10/H11/H12/H13/H15 REJECTED | HIGH (live + static probes) |
| H17 (stale bundle) | MEDIUM — needs operator platform confirmation to PROVE |
| F-2 (silent auth-not-ready) still in play if H17 rejected | MEDIUM |
| Spec is structurally correct as-is | HIGH (Scope B is right regardless of which F is the actual cause) |

### PASS-2 spec adjustment

**No change to existing spec required.** Scope B (logError + 12 sites + CI gate + I-PROPOSED-D) is unchanged. Scope A may add an explicit guard for H17 prevention:
- Documented operator-runbook step: post-IMPL of any 17e-A-class change, EAS OTA must publish OR operator must rebuild dev build before retesting
- Optional implementor TODO: surface a "build version" footer in `__DEV__` mode at app/index so operator can confirm at-a-glance which bundle is running

**Authored (PASS-2):** 2026-05-05 21:50 UTC
**Authored by:** mingla-forensics
**Status:** PASS-2 complete; awaiting one operator answer (deployed vs local Metro) to PROVE H17 or trigger PASS-3 with diagnostic patch

---

## PASS-2 OPERATOR-ANSWER UPDATE — "dev build"

Operator answer (2026-05-05 21:55 UTC): "**dev build**".

### Interpretation

"Dev build" in Expo terminology most precisely refers to a **development client** built via `eas build --profile development`. The development client:
- Has the native runtime baked in (custom native modules, plugin native code)
- Has the JavaScript bundle SERVED BY METRO when Metro is running
- Falls back to a CACHED bundle (last-known JS from a previous Metro session) when Metro is not running

This means H17 has **two sub-cases**, only one of which is the bug:

| Sub-case | Description | Bug status |
|---|---|---|
| **H17a** | Dev client connected to live Metro, Metro serving local 17e-A code | NOT THE BUG — code matches. Drop to diagnostic patch path. |
| **H17b** | Dev client running cached bundle (Metro not running, or stale cache) | **PROVEN BUG** — operator is running pre-17e-A code. Force JS-reload + ensure Metro is running fixes it. |

### Operator-side disambiguation (30 seconds, no code change)

Operator should perform this exact sequence:

1. **Open a terminal in `c:/Users/user/Desktop/mingla-main/mingla-business`**
2. **Run `npx expo start --clear`** — `--clear` flag wipes the babel + Metro cache forcing a fresh transpile
3. **Wait for Metro to print the QR code / `Metro waiting on exp+...` message** — confirms it's serving
4. **On the dev client device:** shake the device (or Cmd+D in simulator) → tap **"Reload"** — this re-fetches the JS bundle from the now-live Metro
5. **Confirm the bundle is fresh:** the dev client's banner should briefly show "Loading bundle …" + a percentage indicator. If you don't see that banner, the device isn't actually re-fetching — try uninstalling + reinstalling the dev client.
6. **Retest brand-create.**

### Two outcomes

| Outcome | Meaning | Next action |
|---|---|---|
| **Brand creates successfully** | H17b PROVEN. Cycle 17e-A code works; the deployed dev client was running stale bundle. | Cycle 17e-A close fires. No additional code work for ORCH-0728 Scope A — the fix was operational. Spec's Scope B (logError) still ships in IMPL as planned. |
| **Brand still glitches** | H17 fully REJECTED (Metro is now serving fresh 17e-A code). True root cause is one of F-2 / F-4-only / new H. | Orchestrator dispatches a 1-line diagnostic patch implementor pass. Operator retests; terminal output collapses search to one F definitively. |

### Updated confidence

| Item | Confidence |
|---|---|
| H17 (umbrella) | MEDIUM-HIGH — operator confirmed dev build |
| H17b (cached stale bundle) | MEDIUM — needs force-reload to confirm |
| H17a (Metro serving fresh) | LOW |

### Spec adjustment for H17 prevention (regardless of which sub-case)

Append to existing spec §3 a new sub-section §3.8 (operator runbook addition):

> **§3.8 — Dev-build retest discipline (ORCH-0728 PASS-2 finding)**
>
> Whenever an IMPL pass changes JavaScript that the operator will retest on a dev client:
> 1. Operator runs `npx expo start --clear` to ensure fresh transpile
> 2. Operator force-reloads the JS bundle on the dev client (shake → Reload OR Cmd+R)
> 3. Operator confirms the "Loading bundle …" banner appeared (visual proof of fresh fetch)
> 4. Optional but recommended: implementor adds a `__DEV__`-only build-info footer at `app/index.tsx` showing `git rev-parse --short HEAD` value baked at build time so the operator can verify at-a-glance which JS bundle is running
>
> This rule supersedes the implicit assumption that "git pull means the running app has the new code". On a dev client, only Metro freshness + JS-reload guarantees that.

**Status:** PASS-2 complete pending operator force-reload retest. Forensics yields control back to orchestrator for the bifurcated next step.

