-- ============================================================================
-- ORCH-0910 — backfill chat-card payloads with synthesized top-level image
--             and cardType discriminator for legacy intent rows.
--
-- Touches: messages.card_payload (jsonb), board_saved_cards.card_data (jsonb).
-- Rationale: ORCH-0910 fixes writers going forward, but existing intent rows
--            still render as bookmark placeholders when they lack top-level
--            `image` and/or `cardType: curated`.
-- Pattern:   Mirrors ORCH-0908 v2 backfill discipline (20260630000000) —
--            RAISE EXCEPTION if precount asserted rows but UPDATE moved zero.
-- ROLLBACK:  single `git revert`; no schema change to undo, only data fixes
--            on previously broken rows. Re-running is idempotent because the
--            WHERE clauses exclude rows already carrying non-empty image plus
--            cardType='curated'.
-- ============================================================================

DO $$
DECLARE
  v_msg_precount integer;
  v_msg_updated integer;
  v_bsc_precount integer;
  v_bsc_updated integer;
BEGIN
  -- 1. messages.card_payload
  SELECT COUNT(*) INTO v_msg_precount
    FROM public.messages
   WHERE message_type = 'card'
     AND card_payload ? 'stops'
     AND jsonb_typeof(card_payload->'stops') = 'array'
     AND (
       NOT (card_payload ? 'image' AND NULLIF(card_payload->>'image', '') IS NOT NULL)
       OR card_payload->>'cardType' IS DISTINCT FROM 'curated'
     );

  UPDATE public.messages
     SET card_payload = jsonb_strip_nulls(
       card_payload || jsonb_build_object(
         'image',
         COALESCE(
           NULLIF(card_payload->>'image', ''),
           (
             SELECT NULLIF(stop.value->>'imageUrl', '')
               FROM jsonb_array_elements(card_payload->'stops') WITH ORDINALITY AS stop(value, ord)
              WHERE NULLIF(stop.value->>'imageUrl', '') IS NOT NULL
              ORDER BY stop.ord
              LIMIT 1
           )
         ),
         'cardType', 'curated'
       )
     )
   WHERE message_type = 'card'
     AND card_payload ? 'stops'
     AND jsonb_typeof(card_payload->'stops') = 'array'
     AND (
       NOT (card_payload ? 'image' AND NULLIF(card_payload->>'image', '') IS NOT NULL)
       OR card_payload->>'cardType' IS DISTINCT FROM 'curated'
     );

  GET DIAGNOSTICS v_msg_updated = ROW_COUNT;

  IF v_msg_precount > 0 AND v_msg_updated = 0 THEN
    RAISE EXCEPTION 'ORCH-0910 backfill: messages precount % but UPDATE moved 0 rows', v_msg_precount;
  END IF;

  RAISE NOTICE 'ORCH-0910 messages backfill: % rows updated (precount %)', v_msg_updated, v_msg_precount;

  -- 2. board_saved_cards.card_data
  SELECT COUNT(*) INTO v_bsc_precount
    FROM public.board_saved_cards
   WHERE card_data ? 'stops'
     AND jsonb_typeof(card_data->'stops') = 'array'
     AND (
       NOT (card_data ? 'image' AND NULLIF(card_data->>'image', '') IS NOT NULL)
       OR card_data->>'cardType' IS DISTINCT FROM 'curated'
     );

  UPDATE public.board_saved_cards
     SET card_data = jsonb_strip_nulls(
       card_data || jsonb_build_object(
         'image',
         COALESCE(
           NULLIF(card_data->>'image', ''),
           (
             SELECT NULLIF(stop.value->>'imageUrl', '')
               FROM jsonb_array_elements(card_data->'stops') WITH ORDINALITY AS stop(value, ord)
              WHERE NULLIF(stop.value->>'imageUrl', '') IS NOT NULL
              ORDER BY stop.ord
              LIMIT 1
           )
         ),
         'cardType', 'curated'
       )
     )
   WHERE card_data ? 'stops'
     AND jsonb_typeof(card_data->'stops') = 'array'
     AND (
       NOT (card_data ? 'image' AND NULLIF(card_data->>'image', '') IS NOT NULL)
       OR card_data->>'cardType' IS DISTINCT FROM 'curated'
     );

  GET DIAGNOSTICS v_bsc_updated = ROW_COUNT;

  IF v_bsc_precount > 0 AND v_bsc_updated = 0 THEN
    RAISE EXCEPTION 'ORCH-0910 backfill: board_saved_cards precount % but UPDATE moved 0 rows', v_bsc_precount;
  END IF;

  RAISE NOTICE 'ORCH-0910 board_saved_cards backfill: % rows updated (precount %)', v_bsc_updated, v_bsc_precount;
END $$;

NOTIFY pgrst, 'reload schema';
