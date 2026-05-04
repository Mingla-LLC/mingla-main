# SPEC — BIZ Cycle 13a (Permissions UI Foundations)

**Mode:** SPEC (forensics complete; 5 decisions locked; binding contract for implementor)
**Investigation:** [`reports/INVESTIGATION_BIZ_CYCLE_13_PERMISSIONS_UI.md`](../reports/INVESTIGATION_BIZ_CYCLE_13_PERMISSIONS_UI.md)
**Dispatch:** [`prompts/SPEC_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS.md`](../prompts/SPEC_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS.md)
**Surface:** Mingla Business mobile app (`mingla-business/`) — operator-side team management + role-based access control foundations
**Target:** production-ready. Not "good enough." Not "works on happy path." Production.
**Date:** 2026-05-04

---

## 1 — Layman summary

Cycle 13a ships the **operator's "second human on the team" surface** for Mingla Business. Today an organiser is functionally a single-user — anyone with the brand creator's auth.users.id row in `creator_accounts` can do everything. After Cycle 13a, the brand creator can invite team members at 6 distinct roles (account_owner / brand_admin / event_manager / finance_manager / marketing_manager / scanner), see who's on the team, see an audit log of recorded actions, and have the UI hide actions a team member's role can't perform on 7 high-traffic screens. UI-only TRANSITIONAL — emails + accept-flow ship in B-cycle. RLS server-side already enforces; mobile mirrors the same role-rank thresholds for show/hide UX.

---

## 2 — Operator + orchestrator-locked decisions (verbatim — DO NOT re-debate)

| # | Decision | Locked value |
|---|----------|--------------|
| 1 | Role count + canonical authority | **6 DB roles** (account_owner / brand_admin / event_manager / finance_manager / marketing_manager / scanner). PRD §11.1's "8 roles" reduced — "brand_owner" = account_owner-or-brand_admin context-dependent; "scanner_payment" = scanner role + `take_payments: true` boolean per Cycle 11/12. PRD doc-reconciliation note in §13. |
| 2 | F-1 scanner permissions shape mismatch | **DEFER to 13b.** Mobile keeps 3-key shape (canScan/canManualCheckIn/canAcceptPayments); DB stays 2-key (scan/take_payments). 13a does NOT write to DB scanner tables. |
| 3 | `permissions_override` jsonb editor | **DEFER to 13b.** 13a ships role-only enforcement; per-member overrides become useful once operators have 3+ team members with edge cases. Empty `{}` default stays untouched. |
| 4 | Team list location | **Brand-level only.** Route: `app/brand/[brandId]/team.tsx`. Accessed from Account screen → switch-brand-context → "Team" entry. NO account-level cross-brand team list in 13a. |
| 5 | Audit log writer scope | **Viewer-only with TRANSITIONAL banner.** Read-only viewer at `app/brand/[brandId]/audit-log.tsx`. NO mobile-side writes to audit_log in 13a. |

---

## 3 — Scope and non-goals

### 3.1 In-scope

- 1 NEW React Query hook: `useCurrentBrandRole(brandId)` reading `brand_team_members` for current `auth.uid()` with **account_owner synthesis fallback** for solo operators (creator_accounts.id === brand.account_id AND no brand_team_members row)
- 1 NEW persisted Zustand store: `useBrandTeamStore` mirroring Cycle 11 `useScannerInvitationsStore` TRANSITIONAL pattern
- 2 NEW components: `InviteBrandMemberSheet` + `RolePickerSheet` (mirror VisibilitySheet/AvailableAtSheet sub-sheet pattern)
- 2 NEW operator routes: `/brand/[brandId]/team` (J-T1 list + J-T2 detail-via-row + J-T3 invite-via-CTA + J-T4 remove-via-action) + `/brand/[brandId]/audit-log` (J-T5 read-only viewer)
- 2 NEW utilities: `src/utils/brandRole.ts` (BRAND_ROLE_RANK constants mirroring SQL biz_role_rank) + `src/utils/permissionGates.ts` (MIN_RANK action thresholds)
- 7 role-gate modifications on existing operator screens (J-T6)
- Account/Brand profile entry points: 2 new menu rows ("Team" + "Audit log")
- Logout cascade extension: `useBrandTeamStore.reset()` in `clearAllStores.ts`
- 2 NEW invariants ratified: I-31 (UI-only brand invitation TRANSITIONAL) + I-32 (mobile-RLS rank parity)
- PRD §11.1 reconciliation note (small inline doc fix)
- TRANSITIONAL banner on team list route + audit log viewer route + InviteBrandMemberSheet
- `/ui-ux-pro-max` pre-flight on 3 surfaces (J-T1 + J-T3 + J-T5) per PRD §11 DESIGN-PACKAGE-SILENT note + memory rule

### 3.2 Out-of-scope (explicit hard lines — do NOT touch)

