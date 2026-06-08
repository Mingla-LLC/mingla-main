# AUDIT — META-ORCH-1104 LANE D: Support Security / RLS / AuthZ Model

**Mode:** mingla-forensics INVESTIGATE/AUDIT (adversarial, security-first)
**Lane:** D — the authorization model for support_case access across three clients
**Date:** 2026-06-08
**Method:** live `pg_policies` / `pg_proc` / table-ACL queries against production DB + file:line code reads
**Scope:** READ-ONLY. No code edited. No migration applied.

> Central question: how is a support staffer (admin on PC, or a toggled business-app user on
> phone) authorized to read+write into ANY user's support conversation, while a normal business
> user or a normal Explorer CANNOT see other people's support cases?

---

## EXECUTIVE SUMMARY

- The chat substrate (`conversations`/`messages`/`conversation_participants`/`message_reads`/`conversation_presence`)
  is **participant-gated** via `SECURITY DEFINER` helpers `is_conversation_participant()` and
  `is_conversation_brand_team_member()`. A non-participant sees nothing. This is the right
  default for support privacy.
- The PC admin desk has **NO blanket cross-user read**. It uses the **anon key under RLS**
  (`mingla-admin/src/lib/supabase.js:14`) and reaches arbitrary users' data **only** through
  `admin_*` **SECURITY DEFINER RPCs** and `admin-*` **edge functions**, each of which re-asserts
  `is_admin_user()`. There is no admin-scoped RLS policy on the chat tables, and the admin client
  does **not** hold the service-role key.
- There is **no `is_support_staff()` helper today** (confirmed: zero `support`/`staff`/`operator`
  functions exist besides PostGIS). A new one must be built, mirroring `is_admin_user()`.
- **Recommended model:** a dedicated `support_staff` table + an `is_support_staff()`
  SECURITY-DEFINER helper + **`support`-aware RLS policies** on the chat tables (option b),
  with **claim-time participant insertion** (option a) as a defense-in-depth convenience — NOT
  as the sole authorization. Cross-client writes route through `support-*` edge functions that
  gate on `is_admin_user() OR is_support_staff()`, mirroring `admin-review-venue-claim`.

---

## FINDING D1 — Current RLS on the chat substrate (the support access control model)

Pulled live from `pg_policies` for all five tables. Every predicate resolves through
SECURITY-DEFINER membership helpers (definitions in D1.6).

### D1.1 `conversations`
| cmd | policy | predicate |
|---|---|---|
| INSERT | "Users can create conversations" | `with_check: created_by = auth.uid()` |
| SELECT | "Users can view conversations they participate in" | `created_by = auth.uid() OR is_conversation_participant(id, auth.uid())` |
| SELECT | "Users can view their conversations" | `is_conversation_participant(id, auth.uid())` |
| SELECT | `conversations_brand_team_member_read` | trip/event + `event_id` + accepted, non-removed `brand_team_members` row for that event's brand |
| UPDATE | `conversations_brand_team_member_update` | same brand-team predicate (both `qual` + `with_check`) |

### D1.2 `conversation_participants`
| cmd | policy | predicate |
|---|---|---|
| INSERT | `conversation_participants_direct_self_add` | `with_check: user_id = auth.uid() AND is_direct_conversation(conversation_id)` — **you may only add YOURSELF, and only to a `direct` conversation** |
| SELECT | "Users can view participants in their conversations" | `user_id = auth.uid() OR is_conversation_participant(conversation_id, auth.uid())` |
| SELECT | `conversation_participants_brand_team_member_read` | `is_conversation_brand_team_member(...)` |
| UPDATE | "Users can update their own participation" | `user_id = auth.uid()` (both sides) |
| DELETE | `conversation_participants_brand_team_member_delete` | `is_conversation_brand_team_member(...)` |

> **Critical for LANE D:** the only client-side participant-INSERT path is self-add to a
> `direct` conversation. A support staffer **cannot** add themselves to someone else's
> support conversation through this policy (it'll be `type='support'`/`group`, not `direct`,
> and even for direct it only lets you add your own row). Therefore "auto-add staffer as
> participant on claim" (proposal option a) **must run through a SECURITY DEFINER RPC / edge
> function with service role** — it cannot be a plain client insert.

