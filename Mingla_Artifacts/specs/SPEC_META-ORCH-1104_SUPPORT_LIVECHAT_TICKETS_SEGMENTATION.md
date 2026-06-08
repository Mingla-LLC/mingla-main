# SPEC — META-ORCH-1104 — Business Support Live-Chat + Tickets + Admin User Segmentation

**Skill:** `mingla-forensics` (SPEC mode)
**Date:** 2026-06-08 (REVISED — corrected scope)
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-1104-[support-livechat-segmentation]/` on branch `meta-orch-1104-support-livechat-segmentation`
**Type:** META-ORCH (one Phase = one sub-ORCH = one worktree + one PR per CLOSE)
**Severity:** S2-medium (no launch dependency; high operational value)
**Evidence basis:** PROPOSAL_META-ORCH-1104 §0 correction + JOURNEY_META-ORCH-1104 (operator-approved journeys + real mount points) + four-lane forensic audit (Lane A messaging/realtime/push, Lane B admin/segmentation/data-integrity, Lane C client surfaces/identity, Lane D security/RLS/authz). Every contract below cites the audit finding it rests on, OR the journey doc, OR a live-code fact verified in this revision.

> **REVISION NOTE (2026-06-08).** This SPEC was rewritten to the operator's CORRECTED scope. Three corrections drove the rewrite:
> 1. **BUSINESS-SIDE ONLY.** There is NO consumer/Explorer-app support. The requester is a **business user** filing from the **business-app account page**; handlers are admin (PC) + support-tagged business users (phone). "Explorer" survives ONLY as an admin segmentation LABEL. The old consumer Phase A is **DELETED**.
> 2. **FULL CROSS-SURFACE PARITY IS MANDATORY.** Every requester + handler surface must work and stay at parity across: (a) business app NATIVE (iOS + Android), (b) business WEB on PC browser, (c) business web on MOBILE browser, (d) admin WEB on PC browser (and remain non-broken on mobile browser). `mingla-business` is an Expo app exported to web and the web bundle is **fragile** (ORCH-1085→1097 repeatedly broke it on native-module imports). The SPEC specifies, per surface, how support **degrades safely** on web via the established native-module quarantine pattern. See §0.2 + the per-phase Web-Degradation Contracts + §12 Parity Matrix.
> 3. **SEGMENTATION DATA-INTEGRITY CLEANUP IS APPROVED.** The dead `profiles.is_admin` retirement, the `admin_toggle_partner` gate-bug fix, and `derive_user_segment` are IN scope (no longer "optional cleanup"). The production `DROP COLUMN` uses a reversible, operator-gated two-step (snapshot → deprecate → operator-gated drop), NOT an unguarded drop in the feature migration. See D5 + §2.5.

> **Reading guide.** This is a buildable contract, not a brainstorm. Phase 0 is specified to the point where the implementor builds it without guessing. Phases 1–3 specify the layer-by-layer contract + per-surface success criteria + test cases + invariants + an explicit Web-Degradation Contract. Every UI phase REQUIRES a `mingla-designer` DESIGN pass (referenced per phase) before its IMPLEMENT dispatch — this SPEC owns the functional contract + UX acceptance bar; the designer owns the granular visual contract (tokens, all-9-states copy, motion).

---

## 0. LOCKED DECISIONS (D1–D6) — encoded, each operator-confirmable

These are the operator-recommended defaults. Each is marked **operator-confirmable** — Seth may overturn any one before Phase 0 IMPLEMENT dispatch; absent an override, the implementor builds exactly this.

- **D1 — BUSINESS-SIDE ONLY (corrected).** Support is **business-side only**. The support **REQUESTER** is a logged-in **business user** filing from the **business-app account page** (`mingla-business` Account → Help & Support). The support **HANDLERS** are: **admin on PC** (admin web) + **support-tagged business users on the business app** (phone console). **There is NO consumer/Explorer-app support surface.** "Explorer users" exists ONLY as an admin **segmentation LABEL** on the Users page, never as a support audience. Anonymous web-checkout buyer support is also **explicitly DEFERRED** to a future v2 (Phase 4 backlog). *Rationale (§0 correction; Lane D D5 PII/abuse surface):* business-side reuses `auth.uid()` as the identity spine end-to-end; the consumer app gets nothing. **(operator-confirmable)**

- **D2 — ONE entity unifies live-chat + ticket. Canonical schema name = `support_tickets`.** A ticket OWNS a conversation; "live chat" = a ticket whose two parties are both present in realtime; "ticket" = the same row answered async later. UI copy may freely say "chat" / "ticket" / "support request"; the **SCHEMA must never reuse the bare names `tickets` or `agents`** — `tickets`/`ticket_types`/`ticket_checkout_*` are event-money ticketing and `agent_*` are the ARI AI agent (PROPOSAL E1, Lane B §5.4, Lane C CF-C1). The message thread reuses the existing `conversations`/`messages` substrate (Lane A F1, Lane D D1). **(operator-confirmable)**

- **D3 — Support-staff capability lives in a DEDICATED table `support_staff`, DECOUPLED from brand membership.** Columns include `user_id, enabled, available, role`. Admin grants/revokes `enabled`; the staffer self-toggles `available` (shift on/off). SQL helper `is_support_staff(p_user_id uuid)` mirrors the existing `is_admin_user()` idiom (Lane D D3, D4; Lane C Finding 3 — every business-app capability is brand-scoped today, so support MUST NOT be a `brand_team_members.role`). **(operator-confirmable)**

- **D4 — Routing v1 = ONE shared queue + CLAIM.** All tickets land in one queue; every enabled+available staffer sees it and is notified of new tickets; anyone can **claim** (sets `assigned_staff_id`). The PC desk and the phone console read the **same** queue — claim on phone shows claimed on PC instantly (journey 3 step 7). NO round-robin, business-hours, SLA, or topic routing in v1 — those are Phase 4 / v2 (PROPOSAL §3.3, fork #4). **(operator-confirmable)**

- **D5 — Segmentation is DERIVED, and we DO the data-integrity cleanup (operator-approved).** Introduce `derive_user_segment(p_profile_id uuid) -> 'admin'|'business'|'explorer'`: **Admin** = the profile's email ∈ `admin_users` `status='active'`; **Business** = an accepted, non-removed `brand_team_members` row; else **Explorer**. `account_type` is realigned as a **view-written cache**, NOT the source of truth. The cleanup (all THREE, operator-approved 2026-06-08):
  1. **Retire the dead `profiles.is_admin` column SAFELY** (Lane B §3/§4.2: 0 writers / 0 readers / 0 true rows; blast radius ≈ 0). Because it is a **production `DROP COLUMN`**, it is **NOT** an unguarded drop inside the feature migration. Use the reversible, operator-gated two-step in §2.5.1: (a) the Phase-0 feature migration **snapshots** the column's data and marks it deprecated (and adds the strict-grep gate banning new reads), but does **NOT** drop it; (b) a **separate, operator-gated drop migration** (`<ts>_meta_orch_1104_drop_profiles_is_admin.sql`) is written but applied **only on Seth's explicit go**, after Phase 0 has soaked.
  2. **Fix the latent `admin_toggle_partner` gate bug** — it gates on `profiles.account_type='admin'` while login/RLS gates on `admin_users` (Lane B §2.4), so an invited admin passes login but is FORBIDDEN by `admin_toggle_partner`; rewrite it (and its 2 migration twins) to `is_admin_user()`.
  3. **Add `derive_user_segment`** + a view; backfill/realign `account_type` from the derived segment as a **cache** + a CHECK so the admin Edit input can't write garbage (Lane B §4.1, §6). **(operator-confirmable)**

- **D6 — Per-app push routing.** Staffer-bound pushes carry a `business.support_message` / `business.support_new_ticket` type so `resolveOneSignalApp` routes them to the **business** OneSignal app AND the business inbox's `type.like 'business.%'` filter renders them (Lane A F5.6, F6.3; Lane C CF-C2). The business-user REQUESTER's reply pushes are ALSO business-typed (the requester is a business-app user — there is no consumer push leg in this corrected scope). **FIRST fix the pre-existing dead-code `notification_preferences` gate in `notify-dispatch`** (Lane A F5.5b: the dispatcher reads non-existent `channel`/`type`/`opt_in` columns, so the entire type-preference gate is a silent no-op) **before** adding any support opt-out. **Recommended cheapest-correct option (§0.1):** ride the existing `messages` boolean for v1; do NOT add a `support_replies` column; the working controls are `conversation_participants.notifications_muted` (per-thread) + quiet-hours. **Push is NATIVE-ONLY: on business web (PC + mobile browser) there is no OneSignal — push is a documented no-op and the inbox/thread surface without push.** **(operator-confirmable)**

### 0.1 D6 push-preference decision — justification (cheapest correct option)

Lane A F5.5b proves `notify-dispatch`'s `notification_preferences` type-gate is **dead today** — it reads `row.channel === 'push' && row.type === '*' && row.opt_in === false` against a table that has **no** `channel`/`type`/`opt_in` columns (the live table is boolean-column-per-category: `messages`, `marketing`, `push_enabled`, …). So push is presently gated only by idempotency + rate-limit + session-mute + quiet-hours + `conversation_participants.notifications_muted` (Lane A F5.2/F5.3).

- **(Option α — recommended, cheapest correct):** Do NOT add a `support_replies` column for v1. Repoint the `notify-dispatch` gate at the real boolean-column schema (the pre-existing-bug fix mandated by D6), checking the **existing `messages` boolean** for support message types (a support reply IS a message). Per-thread mute via `notifications_muted` remains the precise control. Net: one small dispatcher fix, zero new columns, no new toggle. Justification: effectively zero real users today (Lane B §3.1); bundling under `messages` is correct semantics and ships the dispatcher-bug fix as a byproduct.
- **(Option β — deferred):** Add a dedicated `support_replies` boolean column + a toggle. More surface, marginal value. **Deferred to Phase 4.**

**Phase 0 MUST implement the dispatcher-gate fix (Option α). The dedicated `support_replies` column is OUT of v1.**

### 0.2 Web-degradation foundation — the established native-module quarantine pattern (CORRECTION 2)

`mingla-business` is one Expo codebase exported to web; the web bundle is **fragile** and broke repeatedly across ORCH-1085→1097 on native-module imports (COMMS-0002 acked_by trail). The established, in-repo contract this SPEC builds support on — verified live in this revision:

1. **`Platform.OS === 'web'` guards** everywhere a native SDK would touch web (`app/_layout.tsx` — OneSignal init is web-no-op'd at `:402-403`; splash, AppState, AppsFlyer all guarded).
2. **Native-module quarantine via platform-resolved wrappers** — the proven pattern is `Foo.native.tsx` (native impl importing the native module) + `Foo.tsx` (web/default passthrough). Live examples: `src/wrappers/KeyboardRoot.native.tsx` + `KeyboardRoot.tsx` (the comment at `_layout.tsx:52-55` states `react-native-keyboard-controller` has **no web entry point**, so the web variant is a passthrough Fragment, per `SPEC_ORCH-0892-A §7.3`); `src/wrappers/SmartScrollView.native.tsx` + `SmartScrollView.tsx`; `useKeyboardIsVisible.native.ts` + `useKeyboardIsVisible.ts`. The PUSH service is similarly web-no-op'd (`oneSignalService` never initializes the native module on web).
3. **Per-route `.web.tsx` shells** for routes whose native body can't run on web (live: `app/connect-*.web.tsx`, `app/event/[id]/scanner/index.web.tsx`).
4. **A signed-out web route firewall + auth-resolving loading gate** (`_layout.tsx`, ORCH-1087/1093/1100/1102) — any web route renders an auth-resolving loading screen, then either the surface or a redirect to sign-in; no dead-ends, no logged-out flash.

**THE LOAD-BEARING SUPPORT-SPECIFIC RISK (verified live, 2026-06-08):** the chat thread UI we reuse — `mingla-business/src/components/groupChat/GroupChatPanel.tsx` — imports `KeyboardAvoidingView` **directly from `react-native-keyboard-controller` at line 16**, i.e. it does NOT route through the `KeyboardRoot`/`SmartScrollView` wrapper quarantine. `react-native-web` shims this, but ORCH-0892-A §7.3 documents native-keyboard primitives as the exact web-break class. **Therefore: the support thread surface, when rendered on business web, MUST NOT import keyboard-controller primitives directly.** Realtime is already web-safe — `useEventGroupChat.ts:57` uses only `supabase.channel('conversation:${id}')` (pure JS SDK; zero native modules). See §2.10 + per-phase Web-Degradation Contracts for the exact quarantine each phase ships.

---

## 1. v1 SCOPE BOUNDARY

### IN scope (v1)
- **Phase 0** — backend foundation (tables, helper, support-scoped RLS, claim/seed RPC, segment derivation + admin RLS, data-integrity cleanup with reversible `is_admin` handling, push fix, COMMS-0002 allowlist, strict-grep gate).
- **Phase 1** — business requester entry: Account → Help & Support → ticket list + start-chat + thread, across business-app NATIVE + business WEB (PC) + business web (MOBILE browser).
- **Phase 2** — admin PC desk (queue + detail + agents panel) + Users-page Explorer/Business/Admin segmentation, with mobile-browser non-break.
- **Phase 3** — business-app staff console (gated card → inbox → claim/switch/reply/availability toggle + push), across NATIVE + web (push native-only; web shows inbox without push).

### OUT of v1 scope (deferred to Phase 4 / v2)
- Consumer/Explorer-app support of any kind (D1 — correction: there is none).
- Anonymous / buyer-web support (D1).
- Round-robin / business-hours / SLA / topic routing (D4).
- Canned replies, internal staff notes, dedicated `support_replies` opt-out column (D6 Option β).
- Presence/availability polish beyond the live-chat baseline, multi-language, CSAT surveys.

### Affected Surfaces (Phase 2.5 cross-surface block — corrected)

| # | Surface | In v1? | Behavior demanded / why not |
|---|---|---|---|
| 1 | **Consumer iOS / Android** (`app-mobile/`) | ❌ | **D1 — NO consumer support.** The consumer app gets nothing. "Explorer" is an admin label only. |
| 2 | **Business iOS** (`mingla-business/` native) | ✅ Phases 1, 3 | Requester Help & Support (1) + staff console (3). Parity with Android **automatic** (shared RN) — verified on Android **physical** at TEST. |
| 3 | **Business Android** (`mingla-business/` native) | ✅ Phases 1, 3 | Same shared code; **Android-physical** proof mandatory. |
| 4 | **Business WEB — PC browser** (`mingla-business` web export) | ✅ Phases 1, 3 | Requester thread (1) + staff inbox/thread (3) work on PC browser via the native-module quarantine (§0.2). Push = no-op on web; realtime/presence work via the JS SDK. |
| 5 | **Business web — MOBILE browser** (`mingla-business` web export) | ✅ Phases 1, 3 | Same web bundle; must pass the mobile-web route firewall + render the thread without keyboard-controller breakage. **Mobile-browser proof mandatory.** |
| 6 | **Admin Web — PC browser** (`mingla-admin/`) | ✅ Phase 2 | Support desk + segmentation. **PC-browser proof mandatory.** |
| 7 | **Admin web — mobile browser** (`mingla-admin/`) | ✅ Phase 2 (non-break) | Must remain **usable / non-broken** on a mobile browser (responsive, no horizontal scroll, no crash). Full desk ergonomics are a PC target; mobile = "don't break." |

Backend (`supabase/`) is touched by Phases 0 + 4 only.

---

## 2. CONSOLIDATED DATA MODEL

All DDL is the **authoritative Phase-0 contract**. Migration-baseline hazards apply (memory `feedback_edge_deploy_and_migration_apply_hazards.md`): widening a CHECK = `DROP CONSTRAINT` then `ADD CONSTRAINT` in the same migration; `$function$;` terminator before any `GRANT`; `DROP` before widening a `RETURNS TABLE`; deploy from MERGED main; apply via Supabase Management API if the CLI is drift-wedged. **Migrations are applied by Seth via `supabase db push` — the implementor writes the migration file, never `mcp__supabase__apply_migration`.**

### 2.1 `support_tickets` (new table — the support entity, D2)

```sql
CREATE TABLE public.support_tickets (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requester_segment  text NOT NULL DEFAULT 'business'
                       CHECK (requester_segment IN ('business','explorer')),  -- v1 requesters are business; 'explorer' reserved for a future buyer leg
  subject            text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 1 AND 200),
  status             text NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new','open','pending','resolved','closed')),
  priority           text NOT NULL DEFAULT 'normal'
                       CHECK (priority IN ('low','normal','high','urgent')),
  assigned_staff_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,       -- claim sets this (D4)
  conversation_id    uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,  -- the thread (D2)
  brand_id           uuid REFERENCES public.brands(id) ON DELETE SET NULL,    -- nullable; set from the business context if available
  created_at         timestamptz NOT NULL DEFAULT now(),
  first_response_at  timestamptz,    -- set on first staff message (Phase 2/3)
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
`new` → (requester sent first message, before any staff touch) → `open` (a staffer claimed/replied) → `pending` (waiting on requester) ↔ `open` → `resolved` (staff marks done) → `closed` (auto after N days OR explicit). `closed`/`resolved` may reopen → `open` on a new requester message. Phase 0 ships the columns + CHECK; Phase 2/3 own the transition writes.

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

