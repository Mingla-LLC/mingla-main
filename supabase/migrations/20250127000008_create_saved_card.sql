create extension if not exists "uuid-ossp";

create table if not exists saved_card (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references profiles(id) on delete cascade,
  experience_id text not null,
  title text,
  category text,
  image_url text,
  match_score numeric,
  card_data jsonb not null,
  created_at timestamptz not null default now()
);

create unique index if not exists saved_card_profile_experience_idx
  on saved_card(profile_id, experience_id);

alter table saved_card enable row level security;

create policy "Users can manage their saved cards"
  on saved_card
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);
