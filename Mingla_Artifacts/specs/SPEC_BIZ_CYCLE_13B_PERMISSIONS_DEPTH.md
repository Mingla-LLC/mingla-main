# SPEC — BIZ Cycle 13b (Permissions UI Depth — subtract scaffolding + audit log RLS extension)

**Mode:** SPEC (forensics complete; 5 decisions operator-locked; binding contract for implementor)
**Investigation:** [`reports/INVESTIGATION_BIZ_CYCLE_13B_PERMISSIONS_DEPTH.md`](../reports/INVESTIGATION_BIZ_CYCLE_13B_PERMISSIONS_DEPTH.md)
**Dispatch:** [`prompts/SPEC_BIZ_CYCLE_13B_PERMISSIONS_DEPTH.md`](../prompts/SPEC_BIZ_CYCLE_13B_PERMISSIONS_DEPTH.md)
**Surface:** Mingla Business mobile app (`mingla-business/`) + supabase backend (1 RLS migration + 1 DROP TABLE migration)
**Target:** production-ready. No "good enough." Every contract testable.
**Date:** 2026-05-04

---

## 1 — Layman summary

Cycle 13b ships three permissions cleanups:

1. **Drop `canManualCheckIn` from scanner invite UI.** It's a Cycle 11 toggle that gates NOTHING in scan logic — purely decorative pill rendering. ~50 LOC subtract + persist v1→v2 migration.
2. **Drop the `permissions_matrix` table.** Mobile never reads it. Backend uses `biz_role_rank` directly. 5 sentinel seed rows are sole content. 1 SQL migration. Mirrors DEC-092 J-A9 subtract precedent.
3. **Add brand_admin SELECT policy on `audit_log`.** Today brand admins see only their own actions; new policy lets them see all rows for brands they belong to. 4-line SQL migration + mobile banner copy update. Helper `biz_is_brand_admin_plus_for_caller` already exists.

Threads 2 (override editor) + 3 (per-event roles) explicitly DEFERRED — locked in DEC-093 + I-33-DRAFT.

---

## 2 — Operator-locked decisions (verbatim — DO NOT re-debate)

| # | Decision | Locked value |
|---|----------|--------------|
| Q1 | Scanner permissions shape (F-1) | **Path A — drop `canManualCheckIn` from mobile entirely.** Persist v1→v2 migration strips field on hydrate. NO DB schema change. |
| Q2 | `permissions_override` jsonb editor | **DEFER UI; lock shape as deny-list.** I-33-DRAFT pre-staged. NO editor in 13b. |
| Q3 | Per-event role assignments | **DEFER indefinitely.** DEC-093 logged. NO schema change. |
| Q4 | `permissions_matrix` table | **Path B — drop the table.** 1 migration. Memory file pre-staged DRAFT. |
| Q5 | Audit log brand-admin RLS | **Path A — ship 4-line ADD policy migration.** Helper exists. |

**Operator authority:** "1. Agreed / 2. Agreed / 3. Agreed / 4. Agreed / 5. Yes great feature." (2026-05-04).

---

## 3 — Scope and non-goals

### 3.1 In-scope (3 threads)

**Thread 1 — drop `canManualCheckIn` (mobile only):**
- Drop field from `ScannerPermissions` type interface
- Persist version v1 → v2 with migration that strips field on hydrate
- Delete toggle UI + state hook + handler in InviteScannerSheet
- Delete 2 pill-render sites in scanners/index.tsx
- Update header docstrings on both touched files

**Thread 4 — drop `permissions_matrix` (backend + memory):**
- New migration: DROP POLICY + DROP TABLE
- Add I-34 to INVARIANT_REGISTRY
- Memory file `feedback_permissions_matrix_decommissioned.md` already DRAFT; orchestrator flips to ACTIVE on CLOSE

**Thread 5 — audit_log brand-admin SELECT policy (backend + mobile copy):**
- New migration: CREATE POLICY using `biz_is_brand_admin_plus_for_caller(brand_id)`
- Mobile banner copy update in `audit-log.tsx`
- Update I-24 (audit_log Option B) appendix noting new SELECT policy

### 3.2 Out-of-scope (explicit hard lines)

- ❌ `permissions_override` jsonb editor UI (Q2 DEFERRED per I-33-DRAFT)
- ❌ Interpreting `permissionsOverride` in `useCurrentBrandRole.canPerformAction` (Q2)
- ❌ Per-event role schema work (Q3 DEC-093)
- ❌ `event_team_members` parallel table (Q3 Option B rejected)
- ❌ `brand_team_members.event_id` column extension (Q3 Option A rejected)
- ❌ `permissions_matrix` Path A expand-to-runtime (Q4 rejected)
- ❌ `permissions_matrix` Path C TRANSITIONAL-comment (Q4 rejected — Path B drop chosen)
- ❌ Adding new actions to `MIN_RANK` constants (out-of-scope)
- ❌ Refactoring `biz_role_rank` SQL (out-of-scope)
- ❌ Cycle 11 `canManualCheckIn` resurrection — operator locked Path A
- ❌ Audit log writers (B-cycle scope per I-24)
- ❌ `biz_is_brand_admin_plus_for_caller` rewrite (out-of-scope)
- ❌ Cycle 13a foundations files modification (`brandRole.ts`, `permissionGates.ts`, `useCurrentBrandRole.ts`, etc.)