-- List/count ergonomics for the admin page. A SECURITY INVOKER view inherits the caller's
-- profiles RLS ("Admins can read all profiles"); a non-admin sees only their own row.
CREATE OR REPLACE VIEW public.profiles_with_segment
WITH (security_invoker = true) AS
SELECT p.*, public.derive_user_segment(p.id) AS segment
FROM public.profiles p;
```

**Admin/business population truth (Lane B §3):** Admin = 1 active (`seth@usemingla.com`); Business = 13 distinct accepted `brand_team_members` users (all Seth's dev/harness accounts); Explorer = residual. Do NOT over-engineer for scale.

> **`account_type` as a view-written cache (D5):** `account_type` is NOT authoritative. It is backfilled once from `derive_user_segment(id)` so the legacy admin `.or(account_type…)` filter stops lying, and a CHECK constrains it. The admin page reads the **`segment` column of the view**, never the cached `account_type`. "View-written cache" = the value is materialized from the derive function, not authored by a user.

### 2.5 Data-integrity cleanup migration (D5, Lane B §6) — SAME Phase-0 work, with REVERSIBLE `is_admin` handling

1. **Rewrite `admin_toggle_partner`** (live def) + the 2 migration twins (`20260822000000_orch_1052_partner_identity_stripe.sql:112,:434`, `20260823000000_orch_1054_partner_splits.sql:118`) to gate on `public.is_admin_user()` instead of `profiles.account_type='admin'`. Closes the §2.4 privilege divergence (Lane B §2.4).
2. **`account_type`:** keep the column as a non-authoritative cache. `ALTER TABLE public.profiles ADD CONSTRAINT profiles_account_type_check CHECK (account_type IS NULL OR account_type IN ('explorer','business','admin'));` Backfill once from `derive_user_segment(id)`.
3. **`profiles.is_admin` — REVERSIBLE, TWO-STEP, OPERATOR-GATED retirement (D5.1 — NOT an unguarded drop):** see §2.5.1. The Phase-0 feature migration does **NOT** drop the column.

#### 2.5.1 Reversible `profiles.is_admin` retirement (the production-DROP-COLUMN safety)

Dropping a production column is irreversible mid-migration and destroys any latent data. Even though Lane B §3/§4.2 proves 0 writers / 0 readers / 0 true rows (blast radius ≈ 0), this SPEC mandates a **reversible, operator-gated two-step**:

- **Step A (in the Phase-0 feature migration `<ts>_meta_orch_1104_support_foundation.sql`):**
  1. **Snapshot** the column's data into a backup table so the drop is recoverable:
     ```sql
     CREATE TABLE IF NOT EXISTS public._deprecated_profiles_is_admin_backup AS
       SELECT id AS profile_id, is_admin, now() AS snapshotted_at FROM public.profiles;
     COMMENT ON TABLE public._deprecated_profiles_is_admin_backup IS
       'META-ORCH-1104 D5.1 snapshot of profiles.is_admin prior to drop. Restore source if the drop must be reversed. Drop this backup once the separate drop migration has soaked.';
     ```
  2. **Mark deprecated** (do NOT drop): `COMMENT ON COLUMN public.profiles.is_admin IS '[DEPRECATED META-ORCH-1104 D5.1] dead column — 0 readers; segment derives from admin_users/brand_team_members. Drop via the separate operator-gated drop migration. DO NOT add new readers.';`
  3. **Strict-grep gate** banning any NEW read/write of `profiles.is_admin` (catches reintroduction) — §4.1 item 4. (`session_participants.is_admin` is a different column and is NOT banned.)
- **Step B (a SEPARATE migration file `<ts>_meta_orch_1104_drop_profiles_is_admin.sql`, written in Phase 0 but APPLIED ONLY on Seth's explicit go, after Phase 0 has soaked):**
  ```sql
  -- OPERATOR-GATED. Apply ONLY after Seth confirms Phase 0 has soaked with no is_admin readers.
  -- Reversible via public._deprecated_profiles_is_admin_backup (the Step-A snapshot).
  ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_admin;
  ```
  The SPEC requires the implementor to deliver Step B's file but to STOP and flag in the implementation report that it is **operator-gated — not to be applied with the feature migration**. Seth applies it on his own go.

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
-- (3) name rule: support conversation is type='group' + name = ticket subject. The existing
-- conversations_group_requires_name already requires a non-empty trimmed name — no DROP/ADD needed.
```