- ❌ `permissions_override` jsonb editor (Q3 deferred to 13b)
- ❌ Account-level cross-brand team list (Q4 brand-level only)
- ❌ Mobile-side writes to audit_log (Q5 viewer-only)
- ❌ F-1 scanner permissions shape mismatch fix (Q2 deferred to 13b)
- ❌ `invite-brand-member` + `accept-brand-invitation` edge functions (B-cycle backend wire — 13a is UI-only TRANSITIONAL per I-31)
- ❌ Per-event role assignments for non-scanner roles (PRD §11.2 "restrict by event" — 13b scope)
- ❌ `permissions_matrix` table expansion or deprecation (D-CYCLE13-FOR-3 — 13b decision)
- ❌ Per-role detail explainer screens (one screen per role) — 13a ships shared "Roles explained" via RolePickerSheet read-only mode
- ❌ Email cascade on invite (TRANSITIONAL banner per I-31; emails ship B-cycle)
- ❌ Audit log search / filter / pagination (newest-first list only in 13a)
- ❌ Removing `permissions_matrix` table (defer 13b deprecation review)
- ❌ Modifying Cycle 11 InviteScannerSheet or scannerInvitationsStore logic (only update header doc continuity comment)
- ❌ Server-state in Zustand (useCurrentBrandRole MUST be React Query, not Zustand — Const #5)

### 3.3 Assumptions

- Cycle 12 (commit `8d457528`) shipped + live
- Cycle 11 (commit `ade877fb`) shipped + live — useScannerInvitationsStore + InviteScannerSheet pattern + I-28 in registry
- ORCH-0706 (commit `9d879ac2`) deployed live — PR #59 schema with brand_team_members / brand_invitations / permissions_matrix / audit_log tables exist on production DB with RLS + biz_role_rank function
- AuthContext exposes `user: User | null` only; no role concept fetched today
- `useCurrentBrandStore.activeBrandId` is the canonical "which brand am I currently operating on" source
- React Query is already wired in mingla-business (verify during IMPL pre-flight; if not, dispatch should add it as part of 13a)

---

## 4 — Per-layer specification

### 4.1 Database — none

PR #59 schema is LIVE + correct. No migrations.

### 4.2 Edge functions — none

No new edge functions. No deploys.

### 4.3 Service layer — none (Supabase reads inline in hook)

`useCurrentBrandRole(brandId)` reads `brand_team_members` directly via `supabase.from("brand_team_members").select(...).eq(...)`. RLS enforces server-side. No new service file needed.

### 4.4 NEW utility — `src/utils/brandRole.ts`

**File:** `mingla-business/src/utils/brandRole.ts` (NEW)

**Contract (verbatim):**

```ts
/**
 * Brand role hierarchy + helpers (Cycle 13a).
 *
 * I-32: BRAND_ROLE_RANK MUST mirror the SQL biz_role_rank() function values
 * verbatim. Any drift is a P0 — RLS server-side and mobile show/hide will
 * disagree. CI grep test asserts parity (see specs §11 regression prevention).
 *
 * Per Cycle 13a SPEC §4.4.
 */

export type BrandRole =
  | "account_owner"
  | "brand_admin"
  | "event_manager"
  | "finance_manager"
  | "marketing_manager"
  | "scanner";

/**
 * Rank values mirror SQL biz_role_rank() at
 * supabase/migrations/20260502100000_b1_business_schema_rls.sql:11-30.
 * Higher = more privilege. 0 = no membership.
 */
export const BRAND_ROLE_RANK = {
  scanner: 10,
  marketing_manager: 20,
  finance_manager: 30,
  event_manager: 40,
  brand_admin: 50,
  account_owner: 60,
} as const satisfies Record<BrandRole, number>;

export const NO_MEMBERSHIP_RANK = 0;

export const meetsRoleRank = (
  currentRank: number,
  requiredRank: number,
): boolean => currentRank >= requiredRank;

export const roleDisplayName = (role: BrandRole): string => {
  switch (role) {
    case "account_owner":
      return "Account owner";
    case "brand_admin":
      return "Brand admin";
    case "event_manager":
      return "Event manager";
    case "finance_manager":
      return "Finance manager";
    case "marketing_manager":
      return "Marketing manager";
    case "scanner":
      return "Scanner";
    default: {
      const _exhaust: never = role;
      return _exhaust;
    }
  }
};

export const roleDescription = (role: BrandRole): string => {
  switch (role) {
    case "account_owner":
      return "Full control of the account, brands, and billing.";
    case "brand_admin":
      return "Manage brand settings, team, events, and finances.";
    case "event_manager":
      return "Create and edit events; manage tickets and scanners.";
    case "finance_manager":
      return "View and refund orders; manage payouts.";
    case "marketing_manager":
      return "Edit brand profile and public pages.";
    case "scanner":
      return "Scan tickets at the door (event-scoped).";
    default: {
      const _exhaust: never = role;
      return _exhaust;
    }
  }
};
```

### 4.5 NEW utility — `src/utils/permissionGates.ts`

**File:** `mingla-business/src/utils/permissionGates.ts` (NEW)

**Contract (verbatim):**

```ts
/**
 * Per-action minimum role rank thresholds (Cycle 13a).
 *
 * Single chokepoint for all mobile UI gates. Mirrors RLS server-side checks
 * via biz_role_rank thresholds in the SECURITY DEFINER wrappers.
 *
 * I-32: thresholds MUST match RLS server-side enforcement. If RLS allows
 * an action, mobile MUST surface it (no UX dishonesty); if RLS blocks, mobile
 * MUST hide/disable (no dead taps per Const #1).
 *
 * Per Cycle 13a SPEC §4.5.
 */

import { BRAND_ROLE_RANK } from "./brandRole";

export const MIN_RANK = {
  // J-T6 gates (Cycle 13a)
  EDIT_EVENT: BRAND_ROLE_RANK.event_manager,             // 40
  EDIT_TICKET_PRICE: BRAND_ROLE_RANK.finance_manager,    // 30
  REFUND_ORDER: BRAND_ROLE_RANK.finance_manager,         // 30
  REFUND_DOOR_SALE: BRAND_ROLE_RANK.finance_manager,     // 30
  ADD_COMP_GUEST: BRAND_ROLE_RANK.event_manager,         // 40
  MANAGE_SCANNERS: BRAND_ROLE_RANK.event_manager,        // 40
  CREATE_EVENT: BRAND_ROLE_RANK.event_manager,           // 40
  // Team management gates (J-T1..J-T4)
  INVITE_TEAM_MEMBER: BRAND_ROLE_RANK.brand_admin,       // 50
  REMOVE_TEAM_MEMBER: BRAND_ROLE_RANK.brand_admin,       // 50
  REVOKE_INVITATION: BRAND_ROLE_RANK.brand_admin,        // 50
  VIEW_AUDIT_LOG: BRAND_ROLE_RANK.brand_admin,           // 50
  // 13b expansion targets (defined now for forward-compat; not used in 13a):
  EDIT_PERMISSIONS_OVERRIDE: BRAND_ROLE_RANK.brand_admin, // 50 — 13b
  ASSIGN_EVENT_MANAGER_TO_EVENT: BRAND_ROLE_RANK.brand_admin, // 50 — 13b
} as const;

export type GatedAction = keyof typeof MIN_RANK;

export const canPerformAction = (
  currentRank: number,
  action: GatedAction,
): boolean => currentRank >= MIN_RANK[action];

/**
 * Friendly disabled-state caption for a gated action.
 * Const #1 No dead taps — gated buttons disable WITH a caption explaining why.
 */
export const gateCaptionFor = (action: GatedAction): string => {
  const requiredRank = MIN_RANK[action];
  const requiredRoleName = (() => {
    if (requiredRank >= BRAND_ROLE_RANK.account_owner) return "account owner";
    if (requiredRank >= BRAND_ROLE_RANK.brand_admin) return "brand admin or above";
    if (requiredRank >= BRAND_ROLE_RANK.event_manager) return "event manager or above";
    if (requiredRank >= BRAND_ROLE_RANK.finance_manager) return "finance manager or above";
    return "team member";
  })();
  return `Your role doesn't include this action. Ask a ${requiredRoleName}.`;
};
```

### 4.6 NEW hook — `useCurrentBrandRole(brandId)`

**File:** `mingla-business/src/hooks/useCurrentBrandRole.ts` (NEW)

**Contract (verbatim):**

```ts
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import {
  BRAND_ROLE_RANK,
  NO_MEMBERSHIP_RANK,
  type BrandRole,
} from "../utils/brandRole";

export interface CurrentBrandRoleState {
  role: BrandRole | null;
  rank: number;
  permissionsOverride: Record<string, unknown>;
  isLoading: boolean;
  isError: boolean;
}

const STALE_TIME_MS = 5 * 60 * 1000; // 5 min — role changes are rare

export const brandRoleKeys = {
  all: ["brand-role"] as const,
  byBrand: (brandId: string, userId: string) =>
    [...brandRoleKeys.all, brandId, userId] as const,
};

export const useCurrentBrandRole = (
  brandId: string | null,
): CurrentBrandRoleState => {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const enabled = brandId !== null && userId !== null;

  const { data, isLoading, isError } = useQuery({
    queryKey: enabled ? brandRoleKeys.byBrand(brandId!, userId!) : ["brand-role-disabled"],
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<{
      role: BrandRole | null;
      permissionsOverride: Record<string, unknown>;
    }> => {
      if (!enabled) {
        return { role: null, permissionsOverride: {} };
      }
      // Step 1: try brand_team_members for active row
      const { data: memberRow, error: memberErr } = await supabase
        .from("brand_team_members")
        .select("role, permissions_override")
        .eq("brand_id", brandId)
        .eq("user_id", userId)
        .is("removed_at", null)
        .maybeSingle();
      if (memberErr) throw memberErr;
      if (memberRow !== null) {
        return {
          role: memberRow.role as BrandRole,
          permissionsOverride:
            (memberRow.permissions_override as Record<string, unknown>) ?? {},
        };
      }
      // Step 2: account_owner synthesis fallback for solo operators
      const { data: brandRow, error: brandErr } = await supabase
        .from("brands")
        .select("account_id")
        .eq("id", brandId)
        .maybeSingle();
      if (brandErr) throw brandErr;
      if (brandRow === null) {
        return { role: null, permissionsOverride: {} };
      }
      const { data: accountRow, error: accountErr } = await supabase
        .from("creator_accounts")
        .select("user_id")
        .eq("id", brandRow.account_id)
        .maybeSingle();
      if (accountErr) throw accountErr;
      if (accountRow !== null && accountRow.user_id === userId) {
        return { role: "account_owner", permissionsOverride: {} };
      }
      return { role: null, permissionsOverride: {} };
    },
  });

  const role = data?.role ?? null;
  const rank = role !== null ? BRAND_ROLE_RANK[role] : NO_MEMBERSHIP_RANK;
  const permissionsOverride = data?.permissionsOverride ?? {};

  return { role, rank, permissionsOverride, isLoading, isError };
};
```

**Cache invalidation:** `useBrandTeamStore.recordInvitation` / `revokeInvitation` / `removeAcceptedMember` mutations invalidate `brandRoleKeys.byBrand(brandId, userId)` for any affected user. SPEC writer can lock the exact invalidation pattern in IMPL phase; default is broad invalidation `queryClient.invalidateQueries({ queryKey: brandRoleKeys.all })` since it's bounded.

**Error handling:** `isError` propagates to the gate consumer. Failed fetch → consumer treats as `rank: 0` (no membership) → all actions blocked → defensive fail-closed posture.

### 4.7 NEW Zustand store — `useBrandTeamStore`

**File:** `mingla-business/src/store/brandTeamStore.ts` (NEW)

**Persist config:**
- Key: `mingla-business.brandTeamStore.v1`
- Version: 1
- Storage: AsyncStorage
- Partialize: `(s) => ({ entries: s.entries })`

**Type definitions (verbatim required):**

```ts
import type { BrandRole } from "../utils/brandRole";

