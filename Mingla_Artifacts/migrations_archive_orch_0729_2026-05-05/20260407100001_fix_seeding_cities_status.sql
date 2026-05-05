-- Fix seeding_cities.status: cities with places should be 'seeded', not 'draft'
UPDATE public.seeding_cities sc
SET status = 'seeded', updated_at = now()
WHERE sc.status = 'draft'
  AND EXISTS (
    SELECT 1 FROM public.place_pool pp
    WHERE pp.city_id = sc.id AND pp.is_active
    LIMIT 1
  );
