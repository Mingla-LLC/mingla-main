# Ve5 — Menu AI Parser → Restaurant Experiences

> **Track:** Track 2 — Physical venues
> **Duration:** 1.5 weeks
> **Depends on:** Ve4 (in TestFlight; verified venues exist), M0 (`events.event_type` discriminator)
> **Status:** locked, not started

---

## 1. User Outcome

A verified restaurant owner photographs their menu inside the business app. Gemini parses the menu and returns 8-15 candidate single-intent experiences ("Bottomless brunch Saturdays," "Date-night tasting menu for $75/head," "Group dinner under $50/head"). Each candidate surfaces as a confirmation card (accept / edit / reject) using the same `agent_pending_actions` state machine. Approved experiences become real `events` rows with `event_type='experience'` attached to the venue brand. They appear in the venue's Hub > Experiences sub-tab and (later, in C2) flow into the consumer Discover multi-stop composer.

This is the second AI shortcut in 1.2 (the first being Tr8's trip itinerary scaffolding) and follows the same Ari-pattern.

---

## 2. Smoke Test

1. Sign in as a verified Restaurant brand (from Ve3/Ve4)
2. Navigate to Hub > Experiences sub-tab → see "Snap your menu to generate experiences" CTA
3. Tap CTA, photograph (or upload) a real menu (brunch + dinner + drinks, multi-page acceptable)
4. Loading state: "Reading your menu..." (~15-30s)
5. ~10-15 confirmation cards appear, each showing: title, narrative, suggested price range, intent tags
6. Edit one card inline (rewrite narrative)
7. Reject 2 cards
8. Accept the rest
9. Hub > Experiences sub-tab populates with the approved experiences
10. **DB probe:**
    ```sql
    SELECT id, title, event_type, brand_id FROM public.events
    WHERE brand_id = <venue-brand-id> AND event_type = 'experience';
    -- Expect: count = accepted cards
    SELECT action_type, status FROM public.agent_pending_actions
    WHERE related_brand_id = <venue-brand-id>;
    -- Expect: total = generated cards; mix of accepted / rejected / accepted-with-edit
    ```
11. **Regression:** event_type='event' creation flow unaffected; venues without menu snap have empty Experiences tab

---

## 3. Acceptance Criteria

| # | Criterion |
|---|-----------|
| 1 | Hub > Experiences sub-tab gains "Generate from menu" CTA (only visible for `kind='physical'` AND `category='Restaurant'`) |
| 2 | Photo/PDF upload supports JPEG + PNG + PDF; multi-page acceptable |
| 3 | New edge function `parse-restaurant-menu` returns structured: `{experiences: [{title, narrative, suggested_price_min_cents, suggested_price_max_cents, currency, intent_tags: [...], confidence: 0.0-1.0}, ...]}` |
| 4 | Each parsed experience becomes an `agent_pending_actions` row with `action_type='experience_proposed'` |
| 5 | Confirmation card UI: title + narrative + price range + intent tags + accept / edit / reject |
| 6 | Bulk "Accept all" affordance |
| 7 | Edit: inline editing of title + narrative + price + intent tags before accept |
| 8 | Accept writes to `events` table with `event_type='experience'`, status='live', visibility='public', `brand_id=<venue-brand-id>` |
| 9 | Rejected pending actions discarded; not written to events |
| 10 | Respects `I-ARI-CONFIRM-AUTHORITY` — no auto-publish |
| 11 | Respects `I-ARI-USER-JWT-ONLY` — caller's JWT used |
| 12 | Failure modes: parsing fails → friendly retry; file too large → reject with size limit; non-menu file → empty experiences list + friendly message |

---

## 4. Files Touched

**New:**
- `mingla-business/src/components/experience/MenuSnapInput.tsx`
- `mingla-business/src/components/experience/ExperienceReviewCards.tsx`
- `mingla-business/src/components/experience/ExperienceConfirmationCard.tsx`
- `mingla-business/src/services/experienceGenerationService.ts`
- `mingla-business/src/hooks/usePendingExperiences.ts`
- `supabase/functions/parse-restaurant-menu/index.ts`
- `supabase/functions/_shared/geminiMenuParser.ts`

**Modified:**
- `mingla-business/app/(tabs)/hub/experiences.tsx` (from empty placeholder to real surface)

---

## 5. Data Model Changes

No new tables. `events.event_type='experience'` already supported via M0's migration. `agent_pending_actions.action_type` extended in Tr8 if not earlier (verify CHECK).

```sql
-- If agent_pending_actions CHECK constraint exists, extend to include 'experience_proposed'
-- (likely already covered by Tr8's extension)
```

Experience-specific event row fields (re-using existing events columns):
- `title` — experience title
- `description` — narrative
- `theme jsonb` — for intent_tags, suggested price range, AI metadata
- `visibility` — 'public' for approved experiences
- `status` — 'live' for approved experiences
- No `location_text` needed (inherited from brand's address)
- No date fields needed for non-recurring experiences (use theme JSONB for recurrence patterns like "Saturdays only")

---

## 6. Dependencies

- Upstream: Ve4 (verified venues exist with structured place data), M0 (event_type), Tr8 (agent_pending_actions confirmation pattern)
- Downstream: C2 (consumer multi-stop composer consumes `event_type='experience'` rows)

---

## 7. Regression Tests

1. Today's event creation (event_type='event') — unaffected
2. Trip creation (event_type='trip') — unaffected
3. Hub > Experiences for non-Restaurant verified venue — shows different empty state OR (Ve6/Ve7) the appropriate category snap
4. Hub > Experiences for unverified or popup brand — shows "Experiences are for verified physical venues" placeholder
5. Ari chat — `agent_pending_actions` rows from experience parsing must NOT appear in Ari's chat (filter by action_type)

---

## 8. Hard Guards

- Don't auto-publish experiences without operator accept — violates `I-ARI-CONFIRM-AUTHORITY`
- Don't use service-role in the edge function — caller's JWT
- Don't store the menu image long-term — process + discard for privacy
- Don't generate more than 20 experiences per snap (Gemini cap)
- Don't allow experience generation for non-verified brands (`claim_status='verified'` required)

---

## 9. Open Polish

- Re-prompt option ("regenerate with focus on weekday lunch") — defer
- Per-experience scheduling (recurrence patterns like "Saturdays only") — defer; v1 is title + narrative only
- Per-experience photo (use AI to suggest from venue's existing photos or generate?) — defer; falls back to brand cover
- Multi-language menu parsing — defer (English first)

---

## 10. Pipeline Notes

**Seth-owned:** SPEC the Gemini structured-output schema for the menu parser exactly. Test against 5-10 real menus during INVESTIGATE.

**Taofeek-owned:** mirror Tr8's pattern almost line-for-line — different prompt and schema, same architecture. Build the Gemini edge function first; verify it returns reasonable JSON on real menus. Then build the UI on top. Reuse the confirmation-card UI from Tr8 with category-specific fields.
