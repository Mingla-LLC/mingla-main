-- ISSUE-865 WP-A — TESTER adversarial SQL suite.
--
-- DIFFERENT ANGLE than the implementor's suite (issue_865_attribution_conversion
-- _schema.test.sql), which covers UNIQUE(event_id)/RLS/privacy but NOT referential
-- integrity or value/enum boundaries. This suite attacks:
--   A-1  a conversion referencing a NON-EXISTENT campaign_id is REJECTED (FK 23503).
--   A-2  ON DELETE SET NULL — deleting the parent ad_campaigns row must PRESERVE the
--        revenue-relevant conversion row (campaign_id nulled, row survives). This is
--        the fails-on-revert anchor at a DIFFERENT line than the implementor's
--        UNIQUE(event_id): change ad_conversions.campaign_id FK to ON DELETE CASCADE
--        and the conversion row is deleted with its campaign → A-2 fails.
--   A-3  value_cents CHECK — a negative value is rejected (23514).
--   A-4  unknown platform enum is rejected (23514).
--
-- Runs LOCAL Postgres only (raw-Docker per COMMS-0102), in ONE rollback txn.
-- Requires the real ad-engine foundation (20261230000000) + the #865 migration
-- applied, plus FK-target rows (events/orders/ad_connections/ad_campaigns).
\set ON_ERROR_STOP on
begin;
set local role service_role;

-- parent fixtures
insert into public.ad_connections (id, platform, lane, display_name, external_account_id, auth_kind, token_env_var)
  values ('33333333-3333-3333-3333-333333333333','meta','consumer','QA','a1','system_user_token','META_TOKEN');
insert into public.ad_campaigns (id, connection_id, platform, external_campaign_id, name, objective,
       dest_page_type, dest_brand_slug, dest_url, dest_smart_link)
  values ('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333','meta','ext-1','QA',
          'OUTCOME_TRAFFIC','event','brandx','https://x/e','https://onelink/x');

-- A-1 · non-existent campaign_id rejected
do $$
begin
  begin
    insert into public.ad_conversions (event_id,event_type,event_name,surface,campaign_id)
      values ('ADV-FK-BAD','purchase','Purchase','web','99999999-9999-9999-9999-999999999999');
    raise exception 'A-1 FAIL: conversion with a non-existent campaign_id was ACCEPTED';
  exception
    when foreign_key_violation then null;  -- expected 23503
  end;
end $$;

-- A-2 · ON DELETE SET NULL preserves the conversion (fails-on-revert anchor)
insert into public.ad_conversions (event_id,event_type,event_name,surface,value_cents,campaign_id)
  values ('ADV-FK-GOOD','purchase','Purchase','web',1000,'44444444-4444-4444-4444-444444444444');
delete from public.ad_campaigns where id='44444444-4444-4444-4444-444444444444';
do $$
declare n int; c uuid; v int;
begin
  select count(*) into n from public.ad_conversions where event_id='ADV-FK-GOOD';
  if n <> 1 then
    raise exception 'A-2 FAIL: conversion row did NOT survive parent-campaign delete (got % rows) — FK must be ON DELETE SET NULL, not CASCADE', n;
  end if;
  select campaign_id, value_cents into c, v from public.ad_conversions where event_id='ADV-FK-GOOD';
  if c is not null then
    raise exception 'A-2 FAIL: campaign_id was not nulled on parent delete';
  end if;
  if v <> 1000 then
    raise exception 'A-2 FAIL: revenue value_cents was not preserved (got %)', v;
  end if;
end $$;

-- A-3 · negative value_cents rejected
do $$
begin
  begin
    insert into public.ad_conversions (event_id,event_type,event_name,surface,value_cents)
      values ('ADV-VNEG','purchase','Purchase','web',-1);
    raise exception 'A-3 FAIL: negative value_cents was ACCEPTED';
  exception
    when check_violation then null;  -- expected 23514
  end;
end $$;

-- A-4 · unknown platform enum rejected
do $$
begin
  begin
    insert into public.ad_conversions (event_id,event_type,event_name,surface,platform)
      values ('ADV-PLAT','purchase','Purchase','web','linkedin');
    raise exception 'A-4 FAIL: unknown platform "linkedin" was ACCEPTED';
  exception
    when check_violation then null;  -- expected 23514
  end;
end $$;

rollback;
\echo 'ISSUE-865 WP-A tester adversarial FK/boundary suite: A-1..A-4 PASS'
