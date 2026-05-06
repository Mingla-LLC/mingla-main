# SPEC — ORCH-0728 FULL FIX (brand-create + mingla-business logError + stub-brand purge + dev-build hygiene)

**Status:** SUPERSEDES `SPEC_ORCH_0728_BRAND_CREATE_FIX_AND_MB_ERROR_LOGGING.md`
**Investigation anchor:** [`reports/INVESTIGATION_ORCH_0728_PASS_3_BRUTAL.md`](../reports/INVESTIGATION_ORCH_0728_PASS_3_BRUTAL.md)
**Authored:** 2026-05-05

---

## 1. Layman summary

Four scopes in one IMPL landing:
- **Scope A** — fix the brand-create failure (root cause TBD by diagnostic patch — spec covers all plausible Fs)
- **Scope B** — `logError` primitive + 14 site migrations + CI gate + I-PROPOSED-D ACTIVE
- **Scope C** — dev-build hygiene: `__DEV__` build-info footer + force-reload runbook
- **Scope D** — stub-brand purge: persist migrate v13→v14 nukes stub currentBrand + delete `brandList.ts` + I-PROPOSED-E ACTIVE

Lands as one cohesive IMPL pass. Closes ORCH-0728 + Cycle 17e-A together.

---

## 2. Scope + non-goals + assumptions

### IN

- 1 NEW migration `20260506000002_orch_0728_notify_pgrst_followup.sql` (re-issues NOTIFY in case PASS-1's didn't take or any subsequent migration drift)
- 1 NEW utility `mingla-business/src/utils/logError.ts`
- 1 NEW utility `mingla-business/src/utils/humanizeBrandError.ts`
- 1 NEW CI gate `.github/scripts/strict-grep/i-proposed-d-mb-error-coverage.mjs`
- 14 site migrations (per investigation H-1 to H-14 catalog)
- BrandSwitcherSheet auth-not-ready disabled-button fix
- BrandSwitcherSheet humanized error surfacing
- v13→v14 persist migrate stub-brand purge
- Delete `mingla-business/src/store/brandList.ts` (orphan file)
- `__DEV__` build-info footer at `app/_layout.tsx` (or app/index.tsx)
- Workflow registration of new gate
- INVARIANT_REGISTRY entries for I-PROPOSED-D ACTIVE + I-PROPOSED-E DRAFT

### OUT

- ~40 remaining silent-failure sites (subsequent cycle ORCH-0728-followup)
- Sentry / DataDog remote sink (interface reserved in logError, not implemented)
- App-mobile or mingla-admin error logging (different products)
- Spec assumes diagnostic patch (`IMPL_ORCH_0728_PASS_3_DIAGNOSTIC.md`) lands FIRST, captures runtime evidence, then this full IMPL absorbs the captured F into Scope A's specific fix

### Assumptions

- **A-1** Diagnostic patch ran and revealed Scope A's specific F (one of: F-2 silent return, RLS denial, JWT race, mapper throw, network kill). Spec covers ALL of these via humanizeBrandError + auth-not-ready disabled button + logError.
- **A-2** No new tables; Scope A is a pure JS fix once F is known.
- **A-3** PostgREST schema cache is now fresh (PASS-1 NOTIFY + Scope A new migration NOTIFY).

---

## 3. Layer-by-layer specification

### 3.1 Database — NEW migration `20260506000002_orch_0728_notify_pgrst_followup.sql`

```sql
-- ORCH-0728: re-issue NOTIFY pgrst, 'reload schema' as a defensive measure.
-- Idempotent; harmless if cache is already fresh.
NOTIFY pgrst, 'reload schema';
```

### 3.2 NEW utility — `mingla-business/src/utils/logError.ts`

(Verbatim from prior SPEC §3.2 — unchanged, including signature, body, severity routing, and reserved remote-sink interface.)

### 3.3 NEW utility — `mingla-business/src/utils/humanizeBrandError.ts`

