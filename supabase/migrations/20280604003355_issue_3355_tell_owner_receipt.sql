-- Issue #3355 bundle 5 — a teammate's note to the owner is receipt-backed.
--
-- tell_owner_in_brand_group posted straight through
-- issue_3720_send_brand_group_message. If the connection dropped after the
-- note posted, the retried confirm found the approval still `executing` (or
-- already `executed`) and answered WRONG_STATE, which the Host showed as
-- "didn't go through" for a note the owner had already received.
--
-- The send now runs inside the shared #1972 operation receipt, keyed by the
-- approval itself: the first confirm posts once and records the result; a
-- retry of the same approval returns that result and posts nothing. The note
-- must be exactly the words the teammate approved.
--
-- Proofs: __tests__/issue_3355_tell_owner_receipt.pg17.test.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.ari_tell_owner_in_brand_group(
  p_operation_id uuid,
  p_conversation_id uuid,
  p_content text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_confirmed jsonb;
  v_begin jsonb;
  v_message_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  -- The receipt binds to the exact approval; the note must be its words.
  SELECT tool_args INTO v_confirmed
    FROM public.agent_pending_actions
   WHERE id = p_operation_id
     AND user_id = auth.uid()
     AND tool_name = 'tell_owner_in_brand_group';
  IF v_confirmed IS NULL
     OR v_confirmed->>'message' IS DISTINCT FROM p_content THEN
    RAISE EXCEPTION 'operation_binding_mismatch';
  END IF;

  v_begin := public.agent_operation_receipt_begin(
    p_operation_id, 'tell_owner_in_brand_group', v_confirmed);
  IF COALESCE((v_begin->>'replay')::boolean, false) THEN
    RETURN (v_begin->'result') || jsonb_build_object('replayed', true);
  END IF;

  -- Sent as the caller, in brand mode; the group's own membership and
  -- posting checks apply unchanged.
  v_message_id := public.issue_3720_send_brand_group_message(
    p_conversation_id, p_content, NULL, '{}'::uuid[], 'brand', '{}'::uuid[]);

  RETURN public.agent_operation_receipt_complete(
    p_operation_id,
    'tell_owner_in_brand_group',
    v_confirmed,
    jsonb_build_object(
      'sent', true,
      'message_id', v_message_id,
      'conversation_id', p_conversation_id
    )
  ) || jsonb_build_object('replayed', false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.ari_tell_owner_in_brand_group(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_tell_owner_in_brand_group(uuid, uuid, text)
  TO authenticated, service_role;

-- The recorded note for one of the caller's own approvals, or NULL. A retry
-- reads this first: a note that already posted is answered from its receipt,
-- before checks that could have changed since (a renamed brand, a teammate
-- who left the group) turn a sent note into "nothing was sent".
CREATE OR REPLACE FUNCTION public.ari_tell_owner_receipt(p_operation_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT receipt.result || jsonb_build_object('replayed', true)
    FROM public.agent_operation_receipts receipt
   WHERE receipt.operation_id = p_operation_id
     AND receipt.user_id = auth.uid()
     AND receipt.tool_name = 'tell_owner_in_brand_group';
$fn$;

REVOKE ALL ON FUNCTION public.ari_tell_owner_receipt(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_tell_owner_receipt(uuid)
  TO authenticated, service_role;

COMMIT;
