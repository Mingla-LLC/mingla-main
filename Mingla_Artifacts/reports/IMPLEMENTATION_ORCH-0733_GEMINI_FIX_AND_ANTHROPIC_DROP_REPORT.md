# IMPLEMENTATION REPORT — ORCH-0733 Gemini Fixes + Anthropic Drop from Trial

**Status:** implemented and partially verified — Vite build PASS · grep gates PASS · operator runtime verification PENDING (run Gemini v4 sweep, expect tighter VETO discipline + Anthony's/romantic 70-80).
**Dispatch:** [`Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0733_GEMINI_FIX_AND_ANTHROPIC_DROP.md`](../prompts/IMPLEMENTOR_ORCH-0733_GEMINI_FIX_AND_ANTHROPIC_DROP.md)
**Builds on:** Anthropic baseline `942fbddf` (v3) + Gemini A/B `fe15cb99` (v3 Gemini, comparison run).

---

## 1. Layman summary

Strengthened the Gemini prompt to fix two drift patterns surfaced in the A/B comparison: (1) Gemini was firing VETO 3× more than Anthropic for cases that should be low scores (Mala Pata for theatre — score 1-5, NOT VETO); (2) Gemini was over-weighting negative reviews on date-night signals (Anthony's Runway 84 = 40 vs Anthropic 72; operator-anchored truth says it IS romantic). Bumped PROMPT_VERSION → v4 with anti-VETO examples + a "weighing contradictory evidence" section. Then dropped Anthropic from the active code path; helpers preserved as block comments for `git revert`-cheap reversal. UI radio toggle removed; Gemini is now the sole provider with a static label.

---

## 2. Files Changed (Old → New Receipts)

### `supabase/functions/run-place-intelligence-trial/index.ts` (MODIFIED, ~+40 / −18 net)

**Change 1 — `PROMPT_VERSION` v3 → v4 with audit-trail comment** (~lines 47-67)
- **Before:** `const PROMPT_VERSION = "v3";` with v1/v2/v3 history
- **After:** `const PROMPT_VERSION = "v4";` with appended v4 audit comment explaining the two drift fixes + Anthropic-drop coincidence
- **Why:** Distinguishes new Gemini v4 rows from prior v3 rows in the table.
- **Lines:** +13 / −1

**Change 2 — Anti-VETO examples block in `buildSystemPrompt`** (~line 1024)
- **After existing rubric INAPPROPRIATE_FOR rules:** new "CRITICAL — anti-VETO examples (ORCH-0733 — fixes Gemini over-VETO drift)" section listing 11 explicit anti-examples (Mala Pata × 6 signals, Wang's Kitchen, Big Ed's, Taza Grill, National Gallery — all scored 1-15, NOT VETO).
- **Why:** Live evidence in run `fe15cb99` showed Gemini firing VETO=true for these exact cases. The rubric needed explicit anti-pattern examples to override Gemini's broader interpretation of "structural wrongness."
- **Lines:** +12

**Change 3 — Contradictory-evidence weighting section** (~line 1037)
- **After anti-VETO block:** new "WEIGHING CONTRADICTORY EVIDENCE" section. Tells Gemini explicitly: "Anthony's Runway 84 / `romantic` → score 70-80. Reviews say 'loud, chaotic supper club' AND 'candle-lit, occasion-dining, anniversary destination, fine plating, wine program.' The romantic signal is about INTENT + AMBIANCE + occasion-positioning, NOT silence. Anthony's IS a nice romantic dinner spot — operator-anchored fact." Adds the same logic for `lively`, `fine_dining`, `casual_food`. Codifies: negative caveats deduct 5-15 points, NOT 30; preserve "strong fit" tier when core identity is positive.
- **Why:** Anthony's case (Anthropic 72 vs Gemini 40 = 32-point gap) is the operator-flagged proof that Gemini over-weights review caveats. Operator confirmed Anthony's IS a romantic destination.
- **Lines:** +14

**Change 4 — Add Anthony's + Calusso/brunch to the calibration examples block** (~line 1057)
- **After existing examples (Bayfront, Harris Teeter, Mala Pata/groceries, etc.):** added 2 lines:
  - `Anthony's Runway 84 / romantic → score 70-80 (operator-anchored romantic destination; review noise is a deduction, NOT a verdict)`
  - `Calusso / brunch → VETO + 0 (serves_brunch=false explicit + dinner-only hours = STRUCTURAL wrongness)`
- **Why:** Both cases were live-validated in run `fe15cb99`; calibration examples must reflect them.
- **Lines:** +2

**Change 5 — Bootstrap env validation: drop ANTHROPIC_API_KEY requirement** (~lines 257-265)
- **Before:** required `ANTHROPIC_API_KEY` and `SERPER_API_KEY`; read `geminiKey` but didn't validate
- **After:** required only `GEMINI_API_KEY` and `SERPER_API_KEY`; ANTHROPIC_API_KEY no longer needed (helpers preserved-as-comments)
- **Why:** Gemini is sole provider. Reading an unused secret env var is wasteful. Operators no longer need the Anthropic key in Supabase secrets.
- **Lines:** +3 / −2

**Change 6 — Drop `provider` body param parsing in `handleStartRun`** (~lines 590-625)
- **Before:** parsed `body.provider` (default "anthropic"), validated enum, branched cost-estimate by provider, branched `model` field
- **After:** No provider parsing. Cost estimate fixed at $0.005/place (Gemini). Model always `GEMINI_MODEL_NAME_SHORT`. Returns `provider: "gemini"` in response for client awareness.
- **Why:** Simpler. No provider drift. Backward-compat preserved by hardcoding response value.
- **Lines:** +3 / −15

**Change 7 — Drop `provider` body param + `anthropicKey` arg in `handleRunTrialForPlace`** (~lines 645-665)
- **Before:** signature `(db, body, anthropicKey, geminiKey)`; validated provider enum; branched on provider when checking key
- **After:** signature `(db, body, geminiKey)`; validates only `geminiKey` presence
- **Why:** Mirrors `start_run` simplification.
- **Lines:** +5 / −13

**Change 8 — Drop `provider` arg in `processOnePlace`** (~lines 690-797)
- **Before:** signature `(args: { db, anthropicKey, geminiKey, provider, runId, anchor })` with ternary branch on provider for the Q2 call site + DB write
- **After:** signature `(args: { db, geminiKey, runId, anchor })`; always calls `callGeminiQuestion`; persists `model: GEMINI_MODEL_NAME_SHORT` + `model_version: GEMINI_MODEL_ID` always
- **Why:** Single code path. Eliminates the conditional that was the most failure-prone abstraction in the file.
- **Lines:** +5 / −22

**Change 9 — Comment-preserve Anthropic constants block** (~lines 33-54)
- **Before:** Live constants `MODEL_ID, MODEL_NAME_SHORT, ANTHROPIC_VERSION, ANTHROPIC_MESSAGES_URL, type Provider`
- **After:** Block-commented with header explaining preservation reason (DEC-101 + git-revert-cheap reversal)
- **Why:** Const #7 (label temporary fixes) — exit condition is "DEC entry to re-enable Anthropic." Preserved verbatim for clean revert.
- **Lines:** +6 / −1

**Change 10 — Comment-preserve `callAnthropicWithRetry` + `AnthropicUsage`** (~lines 99-150)
- **Before:** Live function and interface
- **After:** Block-commented with header explaining DEC-101 + reversal path
- **Why:** Same as Change 9.
- **Lines:** +6 / 0

**Change 11 — Comment-preserve Anthropic `callQuestion`** (~lines 819-873)
- **Before:** Live function reading `MODEL_ID`, `ANTHROPIC_MESSAGES_URL`, `callAnthropicWithRetry`, `computeCostUsd`
- **After:** Block-commented with header explaining DEC-101 + reversal path
- **Why:** Same as Change 9.
- **Lines:** +6 / 0

**Change 12 — Drop `computeCostUsd` from active import** (~lines 16-22)
- **Before:** Imported `computeCostUsd, computeCostUsdGemini`
- **After:** Imported `computeCostUsdGemini` only (with explanatory comment about removal)
- **Why:** `computeCostUsd` is only referenced inside the commented Anthropic `callQuestion`. Dropping the import keeps the active surface lean.
- **Lines:** +3 / −1

### `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx` (MODIFIED, ~+10 / −38 net)

**Change 13 — Drop `provider` state + map constants** (~lines 196-220)
- **Before:** `PER_PLACE_BROWSER_THROTTLE_MS_BY_PROVIDER = { anthropic: 9_000, gemini: 1_000 }` + `PER_PLACE_COST_BY_PROVIDER = { anthropic: 0.013, gemini: 0.005 }` + `PROVIDER_LABEL = { anthropic: "...", gemini: "..." }` + `useState("anthropic")` for provider
- **After:** Single `PER_PLACE_BROWSER_THROTTLE_MS = 1_000` + `PER_PLACE_COST_USD = 0.0038` (measured from `fe15cb99` run); provider state removed entirely
- **Why:** Single provider; no need for selection state or per-provider maps. Cost adjusted to actual measured value.
- **Lines:** +6 / −16

**Change 14 — `handleRunTrial` — drop provider in dialog + body params** (~lines 320-345)
- **Before:** dialog "using {providerLabel}…"; cost lookup `PER_PLACE_COST_BY_PROVIDER[provider]`; body params include `provider` field
- **After:** dialog "using Gemini 2.5 Flash…"; cost = `committedCount × PER_PLACE_COST_USD`; body params no longer include provider
- **Why:** Simpler. Edge fn now defaults Gemini.
- **Lines:** +2 / −5

**Change 15 — Drop provider in throttle loop** (~line 393)
- **Before:** `const throttleMs = PER_PLACE_BROWSER_THROTTLE_MS_BY_PROVIDER[provider] ?? 9_000;` then setTimeout
- **After:** Direct `setTimeout(r, PER_PLACE_BROWSER_THROTTLE_MS)`
- **Why:** Single-provider throttle.
- **Lines:** +2 / −4

**Change 16 — Drop provider in `run_trial_for_place` body param** (~line 363)
- **Before:** body params include `provider` field
- **After:** Body params no longer include provider
- **Why:** Edge fn now defaults Gemini.
- **Lines:** +0 / −1

**Change 17 — Replace radio toggle UI with static "AI Provider" label** (~lines 470-485)
- **Before:** Two radio inputs (Claude Haiku 4.5 / Gemini 2.5 Flash) with per-provider cost estimates + helper text "Same prompt + same anchors. Results stored separately for comparison."
- **After:** Static label "AI Provider · Gemini 2.5 Flash · est $X · v4 prompt" with helper text "Locked sole provider. Anthropic dropped 2026-05-05 after A/B comparison."
- **Why:** No selection needed. Static label preserves UI spacing + tells operator at-a-glance which provider runs + which prompt version.
- **Lines:** +8 / −34

**Change 18 — Update step description copy** (~line 443)
- **Before:** "Step 2: Run Q2 per place via the selected provider."
- **After:** "Step 2: Run Q2 per place via Gemini 2.5 Flash."
- **Why:** No more selection.
- **Lines:** +1 / −1

**NOT changed (per spec):**
- Model badge in `PlaceResultCard` — still uses `row.model.startsWith("gemini")` conditional. Old historical Anthropic v1/v2/v3 rows still display "Haiku" badge correctly. New v4 rows display "Gemini" badge. Audit trail preserved without code complexity.
- Anthropic v3 calibration data in `place_intelligence_trial_runs` — preserved as historical reference; no DB writes/deletes from this dispatch.

### `Mingla_Artifacts/signal-lab/SIGNAL_TAXONOMY.md` (MODIFIED, +9 LOC)

**Change 19 — Add "RE-DERIVATION PENDING" warning block at top**
- **After header:** prominent block explaining cutoffs are Anthropic-baseline; Gemini scores 5-15 higher on positives; v4 prompt fixes VETO over-fire; cutoffs need re-derivation from a fresh Gemini v4 sweep; treat all numbers as Anthropic-baseline UNTIL DEC-102 locks Gemini-specific cutoffs.
- **Why:** Future operators (and orchestrator) reading this doc need to know the cutoffs are stale-ish given the provider shift. Stops anyone from blindly using Anthropic cutoffs as production thresholds.
- **Lines:** +9

---

## 3. Static Verification Matrix

| Gate | Method | Result |
|---|---|---|
| `provider` body param removed from active code | grep `provider:` in trial fn — only hit is `provider: "gemini"` static return value | PASS |
| `anthropicKey` removed from active signatures | grep `anthropicKey` — 0 hits in active code | PASS |
| `callAnthropicWithRetry` only inside block comment | grep — 1 hit in commented block + 1 in another commented block | PASS |
| `callQuestion(` (Anthropic) only inside block comment | grep — 2 hits, both inside `/* */` block | PASS |
| `MODEL_ID` only in comments | grep — 1 hit inside commented `callQuestion` | PASS |
| Gemini-only Q2 call site | grep `callGeminiQuestion(` in active processOnePlace | PASS — single call site |
| `PROMPT_VERSION = "v4"` | grep | PASS |
| Anti-VETO examples present | grep "Mala Pata Molino + Cocina / `theatre`" in buildSystemPrompt | PASS |
| Contradictory-evidence section present | grep "Anthony's Runway 84" in buildSystemPrompt | PASS |
| Admin radio toggle removed | grep `<input type="radio"` in TrialResultsTab — 0 hits in render | PASS |
| Admin `provider` state removed | grep `useState("anthropic")\|setProvider` — 0 hits | PASS |
| Admin `provider` in body params | grep `provider,` in invokeWithRefresh body — 0 hits | PASS |
| Vite build (admin) | `npx vite build` | PASS — 18.11s clean |
| Taxonomy doc cutoff warning | inspect SIGNAL_TAXONOMY.md top | PASS |

---

## 4. Spec Traceability

| Dispatch SC | Implementation | Status |
|---|---|---|
| §2.A — anti-VETO examples in system prompt | Change 2 — 11 explicit "score 1-15, NOT VETO" examples | PASS |
| §2.A — contradictory-evidence weighting section | Change 3 — Anthony's Runway 84 + lively/fine_dining/casual_food guidance | PASS |
| §2.A — calibration examples updated (Anthony's + Calusso/brunch) | Change 4 | PASS |
| §2.A — PROMPT_VERSION v3 → v4 with audit comment | Change 1 | PASS |
| §2.B — drop Anthropic env validation | Change 5 | PASS |
| §2.B — drop provider param from start_run + run_trial_for_place + processOnePlace | Changes 6, 7, 8 | PASS |
| §2.B — comment-preserve callQuestion / callAnthropicWithRetry / constants | Changes 9, 10, 11 | PASS |
| §2.B — drop computeCostUsd from active import | Change 12 | PASS |
| §2.C — drop provider state | Change 13 | PASS |
| §2.C — drop provider radio toggle UI | Change 17 | PASS |
| §2.C — drop provider in body params | Changes 14, 16 | PASS |
| §2.C — drop PROVIDER_LABEL map | Change 13 | PASS |
| §2.C — model badge condition preserved (legacy v1/v2/v3 rows) | Verified — PlaceResultCard unchanged | PASS |
| §2.D — SIGNAL_TAXONOMY.md cutoff-pending warning | Change 19 | PASS |
| §3 — Vite build clean | 18.11s, no errors | PASS |

---

## 5. Invariant Preservation

| Invariant | Status | Why |
|---|---|---|
| `I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING` | PRESERVED | Trial pipeline still research-only |
| `I-PHOTO-AESTHETIC-DATA-SOLE-OWNER` | PRESERVED | n/a |
| `I-COLLAGE-SOLE-OWNER` | PRESERVED | No collage write code touched |
| `I-FIELD-MASK-SINGLE-OWNER` | PRESERVED | admin-seed-places untouched |
| `I-REFRESH-NEVER-DEGRADES` | PRESERVED | admin-refresh-places untouched |
| `I-BOUNCER-DETERMINISTIC` | PRESERVED | bouncer untouched |

---

## 6. Cache Safety

- No query keys changed.
- No DB schema changes.
- Old historical v1/v2/v3 rows in `place_intelligence_trial_runs` remain queryable + renderable (model badge still distinguishes Haiku vs Gemini per row).
- New v4 rows have `prompt_version="v4"` + `model="gemini-2.5-flash"` — distinguishable in analysis queries.

---

## 7. Regression Surface

3-5 features most likely to break:

1. **Existing v1/v2/v3 row rendering** — should be UNCHANGED. Spot-check: expand any pre-2026-05-05-v4 row; it still shows Q2 evaluations, Q1 (if v1/v2), and "Haiku" model badge.
2. **Run Trial dialog** — confirm message simplified (no provider name from radio); says "using Gemini 2.5 Flash". Operator should see static "AI Provider · Gemini 2.5 Flash" label below buttons.
3. **Body params on edge fn** — `provider` field no longer sent. Edge fn still accepts `body.provider` if sent (just ignored on the read path); old browser tabs with stale bundle won't break.
4. **Cost estimate display** — single number based on $0.0038/place; was previously branched. Should match measured `fe15cb99` cost when the v4 sweep runs.
5. **`q1_response` column** — still nullable; v4 rows always write `null`. Old v1/v2 rows still have populated q1_response and render correctly.

---

## 8. Constitutional Compliance

| Principle | Touched? | Status |
|---|---|---|
| #2 One owner per truth | YES | Gemini is sole provider; no parallel paths |
| #3 No silent failures | No | Errors still surface with structured retry/throw |
| #7 Label temporary fixes | YES | All Anthropic comment blocks have header explaining preservation reason + reversal path (DEC entry required) |
| #8 Subtract before adding | YES | Anthropic active code REMOVED before any addition; only ADDED prompt sections + simpler invocation |
| #9 No fabricated data | No | n/a — Gemini's `usageMetadata` consumed directly |
| All other 11 | No | n/a |

---

## 9. Deploy step (operator dispatches manually)

```powershell
supabase functions deploy run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv
```

Required — Section A + B are server-side; need redeploy for new prompt + simplified handlers to activate.

After deploy, hard-refresh `#/place-intelligence-trial` admin page to pick up the simplified TrialResultsTab bundle (Section C).

---

## 10. Verification matrix (post-deploy)

UNVERIFIED until operator runs:

| Check | Expected | Status |
|---|---|---|
| Edge fn deploy succeeds | "Deployed Functions on project..." output | UNVERIFIED |
| Hard-refresh admin → Run controls | Static "AI Provider · Gemini 2.5 Flash" label (no radio) | UNVERIFIED |
| Click Run Trial → confirm dialog | "using Gemini 2.5 Flash" text, ~$0.12 estimate | UNVERIFIED |
| New run row | `prompt_version="v4"` + `model="gemini-2.5-flash"` | UNVERIFIED |
| Mala Pata / theatre | score 1-5 (NOT VETO) | UNVERIFIED |
| Mala Pata / play | score 1-5 (NOT VETO) | UNVERIFIED |
| Mala Pata / groceries | score 1-15 (NOT VETO) | UNVERIFIED |
| Wang's Kitchen / fine_dining | score 1-15 (NOT VETO) | UNVERIFIED |
| Anthony's Runway 84 / romantic | score 70-80 (was 40 in v3 Gemini) | UNVERIFIED |
| Bayfront / flowers | VETO 0 (legitimate structural wrongness) | UNVERIFIED |
| Calusso / brunch | VETO 0 (legitimate structural wrongness) | UNVERIFIED |
| Total cost | ~$0.12 ± 20% | UNVERIFIED |
| Wall time | ~2-3 min (with 1s throttle) | UNVERIFIED |

---

## 11. Cost Projection

Same $0.0038/place as v3 Gemini (prompt v4 only adds ~500 tokens to system prompt; cached after first call so per-call cost barely changes). 32-anchor sweep ~$0.12. Triangle full backfill ~$12.

---

## 12. Discoveries for Orchestrator

**None.**

The dispatch was tightly scoped (4 file changes, all expected). The diagnosis from run `fe15cb99` was unambiguous: Gemini over-VETO + Anthony's case. v4 prompt addresses both with explicit examples. No out-of-scope issues surfaced.

---

## 13. Status

**implemented, partially verified.** Code complete. Vite build clean. Static grep gates pass. Operator runtime verification (Gemini v4 sweep + spot-check against the 11+ verification cases) is the remaining gate.

---

## 14. Test First (operator priority list)

1. Deploy edge fn: `supabase functions deploy run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv`
2. Hard-refresh `#/place-intelligence-trial` admin page
3. Verify Run controls now show static "AI Provider · Gemini 2.5 Flash" label (no radio)
4. Click "2. Run trial (32 places)" — confirm "using Gemini 2.5 Flash" + ~$0.12 estimate
5. Wait ~2-3 min for sweep to complete
6. **Critical spot-checks:**
   - Mala Pata / theatre: score 1-5, NOT VETO ✓
   - Mala Pata / play: score 1-5, NOT VETO ✓
   - Mala Pata / groceries: score 1-15, NOT VETO ✓
   - Wang's Kitchen / fine_dining: score 1-15, NOT VETO ✓
   - **Anthony's Runway 84 / romantic: score 70-80** ← was 40 in v3 Gemini; v4 fix should hit 70+
   - Bayfront / flowers: STILL VETO ✓
   - Calusso / brunch: STILL VETO ✓
7. Return run_id + 5-7 spot-check observations to orchestrator

If verification PASSES → orchestrator authors DEC-101 + Entry 005 in CALIBRATION_LOG + closes ORCH-0733 + dispatches Gemini-cutoff re-derivation as DEC-102.

If Anthony's still <60 OR Mala Pata still VETOs theatre/play/groceries → rework dispatch tightening prompt further.

---

## 15. Layman summary (chat)

Tightened the AI prompt to fix two drifts: Gemini was over-VETOing common cases (Mala Pata for theatre = score 1-5, not VETO) and over-weighting noise complaints on date-night signals (Anthony's IS a romantic spot — operator-anchored truth). Added explicit anti-examples + a "weighing contradictory evidence" section. Then dropped Anthropic from the active code; helpers preserved as block-commented historical reference. UI radio toggle removed; static "Gemini 2.5 Flash" label remains. Vite build clean. Operator deploys edge fn + hard-refreshes + runs Gemini v4 sweep next; expect Anthony's to land at 70-80 (was 40) and VETO over-fires to drop dramatically.
