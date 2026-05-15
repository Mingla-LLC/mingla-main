# Tr8 — AI Itinerary Scaffolding

> **Track:** Track 1 — Trip planners
> **Duration:** 1.5 weeks
> **Depends on:** Tr2 (in TestFlight; trip data model exists)
> **Status:** locked, not started
> **Importance:** **🎯 Track 1 completion checkpoint** — trip planners reach full WeTravel parity + AI shortcut WeTravel doesn't offer

---

## 1. User Outcome

Instead of typing the day-by-day itinerary from scratch in Tr2's manual editor, the planner uploads their existing brochure / Google Doc / PDF in Step 2 of the trip wizard. Gemini parses it via a structured-output edge function and returns a candidate day-by-day. Each day surfaces as a confirmation card (accept / edit / reject) using the same `agent_pending_actions` state machine Ari uses today (per `I-ARI-CONFIRM-AUTHORITY`). Planner accepts the good days, edits the close-but-not-quites, rejects the wrong ones. The resulting itinerary populates `trip_days` rows. Way faster than typing 7 days manually.

---

## 2. Smoke Test

1. Take a real PDF brochure (e.g., a yoga retreat brochure with 7 days of activities)
2. Planner creates new trip OR edits existing trip from Tr2
3. At Step 2 (Itinerary), tap "Upload brochure" instead of manual entry
4. Select the PDF from file picker
5. Spinner with "Reading your itinerary..." (Gemini parsing)
6. ~10-20s later, 7 confirmation cards appear (one per day)
7. Each card shows: AI-suggested title + narrative
8. Edit card 1's narrative inline ("rewrite as more conversational")
9. Reject card 4 entirely
10. Accept the remaining 5 with confirm tap
11. Step 2 itinerary now shows 6 days (5 accepted + 1 edited)
12. Continue wizard to publish → buyer sees the AI-derived itinerary
13. **DB probe:**
    ```sql
    SELECT ordinal, title, narrative FROM public.trip_days WHERE event_id = <trip-id> ORDER BY ordinal;
    ```
    Expect 6 rows
14. **agent_pending_actions audit trail:**
    ```sql
    SELECT action_type, status, created_at FROM public.agent_pending_actions
    WHERE event_id = <trip-id> ORDER BY created_at;
    ```
    Expect 7 rows (5 accepted, 1 edited→accepted, 1 rejected)

---

## 3. Acceptance Criteria

| # | Criterion |
|---|-----------|
| 1 | Trip wizard Step 2 adds "Upload brochure" alternative to manual entry |
| 2 | Supports PDF + JPEG + PNG uploads (Gemini multi-modal) |
| 3 | New edge function `parse-trip-brochure` returns structured JSON: `{days: [{ordinal, title, narrative, suggested_date?}, ...]}` |
| 4 | Each parsed day becomes an `agent_pending_actions` row with `action_type='trip_day_proposed'` |
| 5 | Confirmation card UI for each pending day: title + narrative + accept / edit / reject buttons |
| 6 | Edit mode = inline editing of title + narrative before accepting |
| 7 | Accept writes to `trip_days` table with the (possibly edited) content |
| 8 | Reject discards the pending row; doesn't write to `trip_days` |
| 9 | Bulk "Accept all" affordance for planners who trust the AI |
| 10 | Manual-entry fallback always present ("Build manually instead") |
| 11 | Respects `I-ARI-CONFIRM-AUTHORITY` — no auto-write to `trip_days` without explicit accept |
| 12 | Respects `I-ARI-USER-JWT-ONLY` — edge function uses caller's JWT, not service role |
| 13 | Failure modes handled: parsing fails (Gemini returns garbage) → friendly error + retry, file too large → reject with limit info |

---

## 4. Files Touched

**New:**
- `mingla-business/src/components/trip/BrochureUploadInput.tsx`
- `mingla-business/src/components/trip/AIItineraryReviewCards.tsx`
- `mingla-business/src/components/trip/TripDayConfirmationCard.tsx`
- `mingla-business/src/services/tripBrochureService.ts`
- `mingla-business/src/hooks/usePendingTripDays.ts`
- `supabase/functions/parse-trip-brochure/index.ts`
- `supabase/functions/_shared/geminiTripParser.ts`
- `supabase/migrations/<timestamp>_tr8_pending_trip_days.sql` (extends `agent_pending_actions` if needed)

**Modified:**
- `mingla-business/src/components/trip/TripCreatorStep2Itinerary.tsx` (adds upload alternative)

---

## 5. Data Model Changes

If `agent_pending_actions` from ORCH-0821 already supports arbitrary action types, no new tables. Extension only:

```sql
-- Verify agent_pending_actions.action_type allows new value
-- (likely text already; no CHECK constraint to extend)
-- If CHECK exists, extend:
ALTER TABLE public.agent_pending_actions
  DROP CONSTRAINT IF EXISTS agent_pending_actions_action_type_check;
-- Re-add with extended values
ALTER TABLE public.agent_pending_actions
  ADD CONSTRAINT agent_pending_actions_action_type_check
  CHECK (action_type IN ('create_brand', 'create_event', 'update_event', 'trip_day_proposed', 'experience_proposed'));
```

Storage: leverage existing buckets if brochure file needs preservation; else process in-memory and discard after parsing (preferred for size + privacy).

---

## 6. Dependencies

- Upstream: Tr2 (trip_days table exists)
- Sideways: Ari's `agent_pending_actions` state machine (ORCH-0821 — already shipped)
- Downstream: Ve5/Ve6/Ve7 will follow the same pattern for venue experience parsers

---

## 7. Regression Tests

1. Manual itinerary entry path (Tr2 default) — must remain unchanged
2. Ari chat tab — `agent_pending_actions` rows from trip parsing must NOT appear in Ari's chat (filter by action_type)
3. Gemini API failure — friendly error, planner can retry or switch to manual
4. Large file (10MB+) — rejected with clear error
5. Non-itinerary PDF (e.g., a generic document) — AI returns empty days list; UI shows "Couldn't find an itinerary in this file"

---

## 8. Hard Guards

- Don't auto-publish ANY parsed day without explicit accept — violates `I-ARI-CONFIRM-AUTHORITY`
- Don't use service-role in the edge function — caller's JWT only
- Don't store the brochure file long-term (privacy) — process + discard
- Don't log Gemini's raw response in production logs (may contain PII)
- Don't allow Gemini to suggest more than 30 days — cap at 30 (reasonable trip length)

---

## 9. Open Polish

- Suggesting dates per day based on Step 1 start/end dates (defer)
- Place_pool autocomplete for stops within a day (defer)
- Multi-language brochure parsing (defer — English first)
- Re-parsing with edited prompt ("be more concise") (defer)

---

## 10. Pipeline Notes

**Seth-owned:** SPEC must spec the exact Gemini structured-output schema. Test the parser against 5-10 real brochures during INVESTIGATE to verify schema realism.

**Taofeek-owned:** start with the Gemini edge function + a fixed structured output schema. Test it against 3-5 sample brochures before building UI. Use the existing `agent_pending_actions` pattern from ORCH-0821; don't reinvent the state machine.

**🎯 At Tr8 completion: Track 1 done. Trip planners are full WeTravel-parity sellers + have an AI shortcut WeTravel doesn't offer.**
