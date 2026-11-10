-- #4273 — SMS country switches and the marketing sender move into the database.
--
-- WHAT. Two service-role-only tables and four functions:
--   (a) public.sms_country_switches — one row per payout country (the 35 the
--       edge can map): is marketing SMS on, which sender carries it, does the
--       sender need registering first, and who changed it last;
--   (b) public.sms_marketing_sender_config — the one "Mingla Marketing"
--       Twilio Messaging Service SID (an identifier, not a credential);
--   (c) public.sms_marketing_switches_v1() — the edge's one atomic read;
--   (d) public.admin_sms_country_switches_list() — the Mingla Admin list;
--   (e) public.admin_set_sms_country_switch(...) — turn a country on or off;
--   (f) public.admin_set_sms_country_readiness(...) — mark registration done
--       or change the sender (local number added).
--
-- WHY. Each country's marketing switch was a key in MINGLA_DELIVERY_FLAGS_JSON
-- (which also holds payment switches and can never be read back), and the
-- marketing sender could only come from a new Supabase secret, which the
-- project's secret ceiling forbids. Both now live here, toggleable from Mingla
-- Admin by the owner and admins only, every change audited.
--
-- SEED. US and NG are on (today's live behaviour, unchanged); every other
-- country is off. Senders and registration flags mirror
-- supabase/functions/_shared/smsCountries.ts exactly (a Deno parity test reads
-- this file). Re-running the seed never flips a switch (ON CONFLICT DO NOTHING).
--
-- Transactional SMS (verification, tickets, RSVP) is not affected: nothing on
-- that path reads these tables.
--
-- Static SQL only. Conflicts raise PT409.
--
-- Invariants I-4273-SMS-SWITCHES-IN-DB and I-4273-NO-SWITCH-ON-BEFORE-READY
-- are declared beside their proof:
-- supabase/migrations/__tests__/issue_4273_sms_country_switches.implementor.pg17.test.sql

BEGIN;

-- ── (a) One switch row per payout country ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sms_country_switches (
  country text PRIMARY KEY CHECK (country IN (
    'AT','BE','BG','CA','CH','CY','CZ','DE','DK','EE','ES','FI','FR','GB','GR',
    'HR','HU','IE','IS','IT','LI','LT','LU','LV','MT','NG','NL','NO','PL','PT',
    'RO','SE','SI','SK','US'
  )),
  marketing_enabled boolean NOT NULL DEFAULT false,
  sender text NOT NULL CHECK (sender IN ('toll_free', 'marketing_service', 'termii', 'needs_local_number')),
  registration_required boolean NOT NULL DEFAULT false,
  registration_done_at timestamptz NULL,
  note text NULL,
  updated_by uuid NULL,
  updated_by_email text NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- US/CA only ever send from the toll-free number, NG only through Termii,
  -- and no other country can use either.
  CONSTRAINT sms_country_switches_sender_class CHECK (
    ((country IN ('US', 'CA')) = (sender = 'toll_free'))
    AND ((country = 'NG') = (sender = 'termii'))
  ),
  CONSTRAINT sms_country_switches_registration_shape CHECK (
    registration_done_at IS NULL OR registration_required
  ),
  -- I-4273-NO-SWITCH-ON-BEFORE-READY: a country cannot be on while it needs a
  -- local number or an unfinished sender registration, whatever writes it.
  CONSTRAINT sms_country_switches_enable_only_when_ready CHECK (
    NOT marketing_enabled OR (
      sender <> 'needs_local_number'
      AND (NOT registration_required OR registration_done_at IS NOT NULL)
    )
  )
);

ALTER TABLE public.sms_country_switches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_country_switches FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.sms_country_switches TO service_role;

COMMENT ON TABLE public.sms_country_switches IS
  '#4273: marketing SMS switch and sender per payout country. Service role reads only; every write goes through the owner/admin audited RPCs admin_set_sms_country_switch / admin_set_sms_country_readiness. Transactional SMS never reads this table.';

INSERT INTO public.sms_country_switches
  (country, marketing_enabled, sender, registration_required, note)
VALUES
  ('US', true,  'toll_free',          false, NULL),
  ('CA', false, 'toll_free',          false, NULL),
  ('NG', true,  'termii',             false, NULL),
  ('GB', false, 'marketing_service',  false, 'generic IDs blocked; protected brand IDs need MEF registration'),
  ('FR', false, 'marketing_service',  false, NULL),
  ('DE', false, 'marketing_service',  false, NULL),
  ('NL', false, 'marketing_service',  false, 'guideline table ambiguous; confirm alpha support'),
  ('IE', false, 'marketing_service',  true,  'about 2 weeks; unregistered shows ''Likely Scam'''),
  ('ES', false, 'marketing_service',  true,  'up to 4 weeks; no dynamic alpha'),
  ('AT', false, 'marketing_service',  true,  'up to 4 weeks; proof of entitlement; no dynamic alpha'),
  ('CZ', false, 'marketing_service',  true,  '3 weeks; unregistered blocked on T-Mobile and O2'),
  ('RO', false, 'marketing_service',  true,  '4 weeks; Telekom Romania needs it, others overwrite'),
  ('BG', false, 'marketing_service',  true,  '4 weeks; unregistered overwritten (Vivacom)'),
  ('FI', false, 'marketing_service',  true,  'up to 3 weeks; unregistered marked spam from 2026-11-02'),
  ('BE', false, 'needs_local_number', false, 'dynamic alpha not supported'),
  ('HU', false, 'needs_local_number', false, 'operators overwrite alpha with a numeric sender'),
  ('CH', false, 'marketing_service',  false, NULL),
  ('CY', false, 'marketing_service',  false, NULL),
  ('DK', false, 'marketing_service',  false, NULL),
  ('EE', false, 'marketing_service',  false, 'guideline table ambiguous; confirm'),
  ('GR', false, 'marketing_service',  false, 'generic IDs get blocked'),
  ('HR', false, 'marketing_service',  false, 'A1 may overwrite with a generic alpha'),
  ('IS', false, 'marketing_service',  false, 'URLs may be filtered'),
  ('IT', false, 'marketing_service',  false, NULL),
  ('LI', false, 'marketing_service',  false, NULL),
  ('LT', false, 'marketing_service',  false, NULL),
  ('LU', false, 'marketing_service',  false, NULL),
  ('LV', false, 'marketing_service',  false, NULL),
  ('MT', false, 'marketing_service',  false, NULL),
  ('NO', false, 'marketing_service',  false, NULL),
  ('PL', false, 'marketing_service',  false, 'generic IDs filtered by operators'),
  ('PT', false, 'marketing_service',  false, NULL),
  ('SE', false, 'marketing_service',  false, 'guideline table ambiguous; confirm'),
  ('SI', false, 'marketing_service',  false, NULL),
  ('SK', false, 'marketing_service',  false, NULL)
ON CONFLICT (country) DO NOTHING;

-- ── (b) The one marketing Messaging Service ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sms_marketing_sender_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  marketing_messaging_service_sid text NOT NULL
    CHECK (marketing_messaging_service_sid ~ '^MG[0-9a-f]{32}$'),
  label text NOT NULL DEFAULT 'Mingla Marketing',
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Never the transactional (toll-free) service "Mingla Verification".
  CONSTRAINT sms_marketing_sender_not_transactional CHECK (
    marketing_messaging_service_sid <> 'MG1942fbb549187fcf77c0e860405abf58'
  )
);

