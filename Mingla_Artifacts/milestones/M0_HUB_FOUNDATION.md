# M0 — Hub Tab Foundation + Universal Creator + Unified Data Model

> **Milestone code:** M0
> **Track:** Shared foundation (both engineers, before any other track starts)
> **Duration:** 1 week
> **ORCH-ID:** assigned at INVESTIGATE phase
> **Status:** locked, not started

---

## 1. User Outcome

Existing events users see the same content under a new "Hub" tab in the bottom nav. The new top-bar "+" button shows three creation options (Create event / Create experience / Create trip or otherwise). Only "Create event" creates anything for now; the other two stub to friendly "Coming soon" screens. Underneath, the database now supports tagging any event as `event` / `experience` / `trip` so future tracks can write their own offering types from day one.

This milestone is intentionally non-disruptive — operators see no regressions, today's flows all work, but the foundations for everything else in 1.2 are in place.

---

## 2. Smoke Test

A human (operator or Taofeek) runs this end-to-end before declaring M0 done:

1. Open the business app on iOS Simulator or device
2. Sign in to an existing account with at least one brand + one event
3. **Tap the new "Hub" tab in the bottom nav**
   - Expect: Events sub-tab is shown by default with the same events list as today
   - Expect: Experiences sub-tab visible (taps to empty placeholder)
   - Expect: Trips sub-tab visible (taps to empty placeholder)
4. **Tap the "+" button at the top of the screen**
   - Expect: Sheet opens with three options: Create event / Create experience / Create trip or otherwise
5. **Tap "Create event"**
   - Expect: Lands in the existing event creation flow (current behavior, unchanged)
6. Back out, **tap "Create experience"** → "Coming soon" friendly screen
7. Back out, **tap "Create trip or otherwise"** → "Coming soon" friendly screen
8. **Verify deep-links from old `/events` route still work** (should redirect to `/hub/events`)
9. **Run SQL probe to confirm data model:**
   ```sql
   SELECT column_name, data_type, column_default
   FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'event_type';
   ```
   Expect: column exists with default `'event'`
   ```sql
   SELECT event_type, COUNT(*) FROM public.events GROUP BY event_type;
   ```
   Expect: all existing rows have `event_type = 'event'`
10. **Verify no regressions in today's event flow** — create a test event end-to-end, publish, see in events list, edit, end ticket sales, cancel, view orders

---

## 3. Acceptance Criteria

| # | Criterion | Layer |
|---|-----------|-------|
| 1 | Bottom-nav tab renamed from "Events" to "Hub" with same icon position | UI |
| 2 | Hub tab shows three sub-tabs: Events / Experiences / Trips | UI |
| 3 | Hub > Events sub-tab renders today's events list with all filter pills + manage menu functioning unchanged | UI |
| 4 | Hub > Experiences sub-tab renders a friendly empty placeholder ("Single-intent experiences coming soon for venue brands") | UI |
| 5 | Hub > Trips sub-tab renders a friendly empty placeholder ("Multi-day trips coming soon for trip-planner brands") | UI |
| 6 | Top-bar "+" button on Home + Hub tabs opens a 3-option sheet | UI |
| 7 | Create event option routes to `/event/create` (existing) | Routing |
| 8 | Create experience option stubs to "Coming soon" screen | Routing |
| 9 | Create trip or otherwise option stubs to "Coming soon" screen | Routing |
| 10 | Old `/events` and `/(tabs)/events` deep links redirect to `/(tabs)/hub` (sub-tab Events) | Routing |
| 11 | Migration adds `events.event_type` column with CHECK `IN ('event', 'experience', 'trip')` defaulting to `'event'` | DB |
| 12 | All existing rows backfilled to `event_type = 'event'` | DB |
| 13 | Index `idx_events_event_type` created | DB |
| 14 | No regressions: today's event create, publish, list, edit, scan, cancel, refund flows all work unchanged | Cross-cutting |

---

## 4. Files Touched

Estimated file modifications:

**`mingla-business/app/`:**
- `(tabs)/_layout.tsx` — rename Events → Hub tab, update `TABS` array
- `(tabs)/hub/_layout.tsx` (NEW) — sub-tab layout
- `(tabs)/hub/events.tsx` (NEW or moved from `(tabs)/events.tsx`) — today's events list
- `(tabs)/hub/experiences.tsx` (NEW) — placeholder
- `(tabs)/hub/trips.tsx` (NEW) — placeholder
- `(tabs)/events.tsx` (delete or convert to redirect)

**`mingla-business/src/components/ui/`:**
- `TopBar.tsx` or equivalent — add "+" button + sheet trigger
- `UniversalCreatorSheet.tsx` (NEW) — three-option sheet component

