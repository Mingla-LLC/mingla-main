# SPEC — ORCH-0728 (Brand-create fix + mingla-business `logError` infrastructure)

**Mode:** SPEC (companion to investigation)
**Investigation anchor:** [`reports/INVESTIGATION_ORCH_0728_BRAND_CREATE_GLITCH_AND_LOGGING.md`](../reports/INVESTIGATION_ORCH_0728_BRAND_CREATE_GLITCH_AND_LOGGING.md)
**Authored:** 2026-05-05

---

## 1. Plain-English layman summary

Build one error-logging primitive (`logError`) that ALL future caught errors in mingla-business call. It writes structured logs to the terminal — surface name, screen path, mutation name, user id, error code, stack — so we can SEE every failure in real time. Wire 12 high-priority sites in this cycle including the brand-create site. Add a CI gate so future code can't silently swallow. Fix the brand-create UX so auth-not-ready taps don't dead-tap. Add a migration discipline rule that `NOTIFY pgrst, 'reload schema'` lands at the end of every ADD COLUMN migration so PostgREST cache never lags.

After this cycle ships, the operator's question "what error?" gets answered in 1 second from terminal output. The brand-create button works (because cache reload removes F-1). And future glitches are diagnosable on first occurrence, not after a 6-step forensic investigation.

---

## 2. Scope + non-goals + assumptions

### 2.1 Scope (IN)

- **Scope A bug fix:**
  - Add `NOTIFY pgrst, 'reload schema'` to migration `20260506000000` (idempotent retroactive — append-or-no-op pattern via a new follow-up migration `20260506000001_notify_pgrst.sql`)
  - Fix BrandSwitcherSheet auth-not-ready silent return (F-2): button disabled until auth is ready
  - Replace generic catch-all error message with surfaced real error message (when safe — not raw SQL state, but `error.message` after sanitization)
- **Scope B logging primitive:**
  - NEW utility `mingla-business/src/utils/logError.ts` — single function with structured tag schema
  - NEW CI gate `.github/scripts/strict-grep/i-proposed-d-mb-error-coverage.mjs` per registry pattern
  - NEW invariant **I-PROPOSED-D MB-ERROR-COVERAGE** (DRAFT → ACTIVE on CLOSE)
  - Workflow registration in `.github/workflows/strict-grep-mingla-business.yml`
  - First-cycle migration of **12 high-priority sites** (table §3.6 below)
- **Operator runbook update:** ADD COLUMN migration template includes NOTIFY pgrst as final statement

### 2.2 Non-goals (OUT)

- Migration of remaining ~44 logging sites (subsequent cycles)
- App-mobile or mingla-admin error-logging (different products, different scope)
- Sentry / DataDog / external sink integration — spec defines adapter interface ONLY; no actual integration
- Any UI redesign of error-state surfaces (toast/modal copy stays as-is unless directly impacted)
- 17e-B Tier 2 cover/avatar picker UI
- B-cycle backend wires

### 2.3 Assumptions

- **A-1** Operator retests brand-create AFTER `NOTIFY pgrst, 'reload schema'` was issued during forensics (2026-05-05). If create succeeds → F-1 is the root cause and Scope A's main fix is the migration-template addendum + auth-not-ready guard. If create still fails → F-2/F-3 promote and Scope A expands.
- **A-2** Console.error output is visible in operator's `npx expo start` terminal. (If not — confirmed iOS Metro bundler shows console.error in terminal natively.)
- **A-3** No existing logError-style util in mingla-business (verified — `mingla-business/src/utils/` does not contain one).
- **A-4** `app-mobile/src/utils/edgeFunctionError.ts` exists as the app-mobile equivalent; mingla-business spec borrows the duck-typing pattern but is a separate file (no cross-package import).

---

## 3. Layer-by-layer specification

### 3.1 Database layer

#### 3.1.1 NEW migration: `supabase/migrations/20260506000001_notify_pgrst_reload.sql`