ALTER TABLE public.sms_marketing_sender_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_marketing_sender_config FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.sms_marketing_sender_config TO service_role;

COMMENT ON TABLE public.sms_marketing_sender_config IS
  '#4273: the Twilio Messaging Service that carries marketing SMS to alphanumeric-sender countries. An identifier, not a credential (#4273). Changed only by migration. Never the transactional service MG1942....';

INSERT INTO public.sms_marketing_sender_config (id, marketing_messaging_service_sid, label)
VALUES (1, 'MG9d42785c51834395018b52144736b9a7', 'Mingla Marketing')
ON CONFLICT (id) DO NOTHING;

-- ── (c) The edge's one atomic read ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sms_marketing_switches_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'marketingServiceSid',
      (SELECT c.marketing_messaging_service_sid
         FROM public.sms_marketing_sender_config c
        WHERE c.id = 1),
    'countries',
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'country', s.country,
                 'marketingEnabled', s.marketing_enabled,
                 'sender', s.sender,
                 'registrationRequired', s.registration_required,
                 'registrationDone', s.registration_done_at IS NOT NULL
               ) ORDER BY s.country)
          FROM public.sms_country_switches s
      ), '[]'::jsonb)
  )
$function$;

REVOKE ALL ON FUNCTION public.sms_marketing_switches_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_marketing_switches_v1() TO service_role;

COMMENT ON FUNCTION public.sms_marketing_switches_v1() IS
  '#4273: one snapshot of the marketing SMS switches and the marketing sender, read by marketing-send and offering-invite-dispatch. Service role only.';

