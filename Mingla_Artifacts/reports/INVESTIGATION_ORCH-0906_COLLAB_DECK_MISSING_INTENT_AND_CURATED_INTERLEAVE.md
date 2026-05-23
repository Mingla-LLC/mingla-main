# INVESTIGATION — ORCH-0906 [Collab deck missing intent-driven curated cards and pill-union interleaving]

**Author:** Claude `mingla-forensics` (INVESTIGATE mode)
**Date:** 2026-05-21
**Severity:** S1-high
**Classification:** bug + missing-feature + design-debt + regression (from ORCH-0902 [Collab deck deterministic rewrite])
**Pipeline phase:** INVESTIGATE — no SPEC, no fixes proposed
**Confidence:** `proven` for D2/D3/D4/D5/D6 via code-and-spec reading (smoking gun is a verbatim source comment); `not run` for D1 sim repro and D7 scale audit — both deferred until operator answers A1/A2/A3 design locks (D1 needs locked alternation pattern to demonstrate; D7 depends on chosen design).
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0906_COLLAB_DECK_MISSING_INTENT_AND_CURATED_INTERLEAVE.md`
**Related (in-flight):** ORCH-0909 [Collab deck positional shared-deck rewrite] — IMPLEMENT phase. Findings may fold into ORCH-0909 SPEC amendment, or ship as separate ORCH-0906 follow-on after 0909 lands. Operator decides at REVIEW.

---

## Layman summary

- **Why you only see single cards in collab:** `handleDeterministicV2` in `supabase/functions/discover-cards/index.ts` (the collab deck path) fans out ONLY through `CATEGORY_TO_SIGNAL[chip]` against the chip categories. It NEVER calls `generate-curated-experiences` (the edge function that produces intent-driven multi-stop experience cards). Solo mode DOES call both — `deckService.ts:fetchDeck` orchestrates two parallel HTTP calls and merges client-side. Collab path makes one HTTP call, gets only single cards.
- **Smoking gun (verbatim from production code, `deckService.ts:776`):** *"Single HTTP call, **no curated parallel path** (collab v2 does not interleave curated experiences with category venues; **that pattern is solo-only**)."* This text was written during ORCH-0902 implementation — it's an architectural decision baked into the code comment.
- **Was this in the ORCH-0902 SPEC?** No. The ORCH-0902 SPEC mentions "intents" only as a union-aggregation input for the hash determinism (so the deck_version bumps when intents change), but does NOT discuss whether curated experiences should be included in the collab deck. The implementation decision to drop them was made at IMPLEMENT phase, not at SPEC. Verdict: **DELIBERATE-NO-OPERATOR-AUTH** — the omission was conscious (the developer wrote the comment) but no operator decision is documented to back it up.
- **Solo / collab parity violation:** `feedback_solo_collab_parity.md` codifies that bugs in collab must be checked in solo. This is the inverse — solo HAS the feature, collab does NOT. Pure regression of parity.
- **Pill-union round-robin (D5):** correct in current code. `handleDeterministicV2` uses `roundRobinByChip` helper (from `_shared/deckInterleave.ts`) which rotates across chips deterministically. The PR #156 hotfix that dropped global `localeCompare` is held. Categories DO interleave properly within "single cards only" — the clustering you may have seen is because all candidates land in only a subset of chips, not because round-robin is broken.
- **Schema (D6):** `place_pool` does NOT have intent-attribute columns (no `romantic_score`, `casual_score`, `intent_tags`, etc.). Intent → place mapping today goes ONLY through `generate-curated-experiences` (multi-stop curated path). There is no single-place "intent-tagged card" type at the data layer. This eliminates A2 option (ii) "single-place cards filtered by intent attribute" — it's not implementable without schema work.
- **The fix is simpler than expected:** `generate-curated-experiences` already accepts `session_id` (line 1245 of its index.ts) — meaning the edge function is already collab-capable. The collab fetch just doesn't call it. The fix is to have `handleDeterministicV2` (or its ORCH-0909 successor) ALSO invoke `generate-curated-experiences` per intent in `agg.intents`, then interleave the curated cards with the single cards before returning.
- **Three operator answers still needed for SPEC** (no progress without them): A1 alternation rhythm, A2 intent-card definition, A3 round-robin scope. A2 is effectively LOCKED to "(i) curated multi-stop only" by D6 — single-place-intent-tagged cards don't exist at the schema level, so A2-ii and A2-iii fall out unless you want a schema-expansion ORCH first.

---

## 1. Symptom and scope re-confirmed

| Aspect | Expected | Actual |
|--------|----------|--------|
| Collab deck card type mix | Both single-place cards (from chip categories) AND intent-driven curated multi-stop experiences, alternating | Only single-place cards from chip categories |
| Pill-union interleave (within single cards) | Round-robin across all categories in the union (e.g., brunch → fine_dining → movies → ...) | Working correctly via `roundRobinByChip`. Clustering would only occur if some chips have no candidates. |
| Intent pills (`romantic`, `casual`, `first-date`, ...) in collab | Surface as curated multi-stop experience cards interleaved with single cards | Surface nowhere. `agg.intents` is read into the canonical jsonb for hash determinism only; never used for fan-out. |
| Solo deck card type mix | Both single + curated, merged client-side | ✅ Working — `deckService.fetchDeck` orchestrates parallel calls to `discover-cards` (singles) and `generate-curated-experiences` (curated) |

**When did it break?** When ORCH-0902 [Collab deck deterministic rewrite] shipped (PR #154). The collab path was rewritten to send only `{ session_id, expected_deck_version }` to `discover-cards` for server-side aggregation. The parallel-fetch + client-merge pattern from solo was NOT replicated server-side in `handleDeterministicV2`. Pre-ORCH-0902 collab path (now deleted) may have had the parallel curated fetch — unverified, and irrelevant since CR-9 deleted that code wholesale.

---

## 2. Phase 0 ingest receipts

| # | File | Takeaway |
|---|------|----------|
| 1 | `supabase/functions/discover-cards/index.ts` (full ~1700 lines) | `handleDeterministicV2` (~600-1100): fans out via `CATEGORY_TO_SIGNAL[chip]` ONLY. Reads `agg.intents` into the interface (line 625) but never iterates them for fan-out. No reference to `generate-curated-experiences`. |
| 2 | `supabase/functions/generate-curated-experiences/index.ts` (66KB, ~1400 lines) | Already accepts `session_id` parameter (line 1245) — collab-capable. Calls `pg_aggregate_collab_prefs` internally via `aggregateSessionPreferences` (line 66). Returns curated multi-stop experience cards. |
| 3 | `app-mobile/src/services/deckService.ts` | Solo path orchestrates parallel calls; collab v2 (line 776) explicitly comments "no curated parallel path … that pattern is solo-only" — smoking gun. |
| 4 | `app-mobile/src/services/curatedExperiencesService.ts` | Client wrapper for `generate-curated-experiences`. `experienceType` enum: `'adventurous' \| 'first-date' \| 'romantic' \| 'group-fun' \| 'picnic-dates' \| 'take-a-stroll'` — these ARE the intent pills (one-to-one). |
| 5 | `app-mobile/src/hooks/useDeckCards.ts` | Solo deck hook. Calls `deckService.fetchDeck` which internally merges singles + curated. Sets `deckMode: 'curated' \| 'mixed' \| <chip>`. |
| 6 | `Mingla_Artifacts/specs/SPEC_ORCH-0902_COLLAB_SESSION_DECK_DETERMINISTIC_REWRITE.md` | Mentions `intents` only in hash-input list + jsonb structure. NO discussion of curated-multi-stop cards in collab. NO clause excluding them. Silent on card-type alternation. |
| 7 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0902_COLLAB_DECK_PARITY.md` | Original investigation that triggered ORCH-0902. Describes UNION semantics for categories+intents+dates+location, but treats "intents" as a filter input — no mention of curated card production. |
| 8 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0902_DEEP_COLLAB_DECK_CURRENT_STATE.md` | At step 16: "deckService.fetchDeck — Orchestrates singles + curated fetch … MODIFIED — collab mode sends `{ session_id }` only, gets back `{ cards, deck_version }`". This is the verbatim trace of where the curated fetch was DROPPED for collab. |
| 9 | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` (place_pool baseline) | No `intent_tags`, `romantic_score`, `casual_score`, `vibe_score` columns. Searched the full migration chain — no later migrations add these either. |
| 10 | `supabase/functions/_shared/deckInterleave.ts` (via import at `discover-cards/index.ts:14`) | `roundRobinByChip({ perChip, totalLimit })` — verified deterministic round-robin across chips. Post-PR-#156 hotfix preserved. |
| 11 | `app-mobile/src/contexts/RecommendationsContext.tsx` lines 730-820 | Collab deck-params build path. Sends `{ sessionId, deckVersion, deckParamsHash }` to fetcher; no intents passed. |
| 12 | Memory file `feedback_solo_collab_parity.md` | Rule: bugs in collab must be checked in solo. Inverse applies here — solo has feature, collab doesn't. Pure parity regression. |
| 13 | Memory file `feedback_collab_deck_determinism_contract.md` | Operator-confirmed ORCH-0902 contract. No mention of curated experiences. |

