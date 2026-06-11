-- ORCH-1110: backfill creator_accounts.email where it is '' or NULL, from the
-- best available real email (auth.users.email -> newest identity email ->
-- profiles.email). Empty-string is normalized to a real email or left NULL
-- (never ''). Idempotent: re-running affects only rows still blank/NULL; once a
-- row holds a real email it is excluded. No DDL, no RLS change.
--
-- NOTE: filename prefix is 20260925000000 (NOT the SPEC's 20260924000000) to
-- stay strictly greater than the ORCH-1108-1109 sibling worktree migration
-- 20260924000000_orch_1108_brand_invite_declined.sql (Cross-host monotonicity
-- rule 10: prefix must exceed sibling-worktree prefixes). Documented deviation.
--
-- CI-SAFETY: the migration-baseline harness seeds auth.users + public.profiles
-- but NOT auth.identities. A bare reference to auth.identities fails to PLAN in
-- that environment ("relation auth.identities does not exist"). The
-- auth.identities source is therefore guarded behind a to_regclass() existence
-- check and executed as deferred-planned dynamic SQL — full resolution in
-- production (identities present), graceful auth.users->profiles fallback in CI
-- (identities absent). creator_accounts is empty in baseline, so the backfill
-- is a no-op there regardless.
--
-- Spec: Mingla_Artifacts/specs/SPEC_ORCH-1110_blank-email-undeletable-account.md §4.4
DO $$
BEGIN
  IF to_regclass('auth.identities') IS NOT NULL THEN
    -- Production path: auth.users.email -> newest identity email -> profiles.email
    EXECUTE $q$
      UPDATE public.creator_accounts ca
      SET email = sub.resolved_email, updated_at = now()
      FROM (
        SELECT u.id,
          COALESCE(
            NULLIF(BTRIM(au.email), ''),
            NULLIF(BTRIM((
              SELECT ai.identity_data->>'email'
              FROM auth.identities ai
              WHERE ai.user_id = u.id AND NULLIF(BTRIM(ai.identity_data->>'email'), '') IS NOT NULL
              ORDER BY ai.last_sign_in_at DESC NULLS LAST
              LIMIT 1
            )), ''),
            NULLIF(BTRIM(p.email), '')
          ) AS resolved_email
        FROM public.creator_accounts u
        JOIN auth.users au ON au.id = u.id
        LEFT JOIN public.profiles p ON p.id = u.id
        WHERE NULLIF(BTRIM(u.email), '') IS NULL
      ) sub
      WHERE ca.id = sub.id
        AND sub.resolved_email IS NOT NULL
        AND NULLIF(BTRIM(ca.email), '') IS NULL;
    $q$;
  ELSE
    -- CI baseline path (no auth.identities): auth.users.email -> profiles.email
    EXECUTE $q$
      UPDATE public.creator_accounts ca
      SET email = sub.resolved_email, updated_at = now()
      FROM (
        SELECT u.id,
          COALESCE(
            NULLIF(BTRIM(au.email), ''),
            NULLIF(BTRIM(p.email), '')
          ) AS resolved_email
        FROM public.creator_accounts u
        JOIN auth.users au ON au.id = u.id
        LEFT JOIN public.profiles p ON p.id = u.id
        WHERE NULLIF(BTRIM(u.email), '') IS NULL
      ) sub
      WHERE ca.id = sub.id
        AND sub.resolved_email IS NOT NULL
        AND NULLIF(BTRIM(ca.email), '') IS NULL;
    $q$;
  END IF;
END $$;
