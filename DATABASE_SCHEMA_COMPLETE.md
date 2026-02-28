# Mingla Database Schema — Complete Reference

> Auto-generated from `supabase/schema.sql`, `supabase/seed.sql`, all migration files, and root SQL scripts.

---

## Table of Contents

1. [Extensions](#extensions)
2. [Enums](#enums)
3. [Tables](#tables)
   - [profiles](#1-profiles)
   - [preferences](#2-preferences)
   - [experiences](#3-experiences)
   - [saves](#4-saves)
   - [saved_card](#5-saved_card)
   - [saved_experiences](#6-saved_experiences)
   - [scheduled_activities](#7-scheduled_activities)
   - [calendar_entries](#8-calendar_entries)
   - [user_interactions](#9-user_interactions)
   - [user_location_history](#10-user_location_history)
   - [user_preference_learning](#11-user_preference_learning)
   - [user_sessions](#12-user_sessions)
   - [user_activity](#13-user_activity)
   - [friends](#14-friends)
   - [friend_requests](#15-friend_requests)
   - [blocked_users](#16-blocked_users)
   - [muted_users](#17-muted_users)
   - [user_reports](#18-user_reports)
   - [boards](#19-boards)
   - [board_cards](#20-board_cards)
   - [board_votes](#21-board_votes)
   - [board_threads](#22-board_threads)
   - [activity_history](#23-activity_history)
   - [collaboration_sessions](#24-collaboration_sessions)
   - [session_participants](#25-session_participants)
   - [collaboration_invites](#26-collaboration_invites)
   - [board_session_preferences](#27-board_session_preferences)
   - [board_saved_cards](#28-board_saved_cards)
   - [board_card_rsvps](#29-board_card_rsvps)
   - [board_messages](#30-board_messages)
   - [board_card_messages](#31-board_card_messages)
   - [board_message_reads](#32-board_message_reads)
   - [board_card_message_reads](#33-board_card_message_reads)
   - [board_participant_presence](#34-board_participant_presence)
   - [board_user_swipe_states](#35-board_user_swipe_states)
   - [board_typing_indicators](#36-board_typing_indicators)
   - [conversations](#37-conversations)
   - [conversation_participants](#38-conversation_participants)
   - [messages](#39-messages)
   - [message_reads](#40-message_reads)
   - [undo_actions](#41-undo_actions)
   - [preference_history](#42-preference_history)
   - [app_feedback](#43-app_feedback)
   - [experience_feedback](#44-experience_feedback)
   - [discover_daily_cache](#45-discover_daily_cache)
4. [RPC Functions](#rpc-functions)
5. [Triggers](#triggers)
6. [Storage Buckets](#storage-buckets)
7. [Entity Relationship Diagram (Textual)](#entity-relationship-diagram)

---

## Extensions

| Extension | Schema |
|-----------|--------|
| `uuid-ossp` | extensions |
| `pg_net` | extensions |

---

## Enums

| Enum Name | Values |
|-----------|--------|
| `report_reason` | `spam`, `inappropriate-content`, `harassment`, `other` |
| `report_status` | `pending`, `reviewed`, `resolved`, `dismissed` |

---

## Tables

### 1. `profiles`

User profile data. Auto-created on signup via `handle_new_user()` trigger.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `email` | `text` | | YES | |
| `phone` | `text` | | YES | Added for phone auth |
| `display_name` | `text` | | YES | |
| `username` | `text` | | YES | **UNIQUE** |
| `first_name` | `text` | | YES | |
| `last_name` | `text` | | YES | |
| `bio` | `text` | | YES | |
| `location` | `text` | | YES | |
| `avatar_url` | `text` | | YES | |
| `currency` | `text` | `'USD'` | YES | |
| `measurement_system` | `text` | `'metric'` | YES | |
| `share_location` | `boolean` | `true` | YES | |
| `share_budget` | `boolean` | `false` | YES | |
| `share_categories` | `boolean` | `true` | YES | |
| `share_date_time` | `boolean` | `true` | YES | |
| `coach_map_tour_status` | `text` | `NULL` | YES | CHECK: `('completed','skipped')` |
| `preferences` | `jsonb` | `'{}'` | YES | |
| `has_completed_onboarding` | `boolean` | `false` | YES | |
| `onboarding_step` | `integer` | `NULL` | YES | 0=completed, 2-10=steps |
| `email_verified` | `boolean` | `false` | YES | |
| `account_type` | `text` | | YES | explorer, curator, business, qa_manager, admin |
| `active` | `boolean` | `true` | NO | Soft-active flag |
| `visibility_mode` | `text` | `'friends'` | YES | CHECK: `('public','friends','private')` |
| `created_at` | `timestamptz` | `now()` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | |

**RLS:** Enabled
| Policy | Command | Expression |
|--------|---------|------------|
| Profiles viewable except by blocked users | SELECT | `auth.uid() = id OR NOT is_blocked_by(id, auth.uid())` |
| Users can insert own profile | INSERT | `auth.uid() = id` |
| Users can update own profile | UPDATE | `auth.uid() = id` |

**Indexes:**
- `idx_profiles_username` on `(username)`
- `idx_profiles_phone` on `(phone)` WHERE phone IS NOT NULL
- `idx_profiles_email_verified` on `(email_verified)`
- `idx_profiles_has_completed_onboarding` on `(has_completed_onboarding)`
- `idx_profiles_onboarding_step` on `(onboarding_step)`
- `idx_profiles_coach_map_tour_status` on `(coach_map_tour_status)` WHERE NOT NULL

---

### 2. `preferences`

Per-user exploration preferences; 1:1 with profiles.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `profile_id` | `uuid` | | NO | **PK**, FK → `profiles(id)` CASCADE |
| `mode` | `text` | `'explore'` | YES | |
| `budget_min` | `integer` | `0` | YES | |
| `budget_max` | `integer` | `1000` | YES | |
| `people_count` | `integer` | `1` | YES | |
| `categories` | `text[]` | `ARRAY['Stroll','Sip & Chill']` | YES | |
| `travel_mode` | `text` | `'walking'` | YES | |
| `travel_constraint_type` | `text` | `'time'` | YES | |
| `travel_constraint_value` | `integer` | `30` | YES | |
| `datetime_pref` | `timestamptz` | `now()` | YES | |
| `custom_location` | `text` | | YES | |
| `date_option` | `text` | | YES | "Now", "Today", "This Weekend", "Pick a Date" |
| `time_slot` | `text` | `NULL` | YES | "brunch", "afternoon", "dinner", "lateNight" |
| `exact_time` | `text` | `NULL` | YES | e.g. "3:30 PM" |
| `created_at` | `timestamptz` | `now()` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | Auto-updated via trigger |

**RLS:** Enabled
| Policy | Command | Expression |
|--------|---------|------------|
| Users can read own preferences | SELECT | `auth.uid() = profile_id` |
| Users can insert own preferences | INSERT | `auth.uid() = profile_id` |
| Users can update own preferences | UPDATE | `auth.uid() = profile_id` |

**Indexes:**
- `idx_preferences_date_option` on `(date_option)` WHERE NOT NULL
- `idx_preferences_time_slot` on `(time_slot)` WHERE NOT NULL
- `idx_preferences_exact_time` on `(exact_time)` WHERE NOT NULL

---

### 3. `experiences`

Catalog of places/experiences (sourced from Google Places, etc.).

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `title` | `text` | | NO | |
| `category` | `text` | | NO | |
| `place_id` | `text` | | YES | **UNIQUE** — Google Places ID |
| `lat` | `double precision` | | YES | |
| `lng` | `double precision` | | YES | |
| `price_min` | `integer` | `0` | YES | |
| `price_max` | `integer` | `0` | YES | |
| `duration_min` | `integer` | `60` | YES | |
| `image_url` | `text` | | YES | |
| `opening_hours` | `jsonb` | | YES | |
| `meta` | `jsonb` | `'{}'` | YES | |
| `created_at` | `timestamptz` | `now()` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | Auto-updated via trigger |

**RLS:** Enabled
| Policy | Command | Expression |
|--------|---------|------------|
| Anyone can read experiences | SELECT | `true` |
| Authenticated users can insert | INSERT | `auth.role() = 'authenticated'` |
| Authenticated users can update | UPDATE | `auth.role() = 'authenticated'` |

**Indexes:**
- `idx_experiences_category` on `(category)`
- `idx_experiences_place_id` on `(place_id)`
- `idx_experiences_location` on `(lat, lng)`

---

### 4. `saves`

Legacy save/like table (composite PK).

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `profile_id` | `uuid` | | NO | **PK**, FK → `profiles(id)` CASCADE |
| `experience_id` | `uuid` | | NO | **PK**, FK → `experiences(id)` CASCADE |
| `status` | `text` | `'liked'` | YES | |
| `scheduled_at` | `timestamptz` | | YES | |
| `created_at` | `timestamptz` | `now()` | YES | |

**RLS:** Enabled — own rows only (SELECT/INSERT/UPDATE/DELETE).

**Indexes:**
- `idx_saves_profile_id` on `(profile_id)`
- `idx_saves_experience_id` on `(experience_id)`

---

### 5. `saved_card`

Individual card saves per user (richer than `saves`).

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `profile_id` | `uuid` | | NO | FK → `profiles(id)` CASCADE |
| `experience_id` | `text` | | NO | |
| `title` | `text` | | YES | |
| `category` | `text` | | YES | |
| `image_url` | `text` | | YES | |
| `match_score` | `numeric` | | YES | |
| `card_data` | `jsonb` | | NO | Full card snapshot |
| `created_at` | `timestamptz` | `now()` | NO | |

**RLS:** Enabled — `auth.uid() = profile_id` for all ops.

**Indexes:**
- `saved_card_profile_experience_idx` UNIQUE on `(profile_id, experience_id)`

---

### 6. `saved_experiences`

User-saved experiences with extended metadata.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `experience_id` | `uuid` | | YES | FK → `experiences(id)` SET NULL |
| `name` | `text` | | YES | |
| `category` | `text` | | YES | |
| `place_id` | `text` | | YES | Google Places ID |
| `subtitle` | `text` | | YES | |
| `address` | `text` | | YES | |
| `one_liner` | `text` | | YES | |
| `tip` | `text` | | YES | |
| `rating` | `double precision` | | YES | |
| `review_count` | `integer` | | YES | |
| `save_type` | `text` | `'recommendation'` | YES | CHECK: `('experience','recommendation')` |
| `status` | `text` | `'saved'` | YES | CHECK: `('saved','scheduled','finalized')` |
| `created_at` | `timestamptz` | `now()` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | Auto-updated via trigger |

**RLS:** Enabled — own rows only (CRUD).

**Indexes:**
- `idx_saved_experiences_user_id` on `(user_id)`
- `idx_saved_experiences_category` on `(category)`

---

### 7. `scheduled_activities`

Activities scheduled on user's calendar.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `card_id` | `text` | `''` | NO | Google Places / card ID |
| `experience_id` | `text` | | YES | |
| `saved_experience_id` | `uuid` | | YES | FK → `saved_experiences(id)` SET NULL |
| `board_id` | `uuid` | | YES | FK → `boards(id)` SET NULL |
| `title` | `text` | `''` | NO | |
| `category` | `text` | | YES | |
| `image_url` | `text` | | YES | |
| `scheduled_date` | `timestamptz` | `now()` | NO | |
| `status` | `text` | `'scheduled'` | YES | CHECK: `('scheduled','completed','cancelled')` |
| `source` | `text` | `'user_scheduled'` | YES | CHECK: `('user_scheduled','board_finalized')` |
| `created_at` | `timestamptz` | `now()` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | Auto-updated via trigger |

**RLS:** Enabled — own rows only (CRUD).

**Indexes:**
- `idx_scheduled_activities_user_id` on `(user_id)`
- `idx_scheduled_activities_scheduled_date` on `(scheduled_date)`

---

### 8. `calendar_entries`

Cross-device scheduling entries (newer, richer model).

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `card_id` | `text` | | YES | Various ID formats |
| `board_card_id` | `uuid` | | YES | FK → board_saved_cards if from collab |
| `source` | `text` | `'solo'` | NO | CHECK: `('solo','collaboration')` |
| `card_data` | `jsonb` | `'{}'` | NO | Full card snapshot |
| `status` | `text` | `'pending'` | NO | CHECK: `('pending','confirmed','completed','cancelled')` |
| `scheduled_at` | `timestamptz` | | NO | |
| `duration_minutes` | `integer` | | YES | |
| `purchase_option_id` | `uuid` | | YES | |
| `price_paid` | `decimal(10,2)` | | YES | |
| `qr_code` | `text` | | YES | |
| `notes` | `text` | | YES | |
| `created_at` | `timestamptz` | `now()` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | |
| `archived_at` | `timestamptz` | | YES | |

**RLS:** Enabled — own rows only (CRUD).

**Indexes:**
- `idx_calendar_entries_user_id` on `(user_id)`
- `idx_calendar_entries_scheduled_at` on `(scheduled_at DESC)`

---

### 9. `user_interactions`

Tracks all user behaviour on cards/experiences.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `experience_id` | `text` | | NO | place_id/event_id/card_id |
| `interaction_type` | `text` | | NO | CHECK: view, like, dislike, save, unsave, share, schedule, unschedule, click_details, swipe_left, swipe_right, tap |
| `interaction_data` | `jsonb` | `'{}'` | YES | |
| `location_context` | `jsonb` | `'{}'` | YES | |
| `session_id` | `uuid` | | YES | |
| `recommendation_context` | `jsonb` | `'{}'` | YES | |
| `metadata` | `jsonb` | `'{}'` | YES | |
| `created_at` | `timestamptz` | `now()` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | Auto-updated via trigger |

**RLS:** Enabled — own rows only (SELECT/INSERT/UPDATE).

**Indexes:**
- `idx_user_interactions_user_id` on `(user_id)`
- `idx_user_interactions_type` on `(interaction_type)`
- `idx_user_interactions_created_at` on `(created_at)`
- `idx_user_interactions_session_id` on `(session_id)`

---

### 10. `user_location_history`

User location tracking (auto-cleaned after 30 days).

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `latitude` | `double precision` | | NO | |
| `longitude` | `double precision` | | NO | |
| `accuracy` | `double precision` | | YES | |
| `altitude` | `double precision` | | YES | |
| `heading` | `double precision` | | YES | |
| `speed` | `double precision` | | YES | |
| `location_type` | `text` | `'current'` | YES | CHECK: current, home, work, frequent, visited_place |
| `place_context` | `jsonb` | `'{}'` | YES | |
| `created_at` | `timestamptz` | `now()` | YES | |

**RLS:** Enabled — own rows only (SELECT/INSERT).

**Indexes:**
- `idx_user_location_history_user_id` on `(user_id)`
- `idx_user_location_history_created_at` on `(created_at)`
- `idx_user_location_history_type` on `(location_type)`

---

### 11. `user_preference_learning`

ML-driven preference scores per user.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `preference_type` | `text` | | NO | e.g. category, time, location, price |
| `preference_key` | `text` | | NO | e.g. restaurant, morning |
| `preference_value` | `double precision` | | NO | -1.0 to 1.0 |
| `confidence` | `double precision` | `0.5` | YES | |
| `interaction_count` | `integer` | `1` | YES | |
| `last_updated` | `timestamptz` | `now()` | YES | |
| `created_at` | `timestamptz` | `now()` | YES | |

**Constraints:** `UNIQUE(user_id, preference_type, preference_key)`

**RLS:** Enabled — own rows only (SELECT/INSERT/UPDATE).

**Indexes:**
- `idx_user_preference_learning_user_id` on `(user_id)`
- `idx_user_preference_learning_type` on `(preference_type)`
- `idx_user_preference_learning_value` on `(preference_value)`

---

### 12. `user_sessions`

Session grouping for interaction tracking.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `session_type` | `text` | `'recommendation'` | YES | CHECK: recommendation, exploration, planning, social |
| `session_context` | `jsonb` | `'{}'` | YES | |
| `started_at` | `timestamptz` | `now()` | YES | |
| `ended_at` | `timestamptz` | | YES | |
| `interaction_count` | `integer` | `0` | YES | |
| `is_active` | `boolean` | `true` | YES | |

**RLS:** Enabled — own rows only (SELECT/INSERT/UPDATE).

**Indexes:**
- `idx_user_sessions_user_id` on `(user_id)`
- `idx_user_sessions_active` on `(is_active)`

---

### 13. `user_activity`

Recent activity feed for user profile (append-only).

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `activity_type` | `text` | | NO | CHECK: saved_card, scheduled_card, joined_board |
| `title` | `text` | | NO | |
| `tag` | `text` | | YES | |
| `reference_id` | `text` | | YES | |
| `reference_type` | `text` | | YES | CHECK: experience, board |
| `metadata` | `jsonb` | `'{}'` | YES | |
| `created_at` | `timestamptz` | `now()` | NO | |

**RLS:** Enabled — own rows only (SELECT/INSERT, no UPDATE/DELETE).

**Indexes:**
- `idx_user_activity_user_id` on `(user_id)`
- `idx_user_activity_created_at` on `(created_at DESC)`
- `idx_user_activity_user_created` on `(user_id, created_at DESC)`

---

### 14. `friends`

Friend relationships (bidirectional rows).

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `friend_user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `status` | `text` | `'pending'` | YES | CHECK: `('accepted','pending','blocked')` |
| `deleted_at` | `timestamptz` | | YES | Soft-delete for undo |
| `created_at` | `timestamptz` | `now()` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | Auto-updated via trigger |

**Constraints:** `UNIQUE(user_id, friend_user_id)`

**RLS:** Enabled — own rows (via `user_id`).

**Indexes:**
- `idx_friends_user_id` on `(user_id)`

---

### 15. `friend_requests`

Friend request workflow.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `sender_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `receiver_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `status` | `text` | `'pending'` | YES | CHECK: `('pending','accepted','rejected')` |
| `created_at` | `timestamptz` | `now()` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | |

**Constraints:** `UNIQUE(sender_id, receiver_id)`

---

### 16. `blocked_users`

User blocking system — auto-removes friendships on block.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `blocker_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `blocked_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `reason` | `text` | | YES | harassment, spam, other |
| `created_at` | `timestamptz` | `now()` | YES | |

**Constraints:** `UNIQUE(blocker_id, blocked_id)`, `CHECK(blocker_id != blocked_id)`

**RLS:** Enabled
| Policy | Command | Expression |
|--------|---------|------------|
| Users can view their own blocks | SELECT | `auth.uid() = blocker_id` |
| Users can create blocks | INSERT | `auth.uid() = blocker_id` |
| Users can remove their own blocks | DELETE | `auth.uid() = blocker_id` |

**Indexes:**
- `idx_blocked_users_blocker` on `(blocker_id)`
- `idx_blocked_users_blocked` on `(blocked_id)`

---

### 17. `muted_users`

Notification muting (doesn't remove friendship).

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `muter_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `muted_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `created_at` | `timestamptz` | `now()` | YES | |

**Constraints:** `UNIQUE(muter_id, muted_id)`, `CHECK(muter_id != muted_id)`

**RLS:** Enabled — muter can SELECT/INSERT/DELETE own mutes.

**Indexes:**
- `idx_muted_users_muter` on `(muter_id)`
- `idx_muted_users_muted` on `(muted_id)`

---

### 18. `user_reports`

User reporting system for moderation.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `reporter_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `reported_user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `reason` | `report_reason` (enum) | | NO | spam, inappropriate-content, harassment, other |
| `details` | `text` | | YES | |
| `status` | `report_status` (enum) | `'pending'` | YES | pending, reviewed, resolved, dismissed |
| `created_at` | `timestamptz` | `now()` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | Auto-updated via trigger |
| `reviewed_at` | `timestamptz` | | YES | |
| `reviewed_by` | `uuid` | | YES | FK → `auth.users(id)` |
| `resolution_notes` | `text` | | YES | |

**Constraints:** `CHECK(reporter_id != reported_user_id)`

**RLS:** Enabled — reporter can INSERT and SELECT own reports.

**Indexes:**
- `idx_user_reports_reporter` on `(reporter_id)`
- `idx_user_reports_reported` on `(reported_user_id)`
- `idx_user_reports_status` on `(status)`
- `idx_user_reports_created` on `(created_at DESC)`

---

### 19. `boards`

Collaboration boards.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `name` | `text` | `''` | NO | |
| `description` | `text` | | YES | |
| `created_by` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `is_public` | `boolean` | `false` | YES | |
| `tags` | `text[]` | `'{}'` | YES | |
| `archived_at` | `timestamptz` | | YES | Soft-archive for undo |
| `created_at` | `timestamptz` | `now()` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | Auto-updated via trigger |

**RLS:** Enabled
| Policy | Command | Expression |
|--------|---------|------------|
| View public boards & own boards | SELECT | `is_public = true OR created_by = auth.uid()` |
| Users can create boards | INSERT | `auth.uid() = created_by` |
| Users can update own boards | UPDATE | `auth.uid() = created_by` |
| Users can delete own boards | DELETE | `auth.uid() = created_by` |

**Indexes:**
- `idx_boards_created_by` on `(created_by)`
- `idx_boards_is_public` on `(is_public)`

---

### 20. `board_cards`

Cards pinned to a board.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `board_id` | `uuid` | | NO | FK → `boards(id)` CASCADE |
| `saved_experience_id` | `uuid` | | NO | FK → `saved_experiences(id)` CASCADE |
| `added_by` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `finalized_at` | `timestamptz` | | YES | Soft field for undo |
| `added_at` | `timestamptz` | `now()` | YES | |

**Constraints:** `UNIQUE(board_id, saved_experience_id)`

**RLS:** Enabled — access based on board membership.

**Indexes:**
- `idx_board_cards_board_id` on `(board_id)`

---

### 21. `board_votes`

Voting on board cards (supports both `board_cards` and `board_saved_cards`).

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `board_id` | `uuid` | | NO | FK → `boards(id)` CASCADE |
| `card_id` | `uuid` | | YES | FK → `board_cards(id)` CASCADE |
| `saved_card_id` | `uuid` | | YES | FK → `board_saved_cards(id)` CASCADE |
| `session_id` | `uuid` | | YES | FK → `collaboration_sessions(id)` CASCADE |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `vote_type` | `text` | | NO | CHECK: `('up','down','neutral')` |
| `created_at` | `timestamptz` | `now()` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | Auto-updated via trigger |

**Constraints:**
- `UNIQUE(board_id, card_id, user_id)`
- `board_votes_card_check` CHECK: exactly one of `card_id` or `saved_card_id` is set
- `board_votes_session_saved_card_user_unique` UNIQUE on `(session_id, saved_card_id, user_id)` WHERE NOT NULL

**RLS:** Enabled — access based on board membership.

**Indexes:**
- `idx_board_votes_board_id` on `(board_id)`
- `idx_board_votes_user_id` on `(user_id)`
- `idx_board_votes_saved_card_id` on `(saved_card_id)` WHERE NOT NULL
- `idx_board_votes_session_id` on `(session_id)` WHERE NOT NULL

---

### 22. `board_threads`

Discussion threads on board cards.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `board_id` | `uuid` | | NO | FK → `boards(id)` CASCADE |
| `card_id` | `uuid` | | YES | FK → `board_cards(id)` CASCADE |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `content` | `text` | | NO | |
| `parent_id` | `uuid` | | YES | FK → `board_threads(id)` CASCADE (self-ref) |
| `created_at` | `timestamptz` | `now()` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | Auto-updated via trigger |

**RLS:** Enabled — access based on board membership.

**Indexes:**
- `idx_board_threads_board_id` on `(board_id)`

---

### 23. `activity_history`

Audit log for board actions.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `board_id` | `uuid` | | YES | FK → `boards(id)` CASCADE |
| `card_id` | `uuid` | | YES | FK → `board_cards(id)` CASCADE |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `action_type` | `text` | | NO | CHECK: vote, unvote, finalize, unfinalize, add_card, remove_card |
| `action_data` | `jsonb` | `'{}'` | YES | |
| `created_at` | `timestamptz` | `now()` | YES | |

**RLS:** Enabled — access based on board membership.

**Indexes:**
- `idx_activity_history_board_id` on `(board_id)`

---

### 24. `collaboration_sessions`

Collaborative planning sessions (group hangouts, date nights, etc.).

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `name` | `text` | `''` | NO | |
| `created_by` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `status` | `text` | `'pending'` | YES | |
| `session_type` | `text` | `'group_hangout'` | YES | CHECK: group_hangout, date_night, squad_outing, business_meeting |
| `board_id` | `uuid` | | YES | FK → `boards(id)` SET NULL |
| `invite_code` | `text` | | YES | **UNIQUE**, auto-generated `MINGLA-XXXXXX` |
| `invite_link` | `text` | | YES | `mingla://board/{code}` |
| `max_participants` | `integer` | `15` | YES | |
| `is_active` | `boolean` | `true` | YES | |
| `last_activity_at` | `timestamptz` | `now()` | YES | |
| `archived_at` | `timestamptz` | | YES | |
| `created_at` | `timestamptz` | `now()` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | |

**RLS:** Enabled

**Indexes:**
- `idx_collaboration_sessions_invite_code` on `(invite_code)` WHERE NOT NULL

---

### 25. `session_participants`

Members of collaboration sessions.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `session_id` | `uuid` | | NO | FK → `collaboration_sessions(id)` CASCADE |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `role` | `text` | `'member'` | YES | |
| `is_admin` | `boolean` | `false` | YES | Admin privileges |
| `has_accepted` | `boolean` | `false` | YES | |
| `joined_at` | `timestamptz` | `now()` | YES | |
| `created_at` | `timestamptz` | `now()` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | |

**Constraints:** `UNIQUE(session_id, user_id)`

**RLS:** Enabled

**Indexes:**
- `idx_session_participants_has_accepted` on `(has_accepted)`
- `idx_session_participants_is_admin` on `(session_id, is_admin)` WHERE is_admin = true

---

### 26. `collaboration_invites`

Invite records for sessions.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `session_id` | `uuid` | | NO | FK → `collaboration_sessions(id)` CASCADE |
| `inviter_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `invitee_id` | `uuid` | | YES | FK → `auth.users(id)` CASCADE |
| `invited_user_id` | `uuid` | | YES | FK → `auth.users(id)` CASCADE — alias for invitee_id, kept in sync |
| `invited_by` | `uuid` | | YES | FK → `auth.users(id)` CASCADE — alias for inviter_id, kept in sync |
| `status` | `text` | `'pending'` | YES | |
| `invite_method` | `text` | `'friends_list'` | YES | CHECK: friends_list, link, qr_code, invite_code |
| `expires_at` | `timestamptz` | | YES | |
| `accepted_at` | `timestamptz` | | YES | |
| `created_at` | `timestamptz` | `now()` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | |

**Constraints:** `collaboration_invites_session_invited_user_unique` UNIQUE on `(session_id, invited_user_id)`

**RLS:** Enabled

**Indexes:**
- `idx_collaboration_invites_invited_user_id` on `(invited_user_id)`
- `idx_collaboration_invites_invited_by` on `(invited_by)`

---

### 27. `board_session_preferences`

Per-user preferences within a collaboration session.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `session_id` | `uuid` | | NO | FK → `collaboration_sessions(id)` CASCADE |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `budget_min` | `integer` | `0` | YES | |
| `budget_max` | `integer` | `1000` | YES | |
| `categories` | `text[]` | `ARRAY[]::TEXT[]` | YES | |
| `time_of_day` | `text` | | YES | |
| `datetime_pref` | `timestamptz` | | YES | |
| `location` | `text` | | YES | |
| `custom_lat` | `double precision` | | YES | |
| `custom_lng` | `double precision` | | YES | |
| `travel_mode` | `text` | `'walking'` | YES | |
| `travel_constraint_type` | `text` | `'time'` | YES | |
| `travel_constraint_value` | `integer` | `30` | YES | |
| `created_at` | `timestamptz` | `now()` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | Auto-updated via trigger |

**Constraints:** `UNIQUE(session_id, user_id)`

**RLS:** Enabled — own preferences within sessions they participate in.

**Indexes:**
- `idx_board_session_preferences_session_id` on `(session_id)`
- `idx_board_session_preferences_user_id` on `(user_id)`
- `idx_board_session_preferences_session_user` on `(session_id, user_id)`

---

### 28. `board_saved_cards`

Cards saved to a collaboration session (shared view).

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `session_id` | `uuid` | | NO | FK → `collaboration_sessions(id)` CASCADE |
| `experience_id` | `uuid` | | YES | FK → `experiences(id)` SET NULL |
| `saved_experience_id` | `uuid` | | YES | FK → `saved_experiences(id)` SET NULL |
| `card_data` | `jsonb` | | NO | Full card data snapshot |
| `saved_by` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `saved_at` | `timestamptz` | `now()` | YES | |

**Constraints:** `UNIQUE(session_id, experience_id, saved_experience_id)`

**RLS:** Enabled — session participants can SELECT and INSERT.

**Indexes:**
- `idx_board_saved_cards_session_id` on `(session_id)`
- `idx_board_saved_cards_saved_by` on `(saved_by)`
- `idx_board_saved_cards_saved_at` on `(saved_at DESC)`

---

### 29. `board_card_rsvps`

RSVP/attendance tracking for board cards.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `session_id` | `uuid` | | NO | FK → `collaboration_sessions(id)` CASCADE |
| `saved_card_id` | `uuid` | | NO | FK → `board_saved_cards(id)` CASCADE |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `rsvp_status` | `text` | | NO | CHECK: `('attending','not_attending')` |
| `created_at` | `timestamptz` | `now()` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | Auto-updated via trigger |

**Constraints:** `UNIQUE(session_id, saved_card_id, user_id)`

**RLS:** Enabled — participants can view; users manage own RSVPs.

**Indexes:**
- `idx_board_card_rsvps_session_id` on `(session_id)`
- `idx_board_card_rsvps_saved_card_id` on `(saved_card_id)`
- `idx_board_card_rsvps_user_id` on `(user_id)`
- `idx_board_card_rsvps_status` on `(rsvp_status)`

---

### 30. `board_messages`

Main board discussion/chat messages.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `session_id` | `uuid` | | NO | FK → `collaboration_sessions(id)` CASCADE |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `content` | `text` | | NO | |
| `mentions` | `jsonb` | `'[]'` | YES | Array of mentioned user IDs |
| `reply_to_id` | `uuid` | | YES | FK → `board_messages(id)` SET NULL |
| `created_at` | `timestamptz` | `now()` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | Auto-updated via trigger |
| `deleted_at` | `timestamptz` | | YES | Soft-delete |

**RLS:** Enabled — session participants; soft-deleted hidden from SELECT.

**Indexes:**
- `idx_board_messages_session_id` on `(session_id)`
- `idx_board_messages_user_id` on `(user_id)`
- `idx_board_messages_created_at` on `(created_at DESC)`
- `idx_board_messages_reply_to` on `(reply_to_id)` WHERE NOT NULL

---

### 31. `board_card_messages`

Card-specific discussion messages.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `session_id` | `uuid` | | NO | FK → `collaboration_sessions(id)` CASCADE |
| `saved_card_id` | `uuid` | | NO | FK → `board_saved_cards(id)` CASCADE |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `content` | `text` | | NO | |
| `mentions` | `jsonb` | `'[]'` | YES | |
| `reply_to_id` | `uuid` | | YES | FK → `board_card_messages(id)` SET NULL |
| `created_at` | `timestamptz` | `now()` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | |
| `deleted_at` | `timestamptz` | | YES | |

**RLS:** Enabled — session participants.

**Indexes:**
- `idx_board_card_messages_session_id` on `(session_id)`
- `idx_board_card_messages_saved_card_id` on `(saved_card_id)`
- `idx_board_card_messages_user_id` on `(user_id)`
- `idx_board_card_messages_created_at` on `(created_at DESC)`

---

### 32. `board_message_reads`

Read receipts for board messages.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `message_id` | `uuid` | | NO | FK → `board_messages(id)` CASCADE |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `read_at` | `timestamptz` | `now()` | YES | |

**Constraints:** `UNIQUE(message_id, user_id)`

**RLS:** Enabled

---

### 33. `board_card_message_reads`

Read receipts for card-specific messages.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `message_id` | `uuid` | | NO | FK → `board_card_messages(id)` CASCADE |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `read_at` | `timestamptz` | `now()` | YES | |

**Constraints:** `UNIQUE(message_id, user_id)`

**RLS:** Enabled

---

### 34. `board_participant_presence`

Online/offline status per session user.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `session_id` | `uuid` | | NO | FK → `collaboration_sessions(id)` CASCADE |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `is_online` | `boolean` | `false` | YES | |
| `last_seen_at` | `timestamptz` | `now()` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | |

**Constraints:** `UNIQUE(session_id, user_id)`

**RLS:** Enabled — session participants can see; users update own.

**Indexes:**
- `idx_board_participant_presence_session_id` on `(session_id)`
- `idx_board_participant_presence_user_id` on `(user_id)`
- `idx_board_participant_presence_online` on `(is_online)` WHERE true

---

### 35. `board_user_swipe_states`

Individual swipe tracking per user per card in a session.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `session_id` | `uuid` | | NO | FK → `collaboration_sessions(id)` CASCADE |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `experience_id` | `uuid` | | YES | FK → `experiences(id)` SET NULL |
| `saved_experience_id` | `uuid` | | YES | FK → `saved_experiences(id)` SET NULL |
| `swipe_state` | `text` | | NO | CHECK: `('not_seen','swiped_left','swiped_right')` |
| `swiped_at` | `timestamptz` | `now()` | YES | |

**Constraints:** `UNIQUE(session_id, user_id, experience_id, saved_experience_id)`

**RLS:** Enabled — own rows only.

**Indexes:**
- `idx_board_user_swipe_states_session_user` on `(session_id, user_id)`
- `idx_board_user_swipe_states_experience` on `(experience_id)` WHERE NOT NULL
- `idx_board_user_swipe_states_saved_experience` on `(saved_experience_id)` WHERE NOT NULL

---

### 36. `board_typing_indicators`

Typing indicator state per user per card/session.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `session_id` | `uuid` | | NO | FK → `collaboration_sessions(id)` CASCADE |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `saved_card_id` | `uuid` | | YES | FK → `board_saved_cards(id)` CASCADE; NULL = main chat |
| `is_typing` | `boolean` | `false` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | |

**Constraints:** `UNIQUE(session_id, user_id, saved_card_id)`

**RLS:** Enabled — session participants can view; users update own.

**Indexes:**
- `idx_board_typing_indicators_session` on `(session_id)`
- `idx_board_typing_indicators_typing` on `(is_typing)` WHERE true

---

### 37. `conversations`

Direct message conversations.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `type` | `varchar(20)` | `'direct'` | YES | CHECK: `('direct','group')` |
| `created_by` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `created_at` | `timestamptz` | `now()` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | Auto-updated via trigger |
| `last_message_at` | `timestamptz` | | YES | Auto-updated on new message |

**RLS:** Enabled — participants (via `conversation_participants`) + creator.

**Indexes:**
- `idx_conversations_created_by` on `(created_by)`
- `idx_conversations_updated_at` on `(updated_at DESC)`
- `idx_conversations_last_message_at` on `(last_message_at DESC)`

---

### 38. `conversation_participants`

Participants in DM conversations.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `conversation_id` | `uuid` | | NO | FK → `conversations(id)` CASCADE |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `joined_at` | `timestamptz` | `now()` | YES | |
| `last_read_at` | `timestamptz` | | YES | |

**Constraints:** `UNIQUE(conversation_id, user_id)`

**RLS:** Enabled — own participation + same-conversation peers.

**Indexes:**
- `idx_conversation_participants_conversation_id` on `(conversation_id)`
- `idx_conversation_participants_user_id` on `(user_id)`
- `idx_conversation_participants_user_conversation` on `(user_id, conversation_id)`

---

### 39. `messages`

Direct messages.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `conversation_id` | `uuid` | | NO | FK → `conversations(id)` CASCADE |
| `sender_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `content` | `text` | | NO | |
| `message_type` | `varchar(20)` | `'text'` | YES | CHECK: text, image, video, file |
| `file_url` | `text` | | YES | |
| `file_name` | `varchar(255)` | | YES | |
| `file_size` | `bigint` | | YES | |
| `created_at` | `timestamptz` | `now()` | YES | |
| `updated_at` | `timestamptz` | `now()` | YES | Auto-updated via trigger |
| `deleted_at` | `timestamptz` | | YES | Soft-delete |

**RLS:** Enabled — conversation participants; blocked users cannot send.

**Indexes:**
- `idx_messages_conversation_id` on `(conversation_id)`
- `idx_messages_sender_id` on `(sender_id)`
- `idx_messages_created_at` on `(created_at DESC)`
- `idx_messages_conversation_created` on `(conversation_id, created_at DESC)`

---

### 40. `message_reads`

DM read receipts.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `message_id` | `uuid` | | NO | FK → `messages(id)` CASCADE |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `read_at` | `timestamptz` | `now()` | YES | |

**Constraints:** `UNIQUE(message_id, user_id)`

**RLS:** Enabled

**Indexes:**
- `idx_message_reads_message_id` on `(message_id)`
- `idx_message_reads_user_id` on `(user_id)`

---

### 41. `undo_actions`

System-wide undo action queue (auto-expiring).

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `text` | | NO | **PK** |
| `type` | `text` | | NO | friend_removal, message_unsend, vote_undo, finalize_undo, board_archive, save_undo, schedule_undo, preference_rollback |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `data` | `jsonb` | | NO | |
| `timestamp` | `timestamptz` | `now()` | NO | |
| `expires_at` | `timestamptz` | | NO | |
| `description` | `text` | | NO | |
| `created_at` | `timestamptz` | `now()` | NO | |

**RLS:** Enabled — own rows only (SELECT/INSERT/DELETE).

**Indexes:**
- `idx_undo_actions_user_id` on `(user_id)`
- `idx_undo_actions_type` on `(type)`
- `idx_undo_actions_expires_at` on `(expires_at)`
- `idx_undo_actions_timestamp` on `(timestamp)`

---

### 42. `preference_history`

Audit trail for preference changes.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `preference_id` | `uuid` | | NO | |
| `old_data` | `jsonb` | | NO | |
| `new_data` | `jsonb` | | NO | |
| `change_type` | `text` | | NO | INSERT, UPDATE, DELETE |
| `created_at` | `timestamptz` | `now()` | NO | |

**RLS:** Enabled — own rows only (SELECT/INSERT).

**Indexes:**
- `idx_preference_history_user_id` on `(user_id)`
- `idx_preference_history_preference_id` on `(preference_id)`
- `idx_preference_history_created_at` on `(created_at)`

---

### 43. `app_feedback`

App-wide user feedback and ratings.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `user_id` | `uuid` | | YES | FK → `auth.users(id)` SET NULL |
| `rating` | `integer` | | YES | CHECK: 1–5 |
| `message` | `text` | | YES | |
| `category` | `text` | | YES | |
| `platform` | `text` | `'mobile'` | YES | |
| `created_at` | `timestamptz` | `now()` | YES | |

**RLS:** Enabled — own rows only (INSERT/SELECT).

---

### 44. `experience_feedback`

Post-scheduling experience feedback.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `user_id` | `uuid` | | YES | FK → `auth.users(id)` SET NULL |
| `card_id` | `text` | | NO | |
| `experience_title` | `text` | | YES | |
| `rating` | `integer` | | NO | CHECK: 1–5 |
| `feedback_text` | `text` | | YES | |
| `created_at` | `timestamptz` | `now()` | YES | |

**RLS:** Enabled — own rows only (INSERT/SELECT).

---

### 45. `discover_daily_cache`

Per-user daily card cache for the Discover feed.

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| `id` | `uuid` | `gen_random_uuid()` | NO | **PK** |
| `user_id` | `uuid` | | NO | FK → `auth.users(id)` CASCADE |
| `us_date_key` | `date` | | NO | |
| `cards` | `jsonb` | `'[]'` | NO | |
| `featured_card` | `jsonb` | | YES | |
| `generated_location` | `jsonb` | `'{}'` | YES | |
| `created_at` | `timestamptz` | `now()` | NO | |
| `updated_at` | `timestamptz` | `now()` | NO | Auto-updated via trigger |

**Constraints:** `UNIQUE(user_id, us_date_key)`

**RLS:** Enabled — own rows only (SELECT/INSERT/UPDATE) for `authenticated`.

**Indexes:**
- `idx_discover_daily_cache_user_date` on `(user_id, us_date_key DESC)`

---

## RPC Functions

### User Management
| Function | Returns | Description |
|----------|---------|-------------|
| `handle_new_user()` | TRIGGER | Auto-creates profile on `auth.users` INSERT. SECURITY DEFINER. Auto-confirms email/phone. |
| `check_username_availability(TEXT)` | BOOLEAN | Case-insensitive username availability check. SECURITY DEFINER. Callable by anon. |
| `delete_user_profile(UUID)` | void | Safely deletes profile with trigger management. SECURITY DEFINER. |
| `resolve_user_visibility_by_identifier(TEXT)` | TABLE(user_exists, can_view, is_blocked, profile_id, username, email) | Resolves user visibility by email/username considering blocks. SECURITY DEFINER. |

### Preference Learning
| Function | Returns | Description |
|----------|---------|-------------|
| `update_user_preferences_from_interaction()` | TRIGGER | Auto-updates `user_preference_learning` on new interaction (like→+0.1, dislike→-0.1). |
| `create_preference_history()` | TRIGGER | Records preference changes to `preference_history`. |

### Location
| Function | Returns | Description |
|----------|---------|-------------|
| `get_user_frequent_locations(UUID, INTEGER)` | TABLE(latitude, longitude, visit_count, last_visit) | Returns top N frequent locations (≥3 visits). |
| `cleanup_old_location_history()` | void | Deletes location history older than 30 days. |

### Friend / Block / Mute
| Function | Returns | Description |
|----------|---------|-------------|
| `accept_friend_request()` | TRIGGER | Creates reciprocal friendship row on status→'accepted'. |
| `handle_user_blocked()` | TRIGGER | Auto-removes friendships when a block is created. |
| `is_blocked_by(UUID, UUID)` | BOOLEAN | Directional block check. SECURITY DEFINER. |
| `has_block_between(UUID, UUID)` | BOOLEAN | Bidirectional block check. SECURITY DEFINER. |
| `is_muted_by(UUID, UUID)` | BOOLEAN | Directional mute check. SECURITY DEFINER. |
| `get_muted_user_ids(UUID)` | SETOF UUID | Returns all muted user IDs. SECURITY DEFINER. |
| `has_recent_report(UUID, UUID, INTEGER)` | BOOLEAN | Spam-prevention: check if report already filed in window. |

### Collaboration / Board
| Function | Returns | Description |
|----------|---------|-------------|
| `generate_invite_code()` | TEXT | Generates `MINGLA-XXXXXX` format code. |
| `auto_generate_invite_info()` | TRIGGER | Auto-generates invite_code and invite_link on session INSERT. |
| `update_session_last_activity()` | TRIGGER | Updates `collaboration_sessions.last_activity_at` on related INSERT. |
| `auto_create_presence()` | TRIGGER | Creates presence entry when user joins session. |
| `mark_presence_offline()` | TRIGGER | Marks presence offline when user leaves session. |
| `cleanup_session_if_under_two_participants()` | TRIGGER | Auto-deletes sessions with <2 participants. |
| `get_saved_card_vote_counts(UUID)` | TABLE(up_votes, down_votes, total_votes) | Vote counts for a saved card. |
| `get_card_rsvp_counts(UUID)` | TABLE(attending_count, not_attending_count, total_rsvps) | RSVP counts. |
| `get_unread_message_count(UUID, UUID)` | BIGINT | Unread board messages. |
| `get_unread_card_message_count(UUID, UUID, UUID)` | BIGINT | Unread card messages for a specific card. |
| `get_total_unread_card_messages_count(UUID, UUID)` | BIGINT | Total unread card messages across all cards. |

### Messaging
| Function | Returns | Description |
|----------|---------|-------------|
| `update_conversation_on_message()` | TRIGGER | Updates conversation timestamps on new message. |
| `is_conversation_participant(UUID, UUID)` | BOOLEAN | SECURITY DEFINER helper to check conversation membership (avoids RLS recursion). |
| `is_message_conversation_participant(UUID, UUID)` | BOOLEAN | SECURITY DEFINER helper for storage bucket RLS. |
| `soft_delete_message()` | TRIGGER | Marks message as deleted instead of hard-deleting. |

### Undo System
| Function | Returns | Description |
|----------|---------|-------------|
| `get_undo_actions(UUID)` | TABLE(id, type, data, timestamp, expires_at, description) | Non-expired undo actions for user. |
| `execute_undo_action(TEXT, UUID)` | BOOLEAN | Executes and removes an undo action. Handles multiple types. |
| `cleanup_expired_undo_actions()` | void | Removes expired undo entries. |

### Utility
| Function | Returns | Description |
|----------|---------|-------------|
| `update_updated_at_column()` | TRIGGER | Sets `NEW.updated_at = now()`. Used across many tables. |
| `sync_invite_user_id()` | TRIGGER | Syncs `invitee_id` ↔ `invited_user_id` on collaboration_invites. |
| `sync_invite_inviter_id()` | TRIGGER | Syncs `inviter_id` ↔ `invited_by` on collaboration_invites. |

---

## Triggers

| Trigger | Table | Event | Function |
|---------|-------|-------|----------|
| `on_auth_user_created` | `auth.users` | AFTER INSERT | `handle_new_user()` |
| `update_profiles_updated_at` | `profiles` | BEFORE UPDATE | `update_updated_at_column()` |
| `update_preferences_updated_at` | `preferences` | BEFORE UPDATE | `update_updated_at_column()` |
| `trigger_preference_history` | `preferences` | AFTER INSERT/UPDATE/DELETE | `create_preference_history()` |
| `update_experiences_updated_at` | `experiences` | BEFORE UPDATE | `update_updated_at_column()` |
| `update_boards_updated_at` | `boards` | BEFORE UPDATE | `update_updated_at_column()` |
| `update_saved_experiences_updated_at` | `saved_experiences` | BEFORE UPDATE | `update_updated_at_column()` |
| `update_scheduled_activities_updated_at` | `scheduled_activities` | BEFORE UPDATE | `update_updated_at_column()` |
| `update_friends_updated_at` | `friends` | BEFORE UPDATE | `update_updated_at_column()` |
| `accept_friend_request_trigger` | `friends` | AFTER UPDATE | `accept_friend_request()` |
| `on_user_blocked` | `blocked_users` | AFTER INSERT | `handle_user_blocked()` |
| `user_reports_updated_at` | `user_reports` | BEFORE UPDATE | `update_user_reports_updated_at()` |
| `update_user_interactions_updated_at` | `user_interactions` | BEFORE UPDATE | `update_updated_at_column()` |
| `trigger_update_preferences_from_interaction` | `user_interactions` | AFTER INSERT | `update_user_preferences_from_interaction()` |
| `update_user_preference_learning_updated_at` | `user_preference_learning` | BEFORE UPDATE | `update_updated_at_column()` |
| `auto_generate_invite_on_session_create` | `collaboration_sessions` | BEFORE INSERT | `auto_generate_invite_info()` |
| `auto_create_presence_on_join` | `session_participants` | AFTER INSERT | `auto_create_presence()` |
| `mark_offline_on_leave` | `session_participants` | AFTER DELETE | `mark_presence_offline()` |
| `trg_cleanup_session_under_two_participants` | `session_participants` | AFTER INSERT/UPDATE/DELETE | `cleanup_session_if_under_two_participants()` |
| `sync_invite_ids` | `collaboration_invites` | BEFORE INSERT/UPDATE | `sync_invite_user_id()` |
| `sync_invite_inviter_ids` | `collaboration_invites` | BEFORE INSERT/UPDATE | `sync_invite_inviter_id()` |
| `update_board_session_preferences_updated_at` | `board_session_preferences` | BEFORE UPDATE | `update_updated_at_column()` |
| `update_session_activity_on_saved_card` | `board_saved_cards` | AFTER INSERT | `update_session_last_activity()` |
| `update_board_votes_updated_at` | `board_votes` | BEFORE UPDATE | `update_updated_at_column()` |
| `handle_board_vote_trigger` | `board_votes` | AFTER INSERT/UPDATE | `handle_board_vote()` |
| `add_board_card_trigger` | `board_cards` | AFTER INSERT | `add_board_card()` |
| `update_board_card_rsvps_updated_at` | `board_card_rsvps` | BEFORE UPDATE | `update_updated_at_column()` |
| `update_session_activity_on_rsvp` | `board_card_rsvps` | AFTER INSERT/UPDATE | `update_session_last_activity()` |
| `update_board_threads_updated_at` | `board_threads` | BEFORE UPDATE | `update_updated_at_column()` |
| `update_board_messages_updated_at` | `board_messages` | BEFORE UPDATE | `update_updated_at_column()` |
| `update_session_activity_on_message` | `board_messages` | AFTER INSERT | `update_session_last_activity()` |
| `update_board_card_messages_updated_at` | `board_card_messages` | BEFORE UPDATE | `update_updated_at_column()` |
| `update_session_activity_on_card_message` | `board_card_messages` | AFTER INSERT | `update_session_last_activity()` |
| `update_board_participant_presence_updated_at` | `board_participant_presence` | BEFORE UPDATE | `update_updated_at_column()` |
| `update_board_typing_indicators_updated_at` | `board_typing_indicators` | BEFORE UPDATE | `update_updated_at_column()` |
| `update_conversations_updated_at` | `conversations` | BEFORE UPDATE | `update_updated_at_column()` |
| `update_conversation_on_message` | `messages` | AFTER INSERT | `update_conversation_on_message()` |
| `update_messages_updated_at` | `messages` | BEFORE UPDATE | `update_updated_at_column()` |
| `soft_delete_message_trigger` | `messages` | BEFORE DELETE | `soft_delete_message()` |
| `update_discover_daily_cache_updated_at` | `discover_daily_cache` | BEFORE UPDATE | `update_updated_at_column()` |

---

## Storage Buckets

| Bucket | Public | Size Limit | Allowed MIME Types |
|--------|--------|------------|-------------------|
| `avatars` | Yes | 10 MB | jpeg, png, gif, webp |
| `messages` | Yes | 50 MB | jpeg, png, gif, webp, mp4, quicktime, pdf, doc/docx, xls/xlsx, txt, octet-stream |

---

## Entity Relationship Diagram

```
auth.users (Supabase Auth)
  │
  ├──1:1──► profiles
  │           ├──1:1──► preferences
  │           │           └──1:N──► preference_history
  │           ├──1:N──► saves ◄──N:1── experiences
  │           └──1:N──► saved_card
  │
  ├──1:N──► saved_experiences ──N:1──► experiences
  ├──1:N──► scheduled_activities
  ├──1:N──► calendar_entries
  ├──1:N──► user_interactions
  ├──1:N──► user_location_history
  ├──1:N──► user_preference_learning
  ├──1:N──► user_sessions
  ├──1:N──► user_activity
  ├──1:N──► app_feedback
  ├──1:N──► experience_feedback
  ├──1:N──► discover_daily_cache
  │
  ├──1:N──► friends (user_id, friend_user_id)
  ├──1:N──► friend_requests (sender_id, receiver_id)
  ├──1:N──► blocked_users (blocker_id, blocked_id)
  ├──1:N──► muted_users (muter_id, muted_id)
  ├──1:N──► user_reports (reporter_id, reported_user_id)
  │
  ├──1:N──► boards
  │           ├──1:N──► board_cards ──N:1──► saved_experiences
  │           │           ├──1:N──► board_votes
  │           │           └──1:N──► board_threads (self-referencing)
  │           └──1:N──► activity_history
  │
  ├──1:N──► collaboration_sessions
  │           ├──1:N──► session_participants
  │           ├──1:N──► collaboration_invites
  │           ├──1:N──► board_session_preferences
  │           ├──1:N──► board_saved_cards
  │           │           ├──1:N──► board_votes (via saved_card_id)
  │           │           ├──1:N──► board_card_rsvps
  │           │           ├──1:N──► board_card_messages
  │           │           │           └──1:N──► board_card_message_reads
  │           │           └──N:1──► board_typing_indicators
  │           ├──1:N──► board_messages
  │           │           └──1:N──► board_message_reads
  │           ├──1:N──► board_participant_presence
  │           └──1:N──► board_user_swipe_states
  │
  ├──1:N──► conversations
  │           ├──1:N──► conversation_participants
  │           └──1:N──► messages
  │                       └──1:N──► message_reads
  │
  └──1:N──► undo_actions
```

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| **Tables** | 45 |
| **RPC Functions** | ~30 |
| **Triggers** | ~40 |
| **Enums** | 2 (`report_reason`, `report_status`) |
| **Storage Buckets** | 2 (`avatars`, `messages`) |
| **Extensions** | 2 (`uuid-ossp`, `pg_net`) |
