-- Allow 'blocked' status on friends table for block/unblock functionality
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'friends') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'friends' AND column_name = 'status') THEN
      -- Drop existing CHECK on status if it exists (constraint name may vary)
      ALTER TABLE public.friends DROP CONSTRAINT IF EXISTS friends_status_check;
      ALTER TABLE public.friends DROP CONSTRAINT IF EXISTS friends_status_fkey;
      -- Add CHECK that allows accepted, pending, blocked
      ALTER TABLE public.friends ADD CONSTRAINT friends_status_check
        CHECK (status IN ('accepted', 'pending', 'blocked'));
    END IF;
  END IF;
END $$;
