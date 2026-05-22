# IMPLEMENTATION — Conversation RLS Recursion Hotfix

**Status:** implemented, not applied to live DB by Codex  
**Branch:** `HOTFIX-CONVERSATION-RLS-RECURSION-CLEAN`
**Date:** 2026-05-21  
**User-visible symptom:** iOS redbox in `ConnectionsPage.tsx` with `infinite recursion detected in policy for relation "conversations"`  

## Root Cause

The app fetches conversations with embedded `conversation_participants` and `messages`. The live Supabase policy graph contains circular RLS references:

- `conversations` SELECT policies read `conversation_participants`.
- `conversation_participants_brand_team_member_read` reads `conversations`.
- `messages_brand_team_member_read` also reads `conversations`.

When Postgres evaluates the embedded fetch, it can enter `conversations -> conversation_participants/messages -> conversations`, triggering the RLS recursion detector.

## Change

Added migration:

- `supabase/migrations/20260704000000_hotfix_conversation_rls_recursion.sql`

The migration keeps the same access intent but moves cross-table policy predicates behind `SECURITY DEFINER` helpers with fixed `search_path`:

- `public.is_direct_conversation(uuid)`
- `public.is_conversation_brand_team_member(uuid, uuid)`
- `public.can_insert_message_into_conversation(uuid, uuid)`

It then rewrites the recursive policies so:

- `conversations` uses `public.is_conversation_participant(...)` instead of inline `conversation_participants` subqueries.
- `conversation_participants` brand/self-add policies no longer query `conversations` directly.
- `messages` brand/broadcast policies no longer query `conversations` directly.

## Verification

```text
npm run test:conversation-rls-hotfix
PASS T-01 through T-06

npm run test:orch-0898
PASS 22/22

npm run test:orch-0898-adv
PASS 15/15

npm run test:orch-0901
PASS 13/13

git diff --check
PASS

node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
PASS

supabase migration list --linked
REMOTE includes 20260704000000; local migration filename intentionally matches the remote-applied version.
```

## Deployment Note

Codex did not mutate live Supabase. The linked remote migration history already reports `20260704000000` as applied, so this PR keeps that filename to make repo history match Supabase history and unblock Supabase Preview. If an environment still lacks the migration, the operator should run it through the normal DB migration path.
