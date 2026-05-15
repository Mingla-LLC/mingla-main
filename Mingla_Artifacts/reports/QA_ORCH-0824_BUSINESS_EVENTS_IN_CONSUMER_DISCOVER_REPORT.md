# QA — ORCH-0824 — Business events in consumer Discover + wizard taxonomy + Google Places autocomplete

**Tester:** Claude `mingla-tester` (legacy parity mirror; canonical TEST owner is Claude `mingla-forensics` TEST mode per DEC-133 — operator explicitly redirected this dispatch to `mingla-tester`)
**Date:** 2026-05-13
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Sub-mode:** TARGETED + SPEC-COMPLIANCE overlay
**SPEC:** [`Mingla_Artifacts/specs/SPEC_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md`](../specs/SPEC_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md)
**Implementation report v2:** [`IMPLEMENTATION_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER_v2.md`](IMPLEMENTATION_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER_v2.md)
**Investigation:** [`INVESTIGATION_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md`](INVESTIGATION_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md)

---

## ⚠ Conflict-of-interest disclosure

This Claude session previously executed the IMPLEMENT phase (sessions 1 and 2) before being redirected to TEST. The author of the code and the verifier are the same model instance. To honor the "implementor claims are worthless — verify independently" discipline, this report:

1. Reads each touched file with fresh adversarial intent rather than trusting the implementation report's claims.
2. Runs independent CI gates rather than accepting "verified locally" claims.
3. Explicitly contradicts implementor claims where evidence diverges (e.g., the implementor report claimed "Deno not available" — Deno IS available at `/Users/sethogieva/.deno/bin/deno` and was run, see §Independent gates).
4. Flags every finding with file/line evidence; no claim is accepted on faith.

A genuinely independent verification would dispatch to Claude `mingla-forensics` (TEST mode) in a fresh session. Operator chose this path; the report's findings are still load-bearing, but the operator should weight a fresh-session re-verification before final CLOSE if the QA result is contested.

---

## Verdict: **CONDITIONAL PASS**

**Severity counts:** P0=0 · P1=1 · P2=2 · P3=2 · P4=3

Zero P0 (no Constitution violations, no security holes, no crash paths, no data fabrication, no silent failures). One P1 finding (DiscoverScreen useCallback deps array missing the three new filter fields) is small but real — should be fixed before CLOSE OR explicitly accepted by operator as part of the deviation-1 follow-up scope. Two scoped deviations from spec (filter sheet UI deferred + `venueName` null) were pre-accepted by operator in the dispatch and are honored.

Two SPEC success criteria remain runtime-unverifiable from code review (require operator-driven sim repro + DB push + edge fn deploy): **#8 wizard autocomplete dropdown rendering** and **#10 Get Tickets WebView checkout completion**. These cannot be PASS at code-review depth; tester recommends an operator-led smoke before declaring final CLOSE.

---

## Independent gates run

