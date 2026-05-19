# CLOSE NOTE — ORCH-0881 Ve5 Menu AI Parser

> **Issue:** [#103](https://github.com/Mingla-LLC/mingla-main/issues/103)  
> **Branch:** `feat/ve5-menu-ai-parser-issue-103`  
> **Status:** Implementation complete — pending deploy + human smoke

---

## Shipped

### Backend
- Migration `20260623000000_orch_0881_ve5_hub_pending_actions.sql` — `source`, `related_brand_id`, nullable `conversation_id`
- `parse-restaurant-menu` edge function (JWT-only, Gemini structured JSON, ≤20 proposals)
- `create_experience` tool in `agentTools.ts` + `agent-confirm-action` hub-safe message logging

### Mobile
- Hub → Experiences route for verified Restaurant venues
- Menu snap (camera / library / PDF) → review cards → accept / edit / reject / accept all
- Live experiences list (`event_type='experience'`)

### Tests / CI
- `npm run test:orch-0881` (migration contract, gate matrix, service contract, tool contract)
- `I-VE5-PARSE-MENU-USER-JWT-ONLY` strict-grep gate

---

## Deploy checklist

1. Apply migration on remote Supabase
2. Deploy edge functions: `parse-restaurant-menu` (new), `agent-confirm-action` (updated)
3. Confirm `GEMINI_API_KEY_ARI` secret present
4. TestFlight build + issue #103 smoke test (verified restaurant account)

---

## Human smoke (issue #103)

1. Verified Restaurant brand → Hub → Experiences → CTA
2. Photograph/upload menu → ~15–30s loading
3. Review cards → edit 1, reject 2, accept rest (+ optional accept all)
4. Hub list populated
5. SQL: `events` with `event_type='experience'`; `agent_pending_actions` mix of statuses

---

## Deferred (per brief)

- Re-prompt / focus regenerate
- Recurrence scheduling per experience
- Per-experience photos
- Multi-language menus