```sql
-- Cycle ORCH-0728: ensure PostgREST schema cache reloads after the brand-columns migration
-- (20260506000000) so the new kind/address/cover_hue/cover_media_url/cover_media_type/
-- profile_photo_type columns are visible to the API immediately.
--
-- This is a one-time NOTIFY; it is also the template pattern future ADD COLUMN
-- migrations should mirror as their final statement (per ORCH-0728 SPEC §3.7
-- migration discipline rule + I-PROPOSED-D regression prevention).

NOTIFY pgrst, 'reload schema';
```

#### 3.1.2 No new tables, no new columns, no RLS changes, no constraint changes

#### 3.1.3 Migration order

1. Apply `20260506000001_notify_pgrst_reload.sql` via `supabase db push`.
2. PostgREST reloads schema cache (within seconds).

### 3.2 NEW utility — `mingla-business/src/utils/logError.ts`

#### 3.2.1 File path + signature

```ts
// mingla-business/src/utils/logError.ts

export type LogSurface =
  // Format: "ComponentName#methodName" or "hookName#mutationFn" or "service#functionName"
  string;

export interface LogErrorOptions {
  /**
   * Stable tag identifying the call site. Format:
   *   "<ComponentName>#<methodName>" (UI catches)
   *   "<hookName>#<phase>"           (React Query — phase = mutationFn|onError|onMutate|onSuccess)
   *   "<serviceName>#<functionName>" (services)
   * Must NOT be parameterized — use `extra` for dynamic values.
   */
  surface: LogSurface;
  /**
   * Optional context. Logged verbatim. NEVER include PII (no raw email, no
   * full session JWT, no password). User id (UUID) is fine.
   */
  extra?: Record<string, unknown>;
  /**
   * Marks this call as an intentional swallow — no remote-sink dispatch even
   * when the adapter is wired. CI gate still verifies presence of logError;
   * `swallow: true` documents auditor-readable intent. Default false.
   */
  swallow?: boolean;
  /**
   * Severity. Defaults to "error". Use "warn" for recoverable degradations,
   * "info" for non-error events tagged for diagnostic purposes.
   */
  severity?: "error" | "warn" | "info";
}

/**
 * Structured error logging primitive for mingla-business.
 *
 * Wraps every caught error with a stable surface tag + user/screen context.
 * Writes to console.error (severity="error") or console.warn (severity="warn"|"info")
 * with a deterministic `[mb-error]` prefix that operators can grep in terminal.
 *
 * Per Cycle ORCH-0728 SPEC §3.2. Codified by I-PROPOSED-D MB-ERROR-COVERAGE.
 *
 * USAGE:
 *
 *   try {
 *     await mutateAsync(input);
 *   } catch (error) {
 *     logError(error, {
 *       surface: "BrandSwitcherSheet#handleSubmit",
 *       extra: { userId: user?.id ?? null, brandName: trimmedName },
 *     });
 *     setSlugError(humanizeBrandCreateError(error));
 *   }
 *
 * NEVER do:
 *   } catch (error) { console.log(error); }   ← unstructured, hard to grep
 *   } catch () {}                              ← Const #3 silent failure
 *   } catch (error) { /* eslint-disable */ }   ← swallows without marker
 */
export function logError(error: unknown, options: LogErrorOptions): void;
```

#### 3.2.2 Implementation contract

```ts
// (Implementor writes the body — this is the contract)

export function logError(error: unknown, options: LogErrorOptions): void {
  const ts = new Date().toISOString();
  const severity = options.severity ?? "error";

  // Extract error fields safely (Postgrest errors have circular refs in some shapes)
  // Pattern adapted from app-mobile/src/utils/edgeFunctionError.ts duck-typing.
  const errMessage =
    typeof (error as { message?: unknown })?.message === "string"
      ? (error as { message: string }).message
      : String(error);
  const errCode =
    typeof (error as { code?: unknown })?.code === "string"
      ? (error as { code: string }).code
      : undefined;
  const errDetails =
    typeof (error as { details?: unknown })?.details === "string"
      ? (error as { details: string }).details
      : undefined;
  const errHint =
    typeof (error as { hint?: unknown })?.hint === "string"
      ? (error as { hint: string }).hint
      : undefined;
  const errStack =
    typeof (error as { stack?: unknown })?.stack === "string"
      ? (error as { stack: string }).stack
      : undefined;

  const lines: string[] = [];
  lines.push(`[mb-${severity}] surface=${options.surface} ts=${ts}`);
  if (errCode !== undefined) lines.push(`  code=${errCode}`);
  lines.push(`  message=${JSON.stringify(errMessage)}`);
  if (errDetails !== undefined) lines.push(`  details=${JSON.stringify(errDetails)}`);
  if (errHint !== undefined) lines.push(`  hint=${JSON.stringify(errHint)}`);
  if (options.extra !== undefined) {
    lines.push(`  extra=${JSON.stringify(options.extra)}`);
  }
  if (options.swallow === true) {
    lines.push(`  swallow=true`);
  }
  if (errStack !== undefined) {
    lines.push(`  stack:\n${errStack}`);
  }

  const output = lines.join("\n");

  // Severity routing — terminal/dev tools color-code these differently
  if (severity === "error") {
    // eslint-disable-next-line no-console
    console.error(output);
  } else if (severity === "warn") {
    // eslint-disable-next-line no-console
    console.warn(output);
  } else {
    // eslint-disable-next-line no-console
    console.info(output);
  }

  // Future: optional remote sink — see §3.2.3
}
```