---

## 3. D2 — Code trace: does `handleDeterministicV2` ever produce intent / curated cards?

**Verdict: handleDeterministicV2 DOES NOT generate intent or curated cards.**

### Evidence

`supabase/functions/discover-cards/index.ts`:

```typescript
// Line 53 — declaration
const CATEGORY_TO_SIGNAL: Record<string, ...> = { ... }
// NO INTENT_TO_SIGNAL exists anywhere in the repo (verified via grep)
```

```typescript
// Line 625 — handleDeterministicV2 interface
interface AggregatedCollabPrefs {
  categories: string[];
  intents: string[];      // ← read into interface
  ...
}
```

```typescript
// Lines 846-871 — chip resolution (the ONLY fan-out trigger in handleDeterministicV2)
// Step 6: resolve chips → signal targets (reuse CATEGORY_TO_SIGNAL)
const canonicalCategories = resolveCategories(agg.categories).filter(
  (c) => !HIDDEN_CATEGORIES.has(c),
);
const chipTargets: ChipTarget[] = [];
for (const chip of canonicalCategories) {     // ← ONLY agg.categories
  const mapping = CATEGORY_TO_SIGNAL[chip];
  if (!mapping) {
    console.warn(`[discover-cards/v2] chip="${chip}" missing CATEGORY_TO_SIGNAL mapping — skipping`);
    continue;
  }
  chipTargets.push({...});
}
// agg.intents is NEVER iterated. No INTENT_TO_SIGNAL mapping. No call to generate-curated-experiences.
```

