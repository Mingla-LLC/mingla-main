-- Issue #1687 — one voluntary review per user per place.
--
-- THE DEFECT, reproduced live by the tester on 2026-08-06: rate a place, tap the
-- settled pill to un-toggle (which deletes the `user_visits` row and leaves the
-- review), rate it again — and `place_reviews` holds TWO rows for the same place,
-- both rating 4. There is no unique constraint, and RLS grants users
-- INSERT/SELECT/UPDATE on their own rows and NO DELETE, so a user cannot undo
-- their own duplicate. The table #1687 exists to start filling would be
-- un-deduplicated from its first day.
--
-- WHY THE SCHEMA AND NOT THE WRITE. A client-side "look for an existing row,
-- then update or insert" is two round trips with no atomicity — two devices, or
-- one device and a retry, still produce two rows. And the user has no DELETE
-- policy, so nothing in the client can clean up after itself. Only the database
-- can actually guarantee the invariant, so the invariant is stated here.
--
-- WHY A TRIGGER AS WELL AS AN INDEX. The index alone would turn a legitimate
-- RE-RATE into a raw 23505 the user could never resolve — they cannot delete the
-- first review, so their first rating would be permanent. The trigger makes the
-- second rating REPLACE the first (carrying its `created_at`, and its
-- `feedback_text` when the new row has none, so the history is not falsified),
-- and the index is what makes that guarantee true rather than merely intended.
--
-- SCOPED TO THE VOLUNTARY SURFACE. Rows with a `calendar_entry_id` are the
-- SCHEDULED path: one review per calendar entry, and the same place scheduled
-- twice legitimately yields two rows. Those are untouched in both halves —
-- predicate and trigger both return early. Rows with a NULL `user_id` or an empty
-- `card_id` are legacy/service-role writes with no owner to deduplicate against,
-- and are also excluded.
--
-- EXISTING ROWS NEEDED CLEANING: exactly one group. Probed read-only against
-- production (32 rows total) before writing this file:
--   user c727d491-4884-4e72-b467-d6c124b9a8b9, card_id
--   'curated_adventurous_1779562052422_1pg5oi', calendar_entry_id NULL,
--   two rows both `rating 5`, both `feedback_text NULL`, created 2026-05-30
--   20:48:30 and 21:00:08.
-- Note the date: this predates #1687 by ten weeks. Duplicate ownerless-of-a-
-- calendar-entry reviews were ALREADY reachable — #1687 did not introduce the
-- defect, it made it easy to hit. The cleanup below is written generically (keep
-- the OLDEST row per group, which preserves the original `created_at` and any
-- feedback attached to it) so it is correct whatever the table holds at apply
-- time, and it is a no-op once applied.

BEGIN;

-- 1 — collapse existing duplicates so the unique index below can be created.
--     Keeps the oldest row in each group; the trigger installed afterwards is
--     what keeps the RATING current from here on.
DELETE FROM public.place_reviews r
USING (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, card_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.place_reviews
  WHERE calendar_entry_id IS NULL
    AND user_id IS NOT NULL
    AND card_id IS NOT NULL
    AND card_id <> ''
) dupes
WHERE r.id = dupes.id
  AND dupes.rn > 1;

-- 2 — a re-rate REPLACES the previous voluntary review rather than adding one.
CREATE OR REPLACE FUNCTION public.place_reviews_replace_prior_voluntary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  prior public.place_reviews%ROWTYPE;
BEGIN
  -- The scheduled path owns its own row per calendar entry. Never touch it.
  IF NEW.calendar_entry_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- No owner or no card = nothing to deduplicate against.
  IF NEW.user_id IS NULL OR NEW.card_id IS NULL OR NEW.card_id = '' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO prior
  FROM public.place_reviews
  WHERE user_id = NEW.user_id
    AND card_id = NEW.card_id
    AND calendar_entry_id IS NULL
  ORDER BY created_at ASC, id ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- The user rated this place before. Their FIRST rating's timestamp is the
  -- honest "since when", and feedback they already left is not thrown away by a
  -- later rating that carries none (Constitution rule 9 — nothing is fabricated,
  -- and nothing real is silently dropped either).
  NEW.created_at := prior.created_at;
  IF NEW.feedback_text IS NULL THEN
    NEW.feedback_text := prior.feedback_text;
  END IF;

  -- SECURITY DEFINER because `place_reviews` deliberately grants users no DELETE
  -- policy: a user must not be able to erase reviews, but replacing their OWN
  -- rating of one place is not erasure. The predicate is pinned to NEW.user_id,
  -- so this can only ever reach the row the same user is replacing.
  DELETE FROM public.place_reviews
  WHERE user_id = NEW.user_id
    AND card_id = NEW.card_id
    AND calendar_entry_id IS NULL;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.place_reviews_replace_prior_voluntary() IS
  'Issue #1687: a second voluntary rating of the same card REPLACES the first, '
  'preserving created_at and any prior feedback_text. Scheduled reviews '
  '(calendar_entry_id NOT NULL) are untouched.';

DROP TRIGGER IF EXISTS place_reviews_replace_prior_voluntary_trg ON public.place_reviews;
CREATE TRIGGER place_reviews_replace_prior_voluntary_trg
  BEFORE INSERT ON public.place_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.place_reviews_replace_prior_voluntary();

-- 3 — and the database now GUARANTEES it, so a future writer that bypasses the
--     trigger's assumptions still cannot leave two.
CREATE UNIQUE INDEX IF NOT EXISTS place_reviews_one_voluntary_per_card
  ON public.place_reviews (user_id, card_id)
  WHERE calendar_entry_id IS NULL
    AND user_id IS NOT NULL
    AND card_id IS NOT NULL
    AND card_id <> '';

COMMENT ON INDEX public.place_reviews_one_voluntary_per_card IS
  'Issue #1687: one voluntary (non-calendar) review per user per card.';

COMMIT;
