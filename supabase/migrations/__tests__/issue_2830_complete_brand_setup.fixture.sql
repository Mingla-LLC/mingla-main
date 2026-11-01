-- Test-only compatibility fixture for #2830's first-provision boundary.
-- Tests that exercise post-provision behavior must represent the completed
-- brand context and first five setup parts that production now requires.
CREATE OR REPLACE FUNCTION pg_temp.issue_2830_complete_brand_setup(
  p_brand_id uuid,
  p_actor uuid
) RETURNS void
LANGUAGE plpgsql
AS $fixture$
BEGIN
  UPDATE public.brands SET
    description = COALESCE(NULLIF(btrim(description), ''), 'Owner-provided test brand description.'),
    contact_email = 'hello@example.invalid',
    contact_phone = '+12125550100',
    address = '10 Test Street',
    city = 'Brooklyn',
    country_code = 'US',
    social_links = '{"website":"https://example.invalid"}'::jsonb,
    profile_photo_url = 'https://cdn.example.invalid/logo.png',
    cover_media_url = 'https://cdn.example.invalid/cover.jpg',
    cover_media_type = 'image',
    theme_color = '#EA7825',
    theme_font = 'inter',
    theme_animation = 'none'
  WHERE id = p_brand_id;

  INSERT INTO public.brand_site_plans(
    brand_id,
    revision,
    offerings_selected,
    design_key,
    story,
    approved_plan,
    approved_at,
    approved_by,
    started_by,
    updated_by
  ) VALUES (
    p_brand_id,
    0,
    ARRAY[]::text[],
    'atelier',
    '{"who":"Test guests","why":"Owner-provided test value","main_action":"Contact the brand"}'::jsonb,
    '{"for":"Test guests","main_action":"Contact the brand","look":"Atelier","pages":"Home · About · Contact","wont_do":"Invent claims"}'::jsonb,
    now(),
    p_actor,
    p_actor,
    p_actor
  ) ON CONFLICT (brand_id) DO UPDATE SET
    offerings_selected = EXCLUDED.offerings_selected,
    design_key = EXCLUDED.design_key,
    story = EXCLUDED.story,
    approved_plan = EXCLUDED.approved_plan,
    approved_at = EXCLUDED.approved_at,
    approved_by = EXCLUDED.approved_by,
    lock_holder = NULL,
    lock_expires_at = NULL,
    updated_at = now(),
    updated_by = EXCLUDED.updated_by;
END;
$fixture$;
