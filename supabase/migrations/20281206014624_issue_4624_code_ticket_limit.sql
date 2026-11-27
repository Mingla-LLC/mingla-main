-- Issue #4624 — a discount code can stop after N tickets ("Total tickets"),
-- as well as after N checkouts ("Total uses" = max_total_uses). Revised in place
-- by the rework (spec 7206302208, D-0): never applied anywhere before.
--
-- Columns, constraints, functions and triggers only; no data backfill (the one
-- production discount_uses row keeps its units). Every statement is re-runnable.
--   0. discount_uses gains returned_units / returned_at (places given back) and
--      over_limit_units / over_limit_uses (late payments past a cap).
--   1. bd_count_end: kind 'code' may carry ends_after_count (D2a: both limits
--      kept; whichever runs out first ends the code).
--   2. issue_3872_discount_apply (body of 20271216003872 lines 484-854):
--      - one unit = one ticket issued, the line qty (D-3a, D-3b); countScale no
--        longer affects counting and the notice remaining is in tickets;
--      - only a line the discount makes cheaper is a cap line (D-2), for codes,
--        automatic and sale alike;
--      - a code with no tickets left is rejected 'used_up'; the code pass runs the
--        per-line check (D1a) and visits the biggest per-ticket saving first
--        (P3-3); over-cap lines get a 'sale_limited' notice (discountKind 'code').
--   3. issue_3872_discount_candidates (body of 20271216003872 lines 859-916):
--      remainingUnits for codes too, net of returned units; a fully returned
--      checkout stops counting toward Total uses and the per-buyer limit (D-4a).
--   4. issue_4624_sync_discount_returns + triggers on tickets.status (void /
--      refunded) and events.status (cancelled): every refund or cancel path gives
--      its places back, idempotently. A chargeback alone gives nothing (D-4b).
--   5a. issue_4624_extend_discount_hold, and the session trigger releases an
--      expired session's hold only once its own expires_at has passed (D-5a).
--   5b. issue_3872_copy_session_totals_to_order re-checks capacity for a late
--      consume and records the overrun; the payment is honoured (D-5b).
--   6. brand_discounts_list: net consumedUnits, live liveUses, returnedUnits and
--      overLimitUnits.
--   7. issue_3872_discount_maintenance: net counts, tidy lapsed holds, reopen a
--      run-out code (D-4c), 80% warning on whichever limit is closer (P3-4).
--   8. One checkout session line per ticket type (normalised basket lines).
--   Applied discounts carry `limited` so the edge extends only capped holds.
-- Concurrency: issue_3872_reserve_discount_uses and the late consume both take
-- issue_3872_lock_limited_discounts (rows in id order) before counting.
-- Owner, SECURITY DEFINER, search_path and grants of every replaced function are
-- kept as in its latest definition.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 0. discount_uses: places given back (item 4) and late-payment overruns (item 5).
-- ---------------------------------------------------------------------------
ALTER TABLE public.discount_uses ADD COLUMN IF NOT EXISTS returned_units integer NOT NULL DEFAULT 0;
ALTER TABLE public.discount_uses ADD COLUMN IF NOT EXISTS returned_at timestamptz;
ALTER TABLE public.discount_uses ADD COLUMN IF NOT EXISTS over_limit_units integer NOT NULL DEFAULT 0;
ALTER TABLE public.discount_uses ADD COLUMN IF NOT EXISTS over_limit_uses boolean NOT NULL DEFAULT false;
ALTER TABLE public.discount_uses DROP CONSTRAINT IF EXISTS du_returned_shape;
ALTER TABLE public.discount_uses ADD CONSTRAINT du_returned_shape CHECK (
  returned_units BETWEEN 0 AND units
  AND (returned_units = 0 OR status = 'consumed')
  AND ((returned_at IS NOT NULL) = (status = 'consumed' AND units > 0 AND returned_units = units))
);
ALTER TABLE public.discount_uses DROP CONSTRAINT IF EXISTS du_over_limit_shape;
ALTER TABLE public.discount_uses ADD CONSTRAINT du_over_limit_shape CHECK (over_limit_units BETWEEN 0 AND units);


-- ---------------------------------------------------------------------------
-- 1. Codes may end after a number of tickets.
-- ---------------------------------------------------------------------------
ALTER TABLE public.brand_discounts DROP CONSTRAINT IF EXISTS bd_count_end;
ALTER TABLE public.brand_discounts ADD CONSTRAINT bd_count_end
  CHECK (ends_after_count IS NULL OR kind IN ('automatic','sale_price','code'));

