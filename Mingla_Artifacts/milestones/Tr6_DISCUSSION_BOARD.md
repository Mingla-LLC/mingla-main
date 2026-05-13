# Tr6 — Discussion Board / Group Chat

> **Track:** Track 1 — Trip planners
> **Duration:** 2 weeks
> **Depends on:** Tr2 (in TestFlight; thread attaches to trip)
> **Status:** locked, not started

---

## 1. User Outcome

After a buyer books a trip, they automatically join a per-trip group chat with the planner and every other confirmed traveler. Planner posts updates ("flight info attached, please pack swimwear"). Travelers ask questions. Push notifications fire. PDF + image attachments work. Planner can optionally lock the chat to broadcast-only (only brand members post; travelers read). Pre-trip documents (waiver, packing list, visa info) live in a Documents tab shared via the same RLS scope. **Third WeTravel-parity feature.**

---

## 2. Smoke Test

1. Planner creates trip with discussion enabled (default ON)
2. Two test travelers (different accounts) book the trip
3. **Verify both auto-added** — open Discussion tab on each traveler's app, both see the empty thread
4. Planner posts message "See you in Tulum!" + attaches a PDF
5. Both travelers receive push notification within ~10s
6. Open app → see message in thread + PDF download link
7. Traveler A replies "Excited!" → Planner + Traveler B receive notification
8. Planner flips chat to broadcast-only mode. Traveler A tries to post → input disabled with message "Only the planner can post in this trip's chat"
9. **RLS test:** sign in as a third traveler NOT booked on this trip. Try to read the thread via direct API call → confirm RLS blocks (200 empty / 403)
10. Documents tab: planner uploads a "Packing list.pdf". Both travelers see + download it.
11. **DB probe:**
    ```sql
    SELECT * FROM public.event_thread_messages
    WHERE thread_id = (SELECT id FROM public.event_threads WHERE event_id = <trip-id>);
    ```
    Expect 2 messages (planner's + traveler A's reply)

---

## 3. Acceptance Criteria

