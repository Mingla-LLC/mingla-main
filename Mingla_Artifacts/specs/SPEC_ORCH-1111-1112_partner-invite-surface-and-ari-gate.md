# SPEC — ORCH-1111 (surface pending invites in-app) + ORCH-1112 (make Ari reachable with no brand)

**Phase:** SPEC. Binding contract. One PR ships both tickets.
**Repo:** `/Users/sethogieva/Desktop/mingla-main` · business app `mingla-business/` · backend `supabase/`.
**Date:** 2026-06-10. **Discipline:** mingla-forensics SPEC.
**Investigation source:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1111-1109_partner-invite-surface-and-ari-gate.md` (trusted; this spec builds on its Q1–Q9 + Spec-inputs).
**Affected Surfaces:** business-iOS, business-Android (both tickets). Business Web preview shares the same nav gate + To-Do code → parity automatic. Consumer iOS/Android, Buyer Web, Admin Web: OUT (business-only invite + business-only nav).

**Comms ledger:** read `COMMS_LEDGER.md` on entry. No OPEN BLOCK/WARN row addressed to forensics, ORCH-1111, ORCH-1112, or ALL. Nothing to ack. No cross-ORCH discovery requiring a new COMMS row.

---

## 1. Executive summary

Two related partner-onboarding gaps, shipped as one wave.

**ORCH-1111** — A person invited to a brand (team member, or a partner brand-owner transfer) gets only an email today. If they open the business app, they land on the empty "Create a brand" To-Do and never see the invite. This ticket surfaces pending invitations **in-app**, keyed to the authenticated user's login email (server-side, login-email-trusted — no raw token needed in the app), with: a To-Do row ("You've been invited to {brand} — Accept / Decline"), an in-app `business.*` notification (+ bell), and Accept / Decline edge functions. Accept routes through the existing `accept_invite_and_transfer_brand_ownership` RPC; Decline adds a new `declined` terminal state.

**ORCH-1112** — Ari (the AI assistant tab) is gated at rank 30 (finance_manager+), so a brand-less signed-in user can't reach it — even though Ari already has a fully working `create_brand` tool that needs only a logged-in user. This ticket makes the Ari tab reachable for a brand-less (rank 0) user via a **non-monotonic** gate (visible when `rank === 0` OR `rank >= 30`), WITHOUT re-exposing Ari to rank-10 scanners or rank-20 marketing managers. No new wizard is built (locked decision 1A).

---

## 2. Scope & non-goals

### In scope — ORCH-1111
- Migration: add `'declined'` to the `brand_invitations.status` CHECK constraint + a `declined_at timestamptz` column.
- Invitee read access: a **service-role edge function** `list-my-pending-invites` (login-email-trusted), NOT an RLS policy (justified §4.1.2).
- Detection hook `useMyPendingInvites` (React Query) + flash-safe gating (mirrors ORCH-1100 RC-1).
- To-Do row: extend `BusinessTodoInput` + `buildBusinessTodos` + `BusinessTodoAction` + `useBusinessTodos` + `home.tsx` action wiring.
- Notification: emit `business.brand_invite_pending` on first detection (idempotent), rendered by the existing bell/inbox.
- Accept edge fn: **reuse** `accept-brand-invitation` by adding an **email-trusted, tokenless** accept branch (server looks up the invite by login email and uses its stored `token_hash`). Decline: new `decline-brand-invitation` edge fn.
- An invite Accept/Decline sheet component (native) wiring the two service calls + states.

### In scope — ORCH-1112
- `navTabGate.ts`: non-monotonic `ari` visibility (`rank === 0 || rank >= 30`) WITHOUT widening `BRAND_ROLE_RANK` and WITHOUT regressing the `nav-tab-gate-declared` strict-grep gate / anchor.
- `_layout.tsx`: pass the already-computed `rank` (no shape change to the call needed — see §4.7).
- Optional one-line brand-less empty-state nudge (resolved OUT — §9).

### Non-goals (explicit)
- NO new brand-creation wizard for Ari (locked 1A). Ari's existing `create_brand` tool is the path.
- NO change to `BRAND_ROLE_RANK` / `NO_MEMBERSHIP_RANK` values (preserves I-32).
- NO at-invite-time push to the invitee (impossible — invitee has no account at invite time; this is a first-login detection problem per investigation Discovery #1). The invite-CREATE function `invite-brand-member` is NOT modified.
- NO RLS SELECT policy granting invitees direct table reads (we use a service-role edge fn instead — §4.1.2).
- NO consumer-app, admin-web, or buyer-web change.
- NO Ari permission-hardening (server-side Ari tools remain ownership/RLS-gated as today — investigation Discovery #2; out of scope, noted for a future ORCH).
- Ari being reachable does NOT change which Ari tools a rank-0 user can run — `create_brand` already needs only `userId`; all other tools remain ownership/RLS-gated server-side. No new server gate is added.

### Assumptions
- The invitee, once authenticated, has a `creator_accounts` row whose `id == auth.uid()` (true for any signed-in business user; the accept RPC already requires it).
- `brand_invitations.email` and the JWT email both normalize via `lower(trim(...))`. Stored side is already lowercased on write (`invite-brand-member/index.ts:100`).

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior | Files touched here | Parity |
|---|---------|---------|----------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | NO | — | none | n/a — business-only invites + business-only nav |
| 2 | Consumer Android | NO | — | none | n/a |
| 3 | Buyer/anon Web | NO | — | none | n/a — no invite/nav surface |
| 4 | Business iOS | YES | 1108: invite To-Do row + bell notification + Accept/Decline sheet. 1109: Ari tab visible when brand-less. | all §4 files | — |
| 5 | Business Android | YES | identical to iOS | same shared RN files | automatic (shared RN code; no `.ios`/`.android` split in any touched file) |
| 6 | Admin Web (`mingla-admin/`) | NO | — | none | n/a |
| 7 | Business Web preview | YES (incidental) | Same To-Do list + same nav gate feed the web side rail; invite sheet + Ari tab appear there too via shared code. | shared files | automatic |

No touched file has a `.web.tsx` / `.ios.tsx` / `.android.tsx` variant that would split behavior. The web side rail (`BottomNav.web.tsx`) consumes the SAME `visibleTabsForRank` output — the ORCH-1112 gate change applies there automatically (verify in tester pass, no extra code).

---

## 4. Layered specification

### 4.0 — ORCH-1111 data-flow overview

```
First login (authed, email known)
  → useMyPendingInvites (React Query, gated on isAuthReady + brand resolution)
      → list-my-pending-invites edge fn (service-role; lower(jwt.email)=invite.email, status=pending, not expired/revoked)
          → returns [{ id, brand_id, brand_name, role, expires_at }]
  → if ≥1 pending:
      (a) buildBusinessTodos prepends an invite row → BusinessTodoToggle
      (b) (server) list-my-pending-invites emits business.brand_invite_pending (idempotent) → bell
  → tap row / notification → InvitePendingSheet
      → Accept  → accept-brand-invitation { invitationId }  (email-trusted, tokenless branch)
      → Decline → decline-brand-invitation { invitationId } → status='declined', declined_at=now()
  → on either: invalidate useMyPendingInvites + brand list + role → row & notification vanish
