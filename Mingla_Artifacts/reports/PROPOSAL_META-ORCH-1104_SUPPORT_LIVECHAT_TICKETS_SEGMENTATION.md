# META-ORCH-1104 — Support Live-Chat + Tickets + User Segmentation (BRAINSTORM / PRE-SPEC)

**Status:** INTAKE — brainstorm, not yet scoped or dispatched
**Registered:** 2026-06-08
**Owner:** mingla-orchestrator + Seth (operator)
**Classification:** missing-feature (new product surface)
**Severity:** S2-medium (no launch dependency; high operational value)

> This is a brainstorming proposal. Nothing here is committed. It exists to anchor the
> shared understanding and the open forks before any SPEC is written.

---

## 1. Shared understanding (what Seth asked for)

Five distinct asks, one connected system:

1. **Consumer support entry** — a "Help & Support" surface on the app-mobile account page where an Explorer can start a **live chat** and/or **create a ticket**.
2. **Admin agent desk (PC)** — those live chats and tickets route to the admin web app (`mingla-admin`) so Seth can handle support from his computer.
3. **Business-app support-agent mode (phone)** — a **support tag/toggle** that, when ON for a chosen business-app user (Seth, cofounder, future hires), unlocks a **"Live Chats" inbox** inside the business app: push notifications for incoming chats, switch between conversations, reply, and create/manage tickets — a full mobile support console. Same queue the PC sees.
4. **Business users get support too** — business-app users are also Mingla customers and need their own "Help & Support" entry to reach the same support team.
5. **Admin user segmentation** — the admin Users page segments everyone into **Explorer users / Business users / Admin users** (and is built to add more segments later).

The unifying idea: **one shared support queue** with **two agent clients** (admin web on PC, business app on phone) and **two requester surfaces** (consumer app, business app).

---

## 2. What already exists (reuse map — do NOT reinvent)

Forensics sweep 2026-06-08 confirmed the plumbing is largely already built:

| Capability | Status | Reuse path |
|---|---|---|
| Unified chat substrate (`conversations`, `messages`, `conversation_participants`, `message_reads`) | LIVE (ORCH-0898) | A support ticket OWNS a conversation; messages flow through the existing table. `supabase/migrations/20260624000000_orch_0898_unified_chat_substrate.sql` |
| Chat UI components (MessageBubble, TypingIndicator, ReplyQuote, read receipts) | LIVE | `app-mobile/src/components/chat/` — reuse for both requester + agent UIs |
| Canonical messaging service | LIVE | `app-mobile/src/services/messagingService.ts` |
| Realtime (postgres_changes + broadcast, channel naming) | LIVE | `app-mobile/src/services/realtimeService.ts` — new channel `support:ticket:{id}` |
| Push fan-out (OneSignal) | LIVE | `supabase/functions/notify-message` → `notify-dispatch` + `_shared/push-utils.ts`; add new types `support_new_ticket`, `support_message` |
| Notification preferences (per-user, per-type opt-in) | LIVE | `notification_preferences` table |
| Admin Users page (list, detail, filters, bulk actions, CSV export) | LIVE | `mingla-admin/src/pages/UserManagementPage.jsx` — add segment filter/tabs |
| Admin role model | LIVE | `admin_users(email, role owner/admin)` |
| Consumer account settings sheet | LIVE | `app-mobile/src/components/profile/AccountSettings.tsx` — add "Help & Support" section |
| Business account page + sub-pages | LIVE | `mingla-business/app/(tabs)/account.tsx` + `app/account/*` |

**Net:** the messaging engine, realtime, push, and admin shell already exist. The new work is a **support-ticket domain model on top of them**, three new UI surfaces, and a segmentation view. This is integration, not greenfield.

---

## 3. Proposed architecture (recommended defaults)

### 3.1 Data model — unify "live chat" and "ticket" into ONE entity

A **support ticket** is the unit. Every support interaction (a quick live chat or a filed
async ticket) is a ticket with a status. "Live chat" is just a ticket whose participants
are both present in realtime; "ticket" is the same row when the requester has left and an
agent replies later. This avoids building two parallel systems.

