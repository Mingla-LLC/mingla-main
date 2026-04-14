CREATE TABLE IF NOT EXISTS public.menus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id uuid NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('food', 'service')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menus_business ON public.menus (business_profile_id);

CREATE TABLE IF NOT EXISTS public.menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id uuid NOT NULL REFERENCES public.menus(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  category text NOT NULL,
  dietary_tags jsonb NOT NULL DEFAULT '[]',
  sort_order integer NOT NULL DEFAULT 0,
  ai_confidence numeric(3,2),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menu_items_menu ON public.menu_items (menu_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_active ON public.menu_items (menu_id, is_active) WHERE is_active = true;

ALTER TABLE public.menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "menus_owner_all" ON public.menus FOR ALL TO authenticated
    USING (business_profile_id IN (SELECT id FROM public.business_profiles WHERE creator_account_id = auth.uid()))
    WITH CHECK (business_profile_id IN (SELECT id FROM public.business_profiles WHERE creator_account_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "menus_public_read" ON public.menus FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "menu_items_owner_all" ON public.menu_items FOR ALL TO authenticated
    USING (menu_id IN (SELECT m.id FROM public.menus m JOIN public.business_profiles bp ON m.business_profile_id = bp.id WHERE bp.creator_account_id = auth.uid()))
    WITH CHECK (menu_id IN (SELECT m.id FROM public.menus m JOIN public.business_profiles bp ON m.business_profile_id = bp.id WHERE bp.creator_account_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "menu_items_public_read" ON public.menu_items FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "menus_service_role" ON public.menus FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "menu_items_service_role" ON public.menu_items FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS trg_menus_updated_at ON public.menus;
CREATE TRIGGER trg_menus_updated_at BEFORE UPDATE ON public.menus FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
