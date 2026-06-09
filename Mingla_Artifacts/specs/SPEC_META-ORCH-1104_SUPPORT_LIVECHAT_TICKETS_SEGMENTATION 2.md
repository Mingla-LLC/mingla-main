# SPEC — META-ORCH-1104 — In-App Support Live-Chat + Tickets + Admin User Segmentation

**Skill:** `mingla-forensics` (SPEC mode)
**Date:** 2026-06-08
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-1104-[support-livechat-segmentation]/` on branch `meta-orch-1104-support-livechat-segmentation`
**Type:** META-ORCH (one Phase = one sub-ORCH = one worktree + one PR per CLOSE)
**Severity:** S2-medium (no launch dependency; high operational value)
**Evidence basis:** PROPOSAL_META-ORCH-1104 + four-lane forensic audit (Lane A messaging/realtime/push, Lane B admin/segmentation/data-integrity, Lane C client surfaces/identity, Lane D security/RLS/authz). Every contract below cites the audit finding (Lane X Fn / Dn) it rests on.

> **Reading guide.** This is a buildable contract, not a brainstorm. Phase 0 is specified to the point where the implementor builds it without guessing. Phases A–D specify the layer-by-layer contract + success criteria + test cases + invariants. Phase E is a v2 backlog list only. Every UI surface REQUIRES a `mingla-designer` DESIGN pass (referenced per phase) before its IMPLEMENT dispatch — this SPEC owns the functional contract + UX acceptance bar; the designer owns the granular visual contract (tokens, all-9-states copy, motion).

---

## 0. LOCKED DECISIONS (D1–D6) — encoded, each operator-confirmable

These are the operator-recommended defaults. Each is marked **operator-confirmable** — Seth may overturn any one before Phase 0 IMPLEMENT dispatch; absent an override, the implementor builds exactly this.

- **D1 — v1 is AUTH-ONLY.** Support is for logged-in Explorers (app-mobile) + logged-in business users (mingla-business). Anonymous web-checkout buyer support is **explicitly DEFERRED to a v2 fast-follow** (Phase E). *Rationale (Lane D D5 PII/abuse surface; PROPOSAL fork #1):* anonymous identity + abuse controls are a materially bigger lift; auth-only reuses `auth.uid()` as the identity spine end-to-end. **(operator-confirmable)**

- **D2 — ONE entity unifies live-chat + ticket. Canonical schema name = `support_tickets`.** A ticket OWNS a conversation; "live chat" = a ticket whose two parties are both present in realtime; "ticket" = the same row answered async later. UI copy may freely say "chat" / "ticket" / "support request"; the **SCHEMA must never reuse the bare names `tickets` or `agents`** — `tickets`/`ticket_types`/`ticket_checkout_*` are event-money ticketing and `agent_*` are the ARI AI agent (PROPOSAL E1, Lane B §5.4, Lane C CF-C1). The message thread reuses the existing `conversations`/`messages` substrate (Lane A F1, Lane D D1). **(operator-confirmable)**

- **D3 — Support-staff capability lives in a DEDICATED table `support_staff`, DECOUPLED from brand membership.** Columns include `user_id, enabled, available, role`. Admin grants/revokes `enabled`; the staffer self-toggles `available` (shift on/off). SQL helper `is_support_staff(p_user_id uuid)` mirrors the existing `is_admin_user()` idiom (Lane D D3, D4; Lane C Finding 3 — every business-app capability is brand-scoped today, so support MUST NOT be a `brand_team_members.role`). **(operator-confirmable)**

- **D4 — Routing v1 = ONE shared queue + CLAIM.** All tickets land in one queue; every enabled+available staffer sees it and is notified of new tickets; anyone can **claim** (sets `assigned_staff_id`). NO round-robin, business-hours, SLA, or topic routing in v1 — those are Phase E / v2 (PROPOSAL §3.3, fork #4). **(operator-confirmable)**

- **D5 — Segmentation is DERIVED, and we FIX the data-integrity mess.** Introduce `derive_user_segment(p_profile_id uuid) -> 'admin'|'business'|'explorer'`: **Admin** = caller's email ∈ `admin_users` `status='active'`; **Business** = an accepted, non-removed `brand_team_members` row; else **Explorer**. **Retire the dead `profiles.is_admin` column** (Lane B §3, §4.2: 0 writers / 0 readers / 0 true rows; blast radius ≈ 0). **Fix the latent `admin_toggle_partner` gate bug** — it gates on `profiles.account_type='admin'` while login/RLS gates on `admin_users` (Lane B §2.4), so an invited admin passes login but is FORBIDDEN by `admin_toggle_partner`; rewrite it (and its 2 migration twins) to `is_admin_user()`. `account_type` is NOT made authoritative; backfill it from the derived segment as a cache + add a CHECK so the admin Edit input can't write garbage (Lane B §4.1, §6). **(operator-confirmable)**

- **D6 — Per-app push routing.** Staffer-bound pushes carry a `business.support_message` / `business.support_new_ticket` type so `resolveOneSignalApp` routes them to the **business** OneSignal app AND the business inbox's `type.like 'business.%'` filter renders them (Lane A F5.6, F6.3; Lane C CF-C2). Requester replies carry the consumer-typed `support_message` and route to the consumer app. **FIRST fix the pre-existing dead-code `notification_preferences` gate in `notify-dispatch`** (Lane A F5.5b: the dispatcher reads non-existent `channel`/`type`/`opt_in` columns, so the entire type-preference gate is a silent no-op) **before** adding any `support_replies` opt-out. **Recommended cheapest-correct option (see §0.1):** ride the existing `messages` boolean for v1 and do NOT add a `support_replies` column; the working controls are `conversation_participants.notifications_muted` (per-thread) + quiet-hours. **(operator-confirmable)**

### 0.1 D6 push-preference decision — justification (cheapest correct option)

Lane A F5.5b proves `notify-dispatch`'s `notification_preferences` type-gate is **dead today** — it reads `row.channel === 'push' && row.type === '*' && row.opt_in === false` against a table that has **no** `channel`/`type`/`opt_in` columns (the live table is boolean-column-per-category: `messages`, `marketing`, `push_enabled`, …). So push is presently gated only by idempotency + rate-limit + session-mute + quiet-hours + `conversation_participants.notifications_muted` (Lane A F5.2/F5.3).

Two options for a support opt-out:
- **(Option α — recommended, cheapest correct):** Do NOT add a `support_replies` column for v1. Repoint the `notify-dispatch` gate at the real boolean-column schema (the pre-existing-bug fix mandated by D6), checking the **existing `messages` boolean** for support message types (a support reply IS a message). Per-thread mute via `notifications_muted` remains the precise control. Net: one small dispatcher fix, zero new columns, no new consumer UI toggle. Justification: there are effectively zero real users today (Lane B §3.1) and "mute support replies separately from DMs" is a low-value v1 control; bundling under `messages` is correct semantics and ships the dispatcher-bug fix as a byproduct.
- **(Option β — deferred):** Add a dedicated `support_replies` boolean column + a consumer toggle (Lane C CF-C4/CF-C5). More surface, marginal value. **Deferred to Phase E.**

**Phase 0 MUST implement the dispatcher-gate fix (Option α). The dedicated `support_replies` column is OUT of v1.** If Seth wants per-channel granularity, he overrides D6 → Phase E picks up β.

---

## 1. v1 SCOPE BOUNDARY

### IN scope (v1)
- Phase 0 — backend foundation (tables, helper, RLS, segment function, data-integrity cleanup, push fix, allowlist).
- Phase A — consumer (Explorer) requester: Help & Support entry + create ticket + live-chat thread.
- Phase B — admin PC desk (queue + detail + reply-as-staff + lifecycle + staff roster) **AND** Explorer/Business/Admin segmentation on the Users page.
- Phase C — business-app staff console: support toggle + Live Chats inbox sub-page + claim/reply/create + availability-gated push.
- Phase D — business user's own Help & Support entry + `app/account/support.tsx`.

### OUT of v1 scope (deferred to Phase E / v2)
- Anonymous / buyer-web support (D1).
- Round-robin / business-hours / SLA / topic routing (D4).
- Canned replies, internal staff notes, dedicated `support_replies` opt-out column (D6 Option β).
- Presence/availability polish beyond the live-chat baseline, multi-language, CSAT surveys.

### Affected Surfaces (Phase 2.5 cross-surface block)

| # | Surface | In v1? | Behavior demanded / why not |
|---|---|---|---|
| 1 | **Consumer iOS** (`app-mobile/`) | ✅ Phase A | Help & Support entry, create ticket, live-chat thread, support-reply push. Parity with Android is **automatic** (shared RN code) — single SC set with iOS+Android sim proof. |
| 2 | **Consumer Android** (`app-mobile/`) | ✅ Phase A | Same shared code; tester proves on Android emulator too. |
| 3 | **Buyer / anonymous Web** (`mingla-business` `/checkout`, `/e/…`, `/b/…`) | ❌ | **D1 — anonymous support deferred to v2.** No support surface on buyer-anon routes. |
| 4 | **Business iOS** (`mingla-business/`) | ✅ Phases C, D | Staff console (C) + business-user Help & Support (D). Parity with Android **automatic** (shared RN). |
| 5 | **Business Android** (`mingla-business/`) | ✅ Phases C, D | Same shared code; emulator proof. |
| 6 | **Admin Web** (`mingla-admin/`) — adjacent | ✅ Phase B | Support desk + segmentation. Web-only; no mobile analog. |
| 7 | **Business Web preview** (`mingla-business` dev/web) — adjacent | ❌ | **No support surface planned for the dev/web preview.** Push (OneSignal) is web-no-op'd already (Lane C 4.1); staff console is a phone console by design. |

Backend (`supabase/`) is touched by Phases 0 + E only.

---

## 2. CONSOLIDATED DATA MODEL

All DDL is the **authoritative Phase-0 contract**. Migration-baseline hazards apply (memory `feedback_edge_deploy_and_migration_apply_hazards.md`): widening a CHECK = `DROP CONSTRAINT` then `ADD CONSTRAINT` in the same migration; `$function$;` terminator before any `GRANT`; `DROP` before widening a `RETURNS TABLE`; deploy from MERGED main; apply via Supabase Management API if the CLI is drift-wedged. **Migrations are applied by Seth via `supabase db push` — the implementor writes the migration file, never `mcp__supabase__apply_migration`.**

### 2.1 `support_tickets` (new table — the support entity, D2)

```sql
CREATE TABLE public.support_tickets (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requester_segment  text NOT NULL DEFAULT 'explorer'
                       CHECK (requester_segment IN ('explorer','business')),  -- snapshot at create (D5 derive)
  subject            text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 1 AND 200),
  status             text NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new','open','pending','resolved','closed')),
  priority           text NOT NULL DEFAULT 'normal'
                       CHECK (priority IN ('low','normal','high','urgent')),
  assigned_staff_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,       -- claim sets this (D4)
  conversation_id    uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,  -- the thread (D2)
  brand_id           uuid REFERENCES public.brands(id) ON DELETE SET NULL,    -- nullable; set if raised from a business context
  created_at         timestamptz NOT NULL DEFAULT now(),
  first_response_at  timestamptz,    -- set on first staff message (Phase B/C)
  resolved_at        timestamptz,    -- set when status -> resolved/closed
  last_message_at    timestamptz NOT NULL DEFAULT now()  -- bumped on every message (queue sort key)
);

