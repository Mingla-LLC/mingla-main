BEGIN;

DO $test$
DECLARE
  v_definition text;
BEGIN
  IF public.ari_gap_type_label('unconfirmed') <> 'Ari could not confirm the answer' THEN
    RAISE EXCEPTION 'unconfirmed label missing';
  END IF;
  SELECT pg_get_functiondef('public.ari_record_turn_gaps(uuid,uuid,uuid,text,jsonb)'::regprocedure)
    INTO v_definition;
  IF position('unconfirmed' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'recording RPC does not accept unconfirmed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.ari_capability_gap_events'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%unconfirmed%'
  ) THEN
    RAISE EXCEPTION 'gap_type check does not accept unconfirmed';
  END IF;
END;
$test$;

ROLLBACK;
