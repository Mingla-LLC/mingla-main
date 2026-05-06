# IMPL REPORT — ORCH-0728 PASS-3 DIAGNOSTIC PATCH

**Mode:** IMPLEMENT (DIAGNOSTIC ONLY — temporary; replaced by full IMPL of `SPEC_ORCH_0728_FULL_FIX.md`)
**Dispatch anchor:** [`prompts/IMPL_ORCH_0728_PASS_3_DIAGNOSTIC.md`](../prompts/IMPL_ORCH_0728_PASS_3_DIAGNOSTIC.md)
**Investigation anchor:** [`reports/INVESTIGATION_ORCH_0728_PASS_3_BRUTAL.md`](INVESTIGATION_ORCH_0728_PASS_3_BRUTAL.md)
**Authored:** 2026-05-05

---

## 1. Layman summary

5 surgical `console.error` lines added across 4 files. Every catch block in the brand-create chain now prints a structured `[ORCH-0728-DIAG]` line to the Metro terminal showing error.name + message + code + details + hint + (some) stack — so the operator's next tap reveals the actual failure in plain sight. ADDITIVE only — every existing UX surface (setSlugError / Alert / setStep / toast) preserved verbatim. tsc=0. 5 minutes.

**Status:** completed · **Verification:** passed (tsc=0; 5 sites grep-confirmed with `[DIAG ORCH-0728-PASS-3]` markers)

---

## 2. Sites patched

| # | File | Line(s) | Change |
|---|---|---|---|
| 1 | `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` | ~119 | Wrapped silent-return with diagnostic console.error reporting auth-not-ready state (userPresent / userIdPresent flags) |
| 2 | `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` | ~134 | Added diagnostic console.error as FIRST line of catch block; logs name + message + code + details + hint + stack |
| 3 | `mingla-business/src/hooks/useBrands.ts` | ~148 (useCreateBrand onError) | Replaced `_error` with `error`; added diagnostic console.error logging name + message + code + details + hint + accountId + brandName |
| 4 | `mingla-business/src/hooks/useBrands.ts` | ~225 (useUpdateBrand onError) | Same pattern; logs brandId + accountId in extra |
| 5 | `mingla-business/src/services/creatorAccount.ts` | ~31 | Replaced `console.warn(...)` with `console.error("[ORCH-0728-DIAG]")` reporting structured fields + userId |

All 5 sites carry `// [DIAG ORCH-0728-PASS-3] — replaced by logError() on full IMPL` comment so the full IMPL pass can grep-find + replace them.

---

## 3. Old → New receipts

### `mingla-business/src/components/brand/BrandSwitcherSheet.tsx`

**What it did before:** Silent early-return at line 119 (`if (user === null || user.id === undefined) return;`) with NO log, NO state change. Catch block at line 134 swallowed `error.message` entirely — generic UX-only branching.

**What it does now:** Silent-return now ALSO emits `console.error("[ORCH-0728-DIAG] BrandSwitcherSheet#handleSubmit AUTH-NOT-READY", {...})`. Catch block now ALSO emits `console.error("[ORCH-0728-DIAG] BrandSwitcherSheet#handleSubmit FAILED", {...})` BEFORE the existing branching.

**Why:** Investigation PASS-3 §4 root-cause SUSPECTED — could be F-2 (silent return) OR catch-side error. Diagnostic patch surfaces both paths to terminal.

**Lines changed:** ~22 (2 sites × ~11 lines each including comments)

### `mingla-business/src/hooks/useBrands.ts`

