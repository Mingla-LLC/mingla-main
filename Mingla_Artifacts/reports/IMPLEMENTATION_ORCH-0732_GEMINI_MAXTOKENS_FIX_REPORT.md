# IMPLEMENTATION REPORT — ORCH-0732 Gemini maxOutputTokens Fix + Throttle Patch Bundle

**Status:** implemented and partially verified — Vite build PASS · grep gates PASS · operator runtime verification PENDING (Gemini sweep should now succeed 32/32 with ~$0.16 cost, ~2-3 min wall).
**Dispatch:** [`Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0732_GEMINI_MAXTOKENS_FIX.md`](../prompts/IMPLEMENTOR_ORCH-0732_GEMINI_MAXTOKENS_FIX.md)
**Builds on:** Gemini A/B comparison commit `d6cf230a` (introduced bug); throttle patch already in working tree from prior dispatch (uncommitted).
**Live evidence of bug:** Run `064c6133-a842-49e1-8efc-f209722283f5` — 5 attempted, 5 failed with identical `finishReason=MALFORMED_FUNCTION_CALL`.

---

## 1. Layman summary

The Gemini A/B test failed because the output token cap (2000) was too small for our 16-evaluation Q2 tool — Gemini ran out of tokens mid-response on every call, producing a malformed function call our code correctly rejected. Bumped cap to 8000 (Gemini 2.5 Flash supports 64K). Bundled the prior session's uncommitted throttle patch into the same commit. Single fix; no schema or prompt changes.

---

## 2. Files Changed (Old → New Receipts)

### `supabase/functions/run-place-intelligence-trial/index.ts` (MODIFIED, +6 / −1 LOC net)

