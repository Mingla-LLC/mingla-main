-- Auto-update seeding_cities.status when places are added/linked
-- Prevents the bug where 3 of 5 code paths forgot to update status.
-- See: outputs/INVESTIGATION_SEEDING_STATUS_BUG_REPORT.md

CREATE OR REPLACE FUNCTION public.auto_update_city_seeded_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.city_id IS NOT NULL AND NEW.is_active THEN
    UPDATE public.seeding_cities
    SET status = 'seeded', updated_at = now()
    WHERE id = NEW.city_id
      AND status = 'draft';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_city_seeded_status
AFTER INSERT OR UPDATE OF city_id, is_active ON public.place_pool
FOR EACH ROW
EXECUTE FUNCTION public.auto_update_city_seeded_status();
