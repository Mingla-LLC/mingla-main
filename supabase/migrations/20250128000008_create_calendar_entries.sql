-- ===========================================
-- CALENDAR ENTRIES - CROSS DEVICE SCHEDULING
-- ===========================================

-- Drop enum types if they exist and conflict with our TEXT columns
-- First, convert any columns using enums to TEXT, then drop the enums
DO $$
DECLARE
  enum_type_name TEXT;
BEGIN
  -- Find enum types that might be used by calendar_entries (source, status, etc.)
  FOR enum_type_name IN
    SELECT DISTINCT t.typname
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname LIKE '%calendar%' OR t.typname LIKE '%source%' OR t.typname LIKE '%status%'
  LOOP
    -- If calendar_entries table exists and source column uses this enum, convert it first
    IF EXISTS (
      SELECT 1 FROM information_schema.columns c
      JOIN pg_type t ON c.udt_name = t.typname
      WHERE c.table_schema = 'public'
        AND c.table_name = 'calendar_entries'
        AND c.column_name = 'source'
        AND t.typname = enum_type_name
    ) THEN
      -- Convert the source column from enum to TEXT
      EXECUTE format('ALTER TABLE public.calendar_entries ALTER COLUMN source TYPE TEXT USING source::TEXT');
    END IF;
    
    -- If calendar_entries table exists and status column uses this enum, convert it first
    IF EXISTS (
      SELECT 1 FROM information_schema.columns c
      JOIN pg_type t ON c.udt_name = t.typname
      WHERE c.table_schema = 'public'
        AND c.table_name = 'calendar_entries'
        AND c.column_name = 'status'
        AND t.typname = enum_type_name
    ) THEN
      -- Convert the status column from enum to TEXT
      EXECUTE format('ALTER TABLE public.calendar_entries ALTER COLUMN status TYPE TEXT USING status::TEXT');
    END IF;
    
    -- Now drop the enum type
    EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', enum_type_name);
  END LOOP;
END $$;

-- Table to store scheduled experiences per user
-- Note: card_id is TEXT to accommodate various ID formats (UUIDs, Google Places IDs, etc.)
CREATE TABLE IF NOT EXISTS public.calendar_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id TEXT, -- ID of the saved card/experience (can be UUID, Google Places ID, or any string)
  board_card_id UUID, -- ID of board_saved_cards if from collaboration
  source TEXT NOT NULL DEFAULT 'solo' CHECK (source IN ('solo', 'collaboration')),
  card_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER,
  purchase_option_id UUID,
  price_paid DECIMAL(10, 2),
  qr_code TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  archived_at TIMESTAMPTZ
);

-- If table already exists, ensure source and status columns are TEXT (not enum) and have correct CHECK constraints
DO $$
BEGIN
  -- Handle source column
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'calendar_entries' 
    AND column_name = 'source'
  ) THEN
    -- Drop any existing CHECK constraints on source column
    ALTER TABLE public.calendar_entries 
    DROP CONSTRAINT IF EXISTS calendar_entries_source_check;
    
    -- If source column is an enum type, convert it to TEXT
    IF EXISTS (
      SELECT 1 FROM information_schema.columns c
      JOIN pg_type t ON c.udt_name = t.typname
      WHERE c.table_schema = 'public'
        AND c.table_name = 'calendar_entries'
        AND c.column_name = 'source'
        AND t.typtype = 'e'
    ) THEN
      ALTER TABLE public.calendar_entries 
      ALTER COLUMN source TYPE TEXT USING source::TEXT;
    END IF;
    
    -- Add the correct CHECK constraint
    ALTER TABLE public.calendar_entries 
    ADD CONSTRAINT calendar_entries_source_check 
    CHECK (source IN ('solo', 'collaboration'));
  END IF;
  
  -- Handle status column
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'calendar_entries' 
    AND column_name = 'status'
  ) THEN
    -- Drop any existing CHECK constraints on status column
    ALTER TABLE public.calendar_entries 
    DROP CONSTRAINT IF EXISTS calendar_entries_status_check;
    
    -- If status column is an enum type, convert it to TEXT
    IF EXISTS (
      SELECT 1 FROM information_schema.columns c
      JOIN pg_type t ON c.udt_name = t.typname
      WHERE c.table_schema = 'public'
        AND c.table_name = 'calendar_entries'
        AND c.column_name = 'status'
        AND t.typtype = 'e'
    ) THEN
      ALTER TABLE public.calendar_entries 
      ALTER COLUMN status TYPE TEXT USING status::TEXT;
    END IF;
    
    -- Add the correct CHECK constraint
    ALTER TABLE public.calendar_entries 
    ADD CONSTRAINT calendar_entries_status_check 
    CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled'));
  END IF;
END $$;

-- Ensure card_id can be NULL (remove NOT NULL constraint if it exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'calendar_entries' 
    AND column_name = 'card_id'
    AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.calendar_entries 
    ALTER COLUMN card_id DROP NOT NULL;
  END IF;
END $$;

-- If table already exists, alter card_id column to TEXT if it's currently UUID
DO $$
DECLARE
  constraint_name_var TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'calendar_entries' 
    AND column_name = 'card_id'
    AND data_type = 'uuid'
  ) THEN
    -- Drop any foreign key constraints on card_id first
    -- Find all foreign key constraints on card_id column
    FOR constraint_name_var IN
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.table_name = 'calendar_entries'
        AND tc.table_schema = 'public'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'card_id'
    LOOP
      EXECUTE 'ALTER TABLE public.calendar_entries DROP CONSTRAINT IF EXISTS ' || quote_ident(constraint_name_var);
    END LOOP;
    
    -- Now alter the column type
    ALTER TABLE public.calendar_entries 
    ALTER COLUMN card_id TYPE TEXT USING card_id::TEXT;
  END IF;
END $$;

-- Indexes for performant queries
CREATE INDEX IF NOT EXISTS idx_calendar_entries_user_id
  ON public.calendar_entries(user_id);

CREATE INDEX IF NOT EXISTS idx_calendar_entries_scheduled_at
  ON public.calendar_entries(scheduled_at DESC);

-- Enable RLS
ALTER TABLE public.calendar_entries ENABLE ROW LEVEL SECURITY;

-- Policies: users can only access their own calendar entries
DROP POLICY IF EXISTS "Users can view their own calendar entries" ON public.calendar_entries;
CREATE POLICY "Users can view their own calendar entries"
  ON public.calendar_entries
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert their own calendar entries" ON public.calendar_entries;
CREATE POLICY "Users can insert their own calendar entries"
  ON public.calendar_entries
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their own calendar entries" ON public.calendar_entries;
CREATE POLICY "Users can update their own calendar entries"
  ON public.calendar_entries
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their own calendar entries" ON public.calendar_entries;
CREATE POLICY "Users can delete their own calendar entries"
  ON public.calendar_entries
  FOR DELETE
  USING (user_id = auth.uid());

-- Reuse generic updated_at trigger if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'update_updated_at_column'
  ) THEN
    -- Drop trigger if it already exists
    DROP TRIGGER IF EXISTS update_calendar_entries_updated_at ON public.calendar_entries;
    
    -- Create the trigger
    CREATE TRIGGER update_calendar_entries_updated_at
      BEFORE UPDATE ON public.calendar_entries
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END;
$$;


