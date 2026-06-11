# INVESTIGATE — ORCH-1111 (surface pending invites in-app) + ORCH-1112 (make Ari reachable with no brand)

**Phase:** INVESTIGATE only (evidence; no spec, no code change).
**Repo:** `/Users/sethogieva/Desktop/mingla-main` · anchor `main` (read-only).
**Date:** 2026-06-10.
**Discipline:** mingla-forensics. Every claim carries file:line + quoted code.

**Comms ledger:** Read `COMMS_LEDGER.md`. No `OPEN` `BLOCK`/`WARN` row is addressed `to` forensics, ORCH-1111, ORCH-1112, or `ALL`. Nothing to ack. No cross-ORCH discovery requiring a new COMMS row.

**Confidence:** `probable` overall (source-traced end-to-end across DB/RLS/edge/service/hook/component; backend-and-config investigation, live-fire exempt per Prime Directive 7). The two RLS/CHECK-constraint findings are `proven` from the authoritative latest migration.

---

## ORCH-1111 — Surface pending invites in-app

### Q1 — INVITE DETECTION: any existing in-app path that queries invites by the user's email on login/bootstrap?

**Answer: NO. There is no in-app pending-invite detection by the authenticated user's email anywhere in the business app.** Proven by absence + the one place it would live being email-blind.

Evidence — the only invite-reading service query is keyed by `brand_id`, never by email:

`mingla-business/src/services/brandInvitationsService.ts:207-216`
```ts
export async function listBrandInvitations(brandId: string): Promise<BrandInvitationRow[]> {
  const { data, error } = await supabase
    .from("brand_invitations")
    .select("id, brand_id, email, invitee_name, role, ...")
    .eq("brand_id", brandId)                       // ← brand-scoped, NOT email-scoped
    .order("expires_at", { ascending: false });
```

Grep for any email-keyed invite query in the business app returns only the **inviter-side** "already a pending invite for that email" guards in the team/scanner invite sheets — never an invitee-side lookup:
```
mingla-business/src/components/team/InviteBrandMemberSheet.tsx:316  "There's already a pending invite for that email."
mingla-business/src/components/scanners/InviteScannerSheet.tsx:87   "There's already a pending invite for that email."
```

The auth/session bootstrap (`AuthContext.tsx`, `onAuthStateChange` listener around `:150`, `:187-195`) does NOT fan out to any invite check. Grep `pending.*invit|checkPendingInvit|invitationForEmail` across `mingla-business/src` + `app` → zero invitee-detection hits (only the inviter-side strings above).

**RLS HARD BLOCKER (proven).** Even if a detection query were added, an invited email with **no account and no membership cannot SELECT its own invite** under current RLS. The SELECT policy is brand_admin+ only, with no `email = jwt email` clause:

`supabase/migrations/20260820000000_orch_1050_brand_invite_flow.sql:122-150` (latest definition; not superseded):
```sql
CREATE POLICY "brand_invitations_select_brand_admin_plus"
  ON public.brand_invitations FOR SELECT TO authenticated
  USING ( EXISTS ( SELECT 1 FROM public.brand_team_members m ... m.role IN ('brand_owner','brand_admin') )
       OR EXISTS ( SELECT 1 FROM public.brands b JOIN creator_accounts a ... a.id = auth.uid() ) );
```
There is no policy granting `auth.jwt() ->> 'email' = brand_invitations.email`. **→ In-app detection requires either a new RLS SELECT policy keyed on the JWT email, or an edge function (service-role) that resolves the JWT email → pending invites.** (Investigation flags this; the SPEC chooses.)

**Verdict:** No existing in-app pending-invite detection. Adding one is net-new AND currently blocked by RLS for the brandless invitee. `proven`.

---

### Q2 — ACCEPT PATH: trace exactly how an invite is accepted today.

**Answer: Web-only today.** Landing page `/accept-brand-invitation?token=` → service `acceptBrandInvitation(token)` → edge fn `accept-brand-invitation` → RPC `accept_invite_and_transfer_brand_ownership`. There is **no in-app (non-web) accept entry**, and there is **no separate team-member accept RPC** — the single ownership-transfer RPC handles ALL roles (it conditionally transfers only when `role='brand_owner'`).