**Decision (D2-consistent):** support conversation = `type='group'` + `name = <ticket subject>` (≤200 chars). `message_type` needs NO change — support messages are `'text'`/`'image'`/`'file'`, and `'system'` (sender_id NULL) is available for "claimed"/"resolved" banners (Lane A F1.5).

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
-- so 'support' passes — the SPEC REQUIRES the implementor to confirm this holds after adding
-- 'support', with a test asserting a support INSERT is not blocked by the restrictive policy.

-- presence parity (Lane D D5 #9): extend conversation_presence SELECT with a support-staff branch
CREATE POLICY conversation_presence_support_staff_read ON public.conversation_presence FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_presence.conversation_id
      AND c.linked_entity_type = 'support')
    AND (public.is_support_staff(auth.uid()) OR public.is_admin_user()));
```

**Why option-b primary (Lane D D3):** it is the exact pattern the codebase already uses for brand-team access (`conversations_brand_team_member_read`, `messages_brand_team_member_insert`) — a feature-scoped predicate + a SECURITY DEFINER helper. No participant-row pollution; revoking staff instantly revokes access; RLS-honored realtime SELECT lets PC, phone, AND web staff stream the thread (Lane A F3.4, F6.2). **Claim-time participant insertion is defense-in-depth only** (presence/read-receipt parity), never the sole gate, and MUST run through the SECURITY DEFINER RPC below (Lane A F2.2/F6.5, Lane D D5 #6).

### 2.8 The staffer-seed + ticket-mint SECURITY DEFINER RPC (Lane A F2.1/F2.2/F6.5, Lane D D5 #6)

There is NO client primitive to mint a non-direct conversation or to add a staffer as a participant (Lane A F2.1, F2.2). Phase 0 ships:

```sql
-- Mint a support ticket + its conversation + seed the requester participant, atomically.
-- Called by the requester (RLS lets them create their own conversation/ticket); runs DEFINER to
-- seed the participant + satisfy constraints safely.
CREATE OR REPLACE FUNCTION public.create_support_ticket(p_subject text, p_brand_id uuid DEFAULT NULL)
RETURNS uuid  -- returns support_tickets.id
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_conv uuid; v_ticket uuid; v_seg text;
BEGIN
  v_seg := public.derive_user_segment(auth.uid());     -- snapshot segment
  -- v1 requesters are business users; an admin who files is still a requester. Snapshot 'business'
  -- unless explicitly an explorer (reserved for the future buyer leg).
  IF v_seg = 'admin' THEN v_seg := 'business'; END IF;
  IF v_seg NOT IN ('business','explorer') THEN v_seg := 'business'; END IF;
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
| `support-claim` | true | `is_support_staff() OR is_admin_user()` → else 403 | calls `claim_support_ticket(ticketId, user.id)`. |
| `support-send` | true | requester (own ticket) OR staff/admin | inserts the message (prefer the RLS path for staff via the option-b INSERT policy; service-role for status side-effects); sets `first_response_at` on first staff message; bumps `last_message_at`; dispatches push. |
| `support-set-status` | true | `is_support_staff() OR is_admin_user()` | legal status transition (§2.1); sets `resolved_at`. |
| `support-grant-staff` | true | `is_admin_user()` ONLY | upsert `support_staff(user_id, enabled, role)`. The admin roster write. |
| `notify-support` (or a branch in `notify-message`) | service-role (internal) | n/a | push fan-out (D6): to staff `app:"business"`, `type:"business.support_new_ticket"`/`"business.support_message"`, filtered to `support_staff WHERE enabled AND available`; to the business-user requester `app:"business"`, `type:"business.support_message"` (no consumer leg). Deep-link: `businessNotificationRouting.ts:137` gains a `business.support_*` case (today falls to ACCOUNT_FALLBACK). |

