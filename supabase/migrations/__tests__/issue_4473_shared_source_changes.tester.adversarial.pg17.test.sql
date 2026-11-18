\set ON_ERROR_STOP on
-- MINGLA-INVARIANT: I-4473-SHARED-HOLDER-FOLLOWS-SOURCE-STATE | issue #4473 | When a shared purchase stops entitling its holder (contact lapse, refund, cancel, RSVP declined, plus-one removed, event deleted), the holder leaves the brand Guest chat (or, before #4459, the event chat), and nobody still entitled another way is removed.
--
-- Part C: the purchase itself changes while the holder's proof still holds.
-- Parts A and B: a lapsed proof removes only the lapsed holder (the tester's
-- #4473 D3 regression), with #4459 and without it.

BEGIN;

CREATE FUNCTION pg_temp.u(p_tag text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v, 'sc-' || p_tag || '-' || v || '@example.test');
  RETURN v;
END $f$;
CREATE FUNCTION pg_temp.member(p_conv uuid, p_user uuid) RETURNS boolean
LANGUAGE sql AS $f$
  SELECT EXISTS (SELECT 1 FROM public.conversation_participants
                  WHERE conversation_id = p_conv AND user_id = p_user)
$f$;
CREATE FUNCTION pg_temp.guest_chat(p_brand uuid) RETURNS uuid
LANGUAGE sql AS $f$
  SELECT c.id FROM public.conversations c
   WHERE c.linked_entity_type = 'brand_guests'
     AND to_jsonb(c)->>'brand_id' = p_brand::text
$f$;
-- One brand, one paid ticket order owned by p_owner on p_email, shared with
-- p_holder. Returns the order id; the brand and event ids are derived.
CREATE FUNCTION pg_temp.shared_order(
  p_tag text, p_owner uuid, p_holder uuid, p_email text, p_phone text
) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_host uuid := pg_temp.u(p_tag || '-host');
  v_brand uuid := gen_random_uuid();
  v_e uuid := gen_random_uuid();
  v_tt uuid := gen_random_uuid();
  v_o uuid := gen_random_uuid();
  v_r jsonb;
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.creator_accounts(id) VALUES (v_host);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, pricing_currency, payment_provider)
  VALUES (v_brand, v_host, 'SC ' || p_tag, 'sc-' || p_tag || '-4473', 'USD', 'USD', 'stripe');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone, currency)
  VALUES (v_e, v_brand, 'SC ' || p_tag, 'sc-' || p_tag || '-ev-4473', 'event', 'scheduled', 'public', 'UTC', 'USD');
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency) VALUES (v_tt, v_e, 'GA', 1000, 'USD');
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, source)
  VALUES (v_o, v_e, p_owner, 'Owner', p_email, p_phone, 1000, 'USD', 'online_card', 'paid', 'online_checkout');
  INSERT INTO public.tickets(order_id, ticket_type_id, event_id, qr_code, status, approval_status)
  VALUES (v_o, v_tt, v_e, 'sc-qr-' || p_tag, 'valid', 'auto');
  PERFORM set_config('session_replication_role', 'origin', true);
  PERFORM public.add_buyer_to_event_chat(v_e, p_owner, v_o, NULL);
  PERFORM public.issue_4063_record_claim_contact(p_holder, 'email', p_email);
  v_r := public.issue_4473_share_purchases_by_verified_identity(p_holder);
  IF (v_r->>'count')::integer < 1 THEN
    RAISE EXCEPTION 'C setup %: the order was not shared: %', p_tag, v_r;
  END IF;
  RETURN v_o;
END $f$;

DO $t$
DECLARE
  v_owner uuid;
  v_holder uuid;
  v_o uuid;
  v_brand uuid;
  v_e uuid;
  v_guest uuid;
  v_case text;
  v_host uuid;
  v_rsvp_event uuid := gen_random_uuid();
  v_rsvp uuid := gen_random_uuid();
  v_parent uuid := gen_random_uuid();
  v_plus uuid := gen_random_uuid();
  v_r jsonb;