**Change 1 — Bump Gemini `maxOutputTokens` 2000 → 8000 in `callGeminiQuestion` (~line 929)**
- **Before:** `maxOutputTokens: 2000` — copied conservatively from earlier prototype; insufficient for 16 evaluations × ~150 tokens reasoning each.
- **After:** `maxOutputTokens: 8000` with multi-line audit comment explaining root cause + headroom rationale + Gemini Flash 2.5's 64K hard ceiling.
- **Why:** Operator-reported runtime failure (run `064c6133`, 5/5 places `MALFORMED_FUNCTION_CALL`). Diagnosed as token truncation: 16 evaluations × ~150 tokens ≈ 2,400 needed > 2,000 cap.
- **Lines changed:** +7 / −1 (audit-trail comment per Const #7)

### `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx` (NO NEW CHANGES THIS SESSION; bundled from prior dispatch)

The provider-aware throttle patch (`PER_PLACE_BROWSER_THROTTLE_MS_BY_PROVIDER` map at line 201; consumer at line 394) was already implemented in the working tree from the prior dispatch (`IMPLEMENTOR_ORCH-0713_GEMINI_THROTTLE_PATCH.md`). Verified intact via grep — no edits needed; bundles into this commit.

| Verification | Method | Result |
|---|---|---|
| Map definition present | grep `PER_PLACE_BROWSER_THROTTLE_MS_BY_PROVIDER` | PASS — 2 hits (def + consumer) |
| Consumer reads `[provider]` | grep at loop site | PASS |
| Default fallback `?? 9_000` | inline check | PASS |

---

## 3. Static Verification Matrix

| Gate | Method | Result |
|---|---|---|
| Old `maxOutputTokens: 2000` removed | grep — should show only 8000 | PASS — 1 hit at line 935 = 8000 |
| Audit-trail comment present | inline review | PASS — multi-line ORCH-0732 comment |
| Anthropic call path UNTOUCHED | grep `callQuestion(` (Anthropic helper) — unchanged | PASS |
| Q2_TOOL schema UNTOUCHED | inspect lines ~159-198 | PASS |
| System prompt UNTOUCHED | inspect lines ~801+ | PASS |
| Throttle map present | grep `PER_PLACE_BROWSER_THROTTLE_MS_BY_PROVIDER` | PASS |
| Vite build (admin) | `npx vite build` | PASS — 15.82s clean |
| No new imports | unchanged import block | PASS |

---

## 4. Spec Traceability

| Dispatch SC | Implementation | Status |
|---|---|---|
| §2 — Bump maxOutputTokens 2000 → 8000 | Line 935 | PASS |
| §3 — Verify throttle patch already in tree | Verified via grep | PASS |
| §4.2 — Vite build clean | 15.82s, no errors | PASS |
| §4.3 — grep edge fn shows 8000 not 2000 | Line 935 | PASS |
| §4.4 — Operator deploys edge fn | UNVERIFIED until operator runs `supabase functions deploy` | UNVERIFIED |
| §4.5 — Operator cancels stuck run 064c6133 | UNVERIFIED until operator clicks Cancel or runs SQL | UNVERIFIED |
| §4.6 — Operator re-runs Gemini sweep, expects 32/32 success | UNVERIFIED until operator re-runs | UNVERIFIED |

---

## 5. Invariant Preservation

| Invariant | Status | Why |
|---|---|---|
| `I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING` | PRESERVED | Trial pipeline still research-only |
| `I-PHOTO-AESTHETIC-DATA-SOLE-OWNER` | PRESERVED | Trial fn does not write photo_aesthetic_data |
| `I-COLLAGE-SOLE-OWNER` | PRESERVED | No collage code touched |
| `I-FIELD-MASK-SINGLE-OWNER` | PRESERVED | admin-seed-places untouched |
| `I-REFRESH-NEVER-DEGRADES` | PRESERVED | admin-refresh-places untouched |
| `I-BOUNCER-DETERMINISTIC` | PRESERVED | bouncer untouched |

---

## 6. Cache Safety

- No query keys changed.
- No DB schema changes.
- No persisted state shape changes.
- Larger `maxOutputTokens` only affects the Anthropic-style request body sent to Gemini; response parsing is unchanged (still reads `function_call.args`).
- Cost: per-call output tokens unchanged in practice (Gemini will use what it needs; we just allowed more headroom). No double-charging risk.

---

## 7. Regression Surface

3-5 features most likely to break:

1. **Anthropic sweep** — should be IDENTICAL to prior (only Gemini code path's request body changed). Spot-check: re-run Anthropic sweep, verify ~$0.41 cost / ~12 min wall preserved.
2. **Gemini cost calc** — `computeCostUsdGemini` reads actual reported `usageMetadata.candidatesTokenCount` from response, NOT the cap. Larger cap doesn't inflate cost; Gemini bills only what's actually generated.
3. **Throttle patch** — already verified in working tree; provider-aware lookup intact. Anthropic flow still 9s; Gemini drops to 1s.
4. **Existing v1/v2/v3 historical Anthropic rows** — display unchanged; model badge still works.
5. **Failed Gemini run 064c6133** — orphaned 27 pending rows + 5 failed will pollute aggregate stats UNTIL operator cancels via UI Cancel button or SQL UPDATE per dispatch §6.

---

## 8. Constitutional Compliance

| Principle | Touched? | Status |
|---|---|---|
| #2 One owner per truth | No | preserved |
| #3 No silent failures | No | EXISTING throw-on-MALFORMED logic correctly surfaced the bug — no silent failure introduced |
| #7 Label temporary fixes | YES | Permanent fix; audit-trail comment explains root cause + headroom + ceiling |
| #8 Subtract before adding | YES | Old `2000` value removed; replacement is single constant change |
| #9 No fabricated data | No | Cost calc still uses Gemini's actual reported tokens |
| All other 11 | No | n/a |

---

## 9. Deploy step (operator dispatches manually)

```powershell
supabase functions deploy run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv
```

**Required:** Fix A is server-side; needs redeploy to take effect.

---

## 10. Verification matrix (post-deploy)

UNVERIFIED until operator runs:

| Check | Expected | Status |
|---|---|---|
| Edge fn deploy succeeds | "Deployed Functions on project..." output | UNVERIFIED |
| Cancel run 064c6133 (stuck pending rows) | UI Cancel button OR SQL UPDATE per dispatch §6 | UNVERIFIED |
| New Gemini sweep starts | New run_id created | UNVERIFIED |
| All 32 places SUCCEED | 32 completed, 0 failed | UNVERIFIED |
| Cost ~$0.16 | $0.13–$0.20 range | UNVERIFIED |
| Wall time ~2-3 min | Throttle patch + 1s per-place gives ~32×1s + ~32×3s API = ~2-3 min | UNVERIFIED |
| Spot-check Bayfront/flowers VETO | inappropriate_for=true, score=0 | UNVERIFIED |
| Spot-check Mala Pata/brunch | score 80-95 | UNVERIFIED |
| Spot-check Harris Teeter/flowers | score 50-65 | UNVERIFIED |
| Reasoning fields cite negative booleans | Visual on Central Michel Richard | UNVERIFIED |

---

## 11. Cleanup of failed run 064c6133

Operator-side action: cancel the stuck run before re-running. Two options:

**Option A — Admin UI:**
Open `#/place-intelligence-trial` → Trial Results tab → expand run `064c6133-a842-49e1-8efc-f209722283f5` → click Cancel (if button visible).

**Option B — SQL (operator runs manually if Cancel button unavailable):**
```sql
UPDATE public.place_intelligence_trial_runs
SET status = 'cancelled', completed_at = now()
WHERE run_id = '064c6133-a842-49e1-8efc-f209722283f5'
  AND status IN ('pending', 'running');
```

This marks the 27 pending rows as `cancelled` so they don't pollute aggregate cost / per-signal stats.

---

## 12. Discoveries for Orchestrator

**None.**

The bug fix was tightly scoped (1 LOC effective change) and the diagnosis was unambiguous from the live `MALFORMED_FUNCTION_CALL` evidence. No out-of-scope issues surfaced.

---

## 13. Status

**implemented, partially verified.** Code complete. Vite build clean. Static grep gates pass. Operator runtime verification (deploy + cancel stuck run + re-run Gemini sweep) is the remaining gate.

---

## 14. Test First (operator priority list)

1. Deploy edge fn: `supabase functions deploy run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv`
2. Cancel stuck run `064c6133` (UI Cancel button OR SQL block in §11)
3. Open `#/place-intelligence-trial` → Trial Results tab
4. Select "Gemini 2.5 Flash" radio
5. Click Run trial (32 places)
6. Verify wall time ~2-3 min (throttle patch active) + cost ~$0.16
7. Spot-check Bayfront/flowers (VETO 0) + Mala Pata/brunch (~85+) + Harris Teeter/flowers (~55) + National Gallery/creative_arts (~95+)

---

## 15. Layman summary (chat)

Bumped Gemini's output-token cap from 2000 to 8000. The 16-evaluation Q2 tool needs ~2400 tokens; the cap was truncating mid-response on every call, which Gemini reported as MALFORMED_FUNCTION_CALL. Bundled the prior session's uncommitted browser throttle patch (Anthropic 9s / Gemini 1s) into the same commit. Single edge fn line changed; vite build clean; needs `supabase functions deploy` + cancel of stuck run `064c6133` + re-run.