### 3.3 Assumptions

- Cycle 13a (commit `7c5e8632`) shipped + live
- PR #59 schema is LIVE on production DB (ORCH-0706 close 2026-05-03)
- `biz_is_brand_admin_plus_for_caller` SECURITY DEFINER function exists at PR #59 line 327 (verified by forensics)
- `permissions_matrix` table holds only the 5 sentinel seed rows (verified by forensics — no production consumer)
- `audit_log` table is empty in production (B-cycle writers haven't shipped)
- React Query is wired in mingla-business (Cycle 13a Step 1.5 outcome)

---

## 4 — Per-layer specification

### 4.1 Database — 2 new migrations

#### 4.1.1 Migration: drop `permissions_matrix` (Q4)

**File:** `supabase/migrations/<timestamp>_b1_phase7_drop_permissions_matrix.sql`

Use timestamp `20260504100000` or current best-fit ordering. Implementor uses real current date.

**Contract (verbatim):**

```sql
-- =====================================================================
-- Cycle 13b Q4 — permissions_matrix DECOMMISSIONED
-- =====================================================================
-- Mobile uses MIN_RANK constants in mingla-business/src/utils/permissionGates.ts.
-- Backend uses biz_role_rank() function via SECURITY DEFINER helpers
-- (biz_is_brand_admin_plus_for_caller, biz_is_event_manager_plus_for_caller, ...).
-- The matrix was scaffolding from PR #59 author's design that didn't pay off
-- (zero mobile consumers; zero backend RLS reads).
--
-- Per Cycle 13b SPEC §4.1.1 / DEC-093 (forthcoming on 13b CLOSE).
-- Memory: feedback_permissions_matrix_decommissioned.md (status: DRAFT, flips ACTIVE on CLOSE).
-- Mirrors DEC-092 (Cycle 13a Path A J-A9 BrandTeamView subtract precedent).

DROP POLICY IF EXISTS "Authenticated can read permissions_matrix" ON public.permissions_matrix;

DROP TABLE IF EXISTS public.permissions_matrix;
```

**No backup snapshot** — table holds only 5 sentinel rows from PR #59 seed; no operational data; no archive needed (zero rollback signal possible).

#### 4.1.2 Migration: audit_log brand-admin SELECT policy (Q5)

**File:** `supabase/migrations/<timestamp>_b1_phase7_audit_log_brand_admin_select.sql`

Sequenced AFTER the permissions_matrix DROP (filename timestamp must be later).

**Contract (verbatim):**

```sql
-- =====================================================================
-- Cycle 13b Q5 — audit_log brand_admin+ SELECT policy
-- =====================================================================
-- Today's RLS scopes audit_log SELECT to user_id = auth.uid() only.
-- Brand admins want to see all team members' actions on brands they belong to.
-- This new policy STACKS on the existing self-only policy via PostgreSQL
-- multi-policy OR-merge (caller passes if ANY SELECT policy returns true).
--
-- Helper biz_is_brand_admin_plus_for_caller exists at PR #59 line 327
-- (SECURITY DEFINER; reads brand_team_members.role + biz_role_rank threshold).
--
-- Per Cycle 13b SPEC §4.1.2.

CREATE POLICY "Brand admin plus reads brand audit_log"
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (public.biz_is_brand_admin_plus_for_caller(brand_id));
```

**Existing self-only policy `"Users can read own audit_log rows"` STAYS in place.** Both policies coexist. PostgreSQL evaluates SELECT-policy as OR-merge — caller passes if EITHER policy returns true. Sub-rank users (event_manager, finance_manager, etc.) still see only their own rows; brand_admin+ now sees all rows for their brands.

### 4.2 Edge functions — none

13b ships no edge functions.

### 4.3 Service layer — none

No new Supabase service queries. The existing `useAuditLog` React Query hook (Cycle 13a `src/hooks/useAuditLog.ts`) keeps its current `.eq('brand_id', brandId)` filter. RLS layer changes; mobile query shape unchanged.

### 4.4 Hook layer — none

No new hooks. `useAuditLog` continues to work; rank-aware filtering happens at RLS layer not mobile layer.

### 4.5 Mobile type changes (Thread 1) — `ScannerPermissions`

**File:** `mingla-business/src/store/scannerInvitationsStore.ts`

**BEFORE (current):**
```ts
export interface ScannerPermissions {
  /** Always true — scanners can always scan. */
  canScan: boolean;
  /** Operator-set — controls J-S5 manual check-in CTA visibility for this scanner. */
  canManualCheckIn: boolean;
  // Cycle 12 — operator-controllable per scanner. Semantics = "can take
  // cash + manual payments at the door". Card reader + NFC remain
  // TRANSITIONAL until B-cycle Stripe Terminal SDK lands.
  canAcceptPayments: boolean;
}
```

**AFTER (Cycle 13b):**
```ts
export interface ScannerPermissions {
  /** Always true — scanners can always scan. */
  canScan: boolean;
  // Cycle 12 — operator-controllable per scanner. Semantics = "can take
  // cash + manual payments at the door". Card reader + NFC remain
  // TRANSITIONAL until B-cycle Stripe Terminal SDK lands.
  canAcceptPayments: boolean;
}
```

Drop the `canManualCheckIn` field + its docstring entirely. No replacement.

**Persist version bump (verbatim required):**

```ts
const persistOptions: PersistOptions<
  ScannerInvitationsStoreState,
  PersistedState
> = {
  name: "mingla-business.scannerInvitationsStore.v2",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (s): PersistedState => ({ entries: s.entries }),
  version: 2,
  migrate: (persistedState, version) => {
    // v1 → v2 (Cycle 13b Q1): drop canManualCheckIn from each entry's permissions.
    // The field was decorative-only in Cycle 11/12 — never consumed in scan logic.
    // SPEC §4.5.
    if (version === 1) {
      const v1 = persistedState as { entries: Array<{ permissions: { canScan: boolean; canManualCheckIn?: boolean; canAcceptPayments: boolean } }> };
      return {
        entries: (v1.entries ?? []).map((e) => {
          const { canManualCheckIn: _drop, ...restPerms } = e.permissions;
          return { ...e, permissions: restPerms };
        }),
      };
    }
    return persistedState as PersistedState;
  },
};
```

Note: persist key bumped from `mingla-business.scannerInvitationsStore.v1` to `.v2`. Migrate function silently strips `canManualCheckIn` from cached entries on hydrate. Cold-start hydration (Const #14) preserved — pre-Cycle-13b cached entries don't crash; post-13b they have 2-key permissions.

### 4.6 Component layer (Thread 1) — `InviteScannerSheet`

**File:** `mingla-business/src/components/scanners/InviteScannerSheet.tsx`

**Subtractions (verbatim):**

1. **Delete state hook** (line 75 currently):
   ```ts
   const [canManualCheckIn, setCanManualCheckIn] = useState<boolean>(false);
   ```

2. **Delete from useEffect reset** (line ~86):
   ```ts
   setCanManualCheckIn(false);
   ```

3. **Delete from `recordInvitation` payload** (lines ~111-114). Final shape:
   ```ts
   permissions: {
     canScan: true,
     // Cycle 12 — semantics = cash + manual today; card + NFC TRANSITIONAL
     // until B-cycle Stripe Terminal SDK. Operator-controllable per scanner.
     canAcceptPayments,
   },
   ```

4. **Delete from useCallback deps** (line 130):
   ```ts
   canManualCheckIn,
   ```

5. **Delete entire toggle row** (lines ~215-240). The block:
   ```jsx
   {/* Can manual check-in toggle */}
   <View style={styles.toggleRow}>
     <View style={styles.toggleCol}>
       <Text style={styles.toggleLabel}>Allow manual check-in</Text>
       <Text style={styles.toggleSubline}>...</Text>
     </View>
     <Pressable
       onPress={() => !submitting && setCanManualCheckIn((v) => !v)}
       accessibilityRole="switch"
       accessibilityState={{ checked: canManualCheckIn }}
       accessibilityLabel="Allow manual check-in"
       disabled={submitting}
       style={[styles.toggleTrack, canManualCheckIn && styles.toggleTrackOn]}
     >
       <View style={[styles.toggleThumb, canManualCheckIn && styles.toggleThumbOn]} />
     </Pressable>
   </View>
   ```

   Delete entirely. The Cycle 12 `canAcceptPayments` toggle stays.

6. **Update header docstring** (lines ~1-16). Append:
   ```
    *
    * Cycle 13b Q1 — `canManualCheckIn` toggle DROPPED. The field was decorative
    * in Cycle 11/12 (gated 0 consumers in scan logic, only rendered an
    * informational pill on the team list). Per DEC-093 + I-34. The
    * `canAcceptPayments` toggle (Cycle 12 Decision #4) STAYS.
   ```

### 4.7 Component layer (Thread 1) — scanners route

**File:** `mingla-business/app/event/[id]/scanners/index.tsx`

**Subtractions:**

1. **Delete pill at line ~334** (action sheet preview):
   ```jsx
   {activeActionInvitation.permissions.canManualCheckIn ? (
     <Pill variant="info">CAN MANUAL CHECK-IN</Pill>
   ) : null}
   ```

2. **Delete pill at line ~419** (InvitationRow render):
   ```jsx
   {invitation.permissions.canManualCheckIn ? (
     <Pill variant="info">CAN MANUAL CHECK-IN</Pill>
   ) : null}
   ```

Both deletions. No replacement. The `canAcceptPayments` pill (if present) stays unchanged.

### 4.8 Component layer (Thread 5) — audit-log route copy update

**File:** `mingla-business/app/brand/[id]/audit-log.tsx` lines 125-131

**BEFORE (current TRANSITIONAL banner):**
```jsx
<Text style={styles.bannerText}>
  Audit log fills as the backend wires server-side recording in
  B-cycle. You currently see your own actions only — brand-wide
  visibility for admins lands later.
</Text>
```

**AFTER (Cycle 13b — verbatim):**
```jsx
<Text style={styles.bannerText}>
  Audit log fills as the backend wires server-side recording in
  B-cycle. Brand admins see all team actions; team members see
  their own.
</Text>
```

The "lands later" copy retires once the new RLS policy ships. Brand admins now have brand-wide visibility; sub-rank users keep self-only visibility. Both states honest.

### 4.9 Documentation updates

**INVARIANT_REGISTRY.md updates (3 entries):**

1. **I-33** (currently DRAFT — orchestrator flips to ACTIVE on 13b CLOSE; implementor leaves DRAFT marker visible). Body unchanged from pre-staged DRAFT.

2. **NEW I-34** entry (verbatim required):

   ```markdown
   ---

   ### I-34 `permissions_matrix` table DECOMMISSIONED (post Cycle 13b CLOSE)

   **Statement:** The `permissions_matrix` table is dropped post-Cycle-13b. Mobile-side authority for role→action allowance is `MIN_RANK` constants in `mingla-business/src/utils/permissionGates.ts`. Backend-side authority is `biz_role_rank(p_role text)` SQL function (PR #59 lines 11-30) plus the SECURITY DEFINER helpers built on it (`biz_is_brand_admin_plus_for_caller`, `biz_is_event_manager_plus_for_caller`, etc.). NO future migration may re-create `permissions_matrix` without an explicit DEC entry overriding this invariant.

   **Why:** PR #59 author shipped the table as scaffolding for runtime role→action checks. Cycle 13a chose role-rank thresholds in `permissionGates.ts` instead — proving the matrix was never load-bearing. Verified by Cycle 13b forensics: 0 mobile reads, 0 backend RLS reads, only 5 sentinel seed rows. Const #2 (one owner per truth) + Const #8 (subtract before adding) demand the drop.

   **Established by:** Cycle 13b CLOSE 2026-05-04 + DEC-093 (operator-locked Q4 = Path B drop).

   **Enforcement:** Convention. Optional CI gate: any future migration containing `CREATE TABLE ... permissions_matrix` requires DEC review. Mobile grep gate: `grep -rn "permissions_matrix" mingla-business/` returns 0 hits (verified post-Cycle-13b).

   **EXIT CONDITION:** None — permanent decommission. Re-creation requires explicit DEC override (e.g., if operator validates a runtime-mutable permissions matrix use case in a future cycle, that cycle's spec adds a DEC + a new migration with full justification).

   **Related artifacts:**
   - Memory: `feedback_permissions_matrix_decommissioned.md` (flips DRAFT → ACTIVE on 13b CLOSE)
   - DEC-093 (DECISION_LOG)
   - Cycle 13b forensics §6 Thread 4 + Path B recommendation

   **Test that catches a regression:** Migration grep — any future `supabase/migrations/*.sql` file containing `CREATE TABLE` and `permissions_matrix` should fail review unless paired with a DEC override entry.
   ```

3. **I-24 appendix** (audit_log Option B append-only carve-out — extend with new SELECT policy note):

   ```markdown
   > **Cycle 13b amendment (2026-05-04):** a new SELECT policy `"Brand admin plus reads brand audit_log"` was added (PostgreSQL multi-policy OR-merge). Brand admins now see ALL audit_log rows for brands where `biz_is_brand_admin_plus_for_caller(brand_id)` returns true; sub-rank users (event_manager+ on brands but below brand_admin) still see only their own rows via the original `"Users can read own audit_log rows"` policy. Append-only INSERT carve-out unchanged — service-role retains UPDATE/DELETE per Option B; non-service callers are still blocked from mutations via the existing trigger.
   ```

**DECISION_LOG.md update:**

DEC-093 was pre-staged on operator lock 2026-05-04. No new entry needed for 13b CLOSE — the existing DEC-093 covers all 5 Q1-Q5 lock outcomes. Implementor adds nothing here.

**Memory file flip (orchestrator action at CLOSE):**

`~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_permissions_matrix_decommissioned.md` — frontmatter line `status: DRAFT — flips to ACTIVE on Cycle 13b CLOSE` becomes `status: ACTIVE post-Cycle-13b CLOSE`. Implementor LEAVES the DRAFT marker; orchestrator flips at CLOSE.

`MEMORY.md` index entry — orchestrator updates pointer line at CLOSE.

---

## 5 — Success criteria (SC-1..SC-15)

| SC | Description | Layer | Status criterion |
|----|-------------|-------|------------------|
| SC-1 | Persist v1 cache with `canManualCheckIn` field hydrates clean to v2 with field stripped (no crash) | Mobile + persist | Cold-start with v1 cached entry → entry visible in store with 2-key permissions |
| SC-2 | InviteScannerSheet shows exactly 1 toggle (Accept payments at the door) — no Manual check-in toggle visible | UI | Visual smoke on device — only 1 toggle row between Email field and Send button |
| SC-3 | Scanner team list (action sheet preview) renders NO "CAN MANUAL CHECK-IN" pill | UI | Tap a scanner row in `/event/[id]/scanners` — pill absent in detail sheet |
| SC-4 | Scanner team list (InvitationRow) renders NO "CAN MANUAL CHECK-IN" pill | UI | Visual: scanner list rows show no such pill |
| SC-5 | tsc clean post-Thread-1 (only D-CYCLE12-IMPL-1/2 pre-existing) | Static | `cd mingla-business && npx tsc --noEmit` exit 0 (filtered) |
| SC-6 | Grep `canManualCheckIn` returns 0 hits across `mingla-business/` | Static | `grep -rn canManualCheckIn mingla-business/` returns no matches |
| SC-7 | post-migration `to_regclass('public.permissions_matrix')` returns NULL | Schema | DB query returns NULL after migration runs |
| SC-8 | post-migration 0 policies on `permissions_matrix` | Schema | `SELECT count(*) FROM pg_policies WHERE tablename='permissions_matrix'` returns 0 |
| SC-9 | Grep `permissions_matrix` returns 0 hits across `mingla-business/` AND `supabase/functions/` | Static | Both grep targets return no matches (excluding the new DROP migration + the historical PR #59 migration) |
| SC-10 | Existing helpers (`biz_is_brand_admin_plus_for_caller` etc.) still work post-DROP | Backend smoke | RLS smoke test on `brand_team_members` SELECT — brand_admin user still passes |
| SC-11 | Brand_admin user sees all audit_log rows for their brand (incl. other team members') | RLS smoke | seed audit_log row by another team member → brand_admin user SELECTs successfully |
| SC-12 | Brand_admin user does NOT see audit_log rows from brands they're NOT admin of | RLS smoke | Try SELECT with brand_id of unrelated brand — returns 0 rows |
| SC-13 | Sub-rank user (e.g., event_manager) still sees only own audit_log rows | RLS smoke | event_manager user with own row + another's row → sees only own |
| SC-14 | Existing self-only policy `"Users can read own audit_log rows"` still EXISTS post-migration | Schema | `SELECT policyname FROM pg_policies WHERE tablename='audit_log'` returns BOTH policies |
| SC-15 | Mobile audit-log route TRANSITIONAL banner copy updated verbatim | UI | Text content matches §4.8 AFTER block |

---

## 6 — Test matrix (T-1-01..T-1-05 + T-4-01..T-4-05 + T-5-01..T-5-05)

### Thread 1 tests

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1-01 | Persist v1 cache hydrate | AsyncStorage `mingla-business.scannerInvitationsStore.v1` with `[{permissions:{canScan:true,canManualCheckIn:true,canAcceptPayments:false}, ...}]` | After app cold-start, store entries have 2-key permissions; no crash; v2 persist key now in storage | Persist + cold start |
| T-1-02 | Invite sheet toggle count | Open InviteScannerSheet | Exactly 1 ToggleRow visible (Accept payments at the door); no "Allow manual check-in" toggle | UI |
| T-1-03 | Action sheet pill | Tap a scanner row in scanners route, action sheet opens | No "CAN MANUAL CHECK-IN" pill rendered | UI |
| T-1-04 | InvitationRow pill | Visit scanners route with at least 1 invitation in store | No "CAN MANUAL CHECK-IN" pill on any row | UI |
| T-1-05 | tsc + grep gate | `cd mingla-business && npx tsc --noEmit` + `grep -rn canManualCheckIn mingla-business/` | tsc clean (only pre-existing D-CYCLE12-IMPL-1/2); grep returns 0 hits | Static |

### Thread 4 tests

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-4-01 | Table dropped | Run migration; `SELECT to_regclass('public.permissions_matrix')` | Returns NULL | Schema |
| T-4-02 | Policies removed | `SELECT count(*) FROM pg_policies WHERE tablename='permissions_matrix'` | Returns 0 | Schema |
| T-4-03 | Mobile read sites | `grep -rn permissions_matrix mingla-business/` | Returns 0 hits | Static |
| T-4-04 | Backend edge fn read sites | `grep -rn permissions_matrix supabase/functions/` | Returns 0 hits | Static |
| T-4-05 | Existing RLS helpers smoke | Authenticated brand_admin user SELECTs from `brand_team_members` for their brand | Succeeds (helper biz_is_brand_admin_plus_for_caller works) | RLS |

### Thread 5 tests

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-5-01 | Brand_admin sees all rows | Pre-seed audit_log row with `user_id=other_team_member_uid, brand_id=A`. Brand_admin user on Brand A SELECTs `WHERE brand_id=A` | Returns the seeded row + own rows | RLS |
| T-5-02 | Brand_admin scoped to own brands | Same brand_admin user SELECTs `WHERE brand_id=B` (different brand they're not admin of) | Returns 0 rows OR own-rows-on-B-only (NOT others' rows on B) | RLS |
| T-5-03 | Sub-rank user scoped to own | event_manager user with own audit_log row + another's row on same brand | Sees ONLY own row | RLS |
| T-5-04 | Existing policy preserved | `SELECT policyname FROM pg_policies WHERE tablename='audit_log'` post-migration | Returns BOTH `"Users can read own audit_log rows"` AND `"Brand admin plus reads brand audit_log"` | Schema |
| T-5-05 | Mobile copy update + tsc | Read `app/brand/[id]/audit-log.tsx` line 125-131 + `cd mingla-business && npx tsc --noEmit` | Copy matches §4.8 AFTER block; tsc clean | Static + UI |

---

## 7 — Invariants

### 7.1 Existing invariants this cycle preserves

| ID | Statement | How preserved |
|----|-----------|---------------|
| I-21 | Anon-tolerant buyer routes | No buyer-side change |
| I-24 | audit_log Option B append-only carve-out | INSERT trigger + service-role short-circuit unchanged. Cycle 13b adds NEW SELECT policy that stacks on existing self-only via OR-merge. Append-only invariant preserved at INSERT/UPDATE/DELETE layer. |
| I-28 | Scanner-invitation UI TRANSITIONAL until B-cycle | Drop of canManualCheckIn doesn't affect the TRANSITIONAL invariant. UI-only invitation flow stays in force. Cycle 12 amendment (canAcceptPayments toggle FLIP) preserved. |
| I-31 | UI-only brand invitation TRANSITIONAL | Untouched |
| I-32 | Mobile UI gates mirror SQL biz_role_rank verbatim | Untouched (no role-rank change; canManualCheckIn was NOT a rank-gated action) |

### 7.2 NEW invariants 13b ratifies

| ID | Statement | Status |
|----|-----------|--------|
| **I-33** | `permissions_override` jsonb shape MUST be deny-list `{"DENIED": [...]}` referencing `MIN_RANK` action constants | **DRAFT (pre-staged) → ACTIVE on 13b CLOSE** |
| **I-34** | `permissions_matrix` table DECOMMISSIONED. `MIN_RANK` (mobile) + `biz_role_rank` (backend) are canonical | **NEW (added by 13b CLOSE)** |

### 7.3 Invariant numbering verification

Implementor MUST verify before adding I-33 ACTIVE flip + I-34 NEW: read `Mingla_Artifacts/INVARIANT_REGISTRY.md` last entries; confirm I-33 is currently DRAFT (added by orchestrator pre-stage); confirm I-34 is the next free numeric slot. If a different number is now occupied (concurrent cycle close), bump to next free + document final ID in IMPL report.

---

## 8 — Implementation order

Numbered sequence. Implementor follows exactly; tsc verification between major milestones.

1. **Pre-flight gates:**
   - Confirm next-available invariant number for I-34 (read INVARIANT_REGISTRY tail; expect free since I-33-DRAFT is currently most recent)
   - Read forensics report verbatim
   - Read PR #59 schema lines 11-30 (biz_role_rank) + 327-345 (helpers) + 1130-1170 (scanner tables) + 1566-1589 (permissions_matrix) + 1591-1623 (audit_log) — 5-truth-layer schema check
   - Verify forensics findings on grep counts (canManualCheckIn 0 consumers outside 3 known files; permissions_matrix 0 mobile reads)

2. **Thread 4 migration (DROP permissions_matrix):**
   - Write `supabase/migrations/<timestamp>_b1_phase7_drop_permissions_matrix.sql` per §4.1.1 verbatim
   - Filename timestamp: use current UTC epoch best-fit (e.g., `20260504100000` or later). MUST be later than `20260502100000_b1_business_schema_rls.sql`.
   - DO NOT apply via `mcp__supabase__apply_migration` — write `.sql` file to disk only; operator runs `supabase db push`.

3. **Thread 5 migration (audit_log brand-admin SELECT policy):**
   - Write `supabase/migrations/<timestamp>_b1_phase7_audit_log_brand_admin_select.sql` per §4.1.2 verbatim
   - Timestamp MUST be later than Thread 4's migration (e.g., `20260504100001` if Thread 4 is `20260504100000`).
   - DO NOT apply via MCP — disk only; operator runs `supabase db push`.

4. **Thread 1 type drop:**
   - Edit `src/store/scannerInvitationsStore.ts` per §4.5
   - Remove `canManualCheckIn` from `ScannerPermissions` interface (drop field + docstring)
   - Bump persist version: change `name: "...v1"` → `"...v2"`, `version: 1` → `2`, add `migrate` function per §4.5
   - Update header docstring noting Cycle 13b drop

5. **Thread 1 InviteScannerSheet subtract:**
   - Edit `src/components/scanners/InviteScannerSheet.tsx` per §4.6
   - Delete state hook (line 75): `const [canManualCheckIn, setCanManualCheckIn] = useState<boolean>(false);`
   - Delete from useEffect reset (line ~86): `setCanManualCheckIn(false);`
   - Delete from `recordInvitation` payload (lines ~111-114): the `canManualCheckIn,` line + its surrounding spread context
   - Delete from useCallback deps (line 130): `canManualCheckIn,`
   - Delete entire toggle row (lines ~215-240) per §4.6 step 5
   - Update header docstring per §4.6 step 6

6. **Thread 1 scanners route subtract:**
   - Edit `app/event/[id]/scanners/index.tsx` per §4.7
   - Delete pill at line ~334
   - Delete pill at line ~419

7. **tsc checkpoint #1 (mandatory):**
   - `cd mingla-business && npx tsc --noEmit`
   - Expected: only D-CYCLE12-IMPL-1/2 pre-existing errors

8. **Thread 5 mobile copy update:**
   - Edit `app/brand/[id]/audit-log.tsx` lines 125-131 per §4.8 AFTER block
   - Verbatim 4-line copy change inside the existing `<Text style={styles.bannerText}>` block

9. **INVARIANT_REGISTRY entries:**
   - Append I-34 verbatim per §4.9 Documentation Updates
   - Append I-24 appendix verbatim per §4.9
   - DO NOT flip I-33 from DRAFT to ACTIVE — orchestrator does this at CLOSE; implementor leaves DRAFT marker visible

10. **tsc checkpoint #2 (mandatory):**
    - Final `cd mingla-business && npx tsc --noEmit`
    - Expected: only D-CYCLE12-IMPL-1/2 pre-existing errors

11. **Verification matrix:**
    - Run all 15 SC tests + grep regression battery (T-1-05 + T-4-03 + T-4-04)
    - Confirm migrations are syntactically valid SQL (read once after writing)
    - DB-side verification (T-4-01/02/05 + T-5-01..T-5-04) requires `supabase db push` to apply migrations — operator runs this; implementor reports as UNVERIFIED-pending-deploy

12. **Implementation report:**
    - Write `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_13B_PERMISSIONS_DEPTH_REPORT.md` per implementor 15-section template
    - Include Old → New receipts for every file modified or created
    - SC-1..SC-15 verification matrix with PASS / UNVERIFIED-with-reason labels
    - T-1-01..T-1-05 + T-4-01..T-4-05 + T-5-01..T-5-05 outcomes
    - Final I-34 numeric ID confirmed
    - Discoveries for orchestrator (D-CYCLE13B-IMPL-N if any new side issues)
    - Memory file flip note (orchestrator action at CLOSE)
    - Status label per implementor honesty discipline

---

## 9 — Regression prevention

| Risk | Structural safeguard | Test |
|------|----------------------|------|
| Future implementor reads dropped `permissions_matrix` | I-34 + memory file `feedback_permissions_matrix_decommissioned.md` ACTIVE post-CLOSE + all references in mobile/backend already eliminated | Migration grep gate (CI optional): any new `CREATE TABLE permissions_matrix` requires DEC override |
| Future implementor accepts non-deny-list `permissions_override` shape | I-33 forward-compat invariant pre-staged DRAFT, flips ACTIVE on CLOSE | First downstream consumer's parser (Cycle 13c+ when override editor ships) |
| Audit log policy drift | I-24 amendment notes both policies coexist via PostgreSQL multi-policy OR-merge | RLS smoke tests T-5-01..T-5-04 |
| `canManualCheckIn` field re-introduced | Grep gate SC-6 + I-34 covers permissions_matrix specifically (consider parallel `feedback_canmanualcheckin_decommissioned.md` if needed — defer unless implementor sees a real risk) | T-1-05 grep |
| Persist v1 cache hydrate crash on field strip | v1→v2 migrate function explicitly destructures `canManualCheckIn: _drop` and rebuilds permissions object | T-1-01 cold-start with seeded v1 cache |

**Protective comments required in code:**
- `scannerInvitationsStore.ts` v1→v2 migrate function: comment block citing §4.5 + Cycle 13b SPEC + I-34
- `InviteScannerSheet.tsx` header: append Cycle 13b note per §4.6 step 6
- Both new SQL migrations: comment headers per §4.1.1 / §4.1.2 verbatim

---

## 10 — Cross-references

- Forensics: [`reports/INVESTIGATION_BIZ_CYCLE_13B_PERMISSIONS_DEPTH.md`](../reports/INVESTIGATION_BIZ_CYCLE_13B_PERMISSIONS_DEPTH.md)
- SPEC dispatch: [`prompts/SPEC_BIZ_CYCLE_13B_PERMISSIONS_DEPTH.md`](../prompts/SPEC_BIZ_CYCLE_13B_PERMISSIONS_DEPTH.md)
- Cycle 13a SPEC: [`specs/SPEC_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS.md`](SPEC_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS.md)
- Cycle 13a IMPL report: [`reports/IMPLEMENTATION_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS_REPORT.md`](../reports/IMPLEMENTATION_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS_REPORT.md)
- DEC-092 (Path A J-A9 subtract precedent): [`Mingla_Artifacts/DECISION_LOG.md`](../DECISION_LOG.md)
- DEC-093 (Cycle 13b — Q3 per-event role defer + meta-decision for Q1+Q4+Q5 ship): [`Mingla_Artifacts/DECISION_LOG.md`](../DECISION_LOG.md)
- I-33-DRAFT (override jsonb shape forward-compat): [`Mingla_Artifacts/INVARIANT_REGISTRY.md`](../INVARIANT_REGISTRY.md)
- Memory: `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_permissions_matrix_decommissioned.md` (status: DRAFT → ACTIVE on CLOSE)
- PR #59 schema source: `supabase/migrations/20260502100000_b1_business_schema_rls.sql`
  - biz_role_rank: lines 11-30
  - biz_is_brand_admin_plus_for_caller: lines 327-335
  - scanner_invitations + event_scanners: lines 1132-1167
  - permissions_matrix: lines 1566-1589
  - audit_log + existing self-only policy: lines 1591-1623
- Cycle 11 close commit `ade877fb` — InviteScannerSheet origin (canManualCheckIn intent specified, never wired)
- Cycle 12 close commit `8d457528` — InviteScannerSheet canAcceptPayments toggle FLIP (preserved by 13b)
- Cycle 13a close commit `7c5e8632` — foundations files stable (NOT modified by 13b)

---

## 11 — Forward backend handoff (B-cycle requirements)

Cycle 13b makes 0 functional changes to backend writers. B-cycle still owes:

- `invite-brand-member` + `accept-brand-invitation` edge functions (closes I-31 EXIT)
- audit_log writer cluster: refund / role-change / brand-edit / invite edge functions need to INSERT audit_log rows in same transaction with the operation (closes Cycle 13a TRANSITIONAL banner — once writers ship, the audit log starts filling and Cycle 13b's brand-admin SELECT policy becomes valuable)
- `invite-scanner` + `accept-scanner-invitation` edge functions (closes I-28 EXIT)
- F-1 mobile↔DB scanner shape translator at the read/write boundary (camelCase mobile ↔ snake_case DB) — Cycle 13b drops `canManualCheckIn` so the translator only needs to map `canScan ↔ scan` + `canAcceptPayments ↔ take_payments`. ~10 LOC translator.

---

## 12 — Output contract for the implementor

Implementor produces TWO things:

1. **Code changes** per §8 implementation order (12 steps)
2. **Implementation report** at `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_13B_PERMISSIONS_DEPTH_REPORT.md` per Mingla implementor 15-section template:
   - Old → New receipts for every file modified or created (~6 files expected: 2 NEW migrations + 4 MOD files)
   - SC-1..SC-15 verification matrix with PASS / UNVERIFIED-pending-deploy labels (DB-side SCs unverifiable until operator runs `supabase db push`)
   - T-1-01..T-1-05 + T-4-01..T-4-05 + T-5-01..T-5-05 outcomes
   - Invariant registrations: confirmed final I-34 numeric ID; I-33-DRAFT marker preserved
   - Constitutional compliance scan (14 principles)
   - Cache safety: confirm persist v1→v2 migration handles cached entries correctly
   - Regression surface: 3-5 adjacent features tester should spot-check (Cycle 11 InviteScannerSheet remaining canAcceptPayments toggle · Cycle 12 InviteScannerSheet flow · Cycle 13a audit-log route + useAuditLog hook)
   - Discoveries for orchestrator (D-CYCLE13B-IMPL-N — any new side issues, separate from carry-forward D-CYCLE13B-FOR-1..4)
   - Transition items: I-33 DRAFT marker stays visible; orchestrator flips at CLOSE
   - Files touched matrix (path + action + LOC delta)
   - Verification commands run + outputs (tsc, grep tests, migration syntax check)
   - Status label — `implemented and verified` for mobile-side SCs / `implemented, partially verified` for DB-side (UNVERIFIED-pending-deploy until operator runs `supabase db push`)

3. **Chat output** (compact, per `feedback_no_summary_paragraph`):

```
Layman summary:
- [What ships in plain English — 3 threads cleanup + audit log RLS extension]
- [Limitations — 2 migrations need operator `supabase db push` before DB-side SC verification]
- [Test-first guidance for operator]

Status: [implemented and verified | partially verified | unverified-pending-deploy]
Verification: [tsc clean? grep tests pass? mobile UI smoke ready?]
Report: Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_13B_PERMISSIONS_DEPTH_REPORT.md

Test first:
- [Operator runs `supabase db push` to apply 2 new migrations]
- [Mobile smoke: open scanner invite — only 1 toggle visible]
- [Mobile smoke: open audit log route — banner copy updated]

Discoveries for orchestrator: [None expected unless side issue surfaces]
```

---

## 13 — What the implementor MUST NOT do

- Re-debate any locked decision from §2 (Q1+Q4+Q5 SHIP; Q2+Q3 DEFER)
- Add scope beyond §3.1 (e.g., implement override editor; build per-event role schema; expand `permissions_matrix` instead of dropping; resurrect `canManualCheckIn`)
- Touch Cycle 13a foundations files (`brandRole.ts`, `permissionGates.ts`, `useCurrentBrandRole.ts`, `useAuditLog.ts`, `brandTeamStore.ts`, `team/*.tsx`, `app/brand/[id]/team.tsx`)
- Use `mcp__supabase__apply_migration` to apply migrations — write `.sql` files to `supabase/migrations/` only; operator deploys via `supabase db push`
- Modify the historical PR #59 migration `20260502100000_b1_business_schema_rls.sql` — preserve as audit trail
- Skip the I-34 INVARIANT_REGISTRY entry
- Flip I-33 from DRAFT → ACTIVE — that's an orchestrator-owned action at 13b CLOSE
- Forget the v1→v2 persist migrate function — without it, cold-start hydration of cached v1 entries shows `canManualCheckIn: undefined` in objects (TS happy, but inconsistent shape)

If the SPEC is wrong or contradicts what the implementor finds in code: STOP. State the contradiction. Wait for direction.

---

**SPEC binding contract complete. Ready for implementor dispatch.**
