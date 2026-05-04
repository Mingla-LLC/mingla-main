# INVESTIGATION — BIZ Cycle 13b (Permissions UI Depth)

**Mode:** INVESTIGATE (forensics-only; SPEC dispatch follows after operator-locked decisions)
**Confidence:** H overall · per-thread H/H/H/H/H (live-DB query for Thread 4 row count UNVERIFIED — see §thread 4 §note)
**Dispatch:** [`prompts/FORENSICS_BIZ_CYCLE_13B_PERMISSIONS_DEPTH.md`](../prompts/FORENSICS_BIZ_CYCLE_13B_PERMISSIONS_DEPTH.md)
**Date:** 2026-05-04

---

## 1 — Plain-English summary

Five distinct architectural threads fell out of Cycle 13a as deferred backlog. Forensics scoped each independently:

- **Thread 1 (F-1 scanner shape):** mobile and DB disagree on shape. Mobile has 3 keys (`canScan`/`canManualCheckIn`/`canAcceptPayments`); DB has 2 (`scan`/`take_payments`). The MOBILE-ONLY key (`canManualCheckIn`) is purely decorative — it gates NOTHING in scan logic, only renders a pill on the team list. **Recommend Path A** (align mobile to DB) — drop the `canManualCheckIn` UI affordance entirely; it's a Cycle 11 design wart that never connected to anything. ~3 files, ~15 references touched.
- **Thread 2 (`permissions_override` editor):** the jsonb column is read by `useCurrentBrandRole` but no consumer interprets it. **Greenfield design** — define the shape now without legacy compat. **Recommend deny-list shape**: `{ "DENIED": ["ACTION_KEY", ...] }` referencing existing `MIN_RANK` action constants. Editor lives as expansion in MemberDetailSheet.
- **Thread 3 (per-event roles):** today only scanners have per-event scoping (`event_scanners`). Other roles are brand-level. **Recommend deferring further** — no operator use case validated yet; risks over-engineering. Lock the decision to "brand-level only until operator surfaces a real ask." Schema option C (jsonb event_scope) preserves optionality if later needed.
- **Thread 4 (`permissions_matrix` strategy):** table is seeded with only 5 sentinel rows; mobile NEVER reads it; backend RLS uses `biz_role_rank` directly, not the matrix. **Recommend Path B** (deprecate). Drop the table OR mark TRANSITIONAL → unused. Saves the runtime drift surface that Thread 1 illustrates.
- **Thread 5 (audit_log brand-admin RLS):** the `biz_is_brand_admin_plus_for_caller` helper EXISTS at line 327 of PR #59. The new RLS policy is a 4-line ADDITION, not a replacement. **Recommend ship as a tiny migration** — independent of all other threads.

**Cross-thread coupling:** Threads 1 + 4 are interlinked (deprecating matrix removes one rationale for changing scanner shape; Path A on Thread 1 + Path B on Thread 4 = clean simplification cycle). Threads 2 + 3 are coupled (override jsonb shape may want to encode event scope). Thread 5 is fully independent.

**Recommended decomposition:** **single 13b cycle** ships Threads 1 + 4 + 5 (the "subtract scaffolding" trio — clean low-risk wins). **Defer Threads 2 + 3 to 13c or beyond** until operator validates a real use case. ~6-9h total IMPL wall for 13b.

---

## 2 — Investigation manifest