#### 3.2.3 Future remote-sink adapter (interface ONLY in this cycle)

```ts
// Reserved interface — NOT implemented in ORCH-0728. Documented so future
// cycles can wire Sentry / DataDog / Mixpanel without changing call sites.

export interface LogErrorRemoteSink {
  send(payload: {
    surface: string;
    severity: "error" | "warn" | "info";
    timestamp: string;
    error: { message: string; code?: string; details?: string; stack?: string };
    extra?: Record<string, unknown>;
  }): Promise<void>;
}

// In a future cycle, logError() may dispatch to a registered sink IF
// `options.swallow !== true`. Until that cycle, the sink stays null and
// logError is console-only.
```

### 3.3 NEW CI gate — `.github/scripts/strict-grep/i-proposed-d-mb-error-coverage.mjs`

#### 3.3.1 Gate logic (regex-based per registry pattern)

```js
#!/usr/bin/env node
/**
 * I-PROPOSED-D strict-grep gate — every catch in mingla-business MUST log via logError.
 *
 * Gate logic:
 *   For every .ts / .tsx file in mingla-business/src/ + mingla-business/app/:
 *     For every `catch (error)` or `catch (e)` or `catch (err)` block:
 *       The first non-blank line INSIDE the catch body MUST be a call to logError(...)
 *       OR the catch body must contain logError(...) within the first 5 lines
 *       UNLESS line immediately above the catch keyword has:
 *         // orch-strict-grep-allow mb-error-coverage — <reason>
 *
 * (Rationale: most catches are 1-3 lines + a setState. Requiring logError in
 * the first 5 lines is permissive enough for the common shape but tight enough
 * to catch the swallowing pattern.)
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one violation
 *   2 — script error
 *
 * Established by ORCH-0728 SPEC §3.3 + I-PROPOSED-D.
 */
```

#### 3.3.2 Allowlist tag

`// orch-strict-grep-allow mb-error-coverage — <reason>`

Examples of legitimate allowlist:
- `Linking.openURL().catch(() => {})` (URL open failure with no useful surface — reason: "Linking handles dialogs natively; no surface needed")
- `await GoogleSignin.signOut(); /* ignore */` (cleanup-only)

Test fixtures live in `.github/scripts/strict-grep/__fixtures-d/` (NEW dir) — synthetic violation + clean.

#### 3.3.3 Workflow registration

Append to `.github/workflows/strict-grep-mingla-business.yml`:

```yaml
  i-proposed-d-mb-error-coverage:
    name: "I-PROPOSED-D: catch blocks call logError"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Run I-PROPOSED-D gate
        run: node .github/scripts/strict-grep/i-proposed-d-mb-error-coverage.mjs
```

Update README in `.github/scripts/strict-grep/README.md` Active gates table.

### 3.4 Component fix — `BrandSwitcherSheet.tsx`

#### 3.4.1 Auth-not-ready guard (replaces F-2 silent return)

**Replace:**
```ts
if (user === null || user.id === undefined) return;
```

**With:** disabled button while `loading || user === null`. Plus retain a defensive logError if somehow tap fires.

