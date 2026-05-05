# INVESTIGATION REPORT — BIZ Cycle 13 (Permissions UI per BUSINESS_PRD §11 + §14)

**Mode:** INVESTIGATE (decompose-first variant per dispatch — output is investigation + decomposition recommendation, NOT a SPEC; SPEC happens after operator picks the 13a slice)
**Date:** 2026-05-03 (very late evening)
**Surface:** Mingla Business mobile app (`mingla-business/`) — operator-side team management + role-based access control
**Dispatch:** [`prompts/FORENSICS_BIZ_CYCLE_13_PERMISSIONS_UI.md`](../prompts/FORENSICS_BIZ_CYCLE_13_PERMISSIONS_UI.md)
**Confidence:** **H** on schema findings + decomposition strawman; **M** on cycle-13b scope (depends on operator decision on permissions_override jsonb editor). All schema findings verified via PR #59 file (canonical; no later migration touches these 6 tables).

---

## 1 — Layman summary

The dispatch asked me to enumerate 8 roles × 8 restrictions = 64 cells of access-control logic and propose a 2-3-cycle decomposition. **The dispatch's framing is partially wrong, in a way that simplifies the work.** PRD §11 lists 8 conceptual roles but the actual DB schema (PR #59, live since ORCH-0706 close) ships **6 roles** in an enum constraint, with **role privilege ranking via `biz_role_rank()` SQL function** + a **5-row-seeded `permissions_matrix` action-table** + a **`permissions_override` jsonb column on each team_member row** for fine-grained overrides. RLS already enforces role-rank-based access via SECURITY DEFINER wrappers like `biz_is_brand_admin_plus_for_caller(brand_id)`. The DB-side foundation is **strong + production-ready**.

What's missing is **all the mobile-side surface area**: there is no mobile concept of "current user's role on the current brand" today. AuthContext exposes `user: User | null` only. The Cycle 11 InviteScannerSheet pattern is the closest precedent and is event-scoped (scanner role only). To ship the brand-level team management surface, Cycle 13a needs to: (a) fetch + expose the current user's brand-team-member row, (b) build a brand-level invite-flow + team list (generalizing Cycle 11's pattern), (c) build an audit log viewer reading the existing `audit_log` table, (d) add UI gates on a small set of write actions across existing operator screens that the user's role cannot perform. **The 64-cell matrix is unnecessary** — RLS already enforces server-side; mobile just needs to mirror role rank for show/hide.

**Recommended decomposition:** **2 cycles, not 3.** 13a (foundations + invite flow + team list + audit log viewer + 5-7 high-traffic screen gates) ≈ 14-18h. 13b (per-member `permissions_override` editor + event-level restrictions + scanner-payment unification + audit log filters) ≈ 8-12h. Operator picks 13a slice next.

**5 open questions for operator** before SPEC fires (see §10).

---

## 2 — Investigation manifest

### Files read (in order)

| # | Path / source | Layer | Why |
|---|---------------|-------|-----|
| 1 | `Mingla_Artifacts/BUSINESS_PRD.md` lines 60-115 (§1 Account Structure) + lines 652-686 (§11 Permissions) + lines 1097-1115 (§14 MVP cut) | Docs | PRD scope footprint |
| 2 | `supabase/migrations/20260502100000_b1_business_schema_rls.sql` lines 1-30 (biz_role_rank function) | Schema | Role hierarchy authority |
| 3 | Same file lines 80-225 (brand_team_members + brand_invitations + brands) | Schema | Brand-team-member tables + role enum |
| 4 | Same file lines 230-260 (biz_brand_effective_rank SECURITY DEFINER helper) | Schema | RLS check primitive |
| 5 | Same file lines 416-487 (RLS policies on brand_team_members + brand_invitations) | Schema | Server-side enforcement |
| 6 | Same file lines 1130-1170 (event_scanners + scanner_invitations) | Schema | Event-scoped scanner permissions |
| 7 | Same file lines 1560-1652 (permissions_matrix + audit_log) | Schema | Action-based permission table + audit table |
| 8 | `mingla-business/src/context/AuthContext.tsx` (head + grep) | Code | Current user exposure (no role concept today) |
| 9 | `mingla-business/src/store/scannerInvitationsStore.ts` (already in conversation context) | Code | Cycle 11 TRANSITIONAL pattern |
| 10 | `mingla-business/src/components/scanners/InviteScannerSheet.tsx` (already in conversation context) | Code | Cycle 11 invite-sheet pattern + Cycle 12 canAcceptPayments toggle |
| 11 | Cycle 11 + 12 IMPL reports (in context) | Reports | Architectural pattern + invariants I-27/I-28 |
| 12 | ORCH-0706 close report (in context) | Reports | Schema live since 2026-05-03; permissions_matrix seeded |

