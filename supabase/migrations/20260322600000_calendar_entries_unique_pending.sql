-- Pass 5a (P5-04): Prevent duplicate pending calendar entries for the same user + card.

-- Clean up any existing duplicates before creating the index.
-- Keep the most recent entry for each (user_id, card_id) pair.
DELETE FROM public.calendar_entries ce
WHERE ce.status = 'pending'
  AND ce.archived_at IS NULL
  AND ce.card_id IS NOT NULL
  AND ce.id NOT IN (
    SELECT DISTINCT ON (user_id, card_id) id
    FROM public.calendar_entries
    WHERE status = 'pending' AND archived_at IS NULL AND card_id IS NOT NULL
    ORDER BY user_id, card_id, created_at DESC
  );

-- Partial unique index: only applies to entries where status = 'pending' AND not archived.
-- Allows: rescheduling after cancellation (old entry is 'cancelled', new one is 'pending').
-- Allows: re-adding after archival (old entry has archived_at set).
-- Prevents: two active pending entries for the same user + card.
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_entries_unique_pending
  ON public.calendar_entries (user_id, card_id)
  WHERE status = 'pending' AND archived_at IS NULL AND card_id IS NOT NULL;