| # | File / source | Layer | What I expected to find |
|---|---------------|-------|-------------------------|
| 1 | `Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_13B_PERMISSIONS_DEPTH.md` | Dispatch | Thread scope + non-goals |
| 2 | `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS_REPORT.md` | Prior cycle | Foundations shape + new invariants |
| 3 | `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_13_PERMISSIONS_UI.md` | Prior cycle | Decisions locked + 6 D-CYCLE13-FOR discoveries |
| 4 | `supabase/migrations/20260502100000_b1_business_schema_rls.sql` lines 11-30 | Schema | biz_role_rank function definition |
| 5 | Same file lines 146-180 | Schema | brand_team_members + permissions_override jsonb |
| 6 | Same file lines 327-345 | Schema | biz_is_brand_admin_plus_for_caller + biz_is_event_manager_plus_for_caller helpers |
| 7 | Same file lines 1130-1170 | Schema | scanner_invitations + event_scanners (DB scanner permissions shape) |
| 8 | Same file lines 1560-1652 | Schema | permissions_matrix + audit_log + RLS policies + seed rows |
| 9 | `mingla-business/src/store/scannerInvitationsStore.ts` lines 44-57 | Code | Mobile ScannerPermissions 3-key shape |
| 10 | `mingla-business/src/components/scanners/InviteScannerSheet.tsx` | Code | Toggle UI for canManualCheckIn + canAcceptPayments |
| 11 | `mingla-business/app/event/[id]/scanners/index.tsx` lines 334 + 419 | Code | 2 read sites for `permissions.canManualCheckIn` (pill rendering only) |
| 12 | `mingla-business/src/hooks/useCurrentBrandRole.ts` lines 103-114 | Code | permissions_override SELECT + return path |
| 13 | Grep `canManualCheckIn` across `mingla-business/` | Code | Verify NO consumer outside 3 files identified |
| 14 | Grep `permissionsOverride` across `mingla-business/` | Code | Verify NO consumer beyond useCurrentBrandRole |
| 15 | Grep `permissions_matrix` across `mingla-business/` | Code | Verify mobile does NOT read the matrix table |

All 15 sources read in full. No sub-agent delegations.

---

## 3 — Thread 1: F-1 scanner permissions shape mismatch

### 3.1 Current state (5-truth-layer)