**D6 dispatcher-bug fix (mandatory, Phase 0):** in `notify-dispatch` (Lane A F5.5b `:393-426`), repoint the dead `notification_preferences` type-gate at the real boolean-column schema — for support/message types, consult the existing `messages` boolean (Option α). Add a test asserting the gate now reads a real column (regression guard for the silent no-op).

### 2.10 Realtime + the web native-module quarantine (Lane A F3.4, F6.2; §0.2 verified live)

Because a support ticket OWNS a `conversations` row, the EXISTING `conversation:{conversationId}` channel delivers live support messages with **zero new realtime code**, and it is **web-safe**: `useEventGroupChat.ts:57` uses only `supabase.channel('conversation:${id}')` (pure JS SDK — works identically on native and web). Filter is on `conversation_id` (non-PK) — safe from the PK-filter footgun (Lane A F3.2). Presence via the JS SDK works once the viewer satisfies the presence SELECT policy (§2.7).

**THE QUARANTINE THE UI PHASES MUST SHIP (CORRECTION 2, verified live):** `GroupChatPanel.tsx:16` imports `KeyboardAvoidingView` directly from `react-native-keyboard-controller` (native; no web entry point per ORCH-0892-A §7.3). The support thread surface MUST follow the established `Foo.native.tsx` + `Foo.tsx` quarantine so the **web bundle never imports keyboard-controller primitives directly**. Two acceptable implementations (LOCKED that one is chosen; OPEN which):
- **(a)** Reuse `GroupChatPanel` only on native; provide a **web variant of the keyboard wrapper** (route the support thread's `KeyboardAvoidingView` through `src/wrappers/KeyboardRoot`/an equivalent platform-resolved wrapper whose `.tsx` web variant is a passthrough), OR
- **(b)** Build the support thread on a **thin, platform-resolved thread component** (`SupportThread.native.tsx` with the keyboard-controller path + `SupportThread.tsx` web passthrough) that reuses the shared message list/composer/realtime but NOT the direct keyboard-controller import.
Either way, **no support file may import `react-native-keyboard-controller` outside a `.native` module**, and a strict-grep gate enforces it (§4.1 item 5).

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
  "supabase/migrations/<ts>_meta_orch_1104_drop_profiles_is_admin.sql",  // operator-gated drop (Step B)
  // …plus any __tests__ files added in the same PR
];
```
(Wire the new const into the C7 allow set exactly as the existing `ORCH_*_BACKEND_ALLOWLIST` consts are.) The `notify-dispatch`/`notify-message`/`businessNotificationRouting.ts` edits are MODIFICATIONS of existing allow-listed files — confirm they don't trip C7 as "new".

---

## 3. SECURITY SECTION (consolidated — Lane D)

### 3.1 Three-client authorization model (corrected — all three clients are business-side)

| Client | Identity | Read path | Write path |
|---|---|---|---|
| **Business requester** (mingla-business native + web) | `auth.uid()` = `requester_user_id` | participant-gated RLS on their own support conversation (works once seeded by `create_support_ticket`) | normal `messages` INSERT (they're a participant) |
| **PC admin** (mingla-admin web) | anon key + JWT → `is_admin_user()` | option-b support RLS treats admins as staff (`… OR is_admin_user()`) | `support-send`/`support-set-status`/`support-claim` edge fns (re-assert admin) |
| **Phone/web staffer** (mingla-business native + web) | anon key + JWT → `is_support_staff(auth.uid())` | option-b support RLS → RLS-honored realtime SELECT, no participant pollution | `support-claim` + `support-send` edge fns (re-assert staff) |

Single source of truth for "who is staff" = `support_staff` (admin-managed) via `is_support_staff()`. "Who is admin" stays `admin_users` via `is_admin_user()`. Admins are implicitly support-capable.

### 3.2 The 9 mandatory authZ checks (Lane D D5 — every one is a Phase-0 success criterion)

1. New `support_staff` table; `enabled`/`role` writes gated by `is_admin_user()` ONLY (via `support-grant-staff`). A normal user cannot self-promote.
2. New `is_support_staff(p_user_id)` SECURITY DEFINER STABLE helper, modeled on `is_admin_user()`.
3. Chat-table support policies scoped to `linked_entity_type='support' AND (is_support_staff() OR is_admin_user())` for SELECT/INSERT/UPDATE — staff never widen into users' direct/group/event DMs. **Verify** the RESTRICTIVE `messages_broadcast_only_enforcement` still passes `'support'`.
4. `support_tickets` RLS: requester sees own; staff/admin see all; nobody else — NOT a blanket authenticated read.
5. Every `support-*` edge fn: `getUser()` → 401, then `is_support_staff()`-or-`is_admin_user()` RPC → 403; service-role used ONLY for the privileged write; never ship service-role to a client.
6. Claim-time participant insertion runs ONLY through `claim_support_ticket` (SECURITY DEFINER) behind a service-role edge fn — never a client insert.
7. Audit-log every staff claim/reply/status-change (reuse `admin_audit_log` or add `support_audit_log`); minimize PII in push payloads (push carries ids, not bodies); off-duty (`available=false`) staff excluded from new-ticket pushes.
8. COMMS-0002: `META_ORCH_1104_BACKEND_ALLOWLIST` entry in the same commit as every new edge fn / migration (§2.11).
9. Presence: support staff get the extended presence SELECT policy (§2.7) as primary + participant-seed as the convenience (§2.8).

### 3.3 Abuse / PII boundary (Lane D D5)
- Requester B reading requester A's case: blocked — B is not a participant, brand-team path is event/trip-only, no support policy matches → zero rows.
- Non-staff business user opening the staff console: blocked — brand membership grants brand/event access only; the console is gated client-side (cosmetic) AND server-side on `is_support_staff()` (the real boundary). The toggle UI is never trusted alone.

---

## 4. PHASE 0 — Backend Foundation (backend-only sub-ORCH)

**Surfaces:** Backend only. No mobile/admin UI. No OTA. No `mingla-designer` pass (backend-only).

### 4.1 Layer-by-layer (the build order)
1. **DB / feature migration** (one file `<ts>_meta_orch_1104_support_foundation.sql`): `support_tickets` (§2.1), `support_staff` (§2.2), `is_support_staff()` (§2.3), `derive_user_segment()` + `profiles_with_segment` view (§2.4), data-integrity cleanup (§2.5: rewrite `admin_toggle_partner` + twins; `account_type` CHECK + backfill; `is_admin` **snapshot + deprecate ONLY**, NO drop — §2.5.1 Step A), the 3-constraint `'support'` widening (§2.6), `create_support_ticket` + `claim_support_ticket` + `support_set_available` RPCs (§2.8/§2.7), all RLS policies (§2.7), optional `support_audit_log`.
2. **Operator-gated drop migration** (SEPARATE file `<ts>_meta_orch_1104_drop_profiles_is_admin.sql`, §2.5.1 Step B): written but NOT applied with the feature migration; implementation report flags it operator-gated.
3. **Edge fns:** `support-claim`, `support-send`, `support-set-status`, `support-grant-staff`, and `notify-support` (or `notify-message` branch) (§2.9). Plus the `notify-dispatch` D6 dead-gate fix (§2.9).
4. **Router patch:** `businessNotificationRouting.ts:137` gains a `business.support_*` case (Lane A F5.6).
5. **CI:** `META_ORCH_1104_BACKEND_ALLOWLIST` block (§2.11); strict-grep gate banning NEW reads/writes of `profiles.is_admin` (D5.1 — `session_participants.is_admin` exempt); strict-grep gate banning bare `tickets`/`agents` schema names for support (CF-C1); strict-grep gate banning a `react-native-keyboard-controller` import in any non-`.native` support file (§2.10 — for Phases 1/3 — register the gate in Phase 0).
6. **TS types:** regenerate Supabase types so `support_tickets`/`support_staff`/`segment` are available to Phases 1–3.

### 4.2 Success criteria (observable / testable)
- **SC-0.1** A logged-in user calls `create_support_ticket('Help with my booking')` → returns a uuid; a `support_tickets` row (status `new`, segment derived to `business`), a `conversations` row (`type='group'`, `linked_entity_type='support'`, name='Help with my booking'), and a requester `conversation_participants` row all exist.
- **SC-0.2** `is_support_staff(<enabled user>)` = true; `is_support_staff(<non-staff>)` = false; `is_support_staff(<disabled staff>)` = false.
- **SC-0.3** `derive_user_segment` returns `admin` for `seth@usemingla.com`, `business` for an accepted-brand-team user, `explorer` for a fresh profile. Counts via `profiles_with_segment` match Lane B §3 (admin=1, business=13, rest explorer) at build time.
- **SC-0.4** `admin_toggle_partner` now gates on `is_admin_user()` (an `admin_users`-active, `account_type≠'admin'` user can toggle a partner).
- **SC-0.5** `profiles.is_admin` is **deprecated + snapshotted** (still present after the feature migration; `_deprecated_profiles_is_admin_backup` exists; column comment carries `[DEPRECATED …]`); the Step-B drop file exists but is NOT applied. After Seth applies Step B, the column is gone and is recoverable from the backup table.
- **SC-0.6** A support `messages` INSERT by an enabled staffer succeeds (option-b INSERT policy + RESTRICTIVE policy both pass); the same INSERT by a non-staff non-participant returns 0 rows / RLS error.
- **SC-0.7** `claim_support_ticket` sets `assigned_staff_id`, flips `new→open`, and seeds the staffer participant idempotently (second claim is a no-op on the participant row).
- **SC-0.8** `notify-dispatch` type-gate now reads a real boolean column (`messages`) — a test proves the gate is no longer a silent no-op against the live schema (D6 fix).
- **SC-0.9** Every `support-*` edge fn returns 401 (no JWT), 403 (authed non-staff for staff routes), 200 (staff/admin) — verified per route.

### 4.3 Invariants
- **I-1104-STAFF-DEDICATED** — support staffing is `support_staff`-only; never `brand_team_members.role` (Lane C Finding 3). Strict-grep: no `role = 'support'`/`'staff'` added to brand-team gates.
- **I-1104-SCHEMA-NO-BARE-TICKETS-AGENTS** — no support schema object named `tickets`/`agents` (CF-C1). Strict-grep gate.
- **I-1104-SUPPORT-SCOPED-RLS** — every staff chat-table policy carries `linked_entity_type='support'`; staff never read non-support DMs (Lane D D5 #3).
- **I-1104-ADMIN-GATE-UNIFIED** — `admin_toggle_partner` (+ twins) gate on `is_admin_user()`, not `account_type='admin'` (Lane B §2.4).
- **I-1104-IS-ADMIN-RETIRED-SAFE** — no NEW reader/writer of `profiles.is_admin`; the drop is the separate operator-gated migration with a snapshot backup (strict-grep + reversible drop, §2.5.1).
- **I-1104-NO-KBC-ON-WEB** — no support file imports `react-native-keyboard-controller` outside a `.native` module (§2.10). Strict-grep gate (enforced for Phases 1/3, registered Phase 0).
- Preserve existing chat substrate invariants (participant-gating, broadcast-only restrictive policy).

### 4.4 Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-0.1 (happy) | Requester opens a ticket | `create_support_ticket('X')` as business user | ticket+conv+participant rows; status `new`, segment `business` | DB/RPC |
| T-0.2 (adversarial) | Requester B reads A's case | A opens ticket; B `SELECT * FROM support_tickets WHERE id=A` | 0 rows (RLS) | RLS |
| T-0.3 (adversarial) | Non-staff self-promote | non-staff `INSERT INTO support_staff(user_id,enabled) VALUES(self,true)` | RLS denies (admin-write only) | RLS |
| T-0.4 (adversarial) | Staff read a NON-support DM | enabled staffer `SELECT` a `direct` conversation they're not in | 0 rows (support policy is `linked_entity_type='support'`-scoped) | RLS/PII |
| T-0.5 (happy) | Claim seeds participant | `support-claim` as staff | `assigned_staff_id` set, status `open`, staffer participant seeded once | edge+RPC |
| T-0.6 (adversarial) | `claim_support_ticket` spoofed staff id | call RPC directly with `p_staff_id=<other>` from a client | unreachable — RPC not client-exposed; only service-role edge invokes it | authz |
| T-0.7 (regression) | D6 dead-gate fix | user with `messages=false` | support push respects the real `messages` column (gate no longer no-op) | edge |
| T-0.8 (regression) | `admin_toggle_partner` divergence | invited admin (`admin_users` active, `account_type` null) toggles partner | succeeds (was FORBIDDEN before) | RPC |
| T-0.9 (safety) | `is_admin` reversibility | apply feature migration | column still present + `_deprecated_…_backup` populated; Step-B file exists, unapplied | migration |

**Phase 0 gate:** regression-test gate = T-0.2, T-0.3, T-0.4, T-0.7, T-0.8, T-0.9 must pass. No UI; tested via SQL + edge-fn invocation.

---

## 5. PHASE 1 — Business Requester Entry (mingla-business: native + web PC + mobile browser)

**Surfaces:** Business iOS + Android native; Business web (PC browser); Business web (mobile browser). **Depends on:** Phase 0 merged.
**REQUIRES a `mingla-designer` DESIGN pass** (`DESIGN_META-ORCH-1104_PHASE_1_BUSINESS_REQUESTER.md`) before IMPLEMENT — tokens, all-9-states copy, motion, no-slop bans, AND the web-rendering layout at admin/web breakpoints (375/390/430pt mobile-browser + PC).

### 5.1 Layer-by-layer (Lane C Finding 2.3; journey 1 mount points)
- **Entry mount (Lane C 2.3):** add a `SettingsNavRow` (`icon="help"`, label "Help & Support") to the existing "Settings" `GlassCard` on `mingla-business/app/(tabs)/account.tsx` (`:338-354`, after "Notifications"), `onPress → router.push('/account/support')`.
- **Help & Support screen:** new route `mingla-business/app/account/support.tsx` (mirrors `account/notifications.tsx`): a **"Start a chat"** button, an optional **subject** field, and a list of the user's **past tickets** with status badges (Open / Pending / Resolved). Reachable by EVERY business user regardless of brand rank (it's a requester surface, not the staff console).
- **Start-chat:** on submit calls `supabase.rpc('create_support_ticket', { p_subject, p_brand_id? })` → navigates to the returned thread.
- **Support thread:** new route `mingla-business/app/support/[ticketId].tsx`. Reuses the shared message list/composer + the `conversation:{id}` realtime channel (Lane A F6.1/F6.2). **Quarantine (§2.10, MANDATORY):** must NOT import `react-native-keyboard-controller` outside a `.native` module — implement via the platform-resolved thread/wrapper so the web bundle stays clean.
- **Service/hook:** new `mingla-business/src/services/supportService.ts` (create/list own tickets via `support_tickets` RLS read) + `useSupportTickets(userId)` React-Query hook (key `['support','tickets',userId]`, invalidate on create). Messages reuse the existing business chat service unchanged.
- **Push (D6, NATIVE-ONLY):** on native, the requester receives `business.support_message` on the business OneSignal app; tap deep-links to `/support/[ticketId]`. **On web, push is a documented no-op** — the thread still updates live via realtime; no OneSignal call fires (web guard already in `oneSignalService`).

### 5.2 Web-Degradation Contract (CORRECTION 2 — explicit)
- **Realtime/presence:** WORK on web (PC + mobile browser) via the Supabase JS SDK (`supabase.channel`) — no degradation.
- **Push:** NO-OP on web (no OneSignal). The requester sees new replies live while the tab is open; offline web pushes are not delivered (acceptable — web has no push in this app). State this in the empty/degraded copy if relevant.
- **Keyboard handling:** the thread MUST render on web WITHOUT a direct keyboard-controller import (§2.10). On web, keyboard-avoidance is a passthrough (browser handles the soft keyboard); the composer must remain visible and usable on a mobile browser.
- **Route firewall:** `/account/support` and `/support/[ticketId]` must pass the signed-out web route firewall + auth-resolving gate (`_layout.tsx`, ORCH-1087/1093/1100/1102) — a signed-out user is redirected to sign-in, never dead-ended; a signed-in user lands on the surface after the loading gate.
- **No bundle break:** adding these routes must NOT introduce any native-only import into the web entry. Verified at TEST by a successful web export + the new strict-grep `I-1104-NO-KBC-ON-WEB` gate.

### 5.3 Success criteria (per-surface — parity is shared-code AUTOMATIC for native iOS↔Android, MANUAL across native↔web)
- **SC-1.1** Account → "Help & Support" shows Start-a-chat + subject + past-ticket list with status badges. *(native + web)*
- **SC-1.2** Start a chat → enter subject → lands in a live thread; sending a message persists + appears optimistically. *(native + web)*
- **SC-1.3** "My support requests" lists the user's own tickets (status + last-message preview), newest first; empty-state copy in Mingla voice. *(native + web)*
- **SC-1.4-native** A staff reply arrives in realtime in the open thread AND as a `business.support_message` push when backgrounded; tapping the push opens the thread.
- **SC-1.4-web** A staff reply arrives in realtime in the open thread; push is a no-op (web) — no crash, no error, thread updates live.
- **SC-1.5-iOS / SC-1.5-Android** Both native platforms verified — **Android on a PHYSICAL device** at TEST (memory: Android-physical proof).
- **SC-1.6-web-PC** Verified on a **PC browser** (web export) — thread renders, composes, streams; no bundle/native-import break.
- **SC-1.7-web-mobile** Verified on a **mobile browser** — route firewall passes, thread + composer usable, no keyboard-controller breakage.

### 5.4 Invariants
- Reuse the shared message list/composer/realtime unchanged on native (no fork of the chat engine). **`I-1104-NO-KBC-ON-WEB`** holds. One owner per truth (server state in RQ). No dead taps. No fabricated ticket data (missing = hidden).

### 5.5 Test cases

| Test | Scenario | Expected | Layer/Surface |
|---|---|---|---|
| T-1.1 (happy) | Open ticket + send | thread + message persisted; appears in "My support requests" | full stack, native+web |
| T-1.2 (error) | Send while offline (native) | composer shows retry; message not silently dropped | hook+component |
| T-1.3 (empty) | No tickets yet | empty-state copy, Start-a-chat CTA | component |
| T-1.4 (realtime) | Staff replies while thread open | reply appears live (no manual refresh) | realtime, native+web |
| T-1.5 (web) | Open thread on PC + mobile browser | renders, composes, streams; NO keyboard-controller bundle error | web |
| T-1.6 (web firewall) | Signed-out hits `/support/[id]` on web | redirected to sign-in (no dead-end, no logged-out flash) | web firewall |
| T-1.7 (adversarial) | Deep-link to a foreign conversationId | RLS blocks; not-found, no crash | RLS+nav |

---

## 6. PHASE 2 — Admin PC Desk + Segmentation (mingla-admin web)

**Surfaces:** Admin Web (PC primary) + admin web mobile-browser non-break. **Depends on:** Phase 0 merged. Can run in PARALLEL with Phase 1.
**REQUIRES a `mingla-designer` DESIGN pass** (`DESIGN_META-ORCH-1104_PHASE_2_ADMIN_DESK.md`) — admin web breakpoints, table/detail layout, all-9-states, AND the mobile-browser responsive fallback (no horizontal scroll, no crash).

### 6.1 Layer-by-layer (Lane B §1, §5; journeys 2 + 4)
- **Router (Lane B §5.1):** add to `App.jsx` `PAGES` (`:35-54`): `support: SupportDeskPage,` + import — route `#/support`.
- **Nav (Lane B §5.2):** add `{ id: "support", label: "Support", icon: "LifeBuoy" }` to `constants.js` `NAV_GROUPS` (`:122-154`); register `LifeBuoy` (from `lucide-react`) in `Sidebar.jsx` `ICON_MAP` (`:36-40`) — else it silently falls back to `LayoutDashboard` (`:77`).
- **Support desk page (mirror `UserManagementPage` list/detail + `ClaimsPage` queue):** **queue** (all tickets, sort `last_message_at desc`, filter by status / "unassigned only") + **detail** (left = the conversation thread; right = ticket meta — requester, their segment, brand if any, status, priority — + actions: claim, set status, set priority + reply-as-staff composer). Reads via the support RLS (admin treated as staff) under the `is_admin_user()` umbrella (Lane D D2). Reply/lifecycle writes go through `support-send` / `support-claim` / `support-set-status`. An **unread count** badges the sidebar item; new tickets surface live at the top.
- **Agents panel (mirror `AdminPage.jsx` roster, Lane B §5.3):** list `support_staff`, grant/revoke `enabled` via `support-grant-staff` (admin-only). This is the GRANT side of D3 (the "support tag" Seth controls).
- **Segmentation on `UserManagementPage` (Lane B §1.6; journey 4):** segment tabs (All / Explorer / Business / Admin) above the Filters block (`:1001`) with live counts as `StatCard`s (extend `stats` `:75` + `fetchStats` `:170` with explorer/business/admin head-counts from `profiles_with_segment`); filter resolves via the view's `segment` column — read from `profiles_with_segment` instead of `profiles` so it can `.eq('segment', …)`. **Replace the lying `.or(account_type…)` filter (`:208-209` + the 5 stats sites) with the derived segment.**