-- ── (d) Mingla Admin list ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_sms_country_switches_list()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  -- Owner and admins only (#4273): the partner seat passes is_admin_user()
  -- but is refused here.
  IF NOT (public.is_admin_user() AND public.admin_team_role() IN ('owner', 'admin')) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'marketingService', (
      SELECT jsonb_build_object('sid', c.marketing_messaging_service_sid, 'label', c.label)
        FROM public.sms_marketing_sender_config c
       WHERE c.id = 1
    ),
    'countries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'country', s.country,
               'marketingEnabled', s.marketing_enabled,
               'sender', s.sender,
               'registrationRequired', s.registration_required,
               'registrationDoneAt', s.registration_done_at,
               'note', s.note,
               'price', CASE WHEN p.country IS NULL THEN NULL ELSE jsonb_build_object(
                 'provider', p.provider,
                 'currency', p.currency,
                 'minorNumerator', p.minor_numerator,
                 'minorDenominator', p.minor_denominator,
                 'fetchedAt', p.fetched_at
               ) END,
               'blockedReason', CASE
                 WHEN s.sender = 'needs_local_number' THEN 'needs_local_number'
                 WHEN s.registration_required AND s.registration_done_at IS NULL THEN 'registration_pending'
                 WHEN p.country IS NULL THEN 'unpriced'
                 ELSE NULL
               END,
               'updatedAt', s.updated_at,
               'updatedByEmail', s.updated_by_email
             ) ORDER BY s.country)
        FROM public.sms_country_switches s
        LEFT JOIN public.sms_country_prices p ON p.country = s.country
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_sms_country_switches_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_sms_country_switches_list() TO authenticated;

COMMENT ON FUNCTION public.admin_sms_country_switches_list() IS
  '#4273: Mingla Admin SMS countries list (switch, sender, registration, price, what blocks turning on). Owner and admins only.';

-- ── (e) Turn a country's marketing texts on or off ──────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_sms_country_switch(
  p_country text,
  p_marketing_enabled boolean,
  p_reason text,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_country text;
  v_row public.sms_country_switches%ROWTYPE;
  v_email text;
  v_now timestamptz := now();
