-- Issue #3872 R1 discounts — M4 venue orders and reservation deposits.

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_3872_expand_checkout_discount_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_line jsonb;
  v_applied jsonb;
  v_order_kind text;
  v_line_ref text;
  v_currency text;
BEGIN
  IF NEW.discount_snapshot IS NULL THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.discount_snapshot) IS DISTINCT FROM 'object'
     OR jsonb_typeof(NEW.discount_snapshot->'lines') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'discount_snapshot_invalid';
  END IF;

  v_order_kind := CASE TG_TABLE_NAME
    WHEN 'venue_orders' THEN 'venue_order'
    ELSE 'reservation_deposit'
  END;
  v_currency := upper(COALESCE(NULLIF(NEW.discount_snapshot->>'currency',''), NEW.currency));

  FOR v_line IN
    SELECT value FROM jsonb_array_elements(NEW.discount_snapshot->'lines')
  LOOP
    v_line_ref := CASE WHEN v_order_kind='venue_order' THEN v_line->>'lineRef' ELSE NULL END;
    FOR v_applied IN
      SELECT value FROM jsonb_array_elements(COALESCE(v_line->'applied','[]'::jsonb))
    LOOP
      INSERT INTO public.order_discount_lines(
        order_kind, order_id, line_ref, discount_id, brand_id, kind,
        code_snapshot, name_snapshot, value_type, value_bps, value_minor,
        units, amount_minor, applied_seq, currency
      ) VALUES (
        v_order_kind, NEW.id, v_line_ref,
        (v_applied->>'discountId')::uuid, NEW.brand_id, v_applied->>'kind',
        NULLIF(v_applied->>'code',''), v_applied->>'name',
        v_applied->>'valueType', NULLIF(v_applied->>'valueBps','')::integer,
        NULLIF(v_applied->>'valueMinor','')::integer,
        (v_applied->>'units')::integer, (v_applied->>'lineMinor')::integer,
        (v_applied->>'seq')::smallint, v_currency
      ) ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3872_expand_checkout_discount_snapshot() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_3872_venue_discount_snapshot ON public.venue_orders;
CREATE TRIGGER issue_3872_venue_discount_snapshot
AFTER INSERT ON public.venue_orders
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_expand_checkout_discount_snapshot();

DROP TRIGGER IF EXISTS issue_3872_deposit_discount_snapshot ON public.reservation_checkout_sessions;
CREATE TRIGGER issue_3872_deposit_discount_snapshot
AFTER INSERT ON public.reservation_checkout_sessions
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_expand_checkout_discount_snapshot();

-- A staff round reserves with p_consume=true before its order insert. If that
-- insert aborts, there is no order to own the consumed use, so the explicit
-- release seam may release exactly that unowned staff use as well.
CREATE OR REPLACE FUNCTION public.issue_3872_release_discount_uses(
  p_kind text,
  p_ref_id uuid
) RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.discount_uses
     SET status='released', released_at=now(), consumed_at=NULL
   WHERE checkout_kind=p_kind
     AND checkout_ref_id=p_ref_id
     AND (
       status='reserved'
       OR (status='consumed' AND channel='staff' AND order_id IS NULL)
     );
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_release_discount_uses(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_release_discount_uses(text,uuid) TO service_role;

DO $postcheck$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.venue_orders'::regclass
      AND tgname='issue_3872_venue_discount_snapshot' AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.reservation_checkout_sessions'::regclass
      AND tgname='issue_3872_deposit_discount_snapshot' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'issue #3872 M4 snapshot triggers missing';
  END IF;
END;
$postcheck$;

COMMIT;