```
support_tickets
  id, requester_user_id, requester_segment (explorer|business),
  subject, status (new|open|pending|resolved|closed),
  priority (low|normal|high|urgent),
  assigned_agent_id (nullable),
  conversation_id  -> conversations.id (the message thread),
  brand_id (nullable, if raised from a business context),
  created_at, first_response_at, resolved_at, last_message_at

support_agents
  user_id (PK), enabled (bool), display_name, role (agent|lead),
  available (presence/availability toggle), created_at
```

- The message thread reuses `conversations` + `messages` (linked_entity_type = `'support'`).
- `support_agents` is a **dedicated table decoupled from brand membership** — Seth,
  cofounder, and future hires each get a row. The business-app "support toggle" flips
  `enabled`/`available`. Admin grants/revokes the agent capability. (Recommended over
  overloading `brand_team_members.role`, which would wrongly tie support staffing to a brand.)

### 3.2 Two agent clients, one queue

Both `mingla-admin` (PC) and the business-app "Live Chats" inbox are **clients of the same
`support_tickets` + `messages`**. An agent can pick up a chat on the PC or the phone
interchangeably. Realtime keeps both in sync.

### 3.3 Routing (v1) — shared-queue claim model

All tickets land in ONE shared queue. Every enabled+available agent sees the queue and gets
notified of new tickets; anyone can **claim** (sets `assigned_agent_id`). No round-robin, no
business-hours, no topic routing in v1 — those are v2. This is the simplest model that lets
Seth + cofounder both work the queue from anywhere.

### 3.4 Segmentation — derived, single source of truth

A read-only DB view computes each user's segment instead of denormalizing a column that can
drift:

```
explorer  = profile exists, no brand_team_members row, not admin
business  = has an accepted brand_team_members row
admin     = profiles.is_admin OR present in admin_users
```

The admin Users page gets segment tabs + counts + a filter, reading this view. (A user can be
both business and admin — surface the highest-privilege badge, but allow filtering by any.)

### 3.5 Notifications & presence

- New push types `support_new_ticket` (to all available agents) and `support_message` (to the
  assigned agent + the requester) via the existing `notify-message`/`notify-dispatch` path.
- Agent **availability** toggle gates who gets `support_new_ticket` — off-shift agents aren't
  pinged. Requester always gets `support_message` for replies.

---

## 4. Open forks for Seth (brainstorm)

1. **Anonymous / buyer-web support in v1?** Recommend **defer** — v1 is auth-only (logged-in
   Explorers + business users). Anonymous buyers on the web checkout reaching support is a
   bigger lift (identity, abuse) and can be a fast-follow.
2. **Unify chat+ticket vs two systems?** Recommend **unify** (§3.1).
3. **Agent identity: dedicated `support_agents` table vs brand-role overload?** Recommend
   **dedicated table** (§3.1).
4. **Routing v1: shared-queue claim vs assignment/round-robin?** Recommend **shared-queue claim** (§3.3).
5. **First shippable slice** — see phasing below.

---

## 5. Proposed phasing (META-ORCH → sub-ORCHs)

| Sub | Title | Surfaces | Why this order |
|---|---|---|---|
| **Phase 0** | Support domain model + RLS + `support_agents` + segment view | backend-only | Everything depends on it |
| **Phase A** | Consumer "Help & Support" → live chat + ticket creation | app-mobile (iOS+Android) | The requester side; proves the loop |
| **Phase B** | Admin agent desk + segmentation | admin web | Lets Seth handle support from PC end-to-end |
| **Phase C** | Business-app support-agent mode (toggle + Live Chats inbox + push) | business iOS+Android | The phone console |
| **Phase D** | Business user's own "Help & Support" entry | business iOS+Android | Business users file tickets too |
| **Phase E** | Presence/availability + routing polish + SLAs | backend + both agent clients | v2 hardening |

**Recommended first shippable milestone:** Phase 0 + A + B together = support works end-to-end
(Explorer files → Seth answers on PC). Then C (phone console) + segmentation can ship as the
business-app already needs an OTA. Segmentation (part of B) is small and high-value — could even
front-run as a quick standalone win if Seth wants immediate value.

---

## 6. Affected Surfaces (full META scope)

- Consumer iOS (`app-mobile/`) — Phase A
- Consumer Android (`app-mobile/`) — Phase A
- Business iOS (`mingla-business/`) — Phases C, D
- Business Android (`mingla-business/`) — Phases C, D
- Admin Web (`mingla-admin/`) — Phase B
- Backend (`supabase/`) — Phases 0, E

