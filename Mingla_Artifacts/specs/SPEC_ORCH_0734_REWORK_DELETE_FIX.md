# SPEC — ORCH-0734 REWORK — Brand-delete silent no-op + trash-icon parent-prop fix

**Authored:** 2026-05-06 by mingla-forensics
**Investigation:** [`reports/INVESTIGATION_ORCH_0734_REWORK_DELETE_PATH_BRUTAL.md`](../reports/INVESTIGATION_ORCH_0734_REWORK_DELETE_PATH_BRUTAL.md)
**Closes:** RC-0734-RW-A (silent no-op) + RC-0734-RW-B (trash icon hidden) + CF-0734-RW-1 (no success Toast) + HF-0734-RW-2 (no diagnostic logging on delete path)
**Status:** BINDING (implementor follows verbatim; deviations require new SPEC version)

---

## 1. Layman summary

Five mechanical changes:

1. Make `softDeleteBrand` chain `.select("id")` after the UPDATE and throw if 0 rows were affected — turns a silent no-op into a loud error.
2. Wire the BrandDeleteSheet state machine into `home.tsx` and `events.tsx` (mirror `account.tsx` lines 60-149 + 282-288 verbatim) so the trash icon renders on all three tabs.
3. Pass `onRequestDeleteBrand` to `<BrandSwitcherSheet>` from both new tab call sites.
4. Add a "Brand deleted" Toast to the parent `onDeleted` callback for explicit success feedback.
5. Add diagnostic markers `[ORCH-0734-RW-DIAG]` to the delete service + hook (TRANSITIONAL — removed at CLOSE).

Plus: register I-PROPOSED-I MUTATION-ROWCOUNT-VERIFIED invariant (DRAFT) and a strict-grep CI gate to enforce it going forward.

Zero DB layer changes (DB layer is verified good post-ORCH-0734-v1).

---

## 2. Scope, Non-goals, Assumptions

### 2.1 Scope

- **Service:** `mingla-business/src/services/brandsService.ts` — modify `softDeleteBrand` to chain `.select("id")` + throw on 0 rows + add diagnostic markers
- **Hook:** `mingla-business/src/hooks/useBrands.ts` — add diagnostic markers around `useSoftDeleteBrand` mutationFn (TRANSITIONAL)
- **Tab routes:** `mingla-business/app/(tabs)/home.tsx` + `mingla-business/app/(tabs)/events.tsx` — wire BrandDeleteSheet state machine + pass `onRequestDeleteBrand`
- **Existing tab route:** `mingla-business/app/(tabs)/account.tsx` — add Toast on `handleBrandDeleted` for parity
- **Invariant registry:** `Mingla_Artifacts/INVARIANT_REGISTRY.md` — add I-PROPOSED-I (status: DRAFT)
- **CI gate:** `.github/scripts/strict-grep/i-proposed-i-mutation-rowcount-verified.mjs` (NEW) + 1 job in `.github/workflows/strict-grep-mingla-business.yml`
- **Memory file:** `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_rls_returning_owner_gap.md` — extend body with rowcount-verification appendix (still DRAFT)

### 2.2 Non-goals

- **DB layer changes** — zero. Post-ORCH-0734-v1 schema is verified good.
- **app-mobile** — out of ORCH-0734 scope (operator-directive)
- **events / orders / tickets** mutations — out of scope; LF-1/LF-2/LF-3 from original audit remain queued for future cycles
- **Hoisting BrandDeleteSheet to shared layout** — Option B in the investigation was the architecturally cleaner fix but expands scope. SPEC chooses Option A (per-tab duplication mirroring account.tsx) for minimum blast radius.
- **Hard-DELETE of QA probe brand leftovers** — operational cleanup, separate dispatch
- **Cleanup of all 10 diagnostic markers (existing 6 + new 4)** — separate post-PASS dispatch

### 2.3 Assumptions

