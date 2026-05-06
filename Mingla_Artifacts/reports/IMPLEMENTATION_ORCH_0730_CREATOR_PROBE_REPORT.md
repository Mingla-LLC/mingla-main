# IMPL REPORT — ORCH-0730 CREATOR-ACCOUNTS PROBE

**Mode:** IMPLEMENT (DIAGNOSTIC ONLY — temporary)
**Dispatch anchor:** [`prompts/IMPL_ORCH_0730_CREATOR_ACCOUNTS_PROBE.md`](../prompts/IMPL_ORCH_0730_CREATOR_ACCOUNTS_PROBE.md)
**Predecessor:** ORCH-0729 raw-fetch probe REJECTED F-10c (raw fetch with explicit Authorization also returned 403+42501)
**Authored:** 2026-05-06

---

## 1. Layman summary

Added a 1-block, ~46-line probe to BrandSwitcherSheet.tsx that runs immediately after the PASS-7 raw-fetch probe and before `mutateAsync`. The probe issues a `GET /rest/v1/creator_accounts?id=eq.<user.id>&select=id,email` with the SAME `Authorization: Bearer ${access_token}` + `apikey` headers. Operator's next tap will tell us whether the JWT authenticates for any RLS-gated read at all (1 row returned = JWT works, brands-INSERT-specific bug; 0 rows / 401 = JWT silently degraded to anon, project-config issue → ORCH-0730 Supabase escalation). ADDITIVE only — every prior diagnostic + UX preserved. tsc=0.

**Status:** implemented and verified · **Verification:** passed (tsc=0; `[DIAG ORCH-0730-CREATOR-PROBE]` markers present)

---

## 2. Sites patched

| # | File | Line(s) | Change |
|---|---|---|---|
| 1 | `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` | inside try-block, after PASS-7 raw-fetch catch (line ~201), before `createBrandMutation.mutateAsync({...})` | Added 46-line creator-accounts SELECT probe with `console.error("[ORCH-0730-DIAG] CREATOR-ACCOUNTS PROBE", {...})` |

No new imports required — `Constants` was already imported during PASS-7.

---

## 3. Old → New receipt

### `mingla-business/src/components/brand/BrandSwitcherSheet.tsx`