### 6.2 Web-Degradation Contract (mobile-browser non-break)
- Admin web is React+Vite (NOT Expo) — no native-module quarantine concern. The requirement here is **responsive non-break on a mobile browser**: the desk table + detail must not horizontally scroll off-screen or crash on a narrow viewport; the Users segmentation tabs must remain tappable. Full desk ergonomics (multi-column detail) are a PC target; on mobile the layout may stack/simplify but must remain usable. *(LOCKED: no crash, no horizontal overflow, tabs usable. OPEN: exact responsive stacking.)*

### 6.3 Success criteria
- **SC-2.1** A new `#/support` nav item renders the support desk inside the authed shell; non-admins never reach it (App.jsx renders pages only when `session` set + RLS).
- **SC-2.2** The queue lists open tickets newest-activity-first; clicking one opens the thread; admin can reply (message persists, requester gets it in realtime + push).
- **SC-2.3** Admin can claim, set status (legal transitions only), set priority; `first_response_at`/`resolved_at` populate correctly; sidebar unread badge updates.
- **SC-2.4** Agents panel: admin grants a user `enabled=true` → that user's `is_support_staff()` flips true (verifiable Phase 3); revoke flips it false.
- **SC-2.5** Users page shows All/Explorer/Business/Admin tabs with correct counts (admin=1, business=13, explorer=residual at build time); selecting a tab filters the list via the view; the old `account_type` filter no longer lies.
- **SC-2.6-PC** Verified on a **PC browser**.
- **SC-2.7-mobile** The desk + Users page remain **non-broken on a mobile browser** (no crash, no horizontal scroll, tabs usable).

