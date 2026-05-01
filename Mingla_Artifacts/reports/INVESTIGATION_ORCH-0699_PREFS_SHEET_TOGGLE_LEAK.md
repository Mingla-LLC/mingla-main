# INVESTIGATION — ORCH-0699: Preferences Sheet Toggle Leak

> **Mode:** INVESTIGATE (forensics, no fix)
> **Severity:** S1-high (`bug` + `ux` + `data-integrity`)
> **Surface:** Consumer Mingla mobile (`app-mobile/`) — Preferences sheet on Discover/HomePage
> **Reporter:** Operator, 2026-05-01
> **Investigator:** /mingla-forensics
> **Dispatch:** [prompts/FORENSICS_ORCH-0699_PREFS_SHEET_TOGGLE_LEAK.md](../prompts/FORENSICS_ORCH-0699_PREFS_SHEET_TOGGLE_LEAK.md)
> **Confidence:** **HIGH** — root cause traced end-to-end through code (UI state → save handler → DB → cache → deck-param builder → query key → wire payload → edge function). All six fields filled. No "probable" claims.

---

## 1. Executive Summary (5 lines)

The "See curated experiences?" and "See popular options?" toggles on the Preferences sheet are **decorative**: they hide the pill UI and persist a boolean to the DB, but no code on the deck-generation path ever reads that boolean. Pills selected inside a toggled-off section are passed straight through to the deck request because the deck-param builder reads `userPrefs.categories` / `userPrefs.intents` raw and ignores `userPrefs.intent_toggle` / `userPrefs.category_toggle`. **Solo (`stableDeckParams`) and collab (`aggregateCollabPrefs`) are both broken.** Wire payload to the `discover-cards` edge function never carries toggle state; query key in `useDeckCards` never includes it. The toggle bool is in the data contract but absent from the query contract — a half-completed feature shipped under ORCH-0434.

---

## 2. Surface Map (G1)

