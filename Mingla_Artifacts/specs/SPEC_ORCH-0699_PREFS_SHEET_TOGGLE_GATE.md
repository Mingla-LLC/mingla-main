# Spec — ORCH-0699 — Preferences Sheet Toggle Gate (with bundled D-OBS-4 analytics fix)

**Date:** 2026-05-01
**Author:** mingla-forensics (SPEC mode)
**Investigation:** [reports/INVESTIGATION_ORCH-0699_PREFS_SHEET_TOGGLE_LEAK.md](../reports/INVESTIGATION_ORCH-0699_PREFS_SHEET_TOGGLE_LEAK.md)
**Dispatch:** [prompts/SPEC_ORCH-0699_PREFS_SHEET_TOGGLE_GATE.md](../prompts/SPEC_ORCH-0699_PREFS_SHEET_TOGGLE_GATE.md)
**Severity:** S1-high (`bug` + `ux` + `data-integrity`)
**Estimated effort:** 30–45 min implementor wall time + ~30 min device smoke
**OTA-eligible:** YES (no DB migration, no edge function change, no native module change)

---

## 0 — Problem statement (one paragraph)

The "See curated experiences?" + "See popular options?" toggles on the consumer Preferences sheet are decorative. The boolean is written to DB and React Query cache, but no consumer downstream reads it. Pills inside a toggled-off section continue to drive deck generation in both solo (`stableDeckParams`) and collab (`aggregateCollabPrefs`). Originated in ORCH-0434 as a half-completed feature — the migration added the columns and updated the in-sheet validation to be toggle-aware but never plumbed the gate to the deck-param consumers. This spec defines the read-side gate at exactly two sites + bundles a forward-only analytics-truth fix at one additional site so telemetry matches deck behavior from the moment the gate ships.

---

## 1 — Scope

### Files affected (3 MOD, 0 NEW)

| # | File | Function | Change |
|---|---|---|---|
| 1 | `app-mobile/src/contexts/RecommendationsContext.tsx` | `stableDeckParams` (lines 482-513) | Gate `categories` + `intents` on `userPrefs.intent_toggle` / `category_toggle`. Extend dep array. |
| 2 | `app-mobile/src/utils/sessionPrefsUtils.ts` | `aggregateCollabPrefs` (lines 48-146) | Skip per-row pill iteration when that row's corresponding toggle is `false`. |
| 3 | `app-mobile/src/components/PreferencesSheet.tsx` | analytics block (lines 910-924) | Record *effective* (post-gate) counts + arrays in AppsFlyer + Mixpanel. Add diagnostic toggle bools to Mixpanel. |

### Estimated diff
~6–10 LOC of substantive logic + ~30–40 LOC of protective comments and effective-array consts. Three files, one PR.

---

## 2 — Non-Goals

- 🚫 **NO database migration.** Columns `intent_toggle` / `category_toggle` already exist on `preferences` + `board_session_preferences` (per migration `20260415100000_orch0434_phase1_slug_migration.sql:50-58`).
- 🚫 **NO edge function changes.** `discover-cards` doesn't need toggle data — the gate is upstream.
- 🚫 **NO `useDeckCards` interface change.** Effective arrays flow through the existing `categories` / `intents` params.
- 🚫 **NO query-key shape change.** Empty effective array changes the existing key value naturally → React Query refetches automatically.
- 🚫 **NO clearing of pill state on toggle-off.** Preserving pills is the contract — flipping back ON must instantly restore selection without re-pick (T-04).
- 🚫 **NO change to `<ToggleSection>` component** ([PreferencesSheet/ToggleSection.tsx](../../app-mobile/src/components/PreferencesSheet/ToggleSection.tsx)). Visual gating already correct.
- 🚫 **NO change to in-sheet validation** at PreferencesSheet.tsx:692-695. Already toggle-aware.
- 🚫 **NO change to `accept-tag-along` edge fn** (D-OBS-2: propagation already correct).
- 🚫 **NO change to `useSessionManagement`** (D-OBS-2: propagation already correct).
- 🚫 **NO retroactive analytics correction.** D-OBS-4 is forward-only; past `preferences_updated` events were always raw — leave them alone.
- 🚫 **NO `invalidateQueries(["userPreferences"])` introduced anywhere.** Existing optimistic cache flow is sufficient (preserved per AppHandlers.tsx:936-941 landmine comment).
- 🚫 **NO process improvement for D-OBS-1.** Orchestrator backlog candidate, not spec scope.
- 🚫 **NO Mingla Business changes.** Consumer mobile only.

---

## 3 — Assumptions

