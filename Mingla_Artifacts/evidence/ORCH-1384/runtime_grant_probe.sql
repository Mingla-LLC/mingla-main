-- ORCH-1384 TEST — runtime effective-privilege probe (READ-ONLY).
-- P0 evidence: the reissue RPC's intended service_role-ONLY grant (SPEC §4.4 RPC-3,
-- §7 A-6) is NOT enforced at runtime because Supabase default ACL grants per-ROLE
-- EXECUTE on function CREATE and `REVOKE ALL ... FROM PUBLIC` does not strip a role
-- grant (identical root cause to ORCH-1338 P2-1).
SELECT
  has_function_privilege('anon',          'public.partner_reissue_brand_invitation(uuid,uuid,text,text,timestamptz)','EXECUTE') AS anon_can_reissue,       -- expect FALSE; ACTUAL true (P0)
  has_function_privilege('authenticated', 'public.partner_reissue_brand_invitation(uuid,uuid,text,text,timestamptz)','EXECUTE') AS authenticated_can_reissue,-- expect FALSE; ACTUAL true (P0)
  has_function_privilege('service_role',  'public.partner_reissue_brand_invitation(uuid,uuid,text,text,timestamptz)','EXECUTE') AS service_can_reissue,       -- expect TRUE
  has_function_privilege('anon',          'public.partner_cancel_pending_link(uuid)','EXECUTE') AS anon_can_cancel,      -- P3: body fail-closes on auth.uid() NULL
  has_function_privilege('anon',          'public.partner_disconnect_link(uuid)','EXECUTE') AS anon_can_disconnect;      -- P3: body fail-closes on auth.uid() NULL
-- ACTUAL RESULT 2026-07-17 (prod gqnoajqerqhnvulmnyvv):
-- anon_can_reissue=true  authenticated_can_reissue=true  service_can_reissue=true  anon_can_cancel=true  anon_can_disconnect=true
