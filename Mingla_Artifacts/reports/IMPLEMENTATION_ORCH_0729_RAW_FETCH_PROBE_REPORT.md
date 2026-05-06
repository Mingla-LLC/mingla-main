# IMPL REPORT — ORCH-0729 RAW-FETCH PROBE

**Mode:** IMPLEMENT (DIAGNOSTIC ONLY — temporary, removed at full IMPL of `SPEC_ORCH_0729_PIPELINE_FIX.md`)
**Dispatch anchor:** [`prompts/IMPL_ORCH_0729_RAW_FETCH_PROBE.md`](../prompts/IMPL_ORCH_0729_RAW_FETCH_PROBE.md)
**Authored:** 2026-05-06

---

## 1. Layman summary

Added 1 `Constants` import + 1 raw-fetch probe block (~57 lines) to BrandSwitcherSheet.tsx. The probe runs immediately after the existing PASS-5 session probe and immediately BEFORE `createBrandMutation.mutateAsync(...)`. Both fire on the same tap. The probe constructs a POST to `/rest/v1/brands` with explicit `Authorization: Bearer ${access_token}` + `apikey` headers, using a unique `__qa_<timestamp>` slug to avoid collision with the operator's chosen brand name. ADDITIVE only — every existing diagnostic and UX preserved. tsc=0.

**Status:** implemented and verified · **Verification:** passed (tsc=0; both `[DIAG ORCH-0729-RAW-FETCH]` markers present)

---

## 2. Sites patched

| # | File | Line(s) | Change |
|---|---|---|---|
| 1 | `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` | imports (after line 30) | Added `import Constants from "expo-constants";` with `[DIAG ORCH-0729-RAW-FETCH]` marker |
| 2 | `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` | inside try-block, after PASS-5 session probe block, before `createBrandMutation.mutateAsync({...})` | Added 57-line raw-fetch probe with `console.error("[ORCH-0729-DIAG] RAW FETCH RESULT", {...})` |

Both sites carry the `[DIAG ORCH-0729-RAW-FETCH]` marker so the full IMPL pass can grep + remove.

---

## 3. Old → New receipt

### `mingla-business/src/components/brand/BrandSwitcherSheet.tsx`

**What it did before:** PASS-5 added an in-line `await supabase.auth.getSession()` probe before `mutateAsync`. The session probe revealed: sessionPresent=true, matches=true, valid token. But mutateAsync still fails with 42501. PASS-7 forensics narrowed root cause to F-10c (header attachment failure in supabase-js v2.74.0) but couldn't prove it from static analysis alone.

**What it does now:** Immediately after the PASS-5 probe runs and logs session shape, the new raw-fetch probe constructs an explicit `POST /rest/v1/brands` request bypassing supabase-js entirely. Headers are: `apikey: <env anon key>`, `Authorization: Bearer <session.access_token>`, `Content-Type: application/json`, `Prefer: return=representation`. Body uses unique `__qa_<base36 timestamp>` slug + `__QA_Probe_<base36 timestamp>` name to avoid collision with operator's chosen brand. The probe's response status + body are logged via `console.error("[ORCH-0729-DIAG] RAW FETCH RESULT", { status, statusText, bodyStart, urlUsed, anonKeyStart })`. After the probe, control flows into the existing `mutateAsync` call (unchanged). Both data points are now captured on the same tap.

**Why:** PASS-7 §7 — forensics requires definitive disambiguation between F-10c PROVEN (supabase-js attachment bug) vs F-10c REJECTED (deeper auth issue → ORCH-0730 escalation). Raw-fetch with explicit headers is the canonical disambiguator: if supabase-js is dropping the Authorization header, raw-fetch will succeed where supabase-js fails. If both fail with same 42501, the JWT itself is being rejected.

**Lines changed:** ~59 (1 import + 57 probe + 1 marker comment)

---

## 4. Verification

### tsc

```
$ cd mingla-business && npx tsc --noEmit
[exit 0, no output]
EXIT=0
```

✅ PASS — Constants import resolves; fetch + Headers types match @types/react-native.

### Existing diagnostics + UX preserved (verified post-edit re-read)

- PASS-3 silent-return diagnostic at line 119 — UNCHANGED ✅
- PASS-3 catch diagnostic at line 134 — UNCHANGED ✅
- PASS-5 PRE-MUTATE session probe — UNCHANGED ✅
- `await createBrandMutation.mutateAsync({...})` call — UNCHANGED ✅
- `setCurrentBrand(newBrand)`, `onBrandCreated`, `onClose()` — UNCHANGED ✅
- Catch block branching (SlugCollisionError vs generic) — UNCHANGED ✅
- `setSubmitting(false)` in finally — UNCHANGED ✅

---

## 5. Spec traceability

This is a DIAGNOSTIC-ONLY micro-dispatch — no SC matrix from `SPEC_ORCH_0729_PIPELINE_FIX.md` applies. Dispatch's own success criterion:

