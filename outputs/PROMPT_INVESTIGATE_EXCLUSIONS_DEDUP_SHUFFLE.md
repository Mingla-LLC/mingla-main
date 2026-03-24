# Investigation Prompt: Exclusions Parity, Paired View Dedup, Shuffle Latency

**Skill:** Software and Code Architect (Investigator Mode)
**Date:** 2026-03-24
**Scope:** 3 specific bugs. Deep forensic trace for each. Cite exact file:line evidence.

---

## Bug 1: Exclusion Parity Between discover-cards and discover-experiences

**User report:** Cards in the "For You" pills (discover-experiences) include venues that should be excluded — kids venues, farmers markets, gyms, etc. The swipe deck (discover-cards) correctly excludes these.

**What to investigate:**

1. Read `supabase/functions/discover-cards/index.ts` and trace how exclusions are applied:
   - Is there a `category_type_exclusions` table check?
   - Is there an `isChildVenueName()` filter?
   - Is there a `dog_park` global exclusion?
   - Are there keyword-based exclusions (schools, gyms, farmers markets)?
   - At what point in the pipeline are these applied? (SQL RPC? Post-fetch JS filter? Both?)

2. Read `supabase/functions/discover-experiences/index.ts` and trace the SAME exclusion points:
   - Does it use the same `query_pool_cards` RPC or a different query?
   - Does it have `category_type_exclusions` enforcement?
   - Does it have `isChildVenueName()` or equivalent?
   - Does it have `dog_park` global exclusion?
   - Does it have keyword exclusions?

3. Create a side-by-side comparison table:
   | Exclusion Type | discover-cards | discover-experiences | Match? |

4. For any mismatches: identify the exact file:line where the exclusion is missing.

5. Also check `supabase/functions/generate-curated-experiences/index.ts` — curated card generation. Does IT apply the same exclusions when selecting places for stops?

---

## Bug 2: Card Repetition Across Paired Person View Sections

**User report:** The same cards appear in multiple sections of PersonHolidayView — hero cards, upcoming holidays, and custom holidays show duplicates.

**What to investigate:**

1. Read `app-mobile/src/components/PersonHolidayView.tsx` — how does it render sections?
   - How many calls to `usePairedCards` (or equivalent) are made?
   - Does each section get its own query with different params?
   - Is there any cross-section dedup?

2. Read `app-mobile/src/hooks/usePairedCards.ts` — what params differentiate queries?
   - Query key: does it include holiday/section identifier?
   - Does it pass `excludeCardIds` from other sections?

3. Read `supabase/functions/get-person-hero-cards/index.ts` — does it accept an exclusion list?
   - Is there a param for "exclude these card IDs" that the client could use?
   - Does it use `person_card_impressions` to avoid showing the same card twice?

4. Trace the exact dedup mechanism (or lack thereof):
   - Birthday section → fetches cards with categories X
   - Holiday 1 section → fetches cards with categories Y
   - Holiday 2 section → fetches cards with categories Z
   - Custom holiday section → fetches cards with categories W
   - If categories overlap (e.g., both holidays want "casual_eats"), the same venue appears in both

5. Is there a `p_exclude_card_ids` parameter that COULD be used for cross-section dedup? If so, why isn't the client passing accumulated IDs?

---

## Bug 3: Shuffle Button Latency

**User report:** The shuffle button in PersonHolidayView takes too long to respond.

**What to investigate:**

1. Find the shuffle button handler in PersonHolidayView or its children.
   - What does "shuffle" do? Refetch cards? Rotate cached cards? Reset impressions?
   - Is it awaited? Fire-and-forget?

2. Trace the full chain from button press to new cards appearing:
   - Does it invalidate React Query cache?
   - Does it call the edge function again?
   - Does it hit the `query_person_hero_cards` RPC (the one with the radius expansion loop)?
   - How long does each step take?

3. Is the shuffle button disabled/loading during the fetch? Or does the user press it and nothing happens for seconds?

4. Cross-reference with INVESTIGATION_PAIRED_HOLIDAY_CARD_LATENCY.md — the radius expansion loop was already identified as a 300-640ms bottleneck per call. If shuffle triggers N parallel calls (one per section), the total latency = N × loop time.

5. Is there a way to shuffle from client-side cache instead of re-fetching? (e.g., fetch 10 cards, show 3, shuffle shows next 3)

---

## Output Format

Write findings to `outputs/INVESTIGATION_EXCLUSIONS_DEDUP_SHUFFLE.md` with:

```markdown
## Bug 1: Exclusion Parity
### Facts (file:line evidence)
### Side-by-Side Comparison Table
### Missing Exclusions (exact locations)

## Bug 2: Paired View Card Repetition
### Facts (file:line evidence)
### Dedup Mechanism (or lack thereof)
### Root Cause

## Bug 3: Shuffle Latency
### Facts (file:line evidence)
### Latency Breakdown
### Root Cause

## Recommendations (prioritized)
```

**CRITICAL:** Do NOT include summary paragraphs. Just the facts and findings.
**CRITICAL:** Cite exact file:line for every claim.
**CRITICAL:** For Bug 1, the comparison table is mandatory — the user needs to see exactly which exclusions are missing where.