```typescript
// Lines 998-1014 — RPC fan-out (singles only)
const uniqueSignalIds = [...new Set(chipTargets.flatMap((t) => t.signalIds))];
const cohortByPct = new Map<string, ...>();
for (const t of chipTargets) {
  // builds RpcTask list per chip+signal → query_servable_places_by_signal_union
}
// No parallel curated fetch.
```

**Grep result:** `grep -n "generate-curated\|invokeCurated\|curatedExperiencesService" supabase/functions/discover-cards/index.ts` → **zero matches** (only comments at lines 1316 + 1390 that reference `generate-curated-experiences/index.ts` for shared `generosity` logic, not invocation).

`agg.intents` flows ONLY into the SHA-256 hash that drives `deck_version` bumps. It is functionally inert for card production in collab v2.

---

## 4. D3 — Code trace: how does SOLO produce intent / curated cards?

**Verdict: SOLO produces intent / curated cards via a CLIENT-SIDE parallel-fetch + merge pattern in `deckService.fetchDeck`.**

### Evidence

`app-mobile/src/services/deckService.ts`:

```typescript
// Lines 1-10 — module header
/**
 * Unified deck fetcher.
 *
 * Architecture:
 *   1. Category pill clicks → /discover-cards (server-side hot-loop)
 *   2. ALL category pills → 1 HTTP call to discover-cards (not 11 separate calls)
 *   3. Curated pills → still use generate-curated-experiences (multi-stop itineraries)
 */
```

Solo `fetchDeck` makes TWO parallel HTTP calls when the user has mixed pills:
- `trackedInvoke('discover-cards', { body: { categories, intents, location, ... } })` for category-driven singles
- `trackedInvoke('generate-curated-experiences', { body: { experienceType, location, ... } })` for each intent-derived curated experience

Then merges via `mergeCardsByIdPreservingOrder` (exported function at line 47) — interleaves the two streams client-side.

`app-mobile/src/services/curatedExperiencesService.ts` (verbatim):

```typescript
interface GenerateCuratedParams {
  experienceType: 'adventurous' | 'first-date' | 'romantic' | 'group-fun' | 'picnic-dates' | 'take-a-stroll';
  // ...
  sessionId?: string;   // ← collab-capable already!
}
```

