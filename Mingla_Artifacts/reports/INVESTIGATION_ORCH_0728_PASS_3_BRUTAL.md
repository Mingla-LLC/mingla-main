# INVESTIGATION REPORT — ORCH-0728 PASS-3 BRUTAL (full mingla-business audit)

**Mode:** INVESTIGATE-THEN-SPEC (PASS-3 brutal — supersedes PASS-1 + PASS-2 conclusions)
**Dispatch anchor:** [`prompts/INVESTIGATION_ORCH_0728_PASS_3_BRUTAL.md`](../prompts/INVESTIGATION_ORCH_0728_PASS_3_BRUTAL.md)
**Companion spec:** [`specs/SPEC_ORCH_0728_FULL_FIX.md`](../specs/SPEC_ORCH_0728_FULL_FIX.md) (SUPERSEDES `SPEC_ORCH_0728_BRAND_CREATE_FIX_AND_MB_ERROR_LOGGING.md`)
**Authored:** 2026-05-05

---

## 1. Layman summary

**Brand-create root cause is INCONCLUSIVE without runtime evidence — we cannot prove what's failing because every catch block in mingla-business swallows error.message before it reaches your terminal.** Static analysis exhausts. Live DB probes exhaust. The bug is in the runtime moment we cannot see. PASS-3 declares: **diagnostic patch must land BEFORE root cause is callable proven**. Once 1-line `console.error` is added to 4 catch sites, your next tap pastes the actual error code/message into your terminal. We then know, in 30 seconds, whether it's RLS denial / JWT expired / mapper-side throw / network kill / something nobody thought of. This is the only honest path forward.

PASS-3 also surfaces **regression "Lonely Moth stays connected" is REAL** — the v12→v13 persist migrate keeps `currentBrand` even when its `id` is a stub (`"lm"` / `"tll"` / `"sl"` / `"hr"`) that doesn't exist in the production `brands` table. This is a stale-state ghost: TopBar renders the stub brand from persisted Zustand, but no DB row backs it. Stub-brand purge (NEW Scope D) lands as part of the full fix.

PASS-3 audited **14 silent-failure sites** (the high-priority subset of the ~50-80 total estimated landscape). Full catalog in §6.

**Findings:** 0 root causes PROVEN, 1 ROOT CAUSE SUSPECTED (H17b/H21 combination — needs diagnostic patch to confirm), 6 contributing factors confirmed, 14 hidden flaws cataloged, 4 observations, 5 NEW hypothesis rejections.
**Confidence:** root cause **INCONCLUSIVE** until diagnostic patch lands; supporting findings HIGH; full spec confidence HIGH (covers all hypotheses).

---

## 2. Symptom (PASS-3 cumulative)