Entry point (web page):
`mingla-business/app/accept-brand-invitation.tsx:5-13`
```
URL: https://business.usemingla.com/accept-brand-invitation?token=<raw>
... 3. POST { token } to the accept-brand-invitation edge fn (via acceptBrandInvitation service).
```

Service:
`mingla-business/src/services/brandInvitationsService.ts:147-153`
```ts
export async function acceptBrandInvitation(token: string): Promise<AcceptBrandInvitationResult> {
  const { data, error } = await supabase.functions.invoke("accept-brand-invitation", { body: { token } });
```

Edge fn → single RPC for every role:
`supabase/functions/accept-brand-invitation/index.ts:194-197`
```ts
const { data: rpcResult, error: rpcErr } = await service.rpc(
  "accept_invite_and_transfer_brand_ownership",
  { p_token_hash: tokenHash, p_accepting_account_id: account.id },
);
```
The fn header confirms the RPC both accepts AND (when `role=brand_owner`) transfers, atomically, with `FOR UPDATE` locking (`accept-brand-invitation/index.ts:8-11`). So the `brand_owner` partner-transfer path and the standard team-member path are the **same** edge fn + **same** RPC; the role-branch lives inside the SQL function (migration `20260820000000_orch_1050_brand_invite_flow.sql:382` `SET status='accepted'` for all, transfer block conditional on role).