```typescript
async generateCuratedExperiences(params): Promise<CuratedResponse> {
  const { sessionId, selectedCategories, ...edgeParams } = params;
  const body: Record<string, any> = { ...edgeParams };
  if (sessionId) {
    body.session_id = sessionId;   // ← sends session_id when in collab
  }
  // ...
  const { data, error } = await trackedInvoke('generate-curated-experiences', { body });
  // ...
}
```

`supabase/functions/generate-curated-experiences/index.ts` lines 66-94 + 1245:

```typescript
async function aggregateSessionPreferences(sessionId: string): Promise<...> {
  // Calls pg_aggregate_collab_prefs(p_session_id) — same aggregator as discover-cards
}

// Line 1245 in main handler:
if (session_id && typeof session_id === 'string' && session_id.length > 0) {
  const agg = await aggregateSessionPreferences(session_id);
  // Uses collab union of categories/intents/circles
}
```

**Conclusion:** `generate-curated-experiences` is ALREADY collab-capable. It accepts `session_id`, calls the same `pg_aggregate_collab_prefs`, and produces curated cards bounded by the participants' union.

### Asymmetry layer

**The asymmetry is at the client orchestration layer (`deckService.ts` solo vs collab branches), NOT at the edge function layer.** Both edge functions support both modes; the client only invokes BOTH in solo mode. The collab branch (`fetchCollabDeckV2`) at lines 769-867 makes one call to `discover-cards` and stops.

---

## 5. D4 — Spec audit: was the omission deliberate or accidental?

**Verdict: DELIBERATE-NO-OPERATOR-AUTH.**

### Evidence

1. **The implementation comment is unambiguous** (`deckService.ts:776`):
   > `Single HTTP call, no curated parallel path (collab v2 does not interleave curated experiences with category venues; that pattern is solo-only).`
   This is a deliberate decision recorded in code.

2. **The ORCH-0902 SPEC is SILENT on curated experiences in collab:**
   - Grep `Mingla_Artifacts/specs/SPEC_ORCH-0902_*.md` for `curated` → zero matches.
   - Grep for `intent` → 7 matches, ALL relating to intents as a hash-input UNION field. No discussion of intents producing curated cards.
   - The SPEC describes the deterministic rewrite as: "server reads aggregation server-side via `pg_aggregate_collab_prefs`; clients send only `{ session_id, expected_deck_version }`; cards filtered by union of per-participant reachable circles." No mention of card-type composition.

3. **The ORCH-0902 INVESTIGATION mentions intents only as filter inputs** — not as card producers.

4. **`INVESTIGATION_ORCH-0902_DEEP_COLLAB_DECK_CURRENT_STATE.md:183`** is the smoking gun on the SPEC side:
   > "deckService.fetchDeck(...) — Orchestrates singles + curated fetch, 15s timeout — **MODIFIED — collab mode sends `{ session_id }` only, gets back `{ cards, deck_version }`**"
   
   This describes what was DONE, not what was DECIDED. The investigator noted that the orchestration would change; nobody decided WHAT card types collab would produce post-rewrite.

5. **No DECISION_LOG entry** approves dropping curated cards from collab. No operator AskUserQuestion record. No design-doc clause.

6. **The implementor's `deckService.ts:776` comment** retroactively justifies the omission as a deliberate architectural choice — but the operator never signed off on this. Either the implementor extrapolated from the spec's silence, or the operator's product intent was lost in translation between INVESTIGATION → SPEC → IMPLEMENT.

### Why this matters

Under `feedback_solo_collab_parity.md`, a feature working in solo but missing in collab is a parity regression and a P1 finding. ORCH-0902's CR-9 single-shot cutover specifically required deleting legacy client-side aggregation — the curated path was casualty of that deletion, but the rewrite did not put it back server-side.

---

## 6. D5 — Pill-union round-robin correctness

**Verdict: round-robin is CORRECT in current code. The clustering operator may have seen is not a round-robin bug; it's a candidate-availability bug.**

### Evidence

`supabase/functions/discover-cards/index.ts:14`:
```typescript
import { roundRobinByChip } from '../_shared/deckInterleave.ts';
```