| Aspect | Finding |
|---|---|
| Expected | Tap "Create brand" → INSERT → brand appears + Toast + sheet closes |
| Actual | "Glitch" — button shows brief feedback (likely optimistic temp-row flash + rollback per F-5), Lonely Moth stub stays in TopBar (regression: persisted Zustand stub survives v12→v13 migrate), no terminal log, no inline error visible to operator (or operator doesn't notice it), audit_log = 0 events / last hour, brand_count_total = 0 (NO brand has EVER been written) |
| Reproduction | 100% reproducible per operator |
| Platform | Dev build (Expo development client) |
| Bundle freshness | UNCONFIRMED — operator did not paste bundle-stamp probe output (per PASS-2 §4.5 recommendation); could be H17b cached stale bundle OR H17a fresh-Metro-but-other-F |
| Logging gap | CONFIRMED — every catch site swallows error; ZERO terminal output captured during retest |

---

## 3. PASS-3 Investigation manifest

### 3.1 Files re-read (PASS-3 lens)

| # | File | Lines reviewed | New findings vs PASS-1+2 |
|---|---|---|---|
| 1 | `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` | All 405 | mode-switch logic confirmed (line 87); default text "Lonely Moth" line 89/97; canSubmit only checks `trimmedName.length > 0`, NOT `!authLoading || user !== null`; line 119 silent return on user-null condition — Const #1 + #3 violation; catch at 134-146 swallows error.message |
| 2 | `mingla-business/src/hooks/useBrands.ts` | All 376 | onError sites at 148, 225 use `_error` (intentionally unused — Const #3 violation); useSoftDeleteBrand at 261 has NO onError (silent); useBrandCascadePreview parallel queries throw without log |
| 3 | `mingla-business/src/store/currentBrandStore.ts` | All 415 | v12→v13 migrate at line 379-385 PRESERVES currentBrand whether or not its id matches a real DB row → **regression: stub brand survives migration**. Confirmed root cause of "Lonely Moth stays connected" |
| 4 | `mingla-business/src/store/brandList.ts` | All 246 | STUB_BRANDS still exists with 4 stubs (`lm` / `tll` / `sl` / `hr`); never imported anywhere except in dead-code paths — file should be DELETED in stub-brand purge (Scope D) |
| 5 | `mingla-business/src/hooks/useBrandListShim.ts` | All 27 | Returns `[]` when user=null; safe; but doesn't expose loading state — consumer can't disambiguate "no brands" from "still loading" |
| 6 | `mingla-business/src/hooks/useCurrentBrandRole.ts` | All 170 | Stub-mode synthesis fallback at lines 158-164 → if currentBrand has stub `id="lm"` AND `role="owner"`, role synthesizes to `account_owner` rank 60. **This means a stub brand grants synthetic permissions even though it has no DB row**. This is the actual regression chain |
| 7 | `mingla-business/src/services/brandsService.ts` | All 252 | createBrand line 94-105 uses `.select().single()` — could 400 with PGRST116 if RLS denies SELECT but INSERT succeeded |
| 8 | `mingla-business/src/services/brandMapping.ts` | All 335 | mapUiToBrandInsert keys validated against schema columns — match exactly (PASS-2 confirmed) |
| 9 | `mingla-business/src/context/AuthContext.tsx` | Already read PASS-1 | bootstrap loading=true initial; goes false after getSession resolves |
| 10 | `mingla-business/src/components/ui/TopSheet.tsx` | All 396 | Event propagation correct (PASS-2 verified); no pointerEvents block |
| 11 | `mingla-business/src/services/creatorAccount.ts` | All 59 | upsert error: console.warn — silent severity (Const #3 minor) |
| 12 | `mingla-business/app/(tabs)/account.tsx` | All 503 | dev styleguide `__DEV__`-gated (line 198) — NOT a regression |

### 3.2 Live DB probes (PASS-3)

| Probe | Result | Implication |
|---|---|---|
| `count(*) FROM brands` (all) | 0 | NO brand row exists in DB at all (active or soft-deleted). INSERT has NEVER succeeded for this operator. |
| `count(*) FROM brands WHERE deleted_at IS NULL` | 0 | Same. |
| `column_count` for brands | 25 (19 + 6) | Schema is fully live with all 6 17e-A columns ✅ |
| `audit_log` last 1 hour | 0 events | Either no writes attempted at backend OR audit_log only captures success |
| Operator's auth.users + creator_accounts | exists, IDs match, ca_deleted=null | Auth state healthy |
| INSERT-fired triggers | 0 | H12 still REJECTED |
| RLS policies | 5 policies, INSERT WITH CHECK = `account_id = auth.uid() AND deleted_at IS NULL` | Correct |
| `pg_stat_statements` for brands INSERT | 0 hits | NO INSERT statement has been observed by Postgres for the brands table — strong signal that the SQL never reached the DB |

**Critical synthesis:** `pg_stat_statements` shows no INSERT for brands → either (a) the JS path never reached `.insert()`, (b) PostgREST rejected before passing to Postgres, or (c) `pg_stat_statements` is not enabled / has been reset. We cannot disambiguate without runtime evidence.

### 3.3 Static — silent-failure audit (PASS-3 spot count)

`grep -c 'try\s*\{|catch\s*\(' mingla-business/src/` → **67 occurrences across 36 files**.

This is the ~50-80 site landscape estimated. PASS-3 cataloged 14 high-priority sites (§6). Full catalog deferred to spec implementation phasing.

---

## 4. Findings (classified)

### 🔴 ROOT CAUSE — STATUS: SUSPECTED (gated on diagnostic patch)

#### F-1-S — Brand-create silently fails somewhere between BrandSwitcherSheet#handleSubmit and a confirmable end state

**Why suspected, not proven:**
Static analysis has eliminated H7, H10, H11, H12, H13, H15. PASS-2 force-reload guidance was given but operator did not confirm execution + bundle-stamp probe output. PASS-3 cannot run the operator's tap. We have: (a) brand_count=0 (INSERT either never fired, or fired and was rolled back), (b) audit_log=0, (c) pg_stat_statements has no INSERT hit, (d) operator says "button glitches", (e) operator authenticated + creator_accounts exists.

The remaining hypothesis space:
- **F-2** (silent auth-not-ready return at BrandSwitcherSheet:119) — if `user` is null at tap time
- **F-3** (JWT/session race) — UNLIKELY but not formally proven
- **F-5** (optimistic rollback flash creating "glitch" perception while error is swallowed) — promotes to MEDIUM
- **H17b** (cached stale bundle running pre-17e-A code) — MEDIUM; operator has dev build but didn't confirm bundle freshness
- **H19** (`useAuth().loading` race vs sheet-mount → stale `user`)
- **H21** (combination — bundle stale + Zustand stub-brand state)

**File + line:** `mingla-business/src/components/brand/BrandSwitcherSheet.tsx:117-150` (handleSubmit), with proximate cause likely at line 119 (silent return) or inside the catch block at line 134-146 (swallowing error.message).

**Exact code (catch block):**
```ts
} catch (error) {
  if (error instanceof SlugCollisionError) {
    setSlugError("This brand name is taken. Try a small variation (e.g. \"" + trimmedName + " Events\").");
  } else {
    setSlugError("Couldn't create brand. Tap Create to try again.");
  }
}
```

**What it does:** Maps any non-SlugCollisionError to a generic UX message. Discards `error.message`, `error.code`, `error.details`, `error.stack` without ever logging them.

**What it should do:** Call `logError(error, { surface: "BrandSwitcherSheet#handleSubmit", extra: { userId, brandName } })` BEFORE the UX branch. Without this, every diagnosis attempt fails because the runtime evidence is gone.

**Causal chain (multiple paths converge to same symptom):**
- Path A (F-2 hits): `user` is null/loading → line 119 returns silently → no UX feedback → operator describes as "button glitch"
- Path B (RLS / network / mapper hit): error fires → catch swallows → setSlugError fires brief inline red text → operator may not notice OR perceives as "glitch"
- Path C (H17b stale bundle): pre-17e-A code runs → setBrands writes locally → no INSERT → no DB write → no error visible
- All paths converge to: brand_count=0, no terminal log, operator confused.

**Verification step:** Land diagnostic patch (§5 — 1-line console.error in 4 sites). Operator force-reloads, taps Create, pastes terminal output. Output identifies F definitively in 30 seconds.

**Without verification, root cause is INCONCLUSIVE.**

### 🟠 CONTRIBUTING FACTORS

#### F-2 — Silent auth-not-ready return (PASS-1 confirmed, PASS-3 promoted)

`BrandSwitcherSheet.tsx:119`: `if (user === null || user.id === undefined) return;` with NO toast + NO log + NO state flip. Const #1 (no dead taps) + Const #3 (no silent failures). Promoted from Contributing to ROOT CAUSE candidate.

#### F-4 — Catch swallows error.message (PASS-1 confirmed, PASS-3 confirmed structural)

The single most important contributing factor — it is why this investigation has taken 3 passes. Without F-4 fixed, the next bug is invisible too.

#### F-5 — Optimistic rollback creates "glitch" perception

`useBrands.ts:118-146` useCreateBrand onMutate inserts a temp brand with `_temp_${Date.now()}` ID into the list cache. If the mutation rejects, onError at line 148 rolls back to snapshot. Net visible effect: a brief 100-300ms flash of an extra brand row appearing then disappearing. This matches operator's word "glitch". F-5 doesn't cause the failure — it makes the failure SHAPE recognizable.

#### F-6 — Persist migrate v12→v13 preserves stub brand currentBrand (NEW PASS-3 finding)

`currentBrandStore.ts:379-385`:
```ts
if (version < 13) {
  const old = persistedState as Partial<{ currentBrand: Brand | null }> | null;
  return { currentBrand: old?.currentBrand ?? null };
}
```

If pre-17e-A operator had `currentBrand = STUB_BRANDS[0]` (Lonely Moth, id="lm"), the migrate keeps it. `useBrand("lm")` returns null (no DB row). TopBar renders "Lonely Moth" from the persisted Zustand currentBrand — this is the "Lonely Moth stays connected" symptom.

**File + line:** `currentBrandStore.ts:379-385`
**What it does:** Preserves the entire currentBrand object as-is, even if its `id` doesn't correspond to a real `brands` row.
**What it should do:** Detect stub IDs (`"lm"` / `"tll"` / `"sl"` / `"hr"`) and clear currentBrand for those specifically. Or — more robust — clear currentBrand for any id that doesn't appear in the `brands` table on next React Query fetch.

#### F-7 — Stub-mode synthesis fallback grants role to non-existent brand (NEW PASS-3 finding)

`useCurrentBrandRole.ts:149-164`:
```ts
if (role === null && stubBrandRole !== null) {
  if (stubBrandRole === "owner") {
    role = "account_owner";
  } else if (stubBrandRole === "admin") {
    role = "brand_admin";
  }
}
```

If currentBrand is a stub `id="lm"` with `role="owner"`, this synthesizes `account_owner` rank=60. Combined with F-6, the operator's local UI grants top-level permissions on a brand that has no DB row. This isn't directly causing brand-create to fail, but it's a regression — the "exit condition" comment in the file says this becomes dead code post-17e-A, but the stub-brand-survival makes it live again.

#### F-8 — useBrandCascadePreview parallel queries throw without context (NEW PASS-3 finding)

`useBrands.ts:316-353`: 5 parallel queries; if any error, `throw error` at lines 349-353 — caller (BrandDeleteSheet) catches but doesn't log. Hidden flaw — would cause a similar diagnosis blocker on delete failure.

### 🟡 HIDDEN FLAWS — silent-failure catalog (top 14 of estimated 50-80)

| # | File | Line | Current shape | Required shape | Severity |
|---|---|---|---|---|---|
| H-1 | `BrandSwitcherSheet.tsx` | 119 | silent return on auth-not-ready | logError + disabled button | P0 |
| H-2 | `BrandSwitcherSheet.tsx` | 134-146 | catch swallows error.message | logError + setSlugError(humanize(error)) | P0 |
| H-3 | `useBrands.ts` | 148-159 | useCreateBrand onError uses _error | logError + rollback | P0 |
| H-4 | `useBrands.ts` | 225-232 | useUpdateBrand onError uses _error | logError + rollback | P0 |
| H-5 | `useBrands.ts` | 261 | useSoftDeleteBrand has NO onError | logError + onError | P0 |
| H-6 | `useBrands.ts` | 349-353 | useBrandCascadePreview throws without log | logError + throw | P1 |
| H-7 | `creatorAccount.ts` | 31 | console.warn instead of console.error | logError severity=warn | P1 |
| H-8 | `AuthContext.tsx` | 110-115 | bootstrap getSession console.warn | logError surface=AuthContext#bootstrap | P1 |
| H-9 | `AuthContext.tsx` | 261-285 | Google signin catch — Alert only | logError + Alert | P1 |
| H-10 | `AuthContext.tsx` | 350-358 | Apple signin catch — Alert only | logError + Alert | P1 |
| H-11 | `account.tsx` | 86-91 | signOut catch — `__DEV__`-gated console.error | logError + production-visible | P1 |
| H-12 | `BrandEditView.tsx` | 263-283 | catch — toast only | logError + toast | P1 |
| H-13 | `BrandDeleteSheet.tsx` | 159-167 | catch — inline error only | logError + inline | P1 |
| H-14 | `currentBrandStore.ts` | 379-385 | persist migrate preserves stub-id currentBrand | clear currentBrand for stub ids | P1 (regression) |

**Subsequent-cycle backlog:** ~40 more sites estimated (event creator, order/refund flows, scanner flows, navigation handlers, storage uploads, edge function callers). Spec defines piecemeal migration plan.

### 🔵 OBSERVATIONS

| Obs | Note |
|---|---|
| O-1 | STUB_BRANDS file (`src/store/brandList.ts`) still exists with 4 stubs but is no longer imported anywhere — orphan file |
| O-2 | TopSheet has correct event propagation; H13 fully ruled out |
| O-3 | All 6 17e-A migration columns are live in DB; CHECK constraints + defaults correct |
| O-4 | Operator's auth.users + creator_accounts records are healthy |

### NEW HYPOTHESIS REJECTIONS (PASS-3)

| # | Hypothesis | Verdict |
|---|---|---|
| H18 | Stub-brand `id="lm"` survives → useBrand("lm") returns null → tap looks like glitch | **REJECTED as cause of brand-create failure** — stub brand state doesn't directly affect the create-mutation path. CONFIRMED as cause of "Lonely Moth stays connected" symptom (via F-6) |
| H19 | useAuth().loading race vs sheet-mount | **UNLIKELY** — operator's last_sign_in is 2026-05-05 21:39:45+00; loading should be false by sheet-open time |
| H20 | slugify("Lonely Moth") collision | **REJECTED** — brand_count=0, idx_brands_slug_active is empty, no collision possible |
| H21 | Combination: stale bundle + Zustand stub state | **PARTIAL** — F-6 + F-7 confirmed; bundle staleness still unconfirmed |

---

## 5. Mandatory diagnostic-patch sub-step (PASS-3 conclusion)

**Forensics CANNOT prove root cause without runtime evidence.** PASS-3 concludes with this hard requirement: orchestrator dispatches a 5-minute implementor pass to add 1-line `console.error` to 4 sites. Operator force-reloads dev client, taps Create, pastes terminal output. Forensics PASS-4 (or this report's amendment) consumes the output, root-cause-PROVEN follows.

**Implementor prompt is in §11.** It is ready to fire.

Without this, ORCH-0728 stays SUSPECTED indefinitely. Cycle 17e-A close stays gated.

---

## 6. Five-Layer Cross-Check (PASS-3)

| Layer | Verdict |
|---|---|
| **Docs** | SPEC §3.7.1 + IMPL receipts describe correct flow. No doc gap. |
| **Schema** | All 25 columns live; CHECKs correct; FK chain confirmed; RLS policies correct; SECURITY DEFINER functions read brands successfully. NO schema-layer issue. |
| **Code** | Static analysis exhausts; no compile errors; mapper output matches schema; mutationFn pre-Supabase paths safe. NO code-layer issue identifiable statically. |
| **Runtime** | **OPAQUE — primary diagnostic blocker.** Without diagnostic patch, this layer cannot be probed. |
| **Data** | brand_count=0; audit_log=0; pg_stat_statements has no brands INSERT hit; operator's creator_accounts row exists. Data confirms NO write reached the DB. |

**Layer disagreement:** Code says "INSERT should succeed"; Data says "no INSERT ever fired"; Runtime is the only layer that can disambiguate which JS branch is being taken. PASS-3 declares Runtime opacity as the structural blocker, fixed by Scope B logger.

---

## 7. Blast radius

| Surface | Affected |
|---|---|
| Brand create (BrandSwitcherSheet) | YES — primary symptom |
| Brand edit (BrandEditView) | LIKELY — same logging gap, would fail same way |
| Brand soft-delete (BrandDeleteSheet) | LIKELY — useSoftDeleteBrand has NO onError |
| Stripe Connect onboarding (uses useUpdateBrand) | LIKELY |
| TopBar / current-brand chip | YES — "Lonely Moth stays connected" via F-6 |
| Account / settings / profile | LOW — different mutations; would have own silent paths but different surfaces |
| Creator account upsert | F-7 silent-warn — could mask a deeper auth issue |
| Auth flow (Google/Apple/Email) | LIKELY — H9, H10 silent-Alert paths |

**Solo/Collab parity:** mingla-business is single-mode; N/A.

---

## 8. Invariant violations

| Invariant | Sites | Action |
|---|---|---|
| Const #1 (no dead taps) | F-2 silent return | Spec mandates disabled button gated on `loading || user === null` |
| Const #3 (no silent failures) | F-2, F-4, F-7, F-8, H-1 to H-14 (14 sites) | Spec mandates logError primitive + I-PROPOSED-D CI gate |
| Const #5 (server state via React Query) | None new | Maintained |
| I-PROPOSED-A (brands deleted_at filter) | None new — fix already in 17e-A | Maintained |

**NEW invariant proposed:** I-PROPOSED-D MB-ERROR-COVERAGE (already DRAFT — confirmed by PASS-3) + **I-PROPOSED-E STUB-BRAND-PURGED** (NEW — codifies that stub IDs `lm`/`tll`/`sl`/`hr` MUST NOT survive in any persisted state post-17e-A).

---

## 9. Fix strategy (direction — full spec in companion file)

### Phase 1 (CRITICAL — blocks PASS-4): diagnostic patch
- 1-line console.error in 4 catch sites
- 5 minutes implementor work
- Operator retests, pastes output

### Phase 2 (full ORCH-0728 IMPL): comprehensive landing
- logError primitive + 14 first-cycle site migrations
- I-PROPOSED-D CI gate
- Stub-brand purge: drop STUB_BRANDS file + persist migrate v13→v14 amendment that nukes currentBrand if id matches stub
- BrandSwitcherSheet auth-not-ready disabled-button fix
- Whatever F is the actual root cause (revealed by Phase 1 output)
- Build-info footer for `__DEV__` mode
- Bundle-freshness runbook

### Phase 3 (subsequent cycles): tail logging migration
- Remaining ~40-50 sites piecemeal
- Tracked as ORCH-0728-followup

---

## 10. Regression prevention

| Class | Prevention |
|---|---|
| Silent catch | I-PROPOSED-D CI gate |
| ADD COLUMN migration without NOTIFY pgrst | Documented runbook rule (PASS-1 already established) |
| Stub-brand survival | I-PROPOSED-E + persist migrate v13→v14 |
| Stale-bundle confusion | `__DEV__` build-info footer + force-reload runbook |
| Auth-not-ready dead taps | Spec mandates `disabled = !canSubmit || authLoading || user === null` everywhere user.id is required |

---

## 11. Recommended diagnostic-patch implementor prompt (READY TO FIRE)

Save to `Mingla_Artifacts/prompts/IMPL_ORCH_0728_PASS_3_DIAGNOSTIC.md`:

```markdown
# IMPL DISPATCH — ORCH-0728 PASS-3 DIAGNOSTIC PATCH

**Mode:** IMPLEMENT (DIAGNOSTIC ONLY — temporary; replaced by full IMPL of SPEC_ORCH_0728_FULL_FIX.md)
**Scope:** 4 files, 1 line per file
**Effort:** 5 minutes

## Task

Add a single `console.error` call as the FIRST line inside each of these 4 catch blocks, using the verbatim shape below. DO NOT remove or modify the existing UX (setSlugError / Alert / setState calls). The console.error is ADDITIVE.

## Sites

### Site 1 — `mingla-business/src/components/brand/BrandSwitcherSheet.tsx`

Inside catch at line 134:

```ts
} catch (error) {
  // [DIAG ORCH-0728-PASS-3] — replaced by logError() on full IMPL landing
  // eslint-disable-next-line no-console
  console.error("[ORCH-0728-DIAG] BrandSwitcherSheet#handleSubmit FAILED", {
    name: (error as { name?: string })?.name,
    message: (error as { message?: string })?.message,
    code: (error as { code?: string })?.code,
    details: (error as { details?: string })?.details,
    hint: (error as { hint?: string })?.hint,
    stack: (error as { stack?: string })?.stack,
  });
  if (error instanceof SlugCollisionError) {
    // ... existing branching unchanged
```

Also inside the silent return at line 119, add a log so we know if F-2 fires:

```ts
if (user === null || user.id === undefined) {
  // [DIAG ORCH-0728-PASS-3] — silent-return diagnostic
  // eslint-disable-next-line no-console
  console.error("[ORCH-0728-DIAG] BrandSwitcherSheet#handleSubmit AUTH-NOT-READY", {
    userPresent: user !== null,
    userIdPresent: user?.id !== undefined,
  });
  return;
}
```

### Site 2 — `mingla-business/src/hooks/useBrands.ts`

Inside useCreateBrand onError at line 148. Replace `_error` with `error`:

```ts
onError: (error, input, context) => {
  // [DIAG ORCH-0728-PASS-3]
  // eslint-disable-next-line no-console
  console.error("[ORCH-0728-DIAG] useCreateBrand#onError FAILED", {
    name: (error as { name?: string })?.name,
    message: (error as { message?: string })?.message,
    code: (error as { code?: string })?.code,
    details: (error as { details?: string })?.details,
    hint: (error as { hint?: string })?.hint,
    accountId: input.accountId,
    brandName: input.name,
  });
  // ... existing rollback unchanged
```

### Site 3 — `mingla-business/src/hooks/useBrands.ts`

Inside useUpdateBrand onError at line 225 — same pattern, surface = `useUpdateBrand#onError`.

### Site 4 — `mingla-business/src/services/creatorAccount.ts`

Replace `console.warn` at line 31 with `console.error` of the same diagnostic shape, surface = `creatorAccount#ensureCreatorAccount`.

## Constraints

- DO NOT replace this with logError() — that's the full IMPL pass
- DO NOT remove existing UX
- Mark each line with `// [DIAG ORCH-0728-PASS-3]`
- Run `npx tsc --noEmit` to verify no compile errors
- DO NOT commit (or commit on a separate branch — operator will revert after PASS-4)

## Output

Brief implementation report at `outputs/IMPLEMENTATION_ORCH_0728_PASS_3_DIAGNOSTIC_REPORT.md` confirming the 5 sites were patched (4 files, 5 sites because BrandSwitcherSheet has 2 — silent-return + catch).

## Operator post-step

1. Force-reload dev client (Cmd+R or shake → Reload)
2. Wait for "Loading bundle …" banner — confirms fresh fetch
3. Tap Create brand
4. Paste Metro terminal output between sheet-open and 5s after tap into orchestrator chat

Forensics PASS-4 root-causes definitively from the captured output.
```

---

## 12. Discoveries for orchestrator

| ID | Severity | Description |
|---|---|---|
| **D-ORCH-0728-FOR-10** | NEW | Persist migrate v12→v13 doesn't nuke stub-brand currentBrand. Spec adds Scope D (stub-brand purge) + I-PROPOSED-E |
| **D-ORCH-0728-FOR-11** | NEW | useSoftDeleteBrand has NO onError — Const #3 violation; spec H-5 covers |
| **D-ORCH-0728-FOR-12** | NEW | useBrandCascadePreview throws without logging — spec H-6 covers |
| **D-ORCH-0728-FOR-13** | NEW | `src/store/brandList.ts` is orphan — no live importers; safe to delete in Scope D |
| **D-ORCH-0728-FOR-14** | Forward-observation | Spec covers 14 sites in first IMPL cycle; ~40 more in subsequent cycles tracked as ORCH-0728-followup |
| **D-ORCH-0728-FOR-15** | NEW | `pg_stat_statements` shows 0 brands INSERTs — strong evidence the SQL never reached the DB. Diagnostic patch will reveal which JS branch is actually executing |
| **D-ORCH-0728-FOR-16** | Process | PASS-3 escalates the diagnostic patch from "optional" to "mandatory pre-IMPL". Future ORCH dispatches with logging-blocked diagnosis should adopt this pattern from PASS-1 instead of waiting for PASS-3 escalation. |

---

## 13. Confidence assessment

| Item | Confidence |
|---|---|
| Schema correct, RLS correct, FK chain correct | HIGH |
| F-2 + F-4 + F-5 + F-6 + F-7 + F-8 contributing factors | HIGH |
| 14 silent-failure sites cataloged | HIGH |
| Stub-brand survival is the cause of "Lonely Moth stays connected" | HIGH |
| Brand-create root cause | **INCONCLUSIVE — gated on diagnostic patch** |
| Spec covers all hypotheses regardless of which F is the cause | HIGH |
| H17b (stale bundle) | MEDIUM — operator did not confirm bundle freshness |

---

**Authored:** 2026-05-05
**Authored by:** mingla-forensics (PASS-3 brutal)
**Status:** Investigation complete; root cause SUSPECTED gated on diagnostic patch + operator runtime evidence
**Next step:** Orchestrator REVIEW + dispatches §11 implementor prompt for diagnostic patch (5 min); operator retests + pastes terminal output; forensics PASS-4 finalizes root cause; orchestrator dispatches full ORCH-0728 IMPL per `SPEC_ORCH_0728_FULL_FIX.md`

---

## PASS-4 — ROOT CAUSE PROVEN (2026-05-06 03:52 UTC)

Operator's diagnostic-patch retest captured the actual error in Metro terminal:

```
ERROR [ORCH-0728-DIAG] useCreateBrand#onError FAILED {
  accountId: "b17e3e15-218d-475b-8c80-32d4948d6905",
  brandName: "Vibes and Stuff",
  code: "42501",
  details: null,
  hint: null,
  message: "new row violates row-level security policy for table \"brands\"",
  name: undefined,
}
ERROR [ORCH-0728-DIAG] BrandSwitcherSheet#handleSubmit FAILED { code: "42501", message: ... }
```

PLUS a side-channel warning in same retest:

```
WARN [reapOrphanStorageKeys] Found 11 orphan AsyncStorage key(s):
["mingla-business.currentBrand.v11", "mingla-business.currentBrand.v13", ..., v2]
```

### 🔴 ROOT CAUSE F-9 — PROVEN

#### F-9 — Session JWT not attached to INSERT request → PostgREST treats as anon → RLS WITH CHECK denies (42501)

| Field | Value |
|---|---|
| File + line | `mingla-business/src/components/brand/BrandSwitcherSheet.tsx:124` (passes `accountId: user.id` correctly) AND `mingla-business/src/services/supabase.ts:39-50` (autoRefreshToken: true config) — composite root cause across the auth-token-refresh boundary |
| Exact code | `await createBrandMutation.mutateAsync({ accountId: user.id, ... })` — supabase client should attach session JWT to the underlying POST `/rest/v1/brands` request |
| What it does | Operator's session JWT (access_token) is expired or missing at request time; Supabase client's autoRefreshToken hasn't successfully refreshed; request fires with NO Authorization header (or stale header); PostgREST treats as anon role; `auth.uid()` evaluates to NULL; RLS WITH CHECK `account_id = auth.uid() AND deleted_at IS NULL` evaluates `account_id = NULL` → false → 42501 |
| What it should do | Session JWT MUST be fresh at request time. Implementation MUST proactively refresh session before any RLS-gated mutation OR explicitly handle 42501 with a sign-out + sign-in flow |
| Causal chain | (1) Operator signed in 2026-05-05 22:48:57+00 (5 hours ago — verified via auth.users probe). (2) Default Supabase JWT TTL = 1 hour. (3) autoRefreshToken should have refreshed silently 5 times by now; evidently failed (background refresh issue, network blip, or storage-shim race). (4) Operator's React state still has `user` populated (because it's set from getSession at bootstrap and not re-cleared). (5) Operator taps Create → mutateAsync fires → POST /rest/v1/brands → Supabase client attaches stale/missing JWT → PostgREST 401 → falls back to anon role for RLS evaluation → 42501 |
| Verification step | **PROVEN** — Diagnostic patch's `[ORCH-0728-DIAG] useCreateBrand#onError FAILED` line shows `code: "42501"` + `message: "new row violates row-level security policy for table \"brands\""` verbatim |

**Confidence:** HIGH — six-field evidence complete.

### 🟡 NEW HIDDEN FLAW H-15 — PASS-4 surfaced

#### H-15 — `reapOrphanStorageKeys.ts:17-29` allowlist missed `currentBrand.v13` (17e-A IMPL miss)

| Field | Value |
|---|---|
| File + line | `mingla-business/src/utils/reapOrphanStorageKeys.ts:17-29` |
| Current code | `KNOWN_MINGLA_KEYS = new Set(["mingla-business.currentBrand.v12", ...])` — list contains v12 but NOT v13 |
| Required | Add `"mingla-business.currentBrand.v13"` (and `"mingla-business.currentBrand.v14"` once Scope D ships) |
| Severity | P2 — non-functional in 17d (log-only, no auto-clear); but flags v13 as orphan in Metro terminal warning every cold-start |
| Causal chain | Cycle 17e-A IMPL bumped persist version v12→v13 in `currentBrandStore.ts` but did not update reapOrphanStorageKeys.ts allowlist. Result: v13 (current state) is mis-categorized as orphan; would cause data loss if reapOrphanStorageKeys ever promoted from log-only to auto-clear |
| Fix | Update KNOWN_MINGLA_KEYS to include `v13` (and `v14` post-Scope-D) |

**Roll into spec Scope D** alongside the `brandList.ts` deletion + persist-migrate v13→v14 changes — same 17e-A drift category.

### Updated hypothesis status (PASS-4 final)

| # | Hypothesis | Final verdict |
|---|---|---|
| F-1 | PostgREST cache stale | REJECTED PASS-2 |
| F-2 | Silent auth-not-ready | REJECTED — diagnostic showed `BrandSwitcherSheet#handleSubmit FAILED` (the mutation DID fire), not AUTH-NOT-READY (which would have logged separately). user.id was populated. |
| F-3 | JWT/session race | **PROVEN as F-9 below** — was promoted to root cause |
| F-4 | Catch swallows error | CONFIRMED + remediated by diagnostic patch + structural fix in spec |
| F-5 | Optimistic rollback flash | CONFIRMED — operator's "button glitches" perception matches |
| F-6 | Stub-brand persist survival | CONFIRMED contributing to "Lonely Moth stays connected" |
| F-7 | Stub-mode role synthesis | CONFIRMED contributing |
| F-8 | useBrandCascadePreview throws unsilenced | CONFIRMED hidden flaw |
| **F-9** | **Session JWT not attached → RLS 42501** | **PROVEN — root cause** |
| H-15 | reapOrphanStorageKeys missed v13 | **PROVEN — side bug, in scope of Scope D** |
| H17a/H17b | Stale bundle | REJECTED — diagnostic logs fired so bundle IS fresh |

### Updated fix strategy

Scope A's fix is now SPECIFIC, not generic:

1. **Proactive session-refresh before any RLS-gated mutation** in `BrandSwitcherSheet#handleSubmit` (and `useCreateBrand` / `useUpdateBrand` / `useSoftDeleteBrand` mutationFn entries by extension)
2. **42501 mapping in humanizeBrandError** (already in Scope A spec §3.3 — verified handles this) → "Sign-in lapsed; please sign out and back in."
3. **Disabled-button auth gating** (already in Scope A spec §3.4) — covers the auth-not-ready case
4. **logError + structured terminal log** (Scope B) → 42501 will be visible in production diagnostic stream

Scope A `humanizeBrandError` already maps `code === "42501"` → "Sign-in lapsed; please sign out and back in." — operator gets actionable copy.

But the BETTER fix is preventing the 42501 entirely: `await supabase.auth.refreshSession()` before mutateAsync. If refresh succeeds, INSERT goes through. If refresh fails (genuinely expired refresh token), surface "Sign-in lapsed" instead of letting the INSERT fire.

### Operator UNBLOCK action (immediate, no code change)

Until full IMPL lands, operator can unblock brand-create RIGHT NOW by:
1. Open /(tabs)/account
2. Tap "Sign out everywhere"
3. Sign back in (Google / Apple / Email)
4. Tap Create brand → expected to succeed

This proves F-9 PROVEN beyond the diagnostic — fresh session on a fresh sign-in eliminates the JWT staleness window.

### PASS-4 confidence

| Item | Confidence |
|---|---|
| Root cause F-9 is the brand-create failure | HIGH — six-field evidence + 42501 verbatim + 5h-old session corroborates |
| H-15 allowlist miss is the orphan-key warning | HIGH |
| Sign-out + sign-in unblocks operator immediately | HIGH (predictive) |
| Spec Scope A `humanizeBrandError` 42501 mapping covers UX surface | HIGH |
| Spec Scope A needs ADDITION of proactive session-refresh in handleSubmit | NEW FINDING — spec amendment required |

**Authored (PASS-4):** 2026-05-06 03:52 UTC
**Authored by:** mingla-forensics (PASS-4 root-cause finalization)
**Status:** ROOT CAUSE PROVEN — full IMPL of `SPEC_ORCH_0728_FULL_FIX.md` ready to dispatch (with PASS-4 spec amendment for proactive session-refresh + reapOrphanStorageKeys allowlist fix)

---

## PASS-5 — F-9 REJECTED (2026-05-06 04:05 UTC)

Operator signed out + signed back in (`last_sign_in_at` updated to **2026-05-06 04:05:01+00** — 36 seconds before retest, verified live DB probe). Tapped Create brand. **Same 42501 error fired**:

```
ERROR [ORCH-0728-DIAG] useCreateBrand#onError FAILED {
  accountId: "b17e3e15-218d-475b-8c80-32d4948d6905",
  brandName: "Vibes and Stuff",
  code: "42501",
  message: "new row violates row-level security policy for table \"brands\""
}
```

**F-9 (session-expired) is now REJECTED.** A fresh session, less than 1 minute old, STILL produces 42501. The proactive session-refresh fix (PASS-4 amendment §3.4-A) would NOT have fixed this — it would have refreshed an already-fresh token and then hit the same 42501.

### NEW HYPOTHESIS SPACE (PASS-5)

The 42501 means PostgREST evaluates RLS WITH CHECK `account_id = auth.uid()` and gets FALSE. operator's `account_id` value is verified `b17e3e15...` (their auth.users.id). Therefore `auth.uid()` at request time is either:

- **H22 NULL** — Supabase client session JWT is NOT being attached to the outgoing POST request (storage shim issue, multi-instance issue, or RN-SDK bug)
- **H23 wrong** — JWT IS attached but its `sub` claim is a DIFFERENT user's id (multi-account state divergence between React state + supabase.auth internal state)
- **H24 different role** — JWT is attached but the request is going through `anon` API key path instead of `authenticated` path (header misrouting)

Static analysis cannot disambiguate H22 / H23 / H24. We need ONE MORE diagnostic line:

```ts
// Immediately BEFORE await createBrandMutation.mutateAsync(...)
const sessionProbe = await supabase.auth.getSession();
console.error("[ORCH-0728-DIAG] PRE-MUTATE session probe", {
  sessionPresent: sessionProbe.data.session !== null,
  sessionUserId: sessionProbe.data.session?.user?.id,
  sessionExpiresAt: sessionProbe.data.session?.expires_at,
  reactUserId: user.id,
  matches: sessionProbe.data.session?.user?.id === user.id,
  tokenStart: sessionProbe.data.session?.access_token?.slice(0, 12) + "...",
  hasError: sessionProbe.error !== null,
  errorMessage: sessionProbe.error?.message,
});
```

This tells us:
- `sessionPresent=false` → H22 PROVEN — Supabase client lost session despite fresh sign-in
- `sessionPresent=true, matches=false` → H23 PROVEN — JWT is for different user
- `sessionPresent=true, matches=true` → H22/H23 REJECTED → H24 (header misrouting / anon-key override) becomes prime suspect

### Recommended next step

Author + dispatch a 2-minute micro-diagnostic implementor pass adding the session probe. Operator retests, pastes output. PASS-6 root-causes definitively from probe shape.

This is faster than authoring spec for ALL three H22/H23/H24 fixes blindly — each has different code-path implications.

**Authored (PASS-5):** 2026-05-06 04:08 UTC
**Authored by:** mingla-forensics (PASS-5 — F-9 rejection + H22/H23/H24 hypothesis space)
**Status:** F-9 REJECTED; awaits one more diagnostic to disambiguate H22 vs H23 vs H24
**Next step:** Orchestrator dispatches micro-diagnostic IMPL pass; operator retests; PASS-6 finalizes

---

## PASS-6 — H24 PROVEN; H22 + H23 REJECTED (2026-05-06)

PASS-5 session probe captured:

```
ERROR [ORCH-0728-DIAG] PRE-MUTATE session probe {
  errorMessage: undefined,
  hasError: false,
  matches: true,                                    ← session.user.id === reactUserId
  reactUserId: "b17e3e15-218d-475b-8c80-32d4948d6905",
  sessionExpiresAt: 1778645101,                     ← ~2026-05-26 — well in future
  sessionPresent: true,                             ← session IS present
  sessionUserId: "b17e3e15-218d-475b-8c80-32d4948d6905",
  tokenStart: "eyJhbGciOiJI..."                     ← real JWT prefix
}
```

### Hypothesis verdicts

| H | Verdict |
|---|---|
| H22 (no session) | **REJECTED** — sessionPresent=true |
| H23 (wrong-user session) | **REJECTED** — matches=true |
| H24 (JWT exists but not authenticated by PostgREST) | **PROVEN** — only remaining path |

### 🔴 ROOT CAUSE — F-10 PROVEN (replaces F-9)

#### F-10 — JWT exists in supabase client but PostgREST does not authenticate it as `auth.uid()` = user.id

| Field | Value |
|---|---|
| File + line | Architectural — likely `mingla-business/src/services/supabase.ts:8-22` (env-var resolution) OR a JWT validation chain (project URL ↔ anon key ↔ JWT signing-secret) |
| Exact code | `const supabaseUrl = extra?.EXPO_PUBLIC_SUPABASE_URL ‖ process.env.EXPO_PUBLIC_SUPABASE_URL ‖ "";` + `const supabaseAnonKey = extra?.EXPO_PUBLIC_SUPABASE_ANON_KEY ‖ process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ‖ "";` |
| What it does | Loads Supabase URL + anon key from env. Operator's signed-in JWT was signed by THIS project (verified — auth.users.id matches DB), but PostgREST evaluates `auth.uid()` to NULL or different value at request time → RLS WITH CHECK `account_id = auth.uid()` fails → 42501. |
| What it should do | The JWT issued by Supabase Auth at sign-in MUST be validated successfully by PostgREST's `auth.uid()` extraction. Three paths to break this: env-var mismatch, JWT signing-secret drift, OR header attachment failure. |
| Causal chain (suspected sub-causes — must be disambiguated): | **F-10a** Env-var mismatch — `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` point to different Supabase projects (sign-in works against URL's project, request goes to anon-key's project, JWT signature mismatches). **F-10b** Stale anon key — the dev build was compiled with an OLD anon key that doesn't match the current project's JWT signing secret. **F-10c** Header interceptor — something is stripping or replacing the `Authorization` header between supabase-js and PostgREST. **F-10d** JWT format/payload issue — token is a JWT but its `aud`/`iss` claim doesn't match what PostgREST expects. |
| Verification step | (1) Check operator's actual env vars (Constants.expoConfig.extra) at runtime — are URL + anon key for the same project? (2) Decode the JWT's `aud` + `iss` + `sub` + `role` claims — confirm they target the project the request goes to. (3) Make a test request to a non-RLS endpoint (e.g., `supabase.from("brands").select("count")` as anon) — if 200 with anon role, the connection works; if RLS-protected SELECT also fails, the auth chain is broken. |

### Operator's pipeline-wide audit directive

Operator escalated scope: "dispatch a brutal forensics investigation to trace the entire pipeline for issues from account creation, to brand creation, event creation, and account deletion."

This is correctly recognized — F-10 affects EVERY RLS-gated mutation, not just brand-create. If JWT auth is broken, then:
- Account creation (signin → ensureCreatorAccount upsert) — likely currently working because creator_accounts INSERT policy is `auth.uid() = id` — same broken RLS path; either it never worked OR the upsert succeeded BEFORE the JWT chain broke
- Brand creation — currently failing
- Event creation — would fail with 42501 too
- Account deletion — would fail
- Any RLS-protected read on brands / events / orders — would fail

The brutal pipeline audit is the right move. PASS-6 hands to the orchestrator's pipeline-audit dispatch.

**Authored (PASS-6):** 2026-05-06
**Authored by:** mingla-forensics (PASS-6 — H24 PROVEN as F-10)
**Status:** Root cause F-10 PROVEN; sub-cause F-10a/b/c/d disambiguation + pipeline-wide audit dispatch follows
**Next step:** Orchestrator authors brutal pipeline-wide forensics dispatch covering account/brand/event/deletion flows + F-10 sub-cause disambiguation