### D1.3 `messages`
| cmd | policy | kind | predicate |
|---|---|---|---|
| INSERT | "Users can send messages…" | PERMISSIVE | `sender_id = auth.uid()` AND caller is a `conversation_participants` row AND neither party has blocked the other (`blocked_users` check) |
| INSERT | `messages_brand_team_member_insert` | PERMISSIVE | `sender_id = auth.uid() AND is_conversation_brand_team_member(...)` |
| INSERT | `messages_broadcast_only_enforcement` | **RESTRICTIVE** | `can_insert_message_into_conversation(conversation_id, auth.uid())` — AND-ed on top of every INSERT |
| SELECT | "Users can view messages in conversations" / "…in their conversations" | PERMISSIVE | participant of the conversation; first variant also requires `deleted_at IS NULL` |
| SELECT | `messages_brand_team_member_read` | PERMISSIVE | `deleted_at IS NULL AND is_conversation_brand_team_member(...)` |
| UPDATE | "Users can update their own messages" / `messages_brand_team_member_update` | | own message (`sender_id`), or brand-team-member |
| DELETE | "Users can delete their own messages" | | `sender_id = auth.uid()` |

> The **RESTRICTIVE** `messages_broadcast_only_enforcement` policy is AND-ed with the permissive
> INSERTs: a new `support`-staff INSERT path must satisfy BOTH a new permissive policy
> AND `can_insert_message_into_conversation()`. That helper currently passes any conversation
> whose `linked_entity_type` is not trip/event, so a `support` conversation passes it freely —
> good, but the SPEC must verify it stays true after adding `'support'`.

### D1.4 `message_reads`
- ALL: "Users can mark messages as read" → `user_id = auth.uid()`.
- SELECT: read receipts visible if you are a participant of the message's conversation.

### D1.5 `conversation_presence`
- SELECT: "Participants can read conversation presence" → `EXISTS conversation_participants cp WHERE cp.conversation_id = ... AND cp.user_id = auth.uid()` — **participant-gated**.
- INSERT/UPDATE: own presence only (`auth.uid() = user_id`).

> Live-chat presence already works (proposal Finding E2). But because presence-read is
> participant-gated, a staffer must be a participant (or a new support policy must extend it) to
> see the requester's typing/online state.

### D1.6 Membership helper definitions (all `SECURITY DEFINER`, `STABLE`)
- `is_conversation_participant(conv_id, u_id)` → `EXISTS(SELECT 1 FROM conversation_participants WHERE conversation_id=conv_id AND user_id=u_id)`.
- `is_conversation_brand_team_member(conv_id, u_id)` → joins `conversations→events→brand_team_members`, requires `linked_entity_type IN ('trip','event')`, `event_id NOT NULL`, `accepted_at NOT NULL`, `removed_at IS NULL`. **This path is event/trip-only — it will NOT cover a `support` conversation** (no `event_id`), so support staff get zero access through the brand-team path.
- `is_direct_conversation(p_conversation_id)` → `type='direct'`.
- `can_insert_message_into_conversation(...)` → passes unless trip/event broadcast-only and not a brand-team-member.

**D1 conclusion:** the substrate is strictly participant-membership-gated. A `support_case`
conversation inherits this: only the requester (a participant) sees it. **Nothing today grants a
support staffer access to a conversation they are not a participant of.** That access must be
purpose-built in LANE-D's authz layer.

---

## FINDING D2 — How admin/staff get cross-user access TODAY (the PC desk mechanism)

**The admin web app uses the ANON key under RLS — NOT the service-role key.**
- `mingla-admin/src/lib/supabase.js:3` reads `VITE_SUPABASE_ANON_KEY`; line 14 `createClient(url, supabaseAnonKey, …)`. There is no service-role key anywhere in the browser bundle (correct — it must never ship to a client).
- Table ACLs confirm `anon`/`authenticated`/`service_role` all hold `arwdDxtm` on `conversations`/`messages`/`conversation_participants`/`admin_users`, so **RLS — not grants — is the only gate** for the admin client.

**So how does admin read arbitrary users' data?** Two mechanisms, both re-asserting admin identity server-side:

1. **SECURITY DEFINER `admin_*` RPCs.** ~70 `admin_*` functions exist, all `SECURITY DEFINER` (e.g. `admin_list_subscriptions`, `admin_analytics_*`, `get_admin_emails`). They run as the function owner (bypassing RLS) and re-check `is_admin_user()` internally before returning cross-user rows.
2. **`admin-*` edge functions** that authenticate the caller and gate on `is_admin_user()` — canonical pattern at `supabase/functions/admin-review-venue-claim/index.ts:237-253` (see D4).