**`mingla-business/src/constants/`:**
- `designSystem.ts` — confirm `send` icon for marketing tab still works; no change needed to Hub icon

**`supabase/migrations/`:**
- `<timestamp>_m0_events_event_type_discriminator.sql` (NEW)

---

## 5. Data Model Changes

```sql
-- supabase/migrations/<timestamp>_m0_events_event_type_discriminator.sql

ALTER TABLE public.events
  ADD COLUMN event_type text NOT NULL DEFAULT 'event'
    CHECK (event_type IN ('event', 'experience', 'trip'));

-- Explicit backfill (defensive; default handles new rows but explicit confirms intent)
UPDATE public.events SET event_type = 'event' WHERE event_type IS NULL;

CREATE INDEX idx_events_event_type ON public.events(event_type);

COMMENT ON COLUMN public.events.event_type IS
  'Mingla Business 1.2 — discriminator for the unified offering model. event=today''s ticketed event (popup organizers), experience=single-intent venue-derived offering (M11+), trip=multi-day curated package (Tr2+). I-1.2-UNIFIED-EVENT-TYPE.';
```

No RLS policy changes needed — existing event RLS policies continue to cover all event_type values.

---

## 6. Dependencies

- **Upstream:** none. M0 is the first milestone.
- **Downstream:** every other milestone in 1.2 depends on M0 shipping first. Tr and Ve tracks cannot start until M0 is in TestFlight.

---

## 7. Regression Tests

Required regression coverage:

1. **Event creation flow** — full Create event → publish → buyer purchases → operator sees order, runs unchanged
2. **Event management** — edit live event, end ticket sales, cancel event, view orders, scanner, guests, blasts
3. **Brand profile** — `/b/{brandSlug}` public page renders correctly (uses existing `brands_public_view`)
4. **Marketing Hub** — `/(tabs)/marketing/campaigns/*` routes work (the Marketing tab is unaffected)
5. **Ari tab** — chat works, agent confirmation cards render
6. **Account tab** — edit profile, sign out
7. **Deep links** — verify any saved deep links to `/events` redirect cleanly

Regression test files to add or update:
- `mingla-business/app/(tabs)/__tests__/hub_navigation.test.tsx` (NEW) — verifies tab structure, sub-tab routing, deep-link redirect
- `mingla-business/src/components/ui/__tests__/UniversalCreatorSheet.test.tsx` (NEW) — sheet renders 3 options + routes correctly

---

## 8. Hard Guards (Do NOT)

- **Do NOT** rename or restructure today's event management routes under `/event/[id]/*` — they continue as-is
- **Do NOT** modify `events.event_type` to use an enum type (use text + CHECK constraint per the project spec)
- **Do NOT** add the Experiences or Trips placeholder content beyond "Coming soon" — that's M11 and Tr2 scope
- **Do NOT** wire the Create experience or Create trip routes to anything real — stub only
- **Do NOT** touch the Marketing (Blast), Ari, Home, or Account tabs
- **Do NOT** write any new edge functions in this milestone

---

## 9. Open Polish Items Surfaced During M0

Resolve during M0's SPEC:
- Hub sub-tab pattern (hard sub-tabs vs filter pills) — recommendation: hard sub-tabs for clarity
- "+" button placement on which tabs (Home + Hub at minimum, possibly Account)
- Visual treatment of the three "Coming soon" placeholders — should they feel like real upcoming features or just empty states?
- Whether to keep the existing FAB "+ Build event" CTA on Hub > Events as a redundant shortcut, or consolidate to the top-bar "+"

---

## 10. Pipeline Notes (When Seth Owns M0)

- **INVESTIGATE phase:** confirm today's tab structure, identify all consumers of `events` table that might be impacted by the new column
- **SPEC phase:** resolve §9 polish items; decide redirect-vs-rename strategy for `/events` route
- **IMPLEMENT phase:** migration first, then UI, then sub-tabs, then "+" sheet, then smoke test
- **TEST phase:** full regression sweep on event flow + new tab navigation
- **CLOSE phase:** decision log entry codifying I-1.2-UNIFIED-EVENT-TYPE invariant

---

## 11. Pipeline Notes (When Taofeek Owns M0)

Read this brief end-to-end. Open the current `mingla-business/app/(tabs)/_layout.tsx` to see today's tab structure. Open `mingla-business/app/(tabs)/events.tsx` to see today's events list. Sketch your migration SQL against the project spec §3.3. Run the smoke test in §2 as the final verification.

This is a low-architectural-risk milestone but high cross-cutting impact (every tab user is affected). Prioritize the regression sweep.