```

---

### 4.1 — DATABASE

#### 4.1.1 Migration: add `declined` status + `declined_at`

**File (NEW):** `supabase/migrations/20260910000000_orch_1108_brand_invite_declined.sql`
(Use the next free `YYYYMMDDHHMMSS` after the latest existing migration — the implementor MUST `ls supabase/migrations/ | tail` and pick a timestamp strictly greater than the latest; `20260910000000` is the placeholder.)

**Exact current constraint (authoritative, latest definition):**
`supabase/migrations/20260820000000_orch_1050_brand_invite_flow.sql:48-52`
```sql
ALTER TABLE public.brand_invitations DROP CONSTRAINT IF EXISTS brand_invitations_status_check;
ALTER TABLE public.brand_invitations ADD CONSTRAINT brand_invitations_status_check
  CHECK (status IN ('pending', 'accepted', 'revoked', 'expired'));
```
Constraint name: `brand_invitations_status_check`. Current values: `{pending, accepted, revoked, expired}`.

**Migration SQL (forward-only, idempotent, DROP-before-widen per `feedback_edge_deploy_and_migration_apply_hazards`):**
```sql
-- ORCH-1111 [Surface pending invites in-app] — add invitee-driven 'declined'
-- terminal state to brand_invitations.
-- Idempotent: column add guarded with IF NOT EXISTS; CHECK uses DROP-then-ADD.

ALTER TABLE public.brand_invitations
  ADD COLUMN IF NOT EXISTS declined_at timestamptz;

-- Widen the status CHECK to include 'declined'. DROP-before-ADD so re-running
-- the migration is safe and the widen does not collide with the ORCH-1050 def.
ALTER TABLE public.brand_invitations
  DROP CONSTRAINT IF EXISTS brand_invitations_status_check;
ALTER TABLE public.brand_invitations
  ADD CONSTRAINT brand_invitations_status_check
  CHECK (status IN ('pending', 'accepted', 'revoked', 'expired', 'declined'));

-- Verification probe (read-only).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='brand_invitations'
      AND column_name='declined_at'
  ) THEN
    RAISE EXCEPTION 'ORCH-1111 probe failed: brand_invitations.declined_at missing';
  END IF;
