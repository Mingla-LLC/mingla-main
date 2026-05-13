# C2 — Mingla Multi-Stop Composer + Experience Surfacing

> **Track:** Track 3 — Consumer surfacing
> **Duration:** 2.5 weeks
> **Depends on:** Ve7 (in TestFlight; approved venue experiences exist), Tr2 (trips exist)
> **Status:** locked, not started
> **Importance:** **🎯 Mingla Business 1.2 completion checkpoint** — all four personas active, consumers discovering everything

---

## 1. User Outcome

A consumer with "date night" intent opens the Mingla consumer app and sees, in the main Discover feed, a **multi-stop curated card** showing two-to-three real venues woven into a coherent evening ("Saturday afternoon: brunch at Joe's → coffee at Bean Lab → bookshop stroll at Whitman's"). Each card displays a "By [Venue]" attribution chip for each composed stop. The chained venues are geographically close (within walking distance), hours-overlap during the intended time window, price-tier coherent, and intent-matched.

Mingla's pairing engine consumes the venue-authored single-intent experiences from Ve5/Ve6/Ve7 and composes multi-stop outings using internal rules. Operators don't author these compositions — Mingla does. Consumers see them as Mingla-curated outings featuring real local venues.

Additionally, consumers can tap "Report this listing" on any claimed-venue card; the report lands in the admin queue for imposter cleanup.

This is the final milestone in 1.2. Closing C2 = Mingla Business 1.2 shipped.

---

## 2. Smoke Test

1. As planner setup: at least 3 verified venues in the same city with approved experiences (a Restaurant with brunch + dinner experiences, a Coffee shop with morning + afternoon experiences, a bookshop with browse experience — created via Ve5/Ve6/Ve7)
2. Fresh install consumer app. Sign in as consumer test user, set preferences to "date night" intent + city = same city as venues
3. Open Discover
4. **Verify main feed includes a multi-stop curated card** with title like "Saturday afternoon date" chaining 2-3 of the seeded venues
5. **Verify composition correctness:**
   - Venues are geographically close (within ~1km / 15-min walk)
   - Hours overlap during the suggested time window
   - Price tiers similar (no $200 dinner chained with $5 coffee)
   - Intent tags align (all date-night-coherent)
6. **Verify attribution chips** showing each venue name correctly
7. Tap the multi-stop card → see expanded view with each stop's details + map
8. Tap an individual venue chip → land on the venue's public brand page
9. **Try a different intent:** change preferences to "solo treat" → see different cards composed (single-stop experiences, not multi-stop chains; OR multi-stop chains coherent with solo treat)
10. **Verify single-stop experience cards** also surface in main feed for matching intent
11. **Report a listing:** tap "Report this listing" on a card → confirm a report row created in admin queue
12. **DB probe:**
    ```sql
    SELECT * FROM public.report_listings WHERE reported_at > now() - interval '5 minutes';
    -- Expect: 1 row from the test report
    ```

---

## 3. Acceptance Criteria

| # | Criterion |
|---|-----------|
| 1 | Consumer Discover main feed surfaces venue-authored experiences as cards |
| 2 | Cards display "By [Venue Name]" attribution chip |
| 3 | Multi-stop composer edge function `compose-multi-stop-curations` runs on consumer request, returning composed outings |
| 4 | Composition rules: geographic proximity (configurable; default 1km), hours overlap during time window, price tier coherence (within 1 tier), intent alignment, time-of-day match |
| 5 | Multi-stop cards display 2-3 chained venues with combined "By [Venue 1] + [Venue 2] + [Venue 3]" attribution |
| 6 | Pairing engine signal scorer extended to score business-authored experiences alongside today's content |
| 7 | "Report this listing" affordance on every claimed-venue / experience / multi-stop card |
| 8 | Report flow writes to a new `report_listings` table with reporter id, reported brand_id, reason |
| 9 | Admin queue (`mingla-admin/admin/reports`) shows pending reports |
| 10 | Consumer empty state when no compositions available — fall back to existing card stream (no degraded UX) |
| 11 | Loading + error states for the composer query |
| 12 | Compositions cached per-user-per-day (avoid re-computing on every Discover open) |

---