BEGIN
  IF to_regprocedure('public.issue_4459_safe_sync(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'C setup: #4459 is not in this chain';
  END IF;

  -- C1-C3. A shared ticket order is refunded, cancelled, or its event deleted.
  FOREACH v_case IN ARRAY ARRAY['refund', 'cancel', 'delete'] LOOP
    v_owner := pg_temp.u(v_case || '-owner');
    v_holder := pg_temp.u(v_case || '-holder');
    v_o := pg_temp.shared_order(v_case, v_owner, v_holder,
      'sc-' || v_case || '@example.test',
      CASE v_case WHEN 'refund' THEN '+12025557701'
        WHEN 'cancel' THEN '+12025557702' ELSE '+12025557703' END);
    SELECT o.event_id, e.brand_id INTO v_e, v_brand
      FROM public.orders o JOIN public.events e ON e.id = o.event_id WHERE o.id = v_o;
    v_guest := pg_temp.guest_chat(v_brand);
    IF v_guest IS NULL OR NOT pg_temp.member(v_guest, v_owner)
       OR NOT pg_temp.member(v_guest, v_holder) THEN
      RAISE EXCEPTION 'C % setup: owner and holder are not both in the Guest chat', v_case;
    END IF;
    IF v_case = 'refund' THEN
      UPDATE public.tickets SET status = 'refunded' WHERE order_id = v_o;
      UPDATE public.orders SET payment_status = 'refunded' WHERE id = v_o;
    ELSIF v_case = 'cancel' THEN
      UPDATE public.orders SET payment_status = 'cancelled', cancelled_at = now() WHERE id = v_o;
    ELSE
      UPDATE public.events SET deleted_at = now() WHERE id = v_e;
    END IF;
    PERFORM public.issue_4473_sweep_lapsed_shared_holders(500);
    IF public.issue_4459_brand_guest_eligible(v_brand, v_holder) THEN
      RAISE EXCEPTION 'C % the holder is still eligible after the change', v_case;
    END IF;
    IF pg_temp.member(v_guest, v_holder) THEN
      RAISE EXCEPTION 'C % the shared holder stayed in the Guest chat', v_case;
    END IF;
  END LOOP;

  -- C4-C5. A shared RSVP is declined; a shared plus-one is removed.
  v_owner := pg_temp.u('rsvp-owner');
  v_holder := pg_temp.u('rsvp-holder');
  v_host := pg_temp.u('rsvp-host');
  v_brand := gen_random_uuid();
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.creator_accounts(id) VALUES (v_host);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, pricing_currency, payment_provider)
  VALUES (v_brand, v_host, 'SC rsvp', 'sc-rsvp-4473', 'USD', 'USD', 'stripe');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone, currency)
  VALUES (v_rsvp_event, v_brand, 'SC rsvp', 'sc-rsvp-ev-4473', 'rsvp', 'scheduled', 'public', 'UTC', 'USD');
  INSERT INTO public.event_rsvps(id, event_id, user_id, guest_name, guest_email, guest_phone,
    rsvp_status, approval_status)
  VALUES (v_rsvp, v_rsvp_event, v_owner, 'Owner', 'sc-rsvp@example.test', '+12025557704', 'going', 'approved'),
         (v_parent, v_rsvp_event, v_host, 'Host', 'sc-host-rsvp@example.test', '+12025557706', 'going', 'approved');
  INSERT INTO public.event_rsvp_guests(id, rsvp_id, name, email, phone, matched_user_id)
  VALUES (v_plus, v_parent, 'Plus', 'sc-plus@example.test', '+12025557705', v_owner);
  INSERT INTO public.issue_4459_rsvp_server_approvals(rsvp_id) VALUES (v_rsvp), (v_parent);
  PERFORM set_config('session_replication_role', 'origin', true);
  PERFORM public.issue_4063_record_claim_contact(v_holder, 'email', 'sc-rsvp@example.test');
  PERFORM public.issue_4063_record_claim_contact(v_holder, 'email', 'sc-plus@example.test');
  v_r := public.issue_4473_share_purchases_by_verified_identity(v_holder);
  IF (v_r->>'count')::integer <> 2 THEN
    RAISE EXCEPTION 'C4 setup: expected the RSVP and the plus-one shared: %', v_r;
  END IF;
  PERFORM public.issue_4459_safe_sync(v_brand, v_holder, 'test');
  v_guest := pg_temp.guest_chat(v_brand);
  IF v_guest IS NULL OR NOT pg_temp.member(v_guest, v_holder) THEN
    RAISE EXCEPTION 'C4 setup: the RSVP holder is not in the Guest chat';
  END IF;
  UPDATE public.event_rsvps SET rsvp_status = 'not_going' WHERE id = v_rsvp;
  IF NOT pg_temp.member(v_guest, v_holder) THEN
    RAISE EXCEPTION 'C4 the holder left while still entitled through the plus-one';
  END IF;
  DELETE FROM public.event_rsvp_guests WHERE id = v_plus;
  IF pg_temp.member(v_guest, v_holder) THEN
    RAISE EXCEPTION 'C5 the holder stayed after the RSVP was declined and the plus-one removed';
  END IF;
  RAISE NOTICE 'C PASS: refund, cancel, event deletion, declined RSVP and removed plus-one all re-sync the holder';
