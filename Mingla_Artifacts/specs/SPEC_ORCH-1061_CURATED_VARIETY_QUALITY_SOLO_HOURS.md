# SPEC — ORCH-1061 [Curated stop variety + quality blend + solo hours gate]

**Status:** READY FOR IMPLEMENT
**Author:** mingla-forensics (SPEC mode)
**Date:** 2026-06-02
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1061-[curated-variety-quality]/` on branch `ORCH-1061-curated-variety-quality` (branched from `origin/main` `ef88b93c2`)
**Affected surfaces:** Consumer iOS + Consumer Android only (delivered via the edge function; zero client code in scope). NOT business/admin/buyer-web.

---

## 0. Layman summary

Three tightly-scoped backend changes to the consumer "curated" outing cards (the multi-stop Romantic / First Date / Adventurous / Group Fun / Take-a-Stroll / Picnic plans on the swipe deck):

1. **PART 1A** — Stops after the anchor are currently picked by *nearest only*, ignoring quality. Change them to a **60% quality / 40% proximity blend** so the second/third stop is a good place that's also reasonably close, not just whatever is physically closest.
2. **PART 1B** — The order combos are tried is currently a `Math.random` shuffle (non-deterministic, breaks collab decks). Replace it with a **deterministic ordering seeded off `batchSeed`** that (a) rotates the intent's *main activity* across cards so the deck shows variety, and (b) descends quality.
3. **PART 2** — Solo curated cards never get the "is this place open when I'd arrive?" filter that collab cards already get. **Extract the open-hours cascade into a shared module** so both solo and collab inherit it from inside `generate-curated-experiences`.

**Hard scope guard:** NO combo expansion. Combos and intents are frozen exactly as they are today.

---

## 1. Investigation basis — CONFIRMED by re-read

Every cite below was re-read in this worktree (not taken on faith). Line numbers are the current state of `supabase/functions/generate-curated-experiences/index.ts` unless noted.

| Claim | Confirmed location | Note |
|---|---|---|
| 6 experience types + combos | `index.ts:207-355` (`EXPERIENCE_TYPES`) | Actual combo counts: Adventurous **6**, First Date **5**, Romantic **2**, Group Fun **5**, Picnic **1**, Take-a-Stroll **3**. (Dispatch said "22 combos" — actual total is **22** ✓: 6+5+2+5+1+3=22.) |
| First non-optional stop = `available[0]` (top by vibe rank) | `index.ts:894-896` (`isFirstMainStop ? available[0] : …`) | Optional stops reached before it also use the `available` filter; flowers (optional) is selected at `index.ts:885` skip-or-take but is itself `available[0]`-ordered upstream. |
| Every later stop = `selectClosestHighestRated` (pure nearest) | standard branch `index.ts:897`; reverse-anchor branch `index.ts:847` | Function at `index.ts:1036-1054` — pure haversine nearest; rating/quality IGNORED despite the misleading name. |
| Combo order = `Math.random` shuffle ×(limit\*2) | `index.ts:741-746` via `shuffle()` at `index.ts:1016-1023` | `shuffle` uses `Math.floor(Math.random()*…)`. |
| `globalUsedPlaceIds` per-request, accumulates across all cards | declared `index.ts:750`; seeded per-card `index.ts:778`; updated `index.ts:983-986` | Anchor descends best→2nd→3rd across cards because each card seeds `comboUsedIds` from the global set. |
| Vibe rank overrides | `index.ts:403-461` (`EXPERIENCE_RANK_SIGNAL_OVERRIDE`) | resolver `resolveStopRankSignal` `index.ts:467-469`. |
| Candidate fetch carries `_rankScore` | `fetchSinglesForSignalRank` → RPC `fetch_local_signal_ranked`; helper `_shared/signalRankFetch.ts:257-406` | Row shape `SignalRankResult` (`signalRankFetch.ts:40-70`) carries `_rankScore` (number), `rating` (number), `review_count` (number), `lat`, `lng`. Rows arrive **sorted by `_rankScore` DESC then sliced to `limit`** (`signalRankFetch.ts:402-403`). |
| Reverse-anchor (picnic) finds Picnic Spot first, fetches others within 3km | `index.ts:783-866`; per-card near-fetch radius `3000` `index.ts:814` | Anchor stop built directly (`index.ts:823-831`); companions via `selectClosestHighestRated` (`index.ts:847`). |
| Each stop carries honest `isOpenNow`/`openingHours`/`utcOffsetMinutes` | `buildCardStop` `index.ts:567-575` | `isOpenNow` null when unknown (Constitution #9). `openingHours` = `card.opening_hours || {}`. `utcOffsetMinutes` = `card.utc_offset_minutes ?? null`. |
| **Solo path** = DIRECT call to generate-curated-experiences, NO hours filter | client `app-mobile/src/services/deckService.ts:570-581` (`skipDescriptions:true`, `batchSeed`, `datetimePref` all sent) | This edge fn applies **no** open-hours filter anywhere. Confirmed by full read. |
| **Collab path** = via discover-cards, which DOES apply `filterCuratedByStopHours` | `discover-cards/index.ts:1363`; helpers `isStopOpenAtHour` `460-502`, `filterCuratedByStopHours` `504-532`, `CURATED_STOP_DURATION` `464-478`, `ALWAYS_OPEN_TYPES` `480-485`, `parseHoursText`/`hourInRanges`/`parseSingleRange` `147-219` | `curatedUtcNow = agg.datetimePref ? new Date(agg.datetimePref) : new Date()` (`discover-cards/index.ts:1362`). |
| `batchSeed` is a request param | handler destructure `index.ts:1261` (`batchSeed = 0`) | **NEW FINDING:** `batchSeed` is destructured but is **NOT** currently passed into `generateCardsForType` (single call site `index.ts:1351-1356`). Today the function never sees it. PART 1B must thread it through as a new parameter. |

### 1.1 Discoveries during this SPEC (registered, not silently fixed)

- **D-1 (Hidden flaw, 🟡 — relevant to PART 2).** The collab curated-hours reader `isStopOpenAtHour` (`discover-cards/index.ts:487-502`) ONLY reads the **text-based** `openingHours[dayName]` shape (lowercase day key → `parseHoursText`). It does **NOT** handle the canonical Google v1 `openingHours.periods` array shape, unlike the sibling `filterByDateTime.isOpenAtHour` (`discover-cards/index.ts:285-335`) which checks `oh.periods` first. Since `place_pool.opening_hours` is the unwrapped Google v1 shape (`{ openNow, periods, weekdayDescriptions, … }` per the `[CRITICAL — ORCH-0641]` comment at `discover-cards/index.ts:263-276`), `isStopOpenAtHour` falls to its "no `dayText` → assume open" branch (`index.ts:497`) for ~99.9% of rows. **This means the collab curated-hours filter is largely a no-op today** — it only meaningfully filters the ~37 legacy text-shape rows. This is the SAME bug class ORCH-1019 fixed on the mobile client (see `I-CURATED-HOURS-VIA-CANONICAL-READER`). PART 2 of THIS spec MUST fix it while extracting (it would be malpractice to extract a broken reader into a shared module and ship it to the solo path too). The shared reader MUST handle `periods` first, then `_periods`, then text `weekdayDescriptions`/lowercase-day fallback — mirroring the all-shape-tolerant `filterByDateTime.isOpenAtHour`. Honest-unknown rule preserved: genuinely no data → assume open. See §5 PART 2 for the exact contract.

---

## 2. Scope, non-goals, assumptions

### 2.1 In scope
- `supabase/functions/generate-curated-experiences/index.ts` — the curated generator (PART 1A blend, PART 1B deterministic rotation, PART 2 hours filter call).
- A NEW shared module `supabase/functions/_shared/curatedStopHours.ts` — extracted open-hours cascade (PART 2), imported by BOTH `discover-cards` and `generate-curated-experiences`.
- `supabase/functions/discover-cards/index.ts` — repoint its existing `filterCuratedByStopHours` call to the shared module; delete the now-duplicated local helpers (PART 2 single-source-of-truth).
- New Deno tests under `supabase/functions/generate-curated-experiences/__tests__/` and `supabase/functions/_shared/__tests__/`.
- C7 backend allowlist + (optionally) a new strict-grep gate.

### 2.2 Non-goals (explicit)
- **NO combo expansion.** Romantic stays 2 combos, Picnic stays 1, etc. No combo/intent added, removed, or reordered in `EXPERIENCE_TYPES`.
- **No change to the first-stop selection** (`available[0]` by vibe rank stays exactly as is — PART 1A touches ONLY post-first-non-optional-stop picks).
- **No change to the candidate fetch / RPC / signal system** (`fetchSinglesForSignalRank`, `fetch_local_signal_ranked`, `EXPERIENCE_RANK_SIGNAL_OVERRIDE`, filter_min, primary-type gate all unchanged).
- **No change to any preserved gate** (see §6).
- **No client (`app-mobile`) code changes.** Solo client already sends `datetimePref` + `batchSeed`; it inherits the fix server-side. No mobile parity work.
- **No new external-API calls.** (See §9.)
- **No DB migration.** All three parts are pure edge-function logic over data the candidate rows already carry.

### 2.3 Assumptions
- `batchSeed` sent by the solo client (`deckService.ts:577` `batchSeed: params.batchSeed`) is a stable per-batch integer; collab path sets it via session aggregation OR defaults to 0. The rotation must be correct AND deterministic for `batchSeed=0` (default) too.
- Candidate `_rankScore` is a non-negative number on the scale produced by `fetch_local_signal_ranked` (rank-signal score). `rating` ∈ [0,5], `review_count` ≥ 0. All may be 0; none are negative.
- The 3km reverse-anchor companion fetch radius (`index.ts:814`) is the proximity-normalization denominator for the reverse-anchor branch; the standard branch uses `clampedRadius` (`index.ts:667`).

---

## 3. Cross-Surface Impact (MANDATORY)

| Surface | Covered? | Behavior / files / parity |
|---|---|---|
| 1. Consumer iOS (`app-mobile` iOS) | YES | Curated deck cards get quality-blended post-anchor stops, deterministic main-activity rotation, and open-hours filtering. Parity is **automatic** — all logic is server-side in the edge fn; iOS calls the same edge fn. No iOS file touched. SC-1A/1B/2 apply. |
| 2. Consumer Android (`app-mobile` Android) | YES | Identical to iOS — same edge fn, same payload. Parity **automatic**. No Android file touched. |
| 3. Buyer/anon Web | NO | Buyer-web checkout/public pages do not render the curated deck. No curated pipeline exposure. |
| 4. Business iOS | NO | Business app has no consumer curated deck. |
| 5. Business Android | NO | Same as Business iOS. |
| 6. Admin Web | NO | Admin does not render or generate curated cards. |
| 7. Business Web preview | NO | No curated deck surface. |

Because the only two covered surfaces both consume the SAME edge function with NO separate client code, parity is automatic and per-surface success criteria are identical. No manual per-surface (SC-N-iOS / SC-N-Android) split is required — but the tester MUST still confirm a real curated deck renders the new behavior on BOTH an iOS sim and an Android emulator (the edge fn is shared, but the *rendering* of the resulting payload must be eyeballed on each platform per the parity rule).

---

## 4. PART 1A — Quality-aware proximity blend for post-anchor stops

### 4.1 Goal
Replace pure-nearest `selectClosestHighestRated` (used for every stop AFTER the first non-optional stop) with a **proximity + quality blend**, default **60% quality / 40% proximity** (operator-approved knob). Deterministic. Used in BOTH branches (standard `index.ts:897`, reverse-anchor `index.ts:847`).

### 4.2 New function (replaces `selectClosestHighestRated` usage)

Add a new pure helper `selectBlendedStop(available, refLat, refLng, radiusMeters)` and route both post-anchor call sites through it. Do NOT delete `selectClosestHighestRated` yet if any OTHER call site exists — grep confirms it is used ONLY at `index.ts:847` and `index.ts:897`, so it MAY be deleted, but the implementor must re-grep at implement time and delete only if still unreferenced. If kept, it must not be silently left as dead code without a `[TRANSITIONAL]` marker (Constitution #7) — prefer deletion.

#### 4.2.1 Quality sub-score `Q(p)` (🔒 LOCKED)

Quality is a normalized 0..1 value derived from data the candidate already carries (`signalRankFetch.ts:40-70`):

```
// Primary: vibe rank score, normalized within THIS candidate set.
// `available` arrived sorted by _rankScore DESC; normalize against the set's own max
// so the scale is self-relative (rank scores differ wildly across signals).
const rankMax = Math.max(...available.map(p => p._rankScore ?? 0), 0);
const rankNorm = rankMax > 0 ? ((p._rankScore ?? 0) / rankMax) : 0;   // 0..1