## 4. Files Touched

**`app-mobile/` (consumer app):**

**New:**
- `app-mobile/src/components/discover/MultiStopCard.tsx`
- `app-mobile/src/components/discover/ExperienceCard.tsx`
- `app-mobile/src/components/discover/AttributionChip.tsx`
- `app-mobile/src/components/discover/ReportListingSheet.tsx`
- `app-mobile/src/services/multiStopComposerService.ts`
- `app-mobile/src/services/reportListingService.ts`

**Modified:**
- `app-mobile/src/screens/Discover/DiscoverScreen.tsx` (main feed includes experiences + multi-stops)
- `app-mobile/src/services/signalScoringService.ts` (extends scoring to business-authored content)

**`supabase/functions/`:**
- `compose-multi-stop-curations/index.ts` (NEW)
- `report-listing/index.ts` (NEW)

**`mingla-admin/`:**
- `mingla-admin/src/pages/AdminReportsQueue.jsx` (NEW)

**`supabase/migrations/`:**
- `<timestamp>_c2_report_listings_table.sql` (NEW)

---

## 5. Data Model Changes

```sql
CREATE TABLE public.report_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid REFERENCES auth.users(id),
  reported_brand_id uuid NOT NULL REFERENCES public.brands(id),
  reported_event_id uuid REFERENCES public.events(id),
  reason text NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'under_review', 'actioned', 'dismissed')),
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  resolution_notes text,
  reported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.report_listings ENABLE ROW LEVEL SECURITY;
-- Insert: anon allowed (with rate limit at edge function) + auth users
-- Read: Mingla admins only

CREATE INDEX idx_report_listings_status ON public.report_listings(status) WHERE status = 'pending';
CREATE INDEX idx_report_listings_brand ON public.report_listings(reported_brand_id);
```

---

## 6. Dependencies

- Upstream: Ve7 (all three venue parsers complete; experiences exist), Tr2 (trips exist; surfaced in C1)
- Downstream: none (final milestone in 1.2)

---

## 7. Regression Tests

1. Today's main Discover feed cards — unaffected when no business-authored experiences available
2. Empty state when no compositions available — falls back to today's content gracefully
3. Report-listing rate limit — burst of reports from same user doesn't flood admin queue
4. Multi-stop composer with only 1 experience available — should NOT create a 1-stop "multi-stop"; should surface as a single experience card
5. Composer respects RLS — only published, verified-venue experiences considered
6. Trip cards from C1 unaffected by C2 changes

---

## 8. Hard Guards

- Don't auto-create multi-stops with violations: stops in different cities, hours don't overlap, price tier mismatch >1 tier, intent mismatch
- Don't surface unverified venue content
- Don't expose business-app's operator dashboard data to consumer
- Don't allow consumer to directly query the composition rules (server-side only)
- Don't show "Report this listing" affordance for Mingla-curated multi-stops (only for individual venue cards)
- Don't violate `feedback_solo_collab_parity.md` — verify both solo + collab Discover modes work

---

## 9. Open Polish

- Multi-stop dwell-time estimation (how long should consumer spend at each stop)
- Multi-stop transit modes (walk / drive / transit)
- Multi-stop social affordance (invite friends to the outing)
- Composition refresh frequency / cache TTL
- Personalized composition (consumer's history of past visits)
- Operator visibility into "your venue appeared in N multi-stops this week" analytics (defer)

---

## 10. Pipeline Notes

**Seth-owned:** the composition rules are the architectural heart of C2. SPEC must define the exact rules: geographic distance threshold, hours overlap algorithm, price tier coherence definition, intent matching scoring. INVESTIGATE: test the rules against simulated venue datasets.

**Taofeek-owned:** this is the most cross-cutting milestone — touches `app-mobile/` (consumer), `supabase/functions/` (composer edge function + report edge function), `mingla-admin/` (reports queue), and depends on existing signal scoring infrastructure. Pace: week 1 = composer edge function + scoring extension. Week 2 = consumer UI + cards. Week 3 = report flow + admin queue + polish.

**🎯 At C2 completion: Mingla Business 1.2 fully shipped. All four personas onboarded and active. Consumers discover the full content variety. Marketplace is live.**
