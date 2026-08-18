-- #2107: The server owns whether a JavaScript (OTA) update may be ignored.
--
-- Deliberately a SEPARATE table from #2075's app_version_policies, keyed by
-- runtime_version as well as app + platform. An OTA only ever reaches the
-- runtime it was built for, so "is this update required" is a per-runtime
-- question; the native minimum is not.
--
-- ABSENT ROW MEANS 'silent'. A runtime nobody has rowed behaves exactly as it
-- does today, which is also how a runtime that cannot accept the bootstrap OTA
-- is recorded as store-update-only: it simply never gets a row, and #2075's
-- native minimum handles it.
create table public.app_ota_policies (
  app_id text not null check (app_id in ('explorer', 'business')),
  platform text not null check (platform in ('ios', 'android')),
  runtime_version text not null check (
    runtime_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
  ),
  -- silent        — today's dismissible banner, nothing is blocked.
  -- acknowledge   — blocking layer until the user taps once; the app is then
  --                 released and the update applies on the next cold launch.
  -- force_restart — EMERGENCY ONLY. Blocking layer that downloads and reloads.
  --                 Built dormant per the #2107 operator decision so the lever
  --                 exists before the emergency rather than being written
  --                 during one.
  mode text not null default 'silent' check (
    mode in ('silent', 'acknowledge', 'force_restart')
  ),
  message text not null default 'A required update is ready. Tap to download it.',
  updated_at timestamptz not null default now(),
  primary key (app_id, platform, runtime_version)
);

alter table public.app_ota_policies enable row level security;
revoke all on public.app_ota_policies from public, anon, authenticated;
grant select, insert, update, delete on public.app_ota_policies to service_role;

create trigger app_ota_policies_set_updated_at
before update on public.app_ota_policies
for each row execute function public.update_updated_at_column();

-- NO SEED ROWS ON PURPOSE. Enforcement stays off until every live runtime has
-- received the bootstrap OTA carrying the gate; the rollout inserts rows only
-- after each lane's served manifest has been verified on a real install.