BEGIN
  IF NOT (public.is_admin_user() AND public.admin_team_role() IN ('owner', 'admin')) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  v_country := upper(btrim(COALESCE(p_country, '')));
  IF NOT EXISTS (SELECT 1 FROM public.sms_country_switches s WHERE s.country = v_country) THEN
    RAISE EXCEPTION 'unknown_country';
  END IF;
  IF p_marketing_enabled IS NULL THEN
    RAISE EXCEPTION 'state_required';
  END IF;
  IF translate(
       COALESCE(p_reason, ''),
       E' \t\n\r\f\v' || chr(160) || chr(8203) || chr(8204) || chr(8205) || chr(8232) || chr(8233) || chr(65279),
       ''
     ) = '' THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  SELECT * INTO v_row FROM public.sms_country_switches s WHERE s.country = v_country FOR UPDATE;

  IF p_expected_updated_at IS NOT NULL AND v_row.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'sms_country_switch_stale' USING ERRCODE = 'PT409';
  END IF;

  -- I-4273-NO-SWITCH-ON-BEFORE-READY: the table CHECK refuses the first two
  -- too; naming them here gives Admin a plain reason.
  IF p_marketing_enabled THEN
    IF v_row.sender = 'needs_local_number' THEN
      RAISE EXCEPTION 'sms_country_needs_local_number';
    END IF;
    IF v_row.registration_required AND v_row.registration_done_at IS NULL THEN
      RAISE EXCEPTION 'sms_country_registration_pending';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sms_country_prices p WHERE p.country = v_country) THEN
      RAISE EXCEPTION 'sms_country_unpriced';
    END IF;
  END IF;

  IF v_row.marketing_enabled = p_marketing_enabled THEN
    RAISE EXCEPTION 'no_change';
  END IF;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = auth.uid();

  UPDATE public.sms_country_switches s
     SET marketing_enabled = p_marketing_enabled,
         updated_at = v_now,
         updated_by = auth.uid(),
         updated_by_email = v_email
   WHERE s.country = v_country;

  PERFORM public.admin_write_audit(
    'sms_country.switch_set',
    'sms_country_switches',
    v_country,
    p_reason,
    jsonb_build_object(
      'before', jsonb_build_object('marketingEnabled', v_row.marketing_enabled),
      'after', jsonb_build_object('marketingEnabled', p_marketing_enabled)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'country', v_country,
    'marketingEnabled', p_marketing_enabled,
    'updatedAt', v_now
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_sms_country_switch(text, boolean, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_sms_country_switch(text, boolean, text, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.admin_set_sms_country_switch(text, boolean, text, timestamptz) IS
  '#4273: turn marketing SMS on or off for one country. Owner and admins only; reason required; audited; refuses a country that needs a local number, an unfinished registration or a price; a stale expected_updated_at raises PT409.';

-- ── (f) Mark registration done / change the sender ──────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_sms_country_readiness(
  p_country text,
  p_registration_done boolean,
  p_sender text,
  p_reason text,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_country text;
  v_row public.sms_country_switches%ROWTYPE;
  v_email text;
  v_now timestamptz := now();
  v_done_at timestamptz;
  v_sender text;
BEGIN
  IF NOT (public.is_admin_user() AND public.admin_team_role() IN ('owner', 'admin')) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  v_country := upper(btrim(COALESCE(p_country, '')));
  IF NOT EXISTS (SELECT 1 FROM public.sms_country_switches s WHERE s.country = v_country) THEN
    RAISE EXCEPTION 'unknown_country';
  END IF;
  IF translate(
       COALESCE(p_reason, ''),
       E' \t\n\r\f\v' || chr(160) || chr(8203) || chr(8204) || chr(8205) || chr(8232) || chr(8233) || chr(65279),
       ''
     ) = '' THEN
    RAISE EXCEPTION 'reason_required';
  END IF;
  IF p_registration_done IS NULL AND p_sender IS NULL THEN
    RAISE EXCEPTION 'no_change';
  END IF;

  SELECT * INTO v_row FROM public.sms_country_switches s WHERE s.country = v_country FOR UPDATE;

  IF p_expected_updated_at IS NOT NULL AND v_row.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'sms_country_switch_stale' USING ERRCODE = 'PT409';
  END IF;

  v_done_at := v_row.registration_done_at;
  IF p_registration_done IS NOT NULL THEN
    IF NOT v_row.registration_required THEN
      RAISE EXCEPTION 'registration_not_required';
    END IF;
    IF p_registration_done THEN
      v_done_at := COALESCE(v_row.registration_done_at, v_now);
    ELSE
      IF v_row.marketing_enabled THEN
        RAISE EXCEPTION 'switch_off_first';
      END IF;
      v_done_at := NULL;
    END IF;
  END IF;

  v_sender := v_row.sender;
  IF p_sender IS NOT NULL THEN
    IF p_sender NOT IN ('marketing_service', 'needs_local_number')
       OR v_country IN ('US', 'CA', 'NG') THEN
      RAISE EXCEPTION 'sender_not_changeable';
    END IF;
    IF p_sender <> v_row.sender AND v_row.marketing_enabled THEN
      RAISE EXCEPTION 'switch_off_first';
    END IF;
    v_sender := p_sender;
  END IF;

  IF v_sender = v_row.sender AND v_done_at IS NOT DISTINCT FROM v_row.registration_done_at THEN
    RAISE EXCEPTION 'no_change';
  END IF;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = auth.uid();

  UPDATE public.sms_country_switches s
     SET sender = v_sender,
         registration_done_at = v_done_at,
         updated_at = v_now,
         updated_by = auth.uid(),
         updated_by_email = v_email
   WHERE s.country = v_country;

  PERFORM public.admin_write_audit(
    'sms_country.readiness_set',
    'sms_country_switches',
    v_country,
    p_reason,
    jsonb_build_object(
      'before', jsonb_build_object(
        'sender', v_row.sender,
        'registrationDoneAt', v_row.registration_done_at
      ),
      'after', jsonb_build_object(
        'sender', v_sender,
        'registrationDoneAt', v_done_at
      )
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'country', v_country,
    'sender', v_sender,
    'registrationDoneAt', v_done_at,
    'updatedAt', v_now
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_sms_country_readiness(text, boolean, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_sms_country_readiness(text, boolean, text, text, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.admin_set_sms_country_readiness(text, boolean, text, text, timestamptz) IS
  '#4273: mark a country''s sender registration done (or undone) and/or change its sender between marketing_service and needs_local_number. Owner and admins only; reason required; audited; a country that is on must be switched off first; US/CA/NG senders never change; a stale expected_updated_at raises PT409.';

COMMIT;

-- Footer.
-- Invariants: I-4273-SMS-SWITCHES-IN-DB, I-4273-NO-SWITCH-ON-BEFORE-READY
-- (declared in supabase/migrations/__tests__/issue_4273_sms_country_switches.implementor.pg17.test.sql).
-- Rollout: applying before merge is safe; no live code reads these tables yet.
-- Down path (documented only, never executed here): drop the four functions
-- above, then public.sms_marketing_sender_config and public.sms_country_switches.