**Explicitly NOT in scope (v1):** Buyer/anonymous Web — deferred (fork #1). Business Web preview — no support surface planned for the dev/web preview.

---

## 6.5 EVIDENCE ADDENDUM (live DB + code, verified 2026-06-08)

These findings come from querying the live production DB and reading the actual files —
they **correct** the second-hand reuse summary in §2 and reshape the recommendations.

### Finding E1 — "ticket" and "agent" are ALREADY taken (naming collision risk)
- `tickets`, `ticket_types`, `ticket_checkout_sessions`, `ticket_order_notifications` = **event money ticketing**, not support. A support entity named `tickets` would be catastrophic.
- `agent_conversations`, `agent_messages`, `agent_user_profile`, `agent_pending_actions` = **the ARI AI agent**. Human support staff must NOT be called "agents" in schema.
- **Correction to §3.1:** name the entities `support_cases` (or `support_threads`) and `support_staff` (or `support_operators`) — never `tickets`/`agents`. In the UI we can still *say* "tickets" to users; the schema must not collide.

### Finding E2 — chat substrate is real and support-ready
- `conversations` carries `type` (direct/group) + `linked_entity_type` (currently direct/event/session/trip). Adding `'support'` is a natural extension.
- `conversation_presence` table exists with live usage (`app-mobile/src/hooks/useChatPresence.ts` + `chatPresenceService.ts`) — **live-chat presence already works**, no need to build it.
- Volume is tiny (153 conversations, 106 messages) — substrate is healthy, zero migration risk. §3.2 confirmed.

### Finding E3 — `notification_preferences` is BOOLEAN COLUMNS, not per-type rows
- Real columns: `messages, reminders, marketing, friend_requests, link_requests, collaboration_invites, push_enabled, email_enabled, dm_bypass_quiet_hours`.
- **Correction to §2/§3.5:** a support notification toggle = a NEW boolean column (e.g. `support_replies`), or it rides the existing `messages` boolean. Not a new row type.

### Finding E4 — segmentation field EXISTS but is unreliable, and the three "admin truths" DISAGREE
The admin Users page already segments informally: it filters the user list with
`account_type.neq.admin OR account_type.is.null` (hides admin accounts) and excludes `is_seed`.
But the data shows the truth is fractured:

| Source of "who is what" | What the data says |
|---|---|
| `profiles.account_type` | 35 null, 1 `'admin'`, 2 `'business'` (of 38) — **92% unpopulated, unusable as truth** |
| `profiles.is_admin` | **0 rows true** — dead column |
| `admin_users` (email-keyed) | **5 rows** — the real admin list, but NOT linked to profiles by id |
| `brand_team_members` (accepted, not removed) | **13 distinct users** — the real business-user truth |

So **business truth ≠ `account_type='business'` (13 vs 2)** and **admin truth is represented THREE
incompatible ways (1 vs 0 vs 5)**. This is a five-truth-layer contradiction.

- **Correction to §3.4:** segments MUST be **derived** from the authoritative tables:
  - **Business** = has an accepted `brand_team_members` row (13), not `account_type`.
  - **Admin** = email ∈ `admin_users` (5) — reconcile/retire `is_admin` and `account_type='admin'`.
  - **Explorer** = neither, and not `is_seed`.
- Optional hardening: backfill `account_type` from the derived view so the existing admin filter stops lying, and pick ONE admin source of truth (recommend `admin_users`). This is a real root-cause cleanup, not just a feature add.

### Finding E5 — no in-app support exists at all today
"Contact support" = a static `support@mingla.app` mailto + Stripe KYC remediation copy. Greenfield UX, but on top of mature messaging/realtime/push/admin plumbing. The build is integration, not invention.

---

## 7. Process notes

- COMMS-0002 (WARN/ALL): every new edge function or migration must add a backend strict-grep
  allowlist entry in the SAME commit — applies to Phases 0 and E.
- This is a META-ORCH; each phase is its own worktree + PR per the one-PR-per-CLOSE rule.
- No code written yet. Next step is locking the forks in §4, then dispatching Phase 0 SPEC to
  `mingla-forensics`.
