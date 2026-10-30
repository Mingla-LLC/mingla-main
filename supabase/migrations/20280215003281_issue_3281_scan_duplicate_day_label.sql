-- issue #3281 PR8 — duplicate / day-scoped scan responses must surface the
-- day being scanned so the door can say "Already scanned for Sat 25 Oct".
--
-- `biz_ticket_scan` only assigns `v_admitted_day` on success. Duplicate rungs
-- leave it NULL even when `v_target_day` is known, so the JSON `eventDateId`
-- was missing on real duplicates. Return COALESCE(admitted, target).

DO $patch$
DECLARE
  v_oid oid;
  v_def text;
  v_next text;
BEGIN
  v_oid := to_regprocedure('public.biz_ticket_scan(uuid, text, uuid, text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'issue_3281_scan_duplicate_day_label: biz_ticket_scan missing';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  IF position('''eventDateId'', v_admitted_day' in v_def) = 0 THEN
    IF position('''eventDateId'', COALESCE(v_admitted_day, v_target_day)' in v_def) > 0 THEN
      RAISE NOTICE 'issue_3281_scan_duplicate_day_label: already patched';
      RETURN;
    END IF;
    RAISE EXCEPTION
      'issue_3281_scan_duplicate_day_label: expected eventDateId return not found';
  END IF;

  v_next := replace(
    v_def,
    '''eventDateId'', v_admitted_day',
    '''eventDateId'', COALESCE(v_admitted_day, v_target_day)'
  );
  IF v_next = v_def THEN
    RAISE EXCEPTION 'issue_3281_scan_duplicate_day_label: replace produced no change';
  END IF;

  EXECUTE v_next;
END;
$patch$;

DO $probe$
DECLARE
  v_def text := pg_get_functiondef(
    'public.biz_ticket_scan(uuid, text, uuid, text)'::regprocedure
  );
BEGIN
  IF position('''eventDateId'', COALESCE(v_admitted_day, v_target_day)' in v_def) = 0 THEN
    RAISE EXCEPTION
      'issue_3281_scan_duplicate_day_label probe failed: COALESCE return missing';
  END IF;
END;
$probe$;
