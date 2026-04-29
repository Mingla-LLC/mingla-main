# Curated Experience Template

How to add a new curated experience (intent) to Mingla.

A "curated experience" is a multi-stop plan template — Romantic, First Date, Group Fun, Adventurous, Take a Stroll, Picnic Dates. Users see one card per intent and can swipe through plan variations within it. Each plan is built from real places (place_pool) ranked by signal scores (place_scores).

The serving function is `index.ts` in this folder. All experience definitions live in that file.

---

## What you need to add a new experience

Adding a new experience touches **5 declarations** in `index.ts`. They all live in the top half of the file. None require changes elsewhere in the codebase.

### 1. The experience definition itself — `EXPERIENCE_TYPES`

The main array, around line 128. Add one new object with this shape:

```typescript
{
  id: 'your-intent-slug',         // kebab-case, used in URLs / events
  label: 'Your Intent Label',     // human display name
  stops: [                         // shape of a plan: how many stops, what role each plays
    { role: 'auto' },              // 'auto' = label derived from slug. Or hardcode 'Activity'/'Dinner'/etc.
    { role: 'auto', optional: true, dismissible: true },
    // optional?: stop is skipped if no eligible places found (instead of failing the combo)
    // dismissible?: user can hide this stop in the mobile UI
    // reverseAnchor?: find this stop FIRST, then query others near it (used by Picnic for park-first ordering)
  ],
  combos: [                        // each entry is a plan variation. Length must match stops length.
    ['slug_for_stop_0', 'slug_for_stop_1'],
    ['slug_for_stop_0', 'slug_for_stop_1'],
    // … as many combos as you want
  ],
  taglines: [                      // randomized card subtitle
    'A great line for the card',
    'Another randomized option',
  ],
  descriptionTone: 'group',        // pick from existing union type, or extend it (see Description Tones below)
}
```

### 2. Optional — per-stop vibe ranking — `EXPERIENCE_RANK_SIGNAL_OVERRIDE`

Around line 407. Use this if a stop should be ranked by a *different* signal than its filter signal. Example: First Date's `play` stop filters by `play` (eligibility) but ranks by `icebreakers` (vibe — pulls casual conversation-friendly play places to the top, not just the most "play-iest" places).

```typescript
'your-intent-slug': {
  'play': 'icebreakers',           // play stop ranked by icebreakers vibe
  'upscale_fine_dining': 'romantic', // dinner stop ranked by romantic vibe
  // any slug not listed → falls back to ranking by its own filter signal
},
```

### 3. Optional — slug → filter signal — `COMBO_SLUG_TO_FILTER_SIGNAL`

Around line 387. **Skip this if your combos use slugs that already have a filter signal mapping.** Add an entry only if you're introducing a brand-new slug that wasn't already used by an existing experience.

```typescript
'your_new_slug': 'name_of_existing_signal',  // e.g. 'hiking': 'nature'
```

### 4. Optional — slug → required types — `COMBO_SLUG_TYPE_FILTER`

Around line 414. Use this if your new slug needs to narrow an existing signal to specific Google Places types. Example: `hiking` reuses the `nature` signal but only places whose `place_pool.types` overlaps with `['hiking_area', 'state_park', ...]` should pass; `museum` reuses `creative_arts` but only places whose types overlap with `['museum', 'art_museum']` pass.

```typescript
'your_new_slug': ['google_type_1', 'google_type_2', 'google_type_3'],
```

### 5. Optional — slug → display label — `SLUG_TO_STOP_ROLE`

Around line 478. Used **only if your stops have `role: 'auto'`**. Maps each slug to the human label shown to users for that stop.

```typescript
'your_new_slug': 'Display Label',  // e.g. 'hiking': 'Hike', 'museum': 'Museum'
```

If your stops have hardcoded roles (`role: 'Activity'`), you don't need this — the hardcoded label wins.

---

## When you might NOT need a new signal

A new experience does **not** automatically require a new signal. The 14 active signals (brunch, casual_food, creative_arts, drinks, fine_dining, flowers, icebreakers, lively, movies, nature, picnic_friendly, play, romantic, scenic, theatre) cover most use cases. Mix and match.

A new signal is only needed if:
- The vibe you want to surface doesn't exist (Cozy, Sexy, Hidden Gem, Iconic — all unbuilt)
- You need a different filter dimension that doesn't fit any existing signal

To add a signal, see the migrations under `supabase/migrations/*orch_*signal*.sql` for the seed pattern (signal_definitions row + signal_definition_versions row + run-signal-scorer backfill).

---

## A complete example — adding "Solo Adventure"

Hypothetical: a solo-friendly intent for one-person-friendly experiences.

