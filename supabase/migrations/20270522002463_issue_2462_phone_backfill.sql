-- ===========================================================================
-- issue #2462 — REPAIR THE PHONE NUMBERS THAT WERE ALREADY CORRUPTED.
--
-- The code fix (composeE164) stops NEW corruption. This repairs the rows that
-- already carry an undeliverable number, so those guests can actually receive
-- the pass they already hold.
--
-- WHY IT IS SAFE TO DO AUTOMATICALLY. Only two patterns are touched, and both
-- are unambiguous — there is exactly one number each could have been:
--
--   +2340XXXXXXXXXX  (15 chars) -> +234XXXXXXXXXX
--     A Nigerian who typed 0803… into a field already showing +234. Nigerian
--     mobile numbers begin 7/8/9, so `+2340` followed by 7/8/9 cannot be
--     anything else. The pattern below REQUIRES that following digit.
--
--   +44234XXXXXXXXXX (16 chars) -> +234XXXXXXXXXX
--     A Nigerian who pasted their full international number while the picker
--     still showed the UK. `+44` followed by `234` + a valid NG subscriber
--     number is not a reachable UK number.
--
-- WHAT IS DELIBERATELY LEFT ALONE — repair requires certainty, and these have
-- more than one possible original, so they are reported for a human instead:
--   +23481770710755  — 11 subscriber digits, one too many; which digit is
--                      spurious cannot be known.
--   +109069902335    — very probably +2349069902335 (a Nigerian number typed
--                      on the US dial code) but "very probably" is a guess, and
--                      guessing someone's phone number is not a repair.
--   +2348214536871   — passes every length check, but 821 is not an allocated
--                      Nigerian mobile prefix. Wrong in a way this migration
--                      cannot see, and its SMS already failed terminally.
--
-- REVERSIBLE. Every change is recorded old -> new in
-- `issue_2462_phone_repair_audit` before it is applied, so the exact prior state
-- can be restored row by row.
--
-- IDEMPOTENT. Re-running repairs nothing further: the patterns no longer match
-- once fixed, and the audit insert is guarded by the same predicate.
--
-- NO MESSAGE IS SENT BY THIS MIGRATION. It rewrites stored numbers only.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.issue_2462_phone_repair_audit (
  id            bigserial PRIMARY KEY,
  table_name    text        NOT NULL,
  column_name   text        NOT NULL,
  row_id        text        NOT NULL,
  old_value     text        NOT NULL,
  new_value     text        NOT NULL,
  repaired_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.issue_2462_phone_repair_audit IS
  'issue #2462 — old -> new record of every phone number rewritten by the '
  'trunk-prefix repair, so the change is auditable and reversible per row.';

ALTER TABLE public.issue_2462_phone_repair_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.issue_2462_phone_repair_audit
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.issue_2462_phone_repair_audit TO service_role;

DO $repair$
DECLARE
  -- `+2340` + a real NG mobile prefix (7/8/9) + 9 more digits.
  c_ng_trunk CONSTANT text := '^\+2340[789][0-9]{9}$';
  -- `+44` + `234` + a real NG mobile prefix + 9 more digits.
  c_uk_wrap  CONSTANT text := '^\+44234[789][0-9]{9}$';
  v_rows     integer := 0;
  v_total    integer := 0;
BEGIN
  ---------------------------------------------------------------------------
  -- ticket_checkout_sessions.buyer_phone_e164
  ---------------------------------------------------------------------------
  INSERT INTO public.issue_2462_phone_repair_audit
    (table_name, column_name, row_id, old_value, new_value)
  SELECT 'ticket_checkout_sessions', 'buyer_phone_e164', s.id::text,
         s.buyer_phone_e164,
         CASE WHEN s.buyer_phone_e164 ~ c_ng_trunk
              THEN '+234' || substring(s.buyer_phone_e164 from 6)
              ELSE '+'    || substring(s.buyer_phone_e164 from 4) END
    FROM public.ticket_checkout_sessions s
   WHERE s.buyer_phone_e164 ~ c_ng_trunk OR s.buyer_phone_e164 ~ c_uk_wrap;

  UPDATE public.ticket_checkout_sessions s
     SET buyer_phone_e164 =
           CASE WHEN s.buyer_phone_e164 ~ c_ng_trunk
                THEN '+234' || substring(s.buyer_phone_e164 from 6)
                ELSE '+'    || substring(s.buyer_phone_e164 from 4) END
   WHERE s.buyer_phone_e164 ~ c_ng_trunk OR s.buyer_phone_e164 ~ c_uk_wrap;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_total := v_total + v_rows;
  RAISE NOTICE 'issue #2462: repaired % ticket_checkout_sessions row(s)', v_rows;

  ---------------------------------------------------------------------------
  -- orders.buyer_phone_e164
  ---------------------------------------------------------------------------
  INSERT INTO public.issue_2462_phone_repair_audit
    (table_name, column_name, row_id, old_value, new_value)
  SELECT 'orders', 'buyer_phone_e164', o.id::text, o.buyer_phone_e164,
         CASE WHEN o.buyer_phone_e164 ~ c_ng_trunk
              THEN '+234' || substring(o.buyer_phone_e164 from 6)
              ELSE '+'    || substring(o.buyer_phone_e164 from 4) END
    FROM public.orders o
   WHERE o.buyer_phone_e164 ~ c_ng_trunk OR o.buyer_phone_e164 ~ c_uk_wrap;

  UPDATE public.orders o
     SET buyer_phone_e164 =
           CASE WHEN o.buyer_phone_e164 ~ c_ng_trunk
                THEN '+234' || substring(o.buyer_phone_e164 from 6)
                ELSE '+'    || substring(o.buyer_phone_e164 from 4) END
   WHERE o.buyer_phone_e164 ~ c_ng_trunk OR o.buyer_phone_e164 ~ c_uk_wrap;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_total := v_total + v_rows;
  RAISE NOTICE 'issue #2462: repaired % orders.buyer_phone_e164 row(s)', v_rows;

  ---------------------------------------------------------------------------
  -- orders.buyer_phone (the display copy)
  ---------------------------------------------------------------------------
  INSERT INTO public.issue_2462_phone_repair_audit
    (table_name, column_name, row_id, old_value, new_value)
  SELECT 'orders', 'buyer_phone', o.id::text, o.buyer_phone,
         CASE WHEN o.buyer_phone ~ c_ng_trunk
              THEN '+234' || substring(o.buyer_phone from 6)
              ELSE '+'    || substring(o.buyer_phone from 4) END
    FROM public.orders o
   WHERE o.buyer_phone ~ c_ng_trunk OR o.buyer_phone ~ c_uk_wrap;

  UPDATE public.orders o
     SET buyer_phone =
           CASE WHEN o.buyer_phone ~ c_ng_trunk
                THEN '+234' || substring(o.buyer_phone from 6)
                ELSE '+'    || substring(o.buyer_phone from 4) END
   WHERE o.buyer_phone ~ c_ng_trunk OR o.buyer_phone ~ c_uk_wrap;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_total := v_total + v_rows;
  RAISE NOTICE 'issue #2462: repaired % orders.buyer_phone row(s)', v_rows;

  ---------------------------------------------------------------------------
  -- tickets.attendee_phone (copied from the session at mint)
  ---------------------------------------------------------------------------
  INSERT INTO public.issue_2462_phone_repair_audit
    (table_name, column_name, row_id, old_value, new_value)
  SELECT 'tickets', 'attendee_phone', t.id::text, t.attendee_phone,
         CASE WHEN t.attendee_phone ~ c_ng_trunk
              THEN '+234' || substring(t.attendee_phone from 6)
              ELSE '+'    || substring(t.attendee_phone from 4) END
    FROM public.tickets t
   WHERE t.attendee_phone ~ c_ng_trunk OR t.attendee_phone ~ c_uk_wrap;

  UPDATE public.tickets t
     SET attendee_phone =
           CASE WHEN t.attendee_phone ~ c_ng_trunk
                THEN '+234' || substring(t.attendee_phone from 6)
                ELSE '+'    || substring(t.attendee_phone from 4) END
   WHERE t.attendee_phone ~ c_ng_trunk OR t.attendee_phone ~ c_uk_wrap;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_total := v_total + v_rows;
  RAISE NOTICE 'issue #2462: repaired % tickets.attendee_phone row(s)', v_rows;

  RAISE NOTICE 'issue #2462: % phone value(s) repaired in total', v_total;
END
$repair$;

-- ---------------------------------------------------------------------------
-- POST-MIGRATION PROBES. These RAISE — a repair that silently did nothing, or
-- that produced an invalid number, must not report success (the #2113 lesson).
-- ---------------------------------------------------------------------------
DO $probe$
DECLARE v_left integer; v_bad integer; v_audited integer;
BEGIN
  SELECT count(*) INTO v_left FROM (
    SELECT 1 FROM public.ticket_checkout_sessions
      WHERE buyer_phone_e164 ~ '^\+2340[789][0-9]{9}$' OR buyer_phone_e164 ~ '^\+44234[789][0-9]{9}$'
    UNION ALL
    SELECT 1 FROM public.orders
      WHERE buyer_phone_e164 ~ '^\+2340[789][0-9]{9}$' OR buyer_phone_e164 ~ '^\+44234[789][0-9]{9}$'
         OR buyer_phone      ~ '^\+2340[789][0-9]{9}$' OR buyer_phone      ~ '^\+44234[789][0-9]{9}$'
    UNION ALL
    SELECT 1 FROM public.tickets
      WHERE attendee_phone ~ '^\+2340[789][0-9]{9}$' OR attendee_phone ~ '^\+44234[789][0-9]{9}$'
  ) x;
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'issue #2462 probe: % corrupted phone value(s) still match the repair pattern', v_left;
  END IF;

  -- Every value we WROTE must be a well-formed Nigerian E.164. If the string
  -- surgery were off by one this catches it before anyone tries to send to it.
  SELECT count(*) INTO v_bad FROM public.issue_2462_phone_repair_audit
   WHERE new_value !~ '^\+234[789][0-9]{9}$';
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'issue #2462 probe: % repaired value(s) are not valid NG E.164', v_bad;
  END IF;

  SELECT count(*) INTO v_audited FROM public.issue_2462_phone_repair_audit;
  RAISE NOTICE 'issue #2462: % repair(s) recorded and reversible', v_audited;
END
$probe$;