- **A-1:** Postgres permissive policies are OR'd; `.select("id")` after `.update()` triggers `Prefer: return=representation`; the post-update row is admitted by `Account owner can select own brands` policy (verified live; 7 policies on brands).
- **A-2:** supabase-js v2 returns `data: null` (or empty array) when an UPDATE...RETURNING matches 0 rows; verified via OB-2 in investigation (`updateBrand` already relies on this contract).
- **A-3:** BrandDeleteSheet's `try/catch` around `mutateAsync` is the existing error-surface contract — a structured throw from the service propagates correctly to `submitError` inline display.
- **A-4:** `account.tsx` lines 60-149 (state + handlers) and 282-288 (BrandDeleteSheet render) constitute the canonical pattern; mirroring them verbatim is sufficient.

---

## 3. Code layer — exact changes

### 3.1 `mingla-business/src/services/brandsService.ts:222-228` — softDeleteBrand step 2 rowcount fix

**Before (current):**
```ts
  // Step 2 — soft-delete via UPDATE.
  const nowIso = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("brands")
    .update({ deleted_at: nowIso })
    .eq("id", brandId)
    .is("deleted_at", null); // defensive idempotency

  if (updateError) throw updateError;
```

**After:**
```ts
  // Step 2 — soft-delete via UPDATE with rowcount verification.
  // Chains .select("id") to verify exactly 1 row was updated. Without this
  // verification, supabase-js silently returns success when 0 rows match
  // (RLS denial, wrong brandId, already-soft-deleted) — the bug closed by
  // ORCH-0734 REWORK. The .select() chain is safe post-ORCH-0734-v1: the
  // "Account owner can select own brands" policy admits the post-update
  // row regardless of deleted_at state.
  const nowIso = new Date().toISOString();
  // [DIAG ORCH-0734-RW-DIAG] Removed at full IMPL CLOSE per cleanup dispatch
  // eslint-disable-next-line no-console
  console.error("[ORCH-0734-RW-DIAG] softDeleteBrand step 2 — UPDATE ATTEMPT", {
    brandId,
    nowIso,
  });
  const { data, error: updateError } = await supabase
    .from("brands")
    .update({ deleted_at: nowIso })
    .eq("id", brandId)
    .is("deleted_at", null) // defensive idempotency
    .select("id");

  if (updateError) throw updateError;
  // [DIAG ORCH-0734-RW-DIAG] Removed at full IMPL CLOSE per cleanup dispatch
  // eslint-disable-next-line no-console
  console.error("[ORCH-0734-RW-DIAG] softDeleteBrand step 2 — UPDATE RESULT", {
    brandId,
    rowCount: data?.length ?? 0,
    expected: 1,
  });
  if (data === null || data.length === 0) {
    throw new Error(
      "softDeleteBrand: 0 rows updated — brand may not exist, may already be soft-deleted, or RLS denied. brandId=" +
        brandId,
    );
  }
```

**Reasoning:** The `.select("id")` chain triggers PostgREST `Prefer: return=representation`. This makes Postgres evaluate SELECT policies on the post-update row. The new `Account owner can select own brands` policy (from ORCH-0734-v1) admits via `account_id = auth.uid()` direct predicate — no helper-function snapshot quirks. Rowcount > 0 confirms the UPDATE actually applied. Throw turns silent no-op into loud error that BrandDeleteSheet's catch block surfaces inline.

### 3.2 `mingla-business/src/hooks/useBrands.ts:281-303` — useSoftDeleteBrand diagnostic markers

