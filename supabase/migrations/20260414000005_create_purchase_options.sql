CREATE TABLE IF NOT EXISTS public.purchase_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id uuid NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  price_unit text NOT NULL CHECK (price_unit IN ('person', 'pair', 'group', 'flat')),
  included_item_ids uuid[] DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_options_business ON public.purchase_options (business_profile_id);

ALTER TABLE public.purchase_options ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "po_owner_all" ON public.purchase_options FOR ALL TO authenticated
    USING (business_profile_id IN (SELECT id FROM public.business_profiles WHERE creator_account_id = auth.uid()))
    WITH CHECK (business_profile_id IN (SELECT id FROM public.business_profiles WHERE creator_account_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "po_public_read" ON public.purchase_options FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "po_service_role" ON public.purchase_options FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