**No in-app accept entry exists.** The accept token is only consumed via the web route above; `supabase.functions.invoke("accept-brand-invitation", …)` has exactly one caller (the service, called only by the web page's `useAcceptBrandInvitation` hook at `accept-brand-invitation.tsx:39,58`).

**Verdict:** Web → edge → single transfer-aware RPC. No native accept. An in-app Accept button would reuse `acceptBrandInvitation(token)` — **but the invitee needs the raw token**, which today only arrives via the emailed link (see Q1 RLS: the invitee can't read its own row to get a token, and `token_hash` is one-way). `probable`.

---

### Q3 — DECLINE PATH: does any decline exist? minimal honest decline?

**Answer: NO decline path exists. `'declined'` is NOT an allowed `brand_invitations.status` value.** The CHECK constraint allows only four values.

`supabase/migrations/20260820000000_orch_1050_brand_invite_flow.sql:52` (latest):
```sql
CHECK (status IN ('pending', 'accepted', 'revoked', 'expired'));
```
Grep `declined` across `supabase/migrations/` hits ONLY other tables (`friend_requests`, `pair_requests`, `tag_along_requests` at `20260505000000_baseline_squash_orch_0729.sql:8323,8593,9798`) — never `brand_invitations`.

Minimal honest decline today (without a constraint change) = reuse the existing `'revoked'` terminal state via the existing revoke shape (`revokeBrandInvitation` at `brandInvitationsService.ts:182-203` sets `status='revoked', revoked_at=now()`), but semantically `revoked` = inviter-cancelled, not invitee-declined — conflating the two loses attribution. The cleaner option is **adding `'declined'` to the CHECK constraint** + a dedicated column/timestamp. Note: the current UPDATE RLS (`…:182` "UPDATE: brand_admin+ may revoke") only permits brand_admin+, so an invitee-driven decline would ALSO need an RLS UPDATE policy (or a service-role edge fn) for the invitee — same gap as Q1.

**Verdict:** No decline path; allowed status set is `{pending, accepted, revoked, expired}`. A real decline needs a constraint widen (`'declined'`) + invitee-side write authority. `proven` (constraint), `probable` (write-authority gap).

---

### Q4 — TO-DO LIST: the smart To-Do surface; how rows are computed; adding an invite row.

**Answer: Fully data-driven.** The pure function `buildBusinessTodos(input)` returns an ordered `BusinessTodo[]` from derived booleans; `<BusinessTodoToggle>` renders them generically; `useBusinessTodos()` supplies the input. Adding a "You've been invited to X — Accept / Decline" row is a data-layer add, NOT a component rewrite — though the row's data must come from a NEW invite-detection source (Q1).

Pure derivation (no React, trivially testable):
`mingla-business/src/utils/businessTodos.ts:110-122` — note the early-return brand gate that today emits ONLY "Create a brand" for a brandless user:
```ts
export function buildBusinessTodos(input: BusinessTodoInput): BusinessTodo[] {
  if (input.hasNoBrands) {
    return [{ id: "create_brand", label: "Create a brand",
              sublabel: "Set up your business on Mingla",
              action: { kind: "open_brand_switcher" } }];
  }
```
**This is the exact "empty Create-a-brand To-Do" the invited email lands on** (the symptom). An invite row would either prepend before this early-return or be injected by the hook.

Generic renderer (row set is `props.todos`, fully data-driven; supports label + sublabel + optional badge + chevron):
`mingla-business/src/components/home/BusinessTodoToggle.tsx:96-138`. Empty → renders nothing (`:74 if (count === 0) return null`).

Action dispatch is a discriminated union; a new action kind (e.g. open an invite sheet) would extend it:
`mingla-business/src/utils/businessTodos.ts:18-21`
```ts
export type BusinessTodoAction =
  | { kind: "open_brand_switcher" }
  | { kind: "open_universal_creator" }
  | { kind: "route"; route: string };
```
Home wires actions at `mingla-business/app/(tabs)/home.tsx:371-389` (`handleTodoAction` switch over `todo.action.kind`).

Hook (the data source — currently has NO invite input):
`mingla-business/src/hooks/useBusinessTodos.ts:40,70-71,114-144` — computes `hasNoBrands` etc. from `useBrands(user?.id)` and feeds `buildBusinessTodos`. A new `pendingInvites` input would be threaded here.

**Verdict:** Row set is data-driven; adding an invite row is a clean data-layer extension (pure-fn input + new action kind + hook wiring), gated only by the Q1 detection source. `proven`.

---

### Q5 — IN-APP NOTIFICATIONS: bell + notification cards; data source; ORCH-1081 pattern.

**Answer: Data source = `public.notifications` table; created by edge functions via `dispatchNotification(...)`; read in-app via `useBusinessNotifications` (React Query + Realtime), filtered to `stripe.%`/`business.%` types.** ORCH-1081 already added two business notification types as the pattern to follow.

Read side (single source, prefix-filtered — I-PROPOSED-W gate):
`mingla-business/src/hooks/useBusinessNotifications.ts:133-140`
```ts
const { data, error } = await supabase.from("notifications")
  .select(SELECT_COLUMNS).eq("user_id", userId)
  .or("type.like.stripe.%,type.like.business.%")
  .order("created_at", { ascending: false }).limit(FETCH_LIMIT)...
```
Realtime INSERT-invalidate / UPDATE-patch on `notifications` filtered `user_id=eq.<id>` (`useBusinessNotifications.ts:82-118`). Rich inbox + unread + mark-read at `:184-284` (`useBusinessNotificationsInbox`).

Write side / pattern (ORCH-1081 transfer + first-split notifications — the model to copy):
`supabase/functions/accept-brand-invitation/index.ts:304-323` (`business.team_member_joined`) and `:359-376` (`business.partner_transfer_completed`):
```ts
await dispatchNotification({
  userId: recipientId, brandId, type: "business.team_member_joined",
  title, body, data: { ... }, relatedId: account.id, relatedType: "team_member",
  idempotencyKey: `business.team_member_joined:${brandId}:${account.id}:${recipientId}`,
  deepLink: `mingla-business://brand/${brandId}/team`,
});
```
`dispatchNotification` is imported from `_shared/stripeEdgeAuth.ts` (`accept-brand-invitation/index.ts:37-40`).

**GAP for ORCH-1111:** `invite-brand-member` (the CREATE side) sends only a **Resend email** to the invitee — it does NOT write a `notifications` row, and could not target the invitee anyway because the invitee has no `creator_accounts.id`/`user_id` yet (no account). Grep confirms `invite-brand-member/index.ts` has no `dispatchNotification` for the invitee (only the email body at `:285-317`). So an in-app invite notification can only fire AFTER the invited email creates an account (i.e. on first login, post-detection), not at invite-creation time. The notification type would follow the `business.*` convention (e.g. `business.brand_invite_pending`) to pass the `useBusinessNotifications` `.or()` filter.

**Verdict:** Notification infra exists and is healthy; the ORCH-1081 `dispatchNotification` calls in `accept-brand-invitation` are the exact pattern. New work = (a) detect on login, (b) emit a `business.*` invite notification keyed to the now-existing account. `probable`.

---

### Q6 — EMAIL MATCH RISK: how is the auth email obtained; case/normalization.

**Answer: Email comes from the Supabase auth session (`user.email`), surfaced via AuthContext.** `brand_invitations.email` and `partner_brand_links.invited_owner_email` are stored **lowercased**; the JWT email is NOT guaranteed lowercased, so any match MUST `.toLowerCase()` both sides.

Auth email source:
`mingla-business/src/context/AuthContext.tsx:523`
```ts
email: account?.email ?? s.user.email ?? null,
```
The edge-fn precedent already normalizes the JWT email when matching `partner_brand_links`:
`supabase/functions/accept-brand-invitation/index.ts:346`
```ts
const memberEmail = (userResult.user.email ?? "").toLowerCase();
```
Stored side is lowercased on write:
- invites: `brandInvitationsService.ts:127` `invitee_email: input.inviteeEmail.trim().toLowerCase()`
- invite edge fn: `invite-brand-member/index.ts:100` `const inviteeEmail = str(body.invitee_email).trim().toLowerCase();`

**Risk:** a raw equality match on `user.email` (mixed-case from the IdP) vs the lowercased stored `email` would silently miss the invite. The match key MUST be `lower(jwt.email) = brand_invitations.email`. If detection is done via RLS, the policy predicate must use `lower(auth.jwt() ->> 'email')`.

**Verdict:** Email is from the auth session; both sides must be lowercased for the match. `proven`.

---

## ORCH-1112 — Make Ari reachable with no brand

### Q7 — TAB GATE: current gate; ari threshold; rank a no-brand user gets; minimal change.

**Answer: `ari` is gated at rank 30 (finance_manager). A no-brand user gets rank 0 (`NO_MEMBERSHIP_RANK`). Minimal change = set `MIN_RANK_FOR_TAB.ari = 0`** (with the same strict-grep anchor preserved). That single value is the entire gate.

Gate table:
`mingla-business/src/utils/navTabGate.ts:46-53`
```ts
export const MIN_RANK_FOR_TAB = {
  home: 0,
  hub: BRAND_ROLE_RANK.finance_manager, // 30
  ari: BRAND_ROLE_RANK.finance_manager, // 30
  marketing: BRAND_ROLE_RANK.marketing_manager, // 20
  account: 0,
} as const;
```
Filter applied to the TABS superset:
`navTabGate.ts:63-72` (`visibleTabsForRank` drops any tab whose `rank < min`).
Consumed in the layout:
`mingla-business/app/(tabs)/_layout.tsx:121-127` `visibleTabsForRank(TABS, brandPointerPending ? MAX_SAFE_INTEGER : rank).filter(isTabVisible)`.

No-brand rank = 0:
`mingla-business/src/hooks/useCurrentBrandRole.ts:180` `const rank = role !== null ? BRAND_ROLE_RANK[role] : NO_MEMBERSHIP_RANK;`
`mingla-business/src/utils/brandRole.ts:37` `export const NO_MEMBERSHIP_RANK = 0;`

Additional gate: `ari` ALSO passes through a feature flag (`EXPO_PUBLIC_FF_ARI_ENABLED`, default `true`):
`mingla-business/src/config/featureFlags.ts:21,31-32`.

**Verdict:** `ari` threshold = 30; no-brand = 0; minimal change = `ari: 0` in `MIN_RANK_FOR_TAB`. The strict-grep anchor `// orch-strict-grep-anchor MIN_RANK_FOR_TAB` (`navTabGate.ts:44`) and the `nav-tab-gate-declared` gate must be honored. `proven`.

