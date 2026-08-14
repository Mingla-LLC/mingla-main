-- #2075: The server is the only owner of native minimum-version policy.
create table public.app_version_policies (
  app_id text not null check (app_id in ('explorer', 'business')),
  platform text not null check (platform in ('ios', 'android')),
  minimum_version text not null check (minimum_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  store_url text not null check (store_url ~ '^https://'),
  enforcement_mode text not null default 'observe' check (enforcement_mode in ('observe', 'enforce')),
  message text not null default 'Update Mingla to keep using the app.',
  updated_at timestamptz not null default now(),
  primary key (app_id, platform)
);

alter table public.app_version_policies enable row level security;
revoke all on public.app_version_policies from public, anon, authenticated;
grant select, insert, update, delete on public.app_version_policies to service_role;

insert into public.app_version_policies (app_id, platform, minimum_version, store_url) values
  ('explorer', 'ios', '1.1.4', 'https://apps.apple.com/app/id6760440898'),
  ('explorer', 'android', '1.1.4', 'https://play.google.com/store/apps/details?id=com.mingla.app.v2'),
  ('business', 'ios', '1.1.4', 'https://apps.apple.com/app/id6768737367'),
  ('business', 'android', '1.1.4', 'https://play.google.com/store/apps/details?id=com.sethogieva.minglabusiness');
