# Cycle B6 — Backend: chat agent (M19+ from old plan)

**Phase:** Phase 7 — Post-MVP
**Estimated effort:** ~100 hrs
**Status:** ⬜ PLACEHOLDER (post-MVP — chat-agent gate is non-negotiable per §U.0 PRD)
**Codebase:** `supabase/` + `mingla-business/`

## Scope

The chat agent surface — bottom-nav menu in mingla-business, agent capabilities sit ON TOP of the structured event-creation system. Agent never replaces the DB-source-of-truth contract. Use cases: drafting events from natural language, generating marketing copy, suggesting tickets, AI guest psychology.

## Journeys (to refine)

- J-B6.1 — Chat menu in bottom nav (replaces or augments existing tabs?)
- J-B6.2 — Agent foundation (LLM provider — Claude / GPT-4o / etc., context construction, validation rails)
- J-B6.3 — Draft event from chat (agent fills DraftEvent fields; user reviews + commits)
- J-B6.4 — Marketing copy + asset generation
- J-B6.5 — Ticket suggestions (price + capacity recommendations)
- J-B6.6 — AI guest psychology (post-event analytics + recommendations)

## References

- BUSINESS_PRD §U.0 (agent gate), §U.1–U.14 (agent use cases)
- `Mingla_Artifacts/project_business_chat_agent_strategy.md`
- Strategic Plan R6 (chat agent built too early)

## Notes

**Hard rule:** no agent code merges before all of cycles 0a–17 + B1–B4 are signed off as private-beta-ready. This is non-negotiable per §U.0. The product must work fully without the agent. The agent is a productivity layer, not a replacement.