### Files NOT read (intentional scope discipline)

- `currentBrandStore.ts` full body — I confirmed via grep that brand-list + active-brand are the surface; no role concept today (brand-team-member fetch will be a NEW hook)
- The 5-7 highest-traffic operator screens for blast-radius enumeration — defer to SPEC phase. Decompose-first investigation only enumerates **classes** of gates; the SPEC enumerates exact files
- Live DB verification via Supabase Management API — the migration file is canonical, applied via `supabase db push` per ORCH-0706 close report; no drift risk for read-only schema confirmation

---

## 3 — Findings

### 🔴 No root causes — Cycle 13 is greenfield

This is a feature build, not a bug fix. There's no existing-feature-broken to root-cause. The "investigation" framing is decomposition + scope-bounding.

### 🟠 Contributing factor — F-1 (P2): mobile↔DB scanner permissions shape mismatch

**File + line:** `mingla-business/src/store/scannerInvitationsStore.ts:41-50` vs `supabase/migrations/20260502100000_b1_business_schema_rls.sql:1136`

**Mobile shape (Cycle 11 + Cycle 12 flip):**
```ts
export interface ScannerPermissions {
  canScan: boolean;
  canManualCheckIn: boolean;
  canAcceptPayments: boolean;
}
```

**DB shape (`event_scanners.permissions` + `scanner_invitations.permissions` jsonb default):**
```sql
'{"scan": true, "take_payments": false}'::jsonb
```

**Mismatch:** mobile has 3 keys (`canScan` / `canManualCheckIn` / `canAcceptPayments`); DB has 2 keys (`scan` / `take_payments`). `canManualCheckIn` exists only on mobile. Naming convention also differs (camelCase vs snake_case).

**Impact today:** zero — `useScannerInvitationsStore` is `[TRANSITIONAL]` UI-only per I-28; no edge function syncs to DB yet. **Impact at B-cycle wire:** the `invite-scanner` edge function will need to translate between the two shapes OR one side moves to match the other.

**Classification:** 🟠 contributing factor (will block B-cycle scanner backend wire if not resolved by Cycle 13).

