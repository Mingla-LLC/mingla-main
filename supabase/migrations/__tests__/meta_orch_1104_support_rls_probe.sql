-- META-ORCH-1104 Phase 0 — live RLS / restrictive-policy probe (SPEC §2.7 VERIFY,
-- T-0.2 / T-0.3 / T-0.4 / T-0.7 / SC-0.6).
--
-- Run AFTER the feature migration is applied (read-only; SELECT/EXPLAIN only).
-- These are the live-DB adversarial assertions the static migration test cannot
-- exercise. Operator/tester runs them via the Management API execute_sql or
-- `supabase db` read path. Each row should report the expected boolean.

-- (A) RESTRICTIVE messages_broadcast_only_enforcement passes a 'support' insert.
--     can_insert_message_into_conversation returns TRUE for support convs because
--     linked_entity_type='support' takes the (<> ALL(trip,event)) branch.
--     Expected: support_insert_allowed = true.
WITH support_conv AS (
  SELECT id FROM public.conversations WHERE linked_entity_type = 'support' LIMIT 1
)
SELECT
  EXISTS (SELECT 1 FROM support_conv) AS has_support_conv,
  COALESCE(
    (SELECT public.can_insert_message_into_conversation(sc.id, c.created_by)
     FROM support_conv sc JOIN public.conversations c ON c.id = sc.id),
    true
  ) AS support_insert_allowed;

-- (B) The 4 support chat policies are scoped to linked_entity_type='support'.
--     Expected: every row's qual contains 'support'.
SELECT polname,
       pg_get_expr(polqual, polrelid) ILIKE '%''support''%'
         OR pg_get_expr(polwithcheck, polrelid) ILIKE '%''support''%' AS is_support_scoped
FROM pg_policy
WHERE polname IN (
  'conversations_support_staff_read',
  'messages_support_staff_read',
  'messages_support_staff_insert',
  'conversation_presence_support_staff_read'
)
ORDER BY polname;

-- (C) support_staff INSERT is admin-only (T-0.3). Expected: with_check mentions
--     is_admin_user and NOT auth.uid()=user_id self-write.
SELECT polname, polcmd, pg_get_expr(polwithcheck, polrelid) AS with_check
FROM pg_policy
WHERE polrelid = 'public.support_staff'::regclass AND polcmd = 'a';  -- 'a' = INSERT

-- (D) claim_support_ticket is NOT executable by anon/authenticated (T-0.6).
--     Expected: both false.
SELECT
  has_function_privilege('anon', 'public.claim_support_ticket(uuid,uuid)', 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', 'public.claim_support_ticket(uuid,uuid)', 'EXECUTE') AS authenticated_can_execute;

-- (E) Segment counts match SPEC SC-0.3 (admin=1, business=13, explorer=rest @ build time).
SELECT segment, count(*) FROM public.profiles_with_segment GROUP BY segment ORDER BY 2 DESC;

-- (F) is_admin reversibility (SC-0.5): column still present + backup populated.
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='profiles' AND column_name='is_admin') AS is_admin_still_present,
  (SELECT count(*) FROM public._deprecated_profiles_is_admin_backup) AS backup_row_count;
