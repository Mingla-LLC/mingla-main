-- Issue #4238 Wave 3 (M-2) — host-funnel conversions: one path for Lead, host
-- sign-up, first publish and first sale.
--
-- Spec: #4238 tracking-fix spec v2.4, section 8 (W3-3, D7) and section 12.
--
-- What this adds:
--   1. public.ad_match_contexts — the browser match keys (first-party click id,
--      _fbp/_fbc/_ttp/_scid, IP, user agent, the visitor's ads choice, the page)
--      for a host or a host lead, the same kinds of values
--      ticket_checkout_sessions already holds for buyers. One row per subject.
--      RLS on with NO client policy: only service-role code reads or writes it.
--      install_attribution holds a Host app install's saved AppsFlyer fields
--      (media_source, campaign, af_sub1-3) for analysis; it is never sent to an
--      ad network.
--   2. ad_conversions.event_type also accepts host_signup, host_first_publish
--      and host_first_sale. 'lead' (already allowed) is the host lead.
--   3. Two triggers that queue a pending conversion row, never raising into
--      the caller (static SQL, catch-all, RAISE WARNING):
--        creator_accounts INSERT                  → host_signup:<user id>
--        events first published_at (insert/update) → host_publish:<owner id>
--      ON CONFLICT (event_id) DO NOTHING: each fires once per host, ever.
--
-- Invariant I-4238-HOST-FUNNEL-ONCE (declared in
-- supabase/migrations/__tests__/issue_4238_host_funnel.implementor.pg17.test.sql).
--
-- Static SQL only. No backfill (hosts who signed up or published before this
-- migration are not reported). Do NOT auto-apply — reviewed path post-merge.
-- Apply BEFORE the edge functions deploy.

BEGIN;

-- 1. ad_match_contexts ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ad_match_contexts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type          text NOT NULL CHECK (subject_type IN ('host_user', 'lead')),
  subject_id            text NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 200),
  click_id              text NULL CHECK (click_id IS NULL OR length(click_id) <= 200),
  fbp                   text NULL CHECK (fbp IS NULL OR length(fbp) <= 500),
  fbc                   text NULL CHECK (fbc IS NULL OR length(fbc) <= 500),
  ttp                   text NULL CHECK (ttp IS NULL OR length(ttp) <= 500),
  scid                  text NULL CHECK (scid IS NULL OR length(scid) <= 500),
  client_ip             text NULL CHECK (client_ip IS NULL OR length(client_ip) <= 100),
  client_user_agent     text NULL CHECK (client_user_agent IS NULL OR length(client_user_agent) <= 1000),
  ad_tracking_opt_out   boolean NOT NULL DEFAULT false,
  event_source_url      text NULL CHECK (event_source_url IS NULL OR length(event_source_url) <= 2000),
  surface               text NOT NULL DEFAULT 'web' CHECK (surface IN ('web', 'ios', 'android')),
  install_attribution   jsonb NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_match_contexts_subject_key UNIQUE (subject_type, subject_id)
);

COMMENT ON TABLE public.ad_match_contexts IS
  'Issue #4238 W3-3. Browser match keys for a host (host_user, auth user id) or a host lead (lead, book_call_leads id or tool:<tool_leads id>). Service role only (RLS on, no client policy). Never exposed to clients; never stores a token or a hash.';

ALTER TABLE public.ad_match_contexts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ad_match_contexts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ad_match_contexts TO service_role;

DROP TRIGGER IF EXISTS trg_ad_match_contexts_updated_at ON public.ad_match_contexts;
CREATE TRIGGER trg_ad_match_contexts_updated_at
  BEFORE UPDATE ON public.ad_match_contexts
  FOR EACH ROW EXECUTE FUNCTION public.tg_ad_engine_set_updated_at();

-- 2. ad_conversions.event_type --------------------------------------------------

ALTER TABLE public.ad_conversions
  DROP CONSTRAINT IF EXISTS ad_conversions_event_type_check;
ALTER TABLE public.ad_conversions
  ADD CONSTRAINT ad_conversions_event_type_check
  CHECK (event_type IN (
    'purchase', 'reservation', 'lead', 'view',
    'host_signup', 'host_first_publish', 'host_first_sale'
  ));

-- 3a. host sign-up --------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_issue_4238_host_signup_conversion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  BEGIN
    INSERT INTO public.ad_conversions (
      event_id, event_type, event_name, surface, lane, hashed_email
    ) VALUES (
      'host_signup:' || NEW.id::text,
      'host_signup',
      'HostSignUp',
      'web',
      'consumer',
      CASE
        WHEN NEW.email IS NOT NULL AND length(trim(NEW.email)) > 0
          THEN encode(sha256(convert_to(lower(trim(NEW.email)), 'UTF8')), 'hex')
        ELSE NULL
      END
    )
    ON CONFLICT (event_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'issue #4238 host_signup conversion not queued: %', SQLERRM;
  END;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.tg_issue_4238_host_signup_conversion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_issue_4238_host_signup_conversion ON public.creator_accounts;
CREATE TRIGGER trg_issue_4238_host_signup_conversion
  AFTER INSERT ON public.creator_accounts
  FOR EACH ROW EXECUTE FUNCTION public.tg_issue_4238_host_signup_conversion();

-- 3b. host first publish ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_issue_4238_host_first_publish_conversion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_owner uuid;
BEGIN
  IF NEW.published_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.published_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  BEGIN
    -- The same owner relation as resolveBrandOwnerUserId (_shared/appsFlyerS2S.ts).
    SELECT b.account_id INTO v_owner FROM public.brands b WHERE b.id = NEW.brand_id;
    IF v_owner IS NULL THEN
      RETURN NEW;
    END IF;
    -- #4238 P1-3: a TRUE first publish only. An owner who already has any
    -- other published listing (an event, trip or experience in public.events,
    -- on any of their brands, deleted or not) or a verified (public) venue
    -- listing is an existing host: nothing is queued, so a host who published
    -- before this migration is never reported as a "first" publish.
    IF EXISTS (
      SELECT 1
      FROM public.events e
      JOIN public.brands ob ON ob.id = e.brand_id
      WHERE ob.account_id = v_owner
        AND e.id <> NEW.id
        AND e.published_at IS NOT NULL
    ) OR EXISTS (
      SELECT 1
      FROM public.venue_listings vl
      JOIN public.brands ob ON ob.id = vl.brand_id
      WHERE ob.account_id = v_owner
        AND vl.claim_status = 'verified'
    ) THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.ad_conversions (
      event_id, event_type, event_name, surface, lane, brand_id, mingla_event_id
    ) VALUES (
      'host_publish:' || v_owner::text,
      'host_first_publish',
      'HostFirstEventPublished',
      'web',
      'consumer',
      NEW.brand_id,
      NEW.id
    )
    ON CONFLICT (event_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'issue #4238 host_first_publish conversion not queued: %', SQLERRM;
  END;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.tg_issue_4238_host_first_publish_conversion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_issue_4238_host_first_publish_conversion ON public.events;
CREATE TRIGGER trg_issue_4238_host_first_publish_conversion
  AFTER INSERT OR UPDATE OF published_at ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.tg_issue_4238_host_first_publish_conversion();

COMMIT;
