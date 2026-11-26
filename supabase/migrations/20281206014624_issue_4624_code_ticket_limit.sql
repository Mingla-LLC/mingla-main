-- Issue #4624 — a discount code can stop after N tickets ("Total tickets"),
-- as well as after N checkouts ("Total uses" = max_total_uses).
--
-- Constraint and function replacements only: no table, column, policy or data
-- change, and every statement is re-runnable.
--   1. bd_count_end: kind 'code' may now carry ends_after_count (D2a: both
--      limits are kept; whichever runs out first ends the code).
--   2. issue_3872_discount_apply (body of 20271216003872 lines 484-854): a code
--      with no tickets left is rejected 'used_up', and the code pass runs the
--      same per-line ticket check as the automatic pass (D1a): a line with more
--      tickets than remain gets no code discount and a 'sale_limited' notice
--      (discountKind 'code') carrying discountId, lineRef and remaining.
--   3. issue_3872_discount_candidates (body of 20271216003872 lines 859-916): the
--      code branch computes remainingUnits exactly like the automatic branch
--      (consumed plus live reserved units) and its limited flag includes
--      ends_after_count.
-- Concurrency: issue_3872_reserve_discount_uses already locks every candidate
-- whose ends_after_count, max_total_uses or max_uses_per_buyer is set
-- (issue_3872_lock_limited_discounts) and re-reads the candidates after the
-- lock, so parallel reservations of a ticket-capped code serialise.
-- The writer (issue_3872_upsert_discount) already passes endsAfterCount through
-- for every kind; the old constraint was the only refusal. The column CHECK
-- (ends_after_count > 0) still refuses 0 and negatives.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Codes may end after a number of tickets.
-- ---------------------------------------------------------------------------
ALTER TABLE public.brand_discounts DROP CONSTRAINT IF EXISTS bd_count_end;
ALTER TABLE public.brand_discounts ADD CONSTRAINT bd_count_end
  CHECK (ends_after_count IS NULL OR kind IN ('automatic','sale_price','code'));

