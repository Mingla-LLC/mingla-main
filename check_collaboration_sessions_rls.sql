-- Query to check RLS policies on collaboration_sessions table

-- 1. Check if RLS is enabled
SELECT 
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename = 'collaboration_sessions';

-- 2. List all RLS policies on collaboration_sessions
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd as command,
    qual as using_expression,
    with_check as with_check_expression
FROM pg_policies 
WHERE schemaname = 'public' 
AND tablename = 'collaboration_sessions'
ORDER BY policyname;

-- 3. Get detailed policy information with full expressions
SELECT 
    p.polname as policyname,
    p.polcmd as command_type,
    p.polpermissive as permissive,
    p.polroles as roles,
    pg_get_expr(p.polqual, p.polrelid) as using_expression,
    pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expression
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' 
AND c.relname = 'collaboration_sessions'
ORDER BY p.polname;

-- 4. Check table structure
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'collaboration_sessions'
ORDER BY ordinal_position;

