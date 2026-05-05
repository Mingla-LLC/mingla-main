-- ORCH-0360: Clean up duplicate INSERT policy on messages table.
-- Migration 20250204000001 created "Users can send messages checking blocks"
-- which uses has_block_between() function.
-- Migration 20260409800000 created "Users can send messages to conversations
-- they participate in" with equivalent inline block checking via NOT EXISTS.
-- Both are permissive INSERT policies — PostgreSQL OR's them. Drop the older
-- one to avoid confusion. The newer policy is authoritative.
DROP POLICY IF EXISTS "Users can send messages checking blocks" ON public.messages;