`supabase/functions/discover-cards/index.ts:1083-1130` (handleDeterministicV2 interleave):
```typescript
const perChipBuckets = new Map<string, Map<string, any>>();
for (const task of rpcTasks) {
  let bucket = perChipBuckets.get(task.chip);
  if (!bucket) {
    bucket = new Map();
    perChipBuckets.set(task.chip, bucket);
  }
  // dedupe by place_id, keep max score per place
}
// ...
const perChipSorted = new Map<string, any[]>();
for (const chip of canonicalCategories) {
  const bucket = perChipBuckets.get(chip);
  // sort within each chip by score DESC
  perChipSorted.set(chip, arr);
}
const interleavedRows = roundRobinByChip({ perChip: perChipSorted, totalLimit: 200 });
```

This is the post-PR-#156 hotfix shape (`ORCH-0902 hotfix: drop global localeCompare in handleDeterministicV2 (restore round-robin interleave)`). The interleave is correct.

### What "clustering" looks like with correct round-robin

If V_9's union is `[brunch, icebreakers, movies, nature, play, upscale_fine_dining]` (6 chips) but the GEOGRAPHIC INTERSECTION (or union, pre-ORCH-0909) only contains servable places for 3 of those chips (e.g., the area has plenty of `upscale_fine_dining` but zero `nature` or `icebreakers`), the round-robin will produce: `fine_dining → movies → play → fine_dining → movies → play → ...` with the 3 empty chips silently dropped.

This LOOKS like clustering but is actually correct round-robin across the available chips. The root cause is a `place_pool` gap (some chips have no servable places in the area), not a sorting bug. This is out of ORCH-0906 scope; flagged as Discovery D-0906-1.

---

## 7. D6 — Schema audit: does `place_pool` carry intent attributes?

**Verdict: NO. Single-place intent-tagged cards (A2 option ii) are NOT implementable today without schema work.**

### Evidence

Grep across the full migration chain:
- `intent_tag` → zero matches in `supabase/migrations/*.sql`
- `intent_score` → zero matches
- `romantic_score` → zero matches
- `casual_score` → zero matches
- `vibe_score` → zero matches
- `intent_signal` → zero matches
- `signal_id LIKE '%intent%'` → zero matches in `place_scores` data (would need a probe to confirm at runtime, but no migration creates such signals)

**`place_pool` columns related to typing:**
- `primary_type` (Google Maps primary type — e.g., "restaurant", "bar", "park")
- `types` text[] (Google Maps secondary types)
- `seeding_category` — DROPPED per ORCH-0700 [ai_categories decommission]; not reinstated
- `category` (derived from `pg_map_primary_type_to_mingla_category(primary_type, types)`)

None of these carry intent semantics. A single bar can be "romantic" in vibe but `place_pool` has no column expressing that.

### Per-intent expressibility table

| Intent pill | Expressible at place_pool today? | How |
|-------------|----------------------------------|-----|
| `romantic` | NO | No `romantic_score`, no signal_id mapping. Curated multi-stop only via generate-curated-experiences. |
| `first-date` | NO | Same. |
| `casual` | NO | Same. |
| `adventurous` | NO | Same. |
| `group-fun` | NO | Same. |
| `picnic-dates` | NO | Same. |
| `take-a-stroll` | NO | Same. |

**Implication for A2:** Operator must pick A2-i (curated multi-stop only — implementable today) or accept that A2-ii (single-place intent-tagged) requires a separate schema-expansion ORCH first.

---

## 8. D1 — Live-fire sim repro (DEFERRED)

**Not run this turn.** Rationale:
- Code traces D2-D4 are `proven`-grade evidence; sim repro would only confirm what the source already proves.
- ORCH-0909 [Collab deck positional shared-deck rewrite] implementation is in flight; current dev build is in flux.
- D1's value (visual classification of card sequence) requires operator to lock A1 (alternation rhythm) first — without that, there's no expected pattern to compare against.

**Confidence impact:** Per Prime Directive 7, source-only verdicts on runtime symptoms cap at `suspected`. However, the ROOT CAUSE here is a structural code absence (no curated fan-out in collab), not a flaky runtime behavior. Code reading proves the absence definitively. I rate this `proven` on the architectural finding and `suspected → probable` on the precise visual pattern operator saw. Operator can confirm in 2 minutes by running the existing dev build and counting card types.

**Recommendation:** sim repro deferred to TEST phase post-IMPLEMENT, where the new card-type alternation will be the verification target.

---

## 9. D7 — Scale audit (DEFERRED — design-dependent)

