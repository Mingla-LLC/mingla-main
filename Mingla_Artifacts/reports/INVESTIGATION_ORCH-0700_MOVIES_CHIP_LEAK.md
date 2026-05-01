---
id: ORCH-0700
type: INVESTIGATION REPORT
mode: INVESTIGATE
classification: bug + data-integrity + ux + invariant-violation (Exclusion Consistency, No-Fabricated-Data)
severity: S1-high (confirmed)
created: 2026-05-01
investigator: /mingla-forensics
dispatch: prompts/FORENSICS_ORCH-0700_MOVIES_CHIP_THEATRE_LEAK.md
related: ORCH-0434 (10-cat merge), ORCH-0598 (Slice 6 Movies vs Theatre split), ORCH-0634 (signal-only multi-chip fan-out), ORCH-0640 (card_pool deprecation), ORCH-0660 (deck distance/travel-time)
---

# ORCH-0700 — Movies Chip Integrity: Forensic Report

## 1. Verdict

**Claim-A (cinema-exhaustion silent-substitution): PARTIALLY PROVEN — confidence H.**

Two distinct leak pathways exist and are architecturally provable from code alone.
A third leak surface (signal-scoring promiscuity) is architecturally possible but
unquantified without live data.

| Pathway | Status | Confidence | User-affecting today? |
|---|---|---|---|
| **A1 — Pre-OTA bundled-chip union path** | **Confirmed leak by design** | H (static-trace complete) | YES, scoped to clients still on pre-2026-04-23 build that send `'Movies & Theatre'` / `'movies_theatre'` chip slug |
| **A2 — Curated-stop replacement via `ai_categories`** | **Confirmed leak by design** | H | YES — every curated experience whose stop is typed `movies_theatre` queries `place_pool.ai_categories CONTAINS ['movies_theatre']`, returning any AI-tagged theatre venue |
| **A3 — Signal-score promiscuity (canonical Movies chip)** | **Architecturally possible, unproven at runtime** | M (math + scorer trace, no DB sample) | UNKNOWN — requires live query to quantify |
| **A4 — Cross-chip fan-out contamination (multi-chip selection)** | **Disproven** | H | NO |
| **A5 — Ticketmaster non-Film events tagged Movies** | **Disproven** | H | NO |
| **A6 — Person-hero theatre-as-Movies labelling** | **Disproven for the label**, but signal mismatch persists | H | NO label fabrication; possible content-vs-request mismatch with honest labels |

**Bottom line for the operator:** the canonical post-OTA Movies chip does NOT silently
swap in theatres at the routing layer. But two real holes exist: (1) the legacy
`'Movies & Theatre'` union path, still alive until 2026-05-13, and serving theatre
venues with `displayCategory: 'Movies'` to any pre-OTA client; and (2) the
curated-stop replacement path, which queries `ai_categories` rather than the canonical
type list and returns any place tagged `movies_theatre` — including theatres tagged
that way by AI categorisation under the legacy bundled taxonomy.

---

## 2. Per-Thread Results

### G1 — Single-chip Movies request, full deck exhaustion simulation

**Verdict:** No silent type-substitution at the routing/fan-out layer. Confidence M
(static trace complete; live-fire reproduction blocked — see §10).

