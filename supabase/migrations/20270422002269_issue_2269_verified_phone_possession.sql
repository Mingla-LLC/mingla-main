-- Issue #2269 — a buyer who checks out with their phone and signs into the
-- Explorer app with Google or Apple must still get their ticket.
--
-- WHAT #2269 ASSUMED, AND WHAT PRODUCTION ACTUALLY SAYS (measured 2026-08-18,
-- project gqnoajqerqhnvulmnyvv, 128 auth.users / 191 auth.identities).
--
-- The issue reads `i.provider = 'phone'` as "signed in with a phone" and
-- concludes that the 63 Google and 37 Apple accounts are excluded. They are
-- not. `verify-otp` calls `auth.admin.updateUserById(user, { phone })` after
-- Twilio approves, and GoTrue mints a provider='phone' identity ALONGSIDE the
-- google/apple one. Measured, per provider set:
--
--     providers            accounts  auth.users.phone  provider='phone' identity
--     google,phone               38                38                         38
--     apple,phone                23                23                         23
--     apple,google,phone          1                 1                          1
--     google (only)              23                 0                          0
--     apple  (only)              13                 0                          0
--
-- Every one of the 62 accounts holding a phone ALREADY has the phone identity,
-- and 61 of those 62 signed in with Google or Apple. The phone identity is
-- created 20-40 SECONDS AFTER the social identity (median 29s; its
-- last_sign_in_at equals its created_at) — it is the onboarding Twilio step,
-- not a sign-in method. There is no excluded population of 63.
-- `verified_account_identifiers` returns a phone for 62 of 62 phone holders.
--
-- THE DEFECT THAT IS REAL. `verify-otp` writes `profiles.phone` as the
-- must-succeed source of truth and syncs GoTrue best-effort, inside a
-- try/catch that only warns. `auth.users` carries `users_phone_key UNIQUE
-- (phone)`. When a stale account still holds the number, that sync THROWS, is
-- SWALLOWED, and no phone identity is ever minted — so a phone Twilio really
-- did verify becomes invisible to the claim. Measured: 2 accounts, 3 armed-able
-- guest orders.
--
--   485addca google-only  profiles.phone +2348162646567  auth.users.phone NULL
--            blocked by b17e3e15 (a business account from April) which still
--            holds 2348162646567 in auth.users. verify-otp's duplicate guard
--            reads `profiles` only, where b17e3e15's phone is already NULL, so
--            the guard passed and the real conflict surfaced only in the
--            swallowed sync.
--   87207cdb apple-only   profiles.phone +12015550199 (the reviewer number)
--            the ORCH-0977 reviewer bypass writes `profiles` and never GoTrue.
--
-- WHY NOT JUST READ `profiles.phone`. Because it is CLIENT-WRITABLE, and
-- reading it would do exactly what #2217's revert matrix forbids. Measured:
-- `authenticated` holds a column-level UPDATE grant on `profiles.phone`, and
-- the RLS policy is `USING (auth.uid() = id) WITH CHECK (auth.uid() = id)`
-- with no trigger guarding the column. Any signed-in user can set their own
-- `profiles.phone` to a stranger's number. A predicate on it turns "knows the
-- number" into "owns the ticket" — knowledge, not possession.
--
-- WHY NOT `phone_confirmed_at`. Set on ALL 128 accounts including the 66 with
-- no phone at all. It carries no information (#2237's class, and #2217 already
-- refused it).
--
-- THE FIX. A possession ledger this project owns, written ONLY by service_role
-- at the instant Twilio returns `approved`, and UNIONed into the phone arm.
-- The GoTrue identity arm is untouched and remains the primary source; the
-- ledger is what survives a GoTrue unique-constraint refusal. Because the proof
-- no longer depends on that best-effort write, its failure stops costing a
-- buyer their ticket.
--
-- The email arm is UNCHANGED, deliberately. It is the fallback and it works.
BEGIN;