// Secondary: rating × log-dampened review_count, normalized 0..1.
// rating/5 gives 0..1; review weight saturates so a 5.0 with 3 reviews
// does not beat a 4.6 with 2,000 reviews.
const ratingNorm = Math.min(Math.max((p.rating ?? 0) / 5, 0), 1);     // 0..1
const reviewWeight = Math.min(Math.log10((p.review_count ?? 0) + 1) / 3, 1); // 0..1, saturates at 1000 reviews
const ratingScore = ratingNorm * (0.5 + 0.5 * reviewWeight);          // 0..1; ratings with no reviews keep half weight

// Quality = primary (vibe rank) dominant, rating/reviews as a secondary tie-shaper.
const Q = 0.75 * rankNorm + 0.25 * ratingScore;                       // 0..1
```

Rationale: `_rankScore` IS the signal-tuned "is this the right vibe" measure the pipeline already trusts for the first stop; it must dominate quality. Rating/review is the secondary discriminator that the dispatch named. The 0.75/0.25 internal split of *quality* is LOCKED; it is distinct from the 60/40 quality-vs-proximity blend below.

#### 4.2.2 Proximity sub-score `P(p)` (🔒 LOCKED)

```
const distKm = haversineKm(refLat, refLng, p.lat ?? 0, p.lng ?? 0);   // existing _shared/distanceMath helper
const radiusKm = Math.max(radiusMeters / 1000, 0.001);               // avoid /0
// Linear closeness within the candidate radius; clamp to [0,1].
const P = Math.min(Math.max(1 - (distKm / radiusKm), 0), 1);          // 1 = at ref point, 0 = at/beyond radius edge
```

`radiusMeters` passed in = `clampedRadius` for the standard branch (the radius the candidates were fetched within, `index.ts:667`), and `3000` for the reverse-anchor branch (the per-card near-fetch radius, `index.ts:814`). This makes proximity self-relative to the pool the candidates came from.

#### 4.2.3 Blend + selection (🔒 LOCKED)

```
const BLEND_QUALITY = 0.60;   // operator-approved knob
const BLEND_PROXIMITY = 0.40;
const score = BLEND_QUALITY * Q + BLEND_PROXIMITY * P;
// pick the MAX score; deterministic tie-break chain below.
```

**Tie-breaks (🔒 LOCKED, deterministic — no `Math.random`):** when two candidates' blended `score` are within `1e-9`:
1. higher `_rankScore` wins;
2. then higher `rating`;
3. then higher `review_count`;
4. then lexicographically smaller `google_place_id` (stable, pool-independent final arbiter).

The whole function is a pure function of `available` (whose order + contents are themselves deterministic given request inputs + the global dedup state) and the ref point — **no request-time randomness**. This is what keeps collab decks reproducible (§6, collab-determinism invariant).

#### 4.2.4 Empty / single guards (🔒 LOCKED)
- `available.length === 0` → return `null` (caller already handles null → optional-skip or combo-invalid; preserves the existing failed-anchor cycle logic at `index.ts:842/850`).
- `available.length === 1` → return `available[0]` (no blend needed).

### 4.3 Call-site edits
- `index.ts:897` (standard branch): `selectClosestHighestRated(available, prevLat, prevLng)` → `selectBlendedStop(available, prevLat, prevLng, clampedRadius)`. `clampedRadius` is in scope at `generateCardsForType` (`index.ts:667`).
- `index.ts:847` (reverse-anchor branch): `selectClosestHighestRated(available, prevLat, prevLng)` → `selectBlendedStop(available, prevLat, prevLng, 3000)`. (3000 = the per-card near-fetch radius used at `index.ts:814`.)

### 4.4 PART 1A success criteria
- **SC-1A-1:** For a post-anchor stop with ≥2 candidates, the selected place maximizes `0.6·Q + 0.4·P` (not pure nearest). Observable: a closer-but-low-rank candidate loses to a slightly-farther-but-high-rank candidate when the blend math says so.
- **SC-1A-2:** Selection is deterministic — same `available` + same ref point → same pick across runs (no `Math.random`).
- **SC-1A-3:** First non-optional stop is UNCHANGED (still `available[0]` by vibe rank) — PART 1A does not touch `index.ts:895-896`.
- **SC-1A-4:** Null/single-candidate behavior matches the old helper (null on empty → preserves failed-anchor + optional-skip logic).

---

## 5. PART 1B — Deterministic best→2nd-best rotation that rotates the main activity

### 5.1 Goal
Replace the random combo shuffle (`index.ts:741-746`) with a **deterministic ordering** that (a) rotates the intent's *main activity* across cards and (b) descends quality, seeded off `batchSeed` so collab decks stay reproducible.

### 5.2 Per-intent main-activity rotation table (🔒 LOCKED — CONFIRMED against `EXPERIENCE_TYPES` `index.ts:207-355`)

For each intent, the "main activity" is the combo slot whose *category* we rotate across cards. The rotation key = the slug at that slot index.

| Intent (`id`) | Combos (count) | Main-activity slot | Distinct main-activity slugs (rotation order = first appearance, then quality) |
|---|---|---|---|
| `adventurous` | 6 | stop-1 (index 0) | `play`, `theatre`, `hiking`, `creative_arts`, `museum` (note: `theatre` appears twice — combos `['theatre','casual_food']` + `['theatre','upscale_fine_dining']`) |
| `first-date` | 5 | the **Activity** stop = index 1 (index 0 is optional Flowers) | `brunch`, `theatre`, `movies`, `play` (`play` appears twice — `['flowers','play','drinks_and_music']` + `['flowers','play','upscale_fine_dining']`) |
| `romantic` | 2 | the **Experience** stop = index 1 (index 0 is optional Flowers) | `creative_arts`, `theatre` |
| `group-fun` | 5 | stop-1 (index 0) | `play`, `theatre`, `brunch`, `movies` (`play` appears twice) |
| `take-a-stroll` | 3 | **Nature anchor is CONSTANT (`nature` in all 3)** → rotate the **FOOD stop** = index 1 | `brunch`, `casual_food`, `upscale_fine_dining` |
| `picnic-dates` | 1 | single combo → **NO rotation**; pure park-quality descent (reverse-anchor already descends anchor best→2nd via `globalUsedPlaceIds`). Keep as-is. |

**Main-activity slot index resolver (🔒 LOCKED):** the implementor MUST derive the slot index from the typeDef, not hardcode per-intent magic numbers in the loop:

```
function mainActivitySlotIndex(typeDef): number {
  // Reverse-anchor (picnic): no rotation — return -1 sentinel.
  if (typeDef.stops.some(s => s.reverseAnchor)) return -1;
  // take-a-stroll: nature anchor constant → rotate the food slot.
  //   Defined as: the first stop slot whose slug VARIES across combos.
  // General rule for all non-anchor intents: rotate the FIRST non-optional slot
  //   whose slug is NOT constant across all combos.
  const firstNonOptional = typeDef.stops.findIndex(s => !s.optional);
  for (let i = firstNonOptional; i < typeDef.stops.length; i++) {
    const slugsAtI = new Set(typeDef.combos.map(c => c[i]));
    if (slugsAtI.size > 1) return i;   // first varying non-optional slot
  }
  return firstNonOptional; // all-constant fallback (shouldn't happen for current table)
}
```

Verify this resolver yields: adventurous→0, first-date→1, romantic→1, group-fun→0, take-a-stroll→1, picnic→-1. (A Deno test pins this exact mapping — see §8 T-1B-MAP.) This is the SINGLE source of the per-intent slot; the table above is the human-readable expectation the test asserts.

### 5.3 Deterministic ordering algorithm (🔒 LOCKED)

Replace `index.ts:741-746` with `buildDeterministicComboList(typeDef, batchSeed, limit)`:

```
function buildDeterministicComboList(typeDef, batchSeed, limit): string[][] {
  const combos = typeDef.combos;                  // FROZEN order from EXPERIENCE_TYPES
  const slotIdx = mainActivitySlotIndex(typeDef);

  // Picnic / no-rotation: deterministic single-combo repeat to limit*2.
  if (slotIdx < 0 || combos.length <= 1) {
    const out = [];
    while (out.length < limit * 2) out.push(...combos);   // combos has 1 entry for picnic
    return out;
  }

  // 1. Group combos by main-activity slug, preserving FIRST-appearance order of slugs.
  const groupOrder = [];                          // ordered distinct slugs
  const groups = new Map();                       // slug -> combos[] (in EXPERIENCE_TYPES order)
  for (const c of combos) {
    const slug = c[slotIdx];
    if (!groups.has(slug)) { groups.set(slug, []); groupOrder.push(slug); }
    groups.get(slug).push(c);
  }
  // Within each group, combos retain their EXPERIENCE_TYPES order (quality proxy:
  // the combo table is authored best-first; this is the deterministic "descend
  // quality" axis at combo granularity). Do NOT sort by a runtime score — the
  // per-card quality descent is delivered by globalUsedPlaceIds (anchor best->2nd)
  // + PART 1A blend, NOT by reordering combos at runtime.

  // 2. Deterministic rotation offset from batchSeed (NO Math.random).
  const startOffset = ((batchSeed % groupOrder.length) + groupOrder.length) % groupOrder.length;

  // 3. Round-robin across groups, starting at startOffset, cycling group order,
  //    pulling one combo per group per pass (so the MAIN ACTIVITY rotates card-to-card),
  //    descending within each group as passes advance.
  const out = [];
  const cursors = new Map(groupOrder.map(s => [s, 0]));
  let exhaustedGuard = 0;
  while (out.length < limit * 2) {
    let pushedThisCycle = 0;
    for (let k = 0; k < groupOrder.length; k++) {
      const slug = groupOrder[(startOffset + k) % groupOrder.length];
      const arr = groups.get(slug);
      const cur = cursors.get(slug);
      if (cur < arr.length) { out.push(arr[cur]); cursors.set(slug, cur + 1); pushedThisCycle++; }
      if (out.length >= limit * 2) break;
    }
    // When every group is exhausted, reset cursors to repeat the full deterministic
    // sequence (mirrors today's "repeat shuffle to limit*2" behavior) — still no randomness.
    if (pushedThisCycle === 0) {
      for (const s of groupOrder) cursors.set(s, 0);
      if (++exhaustedGuard > limit * 2) break;   // hard stop, can't happen with ≥1 combo
    }
  }
  return out;
}
```

**Why round-robin-across-groups delivers "rotate the main activity":** card 1 uses group[startOffset]'s first combo (main activity A), card 2 uses group[startOffset+1]'s first combo (main activity B), etc. — so consecutive cards show different main activities. The anchor place itself descends best→2nd→3rd across cards via the existing `globalUsedPlaceIds` accumulation (`index.ts:778/983-986`), which is untouched. Together: variety across main activity (1B) + quality descent within an activity (existing global dedup) + quality-blended companions (1A).

### 5.4 Threading `batchSeed` through (🔒 LOCKED)
`batchSeed` is destructured at `index.ts:1261` but NOT passed to `generateCardsForType` today (single call site `index.ts:1351-1356`). The implementor MUST:
1. Add `batchSeed: number` as a new parameter to `generateCardsForType` (`index.ts:651-661`), defaulting to `0`.
2. Pass `batchSeed` at the call site (`index.ts:1351-1356`).
3. Pass `batchSeed` into `buildDeterministicComboList`.

`batchSeed` is coerced to a safe integer at the top of `buildDeterministicComboList`: `const seed = Number.isFinite(batchSeed) ? Math.floor(Math.abs(batchSeed)) : 0;` (defensive — collab agg or a bad client value can't break determinism).

### 5.5 Delete the random shuffle for ordering
- `shuffle()` (`index.ts:1016-1023`) is used at `index.ts:743` and `745` for combo ordering. After PART 1B those two usages are removed. The implementor MUST re-grep `shuffle(` — if `index.ts:616` `buildCardFromStops` tagline pick (`Math.random`) or `matchScore` (`index.ts:644` `Math.random`) are the only remaining `Math.random` uses, those are **display-only, non-ordering** randomness (tagline + cosmetic match score) and are OUT OF SCOPE — do NOT touch them (they don't affect deck card identity/order, so collab determinism is unaffected; note this explicitly in the implementation report). If `shuffle()` becomes unreferenced, delete it; otherwise leave it.

### 5.6 PART 1B success criteria
- **SC-1B-1:** Combo ordering is deterministic — identical `(typeDef, batchSeed, limit)` → identical `comboList` across runs (no `Math.random` in the ordering path).
- **SC-1B-2:** Consecutive cards rotate the main activity for multi-main-activity intents (adventurous/first-date/romantic/group-fun): card N and card N+1 have different main-activity slugs while distinct activities remain.
- **SC-1B-3:** Take-a-Stroll rotates the **food** slot (`brunch`→`casual_food`→`upscale_fine_dining`) while the nature anchor descends in quality (anchor stays `nature`, place descends via global dedup).
- **SC-1B-4:** Picnic produces a deterministic single-combo list (no rotation) and the park anchor still descends best→2nd→3rd across cards.
- **SC-1B-5:** Changing `batchSeed` changes the rotation START offset deterministically (different `batchSeed` → different but reproducible first main activity).
- **SC-1B-6:** `mainActivitySlotIndex` yields the exact table in §5.2.

---

## 6. PART 2 — Apply the open-hours cascade to the solo path (via shared extraction)

### 6.1 Goal
Apply the "open during the outing" cascade INSIDE `generate-curated-experiences` so BOTH solo and collab inherit it. Extract the logic into a NEW shared module (single source of truth, Constitution #6) imported by BOTH `discover-cards` and `generate-curated-experiences`. Fix D-1 (periods-shape reader) during extraction.

### 6.2 New shared module: `supabase/functions/_shared/curatedStopHours.ts` (🔒 LOCKED contract)

Export the following, extracted from `discover-cards/index.ts` (lines cited) with the D-1 fix:

```ts
// Extracted verbatim from discover-cards/index.ts unless noted:
export function parseSingleRange(range: string): { open: number; close: number } | null  // discover-cards:150-195
export function parseHoursText(text: string): { open: number; close: number }[] | null   // discover-cards:200-214
export function hourInRanges(hour: number, ranges: {open:number;close:number}[]): boolean // discover-cards:217-219
export const CURATED_STOP_DURATION: Record<string, number>                                // discover-cards:464-478
export const ALWAYS_OPEN_TYPES: ReadonlySet<string>                                       // discover-cards:480-485
export function isStopOpenAtHour(stop, hour, dayOfWeek): boolean                          // discover-cards:487-502 + D-1 FIX
export function filterCuratedByStopHours(cards: any[], utcNow: Date): any[]               // discover-cards:504-532
const DAY_NAMES = ['sunday','monday',…]                                                   // discover-cards:221 (module-local)
```

**D-1 FIX inside `isStopOpenAtHour` (🔒 LOCKED — this is a correctness fix, not just a move):** the extracted `isStopOpenAtHour` MUST evaluate hours in this cascade (mirroring the all-shape-tolerant `filterByDateTime.isOpenAtHour` at `discover-cards/index.ts:285-335`):

1. `ALWAYS_OPEN_TYPES.has(stop.placeType)` → `true`.
2. `const oh = stop.openingHours;` if not an object → `true` (honest-unknown → assume open).
3. **Path A — canonical Google v1 `periods`:** if `Array.isArray(oh.periods) && oh.periods.length > 0` → evaluate against `periods` (open.day === dayOfWeek; openH = open.hour + open.minute/60; closeH = close.hour + close.minute/60; closeH===0→24; closeH<=openH→+24; return `hourFrac >= openH && hourFrac < closeH` for any period). **(This is the D-1 fix — today's reader skips this and falls through.)**
4. **Path B — legacy `_periods`:** same eval against `oh._periods`.
5. **Path C — text shape:** `dayText = oh[DAY_NAMES[dayOfWeek]]`; if absent → `true` (honest-unknown); `parsed = parseHoursText(dayText)`; if null ("Closed"/unparseable) → `false`; else `hourInRanges(hour, parsed)`.

The **honest-unknown rule is LOCKED**: genuinely no hours data (no periods, no `_periods`, no day text) → assume OPEN (never fabricate closed). This matches Constitution #9 in the inclusive direction the existing curated filter intends (curated cards are precious; don't drop a venue for missing data).

`filterCuratedByStopHours` is extracted byte-for-byte (`discover-cards:504-532`) — its `utcOffsetMinutes` fallback (`card.utcOffsetMinutes ?? Math.round(card.lng/15)*60`), per-stop duration accumulation, and optional-stop skip stay identical. It calls the FIXED `isStopOpenAtHour`.

### 6.3 `discover-cards/index.ts` edits
- DELETE the local `parseSingleRange`, `parseHoursText`, `hourInRanges`, `CURATED_STOP_DURATION`, `ALWAYS_OPEN_TYPES`, `isStopOpenAtHour`, `filterCuratedByStopHours` (the curated-specific copies at `147-219`, `464-532`). **CAUTION:** `parseSingleRange`/`parseHoursText`/`hourInRanges`/`DAY_NAMES`/`ALWAYS_OPEN_TYPES` are ALSO used by the NON-curated `filterByDateTime` path (`discover-cards:277-457`). The implementor MUST either (a) import them from the shared module into `discover-cards` and keep `filterByDateTime` working against the imported versions, OR (b) keep `filterByDateTime`'s own copies and extract ONLY the curated-specific `isStopOpenAtHour`/`CURATED_STOP_DURATION`/`filterCuratedByStopHours` + the shared parse helpers. **Decision (🔒 LOCKED): option (a)** — import `parseSingleRange`, `parseHoursText`, `hourInRanges`, `ALWAYS_OPEN_TYPES`, `DAY_NAMES` from the shared module and point BOTH `filterByDateTime` and the curated path at them, so there is ONE parser. Re-grep every reference before deleting. Re-run discover-cards' existing Deno tests (`orch_0903_…`, `orch_0906_…`, `orch_0909_…`, `collab_determinism_under_ai_blend`) to prove the non-curated path still passes.
- The call at `discover-cards:1363` `filterCuratedByStopHours(timeFilteredCards, curatedUtcNow)` now resolves to the shared import. UNCHANGED behavior except the D-1 fix now makes it ACTUALLY filter periods-shape rows.

### 6.4 `generate-curated-experiences/index.ts` edits — apply to solo path
After cards are assembled and BEFORE the function returns (i.e., wrap the `cards` produced inside `generateCardsForType`, or filter at the handler after `generateCardsForType` returns — **Decision (🔒 LOCKED): filter at the handler**, `index.ts:1351-1356`, right after `generateCardsForType` returns and before `console.log`/response, so the empty-summary verdict logic still sees the FINAL card set):

```
import { filterCuratedByStopHours } from '../_shared/curatedStopHours.ts';
…
let { cards, summary } = await generateCardsForType(typeDef, …, batchSeed, …);
// PART 2: open-during-outing filter — solo path inherits the same cascade collab gets.
const curatedUtcNow = datetimePref ? new Date(datetimePref) : new Date();
cards = filterCuratedByStopHours(cards, curatedUtcNow);
// If filtering emptied the deck, surface the existing empty verdict shape.
if (cards.length === 0 && !summary) {
  summary = { emptyReason: 'pool_empty', candidateAnchorCount: 0, failedAnchorCount: 0 };
}
```

**Start-time source (🔒 LOCKED):** `datetimePref ? new Date(datetimePref) : new Date()` — EXACTLY mirroring `discover-cards:1362`. Each stop's local arrival time is computed inside `filterCuratedByStopHours` using `card.utcOffsetMinutes` (already on each stop via `buildCardStop` `index.ts:568`) — the curated card's top-level `utcOffsetMinutes` is read from the FIRST stop; confirm the assembled card carries a top-level `utcOffsetMinutes` (it does NOT today — `buildCardFromStops` `index.ts:631-646` does not set a card-level `utcOffsetMinutes`/`lng`). **Therefore (🔒 LOCKED):** `filterCuratedByStopHours` currently reads `card.utcOffsetMinutes`/`card.lng` at `discover-cards:512`. For the solo path the assembled curated card must expose those. The implementor MUST add to `buildCardFromStops` (`index.ts:631-646`) a top-level `utcOffsetMinutes: mainStops[0]?.utcOffsetMinutes ?? null` and `lat`/`lng: mainStops[0]?.lat/lng ?? null` so `filterCuratedByStopHours` resolves the timezone the same way for solo as collab. (Collab cards get these from the discover-cards card shape; solo cards are built here — this closes the gap. Confirm the collab card shape that reaches `filterCuratedByStopHours` carries `utcOffsetMinutes` — it does, via the discover-cards transformer.) This is additive (new top-level fields), does NOT change stop-level data, and mobile ignores unknown top-level fields.

### 6.5 Is discover-cards' own call now redundant? (Decision — JUSTIFIED)
**No — keep both (belt-and-suspenders, 🔒 LOCKED).** The collab path (`discover-cards`) calls `filterCuratedByStopHours` AFTER its own `filterByDateTime`/`filterByDateWindows` AND on a candidate set that discover-cards assembles independently (it does NOT always go through `generate-curated-experiences` for every collab card — discover-cards has its own curated assembly + fallback paths, e.g. `fallbackToCuratedAfterSingleExhaustion` at `discover-cards:1369`). Removing the discover-cards call would drop hours-filtering on those discover-cards-native curated paths. Keeping both is idempotent (filtering an already-open card again is a no-op) and costs nothing. The solo filter added in §6.4 covers the DIRECT solo call that bypasses discover-cards entirely (`deckService.ts:570`). Both call sites now share ONE implementation.

### 6.6 PART 2 success criteria
- **SC-2-1 (the regression that proves the gap):** A solo curated card whose a stop is CLOSED at the computed arrival time is now EXCLUDED from the solo `generate-curated-experiences` response. (Today it is served — that is the bug.)
- **SC-2-2:** A solo curated card all of whose stops are open at arrival is RETAINED.
- **SC-2-3:** A stop with NO hours data (and not an always-open type) is treated as OPEN (honest-unknown) — card retained.
- **SC-2-4:** `isStopOpenAtHour` now correctly evaluates the canonical Google v1 `periods` shape (D-1 fix) — a closed periods-shape stop is detected as closed (previously false-OK).
- **SC-2-5:** Collab path behavior is preserved (discover-cards still filters; non-curated `filterByDateTime` still passes its existing tests).
- **SC-2-6:** When hours-filtering empties the solo deck, the response carries a `summary` empty verdict (mobile routes to EMPTY UI, not stuck loading).
- **SC-2-7:** Single source of truth — `parseHoursText`/`isStopOpenAtHour`/`filterCuratedByStopHours`/`CURATED_STOP_DURATION`/`ALWAYS_OPEN_TYPES` exist in exactly ONE file (`_shared/curatedStopHours.ts`); no duplicate definitions remain in `discover-cards` or `generate-curated-experiences`.

---

## 7. Preserved gates & invariants (🔒 LOCKED — MUST NOT regress)

All of the following MUST behave identically after the change. Each has a test obligation in §8.

| Gate / invariant | Location | Preservation requirement |
|---|---|---|
| `filterMin` thresholds | `signalRankFetch.ts:150-153` + RPC | Untouched — PART 1A/1B operate on already-filtered candidates. |
| G3 photo gate | `signalRankFetch.ts:342-348` | Untouched. |
| Fine-dining ≥'bougie' floor | `index.ts:876-880` | Untouched (runs in the `available` filter BEFORE selection). PART 1A only changes which of the surviving candidates is picked. |
| First-stop travel ≤ constraint×1.5 | `index.ts:933-939` | Untouched — runs after stops built; PART 1A/1B do not change the first stop. |
| Dedup (per-card `comboUsedIds` + global `globalUsedPlaceIds`) | `index.ts:778`, `805/855/905`, `941-948`, `983-986` | Untouched. PART 1A picks from `available` which is already dedup-filtered; PART 1B does not change dedup. |
| Reverse-anchor failed-anchor cycle prevention | `index.ts:757`, `787-794`, `842/850`, `923/937/946` | Untouched. PART 1A's `selectBlendedStop` returns null exactly where `selectClosestHighestRated` did → same failed-anchor marking. |
| Empty→summary verdicts | `index.ts:991-1011` | Preserved + extended for the hours-filter-emptied case (§6.4). |
| **I-COLLAB-DECK-DETERMINISM-PRESERVED-UNDER-AI-BLEND** | `INVARIANT_REGISTRY.md:127-145`; memory `[[collab-deck-determinism-contract]]` | PART 1A blend + PART 1B rotation are PURE functions of request inputs (location, batchSeed, excludePlacePoolIds, candidate set) — **no request-time `Math.random` in any ordering/selection path**. Today's `shuffle` DOES use `Math.random`; PART 1B REMOVES that nondeterminism. This is a NET IMPROVEMENT to determinism. The blend introduces no request-time randomness and no new request-time read that varies by request. |
| **I-CURATED-HOURS-VIA-CANONICAL-READER** | `INVARIANT_REGISTRY.md:36-46` | This invariant scopes `app-mobile/` (client). PART 2 is server-side and does NOT touch app-mobile, so the existing gate is unaffected. The server-side D-1 fix brings the EDGE reader to the same all-shape-tolerant standard (philosophical parity, not gate-scoped). |
| Honest-unknown / no-fabrication (Constitution #9) | `index.ts:571-575`; §6.2 | Hours-unknown → assume open (never fabricate closed); `isOpenNow` stays null when unknown. |

---

## 8. Test plan

> **Step-0.5 regression-test requirement (🔒 LOCKED):** the implementor ships a **fails-on-revert happy-path** Deno test, and the tester writes a **distinct adversarial** Deno test. Both MUST be proven to FAIL when the production change is reverted (cite the revert commit SHA in the report, per the ORCH-1019 model `INVARIANT_REGISTRY.md:44`).

Test runner: `deno test` (these edge fns already ship Deno tests — see `supabase/functions/discover-cards/__tests__/` and `supabase/functions/generate-curated-experiences/__tests__/`). Candidate paths below.

| Test | Scenario | Input | Expected | Layer | Owner |
|---|---|---|---|---|---|
| **T-1A-01** | Post-anchor pick is quality-weighted, not nearest | `available` = [{closer, low `_rankScore`+low rating}, {slightly farther, high `_rankScore`+high rating}] within radius; refLat/Lng | `selectBlendedStop` returns the FARTHER high-quality one (blend math: 0.6·Q+0.4·P favors it) | unit | implementor (happy) |
| **T-1A-02** | Pure-nearest would have lost | construct a case where nearest ≠ blended-max | returns blended-max, NOT nearest | unit | tester (adversarial) |
| **T-1A-03** | Determinism | run T-1A-01 twice | identical pick | unit | implementor |
| **T-1A-04** | Tie-break chain | two candidates equal blended score, differing `_rankScore` then rating then id | returns the `_rankScore`-then-rating-then-id winner | unit | tester (adversarial) |
| **T-1A-05** | Empty/single | `[]` → null; `[x]` → x | matches old helper | unit | implementor |
| **T-1B-MAP** | `mainActivitySlotIndex` mapping | each of the 6 typeDefs | adventurous→0, first-date→1, romantic→1, group-fun→0, take-a-stroll→1, picnic→-1 | unit | implementor (happy) |
| **T-1B-01** | Ordering deterministic | `buildDeterministicComboList(typeDef, batchSeed=7, limit=20)` twice | identical arrays; NO `Math.random` reachable | unit | implementor |
| **T-1B-02** | Main activity rotates | adventurous, limit large | consecutive entries (while distinct activities remain) have different `[slotIdx]` slug | unit | implementor |
| **T-1B-03** | Take-a-Stroll rotates FOOD while nature constant | take-a-stroll | slot index = 1 (food); entry[0]=nature constant; food slug rotates brunch→casual_food→upscale_fine_dining | unit | tester (adversarial — proves it's not rotating nature) |
| **T-1B-04** | Picnic = no rotation, single combo repeat | picnic-dates, limit=20 | every entry === `['groceries','flowers','nature']`; length ≥ limit\*2 | unit | implementor |
| **T-1B-05** | batchSeed changes start offset deterministically | adventurous, batchSeed 0 vs 1 vs 2 | different first main-activity slug, each reproducible | unit | tester (adversarial) |
| **T-1B-06** | No request-time Math.random in ordering | source-text assert: `buildDeterministicComboList` body contains no `Math.random` | passes | source-grep unit | tester |
| **T-2-01 (THE GAP)** | Solo curated card with a CLOSED stop is dropped | card with stop closed at arrival hour (periods shape) + `datetimePref` | `filterCuratedByStopHours` excludes it; on revert (no solo filter) it is RETAINED → test FAILS on revert | unit + integration | implementor (happy, fails-on-revert) |
| **T-2-02** | All-open card retained | all stops open at arrival | retained | unit | implementor |
| **T-2-03** | No-hours stop assumed open | stop with no periods/text, non-always-open type | retained (honest-unknown) | unit | tester (adversarial — proves we don't fabricate closed) |
| **T-2-04 (D-1)** | periods-shape closed stop detected | stop with `openingHours.periods` closed at hour | `isStopOpenAtHour` → false (pre-fix: false-OK true) → card dropped | unit | tester (adversarial, fails-on-revert of D-1 fix) |
| **T-2-05** | Single source of truth | source-grep: `filterCuratedByStopHours`/`isStopOpenAtHour`/`parseHoursText` defined ONLY in `_shared/curatedStopHours.ts` | no duplicate defs in discover-cards / generate-curated | source-grep unit | tester |
| **T-2-06** | discover-cards non-curated path unbroken | run existing `orch_0903`/`orch_0906`/`orch_0909`/`collab_determinism_under_ai_blend` tests | all PASS | regression | implementor |
| **T-2-07** | Empty after hours filter → summary verdict | solo response where filter empties cards | response carries `summary.emptyReason` | integration | tester |

**Candidate test file paths:**
- `supabase/functions/generate-curated-experiences/__tests__/orch_1061_blend_and_rotation.test.ts` (T-1A-\*, T-1B-\*) — implementor happy-path.
- `supabase/functions/generate-curated-experiences/__tests__/orch_1061_blend_rotation.adversarial.test.ts` (T-1A-02/04, T-1B-03/05/06) — tester adversarial.
- `supabase/functions/_shared/__tests__/curatedStopHours.test.ts` (T-2-01/02/03/05) — implementor happy-path.
- `supabase/functions/_shared/__tests__/curatedStopHours.adversarial.test.ts` (T-2-03/04) — tester adversarial.
- Reuse existing `supabase/functions/discover-cards/__tests__/*.test.ts` for T-2-06.

---

## 9. External-API-docs note (COMMS-0003)

**This ORCH introduces NO new external-API calls.** PART 1A/1B are pure arithmetic over candidate rows already fetched. PART 2 parses hours strings already stored in `place_pool.opening_hours` (internal data; the parser is internal text logic). The OpenAI prompt (`generatePicnicShoppingList` `index.ts:1071-1091`) and the `fetch_local_signal_ranked` RPC are UNCHANGED. No provider enum/payload/endpoint is introduced or modified. COMMS-0003 is satisfied by this explicit declaration. (Acked.)

---

## 10. Strict-grep / backend allowlist (COMMS-0002)

This ORCH adds NEW files under `supabase/functions/` — the ORCH-0863 C7 `no-new-backend-files` strict-grep gate will block the PR unless they are allowlisted **in the same commit**.

**Exact allowlist file:** `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`.
**Exact mechanism:** add a new block (alphabetically/numerically after the existing `ORCH_1040_BACKEND_ALLOWLIST` at `~line 372` region) and spread it into the combined allowlist array at `~line 1453-1491`:

```js
// ORCH-1061 [Curated stop variety + quality blend + solo hours gate].
// C7 is scoped to ORCH-0863 marketing; these backend touches are ORCH-1061
// scope: the extracted shared curated-hours module + its tests + the curated
// generator's new blend/rotation tests. (No migration — pure edge-fn logic.)
const ORCH_1061_BACKEND_ALLOWLIST = [
  "supabase/functions/_shared/curatedStopHours.ts",
  "supabase/functions/_shared/__tests__/curatedStopHours.test.ts",
  "supabase/functions/_shared/__tests__/curatedStopHours.adversarial.test.ts",
  "supabase/functions/generate-curated-experiences/__tests__/orch_1061_blend_and_rotation.test.ts",
  "supabase/functions/generate-curated-experiences/__tests__/orch_1061_blend_rotation.adversarial.test.ts",
];
```
…and add `...ORCH_1061_BACKEND_ALLOWLIST,` to the spread block (after `...ORCH_1040_BACKEND_ALLOWLIST,` at `index.ts`-of-the-gate `~line 1491`).

> NOTE: `generate-curated-experiences/index.ts` and `discover-cards/index.ts` are MODIFIED, not new — C7 (`no-new-backend-files`) only fires on NEW files, so the two modified `index.ts` files do NOT need allowlisting (they already exist; they appear in earlier allowlists e.g. ORCH-0902/0903). Only the 5 NEW files above need entries. The implementor MUST run the gate locally (`node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`) before pushing.

**Optional new invariant gate (🎨 OPEN to implementor judgment):** consider a small strict-grep `i-curated-hours-shared-sole-owner.mjs` asserting `filterCuratedByStopHours`/`isStopOpenAtHour` are defined ONLY in `_shared/curatedStopHours.ts` (mirrors the existing `i-curated-hours-via-canonical-reader.mjs` pattern). If added, it ALSO needs its own allowlist entry + a workflow job line. T-2-05 covers this contract via Deno test regardless, so the gate is a nice-to-have, not required. (Acked COMMS-0002.)

---

## 11. Implementation order

1. **PART 2 extraction first** — create `_shared/curatedStopHours.ts` (with D-1 fix), repoint `discover-cards` imports, delete its dupes, run discover-cards Deno tests (T-2-06) to prove the non-curated path is intact. (Lowest-risk, isolates the move.)
2. **PART 2 solo wiring** — add the `filterCuratedByStopHours` call in the `generate-curated-experiences` handler + the top-level `utcOffsetMinutes`/`lat`/`lng` on `buildCardFromStops`. Write T-2-01/02/03/07.
3. **PART 1A** — add `selectBlendedStop`, route both call sites, (delete `selectClosestHighestRated` if unreferenced). Write T-1A-\*.
4. **PART 1B** — add `mainActivitySlotIndex` + `buildDeterministicComboList`, thread `batchSeed` into `generateCardsForType`, replace the shuffle. Write T-1B-\*.
5. **Allowlist** — add `ORCH_1061_BACKEND_ALLOWLIST` block + spread (same commit). Run the gate locally.
6. **Run all Deno tests** + the discover-cards regression suite. Confirm fails-on-revert for T-2-01 (solo gap) and T-1A-01.

---

## 12. Regression prevention
- **Determinism guard:** T-1B-06 source-grep asserts no `Math.random` in the ordering path; the blend/rotation are pure functions (no I/O).
- **Single-source-of-truth guard:** T-2-05 source-grep (and optional strict-grep gate §10) prevents the hours cascade from being re-duplicated.
- **The solo-gap guard:** T-2-01 fails-on-revert — if a future change removes the solo `filterCuratedByStopHours` call, CI goes red.
- **Protective comments:** each new function carries a `// ORCH-1061:` header explaining WHY (blend over nearest; deterministic rotation off batchSeed for collab; shared hours cascade for solo+collab parity).

---

## 13. Open questions for the operator
- **OQ-1:** The 0.75/0.25 internal split of *quality* (vibe-rank vs rating×reviews) is my proposed default to keep the signal-tuned `_rankScore` dominant. The 60/40 quality-vs-proximity is operator-locked; the 75/25 internal is a SPEC choice. Confirm acceptable, or specify a different internal weighting.
- **OQ-2:** PART 1B "descend quality within a main-activity group" is delivered at COMBO granularity by the authored EXPERIENCE_TYPES order (best-first) + at PLACE granularity by the existing `globalUsedPlaceIds` best→2nd descent. I did NOT add a runtime combo re-sort by score (that would re-introduce request-coupled ordering risk and isn't needed since place-level descent already happens). Confirm this interpretation of "descends quality" matches intent.
- **OQ-3 (D-1):** I am fixing the latent collab periods-shape reader bug (D-1) inside the extraction because shipping a known-broken reader to the solo path would be malpractice. This slightly widens PART 2 beyond a pure move. Confirm you want the fix included (recommended) vs. extract-as-is + separate follow-up ORCH for D-1.

---

## 14. /goal self-assessment (SPEC completion predicate)

1. **Functional contract complete for every touched layer** — YES. Edge fn (both branches, handler, card builder), new shared module (full export contract + D-1 fix cascade), discover-cards edits, allowlist. No DB/RLS/hook/component layer touched (server-only; declared). ✓
2. **UI visual/UX contract** — N/A: zero UI surface touched (server-only payload change; mobile renders unchanged payload shape). Cross-Surface §3 declares this explicitly; no `mingla-designer` pass required. ✓
3. **No-AI-slop / References examined** — N/A (no UI). ✓
4. **Every requirement tagged 🔒/🎨** — formulas, rotation algorithm, slot resolver, hours cascade, start-time source, belt-and-suspenders decision are 🔒 LOCKED; the optional strict-grep gate + adversarial-test creativity are 🎨 OPEN. ✓
5. **Cross-Surface §3 present; SCs observable/testable/unambiguous** — YES (SC-1A-\*, SC-1B-\*, SC-2-\*). Parity automatic (shared edge fn). ✓
6. **Invariants named; happy/error/edge tests per criterion; impl order; regression prevention** — YES (§7, §8, §11, §12). ✓
7. **Zero hand-wave** — formulas are explicit arithmetic; rotation is full pseudocode; hours cascade is a 5-path explicit ladder. ✓

**Bounded:** NO combo expansion; NO migration; NO client code; NO new external API; 1 new shared file + 2 modified edge fns + tests + 1 allowlist block. **Complete:** all three parts + the latent D-1 fix + every preserved gate enumerated with a test obligation. Confidence: HIGH (every cite re-read in-worktree; the only judgment calls are surfaced as OQ-1/2/3).