```typescript
// 1. EXPERIENCE_TYPES
{
  id: 'solo-adventure',
  label: 'Solo Adventure',
  stops: [
    { role: 'auto' },              // first stop label derived from combo slug
    { role: 'auto' },              // second stop label derived from combo slug
  ],
  combos: [
    ['creative_arts', 'casual_food'],   // Make something with hands → casual bite
    ['museum',        'casual_food'],   // Museum visit → casual bite
    ['hiking',        'casual_food'],   // Solo hike → casual bite
  ],
  taglines: [
    'Time for yourself, perfectly planned',
    'Solo, but never lonely',
    'Adventure on your own terms',
  ],
  descriptionTone: 'adventure',
}

// 2. EXPERIENCE_RANK_SIGNAL_OVERRIDE
'solo-adventure': {
  'creative_arts': 'icebreakers',  // surface conversation-easy creative places, not advanced art schools
  'museum':        'icebreakers',
  'hiking':        'scenic',       // surface scenic walks over technical trails
  'casual_food':   'icebreakers',  // surface bar-counter-friendly restaurants over family booths
},

// 3, 4, 5 — none needed. hiking + museum + casual_food slugs already exist with all the supporting maps.
```

Total new code: ~25 lines in one file. Deploy `generate-curated-experiences` edge function. Done.

---

## Description tones

In `EXPERIENCE_TYPES`, the `descriptionTone` field picks which AI description function generates per-stop copy. Today's options:

| Tone | Used by | What it does |
|---|---|---|
| `'romantic'` | Romantic | Warm, intimate copy. Custom prompt. |
| `'stroll'` | Take a Stroll | Calm, observational copy. Custom prompt. |
| `'picnic'` | Picnic Dates | Plus a generated shopping list for the grocery stop. |
| `'group'` | Group Fun | Falls through to generic copy (no per-tone customization yet). |
| `'firstdate'` | First Date | Falls through to generic copy. |
| `'adventure'` | Adventurous | Falls through to generic copy. |

**Adding a new tone:** add the string literal to the union type in the `ExperienceTypeDef` interface, then add a branch in the description-routing logic (search for `descriptionTone === 'romantic'` to find the dispatch site). To get truly distinctive copy, also write a new generator function modeled on `generateRomanticStopDescriptions` or `generateStrollStopDescriptions`. If you skip this and use an existing tone, the experience will still ship — it just won't have a unique voice in its AI descriptions.

---

## What the serving function does for you (so you don't have to)

When a user requests cards for your new experience, `generateCardsForType()` automatically:

1. Walks each combo
2. For each slug in the combo:
   - Resolves filter signal (chip-own or the override map)
   - Resolves rank signal (override or chip-own)
   - Resolves required types if any (sub-filtering)
   - Calls `fetchSinglesForSignalRank()` if any signal-aware path is configured, else legacy `fetchSinglesForCategory()`
3. Anchors the highest-quality first stop, proximity-chains the rest
4. Builds card stops with the right role label, travel times, prices
5. Generates AI descriptions via the routed tone
6. Returns the card to the deck

You declare the *what*; the function handles the *how*.

---

## Constraints to be aware of

- **`combos[i].length` must equal `stops.length`.** Mismatched combos silently skip.
- **Every slug in your combos must resolve to a filter signal** (either via `COMBO_SLUG_TO_FILTER_SIGNAL` or by being a direct signal id). Unresolvable slugs fail at runtime.
- **Stops with `optional: true` are silently skipped** if no eligible places are found. Non-optional stops failing causes the entire combo to be dropped.
- **`reverseAnchor: true` is special** — only Picnic Dates uses it. The anchor stop is queried first; other stops are constrained to a 3km radius around the anchor. Don't use this unless you want park-first behavior.
- **One experience produces one card with multiple combo variations.** Users swipe through combos within a single intent card; they don't see multiple cards per intent.
- **The template scatter is intentional but imperfect.** All five maps could one day be collapsed into the `ExperienceTypeDef` itself. That's a future refactor (see the Mingla orchestrator backlog) — for now, use the pattern as-is.

---

## Where to look in the code

| Concept | File / location |
|---|---|
| `ExperienceTypeDef` interface | `index.ts` ~line 117 |
| `EXPERIENCE_TYPES` array (the actual experiences) | `index.ts` ~line 128 |
| `COMBO_SLUG_TO_FILTER_SIGNAL` | `index.ts` ~line 387 |
| `EXPERIENCE_RANK_SIGNAL_OVERRIDE` | `index.ts` ~line 407 |
| `COMBO_SLUG_TYPE_FILTER` | `index.ts` ~line 446 |
| `COMBO_SLUG_FILTER_MIN` | `index.ts` ~line 478 |
| `SLUG_TO_STOP_ROLE` | `index.ts` ~line 487 |
| `resolveStopRole()` | `index.ts` ~line 506 |
| `fetchSinglesForSignalRank()` (the workhorse) | `index.ts` ~line 323 |
| `generateCardsForType()` (the orchestrator) | `index.ts` ~line 650+ |

---

## After you ship a new experience

1. Deploy the edge function: `npx supabase functions deploy generate-curated-experiences --project-ref <ref>`
2. Test with a curl ping (verify no startup crash):
   ```
   curl -X POST <url>/functions/v1/generate-curated-experiences \
     -H "Authorization: Bearer <anon-key>" \
     -H "Content-Type: application/json" -d '{}'
   ```
   Expect: `{"error":"location.lat and location.lng are required",…}` (validation error = function loaded cleanly).
3. Make sure the chip exists in the mobile app's intent picker (check `app-mobile/src/components/...`).
4. Device-test the experience deck. Verify combos render, top picks look right.
5. Commit + EAS OTA if any mobile-visible change accompanies it.