| Element | File:Line | Notes |
|---|---|---|
| Sheet root | [PreferencesSheet.tsx:142](../../app-mobile/src/components/PreferencesSheet.tsx#L142) | `export default function PreferencesSheet(...)` |
| **"See curated experiences?" toggle** | [PreferencesSheet.tsx:1096-1114](../../app-mobile/src/components/PreferencesSheet.tsx#L1096-L1114) | `<ToggleSection title="See curated experiences?" isOn={intentToggle} onToggle={handleIntentToggleChange} disabled={!categoryToggle}>` |
| Curated pills (children of curated toggle) | [PreferencesSheet.tsx:1103-1113](../../app-mobile/src/components/PreferencesSheet.tsx#L1103) | `<ExperienceTypesSection experienceTypes={experienceTypes} selectedIntents={selectedIntents} onIntentToggle={handleIntentToggle} ...>` |
| **"See popular options?" toggle** | [PreferencesSheet.tsx:1123-1136](../../app-mobile/src/components/PreferencesSheet.tsx#L1123-L1136) | `<ToggleSection title="See popular options?" isOn={categoryToggle} onToggle={handleCategoryToggleChange} disabled={!intentToggle}>` |
| Popular pills (children of popular toggle) | [PreferencesSheet.tsx:1130-1135](../../app-mobile/src/components/PreferencesSheet.tsx#L1130) | `<CategoriesSection filteredCategories={filteredCategories} selectedCategories={selectedCategories} onCategoryToggle={handleCategoryToggle} ...>` |
| Toggle wrapper component | [PreferencesSheet/ToggleSection.tsx:29-73](../../app-mobile/src/components/PreferencesSheet/ToggleSection.tsx#L29-L73) | Conditionally renders children: `{isOn && <View>{children}</View>}` (line 61) — **visual gate only** |
| Curated pills component | [PreferencesSheet/PreferencesSections.tsx:27-122](../../app-mobile/src/components/PreferencesSheet/PreferencesSections.tsx#L27-L122) | `ExperienceTypesSection` — dumb component, no internal pill state |
| Popular pills component | [PreferencesSheet/PreferencesSections.tsx:150-235](../../app-mobile/src/components/PreferencesSheet/PreferencesSections.tsx#L150-L235) | `CategoriesSection` — dumb component, no internal pill state |

**Key observation (visual gate only):** `<ToggleSection>` at [ToggleSection.tsx:61](../../app-mobile/src/components/PreferencesSheet/ToggleSection.tsx#L61) does `{isOn && <View>{children}</View>}` — when toggle goes off, children unmount. But the pill state lives in `<PreferencesSheet>` (the parent), not in the children. React preserves parent state when children unmount, so pill arrays survive the toggle flip.

---

## 3. State Map (G2)

| State | File:Line | Type | Initial |
|---|---|---|---|
| `selectedIntents` (curated pill IDs) | [PreferencesSheet.tsx:203](../../app-mobile/src/components/PreferencesSheet.tsx#L203) | `string[]` | `[]` |
| `intentToggle` (curated section enabled) | [PreferencesSheet.tsx:206](../../app-mobile/src/components/PreferencesSheet.tsx#L206) | `boolean` | `true` |
| `categoryToggle` (popular section enabled) | [PreferencesSheet.tsx:207](../../app-mobile/src/components/PreferencesSheet.tsx#L207) | `boolean` | `true` |
| `selectedCategories` (popular pill IDs) | [PreferencesSheet.tsx:210](../../app-mobile/src/components/PreferencesSheet.tsx#L210) | `string[]` | `[]` |

**Toggle change handlers — pills are NEVER cleared:**

```ts
// PreferencesSheet.tsx:542-548
const handleIntentToggleChange = useCallback((newValue: boolean) => {
  if (!newValue && !categoryToggle) {
    toastManager.warning(t('preferences:experience_types.min_message'), 2000);
    return;
  }
  setIntentToggle(newValue);   // ← no setSelectedIntents([]) here
}, [categoryToggle, t]);

// PreferencesSheet.tsx:550-556
const handleCategoryToggleChange = useCallback((newValue: boolean) => {
  if (!newValue && !intentToggle) {
    toastManager.warning(t('preferences:categories.min_message'), 2000);
    return;
  }
  setCategoryToggle(newValue); // ← no setSelectedCategories([]) here
}, [intentToggle, t]);
```

Toggle and pill state are **separate fields with no coupling**. Flipping a toggle only flips one bool — pill arrays remain populated.

**Validation logic (already toggle-aware — proves the contract was meant to gate):**

```ts
// PreferencesSheet.tsx:692-695
const intentsOk = !intentToggle || selectedIntents.length > 0;
const categoriesOk = !categoryToggle || selectedCategories.length > 0;
const atLeastOneToggle = intentToggle || categoryToggle;
```

The form-validity check correctly treats toggle-off as "this section's pills don't matter." The same gating logic is **absent from the deck-param builder downstream**.

---

## 4. Request Path Trace (G3)

### 4a. Solo path: `handleApplyPreferences` → `onSave(preferences)` → `AppHandlers.handleSavePreferences`

`PreferencesSheet.tsx` payload built at [821-838](../../app-mobile/src/components/PreferencesSheet.tsx#L821-L838):

```ts
const finalCategories = selectedCategories;      // line 817 — RAW, no gate
const finalIntents = selectedIntents;            // line 818 — RAW, no gate

const preferences = {
  selectedIntents: finalIntents,                 // line 822 — passed raw
  selectedCategories: finalCategories,           // line 823 — passed raw
  ...
  intentToggle,                                  // line 836 — bool included separately
  categoryToggle,                                // line 837 — bool included separately
};

await Promise.resolve(onSave(preferences));      // line 907 — solo path
```

`AppHandlers.tsx` write to DB + optimistic cache at [442-491](../../app-mobile/src/components/AppHandlers.tsx#L442-L491):

```ts
const dbPreferences: any = {
  ...
  categories: soloCats,                          // line 445 — raw pills
  intents: soloIntents,                          // line 446 — raw pills
  ...
  intent_toggle: preferences.intentToggle ?? true,    // line 459 — bool
  category_toggle: preferences.categoryToggle ?? true, // line 460 — bool
};

queryClient.setQueryData(["userPreferences", user.id], {
  ...
  categories: dbPreferences.categories,          // line 477 — raw in cache
  intents: dbPreferences.intents || [],          // line 478 — raw in cache
  ...
  intent_toggle: dbPreferences.intent_toggle,    // line 488 — bool in cache
  category_toggle: dbPreferences.category_toggle, // line 489 — bool in cache
});
```

**Verdict:** Solo write puts BOTH raw pill arrays AND toggle bools into DB and React Query cache. The cache shape is correct (data is present); the leak is downstream.

### 4b. Collab path: `handleApplyPreferences` → `updateBoardPreferences(dbPrefs)`

[PreferencesSheet.tsx:874-892](../../app-mobile/src/components/PreferencesSheet.tsx#L874-L892):

```ts
const rawDbPrefs: any = {
  categories: finalCategories,                   // line 875 — raw pills
  intents: finalIntents,                         // line 876 — raw pills
  ...
  intent_toggle: intentToggle,                   // line 890 — bool
  category_toggle: categoryToggle,               // line 891 — bool
};
```

Same shape as solo. Both pills and toggles persist; gating is downstream's responsibility.

---

## 5. Consumption Path Trace (G4) — THE LEAK

### 5a. Solo: `stableDeckParams` in `RecommendationsContext.tsx`

**[RecommendationsContext.tsx:482-513](../../app-mobile/src/contexts/RecommendationsContext.tsx#L482-L513):**

```ts
const stableDeckParams = useMemo(() => {
  const rawCats = userPrefs?.categories ?? [];           // line 485 — reads raw pills
  const cats = rawCats.length > 0 ? normalizeCategoryArray(rawCats) : [];
  const ints = userPrefs?.intents ?? [];                 // line 487 — reads raw pills

  if (cats.length === 0 && ints.length === 0 && isLoadingPreferences) return null;

  const hasAnySignal = cats.length > 0 || ints.length > 0;
  return {
    categories: cats.length > 0
      ? cats
      : hasAnySignal
        ? []
        : ["nature", "drinks_and_music", "icebreakers"],
    intents: ints,                                       // line 504 — passes raw
  };
}, [
  JSON.stringify(userPrefs?.categories ?? []),           // line 509 — deps: pills only
  JSON.stringify(userPrefs?.intents ?? []),              // line 511 — deps: pills only
  isLoadingPreferences,
]);
```

**Negative grep proof — toggles are not consulted in this builder:**

```bash
$ grep -nE 'intent_toggle|category_toggle' app-mobile/src/contexts/RecommendationsContext.tsx
80:  intent_toggle: true,         # ← only in DEFAULT_PREFERENCES literal
81:  category_toggle: true,
```

Outside the default-prefs literal at line 80-81, the file never references `intent_toggle` or `category_toggle`. **`stableDeckParams` ignores the toggle.**

### 5b. Collab: `aggregateCollabPrefs` in `sessionPrefsUtils.ts`

**[sessionPrefsUtils.ts:48-146](../../app-mobile/src/utils/sessionPrefsUtils.ts#L48-L146):**

```ts
// Categories: UNION (R3.1) — combine everyone's categories, deduplicate
const categorySet = new Set<string>();
for (const row of rows) {
  for (const cat of (row.categories || [])) {           // line 69 — reads raw pills
    categorySet.add(cat);
  }
}

// Intents: UNION (R3.9) — combine everyone's intents, deduplicate
const intentSet = new Set<string>();
for (const row of rows) {
  for (const intent of (row.intents || [])) {           // line 77 — reads raw pills
    intentSet.add(intent);
  }
}
```

The aggregator iterates `row.categories` and `row.intents` directly. **Each row's `intent_toggle` / `category_toggle` is never inspected.** A participant who toggled curated experiences OFF still contaminates the union with their pill selection.

### 5c. The hook layer: `useDeckCards`

**[useDeckCards.ts:40-58](../../app-mobile/src/hooks/useDeckCards.ts#L40-L58)** — `DeckQueryKeyParams` interface:

```ts
export interface DeckQueryKeyParams {
  mode?: 'solo' | 'collab';
  sessionId?: string;
  lat: number;
  lng: number;
  categories: string[];                     // ← pills only
  intents: string[];                        // ← pills only
  travelMode: string;
  travelConstraintType: string;
  travelConstraintValue: number;
  datetimePref?: string;
  dateOption?: string;
  batchSeed: number;
  excludeCardIds?: string[];
}
```

**No toggle field.** The query key (`buildDeckQueryKey`, [lines 66-78](../../app-mobile/src/hooks/useDeckCards.ts#L66-L78)) hashes pills + travel + date + seed only. Flipping a toggle does not change the key, so React Query does **not** invalidate or refetch. The toggle is invisible to the cache layer.

### 5d. The wire: `deckService.fetchDeck` → `discover-cards` edge function

**[deckService.ts:401-415](../../app-mobile/src/services/deckService.ts#L401-L415):**

```ts
const { data, error } = await Promise.race([
  trackedInvoke('discover-cards', {
    body: {
      categories: categoryNames,            // line 403 — pills only
      location: params.location,
      travelMode: params.travelMode,
      travelConstraintType: params.travelConstraintType,
      travelConstraintValue: params.travelConstraintValue,
      datetimePref: params.datetimePref,
      dateOption: params.dateOption,
      batchSeed: params.batchSeed,
      limit: categoryLimit,
      excludeCardIds: params.excludeCardIds,
      dateWindows: params.dateWindows,
      sessionId: params.sessionId,
    },
  }),
  timeoutPromise,
]);
```

**No `intent_toggle` / `category_toggle` field in the wire body.** Confirmed via:

```bash
$ grep -rE 'intent_toggle|category_toggle' supabase/functions/discover-cards/
(no matches)
```

The edge function never sees the toggle. Even if it wanted to gate, the data isn't there.

---

## 6. Root Cause Classification (G5) — **Class (b)**

> **(b) Payload-builder reads pills but never reads toggle → toggle has no consumer downstream.**

### Six-field evidence:

| Field | Value |
|---|---|
| **File + line** | [`app-mobile/src/contexts/RecommendationsContext.tsx:482-513`](../../app-mobile/src/contexts/RecommendationsContext.tsx#L482-L513) (solo) and [`app-mobile/src/utils/sessionPrefsUtils.ts:48-146`](../../app-mobile/src/utils/sessionPrefsUtils.ts#L48-L146) (collab) |
| **Exact code** | Solo: `const ints = userPrefs?.intents ?? [];` then `return { categories: ..., intents: ints }`. Collab: `for (const intent of (row.intents \|\| [])) intentSet.add(intent);` |
| **What it does** | Reads `userPrefs.categories` and `userPrefs.intents` directly. Returns them to `useDeckCards` as the deck-fetch params. |
| **What it should do** | Compute *effective* categories/intents by gating on toggle: `effectiveIntents = intent_toggle ? ints : []` and `effectiveCategories = category_toggle ? cats : []` (same pattern the in-sheet validation already uses at [PreferencesSheet.tsx:692-695](../../app-mobile/src/components/PreferencesSheet.tsx#L692-L695)). |
| **Causal chain** | (1) User selects pills inside section X → `setSelectedX([...ids])`. (2) User flips toggle X off → `setXToggle(false)` only; pill state preserved. (3) User taps Apply → payload includes `selectedIntents/selectedCategories: <raw>` and `intentToggle/categoryToggle: false`. (4) `AppHandlers.handleSavePreferences` writes BOTH raw pills and toggle bools to DB row + optimistic React Query cache. (5) `userPreferences` cache now has `{ categories: [...], intents: [...], intent_toggle: false, category_toggle: false }`. (6) `RecommendationsContext.stableDeckParams` reads `userPrefs.intents` (raw) and `userPrefs.categories` (raw); never reads either toggle bool. (7) Pills flow to `useDeckCards` → query key includes raw pills → `deckService.fetchDeck` → wire payload `{ categories: [...] }` to `discover-cards`. (8) Edge function returns cards filtered by those pills. (9) User sees cards driven by pills they thought they had disabled. |
| **Verification step** | (a) Open Preferences sheet, select a curated pill (e.g. "romantic"), select a popular category pill (e.g. "drinks_and_music"). Apply. Observe deck reflects both. (b) Reopen sheet, flip "See curated experiences?" toggle OFF. Apply. (c) Observe React Query devtools or `[useDeckCards] partial delivery:` debug log: query key still contains `"romantic"` in the intents segment; cards are unchanged. (d) Confirm `userPrefs.intent_toggle === false` in cache but `userPrefs.intents === ["romantic"]` and the deck still shows romantic-curated experiences. (e) Patch test: force `stableDeckParams` to return `{ categories: [], intents: [] }` when both toggles are false — confirm deck switches to empty-state UI, proving the gate works at this layer. |

### Why it's NOT (a), (c), or (d):

- **(a) Pill state never cleared:** True observationally (pills aren't cleared, see [PreferencesSheet.tsx:542-556](../../app-mobile/src/components/PreferencesSheet.tsx#L542-L556)), but this is intentional UX — the user expects to flip toggle back on without re-picking pills. Clearing pills on toggle-off would be a worse fix because it deletes user intent. So preserving pills is correct; the gate must be applied at consumption, not by destroying state.
- **(c) Consumer (RPC/edge fn) ignores toggle:** True downstream consequence, but the edge function never receives the toggle in the first place (wire payload contains zero toggle data — see §5d grep). The leak originates at the deck-param-build site, not at the edge function. Fixing only the edge function would still require plumbing toggle through the wire payload + query key + hook interface; fixing at the deck-param builder requires zero edge-function changes.
- **(d) Combination:** The pill-not-cleared observation (a) is real but intentional/desirable. The single defect is (b).

**Restatement:** ORCH-0434 (the migration that introduced the toggle columns) updated the in-sheet validation logic to be toggle-aware ([PreferencesSheet.tsx:692-695](../../app-mobile/src/components/PreferencesSheet.tsx#L692-L695)) and updated the save path to persist the bools — but never updated the deck-param consumers to honor them. **This is a half-completed feature, not a regression.** The toggle has been decorative since it was introduced.

---

## 7. Solo + Collab Parity (G6)

**Both broken with the same architectural defect, in two different files:**

| Mode | Defect Site | Builder | Reads pills? | Reads toggle? |
|---|---|---|---|---|
| Solo | [RecommendationsContext.tsx:482-513](../../app-mobile/src/contexts/RecommendationsContext.tsx#L482-L513) | `stableDeckParams` | ✅ Yes (lines 485, 487) | ❌ No |
| Collab | [sessionPrefsUtils.ts:48-146](../../app-mobile/src/utils/sessionPrefsUtils.ts#L48-L146) | `aggregateCollabPrefs` | ✅ Yes (lines 69, 77) | ❌ No |

Per the memory rule "Solo + Collab Parity": both must be fixed in the same spec. The collab leak is arguably worse — Participant A's hidden pills contaminate everyone else's deck (because aggregation is UNION, line 67 + 75 of `sessionPrefsUtils.ts`), so a single user's stale, supposedly-disabled pill can derail the group.

**Negative-grep proof (collab):**

```bash
$ grep -nE 'intent_toggle|category_toggle' app-mobile/src/utils/sessionPrefsUtils.ts
(no matches)
```

---

## 8. Pattern Blast Radius (G7) — **Contained**

`<ToggleSection>` is mounted exactly twice in the entire Preferences sheet:

```bash
$ grep -nE 'ToggleSection|<Switch' app-mobile/src/components/PreferencesSheet.tsx
59:  import { ToggleSection } from './PreferencesSheet/ToggleSection';
1096: <ToggleSection ... title="See curated experiences?" ...>
1114: </ToggleSection>
1123: <ToggleSection ... title="See popular options?" ...>
1136: </ToggleSection>
```

Both leak. No other section uses the same gate-pattern.

**Other toggle-like controls audited (NOT the same pattern, NOT broken):**

- **GPS toggle** in `PreferencesSheetSectionsAdvanced.tsx`: `useGpsLocation` boolean controls a binary "use GPS vs use custom address" with mutually exclusive UI states ([line 168](../../app-mobile/src/components/PreferencesSheet/PreferencesSectionsAdvanced.tsx#L168)). The save handler at [PreferencesSheet.tsx:805-807](../../app-mobile/src/components/PreferencesSheet.tsx#L805-L807) correctly reads `useGpsLocation` to choose `customLocationValue = useGpsLocation ? null : searchLocation`. **Properly gated.**
- **Travel mode pills** ([PreferencesSheet.tsx:1147-1150](../../app-mobile/src/components/PreferencesSheet.tsx#L1147)): single-select, no toggle wrapper — N/A.
- **Date option** ([PreferencesSheet.tsx:222-223](../../app-mobile/src/components/PreferencesSheet.tsx#L222)): single-select with optional multi-day calendar — single value, no toggle gating concept — N/A.

**Verdict:** ORCH-0699 is a **single class of bug occupying both `<ToggleSection>` instances**, NOT a sheet-wide systemic class. Fix scope is bounded.

---

## 9. Five-Truth-Layer Reconciliation (G8)

| Layer | What it says | Contradicts? |
|---|---|---|
| **Docs** | No PRD/spec found documenting toggle-off semantics. The closest in-code doc is the comment at [migration:7](../../supabase/migrations/20260415100000_orch0434_phase1_slug_migration.sql#L7) saying "Adds intent_toggle, category_toggle, selected_dates columns" — purpose unstated. The validation block at [PreferencesSheet.tsx:692-695](../../app-mobile/src/components/PreferencesSheet.tsx#L692-L695) implicitly documents the intent: toggle-off means "ignore pills in this section." | ⚠️ Implicit contract from validation contradicts deck-param builder behavior. |
| **Schema** | `preferences.intent_toggle boolean NOT NULL DEFAULT true` + `category_toggle` exist on both `preferences` (solo) and `board_session_preferences` (collab) tables — see [migration:50-58](../../supabase/migrations/20260415100000_orch0434_phase1_slug_migration.sql#L50-L58). Schema enforces presence and a default of true. | ❌ Schema carries the bool that no consumer reads → dead data column. |
| **Code** | Save layer writes toggle bool. Validation layer reads it correctly. **Deck-param builders ignore it** (RecommendationsContext + sessionPrefsUtils). Hook layer (`useDeckCards`) has no toggle field. Wire layer (`deckService`) does not transmit it. Edge function (`discover-cards`) does not consume it. | ❌ Save and validation contradict deck-param/hook/wire/edge layers. |
| **Runtime** | The actual `discover-cards` invocation body contains only `categories: <pill array>` — no toggle. Verified via [deckService.ts:401-415](../../app-mobile/src/services/deckService.ts#L401-L415). Live runtime proof not required because the static code path is unambiguous (single `trackedInvoke` site, single body shape). | ❌ Wire payload omits toggle entirely. |
| **Data** | DB row stores toggle bool correctly. React Query `userPreferences` cache stores toggle bool correctly. Both are persistently lying to themselves: the value is recorded but ignored. | ❌ Persisted state contradicts effective state — user sees the same deck regardless of toggle value. |

**Reconciliation verdict:** **The data layer holds truth that the query layer doesn't read.** Five layers disagree along the same fault line: docs/schema/data/save/validation say "toggle gates the section" (tier A); deck-param/hook/wire/edge say "toggle doesn't exist" (tier B). The fix must teach tier B to honor what tier A already records.

---

## 10. Discoveries (D-OBS)

### D-OBS-1 — ORCH-0434 shipped a half-completed feature
The migration that added `intent_toggle` / `category_toggle` columns ([20260415100000_orch0434_phase1_slug_migration.sql](../../supabase/migrations/20260415100000_orch0434_phase1_slug_migration.sql)) updated the in-sheet validation block ([PreferencesSheet.tsx:692-695](../../app-mobile/src/components/PreferencesSheet.tsx#L692-L695)) to be toggle-aware AND added save-path persistence — but never updated the deck-param consumers (`stableDeckParams`, `aggregateCollabPrefs`) to gate on the new columns. **Process suggestion:** ORCH-0434's spec/test plan likely had a coverage gap for "toggle actually changes the deck" — recommend orchestrator codify a contract-completeness rule when adding a new gating field. (Not investigated further; flagged for orchestrator triage.)

### D-OBS-2 — Toggle propagation across session creation IS correct (no fix needed there)
[`useSessionManagement.ts:418-419`](../../app-mobile/src/hooks/useSessionManagement.ts#L418-L419) and [`accept-tag-along/index.ts:200-201`](../../supabase/functions/accept-tag-along/index.ts#L200-L201) + [`303-304`](../../supabase/functions/accept-tag-along/index.ts#L303-L304) DO copy `intent_toggle` / `category_toggle` forward when seeding new collab sessions or accepting tag-along invites. So the toggle column propagates correctly across writes — **the fix is read-side only, no edge function or session-creation changes required**.

### D-OBS-3 — Query-key invalidation will work for free post-fix
`buildDeckQueryKey` at [useDeckCards.ts:66-78](../../app-mobile/src/hooks/useDeckCards.ts#L66-L78) hashes raw `categories` and `intents`. After the fix is applied at the deck-param-build site (effective arrays = empty when toggle off), flipping a toggle will mutate the effective array → query key changes → React Query refetches automatically. **No key-shape change needed.** The fix is a pure read-side gate at exactly two call sites.

### D-OBS-4 — Mixpanel telemetry already records toggle counts wrong
[PreferencesSheet.tsx:910-924](../../app-mobile/src/components/PreferencesSheet.tsx#L910-L924) emits `appsflyer.preferences_updated` with `categories_count: finalCategories.length, intents_count: finalIntents.length` and Mixpanel `trackPreferencesUpdated` with the raw `intents` and `categories` arrays. Today these reflect raw counts, not effective counts. After the fix, telemetry should record effective counts (post-gate) so analytics align with what the user actually applied. Out of scope for ORCH-0699 spec but flagged. (Not blocking — fix can be a follow-up.)

### D-OBS-5 — `discover-cards` source-of-truth confirmation
The edge function never receives toggle data, so the spec's fix surface is bounded to `app-mobile/src/contexts/RecommendationsContext.tsx` + `app-mobile/src/utils/sessionPrefsUtils.ts`. **Two surgical changes, single PR.** No SQL migration. No edge function redeploy. OTA-eligible.

---

## 11. Recommended Next Step

**Spec the gate at the deck-param-build sites** (two surgical changes, no edge-function or schema work). One spec, one implementor pass, one tester pass. Solo + collab covered together per parity rule.