```ts
/**
 * humanizeBrandError — operator-facing UX message for brand-mutation failures.
 *
 * Maps Postgrest error codes to actionable copy. Adds a verbose suffix
 * `(Error: <message slice>)` in the fallback so operator can self-diagnose
 * without terminal access.
 */
export function humanizeBrandError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  const message = (error as { message?: string })?.message ?? "";

  if (code === "23505") {
    return "This brand name is taken. Try a small variation (e.g. with \"Events\" or \"London\").";
  }
  if (code === "42501") {
    return "Sign-in lapsed. Please sign out and back in, then try again.";
  }
  if (code === "PGRST204") {
    return "App is updating — please retry in a moment.";
  }
  if (code === "PGRST116") {
    return "The brand was created but couldn't be read back. Refresh the app and check your brand list.";
  }
  // Network or unknown — surface a tiny hint
  const slice = message.slice(0, 80);
  if (slice.length > 0) {
    return `Couldn't create brand. Tap Create to try again. (Error: ${slice})`;
  }
  return "Couldn't create brand. Tap Create to try again.";
}
```

### 3.4 BrandSwitcherSheet — auth-not-ready + humanized errors

Replace lines 117-150:

```ts
const { user } = useAuth();
const authLoading = useAuth().loading;  // OR destructure from useAuth() above
// ...
const canSubmit = useMemo(
  () => trimmedName.length > 0 && !authLoading && user !== null && user.id !== undefined,
  [trimmedName, authLoading, user]
);
// ...
const handleSubmit = async (): Promise<void> => {
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
  setSubmitting(true);
  setSlugError(null);
  try {
    const newBrand = await createBrandMutation.mutateAsync({
      accountId: user.id,
      name: trimmedName,
      slug: slugify(trimmedName),
      kind: "popup",
      address: null,
      coverHue: 25,
    });
    setCurrentBrand(newBrand);
    onBrandCreated?.(newBrand);
    onClose();
  } catch (error) {
    logError(error, {
      surface: "BrandSwitcherSheet#handleSubmit",
      extra: { userId: user.id, brandName: trimmedName },
    });
    setSlugError(humanizeBrandError(error));
  } finally {
    setSubmitting(false);
  }
};
```

Button binding:
```tsx
<Button
  label={submitting ? "Creating…" : "Create brand"}
  onPress={handleSubmit}
  variant="primary"
  size="lg"
  loading={submitting}
  disabled={!canSubmit || submitting}
/>
```

### 3.5 useBrands.ts hook layer migrations

Replace `_error` with `error` and call logError BEFORE rollback in:
- `useCreateBrand` onError at line 148
- `useUpdateBrand` onError at line 225

ADD onError to `useSoftDeleteBrand` at line 261:
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

WRAP each parallel-query error throw in `useBrandCascadePreview` at lines 349-353:
```ts
if (pastResult.error) {
  logError(pastResult.error, { surface: "useBrandCascadePreview#pastEvents", extra: { brandId } });
  throw pastResult.error;
}
// repeat for upcoming/live/team/stripe...
```

### 3.6 Service + context migrations

| File | Line | Change |
|---|---|---|
| `creatorAccount.ts` | 31 | Replace `console.warn(...)` with `logError(error, { surface: "creatorAccount#ensureCreatorAccount", severity: "warn" })` |
| `AuthContext.tsx` | 110-115 | Replace `console.warn` with `logError(...)` surface=`AuthContext#bootstrap` |
| `AuthContext.tsx` | 261-285 | Add `logError(err, { surface: "AuthContext#signInWithGoogle" })` BEFORE Alert |
| `AuthContext.tsx` | 350-358 | Add `logError(err, { surface: "AuthContext#signInWithApple" })` BEFORE Alert |
| `account.tsx` | 86-91 | Add `logError(error, { surface: "AccountTab#handleSignOut" })` (production-visible — remove `__DEV__` gate) |
| `BrandEditView.tsx` | 263-283 | Add `logError(error, { surface: "BrandEditView#handleSave" })` BEFORE toast |
| `BrandDeleteSheet.tsx` | 159-167 | Add `logError(error, { surface: "BrandDeleteSheet#handleSubmit" })` BEFORE setStep("rejected") |

### 3.7 NEW CI gate `i-proposed-d-mb-error-coverage.mjs`

(Verbatim from prior SPEC §3.3 — regex-based; scans for catch blocks; fails if no logError within 5 lines + no allowlist; allowlist tag `// orch-strict-grep-allow mb-error-coverage — <reason>`)

### 3.8 Persist migrate v13→v14 — stub-brand purge (NEW Scope D)

`mingla-business/src/store/currentBrandStore.ts`:

```ts
// Add near top:
const STUB_BRAND_IDS = new Set(["lm", "tll", "sl", "hr"]);

// Update version + migrate function:
const persistOptions: PersistOptions<CurrentBrandState, PersistedState> = {
  name: "mingla-business.currentBrand.v14",  // ← bump from v13 to v14
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (state) => ({ currentBrand: state.currentBrand }),
  version: 14,  // ← bump from 13 to 14
  migrate: (persistedState, version) => {
    // v12 → v13 — drops `brands` array (existing logic)
    if (version < 13) {
      const old = persistedState as Partial<{ currentBrand: Brand | null }> | null;
      const cb = old?.currentBrand ?? null;
      // ALSO purge stub IDs at this step for direct upgraders
      if (cb !== null && STUB_BRAND_IDS.has(cb.id)) {
        return { currentBrand: null };
      }
      return { currentBrand: cb };
    }
    // v13 → v14 — purges any surviving stub-id currentBrand
    if (version < 14) {
      const old = persistedState as Partial<{ currentBrand: Brand | null }> | null;
      const cb = old?.currentBrand ?? null;
      if (cb !== null && STUB_BRAND_IDS.has(cb.id)) {
        return { currentBrand: null };
      }
      return { currentBrand: cb };
    }
    return persistedState as PersistedState;
  },
};
```

Also: rename store to bump cache key (`v13` → `v14`) so existing caches re-run the migrate function.

### 3.9 Delete orphan file

`mingla-business/src/store/brandList.ts` — DELETE entirely. Verify no imports remain via:

```bash
cd mingla-business && grep -rn 'from.*brandList\|import.*brandList' src/ app/
```

Should return 0 hits.

### 3.10 Build-info footer — Scope C

`mingla-business/app/_layout.tsx` (or app/index.tsx — pick the root):

Add at top of imports:
```ts
import Constants from "expo-constants";
```

Add to render (only in `__DEV__`):
```tsx
{__DEV__ ? (
  <View pointerEvents="none" style={styles.devBuildInfoFooter}>
    <Text style={styles.devBuildInfoText}>
      bundle: {Constants.expoConfig?.extra?.GIT_COMMIT_SHORT ?? "unknown"}
    </Text>
  </View>
) : null}
```

Style:
```ts
devBuildInfoFooter: {
  position: "absolute",
  bottom: 4,
  right: 4,
  paddingHorizontal: 6,
  paddingVertical: 2,
  borderRadius: 4,
  backgroundColor: "rgba(0,0,0,0.6)",
},
devBuildInfoText: {
  fontSize: 10,
  color: "rgba(255,255,255,0.6)",
  fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
},
```

`app.config.js` or `app.config.ts` — bake the git commit at build time:
```js
import { execSync } from "node:child_process";
const gitCommitShort = execSync("git rev-parse --short HEAD").toString().trim();
// In the config:
extra: {
  ...existing,
  GIT_COMMIT_SHORT: gitCommitShort,
}
```

### 3.11 Migration discipline runbook (Scope C)

Create `Mingla_Artifacts/RUNBOOK.md` (or append to existing) with:

```markdown
## ADD COLUMN migration discipline

Every Supabase migration that adds columns MUST end with:

    NOTIFY pgrst, 'reload schema';

Without this, PostgREST may serve cached schema for minutes-to-hours, causing INSERT requests with new columns to return PGRST204.

## Dev-build retest discipline

Whenever an IMPL pass changes JavaScript that the operator will retest on a dev client:

1. `cd mingla-business && npx expo start --clear` (force fresh transpile)
2. On the dev client device: shake → tap "Reload" (force fresh JS bundle fetch)
3. Confirm "Loading bundle …" banner appeared (visual proof of fresh fetch)
4. Verify build-info footer shows expected git commit short hash (Scope C)
5. Then retest

This rule supersedes the implicit assumption that "git pull means the running app has the new code". On a dev client, only Metro freshness + JS-reload guarantees that.
```

---

## 4. Success criteria (numbered)