-- ---------------------------------------------------------------------------
-- 2. Engine: ticket-capped code pass.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3872_discount_apply(p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $fn$
DECLARE
  v_currency text := upper(COALESCE(p_input->>'currency',''));
  v_at timestamptz := COALESCE((p_input->>'at')::timestamptz,now());
  v_queued boolean := COALESCE((p_input->>'queued')::boolean,false);
  v_lines jsonb := '[]'::jsonb;
  v_ranked jsonb := '[]'::jsonb;
  v_chosen jsonb := '[]'::jsonb;
  v_state jsonb := '[]'::jsonb;
  v_notices jsonb := '[]'::jsonb;
  v_code jsonb := p_input->'code';
  v_lookup text := COALESCE(p_input->>'codeLookup','none');
  v_internal boolean := COALESCE((p_input->>'_skipConflict')::boolean,false);
  v_line jsonb; v_d jsonb; v_other jsonb; v_target jsonb; v_ap jsonb;
  v_eligible boolean; v_live boolean; v_compatible boolean;
  v_qty integer; v_value_scale integer; v_count_scale integer;
  v_list integer; v_old integer; v_new integer; v_line_minor integer;
  v_score bigint; v_eligible_list bigint; v_eligible_net bigint;
  v_remaining bigint; v_required bigint; v_units integer; v_seq integer;
  v_code_reason text; v_with text; v_candidate jsonb; v_filtered jsonb;
  v_a_net bigint; v_b_net bigint; v_replaced jsonb;
  v_code_outcome jsonb := jsonb_build_object('status','none','reason',NULL,'required',NULL,'with',NULL,'replaced','[]'::jsonb);
  v_applied jsonb; v_list_total bigint; v_net_total bigint; v_digest text; v_list_digest text;
  v_score_notices jsonb;
BEGIN
  IF jsonb_typeof(p_input->'lines') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'discount_lines_invalid';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'lineRef',x->>'lineRef','itemKind',x->>'itemKind','itemId',x->'itemId',
      'listingId',x->'listingId','listingKind',x->>'listingKind',
      'listUnitMinor',GREATEST(0,COALESCE((x->>'listUnitMinor')::integer,0)),
      'qty',GREATEST(1,COALESCE((x->>'qty')::integer,1)),
      'valueScale',GREATEST(1,COALESCE((x->>'valueScale')::integer,1)),
      'countScale',GREATEST(1,COALESCE((x->>'countScale')::integer,1)),
      'allowed',COALESCE((x->>'allowed')::boolean,false),
      'tz',COALESCE(NULLIF(x->>'tz',''),'UTC')
    ) ORDER BY x->>'lineRef'
  ),'[]'::jsonb) INTO v_lines
  FROM jsonb_array_elements(p_input->'lines') x;

  -- Score live automatic discounts independently, then sort deterministically.
  FOR v_d IN SELECT value FROM jsonb_array_elements(COALESCE(p_input->'automatics','[]'::jsonb))
  LOOP
    v_live := COALESCE(v_d->>'status','active')='active'
      AND (v_d->'deletedAt' IS NULL OR v_d->>'deletedAt' IS NULL)
      AND (v_d->'needsAttention' IS NULL OR v_d->>'needsAttention' IS NULL)
      AND COALESCE((v_d->>'startsAt')::timestamptz,'-infinity'::timestamptz) <= v_at
      AND COALESCE((v_d->>'endsAt')::timestamptz,'infinity'::timestamptz) > v_at
      AND (v_d->'currency' IS NULL OR v_d->>'currency' IS NULL OR upper(v_d->>'currency')=v_currency)
      AND (NOT v_queued OR NOT COALESCE((v_d->>'limited')::boolean,false));
    IF NOT v_live OR COALESCE(v_d->>'kind','') NOT IN ('automatic','sale_price') THEN CONTINUE; END IF;

    v_eligible_list := 0;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
      v_eligible := COALESCE((v_line->>'allowed')::boolean,false)
        AND (v_line->>'listUnitMinor')::integer > 0
        AND (
          v_d->>'scopeKind'='brand'
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(v_d->'targets','[]'::jsonb)) t
            WHERE (t->>'targetKind'='listing_kind' AND t->>'listingKind'=v_line->>'listingKind')
               OR (t->>'targetKind'='event' AND t->>'targetId'=v_line->>'listingId'
                   AND v_line->>'listingKind' IN ('event','experience','trip'))
               OR (t->>'targetKind'='venue_menu' AND t->>'targetId'=v_line->>'listingId'
                   AND v_line->>'itemKind'='menu_item')
               OR (t->>'targetKind'='venue_deposit' AND t->>'targetId'=v_line->>'listingId'
                   AND v_line->>'itemKind'='venue_deposit')
               OR (t->>'targetKind' IN ('ticket_type','menu_item') AND t->>'targetId'=v_line->>'itemId')
          )
        );
      IF v_eligible AND v_d->'schedule' IS NOT NULL AND v_d->'schedule' <> 'null'::jsonb THEN
        v_eligible := EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_d->'schedule'->'days') day
          WHERE day::integer=extract(isodow FROM (v_at AT TIME ZONE (v_line->>'tz')))::integer
        ) AND to_char(v_at AT TIME ZONE (v_line->>'tz'),'HH24:MI') >= v_d->'schedule'->>'from'
          AND to_char(v_at AT TIME ZONE (v_line->>'tz'),'HH24:MI') < v_d->'schedule'->>'to';
      END IF;
      IF v_eligible THEN
        v_eligible_list := v_eligible_list
          + (v_line->>'listUnitMinor')::bigint*(v_line->>'qty')::integer;
      END IF;
    END LOOP;
    IF v_eligible_list < COALESCE((v_d->>'minSubtotalMinor')::bigint,0) THEN CONTINUE; END IF;

    v_score := 0;
    v_score_notices := '[]'::jsonb;
    v_remaining := CASE WHEN v_d->'remainingUnits' IS NULL OR v_d->>'remainingUnits' IS NULL
      THEN NULL ELSE (v_d->>'remainingUnits')::bigint END;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
      v_eligible := COALESCE((v_line->>'allowed')::boolean,false)
        AND (v_line->>'listUnitMinor')::integer > 0
        AND (
          v_d->>'scopeKind'='brand'
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(v_d->'targets','[]'::jsonb)) t
            WHERE (t->>'targetKind'='listing_kind' AND t->>'listingKind'=v_line->>'listingKind')
               OR (t->>'targetKind'='event' AND t->>'targetId'=v_line->>'listingId'
                   AND v_line->>'listingKind' IN ('event','experience','trip'))
               OR (t->>'targetKind'='venue_menu' AND t->>'targetId'=v_line->>'listingId'
                   AND v_line->>'itemKind'='menu_item')
               OR (t->>'targetKind'='venue_deposit' AND t->>'targetId'=v_line->>'listingId'
                   AND v_line->>'itemKind'='venue_deposit')
               OR (t->>'targetKind' IN ('ticket_type','menu_item') AND t->>'targetId'=v_line->>'itemId')
          )
        );
      IF v_eligible AND v_d->'schedule' IS NOT NULL AND v_d->'schedule'<>'null'::jsonb THEN
        v_eligible := EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_d->'schedule'->'days') day
          WHERE day::integer=extract(isodow FROM (v_at AT TIME ZONE (v_line->>'tz')))::integer
        ) AND to_char(v_at AT TIME ZONE (v_line->>'tz'),'HH24:MI') >= v_d->'schedule'->>'from'
          AND to_char(v_at AT TIME ZONE (v_line->>'tz'),'HH24:MI') < v_d->'schedule'->>'to';
      END IF;
      IF NOT v_eligible THEN CONTINUE; END IF;
      v_qty := (v_line->>'qty')::integer;
      v_count_scale := (v_line->>'countScale')::integer;
      IF v_remaining IS NOT NULL AND v_remaining < v_qty*v_count_scale THEN
        v_score_notices := v_score_notices || jsonb_build_array(jsonb_build_object(
          'type','sale_limited','discountId',v_d->>'id','lineRef',v_line->>'lineRef',
          'remaining',floor(v_remaining::numeric/v_count_scale)::integer
        ));
        CONTINUE;
      END IF;
      IF v_remaining IS NOT NULL THEN v_remaining := v_remaining-v_qty*v_count_scale; END IF;
      v_old := (v_line->>'listUnitMinor')::integer;
      v_value_scale := (v_line->>'valueScale')::integer;
      IF v_d->>'valueType'='set_price' THEN
        v_new := LEAST(v_old,COALESCE((v_d->>'valueMinor')::integer,0)*v_value_scale);
      ELSIF v_d->>'valueType'='percent' THEN
        v_new := v_old-round(v_old::numeric*COALESCE((v_d->>'valueBps')::integer,0)/10000)::integer;
      ELSE
        v_new := v_old-LEAST(v_old,COALESCE((v_d->>'valueMinor')::integer,0)*v_value_scale);
      END IF;
      v_score := v_score+GREATEST(0,v_old-v_new)*v_qty;
    END LOOP;
    IF v_score > 0 THEN
      v_ranked := v_ranked || jsonb_build_array(jsonb_build_object('d',v_d,'saving',v_score));
    ELSE
      v_notices := v_notices || v_score_notices;
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'saving')::bigint DESC,
    COALESCE((x->'d'->>'createdAt')::timestamptz,'infinity'::timestamptz),x->'d'->>'id'),'[]'::jsonb)
    INTO v_ranked FROM jsonb_array_elements(v_ranked) x;

  FOR v_d IN SELECT value->'d' FROM jsonb_array_elements(v_ranked) LOOP
    v_compatible := true;
    FOR v_other IN SELECT value FROM jsonb_array_elements(v_chosen) LOOP
      IF NOT (
        ((v_d->>'combinesWith'='any') OR (v_d->>'combinesWith'='automatic_only' AND v_other->>'kind' IN ('automatic','sale_price')))
        AND ((v_other->>'combinesWith'='any') OR (v_other->>'combinesWith'='automatic_only' AND v_d->>'kind' IN ('automatic','sale_price')))
      ) THEN v_compatible:=false; EXIT; END IF;
    END LOOP;
    IF v_compatible THEN v_chosen:=v_chosen||jsonb_build_array(v_d); END IF;
  END LOOP;

  -- State starts from the sorted list lines.
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
    v_state := v_state || jsonb_build_array(v_line || jsonb_build_object(
      'netUnitMinor',(v_line->>'listUnitMinor')::integer,'applied','[]'::jsonb
    ));
  END LOOP;

  -- Apply the chosen automatics in type order and chosen order.
  FOR v_d IN
    SELECT c.value FROM jsonb_array_elements(v_chosen) WITH ORDINALITY c(value,ord)
    ORDER BY CASE c.value->>'valueType' WHEN 'set_price' THEN 1 WHEN 'percent' THEN 2 ELSE 3 END,c.ord
  LOOP
    v_remaining := CASE WHEN v_d->'remainingUnits' IS NULL OR v_d->>'remainingUnits' IS NULL
      THEN NULL ELSE (v_d->>'remainingUnits')::bigint END;
    v_lines := '[]'::jsonb;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_state) ORDER BY value->>'lineRef' LOOP
      v_eligible := COALESCE((v_line->>'allowed')::boolean,false)
        AND (v_line->>'listUnitMinor')::integer > 0
        AND (
          v_d->>'scopeKind'='brand'
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(v_d->'targets','[]'::jsonb)) t
            WHERE (t->>'targetKind'='listing_kind' AND t->>'listingKind'=v_line->>'listingKind')
               OR (t->>'targetKind'='event' AND t->>'targetId'=v_line->>'listingId'
                   AND v_line->>'listingKind' IN ('event','experience','trip'))
               OR (t->>'targetKind'='venue_menu' AND t->>'targetId'=v_line->>'listingId'
                   AND v_line->>'itemKind'='menu_item')
               OR (t->>'targetKind'='venue_deposit' AND t->>'targetId'=v_line->>'listingId'
                   AND v_line->>'itemKind'='venue_deposit')
               OR (t->>'targetKind' IN ('ticket_type','menu_item') AND t->>'targetId'=v_line->>'itemId')
          )
        );
      IF v_eligible AND v_d->'schedule' IS NOT NULL AND v_d->'schedule'<>'null'::jsonb THEN
        v_eligible := EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_d->'schedule'->'days') day
          WHERE day::integer=extract(isodow FROM (v_at AT TIME ZONE (v_line->>'tz')))::integer
        ) AND to_char(v_at AT TIME ZONE (v_line->>'tz'),'HH24:MI') >= v_d->'schedule'->>'from'
          AND to_char(v_at AT TIME ZONE (v_line->>'tz'),'HH24:MI') < v_d->'schedule'->>'to';
      END IF;
      v_qty:=(v_line->>'qty')::integer; v_count_scale:=(v_line->>'countScale')::integer;
      IF v_eligible AND v_remaining IS NOT NULL AND v_remaining < v_qty*v_count_scale THEN
        v_notices := v_notices || jsonb_build_array(jsonb_build_object(
          'type','sale_limited','discountId',v_d->>'id','lineRef',v_line->>'lineRef',
          'remaining',floor(v_remaining::numeric/v_count_scale)::integer
        ));
        v_eligible:=false;
      END IF;
      IF v_eligible THEN
        IF v_remaining IS NOT NULL THEN v_remaining:=v_remaining-v_qty*v_count_scale; END IF;
        v_old:=(v_line->>'netUnitMinor')::integer; v_value_scale:=(v_line->>'valueScale')::integer;
        IF v_d->>'valueType'='set_price' THEN
          v_new:=LEAST(v_old,COALESCE((v_d->>'valueMinor')::integer,0)*v_value_scale);
        ELSIF v_d->>'valueType'='percent' THEN
          v_new:=v_old-round(v_old::numeric*COALESCE((v_d->>'valueBps')::integer,0)/10000)::integer;
        ELSE
          v_new:=v_old-LEAST(v_old,COALESCE((v_d->>'valueMinor')::integer,0)*v_value_scale);
        END IF;
        v_new:=GREATEST(0,v_new); v_line_minor:=(v_old-v_new)*v_qty;
        IF v_line_minor>0 THEN
          v_seq:=jsonb_array_length(v_line->'applied')+1; v_units:=v_qty*v_count_scale;
          v_ap:=jsonb_build_object(
            'discountId',v_d->>'id','kind',v_d->>'kind','name',v_d->>'name','code',v_d->'code',
            'valueType',v_d->>'valueType','valueBps',v_d->'valueBps','valueMinor',v_d->'valueMinor',
            'perUnitMinor',v_old-v_new,'lineMinor',v_line_minor,'units',v_units,'seq',v_seq
          );
          v_line:=jsonb_set(jsonb_set(v_line,'{netUnitMinor}',to_jsonb(v_new)),'{applied}',(v_line->'applied')||jsonb_build_array(v_ap));
        END IF;
      END IF;
      v_lines:=v_lines||jsonb_build_array(v_line);
    END LOOP;
    v_state:=v_lines;
  END LOOP;

  -- Validate the code in the fixed EN-9 order.
  IF v_lookup='none' THEN v_code_reason:=NULL;
  ELSIF v_lookup<>'found' OR v_code IS NULL OR v_code='null'::jsonb THEN v_code_reason:='not_found';
  ELSIF COALESCE(v_code->>'status','active')='paused' OR (v_code->'needsAttention' IS NOT NULL AND v_code->>'needsAttention' IS NOT NULL) THEN v_code_reason:='paused';
  ELSIF COALESCE((v_code->>'startsAt')::timestamptz,'-infinity')>v_at THEN v_code_reason:='not_started';
  ELSIF COALESCE(v_code->>'status','active')='ended' OR COALESCE((v_code->>'endsAt')::timestamptz,'infinity')<=v_at THEN v_code_reason:='ended';
  ELSIF v_code->'remainingTotalUses' IS NOT NULL AND (v_code->>'remainingTotalUses')::integer<=0 THEN v_code_reason:='used_up';
  -- #4624: a code capped by tickets (ends_after_count) with none left is used up.
  ELSIF (v_code->>'remainingUnits')::bigint<=0 THEN v_code_reason:='used_up';
  ELSIF v_code->'remainingBuyerUses' IS NOT NULL AND (v_code->>'remainingBuyerUses')::integer<=0 THEN v_code_reason:='buyer_limit';
  ELSIF v_queued THEN v_code_reason:='queue';
  ELSE
    v_eligible_net:=0; v_eligible_list:=0;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_state) LOOP
      v_eligible:=COALESCE((v_line->>'allowed')::boolean,false) AND (v_line->>'listUnitMinor')::integer>0
        AND (v_code->>'scopeKind'='brand' OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(v_code->'targets','[]'::jsonb)) t
          WHERE (t->>'targetKind'='listing_kind' AND t->>'listingKind'=v_line->>'listingKind')
             OR (t->>'targetKind'='event' AND t->>'targetId'=v_line->>'listingId' AND v_line->>'listingKind' IN ('event','experience','trip'))
             OR (t->>'targetKind'='venue_menu' AND t->>'targetId'=v_line->>'listingId' AND v_line->>'itemKind'='menu_item')
             OR (t->>'targetKind'='venue_deposit' AND t->>'targetId'=v_line->>'listingId' AND v_line->>'itemKind'='venue_deposit')
             OR (t->>'targetKind' IN ('ticket_type','menu_item') AND t->>'targetId'=v_line->>'itemId')
        ));
      IF v_eligible THEN
        v_eligible_list:=v_eligible_list+(v_line->>'listUnitMinor')::bigint*(v_line->>'qty')::integer;
        v_eligible_net:=v_eligible_net+(v_line->>'netUnitMinor')::bigint*(v_line->>'qty')::integer;
      END IF;
    END LOOP;
    IF v_eligible_list=0 THEN v_code_reason:='not_applicable';
    ELSIF v_eligible_net<COALESCE((v_code->>'minSubtotalMinor')::bigint,0) THEN
      v_code_reason:='min_subtotal'; v_required:=COALESCE((v_code->>'minSubtotalMinor')::bigint,0)-v_eligible_net;
    END IF;
  END IF;

  IF v_code_reason IS NOT NULL THEN
    v_code_outcome:=jsonb_build_object('status','rejected','reason',v_code_reason,'required',v_required,'with',NULL,'replaced','[]'::jsonb);
  ELSIF v_lookup='found' THEN
    v_compatible:=true; v_with:=NULL;
    FOR v_other IN SELECT value FROM jsonb_array_elements(v_chosen) LOOP
      IF NOT (
        ((v_code->>'combinesWith'='any') OR (v_code->>'combinesWith'='automatic_only' AND v_other->>'kind' IN ('automatic','sale_price')))
        AND ((v_other->>'combinesWith'='any') OR (v_other->>'combinesWith'='automatic_only' AND v_code->>'kind' IN ('automatic','sale_price')))
      ) THEN v_compatible:=false; IF v_with IS NULL THEN v_with:=v_other->>'name'; END IF; END IF;
    END LOOP;

    IF NOT v_internal THEN
      IF v_compatible THEN v_filtered:=COALESCE(p_input->'automatics','[]'::jsonb);
      ELSE
        SELECT COALESCE(jsonb_agg(a),'[]'::jsonb) INTO v_filtered
        FROM jsonb_array_elements(COALESCE(p_input->'automatics','[]'::jsonb)) a
        WHERE ((v_code->>'combinesWith'='any') OR (v_code->>'combinesWith'='automatic_only' AND a->>'kind' IN ('automatic','sale_price')))
          AND ((a->>'combinesWith'='any') OR (a->>'combinesWith'='automatic_only' AND v_code->>'kind' IN ('automatic','sale_price')));
      END IF;
      v_candidate:=public.issue_3872_discount_apply(
        jsonb_set(jsonb_set(p_input,'{automatics}',v_filtered),'{_skipConflict}','true'::jsonb)
      );
      SELECT COALESCE(sum((x->>'netUnitMinor')::bigint*(x->>'qty')::integer),0) INTO v_a_net FROM jsonb_array_elements(v_state) x;
      v_b_net:=(v_candidate->>'netSubtotalMinor')::bigint;
      IF v_compatible OR v_b_net<v_a_net THEN
        IF NOT v_compatible THEN
          SELECT COALESCE(jsonb_agg(c->>'name'),'[]'::jsonb) INTO v_replaced
          FROM jsonb_array_elements(v_chosen) c
          WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_filtered) f WHERE f->>'id'=c->>'id');
          v_candidate:=jsonb_set(v_candidate,'{codeOutcome,replaced}',v_replaced,true);
        END IF;
        RETURN v_candidate;
      END IF;
      v_code_outcome:=jsonb_build_object('status','rejected','reason','incompatible_better_automatic','required',NULL,'with',v_with,'replaced','[]'::jsonb);
    ELSE
      -- Internal compatible candidate: apply the code last.
      -- #4624: the same per-line ticket check as the automatic pass (D1a): a line
      -- with more tickets than remain on the code gets no code discount and a
      -- notice says how many remain; discounted lines use up the remainder.
      v_remaining := CASE WHEN v_code->'remainingUnits' IS NULL OR v_code->>'remainingUnits' IS NULL
        THEN NULL ELSE (v_code->>'remainingUnits')::bigint END;
      v_lines:='[]'::jsonb;
      FOR v_line IN SELECT value FROM jsonb_array_elements(v_state) ORDER BY value->>'lineRef' LOOP
        v_eligible:=COALESCE((v_line->>'allowed')::boolean,false) AND (v_line->>'listUnitMinor')::integer>0
          AND (v_code->>'scopeKind'='brand' OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(v_code->'targets','[]'::jsonb)) t
            WHERE (t->>'targetKind'='listing_kind' AND t->>'listingKind'=v_line->>'listingKind')
               OR (t->>'targetKind'='event' AND t->>'targetId'=v_line->>'listingId' AND v_line->>'listingKind' IN ('event','experience','trip'))
               OR (t->>'targetKind'='venue_menu' AND t->>'targetId'=v_line->>'listingId' AND v_line->>'itemKind'='menu_item')
               OR (t->>'targetKind'='venue_deposit' AND t->>'targetId'=v_line->>'listingId' AND v_line->>'itemKind'='venue_deposit')
               OR (t->>'targetKind' IN ('ticket_type','menu_item') AND t->>'targetId'=v_line->>'itemId')
          ));
        v_qty:=(v_line->>'qty')::integer; v_count_scale:=(v_line->>'countScale')::integer;
        IF v_eligible AND v_remaining IS NOT NULL AND v_remaining < v_qty*v_count_scale THEN
          v_notices := v_notices || jsonb_build_array(jsonb_build_object(
            'type','sale_limited','discountId',v_code->>'id','lineRef',v_line->>'lineRef',
            'remaining',floor(v_remaining::numeric/v_count_scale)::integer,'discountKind','code'
          ));
          v_eligible:=false;
        END IF;
        IF v_eligible THEN
          IF v_remaining IS NOT NULL THEN v_remaining:=v_remaining-v_qty*v_count_scale; END IF;
          v_old:=(v_line->>'netUnitMinor')::integer;
          v_value_scale:=(v_line->>'valueScale')::integer;
          IF v_code->>'valueType'='set_price' THEN v_new:=LEAST(v_old,COALESCE((v_code->>'valueMinor')::integer,0)*v_value_scale);
          ELSIF v_code->>'valueType'='percent' THEN v_new:=v_old-round(v_old::numeric*COALESCE((v_code->>'valueBps')::integer,0)/10000)::integer;
          ELSE v_new:=v_old-LEAST(v_old,COALESCE((v_code->>'valueMinor')::integer,0)*v_value_scale); END IF;
          v_new:=GREATEST(0,v_new); v_line_minor:=(v_old-v_new)*v_qty;
          IF v_line_minor>0 THEN
            v_seq:=jsonb_array_length(v_line->'applied')+1; v_units:=v_qty*v_count_scale;
            v_ap:=jsonb_build_object('discountId',v_code->>'id','kind',v_code->>'kind','name',v_code->>'name','code',v_code->'code',
              'valueType',v_code->>'valueType','valueBps',v_code->'valueBps','valueMinor',v_code->'valueMinor',
              'perUnitMinor',v_old-v_new,'lineMinor',v_line_minor,'units',v_units,'seq',v_seq);
            v_line:=jsonb_set(jsonb_set(v_line,'{netUnitMinor}',to_jsonb(v_new)),'{applied}',(v_line->'applied')||jsonb_build_array(v_ap));
          END IF;
        END IF;
        v_lines:=v_lines||jsonb_build_array(v_line);
      END LOOP;
      v_state:=v_lines;
      v_code_outcome:=jsonb_build_object('status','applied','reason',NULL,'required',NULL,'with',NULL,'replaced','[]'::jsonb);
    END IF;
  END IF;

  -- Finalise line totals, aggregate applied discounts, and calculate digests.
  v_lines:='[]'::jsonb;
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_state) ORDER BY value->>'lineRef' LOOP
    v_list:=(v_line->>'listUnitMinor')::integer; v_new:=(v_line->>'netUnitMinor')::integer; v_qty:=(v_line->>'qty')::integer;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'lineRef',v_line->>'lineRef','listUnitMinor',v_list,'netUnitMinor',v_new,'qty',v_qty,
      'unitsCounted',v_qty*(v_line->>'countScale')::integer,
      'lineListMinor',v_list*v_qty,'lineNetMinor',v_new*v_qty,'lineDiscountMinor',(v_list-v_new)*v_qty,
      'applied',v_line->'applied'
    ));
  END LOOP;
  SELECT COALESCE(sum((x->>'lineListMinor')::bigint),0),COALESCE(sum((x->>'lineNetMinor')::bigint),0)
    INTO v_list_total,v_net_total FROM jsonb_array_elements(v_lines) x;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'discountId',discount_id,'kind',kind,'name',name,'code',code,
    'amountMinor',amount_minor,'units',units
  ) ORDER BY first_seq,discount_id),'[]'::jsonb) INTO v_applied
  FROM (
    SELECT a->>'discountId' discount_id,min(a->>'kind') kind,min(a->>'name') name,min(a->>'code') code,
      sum((a->>'lineMinor')::bigint) amount_minor,sum((a->>'units')::integer) units,min((a->>'seq')::integer) first_seq
    FROM jsonb_array_elements(v_lines) l CROSS JOIN LATERAL jsonb_array_elements(l->'applied') a
    GROUP BY a->>'discountId'
  ) q;
  SELECT md5(COALESCE(string_agg(
    (x->>'lineRef')||'|'||(x->>'qty')||'|'||(x->>'listUnitMinor')||'|'||(x->>'netUnitMinor')||'|'||
      COALESCE((SELECT string_agg(a->>'discountId',',' ORDER BY a->>'discountId') FROM jsonb_array_elements(x->'applied') a),''),
    ';' ORDER BY x->>'lineRef'), '')||'|code:'||(v_code_outcome->>'status')||':'||COALESCE(v_code_outcome->>'reason','-')),
    md5(COALESCE(string_agg((x->>'lineRef')||'|'||(x->>'qty')||'|'||(x->>'listUnitMinor'),';' ORDER BY x->>'lineRef'),''))
    INTO v_digest,v_list_digest FROM jsonb_array_elements(v_lines) x;
  RETURN jsonb_build_object('lines',v_lines,'listSubtotalMinor',v_list_total,'discountMinor',v_list_total-v_net_total,
    'netSubtotalMinor',v_net_total,'applied',v_applied,'codeOutcome',v_code_outcome,'notices',v_notices,
    'digest',v_digest,'listDigest',v_list_digest);
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_discount_apply(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_discount_apply(jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Candidate loader: remainingUnits for codes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3872_discount_candidates(
  p_brand_id uuid,p_lines jsonb,p_code text,p_buyer jsonb,p_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_automatics jsonb; v_code jsonb; v_lookup text:='none'; v_email text; v_phone text; v_user uuid;
BEGIN
  v_email:=NULLIF(lower(btrim(COALESCE(p_buyer->>'email',''))),'');
  v_phone:=NULLIF(btrim(COALESCE(p_buyer->>'phone','')),'');
  v_user:=NULLIF(p_buyer->>'userId','')::uuid;
  IF p_code IS NOT NULL AND v_email IS NULL AND v_phone IS NULL AND v_user IS NULL THEN
    RAISE EXCEPTION 'discount_code_not_accepted';
  END IF;
  IF NOT public.issue_3872_discounts_on(p_brand_id) THEN
    RETURN jsonb_build_object('automatics','[]'::jsonb,'code',NULL,'codeLookup',CASE WHEN p_code IS NULL THEN 'none' ELSE 'not_found' END);
  END IF;

  SELECT COALESCE(jsonb_agg(def ORDER BY def->>'createdAt',def->>'id'),'[]'::jsonb) INTO v_automatics
  FROM (
    SELECT jsonb_build_object(
      'id',d.id,'kind',d.kind,'code',d.code,'name',d.name,'valueType',d.value_type,
      'valueBps',d.value_bps,'valueMinor',d.value_minor,'currency',d.currency,'scopeKind',d.scope_kind,
      'combinesWith',d.combines_with,'startsAt',d.starts_at,'endsAt',d.ends_at,'schedule',d.schedule,
      'minSubtotalMinor',d.min_subtotal_minor,'status',d.status,'needsAttention',d.needs_attention,
      'deletedAt',d.deleted_at,'createdAt',d.created_at,
      'targets',COALESCE((SELECT jsonb_agg(jsonb_build_object('targetKind',t.target_kind,'listingKind',t.listing_kind,'targetId',t.target_id))
                          FROM public.brand_discount_targets t WHERE t.discount_id=d.id AND t.orphaned_at IS NULL),'[]'::jsonb),
      'remainingTotalUses',CASE WHEN d.max_total_uses IS NULL THEN NULL ELSE GREATEST(0,d.max_total_uses-(SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND (u.status='consumed' OR (u.status='reserved' AND u.expires_at>p_at)))) END,
      'remainingBuyerUses',CASE WHEN d.max_uses_per_buyer IS NULL THEN NULL ELSE GREATEST(0,d.max_uses_per_buyer-(SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND (u.status='consumed' OR (u.status='reserved' AND u.expires_at>p_at)) AND ((v_email IS NOT NULL AND u.buyer_email_norm=v_email) OR (v_phone IS NOT NULL AND u.buyer_phone_e164=v_phone) OR (v_user IS NOT NULL AND u.buyer_user_id=v_user)))) END,
      'remainingUnits',CASE WHEN d.ends_after_count IS NULL THEN NULL ELSE GREATEST(0,d.ends_after_count-COALESCE((SELECT sum(u.units) FROM public.discount_uses u WHERE u.discount_id=d.id AND (u.status='consumed' OR (u.status='reserved' AND u.expires_at>p_at))),0)) END,
      'limited',(d.ends_after_count IS NOT NULL OR d.max_total_uses IS NOT NULL OR d.max_uses_per_buyer IS NOT NULL)
    ) def
    FROM public.brand_discounts d
    WHERE d.brand_id=p_brand_id AND d.kind IN ('automatic','sale_price') AND d.deleted_at IS NULL
      AND (d.max_uses_per_buyer IS NULL OR v_email IS NOT NULL OR v_phone IS NOT NULL OR v_user IS NOT NULL)
  ) q;

  IF p_code IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id',d.id,'kind',d.kind,'code',d.code,'name',d.name,'valueType',d.value_type,
      'valueBps',d.value_bps,'valueMinor',d.value_minor,'currency',d.currency,'scopeKind',d.scope_kind,
      'combinesWith',d.combines_with,'startsAt',d.starts_at,'endsAt',d.ends_at,'schedule',d.schedule,
      'minSubtotalMinor',d.min_subtotal_minor,'status',d.status,'needsAttention',d.needs_attention,
      'deletedAt',d.deleted_at,'createdAt',d.created_at,
      'targets',COALESCE((SELECT jsonb_agg(jsonb_build_object('targetKind',t.target_kind,'listingKind',t.listing_kind,'targetId',t.target_id)) FROM public.brand_discount_targets t WHERE t.discount_id=d.id AND t.orphaned_at IS NULL),'[]'::jsonb),
      'remainingTotalUses',CASE WHEN d.max_total_uses IS NULL THEN NULL ELSE GREATEST(0,d.max_total_uses-(SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND (u.status='consumed' OR (u.status='reserved' AND u.expires_at>p_at)))) END,
      'remainingBuyerUses',CASE WHEN d.max_uses_per_buyer IS NULL THEN NULL ELSE GREATEST(0,d.max_uses_per_buyer-(SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND (u.status='consumed' OR (u.status='reserved' AND u.expires_at>p_at)) AND ((v_email IS NOT NULL AND u.buyer_email_norm=v_email) OR (v_phone IS NOT NULL AND u.buyer_phone_e164=v_phone) OR (v_user IS NOT NULL AND u.buyer_user_id=v_user)))) END,
      'remainingUnits',CASE WHEN d.ends_after_count IS NULL THEN NULL ELSE GREATEST(0,d.ends_after_count-COALESCE((SELECT sum(u.units) FROM public.discount_uses u WHERE u.discount_id=d.id AND (u.status='consumed' OR (u.status='reserved' AND u.expires_at>p_at))),0)) END,
      'limited',(d.ends_after_count IS NOT NULL OR d.max_total_uses IS NOT NULL OR d.max_uses_per_buyer IS NOT NULL)
    ),'found' INTO v_code,v_lookup
    FROM public.brand_discounts d
    WHERE d.brand_id=p_brand_id AND d.kind='code' AND d.code=p_code AND d.deleted_at IS NULL
    ORDER BY d.created_at DESC LIMIT 1;
    IF NOT FOUND THEN v_lookup:='not_found'; END IF;
  END IF;
  RETURN jsonb_build_object('automatics',v_automatics,'code',v_code,'codeLookup',v_lookup);
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_discount_candidates(uuid,jsonb,text,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_discount_candidates(uuid,jsonb,text,jsonb,timestamptz) TO service_role;

COMMIT;