**The identity helper:** `is_admin_user()` (SECURITY DEFINER, STABLE) — reads the caller's email from `auth.users WHERE id=auth.uid()`, then `EXISTS(SELECT 1 FROM admin_users WHERE email=v_email AND status='active')`. This is the SQL source of truth for "is the caller an admin."
- Note: `admin_users` is **email-keyed, not `auth.uid`-keyed** (matches proposal Finding E4). `is_admin_user()` bridges uid→email→admin_users at runtime.
- `admin_users` RLS itself is self-referential: `is_admin_user()` (or `auth.email()` ∈ active admins) gates read/insert/update/delete — so only admins can see the admin list.

**D2 conclusion:** there is **no admin-scoped RLS policy on the chat tables** and **no service-role
in the admin client**. The PC desk reads tickets by calling **SECURITY DEFINER RPCs / edge
functions that re-assert `is_admin_user()`**. A `support_*` RPC/edge fn for the desk must follow
the identical pattern.

---

## FINDING D3 — Staff-on-phone authZ (the hard one)

A toggled business-app user must read+write support conversations they are not a normal
participant of. The substrate (D1) gives them nothing by default. Three candidate mechanisms,
evaluated against how this codebase already does cross-cutting access (D2):

### Option (a) — auto-add staffer as a `conversation_participant` on claim
- **Pro:** once added, ALL existing participant-gated policies (read messages, presence, read receipts, send) "just work" with zero new policy. Realtime channels keyed on participant membership work unchanged.
- **Con / blocker:** the client **cannot** self-insert into someone else's `group`/`support` conversation — `conversation_participants_direct_self_add` (D1.2) only permits self-add to a `direct` conversation. So the insert MUST go through a **SECURITY DEFINER RPC / service-role edge function**. Also pollutes participant semantics (a staffer appears as a "member"), complicates "who is the requester," and a closed/reassigned case leaves stale participant rows unless explicitly removed.

### Option (b) — `support`-aware RLS policies (RECOMMENDED primary)
- Add policies on `conversations`/`messages`/`conversation_participants`/`presence` of the form:
  `(linked_entity_type = 'support') AND public.is_support_staff(auth.uid())` for SELECT/INSERT/UPDATE.