---

### Q8 — ARI CAPABILITY: route + component; can Ari create a brand today; what it does with no brand.

**Answer: Ari ALREADY has full brand-creation capability and ALREADY handles the no-brand case. "Create a brand with Ari" is NOT new capability — it is purely a matter of exposing the tab (Q7).**

Route + component:
`mingla-business/app/(tabs)/ari.tsx:11-13` → `<AriChatScreen/>` (`mingla-business/src/screens/ari/AriChatScreen.tsx`).

Ari reads the brand list but does NOT require a selected brand to render. It loads brands purely for name display:
`AriChatScreen.tsx:121-130`
```ts
const { user } = useAuth();
const accountId = user?.id ?? null;
const brands = useBrands(accountId);
const brandNamesById = React.useMemo(...);   // display only
```
The empty state (no brand required) explicitly advertises brand creation, and a quick-reply chip literally seeds a brand-create turn:
`AriChatScreen.tsx:337-341` chips: `"Create a brand called Sample Events"`.
`mingla-business/src/components/ari/EmptyState.tsx:31` "I can create events, manage brands, and answer questions about your business."

The `create_brand` tool exists and requires ONLY an authenticated `userId` (no brand, no membership, no rank):
`supabase/functions/_shared/agentTools.ts:149,169-203` — executor inserts `account_id: userId` and `.select(...).single()`; sets default brand on the user's first brand (`:227-247`). No membership/rank precondition.