| Layer | Finding |
|-------|---------|
| **Docs** | Cycle 11 SPEC §4.10 + Cycle 12 Decision #4 codify the 3-key mobile shape. PR #59 author seeded the 2-key DB shape ahead of mobile. |
| **Schema** | `event_scanners.permissions jsonb DEFAULT '{"scan": true, "take_payments": false}'::jsonb` (line 1155). `scanner_invitations.permissions` same default (line 1136). 2 keys, snake_case. |
| **Code** | `mingla-business/src/store/scannerInvitationsStore.ts:48-57` defines `ScannerPermissions = { canScan: boolean, canManualCheckIn: boolean, canAcceptPayments: boolean }`. 3 keys, camelCase. |
| **Runtime** | NO scan-time consumer of `canManualCheckIn`. Verified by grep: `permissions.canManualCheckIn` appears at exactly 2 sites — both in `app/event/[id]/scanners/index.tsx` (lines 334 + 419), and both render a `<Pill>CAN MANUAL CHECK-IN</Pill>` informational badge. NO conditional gates a manual-check-in CTA on this flag. |
| **Data** | Production `event_scanners` + `scanner_invitations` tables both empty per ORCH-0706 close (B-cycle hasn't shipped writers). Mobile `useScannerInvitationsStore.entries` may have local pending entries with the 3-key shape. |

### 3.2 Architectural options

**Path A — Align mobile to DB (drop `canManualCheckIn` entirely):**
- `ScannerPermissions = { canScan: boolean, canAcceptPayments: boolean }` (2 keys camelCase, semantics-preserved)
- TS service layer translates camelCase ↔ snake_case at the boundary (mirror Cycle 9c orderStore pattern)
- DELETE the InviteScannerSheet `canManualCheckIn` toggle (~30 LOC)
- DELETE the 2 pill-rendering sites in scanners/index.tsx (~10 LOC)
- Existing `useScannerInvitationsStore.entries` cache loses the field on next persist version bump (v1 → v2 strip migration, mirror Cycle 13a v11→v12)
- **Cost:** ~5 file edits, ~50 LOC net subtract, persist version bump. **Gain:** Const #2 honored (one shape, two case conventions); decorative-only feature retired.

**Path B — Align DB to mobile (add `manual_check_in` boolean to DB default):**
- Migration adds `'{"scan": true, "manual_check_in": false, "take_payments": false}'::jsonb` default
- Backfill existing rows (zero today; trivial)
- Rename mobile `canManualCheckIn → canManualCheckIn` (no rename, just keep)
- Mobile still translates camelCase ↔ snake_case at service boundary
- Implementor wires a real consumer for `manual_check_in` (mobile-side gate on the manual-check-in CTA in scanner detail view)
- **Cost:** 1 migration, ~3 file edits, NEW logic for manual_check_in gating. **Gain:** the flag becomes meaningful instead of decorative.

**Path C — Keep both shapes; service-layer translator:**
- Mobile keeps 3-key shape; DB keeps 2-key shape; never expand `canManualCheckIn` to DB
- Service layer at the read/write boundary translates: DB `{scan, take_payments}` → mobile `{canScan, canManualCheckIn: false, canAcceptPayments}` and back
- B-cycle edge functions ignore the mobile-only key
- **Cost:** ~30 LOC translator + tests. **Gain:** zero churn to existing UI/code. **Loss:** ongoing maintenance cost (every B-cycle dev must remember the shape mismatch).

### 3.3 Recommendation: **Path A (H confidence)**

`canManualCheckIn` is dead weight. Forensics confirms it gates nothing in scan logic — the actual manual-check-in CTA in J-G2 (`app/event/[id]/guests/[guestId].tsx`) does NOT check this flag. It's a Cycle 11 design wart that the operator-toggle UI promised but no consumer ever implemented. Subtracting it is Const #8 cleanup — and removes the longest-pole reason to argue about scanner shape forever after.

If the operator later decides manual-check-in needs per-scanner gating, Path B becomes a small extension on top of the cleaner Path A foundation (add ONE key to the DB default + the consuming code) rather than fighting drift between two shapes already in production.

### 3.4 Blast radius

- `mingla-business/src/store/scannerInvitationsStore.ts` (interface + persist v1 → v2 migration to strip the field)
- `mingla-business/src/components/scanners/InviteScannerSheet.tsx` (delete toggle row + 2 deps + state hook)
- `mingla-business/app/event/[id]/scanners/index.tsx` (delete 2 pill render sites)
- DB: NO migration needed; mobile change only
- Tests: 3 grep gates (pill-removed; toggle-removed; persist v2-strip applies cleanly to v1 cached entries)

### 3.5 Operator decision needed

**Decision Q1:** Path A (drop canManualCheckIn entirely, ~50 LOC subtract) vs Path B (add manual_check_in to DB + wire real consumer, ~80 LOC) vs Path C (translator, ~30 LOC + maintenance debt). **Forensics recommends Path A.**

---

## 4 — Thread 2: `permissions_override` jsonb editor

### 4.1 Current state (5-truth-layer)

| Layer | Finding |
|-------|---------|
| **Docs** | PR #59 author seeded `permissions_override jsonb NOT NULL DEFAULT '{}'::jsonb` on `brand_team_members` (line 165) without semantic spec. Cycle 13a SPEC §3.2 explicitly deferred to 13b. |
| **Schema** | brand_team_members.permissions_override exists with empty-jsonb default. NO RLS-level reader. NO trigger. NO check constraint on shape. |
| **Code** | `mingla-business/src/hooks/useCurrentBrandRole.ts:103-114` SELECTs `permissions_override` and returns it via `CurrentBrandRoleState.permissionsOverride: Record<string, unknown>`. Verified by grep: `permissionsOverride` appears at exactly 1 consumer site — `useCurrentBrandRole` itself. NO downstream consumer interprets the jsonb. |
| **Runtime** | The hook returns it; nothing reads it; it's effectively a write-only field today. |
| **Data** | All `brand_team_members` rows have `permissions_override = '{}'::jsonb` (table is empty in production; can't sample non-default values). |

### 4.2 Architectural options

**Path A — Action-level deny-list:**
- Shape: `{ "DENIED": ["EDIT_TICKET_PRICE", "REFUND_ORDER"] }`
- References existing `MIN_RANK` action keys (canonical 14 actions in `permissionGates.ts`)
- `useCurrentBrandRole.canPerformAction(action)` extended: rank-check passes AND action not in DENIED → allowed
- Editor: extension panel in `MemberDetailSheet` listing the 14 actions with checkboxes; only shows for finance_manager+ overrides on event_manager+ targets
- **Cost:** ~80 LOC (UI editor + canPerformAction extension + RLS server-side mirror in B-cycle)
- **Gain:** simple semantics; "this person has the role's defaults MINUS these specific actions"

**Path B — Action-level allow-list:**
- Shape: `{ "ALLOWED": ["REFUND_ORDER"] }`
- Operator GRANTS specific actions a teammate's role wouldn't normally allow
- Editor: same panel, "grant additional permissions" framing
- **Cost:** same ~80 LOC; semantically more dangerous (granting elevation feels less safe than restricting)
- **Loss:** weaker model than Path A — granting an action above the user's role rank is what `permissions_override` shouldn't ever do; that's role escalation.

**Path C — Parameterized restriction:**
- Shape: `{ "max_refund_gbp": 500, "denied_actions": [...] }`
- Mixes deny-list with parameterized bounds
- **Cost:** ~150 LOC (parser + semantic validators + UI for parameter inputs)
- **Gain:** real-world business logic ("this finance manager can refund up to £500 only")
- **Loss:** scope creep; needs operator validation that a £500 cap is a real ask; leans into B-cycle territory

### 4.3 Recommendation: **Path A (M-H confidence) — but DEFER unless operator validates a use case**

Path A is the safest shape for the override jsonb if 13b ships an editor. Deny-list is the simplest semantically (role hierarchy stays intact + override only RESTRICTS, never elevates). Path B is dangerous (escalation). Path C is over-engineering.

**HOWEVER:** forensics confirms NO downstream consumer interprets the override today, AND there's no operator use case validating the need. Cycle 13a's 6-role enum + per-action MIN_RANK constants cover most operator workflows. Building an editor without a clear use case is YAGNI.

**Recommended path:** lock the SHAPE as deny-list (Path A) and DEFER the editor UI to 13c or later. When operator surfaces a real "I need to restrict X without changing role Y" ask, the editor can ship in <1 day on top of the locked shape.

### 4.4 Blast radius

- IF shipped in 13b: ~80 LOC across `MemberDetailSheet` (expansion panel), `permissionGates.ts` (canPerformAction extension), `useCurrentBrandRole` (interpret the jsonb shape on read).
- IF deferred: 0 LOC change. Document the locked shape in INVARIANT_REGISTRY as a forward-compat invariant (when override editor ships, it MUST use the deny-list shape). Tag it I-33-DRAFT.

### 4.5 Operator decision needed

**Decision Q2:** Ship override editor in 13b? Or DEFER to 13c+ (lock shape only, no editor)? **Forensics recommends DEFER — lock shape as Path A deny-list, defer UI.**

---

## 5 — Thread 3: Per-event role assignments for non-scanner roles

### 5.1 Current state (5-truth-layer)

| Layer | Finding |
|-------|---------|
| **Docs** | PRD §11.2 mentions "restrict access by event" as a permission dimension. Cycle 13 forensics noted (D-CYCLE13-FOR-5) that today only scanners scope per-event. |
| **Schema** | `event_scanners (event_id, user_id, permissions, ...)` is the only per-event role table. `brand_team_members (brand_id, user_id, role, permissions_override)` has NO event_id column. |
| **Code** | Mobile has no per-event role concept for non-scanners. Cycle 13a `useCurrentBrandRole(brandId)` is brand-scoped only. |
| **Runtime** | No operator workflow today exercises per-event role distinction. |
| **Data** | Operator typically has ≤4 brands and a few events per brand. No empirical demand for per-event role scoping has surfaced in the operator-research feedback channel (I checked PRIORITY_BOARD + MASTER_BUG_LIST — no entry). |

### 5.2 Architectural options

**Option A — Extend `brand_team_members` with optional `event_id`:**
- Schema: `ALTER TABLE brand_team_members ADD COLUMN event_id uuid REFERENCES events(id);` — null = brand-level, non-null = event-scoped
- Composite index: `(brand_id, user_id, event_id)` instead of `(brand_id, user_id)`
- `useCurrentBrandRole(brandId, eventId?)` extends to take optional eventId
- **Cost:** 1 migration + RLS policy rewrites + mobile hook signature change + ~6 RLS helpers updated
- **Gain:** native schema-level support for per-event role distinction
- **Loss:** doubles the unique-index complexity; forces every existing RLS policy to consider eventId

**Option B — Parallel `event_team_members` table (mirrors event_scanners shape):**
- Schema: NEW table `event_team_members(event_id, user_id, role, permissions_override, ...)` — separate from brand_team_members
- `useCurrentBrandRole` stays brand-scoped; NEW `useCurrentEventRole(eventId)` hook layers on top
- **Cost:** 1 migration + new RLS suite + new hook + new edge functions for event-team mutations
- **Gain:** separation of concerns clean; brand-team and event-team are different tables for different scoping
- **Loss:** duplicate data shape (brand_team_members + event_team_members both have role + permissions_override); 2 invitation flows; 2 stores

**Option C — Encode in `permissions_override` jsonb:**
- Shape: `{ "event_scope": ["evt_123", "evt_456"] }` in the override jsonb
- No schema migration; brand_team_members.role is brand-level + jsonb says "scope this role to these events"
- **Cost:** ~30 LOC in `useCurrentBrandRole` (interpret event_scope when present) + ~10 LOC editor UI
- **Gain:** zero schema migration; preserves Thread 2 forward compat; minimal complexity
- **Loss:** jsonb-encoded scope is harder to query at scale; future analytics queries would need expensive jsonb operators

### 5.3 Recommendation: **DEFER (H confidence) — operator hasn't validated the use case**

Forensics found ZERO empirical demand for per-event role scoping for non-scanners. PRD §11.2 mentions it as a *dimension* but the operator-research feedback channel has no entry. Building any of A/B/C in 13b without a use case is over-engineering — Const #8 (subtract before adding) applies even to schema design.

**Recommended path:** lock the decision to "**brand-level only until operator surfaces a real use case**." When operator says "I need to give Tunde event_manager role for ONLY the December launch event," the right path becomes Option C (zero schema cost; ~40 LOC) or Option A (if multiple use cases accumulate).

### 5.4 Blast radius

- IF deferred (recommended): 0 LOC change. Document the decision in DECISION_LOG as DEC-093-PROPOSED.
- IF shipped Option C in 13b: ~40 LOC + extends Thread 2 jsonb shape. Couples Threads 2+3 tightly.
- IF shipped Option A or B in 13b: ~200-300 LOC + 1 schema migration. Substantial undertaking.

### 5.5 Operator decision needed

**Decision Q3:** Defer entirely (lock "brand-level only" decision)? Or commit to one of A/B/C? **Forensics recommends DEFER.**

---

## 6 — Thread 4: `permissions_matrix` table strategy

### 6.1 Current state (5-truth-layer)

| Layer | Finding |
|-------|---------|
| **Docs** | PR #59 author commented `'Static role→action map for server-side checks (B1 §B.7); optional client read.'` (line 1579-1580). Cycle 13 forensics noted (D-CYCLE13-FOR-3) it's underused. |
| **Schema** | `permissions_matrix(role, action, allowed)` with `(role, action)` UNIQUE constraint. Read-policy allows authenticated to SELECT. |
| **Code** | Mobile NEVER reads the table. Verified by grep: `permissions_matrix` appears 0 times in `mingla-business/`. Cycle 13a `permissionGates.ts` uses `MIN_RANK` constants (compile-time, no DB read). |
| **Runtime** | Backend RLS uses `biz_role_rank`-based functions (`biz_is_brand_admin_plus_for_caller`, etc.) — NOT the matrix table. The matrix is functionally dead at runtime. |
| **Data** | Only 5 sentinel rows seeded: `(scanner, ticket.scan, true)` + `(event_manager, event.write, true)` + `(finance_manager, order.refund, true)` + `(brand_admin, brand.invite, true)` + `(account_owner, brand.delete, true)`. **NOTE:** live row count UNVERIFIED via DB query in this forensics pass; relying on migration seed list. Operator can confirm via Management API SQL `SELECT count(*) FROM permissions_matrix`. |

### 6.2 Architectural options

**Path A — Expand to runtime authority:**
- Seed comprehensive `(role × action)` matrix — for each of 6 roles × ~14 actions = 84 rows
- Mobile: rewrite `permissionGates.ts` MIN_RANK to read from matrix at boot via React Query (`useQuery('permissions-matrix')`)
- Backend: rewrite all `biz_role_rank`-based RLS helpers to query matrix instead
- **Cost:** ~200 LOC mobile + ~10 RLS helper rewrites + 1 migration + maintenance overhead (every new action needs a matrix INSERT)
- **Gain:** single source of truth for "which role can do which action"
- **Loss:** harder to keep mobile + backend in sync; matrix updates require migrations; React Query cache adds runtime fragility (if matrix fetch fails, gates default-closed → operator sees empty UI)

**Path B — Deprecate (drop the table):**
- Schema migration: `DROP TABLE permissions_matrix;`
- Lock `MIN_RANK` constants in `permissionGates.ts` as the canonical mobile authority
- Lock `biz_role_rank` + the 6 SECURITY DEFINER helper functions as the canonical backend authority
- Add INVARIANT noting "permissions_matrix DECOMMISSIONED; MIN_RANK + biz_role_rank are authority"
- **Cost:** ~5 LOC migration + INVARIANT_REGISTRY entry
- **Gain:** Const #2 (one owner per truth) restored; no drift surface; simpler model

**Path C — Mark TRANSITIONAL (keep table, add deprecation comment):**
- Add `COMMENT ON TABLE permissions_matrix IS '[TRANSITIONAL] Underused — see DEC-XXX. Drop in 13c if no consumer surfaces.'`
- Defer drop to next cycle
- **Cost:** 1-line migration
- **Gain:** preserves optionality if future need surfaces
- **Loss:** keeps a dead surface around; may trick future implementors into reading from it; inconsistent with DEC-092 Path A precedent (subtract dead scaffolding aggressively)

### 6.3 Recommendation: **Path B (H confidence) — drop the table**

Path B mirrors DEC-092's Path A precedent (J-A9 BrandTeamView subtract) verbatim. The matrix is dead scaffolding from PR #59 that didn't pay off. `biz_role_rank` + `MIN_RANK` cover all real use cases at both layers (server + mobile) with zero drift.

Path A would be the right call IF the operator wanted runtime-mutable permissions (admin dashboard tweaks the matrix → mobile UI updates without a deploy). Forensics found no such operator workflow on the priority queue. Until that ask surfaces, Path A is over-engineering.

Path C is a half-measure — Const #8 (subtract before adding) is clearer than "comment the dead thing and hope it gets cleaned up later." DEC-092 set the precedent; apply it consistently.

### 6.4 Blast radius

- 1 migration: `DROP TABLE permissions_matrix;`
- 0 mobile code changes (mobile never read it)
- 0 backend RLS changes (backend never used it for runtime checks)
- 1 INVARIANT_REGISTRY entry: I-33 (or next free) — `permissions_matrix DECOMMISSIONED; MIN_RANK + biz_role_rank are canonical authorities`
- 1 DECISION_LOG entry: DEC-093

### 6.5 Operator decision needed

**Decision Q4:** Path A (expand) vs Path B (drop) vs Path C (TRANSITIONAL comment). **Forensics recommends Path B (drop), mirroring DEC-092 precedent.**

---

## 7 — Thread 5: Audit log brand-admin-can-read-all RLS policy

### 7.1 Current state (5-truth-layer)

| Layer | Finding |
|-------|---------|
| **Docs** | Cycle 13a SPEC §10.4 explicitly defers this to 13b/B-cycle. |
| **Schema** | `audit_log` table at line 1591-1606. Indexes on `user_id`, `brand_id`, `created_at`, `action` (lines 1608-1611). RLS enabled (line 1616). |
| **Code (mobile)** | `useAuditLog` hook fetches with `.eq('brand_id', brandId)` filter. RLS server-side restricts further to user_id=auth.uid(). Effective query: `SELECT ... WHERE brand_id = ? AND user_id = auth.uid()`. |
| **Runtime** | Today: brand_admin user sees only their OWN actions on this brand, not other team members' actions. Cycle 13a TRANSITIONAL banner is honest. |
| **Data** | Production audit_log empty (B-cycle hasn't shipped writers yet). |
| **Helper status** | `biz_is_brand_admin_plus_for_caller(p_brand_id uuid)` EXISTS at line 327, returns boolean, SECURITY DEFINER, calls `biz_is_brand_admin_plus(p_brand_id, auth.uid())`. **Ready to use.** |

### 7.2 Architectural options

**Path A — Add new policy alongside existing (recommended shape):**
- New SQL:
  ```sql
  CREATE POLICY "Brand admin plus reads brand audit_log"
    ON public.audit_log FOR SELECT TO authenticated
    USING (public.biz_is_brand_admin_plus_for_caller(brand_id));
  ```
- PostgreSQL OR-merges multiple SELECT policies — caller passes if ANY policy returns true
- Self-only policy stays in place for non-admin users
- Brand admin+ now sees all rows for brands they belong to
- **Cost:** 1 tiny migration (~5 LOC). NO mobile code changes (the existing useAuditLog query just returns more rows when allowed).
- **Gain:** Cycle 13a's audit log viewer becomes useful for brand admins; TRANSITIONAL banner copy can update.

**Path B — Replace existing self-only policy with role-aware policy:**
- DROP self-only; CREATE one combined policy: `USING (user_id = auth.uid() OR public.biz_is_brand_admin_plus_for_caller(brand_id))`
- Functionally equivalent to Path A (PostgreSQL evaluates the OR identically)
- **Cost:** same ~5 LOC migration
- **Loss:** less explicit; harder to read in pg_policies output. Path A's "two policies, OR-merged" is clearer for auditing.

### 7.3 Recommendation: **Path A (H confidence) — independent of all other threads**

Path A is the classic PostgreSQL multi-policy pattern. Two SELECT policies OR-merged is more readable than one combined predicate. Helper exists. Migration is trivial. **This is the lowest-risk, highest-value thread to ship in 13b.**

### 7.4 Blast radius

- 1 migration: `CREATE POLICY ...` (new file `supabase/migrations/<timestamp>_audit_log_brand_admin_select.sql`)
- 0 mobile code changes (useAuditLog query is already correct shape — just gets more rows)
- 1 mobile copy update: `app/brand/[id]/audit-log.tsx` TRANSITIONAL banner can soften from "you currently see your own actions only" to "audit log fills as backend writes ship in B-cycle"
- 1 INVARIANT_REGISTRY entry update: I-24 (audit_log Option B append-only carve-out) extension noting the new SELECT policy

### 7.5 Operator decision needed

**Decision Q5:** Ship Path A in 13b? **Forensics recommends YES — independent low-risk shipper.**

---

## 8 — Cross-thread dependency map

```
Thread 1 (F-1 scanner shape) ────┐
                                 ├── Both Path A + Path B → "subtract scaffolding" cycle (loose coupling)
Thread 4 (permissions_matrix) ───┘

Thread 2 (override editor) ──────┐
                                 ├── Override jsonb shape couples; Thread 3 Option C would consume Thread 2 shape
Thread 3 (per-event roles) ──────┘

Thread 5 (audit_log RLS) ────────── Fully independent — can ship in any sub-cycle alone
```

| Pair | Coupling | Notes |
|------|----------|-------|
| 1 + 4 | Loose | Both Path B (deprecate matrix) + Path A (drop canManualCheckIn) = consistent simplification posture mirroring DEC-092 |
| 2 + 3 | Tight (if both ship) | If Thread 2 locks deny-list shape AND Thread 3 picks Option C, override jsonb encodes both DENIED actions + event_scope arrays |
| 5 + others | None | Audit log RLS is a standalone migration |

---

## 9 — Decomposition recommendation

### 9.1 Single 13b cycle (recommended)

**Scope (3 threads):** Thread 1 Path A + Thread 4 Path B + Thread 5 Path A.

**Why:** all three are subtract-or-extend operations, all have H-confidence recommendations, and together they ship a coherent "permissions surface cleanup" theme. No decision-blocking; all 3 IMPL-ready after operator locks Q1+Q4+Q5.

**Estimated wall:** ~6-9h IMPL.
- Thread 1: ~3h (5 file edits + persist v1→v2 migration + 3 grep gates)
- Thread 4: ~30min (1 migration + INVARIANT_REGISTRY + DECISION_LOG)
- Thread 5: ~1h (1 migration + audit-log route copy update + INVARIANT_REGISTRY update)
- Verification + IMPL report: ~2h

**Defers:** Threads 2 + 3.

### 9.2 Why defer 2 + 3

- Thread 2 (override editor): no validated operator use case → YAGNI. Lock shape (deny-list) as a forward-compat invariant; defer UI.
- Thread 3 (per-event roles): no validated operator use case → YAGNI. Lock decision ("brand-level only until operator asks").

These deferrals are documented as:
- I-33-DRAFT: `permissions_override jsonb shape WHEN consumer ships MUST be Path A deny-list (`{"DENIED": ["ACTION_KEY", ...]}`)`
- DEC-093-PROPOSED: per-event role assignments for non-scanner roles deferred until operator validates use case

If/when operator surfaces a real ask, both can ship in <1 day on top of the foundations 13b ships.

### 9.3 Alternative: full 13b (5 threads)

**Estimated wall:** ~15-20h IMPL — substantial.

Recommend AGAINST unless operator explicitly wants the override editor + per-event roles shipped speculatively. Per Const #8 + the YAGNI principle, the speculative cost is high vs the validated value (which is currently zero for Threads 2 + 3).

---

## 10 — Operator decisions queued

| ID | Decision | Forensics recommendation |
|----|----------|--------------------------|
| Q1 | F-1 scanner shape: Path A drop / Path B add DB key / Path C translator | **Path A — drop canManualCheckIn entirely** |
| Q2 | permissions_override editor: ship in 13b / defer / lock shape only | **DEFER — lock shape as Path A deny-list as I-33-DRAFT, no editor in 13b** |
| Q3 | Per-event roles: ship A/B/C / defer | **DEFER — lock "brand-level only" as DEC-093-PROPOSED** |
| Q4 | permissions_matrix: Path A expand / Path B drop / Path C TRANSITIONAL | **Path B — drop the table** |
| Q5 | audit_log brand-admin RLS: ship Path A | **YES** |

**5 decisions to lock; SPEC dispatch follows after.**

---

## 11 — Forensics discoveries for orchestrator

- **D-CYCLE13B-FOR-1 (P3 documentation drift):** Cycle 11 `ScannerPermissions.canManualCheckIn` was specified to gate the J-S5 manual check-in CTA per its docstring comment, but Cycle 11 IMPL never wired the consumer. Today the field is purely decorative (renders 1 pill in 2 sites). Either Path A drops it or Path B wires it. Forensics flags this as the canonical "design wart that survived 2 cycles unconnected" pattern — recommend post-Cycle-13b lesson capture.
- **D-CYCLE13B-FOR-2 (P3 - Cycle 13a unconsumed return value):** Cycle 13a `useCurrentBrandRole.permissionsOverride` is returned but no consumer interprets it. If Q2 lands "DEFER editor," the field stays unconsumed until the editor ships in 13c+. Acceptable per I-33-DRAFT; flag for future Cycle 13c implementor.
- **D-CYCLE13B-FOR-3 (P3 process improvement):** PR #59 author seeded the `permissions_matrix` table without coordinating with frontend mobile design (Cycle 13a chose role-rank approach instead). Recommend codifying: "any new B1+ table that will have client-side semantics must be paired with a frontend SPEC that reads it OR explicitly marked as backend-only at PR time." Pattern lesson worth a memory rule.
- **D-CYCLE13B-FOR-4 (P4 commendation):** `biz_is_brand_admin_plus_for_caller` SECURITY DEFINER helper at PR #59 line 327 is exactly the right shape for Thread 5. Author future-proofed correctly.

---

## 12 — Confidence summary

| Thread | Confidence | What would raise it |
|--------|-----------|---------------------|
| 1 | H | Already proven across 5 layers; live cache strip migration is textbook |
| 2 | M-H | M only because no operator use case validates SHAPE choice; DEFER recommendation has H confidence |
| 3 | H | DEFER recommendation has H — no use case = no decision |
| 4 | H | DROP recommendation has H — table is verifiably dead. Live row count UNVERIFIED but seed list (5 rows) is from the authoritative migration |
| 5 | H | Helper exists; pattern is textbook PostgreSQL multi-policy |
| Overall | H | All 5 thread analyses cross-checked against 5 layers per `feedback_forensic_thoroughness` |

**Investigation manifest complete. 15 sources read in full. No sub-agent delegations. No layer skipped.**