export type BrandTeamEntryStatus = "pending" | "accepted" | "removed";

export interface BrandTeamEntry {
  /** btm_<base36-ts>_<base36-rand4> for accepted; bti_<...> for pending. */
  id: string;
  brandId: string;
  inviteeEmail: string;
  inviteeName: string;
  role: BrandRole;
  status: BrandTeamEntryStatus;
  invitedBy: string;        // operator account_id
  invitedAt: string;        // ISO 8601
  acceptedAt: string | null;
  removedAt: string | null;
}

export interface BrandTeamStoreState {
  entries: BrandTeamEntry[];
  // Mutations
  recordInvitation: (
    entry: Omit<
      BrandTeamEntry,
      "id" | "invitedAt" | "status" | "acceptedAt" | "removedAt"
    >,
  ) => BrandTeamEntry;
  revokeInvitation: (id: string) => BrandTeamEntry | null;
  removeAcceptedMember: (id: string) => BrandTeamEntry | null;
  reset: () => void;
  // Selectors
  /** Single existing reference — safe to subscribe directly. */
  getEntryById: (id: string) => BrandTeamEntry | null;
  /** Fresh array — USE VIA .getState() ONLY for one-shot lookups; for component reads use raw entries + useMemo. */
  getEntriesForBrand: (brandId: string) => BrandTeamEntry[];
}
```

**ID generators:**

```ts
const generateInviteId = (): string => {
  const ts36 = Date.now().toString(36);
  const rand4 = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, "0");
  return `bti_${ts36}_${rand4}`;
};

const generateAcceptedId = (): string => {
  const ts36 = Date.now().toString(36);
  const rand4 = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, "0");
  return `btm_${ts36}_${rand4}`;
};
```

**Mutation contracts:**

```ts
recordInvitation: (entry): BrandTeamEntry => {
  const newEntry: BrandTeamEntry = {
    ...entry,
    id: generateInviteId(),
    invitedAt: new Date().toISOString(),
    status: "pending",
    acceptedAt: null,
    removedAt: null,
  };
  set((s) => ({ entries: [newEntry, ...s.entries] }));
  return newEntry;
},

revokeInvitation: (id): BrandTeamEntry | null => {
  const existing = get().entries.find((e) => e.id === id);
  if (existing === undefined) return null;
  if (existing.status !== "pending") return existing; // idempotent
  const updated: BrandTeamEntry = {
    ...existing,
    status: "removed",
    removedAt: new Date().toISOString(),
  };
  set((s) => ({
    entries: s.entries.map((e) => (e.id === id ? updated : e)),
  }));
  return updated;
},

removeAcceptedMember: (id): BrandTeamEntry | null => {
  const existing = get().entries.find((e) => e.id === id);
  if (existing === undefined) return null;
  if (existing.status !== "accepted") return existing; // idempotent
  const updated: BrandTeamEntry = {
    ...existing,
    status: "removed",
    removedAt: new Date().toISOString(),
  };
  set((s) => ({
    entries: s.entries.map((e) => (e.id === id ? updated : e)),
  }));
  return updated;
},
```

**Selector rules:** mirror Cycle 9c v2 + Cycle 12 SPEC §4.5 patterns. `getEntryById` safe to subscribe; `getEntriesForBrand` USE VIA `.getState()` ONLY; component reads use raw entries + useMemo.

**[TRANSITIONAL] header (verbatim required):**

```ts
/**
 * brandTeamStore — persisted Zustand store for brand-team invitations + accepted members (Cycle 13a).
 *
 * I-31: UI-ONLY in Cycle 13a. recordInvitation creates a pending invitation
 * in client-side store; NO email is sent, NO acceptance flow exists, NO
 * functional brand-team-member sync to brand_team_members DB table.
 *
 * [TRANSITIONAL] EXIT CONDITION: B-cycle wires:
 *   - edge function `invite-brand-member` (writes to brand_invitations + sends Resend email)
 *   - edge function `accept-brand-invitation` (writes to brand_team_members on token-gated route)
 *
 * When backend lands, this store contracts to a cache (or removes entirely
 * if backend is sole authority).
 *
 * Constitutional notes:
 *   - #2 one owner per truth: brand-team UI invitations live ONLY here.
 *   - #6 logout clears: extended via clearAllStores.
 *   - #9 no fabricated data: store starts EMPTY; never seeded.
 *
 * Per Cycle 13a SPEC §4.7.
 */