CREATE UNIQUE INDEX support_tickets_conversation_id_key ON public.support_tickets(conversation_id);
CREATE INDEX support_tickets_status_lastmsg_idx ON public.support_tickets(status, last_message_at DESC);
CREATE INDEX support_tickets_assigned_idx ON public.support_tickets(assigned_staff_id) WHERE assigned_staff_id IS NOT NULL;
CREATE INDEX support_tickets_requester_idx ON public.support_tickets(requester_user_id);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
```

**Status lifecycle (the only legal transitions; enforced in edge fns, not a DB trigger in v1):**
`new` → (requester sent first message, before any staff touch) → `open` (a staffer claimed/replied) → `pending` (waiting on requester) ↔ `open` → `resolved` (staff marks done) → `closed` (auto after N days OR explicit). `closed`/`resolved` may reopen → `open` on a new requester message. Phase 0 ships the columns + CHECK; Phase B/C own the transition writes.

### 2.2 `support_staff` (new table — staff capability, D3)

```sql
CREATE TABLE public.support_staff (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled      boolean NOT NULL DEFAULT false,   -- admin grants/revokes capability (Lane D D5: writes admin-gated)
  available    boolean NOT NULL DEFAULT false,   -- staffer self-toggles shift (Lane C Finding 3)
  display_name text,
  role         text NOT NULL DEFAULT 'staff' CHECK (role IN ('staff','lead')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.support_staff ENABLE ROW LEVEL SECURITY;
```

### 2.3 `is_support_staff()` helper (new — mirrors `is_admin_user()`, Lane D D3/D4)

```sql
CREATE OR REPLACE FUNCTION public.is_support_staff(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.support_staff s
    WHERE s.user_id = p_user_id AND s.enabled = true
  );
$function$;
-- Admins are implicitly support-capable everywhere staff is checked: use
-- (public.is_support_staff(auth.uid()) OR public.is_admin_user()) at every gate. (Lane D recommended hybrid §1)
```

### 2.4 `derive_user_segment()` + segment view (new — D5, Lane B §6)

```sql
CREATE OR REPLACE FUNCTION public.derive_user_segment(p_profile_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.admin_users au
      JOIN auth.users u ON lower(u.email) = lower(au.email)
      WHERE u.id = p_profile_id AND au.status = 'active'
    ) THEN 'admin'
    WHEN EXISTS (
      SELECT 1 FROM public.brand_team_members btm
      WHERE btm.user_id = p_profile_id
        AND btm.accepted_at IS NOT NULL
        AND btm.removed_at IS NULL
    ) THEN 'business'
    ELSE 'explorer'
  END;
$function$;

-- List/count ergonomics for the admin page (read via the anon client under the admin RLS umbrella).
-- A SECURITY INVOKER view inherits the caller's profiles RLS ("Admins can read all profiles");
-- so a non-admin sees only their own row. Keep is_seed exposed for forward-safety (Lane B §3.2).
CREATE OR REPLACE VIEW public.profiles_with_segment
WITH (security_invoker = true) AS
SELECT p.*, public.derive_user_segment(p.id) AS segment
FROM public.profiles p;
```

**Admin/business population truth (Lane B §3):** Admin = 1 active (`seth@usemingla.com`); Business = 13 distinct accepted `brand_team_members` users (all Seth's dev/harness accounts; effectively zero real third-party business users — do NOT over-engineer for scale). Explorer = residual.

### 2.5 Data-integrity cleanup migration (D5, Lane B §6) — SAME Phase-0 work

1. **Rewrite `admin_toggle_partner`** (live def) + the 2 migration twins (`20260822000000_orch_1052_partner_identity_stripe.sql:112,:434`, `20260823000000_orch_1054_partner_splits.sql:118`) to gate on `public.is_admin_user()` instead of `profiles.account_type='admin'`. Closes the §2.4 privilege divergence.
2. **Retire `profiles.is_admin`:** `ALTER TABLE public.profiles DROP COLUMN is_admin;` (blast radius ≈ 0 — every other `is_admin` reference is `session_participants.is_admin`, Lane B §4.2). Add a strict-grep gate so it can't return.
3. **`account_type`:** keep the column as a non-authoritative cache. `ALTER TABLE public.profiles ADD CONSTRAINT profiles_account_type_check CHECK (account_type IS NULL OR account_type IN ('explorer','business','admin'));` Backfill once from `derive_user_segment(id)` so the existing admin `.or(account_type…)` filter stops lying. The admin page reads `segment` (the view), NOT the cached column, for the new tabs/counts/filter.

### 2.6 `'support'` linked_entity_type — the 3-constraint CHECK migration (Lane A F1.4) — SAME Phase-0 work

A support ticket OWNS a `conversations` row. `linked_entity_type` is enum-CHECK-constrained, entangled with two more CHECKs. Phase 0 migration MUST, in one file (DROP then ADD each):

```sql
-- (1) admit 'support' to the value set
ALTER TABLE public.conversations DROP CONSTRAINT conversations_linked_entity_type_check;
ALTER TABLE public.conversations ADD  CONSTRAINT conversations_linked_entity_type_check
  CHECK (linked_entity_type IN ('direct','session','trip','event','support'));

-- (2) add a coherence branch: 'support' has NEITHER session_id NOR event_id (shape == 'direct')
ALTER TABLE public.conversations DROP CONSTRAINT conversations_linked_entity_coherent;
ALTER TABLE public.conversations ADD  CONSTRAINT conversations_linked_entity_coherent CHECK (
  (linked_entity_type = 'direct'  AND session_id IS NULL     AND event_id IS NULL) OR
  (linked_entity_type = 'session' AND session_id IS NOT NULL AND event_id IS NULL) OR
  (linked_entity_type = 'trip'    AND event_id   IS NOT NULL AND session_id IS NULL) OR
  (linked_entity_type = 'event'   AND event_id   IS NOT NULL AND session_id IS NULL) OR
  (linked_entity_type = 'support' AND session_id IS NULL     AND event_id IS NULL)
);
-- (3) name rule (conversations_group_requires_name): DECISION = support conversation is
-- type='group' + name = ticket subject (carries a subject line cleanly). No DROP/ADD needed —
-- the existing group rule already requires a non-empty trimmed name, which a support subject satisfies.
```

**Decision (D2-consistent):** support conversation = `type='group'` + `name = <ticket subject>` (≤200 chars). This satisfies `conversations_group_requires_name` with no constraint change. `message_type` needs NO change — support messages are `'text'`/`'image'`/`'file'`, and `'system'` (sender_id NULL) is available for "claimed"/"resolved" banners (Lane A F1.5).

### 2.7 RLS policies (Lane D D1–D5, recommended hybrid: option-b RLS primary + claim-time participant seeding as defense-in-depth)

```sql
-- support_tickets: requester sees own; staff/admin see all; nobody else. (Lane D D5 #4)
CREATE POLICY support_tickets_requester_read ON public.support_tickets FOR SELECT
  USING (requester_user_id = auth.uid()
         OR public.is_support_staff(auth.uid()) OR public.is_admin_user());
CREATE POLICY support_tickets_requester_insert ON public.support_tickets FOR INSERT
  WITH CHECK (requester_user_id = auth.uid());   -- a user opens their own ticket
CREATE POLICY support_tickets_staff_update ON public.support_tickets FOR UPDATE
  USING (public.is_support_staff(auth.uid()) OR public.is_admin_user())
  WITH CHECK (public.is_support_staff(auth.uid()) OR public.is_admin_user());
-- NOTE: claim / status writes flow through edge fns (service-role) that re-assert staff;
-- the staff_update policy is the RLS safety-net, NOT the primary write path.

-- support_staff: self-read; ALL writes admin-gated; staffer may self-toggle 'available' ONLY. (Lane D D5 #1)
CREATE POLICY support_staff_self_read ON public.support_staff FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin_user());
CREATE POLICY support_staff_admin_write ON public.support_staff FOR INSERT
  WITH CHECK (public.is_admin_user());
CREATE POLICY support_staff_admin_update ON public.support_staff FOR UPDATE
  USING (public.is_admin_user() OR user_id = auth.uid())
  WITH CHECK (public.is_admin_user() OR user_id = auth.uid());
-- ENFORCEMENT NOTE: a self-update by a staffer must be restricted to the `available` column only.
-- RLS cannot column-restrict an UPDATE cleanly; therefore the staffer's availability toggle MUST
-- go through a SECURITY DEFINER RPC `support_set_available(p_available boolean)` that updates ONLY
-- `available` for `auth.uid()` when that user is enabled. The broad self-update policy above is the
-- net; the RPC is the real write path. `enabled`/`role` are written ONLY by admin edge fns.

-- support-scoped chat-table policies (option b) — staff/admin read+write support conversations
-- WITHOUT participant pollution. Scoped to linked_entity_type='support' so staff never widen into
-- users' direct/group/event DMs (Lane D D5 PII). (Lane D D3 option-b, D5 #3)
CREATE POLICY conversations_support_staff_read ON public.conversations FOR SELECT
  USING (linked_entity_type = 'support'
         AND (public.is_support_staff(auth.uid()) OR public.is_admin_user()));
CREATE POLICY messages_support_staff_read ON public.messages FOR SELECT
  USING (deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id
      AND c.linked_entity_type = 'support')
    AND (public.is_support_staff(auth.uid()) OR public.is_admin_user()));
CREATE POLICY messages_support_staff_insert ON public.messages FOR INSERT
  WITH CHECK (sender_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id
      AND c.linked_entity_type = 'support')
    AND (public.is_support_staff(auth.uid()) OR public.is_admin_user()));
-- VERIFY (Lane D D1.3, D5 #3): the RESTRICTIVE messages_broadcast_only_enforcement policy is
-- AND-ed on every INSERT. can_insert_message_into_conversation() passes non-trip/event convs today,
-- so 'support' passes — the SPEC REQUIRES the implementor to confirm this still holds after adding
-- 'support', with a test asserting a support INSERT is not blocked by the restrictive policy.

-- presence parity (Lane D D5 #9): extend conversation_presence SELECT with a support-staff branch
CREATE POLICY conversation_presence_support_staff_read ON public.conversation_presence FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_presence.conversation_id
      AND c.linked_entity_type = 'support')
    AND (public.is_support_staff(auth.uid()) OR public.is_admin_user()));
```

**Why option-b primary (Lane D D3):** it is the exact pattern the codebase already uses for brand-team access (`conversations_brand_team_member_read`, `messages_brand_team_member_insert`) — a feature-scoped predicate + a SECURITY DEFINER helper. No participant-row pollution; revoking staff instantly revokes access; RLS-honored realtime SELECT lets both PC and phone staff stream the thread (Lane A F3.4, F6.2). **Claim-time participant insertion is defense-in-depth only** (presence/read-receipt parity), never the sole gate, and MUST run through the SECURITY DEFINER RPC below (Lane A F2.2/F6.5, Lane D D5 #6).

### 2.8 The staffer-seed + ticket-mint SECURITY DEFINER RPC (Lane A F2.1/F2.2/F6.5, Lane D D5 #6)

There is NO client primitive to mint a non-direct conversation or to add a staffer as a participant (Lane A F2.1, F2.2). Phase 0 ships:

```sql
-- Mint a support ticket + its conversation + seed the requester participant, atomically.
-- Called by the requester (RLS lets them create their own conversation/ticket); runs DEFINER to
-- seed the participant + bump constraints safely.
CREATE OR REPLACE FUNCTION public.create_support_ticket(p_subject text, p_brand_id uuid DEFAULT NULL)
RETURNS uuid  -- returns support_tickets.id
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_conv uuid; v_ticket uuid; v_seg text;
BEGIN
  v_seg := public.derive_user_segment(auth.uid());     -- snapshot segment (explorer|business; admin folds to explorer for a ticket)
  IF v_seg = 'admin' THEN v_seg := 'explorer'; END IF;  -- an admin filing a ticket is a requester, not staff context
  INSERT INTO public.conversations(type, linked_entity_type, name, created_by)
    VALUES ('group','support', left(btrim(p_subject),200), auth.uid()) RETURNING id INTO v_conv;
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_conv, auth.uid());
  INSERT INTO public.support_tickets(requester_user_id, requester_segment, subject, conversation_id, brand_id)
    VALUES (auth.uid(), v_seg, left(btrim(p_subject),200), v_conv, p_brand_id) RETURNING id INTO v_ticket;
  RETURN v_ticket;
