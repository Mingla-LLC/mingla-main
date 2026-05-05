# IMPLEMENTATION REPORT — ORCH-0713 Gemini A/B Comparison

**Status:** implemented and partially verified — Vite build PASS · grep gates PASS · Deno typecheck deferred (verifies on `supabase functions deploy`) · operator runtime verification PENDING (run 32-anchor sweep with Gemini provider; expect ~$0.16 vs Anthropic v3 $0.41)
**ORCH IDs in scope:** ORCH-0713 Gemini A/B test
**Dispatch:** [Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0713_GEMINI_COMPARISON.md](../prompts/IMPLEMENTOR_ORCH-0713_GEMINI_COMPARISON.md)
**Builds on:** v3 cost reduction (commit `01ffad54`) — Q2-only, 768px collage, gap-filled inputs

---

## 1. Layman summary

Added Gemini 2.5 Flash as a SECOND model option alongside the existing Anthropic Claude Haiku 4.5 path in the trial pipeline. Operator picks provider via radio buttons in the Run Trial dialog; default stays Anthropic. Same prompt, same anchors, same output schema → direct A/B comparison. Pure additive change — Anthropic path completely UNTOUCHED structurally. Estimated cost on 32 anchors: Gemini ~$0.16 vs Anthropic $0.41 (-68% if quality matches).

---

## 2. Files Changed (Old → New Receipts)

### `supabase/functions/_shared/photoAestheticEnums.ts` (MODIFIED, +21 LOC)