| # | Criterion | Verification |
|---|---|---|
| **SC-A-1** | Brand-create succeeds end-to-end with operator's auth | Operator runtime smoke |
| **SC-A-2** | Any brand-create failure produces structured terminal log within 200ms | Manual: kill network → tap Create → terminal log present |
| **SC-A-3** | Button disabled when `loading || user === null` | Visual + tsc |
| **SC-A-4** | Generic catch-all replaced with humanizeBrandError output | Synthetic INSERT failure → operator sees actionable + suffixed message |
| **SC-B-1** | `logError` exists with §3.2 signature | File read |
| **SC-B-2** | logError writes `[mb-error/warn/info]` line with surface + ts + code + message + extra | Manual test |
| **SC-B-3** | All 14 first-cycle sites call logError | Direct file reads + grep ≥14 hits |
| **SC-B-4** | I-PROPOSED-D CI gate exists, exits 0 on tree, exits 1 on synthetic violation | Fixture round-trip |
| **SC-B-5** | Workflow registers I-PROPOSED-D job | File read |
| **SC-B-6** | I-PROPOSED-D ACTIVE in INVARIANT_REGISTRY | File read |
| **SC-C-1** | Build-info footer shows git commit short hash in `__DEV__` | Visual |
| **SC-C-2** | RUNBOOK.md documents migration + dev-build runbook | File read |
| **SC-D-1** | `brandList.ts` DELETED | File system check |
| **SC-D-2** | Persist migrate v13→v14 nukes stub-id currentBrand | Cold-start with v13 cache containing currentBrand={id:"lm",...} → after migrate → currentBrand=null |
| **SC-D-3** | I-PROPOSED-E DRAFT in INVARIANT_REGISTRY | File read |
| **SC-MIG-1** | `20260506000002_orch_0728_notify_pgrst_followup.sql` exists | File read |
| **SC-MIG-2** | Migration applied via `supabase db push` (operator) | DB query confirms in schema_migrations |
| **SC-CONST-1..4** | Const #1 + Const #3 satisfied across 14 sites; tsc clean; all 6 (now 7) gates exit 0 | Multi-check |

---

## 5. Test cases

(Same as prior spec T-01 to T-28 + 5 new tests for Scope D)

| Test | Scenario | Expected |
|---|---|---|
| T-29 | v12→v13 cache with currentBrand={id:"lm",...} → cold start | currentBrand=null after hydrate |
| T-30 | v13 cache with currentBrand={id:"lm",...} → cold start | currentBrand=null after hydrate via v13→v14 migrate |
| T-31 | v13 cache with currentBrand={id:"<real-uuid>",...} → cold start | currentBrand preserved (real brand untouched) |
| T-32 | grep `from.*brandList` post-IMPL | 0 hits |
| T-33 | Build-info footer rendering in `__DEV__` | Visible at bottom-right with `bundle: <7-char-hex>` text |

---

## 6. Implementation order

1. NEW migration `20260506000002_orch_0728_notify_pgrst_followup.sql` (operator applies)
2. logError primitive
3. humanizeBrandError helper
4. CI gate fixture infrastructure
5. CI gate script
6. Workflow registration
7. README update
8. useBrands.ts onError migrations (4 sites)
9. BrandSwitcherSheet auth-not-ready + humanized error
10. Component migrations (BrandEditView, BrandDeleteSheet)
11. Service migrations (creatorAccount)
12. AuthContext migrations (4 catches)
13. account.tsx signOut catch
14. v13→v14 persist migrate
15. DELETE `brandList.ts`
16. Build-info footer + app.config.js git commit baking
17. RUNBOOK.md write
18. INVARIANT_REGISTRY: I-PROPOSED-D ACTIVE + I-PROPOSED-E DRAFT
19. tsc + all 7 CI gates verify

**Estimated effort:** 6-8 hours.

---

## 7. Invariants — preserved + new

### Preserved

