-- ISSUE-1354 [Admin: see all free-tool submissions] — tool_leads admin read-RPCs.
--
-- Two guard-first, STABLE SECURITY DEFINER read-RPCs behind a new admin "Tool
-- Leads" console. The 4 marketing free tools funnel every submission into
-- public.tool_leads (service-role write, RLS deny-all). Nothing listed them and
-- no one was notified. This migration adds ONLY the read surface (the founder-
-- notify hook lives in growth-tools-gate; no table/column/RLS/index change here).
--
--   admin_tool_leads_list(p_tool, p_has_email, p_search, p_limit, p_offset)
--     — light rows, newest first, + a window total_count for pagination. NEVER
--       returns report / report_token / ip_hash (PII/full-report stay server-side
--       until the detail RPC is asked for one row).
--   admin_tool_lead_get(p_id)
--     — full detail for the modal: input + report + report_token. NEVER ip_hash.
--
-- SECURITY (SPEC §5.1 + SPEC-REVIEW amendment): the SPEC mirrored
-- admin_beta_leads_list (authenticated-EXECUTE + app-layer ALLOWED_ADMIN_EMAILS,
-- no DB-level admin guard). The approved amendment requires a DB-level admin
-- guard IF the schema already provides a standard one — it does:
-- public.is_admin_user() (used by ORCH-1201/1272/1273/1276/1278 sensitive admin
-- read RPCs). tool_leads holds PII (lead emails + business context) and this repo
-- is public, so both RPCs add the guard-FIRST is_admin_user() check for
-- defense-in-depth (mirrors admin_get_person / admin_list_offerings). Because a
-- guard needs RAISE, these are LANGUAGE plpgsql (not the SPEC's `language sql`) —
-- the ONLY deviation from §5.1, driven by the binding amendment; the return
-- column contracts + grants are exactly as specced.
--
-- Least-privilege (ORCH-1271 golden template): functions default to PUBLIC
-- EXECUTE. Each is a user-JWT admin read (the admin UI calls it via the anon key
-- + an authenticated admin JWT; the internal is_admin_user() guard is the real
-- gate). EXECUTE is revoked from public + anon, granted to authenticated ONLY. A
-- DO-block self-assert proves the lockdown at apply time. public.tool_leads keeps
-- RLS deny-all (no anon/authenticated policy) — preserves I-1045-ANON-NO-SELECT.
--
-- Idempotent: drop function if exists before each create.
--
-- Enforces (DRAFT until CLOSE): I-PROPOSED-1354-TOOL-LEADS-ADMIN-RPC-GATED,
--   I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT.

--------------------------------------------------------------------------------
-- 1. admin_tool_leads_list — light rows (no report jsonb / report_token / ip_hash)
--    + window total_count for pagination. newest first.
--------------------------------------------------------------------------------
drop function if exists public.admin_tool_leads_list(text, boolean, text, int, int);

create function public.admin_tool_leads_list(
  p_tool      text    default null,
  p_has_email boolean default null,
  p_search    text    default null,
  p_limit     int     default 100,
  p_offset    int     default 0
)
  returns table(
    id             uuid,
    tool           text,
    status         text,
    created_at     timestamptz,
    email          text,
    has_report     boolean,
    input          jsonb,
    pid            text,
    utm            jsonb,
    place_match_id uuid,
    total_count    bigint
  )
  language plpgsql
  stable
  security definer
  set search_path to 'public'
as $$
declare
  v_limit  int := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  -- (I-ADMIN-GATE-FIRST-STATEMENT) guard FIRST — DB-level admin enforcement
  -- (SPEC-REVIEW amendment), on top of the authenticated-only EXECUTE grant.
  if not public.is_admin_user() then raise exception 'not_authorized'; end if;

  return query
  select
    tl.id,
    tl.tool,
    tl.status,
    tl.created_at,
    tl.email,
    (tl.report is not null)             as has_report,
    tl.input,
    tl.pid,
    tl.utm,
    tl.place_match_id,
    count(*) over ()                    as total_count
  from public.tool_leads tl
  where (p_tool is null or tl.tool = p_tool)
    and (
      p_has_email is null
      or (p_has_email and tl.email is not null)
      or (not p_has_email and tl.email is null)
    )
    and (
      p_search is null
      or btrim(p_search) = ''
      or tl.email ilike '%' || p_search || '%'
      or tl.input->>'name' ilike '%' || p_search || '%'
      or tl.input->>'title' ilike '%' || p_search || '%'
    )
  order by tl.created_at desc
  limit v_limit offset v_offset;
end;
$$;

--------------------------------------------------------------------------------
-- 2. admin_tool_lead_get — full detail for the modal (input + report +
--    report_token). NEVER ip_hash.
--------------------------------------------------------------------------------
drop function if exists public.admin_tool_lead_get(uuid);

create function public.admin_tool_lead_get(p_id uuid)
  returns table(
    id             uuid,
    tool           text,
    status         text,
    created_at     timestamptz,
    email          text,
    input          jsonb,
    report         jsonb,
    pid            text,
    utm            jsonb,
    place_match_id uuid,
    report_token   text
  )
  language plpgsql
  stable
  security definer
  set search_path to 'public'
as $$
begin
  -- (I-ADMIN-GATE-FIRST-STATEMENT) guard FIRST.
  if not public.is_admin_user() then raise exception 'not_authorized'; end if;

  return query
  select
    tl.id,
    tl.tool,
    tl.status,
    tl.created_at,
    tl.email,
    tl.input,
    tl.report,
    tl.pid,
    tl.utm,
    tl.place_match_id,
    tl.report_token
  from public.tool_leads tl
  where tl.id = p_id;
end;
$$;

comment on function public.admin_tool_leads_list(text, boolean, text, int, int) is
  'ISSUE-1354: admin list of tool_leads (all rows, filter by tool + has-email + '
  'search). SECURITY DEFINER, search_path pinned, is_admin_user() guard FIRST + '
  'EXECUTE granted to authenticated only (app-layer ALLOWED_ADMIN_EMAILS is the '
  'UI gate). NEVER returns report / report_token / ip_hash. tool_leads stays RLS '
  'deny-all.';

comment on function public.admin_tool_lead_get(uuid) is
  'ISSUE-1354: admin detail of one tool_lead (input + report + report_token for '
  'the report modal). SECURITY DEFINER, search_path pinned, is_admin_user() guard '
  'FIRST + EXECUTE granted to authenticated only. NEVER returns ip_hash. '
  'tool_leads stays RLS deny-all.';

--------------------------------------------------------------------------------
-- 3. Least-privilege lockdown (identical posture to admin_beta_leads_list /
--    admin_get_person): revoke from public + anon, grant to authenticated only.
--------------------------------------------------------------------------------
revoke all    on function public.admin_tool_leads_list(text, boolean, text, int, int) from public;
revoke all    on function public.admin_tool_leads_list(text, boolean, text, int, int) from anon;
grant execute on function public.admin_tool_leads_list(text, boolean, text, int, int) to authenticated;

revoke all    on function public.admin_tool_lead_get(uuid) from public;
revoke all    on function public.admin_tool_lead_get(uuid) from anon;
grant execute on function public.admin_tool_lead_get(uuid) to authenticated;

--------------------------------------------------------------------------------
-- 4. Self-assert: apply FAILS unless the privilege lockdown holds (anon cannot
--    execute; authenticated can). Runtime-proves the containment at apply time.
--------------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.admin_tool_leads_list(text, boolean, text, int, int)', 'EXECUTE') then
    raise exception 'ISSUE-1354: admin_tool_leads_list still EXECUTE-able by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_tool_leads_list(text, boolean, text, int, int)', 'EXECUTE') then
    raise exception 'ISSUE-1354: authenticated lost EXECUTE on admin_tool_leads_list (admin UI would break)';
  end if;
  if has_function_privilege('anon', 'public.admin_tool_lead_get(uuid)', 'EXECUTE') then
    raise exception 'ISSUE-1354: admin_tool_lead_get still EXECUTE-able by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_tool_lead_get(uuid)', 'EXECUTE') then
    raise exception 'ISSUE-1354: authenticated lost EXECUTE on admin_tool_lead_get (admin UI would break)';
  end if;
end $$;