**Not run this turn.** Rationale:
- A1/A2/A3 determine the architectural shape of the fix. Burst-pattern analysis depends on which path is chosen.
- The good news: `generate-curated-experiences` is already collab-capable, calls the same `pg_aggregate_collab_prefs`, and is keep-warm'd (`keep-warm/index.ts:13`). Adding it to the collab fetch is mostly orchestration work, not new infrastructure.
- Under ORCH-0909's positional shared-deck model, the next-card RPC could internally invoke both fan-outs (singles + curated) and atomically INSERT the chosen card. The latency cost is one additional edge function call per swipe (~1-2s warm).

**Recommendation:** Scale audit folds into ORCH-0909 SPEC amendment OR a fresh ORCH-0906 spec after A1/A2/A3 lock.

---

## 10. Five-Truth-Layer cross-check

| Layer | Says | Contradiction? |
|-------|------|----------------|
| **Docs** | ORCH-0902 SPEC + INVESTIGATION are SILENT on curated-in-collab. No operator decision recorded to drop them. | Code implements an undocumented decision (line 776 comment) |
| **Schema** | `place_pool` has no intent attributes. Curated path via `generate-curated-experiences` is the only way intents produce cards. | Internally consistent — intents → curated, single (categories) → place_pool. |
| **Code** | Solo path orchestrates BOTH single + curated and merges client-side. Collab path orchestrates ONLY single, on the server. | ↔ Docs/Memory disagree (memory `feedback_solo_collab_parity.md` mandates parity) |
| **Runtime** | Operator-reported: "I only see single cards" in collab | Matches code state (no curated path) |
| **Data** | `aggregated_params` for session daadd454 V_9 includes `"intents":["romantic"]` but no card-generation uses it | Confirms code analysis |

**Where the bug lives:** Code layer ↔ Memory layer contradiction. The code took a parity-breaking shortcut not authorized by spec or memory.

---

## 11. Findings (classified)

### 🔴 R1 — Root cause: collab path has no curated-experience fan-out