```ts
const { user, loading: authLoading } = useAuth();
// ...
const canSubmit = useMemo(() => trimmedName.length > 0 && !authLoading && user !== null, [trimmedName, authLoading, user]);
// Button disabled binding: disabled={!canSubmit || submitting}
// Inside handleSubmit:
if (!canSubmit || submitting) return;
if (user === null || user.id === undefined) {
  // Defensive — should be unreachable given canSubmit guard
  logError(new Error("auth-not-ready-on-tap"), {
    surface: "BrandSwitcherSheet#handleSubmit",
    extra: { authLoading, userPresent: user !== null },
  });
  setSlugError("Sign-in finishing — try again in a moment.");
  return;
}
```

**Note:** `useAuth()` already returns `loading`. AuthContext.tsx:96 has `loading` state. Spec just consumes it.

#### 3.4.2 Catch surfaces real error after logError

**Replace:**
```ts
} catch (error) {
  if (error instanceof SlugCollisionError) {
    setSlugError("This brand name is taken. Try a small variation (e.g. \"" + trimmedName + " Events\").");
  } else {
    setSlugError("Couldn't create brand. Tap Create to try again.");
  }
}
```

**With:**
```ts
} catch (error) {
  logError(error, {
    surface: "BrandSwitcherSheet#handleSubmit",
    extra: { userId: user.id, brandName: trimmedName, accountId: user.id },
  });
  if (error instanceof SlugCollisionError) {
    setSlugError("This brand name is taken. Try a small variation (e.g. \"" + trimmedName + " Events\").");
  } else {
    // F-4 fix: surface the real error message so operator can self-diagnose
    // when terminal access is unavailable. Sanitize: prefer error.message,
    // fall back to generic. Strip raw SQL state codes from user-visible copy.
    const msg = humanizeBrandCreateError(error);
    setSlugError(msg);
  }
}
```

NEW helper `humanizeBrandCreateError(error: unknown): string`:
- If `(error as { code: string }).code === "PGRST204"` → "App is updating — please retry in a moment."
- If `(error as { code: string }).code === "42501"` → "Sign-in lapsed; please sign out and back in."
- If `(error as { code: string }).code === "23505"` → "This brand name is taken. Try a small variation."
- Else → "Couldn't create brand. Tap Create to try again. (Error: <error.message slice 80>)"

The verbose `(Error: ...)` suffix in the fallback gives operator a 1-second hint without needing terminal.

### 3.5 Hook fixes — `useBrands.ts`

#### 3.5.1 useCreateBrand onError adds logError BEFORE rollback

```ts
onError: (error, input, context) => {
  logError(error, {
    surface: "useCreateBrand#onError",
    extra: { accountId: input.accountId, name: input.name, contextHadSnapshot: context?.snapshot !== undefined },
  });
  // Existing rollback unchanged...
}
```

#### 3.5.2 useUpdateBrand onError — same pattern

```ts
onError: (error, { brandId, accountId }, context) => {
  logError(error, {
    surface: "useUpdateBrand#onError",
    extra: { brandId, accountId },
  });
  // Existing rollback unchanged...
}
```

#### 3.5.3 useSoftDeleteBrand — add onError where currently absent

```ts
const mutation = useMutation<SoftDeleteResult, Error, SoftDeleteBrandInput>({
  mutationFn: async ({ brandId }) => softDeleteBrand(brandId),
  onError: (error, { brandId, accountId }) => {
    logError(error, {
      surface: "useSoftDeleteBrand#onError",
      extra: { brandId, accountId },
    });
  },
  onSuccess: (result, { brandId, accountId }) => { /* unchanged */ },
});
```

This restores Const #3 compliance for useSoftDeleteBrand which previously had no onError.

#### 3.5.4 useBrandCascadePreview queryFn — wrap inner errors with logError before throw

```ts
queryFn: async () => {
  // ... existing parallel queries ...
  if (pastResult.error) {
    logError(pastResult.error, {
      surface: "useBrandCascadePreview#pastEvents",
      extra: { brandId },
    });
    throw pastResult.error;
  }
  // Same pattern for upcoming/live/team/stripe...
}
```

### 3.6 First-cycle site migration table (12 sites)