END $t$;

ROLLBACK;

-- #4473 D3 regression: a lapsed share removes only the lapsed holder from the
-- chat; never a legitimate owner, team member, chat creator, ticket holder or
-- someone still entitled through another proven share.
BEGIN;

CREATE FUNCTION pg_temp.u(p_tag text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v, 'd3-' || p_tag || '-' || v || '@example.test');
  RETURN v;
END $f$;

CREATE FUNCTION pg_temp.member(p_conv uuid, p_user uuid) RETURNS boolean
LANGUAGE sql AS $f$
  SELECT EXISTS (SELECT 1 FROM public.conversation_participants
                  WHERE conversation_id = p_conv AND user_id = p_user)
$f$;

DO $t$
DECLARE
  v_host uuid := pg_temp.u('host');
  v_owner uuid := pg_temp.u('owner');
  v_plain uuid := pg_temp.u('plain');
  v_buyer uuid := pg_temp.u('buyer');      -- owns another paid order at the brand / event
  v_team uuid := pg_temp.u('team');
  v_double uuid := pg_temp.u('double');    -- also proves a second order's contact
  v_owner2 uuid := pg_temp.u('owner2');
  v_brand uuid := gen_random_uuid();
  v_e1 uuid := gen_random_uuid();
  v_e2 uuid := gen_random_uuid();
  v_tt1 uuid := gen_random_uuid();
  v_tt2 uuid := gen_random_uuid();
  v_o1 uuid := gen_random_uuid();
  v_o2 uuid := gen_random_uuid();
  v_o3 uuid := gen_random_uuid();
  v_email1 constant text := 'd3-shared-1@example.test';
  v_email2 constant text := 'd3-shared-2@example.test';
  v_guest uuid;
  v_r jsonb;
  v_u uuid;
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.creator_accounts(id) VALUES (v_host);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, pricing_currency, payment_provider)
  VALUES (v_brand, v_host, 'D3 brand', 'd3-brand-4473', 'USD', 'USD', 'stripe');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone, currency)
  VALUES (v_e1, v_brand, 'D3 one', 'd3-one-4473', 'event', 'scheduled', 'public', 'UTC', 'USD'),
         (v_e2, v_brand, 'D3 two', 'd3-two-4473', 'event', 'scheduled', 'public', 'UTC', 'USD');
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency)
  VALUES (v_tt1, v_e1, 'GA', 1000, 'USD'), (v_tt2, v_e2, 'GA', 1000, 'USD');
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, source)
  VALUES
    (v_o1, v_e1, v_owner, 'Owner', v_email1, '+12025557601', 1000, 'USD', 'online_card', 'paid', 'online_checkout'),
    (v_o2, v_e2, v_buyer, 'Buyer', 'd3-buyer-own@example.test', '+12025557602', 1000, 'USD', 'online_card', 'paid', 'online_checkout'),
    (v_o3, v_e1, v_owner2, 'Owner Two', v_email2, '+12025557603', 1000, 'USD', 'online_card', 'paid', 'online_checkout');
  INSERT INTO public.tickets(order_id, ticket_type_id, event_id, qr_code, status, approval_status)
  VALUES (v_o1, v_tt1, v_e1, 'd3-qr-1', 'valid', 'auto'),
         (v_o2, v_tt2, v_e2, 'd3-qr-2', 'valid', 'auto'),
         (v_o3, v_tt1, v_e1, 'd3-qr-3', 'valid', 'auto');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
  VALUES (v_brand, v_team, 'event_manager', now());
  PERFORM set_config('session_replication_role', 'origin', true);

  -- ── Part A: with #4459 (the live chain). ────────────────────────────────
  IF to_regprocedure('public.issue_4459_safe_sync(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'setup: #4459 is not in this chain';
  END IF;
  PERFORM public.add_buyer_to_event_chat(v_e1, v_owner, v_o1, NULL);
  PERFORM public.add_buyer_to_event_chat(v_e2, v_buyer, v_o2, NULL);
  PERFORM public.add_buyer_to_event_chat(v_e1, v_owner2, v_o3, NULL);
  FOREACH v_u IN ARRAY ARRAY[v_plain, v_buyer, v_team, v_double] LOOP
    PERFORM public.issue_4063_record_claim_contact(v_u, 'email', v_email1);
    v_r := public.issue_4473_share_purchases_by_verified_identity(v_u);
  END LOOP;
  PERFORM public.issue_4063_record_claim_contact(v_double, 'email', v_email2);
  v_r := public.issue_4473_share_purchases_by_verified_identity(v_double);
  SELECT id INTO v_guest FROM public.conversations
   WHERE linked_entity_type = 'brand_guests' AND brand_id = v_brand;
  IF v_guest IS NULL THEN RAISE EXCEPTION 'A setup: no Guest chat'; END IF;
  FOREACH v_u IN ARRAY ARRAY[v_owner, v_owner2, v_plain, v_buyer, v_team, v_double] LOOP
    IF NOT pg_temp.member(v_guest, v_u) THEN
      RAISE EXCEPTION 'A setup: % not in the Guest chat', v_u;
    END IF;
  END LOOP;

  -- Every account loses the first email at once.
  UPDATE public.account_claim_contacts SET revoked_at = now()
   WHERE value = v_email1 AND revoked_at IS NULL;
  PERFORM public.issue_4473_sweep_lapsed_shared_holders(500);

  IF pg_temp.member(v_guest, v_plain) THEN
    RAISE EXCEPTION 'A1 the lapsed plain holder stayed in the Guest chat';
  END IF;
  IF NOT pg_temp.member(v_guest, v_owner) THEN
    RAISE EXCEPTION 'A2 the owner was removed from the Guest chat';
  END IF;
  IF NOT pg_temp.member(v_guest, v_owner2) THEN
    RAISE EXCEPTION 'A2 another buyer was removed from the Guest chat';
  END IF;
  IF NOT pg_temp.member(v_guest, v_buyer) THEN
    RAISE EXCEPTION 'A3 a holder who owns another paid order at the brand was removed';
  END IF;
  IF NOT pg_temp.member(v_guest, v_team) THEN
    RAISE EXCEPTION 'A4 a brand team member was removed from the Guest chat';
  END IF;
  IF NOT pg_temp.member(v_guest, v_double) THEN
    RAISE EXCEPTION 'A5 a holder still shared through another proven order was removed';
  END IF;
  RAISE NOTICE 'D3-A PASS: with #4459 only the lapsed plain holder left the Guest chat';
END $t$;

ROLLBACK;

-- ── Part B: the pre-#4459 path (safe_sync absent), legacy event chat. ──────
BEGIN;
ALTER FUNCTION public.issue_4459_safe_sync(uuid, uuid, text) RENAME TO issue_4459_safe_sync_hidden_d3;

CREATE FUNCTION pg_temp.u(p_tag text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v, 'd3b-' || p_tag || '-' || v || '@example.test');
  RETURN v;
END $f$;
CREATE FUNCTION pg_temp.member(p_conv uuid, p_user uuid) RETURNS boolean
LANGUAGE sql AS $f$
  SELECT EXISTS (SELECT 1 FROM public.conversation_participants
                  WHERE conversation_id = p_conv AND user_id = p_user)
$f$;

DO $t$
DECLARE
  v_host uuid := pg_temp.u('host');
  v_owner uuid := pg_temp.u('owner');
  v_plain uuid := pg_temp.u('plain');
  v_buyer uuid := pg_temp.u('buyer');
  v_team uuid := pg_temp.u('team');
  v_creator uuid := pg_temp.u('creator');
  v_holder uuid := pg_temp.u('holder');
  v_double uuid := pg_temp.u('double');
  v_owner2 uuid := pg_temp.u('owner2');
  v_brand uuid := gen_random_uuid();
  v_e1 uuid := gen_random_uuid();
  v_tt1 uuid := gen_random_uuid();
  v_o1 uuid := gen_random_uuid();
  v_o2 uuid := gen_random_uuid();
  v_o3 uuid := gen_random_uuid();
  v_o4 uuid := gen_random_uuid();
  v_conv uuid := gen_random_uuid();
  v_email1 constant text := 'd3b-shared-1@example.test';
  v_email2 constant text := 'd3b-shared-2@example.test';
  v_u uuid;
BEGIN
  IF to_regprocedure('public.issue_4459_safe_sync(uuid,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'B setup: safe_sync still visible';
  END IF;
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.creator_accounts(id) VALUES (v_host);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, pricing_currency, payment_provider)
  VALUES (v_brand, v_host, 'D3B brand', 'd3b-brand-4473', 'USD', 'USD', 'stripe');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone, currency)
  VALUES (v_e1, v_brand, 'D3B one', 'd3b-one-4473', 'event', 'scheduled', 'public', 'UTC', 'USD');
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency)
  VALUES (v_tt1, v_e1, 'GA', 1000, 'USD');
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, source)
  VALUES
    (v_o1, v_e1, v_owner, 'Owner', v_email1, '+12025557611', 1000, 'USD', 'online_card', 'paid', 'online_checkout'),
    (v_o2, v_e1, v_buyer, 'Buyer', 'd3b-buyer-own@example.test', '+12025557612', 1000, 'USD', 'online_card', 'paid', 'online_checkout'),
    (v_o3, v_e1, v_owner2, 'Owner Two', v_email2, '+12025557613', 1000, 'USD', 'online_card', 'paid', 'online_checkout'),
    (v_o4, v_e1, v_host, 'Gifter', 'd3b-gifter@example.test', '+12025557614', 1000, 'USD', 'online_card', 'paid', 'online_checkout');
  INSERT INTO public.tickets(order_id, ticket_type_id, event_id, qr_code, status, approval_status)
  VALUES (v_o1, v_tt1, v_e1, 'd3b-qr-1', 'valid', 'auto'),
         (v_o2, v_tt1, v_e1, 'd3b-qr-2', 'valid', 'auto'),
         (v_o3, v_tt1, v_e1, 'd3b-qr-3', 'valid', 'auto');
  -- A ticket sent to and accepted by v_holder.
  INSERT INTO public.tickets(order_id, ticket_type_id, event_id, qr_code, status, approval_status,
    holder_user_id, transfer_state)
  VALUES (v_o4, v_tt1, v_e1, 'd3b-qr-4', 'valid', 'auto', v_holder, 'claimed');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
  VALUES (v_brand, v_team, 'event_manager', now());
  INSERT INTO public.conversations(id, type, linked_entity_type, event_id, created_by, name)
  VALUES (v_conv, 'group', 'event', v_e1, v_creator, 'D3B chat');
  INSERT INTO public.conversation_participants(conversation_id, user_id)
  SELECT v_conv, x FROM unnest(ARRAY[v_owner, v_owner2, v_plain, v_buyer, v_team, v_creator, v_holder, v_double]) x;
  PERFORM set_config('session_replication_role', 'origin', true);

  FOREACH v_u IN ARRAY ARRAY[v_plain, v_buyer, v_team, v_creator, v_holder, v_double] LOOP
    PERFORM public.issue_4063_record_claim_contact(v_u, 'email', v_email1);
    INSERT INTO public.purchase_shared_holders(kind, source_id, user_id) VALUES ('order', v_o1, v_u);
  END LOOP;
  PERFORM public.issue_4063_record_claim_contact(v_double, 'email', v_email2);
  INSERT INTO public.purchase_shared_holders(kind, source_id, user_id) VALUES ('order', v_o3, v_double);

  UPDATE public.account_claim_contacts SET revoked_at = now()
   WHERE value = v_email1 AND revoked_at IS NULL;
  PERFORM public.issue_4473_sweep_lapsed_shared_holders(500);
  IF EXISTS (SELECT 1 FROM public.purchase_shared_holders
              WHERE source_id = v_o1 AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'B setup: the sweep left a lapsed share live';
  END IF;

  IF pg_temp.member(v_conv, v_plain) THEN
    RAISE EXCEPTION 'B1 the lapsed plain holder stayed in the event chat';
  END IF;
  IF NOT pg_temp.member(v_conv, v_owner) OR NOT pg_temp.member(v_conv, v_owner2) THEN
    RAISE EXCEPTION 'B2 a buyer was removed from the event chat';
  END IF;
  IF NOT pg_temp.member(v_conv, v_buyer) THEN
    RAISE EXCEPTION 'B3 a holder who owns a paid order on the event was removed';
  END IF;
  IF NOT pg_temp.member(v_conv, v_team) THEN
    RAISE EXCEPTION 'B4 a brand team member was removed';
  END IF;
  IF NOT pg_temp.member(v_conv, v_creator) THEN
    RAISE EXCEPTION 'B5 the chat creator was removed';
  END IF;
  IF NOT pg_temp.member(v_conv, v_holder) THEN
    RAISE EXCEPTION 'B6 a ticket holder (sent ticket) was removed';
  END IF;
  IF NOT pg_temp.member(v_conv, v_double) THEN
    RAISE EXCEPTION 'B7 a holder still shared through another proven order was removed';
  END IF;

  -- Deleting a share (account deletion path) behaves the same.
  DELETE FROM public.purchase_shared_holders WHERE user_id = v_double;
  IF pg_temp.member(v_conv, v_double) THEN
    RAISE EXCEPTION 'B8 a deleted last share left the holder in the event chat';
  END IF;
  RAISE NOTICE 'D3-B PASS: without #4459 only lapsed, unentitled holders left the event chat';
END $t$;

ROLLBACK;
