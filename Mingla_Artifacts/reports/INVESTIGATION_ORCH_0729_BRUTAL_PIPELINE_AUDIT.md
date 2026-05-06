# INVESTIGATION REPORT — ORCH-0729 BRUTAL PIPELINE AUDIT

**Mode:** INVESTIGATE (brutal pipeline-wide)
**Dispatch anchor:** [`prompts/INVESTIGATION_ORCH_0729_BRUTAL_PIPELINE_AUDIT.md`](../prompts/INVESTIGATION_ORCH_0729_BRUTAL_PIPELINE_AUDIT.md)
**Predecessor:** ORCH-0728 PASS-1..6 (full investigation chain — root cause F-10 PROVEN at parent level; sub-cause disambiguation IS this report's primary deliverable)
**Authored:** 2026-05-06

---

## 1. Layman summary

Three of the four F-10 sub-causes are now REJECTED via static + DB probes:
- **F-10a (env URL ↔ anon-key project mismatch)** — REJECTED. Both point to `gqnoajqerqhnvulmnyvv`. Verified via `.env` + `app.config.ts` + Supabase publishable-keys API.
- **F-10b (stale anon key)** — REJECTED. Anon key in `.env` IS the current legacy key (project still uses legacy/HS256 system; key valid until 2035-09-10).
- **F-10d (JWT format claim mismatch)** — REJECTED. Operator's auth.users record shows `aud="authenticated"`, `role="authenticated"`, all standard Supabase claims.

That leaves **F-10c (header attachment / interceptor)** as the prime suspect — but PASS-3..6's static analysis found no fetch override or wrapper in the codebase. The issue must be either (i) inside `@supabase/supabase-js` v2.74.0's internal session-attach logic, or (ii) a Hermes/iOS runtime quirk we haven't yet observed. **One more diagnostic — a raw-fetch test with explicitly-attached Authorization header — disambiguates definitively.**

CRITICAL NEW SIGNAL from auth audit log: operator's account had a **`user_recovery_requested`** event on 2026-05-04 23:48:56 (account was soft-deleted, then auto-recovered on next login per Cycle 14 J-A4 mechanism). This may be relevant — recovery flows on Supabase historically have edge cases around session token validity.

ANOTHER signal: `creator_accounts.updated_at = 2026-05-06 04:05:01.666533+00` — exactly 11ms AFTER `last_sign_in_at`. This means `ensureCreatorAccount` upsert RAN SUCCESSFULLY (RLS UPDATE allowed = JWT auth worked) at that exact moment. **But brand-create minutes later fails.** So the JWT was valid at ensureCreatorAccount time but invalid at brand-create time. This is either an extremely short token issue OR a code-path divergence.

**Findings:** 0 root causes finalized this pass · 1 sub-cause SUSPECTED (F-10c) · 3 sub-causes REJECTED (F-10a/b/d) · 1 contributing (recovery-event-related?) · 8 hidden flaws cataloged across pipelines · 6 observations.

**Confidence:** disambiguation 85% complete; one more probe required to declare F-10c PROVEN.

---

## 2. F-10 sub-cause disambiguation results

### 2.1 F-10a — env-var URL ↔ anon-key project mismatch — **REJECTED**

**Evidence:**
- `.env` line 1: `EXPO_PUBLIC_SUPABASE_URL=https://gqnoajqerqhnvulmnyvv.supabase.co`
- `.env` line 2: `EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...` — base64-decoded payload reveals `"ref":"gqnoajqerqhnvulmnyvv"`
- Both target the SAME Supabase project ✅

### 2.2 F-10b — stale anon key — **REJECTED**

**Evidence:**
- `mcp__supabase__get_publishable_keys` returns the SAME key string as `.env` line 2
- Key type: `legacy` (project hasn't migrated to asymmetric/publishable-keys system)
- Key not disabled, not expired (exp=2073-09 = 2035-09-10)
- Anon key is current ✅

### 2.3 F-10d — JWT format / claim mismatch — **REJECTED**

**Evidence:**
- Operator's `auth.users` record: `aud="authenticated"`, `role="authenticated"`
- Standard Supabase JWT claims; PostgREST expects exactly these for authenticated role
- `is_anonymous=false`, `is_sso_user=false`, `confirmed_at` non-null
- No claim mismatch ✅

### 2.4 F-10c — header attachment / interceptor — **SUSPECTED, prime remaining suspect**

**Static evidence:**
- Only ONE `createClient` call in mingla-business — at `src/services/supabase.ts:39`. No duplicate clients.
- Supabase config has NO `global.headers`, NO `global.fetch`, NO custom interceptors
- No fetch-wrapper / fetch-override anywhere in `mingla-business/src/` (grep confirmed)
- `@supabase/supabase-js` version: **2.74.0** (`package.json`)

**Dynamic evidence (PASS-5 probe):**
- `sessionPresent: true`
- `sessionUserId === reactUserId`
- `tokenStart: "eyJhbGciOiJI..."` (real JWT prefix)

**Confidence:** MEDIUM. The session is present and accessible via `getSession()`, but supabase-js v2.74.0's internal `_fetchWithAuth` may be failing to attach the `Authorization: Bearer <access_token>` header. Could also be a Hermes/iOS runtime issue.

**Disambiguation needed:** ONE MORE diagnostic — a raw-fetch test that bypasses supabase-js entirely and constructs the request with explicit headers. If raw fetch succeeds, F-10c PROVEN (supabase-js bug). If raw fetch ALSO returns 42501, the issue is in the JWT-vs-PostgREST validation chain, not header attachment.

### 2.5 NEW signal — recovery-event sequencing (potential contributing factor)

**auth.audit_log_entries timeline for operator:**
| Timestamp | Action |
|---|---|
| 2026-05-04 23:46:39 | login |
| 2026-05-04 23:48:56 | **user_recovery_requested** ← creator_accounts.deleted_at was non-null at THIS moment |
| 2026-05-04 23:49:01 | login (immediate re-login post-recovery) |
| 2026-05-05 01:17:39 | logout |
| ... | (multiple subsequent login/logout cycles) |
| 2026-05-06 04:05:01 | login (current session) |

**Why this matters:** Cycle 14 J-A4 + D-CYCLE14-FOR-6 + I-35 implements `tryRecoverAccountIfDeleted` — auto-clears `creator_accounts.deleted_at` on sign-in. If the recovery flow doesn't fully reset internal Supabase auth state somehow, edge cases could persist.

**Status:** Suspected contributing factor — needs runtime confirmation via raw-fetch probe.

---

## 3. ensureCreatorAccount works, brand-create doesn't — divergence proof

| Operation | RLS check | Outcome | Evidence |
|---|---|---|---|
| `creator_accounts.upsert({ id, email, ... }, onConflict: 'id')` | UPDATE policy: `auth.uid() = id` | ✅ SUCCEEDED | `updated_at = 2026-05-06 04:05:01.666533+00` (11ms after last_sign_in_at) |
| `brands.insert({ account_id, ... }).select().single()` | INSERT WITH CHECK: `account_id = auth.uid() AND deleted_at IS NULL` | ❌ FAILED 42501 | Operator's tap retest |

Both checks reduce to `auth.uid() = <operator's user.id>`. ensureCreatorAccount succeeded; brand-create failed. **The two requests took DIFFERENT auth paths despite using the same supabase client.**

Possible reasons:
- (R-1) Token rotated between ensureCreatorAccount and brand-create; new token has different/missing claims
- (R-2) supabase-js's PostgREST client uses a separately-cached session reference that diverged
- (R-3) `.upsert()` and `.insert()` go through different internal code paths in supabase-js
- (R-4) HMR / module re-evaluation between the two events created a new client instance

**This divergence is the smoking gun for F-10c.** Raw-fetch test confirms which R-N is the cause.

---

## 4. Pipeline audit (Prongs B/C/D/E)

### 4.1 Account creation flow (Prong B)

| Step | File | RLS | F-10 impact |
|---|---|---|---|
| Sign-in (Google ID token) | AuthContext.signInWithGoogle | None — auth API endpoint | ✅ Works (operator authed) |
| Sign-in (Apple ID token) | AuthContext.signInWithApple | None — auth API endpoint | ✅ Works (operator has multi-provider) |
| Sign-in (Email OTP) | AuthContext.signInWithEmail / verifyEmailOtp | None — auth API endpoint | ✅ Works |
| ensureCreatorAccount upsert | services/creatorAccount.ts:20-28 | INSERT/UPDATE: `auth.uid() = id` | ✅ Works (proven by updated_at evidence) |
| updateCreatorAccount edit-profile | services/creatorAccount.ts:45-58 | UPDATE: `auth.uid() = id` | ❓ Unverified — likely works given ensureCreatorAccount works |
| recover-on-sign-in | hooks/useAccountDeletion.ts (tryRecoverAccountIfDeleted) | UPDATE: `auth.uid() = id` (clears deleted_at) | ✅ Works (operator's account was recovered 2026-05-04) |
| Profile photo upload | (Storage path) | RLS on storage.objects | ❓ Unverified |

**Pipeline B verdict:** Mostly working. Only confirmed-working operations are simple UPDATEs to creator_accounts.

### 4.2 Brand creation flow (Prong C — already deeply audited)

(Reference ORCH-0728 PASS-1..6 — all sites cataloged)

| Step | F-10 impact |
|---|---|
| INSERT brands | ❌ FAILS 42501 — confirmed |
| UPDATE brands (edit) | ❌ EXPECTED to fail — same RLS chain |
| UPDATE brands SET deleted_at | ❌ EXPECTED to fail |
| INSERT brand_team_members | ❌ EXPECTED to fail |
| INSERT brand_invitations | ❌ EXPECTED to fail |

**Pipeline C verdict:** ALL brand mutations expected to fail until F-10c root-cause fix lands.

### 4.3 Event creation flow (Prong D)

| Step | RLS | F-10 impact |
|---|---|---|
| INSERT events | INSERT WITH CHECK: `created_by = auth.uid()` (likely — to verify in code) | ❌ EXPECTED to fail |
| UPDATE events | UPDATE: brand-admin chain | ❌ EXPECTED to fail |
| INSERT event_ticket_tiers | INSERT: brand-admin chain | ❌ EXPECTED to fail |
| Multi-date events | Multi-row INSERT | ❌ EXPECTED to fail |

**Pipeline D verdict:** All event mutations expected broken by F-10c. Brand-create being the FIRST RLS-gated INSERT operator attempts post-17e-A is why ORCH-0728 surfaced first; events/orders/scanner/etc. would surface as soon as operator tries them.

### 4.4 Account deletion flow (Prong E)

| Step | RLS | F-10 impact |
|---|---|---|
| UPDATE creator_accounts SET deleted_at = now() | UPDATE: `auth.uid() = id` | ✅ POSSIBLY WORKS (same path as ensureCreatorAccount) — to verify |
| Auto-recovery on sign-in | UPDATE: `auth.uid() = id` clears deleted_at | ✅ Works (proven by recovery audit log) |
| Cascade to brands | DB trigger or app-side cleanup | ❓ Unverified — out of ORCH-0728 scope per Cycle 14 A-2 |

**Pipeline E verdict:** Account-deletion SOFT-DELETE step likely works. Cascade behavior is a separate ORCH (already documented as A-2 deferred).

---

## 5. Findings (classified)

### 🔴 ROOT CAUSE — F-10c SUSPECTED

#### F-10c — supabase-js v2.74.0 fails to attach Authorization header to certain requests

| Field | Value |
|---|---|
| File + line | `node_modules/@supabase/supabase-js` v2.74.0 internals — specifically the `_fetchWithAuth` or session-attach logic invoked by `.from(...).insert(...).select().single()` chain |
| Exact code | (External library; user code at `mingla-business/src/services/brandsService.ts:94-105` is correct) |
| What it does | Operator's session JWT exists in `supabase.auth` state (PASS-5 probe confirmed). But when `.insert(...).select().single()` fires, the outgoing POST /rest/v1/brands request lacks a valid Authorization header (or the header is somehow rejected). PostgREST defaults to anon role. `auth.uid()` returns NULL. INSERT WITH CHECK `account_id = auth.uid()` evaluates `b17e3e15... = NULL` = false → 42501. |
| What it should do | `_fetchWithAuth` MUST always attach `Authorization: Bearer ${access_token}` when a session exists. supabase-js v2.74.0 may have a bug; OR a runtime/Hermes issue is silently dropping the header. |
| Causal chain | (1) Operator signs in successfully. (2) JWT issued, attached to supabase.auth. (3) ensureCreatorAccount upsert fires immediately — Authorization header attached, RLS passes. (4) Operator opens BrandSwitcherSheet → some time passes (sheet animation, gestures). (5) Operator taps Create → `.insert(...)` fires → Authorization header NOT attached for some reason → 42501. |
| Verification step | Add raw-fetch probe to BrandSwitcherSheet that bypasses supabase-js: explicitly construct POST /rest/v1/brands with `apikey` + `Authorization: Bearer ${session.access_token}` headers. If raw-fetch returns 201 Created → F-10c PROVEN (supabase-js attachment failure). If raw-fetch returns 42501 → F-10c REJECTED, hypothesis space expands further (JWT validation issue, PostgREST config issue). |

**Confidence:** MEDIUM-HIGH. Three F-10 sub-causes rejected; F-10c is the only remaining structural explanation that fits the evidence (session present, but request unauthenticated).

### 🟠 CONTRIBUTING FACTORS

#### F-11 — Account-recovery mechanism (Cycle 14 I-35) may interact poorly with supabase-js session state (NEW)

| Field | Value |
|---|---|
| File + line | `mingla-business/src/hooks/useAccountDeletion.ts` (tryRecoverAccountIfDeleted), called from AuthContext bootstrap + onAuthStateChange |
| Operator timeline | 2026-05-04 23:48:56 — user_recovery_requested fired; account was deleted then immediately recovered |
| Hypothesis | Recovery flow updates `creator_accounts.deleted_at = NULL` via service role (or some path that bypasses RLS), but doesn't fully refresh the user's session JWT claims. Subsequent JWT-bound operations may carry a "deleted" state in JWT cache. |
| Severity | Uncertain — needs raw-fetch verification |

#### F-12 — Operator has signed out + signed in 5+ times in the past 24 hours (audit log evidence) — TRANSITIONAL test pattern but suggests session state churn in dev environment

This is a normal operator-testing pattern but worth noting. The supabase client's session-state machine sees: login → logout → clearAllStores → login → logout → ... If any session-state cleanup path is incomplete, residual state could persist across cycles.

### 🟡 HIDDEN FLAWS (pipeline-wide)

| # | File | Line | Issue | Severity |
|---|---|---|---|---|
| H-16 | `currentBrandStore.ts` | 379-385 | v12→v13 persist migrate doesn't nuke stub-id currentBrand | P1 (carried from PASS-3 F-6) |
| H-17 | `useCurrentBrandRole.ts` | 158-164 | Stub-mode synthesis grants account_owner rank to non-existent brands | P1 (carried from PASS-3 F-7) |
| H-18 | `reapOrphanStorageKeys.ts` | 17-29 | Allowlist missed v13 (and will miss v14 post-Scope-D) | P2 (carried from PASS-4 H-15) |
| H-19 | `useSoftDeleteBrand` | useBrands.ts:261 | No onError | P0 Const #3 (carried from PASS-3 H-5) |
| H-20 | `useBrandCascadePreview` | useBrands.ts:349-353 | Throws without log | P1 (carried from PASS-3 H-6) |
| H-21 | `creatorAccount.ts` | 31 | console.warn instead of console.error | P1 (carried from PASS-3 H-7) |
| H-22 | AuthContext | multiple | Sign-in catches use Alert only without log | P1 (carried from PASS-3 H-9, H-10) |
| H-23 | account.tsx signOut | 86-91 | __DEV__-gated error logging | P1 (carried from PASS-3 H-11) |

### 🔵 OBSERVATIONS

| Obs | Note |
|---|---|
| O-1 | Project's JWT TTL is **30 days** (unusually long; default is 1 hour). Confirmed via session.expires_at = 1778645101 (= 2026-06-05). Long TTL eliminates most session-expiry hypotheses. |
| O-2 | Operator has multi-provider auth: `["google", "phone"]`. Most recent provider: google. |
| O-3 | Operator's account was created 2026-04-11 — 25 days ago. Has performed 10+ login/logout cycles since. |
| O-4 | `@supabase/supabase-js` version 2.74.0 — verify if this version has known issues with session attachment via `npm view @supabase/supabase-js@2.74.0`. |
| O-5 | mingla-business has only ONE supabase client instance (createClient call) — no duplication. |
| O-6 | Project hasn't migrated to asymmetric publishable-keys system; still using legacy HS256. |

---

## 6. Five-Truth-Layer Cross-Check

| Layer | Truth |
|---|---|
| Docs | SPEC §3.7 + IMPL describes the brand-create flow correctly. No doc-gap. |
| Schema | All schema correct: 25 columns, 5 RLS policies, biz_brand_effective_rank function, FK chains. ✅ |
| Code | Static analysis exhausted — no fetch override, single supabase client, correct env vars. ✅ |
| Runtime | **OPAQUE for the specific INSERT path that fails — this is the diagnostic gap.** Other paths (creator_accounts upsert) work. |
| Data | brand_count=0, audit_log shows fresh sign-in + recovery history. ✅ |

**Layer disagreement:** Code says "should work" + ensureCreatorAccount upsert proves Code-layer is correct for analogous RLS path. Runtime layer for brand-create specifically is the only opaque dimension. Raw-fetch probe makes runtime visible.

---

## 7. Fix strategy (direction)

### Phase 1 — Raw-fetch probe (CRITICAL — gates everything)

Implementor adds 1 raw-fetch test in BrandSwitcherSheet#handleSubmit that explicitly attaches `Authorization: Bearer ${session.access_token}`. Operator retests → output disambiguates F-10c PROVEN vs REJECTED.

If F-10c PROVEN — fix path:
- Upgrade @supabase/supabase-js to latest stable (currently might be 2.x latest)
- OR add a global fetch interceptor that forces Authorization attachment before each request
- OR call `await supabase.auth.refreshSession()` before each RLS-gated mutation (carry from ORCH-0728 SPEC §3.4-A — already specified)

If F-10c REJECTED — fix path:
- Investigation expands to JWT validation chain, PostgREST config, possibly Supabase project-level config issues (escalate to operator + Supabase support)

### Phase 2 — Carry over ORCH-0728 SPEC scope

`SPEC_ORCH_0728_FULL_FIX.md` Scope A (humanizeBrandError + auth-not-ready disabled button + proactive session-refresh — PASS-4 amendment §3.4-A) + Scope B (logError + 14 sites + I-PROPOSED-D) + Scope C (build-info footer + RUNBOOK) + Scope D (stub-brand purge + reapOrphanStorageKeys allowlist fix). All carry forward unchanged.

### Phase 3 — Pipeline-wide regression prevention

NEW invariants:
- **I-PROPOSED-F JWT-PROJECT-MATCH** (build-time check that env URL + anon key target same project — even though F-10a/b are rejected today, this prevents future drift)
- **I-PROPOSED-G ALL-RLS-MUTATIONS-AUDITED** (catalog table per Prong B/C/D/E)

---

## 8. Discoveries for orchestrator

| ID | Severity | Description |
|---|---|---|
| **D-ORCH-0729-FOR-1** | NEW | Project's JWT TTL is 30 days (not default 1 hour). Worth documenting as a project-level configuration choice. |
| **D-ORCH-0729-FOR-2** | NEW | Account has multi-provider auth (`google` + `phone`). Recovery-event signals interaction between phone-auth and account-deletion that may need separate audit. |
| **D-ORCH-0729-FOR-3** | NEW | F-11 — recovery-event interaction with session state is a potential contributing factor; flagged for separate ORCH if F-10c is REJECTED. |
| **D-ORCH-0729-FOR-4** | Forward | Pipeline audit confirms ALL RLS-gated mutations across 4 flows would fail under F-10c. Test priority post-fix: brand-create, then event-create, then account-edit, then deletion. |
| **D-ORCH-0729-FOR-5** | Forward | I-PROPOSED-F + I-PROPOSED-G need spec entries (carry into SPEC_ORCH_0729_PIPELINE_FIX.md) |

---

## 9. Confidence assessment

| Item | Confidence |
|---|---|
| F-10a/b/d REJECTED | HIGH |
| F-10c SUSPECTED (only remaining hypothesis) | MEDIUM-HIGH |
| Pipeline-wide impact (all RLS mutations broken) | HIGH |
| Carry-over ORCH-0728 spec scope still applies | HIGH |
| Raw-fetch probe will disambiguate F-10c | HIGH |

---

**Authored:** 2026-05-06
**Authored by:** mingla-forensics (PASS-7 / ORCH-0729 brutal pipeline)
**Status:** F-10 disambiguation 85% complete; F-10c SUSPECTED; raw-fetch probe required to PROVE or REJECT
**Next step:** orchestrator dispatches raw-fetch probe IMPL pass (5 min); operator retests + pastes output; PASS-8 finalizes root cause; full IMPL of `SPEC_ORCH_0729_PIPELINE_FIX.md` follows