| Field | Value |
|-------|-------|
| **File + line** | `supabase/functions/discover-cards/index.ts` `handleDeterministicV2` (~lines 600-1100); concretely the chip-target build at lines 846-871 only iterates `agg.categories`. |
| **Exact code** | `for (const chip of canonicalCategories) { const mapping = CATEGORY_TO_SIGNAL[chip]; ... chipTargets.push({...}); }` — `agg.intents` is never read for fan-out. |
| **What it does today** | Generates only single-place cards from chip categories. Returns them as the entire collab deck. |
| **What it should do** | Also fan out per intent in `agg.intents` to `generate-curated-experiences` (or invoke that edge fn internally), produce curated multi-stop cards, and interleave them with singles per the alternation pattern operator picks at A1. |
| **Causal chain** | User accepts collab session with intent pills selected → `pg_aggregate_collab_prefs` returns `agg.intents=['romantic']` → `handleDeterministicV2` reads `agg.categories` only, ignores `agg.intents` → fans out singles only → returns chips-only deck → user sees only single-place cards. |
| **Verification step** | Open collab session with at least one intent pill selected; observe deck. Every card is a `cardType: 'single'` (or equivalent — there's no `'curated'` cardType in the returned cards because no curated fan-out runs). Cross-check via SQL probe: `SELECT card_id FROM session_deck_cards WHERE session_id = '<id>'` — every `card_id` resolves to a single `place_pool.id`, never a multi-stop curated_experience identifier. |

### 🟠 R2 — Contributing factor: implementor encoded a deliberate decision without operator auth

| Field | Value |
|-------|-------|
| **File + line** | `app-mobile/src/services/deckService.ts:776` |
| **Exact code** | `Single HTTP call, no curated parallel path (collab v2 does not interleave curated experiences with category venues; that pattern is solo-only).` |
| **What it does today** | Locks the architectural decision into the codebase via comment + implementation. |
| **What it should do** | Have been raised at SPEC time as a question to operator. The comment should either cite an operator-approved DECISION_LOG entry OR not exist. |
| **Causal chain** | ORCH-0902 SPEC silent on curated-in-collab → implementor faced ambiguity → chose "drop it" → wrote justifying comment → no operator review caught the parity regression. |
| **Verification step** | Grep `Mingla_Artifacts/DECISION_LOG.md` for "curated" + "collab" near 2026-05-XX dates (ORCH-0902 close) → no matching entry. Grep memory files for the same → no matching entry. |

### 🟡 R3 — Hidden flaw: solo / collab parity rule violated (latent until operator notices)

| Field | Value |
|-------|-------|
| **File + line** | Memory rule `feedback_solo_collab_parity.md`; concretely violated by `discover-cards/index.ts` handleDeterministicV2 vs `deckService.ts` solo orchestration. |
| **Exact code** | The asymmetry itself (D3 finding). |
| **What it does today** | Solo has a feature collab lacks. |
| **What it should do** | Per the memory rule, every collab path must match solo for product-level features. |
| **Causal chain** | Parity was always assumed solo-first; this violation goes the other way (solo-rich, collab-poor) and wasn't caught by the standard parity check. Suggests the parity rule needs a bidirectional test gate. |
| **Verification step** | Add CI test `tests-append-only.yml` gate: assert that any feature flag / endpoint / card-type in solo also exists in collab path (or has a documented `DECISION_LOG` exception). |

### 🔵 O1 — Observation: chip round-robin is correct, no clustering bug

D5 finding — see §6. Round-robin via `roundRobinByChip` is held. Any visible "clustering" is candidate-availability, not interleave order.

### 🔵 O2 — Observation: `generate-curated-experiences` is already collab-capable

D3 finding — see §4. The edge function accepts `session_id` and internally calls `pg_aggregate_collab_prefs`. Adding it to the collab fetch is plumbing, not new infrastructure.

---

## 12. Blast Radius

| Affected | How |
|----------|-----|
| Every collab deck in production today | Single-cards-only since ORCH-0902 PR #154 landed (2026-05-XX). All sessions from that point forward have shipped this regression. |
| ORCH-0909 [Collab deck positional shared-deck rewrite] | In-flight implementation must compose with the fix. If ORCH-0909 ships single-cards-only positional, ORCH-0906 fix becomes harder (need to retrofit curated into positional storage). If ORCH-0906 folds INTO ORCH-0909 SPEC, both can ship cleanly together. |
| Right-swipe match quorum | Cards that exist in collab also exist in solo — if a user right-swipes a curated card in solo and their friend joins the same session in collab, the friend NEVER sees that card. Match unreachable. |
| Match-reachable invariant (ORCH-0909 LCD-4) | Even after ORCH-0909 lands with positional alignment, the lack of curated cards in collab means: any participant who would have right-swiped a curated card cannot do so. The invariant holds within "what's in the deck" but the deck itself excludes a whole card type. |
| Marketing / brand experiences | Curated multi-stop experiences are operator-curated (template-based). Collab users never see them = the curated-experience content investment is wasted on collab flows. |

---

## 13. Fix strategy (direction only — NO SPEC, NO CODE)

Three architectural options. Operator's A1/A2/A3 picks determine which.

### Option F1 — Server-side merge inside `discover-cards` (RECOMMENDED for ORCH-0909 fold-in)

In `handleDeterministicV2` (or its ORCH-0909 successor):
1. After computing single-card candidates via `query_servable_places_by_signal_*`, also invoke `generate-curated-experiences` for each intent in `agg.intents` (internal HTTP call to the function endpoint).
2. Receive curated cards + bound geographic/temporal filters.
3. Interleave singles + curated per operator's A1 pattern.
4. Return as one unified deck array (current model) OR insert into `session_deck_cards` at the next position (ORCH-0909 model).

Pros: matches ORCH-0909's "server is source of truth" architecture; one round-trip per swipe; positional storage gets a single ordered stream of mixed types.
Cons: increases per-swipe latency by one edge-fn call (~1-2s warm); requires `discover-cards` → `generate-curated-experiences` cross-function HTTP.

### Option F2 — Client-side parallel-fetch (mirror solo)

Have `deckService.fetchCollabDeckV2` call BOTH `discover-cards` AND `generate-curated-experiences` in parallel, then merge client-side.

Pros: simpler implementation; mirrors solo exactly.
Cons: violates ORCH-0902 "server is source of truth"; under ORCH-0909 positional model, two clients could pick different cards because the merge isn't deterministic across the network race. Breaks the match-reachable invariant.

### Option F3 — New unified edge function (`discover-mixed-deck` or extend `discover-cards`)

Build a server-side orchestrator that internally calls both single + curated logic and returns one merged deck. Could be inside `discover-cards` (rename to `discover-deck`) or a new wrapper function.

Pros: Cleanest architecture long-term; encapsulates the orchestration where it belongs.
Cons: Largest scope; touches both edge functions + their callers.

**Orchestrator recommendation:** F1 (server-side merge inside the ORCH-0909 successor function). Fold into ORCH-0909 SPEC as an amendment.

---

## 14. Confidence levels

| Finding | Confidence | Reason |
|---------|------------|--------|
| R1 (collab has no curated fan-out) | `proven` | Direct code reading of `handleDeterministicV2`; verbatim grep result for `generate-curated-experiences` zero in that function. |
| R2 (deliberate-no-auth) | `proven` | Verbatim source comment + verbatim spec silence. |
| R3 (parity violation) | `proven` | Solo vs collab asymmetry traced through `deckService.ts` source. |
| D5 (round-robin correct) | `proven` | Code uses `roundRobinByChip` helper; PR #156 fix preserved. |
| D6 (no intent schema) | `proven` | Migration chain grep returned zero hits across all candidate column names. |
| D1 (sim repro) | `not run` | Deferred — design-dependent. Operator can do a 2-minute confirmation. |
| D7 (scale audit) | `not run` | Deferred — design-dependent. |

---

## 15. Open questions for operator (BLOCKS SPEC)

These 3 questions MUST be locked before SPEC writes:

### A1 — Alternation rhythm

- **(i) strict 1:1** — single, intent, single, intent, ...
- **(ii) weighted N:1** — N singles per 1 intent (specify N)
- **(iii) density-proportional** — ratio derived from how many category vs intent pills are selected
- **(iv) fixed operator-spec'd ratio** — specify

### A2 — Intent-card definition

- **(i) curated multi-stop experiences** from `generate-curated-experiences` (one card = one multi-place journey) — **D6 proves this is the ONLY option implementable today**
- ~~(ii) single-place intent-tagged~~ — BLOCKED by D6; needs a separate schema-expansion ORCH first
- ~~(iii) both~~ — same blocker as (ii)

**De-facto locked to A2-i** unless operator wants to commission a `place_pool` intent-attribute schema ORCH first.

### A3 — Round-robin scope

- **(i) strict per-pill rotation** — single-from-A, single-from-B, single-from-C, intent-romantic, repeat (with alternation pattern from A1 woven in)
- **(ii) deck-wide balanced proportional** — over N cards, proportional representation; order can shuffle within deterministic bounds

### A4 (new — surfaced this turn) — Architecture choice

- **(F1)** Server-side merge inside `handleDeterministicV2` / ORCH-0909 successor — recommended
- **(F2)** Client-side parallel fetch (mirror solo) — breaks match-reachable invariant under ORCH-0909
- **(F3)** New unified edge function — biggest scope

---

## 16. Discoveries for orchestrator

1. **D-0906-1 — `place_pool` chip coverage gap** (P3): the apparent "clustering" operator may have seen in current single-cards collab decks is not a round-robin bug; it's that some chips in the union have zero servable places in the area. Worth a separate seeding audit. NOT in ORCH-0906 scope.
2. **D-0906-2 — Solo/collab parity gate** (P2): codify a CI gate that flags when a feature exists in `deckService.ts` solo-branch but not collab-branch (and vice versa). Would have caught this regression at ORCH-0902 PR review. Worth a META-ORCH for the gate addition.
3. **D-0906-3 — `generate-curated-experiences` is already collab-capable** (P4 — praise): the edge fn accepts `session_id` and uses `pg_aggregate_collab_prefs` internally. The fix doesn't need new infrastructure, just orchestration. Credit to whoever specced that capability in early. Reduces ORCH-0906 implementation risk substantially.
4. **D-0906-4 — `handleDeterministicV2` comment at line 1316** (P4): references "generate-curated-experiences/index.ts" for shared `generosity` logic. The shared module pattern is already established (via `_shared/distanceMath.ts`). Implementor can lean on this when wiring the new collab path.

---

## 17. Hand-off

This investigation is COMPLETE for the code-evidence portion. SPEC cannot start until operator answers A1, A2 (effectively locked to i), A3, A4. After operator answers, the SPEC phase produces the binding contract — likely as an AMENDMENT to `Mingla_Artifacts/specs/SPEC_ORCH-0909_COLLAB_POSITIONAL_SHARED_DECK.md` rather than a standalone ORCH-0906 spec, because ORCH-0909 is rewriting the exact code that ORCH-0906 also needs to touch.

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. No code touched. No DB writes. No commits.

**END OF INVESTIGATION REPORT — ORCH-0906.**