**What it did before:** PASS-7 raw-fetch probe sent a POST INSERT to `/rest/v1/brands` with explicit Authorization, returning 403+42501 — proving F-10c rejected (the JWT reaches PostgREST but auth.uid() doesn't resolve to user.id at INSERT time). The bug is now suspected at JWT validation level (H25 silent JWT validation failure → anon fallback) OR project-config level (H32 JWT secret/audience drift).

**What it does now:** Immediately after the PASS-7 probe block ends (after its catch), a new probe runs: `GET /rest/v1/creator_accounts?id=eq.<user.id>&select=id,email` with identical Authorization + apikey headers. Logs status, statusText, bodyStart (first 300 chars), parsed rowCount (or "non-array" / "parse-error"), and urlUsed. Operates on `creator_accounts` table — only TWO RLS read paths exist: (1) "Creators can read own account" requires `auth.uid() = id` (depends on JWT auth working); (2) "Public can read organiser profiles for share pages" requires `EXISTS (brands with public events)` — operator has 0 brands so this is FALSE. Therefore the probe is a binary disambiguator for JWT validation.

**Why:** PASS-8 evidence (PASS-7 raw-fetch returned 403+42501) eliminates F-10c (supabase-js header bug). The remaining hypotheses are H25 (JWT silently downgrades to anon) and H32 (project-level config issue). The creator_accounts probe disambiguates: rowCount=1 → JWT WORKS for reads → bug is brands-INSERT-specific; rowCount=0 → JWT silently degrades → H25/H32 confirmed → escalate to deeper Supabase audit.

**Lines changed:** ~46 (1 block insertion)

---

## 4. Verification

### tsc

```
$ cd mingla-business && npx tsc --noEmit
[exit 0, no output]
EXIT=0
```

✅ PASS

### Existing diagnostics + UX preserved (post-edit re-read)

- PASS-3 silent-return diagnostic — UNCHANGED ✅
- PASS-3 catch diagnostic — UNCHANGED ✅
- PASS-5 PRE-MUTATE session probe — UNCHANGED ✅
- PASS-7 RAW FETCH RESULT probe — UNCHANGED ✅
- `await createBrandMutation.mutateAsync({...})` — UNCHANGED ✅
- All setState / setSlugError / setSubmitting / Toast UX — UNCHANGED ✅

---

## 5. Spec traceability

Diagnostic-only micro-dispatch — own success criteria:

| Criterion | Verification |
|---|---|
| 1 GET probe block inserted after PASS-7 catch + before mutateAsync | ✅ Confirmed |
| Probe uses same `Authorization: Bearer ${access_token}` + `apikey` headers as PASS-7 raw-fetch | ✅ Confirmed |
| Probe targets `/rest/v1/creator_accounts?id=eq.<user.id>&select=id,email` | ✅ Confirmed |
| Logs status, statusText, bodyStart, rowCount (parsed), urlUsed | ✅ Confirmed |
| Marker `[DIAG ORCH-0730-CREATOR-PROBE]` + `[ORCH-0730-DIAG]` in console.error | ✅ Confirmed |
| Existing UX + 4 prior diagnostic markers preserved | ✅ Confirmed |
| tsc=0 | ✅ Confirmed |

---

## 6. Cache safety

GET request only — read-only. **No cache impact**.
No DB mutations. No `__QA_Probe_*` rows created. No cleanup needed regardless of probe outcome.

---

## 7. Regression surface

Diagnostic-only — no functional change. The probe adds ~50-200ms latency per Create-tap (one extra GET). Acceptable for diagnostic.

---

## 8. Constitutional compliance

| Rule | Status |
|---|---|
| #3 No silent failures | improved (probe surfaces creator_accounts read result + threw paths) |
| Other 13 | unchanged |

---

## 9. Discoveries for orchestrator

| ID | Description |
|---|---|
| **D-IMPL-CREATOR-PROBE-1** | Probe is GET-only; safer than PASS-7 INSERT probe (no test rows created in production DB regardless of outcome). |
| **D-IMPL-CREATOR-PROBE-2** | If JWT IS valid (rowCount=1) but brands-INSERT still 42501s, this points to a brands-table-specific issue we haven't yet considered. Possible causes to add to next forensics pass: (a) recent RLS policy edit not seen in the squash migration we read, (b) trigger we missed, (c) Postgres role grants different from anon for the specific INSERT path. |

---

## 10. Transition items

This site is TRANSITIONAL by design:
- Marker: `// [DIAG ORCH-0730-CREATOR-PROBE]`
- Exit condition: full IMPL of SPEC_ORCH_0730 (or follow-up cycle if the F-10c branch closes early) → grep finds the marker → block removed.

---

## 11. Operator post-step

1. **Force-reload Metro bundle:** shake device (or Cmd+D in simulator) → tap **Reload**
2. **Wait for the "Loading bundle …" banner**
3. **Tap Create brand**
4. **Capture FULL Metro terminal output** — should now contain FIVE diagnostic blocks:
   - `[ORCH-0728-DIAG] PRE-MUTATE session probe { ... }`
   - `[ORCH-0729-DIAG] RAW FETCH RESULT { ... }`
   - **`[ORCH-0730-DIAG] CREATOR-ACCOUNTS PROBE { ... }`** ← NEW (the answer)
   - `[ORCH-0728-DIAG] useCreateBrand#onError FAILED { ... }`
   - `[ORCH-0728-DIAG] BrandSwitcherSheet#handleSubmit FAILED { ... }`
5. **Paste FULL output into chat**

The CREATOR-ACCOUNTS PROBE block tells PASS-9 instantly:

| Result | Diagnosis |
|---|---|
| `status: 200, rowCount: 1` | JWT IS valid in PostgREST. Mystery deepens — bug is brands-INSERT-specific. Next: deep-dive brands RLS + triggers + grants. |
| `status: 200, rowCount: 0` | **H25 PROVEN** — JWT silently degrades to anon at PostgREST. Project-level config issue. Escalate to ORCH-0730 + likely Supabase support. |
| `status: 401` | **H32 PROVEN** — JWT explicitly rejected. Same escalation path. |
| `status: 200, rowCount: "non-array"` or `"parse-error"` | PostgREST returned non-standard response — investigate further. |
| `THREW` | Network/CORS issue — different bug class. |

---

**Authored:** 2026-05-06
**Authored by:** mingla-implementor (PASS-8 creator-accounts disambiguation probe)
**Status:** implemented and verified (tsc=0, 1 marker confirmed, ADDITIVE-only, GET-only — no DB side-effects)
**Awaiting:** operator force-reload + retest + paste full terminal output → orchestrator → forensics PASS-9 → root cause finalized
