-- #4382 Support Desk redesign: the customer-safe Product stage of a ticket.
--
-- The Host and Explorer request threads show a short banner while the
-- request's Product item is being worked on (journey 1, journey 2 step 4):
--   new | triaged                          -> 'passed_to_product'
--   planned, GitHub board Todo or no board -> 'passed_to_product'
--   planned, GitHub board In Progress      -> 'being_built'
--   planned, GitHub board In Review | Done -> 'final_checks'
--   shipped | told | wont_do               -> no stage (the Told message, or
--                                             Support's own reply, says it)
--
-- The function returns ONLY {stage, board_status_label} and only for a ticket
-- the caller can see: the requester, an active brand member on a brand-visible
-- ticket, or Support staff. Anyone else, an internal ticket seen by a customer,
-- and a ticket with no Product item all get NULL (never an error, so it is not
-- an existence oracle). No title, wording, owner, issue link or reporter count
-- leaves this function.

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_4382_ticket_product_stage(p_ticket_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_state text;
  v_board text;
  v_stage text;
BEGIN
  IF v_actor IS NULL OR p_ticket_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT (public.issue_4382_is_staff(v_actor)
          OR public.issue_4382_customer_can_view_ticket(p_ticket_id, v_actor)) THEN
    RETURN NULL;
  END IF;

  SELECT signal.state, item.board_status
    INTO v_state, v_board
    FROM public.support_product_signal_sources source
    JOIN public.support_product_signals signal ON signal.id = source.signal_id
    LEFT JOIN public.product_signal_avengers_links link ON link.signal_id = signal.id
    LEFT JOIN public.product_avengers_items item ON item.id = link.item_id
   WHERE source.source_kind = 'support_ticket'
     AND source.source_id = p_ticket_id
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_stage := CASE
    WHEN v_state IN ('new', 'triaged') THEN 'passed_to_product'
    WHEN v_state = 'planned' AND v_board = 'In Progress' THEN 'being_built'
    WHEN v_state = 'planned' AND v_board IN ('In Review', 'Done') THEN 'final_checks'
    WHEN v_state = 'planned' THEN 'passed_to_product'
    ELSE NULL
  END;
  IF v_stage IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'stage', v_stage,
    'board_status_label', CASE WHEN v_state = 'planned' THEN v_board ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_4382_ticket_product_stage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4382_ticket_product_stage(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.issue_4382_ticket_product_stage(uuid) IS
  '#4382: the customer-safe Product stage (passed_to_product | being_built | final_checks) of a support ticket the caller can see; NULL otherwise. Returns only {stage, board_status_label}.';

COMMIT;
