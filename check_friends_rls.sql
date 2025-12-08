-- Query 1: Check if RLS is enabled on friends table
SELECT 
    schemaname,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename = 'friends';

-- Query 2: Get all RLS policies on the friends table
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd as command_type,  -- SELECT, INSERT, UPDATE, DELETE, or ALL
    qual as using_expression,  -- The USING clause (for SELECT, UPDATE, DELETE)
    with_check as with_check_expression  -- The WITH CHECK clause (for INSERT, UPDATE)
FROM pg_policies 
WHERE schemaname = 'public' 
AND tablename = 'friends'
ORDER BY policyname;

-- Query 3: Get detailed policy information from pg_policy (more detailed)
SELECT 
    p.polname as policy_name,
    p.polcmd as command_type,
    p.polpermissive as is_permissive,
    CASE p.polcmd
        WHEN 'r' THEN 'SELECT'
        WHEN 'a' THEN 'INSERT'
        WHEN 'w' THEN 'UPDATE'
        WHEN 'd' THEN 'DELETE'
        WHEN '*' THEN 'ALL'
    END as command_name,
    pg_get_expr(p.polqual, p.polrelid) as using_expression,
    pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expression,
    array_to_string(p.polroles::regrole[], ', ') as roles
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' 
AND c.relname = 'friends'
ORDER BY p.polname;

-- Query 4: Check the structure of the friends table
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
AND table_name = 'friends'
ORDER BY ordinal_position;

