# SPEC — ORCH-0990 [Curated-card flower stop shows real florists]

**Author:** mingla-forensics (SPEC mode)
**Date:** 2026-05-29
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0990-[flower-stop-real-florists]/` on branch `ORCH-0990-flower-stop-real-florists`
**Surface class:** Backend-only (Supabase edge `_shared` TS). No client code change. No migration *required* for the core fix (one OPTIONAL data re-score is specified as a follow-on, not a blocker).
**Confidence:** root cause **proven** (six-field, live DB + docs + code cross-checked).

---

## 0. Comms Ledger acknowledgements (read on entry 2026-05-29)

- **COMMS-0003 (WARN, ALL)** — external-API params must cite provider docs URLs inline at SPEC. **Acknowledged + satisfied**: every `types[]` / `primaryType` / `florist` claim below cites Google Places v1 docs inline (§4.1). No new external call is introduced; we read an already-persisted Google field (`place_pool.types`).
- **COMMS-0002 (WARN, ALL)** — the ORCH-0863 strict-grep gate blocks PRs adding `supabase/functions/*` files unless the ORCH is allowlisted. **Acknowledged**: this fix edits an EXISTING `_shared` file (no new backend file) and adds a NEW strict-grep gate file under `.github/scripts/strict-grep/` (not under `supabase/functions/`). The new gate file + the OPTIONAL re-score migration (if the implementor ships it) MUST be added to `ORCH_0990_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` **in the same commit** (§9, §10).
- **COMMS-0004 (WARN, ALL)** — INTAKE ID-collision scan. **N/A** — this is SPEC, not INTAKE; ORCH-0990 already spawned.

---

## 1. Symptom (operator-reported 2026-05-29)

On curated experience cards, the "Flowers" stop ("pick up flowers") surfaces places where you **cannot actually buy a bouquet**. Flagged in **Lagos, Nigeria** and **Raleigh, NC**. The bar: **100% of flower stops must resolve to a place that actually sells bouquets** — a real florist OR a grocery/supermarket with a verified floral department — or the stop must be honestly omitted.

---

## 2. Root cause — PROVEN (confirmed, extended, formalized)

Two layers, both verified against live DB (project `gqnoajqerqhnvulmnyvv`, 2026-05-29) + the latest migration + the persisted Google field.

### 🔴 RC-1 — No serve-time type-gate for `flowers` (the direct cause)

| Field | Evidence |
|---|---|
| **File + line** | `supabase/functions/_shared/signalRankFetch.ts:105-108` (`COMBO_SLUG_TYPE_FILTER`) |
| **Exact code** | `export const COMBO_SLUG_TYPE_FILTER: Record<string, string[]> = {`<br>` hiking: ['hiking_area', 'state_park', ...],`<br>` museum: ['museum', 'art_museum'],`<br>`};` — **no `flowers` entry.** |
| **What it does** | `generate-curated-experiences/index.ts:689` reads `COMBO_SLUG_TYPE_FILTER['flowers']` → `undefined` → passes `requiredTypes: undefined` into `fetchSinglesForSignalRank` (signalRankFetch.ts:240 sends `p_required_types: requiredTypes ?? null`). The RPC `fetch_local_signal_ranked` (baseline migration `20260505000000_baseline_squash_orch_0729.sql:4727`) then evaluates `(p_required_types IS NULL OR pp.types && p_required_types)` → the left side is TRUE → **the type clause passes unconditionally.** ANY place with a `flowers` score ≥ `COMBO_SLUG_FILTER_MIN.flowers` (80) inside the bbox is eligible, regardless of whether it sells flowers. |
| **What it should do** | A flower stop MUST require `pp.types && ARRAY['florist']` — i.e. the place's Google `types[]` set MUST contain `'florist'`. |
| **Causal chain** | symptom (non-florist at flower stop) ← card built from `fetchForCombo('flowers')` result ← RPC returned a high-popularity non-florist ← `p_required_types` was NULL ← `COMBO_SLUG_TYPE_FILTER` has no `flowers` key ← never added when `flowers` was introduced (only `hiking`/`museum` got entries in ORCH-0601). |
| **Verification** | Live DB, Cary bbox: **"Eggless cakes of RTP" (primary_type `bakery`, NO florist tag) scores 86 on `flowers` and is currently serve-eligible** — a bakery served as a flower stop. Lagos bbox: "Rukkies Decor" (`general_contractor`) scores 100. These pass today purely because the type clause is a no-op. |

### 🔴 RC-2 — `flowers` signal is popularity-weighted, so real florists are under-scored (the reason a type-gate alone is insufficient)

| Field | Evidence |
|---|---|
| **File + line** | `signal_definition_versions.config` for signal `flowers` (version `477e8a05-d401-4b86-af43-eace3fe087d5`), consumed by `_shared/signalScorer.ts:141 computeScore`. |
| **Exact config** | `scale: { rating_cap: 35, reviews_cap: 25, rating_multiplier: 10, reviews_log_multiplier: 5 }`, `field_weights: { types_includes_florist: 60, types_includes_grocery_store: -15, types_includes_supermarket: -10, ... }`, text patterns up to +40/+35/+10, `min_rating: 4`, `min_reviews: 5`, `cap: 200`. |
| **What it does** | A place's score is dominated by rating (≤35) + reviews-log (≤25) + text-pattern matches (≤85) — up to **145 from popularity/keywords**, vs **+60 for actually being a florist.** A well-reviewed business that merely mentions "flowers" in reviews can outscore a small genuine florist. |
| **What it should do** | Florist-vs-not eligibility must be decided by TYPE (RC-1's gate), and the per-stop score threshold must NOT exclude genuine, quality-gated florists the popularity signal under-weighted. |
| **Causal chain** | real florists score LOW (under the 80 min) → excluded by `COMBO_SLUG_FILTER_MIN.flowers=80` even after a type-gate → the only florist-tagged places clearing 80 are the highly-reviewed ones (big Harris Teeters) → a naïve "type-gate only, keep min 80" fix STILL under-serves real boutiques. |
| **Verification** | Live DB florist-tagged (`'florist' = ANY(types)`) places **scoring under 80**: Washington 13, Lagos 6, Raleigh 6, London 5, Brussels 4. Brussels has 5 florist-tagged places but only 1 clears 80 — keeping min 80 would serve 1 of 5 real florists. |

**Conclusion (formalized):** RC-1 is the direct cause; RC-2 is why option (i)-alone (add the type key, keep min 80) fails the 100% bar by *under-serving*. The honest fix is **type-gate (RC-1) + threshold decoupling (RC-2)**, both inside `signalRankFetch.ts`. No migration is required because the type-gate is enforced by passing `requiredTypes` into the existing RPC clause.

---

## 3. Five-layer cross-check

| Layer | Finding |
|---|---|
| **Docs** | Google Places v1: `types[]` is "a set of type tags for this result"; `primaryType` is a single value and is always one of the `types`. `florist`, `grocery_store`, `supermarket` are all Table-A types (§4.1 URLs). |
| **Schema** | `place_pool.types text[]`, `place_pool.primary_type text`, `place_scores(place_id, signal_id, score)`. RPC `fetch_local_signal_ranked` latest def confirmed in `20260505000000_baseline_squash_orch_0729.sql:4708` (no later migration supersedes it — grep-all confirmed). |
| **Code** | `COMBO_SLUG_TYPE_FILTER` lacks `flowers`; the comment at signalRankFetch.ts:110-113 *claims* it keeps Harris-Teeter florist tags + filters noise — but that behavior was never wired (no type-gate). The comment is aspirational, not enforced. |
| **Runtime** | RPC returns non-florists for `flowers` because the type clause is NULL-bypassed. |
| **Data** | Live: places scoring ≥80 on `flowers` in Lagos/Raleigh currently mostly DO carry the florist tag (the signal config was tuned since the orchestrator's first probe), but the bug is structural: nothing *enforces* it. Cary proves a NO-florist-tag bakery (86) is serve-eligible right now. |

**Layer disagreement = the bug:** Code-comment (Docs layer) says florist-tag filtering happens; Code layer never implements it; Runtime serves non-florists.

---

## 4. Grocery-verification signal — DECISION

**Operator scope (LOCKED 2026-05-29):** eligibility = **florist OR verified-floral grocery**. The honest question: how do we verify a grocery actually sells flowers without per-store curation?

### 4.1 Candidate (a) — `types[]` CONTAINS `'florist'` — **CHOSEN (primary signal)** 🔒LOCKED

Google Places v1 docs:
- `types[]` field: *"A set of type tags for this result."* — https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places (Place resource → `types[]`).
- `primaryType`: *"The primary type of the given result... A place can only have a single primary type"* and *"when a primary type is present, it is always one of the types in the `types` field."* — same reference.
- `florist`, `grocery_store`, `supermarket` are all valid Table-A types — https://developers.google.com/maps/documentation/places/web-service/place-types (`florist` under Services; `grocery_store`/`supermarket` under Shopping).

**Why it is the honest signal:** Google independently tags a place `florist` in `types[]` when it operates a floral business/department — even when `primaryType` is `grocery_store` or `supermarket`. This is Google's own classification, not Mingla heuristics, and requires zero manual curation.

**Live empirical proof (project gqnoajqerqhnvulmnyvv, 2026-05-29):**
- Harris-Teeter supermarkets with genuine floral departments carry `'florist'` in `types[]` while `primaryType='grocery_store'` (Raleigh: 18 such; Washington: 23; Cary: 11). These are exactly the "verified-floral grocery" the operator wants IN.
- A grocery/supermarket WITHOUT a floral department does NOT carry the florist tag → automatically excluded.
- The "florist OR verified-floral-grocery" set is **precisely `'florist' = ANY(types)`** — one predicate covers both halves of the operator's scope.

### 4.2 Candidate (b) — text-pattern (reviews/summary mentions "flowers/bouquet/floral") — **REJECTED as the gate; RETAINED as scorer input** 🔵

Already present in the `flowers` signal config (`reviews_regex`, `summary_regex`). Text-pattern is the SOURCE of false positives (RC-2): "Eggless cakes of RTP" scores 86 partly via text. Using it as the eligibility gate would re-admit non-florists. **Decision:** do NOT use text as the eligibility gate. It stays as a *ranking* nudge inside the score (fine — ranking, not gating).

### 4.3 Candidate (c) — `seedingCategories.ts` / `categoryPlaceTypes.ts` Flowers config — **CONFIRMED CONSISTENT; not the serve gate** 🔵

`seedingCategories.ts:474-499` (Flowers seeding config: `includedTypes: ['florist','grocery_store','supermarket']` + 30 `excludedPrimaryTypes`) governs SEEDING (Google Nearby Search to populate `place_pool`), NOT serving. `categoryPlaceTypes.ts:162-164` mirrors `'Flowers': ['florist','grocery_store','supermarket']`. These confirm florist+grocery+supermarket is Mingla's canonical Flowers universe at seed time. The serve-time gate (signal (a)) is *stricter* (florist tag required), which is correct: a supermarket only qualifies at serve time if it actually has the florist tag (verified floral dept), satisfying the operator's "verified" requirement. **No change to these files.**

### 4.4 Fallback

`'florist' = ANY(types)` is the gate. If a future city has florists Google never tagged `florist`, the stop goes honest-empty (it is optional+dismissible). There is no softer fallback because any softer signal re-admits non-florists — the operator's bar is 100% honesty, which dominates coverage.

---

## 5. Per-city coverage finding (all 17 seeded cities probed live 2026-05-29)

`seeding_cities WHERE status='seeded'` = 17 cities. Probe joined `place_pool` (is_active + is_servable, within bbox) to `place_scores(signal_id='flowers')`, with the real `stored_photo_urls` photo gate (G3) the serve path applies.

| City | Florist-tagged servable | …with photo (servable for stop) | Non-florist scoring ≥80 (today's false-positive risk) |
|---|---|---|---|
| Raleigh | 26 | 26 | 0 (was the operator's flagged city — now clean under the gate) |
| Washington | 26 | 26 | 0 |
| Cary | 13 | 13 | **1 — "Eggless cakes of RTP" (bakery, 86)** |
| Lagos | 10 | 10 | 0 (flagged city — gate yields 10 real florist-tagged places) |
| Durham | 9 | 9 | 0 |
| London | 8 | 8 | 0 |
| Baltimore | 6 | 6 | 0 |
| Brussels | 5 | 5 | 0 |
| **Fort Lauderdale** | **0** | **0** | 0 — **goes honest-empty** |
| **Toronto, Paris, Berlin, Barcelona, Chicago, Dallas, Miami, New York** | **0** | **0** | 0 — **go honest-empty** |

**Findings:**
1. **9 of 17 cities have florist-tagged places** (≥5 each, plenty to fill an optional single-place stop). The two operator-flagged cities (Lagos, Raleigh) BOTH have ample real florists once the gate is applied.
2. **8 cities have ZERO florist-tagged servable places** (Toronto, Paris, Berlin, Barcelona, Chicago, Dallas, Miami, New York; Fort Lauderdale has 842 servable places but 0 florist-tagged). These go **honest-empty** for the flower stop. This is acceptable and correct because the Flowers stop is `optional: true, dismissible: true` in all three experience types that use it (see §6) — the card still builds without it. The RPC's INNER JOINs already return `[]` cleanly when nothing matches; `fetchForCombo` returns `[]`; the generator skips the optional stop (index.ts:831 `if (available.length === 0 && stopDef.optional) continue;`).
3. **The score-threshold choice barely changes coverage** (type-gate + min 80 vs +min 40 differ by ≤2 places/city) because `place_scores` only has a `flowers` row for places that already cleared the scorer's hard eligibility (`min_rating:4`, `min_reviews:5`). Florist-tagged places with NO score row (Brussels 4, Lagos 6, etc.) failed that rating/review quality floor — they are legitimately lower quality and excluded by the RPC's INNER JOIN on `ps_filter` regardless of threshold. Lowering the threshold from 80→40 recovers the few quality florists the popularity weighting pushed just under 80 (Raleigh +2, e.g.) without admitting any non-florist (the type-gate blocks those).

**Conclusion:** type-gate `['florist']` + threshold floor 40 serves every florist-tagged quality place in every city that has one, and yields honest-empty in the 8 cities with none. **100% honesty bar met.**

---

## 6. Call chain (exact current line numbers, this worktree)

```
generate-curated-experiences/index.ts
  EXPERIENCE_TYPES (line 206):
    first-date  → stops[0] { role:'Flowers', optional:true, dismissible:true } (line 244); combos start 'flowers' (lines 249-253)
    romantic    → stops[0] { role:'Flowers', optional:true, dismissible:true } (line 272); combos 'flowers' (lines 277-278)
    picnic-dates→ stops[1] { role:'Flowers', optional:true, dismissible:true } (line 318); combo ['groceries','flowers','nature'] (line 322)
  → generateCardsForType() (line 643)
    → fetchForCombo('flowers') (defined line 682):
        filterSignal = COMBO_SLUG_TO_FILTER_SIGNAL['flowers'] = 'flowers' (signalRankFetch.ts:92)
        typeFilter   = COMBO_SLUG_TYPE_FILTER['flowers']      = undefined  ← RC-1 (signalRankFetch.ts:689 read)
        filterMin    = COMBO_SLUG_FILTER_MIN['flowers']       = 80          ← RC-2 (signalRankFetch.ts:117)
      → fetchSinglesForSignalRank(supabaseAdmin, { ..., requiredTypes: undefined }) (signalRankFetch.ts:211)
        → RPC fetch_local_signal_ranked(p_required_types := null, ...) 
           clause: (p_required_types IS NULL OR pp.types && p_required_types) → NULL bypass ← RC-1 lands here
           (baseline_squash_orch_0729.sql:4727)

ALSO (same resolvers, swap flow):
replace-curated-stop/index.ts → _shared/stopAlternatives.ts:110/115
    filterMin    = resolveFilterMin('flowers')   = 80
    requiredTypes= resolveTypeFilter('flowers')  = undefined
  → fetchSinglesForSignalRank(... requiredTypes) (stopAlternatives.ts:125-134)
```

**Single-point fix:** both the curated generator AND the swap flow resolve through `COMBO_SLUG_TYPE_FILTER` + `COMBO_SLUG_FILTER_MIN` in `signalRankFetch.ts`. Editing those two maps fixes **both** flows at once (Constitution #13 — generation and serving use the same gate). No edge-function code edit, no RPC edit needed.

---

## 7. Fix decision — which option (i / ii / iii)

- (i) add `flowers` to `COMBO_SLUG_TYPE_FILTER` + keep min 80 — **INSUFFICIENT** (under-serves real florists; RC-2 proof: Brussels 1-of-5).
- (ii) decouple ranking/threshold from popularity — **REQUIRED** (lower `COMBO_SLUG_FILTER_MIN.flowers` 80→40 so quality florist-tagged places under-weighted by popularity still pass).
- (iii) re-score / data backfill — **NOT REQUIRED for the fix.** The `types_includes_florist:+60` weight + `min_rating:4`/`min_reviews:5` already give a quality floor in the persisted scores; the type-gate enforces honesty. **OPTIONAL follow-on** (§8.4) only if the operator later wants to *raise* florist scores so flower stops rank higher relative to non-flower noise — not needed to meet the bar.

**Chosen fix = (i) + (ii)**, entirely in `_shared/signalRankFetch.ts`. No migration. No client change.

---

## 8. Change contract — layer by layer

### 8.1 `supabase/functions/_shared/signalRankFetch.ts` — 🔒 LOCKED

**Change A — add the `flowers` type-gate.** In `COMBO_SLUG_TYPE_FILTER` (line 105):

```ts
export const COMBO_SLUG_TYPE_FILTER: Record<string, string[]> = {
  hiking: ['hiking_area', 'state_park', 'nature_preserve', 'national_park', 'wildlife_refuge', 'scenic_spot'],
  museum: ['museum', 'art_museum'],
  // ORCH-0990 — Flowers eligibility = Google `types[]` contains 'florist'.
  // This is the single honest gate that admits BOTH true florists AND
  // grocery/supermarket floral departments (Harris Teeter etc. carry the
  // 'florist' tag in types[] even when primary_type is grocery_store) while
  // rejecting bakeries/event-decor/contractors that only score high on
  // rating/review popularity (RC-1). Google Places v1: types[] is "a set of
  // type tags for this result"; florist is a Table-A type.
  // https://developers.google.com/maps/documentation/places/web-service/place-types
  flowers: ['florist'],
};
```

**Change B — decouple the per-stop threshold from popularity.** In `COMBO_SLUG_FILTER_MIN` (line 114), change `flowers` from `80` to `40`, and REWRITE the misleading comment (lines 110-113) to state the type-gate is now the honesty mechanism:

```ts
// Per-stop filter_min override. Most signals use 120; movies is 80 (tiny universe).
// ORCH-0990: flowers is 40 (was 80). Honesty is now enforced by the
// COMBO_SLUG_TYPE_FILTER['flowers']=['florist'] type-gate, NOT by the score
// threshold. The flowers signal is rating/review-popularity weighted, so genuine
// boutique florists scored 40-79 and were wrongly excluded at 80 (RC-2). The
// scorer's own hard floor (min_rating:4, min_reviews:5) already guarantees only
// rated, reviewed florists get a flowers score row at all, so 40 keeps quality
// real florists while the type-gate keeps out non-florists.
export const COMBO_SLUG_FILTER_MIN: Record<string, number> = {
  'movies': 80,
  'flowers': 40,
};
```

**No other edit to this file.** `resolveTypeFilter` (line 141) and `resolveFilterMin` (line 163) already return the map values; the swap flow inherits both changes automatically.

### 8.2 DB / RPC — 🔒 LOCKED: **NO CHANGE**

`fetch_local_signal_ranked` already honors `p_required_types` via `pp.types && p_required_types`. Passing `['florist']` makes the clause `pp.types && ARRAY['florist']` (overlap = the row's types contains florist). No migration. (Confirmed latest def, no superseding migration.)

### 8.3 Edge functions — 🔒 LOCKED: **NO CODE CHANGE**

`generate-curated-experiences/index.ts` and `replace-curated-stop/index.ts` read the maps unchanged. The behavior change is entirely data-driven by the two map edits. (They will be re-deployed by the orchestrator at CLOSE because their bundled `_shared/signalRankFetch.ts` changed — deploy `generate-curated-experiences` AND `replace-curated-stop`.)

### 8.4 🎨 OPEN follow-on (NOT in this ORCH's required scope) — optional re-score

If, after shipping, the operator wants florists to rank even higher (e.g. raise `types_includes_florist` from +60 to +80 in the `flowers` signal config and re-run `run-signal-scorer`), that is a DATA op via `signal_definition_versions` + the scorer edge fn. **Implementor: do NOT do this unless explicitly asked** — the type-gate + min-40 already meets the bar. If shipped, it requires a migration (new `signal_definition_versions` row) → add to `ORCH_0990_BACKEND_ALLOWLIST` (§10).

---

## 9. Regression prevention — new strict-grep gate 🔒 LOCKED

**New file:** `.github/scripts/strict-grep/orch-0990-flower-stop-florist-gate.mjs`

Asserts, on `supabase/functions/_shared/signalRankFetch.ts`:
1. `COMBO_SLUG_TYPE_FILTER` contains a `flowers:` key whose array includes the string `'florist'`. (Fail if the key is missing or the array lacks `'florist'` → catches a revert of Change A.)
2. `COMBO_SLUG_FILTER_MIN.flowers` is present and ≤ 60 (catches a silent bump back to 80 that would re-exclude real florists).

Exit 1 on any violation (model on `orch-0965-home-uses-upcoming-hook.mjs`). Register the gate as a job in the relevant workflow (`.github/workflows/strict-grep-mingla-business.yml` or the curated/backend strict-grep workflow — implementor: place it in the same workflow that already runs the other backend `_shared` gates; if none exists, add to the mingla-business strict-grep workflow as the other ORCH-09xx backend gates are).

**Regression test (Deno):** `supabase/functions/_shared/signalRankFetch.flowers.test.ts` (new) — see T-06/T-07 in §12. Pure assertions on the exported maps (no DB).

---

## 10. Invariant proposal 🔒 LOCKED

Add to `Mingla_Artifacts/INVARIANT_REGISTRY.md` (status DRAFT → ACTIVE on ORCH-0990 CLOSE):

> ### I-PROPOSED-FLOWER-STOP-FLORIST-VERIFIED
> **Rule:** A curated "Flowers" stop NEVER resolves to a place lacking a flowers-availability signal. Concretely: the only serve-time gate for the `flowers` combo slug is `COMBO_SLUG_TYPE_FILTER['flowers'] = ['florist']`, requiring the served place's Google `types[]` to contain `'florist'` (covers true florists AND grocery/supermarket floral departments that Google tags `florist`). The popularity-weighted `flowers` signal score MUST NOT be the eligibility decider; the per-stop threshold `COMBO_SLUG_FILTER_MIN['flowers']` ≤ 60 exists only to retain quality florists the popularity signal under-weights. If no florist-tagged servable place exists in range, the flower stop is omitted (it is `optional:true, dismissible:true`) — never substituted with a non-florist.
> **Applies to:** `generate-curated-experiences` (curated cards) + `replace-curated-stop` (stop swap), both via `_shared/signalRankFetch.ts` + `_shared/stopAlternatives.ts`.
> **Enforcement:** strict-grep gate `orch-0990-flower-stop-florist-gate.mjs` + Deno test `signalRankFetch.flowers.test.ts`.

**Backend allowlist (COMMS-0002):** in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`, add (same commit as the gate/migration):
```js
const ORCH_0990_BACKEND_ALLOWLIST = [
  'supabase/functions/_shared/signalRankFetch.ts',
  'supabase/functions/_shared/signalRankFetch.flowers.test.ts',
  // + the OPTIONAL §8.4 re-score migration filename, ONLY if the implementor ships it
];
```
Wire it into the gate's allowlist union exactly as the other `ORCH_0NNN_BACKEND_ALLOWLIST` consts are consumed in that file.

---

## 11. Cross-Surface Impact (Phase 2.5 — MANDATORY)

| # | Surface | Covered? | Behavior / parity |
|---|---|---|---|
| 1 | **Consumer iOS** (`app-mobile/` iOS) | ✅ COVERED (automatic) | Curated cards + ORCH-0986 paired-profile holidays section consume `generate-curated-experiences` output. Flower stops now resolve only to florist-tagged places (or are omitted). No client code change — parity is automatic (shared backend). |
| 2 | **Consumer Android** (`app-mobile/` Android) | ✅ COVERED (automatic) | Identical mechanism; same backend response. Automatic parity. |
| 3 | **Buyer/anonymous Web** (`mingla-business/` public routes) | ❌ NOT COVERED | Buyer-anon routes don't render curated experience cards or the flower stop — no analog exists. |
| 4 | **Business iOS** (`mingla-business/` iOS) | ❌ NOT COVERED | Business app has no curated-card flower stop. |
| 5 | **Business Android** (`mingla-business/` Android) | ❌ NOT COVERED | Same — no analog. |
| 6 | **Admin Web** (`mingla-admin/`) | ❌ NOT COVERED | Admin doesn't render curated cards. (Admin *does* run seeding/scoring, but this fix touches neither.) |
| 7 | **Business Web preview** | ❌ NOT COVERED | No curated-card surface. |

Parity across iOS + Android is automatic (single shared backend response), so no separate per-surface success criteria are required; SC-1..SC-5 below apply equally to both consumer platforms.

---

## 12. Success criteria (observable / testable / unambiguous)

The bar: **100% of flower stops resolve to a florist or verified-floral grocery, in every served city, or honest-empty if truly none.**

- **SC-1 🔒** — For the `flowers` combo slug, `fetchSinglesForSignalRank` is called with `requiredTypes: ['florist']`. (Verify: log/inspect the params, or unit-assert `resolveTypeFilter('flowers')` deep-equals `['florist']`.)
- **SC-2 🔒** — Every place returned for a flower stop satisfies `'florist' ∈ place_pool.types`. No place lacking the florist tag is ever served as a flower stop. (Verify: T-01 + live RPC probe.)
- **SC-3 🔒** — Genuine florists scored 40-79 on the `flowers` signal ARE eligible (not excluded by an 80 floor). `resolveFilterMin('flowers') === 40`. (Verify: T-02.)
- **SC-4 🔒** — In a city with ≥1 florist-tagged servable photo'd place (e.g. Lagos, Raleigh), the flower stop resolves to one such place. (Verify: live RPC probe per §5; T-03.)
- **SC-5 🔒** — In a city with ZERO florist-tagged servable places (e.g. Paris, Chicago), the flower stop is OMITTED and the curated card still builds from its required stops (flowers is optional). No crash, no non-florist substitution, no empty-card. (Verify: T-04.)
- **SC-6 🔒** — The swap flow (`replace-curated-stop`) returns only florist-tagged alternatives for a flower stop (same gate). (Verify: T-05.)
- **SC-7 🔒** — Strict-grep gate fails if `COMBO_SLUG_TYPE_FILTER['flowers']` is removed/lacks `'florist'`, or if `COMBO_SLUG_FILTER_MIN['flowers']` > 60. (Verify: T-06/T-07 — run gate against a reverted fixture.)

---

## 13. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| **T-01 (fails-on-revert, happy path — Step 0.5)** | Type-gate honored | Call `fetchForCombo('flowers')` (or the RPC directly) for the Cary bbox | Result set EXCLUDES "Eggless cakes of RTP" (bakery, no florist tag, score 86) and INCLUDES the florist-tagged places. Reverting Change A re-admits the bakery → test fails. | edge + RPC (live or seeded fixture) |
| **T-02** | Threshold decoupled | `resolveFilterMin('flowers')` | `=== 40` | unit (Deno) |
| **T-03** | Florist served in populous city | RPC `fetch_local_signal_ranked(p_filter_signal:'flowers', p_filter_min:40, p_rank_signal:'flowers', <Raleigh bbox>, p_required_types:['florist'])` | Returns ≥1 row; every returned `place_id` has `'florist' ∈ types`. | RPC (live) |
| **T-04** | Honest-empty city | Same RPC with `<Paris bbox>` | Returns `[]`; generator skips optional flower stop; card still built from required stops; no exception. | edge |
| **T-05** | Swap flow gated | `replace-curated-stop` for a flowers stop | All alternatives are florist-tagged. | edge |
| **T-06 (gate)** | Strict-grep catches type-gate revert | Remove `flowers` key from `COMBO_SLUG_TYPE_FILTER` | gate exits 1 | CI |
| **T-07 (gate)** | Strict-grep catches threshold bump | Set `COMBO_SLUG_FILTER_MIN.flowers = 80` | gate exits 1 | CI |
| **T-08 (adversarial — for tester)** | Popularity can't beat type | Seed/identify a non-florist with a high `flowers` score (e.g. a heavily-reviewed bakery whose reviews mention "flowers") in a served bbox | It is NEVER returned for a flower stop; only florist-tagged places appear. Confirms the gate, not the score, decides eligibility. | RPC + edge (live) |

**Step-0.5 fails-on-revert test the implementor MUST write:** T-01 above — assert the Cary-bbox flower fetch excludes the no-florist-tag bakery and includes florist-tagged places, and that `git stash` of Change A flips the assertion red. Capture the before/after in the implementation report.

---

## 14. Implementation order

1. Edit `COMBO_SLUG_TYPE_FILTER` (add `flowers: ['florist']`) + `COMBO_SLUG_FILTER_MIN` (`flowers: 40`) + rewrite the stale comment — `signalRankFetch.ts`. (🔒)
2. Add Deno regression test `signalRankFetch.flowers.test.ts` (T-01 mechanism + T-02). (🔒)
3. Add strict-grep gate `orch-0990-flower-stop-florist-gate.mjs` + register the workflow job. (🔒)
4. Add `ORCH_0990_BACKEND_ALLOWLIST` to `orch-0863-marketing-hub-phase-b.mjs` — SAME commit as steps 2-3 (COMMS-0002). (🔒)
5. Add `I-PROPOSED-FLOWER-STOP-FLORIST-VERIFIED` (DRAFT) to `INVARIANT_REGISTRY.md`. (🔒)
6. Local Deno test + strict-grep run green → PR. Orchestrator at CLOSE: deploy `generate-curated-experiences` + `replace-curated-stop` (their `_shared` bundle changed). (🔒)
7. 🎨 OPEN: §8.4 re-score is explicitly OUT of required scope — do not ship unless the operator asks.

---

## 15. Discoveries for orchestrator

- **D-1 (FYI):** 8 of 17 seeded cities (Toronto, Paris, Berlin, Barcelona, Chicago, Dallas, Miami, New York — and Fort Lauderdale) currently have ZERO florist-tagged servable places in `place_pool`. The flower stop will be honestly omitted there. If the operator wants flower stops live in those markets, that's a SEEDING coverage gap (Google Nearby Search by the `flowers` seeding config), NOT this ORCH — register a separate seeding ORCH if desired. This fix correctly omits rather than fabricates.
- **D-2 (FYI):** The signalRankFetch.ts comment at lines 110-113 referenced specific Raleigh florists by name+score ("Mio Kreations 155, Petal & Oak 102, Fresh Market 69"). That comment was aspirational — the filtering it described was never wired. Change B replaces it with an accurate description. Worth a code-comment-hygiene note for other signal configs (do the comments describe behavior that's actually enforced?).
- **D-3 (FYI):** `picnic-dates` combo `['groceries','flowers','nature']` has the Flowers stop as the optional middle stop. The `groceries` slug separately resolves (no type-gate today) — out of ORCH-0990 scope, but if a future "groceries shows non-grocery" report lands, the same pattern (`COMBO_SLUG_TYPE_FILTER['groceries'] = ['grocery_store','supermarket']`) applies.

---

## 16. Recommended implementor for next phase

**Codex `implementor-mingla`.** Rationale: the change is tiny, surgical, backend-only TS map edits + a Deno test + a strict-grep gate + an allowlist line + an invariant-registry stanza — exactly the mechanical, contract-bounded work Codex executes cleanly with the spec as the contract. No UI, no design pass, no live-fire sim needed (pure backend; tester verifies via live RPC probe per T-03/T-04/T-08). Either implementor can do it; Codex is the default for spec-bounded backend edits.
