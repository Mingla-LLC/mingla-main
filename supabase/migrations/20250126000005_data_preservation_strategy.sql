-- DATA PRESERVATION STRATEGY
-- This approach preserves all existing data while fixing schema issues

-- Step 1: Create backup tables for critical data
CREATE TABLE IF NOT EXISTS public._backup_user_interactions AS 
SELECT * FROM public.user_interactions;

CREATE TABLE IF NOT EXISTS public._backup_user_sessions AS 
SELECT * FROM public.user_sessions;

CREATE TABLE IF NOT EXISTS public._backup_saved_experiences AS 
SELECT * FROM public.saved_experiences;

CREATE TABLE IF NOT EXISTS public._backup_experiences AS 
SELECT * FROM public.experiences;

CREATE TABLE IF NOT EXISTS public._backup_friends AS 
SELECT * FROM public.friends;

CREATE TABLE IF NOT EXISTS public._backup_messages AS 
SELECT * FROM public.messages;

CREATE TABLE IF NOT EXISTS public._backup_profiles AS 
SELECT * FROM public.profiles;

-- Step 2: Create new clean schema alongside existing tables
-- (This will be done in separate migration files)

-- Step 3: Migrate data from old schema to new schema
-- (This will be done after new schema is created)

-- Step 4: Drop old tables after successful migration
-- (This will be done as final step)