| ID | Assumption | Verification |
|---|---|---|
| A-1 | `userPrefs.intent_toggle` and `category_toggle` are always defined when `userPrefs` is defined | Schema enforces `boolean NOT NULL DEFAULT true` on both `preferences` + `board_session_preferences` ([migration:50-58](../../supabase/migrations/20260415100000_orch0434_phase1_slug_migration.sql#L50-L58)) |
| A-2 | Even with A-1, defensive default to `true` is required everywhere we read | Mirrors existing pattern at [AppHandlers.tsx:459-460](../../app-mobile/src/components/AppHandlers.tsx#L459-L460), [PreferencesSheet.tsx:355-356](../../app-mobile/src/components/PreferencesSheet.tsx#L355-L356) and [432-433](../../app-mobile/src/components/PreferencesSheet.tsx#L432-L433) |
| A-3 | `BoardSessionPreferences` already exposes `intent_toggle?: boolean` and `category_toggle?: boolean` | Confirmed at [useBoardSession.ts:32-33](../../app-mobile/src/hooks/useBoardSession.ts#L32-L33) — no type change needed |
| A-4 | Empty effective arrays through `useDeckCards` produce a different query-key value, triggering React Query refetch with `placeholderData` retention | Confirmed via [useDeckCards.ts:66-78](../../app-mobile/src/hooks/useDeckCards.ts#L66-L78) (`buildDeckQueryKey` hashes raw arrays) + [line 234](../../app-mobile/src/hooks/useDeckCards.ts#L234) (`placeholderData: (previousData) => previousData`) |

---

## 4 — Open Questions: AUTO-RESOLVED (auto mode active)

Per dispatch §8 default-yes recommendations:

| OQ | Resolution | Rationale |
|---|---|---|
| **OQ-1** Solo "both toggles OFF" empty-state UX | **(a) Fall back to defaults `["nature", "drinks_and_music", "icebreakers"]`** | Matches "true empty state" semantics already at [RecommendationsContext.tsx:502-503](../../app-mobile/src/contexts/RecommendationsContext.tsx#L502). Cold-start cache from a corrupted DB row is the only path that reaches this state (in-sheet validation at PreferencesSheet.tsx:695 prevents user from creating it via the UI). Defaults give a sane deck instead of a blank screen. |
| **OQ-2** Collab "all rows have both toggles OFF" → empty union | **(a) Return `null`** (consistent with [sessionPrefsUtils.ts:524](../../app-mobile/src/utils/sessionPrefsUtils.ts#L524) "both empty" pre-existing case) | Existing collab-empty handling upstream is already designed for `null`. Fabricating defaults would fight the operator's intent (everyone disabled both sections — they want nothing). |
| **OQ-3** Mixpanel diagnostic fields | **(a) YES — add `intent_toggle_on`, `category_toggle_on`, `categories_raw_count`, `intents_raw_count`** alongside effective fields | 4 extra properties per event is cheap; unlocks "% of users who toggle off" analytics that PMs need to validate the feature post-fix. |
| **OQ-4** Protective comment verbosity | **(a) Multi-line block at each of the 3 sites** explaining the half-completed-feature history + why the gate must stay | Future readers need the WHY (not just the WHAT). The bug took an investigation to find; the explanation prevents accidental removal during a future refactor. |

---

## 5 — Layer Specification

### 5.1 Database layer — NO CHANGES
Columns exist with correct types and defaults. No migration.

### 5.2 Edge function layer — NO CHANGES
`discover-cards` continues to receive only effective `categories` array. No new payload field.

### 5.3 Service layer — NO CHANGES
`deckService.fetchDeck` continues to forward `categories` / `intents` from caller.

### 5.4 Hook layer — NO INTERFACE CHANGES
`useDeckCards` interface ([useDeckCards.ts:40-58](../../app-mobile/src/hooks/useDeckCards.ts#L40-L58)) unchanged. Query-key builder ([lines 66-78](../../app-mobile/src/hooks/useDeckCards.ts#L66-L78)) unchanged. Effective arrays naturally produce different keys.

### 5.5 Context layer — THE FIX (solo)

**File:** [`app-mobile/src/contexts/RecommendationsContext.tsx`](../../app-mobile/src/contexts/RecommendationsContext.tsx)
**Function:** `stableDeckParams` (currently lines 482-513)

**Required behavior:**

1. Read `intentToggle` and `categoryToggle` from `userPrefs` with defensive default `true` (A-2).
2. Compute effective arrays *before* the empty-state branch logic.
3. Recompute `hasAnySignal` from effective arrays so OQ-1 default fires when both toggles off.
4. Add `userPrefs?.intent_toggle` and `userPrefs?.category_toggle` to dependency array.
5. Add multi-line protective comment block above the gate (per OQ-4).

**Reference shape (illustrative — implementor adapts to project style):**

```ts
const stableDeckParams = useMemo(() => {
  // ORCH-0699: Toggle gate. ORCH-0434 added intent_toggle/category_toggle
  // columns + persisted them on save, but never plumbed them through to
  // the deck consumer — so flipping a toggle was decorative for ~weeks.
  // The gate MUST live at this layer because the query key is built from
  // these arrays downstream — empty effective arrays change the key value
  // and trigger React Query refetch automatically (no manual invalidation).
  // DO NOT remove without updating useDeckCards interface to receive raw
  // pills + toggles separately. See INVESTIGATION_ORCH-0699 for full chain.
  const rawCats = userPrefs?.categories ?? [];
  const cats = rawCats.length > 0 ? normalizeCategoryArray(rawCats) : [];
  const ints = userPrefs?.intents ?? [];

  const intentToggle = userPrefs?.intent_toggle ?? true;
  const categoryToggle = userPrefs?.category_toggle ?? true;

  const effectiveCats = categoryToggle ? cats : [];
  const effectiveInts = intentToggle ? ints : [];

  // Still loading and nothing to show yet — wait for preferences to settle.
  if (effectiveCats.length === 0 && effectiveInts.length === 0 && isLoadingPreferences) return null;

  // hasAnySignal computed from EFFECTIVE arrays so OQ-1 default fires
  // when both toggles off (corrupted-cold-start path only — sheet validation
  // at PreferencesSheet.tsx:695 prevents user from getting here via UI).
  const hasAnySignal = effectiveCats.length > 0 || effectiveInts.length > 0;
  return {
    categories: effectiveCats.length > 0
      ? effectiveCats
      : hasAnySignal
        ? []
        : ["nature", "drinks_and_music", "icebreakers"],
    intents: effectiveInts,
  };
}, [
  // eslint-disable-next-line react-hooks/exhaustive-deps
  JSON.stringify(userPrefs?.categories ?? []),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  JSON.stringify(userPrefs?.intents ?? []),
  userPrefs?.intent_toggle,
  userPrefs?.category_toggle,
  isLoadingPreferences,
]);
```

**Critical constraints:**
- `effectiveCats` / `effectiveInts` MUST be derived BEFORE the loading-guard so the guard correctly accounts for toggle-off (a user with both toggles off and pills present should still pass the guard — not get stuck in `null`).
- `hasAnySignal` MUST use effective arrays, not raw, so OQ-1 default kicks in for both-off.
- Dep array MUST include both toggle bools (primitive deps OK without JSON.stringify).

### 5.6 Util layer — THE FIX (collab)

**File:** [`app-mobile/src/utils/sessionPrefsUtils.ts`](../../app-mobile/src/utils/sessionPrefsUtils.ts)
**Function:** `aggregateCollabPrefs` (currently lines 48-146)

**Required behavior:**

1. For each `row`, evaluate `row.intent_toggle ?? true` and `row.category_toggle ?? true` BEFORE iterating that row's pill arrays.
2. Skip the iteration entirely when the corresponding toggle is `false`.
3. Existing return-`null` at line 524 (`if (aggregated.categories.length === 0 && aggregated.intents.length === 0) return null;`) — wait, line ref needs verification. The current code in RecommendationsContext at `collabDeckParams` useMemo at [lines 516-537](../../app-mobile/src/contexts/RecommendationsContext.tsx#L516-L537) does the null-check after calling aggregator. **Confirm: aggregator itself does NOT return null**; the caller (`collabDeckParams`) checks `aggregated.categories.length === 0 && aggregated.intents.length === 0` and returns null. Spec writer notes: this caller-side null-check at [RecommendationsContext.tsx:524](../../app-mobile/src/contexts/RecommendationsContext.tsx#L524) handles OQ-2 (a) automatically — no change needed there.
4. Add multi-line protective comment block above the gate.

**Reference shape (illustrative):**

```ts
// Categories: UNION (R3.1) — combine everyone's categories, deduplicate.
// ORCH-0699: Per-row toggle gate. Each participant's category_toggle=false
// EXCLUDES their categories from the union (that participant disabled the
// section). UNION-with-skip preserves R3.1 semantics for opted-in
// participants while honoring opted-out participants' choice.
const categorySet = new Set<string>();
for (const row of rows) {
  if (!(row.category_toggle ?? true)) continue;
  for (const cat of (row.categories || [])) {
    categorySet.add(cat);
  }
}

// Intents: UNION (R3.9) — combine everyone's intents, deduplicate.
// ORCH-0699: Same per-row toggle gate as categories above.
const intentSet = new Set<string>();
for (const row of rows) {
  if (!(row.intent_toggle ?? true)) continue;
  for (const intent of (row.intents || [])) {
    intentSet.add(intent);
  }
}
```

**Critical constraints:**
- Gate is per-row, NOT per-aggregator. Participant A's gate doesn't affect Participant B.
- Travel mode, distance, datetime aggregation **MUST NOT** be gated — those don't have a toggle concept and remain UNION/MAX/MID per existing R3.2/R3.3/R3.6 rules.
- Selected dates aggregation also stays as-is.
- Caller-side null-check at RecommendationsContext.tsx:524 handles OQ-2 (a) without aggregator-side change.

### 5.7 Component layer — analytics fix only (D-OBS-4)

**File:** [`app-mobile/src/components/PreferencesSheet.tsx`](../../app-mobile/src/components/PreferencesSheet.tsx)
**Site:** lines 910-924 (`logAppsFlyerEvent` + `mixpanelService.trackPreferencesUpdated`)

**Required behavior:**

1. Compute effective categories/intents arrays immediately before the analytics calls, gated on local `intentToggle` / `categoryToggle` state (NOT `userPrefs` — local sheet state is the source of truth at the moment of save).
2. Replace all 4 raw references with effective versions.
3. Update `changesCount` to use effective lengths.
4. Add diagnostic Mixpanel fields per OQ-3 (a).
5. Add multi-line protective comment.

**Reference shape (illustrative):**

```ts
// ORCH-0699 D-OBS-4: Record EFFECTIVE counts/arrays so analytics match
// what the deck actually receives. Raw counts misled "% users who picked
// X" reports — we kept attributing pills the deck never saw.
// Diagnostic fields (OQ-3) preserve raw counts + toggle bools so PMs can
// see opt-out rate and section-disable behavior.
const effectiveCategoriesAnalytics = categoryToggle ? finalCategories : [];
const effectiveIntentsAnalytics = intentToggle ? finalIntents : [];

logAppsFlyerEvent('preferences_updated', {
  is_collaboration: isCollaborationMode,
  categories_count: effectiveCategoriesAnalytics.length,
  intents_count: effectiveIntentsAnalytics.length,
});
mixpanelService.trackPreferencesUpdated({
  isCollaborationMode,
  changesCount: effectiveCategoriesAnalytics.length + effectiveIntentsAnalytics.length,
  intents: effectiveIntentsAnalytics,
  categories: effectiveCategoriesAnalytics,
  travelMode,
  constraintType: 'time',
  constraintValue: typeof constraintValue === 'number' ? constraintValue : 30,
  dateOption: selectedDateOption ?? null,
  // ORCH-0699 D-OBS-4 diagnostic fields (OQ-3) — raw vs effective + toggle state
  intent_toggle_on: intentToggle,
  category_toggle_on: categoryToggle,
  categories_raw_count: finalCategories.length,
  intents_raw_count: finalIntents.length,
});
```

**Critical constraints:**
- Use *local* `intentToggle` / `categoryToggle` state (defined at [PreferencesSheet.tsx:206-207](../../app-mobile/src/components/PreferencesSheet.tsx#L206-L207)), NOT `userPrefs.*` — at save time, local state is the source of truth (cache hasn't been written yet).
- Diagnostic fields are NEW Mixpanel properties — ensure `mixpanelService.trackPreferencesUpdated` signature accepts them. **Spec-time discovery (D-SPEC-1):** the existing function signature may be strict; implementor must verify and either widen the type OR pass the diagnostic fields via Mixpanel `super properties` if the helper rejects unknowns. Preferred: widen the function arg type to accept the new optional fields.
- AppsFlyer event remains MINIMAL — only the 2 effective counts (no diagnostic fields). Diagnostic data lives only in Mixpanel.

### 5.8 Realtime
N/A — no realtime channel involvement.

---

## 6 — Success Criteria

### Solo behavior
- **SC-1** Solo: With pills `["romantic"]` selected and `intent_toggle: false`, after Apply, the React Query key for `useDeckCards` contains an empty intents segment (no `'romantic'` substring). Verifiable via React Query devtools or `[useDeckCards] partial delivery:` debug log at [useDeckCards.ts:216](../../app-mobile/src/hooks/useDeckCards.ts#L216).
- **SC-2** Solo: With above conditions, the network request body to `discover-cards` contains `categories: <effective array>` only. Verifiable via network inspector or `[DeckService] Resolved pills:` debug log at [deckService.ts:361](../../app-mobile/src/services/deckService.ts#L361).
- **SC-3** Solo: With pills `["drinks_and_music"]` + `category_toggle: false` AND pills `["romantic"]` + `intent_toggle: true`, deck reflects intents-only behavior — `drinks_and_music` does NOT appear as a category filter.
- **SC-4** Solo: Toggle OFF → toggle ON without reopening the sheet — pills are restored in the next deck WITHOUT the user re-picking. (Tests no-data-loss invariant.)
- **SC-5** Solo cold-start: corrupted DB row with both toggles `false` AND populated pills → effective arrays = `[]` → falls back to defaults `["nature", "drinks_and_music", "icebreakers"]` for categories, `[]` for intents (per OQ-1 a). Deck renders default empty-state experience instead of crashing or blanking.

### Collab behavior
- **SC-6** Collab: Participant A `intent_toggle=false intents=["romantic"]`, Participant B `intent_toggle=true intents=["adventurous"]` → `aggregateCollabPrefs` returns `intents: ["adventurous"]` (no `romantic`).
- **SC-7** Collab: ALL participants have both toggles `false` → `aggregateCollabPrefs` returns object with empty `categories` + `intents`; caller-side null-check at [RecommendationsContext.tsx:524](../../app-mobile/src/contexts/RecommendationsContext.tsx#L524) returns `null`, routing to existing collab-empty handling. (Per OQ-2 a.)
- **SC-8** Collab mixed: A `category_toggle=false categories=["drinks_and_music"]`, B `category_toggle=true categories=["nature"]` → aggregate `categories: ["nature"]`.
- **SC-9** Collab travel/date aggregation unchanged: per-row gate ONLY affects categories/intents. Per-row toggle does NOT affect that participant's `travel_mode`, `travel_constraint_value`, `datetime_pref`, `date_option`, `selected_dates`, `custom_lat/lng` — those continue to flow into UNION/MAX/MID aggregation.

### Persistence
- **SC-10** DB write of `intent_toggle: false` does NOT clear `intents` array in the `preferences` row — pills remain persisted. (Existing behavior; spec locks it in.)
- **SC-11** Loading the sheet after a session with `intent_toggle: false + intents: ["romantic"]` shows toggle OFF and pill state restored (collapsed but ready to re-appear when toggle flips ON).

### Analytics (D-OBS-4)
- **SC-12** With `intent_toggle: false + intents: ["romantic", "first-date"]` and `category_toggle: true + categories: ["nature"]`, the AppsFlyer `preferences_updated` event records `intents_count: 0` and `categories_count: 1`.
- **SC-13** Mixpanel `trackPreferencesUpdated` `intents` field is `[]` and `categories` field is `["nature"]` for the same input.
- **SC-14** Mixpanel includes diagnostic fields: `intent_toggle_on: false`, `category_toggle_on: true`, `categories_raw_count: 1`, `intents_raw_count: 2`.
- **SC-15** AppsFlyer event does NOT include diagnostic fields (effective counts only).

### Regression / no-data-loss
- **SC-16** Default new-user state (`intent_toggle: true`, `category_toggle: true`, both pill arrays empty) → behavior identical to today (default categories `["nature", "drinks_and_music", "icebreakers"]` populate the deck).
- **SC-17** Existing user with both toggles ON + populated pills → behavior identical to today (their selected pills drive the deck).
- **SC-18** Tag-along acceptance: when User A with `intent_toggle: false + intents: ["romantic"]` accepts a tag-along, recipient's seeded session preferences include `intent_toggle: false + intents: ["romantic"]`. Verify `accept-tag-along` flow unchanged (per D-OBS-2). And: in the recipient's collab session, the per-row gate at SC-7 fires for the disabled-intent row.
- **SC-19** Cache & query key: flipping a toggle causes the next `useDeckCards` queryKey to differ in the `categories` or `intents` segment. React Query refetches automatically. No manual `invalidateQueries` needed.

### TypeScript & build
- **SC-20** `tsc --noEmit` produces ZERO new errors (3 pre-existing baseline errors only).
- **SC-21** Existing test suite passes with no regressions.

---

## 7 — Test Cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | Solo: curated OFF + pill set | Local: `intent_toggle=false, intents=["romantic"]`, `category_toggle=true, categories=["nature"]`. Apply. | Query key intents segment = `''`; deck has zero curated cards; `categories` segment = `'nature'` | Context + useDeckCards |
| T-02 | Solo: popular OFF + pill set | `category_toggle=false, categories=["drinks_and_music"]`, `intent_toggle=true, intents=["romantic"]`. Apply. | Query key categories segment = `''`; deck filters on intents only | Context |
| T-03 | Solo: both OFF + both populated (corrupted-cold-start path) | `intent_toggle=false, category_toggle=false`, both pill arrays populated | Effective arrays empty → fallback defaults `["nature", "drinks_and_music", "icebreakers"]` for categories, `[]` for intents | Context (OQ-1 a) |
| T-04 | Solo: toggle restoration | Apply curated OFF + `["romantic"]`. Reopen sheet. Flip curated ON. Apply. | Deck reflects `["romantic"]` again with NO re-pick required | Component + Context |
| T-05 | Collab: per-row gate | Row A `intent_toggle=false intents=["romantic"]`, Row B `intent_toggle=true intents=["adventurous"]` | Aggregate `intents=["adventurous"]` | sessionPrefsUtils |
| T-06 | Collab: all rows OFF | Every row both toggles false | Aggregator returns empty arrays; `collabDeckParams` returns `null`; existing collab-empty UI fires | sessionPrefsUtils + Context (OQ-2 a) |
| T-07 | Collab: mixed | A `category_toggle=false categories=[drinks_and_music]`, B `category_toggle=true categories=[nature]` | Aggregate `categories=["nature"]` | sessionPrefsUtils |
| T-08 | Collab travel still UNION/MAX | A `intent_toggle=false travel_mode=walking`, B `intent_toggle=true travel_mode=driving` | Aggregate `travelMode='driving'` (per R3.2 most-permissive) — gate does NOT affect non-pill fields | sessionPrefsUtils |
| T-09 | Analytics: AppsFlyer effective counts | `intent_toggle=false intents=["a","b"]`, `category_toggle=true categories=["c"]` | AppsFlyer event: `intents_count=0, categories_count=1` | PreferencesSheet (analytics) |
| T-10 | Analytics: Mixpanel effective + diagnostic | Same as T-09 | Mixpanel: `intents=[], categories=["c"], intent_toggle_on=false, category_toggle_on=true, intents_raw_count=2, categories_raw_count=1, changesCount=1` | PreferencesSheet (analytics) |
| T-11 | DB persistence | Toggle OFF + non-empty pills, Apply | DB `preferences` row has `intent_toggle=false` AND `intents=["romantic"]` (NOT cleared) | AppHandlers + DB |
| T-12 | Cache hydration on app cold start | Persisted state has `intent_toggle=false intents=["romantic"]` | App starts with curated section toggle OFF, pills restored in sheet (collapsed), deck reflects no curated content | useUserPreferences + Context |
| T-13 | Brand-new user | All defaults + empty pill arrays | Defaults populate: `categories=["nature","drinks_and_music","icebreakers"]`, intents `[]` | Context |
| T-14 | Type-safety: undefined toggle | `userPrefs.intent_toggle === undefined` (defensive) | Treated as `true` (default-on) | Context + sessionPrefsUtils |
| T-15 | Query-key invalidation | Flip toggle, observe React Query | `useDeckCards` query key differs; new fetch fires; placeholderData shows previous deck during transition | useDeckCards |
| T-16 | TypeScript clean | `tsc --noEmit` after fix | Zero NEW errors (3 baseline) | Build |
| T-17 | Existing tests | All app-mobile tests pass | No regressions | CI |
| T-18 | Tag-along propagation | A with `intent_toggle=false intents=["romantic"]`, accept tag-along | Recipient session row has `intent_toggle=false intents=["romantic"]`; collab aggregator gates that row out of the union (per T-05) | useSessionManagement + accept-tag-along + sessionPrefsUtils |
| T-19 | Solo: collab-mode-active does not break solo gate | User in collab mode flips solo prefs (different surface) | Collab aggregator unaffected; solo gate fires when user returns to solo mode | Context (mode switching) |

---

## 8 — Invariants

### Existing invariants this change must preserve

| ID | Invariant | How preserved | Test |
|---|---|---|---|
| INV-1 (Constitution #2 "One owner per truth") | Toggle state and pill state are separate fields with separate ownership | Spec does NOT clear pills on toggle flip; toggle change is local to bool only | T-04, T-11 |
| INV-2 (Constitution #4 "One query key per entity") | Deck query key built by single `buildDeckQueryKey` function | Spec does NOT add a parallel construction site; gate happens upstream → same function still produces canonical key | T-15 |
| INV-3 (Constitution #13 "Exclusion consistency") | Same gating logic at every consumer that converts userPrefs → effective deck params | Solo (`stableDeckParams`) AND collab (`aggregateCollabPrefs`) get the SAME pattern: `toggle ? raw : []` | T-01, T-05 |
| INV-4 (MEMORY: Solo+Collab Parity) | Fix solo + collab in the same pass | Both sites in one PR | All Tests |
| INV-5 (MEMORY: AppHandlers.tsx:936-941 landmine) | Do NOT add `invalidateQueries(["userPreferences"])` after save — race with server fetch | Spec MUST NOT introduce any new invalidateQueries call. Existing flow is sufficient. | Code review (grep `invalidateQueries.*userPreferences` returns same matches as today) |

### NEW invariants this change establishes

| ID | Invariant | Documentation |
|---|---|---|
| INV-NEW-1 | Every consumer that reads `userPrefs.categories` or `userPrefs.intents` (or `row.categories` / `row.intents` in collab) for deck/card generation MUST gate on the corresponding `*_toggle`. Treat raw pill arrays as section-input, not deck-input. | Orchestrator must add to [INVARIANT_REGISTRY.md](../INVARIANT_REGISTRY.md) at CLOSE. Future code reading these fields without gating fails review. |
| INV-NEW-2 | `intent_toggle` / `category_toggle` undefined is treated as `true` everywhere (defensive default) | Verified by T-14. Pattern locked in via `?? true` at every read site. |

---

## 9 — Implementation Order (numbered, file-explicit)

1. **`app-mobile/src/contexts/RecommendationsContext.tsx`** — modify `stableDeckParams` (lines 482-513):
   - Add `intentToggle` / `categoryToggle` reads from `userPrefs` with `?? true` defaults
   - Compute `effectiveCats` / `effectiveInts` BEFORE the loading-guard
   - Use effective arrays in the loading-guard, `hasAnySignal`, and return value
   - Extend dep array to include `userPrefs?.intent_toggle` + `userPrefs?.category_toggle` (primitive deps, no JSON.stringify)
   - Add multi-line protective comment block at the top of the useMemo body

2. **`app-mobile/src/utils/sessionPrefsUtils.ts`** — modify `aggregateCollabPrefs` (lines 67-72 + 75-80):
   - Add `if (!(row.category_toggle ?? true)) continue;` inside the categories loop
   - Add `if (!(row.intent_toggle ?? true)) continue;` inside the intents loop
   - Add multi-line protective comment block above each loop
   - VERIFY: travel_mode / constraint / dates / location loops are NOT touched

3. **`app-mobile/src/components/PreferencesSheet.tsx`** — modify analytics block (lines 910-924):
   - Add `effectiveCategoriesAnalytics` / `effectiveIntentsAnalytics` consts immediately before the calls
   - Replace all 4 raw references in AppsFlyer + Mixpanel calls
   - Update `changesCount` to use effective sum
   - Add 4 diagnostic Mixpanel fields (intent_toggle_on, category_toggle_on, categories_raw_count, intents_raw_count)
   - Add multi-line protective comment block above the consts

4. **Verify `mixpanelService.trackPreferencesUpdated` accepts the new diagnostic fields** (per D-SPEC-1):
   - Read [`app-mobile/src/services/mixpanelService.ts`](../../app-mobile/src/services/mixpanelService.ts) `trackPreferencesUpdated` signature
   - If signature is strict (typed param), widen to accept new optional fields:
     - `intent_toggle_on?: boolean`
     - `category_toggle_on?: boolean`
     - `categories_raw_count?: number`
     - `intents_raw_count?: number`
   - If signature is loose (`Record<string, unknown>` or `any`), no change needed
   - Trivial change either way; ~2-4 LOC

5. **Run `tsc --noEmit`** — verify zero NEW errors (3 baseline acceptable per project convention)

6. **Manual smoke matrix** (operator after IMPL):
   - Solo: T-01, T-02, T-04 (visual: deck reflects gate; toggle restoration works)
   - Collab: T-05 (requires 2 participants; can use 2 devices or 2 accounts)
   - Cold start: T-12 (kill app, relaunch — pills restored, deck respects gate)
   - Analytics: T-09 + T-10 (verify in Mixpanel/AppsFlyer dashboards or via debug network inspector)

---

## 10 — Regression Prevention

### Structural safeguard
Multi-line inline comment block at each of the 3 gate sites (per OQ-4 a). Each block:
- References ORCH-0699 + ORCH-0434 (origin)
- States WHY the gate exists at this layer (query key built downstream from these arrays — empty arrays change key value naturally)
- States WHY removal would re-introduce the bug
- States the alternative path required IF removal is ever attempted (plumb toggle through `useDeckCards` interface)

### Test that catches regression
- T-01 + T-05 are canonical regression tests
- If gate is removed: query-key segment for `intents` or `categories` would contain raw pill ID instead of empty → both tests fail immediately

### Process safeguard (D-OBS-1 follow-up — orchestrator backlog only, NOT in this spec)
ORCH-0434's spec/test plan had no contract-completeness check between writer (save layer) and consumer (deck-param builder). Orchestrator may queue a process candidate to require, when adding any new gating field, an explicit "verified all consumers honor it" gate before the PR merges. Out of ORCH-0699 scope.

---

## 11 — Spec-time Discoveries

| ID | Finding | Severity | Action |
|---|---|---|---|
| **D-SPEC-1** | `mixpanelService.trackPreferencesUpdated` signature must accept the new diagnostic fields. The spec adds 4 new optional Mixpanel properties; if the function signature is strict-typed, the implementor must widen it (adds ~2-4 LOC to step 4 of impl order). Trivial; flagged for accuracy of effort estimate. | LOW | Bundled into IMPL step 4 |
| **D-SPEC-2** | The dispatch prompt §2e referenced `aggregateCollabPrefs` returning `null` directly. Verification during spec-writing showed: aggregator does NOT return null — caller `collabDeckParams` at [RecommendationsContext.tsx:524](../../app-mobile/src/contexts/RecommendationsContext.tsx#L524) does the null-check via `if (aggregated.categories.length === 0 && aggregated.intents.length === 0) return null;`. So OQ-2 (a) is satisfied without aggregator-side null return. Spec §5.6 corrected. No new ORCH-ID. | INFO | Captured in spec §5.6 — no extra work |
| **D-SPEC-3** | Existing `userPreferences` cache write at [AppHandlers.tsx:474-491](../../app-mobile/src/components/AppHandlers.tsx#L474-L491) already includes `intent_toggle` + `category_toggle` correctly. So `useUserPreferences` cache hydrates them automatically; no AppHandlers change needed. Spec already excludes this — confirming no scope expansion. | INFO | None |
| **D-SPEC-4** | `<ToggleSection>` at [ToggleSection.tsx:61](../../app-mobile/src/components/PreferencesSheet/ToggleSection.tsx#L61) unmounts children when `isOn === false`. This is a React unmount, NOT a state-clear. Pill state lives in parent (`PreferencesSheet`), preserved across unmount. T-04 (toggle restoration) depends on this — if `<ToggleSection>` is ever refactored to lift pill state into itself, T-04 breaks. Flag as future-design-warning, not action item. | INFO | Capture in [INVARIANT_REGISTRY.md](../INVARIANT_REGISTRY.md) at CLOSE: "ToggleSection MUST NOT own pill state — parent owns, ToggleSection only owns visibility" |
| **D-SPEC-5** | `useUserPreferences` ([useUserPreferences.ts:46-63](../../app-mobile/src/hooks/useUserPreferences.ts)) has `staleTime: 60_000`. Combined with optimistic cache update at [AppHandlers.tsx:474](../../app-mobile/src/components/AppHandlers.tsx#L474), toggle flips propagate within the 60s window via the cache write. Cold-start hydration is the only path where the gate fires from DB-loaded data. Spec assumes this; no change needed. | INFO | None |

---

## 12 — Constitutional Compliance Check

| # | Rule | Compliance |
|---|---|---|
| 1 | No dead taps | ✅ Toggle taps now produce observable deck behavior (today they're "dead" in the data sense — fixed by this spec) |
| 2 | One owner per truth | ✅ Toggle bool and pill array remain separate fields with separate ownership; gate is read-side composition, not state merge |
| 3 | No silent failures | ✅ Gate is unconditional; defensive `?? true` prevents NaN/undefined crashes |
| 4 | One query key per entity | ✅ Same `buildDeckQueryKey` produces canonical key from effective arrays |
| 7 | Label temporary fixes | N/A — no transitional code introduced |
| 8 | Subtract before adding | ✅ This spec ADDS minimal logic; the broken behavior (decorative toggle) is implicitly subtracted |
| 12 | Validate at the right time | ✅ In-sheet validation at PreferencesSheet.tsx:692-695 already gates user-facing form; new gate validates at deck-param-build time (correct layer) |
| 13 | Exclusion consistency | ✅ Same gate pattern in solo + collab |
| 14 | Persisted-state startup | ✅ T-12 covers; cold-start cache hydration runs through gated builder |

No constitutional rule violated. Three rules (#1, #4, #13) RESTORED by this fix.

---

## 13 — Estimated Effort Breakdown

| Phase | Wall time |
|---|---|
| IMPL: 3 file edits + comment blocks + Mixpanel signature check | 30–45 min |
| `tsc --noEmit` + existing test suite | 5 min |
| Operator manual smoke (solo T-01/T-02/T-04, collab T-05, cold-start T-12, analytics T-09/T-10) | 20–30 min |
| **Total** | **~1 hour** |

OTA-eligible (no DB migration, no edge fn, no native module). Standard `eas update --branch production --platform ios` then `--platform android` per project convention.

---

## 14 — Out of scope (firm restatement)

Same as dispatch §11. Re-listed for the implementor's convenience:

- Mingla Business
- Admin dashboard
- DB migration
- Edge function changes
- `useDeckCards` interface change
- Pill-clearing on toggle-off
- Toggle UI changes
- Save-handler changes
- Retroactive analytics correction
- Process improvement (D-OBS-1)
- Validation block at PreferencesSheet.tsx:692-695
- `<ToggleSection>` component
