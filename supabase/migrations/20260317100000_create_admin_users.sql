-- Migration: 20260317100000_create_admin_users.sql
-- Creates the admin_users table required by is_admin_user() and the admin dashboard.
-- This table was previously created manually via SQL Editor — now tracked in migrations.

CREATE TABLE IF NOT EXISTS public.admin_users (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  role        TEXT DEFAULT 'admin' CHECK (role IN ('owner', 'admin')),
  status      TEXT DEFAULT 'invited' CHECK (status IN ('active', 'invited', 'revoked')),
  invited_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  accepted_at TIMESTAMPTZ
);

-- Seed the owner
INSERT INTO public.admin_users (email, role, status, accepted_at)
VALUES ('seth@usemingla.com', 'owner', 'active', now())
ON CONFLICT (email) DO NOTHING;

-- Enable RLS
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Allow anon read (needed for login check before auth)
DROP POLICY IF EXISTS "Allow anon read" ON public.admin_users;
CREATE POLICY "Allow anon read" ON public.admin_users FOR SELECT USING (true);

-- Allow authenticated users to manage admins
DROP POLICY IF EXISTS "Allow authenticated insert" ON public.admin_users;
CREATE POLICY "Allow authenticated insert" ON public.admin_users FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Allow authenticated update" ON public.admin_users;
CREATE POLICY "Allow authenticated update" ON public.admin_users FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Allow authenticated delete" ON public.admin_users;
CREATE POLICY "Allow authenticated delete" ON public.admin_users FOR DELETE TO authenticated USING (true);