### 6.4 Invariants
- Admin client stays anon-key (never service-role in the browser) (Lane D D2). Segment is read from the view/`derive_user_segment`, never a trusted stored column (Lane B §6). No fabricated counts (missing = 0, not faked).

### 6.5 Test cases

| Test | Scenario | Expected | Layer/Surface |
|---|---|---|---|
| T-2.1 (happy) | Admin replies to a queued ticket | message persists; requester realtime + push | full stack |
| T-2.2 (happy) | Segment counts | tabs show admin=1/business=13/explorer=rest | view+UI |
| T-2.3 (adversarial) | Non-admin hits `#/support` | shell not rendered / RLS returns nothing; no leak | authz |
| T-2.4 (edge) | Illegal status transition (`new`→`resolved` skip) | edge fn rejects or normalizes per §2.1 | edge |
| T-2.5 (regression) | account_type filter no longer hides business users | business users appear under Business tab | UI |
| T-2.6 (web mobile) | Open desk + Users page on a mobile browser | no crash, no horizontal scroll, tabs tappable | responsive |

---

## 7. PHASE 3 — Business-App Staff Console (mingla-business: native + web PC + mobile browser)

**Surfaces:** Business iOS + Android native; Business web (PC + mobile browser). **Depends on:** Phase 0 + Phase 2 staff-grant (to have staff to test; or grant via edge fn in the interim). Push needs a native build/OTA.
**REQUIRES a `mingla-designer` DESIGN pass** (`DESIGN_META-ORCH-1104_PHASE_3_STAFF_CONSOLE.md`).