END; $function$;

-- Claim a ticket: set assigned_staff_id, seed staffer participant (presence parity), flip status.
-- Service-role edge fn `support-claim` calls this AFTER re-asserting is_support_staff()/is_admin_user().
CREATE OR REPLACE FUNCTION public.claim_support_ticket(p_ticket_id uuid, p_staff_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_conv uuid;
BEGIN
  SELECT conversation_id INTO v_conv FROM public.support_tickets WHERE id = p_ticket_id;
  UPDATE public.support_tickets
    SET assigned_staff_id = p_staff_id,
        status = CASE WHEN status IN ('new') THEN 'open' ELSE status END
    WHERE id = p_ticket_id;
  INSERT INTO public.conversation_participants(conversation_id, user_id)
    VALUES (v_conv, p_staff_id) ON CONFLICT (conversation_id, user_id) DO NOTHING;
END; $function$;
```

> `create_support_ticket` is safe to call from the client (it only ever acts for `auth.uid()`). `claim_support_ticket` takes `p_staff_id` and MUST only be invoked by a service-role edge fn that has re-asserted staff identity — never exposed as a client-callable RPC with an arbitrary `p_staff_id`. (Lane D D5 #5/#6.)

### 2.9 Edge functions (Lane D D4 template, Lane A F5.6, D6)

Each follows the `admin-review-venue-claim` pattern (Lane D D4): a `userClient` (anon key + caller `Authorization`) for identity + the role gate, and a service-role client ONLY for the privileged write.

| Edge fn | verify_jwt | Gate | Does |
|---|---|---|---|
| `support-claim` | true | `is_support_staff() OR is_admin_user()` → else 403 | calls `claim_support_ticket(ticketId, user.id)`; fires `business.support_message` to other staff? no — fires nothing on claim except optional in-app. |
| `support-send` | true | requester (own ticket) OR staff/admin | inserts the message (service-role only if staff via the option-b INSERT policy already allows direct insert — prefer the RLS path; service-role for status side-effects); sets `first_response_at` on first staff message; bumps `last_message_at`; dispatches push (below). |
| `support-set-status` | true | `is_support_staff() OR is_admin_user()` | legal status transition (§2.1); sets `resolved_at`. |
| `support-grant-staff` | true | `is_admin_user()` ONLY | upsert `support_staff(user_id, enabled, role)`. The admin roster write. |
| `notify-support` (or a branch in `notify-message`) | service-role (internal) | n/a | push fan-out (D6): to requester `app:"consumer"`, `type:"support_message"`; to staff `app:"business"`, `type:"business.support_new_ticket"`/`"business.support_message"`, filtered to `support_staff WHERE enabled AND available` (Lane A F5.6, Lane C 4.2). Deep-links: consumer `mingla://chat/{conv}` (Lane A F5.2); business — add a `business.support_*` case in `businessNotificationRouting.ts:137` (today falls to ACCOUNT_FALLBACK). |

**D6 dispatcher-bug fix (mandatory, Phase 0):** in `notify-dispatch` (Lane A F5.5b `:393-426`), repoint the dead `notification_preferences` type-gate at the real boolean-column schema — for support/message types, consult the existing `messages` boolean (Option α). Add a test asserting the gate now actually reads a real column (regression guard for the silent no-op).

### 2.10 Realtime (no new infra — Lane A F3.4, F6.2)

Because a support ticket OWNS a `conversations` row, the EXISTING `conversation:{conversationId}` channel + `subscribeToConversation` (app-mobile) and the identical `supabase.channel('conversation:${id}')` binding (business `useEventGroupChat:57`) deliver live support messages with **zero new realtime code**. Filter is on `conversation_id` (non-PK) — safe from the PK-filter footgun (Lane A F3.2). Presence via `useChatPresence` works once the viewer satisfies the presence SELECT policy (§2.7 support-staff branch OR participant seeding).

### 2.11 COMMS-0002 backend strict-grep allowlist (BLOCKING — Lane D D4)

Every new `supabase/functions/*` file and every new `supabase/migrations/*.sql` FAILS CI (ORCH-0863 C7 `no-new-backend-files`) unless a `META_ORCH_1104_BACKEND_ALLOWLIST` block is added **in the SAME commit** to `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (precedent block format at `:437` `ORCH_0898_BACKEND_ALLOWLIST`). Phase 0 PR MUST add:

```js
const META_ORCH_1104_BACKEND_ALLOWLIST = [
  "supabase/functions/support-claim/index.ts",
  "supabase/functions/support-send/index.ts",
  "supabase/functions/support-set-status/index.ts",
  "supabase/functions/support-grant-staff/index.ts",
  "supabase/functions/notify-support/index.ts",          // if a dedicated producer is used
  "supabase/migrations/<ts>_meta_orch_1104_support_foundation.sql",
  // …plus any __tests__ files added in the same PR
];
```
(Wire the new const into the C7 allow set exactly as the existing `ORCH_*_BACKEND_ALLOWLIST` consts are.) The `notify-dispatch`/`notify-message`/`businessNotificationRouting.ts` edits are MODIFICATIONS of existing allow-listed files — confirm they don't trip C7 as "new"; if a rename/diff trips it, allowlist per the existing precedent (Lane A note).

---

## 3. SECURITY SECTION (consolidated — Lane D)

### 3.1 Three-client authorization model (Lane D "Recommended authorization model")

| Client | Identity | Read path | Write path |
|---|---|---|---|
| **Explorer requester** (app-mobile) | `auth.uid()` = `requester_user_id` | participant-gated RLS on their own support conversation (already works once seeded by `create_support_ticket`) | normal `messages` INSERT (they're a participant) |
| **PC admin** (mingla-admin) | anon key + JWT → `is_admin_user()` | option-b support RLS treats admins as staff (`… OR is_admin_user()`), OR `support-*` DEFINER RPC re-asserting admin (Lane D D2 pattern) | `support-send`/`support-set-status` edge fn (re-asserts admin) |
| **Phone staffer** (mingla-business) | anon key + JWT → `is_support_staff(auth.uid())` | option-b support RLS → RLS-honored realtime SELECT, no participant pollution | `support-claim` + `support-send` edge fns (re-assert staff); optional claim-time participant insert for presence parity |

Single source of truth for "who is staff" = `support_staff` (admin-managed) via `is_support_staff()`. "Who is admin" stays `admin_users` via `is_admin_user()`. Admins are implicitly support-capable.

### 3.2 The 9 mandatory authZ checks (Lane D D5 — every one is a Phase-0 success criterion)

1. New `support_staff` table; `enabled`/`role` writes gated by `is_admin_user()` ONLY (via `support-grant-staff`). A normal user cannot self-promote.
2. New `is_support_staff(p_user_id)` SECURITY DEFINER STABLE helper, modeled on `is_admin_user()`.
3. Chat-table support policies scoped to `linked_entity_type='support' AND (is_support_staff() OR is_admin_user())` for SELECT/INSERT/UPDATE — staff never widen into users' direct/group/event DMs. **Verify** the RESTRICTIVE `messages_broadcast_only_enforcement` still passes `'support'`.
4. `support_tickets` RLS: requester sees own (`requester_user_id=auth.uid()`); staff/admin see all; nobody else — NOT a blanket authenticated read.
5. Every `support-*` edge fn: `getUser()` → 401, then `is_support_staff()`-or-`is_admin_user()` RPC → 403; service-role used ONLY for the privileged write; never ship service-role to a client (admin client is anon-key, Lane D D2).
6. Claim-time participant insertion runs ONLY through the `claim_support_ticket` SECURITY DEFINER RPC behind a service-role edge fn — never a client insert (the self-add policy forbids it anyway).
7. Audit-log every staff claim/read/reply (reuse `admin_audit_log` or add `support_audit_log`); minimize PII in push payloads (Lane C 4.2: push carries ids, not message bodies); off-duty (`available=false`) staff excluded from new-ticket pushes.
8. COMMS-0002: `META_ORCH_1104_BACKEND_ALLOWLIST` entry in the same commit as every new edge fn / migration (§2.11).
9. Presence: support staff get the extended presence SELECT policy (§2.7) OR a claim-time participant row — this SPEC picks the **extended SELECT policy** as primary + participant-seed as the convenience (§2.7/§2.8).

### 3.3 Abuse / PII boundary (Lane D D5)
- Explorer B reading Explorer A's case: blocked — B is not a participant, brand-team path is event/trip-only, no support policy matches → zero rows.
- Non-staff business user opening the Live Chats inbox: blocked — brand membership grants brand/event access only; the inbox is gated client-side (cosmetic) AND server-side on `is_support_staff()` (the real boundary). The toggle UI is never trusted alone.

---

## 4. PHASE 0 — Backend Foundation (backend-only sub-ORCH)

**Surfaces:** Backend only. No mobile/admin UI. No OTA.

### 4.1 Layer-by-layer (the build order)
1. **DB / migration** (one file `<ts>_meta_orch_1104_support_foundation.sql`): `support_tickets` (§2.1), `support_staff` (§2.2), `is_support_staff()` (§2.3), `derive_user_segment()` + `profiles_with_segment` view (§2.4), data-integrity cleanup (§2.5: rewrite `admin_toggle_partner` + twins, drop `profiles.is_admin`, `account_type` CHECK + backfill), the 3-constraint `'support'` widening (§2.6), `create_support_ticket` + `claim_support_ticket` RPCs (§2.8), all RLS policies (§2.7). Plus `support_set_available` RPC + optional `support_audit_log`.
2. **Edge fns:** `support-claim`, `support-send`, `support-set-status`, `support-grant-staff`, and the `notify-support` producer (or `notify-message` branch) (§2.9). Plus the `notify-dispatch` D6 dead-gate fix (§2.9).
3. **Router patch:** `businessNotificationRouting.ts:137` gains a `business.support_*` case (Lane A F5.6).
4. **CI:** `META_ORCH_1104_BACKEND_ALLOWLIST` block (§2.11) + a strict-grep gate banning `profiles.is_admin` reintroduction + a strict-grep gate banning schema use of bare `tickets`/`agents` for support (CF-C1).
5. **TS types:** regenerate Supabase types so `support_tickets`/`support_staff`/`segment` are available to Phases A–D.

### 4.2 Success criteria (observable / testable)
- **SC-0.1** A logged-in user calls `create_support_ticket('Help with my booking')` → returns a uuid; a `support_tickets` row (status `new`, segment derived), a `conversations` row (`type='group'`, `linked_entity_type='support'`, name='Help with my booking'), and a requester `conversation_participants` row all exist.
- **SC-0.2** `is_support_staff(<enabled user>)` = true; `is_support_staff(<non-staff>)` = false; `is_support_staff(<disabled staff>)` = false.
- **SC-0.3** `derive_user_segment` returns `admin` for `seth@usemingla.com`, `business` for an accepted-brand-team user, `explorer` for a fresh profile. Counts via `profiles_with_segment` match Lane B §3 (admin=1, business=13, rest explorer) at build time.
- **SC-0.4** `profiles.is_admin` column no longer exists; `admin_toggle_partner` now gates on `is_admin_user()` (an `admin_users`-active, `account_type≠'admin'` user can toggle a partner).
- **SC-0.5** A support `messages` INSERT by an enabled staffer succeeds (option-b INSERT policy + RESTRICTIVE policy both pass); the same INSERT by a non-staff non-participant returns 0 rows / RLS error.
- **SC-0.6** `claim_support_ticket` sets `assigned_staff_id`, flips `new→open`, and seeds the staffer participant idempotently (second claim is a no-op on the participant row).
- **SC-0.7** `notify-dispatch` type-gate now reads a real boolean column (`messages`) — a test proves the gate is no longer a silent no-op against the live schema (D6 fix).
- **SC-0.8** Every `support-*` edge fn returns 401 (no JWT), 403 (authed non-staff for staff routes), 200 (staff/admin) — verified per route.

### 4.3 Invariants
- **I-1104-STAFF-DEDICATED** — support staffing is `support_staff`-only; never `brand_team_members.role` (Lane C Finding 3). Strict-grep: no `role = 'support'` or `'staff'` added to brand-team gates.
- **I-1104-SCHEMA-NO-BARE-TICKETS-AGENTS** — no support schema object named `tickets`/`agents` (CF-C1). Strict-grep gate.
- **I-1104-SUPPORT-SCOPED-RLS** — every staff chat-table policy carries `linked_entity_type='support'`; staff never read non-support DMs (Lane D D5 #3).
- **I-1104-ADMIN-GATE-UNIFIED** — `admin_toggle_partner` (+ twins) gate on `is_admin_user()`, not `account_type='admin'` (Lane B §2.4).
- **I-PROFILES-IS-ADMIN-RETIRED** — `profiles.is_admin` is gone and cannot return (strict-grep).
- Preserve existing chat substrate invariants (participant-gating, broadcast-only restrictive policy).

### 4.4 Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-0.1 (happy) | Requester opens a ticket | `create_support_ticket('X')` as Explorer | ticket+conv+participant rows; status `new` | DB/RPC |
| T-0.2 (adversarial) | Explorer B reads Explorer A's case | A opens ticket; B `SELECT * FROM support_tickets WHERE id=A` | 0 rows (RLS) | RLS |
| T-0.3 (adversarial) | Non-staff self-promote | non-staff `INSERT INTO support_staff(user_id,enabled) VALUES(self,true)` | RLS denies (admin-write only) | RLS |
| T-0.4 (adversarial) | Staff read a NON-support DM | enabled staffer `SELECT` a `direct` conversation they're not in | 0 rows (support policy is `linked_entity_type='support'`-scoped) | RLS/PII |
| T-0.5 (happy) | Claim seeds participant | `support-claim` as staff | `assigned_staff_id` set, status `open`, staffer participant seeded once | edge+RPC |
| T-0.6 (adversarial) | `claim_support_ticket` with spoofed staff id | call RPC directly with `p_staff_id=<other>` from a client | must be unreachable — RPC not client-exposed; only service-role edge invokes it | authz |
| T-0.7 (regression) | D6 dead-gate fix | user with `messages=false` | support push respects the real `messages` column (gate no longer no-op) | edge |
| T-0.8 (regression) | `admin_toggle_partner` divergence | invited admin (`admin_users` active, `account_type` null) toggles partner | succeeds (was FORBIDDEN before) | RPC |

**Phase 0 gate:** Step 0.5 regression-test gate = T-0.2, T-0.3, T-0.4, T-0.7, T-0.8 must pass. No UI; tested via SQL + edge-fn invocation. No `mingla-designer` pass (backend-only).

---

## 5. PHASE A — Consumer Requester (app-mobile iOS + Android)

**Surfaces:** Consumer iOS + Android (shared RN — parity automatic). **Depends on:** Phase 0 merged.
**REQUIRES a `mingla-designer` DESIGN pass** (`DESIGN_META-ORCH-1104_PHASE_A_CONSUMER_SUPPORT.md`) before IMPLEMENT — tokens, all-9-states copy, motion, no-slop bans.

### 5.1 Layer-by-layer
- **Component / mount (Lane C Finding 1):** add `SectionId "support"` to `AccountSettings.tsx` (`:65`) + a new `<AccordionCard icon="help-circle" title="Help & Support">` between App Information (`:837`) and the Red Zone (`:839`). Fold the existing static `mailto:support@usemingla.com` row (`:822-836`) INTO this section (one support home, not two). Rows: "Start a live chat" and "My support requests".
- **Live-chat thread (Lane C Finding 1.3/1.4):** the thread is full-screen + keyboard-heavy — mount as its OWN route / full-screen modal launched from the Profile tab, NOT a nested `BaseBottomSheet` child (the sibling-root pattern fights the composer keyboard). The Account row `onClose()`s settings then navigates to a `SupportChatScreen` that mounts `<MessageInterface conversationId={ticketConversationId} currentUserId={user.id} />` with all collab/board props OFF (thin wrapper), OR a minimal list reusing `MessageBubble` + composer styles.
- **Create-ticket form:** a lightweight form (subject) fits the sibling-root child-sheet pattern; on submit calls `supabase.rpc('create_support_ticket', { p_subject })` → navigate to the returned thread.
- **Service/hook:** new `supportService.ts` (create/list own tickets via `support_tickets` RLS read) + `useSupportTickets(userId)` React-Query hook (key `['support','tickets',userId]`, invalidate on create). Messages reuse `messagingService` unchanged (Lane A F2.3/F2.5).
- **Push (Lane C Finding 5):** requester receives `support_message` on the consumer OneSignal app; tap deep-links to the support thread via `data.conversationId`. No new consumer push code beyond the deep-link route handler. **No `support_replies` toggle** (D6 Option α — rides `messages`).

### 5.2 Success criteria
- **SC-A.1** Profile → settings shows "Help & Support" with "Start a live chat" + "My support requests"; old mailto folded in.
- **SC-A.2** Start a live chat → enter subject → lands in a live thread; sending a message persists + appears optimistically.
- **SC-A.3** "My support requests" lists the user's own tickets (status + last_message preview), newest first; empty-state copy in Mingla voice.
- **SC-A.4** A staff reply (sent from Phase B/C) arrives in realtime in the open thread, and as a push (`support_message`) when backgrounded; tapping the push opens the thread.
- **SC-A.5 (iOS + Android)** Both platforms verified on sim/emulator (shared code — one SC, two proofs).

### 5.3 Invariants
- Reuse `MessageInterface`/`messagingService`/`useChatPresence` unchanged (no fork of the chat engine). One owner per truth (server state in RQ, not Zustand). No dead taps. No fabricated ticket data (missing = hidden).

### 5.4 Test cases

| Test | Scenario | Expected | Layer |
|---|---|---|---|
| T-A.1 (happy) | Open ticket + send | thread + message persisted; appears in "My support requests" | full stack |
| T-A.2 (error) | Send while offline | composer shows retry; message not silently dropped | hook+component |
| T-A.3 (empty) | No tickets yet | empty-state copy, "Start a live chat" CTA | component |
| T-A.4 (realtime) | Staff replies while thread open | reply appears live (no manual refresh) | realtime |
| T-A.5 (adversarial) | Deep-link to a foreign conversationId | RLS blocks; thread shows not-found, no crash | RLS+nav |

---

## 6. PHASE B — Admin PC Desk + Segmentation (mingla-admin web)

**Surfaces:** Admin Web only. **Depends on:** Phase 0 merged. Can run in PARALLEL with Phase A.
**REQUIRES a `mingla-designer` DESIGN pass** (`DESIGN_META-ORCH-1104_PHASE_B_ADMIN_DESK.md`) — admin web breakpoints, table/detail layout, all-9-states.

### 6.1 Layer-by-layer (Lane B §1, §5)
- **Router (Lane B §5.1):** add one line to `App.jsx` `PAGES` (`:35-54`): `support: SupportDeskPage,` + the import — route `#/support`.
- **Nav (Lane B §5.2):** add `{ id: "support", label: "Support", icon: "LifeBuoy" }` to `constants.js` `NAV_GROUPS` (`:122-154`); register `LifeBuoy` (import from `lucide-react`) in `Sidebar.jsx` `ICON_MAP` (`:36-40`) — else it silently falls back to `LayoutDashboard` (`:77`).
- **Support desk page (mirror `UserManagementPage` list/detail + `ClaimsPage` queue):** queue (all tickets, sort `last_message_at desc`, filter by status/assignment) + detail (the conversation thread + reply-as-staff composer + lifecycle controls: claim, set status, set priority). Reads via the support RLS (admin treated as staff) and the anon client under the `is_admin_user()` umbrella (Lane D D2). Reply-as-staff and lifecycle writes go through the `support-send` / `support-claim` / `support-set-status` edge fns.
- **Staff roster management (mirror `AdminPage.jsx` invite/active/revoked shape, Lane B §5.3):** list `support_staff`, grant/revoke `enabled` via `support-grant-staff` (admin-only). This is the GRANT side of D3.
- **Segmentation on `UserManagementPage` (Lane B §1.6):** segment tabs/`<select>` (Explorer / Business / Admin) above the Filters block (`:1001`); counts as `StatCard`s (extend `stats` `:75` + `fetchStats` `:170` with explorer/business/admin head-counts from `profiles_with_segment`); filter resolves via the view's `segment` column — read from `profiles_with_segment` instead of `profiles` so it can `.eq('segment', …)` (Lane B §1.6 — segment is NOT a `profiles` column, must come from the view). Replace the lying `.or(account_type…)` filter (`:208-209` + the 5 stats sites) with the derived segment.

### 6.2 Success criteria
- **SC-B.1** A new `#/support` nav item renders the support desk inside the authed shell; non-admins never reach it (App.jsx only renders pages when `session` set + RLS).
- **SC-B.2** The queue lists open tickets newest-activity-first; clicking one opens the thread; admin can reply (message persists, requester gets it in realtime + push).
- **SC-B.3** Admin can claim, set status (legal transitions only), set priority; `first_response_at`/`resolved_at` populate correctly.
- **SC-B.4** Staff roster: admin grants a user `enabled=true` → that user's `is_support_staff()` flips true (verifiable Phase C); revoke flips it false.
- **SC-B.5** Users page shows Explorer/Business/Admin tabs with correct counts (admin=1, business=13, explorer=residual at build time); selecting a tab filters the list via the view; the old `account_type` filter no longer lies.

### 6.3 Invariants
- Admin client stays anon-key (never service-role in the browser) (Lane D D2). Segment is read from `derive_user_segment`/the view, never a trusted stored column (Lane B §6). No fabricated counts (missing = 0, not faked).

### 6.4 Test cases

| Test | Scenario | Expected | Layer |
|---|---|---|---|
| T-B.1 (happy) | Admin replies to a queued ticket | message persists; requester realtime + push | full stack |
| T-B.2 (happy) | Segment counts | tabs show admin=1/business=13/explorer=rest | view+UI |
| T-B.3 (adversarial) | Non-admin hits `#/support` | shell not rendered / RLS returns nothing; no data leak | authz |
| T-B.4 (edge) | Illegal status transition (`new`→`resolved` skip) | edge fn rejects or normalizes per §2.1 lifecycle | edge |
| T-B.5 (regression) | account_type filter no longer hides business users | business users appear under Business tab, not buried in "consumer" | UI |

---

## 7. PHASE C — Business-App Staff Console (mingla-business iOS + Android)

**Surfaces:** Business iOS + Android (shared RN — parity automatic). **Depends on:** Phase 0 + Phase B staff-grant (to have staff to test). Push needs a build/OTA.
**REQUIRES a `mingla-designer` DESIGN pass** (`DESIGN_META-ORCH-1104_PHASE_C_STAFF_CONSOLE.md`).

### 7.1 Layer-by-layer (Lane C Findings 2.4, 3, 4)
- **Capability hook:** new `mingla-business/src/hooks/useSupportStaff.ts` — React-Query keyed on **`user.id`** (NOT `currentBrandId`), reading the user's own `support_staff` row; returns `{ isStaff, enabled, available }`; short stale-time (security-adjacent, mirror `useCurrentBrandRole`).
- **Mount (sub-page, NOT a tab — Lane C Finding 2.4, CF-C3):** a "Support console" `GlassCard` on `(tabs)/account.tsx` rendered ONLY when `useSupportStaff().isStaff && enabled`, with a row → `router.push('/support/inbox')`. New routes `app/support/inbox.tsx` (queue) + `app/support/[ticketId].tsx` (thread). Do NOT add a `TABS` entry (would hit the brand-rank `MIN_RANK_FOR_TAB` strict-grep gate, which can't express a brand-decoupled capability — CF-C3).
- **Availability toggle:** a `Switch` in the inbox header / console card writing `available` via the `support_set_available` RPC (§2.7 — column-restricted self-write).
- **Inbox actions:** list the shared queue (same `support_tickets` the PC sees), claim/switch/reply/create via the `support-*` edge fns; reply composer reuses the business `groupChatService.postPlannerMessage` pattern + the `conversation:{id}` realtime channel (Lane A F6.1/F6.2 — identical channel, no new realtime).
- **Push (Lane C Finding 4, D6):** staffer receives `business.support_new_ticket` / `business.support_message` on the BUSINESS OneSignal app (`app:"business"`), gated by `available=true`; deep-link → `/support/[ticketId]` via the new `businessNotificationRouting` case. Push pref master "Support console" added to `app/account/notifications.tsx` (`:72-93`), rendered only when `isStaff` (Lane C Finding 4.3).

### 7.2 Success criteria
- **SC-C.1** A non-staff business user sees NO "Support console" card and cannot reach `/support/*` (client gate + server RLS).
- **SC-C.2** An enabled staffer sees the console; toggling availability persists `available`.
- **SC-C.3** With `available=true`, a new ticket fires a `business.support_new_ticket` push to the staffer's business app; with `available=false`, no push.
- **SC-C.4** Staffer claims a ticket (sets `assigned_staff_id`, seeds participant), replies (requester gets it realtime + push), and the PC desk reflects the claim/reply live (shared queue).
- **SC-C.5 (iOS + Android)** Both verified on sim/emulator.

### 7.3 Invariants
- **I-1104-STAFF-DECOUPLED** — `useSupportStaff` keys on `user.id`, never `currentBrandId` (Lane C Finding 3). Console + routes gate on `isStaff && enabled`; server RLS is the real boundary (Lane D D5). Push to staff = `app:"business"` always (CF-C2). Availability gates new-ticket push (off-duty = no ping, no PII leak).

### 7.4 Test cases

| Test | Scenario | Expected | Layer |
|---|---|---|---|
| T-C.1 (adversarial) | Non-staff opens `/support/inbox` directly | empty/blocked by RLS; no queue data | authz |
| T-C.2 (happy) | Available staffer, new ticket | business-app push received; appears in inbox | push+realtime |
| T-C.3 (happy) | Claim + reply on phone | PC desk shows claim+reply live | cross-client |
| T-C.4 (edge) | available=false | no new-ticket push (off-shift) | push |
| T-C.5 (adversarial) | Staffer writes own `enabled` via RPC | only `available` mutable by self; `enabled` admin-only | RLS/RPC |

---

## 8. PHASE D — Business User's Own Support Entry (mingla-business iOS + Android)

**Surfaces:** Business iOS + Android. **Depends on:** Phase 0. Can run with Phase C (same build/OTA).
**REQUIRES a `mingla-designer` DESIGN pass** (may be folded into the Phase C design doc).

### 8.1 Layer-by-layer (Lane C Finding 2.3)
- Add a `SettingsNavRow` (`icon="help"`, "Help & Support") to the existing "Settings" `GlassCard` on `(tabs)/account.tsx` (`:338-354`, after "Notifications"), `onPress → router.push('/account/support')`.
- New route `app/account/support.tsx` (mirrors `account/notifications.tsx`): start-chat / file-ticket for the business user as a REQUESTER (their `requester_segment` derives to `business`). Reuses the same `create_support_ticket` RPC + the support thread surface. Reachable by every business user regardless of brand rank (it's a requester surface, not the staff console).

### 8.2 Success criteria
- **SC-D.1** Every business user (any rank) sees "Help & Support" → can open a ticket; it lands in the SAME shared queue with `requester_segment='business'`.
- **SC-D.2** The business requester sees their own tickets only (RLS), gets staff replies in realtime + business-app push.
- **SC-D.3 (iOS + Android)** Both verified.

### 8.3 Test cases

| Test | Scenario | Expected | Layer |
|---|---|---|---|
| T-D.1 (happy) | Business user files a ticket | ticket with `requester_segment='business'` in the shared queue | full stack |
| T-D.2 (adversarial) | Business user opens staff inbox via Help&Support | NO — Help&Support is requester-only; staff console is the separate gated route | authz |

---

## 9. PHASE E — v2 Hardening (OUT of v1 SCOPE — backlog list only)

Listed, not specified. Each becomes its own future sub-ORCH if Seth greenlights:
- **Anonymous / buyer-web support** (D1 deferral) — identity + abuse controls for unauthenticated web checkout buyers.
- **Routing:** round-robin / business-hours / topic routing / SLA timers + breach alerts (D4 deferral).
- **Presence/availability polish** beyond live-chat baseline; staff "who's online" board.
- **Canned replies, internal staff notes** (non-requester-visible), macros.
- **Dedicated `support_replies` opt-out column** + consumer toggle (D6 Option β).
- **CSAT / satisfaction survey on resolve; analytics tiles** (volume, first-response time, resolution time) on the admin desk.
- **`support_audit_log` dashboard** (if a lightweight log row was the v1 choice, the viewer is v2).

---

## 10. PHASE DISPATCH ORDER + DEPENDENCIES

```
Phase 0 (backend foundation)  ── BLOCKS everything ──┐
                                                      ├─► Phase A (consumer requester)   ─┐
                                                      ├─► Phase B (admin desk + segment) ─┤  A ∥ B ∥ (C after B-grant)
                                                      │                                   │
                                  Phase B staff-grant ─► Phase C (business staff console) ┤
                                                      └─► Phase D (business requester)    ─┘  D ∥ C (same build/OTA)
```

- **Phase 0 blocks all** (tables/RLS/RPCs/edge/segment). Ship + merge first.
- **Phase A and Phase B can parallelize** (different surfaces; both only need Phase 0). Segmentation (inside B) is small + high-value and could front-run as a standalone quick win if Seth wants immediate value (PROPOSAL §5).
- **Phase C depends on Phase B's staff-grant** UI to create staff to test the console (or grant via raw SQL/edge fn in the interim). C + D share a business-app build/OTA — ship together.
- **Recommended first shippable milestone:** Phase 0 + A + B = support works end-to-end (Explorer files → Seth answers on PC). Then C + D as the business-app OTA.
- **Per-ORCH worktree + one PR per CLOSE.** Every backend-touching phase (0, and the C push edge work if any new fn) carries its `META_ORCH_1104_BACKEND_ALLOWLIST` entry (§2.11). COMMS-0003 (cite provider docs) — N/A here (no new external API; OneSignal already integrated). COMMS-0004 (INTAKE ID scan) — handled at META registration.

---

## 11. OPEN QUESTIONS FOR THE OPERATOR (genuinely undecided after D1–D6)

1. **Audit-log depth (Lane D D5 #7):** reuse `admin_audit_log` for staff claim/read/reply, or add a dedicated `support_audit_log`? (SPEC defaults to a lightweight `support_audit_log` row on claim/reply; "read" logging is heavier — log reads too, or only writes?) Recommend: log claim + reply + status-change only; skip per-read logging in v1.
2. **Auto-close window:** after how many days of `resolved` does a ticket auto-`closed`? (SPEC leaves it unset in v1 — manual close only — unless you want a value, e.g. 7 days.)
3. **`brand_id` capture (Lane B / §2.1):** when a business user files from a business context, do we snapshot which brand (`brand_id`)? v1 leaves it nullable and only the business-account entry (Phase D) could set it. Want brand context captured, or punt to v2?
4. **Priority authorship:** v1 lets only staff set priority (requester always opens at `normal`). Confirm requesters cannot self-escalate (recommended — prevents priority gaming).
5. **Segment badge for dual-role users (PROPOSAL §3.4):** a user who is BOTH admin and business — surface the highest-privilege badge (admin) but allow filtering under either tab? (SPEC defaults: `derive_user_segment` returns `admin` first, so they count as admin; confirm that's the desired display.)
6. **D6 confirmation:** ride `messages` boolean (Option α, recommended) vs add `support_replies` column (Option β, deferred). Confirm α for v1.

---

## 12. CROSS-SURFACE IMPACT (Phase 2.5 — consolidated)

Covered: Consumer iOS/Android (Phase A, shared RN, automatic parity); Business iOS/Android (Phases C+D, shared RN); Admin Web (Phase B). Backend (Phase 0). NOT covered + why: Buyer/anonymous Web — D1 (deferred to v2); Business Web preview — no support surface planned (push is web-no-op'd, staff console is a phone console). Where parity is automatic (shared RN), one SC set with iOS + Android sim/emulator proof at TEST; no separate code paths exist, so no per-surface SC split is required beyond the platform-proof note in each phase's SC.

---

## 13. REGRESSION PREVENTION

- **Strict-grep gates (Phase 0):** ban `profiles.is_admin` reintroduction; ban bare `tickets`/`agents` schema names for support; assert every staff chat policy carries `linked_entity_type='support'`.
- **D6 dead-gate regression test:** assert `notify-dispatch` reads a real `notification_preferences` boolean column (catches the silent no-op returning).
- **Admin-gate test:** `admin_toggle_partner` keyed on `is_admin_user()` (catches a revert to `account_type='admin'`).
- **PII test (T-0.4):** staff cannot read non-support conversations (catches a policy that drops the `linked_entity_type='support'` scope).
- **Protective comments:** every support RLS policy carries a `-- Lane D D5: support-scoped; never widen staff into user DMs` comment; `claim_support_ticket` carries a `-- service-role edge fn ONLY; never client-exposed with arbitrary p_staff_id`.

---

**END SPEC.** Phase 0 is specified to build without guessing. Phases A–D carry functional + UX contracts; each UI phase REQUIRES its referenced `mingla-designer` DESIGN pass before IMPLEMENT dispatch.