| Gate | Result |
|---|---|
| `node .github/scripts/strict-grep/orch-0824-event-taxonomy-parity.mjs` | **CLEAN** — three eventTaxonomy.ts modules byte-equivalent (45 entries each: 15 party + 16 vibe + 14 music genre). |
| `node .github/scripts/strict-grep/orch-0824-event-category-frozen.mjs` | **CLEAN** — zero forbidden category writes in mingla-business/src, mingla-business/app, app-mobile/src. |
| `/Users/sethogieva/.deno/bin/deno check supabase/functions/discover-merged-events/index.ts` | **CLEAN** — Deno strict type-check passes (Deno WAS available; implementor report's claim that it was unavailable was incorrect). |
| Migration filename monotonicity | **PASS** — `20260604000000` and `20260604000001` strictly greater than local max `20260603000001`. |
| Lockstep canonical list (DB CHECK constraint vs publish RPC validation) | **PASS** — both list the same 15 party slugs in the same order, both in migrations 1 and 2. |

---

## SPEC compliance matrix (all 15 criteria)

| # | SPEC criterion | Result | Evidence |
|---|---|---|---|
| 1 | Business events in city X above TM | **PASS (code)** | `discover-merged-events/index.ts:381-384` strict-partition merge — `businessItems` spread before `tmItems`. |
| 2 | TM-only when no business events | **PASS (code)** | Edge fn returns TM section unchanged when business query is empty; DiscoverScreen `businessEvents.map([])` renders nothing. |
| 3 | Party Type → only business, no TM | **PASS (code)** | `index.ts:340-342` `tmSuppressedByMinglaFacet = partyTypeSlugs.length > 0 || vibeTagSlugs.length > 0`; TM gate respects suppression. Filter UI to expose this is deferred (deviation 1). |
| 4 | Music Genre Hip-Hop → both sources mapped | **PASS (code)** | `eventTaxonomy.ts:73` `hiphop-rap: tmSlug='hiphop-rap'`; `mapMinglaMusicGenresToTmSlugs` resolves at edge fn line 345-347. |
| 5 | Mixed/Variety → only business | **PASS (code)** | `eventTaxonomy.ts:80` `mixed-variety: tmSlug: null`; `tmSuppressedByMinglaOnlyGenres` gate at edge fn line 348-350. |
| 6 | Wizard publish writes all new columns | **PASS (code)** | Publish RPC `20260604000001:295-307` reads partyTypes/vibeTags/musicGenres/city from `v_business_draft`; line 380-384 writes them to top-level columns. Runtime verification pending. |
| 7 | Step 1 no longer renders Category | **PASS (code)** | `CreatorStep1Basics.tsx` no longer contains CATEGORIES const or the Category sheet — verified via file read. |
| 8 | Step 3 autocomplete + city extraction | **UNVERIFIED (runtime)** | `AddressAutocompleteInput.tsx` + `googlePlacesService.ts` wired; Step 3 calls it. Requires sim run + `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` set in mingla-business build. |
| 9 | Card tap opens ExpandedCardModal (no Linking) | **PASS (code)** | `DiscoverScreen.tsx:handleBusinessEventCardPress` sets state + opens modal; no Linking.openURL on this path. |
| 10 | Get Tickets opens InAppBrowserModal | **UNVERIFIED (runtime)** | `ExpandedBusinessEventSheet.tsx:135-137` `handleGetTickets` sets `browserUrl` triggering InAppBrowserModal render. End-to-end checkout in WebView requires sim. |
| 11 | Backfill correctness | **PASS (code)** | Migration 1 lines 96-110 CASE/WHEN with empty-array honest fallback; self-verify DO block lines 117-150 RAISES on canonical violations. Live data verification pending operator DB push. |
| 12 | RLS regression on private events | **PASS (code)** | No RLS policy changes; baseline policy at migration 0 line 14450 unchanged. Service-role edge fn re-applies public-visibility WHERE as defense-in-depth. |
| 13 | RPC raises correct exceptions | **PASS (code)** | `20260604000001:198-219` RAISES `city_required`, `party_types_required`, `party_types_not_canonical`, `vibe_tags_not_canonical`, `music_genres_not_canonical` distinctly. |
| 14 | Lockstep TM↔Mingla genre table | **PASS (code)** | All 12 TM-mappable Mingla genres have entries in `DISCOVER_GENRE_ID` (verified via grep). Two Mingla-only entries (disco-funk, mixed-variety) correctly have `tmSlug: null`. |
| 15 | No category writes remain | **PASS** | CI gate clean; final scan post-implementor's draftEventPristine fix shows 0 violations. |

13/15 PASS on code-review. 2/15 UNVERIFIED pending runtime sim repro.

---

## Constitution check (14 rules)

| # | Rule | Result | Evidence |
|---|---|---|---|
| 1 | No dead taps | **PASS** | All new interactive elements (`TaxonomyPill`, `BusinessEventCard`, autocomplete suggestions, "Get Tickets" CTA, "Clear address" X) have onPress handlers. |
| 2 | One owner per truth | **PASS** | DB columns canonical; JSONB stripped at publish; mapper reads top-level columns. EventTaxonomy duplicated but parity-locked by CI. |
| 3 | No silent failures | **PASS** | `fetchPlaceDetails` throws; `searchMerged` throws; RPC RAISES; edge fn returns explicit JSON errors. Autocomplete failures silently return `[]` — acceptable per Constitution exception for type-ahead UX. |
| 4 | One key per entity (RQ) | **N/A** | DiscoverScreen doesn't use React Query for the merged fetch (preserves existing pattern of useEffect-driven fetch). |
| 5 | Server state server-side | **PASS** | `businessEvents` is component state; not Zustand. |
| 6 | Logout clears everything | **N/A** | No auth changes. |
| 7 | Label temporary | **N/A** | No `[TRANSITIONAL]` markers added; the two deviations are scope reductions documented in implementation report, not code transitions. |
| 8 | Subtract before adding | **PASS** | Category sheet + state removed before pills added in CreatorStep1Basics; old `category` field dropped from DraftEvent before new fields added. |
| 9 | No fabricated data | **PASS** | "Pricing on event page" when null prices (not fake number); `venueName: null` when JSONB unavailable (not fake city); empty array backfill for ambiguous categories. |
| 10 | Currency-aware | **PASS** | `BusinessEventCard.currency` flows through to `formatCurrency` in `formatPriceLine`. |
| 11 | One auth instance | **N/A** | No auth changes. |
| 12 | Validate at right time | **PASS** | Step 1 requires partyTypes ≥ 1; Step 3 requires city != null; RPC re-validates at publish. Three layers of validation, each in the right place. |
| 13 | Exclusion consistency | **PASS** | Same canonical 15/16/14 slug lists in DB CHECK (migration 1), RPC validation (migration 2), edge fn (`isSubsetOf`), and three client modules (`eventTaxonomy.ts`). |
| 14 | Persisted-state startup | **PASS** | Defensive `Array.isArray(row.party_types)` checks in mapper handle pre-migration persisted drafts. Older Zustand snapshots with no taxonomy fields default to `[]`. |

**14/14 — no constitutional violations.**

---

## Findings

### 🔴 P1 — F-1: DiscoverScreen useCallback deps array missing three new filter fields

**File:** [app-mobile/src/components/DiscoverScreen.tsx:1151-1161](app-mobile/src/components/DiscoverScreen.tsx#L1151-L1161)
**Code:**
```typescript
// eslint-disable-next-line react-hooks/exhaustive-deps
[
  effectiveCity?.name,
  effectiveCity?.lat,
  effectiveCity?.lng,
  nightOutGpsLat,
  nightOutGpsLng,
  selectedFilters.date,
  selectedFilters.segment,
  selectedFilters.genre,
  t,
],
```

**Problem:** The fetch closure reads `selectedFilters.partyTypes`, `.vibeTags`, `.musicGenres` (lines 1075-1077) but those three fields are NOT in the deps array. The `eslint-disable-next-line` masks this. When the deferred filter UI sheet rows land (deviation 1) and a user toggles a pill, `setSelectedFilters` will mutate the array but `fetchNightOutEvents` will hold a stale closure and refuse to refetch with the new facets.

**Severity rationale:** Not P0 because the filter UI rows don't exist yet — no user can hit this today. But the moment deviation 1 ships, this is a 100% repro: pill tap → no refetch. P1 because it blocks the deviation-1 follow-up without an additional fix.

**Fix (3 lines):**
```typescript
[
  effectiveCity?.name, effectiveCity?.lat, effectiveCity?.lng,
  nightOutGpsLat, nightOutGpsLng,
  selectedFilters.date, selectedFilters.segment, selectedFilters.genre,
  selectedFilters.partyTypes,    // ORCH-0824
  selectedFilters.vibeTags,      // ORCH-0824
  selectedFilters.musicGenres,   // ORCH-0824
  t,
],
```

**Recommended action:** EITHER implementor patch this 3-line change before CLOSE, OR operator explicitly accepts this as part of deviation-1's deferred scope (it'll be fixed naturally when filter UI lands).

---

### 🟡 P2 — F-2: Edge function pagination doesn't honor SPEC §3.2.4 step 6 "first `size` items from merged list"

**File:** [supabase/functions/discover-merged-events/index.ts:381-384](supabase/functions/discover-merged-events/index.ts#L381-L384)
**Code:**
```typescript
const items: MergedDiscoverItem[] = [
  ...businessItems.map(...): MergedDiscoverItem => ({ source: "business_event", item: it })),
  ...tmItems.map((it): MergedDiscoverItem => ({ source: "ticketmaster", item: it })),
];
```

**Problem:** SPEC §3.2.4 step 6 says "Simple count-based — first `size` items from the merged list." The code concatenates both lists without truncation. If `size=20` and there are 25 business events + 30 TM, the response returns 55 items — 2.75× the requested page size.

**Severity rationale:** Not P0/P1 because the concrete impact at current volumes is minor (most cities have very few business events; the over-fetch is bounded by `size` for TM since the edge fn passes `size` through to TM proxy, but business query also uses `size` via `.range()`, so worst-case is 2×size). At scale, over-fetch wastes bandwidth and pagination math diverges from SPEC. P2.

**Fix:**
```typescript
const items: MergedDiscoverItem[] = [
  ...businessItems.map(...): MergedDiscoverItem => ({ source: "business_event", item: it })),
  ...tmItems.map((it): MergedDiscoverItem => ({ source: "ticketmaster", item: it })),
].slice(0, size);
```

OR better: compute `remainingForTm = max(0, size - businessItems.length)`, slice TM to that count, then concatenate.

**Recommended action:** Operator accept as small follow-up patch OR include in the ORCH-0824-A filter-UI patch.

---

### 🟡 P2 — F-3: ExpandedCardModal contract ambiguous when BOTH `card` AND `businessEvent` are set

**File:** [app-mobile/src/components/ExpandedCardModal.tsx:1540-1553](app-mobile/src/components/ExpandedCardModal.tsx#L1540-L1553)
**Code:**
```typescript
if (businessEvent !== null && businessEvent !== undefined && !card) {
  return <ExpandedBusinessEventSheet ... />;
}
if (!card) {
  return null;
}
```

**Problem:** The early-return for the business-event branch fires ONLY when `!card`. If a caller passes both `card` AND `businessEvent`, the place/TM branch silently wins. DiscoverScreen carefully clears one before setting the other (`handleBusinessEventCardPress` line 1185-1192 sets `selectedCardForExpansion = null` first), so this case shouldn't occur in normal use. But the contract is undocumented in the prop type — a future caller could pass both without realizing the place/TM path takes precedence.

**Severity rationale:** P2 — defensive contract, not a user-facing bug today. Could become a bug if another caller is added.

**Fix:** Add a runtime warning OR JSDoc on `ExpandedCardModalProps.businessEvent` clarifying mutual-exclusion. OR invert priority (businessEvent wins when both are set).

---

### 🔵 P3 — F-4: AddressAutocompleteInput pick triggers two consecutive `updateDraft` calls

**File:** [mingla-business/src/components/event/AddressAutocompleteInput.tsx:135-141](mingla-business/src/components/event/AddressAutocompleteInput.tsx#L135-L141) + [CreatorStep3Where.tsx:79](mingla-business/src/components/event/CreatorStep3Where.tsx#L79)

**Problem:** On suggestion pick, the component fires `onChangeText(details.formattedAddress)` then `onPick(details)` back-to-back. The parent's `onChangeText` handler (`updateDraft({ address: v, city: null, locationGeo: null })`) wipes city/locationGeo. The parent's `onPick` handler then sets address/city/locationGeo correctly. Two consecutive writes; the first write is wasted. End state is correct due to React's batching within a render tick.

**Severity rationale:** P3 — wasted write, no user-visible bug. Could cause brief inconsistency for any code observing draft state between the two writes (none today).

**Fix:** Reorder calls in `handlePickSuggestion` so `onPick(details)` fires first, then `onChangeText(formattedAddress)`. OR remove the `onChangeText` call on pick entirely (`onPick` carries everything; parent already updates address inside onPick).

---

### 🔵 P3 — F-5: Edge function price aggregation coerces null to 0

**File:** [supabase/functions/discover-merged-events/index.ts:296-299](supabase/functions/discover-merged-events/index.ts#L296-L299)
**Code:**
```typescript
const prices = activeTickets
  .map((tt: RawRow) => Number(tt.price_cents))
  .filter((n: number) => Number.isFinite(n));
```

**Problem:** If `tt.price_cents` is null (free ticket), `Number(null) === 0` — which is `Number.isFinite(0) === true`. So a free ticket pushes 0 into the prices array, making `priceMin = 0`. The expanded sheet renders this as "Free" (which is actually accurate for a $0 ticket), so the user-visible behavior is correct. But the logic is semantically muddy.

**Severity rationale:** P3 — works by coincidence, not by design. Hardening for clarity.

**Fix:**
```typescript
const prices = activeTickets
  .map((tt: RawRow) => (tt.price_cents == null ? null : Number(tt.price_cents)))
  .filter((n: number | null): n is number => n !== null && Number.isFinite(n));
```

---

### ✅ P4 — F-6: CI gate caught implementor's own stale reference

**File:** [.github/scripts/strict-grep/orch-0824-event-category-frozen.mjs](../../.github/scripts/strict-grep/orch-0824-event-category-frozen.mjs)

The new EVENT-CATEGORY-FROZEN CI gate caught a stale `draft.category === null` reference in `draftEventPristine.ts:6` that would have caused a TypeScript strict compile error. The implementor's session-1 pass missed this file; the gate run in session 2 surfaced it; implementor fixed in `draftEventPristine.ts`. Demonstrates the gate works as designed and protected the operator from a compile-break.

---

### ✅ P4 — F-7: Honest data discipline in expanded sheet

**File:** [app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx:83-95](app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx#L83-L95)

`formatPriceLine` returns "Pricing on event page" when priceMin/priceMax are both null (no priced tickets), "Free" only when actually 0. No fake `$0.00` or fabricated pricing. Constitution #9 compliance is exemplary — worth replicating in adjacent surfaces.

---

### ✅ P4 — F-8: Three-way taxonomy parity locked at CI level

**Files:** All three `eventTaxonomy.ts` modules + new `orch-0824-event-taxonomy-parity.mjs` gate.

Adding or removing a slug requires updating all three modules atomically; CI fails on any drift. Solid cross-stack contract enforcement that doesn't depend on developer discipline.

---

## Cross-domain impact (verified)

- **mingla-business:** wizard Step 1 + Step 3 changed; draft store + validation + mapper changed. Existing draft autosave compatible (defensive Array.isArray on row read). Existing event editor (`app/event/[id]/edit.tsx`) not touched by this ORCH but reads from the same DraftEvent shape — should still work but **operator should sim-verify** editing a pre-ORCH-0824 published event.
- **app-mobile:** DiscoverScreen + ExpandedCardModal + new services/types/components. Place/TM/curated card render paths in ExpandedCardModal completely untouched (verified by reading the early-return position relative to hook order).
- **Edge functions:** new `discover-merged-events` only; existing `ticketmaster-events` proxy unchanged (invoked server-to-server from the new fn).
- **DB:** two new migrations (column adds + RPC). Existing RLS policy unchanged. Existing buyer flow (`/checkout/{eventId}/...`) unchanged.
- **Admin:** out of scope per SPEC non-goals — no changes.

---

## Scoped deviations from SPEC (pre-accepted by operator per dispatch)

1. **Filter sheet UI sections deferred.** Three new pill rows (Party Type / Vibes / Music Genre) in DiscoverScreen's filter sheet NOT rendered. Data flow supports them when wired. **F-1 P1 finding above MUST be fixed before or alongside the filter UI follow-up** to avoid a stale-closure bug.
2. **`venueName: null` from edge fn.** Venue name lives in `theme.business_event.venueName` JSONB; v1 edge fn doesn't extract. Expanded sheet falls back to `address` / `city`. Follow-up should either extract from JSONB or promote to a top-level column.

Both deviations pre-accepted by operator. Tester acknowledges and does not block.

---

## What requires operator-driven verification before CLOSE

These cannot be PASS at code review depth:

1. **iOS sim repro of wizard Step 1** — open Create Experience wizard, verify three pill grids render, multi-select works, validation triggers on empty Party Type. **Verify ORCH-0823 capslock/space fix still works on Description** after the Step 1 rewrite (paranoia check).
2. **iOS sim repro of wizard Step 3** — verify autocomplete dropdown renders, suggestions are tappable, pick populates address+city+locationGeo, free-typing-without-picking shows the "Pick the venue address from the suggestions" error.
3. **iOS sim repro of consumer Discover** — pick a city in CityPickerSheet that has at least one published business event, verify business event card renders above TM, tap → ExpandedBusinessEventSheet opens with chips and Get Tickets CTA, tap CTA → InAppBrowserModal opens to the public buyer URL.
4. **Deploy sequence verification** — operator runs migration 1 alone first (safe; invisible). Then wizard mingla-business OTA. THEN migration 2 + edge fn deploy. THEN app-mobile OTA. Reversing this order = 100% publish failures.
5. **Live data backfill probe** — after migration 1 lands, operator runs the self-verify DO block output to confirm pre/post counts.

---

## Discoveries for orchestrator

1. **ORCH-0824-A follow-up (filter sheet UI rows)** — small UI patch; ~50 LOC. Tester recommends bundling F-1 deps-array fix into this patch.
2. **ORCH-0824-C follow-up (venueName extraction)** — either JSONB extract in edge fn or top-level column promotion.
3. **ORCH-0824-D follow-up (LiveEvent.category cleanup)** — semantically dead post-ORCH-0824; affects business app's own event list/detail surface.
4. **Implementor's "Deno not available" claim was incorrect** — Deno IS at `/Users/sethogieva/.deno/bin/deno`. Tester ran `deno check` successfully (clean). Operator may want to update the implementor skill's protocol to check this PATH before declaring Deno unavailable.
5. **Same-instance implement+test conflict** — operator chose to dispatch testing to the same Claude session that implemented the work. For high-stakes ORCHs (this is one), a fresh Claude `mingla-forensics` (TEST mode) session would provide stronger independence. Tester proceeded with disclosed adversarial intent but flagged the limitation.

---

## CLOSE checklist (for orchestrator)

- [ ] Operator accepts F-1 as part of ORCH-0824-A follow-up OR implementor applies the 3-line patch.
- [ ] Operator accepts F-2, F-3 as small follow-ups.
- [ ] Operator runs migration 1 via `supabase db push --linked`; verifies via `mcp__supabase__list_migrations`.
- [ ] mingla-business OTA pushed (iOS + Android separately per `feedback_eas_update_no_web.md`).
- [ ] After confirmed wizard OTA on operator's device: operator runs migration 2 + orchestrator deploys edge function via `/Users/sethogieva/bin/supabase functions deploy discover-merged-events --project-ref gqnoajqerqhnvulmnyvv`.
- [ ] app-mobile OTA pushed (iOS + Android separately).
- [ ] Operator runs the 5 sim verifications listed in §"What requires operator-driven verification" above.
- [ ] Standard CLOSE protocol Steps 1-4 (artifact updates, DIAG reap, commit message, OTA announcement).
- [ ] CLOSE Step 5 NOT required (no decommission of a system/column family/table/RPC family; the legacy `category` JSONB is preserved as audit trail, not dropped).

---

NEXT HANDOFF — paste into Codex `orchestrator-mingla` (or Claude `mingla-orchestrator`) for CLOSE:

Close ORCH-0824. The QA verdict is CONDITIONAL PASS — P0=0, P1=1, P2=2, P3=2, P4=3 — per `Mingla_Artifacts/reports/QA_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER_REPORT.md`. The single P1 (DiscoverScreen.tsx useCallback deps array missing the three new filter fields, lines 1151-1161) requires either a 3-line patch from the implementor before CLOSE, OR explicit operator acceptance that it ships with the deferred ORCH-0824-A filter-UI follow-up where it will naturally need fixing anyway. The two scoped deviations (filter sheet UI deferred + venueName null) were pre-accepted by operator in the implementor dispatch. Deploy sequence is mandatory: migration 1 → wizard mingla-business OTA → migration 2 + edge function deploy via `/Users/sethogieva/bin/supabase functions deploy discover-merged-events --project-ref gqnoajqerqhnvulmnyvv` → app-mobile OTA. Reverse order causes 100% business event publish failures. Hard guards: do NOT bypass the pre-merge gate, do NOT skip CLOSE step 1 (all 7 artifact updates including WORLD_MAP, MASTER_BUG_LIST, COVERAGE_MAP, PRODUCT_SNAPSHOT, PRIORITY_BOARD, AGENT_HANDOFFS, OPEN_INVESTIGATIONS), do NOT skip Step 1.5 DIAG-marker reap (grep for `[ORCH-0824-DIAG]` should return zero), separate iOS and Android OTA commands per `feedback_eas_update_no_web.md`, full deploy split per `feedback_orchestrator_deploys_edge_functions.md`. Register ORCH-0824-A (filter UI + F-1 fix), ORCH-0824-C (venueName extraction), ORCH-0824-D (LiveEvent.category cleanup) as follow-up ORCH candidates per the tester report §Discoveries. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
