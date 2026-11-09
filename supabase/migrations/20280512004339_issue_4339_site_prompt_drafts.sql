-- #4339 §5 — "Prompt your website into existence" → Ari: the draft store.
--
-- A visitor on usemingla.com/host describes their place and taps Generate. The
-- marketing page posts the description to the public `site-prompt-draft` edge
-- function, which stores it HERE and returns only an opaque id. The id (never
-- the description) travels to host web as /ari?draft=<id>. After sign-in or
-- sign-up the Host app claims the draft once, binds it to the signed-in user,
-- and sends the description to Ari as the user's first message.
--
-- 1. public.site_prompt_drafts — RLS on, no policies, no anon/authenticated
--    table privileges: nobody reads or writes it directly except service_role.
-- 2. public.site_prompt_draft_create(body, ip_hash) — service_role only. The
--    edge function's one write: purge expired rows, apply the per-visitor and
--    global ceilings, insert, return the id.
-- 3. public.claim_site_prompt_draft(id) — authenticated only. Claims once,
--    refuses expired or already-claimed drafts, and answers every refusal with
--    the same {status:'unavailable'} so the id space is not an oracle.
--
-- Static SQL only (#1860 C7). No conflict is raised: the claim is a single
-- conditional UPDATE, so a concurrent second claim simply finds no row (no
-- 40001, no PT409 needed). Neither function is anon-executable, so the
-- anon-definer allowlist is unchanged.

BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.site_prompt_drafts (
  -- gen_random_uuid(): 122 random bits — opaque and unguessable.
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body text NOT NULL CHECK (
    char_length(btrim(body)) BETWEEN 12 AND 1000 AND body = btrim(body)
  ),
  -- sha256(ip + salt) hex, for the per-visitor ceiling. The raw IP is never
  -- stored. NULL when the edge saw no client address.
  ip_hash text NULL CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  claimed_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at timestamptz NULL,
  CONSTRAINT site_prompt_drafts_expiry_window CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '24 hours'
  ),
  -- A claimed_by without a claimed_at is impossible. (The reverse can happen
  -- when the claiming account is deleted: the claim stays spent.)
  CONSTRAINT site_prompt_drafts_claim_shape CHECK (
    claimed_by IS NULL OR claimed_at IS NOT NULL
  )
);

COMMENT ON TABLE public.site_prompt_drafts IS
  '#4339: website descriptions typed on usemingla.com/host, held for 24 hours until a signed-in host claims one and Ari builds from it. Service-role only; the description never travels in a URL.';

CREATE INDEX IF NOT EXISTS site_prompt_drafts_ip_recent_idx
  ON public.site_prompt_drafts (ip_hash, created_at DESC)
  WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_prompt_drafts_created_idx
  ON public.site_prompt_drafts (created_at DESC);
CREATE INDEX IF NOT EXISTS site_prompt_drafts_expires_idx
  ON public.site_prompt_drafts (expires_at);

ALTER TABLE public.site_prompt_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.site_prompt_drafts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.site_prompt_drafts TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- The edge function's write. Ceilings: 20 drafts per visitor per 24 hours and
-- 2,000 drafts per hour across everyone (a flood guard: rows are at most 1 KB).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.site_prompt_draft_create(p_body text, p_ip_hash text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
BEGIN
  IF char_length(v_body) < 12 OR char_length(v_body) > 1000 THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  IF p_ip_hash IS NOT NULL AND p_ip_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  -- Expired drafts are never kept: a description is gone 24 hours after it
  -- was typed, claimed or not.
  DELETE FROM public.site_prompt_drafts draft WHERE draft.expires_at <= now();

  IF p_ip_hash IS NOT NULL AND (
    SELECT count(*) FROM public.site_prompt_drafts draft
    WHERE draft.ip_hash = p_ip_hash
      AND draft.created_at > now() - interval '24 hours'
  ) >= 20 THEN
    RETURN jsonb_build_object('status', 'rate_limited');
  END IF;

  IF (
    SELECT count(*) FROM public.site_prompt_drafts draft
    WHERE draft.created_at > now() - interval '1 hour'
  ) >= 2000 THEN
    RETURN jsonb_build_object('status', 'busy');
  END IF;

  INSERT INTO public.site_prompt_drafts (body, ip_hash)
  VALUES (v_body, p_ip_hash)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('status', 'created', 'id', v_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.site_prompt_draft_create(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.site_prompt_draft_create(text, text) TO service_role;
COMMENT ON FUNCTION public.site_prompt_draft_create(text, text) IS
  '#4339: store one website description for 24 hours and return its opaque id. Service role only (the site-prompt-draft edge function). Status created | invalid | rate_limited | busy.';

-- ───────────────────────────────────────────────────────────────────────────
-- The Host app's claim. Once, by the signed-in user, before expiry.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_site_prompt_draft(p_draft_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_body text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'site_prompt_draft_auth_required' USING ERRCODE = '42501';
  END IF;

  -- One conditional UPDATE: a concurrent second claim waits on the row lock,
  -- re-checks claimed_at and finds nothing to claim.
  UPDATE public.site_prompt_drafts draft
  SET claimed_by = v_user,
      claimed_at = now()
  WHERE draft.id = p_draft_id
    AND draft.claimed_at IS NULL
    AND draft.expires_at > now()
  RETURNING draft.body INTO v_body;

  IF v_body IS NULL THEN
    -- Missing, expired and already claimed all look the same.
    RETURN jsonb_build_object('status', 'unavailable');
  END IF;
  RETURN jsonb_build_object('status', 'claimed', 'body', v_body);
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_site_prompt_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_site_prompt_draft(uuid) TO authenticated;
COMMENT ON FUNCTION public.claim_site_prompt_draft(uuid) IS
  '#4339: claim a website description once for the signed-in user. {status:claimed, body} the first time before expiry; {status:unavailable} for a missing, expired or already-claimed draft.';

COMMIT;
