-- Query to check for enum types related to calendar_source
SELECT 
  t.typname AS enum_name,
  e.enumlabel AS enum_value
FROM pg_type t 
JOIN pg_enum e ON t.oid = e.enumtypid  
WHERE t.typname LIKE '%calendar%' OR t.typname LIKE '%source%'
ORDER BY t.typname, e.enumsortorder;

-- Query to check if calendar_entries.source column uses an enum
SELECT 
  c.table_name,
  c.column_name,
  c.data_type,
  c.udt_name,
  CASE 
    WHEN c.udt_name IN (SELECT typname FROM pg_type WHERE typtype = 'e') THEN 'ENUM'
    ELSE 'NOT ENUM'
  END AS is_enum_type
FROM information_schema.columns c
WHERE c.table_schema = 'public' 
  AND c.table_name = 'calendar_entries'
  AND c.column_name = 'source';

-- Query to check all constraints on calendar_entries.source
SELECT 
  tc.constraint_name,
  tc.constraint_type,
  cc.check_clause
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.check_constraints cc 
  ON tc.constraint_name = cc.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.table_name = 'calendar_entries'
  AND tc.constraint_type IN ('CHECK', 'FOREIGN KEY');

