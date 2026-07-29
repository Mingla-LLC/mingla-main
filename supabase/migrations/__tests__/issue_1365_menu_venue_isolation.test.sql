-- Issue #1365 happy-path SQL contract. Run after the migration in a disposable
-- database. The assertions intentionally inspect the deployed definitions so
-- reverting venue ownership or the exact-venue public join fails.
DO $test$
DECLARE
  v_view text;
  v_trigger_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'menus'
      AND column_name = 'venue_id'
  ) THEN
    RAISE EXCEPTION 'issue_1365: menus.venue_id missing';
  END IF;

  SELECT pg_get_viewdef('public.public_menus_view'::regclass, true)
  INTO v_view;
  IF v_view NOT LIKE '%v.id = m.venue_id%'
     OR v_view NOT LIKE '%v.claim_status = ''verified''%' THEN
    RAISE EXCEPTION 'issue_1365: public menu is not exact verified venue scoped';
  END IF;

  SELECT count(*)
  INTO v_trigger_count
  FROM pg_trigger
  WHERE tgrelid = 'public.menus'::regclass
    AND NOT tgisinternal
    AND tgname IN ('menus_venue_brand_match', 'menus_require_venue_on_write');
  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION 'issue_1365: menu venue write guards missing';
  END IF;
END;
$test$;