```

**Logout cascade:** Add to `src/utils/clearAllStores.ts`:
```ts
useBrandTeamStore.getState().reset();
```

### 4.8 NEW component — `RolePickerSheet`

**File:** `mingla-business/src/components/team/RolePickerSheet.tsx` (NEW)

**Pattern:** mirror Cycle 5 `VisibilitySheet` + Cycle 12 `AvailableAtSheet` verbatim. 6 options with description sub-line per role from `roleDescription()` helper.

**Props:**

```ts
export interface RolePickerSheetProps {
  visible: boolean;
  current: BrandRole;
  /** When true, render as info-only "Roles explained" reference (no select action). */
  readOnly?: boolean;
  onClose: () => void;
  onSelect: (role: BrandRole) => void;
}
```

**Layout:**
- Title: "Pick a role" (or "Roles explained" if `readOnly`)
- 6 rows in rank order (highest first per UX convention): account_owner / brand_admin / event_manager / finance_manager / marketing_manager / scanner
- Each row: `roleDisplayName(role)` + `roleDescription(role)` sub-line
- Active row (current selection) gets `accent.warm` tint + check icon (when not readOnly)
- "Got it" CTA at bottom when `readOnly` mode

**Memory rule `feedback_rn_color_formats`:** hex/rgb/rgba/hsl ONLY. No oklch/lab/lch/color-mix.

### 4.9 NEW component — `InviteBrandMemberSheet`

**File:** `mingla-business/src/components/team/InviteBrandMemberSheet.tsx` (NEW)

**Pattern:** generalize Cycle 11 `InviteScannerSheet`. Replace 2 boolean toggles with role picker (sub-sheet pattern).

**Props:**

```ts
export interface InviteBrandMemberSheetProps {
  visible: boolean;
  brandId: string;
  brandName: string;
  operatorAccountId: string;
  onClose: () => void;
  onSuccess: (entry: BrandTeamEntry) => void;
}
```

**Internal state:**
```ts
const [name, setName] = useState<string>("");
const [email, setEmail] = useState<string>("");
const [role, setRole] = useState<BrandRole>("event_manager"); // sensible default
const [rolePickerVisible, setRolePickerVisible] = useState<boolean>(false);
const [submitting, setSubmitting] = useState<boolean>(false);
```

**Layout (top to bottom):**
1. Title: "Invite team member"
2. Subhead: "{brandName} team. They'll get access when emails ship in B-cycle."
3. **TRANSITIONAL banner** (verbatim per Cycle 11 ORCH-0711 + Cycle 12 TESTING MODE pattern):
   > "Testing mode — invitations are stored locally for now. Emails ship in B-cycle."
4. Name field (required, 1..120 chars; email-style validation off)
5. Email field (required, valid email format, 1..200 chars)
6. Role picker row (Pressable opening RolePickerSheet; default `event_manager`):
   - Row label: "Role"
   - Row value: `roleDisplayName(role)` + chev-down icon
   - Tap opens RolePickerSheet
7. "Roles explained" link (text-link style at bottom of role row, opens RolePickerSheet in `readOnly` mode)
8. Sticky bottom: "Send invitation" + "Cancel" CTAs

**Validation:**
```ts
const trimmedNameLen = name.trim().length;
const nameValid = trimmedNameLen >= 1 && trimmedNameLen <= 120;
const emailValid = isValidEmail(email);
const isValid = nameValid && emailValid;
const canSubmit = !submitting && isValid;
```

**Confirm handler:**
```ts
const handleConfirm = useCallback(async (): Promise<void> => {
  if (!canSubmit) return;
  setSubmitting(true);
  try {
    await sleep(600);
    const newEntry = useBrandTeamStore.getState().recordInvitation({
      brandId,
      inviteeEmail: email.trim().toLowerCase(),
      inviteeName: name.trim(),
      role,
      invitedBy: operatorAccountId,
    });
    onSuccess(newEntry);
  } finally {
    setSubmitting(false);
  }
}, [canSubmit, email, name, role, brandId, operatorAccountId, onSuccess]);
```

**Memory rule `feedback_keyboard_never_blocks_input`:** ScrollView honors `keyboardShouldPersistTaps="handled"` + `keyboardDismissMode="on-drag"` + `automaticallyAdjustKeyboardInsets`.

**`/ui-ux-pro-max` pre-flight required** (DESIGN-PACKAGE-SILENT per PRD §11):
```bash
python .claude/skills/ui-ux-pro-max/scripts/search.py "role picker segmented control invite team member sheet sub-sheet dark glass" --domain product
```

### 4.10 NEW route — `app/brand/[brandId]/team.tsx` (J-T1 + J-T2 + J-T3 + J-T4)

**File:** `mingla-business/app/brand/[brandId]/team.tsx` (NEW)

**Layout:**
1. Chrome (back to Brand profile + "Team" title + "+" CTA gated on `useCurrentBrandRole().rank >= MIN_RANK.INVITE_TEAM_MEMBER`)
2. **TRANSITIONAL banner** (always visible, not dismissible) — same copy as InviteBrandMemberSheet's
3. **Section: Pending invitations** (newest-first)
   - Title: "PENDING INVITATIONS"
   - Empty when `pending.length === 0` — section hidden
   - Per-row: avatar (initials) + name + email + role pill (`roleDisplayName(role)`) + relative time + tap → opens MemberDetailSheet
4. **Section: Active members** (newest-first)
   - Title: "ACTIVE MEMBERS"
   - Synthetically includes the operator self entry (rendered from `useCurrentBrandRole()` result) at top
   - Per-row: avatar + name + email + role pill + tap → opens MemberDetailSheet
5. Empty state when `pending.length === 0 && accepted.length === 0`:
   *"You're working solo. Tap + to invite a team member."* + EmptyState illustration

**Data sources:**
```ts
const allEntries = useBrandTeamStore((s) => s.entries);
const pendingEntries = useMemo(
  () =>
    allEntries
      .filter((e) => e.brandId === brandId && e.status === "pending")
      .sort((a, b) => new Date(b.invitedAt).getTime() - new Date(a.invitedAt).getTime()),
  [allEntries, brandId],
);
const acceptedEntries = useMemo(
  () =>
    allEntries
      .filter((e) => e.brandId === brandId && e.status === "accepted")
      .sort((a, b) => new Date(b.acceptedAt!).getTime() - new Date(a.acceptedAt!).getTime()),
  [allEntries, brandId],
);
```

**Action gating per row:**
- Pending row tap → MemberDetailSheet shows "Revoke invitation" CTA gated on `MIN_RANK.REVOKE_INVITATION`
- Accepted row tap → MemberDetailSheet shows "Remove from team" CTA gated on `MIN_RANK.REMOVE_TEAM_MEMBER`

**`/ui-ux-pro-max` pre-flight:**
```bash
python .claude/skills/ui-ux-pro-max/scripts/search.py "operator team management member list role pills invite dark glass" --domain product
```

### 4.11 NEW component — `MemberDetailSheet` (J-T2 + J-T4)

**File:** `mingla-business/src/components/team/MemberDetailSheet.tsx` (NEW)

**Props:**
```ts
export interface MemberDetailSheetProps {
  visible: boolean;
  entry: BrandTeamEntry;
  onClose: () => void;
  onRevoke?: (entry: BrandTeamEntry) => void;
  onRemove?: (entry: BrandTeamEntry) => void;
}
```

**Layout:**
1. Title: `entry.inviteeName`
2. Subhead: `entry.inviteeEmail`
3. Role pill: `roleDisplayName(entry.role)`
4. Status row: pending → "Invitation sent {relativeTime}"; accepted → "Joined {relativeTime}"
5. Description: `roleDescription(entry.role)` (info card)
6. **Action button** (gated):
   - Pending: "Revoke invitation" (destructive variant); disabled-with-caption if `currentRank < MIN_RANK.REVOKE_INVITATION`
   - Accepted: "Remove from team" (destructive variant); disabled-with-caption if `currentRank < MIN_RANK.REMOVE_TEAM_MEMBER`
7. "Cancel" ghost CTA

Confirm via simple confirm dialog (existing primitive); no reasoned confirm.

### 4.12 NEW route — `app/brand/[brandId]/audit-log.tsx` (J-T5)

**File:** `mingla-business/app/brand/[brandId]/audit-log.tsx` (NEW)

**Route gate:** the entire route checks `useCurrentBrandRole().rank >= MIN_RANK.VIEW_AUDIT_LOG` (= 50). If insufficient, render an EmptyState: *"Insufficient permissions."* with back action.

**Layout:**
1. Chrome (back to Brand profile + "Audit log" title)
2. **TRANSITIONAL banner** (verbatim):
   > "Audit log fills as the backend wires server-side recording in B-cycle. Some actions logged here today; full coverage is the goal."
3. List of audit_log rows (newest-first), filtered by `brandId`
4. Per-row card:
   - Action label (e.g., "order.refund", "brand.invite")
   - target_type + target_id slice (last 6 chars)
   - Actor name (resolved via creator_accounts join — see §4.13)
   - Relative time
5. Empty state (likely default since DB is empty):
   *"No audit entries yet. Acted-on items show up here as the backend wires server-side recording."*

**Data fetch:** `useAuditLog(brandId)` React Query hook (NEW — co-located inside route file or separate file `src/hooks/useAuditLog.ts`):

```ts
export const auditLogKeys = {
  all: ["audit-log"] as const,
  byBrand: (brandId: string) => [...auditLogKeys.all, brandId] as const,
};