| # | File | Line(s) | Current | New surface tag |
|---|---|---|---|---|
| 1 | `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` | 134-146 | catch swallows error | `BrandSwitcherSheet#handleSubmit` |
| 2 | `mingla-business/src/components/brand/BrandEditView.tsx` | 263-283 | catch surfaces toast only | `BrandEditView#handleSave` |
| 3 | `mingla-business/src/components/brand/BrandDeleteSheet.tsx` | 159-167 | catch surfaces inline error | `BrandDeleteSheet#handleSubmit` |
| 4 | `mingla-business/src/hooks/useBrands.ts` | 148-159 | onError unused-prefix `_error` | `useCreateBrand#onError` |
| 5 | `mingla-business/src/hooks/useBrands.ts` | 225-232 | onError unused-prefix `_error` | `useUpdateBrand#onError` |
| 6 | `mingla-business/src/hooks/useBrands.ts` | 261 | no onError at all | `useSoftDeleteBrand#onError` (NEW) |
| 7 | `mingla-business/src/hooks/useBrands.ts` | 349-353 | parallel query error throws | `useBrandCascadePreview#parallelQueries` |
| 8 | `mingla-business/src/services/creatorAccount.ts` | 30-32 | console.warn — replace | `creatorAccount#ensureCreatorAccount` |
| 9 | `mingla-business/src/context/AuthContext.tsx` | 110-115 | bootstrap getSession error: console.warn | `AuthContext#bootstrap` |
| 10 | `mingla-business/src/context/AuthContext.tsx` | 261-285 | Google signIn catch — Alert only | `AuthContext#signInWithGoogle` |
| 11 | `mingla-business/src/context/AuthContext.tsx` | 350-358 | Apple signIn catch — Alert only | `AuthContext#signInWithApple` |
| 12 | `mingla-business/app/(tabs)/account.tsx` | 86-91 | signOut catch — `__DEV__`-gated console.error | `AccountTab#handleSignOut` |

Each site gains one `logError(error, { surface, extra })` call. Existing toast/Alert/inline-error UX surfaces preserved (logError is additive — does NOT replace user-visible error feedback).

### 3.7 Migration discipline — operator runbook

Add to `Mingla_Artifacts/INVARIANT_REGISTRY.md` under I-PROPOSED-D:

> **Migration template addendum:** Every migration file that contains `ALTER TABLE ... ADD COLUMN` MUST end with the line:
> ```sql
> NOTIFY pgrst, 'reload schema';
> ```
> Without this, PostgREST's schema cache lags `ALTER TABLE` and INSERTs with new columns return PGRST204. ORCH-0728 root cause; structural prevention.

This is documented prose, NOT a CI gate. Operator-checked at migration-author time.

---

## 4. Success criteria (numbered)