-- ===========================================================================
-- (1) The possession ledger.
--
--     NOT client-writable, and that is the entire point. No grants to anon or
--     authenticated, RLS enabled and FORCEd with no policy, so even a future
--     grant leaves it unreadable and unwritable from a user JWT. Only
--     `record_verified_phone` (SECURITY DEFINER, service_role only) writes it.
--
--     PRIMARY KEY (user_id) — one live verified number per account, so a user
--     cannot accumulate claims on every number they ever held.
--     UNIQUE (phone_e164) — one live owner per number, so a recycled number
--     cannot leave two accounts both able to claim it.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.verified_phone_identities (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_e164  text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verified_phone_identities_e164_chk
    CHECK (phone_e164 ~ '^\+[1-9][0-9]{1,14}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS verified_phone_identities_phone_key
  ON public.verified_phone_identities (phone_e164);

COMMENT ON TABLE public.verified_phone_identities IS
  '#2269: the phone numbers Twilio Verify actually approved for an account, written ONLY by record_verified_phone from verify-otp. Exists because the GoTrue sync in verify-otp is best-effort and auth.users.phone is UNIQUE: when a stale account still holds the number the sync throws, is swallowed, and the phone identity is never minted (measured: 2 accounts, 3 orders). Deliberately NOT profiles.phone, which authenticated can write to any value.';

COMMENT ON COLUMN public.verified_phone_identities.phone_e164 IS
  '#2269: E.164 WITH the leading +, matching orders.buyer_phone_e164. GoTrue stores the same number bare; verified_account_identifiers restores the + on that arm only.';

ALTER TABLE public.verified_phone_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verified_phone_identities FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.verified_phone_identities FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.verified_phone_identities TO service_role;

-- ===========================================================================
-- (2) record_verified_phone — the ONLY writer.
--
--     Called by verify-otp after Twilio returns status='approved', and after
--     its own duplicate guard. Takes the number Twilio approved, normalizes it
--     once, and moves ownership: the number belongs to the account that most
--     recently proved it, never to two at once.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.record_verified_phone(
  p_user_id uuid,
  p_phone   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_phone text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  -- Normalize ONCE, here. Callers hand us E.164; be strict rather than
  -- forgiving, because a mis-normalized number would silently match nothing
  -- (or, worse, the wrong order).
  v_phone := '+' || regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  IF v_phone !~ '^\+[1-9][0-9]{1,14}$' THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
    RETURN jsonb_build_object('result', 'unknown_user');
  END IF;

  -- One live owner per number. A number that moved to a new human must stop
  -- entitling the previous account, or the old owner keeps claiming tickets
  -- bought by the new one.
  DELETE FROM public.verified_phone_identities
   WHERE phone_e164 = v_phone AND user_id <> p_user_id;

  INSERT INTO public.verified_phone_identities AS v (user_id, phone_e164, verified_at)
  VALUES (p_user_id, v_phone, now())
  ON CONFLICT (user_id) DO UPDATE
    SET phone_e164 = EXCLUDED.phone_e164, verified_at = EXCLUDED.verified_at;

  RETURN jsonb_build_object('result', 'recorded', 'phone', v_phone);
END;
$function$;

COMMENT ON FUNCTION public.record_verified_phone(uuid, text) IS
  '#2269: records a Twilio-APPROVED number as an account possession proof. service_role only — reachable from verify-otp and nowhere else. A user JWT has no path to this function and no write path to the table behind it.';

REVOKE ALL ON FUNCTION public.record_verified_phone(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_verified_phone(uuid, text) TO service_role;

-- ===========================================================================
-- (3) verified_account_identifiers — phone arm widened, email arm untouched.
--
--     phone = (GoTrue provider='phone' identity)  UNION  (this ledger)
--     email = EXACTLY what #2217 shipped.
--
--     One UNION, one statement, so a user holding both records for the same
--     number still yields ONE row (#2217's I-03 asserts exactly 1).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.verified_account_identifiers(p_user_id uuid)
RETURNS TABLE (kind text, value text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  -- The ledger arm is a plain public table: it is ALWAYS available, including
  -- on the supabase/postgres CI image whose auth schema is a stub. #2217 had to
  -- return nothing at all there; the ledger no longer pays that price.
  v_sql text := $base$
    SELECT 'phone'::text, v.phone_e164
      FROM public.verified_phone_identities v
     WHERE v.user_id = $1
       AND v.phone_e164 ~ '^\+[1-9][0-9]{1,14}$'
  $base$;
BEGIN
  -- FAIL CLOSED on the GoTrue arm, not loudly. `auth.identities` does NOT exist
  -- in the supabase/postgres CI image, and the repository-wide migration lane
  -- applies this file to exactly that image. A LANGUAGE sql body would be
  -- resolved at CREATE time and abort the whole chain there.
  IF to_regclass('auth.identities') IS NOT NULL THEN
    v_sql := v_sql || $ident$
      UNION
      SELECT 'email'::text, lower(btrim(i.identity_data->>'email'))
        FROM auth.identities i
       WHERE i.user_id = $1
         AND btrim(coalesce(i.identity_data->>'email', '')) <> ''
         AND (
           i.provider = 'email'
           OR lower(coalesce(i.identity_data->>'email_verified', '')) IN ('true', 't')
         )
      UNION
      SELECT 'phone'::text,
             '+' || regexp_replace(
               coalesce(i.identity_data->>'phone', u.phone), '[^0-9]', '', 'g')
        FROM auth.identities i
        JOIN auth.users u ON u.id = i.user_id
       WHERE i.user_id = $1
         AND i.provider = 'phone'
         AND coalesce(i.identity_data->>'phone', u.phone) ~ '^[+]?[1-9][0-9]{1,14}$'
    $ident$;
  END IF;

  RETURN QUERY EXECUTE v_sql USING p_user_id;
END;
$function$;

COMMENT ON FUNCTION public.verified_account_identifiers(uuid) IS
  '#2217/#2269: the identifiers an account has PROVEN it can receive at. email — auth.identities only, unchanged by #2269. phone — the GoTrue provider=phone identity UNION public.verified_phone_identities, the service-role-only ledger verify-otp writes when Twilio approves. Deliberately reads NEITHER auth.users.phone_confirmed_at / email_confirmed_at (set on all 128 accounts including 66 with no phone) NOR profiles.phone (authenticated holds a column UPDATE grant on it, so any user can set it to a stranger''s number).';

REVOKE ALL ON FUNCTION public.verified_account_identifiers(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verified_account_identifiers(uuid) TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