**Before (current):**
```ts
export const useSoftDeleteBrand = (): UseSoftDeleteBrandResult => {
  const queryClient = useQueryClient();
  const mutation = useMutation<SoftDeleteResult, Error, SoftDeleteBrandInput>({
    mutationFn: async ({ brandId }) => softDeleteBrand(brandId),
    onSuccess: (result, { brandId, accountId }) => {
      if (!result.rejected) {
        // Invalidate list — re-fetch shows brand absent (deleted_at IS NULL filter)
        queryClient.invalidateQueries({ queryKey: brandKeys.list(accountId) });
        // Clear detail cache
        queryClient.removeQueries({ queryKey: brandKeys.detail(brandId) });
        // Clear role cache for this brand (useCurrentBrandRole sees no brand row → null role)
        queryClient.removeQueries({ queryKey: ["brand-role", brandId] });
        // Clear cascade-preview cache (defensive)
        queryClient.removeQueries({
          queryKey: brandKeys.cascadePreview(brandId),
        });
      }
      // On rejection: caller (BrandDeleteSheet) handles via modal; no cache changes
    },
    // No onError — caller catches via mutateAsync; pessimistic pattern surfaces
    // raw error to UI (toast or inline per Decision 11)
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};
```

**After:** Add diagnostic marker around `mutationFn` AND add a structured `onError` (per Constitutional #3 + I-PROPOSED-D MB-ERROR-COVERAGE DRAFT spirit):

```ts
export const useSoftDeleteBrand = (): UseSoftDeleteBrandResult => {
  const queryClient = useQueryClient();
  const mutation = useMutation<SoftDeleteResult, Error, SoftDeleteBrandInput>({
    mutationFn: async ({ brandId }) => {
      // [DIAG ORCH-0734-RW-DIAG] Removed at full IMPL CLOSE per cleanup dispatch
      // eslint-disable-next-line no-console
      console.error("[ORCH-0734-RW-DIAG] useSoftDeleteBrand mutationFn ENTER", { brandId });
      const result = await softDeleteBrand(brandId);
      // [DIAG ORCH-0734-RW-DIAG] Removed at full IMPL CLOSE per cleanup dispatch
      // eslint-disable-next-line no-console
      console.error("[ORCH-0734-RW-DIAG] useSoftDeleteBrand mutationFn RESULT", {
        brandId,
        rejected: result.rejected,
      });
      return result;
    },
    onSuccess: (result, { brandId, accountId }) => {
      if (!result.rejected) {
        // Invalidate list — re-fetch shows brand absent (deleted_at IS NULL filter)
        queryClient.invalidateQueries({ queryKey: brandKeys.list(accountId) });
        // Clear detail cache
        queryClient.removeQueries({ queryKey: brandKeys.detail(brandId) });
        // Clear role cache for this brand (useCurrentBrandRole sees no brand row → null role)
        queryClient.removeQueries({ queryKey: ["brand-role", brandId] });
        // Clear cascade-preview cache (defensive)
        queryClient.removeQueries({
          queryKey: brandKeys.cascadePreview(brandId),
        });
      }
      // On rejection: caller (BrandDeleteSheet) handles via modal; no cache changes
    },
    onError: (error, { brandId, accountId }) => {
      // [DIAG ORCH-0734-RW-DIAG] Removed at full IMPL CLOSE per cleanup dispatch
      // eslint-disable-next-line no-console
      console.error("[ORCH-0734-RW-DIAG] useSoftDeleteBrand FAILED", {
        brandId,
        accountId,
        message: error.message,
        name: error.name,
      });
      // Caller's mutateAsync still receives the throw (pessimistic pattern preserved)
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};
```

### 3.3 `mingla-business/app/(tabs)/home.tsx` — wire BrandDeleteSheet state machine

**Pre-flight (implementor):** Read `mingla-business/app/(tabs)/account.tsx` lines 1-30 (imports), 50-65 (state declarations), 130-180 (handlers), 280-288 (`<BrandDeleteSheet>` JSX) — that's the canonical pattern. Mirror in home.tsx.

**Changes:**

1. **Imports** — add at top of file (next to existing imports):
```ts
import { BrandDeleteSheet } from "../../src/components/brand/BrandDeleteSheet";
import type { Brand } from "../../src/store/currentBrandStore";
import { useAuth } from "../../src/context/AuthContext";  // if not already imported
```

2. **State declarations** (next to existing `sheetVisible` state — typically near top of component body):
```ts
const { user } = useAuth();  // if not already destructured
// Cycle 17e-A: BrandDeleteSheet state — opens from BrandSwitcherSheet trash taps
const [deleteSheetVisible, setDeleteSheetVisible] = useState<boolean>(false);
const [brandPendingDelete, setBrandPendingDelete] = useState<Brand | null>(null);
```

3. **Handlers** (next to existing handlers like `handleCloseSheet`, etc.):
```ts
// Cycle 17e-A REWORK: BrandSwitcherSheet trash tap → open BrandDeleteSheet
const handleRequestDeleteBrand = useCallback((brand: Brand): void => {
  setBrandPendingDelete(brand);
  setDeleteSheetVisible(true);
}, []);

const handleCloseDeleteSheet = useCallback((): void => {
  setDeleteSheetVisible(false);
  // Don't clear brandPendingDelete immediately — exit animation reads it
}, []);

const handleBrandDeleted = useCallback(
  (deletedBrandId: string): void => {
    // Clear currentBrand if it matches deleted brand
    const current = useCurrentBrandStore.getState().currentBrand;
    if (current !== null && current.id === deletedBrandId) {
      setCurrentBrand(null);
    }
    const deleted = brandPendingDelete;
    setDeleteSheetVisible(false);
    // Show success Toast (uses existing setToast pattern)
    if (deleted !== null) {
      setToast({ visible: true, message: `${deleted.displayName} deleted` });
    }
  },
  [brandPendingDelete, setCurrentBrand],
);
```

(Implementor: if `setCurrentBrand` is not already destructured from `useCurrentBrandStore`, add it. If `useCurrentBrandStore` is not imported, add the import. Reference account.tsx lines 22-45 for canonical imports.)

4. **JSX** — modify the `<BrandSwitcherSheet>` render at line 361-365 to add `onRequestDeleteBrand`:
```tsx
<BrandSwitcherSheet
  visible={sheetVisible}
  onClose={handleCloseSheet}
  onBrandCreated={handleBrandCreated}
  onRequestDeleteBrand={handleRequestDeleteBrand}
/>

<BrandDeleteSheet
  visible={deleteSheetVisible}
  brand={brandPendingDelete}
  accountId={user?.id ?? null}
  onClose={handleCloseDeleteSheet}
  onDeleted={handleBrandDeleted}
/>
```

(Place the `<BrandDeleteSheet>` immediately after `<BrandSwitcherSheet>` in the JSX tree — same pattern as account.tsx line 282.)

### 3.4 `mingla-business/app/(tabs)/events.tsx` — same as 3.3, mirrored

Apply the same 4 changes (imports, state, handlers, JSX) to `events.tsx`. The current `<BrandSwitcherSheet>` is at lines 500-504; add the same `onRequestDeleteBrand` prop and the `<BrandDeleteSheet>` JSX immediately after.

### 3.5 `mingla-business/app/(tabs)/account.tsx:141-150` — add success Toast in handleBrandDeleted (parity)

**Before (current):**
```ts
const handleBrandDeleted = useCallback(
  (deletedBrandId: string): void => {
    const current = useCurrentBrandStore.getState().currentBrand;
    if (current !== null && current.id === deletedBrandId) {
      setCurrentBrand(null);
    }
    const deleted = brandPendingDelete;
    // ... existing logic ...
  },
  [...],
);
```

**After:** Add `setToast({...})` call after `setDeleteSheetVisible(false)` to match the home.tsx + events.tsx pattern from 3.3:

```ts
const handleBrandDeleted = useCallback(
  (deletedBrandId: string): void => {
    const current = useCurrentBrandStore.getState().currentBrand;
    if (current !== null && current.id === deletedBrandId) {
      setCurrentBrand(null);
    }
    const deleted = brandPendingDelete;
    setDeleteSheetVisible(false);
    if (deleted !== null) {
      setToast({ visible: true, message: `${deleted.displayName} deleted` });
    }
  },
  [brandPendingDelete, setCurrentBrand],
);
```

(Implementor: read existing handleBrandDeleted in account.tsx — preserve any existing logic AND add the Toast call. If a Toast is already fired elsewhere, do NOT double-fire.)

---

## 4. Invariant Registry — I-PROPOSED-I (DRAFT)

**Add to `Mingla_Artifacts/INVARIANT_REGISTRY.md`** (orchestrator owns this update; implementor confirms entry exists post-write):

```markdown
### I-PROPOSED-I — MUTATION-ROWCOUNT-VERIFIED (DRAFT)

**Status:** DRAFT — flips to ACTIVE on ORCH-0734-RW tester PASS

**Statement:** Every supabase-js mutation in `mingla-business/src/services/*.ts` that targets a specific row(s) by ID (`.eq("id", X)` / `.eq("brand_id", X)` / similar) MUST verify rowcount via `.select(...)` chain (or equivalent) AND throw a structured error if rowcount is 0. Exempt: UPSERT on PK (idempotent by design — destructuring only `error` is acceptable), and explicitly-documented "fire-and-forget cleanup" mutations marked with `// I-MUTATION-ROWCOUNT-WAIVER: <ORCH-ID> <reason>` magic comment.

**Why:** When supabase-js executes UPDATE/DELETE without `.select()` chain, PostgREST returns `204 No Content` on success — including when 0 rows match the WHERE clause + RLS. supabase-js returns no error. If the service code only destructures `error`, it silently treats 0-row updates as success. The user sees a green Toast / sheet close / navigation, believes the mutation happened, but DB state is unchanged. This is a worse failure mode than 42501 because it provides false-positive confirmation.

**Confirmed instances (closed by this fix):**
- `softDeleteBrand` in `brandsService.ts` — was destructuring only `error`; now chains `.select("id")` + throws on 0 rows.

**Enforcement:** CI gate at `.github/workflows/strict-grep-mingla-business.yml` job `i-proposed-i-mutation-rowcount-verified` running `.github/scripts/strict-grep/i-proposed-i-mutation-rowcount-verified.mjs`. Scans `mingla-business/src/services/*.ts` for `.update(`/`.delete(` patterns and asserts they are followed (within reasonable proximity in the same statement chain) by either `.select(`, `.maybeSingle(`, or the magic waiver comment.

**Source:** ORCH-0734 REWORK (audit + spec 2026-05-06) — investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH_0734_REWORK_DELETE_PATH_BRUTAL.md`; spec `Mingla_Artifacts/specs/SPEC_ORCH_0734_REWORK_DELETE_FIX.md`.

**Cross-reference:** Memory file `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_rls_returning_owner_gap.md` extended (DRAFT) with rowcount-verification appendix at ORCH-0734-RW IMPL.

**EXIT condition:** Permanent invariant. The PostgREST + supabase-js contract that produces silent 0-row success is unlikely to change.
```

---

## 5. CI Gate — `i-proposed-i-mutation-rowcount-verified.mjs`

### 5.1 Required behavior

For each `.ts` file in `mingla-business/src/services/`:
- Find every `.update(...)` or `.delete(...)` method call (at the supabase-js builder level — not nested in unrelated chains)
- For each, check whether the same statement chain contains either:
  - `.select(` — explicit return-representation
  - `.maybeSingle(` or `.single(` — also triggers RETURNING
  - A magic waiver comment within ~3 lines: `// I-MUTATION-ROWCOUNT-WAIVER: <ORCH-ID> <reason>`
- If none of these apply: VIOLATION

Plus: include `--self-test` mode (mirror i-proposed-h pattern) creating violating + passing + waiver synthetic fixtures.

### 5.2 Workflow integration

Add a new job to `.github/workflows/strict-grep-mingla-business.yml` mirroring `i-proposed-h-rls-returning-owner-gap`:
```yaml
  i-proposed-i-mutation-rowcount-verified:
    name: "I-PROPOSED-I: MUTATION-ROWCOUNT-VERIFIED"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Install Babel parser
        run: npm install --no-save @babel/parser @babel/traverse
      - name: Run I-PROPOSED-I self-test
        run: node .github/scripts/strict-grep/i-proposed-i-mutation-rowcount-verified.mjs --self-test
      - name: Run I-PROPOSED-I gate
        run: node .github/scripts/strict-grep/i-proposed-i-mutation-rowcount-verified.mjs
```

Update the registry comment at the top of the workflow file.

### 5.3 Implementation freedom

Implementor may use:
- `@babel/parser` AST walk (matches local pattern) — recommended
- ripgrep + post-processing
- Custom regex (must handle multi-line chains)

Required behavior is non-negotiable. Implementation choice is.

---

## 6. Memory file extension

Append to `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_rls_returning_owner_gap.md` (still DRAFT) the following appendix:

```markdown

## Appendix — ROWCOUNT VERIFICATION (added at ORCH-0734-RW IMPL)

The RLS-RETURNING-OWNER-GAP fix exposes a sibling bug class: **silent 0-row mutation** (also called "MUTATION-ROWCOUNT-VERIFIED").

When supabase-js executes UPDATE/DELETE without `.select()` chain, PostgREST returns 204 No Content on success — including when 0 rows match the WHERE clause + RLS. supabase-js returns no error. Service code that destructures only `error` returns success even when DB state didn't change. User sees false-positive UX feedback.

**The fix:** every mutation against a specific row by ID MUST chain `.select(...)` (or `.maybeSingle()` / `.single()`) AND verify the returned data is non-null + non-empty. Codified as I-PROPOSED-I in INVARIANT_REGISTRY (DRAFT until ORCH-0734-RW CLOSE).

**Why this matters with the original RLS-RETURNING fix:** the new `Account owner can select own brands` direct-predicate policy admits the post-mutation row via RETURNING. So `.select()` chain is now SAFE post-ORCH-0734-v1 (doesn't 42501 the way it would have pre-fix). The two fixes are complementary: ORCH-0734-v1 enables the RETURNING path; ORCH-0734-RW USES it for rowcount verification.

**Pattern to copy:** `mingla-business/src/services/brandsService.ts` `updateBrand` (lines 165-179) — destructures `data` AND `error`, throws if `data === null`. The fixed `softDeleteBrand` mirrors this pattern verbatim.
```

---

## 7. Success Criteria

| ID | Statement | Verification | Layer |
|---|---|---|---|
| SC-RW-1 | Brand-delete from BrandDeleteSheet on a real owner-brand: row's `deleted_at` becomes NOT NULL in DB; brand removed from switcher; "Brand deleted" Toast displays | Operator runs UI test post-IMPL: tap delete, type-confirm, confirm — verify via DB probe `SELECT deleted_at FROM brands WHERE id=X` returns timestamp; brand absent from switcher list; Toast briefly visible | Full-stack |
| SC-RW-2 | Brand-delete attempted on a brand that doesn't exist OR is already soft-deleted: BrandDeleteSheet shows inline error "Couldn't delete: softDeleteBrand: 0 rows updated..." and stays at step="confirm" | Operator runs forced test: manually pass an invalid brandId via dev tools OR use a brand whose deleted_at is already non-null; tap delete; verify inline error appears | Service + UI |
| SC-RW-3 | Trash icon visible on BrandSwitcherSheet dropsheet from all 3 tabs (account, home, events) | Operator opens dropsheet on each tab; verify trash icon Pressable visible per row | UI |
| SC-RW-4 | Tap trash icon on home tab dropsheet → opens BrandDeleteSheet for the tapped brand | Operator runs UI test on home tab; verify sheet opens with correct brand displayed | UI |
| SC-RW-5 | Tap trash icon on events tab dropsheet → opens BrandDeleteSheet for the tapped brand | Operator runs UI test on events tab; verify sheet opens with correct brand displayed | UI |
| SC-RW-6 | "Brand deleted" Toast fires on all 3 tabs after successful soft-delete | Operator runs UI test on each tab; verify Toast briefly visible | UI |
| SC-RW-7 | Diagnostic markers `[ORCH-0734-RW-DIAG]` print to Metro on every brand-delete attempt: ENTER + RESULT (success path) OR FAILED (error path) | Operator captures Metro output during delete attempt | Code |
| SC-RW-8 | I-PROPOSED-I CI gate self-test PASSES locally + on PR | Implementor runs self-test; CI runs on PR | CI |
| SC-RW-9 | I-PROPOSED-I CI gate against current `mingla-business/src/services/*.ts` PASSES (no false positives after fix) | Implementor runs gate locally post-fix | CI |

---

## 8. Test Cases

| ID | Scenario | Input | Expected | Layer | Maps to SC |
|---|---|---|---|---|---|
| T-RW-1 | Delete real brand happy path | Owner taps delete on real-brand-X | DB row deleted_at NOT NULL; brand absent from switcher; Toast "X deleted" | Full-stack | SC-RW-1, SC-RW-6 |
| T-RW-2 | Delete brand that's already soft-deleted (manually fake state) | Owner taps delete, but row's deleted_at is already NOT NULL | Inline error displayed, sheet stays at confirm step | Service + UI | SC-RW-2 |
| T-RW-3 | Trash icon visibility — account tab | Open dropsheet on account tab | Trash icon visible per row | UI | SC-RW-3 (regression check) |
| T-RW-4 | Trash icon visibility — home tab | Open dropsheet on home tab | Trash icon visible per row | UI | SC-RW-3, SC-RW-4 |
| T-RW-5 | Trash icon visibility — events tab | Open dropsheet on events tab | Trash icon visible per row | UI | SC-RW-3, SC-RW-5 |
| T-RW-6 | Trash tap → BrandDeleteSheet opens (home) | Tap trash icon on home dropsheet | BrandDeleteSheet visible with correct brand | UI | SC-RW-4 |
| T-RW-7 | Trash tap → BrandDeleteSheet opens (events) | Tap trash icon on events dropsheet | BrandDeleteSheet visible with correct brand | UI | SC-RW-5 |
| T-RW-8 | Diagnostic markers fire | Tap delete on any tab | `[ORCH-0734-RW-DIAG] softDeleteBrand step 2 — UPDATE ATTEMPT` + `RESULT` markers in Metro | Code | SC-RW-7 |
| T-RW-9 | CI gate self-test | `node ... --self-test` | Exit 0 (3 fixtures: violation/passing/waiver behave correctly) | CI | SC-RW-8 |
| T-RW-10 | CI gate against current code | `node ...` (full audit) | Exit 0 (no violations after fix) | CI | SC-RW-9 |
| T-RW-11 | Re-delete after successful delete | Tap delete twice fast on same brand | Second tap's UPDATE matches 0 rows (already soft-deleted); inline error displayed cleanly | Service + UI | SC-RW-2 |
| T-RW-12 | Cache invalidation post-delete (regression) | Delete brand, observe switcher list immediately | Brand absent from list (React Query refetches via invalidate) | Hook + Service | SC-RW-1 |

---

## 9. Implementation Order

1. **Service-layer fix** (`brandsService.ts:222-228`) — the critical RC-A fix; everything else depends on this throwing correctly.
2. **Hook-layer diagnostic markers** (`useBrands.ts:281-303`) — adds visibility for future debugging.
3. **home.tsx wiring** (imports → state → handlers → JSX) — mirror account.tsx pattern.
4. **events.tsx wiring** — mirror account.tsx pattern.
5. **account.tsx Toast parity** — add Toast in `handleBrandDeleted` for cross-tab UX consistency.
6. **CI gate script** (`i-proposed-i-mutation-rowcount-verified.mjs`) + self-test verification.
7. **CI workflow job** entry in `strict-grep-mingla-business.yml`.
8. **Invariant registry entry** I-PROPOSED-I (DRAFT).
9. **Memory file extension** (rowcount appendix to feedback_rls_returning_owner_gap.md, DRAFT).
10. **Implementation report** at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH_0734_REWORK_REPORT.md` per implementor 15-section template.

---

## 10. Invariants this fix preserves + extends

| Invariant | Preservation/Extension status |
|---|---|
| Constitutional #3 No silent failures | ✅ IMPROVED — RC-A silent no-op closed by rowcount verification |
| Constitutional #8 Subtract before adding | ✅ — fix is mechanical: rowcount check replaces ignore-data destructure; no new abstractions |
| I-PROPOSED-D MB-ERROR-COVERAGE (DRAFT) | ✅ ALIGNED — added structured `onError` to `useSoftDeleteBrand` per the spirit of this invariant |
| I-PROPOSED-H RLS-RETURNING-OWNER-GAP-PREVENTED (DRAFT) | ✅ DOWNSTREAM — uses the `Account owner can select own brands` policy that this fix established |
| **I-PROPOSED-I MUTATION-ROWCOUNT-VERIFIED (NEW DRAFT)** | ✅ **established by this fix** |

---

## 11. Regression surface

3-5 adjacent flows the tester should verify:

1. **Brand-create still works (post-fix)** — service `createBrand` unchanged; RC-0728-A fix from ORCH-0734-v1 still in effect; verify Create-tap on home tab succeeds.
2. **Brand-update non-soft-delete still works** — service `updateBrand` unchanged (already had correct rowcount handling per OB-2); verify edit name → save.
3. **Re-delete idempotency** — added in T-RW-11; the existing `.is("deleted_at", null)` filter at the WHERE level returns 0 rows on already-deleted brands; the new rowcount check should throw a structured error (not silent success).
4. **Switcher list refresh post-delete** — verify React Query refetches the list (existing invalidateQueries logic in onSuccess preserved); brand should disappear from list immediately.
5. **Brand-page navigation post-delete** — `BrandProfileRoute.handleBrandDeleted` calls `router.replace("/(tabs)/account")` (unchanged); should still work; verify operator lands on account tab after delete.

---

## 12. Discoveries — none beyond investigation

No new discoveries. Investigation §9 covers all known side issues.

---

## 13. Confidence

**HIGH** that this SPEC closes both root causes:
- Fix 1 (rowcount) is structurally provable: `.select("id")` returns the updated rows; `data.length === 0` reliably detects 0-row UPDATEs.
- Fix 2 (parent-prop wiring) mirrors a known-working pattern from account.tsx verbatim.
- Fix 3 (Toast) is additive UX polish; cannot regress.
- Fix 4 (diagnostic markers) is observation-only; cannot regress.
- I-PROPOSED-I + CI gate prevent reintroduction.

**MEDIUM** that the implementor will follow Implementation Order §9 exactly. Mitigation: numbered steps + verbatim before/after code blocks.

---

## 14. Operator post-IMPL workflow

After implementor returns:
1. Operator reviews impl report + diff.
2. Operator force-reloads Metro (no `supabase db push` needed — pure code-side fix).
3. Operator runs T-RW-1..T-RW-7 + T-RW-11 (UI smoke).
4. Operator captures Metro output showing `[ORCH-0734-RW-DIAG]` markers (T-RW-8).
5. Operator runs `node .github/scripts/strict-grep/i-proposed-i-mutation-rowcount-verified.mjs --self-test` (T-RW-9) and `node .github/scripts/strict-grep/i-proposed-i-mutation-rowcount-verified.mjs` (T-RW-10).
6. Pastes output for orchestrator REVIEW.
7. Orchestrator dispatches mingla-tester for full PASS verification.
8. On PASS: orchestrator runs CLOSE protocol — flips DRAFT→ACTIVE on memory file + I-PROPOSED-I, updates all 7 artifacts, provides commit message + EAS Update command, dispatches diagnostic-marker cleanup as next sequential cycle (now with 10 markers total to remove).

---

**End of SPEC.**