The system prompt already routes the brandless user to `create_brand`:
`supabase/functions/_shared/agentSystemPrompt.ts:57` `"- (the user has no brands yet — they may want to create one first)"`,
`:84` "If the user asks to create an event… and they have NO brands… First explain they need a brand… then propose create_brand."

`AriChatScreen.handleConfirm` already consumes a `create_brand` result and surfaces the new `brand.id` (`AriChatScreen.tsx:193-199`).

**Verdict:** Ari is a ready brand-creation surface for a rank-0 user the moment the tab is visible. Net-new code for ORCH-1112 is essentially zero beyond the gate flip (optionally a brandless-tuned empty state / first-run nudge — a product choice, not a capability gap). `probable`.

---

### Q9 — LOW-RANK RISK: does `ari: 0` also expose Ari to a rank-10 scanner? how rank is computed.

**Answer: YES — `ari: 0` makes the tab visible to EVERYONE, including a rank-10 scanner, because the gate is a single numeric threshold (`rank >= min`), not a "no-brand only" predicate.** This is the central design tension for ORCH-1112.

Rank is a single scalar per (user, current brand):
`useCurrentBrandRole.ts:180` `rank = role !== null ? BRAND_ROLE_RANK[role] : NO_MEMBERSHIP_RANK;`
`brandRole.ts:28-37` scanner=10, marketing_manager=20, finance_manager=30, …, brand_owner=60; no-membership=0.

The gate compares only the scalar:
`navTabGate.ts:69-71` `const min = MIN_RANK_FOR_TAB[tab.id]; if (min === undefined) return false; return rank >= min;`

So `ari: 0` ⟹ scanner (10) and every other role (≥10) also see Ari. There is **no existing "rank === 0 only" tab predicate** — `visibleTabsForRank` is monotonic in rank. (The scanner-only branch that exists is `isScannerOnlyRank(rank) === (rank === scanner)` at `navTabGate.ts`/`home.tsx:397`, used to swap to `<ScannerHome>`, NOT to hide tabs.)