(All from prior spec — Const #1, #3, #5, I-PROPOSED-A, I-PROPOSED-C, I-17 — unchanged.)

### New

#### **I-PROPOSED-D MB-ERROR-COVERAGE** — already DRAFT; **flips ACTIVE on this CLOSE**

(Statement + scope + CI enforcement unchanged from prior spec; reproduced verbatim in INVARIANT_REGISTRY.)

#### **I-PROPOSED-E STUB-BRAND-PURGED** — DRAFT, flips ACTIVE on ORCH-0728 CLOSE

**Statement:** Stub brand IDs `lm`, `tll`, `sl`, `hr` MUST NOT survive in any persisted state post-17e-A. The persist migrate function in `currentBrandStore` MUST nuke any `currentBrand` whose `id` matches a stub ID. The orphan `brandList.ts` file MUST be deleted.

**Scope:** mingla-business only.

**Why:** Pre-17e-A, the dev-seed button populated `currentBrand = STUB_BRANDS[i]`. Post-17e-A removed the seed button but the persist migrate v12→v13 preserved the stub. Result: TopBar renders "Lonely Moth" but no DB row backs it. UX regression + cascading silent failures (useBrand returns null; useCurrentBrandRole stub-mode synthesis fires for non-existent brand).

**CI enforcement:** No CI gate (logic-level — caught by SC-D-2 unit test).

**EXIT condition:** None — permanent invariant. If stub IDs are ever re-introduced for a different testing purpose, supersede with new IDs that don't collide.

**Cross-reference:** ORCH-0728 SPEC §3.8 + §3.9; PASS-3 investigation F-6 + F-7.

---

## 8. Regression prevention

| Class | Prevention |
|---|---|
| Future devs add catch without logError | I-PROPOSED-D CI gate |
| Future ADD COLUMN migration without NOTIFY pgrst | RUNBOOK + reviewer expectation |
| Stub brand revival | I-PROPOSED-E + persist migrate logic |
| Stale-bundle confusion on retest | Build-info footer + RUNBOOK retest discipline |
| Auth-not-ready dead taps | Spec mandates disabled-button gating |

---

## 9. Operator runtime smoke (post-IMPL, pre-CLOSE)

Re-run Cycle 17e-A smoke #2-#6 plus:

| # | Test | Pass |
|---|---|---|
| 1 | Migration `20260506000002` applied | `\dx` confirms; OR `SELECT * FROM supabase_migrations.schema_migrations WHERE version = '20260506000002'` |
| 2 | Brand create happy | Brand appears + multi-device sync |
| 3 | Brand create slug collision | Inline "taken" + terminal `[mb-error]` |
| 4 | Brand create network kill | Inline humanized + terminal log |
| 5 | Brand create auth-not-ready | Button disabled |
| 6 | Brand edit failure | Terminal `[mb-error] BrandEditView#handleSave` + toast |
| 7 | Brand soft-delete failure | Terminal `[mb-error] useSoftDeleteBrand#onError` |
| 8 | Cold-start with stale stub-brand currentBrand | TopBar shows "Pick a brand" prompt (currentBrand=null after migrate) |
| 9 | Build-info footer visible in `__DEV__` | Visible bottom-right with current commit short hash |

After all 9 PASS → ORCH-0728 + Cycle 17e-A close together.

---

## 10. Discoveries to register

| ID | Severity | Description |
|---|---|---|
| **D-ORCH-0728-SPEC-5** | NEW | Spec adds Scope C dev-build hygiene + Scope D stub-brand purge |
| **D-ORCH-0728-SPEC-6** | Forward | Build-info footer pattern is generic; could be ported to `app-mobile` and `mingla-admin` for the same diagnostic value |
| **D-ORCH-0728-SPEC-7** | Forward | RUNBOOK.md becomes the canonical operator-side reference; ORCH-IDs link to relevant runbook sections going forward |

---

**Authored:** 2026-05-05
**Authored by:** mingla-forensics (PASS-3 brutal — full fix spec)
**Status:** Spec complete; ready for orchestrator REVIEW + diagnostic patch IMPL dispatch (PASS-3 sub-step) followed by full IMPL dispatch
**Supersedes:** `SPEC_ORCH_0728_BRAND_CREATE_FIX_AND_MB_ERROR_LOGGING.md`

---

## PASS-4 SPEC AMENDMENT (root cause proven — F-9 RLS 42501)

Per investigation PASS-4 finalization, root cause is **F-9 — session JWT not attached to INSERT request** (HIGH confidence; six-field evidence captured via diagnostic patch). Spec receives 2 amendments:

### Amendment §3.4-A — Scope A — proactive session-refresh in BrandSwitcherSheet#handleSubmit

INSERT into the spec §3.4 (BrandSwitcherSheet) immediately AFTER the disabled-button + auth-not-ready guard, BEFORE the mutateAsync call:

```ts
// Proactive session-refresh — prevents 42501 RLS denial when access_token has expired
// silently (autoRefreshToken should keep this fresh but we cannot rely on it after
// extended idle periods — see PASS-4 F-9 root cause).
const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
if (sessionError !== null || sessionData.session === null) {
  logError(sessionError ?? new Error("session-null-pre-mutation"), {
    surface: "BrandSwitcherSheet#handleSubmit",
    extra: { phase: "session-precheck" },
  });
  setSlugError("Sign-in lapsed. Sign out from Account, sign back in, then try again.");
  setSubmitting(false);
  return;
}
// If session expires_at is within 60 seconds, force refresh
const expiresAt = sessionData.session.expires_at ?? 0;
const nowSec = Math.floor(Date.now() / 1000);
if (expiresAt - nowSec < 60) {
  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError !== null) {
    logError(refreshError, {
      surface: "BrandSwitcherSheet#handleSubmit",
      extra: { phase: "session-refresh", expiresAt, nowSec },
    });
    setSlugError("Sign-in lapsed. Sign out from Account, sign back in, then try again.");
    setSubmitting(false);
    return;
  }
}
// Now safe to mutate — JWT is fresh
const newBrand = await createBrandMutation.mutateAsync({ ... });
```

**Rationale:** PASS-4 evidence shows operator's session is 5+ hours old at retest time; autoRefreshToken silently failed. Proactive `getSession()` + conditional `refreshSession()` is the structural prevention. UX failure path surfaces actionable copy.

**Apply same pattern to:** any RLS-gated mutation in mingla-business that fires from a stale-prone surface. For first IMPL cycle: BrandSwitcherSheet (Scope A), BrandEditView (extends to handleSave), BrandDeleteSheet (handleSubmit), Stripe Connect onboard handleAfterDone.

### Amendment §3.9-A — Scope D — fix reapOrphanStorageKeys allowlist (NEW H-15)

PASS-4 surfaced that `mingla-business/src/utils/reapOrphanStorageKeys.ts:17-29` allowlist contains `currentBrand.v12` but NOT `v13` (or post-Scope-D `v14`). Cycle 17e-A IMPL drift.

Spec §3.9 (Scope D) gains an explicit fix:

```ts
// mingla-business/src/utils/reapOrphanStorageKeys.ts:17-29
const KNOWN_MINGLA_KEYS = new Set<string>([
  "mingla-business.currentBrand.v14",  // NEW — post-Scope-D persist version
  "mingla-business.draftEvent.v1",
  "mingla-business.liveEvent.v1",
  "mingla-business.orderStore.v1",
  "mingla-business.guestStore.v1",
  "mingla-business.eventEditLog.v1",
  "mingla-business.notificationPrefsStore.v1",
  "mingla-business.scannerInvitationsStore.v2",
  "mingla-business.doorSalesStore.v1",
  "mingla-business.scanStore.v1",
  "mingla-business.brandTeamStore.v1",
]);
```

Drop the `v12` entry (now superseded by v14). Operators upgrading from v12 → v13 → v14 will see the v12 + v13 keys swept as orphans on first cold-start post-IMPL — log-only in 17d phase, harmless. Subsequent cold-starts see only v14 in storage.

### Amendment §4 — NEW success criteria

| # | Criterion | Verification |
|---|---|---|
| **SC-A-5** | `getSession()` precheck fires before mutateAsync; null-session surfaces "Sign-in lapsed" message | Code-trace + manual test (sign-out via dev tools, then attempt create) |
| **SC-A-6** | `refreshSession()` fires when token expires within 60s; success → mutate proceeds; failure → surface "Sign-in lapsed" | Manual test: expire token via dev tools clock-skew |
| **SC-D-4** | `reapOrphanStorageKeys.ts` allowlist contains `v14` (and NOT `v12`) | File read + grep |
| **SC-D-5** | Cold-start with `currentBrand.v14` in AsyncStorage → no orphan warning for that key | Operator runtime smoke |

### Amendment §6 — implementation order

INSERT after step 9 (BrandSwitcherSheet auth-not-ready):

- **9b** — Add proactive session-refresh block to BrandSwitcherSheet#handleSubmit per Amendment §3.4-A
- **15b** — Update reapOrphanStorageKeys.ts allowlist per Amendment §3.9-A

Total estimated effort: 6-8h unchanged (additions are ~30 LOC).

### Operator immediate unblock (no code change)

While full IMPL is being authored: operator can unblock brand-create RIGHT NOW by signing out + signing back in. This eliminates the 5h-stale session on the supabase client → fresh JWT attached to next INSERT → 42501 disappears → brand creates successfully.

This action ALSO confirms F-9 PROVEN beyond the diagnostic evidence (predictive — if sign-out + sign-in fixes it, the cause was definitively the stale session).

**Authored (PASS-4 amendment):** 2026-05-06 03:52 UTC
**Authored by:** mingla-forensics (PASS-4 amendment author)
**Status:** Spec complete with PASS-4 amendments; ready for full IMPL dispatch