END$$;
```

**Justification for `declined_at`:** the table already carries a per-terminal-state timestamp for every other terminal transition (`accepted_at`, `revoked_at`). A dedicated `declined_at` follows that established pattern, preserves decline attribution distinct from inviter-`revoked`, and lets the inviter-side `listBrandInvitations` view render "declined {when}" later without overloading `revoked_at`. Pattern-consistency justifies the column.

**No `$function$;`/GRANT concern here** — this migration touches only a table constraint + column, no function. (The `$function$;`-before-GRANT and DROP-before-widen-RETURNS hazards apply only to function migrations; flagged so the implementor does not over-apply them.)

#### 4.1.2 Invitee read access — DECISION: service-role edge function (NOT RLS)

**Locked approach** (dispatch): server-side, login-email-trusted. **Chosen: edge function**, not an RLS SELECT policy.

**Justification (why edge fn over RLS):**
1. The locked access model says "a service-role edge function looks up pending invite(s) by email." An RLS policy keyed on `lower(auth.jwt()->>'email')` would also work, but it widens the `brand_invitations` table's read surface for ALL direct PostgREST callers and risks leaking other columns (`token_hash`, `invited_by`) the invitee must never read.
2. The edge fn returns ONLY a curated projection (`id, brand_id, brand_name, role, expires_at`) — never `token_hash`. RLS cannot column-project; it would expose the full row.
3. Decline already needs a service-role write path (invitee cannot satisfy the brand_admin+ UPDATE policy — investigation Q3). Keeping read + write both server-side is one consistent, auditable surface.
4. No new table RLS = zero blast on the existing brand_admin+ read policy (`brand_invitations_select_brand_admin_plus`).

**→ No RLS change to `brand_invitations` in this ticket.** The four existing policies (select/insert/update brand_admin+, delete denied) are untouched.

---

### 4.2 — EDGE FUNCTIONS

#### 4.2.1 `list-my-pending-invites` (NEW)

- **Path:** `supabase/functions/list-my-pending-invites/index.ts`
- **config.toml:** add `[functions.list-my-pending-invites]` with `verify_jwt = true` (mirrors `accept-brand-invitation`).
- **Method:** `POST` (no body required; also accept `GET`-style empty body). CORS preflight `OPTIONS` → `ok`.
- **Auth:** `verify_jwt=true`; resolve `auth.getUser()` from the caller's JWT (anon-key client with caller Authorization header, exactly like `accept-brand-invitation/index.ts:158-168`). On no user → `401 { error:'unauthenticated' }`.
- **Logic:**
  1. `const email = (userResult.user.email ?? "").trim().toLowerCase();` If empty → return `200 { invites: [] }` (no email = nothing to match; never 500).
  2. Service-role client (`SUPABASE_SERVICE_ROLE_KEY`).
  3. Query:
     ```sql
     SELECT bi.id, bi.brand_id, bi.role, bi.expires_at, b.name AS brand_name
     FROM brand_invitations bi
     JOIN brands b ON b.id = bi.brand_id
     WHERE lower(bi.email) = $1            -- $1 = normalized jwt email
       AND bi.status = 'pending'
       AND bi.expires_at > now()
       AND b.deleted_at IS NULL
     ORDER BY bi.expires_at ASC;
     ```
     (PostgREST equivalent: `.from('brand_invitations').select('id, brand_id, role, expires_at, brands!inner(name, deleted_at)').eq('status','pending').gt('expires_at', nowIso)` then filter `lower(email)` — but prefer a SECURITY DEFINER RPC `biz_list_pending_invites_for_email(p_email text)` OR an `.rpc`-free service query with `lower(email)` applied via `.ilike('email', email)` exact-match. The cleanest is a service query with `.eq` on a stored-lowercased email since the stored side is already lowercased on write; still call `.toLowerCase()` defensively.)
  4. **Notification side-effect (idempotent):** for each returned invite, call `dispatchNotification` with `type:'business.brand_invite_pending'`, `idempotencyKey: 'business.brand_invite_pending:'+invite.id+':'+userId`. notify-dispatch's idempotency means re-detection on every login does NOT spam the bell. Wrap in try/catch; notification failure must NOT fail the list response (non-fatal, mirror `accept-brand-invitation/index.ts:389-396`).
- **Response:**
  - `200 { invites: [{ id, brand_id, brand_name, role, expires_at }] }`
  - `401 { error:'unauthenticated' }`
  - `500 { error:'server' }` (only on a true service error; an empty/missing email returns `200 { invites: [] }`).
- **Security:** returns ONLY the five curated fields. NEVER returns `token_hash`, `invited_by`, `email`. Email match is server-side; the caller cannot inject an arbitrary email (no email param — derived from the JWT only).

#### 4.2.2 `accept-brand-invitation` — add email-trusted tokenless branch (MODIFY)

- **File:** `supabase/functions/accept-brand-invitation/index.ts`
- **config.toml:** unchanged (`verify_jwt=true`).
- **Current contract:** `POST { token }` → SHA-256(token) → RPC. Token must be 16–256 chars (`:148-151`).
- **Change:** accept EITHER `{ token }` (web path, unchanged) OR `{ invitationId }` (new in-app path). Branch:
  ```
  if body.token is a valid string → existing path (unchanged).
  else if body.invitationId is a uuid → NEW email-trusted branch:
      1. resolve email = lower(userResult.user.email) (same as :346).
      2. service query: SELECT token_hash, email, status, expires_at
         FROM brand_invitations WHERE id = invitationId.
      3. If not found → 404 invite_not_found.
      4. If lower(row.email) <> email → 403 invite_email_mismatch.
         (The login email IS the identity proof — locked access model.)
      5. Pass row.token_hash to the EXISTING RPC call
         (accept_invite_and_transfer_brand_ownership(p_token_hash, account.id)).
         All downstream RPC behavior (status checks, role branch, transfer,
         audit, notifications) is UNCHANGED — the RPC re-verifies email,
         status, expiry, and locks FOR UPDATE.
  else → 400 validation.
  ```
- **Why reuse the RPC via token_hash:** the RPC is the single source of accept truth (role branch, transfer, demote-prior-owner, audit, FOR UPDATE lock, `business.team_member_joined` + `business.partner_transfer_completed` notifications). Resolving `invitationId → token_hash` server-side lets the in-app path reuse it verbatim — **no RPC change**, no second accept code path. The invitee never sees the raw token (one-way hashed) and never needs it.
- **Idempotency / already-terminal:** unchanged — the RPC raises `P0002 invite_already_used` (→ 410), `P0005 invite_revoked` (→ 410), `P0003 invite_expired` (→ 410), `P0004 invite_email_mismatch` (→ 403). The new `declined` state: the RPC does NOT currently special-case `declined`; a declined invite has `status='declined'` which is neither `accepted`/`revoked`, so the RPC would fall through to the expiry/email checks and could re-accept a declined invite. **GUARD:** in the new branch, after step 2, also reject `if row.status <> 'pending'` → map to `410 { error:'invite_not_actionable' }` BEFORE calling the RPC. This makes the in-app accept refuse any non-pending invite (declined included) without touching the RPC. (Open question OQ-1 notes whether to also harden the RPC; not required for this ticket.)
- **Service-layer signature change:** `acceptBrandInvitation` must accept either a token or an invitation id (§4.3).

#### 4.2.3 `decline-brand-invitation` (NEW)

- **Path:** `supabase/functions/decline-brand-invitation/index.ts`
- **config.toml:** add `[functions.decline-brand-invitation]`, `verify_jwt = true`.
- **Method:** `POST { invitationId }`. CORS `OPTIONS` → ok. Non-POST → 405.
- **Auth:** `verify_jwt=true`; `auth.getUser()`. No user → 401.
- **Logic:**
  1. `invitationId` must be a uuid string → else 400 validation.
  2. `email = lower(userResult.user.email)`.
  3. Service-role: `SELECT id, email, status FROM brand_invitations WHERE id = invitationId`.
     - not found → 404 `invite_not_found`.
     - `lower(email) <> jwt email` → 403 `invite_email_mismatch`.
     - `status <> 'pending'` → 410 `invite_not_actionable` (idempotent: a second decline, or declining an already-accepted/revoked invite, returns 410 — caller treats as success-equivalent "no longer pending").
  4. Service-role UPDATE (rowcount-verified per I-PROPOSED-I):
     ```sql
     UPDATE brand_invitations
     SET status = 'declined', declined_at = now()
     WHERE id = invitationId AND status = 'pending'
     RETURNING id;
     ```
     - 0 rows (race: someone flipped it) → 410 `invite_not_actionable`.
  5. Best-effort: mark any `business.brand_invite_pending` notification for this `(userId, invite)` read (so the bell unread clears). Optional/non-fatal — the To-Do row vanishing is the primary signal; if a mark-read helper isn't trivially available, SKIP (OQ-2). Do NOT block the decline on it.
- **Response:** `200 { declined: true }` · `400 validation` · `401 unauthenticated` · `403 invite_email_mismatch` · `404 invite_not_found` · `410 invite_not_actionable` · `500 server`.
- **Security:** invitee identity proven by JWT email == stored invite email; no token, no brand membership required. The UPDATE runs service-role (the invitee cannot satisfy the brand_admin+ UPDATE RLS — that policy is intentionally NOT widened).

---

### 4.3 — SERVICE LAYER

**File:** `mingla-business/src/services/brandInvitationsService.ts`

1. **New type:**
   ```ts
   export interface PendingInviteRow {
     id: string; brand_id: string; brand_name: string;
     role: BrandRole; expires_at: string;
   }
   ```
2. **New query `listMyPendingInvites()`** → invokes `list-my-pending-invites`, returns `PendingInviteRow[]`. Same error envelope as `acceptBrandInvitation` (`extractStatus`/`extractErrorCode` + `BrandInvitationServiceError`). On `{ invites: [...] }` map to `PendingInviteRow[]`; non-object data → `[]` (never throw on empty).
3. **Modify `acceptBrandInvitation`** signature to:
   ```ts
   export async function acceptBrandInvitation(
     arg: { token: string } | { invitationId: string },
   ): Promise<AcceptBrandInvitationResult>
   ```
   Body = `{ token }` or `{ invitationId }` accordingly. **Caller impact:** the existing web caller (`accept-brand-invitation.tsx` via `useAcceptBrandInvitation`) passes a raw token string today — update that ONE call site to `acceptBrandInvitation({ token })`. Grep `acceptBrandInvitation(` to confirm only the hook + web page call it.
   *(Allowed alternative to avoid touching the web path: keep `acceptBrandInvitation(token: string)` and add a SEPARATE `acceptMyInvitation(invitationId: string)`. Implementor MAY choose either; the separate-function option is lower-blast and PREFERRED. If chosen, name it `acceptMyPendingInvitation(invitationId)`.)*
4. **New mutation `declineBrandInvitation(invitationId: string): Promise<void>`** → invokes `decline-brand-invitation`. On `410 invite_not_actionable` treat as resolved (return normally — the invite is no longer pending, which is the decline goal); on other non-2xx throw `BrandInvitationServiceError`.
5. **New cache key:** extend `brandInvitationKeys`:
   ```ts
   myPending: (userId: string): readonly ["brand-invitations","my-pending",string] =>
     ["brand-invitations","my-pending",userId] as const,
   ```

---

### 4.4 — HOOK LAYER

**File:** `mingla-business/src/hooks/useBrandInvitations.ts`

1. **`useMyPendingInvites(userId, enabled)`** — React Query:
   - `queryKey`: `brandInvitationKeys.myPending(userId)` (disabled key when `userId === null`).
   - `queryFn`: `listMyPendingInvites()`.
   - `enabled`: `userId !== null && enabled` — see §4.5 for the flash-safe `enabled` gate.
   - `staleTime`: 30s (matches `STALE_TIME_MS`).
2. **`useAcceptMyInvitation()`** (or extend the existing `useAcceptBrandInvitation`) — mutation calling `acceptMyPendingInvitation(invitationId)`. onSuccess: invalidate `brandInvitationKeys.myPending(userId)`, `brandKeys.list(userId)` (new brand membership), `brandRoleKeys` for the brand, and `businessNotificationKeys.all(userId)`.
3. **`useDeclineMyInvitation()`** — mutation calling `declineBrandInvitation(invitationId)`. onSuccess: invalidate `brandInvitationKeys.myPending(userId)` + `businessNotificationKeys.all(userId)`.

---

### 4.5 — DETECTION + FLASH-SAFE GATING (where it mounts)

**Owner hook:** `useBusinessTodos` (`mingla-business/src/hooks/useBusinessTodos.ts`) is the single place that already computes `isBrandResolving` and feeds `buildBusinessTodos`. The pending-invite detection mounts HERE so the To-Do row and the brand-state derivation share one resolution gate.

**Flash-safe `enabled` gate (mirrors ORCH-1100 RC-1 + the existing `hasNoBrands` guard at `useBusinessTodos.ts:70-71`):**
```
const inviteDetectionReady =
  isAuthReady === true &&            // session settled (AuthContext)
  user?.id != null &&                // we have an account id
  brandsQuery.isFetched &&           // brand list resolved
  !isBrandResolving;                 // brand pointer not mid-hydration
const myPending = useMyPendingInvites(user?.id ?? null, inviteDetectionReady);
```
Rationale: querying before auth/brand resolution settles would (a) fire with a possibly-stale email and (b) risk a one-frame invite row flashing then vanishing. Gating on the SAME `isBrandResolving` the To-Do list already trusts keeps the invite row's appearance atomic with the rest of the list. False-positive flash is structurally prevented: the row only computes after `isBrandResolving===false`.

**Note:** detection runs regardless of `hasNoBrands` — an invited user may already own a brand AND have a pending invite to a different brand. The invite row is independent of the brand-gate early-returns (§4.6).

---

### 4.6 — TO-DO ROW

**File:** `mingla-business/src/utils/businessTodos.ts`

1. **Extend `BusinessTodoAction`:**
   ```ts
   export type BusinessTodoAction =
     | { kind: "open_brand_switcher" }
     | { kind: "open_universal_creator" }
     | { kind: "route"; route: string }
     | { kind: "open_pending_invite"; invitationId: string; brandName: string }; // ORCH-1111
   ```
2. **Extend `BusinessTodoInput`:**
   ```ts
   /** ORCH-1111 — pending brand invitations for the signed-in email (already
    *  flash-gated by the hook; [] when none or still resolving). */
   pendingInvites: { id: string; brandName: string }[];
   ```
3. **Emit the invite row(s) BEFORE the brand-gate early-returns** (so a brand-less invitee sees the invite ABOVE/INSTEAD of being stranded on "Create a brand", and a branded invitee sees it atop their list). Insert at the very top of `buildBusinessTodos`, before the `hasNoBrands` check:
   ```ts
   const inviteTodos: BusinessTodo[] = input.pendingInvites.map((inv) => ({
     id: `pending_invite_${inv.id}`,
     label: `You've been invited to ${inv.brandName}`,
     sublabel: "Tap to accept or decline",
     action: { kind: "open_pending_invite", invitationId: inv.id, brandName: inv.brandName },
   }));
   if (input.hasNoBrands) {
     return [...inviteTodos, { id: "create_brand", ... }];   // invite(s) first, then create-brand
   }
   if (input.hasBrandsButNoSelection) {
     return [...inviteTodos, { id: "select_brand", ... }];
   }
   if (input.brandResolving || !input.hasBrand) {
     return inviteTodos;   // still show invites even while brand resolves (they're hook-gated already)
   }
   const todos: BusinessTodo[] = [...inviteTodos];   // seed the normal list with invites on top
   ```
   **Ordering:** invite rows are ALWAYS first (highest priority — an invite is a one-tap relationship decision). Within multiple invites, preserve the hook's `expires_at ASC` order (soonest-expiring first).
   **Vanish:** a row disappears the instant `pendingInvites` no longer contains its id — which happens when accept/decline invalidates `useMyPendingInvites` and the refetch returns without it. No per-row local state.

**File:** `mingla-business/src/hooks/useBusinessTodos.ts` — thread the new input:
```ts
pendingInvites: (myPending.data ?? []).map((p) => ({ id: p.id, brandName: p.brand_name })),
```
Add `myPending.data` to the `useMemo` dep array.

**File:** `mingla-business/app/(tabs)/home.tsx` — extend `handleTodoAction` switch (`:373`) with:
```ts
case "open_pending_invite":
  setPendingInvite({ invitationId: todo.action.invitationId, brandName: todo.action.brandName });
  return;
```
plus the `_exhaustive` default still type-checks (the new kind is handled, so the `never` assignment stays valid). Add `const [pendingInvite, setPendingInvite] = useState<{invitationId:string;brandName:string}|null>(null)` and render `<InvitePendingSheet>` (§4.6.1) when non-null.

#### 4.6.1 InvitePendingSheet (NEW component)

- **File:** `mingla-business/src/components/team/InvitePendingSheet.tsx` (sibling of `InviteBrandMemberSheet.tsx`; reuse its sheet/glass conventions).
- **Props:** `{ invitationId: string; brandName: string; visible: boolean; onClose: () => void }`.
- **Body copy:** title `You've been invited to ${brandName}`, body `Accept to join ${brandName}, or decline if this wasn't meant for you.`
- **Actions:** primary `Accept` → `useAcceptMyInvitation().mutate(invitationId)`; secondary `Decline` → `useDeclineMyInvitation().mutate(invitationId)`.
- **a11y:** both buttons ≥44pt, `accessibilityRole="button"`, labels `Accept invitation to ${brandName}` / `Decline invitation to ${brandName}`.
- **Haptics:** success haptic on accept resolve; light on decline.
- See §7 state table for every state.

---

### 4.7 — ORCH-1112: the non-monotonic gate

**File:** `mingla-business/src/utils/navTabGate.ts`

**Current code (`:42-69`):** `MIN_RANK_FOR_TAB` is a flat `Record<TabId, number>`; `visibleTabsForRank` filters `rank >= MIN_RANK_FOR_TAB[tab.id]` (monotonic).

**Constraint stack that the change must NOT break:**
- Strict-grep gate `.github/scripts/strict-grep/orch-1055-nav-tab-rank-gate.mjs` parses **keys** of `MIN_RANK_FOR_TAB` (via regex `^\s*([a-zA-Z_]\w*)\s*:` inside `MIN_RANK_FOR_TAB = { ... } as const`) and requires every `TABS` id to be a key. → `ari:` MUST remain a declared key inside that literal.
- Jest `navTabGate.test.ts:132-136` asserts `MIN_RANK_FOR_TAB.ari` is a **number** `> BRAND_ROLE_RANK.scanner`. → `ari`'s value must stay a number `> 10`. (Keeping it `30` satisfies this.)
- Anchor comment `// orch-strict-grep-anchor MIN_RANK_FOR_TAB` (`:40`) must stay.
- I-32: no change to `BRAND_ROLE_RANK` / `NO_MEMBERSHIP_RANK`.

**Chosen implementation — keep `MIN_RANK_FOR_TAB.ari = 30` (scalar, satisfies gate + jest) and add a NON-MONOTONIC special case in `visibleTabsForRank`:**

Replace the `visibleTabsForRank` filter body (`:65-69`) with:
```ts
export const visibleTabsForRank = <T extends BottomNavTab>(
  tabs: readonly T[],
  rank: number,
): T[] =>
  tabs.filter((tab) => {
    const min = (MIN_RANK_FOR_TAB as Record<string, number | undefined>)[tab.id];
    if (min === undefined) return false;
    // ORCH-1112 — non-monotonic carve-out: Ari is reachable for a BRAND-LESS
    // user (rank 0) so they can create their first brand via Ari's create_brand
    // tool, AND for finance_manager+ (rank>=30). It stays HIDDEN for rank-10
    // scanners and rank-20 marketing managers, preserving the ORCH-1055 scanner
    // nav lockout. This is the ONLY tab with a non-monotonic rule.
    if (tab.id === "ari") {
      return rank === NO_MEMBERSHIP_RANK || rank >= min;
    }
    return rank >= min;
  });
```
Add import: `import { BRAND_ROLE_RANK, NO_MEMBERSHIP_RANK } from "./brandRole";` (currently only `BRAND_ROLE_RANK` is imported at `:31`).

**Why this shape, not a predicate-valued `MIN_RANK_FOR_TAB`:** changing `ari`'s value to a function/object breaks BOTH the strict-grep value-agnostic key parse (still fine) AND the jest `toBeGreaterThan` number assertion (breaks). Keeping the scalar `30` and branching by `tab.id` inside the filter is the minimal change that keeps every existing gate green while making the gate non-monotonic for exactly one tab.

**`_layout.tsx` — NO shape change to the call.** The existing call `visibleTabsForRank(TABS, brandPointerPending ? MAX_SAFE_INTEGER : rank)` (`:106`) already passes the resolved `rank`. A genuinely brand-less signed-in user resolves to `rank === 0` AFTER the ORCH-1100 RC-1 `brandPointerPending` window closes (`:99-102`), at which point `visibleTabsForRank(TABS, 0)` now yields `ari` via the new carve-out. During `brandPointerPending` the call passes `MAX_SAFE_INTEGER` (full set) — unaffected. **No change to `_layout.tsx` required.**

**Feature flag interaction:** `ari` ALSO passes `isTabVisible(tab.id)` (`_layout.tsx:107`, `EXPO_PUBLIC_FF_ARI_ENABLED` default true). The gate change is downstream-independent of the flag; if the flag is off, Ari stays hidden regardless (unchanged).

---

## 5. Success criteria (numbered, per-surface where parity is manual; parity is automatic here → shared)

**ORCH-1111**
- **SC-1** A signed-in user whose login email matches a `pending`, non-expired `brand_invitations.email` sees a To-Do row "You've been invited to {brand}" within one refetch of Home/Hub mount.
- **SC-2** The row text is exactly `You've been invited to ${brandName}` with sublabel `Tap to accept or decline`.
- **SC-3** Tapping the row opens `InvitePendingSheet` with Accept + Decline.
- **SC-4** Accept → membership created (or ownership transferred for a `brand_owner` invite) via the existing RPC; the row + bell notification vanish after invalidation; the new brand appears in the brand switcher.
- **SC-5** Decline → `brand_invitations.status='declined'`, `declined_at` set; the row + notification vanish; the brand is NOT joined.
- **SC-6** A `business.brand_invite_pending` notification appears in the bell exactly once per invite (idempotent across repeated logins).
- **SC-7** An invite for a DIFFERENT email does NOT surface (server email match). An `expired`, `revoked`, `accepted`, or `declined` invite does NOT surface.
- **SC-8** `list-my-pending-invites` NEVER returns `token_hash`/`invited_by`/`email` in its payload.
- **SC-9** Accept/Decline of an already-terminal invite (race / double-tap) returns a clean 410 `invite_not_actionable` and the UI treats it as resolved (row vanishes, no error toast on decline; on accept, show "This invite is no longer available").
- **SC-10** No invite row flashes during the auth/brand-resolution window (gated on `inviteDetectionReady`).

**ORCH-1112**
- **SC-11** A brand-less signed-in user (rank 0, after brand resolution settles) sees the **Ari** tab in the bottom nav.
- **SC-12** A rank-10 scanner does NOT see Ari (still Home + Account only).
- **SC-13** A rank-20 marketing manager does NOT see Ari (sees Home + Blast + Account; NOT Ari).
- **SC-14** A rank-30 finance_manager (and above) still sees Ari (unchanged).
- **SC-15** From the brand-less Ari tab, the user can ask Ari to create a brand and the existing `create_brand` tool runs (no new wizard; capability already present).
- **SC-16** `BRAND_ROLE_RANK` / `NO_MEMBERSHIP_RANK` values are unchanged; the `nav-tab-gate-declared` strict-grep gate passes; existing `navTabGate.test.ts` assertions still pass.

---

## 6. Invariants

### Preserved
- **I-32 (rank parity SQL↔TS):** untouched — no `BRAND_ROLE_RANK`/`NO_MEMBERSHIP_RANK` edit. Verified by the unchanged `brandRole.ts` + existing parity test.
- **`nav-tab-gate-declared` strict-grep** (`orch-1055-nav-tab-rank-gate.mjs`): `ari` stays a declared key with a scalar value → gate green. Verified by running the gate.
- **I-PROPOSED-W (notifications prefix filter):** the new notification type is `business.brand_invite_pending` (`business.%`) → passes `useBusinessNotifications`' `.or("type.like.stripe.%,type.like.business.%")`. Verified by SC-6.
- **I-PROPOSED-I (rowcount-verified invite mutations):** the decline UPDATE uses `... AND status='pending' RETURNING id` and treats 0 rows as `invite_not_actionable` — mirrors `revokeBrandInvitation` (`brandInvitationsService.ts:187-202`).
- **`feedback_stripe_rak_onboard_fail_close` / key-resolution invariants:** untouched (no Stripe key code).

### New (DRAFT — flip ACTIVE on CLOSE; orchestrator owns the flip)
- **I-PROPOSED-1055-AMEND (ORCH-1055 nav-gate amendment) — DRAFT.** The ORCH-1055 decision "a rank-10 scanner MUST NOT see the full brand-management nav surface" is AMENDED: the **Ari** tab is now visible to rank-0 (brand-less) users as well as rank≥30, while remaining HIDDEN for rank-10 scanners and rank-20 marketing managers. The scanner lockout is preserved; only a deliberate rank-0 carve-out is added so a brand-less user can reach Ari to create their first brand. Enforcement family: **tests** (`navTabGate.test.ts` cases SC-11/12/13/14) + **strict-grep** (existing `orch-1055-nav-tab-rank-gate.mjs` continues to assert key parity). Recorded as an explicit amendment to the ORCH-1055 DECISION per the locked decision 2A.
- **I-PROPOSED-1108-MYPENDING-PROJECTION — DRAFT.** The invitee-facing pending-invite read (`list-my-pending-invites`) MUST return only `{ id, brand_id, brand_name, role, expires_at }` and MUST NOT expose `token_hash`, `invited_by`, or `email`. Enforcement family: **tests** (edge-fn response-shape test, SC-8) + code review. (No strict-grep proposed unless tester requests one.)
- **I-PROPOSED-1108-EMAIL-NORMALIZE — DRAFT.** Any invitee↔invite email comparison (`list-my-pending-invites`, the accept tokenless branch, `decline-brand-invitation`) MUST compare `lower(trim(jwt.email))` against `lower(brand_invitations.email)`. Enforcement family: **tests** (mismatched-case fixture must still match; SC-7) + code review.
- **`MIN_RANK_FOR_TAB` shape contract** (restated, not new): each key's value remains a **scalar number**; non-monotonic behavior lives in `visibleTabsForRank`, never in the literal. This preserves the strict-grep + jest value assertions. Enforcement family: **tests** + **strict-grep** (existing).

---

## 7. Test cases

### State table — InvitePendingSheet (every state)

| State | Trigger | UI |
|-------|---------|-----|
| loading (list) | detection in flight | No invite row yet (gated; nothing flashes) |
| no-invite | `pendingInvites === []` | No invite row; normal To-Do list |
| one-invite | 1 pending | One invite row at top; tap → sheet |
| multiple-invites | N pending | N rows, `expires_at ASC`; each opens its own sheet |
| sheet-idle | sheet open | Accept (primary) + Decline (secondary) enabled |
| accept-submitting | Accept tapped | Both buttons disabled, Accept shows spinner |
| accept-success | RPC 200 | Success haptic; sheet closes; row + bell vanish; brand switcher shows new brand; toast "You've joined {brand}" |
| decline-submitting | Decline tapped | Both disabled, Decline spinner |
| decline-success | 200 | Sheet closes; row + bell vanish; toast "Invitation declined" |
| not-actionable | 410 `invite_not_actionable` | Sheet closes; row vanishes (refetch); on accept show "This invite is no longer available", on decline silent |
| email-mismatch | 403 | Toast "This invite isn't for this account."; sheet stays open |
| error | 500 / network | Toast "Couldn't reach Mingla — tap to retry."; buttons re-enabled; invite stays |

### Behavioral test matrix

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T1 | happy detect | pending invite for jwt email | row appears | hook+util |
| T2 | wrong email | invite for `other@x.com`, jwt `me@x.com` | edge returns `{invites:[]}`; no row | edge |
| T3 | expired | pending but `expires_at < now()` | not returned; no row | edge |
| T4 | revoked/accepted/declined | terminal status | not returned | edge |
| T5 | case mismatch | invite `Me@X.com` stored lower, jwt `me@x.com` | matches; row appears | edge |
| T6 | accept owner-transfer | `role=brand_owner` invite | RPC transfers; brand repointed; row vanishes | edge+rpc |
| T7 | accept team-member | `role=event_manager` invite | membership row created; row vanishes | edge+rpc |
| T8 | decline | pending invite | status=declined, declined_at set; not joined | edge |
| T9 | double-decline | decline already-declined | 410 not_actionable; UI resolved | edge |
| T10 | projection leak | inspect list payload | no token_hash/invited_by/email | edge |
| T11 | no-flash | mount before auth ready | no row during resolution window | hook |
| T12 | gate brandless | `visibleTabsForRank(TABS, 0)` | includes `ari` | util |
| T13 | gate scanner | `visibleTabsForRank(TABS, 10)` | EXCLUDES `ari` → `[home, account]` | util |
| T14 | gate marketing | `visibleTabsForRank(TABS, 20)` | `[home, marketing, account]` (no ari) | util |
| T15 | gate finance | `visibleTabsForRank(TABS, 30)` | includes `ari` (unchanged) | util |
| T16 | gate owner | `visibleTabsForRank(TABS, 60)` | full set (unchanged) | util |
| T17 | strict-grep | run `orch-1055-nav-tab-rank-gate.mjs` | exit 0 | CI |

---

## 8. Implementation order

1. **DB:** write + apply migration `…_orch_1108_brand_invite_declined.sql` (via Supabase Management API per `feedback_edge_deploy_and_migration_apply_hazards` — MCP read-only/CLI drift-wedged).
2. **Edge:** `list-my-pending-invites` (new) → `decline-brand-invitation` (new) → `accept-brand-invitation` tokenless branch (modify). Add all three config.toml `verify_jwt=true` blocks. Deploy from MERGED main, not a stale worktree.
3. **Service:** `brandInvitationsService.ts` — `PendingInviteRow`, `listMyPendingInvites`, `acceptMyPendingInvitation`, `declineBrandInvitation`, `brandInvitationKeys.myPending`.
4. **Hook:** `useBrandInvitations.ts` — `useMyPendingInvites`, `useAcceptMyInvitation`, `useDeclineMyInvitation`.
5. **To-Do util:** `businessTodos.ts` — `BusinessTodoAction` + `BusinessTodoInput` + emit invite rows.
6. **Detection wiring:** `useBusinessTodos.ts` — `useMyPendingInvites` + `inviteDetectionReady` gate + thread `pendingInvites`.
7. **Component:** `InvitePendingSheet.tsx` (new) + `home.tsx` action wiring + sheet mount.
8. **ORCH-1112:** `navTabGate.ts` non-monotonic `ari` carve-out (independent — can land first; lowest risk).
9. **Tests:** §9 regression contract.

---

## 9. Regression prevention — fails-on-revert contract

### ORCH-1111
- **(a) Implementor happy-path test (must FAIL on revert):**
  `mingla-business/src/utils/__tests__/businessTodos.invite.test.ts` — assert `buildBusinessTodos({ ...base, pendingInvites: [{ id:'i1', brandName:'Acme' }], hasNoBrands: true })` returns a first row with `id==='pending_invite_i1'`, `label==='You've been invited to Acme'`, `action.kind==='open_pending_invite'`, AND that the `create_brand` row still follows. Reverting the `businessTodos.ts` emit → the invite row disappears → test fails.
  PLUS an edge-fn projection unit test `supabase/functions/list-my-pending-invites/index.test.ts` asserting the response shape excludes `token_hash`/`invited_by`/`email` (SC-8).
- **(b) Tester adversarial test (different angle):**
  `supabase/functions/list-my-pending-invites/index.adversarial.test.ts` — (i) an invite for a DIFFERENT email is NOT returned; (ii) an `expired` and a `revoked` invite are NOT returned; (iii) a `declined` invite is NOT returned. Drives the real query path with seeded rows. Reverting the `status='pending' AND expires_at>now()` filter → leaks → test fails.

### ORCH-1112
- **(a) Implementor happy-path test (must FAIL on revert):**
  Append to `mingla-business/src/utils/__tests__/navTabGate.test.ts`:
  - `it("surfaces ari for a brand-less rank-0 user (ORCH-1112)")` → `visibleTabsForRank(FULL_TABS, 0)` includes `ari` (and still includes home/account). Reverting the carve-out → rank-0 drops ari → fails.
  - Keep the EXISTING `rank=0 → [home, account]` test? **NO — that test (`:34-38`) now contradicts the new behavior.** Update it to expect `["home", "ari", "account"]` for rank 0, with a comment citing ORCH-1112. (This is the one existing test the change must edit; tests are append-mostly but this is a deliberate behavior change recorded in the I-PROPOSED-1055-AMEND DRAFT.)
- **(b) Tester adversarial test (different angle — scanner MUST NOT regain Ari):**
  Add `it("rank-10 scanner still does NOT see ari after the ORCH-1112 carve-out")` → `visibleTabsForRank(FULL_TABS, 10)` EQUALS `["home","account"]` (no ari), AND `it("rank-20 marketing manager does NOT see ari")` → `["home","marketing","account"]`. Reverting the carve-out to a naive `ari:0` scalar → scanner regains ari → these fail.
- **(c) Strict-grep:** `node .github/scripts/strict-grep/orch-1055-nav-tab-rank-gate.mjs` MUST still exit 0 (ari remains a declared key).

**Note on tests-append-only:** the navTabGate rank-0 test edit (`:34-38`) is a sanctioned behavior change, not an append violation — flag it to the orchestrator at CLOSE so the tests-append-only invariant ledger records the intentional edit.

---

## 10. Open questions

- **OQ-1 (RPC hardening, non-blocking):** the in-app accept branch guards `status==='pending'` BEFORE the RPC, so a `declined` invite cannot be re-accepted in-app. The web path still calls the RPC directly with a raw token; the RPC does NOT special-case `declined` (it only checks `accepted`/`revoked`/`expired`). A declined invite's raw token, if somehow replayed via the web path, could still accept. **Recommendation:** add `IF v_invitation.status = 'declined' THEN RAISE … 'invite_declined' (P0007)` to the RPC in a follow-up — NOT in this ticket's scope unless Seth wants the RPC hardened now. Flagged for orchestrator decision.
- **OQ-2 (bell mark-read on decline):** clearing the `business.brand_invite_pending` unread on decline is best-effort. If no trivial service-role mark-read helper exists, SKIP (the To-Do row vanishing is the primary signal; the stale unread self-resolves when the user opens the bell). Confirm acceptable.
- **OQ-3 (service signature):** `acceptBrandInvitation` overload vs new `acceptMyPendingInvitation`. SPEC PREFERS the new separate function (lower blast on the web path). Implementor may pick either; if the overload is chosen, the one web caller must be updated.

None of these block IMPLEMENT; OQ-1 is the only one that might warrant a Seth decision (RPC hardening now vs follow-up).

---

## 11. Downstream routing

Next = **mingla-implementor** (business side). Then **mingla-tester** (business iOS + Android, plus the adversarial edge tests). Then **mingla-orchestrator** CLOSE (flips the three I-PROPOSED-* DRAFT invariants ACTIVE, records the ORCH-1055 amendment in the DECISION_LOG, logs the sanctioned navTabGate test edit against tests-append-only).

**Working tree:** dispatch ran on the anchor `/Users/sethogieva/Desktop/mingla-main` (no per-ORCH worktree spawned); the orchestrator should spawn `~/Desktop/mingla-orchs/ORCH-1111-1109-[partner-invite-surface-and-ari-gate]/` and `git fetch origin && git rebase origin/main` before IMPLEMENT (spawn branches off a possibly-stale anchor main).

---

## Allowlist (implementor may change ONLY these)

**ORCH-1111**
- `supabase/migrations/<new>_orch_1108_brand_invite_declined.sql` (NEW)
- `supabase/functions/list-my-pending-invites/index.ts` (NEW) + `…/index.test.ts` + `…/index.adversarial.test.ts`
- `supabase/functions/decline-brand-invitation/index.ts` (NEW)
- `supabase/functions/accept-brand-invitation/index.ts` (MODIFY — add tokenless branch only)
- `supabase/config.toml` (ADD two `[functions.*]` blocks; do not alter existing)
- `mingla-business/src/services/brandInvitationsService.ts`
- `mingla-business/src/hooks/useBrandInvitations.ts`
- `mingla-business/src/utils/businessTodos.ts`
- `mingla-business/src/hooks/useBusinessTodos.ts`
- `mingla-business/app/(tabs)/home.tsx` (action wiring + sheet mount only)
- `mingla-business/src/components/team/InvitePendingSheet.tsx` (NEW)
- `mingla-business/src/utils/__tests__/businessTodos.invite.test.ts` (NEW)

**ORCH-1112**
- `mingla-business/src/utils/navTabGate.ts`
- `mingla-business/src/utils/__tests__/navTabGate.test.ts` (append new cases + the one sanctioned rank-0 edit)

## DO-NOT-TOUCH
- `BRAND_ROLE_RANK` / `NO_MEMBERSHIP_RANK` in `mingla-business/src/utils/brandRole.ts` (I-32).
- `MIN_RANK_FOR_TAB` literal VALUES (keep `ari: 30` scalar; non-monotonic logic lives in `visibleTabsForRank`).
- `_layout.tsx` (no change needed for either ticket).
- `accept_invite_and_transfer_brand_ownership` RPC (unless Seth approves OQ-1 hardening — then a SPEC amendment).
- `invite-brand-member` edge fn (no at-invite notification — Discovery #1).
- The four existing `brand_invitations` RLS policies (no widen — service-role edge fns own invitee read/write).
- `.github/scripts/strict-grep/orch-1055-nav-tab-rank-gate.mjs` (must stay green, not edited).
- Any consumer-app (`app-mobile/`), admin (`mingla-admin/`), Stripe-key, or Paystack file.

Implementor MUST stop-and-amend (request a SPEC amendment) before touching anything outside the allowlist.