### 7.1 Layer-by-layer (Lane C Findings 2.4, 3, 4; journey 3)
- **Capability hook:** new `mingla-business/src/hooks/useSupportStaff.ts` — React-Query keyed on **`user.id`** (NOT `currentBrandId`), reading the user's own `support_staff` row; returns `{ isStaff, enabled, available }`; short stale-time (security-adjacent, mirror `useCurrentBrandRole`).
- **Mount (sub-page, NOT a tab — Lane C Finding 2.4, CF-C3):** a "Support — Live Chats" `GlassCard` on `(tabs)/account.tsx` rendered ONLY when `useSupportStaff().isStaff && enabled`, with a row → `router.push('/support/inbox')`. New route `app/support/inbox.tsx` (queue). The thread route `app/support/[ticketId].tsx` is shared with Phase 1. Do NOT add a `TABS` entry (would hit the brand-rank `MIN_RANK_FOR_TAB` strict-grep gate — CF-C3).
- **Availability toggle:** a `Switch` in the inbox header / console card writing `available` via the `support_set_available` RPC (§2.7 — column-restricted self-write).
- **Inbox actions:** list the shared queue (same `support_tickets` the PC sees), claim/switch/reply/create via the `support-*` edge fns; conversation-switch reuses the ARI `ConversationDrawer` pattern; reply composer + the `conversation:{id}` realtime channel are shared (Lane A F6.1/F6.2). **Quarantine (§2.10):** the thread must not import keyboard-controller outside a `.native` module.
- **Push (Lane C Finding 4, D6, NATIVE-ONLY):** staffer receives `business.support_new_ticket` / `business.support_message` on the BUSINESS OneSignal app (`app:"business"`), gated by `available=true`; deep-link → `/support/[ticketId]` via the new `businessNotificationRouting` case. Push pref master "Support console" added to `app/account/notifications.tsx` (`:72-93`), rendered only when `isStaff`.

