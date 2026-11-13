-- #4423 Wave 3 (decision D4 = option B, D5 = 3 s): Admin bursts cannot starve
-- public traffic.
--
-- PostgREST has one pool of 30 connections for every app. On 13 Nov slow Admin
-- RPCs held them for up to 8 s each and public pages waited 30 to 280 s. A
-- function-level SET statement_timeout does not work (the statement timer
-- starts with the top-level statement, before the function's SET), so the
-- limit is set per request, BEFORE the RPC statement, by PostgREST's
-- db-pre-request hook. Proved on the local stack (PostgREST v14) before this
-- was written: the hook runs as its own statement, so a limit it sets cancels
-- the RPC that follows with 57014.
--
-- public.pgrst_pre_request():
--   For an Admin-only RPC path (/rpc/ops_*, /rpc/team_*, /rpc/admin_*,
--   /rpc/crm_*) it sets statement_timeout to 3 s for this request only
--   (set_config(..., true) is transaction-local, and PostgREST runs each
--   request in its own transaction). Every other path, public RPCs and table
--   reads included, keeps the role's own limit (anon 3 s, authenticated 8 s).
--   It reads no table: one setting read and a string match per request.
--   SECURITY INVOKER with a pinned search_path; anon, authenticated and
--   service_role can execute it because PostgREST calls it as the request role.
-- authenticator: db_pre_request points at it, and a transaction left idle is
--   closed after 30 s (there was no guard; Forensics B finding 13).
--
-- This changes a role setting that runs on EVERY PostgREST request. Seth
-- applies it on its own, outside the Wave 2 session, and watches public p95.
--
-- Rollback (then reload):
--   ALTER ROLE authenticator RESET pgrst.db_pre_request;
--   ALTER ROLE authenticator RESET idle_in_transaction_session_timeout;
--   NOTIFY pgrst, 'reload config';
--
-- Invariant I-ADMIN-RPC-3S-PRE-REQUEST is declared in
-- __tests__/issue_4423_w3_pre_request.implementor.pg17.test.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.pgrst_pre_request()
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_path text := pg_catalog.current_setting('request.path', true);
BEGIN
  IF v_path LIKE '/rpc/ops\_%' OR v_path LIKE '/rpc/team\_%'
     OR v_path LIKE '/rpc/admin\_%' OR v_path LIKE '/rpc/crm\_%' THEN
    PERFORM pg_catalog.set_config('statement_timeout', '3s', true);
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.pgrst_pre_request() IS
  '#4423 W3: PostgREST db-pre-request. Admin-only RPC paths get a 3 s statement_timeout for that request; every other path keeps the role limit. No table access.';

REVOKE ALL ON FUNCTION public.pgrst_pre_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pgrst_pre_request() TO anon, authenticated, service_role;

ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.pgrst_pre_request';
ALTER ROLE authenticator SET idle_in_transaction_session_timeout = '30s';

COMMIT;

NOTIFY pgrst, 'reload config';
