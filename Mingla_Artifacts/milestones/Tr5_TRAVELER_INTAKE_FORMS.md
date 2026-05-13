# Tr5 — Traveler Intake Forms

> **Track:** Track 1 — Trip planners
> **Duration:** 1.5 weeks
> **Depends on:** Tr4 (in TestFlight)
> **Status:** locked, not started

---

## 1. User Outcome

Trip planner builds a custom intake form via drag-drop question builder ("passport number, dietary restrictions, emergency contact, T-shirt size, room-share preference"). Questions support short text, long text, single-choice, multi-choice, file upload, date, phone. Each question marked required or optional. Template defaults available. Buyer fills the form at checkout AFTER the standard buyer info step. Planner sees all answers per traveler in dashboard, with file uploads accessible. **Second WeTravel-parity feature.**

---

## 2. Smoke Test

1. Planner edits trip wizard. New "Traveler intake" step.
2. Add 5 questions: passport number (short text, required), dietary restrictions (multi-choice with custom add), emergency contact (long text, required), T-shirt size (single-choice S/M/L/XL), passport photo (file upload, required)
3. Republish trip.
4. Buyer reserves spot. After standard name/email/phone step, sees the intake form.
5. Try submitting with missing required fields — confirm blocks with clear errors per field.
6. Fill all 5 questions. Upload a passport photo (test JPEG ~1MB).
7. Complete payment + confirmation.
8. Planner opens Travelers tab → sees traveler row. Tap row → see all 5 answers + uploaded photo download.
9. **DB probe:**
   ```sql
   SELECT intake_form_data FROM public.orders WHERE id = <order-id>;
   ```
   Expect JSONB with all 5 answers + storage path to uploaded photo
10. **Regression:** existing event checkout (no intake) flows correctly with no intake form rendered

---

## 3. Acceptance Criteria

| # | Criterion |
|---|-----------|
| 1 | New Trip wizard step "Traveler intake" with drag-drop question builder |
| 2 | Question types supported: short_text, long_text, single_choice, multi_choice, file_upload, date, phone |
| 3 | Per-question: required toggle, optional help text |
| 4 | Template defaults: passport, dietary, emergency contact, room-share preference, T-shirt size — operator can apply with one tap |
| 5 | `events.trip_intake_schema` JSONB column stores: `{questions: [{id, type, label, required, options?, help_text?}, ...]}` |
| 6 | Buyer checkout dynamically renders form per schema after standard buyer info |
| 7 | Required-field validation client-side with clear per-field error display |
| 8 | File upload uses Supabase Storage; storage path stored in `intake_form_data` |
| 9 | New storage bucket `trip_intake_files` with RLS scoped to buyer + brand members of the trip's event |
| 10 | `orders.intake_form_data` JSONB column stores: `{answers: {question_id: value, ...}, files: {question_id: storage_path}}` |
| 11 | Operator Travelers tab shows per-traveler intake completeness indicator + tap to view full responses |
| 12 | File downloads from operator side go through signed URL (not public) |

---

## 4. Files Touched

**New:**
- `mingla-business/src/components/trip/IntakeSchemaBuilder.tsx`
- `mingla-business/src/components/trip/IntakeQuestionEditor.tsx`
- `mingla-business/src/components/trip/IntakeTemplatesPicker.tsx`
- `mingla-business/src/components/buyer/IntakeFormRenderer.tsx` (used at checkout)
- `mingla-business/src/components/trip/TravelerIntakeView.tsx` (operator view)
- `mingla-business/src/utils/intakeSchemaValidation.ts`
- `supabase/migrations/<timestamp>_tr5_intake_schema.sql`

**Modified:**
- Trip wizard adds the intake step
- `mingla-business/src/components/trip/TripCheckoutFlow.tsx` includes intake-form step
- `mingla-business/src/components/trip/TripTravelersTab.tsx`

---

## 5. Data Model Changes

```sql
ALTER TABLE public.events
  ADD COLUMN trip_intake_schema jsonb;

ALTER TABLE public.orders
  ADD COLUMN intake_form_data jsonb;

-- New storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('trip_intake_files', 'trip_intake_files', false);

-- RLS on bucket: object read = buyer or brand member; object write = buyer at checkout
-- (full policies in migration)
```

JSON schema shape:

```json
{
  "questions": [
    {"id": "q1", "type": "short_text", "label": "Passport number", "required": true},
    {"id": "q2", "type": "multi_choice", "label": "Dietary", "required": false,
     "options": ["vegetarian", "vegan", "gluten-free", "kosher", "halal"]},
    {"id": "q3", "type": "file_upload", "label": "Passport photo", "required": true,
     "help_text": "Clear photo of the photo page", "max_size_mb": 5,
     "accepted_mime": ["image/jpeg", "image/png", "application/pdf"]}
  ]
}
```

---

## 6. Dependencies

- Upstream: Tr2 (orders exist for trip-type events)
- Downstream: Tr6 (discussion board may use intake completeness as a filter — "remind travelers who haven't filled passport info")

---

## 7. Regression Tests

1. Today's event checkout (no intake) — must remain unchanged
2. Trip checkout without intake schema configured (trip created in Tr2, no schema added) — buyer flow skips intake step entirely
3. Form validation edge cases — empty required, malformed phone, file > max size, wrong MIME
4. File upload + retrieval — operator can download files uploaded at checkout

---

## 8. Hard Guards

- Don't allow schema edits AFTER any order has been booked against the trip (versioning is out of scope; lock schema after first booking)
- Don't store sensitive answers in plain text in long-running logs (passport numbers, etc.)
- Don't make file uploads sync-blocking — show progress + allow retry
- Don't allow operator to see file URLs that bypass RLS (no public buckets)

---

## 9. Open Polish

- Conditional fields ("if vegetarian, what kind?") — defer to future polish
- Operator export of intake responses (CSV / PDF) — defer
- Re-sending intake form after booking (buyer can edit?) — defer; first version is fill-at-checkout-only

---

## 10. Pipeline Notes

**Seth-owned:** SPEC must explicitly enumerate the seven question types' shapes + validation rules. The dynamic form renderer needs a strong contract.

**Taofeek-owned:** start with the schema validator (TypeScript) + tests. Then the builder UI. Then the renderer. File upload comes last because it's the riskiest piece (RLS + signed URLs). Reuse the `creatorAvatarService.ts` upload pattern (ORCH-0786) for the file upload mechanics.