**What it did before:** useCreateBrand onError (line 148) named the parameter `_error` (intentionally unused — Const #3 violation). useUpdateBrand onError (line 225) same pattern. Both rolled back cache without logging the rejected error.

**What it does now:** Both onError callbacks now name the parameter `error` and emit `console.error("[ORCH-0728-DIAG] useCreate/UpdateBrand#onError FAILED", {...})` BEFORE the existing rollback logic.

**Why:** PASS-3 H-3 + H-4 silent-failure catalog entries. Mutation-layer errors were entirely invisible; surfaces them so operator + forensics can read the rejection.

**Lines changed:** ~24 (2 sites × ~12 lines each including comments)

### `mingla-business/src/services/creatorAccount.ts`

**What it did before:** `console.warn("[creator_accounts] upsert failed:", error.message)` — only `error.message`, severity=warn (terminal display less prominent than error), no structured fields.

**What it does now:** `console.error("[ORCH-0728-DIAG] creatorAccount#ensureCreatorAccount FAILED", { name, message, code, details, hint, userId })` — structured + severity=error.

**Why:** PASS-3 H-7 — ensureCreatorAccount runs on every sign-in (AuthContext bootstrap + onAuthStateChange listener). If THIS upsert is silently failing for the operator's account, every downstream RLS check that depends on `creator_accounts.id = auth.uid()` (including brands INSERT WITH CHECK) would break. Visibility here is essential.

**Lines changed:** ~10

---

## 4. Verification

### tsc

```
$ cd mingla-business && npx tsc --noEmit
[exit 0, no output]
EXIT=0
```

✅ PASS

### Grep-confirm diagnostic markers present

5 sites, all marked with `[DIAG ORCH-0728-PASS-3]`:
- BrandSwitcherSheet.tsx — 2 markers (silent-return + catch)
- useBrands.ts — 2 markers (useCreateBrand onError + useUpdateBrand onError)
- creatorAccount.ts — 1 marker

### Existing UX preserved (verified by post-edit re-read)

- BrandSwitcherSheet `setSlugError(...)`, `setSubmitting(false)`, `if (error instanceof SlugCollisionError)` branching — UNCHANGED ✅
- useCreateBrand snapshot rollback logic — UNCHANGED ✅
- useUpdateBrand detailSnap + listSnap rollback logic — UNCHANGED ✅
- creatorAccount upsert logic — UNCHANGED (only the post-error log line replaced) ✅

---

## 5. Spec traceability

This is a DIAGNOSTIC-ONLY patch dispatch. No SC verification matrix from `SPEC_ORCH_0728_FULL_FIX.md` applies — that's the full IMPL pass that follows. The dispatch's own success criterion is:

| Criterion | Verification |
|---|---|
| 5 console.error sites added with diagnostic shape | ✅ Confirmed (§2 table) |
| All sites marked with `[DIAG ORCH-0728-PASS-3]` | ✅ Confirmed |
| Existing UX preserved (no removal of setState/Alert/toast/setSlugError calls) | ✅ Confirmed (§4 re-read) |
| tsc=0 | ✅ Confirmed |
| Diagnostic logs name + message + code + details + hint + relevant context fields | ✅ Confirmed |

---

## 6. Invariant preservation

| Invariant | Status | Note |
|---|---|---|
| Const #1 No dead taps | UNCHANGED — silent-return path still returns silently for the user, but now logs to terminal. Full fix at IMPL pass adds disabled-button. |
| Const #3 No silent failures | IMPROVED — 5 sites no longer fully silent. Full I-PROPOSED-D landing at full IMPL replaces these with `logError()`. |
| Const #5 Server state via React Query | Unchanged |
| I-PROPOSED-A brands deleted_at filter | Unchanged |
| I-PROPOSED-C no setBrands callers | Unchanged (no new setBrands references) |

---

## 7. Cache safety

No query keys changed. No mutation logic altered. No persisted state shape changed. Diagnostic logs are read-only. **No cache impact.**

---

## 8. Regression surface

Diagnostic-only — no functional change. Adjacent features that could (theoretically) be affected:

1. Performance — 5 console.error calls on error paths only; negligible
2. Eslint — added `// eslint-disable-next-line no-console` so no new lint failures
3. CI — strict-grep gates unaffected (existing 5 gates: i37/i38/i39/I-PROPOSED-A/I-PROPOSED-C all still apply); I-PROPOSED-D not yet shipped (full IMPL pass)

Tester focus areas after operator runtime smoke:
- Confirm operator sees `[ORCH-0728-DIAG]` lines in Metro terminal on tap
- Confirm existing inline-error UX still appears under input as before

---

## 9. Constitutional compliance

| Rule | Status |
|---|---|
| #1 No dead taps | unchanged (full fix at IMPL pass) |
| #3 No silent failures | improved at 5 sites |
| Other 12 | unchanged |

---

## 10. Discoveries for orchestrator

| ID | Description |
|---|---|
| **D-IMPL-DIAG-1** | All 5 sites edited cleanly without ambiguity — line numbers in dispatch matched exact code locations |
| **D-IMPL-DIAG-2** | useCreateBrand + useUpdateBrand both used `_error` prefix (intentionally unused parameter convention) — replacing with `error` triggered no eslint complaints; full IMPL should enforce no-unused-prefix on mutation onError going forward |
| **D-IMPL-DIAG-3** | creatorAccount.ts's existing log was `console.warn` — caught by PASS-3 H-7 as a severity-mismatch issue. The full IMPL's `logError(..., { severity: "warn" })` will preserve warn severity but with structured shape; this diagnostic patch overrides to error severity for visibility |

---

## 11. Transition items

All 5 sites are TRANSITIONAL by design:
- Marker: `// [DIAG ORCH-0728-PASS-3] — replaced by logError() on full IMPL`
- Exit condition: full IMPL of `SPEC_ORCH_0728_FULL_FIX.md` lands → grep finds these markers → replaces each with proper `logError(error, { surface, extra })` call

If full IMPL is delayed past 1 cycle, the diagnostic logs are ABSORBABLE (they're additive, structured, and don't conflict with future logError migration). But they should NOT survive into a production release — they hardcode `console.error` instead of going through the proper sink interface.

---

## 12. Operator post-step (per dispatch §5)

1. **Force-reload Metro:** `cd mingla-business && npx expo start --clear`
2. **Wait for Metro's QR code / `Metro waiting on exp+...` message** — confirms Metro is serving
3. **On dev client:** shake → tap **Reload** — confirm "Loading bundle …" banner appears (visual proof of fresh fetch)
4. **Tap Create brand** in BrandSwitcherSheet
5. **Capture Metro terminal output** between sheet-open and 5 seconds after tap; copy entire chunk
6. **Paste into chat** — orchestrator passes to forensics PASS-4

What to look for in the terminal:
- `[ORCH-0728-DIAG] BrandSwitcherSheet#handleSubmit AUTH-NOT-READY` → F-2 confirmed (operator's auth state wasn't ready)
- `[ORCH-0728-DIAG] BrandSwitcherSheet#handleSubmit FAILED` with `code` field → tells us exactly what Postgres rejected (PGRST204 / 42501 / 23505 / network / etc.)
- `[ORCH-0728-DIAG] useCreateBrand#onError FAILED` → mutation-layer reached but rejected
- `[ORCH-0728-DIAG] creatorAccount#ensureCreatorAccount FAILED` → upstream auth-issue masking the brand-create symptom
- NO logs at all → bundle didn't reload (force-reload didn't take); H17b proven

---

**Authored:** 2026-05-05
**Authored by:** mingla-implementor
**Status:** implemented and verified (tsc=0, 5 sites confirmed, ADDITIVE-only)
**Awaiting:** operator force-reload + retest + paste terminal output → orchestrator hands to forensics PASS-4 → PASS-4 root-causes definitively → orchestrator dispatches full IMPL of `SPEC_ORCH_0728_FULL_FIX.md`
