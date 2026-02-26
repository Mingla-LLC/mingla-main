-- DATA PRESERVATION STRATEGY
-- Safely backup tables only if they exist (handles fresh database case)

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_interactions') THEN
    CREATE TABLE IF NOT EXISTS public._backup_user_interactions AS SELECT * FROM public.user_interactions;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_sessions') THEN
    CREATE TABLE IF NOT EXISTS public._backup_user_sessions AS SELECT * FROM public.user_sessions;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='saved_experiences') THEN
    CREATE TABLE IF NOT EXISTS public._backup_saved_experiences AS SELECT * FROM public.saved_experiences;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='experiences') THEN
    CREATE TABLE IF NOT EXISTS public._backup_experiences AS SELECT * FROM public.experiences;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='friends') THEN
    CREATE TABLE IF NOT EXISTS public._backup_friends AS SELECT * FROM public.friends;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='messages') THEN
    CREATE TABLE IF NOT EXISTS public._backup_messages AS SELECT * FROM public.messages;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='profiles') THEN
    CREATE TABLE IF NOT EXISTS public._backup_profiles AS SELECT * FROM public.profiles;
  END IF;
END $$;
