# INVESTIGATION REPORT — ORCH-0734 REWORK — Brand-delete silent no-op + trash-icon parent-prop omission

**Authored:** 2026-05-06 by mingla-forensics
**Predecessors:** ORCH-0734 IMPL v1 (partial PASS — RC-0728-A fixed, RC-0728-B not closed)
**Dispatch:** [`prompts/INVESTIGATION_ORCH_0734_REWORK_DELETE_PATH_BRUTAL.md`](../prompts/INVESTIGATION_ORCH_0734_REWORK_DELETE_PATH_BRUTAL.md)
**Confidence:** HIGH for both root causes; HIGH for the audit completeness; MEDIUM for which of the two RCs the operator actually hit on each specific delete attempt (without Metro logs we can't pin every individual UI tap, but the bug class is proven by static-trace + DB ground truth).

---

## Layman summary

Two distinct bugs cause the symptom "delete claims success but brand persists" + "trash icon never shows":

1. **🔴 RC-0734-RW-A — `softDeleteBrand` does NOT verify rowcount.** When the UPDATE matches 0 rows (already-deleted, wrong brandId, or any future RLS denial), supabase-js returns success with `data=null`. The service ignores the rowcount entirely and returns `{rejected: false, brandId}`. The hook treats this as success, invalidates cache, fires `onDeleted`. UI navigates away. User believes deletion happened. DB unchanged.

2. **🔴 RC-0734-RW-B — Trash icon on `BrandSwitcherSheet` is parent-conditional, only `account.tsx` passes `onRequestDeleteBrand`.** When the operator opens the dropsheet from `home.tsx` or `events.tsx` tabs, the prop is `undefined` and the icon's conditional render returns null. Operator sees no trash icon. The brand-page delete CTA is the only delete entry point reachable from those tabs.

DB ground truth confirms partial work: the operator successfully soft-deleted 1 of 4 brands (`__QA_Probe_motmp7ei` at 08:27:10 UTC) — proving the DB layer is functional post-ORCH-0734-v1. The other 3 brands (`No dulling`, `__QA_Probe_motsmmxs`, `Vibes`) remain `deleted_at IS NULL`, consistent with either RC-A silent no-op OR operator never actually completed the 4-step delete flow on those.

Findings: 2 root causes, 1 contributing factor, 3 hidden flaws, 4 observations.

---

## 1. Symptom Summary

| Symptom | Reproduction | When started |
|---|---|---|
| Delete on brand page claims success but brand persists | Operator confirmed 2026-05-06 post-ORCH-0734-v1 deploy. UI advances through 4-step delete flow, mutation resolves, sheet closes, but brand still appears in switcher. | Pre-existing in Cycle 17e-A — was previously masked by RC-0728-B (42501 hard-fail). After ORCH-0734-v1 unblocked the WITH CHECK, the underlying silent-no-op + parent-prop gap became user-visible. |
| Trash icon on BrandSwitcherSheet dropsheet not visible | Operator confirmed: opened sheet, no icon. Tab context: most likely opened from home or events tab (both omit `onRequestDeleteBrand`). | Pre-existing since BrandSwitcherSheet was wired to home.tsx + events.tsx (no commits trace this back to a specific cycle, but the omission is consistent with progressive feature-rollout pattern — account.tsx was Cycle 17e-A "first surface", home + events were never updated to mirror). |

---

## 2. Investigation Manifest

| File | Layer | Why |
|---|---|---|
| Live DB probe — `pg_policies WHERE tablename='brands'` | Schema | Confirm post-ORCH-0734-v1 state: 7 policies present including 2 new owner direct-predicates ✅ |
| Live DB probe — `SELECT * FROM brands WHERE account_id=<operator>` | Data | Ground-truth which brands exist + which have deleted_at NOT NULL |
| `mingla-business/src/services/brandsService.ts` | Code | `softDeleteBrand` rowcount handling + `createBrand` / `updateBrand` siblings for pattern comparison |
| `mingla-business/src/hooks/useBrands.ts` | Code | `useSoftDeleteBrand` mutation onSuccess + cache invalidation logic + key factory + `useBrandList` shim |
| `mingla-business/src/hooks/useBrandListShim.ts` | Code | Confirm `useBrandList` is a thin React Query shim (NOT a Zustand source — initial hypothesis disproven) |
| `mingla-business/src/components/brand/BrandDeleteSheet.tsx` | Code | 4-step state machine; mutation call site; success/rejection/error branches |
| `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` | Code | Trash icon conditional render at line 346 (`onRequestDeleteBrand !== undefined`) — confirmed in PASS-1 |
| `mingla-business/app/brand/[id]/index.tsx` | Code | Brand-page delete entry — `BrandDeleteSheet` mounted with `accountId={user?.id ?? null}` + `onDeleted` redirects to /(tabs)/account |
| `mingla-business/app/(tabs)/account.tsx` | Code | The ONE tab that passes `onRequestDeleteBrand` to BrandSwitcherSheet (lines 275-280) — canonical pattern |
| `mingla-business/app/(tabs)/home.tsx` | Code | Confirmed line 361-365: `<BrandSwitcherSheet>` rendered WITHOUT `onRequestDeleteBrand` prop |
| `mingla-business/app/(tabs)/events.tsx` | Code | Confirmed line 500-504: `<BrandSwitcherSheet>` rendered WITHOUT `onRequestDeleteBrand` prop |

---

## 3. Findings (classified)

### 🔴 RC-0734-RW-A — `softDeleteBrand` ignores UPDATE rowcount

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/src/services/brandsService.ts:222-228` |
| **Exact code** | ```ts<br>const { error: updateError } = await supabase<br>  .from("brands")<br>  .update({ deleted_at: nowIso })<br>  .eq("id", brandId)<br>  .is("deleted_at", null);<br>if (updateError) throw updateError;<br>``` |
| **What it does** | Destructures only `error` from the supabase response. Does NOT chain `.select()`. Returns `Prefer: return=minimal` (per `OB-5` in original audit). PostgREST returns `204 No Content` on success — including when 0 rows match the WHERE clause + RLS. supabase-js returns no error. The function returns `{rejected: false, brandId}` even when zero rows were actually updated in the DB. |
| **What it should do** | Verify at least one row was updated. Either chain `.select("id")` to get returned row(s) and check `data.length === 1` (now safe post-ORCH-0734-v1 because the new owner-SELECT policy admits via direct predicate), OR use `.update(...).eq(...).is(...).select("id").maybeSingle()` to get a single-row response. If `data === null` or `data.length === 0`, throw a structured error: `Error("softDeleteBrand: 0 rows updated — brand may not exist, may already be soft-deleted, or RLS denied")`. |
| **Causal chain** | (1) Operator opens BrandDeleteSheet, types brand name to confirm, taps "Delete brand". (2) `BrandDeleteSheet.handleSubmit` calls `softDeleteMutation.mutateAsync({brandId, accountId})`. (3) Hook's `mutationFn` calls `softDeleteBrand(brandId)`. (4) Service runs UPDATE; if ANY of the following: brandId mismatch (stale UI state passes wrong brand), row already soft-deleted (idempotency filter `.is("deleted_at", null)` makes it match 0 rows), or RLS denial — UPDATE matches 0 rows. (5) supabase-js returns no error. Service returns `{rejected: false, brandId}`. (6) Hook's `onSuccess` fires: invalidates `brandKeys.list(accountId)` (correctly), removes detail/role/cascade caches. But cache invalidation is harmless because the DB state didn't change — refetch returns the same brand list. (7) `BrandDeleteSheet.handleSubmit` calls `onDeleted?.(result.brandId)` then `onClose()`. (8) Brand-page's `handleBrandDeleted` clears `currentBrand` if it matches, calls `router.replace("/(tabs)/account")`. (9) Operator lands on /(tabs)/account, sees the brand still in the switcher because nothing was actually deleted. |
| **Verification step** | Run with diagnostic: replace lines 222-228 with `.select("id")` chain + `console.log("[softDeleteBrand] UPDATE rowcount:", data?.length, "expected: 1");` — re-attempt delete on a brand that previously "claimed success". Observed rowcount of 0 confirms RC-A. Or run a controlled test in dashboard SQL: simulate brandId that doesn't match any row → run the UPDATE without RETURNING → confirm `UPDATE 0` returns silently from PostgREST. |

### 🔴 RC-0734-RW-B — `BrandSwitcherSheet` trash icon hidden by parent omission

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/app/(tabs)/home.tsx:361-365` and `mingla-business/app/(tabs)/events.tsx:500-504` (both confirmed via Read tool) |
| **Exact code (home.tsx:361-365)** | ```tsx<br><BrandSwitcherSheet<br>  visible={sheetVisible}<br>  onClose={handleCloseSheet}<br>  onBrandCreated={handleBrandCreated}<br>/><br>``` (note: no `onRequestDeleteBrand` prop) |
| **What it does** | `BrandSwitcherSheet.tsx:346-356` conditionally renders the per-row trash icon ONLY when `onRequestDeleteBrand !== undefined`. When the prop is omitted (home.tsx, events.tsx), every row's trash slot returns `null` — operator sees no delete affordance on those tabs. |
| **What it should do** | All three tabs that render `<BrandSwitcherSheet>` should pass `onRequestDeleteBrand` AND wire the receiving `<BrandDeleteSheet>`, mirroring `account.tsx` lines 60-130 + 282-... verbatim. Alternatively, hoist the BrandDeleteSheet state machine into a shared layout (e.g., `app/(tabs)/_layout.tsx`) so all tabs benefit without per-tab duplication. The latter is the architecturally cleaner fix. |
| **Causal chain** | (1) Operator on Home or Events tab. (2) Taps brand chip in TopBar to open BrandSwitcherSheet. (3) Sheet renders rows for each brand. (4) For each row, `onRequestDeleteBrand !== undefined` evaluates FALSE because parent didn't pass it. (5) Trash icon Pressable returns null. (6) Operator sees brand list with no delete affordance. (7) Operator navigates to brand page (alternative entry point), opens BrandDeleteSheet there. (8) That delete attempt also "doesn't work" due to RC-A separately. |
| **Verification step** | Operator opens BrandSwitcherSheet from `account.tsx` (account tab) — trash icons visible. Same operator opens it from home or events tab — no trash icons. Confirms parent-prop dependency. Static-trace confirmation: `account.tsx:279` passes `onRequestDeleteBrand={handleRequestDeleteBrand}`; `home.tsx:361-365` and `events.tsx:500-504` do not. |

### 🟠 CF-0734-RW-1 — `BrandDeleteSheet` has no explicit success Toast / inline confirmation

| Field | Evidence |
|---|---|
| **File** | `mingla-business/src/components/brand/BrandDeleteSheet.tsx:154-158` |
| **What it does** | On success, `handleSubmit` calls `onDeleted?.(result.brandId)` then `onClose()`. No Toast. No haptic. No inline success card. The sheet just closes and the parent route navigates away. Operator interprets "sheet closed + redirected" as "must have worked." |
| **Why classified contributing, not root cause** | Even if RC-A is fixed (rowcount verified) and the delete genuinely succeeds, the lack of explicit success feedback is a UX gap. Combined with RC-A, it makes silent no-ops feel identical to real deletes. Fixing RC-A alone removes the false-positive case but leaves the success path's UX feedback weak. |
| **Recommended direction** | After RC-A fix, add either: (a) a Toast in the parent's `onDeleted` callback ("Brand deleted") OR (b) a brief 500ms transition step inside the sheet showing "Deleted ✓" before close + redirect. Option (b) is more confidence-building because feedback fires inside the sheet boundary before navigation. |

### 🟡 HF-0734-RW-1 — `softDeleteBrand` step 3 (`clear default_brand_id`) silently `console.warn`s on failure

| Field | Evidence |
|---|---|
| **File** | `mingla-business/src/services/brandsService.ts:230-243` |
| **What it does** | After successful step-2 UPDATE, step 3 clears `creator_accounts.default_brand_id` if it pointed at the soft-deleted brand. If this fails, the function `console.warn`s but does NOT throw. Returns success regardless. |
| **Why classified hidden flaw, not root cause** | Doesn't cause today's symptom. But it violates Constitutional #3 (no silent failures): if the cleanup fails, the user has a stale `default_brand_id` pointer to a soft-deleted brand. Future cycle that reads `default_brand_id` may render UI for a tombstone or get confused. The `console.warn` is pre-existing per Cycle 17e-A SPEC §3.2.7 design (non-fatal). Acceptable for now; codify intent with a `// [TRANSITIONAL]` comment OR make it part of an atomic RPC in a future cycle. |

### 🟡 HF-0734-RW-2 — Same silent-no-op pattern in `updateBrand` (line 165-179)

| Field | Evidence |
|---|---|
| **File** | `mingla-business/src/services/brandsService.ts:165-179` |
| **What it does** | `updateBrand` chains `.select().single()` (post-ORCH-0734-v1, this works because the new owner-SELECT policy admits the post-update row). It correctly throws if `data === null`. So `updateBrand` is NOT vulnerable to the same silent-no-op as `softDeleteBrand`. **Re-classified to 🔵 OB-2 below — this is actually the GOOD pattern; `softDeleteBrand` should mirror it.** |
| **Re-classification** | Moved to 🔵 observation (good pattern to copy). |

### 🟡 HF-0734-RW-2 — No diagnostic logging on delete code path (logError gap)

| Field | Evidence |
|---|---|
| **File** | `mingla-business/src/services/brandsService.ts:198-246`, `mingla-business/src/hooks/useBrands.ts:281-303`, `mingla-business/src/components/brand/BrandDeleteSheet.tsx:134-167` |
| **What it does** | The 6 `[ORCH-0728-DIAG]` markers we added in PASS-3..12 cover ONLY the brand-create handler in `BrandSwitcherSheet.tsx` (the create flow). The brand-delete code path has zero diagnostic markers. When operator hit "delete claims success" today, there was no Metro log surfacing what actually happened — making this re-investigation harder than it needed to be. |
| **Why classified hidden flaw, not root cause** | Not the cause of today's symptom; would have made today's diagnosis instant if it existed. Tied to the I-PROPOSED-D MB-ERROR-COVERAGE invariant (DRAFT). The fix dispatch should optionally add temporary diagnostic markers to the delete service + hook BEFORE rework testing, as TRANSITIONAL aids — operator confirms via Metro logs, then markers removed at CLOSE. |

### 🟡 HF-0734-RW-3 — Trash-icon visibility logic is OK at the SwitcherSheet level but parent-prop omission is silent

| Field | Evidence |
|---|---|
| **File** | `mingla-business/src/components/brand/BrandSwitcherSheet.tsx:62-67` (Props interface — `onRequestDeleteBrand` is optional `?`) |
| **What it does** | The prop being optional is correct API design, but the parent-side risk (forgetting to wire it) has no compile-time enforcement and no runtime warning. A type-check would pass even if every parent omits it. |
| **Why classified hidden flaw** | Not today's bug per se (RC-B is the operator-facing manifestation), but the structural risk is broader: any future tab that adds `<BrandSwitcherSheet>` will silently lack delete UX unless the developer remembers to wire it. The fix dispatch should propose either (a) hoisting to a shared layout (eliminates duplication, removes the risk), OR (b) making the prop required (`onRequestDeleteBrand: (brand: Brand) => void`) — forces every caller to wire it, breaks compile if not. |

### 🔵 OB-1 — DB ground truth confirms 1 of 4 brands successfully soft-deleted (DB layer is working)

DB query for operator account `b17e3e15-...`:

| name | created_at | deleted_at | Status |
|---|---|---|---|
| No dulling | 2026-05-06 08:26:28 | NULL | active |
| __QA_Probe_motsmmxs | 2026-05-06 08:26:28 | NULL | active (raw-fetch probe leftover) |
| Vibes | 2026-05-06 05:40:31 | NULL | active |
| __QA_Probe_motmp7ei | 2026-05-06 05:40:30 | **2026-05-06 08:27:10** | **soft-deleted** |

Critical implication: at 08:27:10 the operator successfully soft-deleted ONE brand. So the DB-layer ORCH-0734-v1 fix is functional. The "delete claims success but brand persists" symptom on the OTHER 3 must have hit RC-A silent-no-op on a subsequent attempt.

### 🔵 OB-2 — `updateBrand` correctly chains `.select().single()` and verifies non-null `data` — copy this pattern for `softDeleteBrand`

`mingla-business/src/services/brandsService.ts:165-179`:
```ts
const { data, error } = await supabase
  .from("brands")
  .update(updatePayload)
  .eq("id", brandId)
  .is("deleted_at", null)
  .select()
  .single();
if (error) throw error;
if (data === null) {
  throw new Error("updateBrand: update returned null row...");
}
```

This is the correct pattern. `softDeleteBrand` deviates by destructuring only `error`. The fix is to mirror this pattern.

### 🔵 OB-3 — `softDeleteBrand` step 1 (events count check) uses `is("deleted_at", null)` filter on events — correct

Line 207: `.is("deleted_at", null)` — confirms the count check excludes already-soft-deleted events. No bug here.

### 🔵 OB-4 — Two QA probe brands persist in production data (`__QA_Probe_*`)

`__QA_Probe_motsmmxs` and `__QA_Probe_motmp7ei` are leftovers from PASS-7 raw-fetch probe + a subsequent test. Per ORCH-0729 SPEC §6 cleanup notes, these should be hard-deleted at end of investigation. Not a bug — operational discovery for orchestrator to schedule cleanup.

---

## 4. Five-Layer Cross-Check

| Layer | Says | Reality |
|---|---|---|
| **Docs** (Cycle 17e-A SPEC §3.2.7) | "softDeleteBrand returns SoftDeleteRejection (not throw) on workflow rejection; throws on Postgrest error" | Code matches but is INCOMPLETE — does not handle 0-row UPDATE which is neither "rejection" nor "Postgrest error" |
| **Schema** | 7 policies on brands (post ORCH-0734-v1); RLS admits owner mutation correctly | ✅ verified live |
| **Code** | softDeleteBrand:222-228 destructures only `error`; updateBrand:165-179 destructures `data` AND `error` | INCONSISTENT pattern between siblings — softDeleteBrand is the outlier |
| **Runtime** | Per operator: "delete claims success but brand persists" | Consistent with silent-no-op pattern |
| **Data** | 1 of 4 brands soft-deleted in DB; 3 active | Confirms DB fix works for at least one delete attempt; subsequent attempt(s) hit RC-A |

**Layer disagreement:** Docs (SPEC §3.2.7) say "throws on Postgrest error" but the code contract is incomplete vs zero-row-UPDATE case. The SPEC should have specified rowcount verification but didn't. The IMPLEMENTOR cannot be faulted for following the SPEC verbatim — this is a SPEC-level gap that propagated to code.

---

## 5. Blast Radius

For RC-0734-RW-A (rowcount silent no-op):
- **`softDeleteBrand`** — confirmed
- **`createBrand`** — uses `.select().single()` + null check ✅ safe
- **`updateBrand`** — uses `.select().single()` + null check ✅ safe
- **Adjacent services in mingla-business**: `creatorAccount.ts:20` UPSERT (idempotent by design — destructures only `error`, but UPSERT on PK behaves correctly), `useAccountDeletion.ts:73,80` UPDATE on creator_accounts — should be re-audited for the same pattern
- **App-mobile**: out of scope per ORCH-0734 dispatch operator-directive; would need its own audit cycle

For RC-0734-RW-B (parent-prop omission):
- **3 tabs render `<BrandSwitcherSheet>`**: account.tsx ✅ wired, home.tsx ❌ omitted, events.tsx ❌ omitted

For CF-0734-RW-1 (no success Toast):
- **All 3 tabs that delete**: same UX gap

For HF-0734-RW-2 (no diagnostic logging):
- **Entire delete path**: zero markers; tied to existing I-PROPOSED-D MB-ERROR-COVERAGE invariant (DRAFT) — this gap is on the critical path of that invariant's eventual ACTIVE flip

---

## 6. Invariant Violations

| Invariant | Status |
|---|---|
| **Constitutional #3 (no silent failures)** | 🔴 VIOLATED by RC-A (UPDATE 0 rows = silent failure that user perceives as success). Fix is required structural change. |
| **Constitutional #8 (subtract before adding)** | ⚪ N/A |
| **I-PROPOSED-D MB-ERROR-COVERAGE (DRAFT)** | 🟡 LOOSELY APPLIES — this invariant requires every catch in mingla-business to call `logError`. RC-A is not a catch but a missed-error path. The invariant could be EXTENDED in this dispatch to cover "every mutation that affects a specific row by ID must verify rowcount > 0." Proposed extension: **I-PROPOSED-I MUTATION-ROWCOUNT-VERIFIED**. |
| **I-PROPOSED-H RLS-RETURNING-OWNER-GAP-PREVENTED (DRAFT)** | ✅ holds — this fix is downstream of the policy fix, not a violation of it |

---

## 7. Fix Strategy (direction only — full SPEC in companion file)

### Fix 1 — `softDeleteBrand` rowcount verification (closes RC-A)

In `mingla-business/src/services/brandsService.ts:222-228`, change to:
```ts
const { data, error: updateError } = await supabase
  .from("brands")
  .update({ deleted_at: nowIso })
  .eq("id", brandId)
  .is("deleted_at", null)
  .select("id");
if (updateError) throw updateError;
if (data === null || data.length === 0) {
  throw new Error(
    "softDeleteBrand: 0 rows updated — brand may not exist, may already be soft-deleted, or RLS denied. brandId=" + brandId
  );
}
```

The `.select("id")` chain triggers `Prefer: return=representation` → invokes RC-0728-A pattern. This is now SAFE because ORCH-0734-v1 added the `Account owner can select own brands` direct-predicate SELECT policy that admits the post-update row regardless of `deleted_at` state.

The `BrandDeleteSheet.handleSubmit` already has a `try/catch` that handles the throw → goes back to `step="confirm"` and shows `submitError` inline. So a 0-row failure now surfaces visibly instead of silently.

### Fix 2 — Wire `onRequestDeleteBrand` from home.tsx + events.tsx (closes RC-B)

Two acceptable architectures:

**Option A (per-tab duplication, mirror `account.tsx`):**
- Add `useState<boolean>` for `deleteSheetVisible` + `useState<Brand | null>` for `brandPendingDelete` to home.tsx
- Add `handleRequestDeleteBrand` callback that opens the sheet + sets state
- Render `<BrandDeleteSheet>` alongside `<BrandSwitcherSheet>` with `onRequestDeleteBrand` prop wired
- Mirror exactly in events.tsx

**Option B (shared layout, hoisted):**
- Move BrandDeleteSheet state machine into `app/(tabs)/_layout.tsx` (or a shared context) so all tabs benefit
- Each tab passes `onRequestDeleteBrand` from a hook like `useBrandDeleteSheet()` that exposes the open handler

**Recommendation:** Option A for minimum scope. Option B is architecturally cleaner but expands scope significantly + risks regression on other tabs.

### Fix 3 — Optional explicit success feedback (closes CF-1)

Add a Toast call in `BrandDeleteSheet.handleSubmit` after `onDeleted?.()`:
```ts
// After onDeleted fires + before onClose
showToast?.("Brand deleted");
onClose();
```

Or pass a `onDeleteSucceeded` callback that the parent uses to show its own Toast (more flexible). Not blocking; nice-to-have polish.

### Fix 4 — Diagnostic logging on delete service + hook (TRANSITIONAL — closes HF-2)

Add `console.error` markers around softDeleteBrand + useSoftDeleteBrand mutationFn similar to ORCH-0728 markers. Mark `[ORCH-0734-RW-DIAG]` with same removal protocol (cleanup at CLOSE).

### Fix 5 — NEW invariant I-PROPOSED-I MUTATION-ROWCOUNT-VERIFIED

Statement: Every supabase-js mutation in mingla-business that targets a specific row(s) by ID (`.eq("id", X)` style) MUST verify rowcount via `.select(...)` chain or equivalent, AND throw a structured error if rowcount is 0. Exempt: UPSERT on PK (idempotent by design). Codified in INVARIANT_REGISTRY as DRAFT until ORCH-0734-RW CLOSE. Backed by a new strict-grep CI gate (similar pattern to I-PROPOSED-H).

---

## 8. Regression Prevention Requirements

1. **NEW invariant I-PROPOSED-I MUTATION-ROWCOUNT-VERIFIED** registered DRAFT during SPEC, ACTIVE on tester PASS.
2. **CI gate** — strict-grep variant that scans `mingla-business/src/services/*.ts` for `.update(`/`.delete(` patterns NOT followed by `.select(`. Plug into `.github/workflows/strict-grep-mingla-business.yml` per `feedback_strict_grep_registry_pattern`.
3. **Tests** — define T-RW-1..N in SPEC covering (a) successful delete actually deletes (DB row deleted_at IS NOT NULL afterward), (b) attempted delete on already-soft-deleted brand throws structured error, (c) trash icon visible on all 3 tabs, (d) error path inline message displays.
4. **Skill memory extension** — `feedback_rls_returning_owner_gap.md` should reference this RW cycle so future agents know the pattern is more than just RLS — it's also rowcount verification.

---

## 9. Discoveries for Orchestrator

| ID | Discovery | Severity | Recommendation |
|---|---|---|---|
| D-FOR-0734-RW-1 | 2 leftover `__QA_Probe_*` brands in production DB from PASS-7 raw-fetch probe + subsequent test | S3 (data hygiene) | Schedule operational cleanup after ORCH-0734-RW CLOSE: hard-DELETE `__QA_Probe_motsmmxs` + soft-deleted `__QA_Probe_motmp7ei` rows |
| D-FOR-0734-RW-2 | LF-1 from original audit (events soft-delete RETURNING latent) is now MORE relevant — the same rowcount-silent-no-op pattern likely affects events too | S2 (latent) | Register ORCH-0735 candidate: extend the rowcount fix to event mutations when events soft-delete UI ships |
| D-FOR-0734-RW-3 | Cycle 17e-A SPEC §3.2.7 missed specifying rowcount verification — root cause of why this bug shipped | S3 (process improvement) | Add to forensics skill checklist: "every spec for a mutation must specify rowcount verification expectations" |
| D-FOR-0734-RW-4 | Trash icon visibility on home + events tabs has been broken since they were wired (no specific commit, but a structural omission) — operator never noticed because the previous bug class (42501) overshadowed it | S3 (UX — already absorbed by RC-B fix) | No separate action — fixed by Fix 2 |
| D-FOR-0734-RW-5 | The 6 `[ORCH-0728/0729/0730/0733-DIAG]` markers + the 4 NEW `[ORCH-0734-RW-DIAG]` markers (if Fix 4 ships) all need cleanup post-PASS — total 10 markers to remove in cleanup cycle | S2 | Schedule diagnostic-marker cleanup as next dispatch after ORCH-0734-RW CLOSE |

---

## 10. Confidence

| Finding | Confidence | Why |
|---|---|---|
| RC-0734-RW-A `softDeleteBrand` rowcount silent no-op | HIGH | Source code read verbatim; pattern is structurally provable (no `.select()` chain → no rowcount info → cannot detect 0-row UPDATE); sibling `updateBrand` proves the correct pattern exists 30 lines below |
| RC-0734-RW-B trash icon parent-prop omission | HIGH | All 3 tab files read verbatim; only `account.tsx:279` passes `onRequestDeleteBrand`; `home.tsx:361-365` and `events.tsx:500-504` confirmed not to pass it |
| Operator's specific delete attempts all hit RC-A vs RC-B vs UX confusion | MEDIUM | DB ground truth proves at least 1 delete worked (`__QA_Probe_motmp7ei`); the other 3 brands' state is consistent with EITHER never-attempted-delete OR hit-RC-A. Without Metro logs we can't pin exactly which. Doesn't matter for the fix — both bug classes are real. |
| The fix closes both bugs | HIGH | Fix 1 (.select chain + rowcount throw) is structurally sound + matches sibling pattern; Fix 2 is mechanical mirror of working code in account.tsx |

---

## 11. Operator post-step

1. Orchestrator REVIEWs this report.
2. Forensics produces companion SPEC `Mingla_Artifacts/specs/SPEC_ORCH_0734_REWORK_DELETE_FIX.md`.
3. Orchestrator REVIEWs the SPEC.
4. Operator dispatches mingla-implementor against the SPEC.
5. Operator force-reloads Metro + retests delete from each tab + verifies trash icon visible on all 3 tabs.
6. Tester PASSes via T-RW-1..N.
7. CLOSE protocol: I-PROPOSED-I → ACTIVE; diagnostic markers cleanup dispatch; commit + EAS update.

---

**End of report.**
