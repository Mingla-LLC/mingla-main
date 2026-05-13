# Ve6 — Activities AI Parser → Play Experiences

> **Track:** Track 2 — Physical venues
> **Duration:** 1 week
> **Depends on:** Ve5 (in TestFlight; menu parser pattern proven)
> **Status:** locked, not started

---

## 1. User Outcome

A bowling alley, arcade, escape room, mini-golf venue, or other "Play" category business photographs their activities or packages list. Gemini parses it and generates 8-15 candidate Play-shaped experiences ("Lane + pitcher of beer for 4," "Friday night arcade tournament," "Escape room booking — 1 hour, 6 people max"). Same review flow as Ve5. Approved experiences become `events.event_type='experience'` rows attached to the venue with Play-appropriate intent tags ("friends_chill", "group_activity", "date_night_active").

---

## 2. Smoke Test

1. Sign in as a verified Play venue (e.g., a fake bowling alley brand created via Ve1/Ve2)
2. Hub > Experiences sub-tab → "Generate from your activities list" CTA (variant of Ve5's menu CTA)
3. Snap a real activities/packages list (test artifact: bowling alley lane pricing sheet, escape room booking pamphlet, arcade tournament flyer)
4. Loading: "Reading your activities..."
5. 8-15 confirmation cards appear with Play-shaped experiences
6. Edit + accept + reject like Ve5
7. Approved experiences appear in Hub > Experiences with appropriate Play intent tags
8. **DB probe** same as Ve5 but expect intent tags like `["friends_chill", "group_activity"]` not `["dinner", "brunch"]`
9. **Regression:** Restaurant brand's Ve5 menu flow still works; flows are distinct based on `brand.category`

---

## 3. Acceptance Criteria

| # | Criterion |
|---|-----------|
| 1 | Hub > Experiences "Generate from your activities" CTA visible only for `kind='physical'` AND `category='Play'` |
| 2 | New edge function `parse-play-activities` returns structured output (same shape as Ve5's parser but different prompt + intent vocabulary) |
| 3 | Play-specific intent tag vocabulary: `friends_chill`, `group_activity`, `date_night_active`, `family_friendly`, `solo_exploration`, etc. |
| 4 | Confirmation card UI inherits from Ve5; only the prompt + intent tag suggestions differ |
| 5 | Per-experience capacity / group size field (Play experiences often capacity-bound — lanes seat 6, escape room 8 max) |
| 6 | Per-experience time-of-day suggestion ("Friday evening", "weekday afternoon") |
| 7 | Approved experiences become `events.event_type='experience'`, intent stored in `theme jsonb` |
| 8 | Bulk "Accept all" affordance |
| 9 | Respects all Ari invariants (confirmation-authority, user-JWT-only) |
| 10 | Failure modes same as Ve5: parsing failure / non-activities file / size limit |

---

## 4. Files Touched

**New:**
- `mingla-business/src/components/experience/ActivitiesSnapInput.tsx` (variant of MenuSnapInput from Ve5)
- `supabase/functions/parse-play-activities/index.ts`
- `supabase/functions/_shared/geminiActivitiesParser.ts`

**Modified:**
- `mingla-business/app/(tabs)/hub/experiences.tsx` — branch on category
- `mingla-business/src/components/experience/ExperienceConfirmationCard.tsx` (extends to render capacity + time-of-day fields)

---

## 5. Data Model Changes

None. Reuses Ve5's pattern + extends `agent_pending_actions.action_type='experience_proposed'`.

Play-specific fields stored in `events.theme jsonb`:
- `intent_tags: string[]`
- `capacity_min, capacity_max: number`
- `suggested_time_of_day: string`
- `ai_metadata: {generator: 'parse-play-activities', confidence: 0.0-1.0, source_file_hash: string}`

---

## 6. Dependencies

- Upstream: Ve5 (pattern + UI + agent_pending_actions extension)
- Sideways: Ve7 (third parser for Creative & Arts)

---

## 7. Regression Tests

1. Restaurant brand → Ve5 flow unchanged
2. Play brand with no activities snapped → empty Experiences tab
3. Wrong category → CTA hidden (e.g., Creative & Arts brand doesn't see Activities CTA)
4. Gemini failure → friendly retry

---

## 8. Hard Guards

- Same as Ve5 (no auto-publish, no service-role, no long-term file storage)
- Don't reuse menu parser prompt for activities — distinct prompts + schemas
- Don't suggest intent tags outside the Play vocabulary defined in this milestone

---

## 9. Open Polish

- Per-experience booking-CTA UX (some Play experiences are walk-in, some require reservations)
- Calendar integration for time-of-day suggestions
- Multi-venue activities (defer; Play venues are single-location for v1)

---

## 10. Pipeline Notes

**Seth-owned:** SPEC defines the Play intent tag vocabulary explicitly. INVESTIGATE: test the parser on 5+ real Play venue activity lists.

**Taofeek-owned:** clone Ve5's edge function and prompt; swap prompt + schema for Play category. UI clones with category-specific copy.
