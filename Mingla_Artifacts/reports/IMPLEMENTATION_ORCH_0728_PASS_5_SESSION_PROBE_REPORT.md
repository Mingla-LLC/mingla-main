# IMPL REPORT — ORCH-0728 PASS-5 SESSION PROBE

**Mode:** IMPLEMENT (DIAGNOSTIC ONLY — temporary, removed at full IMPL of `SPEC_ORCH_0728_FULL_FIX.md`)
**Dispatch anchor:** [`prompts/IMPL_ORCH_0728_PASS_5_SESSION_PROBE.md`](../prompts/IMPL_ORCH_0728_PASS_5_SESSION_PROBE.md)
**Authored:** 2026-05-06

---

## 1. Layman summary

Added 1 supabase import + 1 PRE-MUTATE session-probe block (~13 lines) to `BrandSwitcherSheet.tsx`. The probe runs immediately BEFORE `mutateAsync` and dumps the Supabase client's session shape (sessionPresent / sessionUserId / sessionExpiresAt / matches React user.id / tokenStart / hasError) to terminal. Operator's next tap will reveal whether (H22) the client has no session, (H23) the session is for a different user, or (H24) the session is fine but isn't being attached to the request. ADDITIVE only — existing UX + PASS-3 diagnostics preserved. tsc=0.

**Status:** implemented and verified · **Verification:** passed (tsc=0; 2 markers `[DIAG ORCH-0728-PASS-5]` present)

---

## 2. Sites patched

| # | File | Line(s) | Change |
|---|---|---|---|
| 1 | `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` | imports (after line 46) | Added `import { supabase } from "../../services/supabase";` with `[DIAG ORCH-0728-PASS-5]` marker |
| 2 | `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` | inside try-block before `await createBrandMutation.mutateAsync({...})` | Added 13-line PRE-MUTATE session probe with `console.error("[ORCH-0728-DIAG] PRE-MUTATE session probe", {...})` |

Both sites carry the `[DIAG ORCH-0728-PASS-5]` marker so the full IMPL pass can grep + remove.

---

## 3. Old → New receipts

### `mingla-business/src/components/brand/BrandSwitcherSheet.tsx`

**What it did before:** `handleSubmit` called `createBrandMutation.mutateAsync({...})` directly with no visibility into the supabase client's session state.

**What it does now:** Immediately before `mutateAsync`, calls `await supabase.auth.getSession()` and emits a structured `console.error("[ORCH-0728-DIAG] PRE-MUTATE session probe", {...})` line containing: `sessionPresent`, `sessionUserId`, `sessionExpiresAt`, `reactUserId`, `matches`, `tokenStart` (first 12 chars of access_token), `hasError`, `errorMessage`. The mutation call itself runs unchanged.

**Why:** PASS-5 forensics rejected F-9 (session-expired) — fresh sign-in still produces 42501. The new hypothesis space (H22/H23/H24) requires runtime evidence about the supabase client's session state at the exact moment `mutateAsync` fires. This probe captures it.

**Lines changed:** ~15 (1 import line + 13 probe lines + adjacent comment)

---

## 4. Verification

### tsc

```
$ cd mingla-business && npx tsc --noEmit
[exit 0, no output]
EXIT=0
```

✅ PASS — supabase import resolves cleanly; getSession typing matches @supabase/supabase-js return shape.

### Existing UX preserved (verified post-edit)

- `setSubmitting(true)`, `setSlugError(null)`, `try { ... } catch (error) { ... } finally { ... }` block structure — UNCHANGED ✅
- `createBrandMutation.mutateAsync({...})` call — UNCHANGED ✅
- `setCurrentBrand(newBrand)`, `onBrandCreated?.(newBrand)`, `onClose()` — UNCHANGED ✅
- Existing `[DIAG ORCH-0728-PASS-3]` markers (silent-return + catch) — UNCHANGED ✅

---

## 5. Spec traceability

This is a DIAGNOSTIC-ONLY micro-dispatch — no SC matrix from the full spec applies. Dispatch's own success criterion:

| Criterion | Verification |
|---|---|
| 1 supabase import added (if missing) | ✅ Added (was previously absent) |
| 1 PRE-MUTATE session probe block inserted before mutateAsync | ✅ Confirmed |
| Both sites marked with `[DIAG ORCH-0728-PASS-5]` | ✅ Confirmed |
| Existing UX preserved + PASS-3 markers preserved | ✅ Confirmed |
| tsc=0 | ✅ Confirmed |

---

## 6. Cache safety

No query keys changed. No mutation logic altered. No persisted state shape changed. Read-only `getSession()` call. **No cache impact.**

---

## 7. Regression surface

Diagnostic-only — no functional change. One thing to watch:
- The probe call awaits `supabase.auth.getSession()` BEFORE the mutation. This adds ~5-50ms latency to the create-brand flow. Negligible.

---

## 8. Constitutional compliance

| Rule | Status |
|---|---|
| #3 No silent failures | improved (probe surfaces session state to terminal) |
| Other 13 | unchanged |

---

## 9. Discoveries for orchestrator

| ID | Description |
|---|---|
| **D-IMPL-PASS5-1** | BrandSwitcherSheet had no direct supabase import previously — flow had been entirely abstracted through `useCreateBrand` hook. Adding direct import for diagnostic is acceptable; the full IMPL session-refresh logic per SPEC §3.4-A will need to keep the import (it also uses `supabase.auth.getSession()` + `supabase.auth.refreshSession()`). |

---

## 10. Transition items

Both sites are TRANSITIONAL by design:
- Markers: `// [DIAG ORCH-0728-PASS-5]`
- Exit condition: full IMPL of `SPEC_ORCH_0728_FULL_FIX.md` lands → grep finds these markers → replaces probe with proper proactive session-refresh per Amendment §3.4-A → import preserved (still needed for the production refresh flow)

If full IMPL is delayed, the probe is harmless additive overhead.

---

## 11. Operator post-step

1. **Force-reload Metro bundle:** shake device (or Cmd+D in simulator) → tap **Reload**
2. **Wait for the "Loading bundle …" banner** with percentage indicator (visual proof of fresh fetch)
3. **Tap Create brand**
4. **Capture FULL Metro terminal output** — should now contain THREE diagnostic blocks:
   - `[ORCH-0728-DIAG] PRE-MUTATE session probe { ... }` ← NEW (the answer)
   - `[ORCH-0728-DIAG] useCreateBrand#onError FAILED { ... }` ← from PASS-3
   - `[ORCH-0728-DIAG] BrandSwitcherSheet#handleSubmit FAILED { ... }` ← from PASS-3
5. **Paste FULL output into chat** — orchestrator routes to forensics PASS-6 immediately

The session-probe block tells PASS-6 instantly:

| Probe shape | Diagnosis |
|---|---|
| `sessionPresent: false` | H22 — Supabase client has no session despite fresh sign-in |
| `sessionPresent: true, matches: false` | H23 — JWT is for a different user |
| `sessionPresent: true, matches: true, tokenStart: "eyJ..."` | H24 — JWT exists but isn't attached to the request |
| `hasError: true` | Deeper supabase config issue |

---

**Authored:** 2026-05-06
**Authored by:** mingla-implementor (PASS-5 micro-diagnostic)
**Status:** implemented and verified (tsc=0, 2 markers confirmed, ADDITIVE-only)
**Awaiting:** operator force-reload + retest + paste full terminal output → orchestrator → forensics PASS-6 → root cause finalized
