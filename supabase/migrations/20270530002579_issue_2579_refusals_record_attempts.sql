BEGIN;
-- ===========================================================================
-- issue #2579 — A REFUSAL LOG RECORDS ATTEMPTS, NOT REFERENCES.
--
-- THE ROOT CAUSE, at last, and it was in this table from the first commit.
--
--   insert or update on table "checkout_refusals" violates foreign key
--   constraint "checkout_refusals_ticket_type_id_fkey"
--   Key (ticket_type_id)=(00000000-...) is not present in table "ticket_types"
--
-- `checkout_refusals` carried foreign keys to `events`, `ticket_types` and
-- `brands`. So the log could only record a refusal that pointed at rows which
-- still exist — and the refusals MOST worth recording are precisely the ones
-- that do not: `ticket_type_not_found`, `event_not_found`, a stale link, a
-- malformed client, an id from a cached page for a deleted event. The log was
-- structurally incapable of recording its own most important cases.
--
-- This is why four correct fixes in a row appeared to change nothing. The
-- allowlist WAS incomplete (#2640). The edge WAS collapsing the token (#2645).
-- The write WAS abandoned at the response (#2647). Each was real and each is
-- fixed — and behind all of them the INSERT was being rejected by a constraint,
-- while `.rpc()` reported success because it resolves rather than throws
-- (#2658). Every fix was verified against a lie.
--
-- AND `ON DELETE CASCADE` WAS WORSE THAN THE REJECTION. Deleting an event would
-- have erased every record of people failing to buy tickets for it. A forensic
-- log whose evidence disappears with the subject is not a log. Nobody had hit
-- that yet only because nothing was ever recorded.
--
-- A refusal is an OBSERVATION: at this time, someone tried to buy this, and was
-- told no. The ids are what the buyer SENT, not claims that those rows exist or
-- will continue to. Referential integrity is the wrong model for a record of
-- attempts, so the three foreign keys are dropped. The columns stay: still
-- uuids, still joinable when the row does exist, no longer a precondition for
-- being written down.
-- ===========================================================================

ALTER TABLE public.checkout_refusals
  DROP CONSTRAINT IF EXISTS checkout_refusals_event_id_fkey,
  DROP CONSTRAINT IF EXISTS checkout_refusals_ticket_type_id_fkey,
  DROP CONSTRAINT IF EXISTS checkout_refusals_brand_id_fkey;

DO $probe$
DECLARE v_n int;
BEGIN
  -- No foreign key may remain on this table. A future migration that re-adds
  -- one silently restores the defect, so assert the ABSENCE, not the drop.
  SELECT count(*) INTO v_n
  FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
  WHERE c.relname = 'checkout_refusals' AND con.contype = 'f';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'issue #2579: % foreign key(s) still on checkout_refusals', v_n;
  END IF;

  -- THE EXACT CALL THE EDGE MAKES, with the ids that were being rejected.
  PERFORM public.issue_2579_record_checkout_refusal(
    '459a73b3-d303-44fa-806b-4f85038b566f'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'event_no_active_dates', 1, 'probe-attempts', '+2348012345678',
    'probe@example.invalid');
  IF NOT EXISTS (SELECT 1 FROM public.checkout_refusals
                  WHERE surface = 'probe-attempts'
                    AND raise_token = 'event_no_active_dates') THEN
    RAISE EXCEPTION 'issue #2579: the real edge call is STILL rejected';
  END IF;

  -- The cases the log exists for: ids that point at nothing at all.
  PERFORM public.issue_2579_record_checkout_refusal(
    gen_random_uuid(), gen_random_uuid(),
    'ticket_type_not_found', 2, 'probe-ghost', NULL, NULL);
  IF NOT EXISTS (SELECT 1 FROM public.checkout_refusals
                  WHERE surface = 'probe-ghost'
                    AND raise_token = 'ticket_type_not_found') THEN
    RAISE EXCEPTION 'issue #2579: a refusal naming rows that do not exist is still refused';
  END IF;

  PERFORM public.issue_2579_record_checkout_refusal(
    gen_random_uuid(), NULL, 'event_not_found', 1, 'probe-ghost2', NULL, NULL);
  IF NOT EXISTS (SELECT 1 FROM public.checkout_refusals
                  WHERE surface = 'probe-ghost2' AND raise_token = 'event_not_found') THEN
    RAISE EXCEPTION 'issue #2579: event_not_found cannot be recorded — the log cannot see its own headline case';
  END IF;

  DELETE FROM public.checkout_refusals WHERE surface LIKE 'probe-%';
END $probe$;

COMMIT;
