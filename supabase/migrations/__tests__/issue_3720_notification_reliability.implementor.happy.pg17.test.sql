-- #3720 — Community/support notification reliability (PostgreSQL 17).
-- Transaction-contained; rolls back. Never run on production.
\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temporary table t3720n_results (
  name text primary key,
  ok boolean not null,
  detail text
);
grant select, insert, update on t3720n_results to authenticated;

create temporary table t3720n_ids (
  key text primary key,
  id uuid not null
);
grant select, insert, update on t3720n_ids to authenticated;

create or replace function pg_temp.ok(
  p_name text,
  p_ok boolean,
  p_detail text default null
)
returns void language plpgsql as $$
begin
  insert into t3720n_results(name, ok, detail)
  values (p_name, p_ok, p_detail)
  on conflict (name) do update
    set ok = excluded.ok, detail = excluded.detail;
end;
$$;

insert into auth.users (id, email, email_confirmed_at)
values
  ('a3720000-0000-4000-8000-000000000101', 'admin3720n@example.com', now()),
  ('b3720000-0000-4000-8000-000000000102', 'host1-3720n@example.com', now()),
  ('c3720000-0000-4000-8000-000000000103', 'host2-3720n@example.com', now()),
  ('d3720000-0000-4000-8000-000000000104', 'removed-3720n@example.com', now()),
  ('e3720000-0000-4000-8000-000000000105', 'offline-staff-3720n@example.com', now()),
  ('f3720000-0000-4000-8000-000000000106', 'online-staff-3720n@example.com', now()),
  ('13720000-0000-4000-8000-000000000107', 'disabled-staff-3720n@example.com', now()),
  ('23720000-0000-4000-8000-000000000108', 'requester-3720n@example.com', now())
on conflict (id) do update
set email = excluded.email, email_confirmed_at = now();

insert into public.profiles (id, username)
values
  ('a3720000-0000-4000-8000-000000000101', 'admin3720n'),
  ('b3720000-0000-4000-8000-000000000102', 'host1_3720n'),
  ('c3720000-0000-4000-8000-000000000103', 'host2_3720n'),
  ('d3720000-0000-4000-8000-000000000104', 'removed_3720n'),
  ('e3720000-0000-4000-8000-000000000105', 'offline_staff_3720n'),
  ('f3720000-0000-4000-8000-000000000106', 'online_staff_3720n'),
  ('13720000-0000-4000-8000-000000000107', 'disabled_staff_3720n'),
  ('23720000-0000-4000-8000-000000000108', 'requester_3720n')
on conflict (id) do nothing;

insert into public.admin_users (email, role, status)
values ('admin3720n@example.com', 'admin', 'active')
on conflict (email) do update set role = 'admin', status = 'active';

insert into public.creator_accounts (id, created_at)
values ('a3720000-0000-4000-8000-000000000101', now())
on conflict (id) do nothing;

insert into public.brands (id, account_id, name, slug, created_at, updated_at)
values
  (
    '33720000-0000-4000-8000-000000000111',
    'a3720000-0000-4000-8000-000000000101',
    'Issue 3720 Reliability One', 'issue3720-reliability-one', now(), now()
  ),
  (
    '33720000-0000-4000-8000-000000000112',
    'a3720000-0000-4000-8000-000000000101',
    'Issue 3720 Reliability Two', 'issue3720-reliability-two', now(), now()
  )
on conflict (id) do nothing;

insert into public.brand_team_members
  (brand_id, user_id, role, accepted_at, invited_at, removed_at)
values
  (
    '33720000-0000-4000-8000-000000000111',
    'b3720000-0000-4000-8000-000000000102',
    'brand_owner', now(), now(), null
  ),
  (
    '33720000-0000-4000-8000-000000000112',
    'b3720000-0000-4000-8000-000000000102',
    'brand_owner', now(), now(), null
  ),
  (
    '33720000-0000-4000-8000-000000000111',
    'c3720000-0000-4000-8000-000000000103',
    'brand_owner', now(), now(), null
  ),
  (
    '33720000-0000-4000-8000-000000000111',
    'd3720000-0000-4000-8000-000000000104',
    'brand_owner', now(), now(), now()
  )