**Change 1 — Add Gemini pricing constants + cost helper**
- **Before:** `PRICING` exported Haiku-only constants; `computeCostUsd` Haiku-only.
- **After:** `PRICING` extended with `GEMINI_2_5_FLASH_INPUT_PER_TOKEN: 0.30/MTok` + `GEMINI_2_5_FLASH_OUTPUT_PER_TOKEN: 2.50/MTok` (per https://ai.google.dev/pricing — verify live before locking). NEW exported `computeCostUsdGemini({ promptTokens, candidatesTokens })` function — mirrors `computeCostUsd` shape; returns USD; uses `usageMetadata.promptTokenCount` + `usageMetadata.candidatesTokenCount` from Gemini's response.
- **Why:** Cost computation must distinguish providers; Gemini's usage shape differs from Anthropic's (no separate cache split exposed at this tier).
- **Lines changed:** +21 / 0

### `supabase/functions/run-place-intelligence-trial/index.ts` (MODIFIED, +194 LOC, additive only)

**Change 2 — Import Gemini cost helper + add Gemini constants + Provider type (~lines 14-43)**
- **After:** Import `computeCostUsdGemini` from shared. Add `GEMINI_MODEL_ID = "gemini-2.5-flash"`, `GEMINI_MODEL_NAME_SHORT`, `GEMINI_API_URL` (v1beta generativelanguage), `type Provider = "anthropic" | "gemini"`.
- **Why:** Provider switch needs a discriminator type.
- **Lines added:** +6

**Change 3 — `callGeminiWithRetry` helper (~lines 130-176)**
- **After:** Mirrors `callAnthropicWithRetry` — POST to `${GEMINI_API_URL}?key=${encodeURIComponent(apiKey)}` (Gemini's query-param auth; also supports x-goog-api-key header), 4 attempts max, exponential backoff on 429/5xx, retry-after header respected. Returns `{ payload, usage: { promptTokenCount, candidatesTokenCount } }`.
- **Why:** Symmetric helper; same retry semantics.
- **Lines added:** +47

**Change 4 — `fetchAsBase64` helper (~lines 178-194)**
- **After:** Fetches a URL → arrayBuffer → base64 string + content-type (chunked encoding to avoid stack overflow on large arrays).
- **Why:** Gemini's `inline_data` parts require base64 bytes — does NOT fetch URLs. Anthropic's `image` content block accepts URL directly. The collage is a public Supabase Storage URL, so we fetch + encode locally.
- **Lines added:** +17

**Change 5 — `callGeminiQuestion` helper (~lines 836-893)**
- **After:** Parallel to `callQuestion` (Anthropic). Fetches collage → base64. Builds Gemini request body: `contents[0].parts[]` with `inline_data` for image + `text` for user block; `systemInstruction.parts[0].text` for system prompt; `tools[0].function_declarations[0]` translates Anthropic's `Q2_TOOL { name, description, input_schema }` → Gemini's `{ name, description, parameters }` (JSON Schema verbatim — Gemini accepts standard schema); `toolConfig.functionCallingConfig` with `mode: "ANY"` and `allowedFunctionNames: [tool.name]` to force the call. Parses `candidates[0].content.parts[i].functionCall.args` → `aggregate`. Cost via `computeCostUsdGemini`.
- **Why:** The mechanical translation between Anthropic tool_use and Gemini function_call. Same input → same output `aggregate` shape.
- **Lines added:** +58

**Change 6 — `processOnePlace` accepts `provider` + `geminiKey` (~lines 692-700, 758-779)**
- **Before:** Single Anthropic call path.
- **After:** Function signature accepts `geminiKey: string` and `provider: Provider`. Branch in the Q2 call site: `provider === "gemini"` → `callGeminiQuestion(...)`, else `callQuestion(...)`. Persisted `model` field in DB row picks `GEMINI_MODEL_NAME_SHORT` or `MODEL_NAME_SHORT` based on provider.
- **Why:** Per-place worker is the single switch point — keeps the action handlers thin.
- **Lines added:** +14

**Change 7 — Bootstrap `geminiKey` env (~lines 257-263)**
- **After:** `const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";` — read but DON'T validate at bootstrap; only validate when `provider="gemini"` is requested (lets Anthropic-only deployments not require Gemini key).
- **Why:** Backward-compat — existing operators don't need Gemini key set unless they opt in.
- **Lines added:** +3

**Change 8 — `handleStartRun` accepts `provider` body param (~lines 585-650)**
- **Before:** Estimated cost = `anchors.length * 0.045` (legacy Q1+Q2 estimate).
- **After:** Reads `body.provider` (default "anthropic"); validates string enum ('anthropic' | 'gemini') — returns 400 on invalid. Per-place cost estimate now provider-specific (Anthropic $0.013, Gemini $0.005). Tags pending rows with the correct `model` constant. Returns `provider` + `model` in response body so admin UI can confirm what got started.
- **Why:** Cost estimate accuracy + DB row tagging at insert time.
- **Lines added:** +18

**Change 9 — `handleRunTrialForPlace` accepts `provider` + `geminiKey` (~lines 660-700)**
- **Before:** `(db, body, anthropicKey)`.
- **After:** `(db, body, anthropicKey, geminiKey)`. Reads `body.provider` (default "anthropic"); validates enum (400 on invalid). Validates `geminiKey` present when provider="gemini" (500 with operator-actionable message: "supabase secrets set GEMINI_API_KEY=..."). Passes both keys + provider to `processOnePlace`.
- **Why:** Per-place worker route entrypoint enforces auth gates.
- **Lines added:** +14

**Change 10 — Top-level switch wires `geminiKey` (~line 304)**
- **After:** `case "run_trial_for_place": return await handleRunTrialForPlace(supabaseAdmin, body, anthropicKey, geminiKey);`
- **Lines added:** +1

### `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx` (MODIFIED, +73 LOC additive)

**Change 11 — Provider state + cost map + label map (~lines 180-200)**
- **After:** New module-level constants: `PER_PLACE_COST_BY_PROVIDER = { anthropic: 0.013, gemini: 0.005 }` and `PROVIDER_LABEL = { anthropic: "Anthropic Claude Haiku 4.5", gemini: "Gemini 2.5 Flash" }`. New component state `const [provider, setProvider] = useState("anthropic")`.
- **Why:** Provider drives cost estimate, dialog label, body params.
- **Lines added:** +13

**Change 12 — `handleRunTrial` confirm dialog + body params (~lines 320-340)**
- **Before:** Hardcoded `0.045` cost factor + no provider in body.
- **After:** Cost dynamic per provider; dialog message names provider ("using Anthropic Claude Haiku 4.5"); `start_run` and `run_trial_for_place` bodies include `provider: provider` field.
- **Why:** Operator sees provider-specific cost estimate before confirming; backend gets the provider switch.
- **Lines added:** +5 (mostly inline edits)

**Change 13 — Provider radio toggle UI in Run Controls (~lines 430-490)**
- **After:** New row below the Prepare/Run buttons: "Provider" label + 2 radio inputs ("Claude Haiku 4.5" default | "Gemini 2.5 Flash") with per-provider cost estimate displayed inline (`est $X.XX`). Radio disabled while running. Italic helper: "Same prompt + same anchors. Results stored separately for comparison."
- **Why:** Operator-visible toggle. Prevents accidental wrong-provider invocation. Always shows current cost projection.
- **Lines added:** +44

**Change 14 — Model badge per row (`PlaceResultCard` ~lines 60-76)**
- **After:** New badge next to the status pill: "Haiku" (info-50 background) or "Gemini" (warning-50 background) based on `row.model.startsWith("gemini")`. Tooltip shows full model + version. Renders only when `row.model` present (graceful for legacy rows).
- **Why:** Operator scans run history and immediately sees which provider produced each row.
- **Lines added:** +14

---

## 3. Static Verification Matrix

| Gate | Method | Result |
|---|---|---|
| Anthropic path UNTOUCHED structurally | Verified `callAnthropicWithRetry`, `callQuestion`, `Q2_TOOL`, `buildSystemPrompt`, `buildUserTextBlock` unchanged | PASS |
| Gemini constants present | grep `GEMINI_MODEL_ID\|GEMINI_API_URL\|Provider` in trial fn | PASS — 9 hits |
| Gemini call helper present | grep `callGeminiWithRetry\|callGeminiQuestion` | PASS — defined once each |
| Provider branch in `processOnePlace` | grep `provider === "gemini"` | PASS — branch wired |
| Gemini cost helper exported from shared | grep `computeCostUsdGemini` | PASS — exported + imported |
| Provider auth gate | `!geminiKey` check on Gemini path | PASS — returns 500 with operator-actionable message |
| Default provider = anthropic | `body.provider \|\| "anthropic"` in both handlers | PASS |
| Provider validation | enum check rejects unknowns with 400 | PASS — both `start_run` and `run_trial_for_place` |
| Vite build | `npx vite build` | PASS — 22.21s, no new errors |
| Admin radio UI | Inspect `<input type="radio" name="trial-provider">` | PASS |
| Body param wiring | Inspect `body: { action: "start_run", provider }` and `run_trial_for_place` | PASS |
| Model badge | grep `row.model.startsWith("gemini")` in TrialResultsTab.jsx | PASS |

---

## 4. Spec Traceability

| Dispatch SC | Implementation | Status |
|---|---|---|
| §2.A — Gemini constants + env var read | Lines 38-43, 257-263 | PASS |
| §2.A — `callGeminiWithRetry` helper | Lines 136-176 | PASS |
| §2.A — `callGeminiQuestion` helper | Lines 836-893 | PASS |
| §2.A — Tool schema translation (Anthropic input_schema → Gemini function_declarations parameters) | Lines 858-863 | PASS |
| §2.A — Response parsing (Gemini function_call → aggregate) | Lines 880-887 | PASS |
| §2.A — Provider branch in processOnePlace | Lines 758-779 | PASS |
| §2.A — Persist provider-specific model name | Lines 786-787 | PASS |
| §2.A — `start_run` provider param + cost guard adjustment | Lines 590-616 | PASS |
| §2.B — Provider toggle UI in TrialResultsTab | Lines 451-490 | PASS |
| §2.B — Cost estimate per provider | PER_PLACE_COST_BY_PROVIDER map | PASS |
| §2.B — Body params include provider | Both invokeWithRefresh calls | PASS |
| §2.C — Model badge on run banner | PlaceResultCard | PASS |
| §2.D — Cost helper extension (`computeCostUsdGemini`) | Lines 209-218 of photoAestheticEnums.ts | PASS |
| §2 — Inline_data base64 encoding | `fetchAsBase64` helper + invocation | PASS |

---

## 5. Invariant Preservation

| Invariant | Status | Why |
|---|---|---|
| `I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING` | PRESERVED | Trial pipeline still research-only; provider switch doesn't change consumer set |
| `I-PHOTO-AESTHETIC-DATA-SOLE-OWNER` | PRESERVED | Trial fn does not write photo_aesthetic_data |
| `I-COLLAGE-SOLE-OWNER` | PRESERVED | Collage write paths unchanged; we only READ collage URL for Gemini base64 encoding |
| `I-FIELD-MASK-SINGLE-OWNER` | PRESERVED | admin-seed-places untouched |
| `I-REFRESH-NEVER-DEGRADES` | PRESERVED | admin-refresh-places untouched |
| `I-BOUNCER-DETERMINISTIC` | PRESERVED | bouncer untouched |

---

## 6. Cache Safety

- No query keys changed (admin uses direct supabase calls).
- `model` field in `place_intelligence_trial_runs` already exists; we now write distinct values per provider — backward compat preserved (legacy rows have `model: "claude-haiku-4-5"` from prior runs).
- Default provider = "anthropic" — existing operator workflows unchanged unless they opt into Gemini.
- TrialResultsTab `select("*, place:...)` already pulls all fields including `model` and `model_version` — no query change needed.

---

## 7. Regression Surface

The 3-5 adjacent features most likely to break, for tester/operator awareness:

1. **Existing Anthropic runs** — should be IDENTICAL to v3 baseline (Anthropic code path completely untouched). Spot-check: re-run a small Anthropic sweep, verify costs match prior $0.41 sweep.
2. **Run Trial dialog** — confirm message now mentions provider name. Pre-this-change: `"$X cost, ~Y minute wall time. Continue?"`; post: `"using Anthropic Claude Haiku 4.5. Estimated cost ~$X..."`. No functional regression.
3. **Run banner** — adds the model badge column. Old runs (before `model` was populated) won't show the badge — graceful.
4. **API auth — Anthropic** — still required for all operations (the server bootstraps both keys; only Gemini is conditionally validated).
5. **Tool schema acceptance** — Gemini's `function_declarations` schema accepts JSON Schema verbatim. If Gemini rejects our `Q2_TOOL.input_schema`, the call returns 400 with a parse error and is retried/logged via `callGeminiWithRetry`'s standard retry path.

---

## 8. Constitutional Compliance

| Principle | Touched? | Status |
|---|---|---|
| #2 One owner per truth | No | preserved |
| #3 No silent failures | YES | Gemini retry mismatch and missing-key cases return structured errors with operator-actionable messages |
| #7 Label temporary fixes | YES | Provider switch is permanent (not transitional); audit-trail comments codify the architecture |
| #8 Subtract before adding | N/A | Pure additive; Anthropic path retained as default |
| #9 No fabricated data | YES | Cost calculator uses Gemini's reported `usageMetadata` directly; no fabrication |
| All other 11 | No | n/a |

---

## 9. Deploy step (operator dispatches manually)

```powershell
supabase functions deploy run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv
```

Operator already set `GEMINI_API_KEY` per orchestrator confirm earlier in this session. No re-set needed.

---

## 10. Verification matrix (post-deploy)

UNVERIFIED until operator runs Gemini sweep:

| Check | Expected | Status |
|---|---|---|
| Open #/place-intelligence-trial → Trial Results | Provider radio visible | UNVERIFIED |
| Select "Gemini 2.5 Flash" radio | Cost estimate shows ~$0.16 (was $0.41 for Anthropic) | UNVERIFIED |
| Click Run Trial → confirm dialog | Mentions "using Gemini 2.5 Flash" | UNVERIFIED |
| Run completes 32/32 | All places succeed | UNVERIFIED |
| Total cost ~$0.16 | $0.13–$0.20 range | UNVERIFIED |
| Wall time | Similar to Anthropic v3 (~12 min) | UNVERIFIED |
| New rows have `model="gemini-2.5-flash"` | DB inspection | UNVERIFIED |
| Run banner shows orange "Gemini" badge | Visual | UNVERIFIED |
| Spot-check Bayfront/flowers VETO | inappropriate_for=true, score=0 | UNVERIFIED |
| Spot-check Mala Pata/brunch | score 80-95 (within ±10 of Anthropic 88) | UNVERIFIED |
| Spot-check National Gallery/creative_arts | score 90-100 (within ±5 of Anthropic 98) | UNVERIFIED |
| Spot-check Harris Teeter/flowers | score 50-65 (within ±10 of Anthropic 55) | UNVERIFIED |
| Spot-check Calusso/fine_dining | score 75-95 (Anthropic was 82) | UNVERIFIED |
| Reasoning fields cite negative booleans (e.g., `serves_breakfast=false`) | Manual visual on Central Michel Richard | UNVERIFIED |

---

## 11. Cost Projection

| Sweep type | Anthropic v3 | Gemini 2.5 Flash | Saving |
|---|---|---|---|
| 32-anchor | $0.41 (proven) | ~$0.16 (projected) | -61% |
| Triangle full backfill (3,234 servable) | ~$41 | ~$16 | -61% |

If quality matches → Gemini becomes a viable production-rerank alternative (further -61% on top of v3 cost reduction).

---

## 12. Discoveries for Orchestrator

**None.**

The dispatch was tightly scoped (additive Gemini path + admin UI toggle + model badge). No out-of-scope issues surfaced. The mechanical translation between Anthropic and Gemini APIs is well-documented; no provider-specific quirks blocked the implementation.

---

## 13. Status

**implemented, partially verified.** Code complete. Vite build clean. Static grep gates pass. Operator runtime verification (Gemini sweep + spot-checks) is the remaining gate.

---

## 14. Test First (operator priority list)

1. Deploy edge function: `supabase functions deploy run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv`
2. Open `#/place-intelligence-trial` → Trial Results tab
3. In Run controls, select "Gemini 2.5 Flash" radio (cost should display ~$0.16)
4. Click "2. Run trial (32 places)"
5. Confirm dialog — should say "using Gemini 2.5 Flash. Estimated cost ~$0.16..."
6. Wait ~10-15 min for 32 anchors
7. Verify new run banner shows orange "Gemini" badge per row
8. Spot-check 5 places per §10 (Bayfront/flowers VETO; Harris Teeter/flowers ~55; National Gallery/creative_arts ~95+; Mala Pata/brunch ~85+; Calusso/fine_dining ~80+)
9. Return run_id + total cost + 5 sample evaluations to orchestrator

---

## 15. Layman summary (chat)

Added Gemini 2.5 Flash as a second model option in the trial pipeline. Operator picks Anthropic (default) or Gemini via radio in the Run Trial dialog; same prompt, same anchors, results stored separately so we can compare directly. Anthropic code path completely untouched — pure additive change. Cost projection: Gemini sweep ~$0.16 vs Anthropic $0.41 (-61%) if quality matches. New "Gemini" / "Haiku" badge on each row distinguishes runs at a glance. Operator deploys edge fn and runs Gemini sweep next.