- **This is the EXACT pattern the codebase already uses for brand-team access** (`conversations_brand_team_member_read`, `messages_brand_team_member_insert`, etc., D1) — a feature-scoped predicate + a SECURITY DEFINER membership helper. It is the proven, idiomatic mechanism here.
- **Pro:** no participant-row pollution; staff access is purely a function of staff status + conversation being a support case; revoking staff instantly revokes access; mirrors the `is_conversation_brand_team_member` design 1:1.
- **Con:** the message-INSERT RESTRICTIVE policy (`messages_broadcast_only_enforcement`) is AND-ed on top — verify `can_insert_message_into_conversation` passes `'support'` conversations (it does today, since they're not trip/event). Realtime: postgres_changes subscriptions honor RLS, so a support-policy SELECT lets staff stream the thread without being a participant — but **broadcast/presence channels keyed on participant membership won't include the staffer** unless the channel authz also recognizes support staff (see D5 abuse note + presence policy D1.5).

### Option (c) — SECURITY DEFINER RPC / edge function with service role for every read+write
- **Pro:** maximal control + audit; matches admin desk exactly (D2).
- **Con:** loses realtime — a staffer reading via RPC can't subscribe to `postgres_changes` on `messages` (RLS would still block the realtime SELECT). You'd need broadcast-only relay. Heavier for a live-chat UX.

### Recommended hybrid
1. **Identity:** new `support_staff` table (`user_id PK, enabled bool, available bool, role, ...`) + new helper **`public.is_support_staff(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER`** mirroring `is_conversation_brand_team_member` / `is_admin_user`. Admin-only writes to `support_staff` (gate inserts/updates with `is_admin_user()`), so a normal user can't self-promote. Treat admins as implicitly support-capable: `is_admin_user() OR is_support_staff(auth.uid())`.
2. **Read + realtime stream:** option (b) RLS policies on the chat tables scoped to `linked_entity_type='support' AND (is_support_staff(auth.uid()) OR is_admin_user())`. This gives both PC and phone staff RLS-honored realtime SELECT without participant pollution.
3. **Claim + first staff reply:** a **`support-claim` / `support-send` edge function** (service-role, re-asserts staff identity) sets `assigned_agent_id` and, optionally, inserts the staffer as a participant (option a) **as a convenience for presence/read-receipt parity** — defense-in-depth, never the sole gate.
4. **Presence:** extend the `conversation_presence` SELECT policy with a support-staff branch, OR add the staffer as a participant on claim (option a convenience) so presence "just works."

**No existing `is_support_staff()` / `support_*` / `staff_*` SQL helper exists** (live `pg_proc`
scan returned only PostGIS `*support*` functions). It is greenfield, modeled on `is_admin_user()`.

---

## FINDING D4 — Edge function authZ pattern (the `support-*` template)

Canonical caller-auth + role-gate, verbatim from `supabase/functions/admin-review-venue-claim/index.ts:237-253`:

```ts
const authHeader = req.headers.get("authorization");
if (!authHeader) return json({ error: "No authorization header" }, 401);
const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { headers: { Authorization: authHeader } },   // caller's JWT
});
const { data: { user }, error: userErr } = await userClient.auth.getUser();
if (userErr || !user) return json({ error: "Unauthorized" }, 401);
const { data: isAdmin } = await userClient.rpc("is_admin_user");  // role re-asserted in DB
if (isAdmin !== true) return json({ error: "Forbidden" }, 403);
// privileged work then runs through SECURITY DEFINER RPCs (re-asserting role) on userClient,
// OR a service-role client (SUPABASE_SERVICE_ROLE_KEY) for writes that must bypass RLS.
```

Pattern requirements a `support-*` edge function MUST follow:
- **Two clients:** a `userClient` (anon key + caller `Authorization` header) for identity + RLS-bound reads, and a service-role client **only** for the privileged write (insert participant on claim, set `assigned_agent_id`, send-as-staff). Never expose service-role to the client (D2).
- **Role gate:** call a new `is_support_staff` RPC (or `is_admin_user() OR is_support_staff()`); 401 if no user, 403 if not staff.
- **`verify_jwt`:** `supabase/config.toml` sets `verify_jwt` per function (mix of true/false today). A `support-*` function that does its own `getUser()` + role check can keep `verify_jwt=true` for defense-in-depth (gateway rejects unsigned tokens before the function runs).
- **Push:** reuse `_shared/push-utils.ts` `sendPush` / `dispatchNotification` (the latter imported from `_shared/stripeEdgeAuth.ts`, used by `admin-review-venue-claim`).

### COMMS-0002 — MANDATORY backend strict-grep allowlist (BLOCKING)
COMMS-0002 (status OPEN, last-touched 2026-06-08; `COMMS_LEDGER.md:59`) and the ORCH-0863
`no-new-backend-files` (C7) strict-grep gate mean **any new `supabase/functions/*` file or new
`supabase/migrations/*.sql` will FAIL CI unless a `META_ORCH_1104_BACKEND_ALLOWLIST` entry is
added in the SAME commit**, in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`
(precedent: ORCH-1064/1066/1072 each added their own `*_BACKEND_ALLOWLIST` block alongside the
migration). The SPEC must require this for every `support-*` edge function, the support migrations,
and the `is_support_staff` helper.

---

## FINDING D5 — Abuse / privacy surface + mandatory authZ checks

**What stops a normal Explorer from reading another Explorer's support case?**
- The participant-gated SELECT policies (D1). Explorer B is not a `conversation_participant` of
  Explorer A's `support` conversation and is not support staff → `is_conversation_participant`
  false, brand-team path is event/trip-only (false), no support policy matches → **zero rows**.
- The only client participant-INSERT (`conversation_participants_direct_self_add`) requires
  `type='direct'` and `user_id=auth.uid()`, so a malicious Explorer cannot insert themselves into
  someone else's support case to gain access.
- **Risk to watch:** if `support_tickets` (the new domain table) has its own RLS, the requester
  policy must be `requester_user_id = auth.uid() OR is_support_staff() OR is_admin_user()` — NOT a
  blanket authenticated read. And the message-thread `conversation_id` must never be guessable into
  access (it isn't — access is by membership, not by knowing the id).

**What stops a non-staff business user from opening the Live Chats inbox?**
- A `brand_team_members` row (role `brand_owner`) grants brand/event access ONLY — the brand-team
  helper is event/trip-scoped (D1.6) and does **not** match `linked_entity_type='support'`. So a
  business owner gets **no** support-case access from their brand membership.
- The inbox itself must be gated client-side AND server-side on `is_support_staff(auth.uid())` (or
  admin). The client gate is cosmetic; the **server `is_support_staff` RLS/RPC gate is the real
  boundary** — never trust the business-app toggle UI alone. The `support_staff.enabled` flag is
  the toggle's persisted truth; writes to it must be admin-gated.

**PII / privacy considerations:**
- Support staff reading arbitrary users' messages is a real PII exposure. Mandate: (1) an
  **audit-log row per staff read/claim/reply** (the codebase has `admin_audit_log` — reuse or add
  `support_audit_log`); (2) scope staff visibility to `linked_entity_type='support'` conversations
  ONLY — the support policy must NOT accidentally widen staff into users' `direct`/`group`/event
  DMs; (3) `available`/`enabled` gating so off-duty staff don't receive `support_message` pushes
  carrying message previews (push payload should minimize PII).

### Mandatory authZ checks the SPEC MUST require
1. New `support_staff` table; writes (enable/disable/grant) gated by `is_admin_user()` only.
2. New `is_support_staff(p_user_id uuid)` SECURITY DEFINER STABLE helper, modeled on `is_admin_user()` / `is_conversation_brand_team_member()`.
3. Chat-table support policies scoped to `linked_entity_type='support' AND (is_support_staff(auth.uid()) OR is_admin_user())` for SELECT/INSERT/UPDATE — and verify the RESTRICTIVE `messages_broadcast_only_enforcement` still passes `'support'` conversations.
4. `support_tickets` RLS: requester sees own (`requester_user_id=auth.uid()`); staff/admin see all; nobody else.
5. Every `support-*` edge function: `getUser()` → 401, then `is_support_staff()`-or-`is_admin_user()` RPC → 403; service-role used only for the privileged write; never ship service-role to a client.
6. Claim-time participant insertion (if used) runs ONLY through a SECURITY DEFINER RPC / service-role edge fn — never a client insert (the self-add policy forbids it anyway).
7. Audit-log every staff claim/read/reply; minimize PII in push payloads; off-duty (`available=false`) staff excluded from new-ticket pushes.
8. COMMS-0002: `META_ORCH_1104_BACKEND_ALLOWLIST` entry in the same commit as every new edge fn / migration.
9. Presence: support staff need either a participant row (option a) or an extended presence SELECT policy to see requester presence; pick one explicitly.

---

## RECOMMENDED AUTHORIZATION MODEL (three clients)

| Client | Identity | Read path | Write path |
|---|---|---|---|
| **Explorer requester** (app-mobile) | `auth.uid()` = `requester_user_id` | participant-gated RLS (already works) on their own support conversation | normal `messages` INSERT (they're a participant) |
| **PC admin** (mingla-admin) | anon key + JWT → `is_admin_user()` | `support-*` SECURITY DEFINER RPC / edge fn re-asserting admin (D2 pattern), OR support RLS policy treating admins as staff | `support-send` edge fn (service-role write) re-asserting `is_admin_user()` |
| **Phone staffer** (mingla-business) | anon key + JWT → `is_support_staff(auth.uid())` | support-scoped RLS policy (option b) → RLS-honored realtime SELECT, no participant pollution | `support-claim` + `support-send` edge fns (service-role), re-asserting `is_support_staff()`; optional claim-time participant insert for presence parity |

**Single source of truth for "who is staff":** the new `support_staff` table, admin-managed,
surfaced through `is_support_staff()`. "Who is admin" stays `admin_users` via `is_admin_user()`.
Admins are implicitly support-capable (`is_admin_user() OR is_support_staff()`).

---

## EVIDENCE INDEX
- RLS policies: live `pg_policies` for the 5 chat tables + `admin_users` (D1, D2).
- Helper bodies: live `pg_proc` `pg_get_functiondef` for `is_admin_user`, `is_admin_email`, `is_conversation_participant`, `is_conversation_brand_team_member`, `is_direct_conversation`, `can_insert_message_into_conversation` (D1.6, D2).
- Table ACLs: live `pg_class.relacl` — anon/authenticated/service_role all `arwdDxtm` → RLS is the gate (D2).
- Admin client uses anon key: `mingla-admin/src/lib/supabase.js:3,14,26-27` (D2).
- Edge auth pattern: `supabase/functions/admin-review-venue-claim/index.ts:237-253` (D4).
- No existing support/staff helper: live `pg_proc` scan returned only PostGIS `*support*` fns (D3).
- `brand_team_members` only role today = `brand_owner` (live `DISTINCT role`) — supports the "don't overload brand role" recommendation (D3, proposal §3.1).
- `verify_jwt` per-function: `supabase/config.toml:4-42` (D4).
- COMMS-0002 backend allowlist gate: `COMMS_LEDGER.md:59` (status OPEN) + `scripts/ci-check-invariants.sh` ALLOWED_REGEX precedent (D4).