on conflict do nothing;

-- [TEST-MOD-APPROVED #3988] Support alerts reach staff who are on the team;
-- the support fixtures are current Sales and marketing teammates.
insert into public.admin_team_members (email, role, status, accepted_at)
values
  ('offline-staff-3720n@example.com', 'growth', 'active', now()),
  ('online-staff-3720n@example.com', 'growth', 'active', now()),
  ('disabled-staff-3720n@example.com', 'growth', 'active', now()),
  ('requester-3720n@example.com', 'growth', 'active', now())
on conflict do nothing;

insert into public.support_staff (user_id, enabled, available, role)
values
  ('e3720000-0000-4000-8000-000000000105', true, false, 'staff'),
  ('f3720000-0000-4000-8000-000000000106', true, true, 'staff'),
  ('13720000-0000-4000-8000-000000000107', false, true, 'staff'),
  ('23720000-0000-4000-8000-000000000108', true, false, 'staff')
on conflict (user_id) do update
set enabled = excluded.enabled, available = excluded.available, role = excluded.role;

select pg_temp.ok(
  'categories_namespaced',
  (
    select count(*) = 3
    from public.notification_categories
    where key in (
      'business.community_announcement',
      'business.community_roadmap_updated',
      'business.support_new_ticket'
    ) and active = true
  )
);

select pg_temp.ok(
  'support_channels_complete',
  exists (
    select 1 from public.notification_categories
    where key = 'business.support_new_ticket'
      and default_channels @> array['inapp', 'push', 'email']::text[]
  )
);

-- A published announcement that predates this feature is not replayed merely
-- because the reliability migration exists.
insert into public.community_announcements (
  id, title, body_md, status, author_user_id, published_at
) values (
  '43720000-0000-4000-8000-000000000121',
  'Historical announcement', 'Already live', 'published',
  'a3720000-0000-4000-8000-000000000101', now() - interval '1 day'
);

select pg_temp.ok(
  'no_historical_replay',
  not exists (
    select 1 from public.notification_outbox
    where payload->>'announcement_id' = '43720000-0000-4000-8000-000000000121'
  )
);

select set_config(
  'request.jwt.claim.sub',
  'a3720000-0000-4000-8000-000000000101',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $admin$
declare
  v_announcement uuid;
  v_publish jsonb;
  v_announcement_status jsonb;
  v_card_one uuid;
  v_card_two uuid;
  v_preview jsonb;
  v_campaign jsonb;
  v_retry jsonb;
  v_before integer;
  v_after integer;
  v_all uuid[];
begin
  v_announcement := public.community_upsert_announcement(
    null, 'Reliable announcement', '### Clean **content**'
  );
  v_publish := public.community_publish_announcement(v_announcement);
  insert into t3720n_ids(key, id)
  values ('announcement', v_announcement);

  perform pg_temp.ok(
    'announcement_audience_deduped',
    (v_publish->>'audience_count')::integer = 3,
    v_publish::text
  );
  v_announcement_status := public.community_get_announcement_notification_status(
    (v_publish->>'campaign_id')::uuid
  );
  perform pg_temp.ok(
    'announcement_campaign_reports_queued_channels_truthfully',
    v_announcement_status->>'state' = 'queued'
    and (v_announcement_status->'outbox'->>'pending')::integer = 3
    and (v_announcement_status->'channels'->>'inapp_delivered')::integer = 0,
    v_announcement_status::text
  );
  v_publish := public.community_publish_announcement(v_announcement);
  perform pg_temp.ok(
    'announcement_publish_idempotent',
    (v_publish->>'duplicate')::boolean
  );

  select count(*) into v_before
  from public.notification_outbox
  where category_key = 'business.community_roadmap_updated';

  v_card_one := public.community_upsert_roadmap_card(
    null, 'Now item', 'Now body', 'internal one', 'now', 'published'
  );
  v_card_two := public.community_upsert_roadmap_card(
    null, 'Next item', 'Next body', 'internal two', 'next', 'published'
  );
  perform public.community_upsert_roadmap_card(
    v_card_two, 'Next item edited', 'Next body edited', 'internal two',
    'next', 'published'
  );
  select array_agg(id order by sort_order, id) into v_all
  from public.community_roadmap_cards;
  perform public.community_reorder_roadmap(v_all);

  select count(*) into v_after
  from public.notification_outbox
  where category_key = 'business.community_roadmap_updated';
  perform pg_temp.ok('roadmap_mutations_are_silent', v_after = v_before);

  v_preview := public.community_roadmap_notification_preview();
  perform pg_temp.ok(
    'roadmap_preview_dedupes_hosts',
    (v_preview->>'audience_count')::integer = 3,
    v_preview::text
  );

  v_campaign := public.community_notify_roadmap_change(
    '53720000-0000-4000-8000-000000000131'
  );
  insert into t3720n_ids(key, id)
  values ('first_roadmap_campaign', (v_campaign->>'campaign_id')::uuid);
  perform pg_temp.ok(
    'roadmap_one_campaign_for_many_edits',
    (v_campaign->>'audience_count')::integer = 3,
    v_campaign::text
  );

  v_retry := public.community_notify_roadmap_change(
    '53720000-0000-4000-8000-000000000131'
  );
  perform pg_temp.ok(
    'roadmap_retry_is_same_campaign',
    (v_retry->>'duplicate')::boolean = true
    and v_retry->>'campaign_id' = v_campaign->>'campaign_id'
  );
end;
$admin$;

reset role;

do $first_snapshot_assertions$
declare
  v_announcement uuid;
  v_campaign uuid;
begin
  select id into v_announcement from t3720n_ids where key = 'announcement';
  select id into v_campaign from t3720n_ids where key = 'first_roadmap_campaign';
  perform pg_temp.ok(
    'announcement_one_outbox_per_host',
    (
      select count(*) = 3 and count(distinct user_id) = 3
      from public.notification_outbox
      where category_key = 'business.community_announcement'
        and payload->>'announcement_id' = v_announcement::text
    )
  );
  perform pg_temp.ok(
    'announcement_exact_destination',
    not exists (
      select 1 from public.notification_outbox
      where category_key = 'business.community_announcement'
        and payload->>'announcement_id' = v_announcement::text
        and (
          payload->>'deep_link' <>
            'mingla-business://community/announcement/' || v_announcement::text
          or country_code is not null
        )
    )
  );
  perform pg_temp.ok(
    'roadmap_copy_and_destination_exact',
    not exists (
      select 1 from public.notification_outbox
      where payload->>'campaign_id' = v_campaign::text
        and (
          payload->>'title' <> 'Mingla roadmap updated'
          or payload->>'body' <> 'See what’s new in Now, Next and Later.'
          or payload->>'deep_link' <> 'mingla-business://community/roadmap'
          or payload ? 'internal_note'
          or country_code is not null
        )
    )
  );
end;
$first_snapshot_assertions$;

-- Recipient rows are the immutable first-campaign snapshot. A later deliberate
-- request key resolves the then-current audience and creates a new campaign.
update public.community_notification_campaigns
set created_at = now() - interval '2 minutes'
where kind = 'roadmap_update'
  and request_key = '53720000-0000-4000-8000-000000000131';

update public.brand_team_members
set removed_at = now()
where user_id = 'c3720000-0000-4000-8000-000000000103'
  and brand_id = '33720000-0000-4000-8000-000000000111';

select set_config(
  'request.jwt.claim.sub',
  'a3720000-0000-4000-8000-000000000101',
  true
);
set local role authenticated;

do $new_campaign$
declare
  v_first uuid;
  v_second jsonb;
begin
  select id into v_first
  from public.community_notification_campaigns
  where request_key = '53720000-0000-4000-8000-000000000131';
  v_second := public.community_notify_roadmap_change(
    '53720000-0000-4000-8000-000000000132'
  );
  perform pg_temp.ok(
    'new_request_key_creates_new_snapshot',
    (v_second->>'campaign_id')::uuid <> v_first
    and (v_second->>'audience_count')::integer = 2,
    v_second::text
  );
end;
$new_campaign$;

reset role;

-- An enabled rep receives the operational event even while unavailable.
select set_config(
  'request.jwt.claim.sub',
  '23720000-0000-4000-8000-000000000108',
  true
);
set local role authenticated;

do $requester$
declare
  v_ticket uuid;
begin
  v_ticket := public.create_support_ticket('Need help with a booking', null);
  insert into t3720n_ids(key, id) values ('support_ticket', v_ticket);
end;
$requester$;

reset role;

do $support_assertions$
declare
  v_ticket uuid;
begin
  select id into v_ticket from t3720n_ids where key = 'support_ticket';
  perform pg_temp.ok(
    'support_all_enabled_regardless_availability',
    (
      select count(*) = 3
        and bool_or(user_id = 'e3720000-0000-4000-8000-000000000105')
        and bool_or(user_id = 'f3720000-0000-4000-8000-000000000106')
      from public.notification_outbox
      where category_key = 'business.support_new_ticket'
        and payload->>'ticket_id' = v_ticket::text
    )
  );
  perform pg_temp.ok(
    'support_requester_included_when_enabled',
    exists (
      select 1 from public.notification_outbox
      where category_key = 'business.support_new_ticket'
        and payload->>'ticket_id' = v_ticket::text
        and user_id = '23720000-0000-4000-8000-000000000108'
    )
  );
  perform pg_temp.ok(
    'support_disabled_excluded',
    not exists (
      select 1 from public.notification_outbox
      where category_key = 'business.support_new_ticket'
        and payload->>'ticket_id' = v_ticket::text
        and user_id = '13720000-0000-4000-8000-000000000107'
    )
  );
  perform pg_temp.ok(
    'support_exact_destination',
    not exists (
      select 1 from public.notification_outbox
      where category_key = 'business.support_new_ticket'
        and payload->>'ticket_id' = v_ticket::text
        and (
          payload->>'deep_link' <> 'mingla-business://support/' || v_ticket::text
          or country_code is not null
        )
    )
  );
end;
$support_assertions$;

-- Host preference writes and campaign privacy stay user-safe.
select set_config(
  'request.jwt.claim.sub',
  'b3720000-0000-4000-8000-000000000102',
  true
);
set local role authenticated;

do $host$
declare
  v_forbidden boolean := false;
begin
  perform public.community_set_email_pref(false);
  perform pg_temp.ok(
    'announcement_pref_namespaced',
    exists (
      select 1 from public.notification_channel_prefs
      where user_id = auth.uid()
        and category_key = 'business.community_announcement'
        and channel = 'email' and enabled = false
    )
  );
  perform pg_temp.ok(
    'campaign_rows_hidden_from_hosts',
    (select count(*) = 0 from public.community_notification_campaigns)
  );
  begin
    perform public.community_notify_roadmap_change(gen_random_uuid());
  exception when others then
    v_forbidden := sqlstate = '42501' or sqlerrm ilike '%not_authorized%';
  end;
  perform pg_temp.ok('host_cannot_notify_roadmap', v_forbidden);
end;
$host$;

reset role;

do $policy_reason_assertions$
begin
  perform pg_temp.ok(
    'announcement_email_pref_reason_truthful',
    public.issue_3720_notification_denial_reason(
      'b3720000-0000-4000-8000-000000000102',
      'business.community_announcement',
      'email',
      'host1-3720n@example.com'
    ) = 'preference_off'
  );

  insert into public.channel_suppressions(
    user_id, channel, scope, reason
  ) values (
    'f3720000-0000-4000-8000-000000000106',
    'email', 'transactional', 'bounce'
  ) on conflict do nothing;
  perform pg_temp.ok(
    'support_hard_bounce_reason_truthful',
    public.issue_3720_notification_denial_reason(
      'f3720000-0000-4000-8000-000000000106',
      'business.support_new_ticket',
      'email',
      'online-staff-3720n@example.com'
    ) = 'hard_bounce'
  );
end;
$policy_reason_assertions$;

do $seed_bell_read$
declare
  v_announcement uuid;
begin
  select id into v_announcement from t3720n_ids where key = 'announcement';
  insert into public.notifications(
    id, user_id, type, title, body, data, idempotency_key
  ) values (
    '73720000-0000-4000-8000-000000000151',
    'b3720000-0000-4000-8000-000000000102',
    'business.community_announcement',
    'Reliable announcement', 'Clean content',
    jsonb_build_object('announcement_id', v_announcement),
    'issue-3720-bell-read-probe'
  );
end;
$seed_bell_read$;

select set_config(
  'request.jwt.claim.sub',
  'b3720000-0000-4000-8000-000000000102',
  true
);
set local role authenticated;

update public.notifications
set read_at = now(), is_read = true
where id = '73720000-0000-4000-8000-000000000151';

reset role;

select pg_temp.ok(
  'bell_read_reconciles_announcement_receipt',
  exists (
    select 1
    from public.community_read_receipts r
    join t3720n_ids i on i.key = 'announcement'
    where r.user_id = 'b3720000-0000-4000-8000-000000000102'
      and r.announcement_id = i.id
  )
);

-- Failed provider attempts are reclaimed in place (the global
-- notification/channel unique index remains authoritative), while sent is
-- terminal and cannot be duplicated.
do $delivery$
declare
  v_notification uuid := '63720000-0000-4000-8000-000000000141';
  v_first jsonb;
  v_retry jsonb;
  v_terminal jsonb;
begin
  insert into public.notifications (
    id, user_id, type, title, body, data, idempotency_key
  ) values (
    v_notification,
    'b3720000-0000-4000-8000-000000000102',
    'business.community_roadmap_updated',
    'Mingla roadmap updated',
    'See what’s new in Now, Next and Later.',
    '{}'::jsonb,
    'issue-3720-ledger-probe'
  );

  v_first := public.issue_3720_claim_notification_channel(v_notification, 'push');
  perform public.issue_3720_complete_notification_channel(
    (v_first->>'deliveryId')::uuid, 'failed', 'onesignal', null,
    'provider_unavailable', null
  );
  v_retry := public.issue_3720_claim_notification_channel(v_notification, 'push');
  perform public.issue_3720_complete_notification_channel(
    (v_retry->>'deliveryId')::uuid, 'sent', 'onesignal', 'provider-3720', null, null
  );
  v_terminal := public.issue_3720_claim_notification_channel(v_notification, 'push');

  perform pg_temp.ok(
    'failed_channel_retries_same_ledger_row',
    v_first->>'deliveryId' = v_retry->>'deliveryId'
    and (
      select count(*) = 1 from public.notification_deliveries
      where notification_id = v_notification and channel = 'push'
    )
  );
  perform pg_temp.ok(
    'sent_channel_is_terminal',
    v_terminal->>'outcome' = 'terminal'
    and v_terminal->>'status' = 'sent'
    and v_terminal->>'providerMessageId' = 'provider-3720'
  );
end;
$delivery$;

do $verdict$
declare
  v_fail text;
  v_count integer;
begin
  select count(*) into v_count from t3720n_results;
  if v_count < 26 then
    raise exception 'too few #3720 notification checks: %', v_count;
  end if;
  select string_agg(name || ': ' || coalesce(detail, 'fail'), E'\n' order by name)
  into v_fail
  from t3720n_results
  where not ok;
  if v_fail is not null then
    raise exception E'#3720 notification reliability failures:\n%', v_fail;
  end if;
  raise notice '#3720 notification reliability: % checks PASS', v_count;
end;
$verdict$;

rollback;