| # | Criterion | Verification |
|---|---|---|
| **SC-A-1** | Brand-create fires successfully end-to-end after the migration NOTIFY lands | Operator runtime smoke #2 passes |
| **SC-A-2** | If brand-create fails (any reason), terminal shows `[mb-error] surface=BrandSwitcherSheet#handleSubmit code=<X> message=<Y>` within 200ms of tap | Manual test — kill network → tap Create → terminal log present |
| **SC-A-3** | BrandSwitcherSheet's "Create brand" button is DISABLED when `useAuth().loading || user === null` | Visual + tsc — disabled prop bound to canSubmit which includes !authLoading && user !== null |
| **SC-A-4** | Generic catch-all UX message is replaced with humanizeBrandCreateError() output that suffixes a `(Error: <message slice>)` hint | Synthetic INSERT failure → operator sees actionable message |
| **SC-B-1** | `mingla-business/src/utils/logError.ts` exists with the §3.2 signature | Direct file read |
| **SC-B-2** | `logError` writes a `[mb-error]` (or mb-warn / mb-info) line to console with surface + ts + code + message + extra fields | Manual test invocation |
| **SC-B-3** | All 12 first-cycle sites (§3.6) call logError before any user-visible error feedback | Direct file reads + grep `logError` returns ≥12 hits in mingla-business/ |
| **SC-B-4** | I-PROPOSED-D CI gate exists at `.github/scripts/strict-grep/i-proposed-d-mb-error-coverage.mjs` | Direct file read |
| **SC-B-5** | I-PROPOSED-D gate exits 0 on production tree | Local run `node .github/scripts/strict-grep/i-proposed-d-mb-error-coverage.mjs; echo $?` |
| **SC-B-6** | I-PROPOSED-D gate exits 1 on synthetic violation fixture | Fixture round-trip test |
| **SC-B-7** | Workflow file registers I-PROPOSED-D job | Direct file read of `.github/workflows/strict-grep-mingla-business.yml` |
| **SC-B-8** | I-PROPOSED-D registered in `Mingla_Artifacts/INVARIANT_REGISTRY.md` as DRAFT | File read |
| **SC-MIG-1** | Migration `20260506000001_notify_pgrst_reload.sql` exists with `NOTIFY pgrst, 'reload schema';` | File read |
| **SC-MIG-2** | Migration is applied via `supabase db push` (operator action) | Live DB query confirms `supabase_migrations.schema_migrations` includes 20260506000001 |
| **SC-MIG-3** | Migration discipline rule documented in INVARIANT_REGISTRY.md under I-PROPOSED-D | File read |
| **SC-CONST-1** | Const #3 — no silent failures in the 12 first-cycle sites | Manual review per site |
| **SC-CONST-2** | Const #1 — no dead taps; auth-not-ready button disabled | Visual smoke |
| **SC-CONST-3** | tsc clean | `npx tsc --noEmit` exit 0 |
| **SC-CONST-4** | All 6 strict-grep gates green (i37, i38, i39, I-PROPOSED-A, I-PROPOSED-C, I-PROPOSED-D) | Local + CI |

---

