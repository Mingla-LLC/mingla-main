-- #1929 independent tester: exact-key non-enumeration, indistinguishable denial,
-- truthful tier projection, and authoritative checkout denial. Transaction-local.
\set ON_ERROR_STOP on
BEGIN;
DO $tester$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_other_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_private uuid := gen_random_uuid();
  v_wrong_type uuid := gen_random_uuid();
  v_tier uuid;
  v_bundle json;
  v_denials json[];
  v_slug text := 'i1929-tester-' || replace(gen_random_uuid()::text, '-', '');
BEGIN
  INSERT INTO auth.users(id) VALUES (v_user);
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, pricing_currency, payment_provider)
  VALUES (v_brand, v_user, 'I1929 tester', v_slug, 'NGN', 'NGN', 'paystack'),
         (v_other_brand, v_user, 'I1929 other', v_slug || '-other', 'NGN', 'NGN', 'paystack');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone, currency, published_at)
  VALUES (v_event, v_brand, 'Hidden exact', 'hidden', 'event', 'live', 'hidden', 'Africa/Lagos', 'NGN', now()),
         (v_private, v_brand, 'Private exact', 'private', 'event', 'live', 'private', 'Africa/Lagos', 'NGN', now()),
         (v_wrong_type, v_brand, 'RSVP exact', 'rsvp', 'rsvp', 'live', 'public', 'Africa/Lagos', 'NGN', now());
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,min_purchase_qty,available_online,available_in_person,display_order,is_hidden,is_disabled)
  VALUES (v_event,'disabled projection',10000,'NGN',false,10,1,true,false,0,false,true)
  RETURNING id INTO v_tier;

  SELECT public.pg_direct_event_checkout_bundle(v_event,NULL,NULL) INTO v_bundle;
  IF v_bundle IS NULL OR json_array_length(v_bundle->'tickets') <> 1
     OR (v_bundle#>>'{tickets,0,isDisabled}')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'T1929-A1 hidden/disabled tier was not truthfully projected';
  END IF;
  IF v_bundle::jsonb IS DISTINCT FROM public.pg_direct_event_checkout_bundle(NULL,v_slug,'hidden')::jsonb THEN
    RAISE EXCEPTION 'T1929-A2 exact UUID/slug identity diverged';
  END IF;

  -- Mixed identities and every denied identity collapse to the same SQL NULL.
  v_denials := ARRAY[
    public.pg_direct_event_checkout_bundle(v_event,v_slug,'hidden'),
    public.pg_direct_event_checkout_bundle(NULL,v_slug||'-other','hidden'),
    public.pg_direct_event_checkout_bundle(v_private,NULL,NULL),
    public.pg_direct_event_checkout_bundle(v_wrong_type,NULL,NULL),
    public.pg_direct_event_checkout_bundle(gen_random_uuid(),NULL,NULL),
    public.pg_direct_event_checkout_bundle(NULL,v_slug,'missing')
  ];
  IF EXISTS (SELECT 1 FROM unnest(v_denials) d WHERE d IS NOT NULL) THEN
    RAISE EXCEPTION 'T1929-A3 denied/mixed identities leaked a distinguishable bundle: %', v_denials;
  END IF;

  -- Hydration may truthfully show a disabled tier; checkout remains authority.
  BEGIN
    PERFORM public.biz_ticket_checkout_create_session(
      v_event,NULL,'Tester','tester1929@example.test','+2348012345678',false,
      jsonb_build_array(jsonb_build_object('ticketTypeId',v_tier,'quantity',1)),
      'i1929-tester-disabled-'||v_event,now()+interval '15 minutes',0,'auto');
    RAISE EXCEPTION 'T1929-A4 disabled tier checkout unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'ticket_type_unavailable' THEN
      RAISE EXCEPTION 'T1929-A4 expected ticket_type_unavailable, got %', SQLERRM;
    END IF;
  END;
END
$tester$;
ROLLBACK;
DO $residue$ BEGIN
  IF EXISTS (SELECT 1 FROM public.brands WHERE name IN ('I1929 tester','I1929 other')) THEN
    RAISE EXCEPTION 'T1929-A5 rollback residue';
  END IF;
END $residue$;
\echo '#1929 tester SQL adversarial PASS'