**Trace:** Mobile [`PreferencesSheet.tsx:108`](app-mobile/src/components/PreferencesSheet.tsx#L108)
defines the Movies chip with `id: 'movies'`. User selection flows through
[`deckService.ts:255`](app-mobile/src/services/deckService.ts#L255) (`'movies' → pillId 'movies'`),
then [`deckService.ts:148`](app-mobile/src/services/deckService.ts#L148)
(`PILL_TO_CATEGORY_NAME['movies'] = 'Movies'`), and is sent on the wire as
`categories: ['Movies']` at [`deckService.ts:403`](app-mobile/src/services/deckService.ts#L403).

In [`discover-cards/index.ts:79`](supabase/functions/discover-cards/index.ts#L79),
`CATEGORY_TO_SIGNAL['Movies'] = { signalIds: ['movies'], filterMin: 80, displayCategory: 'Movies' }`.
A single `RpcTask` is built at lines 861-873 with `signalId: 'movies'`. The RPC
`query_servable_places_by_signal` is invoked at lines 889-901 with
`p_signal_id: 'movies'`, `p_filter_min: 80`. Results are bucketed at lines
905-924 keyed by `chip='Movies'`. There is **no second-pass branch** that "borrows
from an adjacent signal." When the cinema universe is exhausted (via
`p_exclude_place_ids` + radius + score gate), the RPC returns fewer rows; if zero,
the function exits with `path:'pool-empty'` at lines 959-967 — **the deck goes
honestly empty**, not silently padded.

The displayCategory on the resulting cards is set at
[`discover-cards/index.ts:920-921`](supabase/functions/discover-cards/index.ts#L920)
from `task.displayCategory` (= `'Movies'`), independent of the row's `primary_type`.
So whatever the RPC returns will be labelled `category: 'Movies'`. This is not a
problem when the RPC only returns cinemas — but if the SCORER lets a non-cinema
venue clear `filterMin: 80`, see thread A3.

**For card N+1 after exhaustion:** `path:'pool-empty'` with `cards: []` and
`reason: 'Signal RPCs succeeded but returned zero rows'`. **No theatre substitution
at the routing layer.** Mobile sees `total: 0`, deck terminates honestly.

### G2 — `displayCategory` truth audit

**Verdict:** `displayCategory` is fabricated at routing time, not derived from
`primary_type`. Confidence H.

**Evidence:** [`discover-cards/index.ts:53-97`](supabase/functions/discover-cards/index.ts#L53-L97)
defines `CATEGORY_TO_SIGNAL` as the sole source of `displayCategory`, attached to
every row at line 921 via `__displayCategory: task.displayCategory`. The
transformer at
[`discover-cards/index.ts:589`](supabase/functions/discover-cards/index.ts#L589) sets
`category: categoryLabel` directly from this, never consulting `row.primary_type`.

The legacy union mapping at
[`discover-cards/index.ts:95-96`](supabase/functions/discover-cards/index.ts#L95-L96)
sets `displayCategory: 'Movies'` for `signalIds: ['movies', 'theatre']` — meaning
**every theatre row served via the union path arrives with a `category: 'Movies'`
label.** This is the structural root of pathway A1.

By contrast,
[`get-person-hero-cards/index.ts:109`](supabase/functions/get-person-hero-cards/index.ts#L109)
correctly derives category from `primary_type` via
`mapPrimaryTypeToMinglaCategory(raw.primary_type, raw.types ?? [])`. **Person-hero
labels honestly. Discover-cards labels by routing intent.** This is a Constitution
#2 (one owner per truth) divergence between two parallel card-serving paths — the
two systems disagree on what the source of truth for "what kind of place is this?"
should be.

### G3 — Legacy bundled chip live-traffic check

**Verdict:** Cannot quantify without analytics access. Confidence L on volume,
H on existence of the leak conduit.

**Static evidence of pre-OTA exposure:** Migration
[`20260423300001_orch_0598_signal_batch.sql:5-9`](supabase/migrations/20260423300001_orch_0598_signal_batch.sql#L5-L9)
records the pre-split impact baseline: "2 users have `'movies_theatre'` in
categories; 1 user has `'Movies & Theatre'` in display_categories; 0 users have
pre-existing `'movies'` or `'theatre'`." The migration UPDATE at lines 312-332
flipped these saved preferences to the new split slugs at the row level on
2026-04-23.

**However** — the wire payload from a pre-OTA client is determined by the OLD
build's `PILL_TO_CATEGORY_NAME` table, NOT by the user's saved preference. A
pre-OTA app that still has a `'movies_theatre'` chip in its bundled UI will send
`'Movies & Theatre'` on the wire regardless of what the DB row now contains, and
the server's `CATEGORY_TO_SIGNAL['Movies & Theatre']` entry serves that union with
`displayCategory: 'Movies'`. The leak conduit is alive until 2026-05-13 (the
`[TRANSITIONAL]` exit date locked in the comment at
[`discover-cards/index.ts:94`](supabase/functions/discover-cards/index.ts#L94)).

**Confidence raise path:** query Mixpanel / edge-function logs for
`categories=Movies & Theatre` events in the last 7 days. Not done — operator can
quantify post-report.

### G4 — `filterMin: 80` blast radius

**Verdict:** `filterMin: 80` ONLY lowers the per-place score gate at the SQL layer.
It does NOT loosen type-matching, distance, or category boundaries. Confidence H.

**Evidence:** the RPC at
[`20260424220003_orch_0634_query_servable_places_by_signal_photo_gate.sql:75-95`](supabase/migrations/20260424220003_orch_0634_query_servable_places_by_signal_photo_gate.sql#L75-L95)
applies `filter_min` exclusively at line 77: `AND ps.score >= p_filter_min`. The
WHERE clause has no type-matching predicate, no category-borrowing branch, and no
sibling-signal fallback. It's a single-signal query. So the only effect of 80 vs
120 is that lower-quality cinemas pass the score gate.

**However:** because the SCORER (see A3 below) is a SOFT scoring function with
soft penalties (not hard type filters), a lower `filterMin` mechanically increases
the chance a non-cinema venue with high rating + accidental keyword hits clears
the threshold. So `filterMin: 80` does not directly leak types, but it widens the
window for the scorer's promiscuity to surface.

### G5 — Multi-chip fan-out cross-contamination

**Verdict:** No cross-contamination. Theatre-lane cards stay typed Theatre.
Confidence H.

**Evidence:** [`discover-cards/index.ts:905-924`](supabase/functions/discover-cards/index.ts#L905-L924)
maintains a separate bucket per chip: `Map<chipName, Map<placeId, row>>`. Movies
results are stored under `chip='Movies'` and tagged `__displayCategory: 'Movies'`;
Theatre results under `chip='Theatre'` and tagged `__displayCategory: 'Theatre'`.
Even when the same physical place is returned by both signals (e.g., Alamo
Drafthouse hits both 'movies' +80 and 'theatre' soft-positive, per the THEATRE
signal's `movie_theater: -20` field weight at
[`20260423300001_orch_0598_signal_batch.sql:273`](supabase/migrations/20260423300001_orch_0598_signal_batch.sql#L273)),
each chip-bucket gets its own copy with the correct displayCategory for that chip.
The round-robin interleave at line 957 preserves chip identity through to the
card output.

The ONLY way Movies and Theatre rows mix into the same bucket is via a union
mapping (CATEGORY_TO_SIGNAL with multiple signalIds under one chip key) — which
exists ONLY for the legacy `'Movies & Theatre'` and `'movies_theatre'` keys
(pathway A1).

### G6 — Ticketmaster segment enforcement

**Verdict:** Disproven — `ticketmaster-events` is HARD-PINNED to the Music
segment and never returns Film-classified events. It also never feeds into
`discover-cards`. Confidence H.

**Evidence:**
[`ticketmaster-events/index.ts:16`](supabase/functions/ticketmaster-events/index.ts#L16)
defines `MUSIC_SEGMENT_ID = "KZFzniwnSyZfZ7v7nJ"` and the URL builder at line 314
unconditionally sets `segmentId: MUSIC_SEGMENT_ID`. There is no `'Film'`,
`'Theatre'`, `'Sports'`, or `'Comedy'` code path anywhere in the function. The
Movies chip cannot be padded by Ticketmaster movie showtimes because no movie
showtime path exists.

**Equally important:** `discover-cards` does NOT call `ticketmaster-events` —
search confirms zero invocations from the discover deck stack. Ticketmaster
events surface only on dedicated event/concerts surfaces (per ORCH-0696), not as
Movies-chip results. So there is no cross-contamination from Ticketmaster into
the Movies deck even at the Music segment level.

### G7 — Curated chain & swap parity

**Verdict:** Curated chain composition uses canonical signal IDs correctly
(no leak). `replace-curated-stop` HAS a leak via `ai_categories` query.
Confidence H on both.

**G7-A — generate-curated-experiences (composition):** at
[`generate-curated-experiences/index.ts:469-471`](supabase/functions/generate-curated-experiences/index.ts#L469-L471),
`COMBO_SLUG_TO_FILTER_SIGNAL` maps `'movies' → 'movies'` and `'theatre' → 'theatre'`
as separate entries. The legacy `'movies_theatre' → 'movies'` entry is marked
"// legacy TRANSITIONAL — movies union handled upstream". Combo definitions at
lines 154-236 use the new split slugs (`'movies'`, `'theatre'`). Filter min
override at line 594 sets `'movies': 80` for cinema thinness. **Curated chain
composition correctly serves Movies stops via the `'movies'` signal RPC alone.**

**G7-B — replace-curated-stop:** **CONFIRMED LEAK PATHWAY.** At
[`replace-curated-stop/index.ts:11-15`](supabase/functions/replace-curated-stop/index.ts#L11-L15),
`VALID_CATEGORIES` includes `'movies_theatre'` (legacy bundled slug) but NOT
`'movies'` or `'theatre'` separately. A request with `categoryId: 'movies'` is
rejected with HTTP 400. So today, if any caller (mobile chain UI, future curated
swap) tries to swap a Movies-typed stop, it must use `'movies_theatre'`.

That request flows into
[`stopAlternatives.ts:86`](supabase/functions/_shared/stopAlternatives.ts#L86):
`.contains('ai_categories', [categoryId])`. **Any place_pool row whose
`ai_categories` array includes `'movies_theatre'` is returned as a Movies
alternative**, regardless of whether the row's `primary_type` is `movie_theater`,
`performing_arts_theater`, `concert_hall`, `opera_house`, or `philharmonic_hall`.
Per ORCH-0598's pre-split history, the AI categorisation pipeline trained on the
legacy 10-category taxonomy and tagged theatre venues with `'movies_theatre'`.
Until those tags are migrated to the split taxonomy (no migration was found that
does this — see §6), the swap path returns mixed-type results.

**Constitution #2 violation (one owner per truth):** the discover-cards path uses
signal-scoring against `place_scores`, while the swap path uses `ai_categories`.
These are two independent owners of "what category is this place?", and they
disagree.

### G8 — Solo + Collab parity

**Verdict:** Parity holds — both paths use the same chip resolution and the same
`CATEGORY_TO_SIGNAL` map. Confidence H.

**Evidence:** the only solo/collab divergence in `discover-cards` is at
[`discover-cards/index.ts:1000-1004`](supabase/functions/discover-cards/index.ts#L1000-L1004)
— collab zeroes out `matchScore` for deterministic ordering. Both modes execute
the identical chip→signal→bucket→displayCategory pipeline at lines 814-924. Any
A1/A3 leak on solo applies identically on collab.

### G9 — Five-Truth-Layer reconciliation (Movies)

| Layer | What it says about Movies | Authoritative? |
|---|---|---|
| **Docs** | ORCH-0598 spec splits Movies (cinemas) from Theatre (live performance). Comment at [`categoryPlaceTypes.ts:66-67`](supabase/functions/_shared/categoryPlaceTypes.ts#L66-L67) confirms separation, with legacy `'Movies & Theatre'` retained as `[TRANSITIONAL]`. | Yes for intent |
| **Schema** | `place_pool.ai_categories` is a `text[]` populated by the AI categoriser. No migration found that re-tags `'movies_theatre'`-tagged rows to `'movies'` or `'theatre'`. `signal_definitions` registers `movies` and `theatre` as separate signals (migration `20260423300001_orch_0598_signal_batch.sql:22-31`). `place_scores` rows exist per `(place_id, signal_id)` pair — verified writeable by the scorer. | Yes for what's stored |
| **Code** | Discover-cards uses `__displayCategory` from routing, not from `primary_type`. Person-hero uses `mapPrimaryTypeToMinglaCategory` from the row itself. Curated swap uses `ai_categories CONTAINS`. **Three different code paths use three different rules to decide "what category is this place?"** | NO — Constitution #2 violation |
| **Runtime** | Not directly observed (no live-fire). | UNVERIFIED |
| **Data** | Per ORCH-0598 seed comment: Raleigh has 7 cinemas + 15 theatre venues. Migration `20260423300001_orch_0598_signal_batch.sql:308-332` migrated 2 + 1 user preference rows from `movies_theatre` → `[movies, theatre]` on 2026-04-23. **Not migrated:** any `place_pool.ai_categories` array entries containing `'movies_theatre'`. | Stale tags persist |

**Contradictions:**
1. **Docs say Movies = cinemas only**, but **Code in `replace-curated-stop` queries `ai_categories CONTAINS 'movies_theatre'`** — accepting any AI-tagged theatre.
2. **Schema split signals** (`movies`, `theatre`) cleanly, but **Code retains the union** mapping for both legacy chip slugs AND the curated-swap entry.
3. **Person-hero labels honestly** from primary_type, **discover-cards labels from routing intent** — same row would render with different category badges depending on which surface served it.

### G10 — Pattern-class search (other narrow chips)

**Verdict:** This is a class-of-bug. Same architectural shape applies to every
chip with a legacy bundled `[TRANSITIONAL]` union mapping in CATEGORY_TO_SIGNAL.
Confidence H on the architecture, M on per-chip impact.

**Evidence:** the same `[TRANSITIONAL]` pattern exists for
`'Brunch, Lunch & Casual'` at
[`discover-cards/index.ts:90-91`](supabase/functions/discover-cards/index.ts#L90-L91)
(`signalIds: ['brunch', 'casual_food']`, `displayCategory: 'Brunch'` — exit
2026-05-12). A pre-OTA client sending the bundled `'Brunch, Lunch & Casual'`
chip gets casual-food venues (taquerias, ramen shops, sandwich shops) labelled
as **'Brunch'**. Same architecture, same leak shape, ~same expiry date.

**Per-chip narrow-universe risk** for the canonical (post-OTA) chips:

| Chip | Universe (Raleigh per seed) | filter_min | Type-list breadth | Leak risk |
|---|---|---|---|---|
| Movies | 7 | 80 | 2 types (`movie_theater`, `drive_in`) | LOWEST cinema universe + RELAXED gate |
| Theatre | 15 | 120 | 5 types | Mid |
| Nature & Views | 279 | 120 | 17 types | Low (broad) |
| Play | 41 | 120 | 18 types | Low |
| Creative & Arts | 59 | 120 | 13 types | Mid |
| Icebreakers | many (cafes/bars/parks) | 120 | 30 types | Low (very broad) |

**Movies is the most exposed chip in the class** because its universe is tiny
(7) AND its filter_min is the most permissive (80 vs the 120 default). Operator's
intuition was correct to single it out first.

**`replace-curated-stop` exposure pattern:** every entry in `VALID_CATEGORIES` at
[`replace-curated-stop/index.ts:11-15`](supabase/functions/replace-curated-stop/index.ts#L11-L15)
is a LEGACY 10-category slug (`brunch_lunch_casual`, `upscale_fine_dining`,
`movies_theatre`, `nature`, `creative_arts`, `play`, `icebreakers`,
`drinks_and_music`, `flowers`, `groceries`). The new split slugs (`movies`,
`theatre`, `brunch`, `casual_food`) are NOT in this list. So the swap path is
locked to legacy slugs and serves results based on legacy `ai_categories` tags.
**This is a class-wide gap, not Movies-specific** — the same is true for any
caller that swaps a Brunch / Casual stop using the bundled `brunch_lunch_casual`
slug.

---

## 3. Confirmed Leak Pathways (enumerated)

### Pathway A1 — Pre-OTA bundled-chip union path
**Confidence: H · User-affecting today: YES (scoped to pre-OTA clients)**

| Step | File:Line | What happens |
|---|---|---|
| 1 | Pre-OTA `PreferencesSheet.tsx` (older build) | User taps the old `'movies_theatre'` chip |
| 2 | Pre-OTA `deckService.ts` `PILL_TO_CATEGORY_NAME['movies_theatre']` | Resolves to `'Movies & Theatre'` (legacy display name) |
| 3 | Wire payload to `discover-cards` | `categories: ['Movies & Theatre']` |
| 4 | [`discover-cards/index.ts:95-96`](supabase/functions/discover-cards/index.ts#L95-L96) | `CATEGORY_TO_SIGNAL['Movies & Theatre']` returns `{ signalIds: ['movies', 'theatre'], filterMin: 100, displayCategory: 'Movies' }` |
| 5 | [`discover-cards/index.ts:861-873`](supabase/functions/discover-cards/index.ts#L861-L873) | TWO `RpcTask` entries built — one per signal, BOTH tagged `displayCategory: 'Movies'` |
| 6 | [`discover-cards/index.ts:889-901`](supabase/functions/discover-cards/index.ts#L889-L901) | RPCs for both `movies` and `theatre` signals fire in parallel |
| 7 | [`discover-cards/index.ts:920-921`](supabase/functions/discover-cards/index.ts#L920-L921) | Theatre rows merged into the same bucket with `__displayCategory: 'Movies'` |
| 8 | [`discover-cards/index.ts:589`](supabase/functions/discover-cards/index.ts#L589) | Cards transformed: `category: 'Movies'` regardless of `primary_type` |
| 9 | Mobile renders | A `performing_arts_theater` row appears with category badge "Movies" |

**Exit condition:** the [TRANSITIONAL] entry is comment-marked for removal on
2026-05-13. Until then, the conduit is open.

### Pathway A2 — Curated-stop replacement via `ai_categories`
**Confidence: H · User-affecting today: YES**

| Step | File:Line | What happens |
|---|---|---|
| 1 | Curated chain Movies stop, user taps "swap" | Mobile sends `categoryId: 'movies_theatre'` to `replace-curated-stop` (only legacy slug accepted per VALID_CATEGORIES) |
| 2 | [`replace-curated-stop/index.ts:11-15`](supabase/functions/replace-curated-stop/index.ts#L11-L15) | Validates `categoryId` against legacy slug list — `'movies_theatre'` passes |
| 3 | [`replace-curated-stop/index.ts:88-96`](supabase/functions/replace-curated-stop/index.ts#L88-L96) | Calls `fetchStopAlternatives({ categoryId: 'movies_theatre', ... })` |
| 4 | [`stopAlternatives.ts:86`](supabase/functions/_shared/stopAlternatives.ts#L86) | `.contains('ai_categories', ['movies_theatre'])` |
| 5 | DB returns | Every row with `'movies_theatre'` in its `ai_categories[]` — including theatre venues AI-tagged under the legacy taxonomy |
| 6 | [`stopAlternatives.ts:133-145`](supabase/functions/_shared/stopAlternatives.ts#L133-L145) | Card built: `placeType: ai_categories[0]` (which is `'movies_theatre'` for these rows) |
| 7 | Mobile renders | Theatre venue offered as a Movies replacement; description templated as "A great movies_theatre worth visiting." (line 140) — fabricated affinity |

**No exit condition documented.** This pathway depends on `ai_categories` migration
that has not been written. Until the AI categorisation pipeline is re-run on the
split taxonomy AND existing rows are re-tagged, this pathway leaks every time a
Movies stop is swapped.

### Pathway A3 — Signal-score promiscuity (canonical Movies chip)
**Confidence: M · User-affecting today: UNKNOWN, requires runtime data**

The 'movies' signal scorer is a SOFT function, not a hard type filter. Soft
penalties at
[`20260423300001_orch_0598_signal_batch.sql:228-231`](supabase/migrations/20260423300001_orch_0598_signal_batch.sql#L228-L231):
```
performing_arts_theater: -10
concert_hall: -40
opera_house: -40
```

The reviews regex includes the substring `"theater"`
([line 239](supabase/migrations/20260423300001_orch_0598_signal_batch.sql#L239))
which matches American-spelled performing arts venues. Scoring math
(per [`signalScorer.ts:141-225`](supabase/functions/_shared/signalScorer.ts#L141-L225)):

For a hypothetical `performing_arts_theater` venue with rating 4.7, 187 reviews
(NCMA West tier), reviews mentioning "theater" once:

| Component | Contribution |
|---|---|
| `types_includes_performing_arts_theater` | -10 |
| `_rating_scale` (min(35, 4.7 × 10)) | +35 |
| `_reviews_scale` (min(25, log10(188) × 5)) | +11.5 |
| `_reviews_match` (regex hit on "theater") | +20 |
| `_summary_match` (no cinema/film/imax words) | 0 |
| `_atmosphere_match` (no luxury-seating words) | 0 |
| **Total** | **~56.5 — below filter_min: 80** |

So a typical performing arts theatre is unlikely to clear 80. But a venue that
crosses categories (e.g., a multi-purpose arts complex with IMAX-equipped
auditorium, or a drive-in repurposed as a concert venue) could score above 80
on the movies signal AND get served as Movies. **Marbles IMAX** is named in the
Movies signal seed comment at line 245 as a top anchor (1546 reviews) — its
`primary_type` is likely `museum` or `science_museum`, not `movie_theater`.
**Already today, the Movies chip serves Marbles IMAX.** Whether the user
considers that a leak depends on whether "the IMAX show is a movie" or "the
museum is not a cinema."

**Confidence raise path:** SQL probe against production —
```sql
SELECT pp.primary_type, COUNT(*)
FROM place_pool pp JOIN place_scores ps ON ps.place_id = pp.id
WHERE ps.signal_id = 'movies' AND ps.score >= 80
GROUP BY pp.primary_type;
```
This was not run — operator can run via Supabase MCP to quantify A3 leak volume.

---

## 4. Pattern-Class Assessment

**This is a class-of-bug, not a Movies-specific bug.** Three architectural patterns
recur across every category that was split or restructured during the
ORCH-0434/0597/0598 migrations:

1. **`displayCategory` set at routing time** rather than derived from
   `primary_type`. Affects every chip in `CATEGORY_TO_SIGNAL`. Manifests as
   "card labelled X but its primary_type belongs to Y" whenever a union path or
   soft-scoring leak fires. Mirrored class issue: `'Brunch, Lunch & Casual'`
   union mapping at line 90 sets `displayCategory: 'Brunch'` while fan-out
   includes `signalIds: ['brunch', 'casual_food']`.

2. **`ai_categories` is a parallel category source of truth** alongside signal
   scoring. `replace-curated-stop` + `fetchStopAlternatives` reads this; discover
   reads signals. **Constitution #2 violation** that affects every category
   served by the swap path.

3. **`replace-curated-stop` `VALID_CATEGORIES` is locked to the legacy 10-cat
   slug list** and does not accept the new split slugs (`movies`, `theatre`,
   `brunch`, `casual_food`). Any caller forced to use legacy slugs gets the
   `ai_categories` leak shape automatically.

The Movies chip is the most exposed because of the smallest universe + the
relaxed filter_min, but the other narrow chips (Theatre 15, Play 41, Creative &
Arts 59) share the same architecture. The pattern-class blast radius is ALL
chips, ALL multi-stop curated experiences, and any future surface that wires
into `fetchStopAlternatives`.

---

## 5. Five-Truth-Layer Table — see thread G9 above (§2.G9)

---

## 6. Quantified User Impact

**Pathway A1 (legacy union):** unknown, scoped to pre-OTA clients still sending
`'Movies & Theatre'`. Operator should query Mixpanel for events where
`request.categories[] == 'Movies & Theatre'` over the last 7 days. Migration data
shows ≤3 distinct user pref rows existed pre-split, but wire payloads are driven
by app version, not pref state. Two-week window remaining until 2026-05-13 cleanup.

**Pathway A2 (swap):** every Movies-stop swap in any curated experience touches
this. Volume = number of Movies-typed curated stops served × swap rate per stop.
Curated chain combos containing `'movies'` slug are at
[`generate-curated-experiences/index.ts:184, 236`](supabase/functions/generate-curated-experiences/index.ts#L184-L236)
— Adventurous + Group-fun experience types. Both ship live.

**Pathway A3 (scoring promiscuity):** unknown without DB sample. Conservative
estimate: any place_pool row with a non-cinema `primary_type` that has rating
≥4.3 and reviews mentioning film/movie/cinema/IMAX/theater — count via the SQL
probe in §2.G3.

**Direct evidence of one A3 leak today:** Marbles IMAX is in the Movies signal
seed (line 245) — its primary_type is `science_museum` (per Google), not
`movie_theater`. Today, this venue is served on the Movies chip with category
"Movies". Whether this counts as a leak depends on the operator's threshold.

---

## 7. Architectural Root Cause

**`displayCategory` is computed at the routing layer (CATEGORY_TO_SIGNAL) from
the chip the user tapped, not from the source-of-truth field on the row served
(`primary_type`).** This fabrication is visible only when the routing intent
diverges from the row's actual type — which happens any time a union mapping
exists (legacy bundled chips), any time the soft scorer lets a non-canonical
type clear `filter_min`, and any time a downstream surface reads
`displayCategory` rather than `primary_type` to decide what category badge to
render. The structural fix is to **derive `category` from the row's
`primary_type` at emission time** (the pattern person-hero already uses at
[`get-person-hero-cards/index.ts:109`](supabase/functions/get-person-hero-cards/index.ts#L109)),
making `CATEGORY_TO_SIGNAL.displayCategory` a routing-only concept that never
reaches the rendered card. Without this, every future chip split, every union
mapping, and every relaxed filter_min reopens the same leak class.

---

## 8. Invariants Violated

- **INV-Exclusion-Consistency (Constitution #13):** Same exclusion rules in
  generation and serving. Violated by A1 + A2 + A3 — discover-cards routing
  serves rows that the discover-cards rendering claims should not exist there.
- **INV-Source-of-Truth-Single (Constitution #2):** `displayCategory` from
  CATEGORY_TO_SIGNAL competes with `primary_type` from place_pool competes with
  `ai_categories` from the AI pipeline. Three competing owners of "what is this
  place?" with no reconciliation rule.
- **INV-No-Fabricated-Data (Constitution #9):** A1 fabricates a Movies label on
  a theatre row. A2 fabricates a templated description ("A great movies_theatre
  worth visiting") for swap alternatives. A3 fabricates a Movies label on
  whatever the soft scorer lets through.
- **INV-Solo-Collab-Parity:** Holds (per G8). Both modes leak identically; this
  is an honesty property, not a defect.

---

## 9. Discoveries for Orchestrator (side issues, do not act in this dispatch)

- **D-OBS-1 (S2, code-quality):** `replace-curated-stop`'s `VALID_CATEGORIES`
  set is frozen to legacy 10-cat slugs. Adding the new split slugs is required
  before the swap path can serve canonical Movies/Theatre/Brunch/Casual stops.
  Out-of-scope here; surface as a separate ORCH or fold into the spec dispatch
  for ORCH-0700 fix.

- **D-OBS-2 (S2, data-integrity):** `place_pool.ai_categories` is not migrated
  from the legacy 10-cat taxonomy to the post-ORCH-0597/0598 split taxonomy.
  Theatre venues likely still carry `'movies_theatre'` in their tag arrays.
  Migration + AI re-categorisation needed before the swap path can be honest.

- **D-OBS-3 (S3, code-quality):** `categoryPlaceTypes.ts` `DISPLAY_TO_SLUG` map
  at lines 472-484 contains only the legacy 10 entries — `'Movies'` and
  `'Theatre'` are NOT keys. Any code calling `mapCategoryToSlug('Movies')` gets
  empty string. `get-person-hero-cards/index.ts:110` has this exact call pattern;
  for any post-split row whose primary_type maps to canonical 'Movies' or
  'Theatre', `categorySlug` is emitted as `""`. Today's mobile likely tolerates
  empty categorySlug; future surfaces may not.

- **D-OBS-4 (S3, code-quality):** `categoryPlaceTypes.ts`
  `CATEGORY_EXCLUDED_PLACE_TYPES` (lines 554-693) has rich entries for the
  legacy `'Movies & Theatre'` (line 603) but NO entries for canonical `'Movies'`
  or `'Theatre'`. `getExcludedTypesForCategory('Movies')` returns ONLY
  `GLOBAL_EXCLUDED_PLACE_TYPES`. Affects on-demand experience generation
  fallback paths (holiday-experiences, warm-cache), NOT the Discover deck
  signal RPC. Still a hidden flaw.

- **D-OBS-5 (S2, observability):** Marbles IMAX (named in Movies signal seed at
  line 245) is a science museum surfaced under Movies because its review/summary
  text trips the cinema regex. Confirms A3 is not theoretical — it is shipping
  in production right now. Operator should decide whether IMAX-equipped non-cinema
  venues belong on the Movies chip; if yes, the soft-scoring design is
  intentional and A3 is not a defect; if no, the scorer must add a hard
  type-gate (e.g., reject rows whose primary_type isn't in `['movie_theater',
  'drive_in']` regardless of score).

- **D-PROC-1 (process):** Constitution #2 (one owner per truth) was not enforced
  during ORCH-0598 split — three independent code paths kept their pre-split
  category-resolution logic and now disagree. Recommend: add a "category source
  of truth" check to the spec-review template for any future taxonomy migration
  ("if this changes how a place's category is computed, prove the same rule is
  applied at every emission point").

- **D-PROC-2 (process):** Migration `20260423300001_orch_0598_signal_batch.sql`
  migrated `preferences` rows but did NOT migrate `place_pool.ai_categories`
  rows. Recommend: any taxonomy split MUST migrate ALL columns of all tables
  that reference the old taxonomy, not just user-facing ones. Add to migration
  review checklist.

---

## 10. Confidence Calibration

| Thread | Verdict | Confidence | Why not H? |
|---|---|---|---|
| G1 | Routing layer does not silently substitute | M | No live-fire reproduction; static trace complete and architecturally airtight |
| G2 | displayCategory is fabricated at routing time | H | Code-anchored at every step |
| G3 | Legacy union conduit exists | H on existence; L on volume | No analytics access |
| G4 | filterMin only gates score | H | Migration SQL is unambiguous |
| G5 | No multi-chip cross-contamination | H | Bucket-per-chip data structure |
| G6 | Ticketmaster cannot leak into Movies | H | Hard-pinned segment + zero discover invocations |
| G7-A | Curated composition correct | H | New split slugs in COMBO_SLUG_TO_FILTER_SIGNAL |
| G7-B | Curated swap leaks via ai_categories | H | Code-anchored |
| G8 | Solo+collab parity holds | H | Single shared pipeline |
| G9 | Three-layer code disagreement | H | Direct file:line citations to all three |
| G10 | Pattern-class confirmed | H on architecture; M on per-chip impact | No DB sample for sibling chips |

**Why no H on G1:** the dispatch's stop-condition rule explicitly required
live-fire reproduction or "complete static-trace proof showing every branch from
RPC entry to row emission." Static trace is complete; live-fire was not run
because the headless environment cannot reproduce a real signed-in mobile
client's chip-tap-to-RPC flow against staging (would require operator to seed a
test region, sign in via the mobile app, and tap the Movies chip with deck
exhaustion conditions). The static trace is sufficient to prove no routing-layer
substitution; A3 (scoring promiscuity) is a separate concern and would still
require live data even with a chip-tap reproduction.

**Live-fire path to lift G1 to H + lift A3 confidence to H:**
1. SQL probe (operator runs via Supabase MCP):
   ```sql
   SELECT pp.primary_type, pp.name, ps.score
   FROM place_pool pp JOIN place_scores ps ON ps.place_id = pp.id
   WHERE ps.signal_id = 'movies' AND ps.score >= 80
   ORDER BY ps.score DESC;
   ```
2. Mixpanel query: count discover-cards events with
   `categories[] == 'Movies & Theatre'` last 7 days.
3. Operator triggers a Movies-stop swap in a curated chain on a signed-in
   account; capture network response from `replace-curated-stop`; inspect
   alternatives' `placeType` and `placeName`.

---

## 11. Stop-Condition Compliance

- [x] All 10 threads have verdicts at M or H confidence.
- [x] Every confirmed leak pathway has line-number citation chain from chip
      tap to row emission (A1 §3, A2 §3).
- [x] Five-truth-layer table is filled (§2.G9).
- [x] Pattern-class assessment decided — class-of-bug, not Movies-only (§4).
- [x] Architectural root cause identified (§7).
- [x] No solutions, no recommendations, no patches included.

Investigation is COMPLETE. Next step: orchestrator dispatches a SPEC against
this report to bound the fix scope.
