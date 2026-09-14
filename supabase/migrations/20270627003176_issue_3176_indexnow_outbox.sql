-- #3176 — service-only IndexNow delivery outbox for independently promoted
-- Host public-search documents. This table carries only canonical URLs and
-- delivery state; it never stores page facts, customer data, or credentials.

BEGIN;

CREATE TABLE public.search_indexnow_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  canonical_url text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('updated','deleted')),
  entity_kind text NOT NULL CHECK (entity_kind IN ('event','trip','experience','venue','brand')),
  change_fingerprint text NOT NULL,
  delivery_state text NOT NULL DEFAULT 'pending'
    CHECK (delivery_state IN ('pending','delivered')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_error_code text CHECK (
    last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{2,64}$'
  ),
  source_updated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT search_indexnow_outbox_url_shape CHECK (
    canonical_url ~ '^https://host\.usemingla\.com/(e|t|exp|b)/'
    AND canonical_url !~ '[?#]'
  ),
  CONSTRAINT search_indexnow_outbox_fingerprint_unique UNIQUE (change_fingerprint),
  CONSTRAINT search_indexnow_outbox_delivery_shape CHECK (
    (delivery_state='pending' AND delivered_at IS NULL)
    OR (delivery_state='delivered' AND delivered_at IS NOT NULL)
  )
);

CREATE INDEX search_indexnow_outbox_pending_idx
  ON public.search_indexnow_outbox(next_attempt_at,id)
  WHERE delivery_state='pending';

ALTER TABLE public.search_indexnow_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_indexnow_outbox FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.search_indexnow_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.search_indexnow_outbox TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.search_indexnow_outbox_id_seq TO service_role;