### 7.2 Web-Degradation Contract (CORRECTION 2 — explicit)
- **Inbox + thread:** WORK on business web (PC + mobile browser) — the staffer can see the queue, claim, and reply via the JS SDK + edge fns. Realtime/presence WORK on web.
- **Push:** NATIVE-ONLY. On web there is NO new-ticket push (OneSignal is web-no-op'd). **The web inbox renders WITHOUT push** — a web staffer must rely on the live queue (realtime) rather than a push to know a new ticket arrived. This is the explicit degradation: web = inbox-without-push; native = inbox-with-push. State it in the inbox copy/empty-state.
- **Availability toggle:** WORKS on web (writes `available` via RPC). Note that with no web push, `available` on web only affects whether NATIVE devices of that staffer would ping — document this so a web-only staffer isn't surprised.
- **Keyboard / route firewall / no-bundle-break:** identical to §5.2 (the staff thread is the same shared, quarantined thread; the inbox route passes the firewall; no native-only import enters the web entry).

### 7.3 Success criteria (per-surface)
- **SC-3.1** A non-staff business user sees NO "Support — Live Chats" card and cannot reach `/support/*` (client gate + server RLS). *(native + web)*
- **SC-3.2** An enabled staffer sees the console; toggling availability persists `available`. *(native + web)*
- **SC-3.3-native** With `available=true`, a new ticket fires a `business.support_new_ticket` push to the staffer's business app; with `available=false`, no push.
- **SC-3.3-web** The web inbox shows new tickets via the live queue (realtime); push is a no-op (documented degradation), no crash.
- **SC-3.4** Staffer claims a ticket (sets `assigned_staff_id`, seeds participant), replies (requester gets it realtime + push), and the PC desk reflects the claim/reply live (shared queue). *(native + web)*
- **SC-3.5-iOS / SC-3.5-Android** Both native verified — **Android on a PHYSICAL device**.
- **SC-3.6-web-PC / SC-3.7-web-mobile** Inbox + thread verified on **PC browser** and **mobile browser**; no keyboard-controller breakage; firewall passes.

### 7.4 Invariants
- **I-1104-STAFF-DECOUPLED** — `useSupportStaff` keys on `user.id`, never `currentBrandId` (Lane C Finding 3). Console + routes gate on `isStaff && enabled`; server RLS is the real boundary (Lane D D5). Push to staff = `app:"business"` always (CF-C2). Availability gates new-ticket push (off-duty = no ping, no PII leak). **`I-1104-NO-KBC-ON-WEB`** holds for the inbox/thread.

### 7.5 Test cases

| Test | Scenario | Expected | Layer/Surface |
|---|---|---|---|
| T-3.1 (adversarial) | Non-staff opens `/support/inbox` directly (native + web) | empty/blocked by RLS; no queue data | authz |
| T-3.2 (happy, native) | Available staffer, new ticket | business-app push received; appears in inbox | push+realtime |
| T-3.3 (happy) | Claim + reply on phone | PC desk shows claim+reply live | cross-client |
| T-3.4 (edge) | available=false (native) | no new-ticket push (off-shift) | push |
| T-3.5 (adversarial) | Staffer writes own `enabled` via RPC | only `available` mutable by self; `enabled` admin-only | RLS/RPC |
| T-3.6 (web) | Staffer opens inbox+thread on PC + mobile browser | queue/claim/reply work via JS SDK; NO keyboard-controller bundle error; push no-op | web |

---

## 8. PHASE 4 — v2 Hardening (OUT of v1 SCOPE — backlog list only)

Listed, not specified. Each becomes its own future sub-ORCH if Seth greenlights:
- **Anonymous / buyer-web support** (D1 deferral) — identity + abuse controls for unauthenticated web-checkout buyers (the only place "explorer" segment requesters could ever appear).
- **Routing:** round-robin / business-hours / topic routing / SLA timers + breach alerts (D4 deferral).
- **Presence/availability polish** beyond live-chat baseline; staff "who's online" board.
- **Canned replies, internal staff notes** (non-requester-visible), macros.
- **Dedicated `support_replies` opt-out column** + toggle (D6 Option β).
- **CSAT / satisfaction survey on resolve; analytics tiles** (volume, first-response time, resolution time) on the admin desk.
- **`support_audit_log` dashboard** (if a lightweight log row was the v1 choice, the viewer is v2).

---

## 9. PHASE DISPATCH ORDER + DEPENDENCIES

```
Phase 0 (backend foundation)  ── BLOCKS everything ──┐
                                                      ├─► Phase 1 (business requester)   ─┐
                                                      ├─► Phase 2 (admin desk + segment) ─┤  1 ∥ 2
                                                      │                                   │
                                  Phase 2 staff-grant ─► Phase 3 (business staff console)─┘  3 after 2-grant
```

- **Phase 0 blocks all** (tables/RLS/RPCs/edge/segment/cleanup). Ship + merge first. The operator-gated `is_admin` drop (Step B) is applied separately, on Seth's go.
- **Phase 1 and Phase 2 can parallelize** (different surfaces; both only need Phase 0). Segmentation (inside Phase 2) is small + high-value and could front-run as a standalone quick win if Seth wants immediate value (PROPOSAL §5).
- **Phase 3 depends on Phase 2's staff-grant** UI to create staff to test the console (or grant via edge fn in the interim). Phase 1 + Phase 3 share the same `mingla-business` build/OTA — the thread route `/support/[ticketId]` is shared, so coordinate so the quarantine (§2.10) ships once and serves both.
- **Recommended first shippable milestone:** Phase 0 + 1 + 2 = support works end-to-end (a business user files → Seth answers on PC). Then Phase 3 as the business-app build/OTA.
- **Per-ORCH worktree + one PR per CLOSE.** Every backend-touching phase carries its `META_ORCH_1104_BACKEND_ALLOWLIST` entry (§2.11). COMMS-0002 (backend strict-grep allowlist) — **FACTORED**: Phase 0 PR adds the block. COMMS-0003 (cite provider docs) — N/A here (no new external API; OneSignal already integrated). Every web-touching phase verifies a clean web export + the `I-1104-NO-KBC-ON-WEB` gate.
- **Spawn hygiene:** each sub-ORCH worktree comes off the stale anchor — `git fetch origin && git rebase origin/main` BEFORE work (memory `feedback_spawn_branches_from_stale_anchor.md`). This META spec's worktree was rebased onto origin/main during this revision.

---

## 10. OPEN QUESTIONS FOR THE OPERATOR (genuinely undecided after D1–D6 + the corrections)

1. **`is_admin` drop timing (D5.1):** confirm the two-step — Phase 0 snapshots + deprecates (no drop), and YOU apply the separate `<ts>_meta_orch_1104_drop_profiles_is_admin.sql` later on your explicit go. Acceptable, or do you want the drop in the feature migration anyway (not recommended)?
2. **Web push reality (CORRECTION 2):** business web has NO push (OneSignal is web-no-op'd). For a **web-only staffer**, this means no new-ticket ping — they must watch the live queue. Confirm web = "inbox-without-push" is acceptable, or do we add browser Web-Push (a materially bigger lift, Phase 4)?
3. **Mobile-browser staff console depth:** is the staff console expected to be FULLY usable on a mobile browser (claim/switch/reply), or is mobile-browser "non-break + read" enough with full ops on native + PC? (SPEC currently requires fully-usable on mobile browser; confirm.)
4. **Audit-log depth (Lane D D5 #7):** reuse `admin_audit_log` for staff claim/reply/status, or add a dedicated `support_audit_log`? (Default: a lightweight `support_audit_log` row on claim/reply/status; skip per-read logging in v1.)
5. **Auto-close window:** after how many days of `resolved` does a ticket auto-`closed`? (SPEC leaves it unset in v1 — manual close only — unless you want a value, e.g. 7 days.)
6. **`brand_id` capture (§2.1):** when a business user files, do we snapshot which brand (`currentBrandId` at create time)? v1 leaves it nullable; the Phase-1 entry could pass it. Capture, or punt to v2?
7. **Priority authorship:** v1 lets only staff set priority (requester always opens at `normal`). Confirm requesters cannot self-escalate.
8. **Segment badge for dual-role users:** a user who is BOTH admin and business — `derive_user_segment` returns `admin` first (counts as admin). Confirm that's the desired display, or allow filtering under either tab?
9. **D6 confirmation:** ride `messages` boolean (Option α, recommended) vs add `support_replies` column (Option β, deferred). Confirm α for v1.

---

## 11. CROSS-SURFACE PARITY MATRIX (CORRECTION 2 — the headline contract)

Surface × capability × works/degrades-how. "✅ native" = full; "✅ web" = works on the web export; "no-op" = present but inert on web; "n/a" = capability not on that surface.

| Capability | Business native (iOS+Android) | Business web — PC browser | Business web — mobile browser | Admin web — PC | Admin web — mobile browser |
|---|---|---|---|---|---|
| **Requester: Help & Support entry** (Phase 1) | ✅ native | ✅ web | ✅ web | n/a | n/a |
| **Requester: start chat + ticket list** (Phase 1) | ✅ native | ✅ web | ✅ web | n/a | n/a |
| **Support thread (list+composer)** (Phase 1/3) | ✅ native (keyboard-controller via `.native`) | ✅ web (passthrough keyboard, §2.10) | ✅ web (passthrough keyboard) | ✅ web (admin desk thread) | ⚠️ non-break (stacked) |
| **Realtime message stream** | ✅ native (JS SDK) | ✅ web (JS SDK) | ✅ web (JS SDK) | ✅ web (JS SDK) | ✅ web |
| **Presence/typing** | ✅ native | ✅ web | ✅ web | ✅ web | ✅ web |
| **Push (new ticket / reply)** | ✅ native (OneSignal) | **no-op** (web has no push) | **no-op** | n/a (desk is live) | n/a |
| **Staff console: inbox + claim/switch/reply** (Phase 3) | ✅ native | ✅ web | ✅ web (confirm depth — Q3) | n/a (PC desk is the analog) | n/a |
| **Staff: availability toggle** (Phase 3) | ✅ native | ✅ web (note: only affects native pings) | ✅ web | n/a | n/a |
| **Admin desk: queue + detail + lifecycle** (Phase 2) | n/a | n/a | n/a | ✅ PC | ⚠️ non-break (stacked) |
| **Admin: agents (grant/revoke staff)** (Phase 2) | n/a | n/a | n/a | ✅ PC | ⚠️ non-break |
| **Admin: Users segmentation tabs** (Phase 2) | n/a | n/a | n/a | ✅ PC | ⚠️ non-break (tabs tappable) |

**Headline:** every requester + handler capability is at parity across business native + business web (PC + mobile browser) + admin web (PC), with exactly TWO documented degradations — (1) **push is native-only** (web surfaces the inbox/thread WITHOUT push, relying on realtime), and (2) **admin web on a mobile browser is "non-break," not full-ergonomics**. The keyboard-controller native module is quarantined out of the web bundle (§2.10, `I-1104-NO-KBC-ON-WEB`) so the fragile business-web export never breaks.

---

## 12. REGRESSION PREVENTION

- **Strict-grep gates (Phase 0):** ban NEW `profiles.is_admin` reads/writes (D5.1; `session_participants.is_admin` exempt); ban bare `tickets`/`agents` schema names for support; assert every staff chat policy carries `linked_entity_type='support'`; **`I-1104-NO-KBC-ON-WEB`** — ban `react-native-keyboard-controller` imports outside `.native` support modules.
- **Web-export gate:** every web-touching phase proves a clean `expo export -p web --clear` (worktree caveat: `--clear`, memory `reference_worktree_web_export_needs_clear.md`) with no native-module resolution failure.
- **D6 dead-gate regression test:** assert `notify-dispatch` reads a real `notification_preferences` boolean column (catches the silent no-op returning).
- **Admin-gate test:** `admin_toggle_partner` keyed on `is_admin_user()` (catches a revert to `account_type='admin'`).
- **PII test (T-0.4):** staff cannot read non-support conversations (catches a policy dropping the `linked_entity_type='support'` scope).
- **`is_admin` reversibility test (T-0.9):** the feature migration leaves the column present + snapshotted; the drop is the separate operator-gated file.
- **Protective comments:** every support RLS policy carries `-- Lane D D5: support-scoped; never widen staff into user DMs`; `claim_support_ticket` carries `-- service-role edge fn ONLY; never client-exposed with arbitrary p_staff_id`; the support thread carries `-- META-ORCH-1104 §2.10: NO direct react-native-keyboard-controller import — web bundle must stay clean`.

---

**END SPEC.** Phase 0 is specified to build without guessing (including the reversible, operator-gated `is_admin` retirement). Phases 1–3 carry functional + per-surface UX contracts + explicit Web-Degradation Contracts; each UI phase REQUIRES its referenced `mingla-designer` DESIGN pass before IMPLEMENT dispatch, and each must prove **Android-physical + PC-browser + mobile-browser** at TEST per the §11 parity matrix.