| # | Criterion |
|---|-----------|
| 1 | New `event_threads` table — one row per event/trip, with `is_broadcast_only` + `is_enabled` flags |
| 2 | New `event_thread_messages` table — author, body, attachments JSONB, posted_at, edited_at |
| 3 | RLS on both tables: read/write only by confirmed buyers (orders.status confirmed) OR brand members of the event's brand |
| 4 | Auto-create thread on first trip publish (or first booking, TBD in SPEC) |
| 5 | Auto-add buyer to thread on booking confirmation (`orders` status = confirmed) |
| 6 | Operator Discussion tab on trip dashboard — posting UI + thread display |
| 7 | Buyer-side Discussion UI accessible from order confirmation screen + Account > My trips list |
| 8 | Attachment upload to new `trip_documents` storage bucket with RLS-scoped access |
| 9 | OneSignal push notification fans out on new message (existing pipeline) |
| 10 | Broadcast-only mode toggle in trip wizard (Step 9 or settings) |
| 11 | Operator-only Documents tab for pre-shared docs (planner uploads, travelers download) |
| 12 | Optional Ari summarization tool: "Summarize the last N messages" (added to Ari's agent_tools) |
| 13 | Cross-trip read attempts blocked by RLS — independently verifiable via test |

---

## 4. Files Touched

**New:**
- `mingla-business/src/components/trip/DiscussionTab.tsx` (operator)
- `mingla-business/src/components/trip/DocumentsTab.tsx` (operator)
- `mingla-business/src/components/buyer/TripDiscussionView.tsx` (traveler)
- `mingla-business/src/services/eventThreadsService.ts`
- `mingla-business/src/hooks/useEventThread.ts`
- `mingla-business/src/hooks/useEventThreadMessages.ts`
- `supabase/functions/post-thread-message/index.ts`
- `supabase/functions/upload-thread-attachment/index.ts`
- `supabase/migrations/<timestamp>_tr6_event_threads.sql`

**Modified:**
- Trip wizard adds Step 9 (Group thread settings) + optional Step 10 (Pre-trip documents)
- Trip operator dashboard adds Discussion + Documents tabs
- Order confirmation screen surfaces "Join the trip chat" affordance
- Ari `agentTools.ts` adds optional summarization tool

---

## 5. Data Model Changes

Per project spec §3.7:

```sql
CREATE TABLE public.event_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  is_broadcast_only boolean NOT NULL DEFAULT false,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id)
);

CREATE TABLE public.event_thread_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.event_threads(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id),
  body text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]',
  posted_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz
);
CREATE INDEX idx_event_thread_messages_thread_posted ON public.event_thread_messages(thread_id, posted_at DESC);

-- RLS — confirmed buyers + brand members
ALTER TABLE public.event_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_thread_messages ENABLE ROW LEVEL SECURITY;

-- Helper function to check confirmed-buyer-or-brand-member
CREATE OR REPLACE FUNCTION public.has_thread_access(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.event_id = p_event_id
        AND o.account_id = auth.uid()
        AND o.status IN ('confirmed', 'paid', 'partially_paid')
    )
    OR EXISTS (
      SELECT 1 FROM brand_members bm
      JOIN events e ON e.brand_id = bm.brand_id
      WHERE e.id = p_event_id AND bm.user_id = auth.uid()
    );
$$;

CREATE POLICY event_threads_read ON public.event_threads FOR SELECT
  USING (has_thread_access(event_id));
CREATE POLICY event_thread_messages_read ON public.event_thread_messages FOR SELECT
  USING (has_thread_access(
    (SELECT event_id FROM event_threads WHERE id = thread_id)
  ));
-- Write policies: brand members always; buyers only if NOT broadcast_only
-- (full policies in migration)

-- Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('trip_documents', 'trip_documents', false);
-- Bucket RLS: object_name format = '{event_id}/{filename}', access scoped via has_thread_access
```

---

## 6. Dependencies

- Upstream: Tr2 (trip orders exist; buyer confirmation triggers thread join)
- Downstream: none direct, but Tr8+ marketing audience extension may reference thread state

---

## 7. Regression Tests

1. Events (event_type='event') — no thread auto-created (only trips get threads in Tr6 scope)
2. Trip with thread disabled (operator turned it off) — no thread exists; UI hides Discussion tab
3. Buyer cancels trip — thread access revoked at next read
4. Brand member removed from team — thread access revoked
5. OneSignal notification idempotency — same message doesn't double-notify

**Critical security test:** independent test that attempts to read another trip's thread; must return zero rows.

---

## 8. Hard Guards

- Don't enable thread for `event_type='event'` (popup events) in Tr6 — out of scope; future cycle
- Don't allow thread access from buyer's deletion / refund / cancellation paths
- Don't make attachments publicly accessible — always RLS-scoped signed URLs
- Don't broadcast Ari summaries to all travelers — Ari is operator-side tool only
- Don't allow message deletion in Tr6 (edit is fine; deletion is polish)

---

## 9. Open Polish

- Threading / replies (defer; flat list for v1)
- Reactions / emoji (defer)
- Read receipts (defer)
- Message search (defer)
- Multi-language summarization via Ari (current Ari is English; defer)
- Notification preferences per traveler (mute trip, broadcast-only opt-out)

---

## 10. Pipeline Notes

**Seth-owned:** the RLS pattern here is the highest-risk piece. INVESTIGATE + SPEC must spell out every access path (operator read, operator write, buyer read, buyer write in broadcast vs non-broadcast, cross-trip attempts, post-cancellation). Test the negative cases explicitly during TEST.

**Taofeek-owned:** start with the schema + RLS + a test that proves cross-trip reads are blocked. Build the UI on top of proven RLS. Mirror the OneSignal notification dispatch pattern from existing notification edge functions. Treat the storage bucket RLS like a separate sub-milestone — test it independently before integrating.
