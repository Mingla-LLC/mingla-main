-- #3720 Slice E follow-up — close the ORCH-1392 anonymous EXECUTE gap and
-- reset community relation grants to the intended read-only client surface.
--
-- Supabase grants EXECUTE on newly-created functions directly to `anon` through
-- ALTER DEFAULT PRIVILEGES. Revoking only from PUBLIC therefore left these
-- SECURITY DEFINER RPCs callable by signed-out clients. All eleven belong to
-- authenticated Host/Admin surfaces; support_is_online() is consumed inside
-- signed-in Host Help & Support and has no anonymous caller.

BEGIN;

-- ALTER DEFAULT PRIVILEGES also grants broad relation privileges directly to
-- API roles in a fresh Supabase database. The Slice E migration revoked those
-- defaults from anon on the tables, but did not reset authenticated, and the
-- view did not reset either API role. Community writes already go through the
-- guarded SECURITY DEFINER RPCs below, so clients only need these reads.
REVOKE ALL ON TABLE public.community_announcements
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.community_announcements
  TO authenticated;
GRANT ALL ON TABLE public.community_announcements
  TO service_role;

REVOKE ALL ON TABLE public.community_read_receipts
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.community_read_receipts
  TO authenticated;
GRANT ALL ON TABLE public.community_read_receipts
  TO service_role;

REVOKE ALL ON TABLE public.community_roadmap_public
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.community_roadmap_public
  TO anon, authenticated;
GRANT ALL ON TABLE public.community_roadmap_public
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.community_role(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.community_can(text, uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.community_set_staff(uuid, text, boolean, text)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.support_is_online()
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.community_upsert_announcement(uuid, text, text)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.community_publish_announcement(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.community_archive_announcement(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.community_upsert_roadmap_card(uuid, text, text, text, text, text)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.community_reorder_roadmap(uuid[])
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.community_set_email_pref(boolean)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.community_mark_announcement_read(uuid)
  FROM PUBLIC, anon;

-- Preserve the intended positive grants explicitly instead of depending on
-- environment-specific default privileges.
GRANT EXECUTE ON FUNCTION public.community_role(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_can(text, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_set_staff(uuid, text, boolean, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.support_is_online()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_upsert_announcement(uuid, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_publish_announcement(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_archive_announcement(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_upsert_roadmap_card(uuid, text, text, text, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_reorder_roadmap(uuid[])
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_set_email_pref(boolean)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_mark_announcement_read(uuid)
  TO authenticated, service_role;

-- Fails on migration replay if any signature is missing, anon remains able to
-- execute one, or the intended signed-in/server callers lose availability.
DO $check$
DECLARE
  v_signature regprocedure;
  v_relation text;
  v_role text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.community_role(uuid)'::regprocedure,
    'public.community_can(text,uuid)'::regprocedure,
    'public.community_set_staff(uuid,text,boolean,text)'::regprocedure,
    'public.support_is_online()'::regprocedure,
    'public.community_upsert_announcement(uuid,text,text)'::regprocedure,
    'public.community_publish_announcement(uuid)'::regprocedure,
    'public.community_archive_announcement(uuid)'::regprocedure,
    'public.community_upsert_roadmap_card(uuid,text,text,text,text,text)'::regprocedure,
    'public.community_reorder_roadmap(uuid[])'::regprocedure,
    'public.community_set_email_pref(boolean)'::regprocedure,
    'public.community_mark_announcement_read(uuid)'::regprocedure
  ]
  LOOP
    IF has_function_privilege('anon', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION
        '#3720 anon lockdown failed: anon can still EXECUTE %', v_signature;
    END IF;
    IF NOT has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION
        '#3720 anon lockdown failed: authenticated lost EXECUTE on %', v_signature;
    END IF;
    IF NOT has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION
        '#3720 anon lockdown failed: service_role lost EXECUTE on %', v_signature;
    END IF;
  END LOOP;

  IF has_table_privilege('anon', 'public.community_announcements', 'SELECT')
     OR has_table_privilege('anon', 'public.community_read_receipts', 'SELECT')
     OR NOT has_table_privilege(
       'anon', 'public.community_roadmap_public', 'SELECT'
     )
     OR NOT has_table_privilege(
       'authenticated', 'public.community_announcements', 'SELECT'
     )
     OR NOT has_table_privilege(
       'authenticated', 'public.community_read_receipts', 'SELECT'
     )
     OR NOT has_table_privilege(
       'authenticated', 'public.community_roadmap_public', 'SELECT'
     ) THEN
    RAISE EXCEPTION '#3720 relation lockdown failed: read matrix drifted';
  END IF;

  FOREACH v_relation IN ARRAY ARRAY[
    'public.community_announcements',
    'public.community_read_receipts',
    'public.community_roadmap_public'
  ]
  LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      IF EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
          'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
          'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ]) AS privilege_name
        WHERE has_table_privilege(v_role, v_relation, privilege_name)
      ) THEN
        RAISE EXCEPTION
          '#3720 relation lockdown failed: % retains a write-like privilege on %',
          v_role,
          v_relation;
      END IF;
    END LOOP;
  END LOOP;
END;
$check$;

COMMIT;
