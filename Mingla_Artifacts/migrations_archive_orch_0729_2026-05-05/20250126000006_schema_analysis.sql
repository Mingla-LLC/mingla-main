-- SCHEMA ANALYSIS SCRIPT
-- This analyzes the existing schema to identify what needs to be fixed

-- 1. Check for missing tables that our new schema needs
SELECT 'Missing Tables Analysis' as analysis_type;

-- Check if we have the core tables we need
SELECT 
    'Core Tables Check' as check_type,
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'profiles' AND table_schema = 'public') 
         THEN 'EXISTS' ELSE 'MISSING' END as profiles,
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'experiences' AND table_schema = 'public') 
         THEN 'EXISTS' ELSE 'MISSING' END as experiences,
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'boards' AND table_schema = 'public') 
         THEN 'EXISTS' ELSE 'MISSING' END as boards,
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'saved_experiences' AND table_schema = 'public') 
         THEN 'EXISTS' ELSE 'MISSING' END as saved_experiences;

-- 2. Check for missing columns in existing tables
SELECT 'Column Analysis' as analysis_type;

-- Check profiles table structure
SELECT 
    'Profiles Table Columns' as table_name,
    string_agg(column_name, ', ' ORDER BY ordinal_position) as columns
FROM information_schema.columns 
WHERE table_name = 'profiles' AND table_schema = 'public';

-- Check boards table structure  
SELECT 
    'Boards Table Columns' as table_name,
    string_agg(column_name, ', ' ORDER BY ordinal_position) as columns
FROM information_schema.columns 
WHERE table_name = 'boards' AND table_schema = 'public';

-- Check saved_experiences table structure
SELECT 
    'Saved Experiences Table Columns' as table_name,
    string_agg(column_name, ', ' ORDER BY ordinal_position) as columns
FROM information_schema.columns 
WHERE table_name = 'saved_experiences' AND table_schema = 'public';

-- 3. Check for missing RLS policies
SELECT 'RLS Policies Analysis' as analysis_type;

SELECT 
    schemaname,
    tablename,
    CASE WHEN rowsecurity THEN 'RLS ENABLED' ELSE 'RLS DISABLED' END as rls_status
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('profiles', 'experiences', 'boards', 'saved_experiences', 'friends', 'messages')
ORDER BY tablename;

-- 4. Check for missing indexes
SELECT 'Index Analysis' as analysis_type;

SELECT 
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
AND tablename IN ('profiles', 'experiences', 'boards', 'saved_experiences', 'friends', 'messages')
ORDER BY tablename, indexname;

-- 5. Check for missing foreign key constraints
SELECT 'Foreign Key Analysis' as analysis_type;

SELECT 
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
AND tc.table_schema = 'public'
AND tc.table_name IN ('profiles', 'experiences', 'boards', 'saved_experiences', 'friends', 'messages')
ORDER BY tc.table_name;