## 5. Test cases (numbered)

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | tsc clean | — | exit 0 | Static |
| T-02 | I-PROPOSED-D gate clean on tree | — | exit 0 | CI |
| T-03 | I-PROPOSED-D gate fixture: synthetic catch without logError | Synthetic file with `try { } catch (e) { console.log(e) }` | exit 1 with rich error | CI |
| T-04 | I-PROPOSED-D gate fixture: clean catch with logError on first body line | Synthetic file with `try { } catch (e) { logError(e, { surface: "X#y" }); }` | exit 0 | CI |
| T-05 | logError "error" severity routes to console.error | `logError(new Error("test"), { surface: "Test#fn" })` | console.error called with `[mb-error] surface=Test#fn ts=... message="test"` | Unit |
| T-06 | logError "warn" severity routes to console.warn | `logError(new Error("test"), { surface: "Test#fn", severity: "warn" })` | console.warn called with `[mb-warn] ...` | Unit |
| T-07 | logError handles non-Error input | `logError("plain string", { surface: "Test#fn" })` | message=`"plain string"` (no crash) | Unit |
| T-08 | logError extracts code/details/hint from Postgrest error shape | `logError({ message: "x", code: "PGRST204", details: "y", hint: "z" }, { surface: "Test#fn" })` | All 3 fields present in output | Unit |
| T-09 | logError swallow flag emits but tags swallow=true | `logError(err, { surface: "Test#fn", swallow: true })` | Output contains `swallow=true` | Unit |
| T-10 | Brand create happy path | Operator taps Create with valid input post-NOTIFY | Brand row in DB + UI updates + Toast | E2E |
| T-11 | Brand create slug collision | Operator taps Create with conflicting slug | SlugCollisionError → inline "This brand name is taken…" + terminal log | E2E |
| T-12 | Brand create non-collision failure (synthetic) | Mock failure → tap Create | Inline `humanizeBrandCreateError` message + terminal log with code + message | E2E |
| T-13 | Brand create auth-not-ready | Tap before auth resolves | Button disabled — no tap fires | UX |
| T-14 | Brand create RLS denial (synthetic 42501) | Mock auth.uid mismatch | Inline "Sign-in lapsed; please sign out and back in." + terminal log | E2E |
| T-15 | Brand create PGRST204 (synthetic) | Mock cache miss | Inline "App is updating — please retry in a moment." + terminal log | E2E |
| T-16 | useCreateBrand onError logs before rollback | Force mutation rejection | Terminal `[mb-error] surface=useCreateBrand#onError` BEFORE cache snapshot restored | Unit |
| T-17 | useUpdateBrand onError logs before rollback | Force mutation rejection | Terminal `[mb-error] surface=useUpdateBrand#onError` | Unit |
| T-18 | useSoftDeleteBrand has onError that logs | Force mutation rejection | Terminal `[mb-error] surface=useSoftDeleteBrand#onError` | Unit |
| T-19 | useBrandCascadePreview parallel-query error logged before throw | Force one of 5 queries to fail | Terminal `[mb-error] surface=useBrandCascadePreview#pastEvents` (or whichever failed) | Unit |
| T-20 | ensureCreatorAccount error logged | Force creator_accounts upsert failure | Terminal `[mb-error] surface=creatorAccount#ensureCreatorAccount` | E2E |
| T-21 | AuthContext bootstrap getSession error logged | Force getSession rejection | Terminal `[mb-error] surface=AuthContext#bootstrap` | E2E |
| T-22 | AuthContext Google signin catch logged | Force Google signin failure | Terminal `[mb-error] surface=AuthContext#signInWithGoogle` (in addition to existing Alert) | E2E |
| T-23 | AuthContext Apple signin catch logged | Force Apple signin failure | Terminal `[mb-error] surface=AuthContext#signInWithApple` | E2E |
| T-24 | account.tsx signOut catch logged | Force signOut failure | Terminal `[mb-error] surface=AccountTab#handleSignOut` (in addition to existing __DEV__ console) | E2E |
| T-25 | Migration 20260506000001 applies cleanly | `supabase db push` | Recorded in supabase_migrations.schema_migrations | Operator |
| T-26 | After migration, INSERT with new columns succeeds | Live brand-create attempt | brand_count > 0 | DB |
| T-27 | All 6 CI gates green | Run all 6 .github/scripts/strict-grep/*.mjs | exit 0 | CI |
| T-28 | INVARIANT_REGISTRY documents migration discipline rule | File read | Rule text present | Docs |

**Total: 28 tests.** T-25 through T-26 are operator-side runtime; rest are tester-side static + unit.

---

## 6. Implementation order

1. **DB migration** — write `20260506000001_notify_pgrst_reload.sql` (operator applies via `supabase db push` BEFORE any code change; closes ORCH-0728 immediate symptom for F-1)
2. **logError primitive** — write `mingla-business/src/utils/logError.ts`
3. **CI gate fixture infrastructure** — create `.github/scripts/strict-grep/__fixtures-d/` with `violation.ts` + `clean.ts`
4. **CI gate** — write `.github/scripts/strict-grep/i-proposed-d-mb-error-coverage.mjs`
5. **Workflow registration** — append job to `.github/workflows/strict-grep-mingla-business.yml`
6. **Strict-grep README update** — `.github/scripts/strict-grep/README.md` Active gates table + allowlist tag
7. **Hook migrations** — useBrands.ts onError sites (4 phases × site)
8. **Component migrations** — BrandSwitcherSheet, BrandEditView, BrandDeleteSheet (3 sites)
9. **Service migrations** — creatorAccount.ts (1 site)
10. **AuthContext migrations** — 4 catches (1 bootstrap + 1 Google + 1 Apple + signOut listener)
11. **Route migration** — app/(tabs)/account.tsx signOut catch
12. **humanizeBrandCreateError helper** — co-located in BrandSwitcherSheet OR new file `mingla-business/src/utils/humanizeBrandError.ts`
13. **BrandSwitcherSheet auth-not-ready disabled-button fix** — canSubmit includes !authLoading && user !== null
14. **INVARIANT_REGISTRY.md** — add I-PROPOSED-D DRAFT entry + migration discipline rule
15. **tsc + all 6 CI gates verify** — local pre-commit

**Estimated implementor effort:** 4-6 hours (primitive + 12 sites + CI gate + tests).

---

## 7. Invariants — preserved + new

### Preserved

| Invariant | How preserved |
|---|---|
| Const #1 No dead taps | Auth-not-ready disabled-button fix (§3.4.1) |
| Const #3 No silent failures | logError primitive + 12 site migrations (§3.6) |
| Const #5 Server state via React Query | Unchanged — no state-ownership changes |
| I-PROPOSED-A brands deleted_at filter | Unchanged |
| I-PROPOSED-C no setBrands callers | Unchanged |
| I-17 brand slug immutable | Unchanged — already enforced by trigger |

### New

#### **I-PROPOSED-D MB-ERROR-COVERAGE** (DRAFT — flips ACTIVE on ORCH-0728 CLOSE)

**Statement:** Every catch block in `mingla-business/src/` + `mingla-business/app/` MUST call `logError(error, { surface, extra })` within the first 5 lines of the catch body. Allowlist comment for intentional swallows. CI gate `i-proposed-d-mb-error-coverage.mjs` enforces.

**Migration discipline addendum:** Every Supabase migration file that contains `ALTER TABLE ... ADD COLUMN` MUST end with `NOTIFY pgrst, 'reload schema';` (documented rule, not CI-enforced this cycle).

**Allowlist tag:** `// orch-strict-grep-allow mb-error-coverage — <reason>`

**Scope:** mingla-business only. App-mobile and mingla-admin are out of scope (separate products).

---

## 8. Regression prevention

| Regression class | Prevention |
|---|---|
| Future devs add catch without logError | I-PROPOSED-D CI gate fails the PR |
| Future ADD COLUMN migration ships without NOTIFY pgrst | Documented rule in INVARIANT_REGISTRY.md + reviewer expectation; future cycle could add CI gate i-proposed-e if regressions occur |
| logError signature drift | TypeScript type-check on the LogErrorOptions interface |
| Allowlist abuse | Reviewer audits — `<reason>` field forces justification at PR time |
| Logging severity confusion | Default = "error"; "warn"/"info" require explicit opt-in |

---

## 9. Operator runtime smoke (post-IMPL, pre-CLOSE)

Re-run Cycle 17e-A smoke #2 plus 4 logError-specific checks:

| # | Test | Pass criterion |
|---|---|---|
| 1 | Migration applied | `supabase db push` shows `20260506000001` newly applied |
| 2 | Brand create happy | Tap Create with valid name → brand appears + sync to second device |
| 3 | Brand create slug collision | Tap Create with existing-slug name → inline "taken" message + terminal `[mb-error] surface=BrandSwitcherSheet#handleSubmit code=23505` |
| 4 | Brand create network kill | Disconnect WiFi → tap Create → inline error + terminal log |
| 5 | Brand create auth-not-ready | Reload app → immediately tap Create before sheet idle → button disabled (no dead-tap symptom) |
| 6 | Brand edit failure | Force a save failure → terminal `[mb-error] surface=BrandEditView#handleSave` + toast |
| 7 | Brand soft-delete failure | Force a delete failure → terminal `[mb-error] surface=useSoftDeleteBrand#onError` + UX rejection state OR error toast |

After all 7 PASS → ORCH-0728 + Cycle 17e-A close together.

---

## 10. Discoveries to register

| ID | Severity | Description |
|---|---|---|
| **D-ORCH-0728-SPEC-1** | Forward-observation | Future cycles migrate the remaining ~44 logging sites. Track as `ORCH-0728-followup` in PRIORITY_BOARD. |
| **D-ORCH-0728-SPEC-2** | Pattern note | Logging primitive is intentionally console-only this cycle. Remote sink interface is reserved (§3.2.3) but unimplemented — when telemetry is wired (post-launch), one location changes. |
| **D-ORCH-0728-SPEC-3** | Forward-observation | App-mobile already has `edgeFunctionError.ts` duck-typing pattern. Consider promoting to a shared package after both products mature; out-of-scope here. |
| **D-ORCH-0728-SPEC-4** | Operator-trust | The `(Error: <message slice>)` suffix in humanizeBrandCreateError fallback gives operator a 1-second hint without requiring terminal access — answers the "I don't trust the admin UI" memory pattern (`feedback_admin_ui_trust`). |

---

**Authored:** 2026-05-05
**Authored by:** mingla-forensics
**Status:** Spec complete — ready for orchestrator REVIEW + implementor dispatch
**Next step:** orchestrator reviews → operator confirms scope/direction → implementor executes per §6 implementation order