| Criterion | Verification |
|---|---|
| 1 Constants import added (if absent) | ✅ Confirmed (was previously absent) |
| 1 raw-fetch probe block inserted after PASS-5 probe + before mutateAsync | ✅ Confirmed |
| Probe uses explicit `Authorization: Bearer <session.access_token>` + `apikey` headers | ✅ Confirmed |
| Probe uses unique `__qa_<suffix>` slug to avoid collision | ✅ Confirmed (Date.now().toString(36)) |
| Both sites marked with `[DIAG ORCH-0729-RAW-FETCH]` | ✅ Confirmed |
| Existing UX + prior diagnostic markers preserved | ✅ Confirmed |
| tsc=0 | ✅ Confirmed |

---

## 6. Cache safety

No query keys changed. No mutation logic altered. The raw-fetch is independent of React Query — it directly hits PostgREST without going through useCreateBrand's mutation pipeline. **No cache impact**.

Side effect: if raw-fetch returns 201 Created, a `__QA_Probe_<suffix>` brand row is inserted into production DB. Orchestrator will clean up via `DELETE FROM brands WHERE slug LIKE '__qa_%'` after PASS-8 confirms diagnosis. Operator does not need to take any cleanup action.

---

## 7. Regression surface

Diagnostic-only — no functional change. Considerations:
- The raw-fetch adds ~50-200ms latency to the create flow (one extra round-trip to PostgREST). Acceptable for diagnostic.
- If raw-fetch THROWS (network issue), the catch block at line 184-188 of the probe logs `[ORCH-0729-DIAG] RAW FETCH THREW` and execution continues into mutateAsync. Won't crash the create flow.
- If raw-fetch creates a `__QA_Probe_*` brand row, operator's brand list will show it next time they refresh. Cosmetic. Cleanup is one SQL command post-diagnosis.

---

## 8. Constitutional compliance

| Rule | Status |
|---|---|
| #3 No silent failures | improved (raw-fetch result + threw paths both surface to terminal) |
| Other 13 | unchanged |

---

## 9. Discoveries for orchestrator

| ID | Description |
|---|---|
| **D-IMPL-RAW-FETCH-1** | The probe makes a REAL INSERT request that, if successful, persists a `__QA_Probe_<suffix>` row to production `brands` table. Cleanup is trivial via SQL but should be documented in PASS-8 and executed by orchestrator (per dispatch §6 cleanup note). |
| **D-IMPL-RAW-FETCH-2** | If F-10c is PROVEN (raw-fetch returns 201), the operator will have a `__QA_Probe_*` brand visible in their brand list on next refresh. Mention this in PASS-8 readout so operator isn't confused. |

---

## 10. Transition items

Both sites are TRANSITIONAL by design:
- Markers: `// [DIAG ORCH-0729-RAW-FETCH]`
- Exit condition: full IMPL of `SPEC_ORCH_0729_PIPELINE_FIX.md` lands → grep finds these markers → removes the probe entirely. Constants import preserved if used by future I-PROPOSED-F build-time check (per spec §3.3).

---

## 11. Operator post-step (per dispatch §5)

1. **Force-reload Metro bundle:** shake device (or Cmd+D in simulator) → tap **Reload**
2. **Wait for the "Loading bundle …" banner** with percentage indicator
3. **Tap Create brand** (use any name — the operator's slug differs from the probe's `__qa_<suffix>` slug)
4. **Capture FULL Metro terminal output** — should now contain FOUR diagnostic blocks:
   - `[ORCH-0728-DIAG] PRE-MUTATE session probe { ... }` ← from PASS-5
   - **`[ORCH-0729-DIAG] RAW FETCH RESULT { ... }`** ← NEW (the answer)
   - `[ORCH-0728-DIAG] useCreateBrand#onError FAILED { ... }` ← from PASS-3
   - `[ORCH-0728-DIAG] BrandSwitcherSheet#handleSubmit FAILED { ... }` ← from PASS-3
5. **Paste FULL output into chat** — orchestrator routes to forensics PASS-8 immediately

The raw-fetch RESULT block tells PASS-8 instantly:

| Result shape | Diagnosis |
|---|---|
| `status: 201` | **F-10c PROVEN** — supabase-js header attach bug. Fix: SPEC §3.2 P-1 path (upgrade supabase-js + global fetch interceptor). |
| `status: 401` | The Authorization header itself is being rejected by Supabase Auth gate. JWT signature mismatch. Escalate to ORCH-0730. |
| `status: 403` with `code: 42501` in body | F-10c REJECTED — JWT reaches PostgREST but `auth.uid()` evaluates wrong. Deep Supabase Auth issue. Escalate to ORCH-0730. |
| `status: 400` with `code: PGRST204` | Schema cache stale (revisit F-1) — unlikely but possible |
| `RAW FETCH SKIPPED — no session.access_token` | Session was lost between getSession() and probe — supabase-js state machine issue |
| `RAW FETCH THREW` | Network or CORS issue — different bug class |

---

**Authored:** 2026-05-06
**Authored by:** mingla-implementor (PASS-7 raw-fetch probe sub-step)
**Status:** implemented and verified (tsc=0, 2 markers confirmed, ADDITIVE-only)
**Awaiting:** operator force-reload + retest + paste full terminal output → orchestrator → forensics PASS-8 → root cause finalized