-- ---------------------------------------------------------------------------
-- 2. Engine: ticket-capped code pass; units = tickets issued; only lines the
--    discount makes cheaper count (codes, automatic and sale alike).
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
      -- #4624 (D-3a/D-3b): one unit per ticket issued (the line qty).
      IF v_remaining IS NOT NULL AND v_remaining < v_qty THEN
        v_score_notices := v_score_notices || jsonb_build_array(jsonb_build_object(
          'type','sale_limited','discountId',v_d->>'id','lineRef',v_line->>'lineRef',
          'remaining',v_remaining::integer
        ));
        CONTINUE;
      END IF;
      IF v_remaining IS NOT NULL THEN v_remaining := v_remaining-v_qty; END IF;
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
      v_qty:=(v_line->>'qty')::integer;
      IF v_eligible THEN
        v_old:=(v_line->>'netUnitMinor')::integer; v_value_scale:=(v_line->>'valueScale')::integer;
        IF v_d->>'valueType'='set_price' THEN
          v_new:=LEAST(v_old,COALESCE((v_d->>'valueMinor')::integer,0)*v_value_scale);
        ELSIF v_d->>'valueType'='percent' THEN
          v_new:=v_old-round(v_old::numeric*COALESCE((v_d->>'valueBps')::integer,0)/10000)::integer;
        ELSE
          v_new:=v_old-LEAST(v_old,COALESCE((v_d->>'valueMinor')::integer,0)*v_value_scale);
        END IF;
        v_new:=GREATEST(0,v_new);
        -- #4624 (D-2): only a line this discount makes cheaper is a cap line; a
        -- line an earlier discount already made free spends no units.
        IF v_old-v_new<=0 THEN
          v_eligible:=false;
        ELSIF v_remaining IS NOT NULL AND v_remaining < v_qty THEN
          v_notices := v_notices || jsonb_build_array(jsonb_build_object(
            'type','sale_limited','discountId',v_d->>'id','lineRef',v_line->>'lineRef',
            'remaining',v_remaining::integer
          ));
          v_eligible:=false;
        END IF;
      END IF;
      IF v_eligible THEN
        IF v_remaining IS NOT NULL THEN v_remaining:=v_remaining-v_qty; END IF;
        v_line_minor:=(v_old-v_new)*v_qty;
        IF v_line_minor>0 THEN
          v_seq:=jsonb_array_length(v_line->'applied')+1; v_units:=v_qty;
          v_ap:=jsonb_build_object(
            'discountId',v_d->>'id','kind',v_d->>'kind','name',v_d->>'name','code',v_d->'code',
            'valueType',v_d->>'valueType','valueBps',v_d->'valueBps','valueMinor',v_d->'valueMinor',
            'perUnitMinor',v_old-v_new,'lineMinor',v_line_minor,'units',v_units,'seq',v_seq,
            'limited',COALESCE((v_d->>'limited')::boolean,false)
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
      -- Only lines the code makes cheaper count (D-2), one unit per ticket issued
      -- (D-3a), and the biggest per-ticket saving is visited first (P3-3). The
      -- final lines and the digest stay in lineRef order.
      v_remaining := CASE WHEN v_code->'remainingUnits' IS NULL OR v_code->>'remainingUnits' IS NULL
        THEN NULL ELSE (v_code->>'remainingUnits')::bigint END;
      v_lines:='[]'::jsonb;
      FOR v_line IN
        SELECT x.value FROM jsonb_array_elements(v_state) x(value)
        ORDER BY (CASE
          WHEN v_code->>'valueType'='set_price' THEN
            (x.value->>'netUnitMinor')::integer-LEAST((x.value->>'netUnitMinor')::integer,
              COALESCE((v_code->>'valueMinor')::integer,0)*(x.value->>'valueScale')::integer)
          WHEN v_code->>'valueType'='percent' THEN
            LEAST((x.value->>'netUnitMinor')::integer,
              round((x.value->>'netUnitMinor')::numeric*COALESCE((v_code->>'valueBps')::integer,0)/10000)::integer)
          ELSE LEAST((x.value->>'netUnitMinor')::integer,
              COALESCE((v_code->>'valueMinor')::integer,0)*(x.value->>'valueScale')::integer)
          END) DESC, x.value->>'lineRef'
      LOOP
        v_eligible:=COALESCE((v_line->>'allowed')::boolean,false) AND (v_line->>'listUnitMinor')::integer>0
          AND (v_code->>'scopeKind'='brand' OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(v_code->'targets','[]'::jsonb)) t
            WHERE (t->>'targetKind'='listing_kind' AND t->>'listingKind'=v_line->>'listingKind')
               OR (t->>'targetKind'='event' AND t->>'targetId'=v_line->>'listingId' AND v_line->>'listingKind' IN ('event','experience','trip'))
               OR (t->>'targetKind'='venue_menu' AND t->>'targetId'=v_line->>'listingId' AND v_line->>'itemKind'='menu_item')
               OR (t->>'targetKind'='venue_deposit' AND t->>'targetId'=v_line->>'listingId' AND v_line->>'itemKind'='venue_deposit')
               OR (t->>'targetKind' IN ('ticket_type','menu_item') AND t->>'targetId'=v_line->>'itemId')
          ));
        v_qty:=(v_line->>'qty')::integer;
        IF v_eligible THEN
          v_old:=(v_line->>'netUnitMinor')::integer;
          v_value_scale:=(v_line->>'valueScale')::integer;
          IF v_code->>'valueType'='set_price' THEN v_new:=LEAST(v_old,COALESCE((v_code->>'valueMinor')::integer,0)*v_value_scale);
          ELSIF v_code->>'valueType'='percent' THEN v_new:=v_old-round(v_old::numeric*COALESCE((v_code->>'valueBps')::integer,0)/10000)::integer;
          ELSE v_new:=v_old-LEAST(v_old,COALESCE((v_code->>'valueMinor')::integer,0)*v_value_scale); END IF;
          v_new:=GREATEST(0,v_new);
          IF v_old-v_new<=0 THEN
            v_eligible:=false;
          ELSIF v_remaining IS NOT NULL AND v_remaining < v_qty THEN
            v_notices := v_notices || jsonb_build_array(jsonb_build_object(
              'type','sale_limited','discountId',v_code->>'id','lineRef',v_line->>'lineRef',
              'remaining',v_remaining::integer,'discountKind','code'
            ));
            v_eligible:=false;
          END IF;
        END IF;
        IF v_eligible THEN
          IF v_remaining IS NOT NULL THEN v_remaining:=v_remaining-v_qty; END IF;
          v_line_minor:=(v_old-v_new)*v_qty;
          IF v_line_minor>0 THEN
            v_seq:=jsonb_array_length(v_line->'applied')+1; v_units:=v_qty;
            v_ap:=jsonb_build_object('discountId',v_code->>'id','kind',v_code->>'kind','name',v_code->>'name','code',v_code->'code',
              'valueType',v_code->>'valueType','valueBps',v_code->'valueBps','valueMinor',v_code->'valueMinor',
              'perUnitMinor',v_old-v_new,'lineMinor',v_line_minor,'units',v_units,'seq',v_seq,
              'limited',COALESCE((v_code->>'limited')::boolean,false));
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
      'unitsCounted',v_qty,
      'lineListMinor',v_list*v_qty,'lineNetMinor',v_new*v_qty,'lineDiscountMinor',(v_list-v_new)*v_qty,
      'applied',v_line->'applied'
    ));
  END LOOP;
  SELECT COALESCE(sum((x->>'lineListMinor')::bigint),0),COALESCE(sum((x->>'lineNetMinor')::bigint),0)
    INTO v_list_total,v_net_total FROM jsonb_array_elements(v_lines) x;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'discountId',discount_id,'kind',kind,'name',name,'code',code,
    'amountMinor',amount_minor,'units',units,'limited',limited
  ) ORDER BY first_seq,discount_id),'[]'::jsonb) INTO v_applied
  FROM (
    SELECT a->>'discountId' discount_id,min(a->>'kind') kind,min(a->>'name') name,min(a->>'code') code,
      sum((a->>'lineMinor')::bigint) amount_minor,sum((a->>'units')::integer) units,min((a->>'seq')::integer) first_seq,
      bool_or(COALESCE((a->>'limited')::boolean,false)) limited
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
-- 3. Candidate loader: remainingUnits for codes; net of returned units, and
--    a fully returned checkout no longer counts as a use.
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
      'remainingTotalUses',CASE WHEN d.max_total_uses IS NULL THEN NULL ELSE GREATEST(0,d.max_total_uses-(SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND ((u.status='consumed' AND u.returned_at IS NULL) OR (u.status='reserved' AND u.expires_at>p_at)))) END,
      'remainingBuyerUses',CASE WHEN d.max_uses_per_buyer IS NULL THEN NULL ELSE GREATEST(0,d.max_uses_per_buyer-(SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND ((u.status='consumed' AND u.returned_at IS NULL) OR (u.status='reserved' AND u.expires_at>p_at)) AND ((v_email IS NOT NULL AND u.buyer_email_norm=v_email) OR (v_phone IS NOT NULL AND u.buyer_phone_e164=v_phone) OR (v_user IS NOT NULL AND u.buyer_user_id=v_user)))) END,
      'remainingUnits',CASE WHEN d.ends_after_count IS NULL THEN NULL ELSE GREATEST(0,d.ends_after_count-COALESCE((SELECT sum(CASE WHEN u.status='consumed' THEN u.units-u.returned_units ELSE u.units END) FROM public.discount_uses u WHERE u.discount_id=d.id AND (u.status='consumed' OR (u.status='reserved' AND u.expires_at>p_at))),0)) END,
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
      'remainingTotalUses',CASE WHEN d.max_total_uses IS NULL THEN NULL ELSE GREATEST(0,d.max_total_uses-(SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND ((u.status='consumed' AND u.returned_at IS NULL) OR (u.status='reserved' AND u.expires_at>p_at)))) END,
      'remainingBuyerUses',CASE WHEN d.max_uses_per_buyer IS NULL THEN NULL ELSE GREATEST(0,d.max_uses_per_buyer-(SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND ((u.status='consumed' AND u.returned_at IS NULL) OR (u.status='reserved' AND u.expires_at>p_at)) AND ((v_email IS NOT NULL AND u.buyer_email_norm=v_email) OR (v_phone IS NOT NULL AND u.buyer_phone_e164=v_phone) OR (v_user IS NOT NULL AND u.buyer_user_id=v_user)))) END,
      'remainingUnits',CASE WHEN d.ends_after_count IS NULL THEN NULL ELSE GREATEST(0,d.ends_after_count-COALESCE((SELECT sum(CASE WHEN u.status='consumed' THEN u.units-u.returned_units ELSE u.units END) FROM public.discount_uses u WHERE u.discount_id=d.id AND (u.status='consumed' OR (u.status='reserved' AND u.expires_at>p_at))),0)) END,
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

-- ---------------------------------------------------------------------------
-- 4. Places come back when tickets die (item 4, D-4a, D-4b).
-- ---------------------------------------------------------------------------
-- Set-based and idempotent: it recomputes returned_units from the order's dead
-- tickets every time, it never increments. A ticket is dead when it is void or
-- refunded, or when its event is cancelled (the event-cancel path leaves a free
-- order's tickets valid; see the events trigger below). refund_pending is not
-- dead until it settles. A chargeback alone changes no ticket, so it returns
-- nothing (D-4b). returned_at is stamped only when every unit is back, which is
-- what frees Total uses and the per-buyer limit (D-4a).
CREATE OR REPLACE FUNCTION public.issue_4624_sync_discount_returns(p_order_id uuid)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_count integer;
BEGIN
  IF p_order_id IS NULL THEN RETURN 0; END IF;
  -- Dead tickets per ticket type; the discounted units per (discount, ticket
  -- type) are summed BEFORE the two are compared, so the same dead ticket is
  -- never counted once per order line, and a use never gets back more than it
  -- consumed (LEAST with units below). Checkouts hold one line per ticket type
  -- (issue_4624_one_item_per_ticket_type), so this is per order line.
  WITH dead AS (
    SELECT t.ticket_type_id, count(*)::integer n
    FROM public.tickets t
    JOIN public.orders o ON o.id=t.order_id
    LEFT JOIN public.events e ON e.id=o.event_id
    WHERE t.order_id=p_order_id
      AND (t.status IN ('void','refunded') OR e.status='cancelled')
    GROUP BY t.ticket_type_id
  ), discounted AS (
    SELECT odl.discount_id, li.ticket_type_id, sum(odl.units)::integer units
    FROM public.order_discount_lines odl
    JOIN public.order_line_items li ON li.id::text=odl.line_ref AND li.order_id=p_order_id
    WHERE odl.order_kind='ticket' AND odl.order_id=p_order_id
    GROUP BY odl.discount_id, li.ticket_type_id
  ), back AS (
    SELECT d.discount_id, sum(LEAST(d.units,COALESCE(dd.n,0)))::integer returned
    FROM discounted d
    LEFT JOIN dead dd ON dd.ticket_type_id=d.ticket_type_id
    GROUP BY d.discount_id
  ), target AS (
    SELECT u.id,
      LEAST(u.units,COALESCE(b.returned,0)) returned_units
    FROM public.discount_uses u
    LEFT JOIN back b ON b.discount_id=u.discount_id
    WHERE u.checkout_kind='ticket' AND u.order_id=p_order_id AND u.status='consumed'
  )
  UPDATE public.discount_uses u
     SET returned_units=t.returned_units,
         returned_at=CASE
           WHEN u.units>0 AND t.returned_units=u.units THEN COALESCE(u.returned_at,now())
           ELSE NULL END
    FROM target t
   WHERE u.id=t.id
     AND (u.returned_units IS DISTINCT FROM t.returned_units
          OR (u.returned_at IS NOT NULL) IS DISTINCT FROM (u.units>0 AND t.returned_units=u.units));
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_4624_sync_discount_returns(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4624_sync_discount_returns(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4624_ticket_discount_return_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.issue_4624_sync_discount_returns(NEW.order_id);
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_4624_ticket_discount_return_trigger() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS issue_4624_ticket_discount_return ON public.tickets;
CREATE TRIGGER issue_4624_ticket_discount_return
AFTER UPDATE OF status ON public.tickets
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status
  AND (OLD.status IN ('void','refunded') OR NEW.status IN ('void','refunded')))
EXECUTE FUNCTION public.issue_4624_ticket_discount_return_trigger();

-- An event cancelled with free orders on it (event-cancel-refund-fanout skips
-- orders with nothing to refund) changes no ticket, so the ticket trigger never
-- fires. Re-sync every discounted order of the event when it enters or leaves
-- 'cancelled'.
CREATE OR REPLACE FUNCTION public.issue_4624_event_discount_return_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_order uuid;
BEGIN
  FOR v_order IN
    SELECT DISTINCT u.order_id FROM public.discount_uses u
    JOIN public.orders o ON o.id=u.order_id
    WHERE o.event_id=NEW.id AND u.checkout_kind='ticket' AND u.status='consumed'
    ORDER BY u.order_id
  LOOP
    PERFORM public.issue_4624_sync_discount_returns(v_order);
  END LOOP;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_4624_event_discount_return_trigger() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS issue_4624_event_discount_return ON public.events;
CREATE TRIGGER issue_4624_event_discount_return
AFTER UPDATE OF status ON public.events
FOR EACH ROW
WHEN ((OLD.status = 'cancelled') IS DISTINCT FROM (NEW.status = 'cancelled'))
EXECUTE FUNCTION public.issue_4624_event_discount_return_trigger();

-- ---------------------------------------------------------------------------
-- 5a. Holds for capped discounts cover the payment window (D-5a).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4624_extend_discount_hold(
  p_checkout_session_id uuid,p_until timestamptz
) RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_count integer;
BEGIN
  IF p_checkout_session_id IS NULL OR p_until IS NULL THEN RETURN 0; END IF;
  UPDATE public.discount_uses u
     SET expires_at=GREATEST(u.expires_at,p_until)
    FROM public.brand_discounts d
   WHERE u.checkout_kind='ticket' AND u.checkout_ref_id=p_checkout_session_id
     AND u.status='reserved' AND u.expires_at>now() AND d.id=u.discount_id
     AND (d.ends_after_count IS NOT NULL OR d.max_total_uses IS NOT NULL OR d.max_uses_per_buyer IS NOT NULL);
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_4624_extend_discount_hold(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4624_extend_discount_hold(uuid,timestamptz) TO service_role;

-- Session trigger (body of 20271216003872 lines 383-418). Ticket branch only:
-- 'expired' releases only holds already past their own expires_at (a capped
-- hold extended past the session's 15 minutes keeps counting until it lapses);
-- 'failed' still releases at once. Venue and deposit branches are unchanged.
CREATE OR REPLACE FUNCTION public.issue_3872_discount_use_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_TABLE_NAME = 'ticket_checkout_sessions' THEN
    IF NEW.status='failed' AND OLD.status IS DISTINCT FROM NEW.status THEN
      UPDATE public.discount_uses SET status='released',released_at=now()
      WHERE checkout_kind='ticket' AND checkout_ref_id=NEW.id AND status='reserved';
    ELSIF NEW.status='expired' AND OLD.status IS DISTINCT FROM NEW.status THEN
      UPDATE public.discount_uses SET status='released',released_at=now()
      WHERE checkout_kind='ticket' AND checkout_ref_id=NEW.id AND status='reserved'
        AND expires_at<=now();
    END IF;
  ELSIF TG_TABLE_NAME = 'venue_orders' THEN
    -- Staff automatics/sale prices are consumed before the insert so a limited
    -- use cannot race. Bind that already-consumed row to the order only after
    -- the order insert succeeds; the M4 release seam handles failed inserts.
    UPDATE public.discount_uses SET order_id=NEW.id
    WHERE checkout_kind='venue_order' AND checkout_ref_id=NEW.id
      AND status='consumed' AND channel='staff' AND order_id IS NULL;
    IF NEW.payment_status='paid' AND (TG_OP='INSERT' OR OLD.payment_status IS DISTINCT FROM NEW.payment_status) THEN
      UPDATE public.discount_uses SET status='consumed',consumed_at=now(),order_id=NEW.id
      WHERE checkout_kind='venue_order' AND checkout_ref_id=NEW.id AND status='reserved';
    ELSIF NEW.payment_status IN ('failed','cancelled')
      AND (TG_OP='INSERT' OR OLD.payment_status IS DISTINCT FROM NEW.payment_status) THEN
      UPDATE public.discount_uses SET status='released',released_at=now()
      WHERE checkout_kind='venue_order' AND checkout_ref_id=NEW.id AND status='reserved';
    END IF;
  ELSE
    IF NEW.status='completed' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
      UPDATE public.discount_uses SET status='consumed',consumed_at=now(),order_id=NEW.reservation_id
      WHERE checkout_kind='reservation_deposit' AND checkout_ref_id=NEW.id AND status='reserved';
    ELSIF NEW.status IN ('expired','failed')
      AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
      UPDATE public.discount_uses SET status='released',released_at=now()
      WHERE checkout_kind='reservation_deposit' AND checkout_ref_id=NEW.id AND status='reserved';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 5b. A late consume re-checks capacity and records any overrun (D-5b honour).
-- Body of 20271216013872 lines 1376-1450; only the late-row block is new.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3872_copy_session_totals_to_order(
  p_checkout_session_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $finalize$
DECLARE
  v_late_ids uuid[];
  v_late record;
  v_used_units bigint; v_used_uses bigint; v_buyer_uses bigint;
BEGIN
  UPDATE public.orders o
  SET list_subtotal_cents=s.list_subtotal_cents,
      discount_cents=s.discount_cents,
      net_subtotal_cents=s.net_subtotal_cents,
      buyer_fees_cents=s.buyer_fees_cents,
      tax_cents=s.tax_cents,
      buyer_total_cents=s.buyer_total_cents,
      pricing_source=s.pricing_source,
      pricing_breakdown=COALESCE(o.pricing_breakdown,s.pricing_breakdown),
      updated_at=now()
  FROM public.ticket_checkout_sessions s
  WHERE s.id=p_checkout_session_id AND o.id=s.order_id
    AND s.buyer_total_cents IS NOT NULL AND o.buyer_total_cents IS NULL;

  WITH session_lines AS (
    SELECT i.id,i.ticket_type_id,i.quantity,i.unit_price_cents,i.total_cents,
      i.list_unit_price_cents,i.discount_cents,
      row_number() OVER(PARTITION BY i.ticket_type_id,i.quantity,i.unit_price_cents,i.total_cents ORDER BY i.id) rn
    FROM public.ticket_checkout_session_items i
    WHERE i.checkout_session_id=p_checkout_session_id
  ), order_lines AS (
    SELECT li.id,li.ticket_type_id,li.quantity,li.unit_price_cents,li.total_cents,
      row_number() OVER(PARTITION BY li.ticket_type_id,li.quantity,li.unit_price_cents,li.total_cents ORDER BY li.id) rn
    FROM public.order_line_items li
    JOIN public.ticket_checkout_sessions s ON s.order_id=li.order_id
    WHERE s.id=p_checkout_session_id
  ), pairs AS (
    SELECT o.id order_line_id,s.id session_item_id,s.list_unit_price_cents,s.discount_cents
    FROM session_lines s JOIN order_lines o USING(ticket_type_id,quantity,unit_price_cents,total_cents,rn)
  )
  UPDATE public.order_line_items li
     SET checkout_session_item_id=p.session_item_id,
         list_unit_price_cents=COALESCE(p.list_unit_price_cents,li.unit_price_cents),
         discount_cents=p.discount_cents
    FROM pairs p
   WHERE li.id=p.order_line_id AND li.checkout_session_item_id IS NULL;

  INSERT INTO public.order_discount_lines(
    order_kind,order_id,line_ref,discount_id,brand_id,kind,code_snapshot,
    name_snapshot,value_type,value_bps,value_minor,units,amount_minor,
    applied_seq,currency)
  SELECT 'ticket',s.order_id,li.id::text,(a->>'discountId')::uuid,s.brand_id,
    a->>'kind',NULLIF(a->>'code',''),a->>'name',a->>'valueType',
    NULLIF(a->>'valueBps','')::integer,NULLIF(a->>'valueMinor','')::integer,
    (a->>'units')::integer,(a->>'lineMinor')::integer,(a->>'seq')::smallint,
    trim(s.currency)
  FROM public.ticket_checkout_sessions s
  JOIN public.ticket_checkout_session_items i ON i.checkout_session_id=s.id
  JOIN public.order_line_items li ON li.checkout_session_item_id=i.id
  CROSS JOIN LATERAL jsonb_array_elements(i.applied_discounts) a
  WHERE s.id=p_checkout_session_id AND s.order_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- #4624 item 5b: a hold that lapsed before the payment finished (released, or
  -- reserved past its expires_at) is a late row. Take the same discount lock the
  -- reserve path takes, count usage without this row, and stamp any overrun.
  -- The buyer keeps what they paid for (D-5b honour); rows still live consume
  -- exactly as before.
  SELECT array_agg(DISTINCT u.discount_id ORDER BY u.discount_id) INTO v_late_ids
  FROM public.discount_uses u
  JOIN public.ticket_checkout_sessions s ON s.id=u.checkout_ref_id
  WHERE s.id=p_checkout_session_id AND s.order_id IS NOT NULL
    AND u.checkout_kind='ticket'
    AND (u.status='released' OR (u.status='reserved' AND u.expires_at<=now()));
  IF v_late_ids IS NOT NULL THEN
    PERFORM public.issue_3872_lock_limited_discounts(v_late_ids);
    FOR v_late IN
      SELECT u.id,u.units,u.buyer_email_norm,u.buyer_phone_e164,u.buyer_user_id,
        d.id discount_id,d.ends_after_count,d.max_total_uses,d.max_uses_per_buyer
      FROM public.discount_uses u
      JOIN public.brand_discounts d ON d.id=u.discount_id
      WHERE u.checkout_kind='ticket' AND u.checkout_ref_id=p_checkout_session_id
        AND (u.status='released' OR (u.status='reserved' AND u.expires_at<=now()))
      ORDER BY u.discount_id
    LOOP
      SELECT
        COALESCE(sum(CASE WHEN o.status='consumed' THEN o.units-o.returned_units ELSE o.units END),0),
        count(*) FILTER (WHERE o.status='reserved' OR o.returned_at IS NULL),
        count(*) FILTER (WHERE (o.status='reserved' OR o.returned_at IS NULL)
          AND ((v_late.buyer_email_norm IS NOT NULL AND o.buyer_email_norm=v_late.buyer_email_norm)
            OR (v_late.buyer_phone_e164 IS NOT NULL AND o.buyer_phone_e164=v_late.buyer_phone_e164)
            OR (v_late.buyer_user_id IS NOT NULL AND o.buyer_user_id=v_late.buyer_user_id)))
        INTO v_used_units,v_used_uses,v_buyer_uses
      FROM public.discount_uses o
      WHERE o.discount_id=v_late.discount_id AND o.id<>v_late.id
        AND (o.status='consumed' OR (o.status='reserved' AND o.expires_at>now()));
      UPDATE public.discount_uses
         SET over_limit_units=CASE WHEN v_late.ends_after_count IS NULL THEN 0
               ELSE GREATEST(0,LEAST(v_late.units,v_used_units+v_late.units-v_late.ends_after_count))::integer END,
             over_limit_uses=(v_late.max_total_uses IS NOT NULL AND v_used_uses+1>v_late.max_total_uses)
               OR (v_late.max_uses_per_buyer IS NOT NULL AND v_buyer_uses+1>v_late.max_uses_per_buyer)
       WHERE id=v_late.id;
    END LOOP;
  END IF;

  UPDATE public.discount_uses u
     SET status='consumed',order_id=s.order_id,consumed_at=now(),released_at=NULL
    FROM public.ticket_checkout_sessions s
   WHERE s.id=p_checkout_session_id AND s.order_id IS NOT NULL
     AND u.checkout_kind='ticket' AND u.checkout_ref_id=s.id
     AND u.status IN ('reserved','released');

  UPDATE public.orders o
     SET metadata=jsonb_set(COALESCE(o.metadata,'{}'::jsonb),'{discount_ids}',
       (SELECT jsonb_agg(x.discount_id ORDER BY x.discount_id)
          FROM (SELECT DISTINCT d.discount_id FROM public.order_discount_lines d
                WHERE d.order_kind='ticket' AND d.order_id=o.id) x),true),
         updated_at=now()
   WHERE o.id=(SELECT s.order_id FROM public.ticket_checkout_sessions s
               WHERE s.id=p_checkout_session_id)
     AND EXISTS(SELECT 1 FROM public.order_discount_lines d
                WHERE d.order_kind='ticket' AND d.order_id=o.id);
END;
$finalize$;
REVOKE ALL ON FUNCTION public.issue_3872_copy_session_totals_to_order(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_copy_session_totals_to_order(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Host list (body of 20271216043872 lines 530-554): net counts after
-- returns, live holds only, and the returned / over-limit figures.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.brand_discounts_list(p_brand_id uuid,p_filter text DEFAULT 'live')
RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp
AS $fn$
  SELECT to_jsonb(d)||jsonb_build_object(
    'targets',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at,t.id)
      FROM public.brand_discount_targets t WHERE t.discount_id=d.id),'[]'::jsonb),
    'consumedUnits',COALESCE((SELECT sum(u.units-u.returned_units) FROM public.discount_uses u
      WHERE u.discount_id=d.id AND u.status='consumed'),0),
    'liveUses',COALESCE((SELECT count(*) FROM public.discount_uses u
      WHERE u.discount_id=d.id AND ((u.status='consumed' AND u.returned_at IS NULL)
        OR (u.status='reserved' AND u.expires_at>now()))),0),
    'returnedUnits',COALESCE((SELECT sum(u.returned_units) FROM public.discount_uses u
      WHERE u.discount_id=d.id AND u.status='consumed'),0),
    'overLimitUnits',COALESCE((SELECT sum(u.over_limit_units) FROM public.discount_uses u
      WHERE u.discount_id=d.id AND u.status='consumed'),0)
  )
  FROM public.brand_discounts d
  WHERE d.brand_id=p_brand_id AND d.deleted_at IS NULL
    AND COALESCE(public.biz_brand_effective_rank(p_brand_id,auth.uid()),0)>=20
    AND CASE p_filter
      WHEN 'live' THEN d.status='active' AND d.starts_at<=now() AND (d.ends_at IS NULL OR d.ends_at>now()) AND d.needs_attention IS NULL
      WHEN 'scheduled' THEN d.status='active' AND d.starts_at>now()
      WHEN 'ended' THEN d.status='ended'
      WHEN 'needs_attention' THEN d.needs_attention IS NOT NULL
      ELSE false END
  ORDER BY d.created_at DESC,d.id;
$fn$;
REVOKE ALL ON FUNCTION public.brand_discounts_list(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brand_discounts_list(uuid,text) TO authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 7. Sweep (body of 20271216043872 lines 767-828): net counts after returns,
-- tidy lapsed holds of dead sessions, reopen a run-out code a refund freed
-- (D-4c), and warn on whichever limit reaches 80% first (P3-4).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3872_discount_maintenance(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
DECLARE v_notify jsonb;
BEGIN
  UPDATE public.brand_discounts d
     SET needs_attention='currency_mismatch'
   WHERE d.deleted_at IS NULL AND d.status IN ('active','paused')
     AND d.currency IS NOT NULL
     AND d.currency IS DISTINCT FROM (
       SELECT upper(COALESCE(b.pricing_currency,b.default_currency)) FROM public.brands b WHERE b.id=d.brand_id
     );

  -- #4624 D-5a: a hold whose session already expired or failed stops counting
  -- at its own expires_at; mark it released once that has passed.
  UPDATE public.discount_uses u
     SET status='released',released_at=p_now
    FROM public.ticket_checkout_sessions s
   WHERE u.checkout_kind='ticket' AND u.checkout_ref_id=s.id
     AND u.status='reserved' AND u.expires_at<p_now
     AND s.status IN ('expired','failed');

  UPDATE public.brand_discounts d
     SET status='ended',ended_reason=CASE
       WHEN d.ends_at IS NOT NULL AND d.ends_at<=p_now THEN 'window'
       WHEN d.ends_after_count IS NOT NULL AND COALESCE((
         SELECT sum(u.units-u.returned_units) FROM public.discount_uses u
          WHERE u.discount_id=d.id AND u.status='consumed'
       ),0)>=d.ends_after_count THEN 'count'
       ELSE 'uses' END
   WHERE d.deleted_at IS NULL AND d.status='active' AND (
     (d.ends_at IS NOT NULL AND d.ends_at<=p_now)
     OR (d.ends_after_count IS NOT NULL AND COALESCE((
       SELECT sum(u.units-u.returned_units) FROM public.discount_uses u WHERE u.discount_id=d.id AND u.status='consumed'
     ),0)>=d.ends_after_count)
     OR (d.max_total_uses IS NOT NULL AND COALESCE((
       SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND u.status='consumed' AND u.returned_at IS NULL
     ),0)>=d.max_total_uses)
   );

  -- #4624 D-4c: a discount the sweep ended because it ran out reopens when
  -- returns bring it back under every limit, while it is still inside its dates,
  -- not deleted, and no other live discount (nor a newer ended one) in the brand
  -- has the same code. A host-ended or window-ended discount never reopens.
  UPDATE public.brand_discounts d
     SET status='active',ended_reason=NULL,notified_ended_at=NULL,notified_limit80_at=NULL
   WHERE d.status='ended' AND d.ended_reason IN ('count','uses') AND d.deleted_at IS NULL
     AND (d.ends_at IS NULL OR d.ends_at>p_now)
     AND (d.ends_after_count IS NULL OR COALESCE((
       SELECT sum(u.units-u.returned_units) FROM public.discount_uses u WHERE u.discount_id=d.id AND u.status='consumed'
     ),0)<d.ends_after_count)
     AND (d.max_total_uses IS NULL OR COALESCE((
       SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND u.status='consumed' AND u.returned_at IS NULL
     ),0)<d.max_total_uses)
     AND (d.code IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.brand_discounts o
        WHERE o.brand_id=d.brand_id AND o.code=d.code AND o.id<>d.id AND o.deleted_at IS NULL
          AND (o.status<>'ended' OR o.created_at>d.created_at OR (o.created_at=d.created_at AND o.id>d.id))
     ));

  WITH usage AS (
    SELECT d.*,
      COALESCE((SELECT sum(u.units-u.returned_units) FROM public.discount_uses u WHERE u.discount_id=d.id AND u.status='consumed'),0)::integer consumed_units,
      COALESCE((SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND u.status='consumed' AND u.returned_at IS NULL),0)::integer consumed_uses
    FROM public.brand_discounts d WHERE d.deleted_at IS NULL
  ), notices AS (
    SELECT id,brand_id,name,'business.discount_limit_80'::text type,
      GREATEST(0,LEAST(
        CASE WHEN ends_after_count IS NOT NULL THEN ends_after_count-consumed_units END,
        CASE WHEN max_total_uses IS NOT NULL THEN max_total_uses-consumed_uses END
      ))::integer left_count,
      NULL::text reason
    FROM usage WHERE status='active' AND notified_limit80_at IS NULL
      AND (
        (ends_after_count IS NOT NULL AND consumed_units*5>=ends_after_count*4)
        OR (max_total_uses IS NOT NULL AND consumed_uses*5>=max_total_uses*4)
      )
    UNION ALL
    SELECT id,brand_id,name,'business.discount_ended',NULL::integer,ended_reason
    FROM usage WHERE status='ended' AND notified_ended_at IS NULL
    UNION ALL
    SELECT id,brand_id,name,'business.discount_needs_attention',NULL::integer,needs_attention
    FROM usage WHERE needs_attention IS NOT NULL AND notified_attention_at IS NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'discountId',id,'brandId',brand_id,'type',type,'name',name,'left',left_count,'reason',reason
  ) ORDER BY id,type),'[]'::jsonb) INTO v_notify FROM notices;

  DELETE FROM public.discount_code_attempts WHERE failed_at<p_now-interval '1 day';
  RETURN jsonb_build_object('notify',v_notify);
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_discount_maintenance(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_discount_maintenance(timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. One checkout line per ticket type. Basket lines are normalised by
-- ticket-checkout-create before the session is created; this refuses any
-- session that still carries two lines for one ticket type, so pricing,
-- holds, issuing and place returns all see a single line.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4624_one_item_per_ticket_type()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.ticket_checkout_session_items i
     WHERE i.checkout_session_id=NEW.checkout_session_id
       AND i.ticket_type_id=NEW.ticket_type_id
       AND i.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'checkout_lines_duplicate';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_4624_one_item_per_ticket_type() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS issue_4624_one_item_per_ticket_type ON public.ticket_checkout_session_items;
CREATE TRIGGER issue_4624_one_item_per_ticket_type
BEFORE INSERT ON public.ticket_checkout_session_items
FOR EACH ROW EXECUTE FUNCTION public.issue_4624_one_item_per_ticket_type();

COMMIT;