export const useAuditLog = (brandId: string | null) => {
  return useQuery({
    queryKey: brandId ? auditLogKeys.byBrand(brandId) : ["audit-log-disabled"],
    enabled: brandId !== null,
    staleTime: 60 * 1000, // 1 min
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("id, user_id, action, target_type, target_id, created_at")
        .eq("brand_id", brandId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
};
```

**RLS note:** existing policy `"Users can read own audit_log rows"` filters to `user_id = auth.uid()`. **For Cycle 13a brand-admin-can-read-all-rows-for-brand semantics, a NEW RLS policy is needed.** SPEC writer flags this: implementor adds a brand-admin SELECT policy in 13a SPEC, OR (preferred) the implementor confirms with operator that the existing self-only policy is sufficient for v1 (users see their own actions only). Recommend: ship with existing self-only policy in 13a + flag for 13b enhancement (brand-admin-sees-all). Updates the route's empty state copy: *"You can see your own audit entries. Brand-wide audit visibility for admins lands in 13b."*

**`/ui-ux-pro-max` pre-flight:**
```bash
python .claude/skills/ui-ux-pro-max/scripts/search.py "operator audit log timeline append-only history viewer dark glass" --domain product
```

### 4.13 Actor name resolution helper

**Decision deferred:** join via separate query OR PostgREST nested embed. Implementor's call. SPEC requires actor name renders as a readable string OR falls back to `user_id` slice; never blank. Pre-flight may suggest one or the other based on RLS constraints (creator_accounts has its own RLS — verify joins work for non-self rows). Defensive: if join blocked, render last-6 chars of `user_id` with mono font.

### 4.14 Entry points: account/brand profile menu rows (MOD)

**File:** `mingla-business/app/(tabs)/account.tsx` (or wherever the brand-context menu currently lives — implementor verifies during pre-flight)

**Add 2 rows:**
- **"Team"** — links to `/brand/{activeBrandId}/team`
  - Visible to all roles (rank-gated content surfaces inside)
- **"Audit log"** — links to `/brand/{activeBrandId}/audit-log`
  - Visible only when `useCurrentBrandRole().rank >= MIN_RANK.VIEW_AUDIT_LOG`

Pattern: standard list-item rows mirroring existing menu entries.

### 4.15 Role gates (J-T6) — 7 surfaces (MOD)

Each gate uses the pattern:

```tsx
const { rank } = useCurrentBrandRole(brandId);
const canEdit = canPerformAction(rank, "EDIT_EVENT");

// In JSX:
{!canEdit ? (
  <Button label="Edit event" disabled accessibilityHint={gateCaptionFor("EDIT_EVENT")} />
) : (
  <Button label="Edit event" onPress={handleEdit} />
)}
```

**Locked gate set (verbatim):**

| # | File | Gate target | Action constant |
|---|------|-------------|-----------------|
| G1 | `mingla-business/app/event/[id]/index.tsx` | "Edit event" CTA + Lifecycle actions (End sales / Cancel event) | `EDIT_EVENT` |
| G2 | `mingla-business/src/components/event/EditPublishedScreen.tsx` Step 5 ticket price field | Ticket price edit (TextInput `editable={canEdit}`) | `EDIT_TICKET_PRICE` |
| G3 | `mingla-business/src/components/orders/RefundSheet.tsx` Confirm CTA | Refund online order | `REFUND_ORDER` |
| G4 | `mingla-business/src/components/door/DoorRefundSheet.tsx` Confirm CTA | Refund door sale | `REFUND_DOOR_SALE` |
| G5 | `mingla-business/src/components/guests/AddCompGuestSheet.tsx` Confirm CTA | Comp guest add | `ADD_COMP_GUEST` |
| G6 | `mingla-business/app/event/[id]/scanners/index.tsx` invite + revoke | Scanner team management | `MANAGE_SCANNERS` |
| G7 | `mingla-business/app/(tabs)/events.tsx` "Create event" CTA | Create new event | `CREATE_EVENT` |

**Pattern (mandatory):** disabled-with-caption (Const #1). Each TextInput / Pressable gets `editable={canPerform}` / `disabled={!canPerform}` + when disabled, render `gateCaptionFor(action)` near the control as inline copy OR (for buttons) as a tooltip/accessibility hint.

**For G2:** the Step 5 ticket sheet has multiple fields. ONLY the `priceText` TextInput gets gated. Other fields (name, capacity, modifiers, available-at picker, etc.) stay editable for `event_manager+`. The price field's helper hint reads (when gated):
*"You can't change ticket prices with your current role. A finance manager or above can."*

### 4.16 PRD §11.1 reconciliation note (MOD)

**File:** `Mingla_Artifacts/BUSINESS_PRD.md` lines 659-668 (the §11.1 list)

Add a small note immediately after the role list:

```markdown
> **Note (added 2026-05-04 per Cycle 13a SPEC §2):** the canonical role enum
> shipped in PR #59 has 6 roles (account_owner, brand_admin, event_manager,
> finance_manager, marketing_manager, scanner). PRD's "Brand owner" reads as
> account_owner-or-brand_admin context-dependent (not a separate role);
> PRD's "Scanner payment permissions" lives as the `take_payments` boolean
> on the scanner role's permissions jsonb (Cycle 11 + 12 surface). No DB
> migration needed.
```

### 4.17 Cycle 11 doc continuity (MOD)

**File:** `mingla-business/src/store/scannerInvitationsStore.ts` header

Append to existing TRANSITIONAL header:

```ts
/**
 * ...existing header...
 *
 * Cycle 13a continuity: the brand-team-member equivalent of this scanner
 * invitation pattern ships at src/store/brandTeamStore.ts (Cycle 13a SPEC
 * §4.7). Both stores follow the I-28/I-31 TRANSITIONAL UI-only pattern
 * until B-cycle wires the corresponding edge functions.
 */
```

NO code change.

---

## 5 — Six journeys (J-T1..J-T6 — full per-journey detail)

### J-T1 — Team list view

**Route:** `/brand/{brandId}/team`
**File:** `mingla-business/app/brand/[brandId]/team.tsx` (NEW per §4.10)

Operator opens from Account screen → "Team" row. Sees TRANSITIONAL banner + sections (Pending Invitations + Active Members). Self renders synthetically at top of Active Members. Tap "+" CTA opens InviteBrandMemberSheet (gated). Tap row opens MemberDetailSheet.

**States:**
- Loading: skeleton (use existing skeleton primitive)
- Error: error toast + retry CTA
- Empty: "You're working solo. Tap + to invite a team member."
- Populated: section headers + rows
- Submitting (during invite): sheet handles its own state

### J-T2 — Member detail sheet

**Component:** `MemberDetailSheet` (§4.11). Opens from row tap. Shows member info + gated revoke/remove CTA + role description.

### J-T3 — Invite member flow

**Component:** `InviteBrandMemberSheet` (§4.9) + `RolePickerSheet` (§4.8). Opens from team list "+" CTA. Operator fills name + email + role → submits → entry appears in Pending section + toast.

### J-T4 — Remove member / revoke invitation

Both flows go through MemberDetailSheet. Confirm via existing ConfirmDialog primitive. On confirm → `useBrandTeamStore.revokeInvitation(id)` or `removeAcceptedMember(id)` → entry status flips to "removed" + entry hidden from team list (UI filter excludes status="removed"). Toast confirms.

### J-T5 — Audit log viewer

**Route:** `/brand/{brandId}/audit-log`
**File:** `mingla-business/app/brand/[brandId]/audit-log.tsx` (NEW per §4.12)

Route-gated to `MIN_RANK.VIEW_AUDIT_LOG` (50, brand_admin+). Visible only via brand-context menu when gate satisfied. Shows TRANSITIONAL banner + newest-first list (capped at 100). Empty state surfaces today (DB empty until B-cycle writers wire).

### J-T6 — Role gates on existing operator screens

7 surfaces per §4.15. Each follows the disabled-with-caption pattern. UI shows clear "Your role doesn't include this action. Ask a {required role}" copy.

---

## 6 — Success criteria (SC-1..SC-30)

| SC | Description |
|----|-------------|
| SC-1 | Operator (account_owner via synthesis) opens `/brand/{brandId}/team` → sees TRANSITIONAL banner + empty state "You're working solo." with no errors |
| SC-2 | Operator taps "+" CTA → InviteBrandMemberSheet opens with TRANSITIONAL banner visible |
| SC-3 | InviteBrandMemberSheet role picker default = `event_manager`; tapping role row opens RolePickerSheet with 6 options + descriptions |
| SC-4 | "Roles explained" link in InviteBrandMemberSheet opens RolePickerSheet in `readOnly` mode (no select action; "Got it" CTA) |
| SC-5 | Operator submits invite (name="Tunde Test", email="tunde@example.com", role="event_manager") → entry appears in Pending Invitations with role pill + relative time |
| SC-6 | After SC-5: useBrandTeamStore.entries has 1 entry with status="pending", id="bti_xxx", correct fields |
| SC-7 | Operator taps the pending row → MemberDetailSheet opens with name/email/role/description/Revoke CTA |
| SC-8 | Operator taps "Revoke invitation" (gated; brand_admin+ only) → confirm dialog → confirm → entry status flips to "removed", entry disappears from team list, toast confirms |
| SC-9 | Operator below brand_admin (e.g., event_manager) does NOT see "+" CTA on team list (hidden, not just disabled — Const #1 + Const #8 subtract before adding) |
| SC-10 | Operator below brand_admin tapping a row opens MemberDetailSheet with Revoke CTA disabled-with-caption "Your role doesn't include this action. Ask a brand admin or above." |
| SC-11 | Operator below `MIN_RANK.VIEW_AUDIT_LOG` does NOT see "Audit log" entry in account/brand menu |
| SC-12 | Operator at brand_admin+ sees "Audit log" entry → tap → audit log route opens with TRANSITIONAL banner + empty state copy |
| SC-13 | Audit log RLS allows users to read their own actions; operator below brand_admin who somehow accesses route via deep link sees "Insufficient permissions" empty state (route-level gate fires) |
| SC-14 | G1 — non-event_manager+ user does NOT see "Edit event" CTA on Event Detail (or sees disabled-with-caption per `gateCaptionFor("EDIT_EVENT")`) |
| SC-15 | G2 — non-finance_manager+ user has Step 5 ticket price TextInput as `editable={false}` with helper hint "You can't change ticket prices with your current role. A finance manager or above can." |
| SC-16 | G3 — non-finance_manager+ user sees Cycle 9c RefundSheet Confirm CTA disabled-with-caption |
| SC-17 | G4 — non-finance_manager+ user sees Cycle 12 DoorRefundSheet Confirm CTA disabled-with-caption |
| SC-18 | G5 — non-event_manager+ user sees AddCompGuestSheet Confirm CTA disabled-with-caption |
| SC-19 | G6 — non-event_manager+ user does NOT see scanner invite/revoke surfaces |
| SC-20 | G7 — non-event_manager+ user does NOT see "Create event" CTA on events tab |
| SC-21 | useCurrentBrandRole synthesis fallback works: brand creator with no brand_team_members row + their auth.uid() === creator_accounts.user_id of brand.account_id → returns `role: "account_owner"`, rank: 60 |
| SC-22 | useCurrentBrandRole returns `role: null, rank: 0` for users with no brand_team_members row AND no creator_accounts ownership match (defensive fail-closed) |
| SC-23 | Logout cascade: useBrandTeamStore.entries === [] post-logout (Const #6) |
| SC-24 | Cold-start hydration: pending invitation persists across app restart (Const #14) |
| SC-25 | Cross-brand scoping: invitation on Brand A does NOT appear in Brand B's team list (filter by brandId) |
| SC-26 | tsc clean across mingla-business workspace (filtered router.d.ts noise + 2 pre-existing Phase 1 errors) |
| SC-27 | I-32 grep parity: BRAND_ROLE_RANK numeric values match SQL biz_role_rank() values verbatim (CI grep test) |
| SC-28 | Selector pattern grep clean: `useBrandTeamStore((s) => s.getEntriesForBrand(...))` returns 0 hits (banned direct subscription) |
| SC-29 | TRANSITIONAL labels honored: brandTeamStore [TRANSITIONAL] header + InviteBrandMemberSheet banner + team list banner + audit log banner copy verbatim per spec |
| SC-30 | PRD §11.1 reconciliation note added (BUSINESS_PRD.md grep verifies the new note exists) |

---

## 7 — Test matrix (T-01..T-40)

| T | Scenario | Input | Expected | Layer |
|---|----------|-------|----------|-------|
| T-01 | Empty team list (solo operator) | brandId, no team rows | Empty state with "+" CTA visible | Route + Hook |
| T-02 | Open invite sheet | Tap "+" | InviteBrandMemberSheet opens with banner | Component |
| T-03 | Role picker default | Open invite sheet | Role row reads "Event manager" | Component |
| T-04 | Role picker selection | Tap role → select brand_admin → Save | Invite sheet shows "Brand admin" | Component |
| T-05 | Roles explained link | Tap "Roles explained" | RolePickerSheet opens in readOnly mode with "Got it" CTA | Component |
| T-06 | Submit valid invite | Name="Tunde", Email="tunde@x.com", Role="event_manager" | Entry created with status=pending; toast | Full stack |
| T-07 | Submit invalid email | Name="Tunde", Email="invalid", Role="event_manager" | Confirm CTA disabled; inline error visible | Component |
| T-08 | Submit empty name | Name="", Email="x@y.com", Role="event_manager" | Confirm disabled | Component |
| T-09 | Pending row tap | Tap a pending row | MemberDetailSheet opens with Revoke CTA | Component |
| T-10 | Revoke pending (admin+) | Confirm in dialog | Status flips to removed; entry disappears; toast | Store + UI |
| T-11 | Revoke pending (below admin) | Open MemberDetailSheet as event_manager | Revoke CTA disabled-with-caption | UI gate |
| T-12 | Active member synthesis | Solo operator opens team list | Self appears in Active Members section as account_owner | Hook |
| T-13 | Audit log route gate | Open as event_manager via deep link | "Insufficient permissions" empty state | Route gate |
| T-14 | Audit log empty state | Open as brand_admin (DB empty) | "No audit entries yet..." copy + TRANSITIONAL banner | Route |
| T-15 | Audit log row render (when populated) | Single row in DB | Action label + target + actor name + relative time | Hook + Route |
| T-16 | G1 EditEvent gate (above) | event_manager opens Event Detail | Edit CTA visible + tappable | UI gate |
| T-17 | G1 EditEvent gate (below) | scanner opens Event Detail | Edit CTA hidden or disabled-with-caption | UI gate |
| T-18 | G2 TicketPrice gate (above) | finance_manager opens Step 5 | Price field editable=true | UI gate |
| T-19 | G2 TicketPrice gate (below) | event_manager opens Step 5 | Price field editable=false + helper hint | UI gate |
| T-20 | G3 RefundOrder gate (above) | finance_manager opens RefundSheet | Confirm CTA enabled | UI gate |
| T-21 | G3 RefundOrder gate (below) | event_manager opens RefundSheet | Confirm CTA disabled-with-caption | UI gate |
| T-22 | G4 RefundDoorSale gate | Same as G3 but DoorRefundSheet | Same behavior | UI gate |
| T-23 | G5 AddCompGuest gate (above) | event_manager opens AddCompGuestSheet | Confirm enabled | UI gate |
| T-24 | G5 AddCompGuest gate (below) | scanner opens (not normally accessible but defensive check) | Confirm disabled-with-caption | UI gate |
| T-25 | G6 ManageScanners gate | event_manager+ vs below | Invite + revoke visible/hidden accordingly | UI gate |
| T-26 | G7 CreateEvent gate (above) | event_manager+ on events tab | "Create event" CTA visible | UI gate |
| T-27 | G7 CreateEvent gate (below) | scanner on events tab | "Create event" CTA hidden | UI gate |
| T-28 | Synthesis fallback works | Solo operator login + open team list | useCurrentBrandRole returns account_owner role/rank=60 | Hook |
| T-29 | Synthesis fallback fails defensively | Non-owner user with no brand_team_members row | rank=0 / all gates closed | Hook |
| T-30 | Cold-start hydration | Invite + kill app + reopen | Pending invitation still in team list | Persist |
| T-31 | Logout clears | Sign out + sign in | useBrandTeamStore.entries === [] | Const #6 |
| T-32 | Cross-brand scoping | Invite on Brand A + open Brand B team list | Brand B list does not show Brand A invite | Selector |
| T-33 | tsc clean | `npx tsc --noEmit` | Exit 0 (filtered) | Static |
| T-34 | I-32 grep parity | `grep biz_role_rank supabase/migrations/*.sql` + compare to BRAND_ROLE_RANK | Numeric values match exactly | CI |
| T-35 | Selector pattern grep | `grep -rE "useBrandTeamStore\(\(s\) => s\.getEntries"` | 0 hits (banned subscription) | Memory rule |
| T-36 | RN color formats grep | `grep -rE "oklch\|lab\(\|lch\(\|color-mix"` on new files | 0 hits | Memory rule |
| T-37 | TRANSITIONAL labels grep | Scan brandTeamStore + InviteBrandMemberSheet + team route + audit route | All 4 markers present with EXIT conditions | Const #7 |
| T-38 | I-31 compliance grep | Confirm no edge function call from brandTeamStore | 0 hits | I-31 |
| T-39 | PRD §11.1 reconciliation note | grep BUSINESS_PRD.md for "canonical role enum shipped in PR #59" | 1+ hits | Doc fix |
| T-40 | UI gate error path | RLS denies on direct attempt (e.g., bypass via direct supabase call) | useCurrentBrandRole.isError=true → all gates closed (defensive) | Hook |

---

## 8 — Invariants

### 8.1 Existing invariants this cycle preserves

| ID | Statement | How preserved | Test |
|----|-----------|---------------|------|
| I-17 | Brand-slug stability — DB-enforced | No slug touches in 13a | Code review |
| I-21 | Anon-tolerant buyer routes | All Cycle 13a surfaces are operator-side `app/brand/`; no buyer surface change | T-33 |
| I-24 | audit_log Option B append-only carve-out | 13a viewer is read-only; no INSERT/UPDATE/DELETE attempts | Route review |
| I-28 | UI-only scanner invitation flow until B-cycle | Cycle 13a doesn't change Cycle 11 logic; only doc continuity comment update | T-37 |

### 8.2 NEW invariants 13a establishes

#### I-31 — Brand-team-member invitation UI is TRANSITIONAL until B-cycle

**Statement:** Cycle 13a's `useBrandTeamStore.recordInvitation` creates a pending invitation in client-side persisted store ONLY. NO email is sent. NO acceptance flow exists. NO functional sync to `brand_team_members` DB table. Mirrors I-28 verbatim for brand invitations. EXIT condition: B-cycle wires `invite-brand-member` + `accept-brand-invitation` edge functions.

**Origin:** Cycle 13a (2026-05-04)
**Enforcement:** [TRANSITIONAL] header on store + visible TRANSITIONAL banner on team list route + on InviteBrandMemberSheet + on audit log route. T-38 grep test asserts no edge function calls.

#### I-32 — Mobile UI gates MUST mirror RLS role-rank semantics

**Statement:** Mobile-side rank thresholds for action gates MUST match the SQL `biz_role_rank()` function values verbatim. Mobile reads `useCurrentBrandRole()` + compares against `BRAND_ROLE_RANK` constants from `src/utils/brandRole.ts` (which mirror SQL exactly). RLS is the server-side safety net; mobile is the UX convenience layer; both MUST agree on rank thresholds.

**Origin:** Cycle 13a (2026-05-04)
**Enforcement (Cycle 13a):** Convention + CI grep test (T-34): a script greps SQL `biz_role_rank` numeric values from `supabase/migrations/20260502100000_b1_business_schema_rls.sql` and compares to TS `BRAND_ROLE_RANK`. Mismatch fails CI.

**Implementor pre-flight:** confirm next-available invariant numbers. Cycle 12 used I-29 + I-30 (verified live). I-31 + I-32 should be free. If taken, bump to next free + document final IDs in IMPL report.

---

## 9 — Implementation order

Numbered sequence. Implementor follows exactly; tsc verification between major milestones.

1. **Pre-flight gates:**
   - Confirm next-available invariant numbers (I-31 + I-32 expected free)
   - Verify React Query is wired in mingla-business; if not, add `@tanstack/react-query` setup (QueryClient + Provider in app root) as Step 1.5
   - `/ui-ux-pro-max` pre-flights on J-T1 (team list) + J-T3 (InviteBrandMemberSheet) + J-T5 (audit log viewer) per §4.9, §4.10, §4.12
   - Read sister patterns: Cycle 11 `InviteScannerSheet.tsx` + Cycle 12 `AvailableAtSheet`-style sub-sheet pattern
2. **NEW utility `src/utils/brandRole.ts`** per §4.4 (BRAND_ROLE_RANK + helpers)
3. **NEW utility `src/utils/permissionGates.ts`** per §4.5 (MIN_RANK + helpers)
4. **NEW hook `src/hooks/useCurrentBrandRole.ts`** per §4.6 (with synthesis fallback)
5. **NEW store `src/store/brandTeamStore.ts`** per §4.7 + persist v1
6. **MOD `src/utils/clearAllStores.ts`** — add useBrandTeamStore.reset() per Const #6
7. **tsc checkpoint** (mandatory before continuing)
8. **NEW component `src/components/team/RolePickerSheet.tsx`** per §4.8
9. **NEW component `src/components/team/InviteBrandMemberSheet.tsx`** per §4.9
10. **NEW component `src/components/team/MemberDetailSheet.tsx`** per §4.11
11. **NEW route `app/brand/[brandId]/team.tsx`** per §4.10 (J-T1 + J-T2 + J-T3 + J-T4)
12. **NEW hook `src/hooks/useAuditLog.ts`** per §4.12 (or co-located in audit log route file)
13. **NEW route `app/brand/[brandId]/audit-log.tsx`** per §4.12 (J-T5)
14. **MOD account/brand profile menu** per §4.14 (Team + Audit log entry rows)
15. **tsc checkpoint** (mandatory)
16. **MOD 7 role gates G1..G7** per §4.15 (J-T6) — apply pattern uniformly
17. **MOD scannerInvitationsStore.ts header** per §4.17 (doc continuity, no logic change)
18. **MOD `Mingla_Artifacts/BUSINESS_PRD.md`** per §4.16 (PRD reconciliation note)
19. **MOD `Mingla_Artifacts/INVARIANT_REGISTRY.md`** — add I-31 + I-32 entries verbatim per §8.2
20. **Verification matrix:**
    - `cd mingla-business && npx tsc --noEmit` (filtered)
    - Manual smoke T-01..T-40
    - Grep regression battery (T-34..T-39)
    - I-32 SQL parity grep
21. **Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS_REPORT.md` per `references/report-template.md` 15-section template

---

## 10 — Forward backend handoff (B-cycle requirements)

Cycle 13a ships UI-complete; B-cycle ships functional. The B-cycle dispatch must include:

### 10.1 Brand invitation backend write path

- New edge function `supabase/functions/invite-brand-member/index.ts`
  - Accepts: `{ brandId, email, role }` from authenticated brand_admin+
  - Validates: caller has rank >= 50 on brandId; email format; role in enum
  - Generates token + writes `brand_invitations` row + sends Resend email
  - Returns: `{ invitationId, expiresAt }`

### 10.2 Brand invitation accept route

- New edge function `supabase/functions/accept-brand-invitation/index.ts`
  - Accepts: `{ token }` from authenticated user (any auth.uid())
  - Validates: token exists + not expired + invitation not yet accepted
  - INSERTs `brand_team_members` row + flips invitation `accepted_at`
  - Returns: `{ brandId, role }`
- Web/deep-link route `/accept/[token]` to handle the link

### 10.3 Sync architecture for useBrandTeamStore

When backend lands, two paths:
- **Path A:** useBrandTeamStore contracts to a cache; React Query becomes source-of-truth via `brand_team_members` + `brand_invitations` reads
- **Path B:** useBrandTeamStore deprecated entirely; team list reads directly from React Query

Recommend Path A — mirrors Cycle 9c orderStore pattern (offline cache + server sync).

### 10.4 brand-admin-can-read-all-audit-log RLS policy

13a uses self-only RLS for audit_log. 13b or B-cycle adds:
```sql
CREATE POLICY "Brand admin plus reads brand audit_log"
  ON public.audit_log FOR SELECT TO authenticated
  USING (public.biz_is_brand_admin_plus_for_caller(brand_id));
```

### 10.5 audit_log writers

Edge functions for refund / role change / brand-edit / invite need to INSERT audit_log rows in same transaction. Defer to B-cycle.

### 10.6 F-1 scanner permissions migration

Defer to 13b (Q2 lock). Small migration adds `manual_check_in` boolean to `event_scanners.permissions` jsonb default + backfill existing rows + mobile renames keys to snake_case.

### 10.7 permissions_matrix table review (D-CYCLE13-FOR-3)

13b decision: expand seed to a comprehensive (role × action) matrix, OR deprecate in favor of role-rank approach. 13a preserves the table untouched.

### 10.8 Per-event role assignments (D-CYCLE13-FOR-5)

Defer to 13b. Currently only scanners have per-event scoping (`event_scanners` table). Other roles are brand-level only.

---

## 11 — Regression prevention

| Risk | Structural safeguard | Test |
|------|----------------------|------|
| Mobile rank thresholds drift from SQL biz_role_rank | I-32 + CI grep test in T-34 | Hard CI gate |
| Single-user mode operator (no brand_team_members row) loses access after 13a deploy | useCurrentBrandRole synthesizes account_owner fallback per §4.6 | T-21 + T-28 manual smoke |
| Permissions UI shows fake invitations | useBrandTeamStore.entries empty at launch (Const #9) | T-37 grep verifies banner copy + entry empty default |
| TRANSITIONAL banners removed in future cycle | Const #7 protective comments + EXIT conditions in headers | T-37 grep test |
| Gate logic drifts (one screen says event_manager another says brand_admin for same action) | Single chokepoint `permissionGates.ts` `MIN_RANK` constants imported by all 7 gate sites | Code review + grep `MIN_RANK\.` to enumerate sites |
| RLS policy denies but UI shows action enabled | `useCurrentBrandRole.isError` propagates to consumers; consumer fail-closed (rank=0) | T-40 |
| Banned direct subscription to fresh-array selector | T-35 grep test | Hard CI gate (mirror Cycle 12 pattern) |
| Role rank drift if PR #59 migration's biz_role_rank changes | Comment in `brandRole.ts` cites the source line; CI grep test compares numeric values | T-34 |

**Protective comments required in code:**
- `brandRole.ts` header: I-32 statement verbatim with cross-reference to SQL line numbers
- `permissionGates.ts` header: cites RLS-mirror requirement
- `brandTeamStore.ts` header: I-31 + EXIT condition verbatim per §4.7
- `useCurrentBrandRole.ts` synthesis fallback: comment block explaining why account_owner synthesis exists

---

## 12 — Cross-references

- Investigation: [`reports/INVESTIGATION_BIZ_CYCLE_13_PERMISSIONS_UI.md`](../reports/INVESTIGATION_BIZ_CYCLE_13_PERMISSIONS_UI.md)
- SPEC dispatch: [`prompts/SPEC_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS.md`](../prompts/SPEC_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS.md)
- BUSINESS_PRD §11 (Permissions and Access Control): [`Mingla_Artifacts/BUSINESS_PRD.md`](../BUSINESS_PRD.md) lines 652-686
- BUSINESS_PRD §14 (MVP v1 — Foundations Cut): lines 1097-1115
- PR #59 schema (canonical for all 6 tables): `supabase/migrations/20260502100000_b1_business_schema_rls.sql` — biz_role_rank lines 11-30; brand_team_members lines 146-180; brand_invitations 182-214; RLS 416-487; event_scanners + scanner_invitations 1130-1170; permissions_matrix + audit_log 1560-1652
- ORCH-0706 close (PR #59 LIVE + I-24 audit-log carve-out): [`reports/IMPLEMENTATION_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING_REPORT.md`](../reports/IMPLEMENTATION_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING_REPORT.md)
- Cycle 11 IMPL v2 (architectural pattern + ORCH-0710 hooks lesson + I-28): [`reports/IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md`](../reports/IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md)
- Cycle 12 IMPL final report (canAcceptPayments toggle FLIP precedent + sub-sheet picker pattern): [`reports/IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md`](../reports/IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md)
- INVARIANT_REGISTRY: [`Mingla_Artifacts/INVARIANT_REGISTRY.md`](../INVARIANT_REGISTRY.md) — I-17 / I-22 / I-23 / I-24 / I-28 preserved; NEW I-31 + I-32 to ratify
- Memory rules referenced: `feedback_implementor_uses_ui_ux_pro_max`, `feedback_supabase_mcp_workaround`, `feedback_orchestrator_never_executes`, `feedback_no_summary_paragraph`, `feedback_keyboard_never_blocks_input`, `feedback_rn_color_formats`, `feedback_anon_buyer_routes`

---

## 13 — Output contract for the implementor

Implementor produces TWO things:

1. **Code changes** per §9 implementation order (21 steps)
2. **Implementation report** at `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS_REPORT.md` per Mingla implementor 15-section template:
   - Old → New receipts for every file modified or created (~18 files expected)
   - SC-1..SC-30 verification matrix with PASS / UNVERIFIED labels per SC
   - T-01..T-40 outcomes
   - Invariant registrations: confirmed final I-31 / I-32 IDs in INVARIANT_REGISTRY
   - Memory rule deference proof: `/ui-ux-pro-max` invoked pre-flight on J-T1 + J-T3 + J-T5 with applied guidance documented
   - Constitutional compliance scan (14 principles)
   - Cache safety: confirm new selector pattern grep-clean + persist v1 hydration clean + React Query keys discipline (use factory only)
   - Regression surface: 5-6 adjacent features tester should spot-check (Cycle 11 InviteScannerSheet, Cycle 12 InviteScannerSheet canAcceptPayments toggle, EditPublishedScreen Step 5 ticket sheet, RefundSheet Cycle 9c, DoorRefundSheet Cycle 12, AddCompGuestSheet Cycle 10)
   - Discoveries for orchestrator (any new side issues)
   - Transition items ([TRANSITIONAL] comments + EXIT CONDITIONs)
   - Files touched matrix (path + action + LOC delta)
   - Verification commands run + outputs

Implementor MUST NOT:
- Re-debate any locked decision from §2
- Add scope beyond §3.1
- Touch backend / RLS / edge functions / migrations
- Skip the `/ui-ux-pro-max` pre-flight on J-T1 + J-T3 + J-T5
- Wire mobile-side audit_log writes (Q5 lock)
- Build a `permissions_override` editor (Q3 lock)
- Build account-level cross-brand team list (Q4 lock)
- Touch Cycle 11 InviteScannerSheet logic (only the doc continuity comment per §4.17)
- Skip the React Query setup if not present (must be wired in 13a as a foundation; if it WAS already wired by another cycle, document the verify in IMPL report)
- Use Zustand for `useCurrentBrandRole` (Const #5 — server state)
- Silently override an invariant — surface to operator if conflict arises

If the spec is wrong or contradicts what the implementor finds in code: STOP. State the contradiction. Wait for direction.