CREATE POLICY search_indexnow_outbox_service_all
  ON public.search_indexnow_outbox
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE FUNCTION public.enqueue_search_indexnow_url(
  p_path text,
  p_operation text,
  p_entity_kind text,
  p_source_updated_at timestamptz,
  p_change_token text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  v_url text;
  v_fingerprint text;
BEGIN
  IF p_path IS NULL OR p_path !~ '^/(e|t|exp|b)/' OR p_path ~ '[?#]'
     OR p_operation NOT IN ('updated','deleted')
     OR p_entity_kind NOT IN ('event','trip','experience','venue','brand')
     OR p_source_updated_at IS NULL
     OR p_change_token IS NULL OR length(p_change_token) < 1 THEN
    RAISE EXCEPTION 'search_indexnow_invalid_enqueue' USING ERRCODE='22023';
  END IF;
  v_url := 'https://host.usemingla.com' || p_path;
  v_fingerprint := md5(v_url || '|' || p_operation || '|' || p_entity_kind || '|' ||
    p_source_updated_at::text || '|' || p_change_token);
  INSERT INTO public.search_indexnow_outbox(
    canonical_url,operation,entity_kind,change_fingerprint,source_updated_at
  ) VALUES (v_url,p_operation,p_entity_kind,v_fingerprint,p_source_updated_at)
  ON CONFLICT (change_fingerprint) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_search_indexnow_url(text,text,text,timestamptz,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_search_indexnow_url(text,text,text,timestamptz,text)
  TO service_role;

CREATE FUNCTION public.tg_enqueue_public_search_indexnow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  v_old_ready boolean;
  v_new_ready boolean;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.lifecycle_state='search_ready' AND NOT NEW.is_test_record THEN
      PERFORM public.enqueue_search_indexnow_url(
        NEW.canonical_path,'updated',NEW.entity_kind,NEW.source_updated_at,
        'insert|' || NEW.lifecycle_state || '|' || coalesce(NEW.redirect_target_path,'')
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP='DELETE' THEN
    IF OLD.lifecycle_state='search_ready' AND NOT OLD.is_test_record THEN
      PERFORM public.enqueue_search_indexnow_url(
        OLD.canonical_path,'deleted',OLD.entity_kind,OLD.source_updated_at,
        'delete|' || OLD.lifecycle_state
      );
    END IF;
    RETURN OLD;
  END IF;

  v_old_ready := OLD.lifecycle_state='search_ready' AND NOT OLD.is_test_record;
  v_new_ready := NEW.lifecycle_state='search_ready' AND NOT NEW.is_test_record;

  IF v_old_ready AND OLD.canonical_path IS DISTINCT FROM NEW.canonical_path THEN
    PERFORM public.enqueue_search_indexnow_url(
      OLD.canonical_path,'deleted',OLD.entity_kind,OLD.source_updated_at,
      'canonical-left|' || NEW.canonical_path
    );
  ELSIF v_old_ready AND NOT v_new_ready THEN
    PERFORM public.enqueue_search_indexnow_url(
      OLD.canonical_path,'deleted',OLD.entity_kind,NEW.source_updated_at,
      'lifecycle-left|' || NEW.lifecycle_state
    );
  END IF;

  IF v_new_ready AND (
    NOT v_old_ready
    OR OLD.canonical_path IS DISTINCT FROM NEW.canonical_path
    OR OLD.redirect_target_path IS DISTINCT FROM NEW.redirect_target_path
    OR OLD.source_updated_at IS DISTINCT FROM NEW.source_updated_at
  ) THEN
    PERFORM public.enqueue_search_indexnow_url(
      NEW.canonical_path,'updated',NEW.entity_kind,NEW.source_updated_at,
      'current|' || NEW.lifecycle_state || '|' || coalesce(NEW.redirect_target_path,'')
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_enqueue_public_search_indexnow()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER enqueue_public_search_indexnow
  AFTER INSERT OR UPDATE OR DELETE ON public.public_search_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_public_search_indexnow();

CREATE FUNCTION public.list_search_indexnow_batch(p_limit integer DEFAULT 1000)
RETURNS TABLE(
  id bigint,
  canonical_url text,
  operation text,
  entity_kind text,
  attempt_count integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path=''
AS $$
  SELECT o.id,o.canonical_url,o.operation,o.entity_kind,o.attempt_count
  FROM public.search_indexnow_outbox o
  WHERE o.delivery_state='pending' AND o.next_attempt_at <= now()
  ORDER BY o.id
  LIMIT LEAST(GREATEST(p_limit,1),1000)
$$;

REVOKE ALL ON FUNCTION public.list_search_indexnow_batch(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_search_indexnow_batch(integer) TO service_role;

CREATE FUNCTION public.record_search_indexnow_delivery(
  p_ids bigint[],
  p_delivered boolean,
  p_error_code text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE v_count integer;
BEGIN
  IF coalesce(array_length(p_ids,1),0)=0 OR cardinality(p_ids)>1000
     OR (NOT p_delivered AND (p_error_code IS NULL OR p_error_code !~ '^[a-z0-9_]{2,64}$')) THEN
    RAISE EXCEPTION 'search_indexnow_invalid_delivery_receipt' USING ERRCODE='22023';
  END IF;
  UPDATE public.search_indexnow_outbox o
  SET attempt_count=o.attempt_count+1,
      last_attempt_at=now(),
      delivery_state=CASE WHEN p_delivered THEN 'delivered' ELSE 'pending' END,
      delivered_at=CASE WHEN p_delivered THEN now() ELSE NULL END,
      last_error_code=CASE WHEN p_delivered THEN NULL ELSE p_error_code END,
      next_attempt_at=CASE WHEN p_delivered THEN o.next_attempt_at
        ELSE now() + LEAST(interval '24 hours', interval '5 minutes' * power(2,LEAST(o.attempt_count,8))::integer) END,
      updated_at=now()
  WHERE o.id=ANY(p_ids) AND o.delivery_state='pending';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.record_search_indexnow_delivery(bigint[],boolean,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_search_indexnow_delivery(bigint[],boolean,text)
  TO service_role;

CREATE FUNCTION public.prune_delivered_search_indexnow(p_before timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE v_count integer;
BEGIN
  IF p_before > now()-interval '90 days' THEN
    RAISE EXCEPTION 'search_indexnow_retention_minimum_90_days' USING ERRCODE='22023';
  END IF;
  DELETE FROM public.search_indexnow_outbox
  WHERE delivery_state='delivered' AND delivered_at < p_before;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_delivered_search_indexnow(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_delivered_search_indexnow(timestamptz)
  TO service_role;

COMMENT ON TABLE public.search_indexnow_outbox IS
  '#3176 service-only, privacy-safe IndexNow delivery queue; failed rows remain pending and retryable.';

COMMIT;