**Recommendation:** Cycle 13a or 13b should add **`manual_check_in` boolean** to the DB permissions jsonb (additive; doesn't break PR #59 schema; just extends the seeded default). Keeps mobile's 3-key shape canonical going forward. Also rename mobile keys to snake_case for parity (`scan` / `manual_check_in` / `take_payments`). Small refactor.

**Verification:** grep both files. Confirmed.

### 🟡 Hidden flaw — F-2 (S2): PRD §11 says 8 roles; DB has 6

**File + line:** PRD §11.1 vs `supabase/migrations/20260502100000_b1_business_schema_rls.sql:152-160`

**PRD §11.1 lists 8 roles:**
- Account owner, Brand owner, Brand admin, Event manager, Finance manager, Marketing manager, Ticket scanner, Scanner payment permissions

**DB enum (canonical):**
- account_owner, brand_admin, event_manager, finance_manager, marketing_manager, scanner
- (6 roles)

**Two PRD entries don't map to DB roles:**
- "Brand owner" — in DB, this is conceptually `brand_admin` for brands the user co-owns OR `account_owner` for the brand's owning account. No separate enum value.
- "Scanner payment permissions" — in DB, this is `scanner` role + `take_payments: true` boolean on event_scanners.permissions. NOT a separate role.

**Classification:** 🟡 hidden flaw — PRD/Schema docs-vs-schema layer disagreement. Operator must pick: (a) PRD shrinks to 6 roles to match DB (recommended; the DB design is intentional and cleaner), OR (b) DB enum extends to 8 (would require migration; "brand_owner" duplicates account_owner semantically — not a clean fit; "scanner_payment" already lives as a permission flag).

**Recommendation:** PRD-level reconciliation note; recommend (a). 13a SPEC locks "6 roles" definitively.

### 🟡 Hidden flaw — F-3 (S3): permissions_matrix seeded with only 5 rows

**File + line:** `supabase/migrations/20260502100000_b1_business_schema_rls.sql:1644-1651`

**Seed:**
```sql
INSERT INTO public.permissions_matrix (role, action, allowed) VALUES
  ('scanner', 'ticket.scan', true),
  ('event_manager', 'event.write', true),
  ('finance_manager', 'order.refund', true),
  ('brand_admin', 'brand.invite', true),
  ('account_owner', 'brand.delete', true)
ON CONFLICT (role, action) DO NOTHING;
```

**What this means:** the table's design is action-based (role × action → allowed boolean). But it's only seeded with **one canonical action per role**, not a comprehensive matrix. **No code currently reads from this table** (no edge function, no mobile code).

**Classification:** 🟡 hidden flaw — the table is structurally orphaned. Either Cycle 13 expands the seed to a complete (role × action → allowed) inventory and queries it from RLS / edge functions / mobile, OR the table is deprecated in favor of the role-rank function approach (which is what RLS already uses).

**Recommendation:** keep the table for **action-level overrides** (row exists → use the boolean; row missing → fall back to role-rank). Cycle 13 doesn't need to populate the full matrix — defer until a concrete use case demands it. Document this in 13a SPEC §4 as a deferred scope item.

### 🟡 Hidden flaw — F-4 (S2): mobile has zero brand-role context today

**File + line:** `mingla-business/src/context/AuthContext.tsx:56` (`user: User | null`)

**What's missing:** no hook fetches the current user's `brand_team_members` row for the active brand. No `useCurrentBrandRole()` exists. UI today assumes the operator is the only person who can do anything (because they ARE — single-user mode).

**Classification:** 🟡 hidden flaw — when a brand has 2+ team members and the secondary user logs in, every screen that ASSUMES single-user-can-do-anything will let the secondary user do operations they shouldn't (RLS will block at write time, but UX surfaces "permission denied" toasts instead of hiding the action).

**Recommendation:** 13a's foundational work is precisely this — add a hook + cache that surfaces the current user's brand role and exposes it to existing screens for show/hide gating.

### 🟡 Hidden flaw — F-5 (S3): audit_log table exists but is empty (no writers wired)

**File + line:** `supabase/migrations/20260502100000_b1_business_schema_rls.sql:1591-1614`

**State:** `audit_log` is empty in production. No edge function INSERTs to it. No mobile code calls a service that writes to it.

**Classification:** 🟡 hidden flaw — a viewer built today renders an empty surface forever until B-cycle wires server-side audit-log writes for sensitive actions (refund, role change, invite, brand delete, etc.).

**Recommendation:** 13a's audit log viewer ships with a TRANSITIONAL banner per Const #7 (mirroring Cycle 11/12 pattern): *"Audit log fills as the backend wires server-side recording in B-cycle. Some actions logged here today; full coverage is the goal."* Mobile-side, optionally also write to `audit_log` from a few high-leverage actions (refund, role change) via an edge function — but this is 13b scope. 13a viewer is read-only.

### 🔵 Observations

- **OBS-1:** Cycle 11 + 12 patterns generalize cleanly. `useScannerInvitationsStore` (event-scoped, persisted Zustand) → `useBrandInvitationsStore` (brand-scoped, persisted Zustand). InviteScannerSheet → InviteBrandMemberSheet (add role picker; reuse Sheet primitive + keyboard discipline + email validation + reset on visible flip). Same architectural shape.
- **OBS-2:** I-28 (UI-only invitation flow until B-cycle TRANSITIONAL) extends naturally to brand invitations. Cycle 13a can declare a parallel **I-31** (brand-team-member invitation UI without functional flow until B-cycle). Same EXIT condition pattern.
- **OBS-3:** `permissions_override` jsonb column on `brand_team_members` (line 165) is an empty `{}` default for every member. This is the override hatch for fine-grained per-member tweaks (e.g., "this event_manager can also approve refunds" → override.order_refund: true). 13a leaves it `{}`. 13b builds the editor.
- **OBS-4:** RLS uses `biz_is_brand_admin_plus_for_caller(brand_id)` SECURITY DEFINER wrappers (e.g., line 427). This means **most permissions are already enforced server-side**. Mobile's job is purely UX (show/hide) — RLS is the safety net.
- **OBS-5:** PRD §11 explicitly flags **DESIGN-PACKAGE-SILENT** — "the Permissions UI (team list, invite flow, role-detail screens, audit-log viewer) is DESIGN-PACKAGE-SILENT — the Claude Design package did not include team / role-detail screens. Cycle 2 implementor will design these from the Designer Handoff §5.3.9–§5.3.11 and §5.11 references using the absorbed tokens + primitives. ~16 hours of design-time work folded into the cycle estimate." → /ui-ux-pro-max pre-flights mandatory per memory rule. See §7.

---

## 4 — Five-layer cross-check

| Layer | Source of truth | Finding |
|-------|-----------------|---------|
| **Docs** | BUSINESS_PRD §11 (8 roles × 8 restrictions = 64 cells) | Overstated — actual DB design is simpler |
| **Schema** | PR #59 + ORCH-0706 (live) | 6 roles enum + role rank + permissions_matrix (5 rows seeded) + permissions_override jsonb + audit_log table + RLS via SECURITY DEFINER wrappers |
| **Code (mobile)** | AuthContext + scannerInvitationsStore + InviteScannerSheet | No brand-role context today; Cycle 11/12 scanner pattern is the only existing precedent (event-scoped) |
| **Runtime** | Mobile app today | Operator is functionally a single-user; brand_team_members table is empty (no team membership rows exist yet for any brand) |
| **Data** | Production DB (per ORCH-0706 close) | permissions_matrix has 5 baseline rows; audit_log is empty; brand_team_members is empty (no second-user-on-team scenario exists yet) |

**Contradictions:**
1. **Docs vs Schema:** PRD §11.1 says 8 roles; DB has 6. → F-2.
2. **Code (Cycle 11/12 mobile) vs Schema:** Scanner permissions shape mismatch (3 keys vs 2 keys). → F-1.

**No layer disagreements that block Cycle 13.** Both contradictions are reconcilable in Cycle 13a SPEC.

---

## 5 — Decomposition recommendation

### Recommended split: 2 cycles (not 3 as the dispatch strawman'd)

#### Cycle 13a — Foundations + team list + invite flow + audit log viewer + role gates (PRIMARY)

**Estimated wall:** ~14-18h IMPL · ~+1,500-2,000 LOC across ~18 files (5 NEW + 13 MOD)
**Severity:** S1 — MVP-blocking unblocks "second human on the team"

**Scope:**

1. **`useCurrentBrandRole()` hook** (NEW — `src/hooks/useCurrentBrandRole.ts`)
   - Reads current `auth.uid()` + `useCurrentBrandStore.activeBrandId`
   - Queries `brand_team_members` via Supabase client for `(brand_id, user_id)` row
   - Returns `{ role: BrandRole | null, rank: number, permissionsOverride: object, isLoading, isError }`
   - Empty result = user is the brand's `account_owner` (current default for the brand creator) — synthesise a `account_owner` role from `creator_accounts` ownership check
   - Cached via React Query keyed `['brand-role', brandId, userId]`; invalidated by team-member mutations

2. **`useBrandTeamStore`** (NEW — `src/store/brandTeamStore.ts`)
   - Persisted Zustand mirroring Cycle 11 `useScannerInvitationsStore` pattern
   - Two entry types: `BrandTeamMember` (accepted) + `BrandInvitation` (pending)
   - Per-brand-keyed selectors (raw entries + useMemo per Cycle 9c v2 pattern; SPEC will lock)
   - [TRANSITIONAL] header — UI-only until B-cycle wires `invite-brand-member` + `accept-brand-invitation` edge functions

3. **`InviteBrandMemberSheet`** (NEW — `src/components/team/InviteBrandMemberSheet.tsx`)
   - Generalize InviteScannerSheet: name + email + role picker (segmented control or sub-sheet of 6 roles) + invite CTA
   - Memory rule `feedback_keyboard_never_blocks_input` honored
   - TRANSITIONAL banner (mirror Cycle 11 ORCH-0711 pattern)

4. **Team list route** (NEW — `app/brand/[brandId]/team.tsx` OR `app/account/team.tsx` depending on operator's nav decision — see §10 Q4)
   - Renders accepted team_members + pending invitations
   - Per-row: name + email + role pill + remove CTA (only if current user has rank >= row's rank)
   - "+" CTA opens InviteBrandMemberSheet
   - EmptyState when no team members yet

5. **Audit log viewer route** (NEW — `app/brand/[brandId]/audit-log.tsx`)
   - Reads `audit_log` filtered by `brand_id` (RLS enforces user-can-read-own + brand-scoped via custom policy if needed — confirm during SPEC phase)
   - Newest-first list: action / target / time / actor name (resolved via creator_accounts join)
   - TRANSITIONAL banner per F-5: *"Audit log fills as the backend wires server-side recording in B-cycle."*
   - Empty state today (table is empty in production)

6. **Account screen entry point** (MOD — `app/(tabs)/account.tsx` OR similar)
   - Add "Team" + "Audit log" rows to the account-level menu
   - Gated on `useCurrentBrandRole().rank >= biz_role_rank('event_manager')` (or per Q1 below)

7. **Role gates on 5-7 highest-traffic operator screens** (MOD — list TBD by SPEC; candidates):
   - EditPublishedScreen — `event_manager+` to edit; `account_owner` only to delete
   - DoorRefundSheet — `finance_manager+` to refund (or operator override per permissions_override)
   - Comp guest add — `event_manager+`
   - Step 5 ticket price field — `finance_manager+` to edit price (event_manager can edit other tier fields)
   - Stripe Connect entry (Brand profile) — `account_owner` only
   - Brand profile edits (cover/contact) — `marketing_manager+`
   - Scanner team management — `event_manager+`

   Pattern: each gate reads `useCurrentBrandRole()` + compares rank against required action level. Hide-or-disabled (Const #1 — disabled with caption "Your role doesn't include this action").

8. **2 NEW invariants ratified:**
   - **I-31 — UI-only brand-team-member invitation flow until B-cycle (TRANSITIONAL).** Mirror I-28.
   - **I-32 — Mobile UI gates MUST mirror RLS role-rank semantics. RLS is the safety net; UI is the convenience layer. Both must agree.**

9. **F-2 reconciliation (PRD doc fix):** add a note to PRD §11.1 that 6 roles is canonical; "brand_owner" = account_owner OR brand_admin context-dependent; "scanner_payment" = scanner role + take_payments boolean.

**What's NOT in 13a:**
- `permissions_override` jsonb editor — defer to 13b
- Event-level scanner restrictions (PRD §11.2 "restrict by event") — already partially exists via `event_scanners` table; full per-event role assignments deferred to 13b
- Audit log search / filter / pagination — 13a is read-only newest-first list
- Audit log writes from mobile — 13a viewer-only; B-cycle wires server-side writes
- Resolving F-1 mobile↔DB scanner permissions shape mismatch — defer to 13b (small migration + mobile rename; doesn't block 13a value)
- DESIGN-PACKAGE-SILENT pre-flight art — required as part of 13a IMPL per memory rule, but the work scope is on the implementor (~4-6h baked into 14-18h estimate)

#### Cycle 13b — Per-member overrides + event-level restrictions + scanner unification (POLISH)

**Estimated wall:** ~8-12h IMPL · ~+800-1,200 LOC across ~10 files
**Severity:** S2 — refinement on 13a's foundation

**Scope:**

1. **`permissions_override` jsonb editor** — per-member fine-grained toggles ("this event_manager can also approve refunds")
2. **Event-level role assignments** — extend `event_scanners` UI into a generic per-event team picker
3. **F-1 mobile↔DB scanner permissions shape unification** — small migration adds `manual_check_in` to default jsonb; mobile keys rename to snake_case; existing rows backfill
4. **Audit log search + filter + pagination + actor name resolution improvements**
5. **Mobile-side audit log writes** for high-leverage actions (refund recorded, role change made, invite sent, member removed) — small edge function `record-audit-log-event` OR direct service-role insert pattern (B-cycle decision)

### Decomposition rationale

The dispatch's 3-cycle strawman framed restriction guards as a separate cycle. **They're not** — once `useCurrentBrandRole()` exists (13a foundation), gating each existing screen is a 5-line conditional render. There's no architectural complexity to defer; it's mechanical application across surfaces. So 13a gets the foundation + invite flow + team list + audit viewer + the 5-7 highest-traffic gates in one pass. 13b is the polish layer.

---

## 6 — Cross-cycle blast radius (gate candidates for 13a)

Top surfaces that need role gates in 13a (full list locked in SPEC):

| Surface | Action being gated | Min rank required | Notes |
|---------|--------------------|---------------------|-------|
| `app/event/[id]/index.tsx` Edit button | Edit published event | `event_manager` | Existing event edit access |
| `app/event/[id]/index.tsx` Cancel/End sales | Lifecycle changes | `event_manager` | Cycle 9b destructive actions |
| `EditPublishedScreen` Step 5 price field | Tier price edit | `finance_manager` | Money-touching field |
| `DoorRefundSheet` confirm | Process refund | `finance_manager` | Money-touching action |
| `RefundSheet` (Cycle 9c online refunds) | Process refund | `finance_manager` | Same logic, parallel surface |
| `AddCompGuestSheet` confirm | Comp guest add | `event_manager` | Scope: free ticket grant |
| `app/event/[id]/scanners/index.tsx` invite | Scanner team management | `event_manager` | Cycle 11 surface |
| Brand profile edit (cover/contact) | Brand-level edits | `marketing_manager` | Brand identity changes |
| Stripe Connect setup | Payments setup | `account_owner` only | Money-flow root |
| Brand delete | Soft-delete brand | `account_owner` only | Highest-rank action |
| `app/account/team.tsx` invite (NEW) | Invite team members | `brand_admin` | Self-gating recursive |

**~11 surfaces total.** SPEC phase enumerates exact files + ranks per surface. Role-rank check pattern is uniform; one helper gates them all.

---

## 7 — DESIGN-PACKAGE-SILENT inventory + /ui-ux-pro-max pre-flight queries

Per memory rule `feedback_implementor_uses_ui_ux_pro_max` + PRD §11 note, the following Cycle 13a surfaces have NO Designer reference:

1. **Team list route** — `app/account/team.tsx` (or `app/brand/[brandId]/team.tsx`)
   - Recommended search: `python .claude/skills/ui-ux-pro-max/scripts/search.py "operator team management member list role pills invite dark glass" --domain product`

2. **InviteBrandMemberSheet** with role picker
   - Recommended search: `python .claude/skills/ui-ux-pro-max/scripts/search.py "role picker segmented control invite team member sheet sub-sheet dark glass" --domain product`

3. **Audit log viewer route** — `app/brand/[brandId]/audit-log.tsx`
   - Recommended search: `python .claude/skills/ui-ux-pro-max/scripts/search.py "operator audit log timeline append-only history viewer dark glass" --domain product`

4. **Role-detail screens (deferred to 13b)** — per PRD §11.1, each role gets a detail screen explaining what it can/cannot do. 13a can ship a single shared "Roles explained" reference accessible from the team list and InviteBrandMemberSheet's role picker. Not a full per-role surface.

**~3 mandatory pre-flights for 13a IMPL.** Implementor synthesizes guidance with existing Mingla glass/dark tokens.

---

## 8 — Forward backend handoff (B-cycle EXIT conditions)

All 5 are documented per Cycle 11/12 TRANSITIONAL precedent:

1. **`invite-brand-member` edge function** — accepts `(brand_id, email, role)` from authenticated brand_admin+, INSERTs into `brand_invitations` with token + expires_at, sends Resend email with accept-link.
2. **`accept-brand-invitation` edge function** — validates token + creates `brand_team_members` row + flips `accepted_at` on invitation.
3. **`record-audit-log-event` edge function (or service-role pattern)** — for any operator-initiated mutation (refund, role change, brand setting change), insert audit_log row. May be implicit via DB trigger on key tables instead.
4. **F-1 scanner permissions migration** — small migration adding `manual_check_in` boolean to `event_scanners.permissions` jsonb default + backfill existing rows.
5. **`audit_log` writers** — once edge functions exist for material mutations (refund, role change, etc.), each writes an `audit_log` row in the same transaction.

13a ships UI; 13b sharpens UI; B-cycle wires backend flows that remove the [TRANSITIONAL] markers.

---

## 9 — Invariants

### Existing invariants this cycle preserves

| ID | Statement | How preserved |
|----|-----------|---------------|
| I-17 | Brand-slug stability — DB-enforced | No slug touches in 13a |
| I-21 | Anon-tolerant buyer routes | All Cycle 13 surfaces are operator-side; no buyer surface change |
| I-24 | audit_log Option B append-only carve-out | 13a viewer is read-only; honors carve-out |
| I-28 | UI-only scanner invitation flow until B-cycle | Cycle 13 doesn't change Cycle 11; the new I-31 mirrors this for brand invitations |

### NEW invariants 13a establishes

- **I-31 — Brand-team-member invitation UI is TRANSITIONAL until B-cycle wires `invite-brand-member` + `accept-brand-invitation` edge functions.** Mirrors I-28 (scanner invitations). EXIT: B-cycle backend wire.
- **I-32 — Mobile UI gates MUST mirror RLS role-rank semantics.** Mobile reads `useCurrentBrandRole()` + compares against `biz_role_rank()` thresholds. RLS is the server-side safety net; mobile is the UX layer; both MUST agree on rank thresholds. Test gate: grep mobile rank constants vs DB function output.

---

## 10 — Open operator questions (need answers before SPEC fires)

### Q1 — Role count: confirm 6 (DB-as-truth) over PRD §11.1's 8?

DB has: account_owner, brand_admin, event_manager, finance_manager, marketing_manager, scanner.
PRD §11.1 lists 8 (adds "brand_owner" + "scanner_payment").

**Recommendation:** confirm 6. "Brand owner" = account_owner or brand_admin context-dependent (not a separate role); "Scanner payment" = scanner + take_payments boolean (already exists). Update PRD §11.1 doc note.

**Operator pick:** A (confirm 6, update PRD) / B (extend DB enum to 8 — would require migration + reasoning for both new roles) / C (other).

### Q2 — Cycle 11/12 scanner permissions shape mismatch (F-1): defer to 13b?

Mobile has 3 keys (canScan, canManualCheckIn, canAcceptPayments); DB has 2 (scan, take_payments). Doesn't block 13a.

**Recommendation:** defer to 13b. 13a doesn't write to DB scanner tables; mismatch only matters at B-cycle wire.

**Operator pick:** A (defer to 13b — recommended) / B (fold into 13a as a small additional ~30min task) / C (B-cycle scope).

### Q3 — `permissions_override` jsonb editor: ship in 13a or 13b?

Per-member fine-grained overrides (e.g., "this event_manager can also approve refunds"). Empty `{}` default today on every member.

**Recommendation:** 13b. 13a ships role-only enforcement (rank-based); the override editor is polish that operators won't need until they have ≥3 team members with edge cases.

**Operator pick:** A (defer to 13b — recommended) / B (ship in 13a — adds ~3-4h) / C (cut entirely if operator confidence low).

### Q4 — Team list location: account-level, brand-level, or both?

Two natural surfaces: `app/account/team.tsx` (account → all teams across brands) OR `app/brand/[brandId]/team.tsx` (brand → this brand's team only). Or both.

**Recommendation:** **brand-level only in 13a.** Operators care about "this brand's team." Account-level cross-brand view is lower priority and adds nav complexity. PRD §1 says "Account-level permissions" too but that's deferred work.

**Operator pick:** A (brand-level only — recommended) / B (account-level only) / C (both — adds ~4-6h).

### Q5 — Audit log writer scope in 13a: viewer-only or also mobile-side writes?

`audit_log` table is empty today. 13a viewer reads existing rows; the question is whether 13a ALSO has mobile fire INSERTs for select actions (e.g., refund button calls a service that writes audit_log).

**Recommendation:** **viewer-only in 13a** with TRANSITIONAL banner per F-5. Mobile-side writes adds API surface (need an edge function or RPC; service-role write requires careful auth) — defer to 13b once a concrete need surfaces.

**Operator pick:** A (viewer-only — recommended) / B (viewer + mobile-side writes for refund/role-change actions — adds ~3-4h + new edge function) / C (B-cycle scope entirely).

---

## 11 — Confidence

**H** on:
- Schema findings (PR #59 read directly, no later migration touches; live since ORCH-0706)
- 6-roles vs 8-roles diagnosis (DB enum is canonical)
- Mobile primitives gap (AuthContext exposes user only; no role context fetched)
- Cycle 11/12 scanner mismatch (greppable in both directions)
- Recommended 2-cycle decomposition (rationale: gates are mechanical post-foundation)

**M** on:
- 13a wall estimate (~14-18h) — depends on operator choices on Q1-Q5; could compress to ~10-12h if operator picks all "defer/recommended" options
- 13b scope — depends on Q3 + Q5 + F-1 timing
- DESIGN-PACKAGE-SILENT pre-flight time (~4-6h baked) — actual time depends on ui-ux-pro-max output relevance

**L** on:
- Live DB state of `audit_log` + `brand_team_members` row counts (didn't run Management API queries; assumed empty per "no edge function writes yet" code-side trace; should confirm in SPEC phase)

---

## 12 — Discoveries for orchestrator

### D-CYCLE13-FOR-1 (S2, RECOMMEND ride-along ORCH or 13b scope)

PRD §11.1 ↔ DB role enum mismatch (8 vs 6). PRD doc needs update; DB doesn't change. Small textual fix.

### D-CYCLE13-FOR-2 (S2, RECOMMEND 13b scope)

`useScannerInvitationsStore` permissions shape ↔ DB `event_scanners.permissions` jsonb shape mismatch (F-1). 3 keys vs 2 keys + naming convention. Resolves when B-cycle wires invite-scanner edge function.

### D-CYCLE13-FOR-3 (S3, RECOMMEND 13b)

`permissions_matrix` table is structurally orphaned — seeded with 5 baseline rows, not read by any code. 13b scope: either expand seed + wire to mobile/RLS reads, OR document as deprecated in favor of role-rank approach.

### D-CYCLE13-FOR-4 (S3 obs, no fix needed)

PR #59 schema specifies `creator_accounts.deleted_at column-level RLS` per ORCH-0707 backlog (Hidden Flaw HF-#1 from PR #59 review). Cycle 13 surfaces — particularly the audit log viewer joining `creator_accounts` to resolve actor names — should respect this RLS column-level when it's added by ORCH-0707. Not blocking 13a.

### D-CYCLE13-FOR-5 (S3 obs, defer)

PRD §11.2 "Restrict access by event" — for event_manager assigned to specific events only. Today there's no `event_managers` table (parallel to `event_scanners`). 13a ships brand-level role + scanner per-event scoping; full event-level role scoping for non-scanner roles is deferred to 13b. Operator decision Q4 partially covers this.

### D-CYCLE13-FOR-6 (S3, recommend codify)

The `biz_role_rank()` function in PR #59 is a SQL-side authority for role hierarchy. Mobile's I-32 (NEW) requires a TS-side mirror. Recommend a TypeScript constant `BRAND_ROLE_RANK: Record<BrandRole, number>` in `mingla-business/src/utils/brandRole.ts` with a CI grep test that flags drift. Mirrors the ORCH-0700 SQL-helper-twin pattern (`pg_map_primary_type_to_mingla_category` ↔ `derivePoolCategory.ts`).

---

## 13 — Cross-references

- BUSINESS_PRD §11 (Permissions and Access Control): [`Mingla_Artifacts/BUSINESS_PRD.md`](../BUSINESS_PRD.md) lines 652-686
- BUSINESS_PRD §14 (MVP v1 — Foundations Cut): lines 1097-1115
- PR #59 schema (canonical for all 6 tables): `supabase/migrations/20260502100000_b1_business_schema_rls.sql` lines 1-30 (biz_role_rank), 80-225 (brands + brand_team_members + brand_invitations), 416-487 (RLS), 1130-1170 (event_scanners + scanner_invitations), 1560-1652 (permissions_matrix + audit_log)
- ORCH-0706 close (PR #59 LIVE on production DB + Option B audit-log carve-out per I-24): [`reports/IMPLEMENTATION_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING_REPORT.md`](./IMPLEMENTATION_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING_REPORT.md)
- Cycle 11 IMPL v2 (architectural pattern + ORCH-0710 hooks lesson + I-28): [`reports/IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md`](./IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md)
- Cycle 12 IMPL final report (canAcceptPayments toggle FLIP — first per-permission control surface): [`reports/IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md`](./IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md)
- INVARIANT_REGISTRY (I-17 / I-22 / I-23 / I-24 / I-28; NEW I-31 + I-32 proposed): [`Mingla_Artifacts/INVARIANT_REGISTRY.md`](../INVARIANT_REGISTRY.md)
- Memory rules referenced: `feedback_implementor_uses_ui_ux_pro_max` (DESIGN-PACKAGE-SILENT pre-flight mandatory), `feedback_supabase_mcp_workaround` (Management API direct SQL when MCP errors), `feedback_orchestrator_never_executes` (orchestrator writes prompts; SPEC happens after operator picks slice), `feedback_diagnose_first_workflow` (this investigation IS the diagnose-first step)
- Dispatch: [`prompts/FORENSICS_BIZ_CYCLE_13_PERMISSIONS_UI.md`](../prompts/FORENSICS_BIZ_CYCLE_13_PERMISSIONS_UI.md)