What inside Ari is permission-gated:
- **Server-side: Ari tool executors are NOT rank-gated.** `agentTools.ts` has zero `MIN_RANK`/`rank`/`brand_team_members` membership checks; `create_brand` gates only on `account_id === userId`; `delete_brand` gates on "a brand the user owns" (`agentTools.ts:554`), i.e. ownership, not the 6-role rank. So a scanner who reaches Ari could `create_brand` (their own new brand) regardless — which is harmless (it's THEIR brand), but event/refund tools operate on brands they own, not the scanned brand.
- **Client-side `permissionGates.ts MIN_RANK`** (`:16-34`) gates EDIT_EVENT(40), REFUND_ORDER(30), CREATE_EVENT(40), INVITE_TEAM_MEMBER(50), etc. — these protect the *manual* surfaces, and `create_brand` is **not** in `MIN_RANK` at all (brand creation is a pre-brand action, intentionally ungated). Note Ari's tools don't consult `permissionGates` — they're enforced (or not) server-side; RLS on the underlying tables (events/orders) is the real backstop for brand-scoped writes.

**Implication for SPEC (flagged, not decided):** a naive `ari: 0` REOPENS Ari to scanners, which ORCH-1055 deliberately closed (a rank-10 scanner currently sees Home + Account only — `navTabGate.ts:8-16` header). To make it "no-brand only" without re-granting scanners, the gate would need to become non-monotonic (e.g. visible when `rank >= 30 OR rank === 0`), which `visibleTabsForRank`'s current single-threshold contract cannot express — it would require a gate-shape change, not just a value change.

**Verdict:** `ari: 0` is "everyone," not "no-brand only." Rank is a single scalar; the gate is monotonic. Exposing Ari to brandless users without also exposing scanners requires changing the gate's SHAPE (an OR predicate), which modifies the ORCH-1055 nav-gate contract. `proven` (mechanism), `probable` (scanner side-effect, source-traced not sim-fired).

---

## Five-Truth-Layer reconciliation (contradictions flagged)

| Layer | ORCH-1111 | ORCH-1112 |
|---|---|---|
| Docs | MEMORY: ORCH-1081 partner flow shipped; invite via emailed link only. | ORCH-1055 header: scanner = Home+Account only; ari gated at 30. |
| Schema | `brand_invitations` SELECT = brand_admin+ only (no email policy); status CHECK = {pending,accepted,revoked,expired} (no `declined`). | rank scalar mirrors SQL `biz_role_rank()` (I-32). |
| Code | No email-keyed invite query; accept is web-only; notifications infra healthy; invite create = email only (no in-app notify). | `MIN_RANK_FOR_TAB.ari=30`; Ari `create_brand` needs only `userId`; system prompt already handles no-brand. |
| Runtime | (Exempt — backend/config; DB facts pre-proven by orchestrator.) | (Exempt.) |
| Data | (Pre-proven: revoked invite, no invitee account.) | A brandless signed-in user resolves to rank 0. |

**Contradiction #1 (the ORCH-1111 symptom):** Docs/product intent = "invitee should see the invite in-app," but Schema (RLS) + Code (no email query) = the invitee literally cannot see it. Truth holder: Schema/Code — the feature does not exist and is RLS-blocked. **The fix is net-new across RLS-or-edge + detection + To-Do/notification + accept-in-app.**

**Contradiction #2 (the ORCH-1112 tension):** Making Ari reachable at rank 0 (Code change) conflicts with the ORCH-1055 design decision that low-rank scanners get a stripped nav (Docs/Schema). Truth holder: the monotonic gate — a value flip cannot satisfy both; a shape change is required. **Flagged for SPEC, not resolved here.**

---

## Blast radius / cross-surface

- **ORCH-1111** touches: business iOS + business Android (To-Do row + notification + in-app accept/decline) and the web accept page is the existing precedent (unchanged). Consumer app: out of scope (business-only invites). Admin: out of scope. RLS/edge change is shared-backend → affects every surface that reads `brand_invitations` (only the business app does).
- **ORCH-1112** touches: business iOS + business Android only (tab gate + Ari empty state). Web business preview: the bottom nav is a side rail (`BottomNav.web.tsx`) — the same `visibleTabsForRank` feeds it, so the gate change applies there too (verify in SPEC). Consumer/admin: out of scope.

---

## Invariant impact (flagged, not pre-decided)

- **I-32 (rank parity SQL↔TS):** ORCH-1112 must NOT alter `BRAND_ROLE_RANK`/`NO_MEMBERSHIP_RANK` — only the per-tab threshold or gate shape. The gate is a UI-shell convenience layered on RLS; changing it doesn't touch I-32 as long as rank values are untouched.
- **ORCH-1055 nav-gate design decision** (`navTabGate.ts:8-30` header; SPEC §2 OPTION B): "a rank-10 scanner MUST NOT see the full brand-management nav surface; sees Home + Account only." **A naive `ari:0` flip VIOLATES this** by re-granting Ari to scanners. SPEC must either (a) accept Ari-for-scanners as an intentional carve-out (and amend the ORCH-1055 decision), or (b) make the gate non-monotonic (`rank>=30 OR rank===0`) — a SHAPE change to `visibleTabsForRank`.
- **Strict-grep gate `nav-tab-gate-declared`** + anchor `// orch-strict-grep-anchor MIN_RANK_FOR_TAB` (`navTabGate.ts:44`): any TABS/threshold edit must keep these passing.
- **I-PROPOSED-W (notifications prefix filter):** an ORCH-1111 invite notification MUST use a `business.%` type to pass `useBusinessNotifications`' `.or("type.like.stripe.%,type.like.business.%")`.
- **I-PROPOSED-I (rowcount-verified invite mutations):** any new decline/accept mutation should mirror the `.select("id")` rowcount-verify pattern at `brandInvitationsService.ts:191-202`.

---

## Discoveries for the orchestrator

1. **`invite-brand-member` never writes an in-app notification for the invitee** (email-only) — and couldn't, since the invitee has no account at invite time. ORCH-1111's in-app surfacing is therefore inherently a *first-login* detection problem, not an *at-invite* push.
2. **Ari tool executors are entirely un-rank-gated server-side** (`agentTools.ts` has no `MIN_RANK`/membership checks); they rely on ownership (`account_id`) + table RLS. Relevant to Q9 risk assessment and worth a separate note for any future Ari permission-hardening ORCH (not in scope here).
3. **No `declined` terminal state on `brand_invitations`** — distinct from friend/pair/tag-along request tables which DO have it. A decline feature is a constraint widen, not a reuse.

---

## Spec inputs

### (a) Files SPEC will need to touch — per ticket

**ORCH-1111 (surface pending invites in-app):**
- DB/RLS migration: NEW `brand_invitations` SELECT policy keyed on `lower(auth.jwt()->>'email') = email AND status='pending'` (OR an edge fn instead) — and, for decline, a CHECK-constraint widen to add `'declined'` + an invitee UPDATE policy (or edge fn).
- (If edge route) NEW edge fn e.g. `list-my-pending-invites` (service-role; JWT email → pending invites) and/or `decline-brand-invitation`.
- `mingla-business/src/services/brandInvitationsService.ts` — add `listMyPendingInvites()` + `declineBrandInvitation()` (the accept fn `acceptBrandInvitation` already exists for reuse).
- `mingla-business/src/hooks/useBrandInvitations.ts` (existing) — add a `useMyPendingInvites` query hook.
- `mingla-business/src/utils/businessTodos.ts` — add a `pendingInvites` input + emit an invite row (extend `BusinessTodoAction` with an open-invite-sheet kind).
- `mingla-business/src/hooks/useBusinessTodos.ts` — thread the new detection source in.
- `mingla-business/app/(tabs)/home.tsx` — wire the new action kind in `handleTodoAction`.
- NEW invite-accept/decline sheet component (native) reusing `acceptBrandInvitation`/`declineBrandInvitation`. **Note: the invitee needs the raw token** — resolve how the in-app accept obtains it (the emailed token, OR a tokenless accept-by-account-email edge path). This is an open design point for SPEC.
- `supabase/functions/accept-brand-invitation/index.ts` (and/or `invite-brand-member`) — optionally emit a `business.*` invite notification on first-login detection (pattern at `:304-376`).

**ORCH-1112 (make Ari reachable with no brand):**
- `mingla-business/src/utils/navTabGate.ts` — the ONLY required change: `MIN_RANK_FOR_TAB.ari` (value flip to 0, or shape change to a non-monotonic predicate per Q9). Keep the strict-grep anchor + gate green.
- `mingla-business/app/(tabs)/_layout.tsx` — only if the gate shape changes (the call site `visibleTabsForRank(TABS, rank)` may need a brandless-aware argument).
- (Optional) `mingla-business/src/components/ari/EmptyState.tsx` / `AriChatScreen.tsx` — a brandless first-run nudge ("Let's create your brand"). Pure UX; Ari capability already exists.
- Tests: `mingla-business/src/utils/__tests__/` nav-tab-gate + the `nav-tab-gate-declared` strict-grep gate.

### (b) Two open product questions for ORCH-1112 — evidence-based recommendation

**Q1 — Conversational vs merely reachable.** Should "create a brand with Ari" be a guided conversational onboarding, or is simply exposing the existing Ari tab (which already creates brands) sufficient?
- **Evidence:** Ari already has `create_brand` requiring only `userId` (`agentTools.ts:169-203`), an empty state advertising it (`EmptyState.tsx:31`), a seeded quick-reply chip (`AriChatScreen.tsx:337-341`), and a system prompt that routes brandless users to `create_brand` (`agentSystemPrompt.ts:57,84`). Zero capability gap.
- **Recommendation: REACHABLE is sufficient for v1** — flip the gate and ship; the conversational flow already works end-to-end. Add only a brandless-tuned empty-state nudge (one-line CTA seeding "Create a brand called …") as low-cost polish. A bespoke guided wizard is out of scope unless Seth wants Ari to become the *primary* brand-creation path (then it's its own ORCH). Rationale: do not gold-plate a capability that already exists.

**Q2 — Always-visible vs scoped (no-brand only).** Should Ari be visible to everyone (incl. rank-10 scanners) or only to no-brand (rank 0) users?
- **Evidence:** The gate is monotonic (`rank >= min`, `navTabGate.ts:69-71`); `ari:0` exposes Ari to scanners too, contradicting the ORCH-1055 decision that scanners see Home + Account only (`navTabGate.ts:8-16`). Ari's tools are ownership/RLS-gated, not rank-gated, so a scanner in Ari can only act on brands they own (low real risk), but it's a UX/scope regression of ORCH-1055.
- **Recommendation: SCOPED to no-brand (rank 0) — make the gate non-monotonic** (`rank >= 30 OR rank === 0` for `ari`). This satisfies the ORCH-1112 goal (brandless user reaches Ari) WITHOUT reopening the scanner surface ORCH-1055 closed. It requires a small gate-shape change in `navTabGate.ts` (an explicit per-tab predicate rather than a single threshold for `ari`) plus an amendment note on the ORCH-1055 decision recording the intentional rank-0 carve-out. If Seth prefers the simplest possible change and accepts Ari-for-scanners, the fallback is `ari:0` + an explicit ORCH-1055 decision amendment — but the scoped option is the right default because it preserves an existing shipped invariant.

### (c) Invariants / design decisions the Ari change would modify
- **ORCH-1055 nav-gate design decision** (`navTabGate.ts:8-30`): the no-brand carve-out OR a scanner-Ari exposure both *modify* this decision — SPEC must record the chosen amendment.
- **`MIN_RANK_FOR_TAB` shape contract** (single numeric threshold per tab, enforced by `nav-tab-gate-declared` strict-grep): the recommended scoped option changes `ari` from a scalar threshold to a predicate — the strict-grep gate + its anchor must be updated to keep passing without weakening the default-closed posture.
- **I-32** is NOT modified (rank values untouched).

---

## Recommended next phase

SPEC both tickets as one wave (`mingla-forensics` SPEC). ORCH-1112 is small and low-risk (gate-shape change + optional empty-state polish). ORCH-1111 is the larger build (RLS-or-edge detection + first-login surfacing + in-app accept/decline + token-acquisition design) and carries the two real open design points: (1) how the in-app invitee obtains a usable accept token given the one-way `token_hash`, and (2) RLS-policy vs service-role-edge for invitee read/decline. Resolve both in SPEC before IMPLEMENT.
