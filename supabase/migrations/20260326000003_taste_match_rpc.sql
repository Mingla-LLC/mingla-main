CREATE OR REPLACE FUNCTION public.jaccard(a TEXT[], b TEXT[])
RETURNS FLOAT AS $$
DECLARE
  v_intersection INT;
  v_union INT;
BEGIN
  IF (a IS NULL OR array_length(a, 1) IS NULL) AND (b IS NULL OR array_length(b, 1) IS NULL) THEN
    RETURN 0;
  END IF;
  SELECT COUNT(*) INTO v_intersection
    FROM (SELECT unnest(COALESCE(a, '{}')) INTERSECT SELECT unnest(COALESCE(b, '{}'))) x;
  SELECT COUNT(*) INTO v_union
    FROM (SELECT unnest(COALESCE(a, '{}')) UNION SELECT unnest(COALESCE(b, '{}'))) x;
  IF v_union = 0 THEN RETURN 0; END IF;
  RETURN v_intersection::FLOAT / v_union;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.compute_taste_match(p_user_a UUID, p_user_b UUID)
RETURNS TABLE (
  match_percentage INTEGER,
  shared_categories TEXT[],
  shared_tiers TEXT[],
  shared_intents TEXT[]
) AS $$
DECLARE
  v_a_cats TEXT[]; v_b_cats TEXT[];
  v_a_tiers TEXT[]; v_b_tiers TEXT[];
  v_a_intents TEXT[]; v_b_intents TEXT[];
  v_score FLOAT;
BEGIN
  SELECT categories, price_tiers, intents INTO v_a_cats, v_a_tiers, v_a_intents
    FROM preferences WHERE user_id = p_user_a;
  SELECT categories, price_tiers, intents INTO v_b_cats, v_b_tiers, v_b_intents
    FROM preferences WHERE user_id = p_user_b;

  v_score := (
    jaccard(v_a_cats, v_b_cats) * 0.5 +
    jaccard(v_a_tiers, v_b_tiers) * 0.3 +
    jaccard(v_a_intents, v_b_intents) * 0.2
  ) * 100;

  RETURN QUERY SELECT
    ROUND(v_score)::INTEGER,
    ARRAY(SELECT unnest(v_a_cats) INTERSECT SELECT unnest(v_b_cats)),
    ARRAY(SELECT unnest(v_a_tiers) INTERSECT SELECT unnest(v_b_tiers)),
    ARRAY(SELECT unnest(v_a_intents) INTERSECT SELECT unnest(v_b_intents));
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
