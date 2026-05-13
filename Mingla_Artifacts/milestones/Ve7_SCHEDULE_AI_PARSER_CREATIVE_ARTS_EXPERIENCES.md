# Ve7 — Schedule AI Parser → Creative & Arts Experiences

> **Track:** Track 2 — Physical venues
> **Duration:** 1 week
> **Depends on:** Ve5, Ve6 (in TestFlight; parser pattern proven twice)
> **Status:** locked, not started
> **Importance:** **🎯 Track 2 completion checkpoint** — all three venue categories have AI-generated experiences live

---

## 1. User Outcome

A verified Creative & Arts venue (art gallery, pottery studio, dance school, music venue, painting class, etc.) photographs their class schedule or exhibition flyer. Gemini parses it and generates Creative & Arts experiences with correct timing, recurrence, pricing, and intent tags ("Beginner pottery — Saturdays 2pm, $45/person," "Current exhibition: 'Light & Form' through March 15," "Salsa lessons Wednesdays 7pm"). Same review pattern. Approved experiences become `events.event_type='experience'` rows.

---

## 2. Smoke Test

1. Sign in as a verified Creative & Arts brand (test fixture: an art gallery or dance studio)
2. Hub > Experiences → "Generate from your schedule" CTA
3. Snap a real class schedule or exhibition flyer
4. Loading
5. 8-15 confirmation cards with Creative & Arts experiences. Should capture: recurrence ("every Saturday"), specific times, instructor name if visible, exhibition end dates
6. Edit + accept + reject
7. Hub > Experiences populates
8. **DB probe** — verify intent tags reflect Creative & Arts vocabulary, recurrence and date info in `events.theme jsonb`
9. **Regression:** Ve5 + Ve6 flows unaffected

---

## 3. Acceptance Criteria

| # | Criterion |
|---|-----------|
| 1 | Hub > Experiences "Generate from your schedule" CTA visible only for `kind='physical'` AND `category='Creative & Arts'` |
| 2 | New edge function `parse-creative-arts-schedule` returns structured output with schedule-aware fields (recurrence, specific dates, instructor) |
| 3 | Creative & Arts intent vocabulary: `solo_treat`, `learn_new_skill`, `cultural_experience`, `date_night_cultural`, `weekend_class`, `evening_class`, `exhibition_visit`, etc. |
| 4 | Per-experience recurrence captured: `{recurrence: "weekly", days: ["Saturday"], start_time: "14:00", duration_minutes: 90}` OR `{single_date: "2026-03-15", time: "19:00"}` |
| 5 | Per-experience instructor field (when visible in flyer/schedule) |
| 6 | Per-experience capacity (class size limit) when applicable |
| 7 | Per-experience price field |
| 8 | Approved experiences write to `events` with all schedule/instructor/capacity/pricing data in `theme jsonb` |
| 9 | Respects all Ari invariants |

---

## 4. Files Touched

**New:**
- `mingla-business/src/components/experience/ScheduleSnapInput.tsx`
- `supabase/functions/parse-creative-arts-schedule/index.ts`
- `supabase/functions/_shared/geminiScheduleParser.ts`

**Modified:**
- `mingla-business/app/(tabs)/hub/experiences.tsx` — third category branch
- `mingla-business/src/components/experience/ExperienceConfirmationCard.tsx` — extends for recurrence + instructor + capacity fields

---

## 5. Data Model Changes

None. Creative & Arts-specific fields in `events.theme jsonb`:

```json
{
  "intent_tags": ["learn_new_skill", "weekend_class"],
  "recurrence": "weekly",
  "days": ["Saturday"],
  "start_time": "14:00",
  "duration_minutes": 90,
  "instructor": "Maria Lopez",
  "capacity": 12,
  "price_cents": 4500,
  "currency": "USD",
  "ai_metadata": {
    "generator": "parse-creative-arts-schedule",
    "confidence": 0.85
  }
}
```

For exhibitions (single-date or date-range):

```json
{
  "intent_tags": ["exhibition_visit", "cultural_experience"],
  "exhibition_start": "2026-03-01",
  "exhibition_end": "2026-03-15",
  "free_or_ticketed": "ticketed",
  "price_cents": 1500,
  "ai_metadata": {...}
}
```

---

## 6. Dependencies

- Upstream: Ve5 + Ve6 (parser pattern + UI)

---

## 7. Regression Tests

1. Ve5 (Restaurant) + Ve6 (Play) flows unaffected
2. Date-overrun: exhibition with past end_date — flag as expired in UI, suggest archival
3. Non-schedule file (random PDF) — empty experiences + friendly message
4. Recurring experiences correctly tagged so consumer-side surfacing (C2) can filter by day-of-week

---

## 8. Hard Guards

- Same as Ve5/Ve6
- Don't auto-archive expired exhibitions — operator decides
- Don't suggest recurrence patterns longer than weekly (e.g., monthly) for v1 — keep schema simple

---

## 9. Open Polish

- ICS calendar export per experience (defer)
- Multi-instructor support (defer)
- Multi-language schedule parsing (defer; English first)

---

## 10. Pipeline Notes

**Seth-owned:** Creative & Arts vocabulary is the highest-judgment piece. SPEC must define intent tags carefully so they align with consumer-side intent matching.

**Taofeek-owned:** by Ve7 the parser pattern is well-trodden. This should be the fastest of the three Ve parsers (~3-4 days) because all the UI patterns are in place from Ve5/Ve6.

**🎯 At Ve7 completion: Track 2 done. Physical venues fully usable across all three categories. Restaurants + Play + Creative & Arts onboard, claim, get verified, snap their material, generate experiences, go live.**
