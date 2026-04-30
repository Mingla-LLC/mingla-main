# Spec — J-A9: Brand Team (list / invite / role / remove)

> **Issue ID:** ORCH-BIZ-CYCLE-2-J-A9
> **Cycle:** 2 — Brands
> **Codebase:** `mingla-business/` (mobile-first; web parity gated to Cycle 6/7 per DEC-071)
> **Predecessor investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-BIZ-CYCLE-2-J-A9.md`
> **Predecessor cycle:** J-A8 + polish CLOSE (commit `2d0ec549`)
> **Authoritative design:** `HANDOFF_BUSINESS_DESIGNER.md` §5.3.9–§5.3.11 (lines 1864-1881) + §5.1.6 boundary (line 1746-1755) + §6.2.2 roles (lines 1629-1631) + §6.3.4–§6.3.6 journeys (lines 3085-3120) + §7 copy bank (lines 2330-2333)
> **Spec writer turn:** 2026-04-29
> **Status:** locked

---

## 1. Scope

### 1.1 In scope

- **Routes (NEW):**
  - `mingla-business/app/brand/[id]/team/index.tsx` — team list
  - `mingla-business/app/brand/[id]/team/[memberId].tsx` — member detail
- **Components (NEW):**
  - `mingla-business/src/components/brand/BrandTeamView.tsx` — list + FAB + invite-sheet trigger
  - `mingla-business/src/components/brand/BrandInviteSheet.tsx` — Sheet form (email + role + note + Send)
  - `mingla-business/src/components/brand/BrandMemberDetailView.tsx` — profile-style member screen
  - `mingla-business/src/components/brand/RolePickerSheet.tsx` — reusable Sheet picker (used by invite + member detail)
- **Schema (MOD):** `mingla-business/src/store/currentBrandStore.ts` — Brand v6 → v7 + new types `BrandMember`, `BrandInvitation`, `BrandMemberRole`, `InviteRole`
- **Stub data (MOD):** `mingla-business/src/store/brandList.ts` — all 4 STUB_BRANDS get team arrays + pending invitations
- **J-A7 wiring (MOD):** `mingla-business/src/components/brand/BrandProfileView.tsx` — add `onTeam` prop · Operations row #2 navigates · sub-text reflects member count · TRANSITIONAL marker removed
- **Route wiring (MOD):** `mingla-business/app/brand/[id]/index.tsx` — pass `onTeam` handler

### 1.2 Out of scope (hard non-goals)

- ❌ Real backend (B1 wires `brand_team_members` + `brand_invitations` tables + RLS)
- ❌ Accept-invitation deep-link `/invitation/:token` (§5.1.6 — needs real tokens; B1)
- ❌ Email sending (B5 marketing infrastructure — Resend integration)
- ❌ Permissions matrix (§3.12 component — deferred, per O-A9-1)
- ❌ Permission enforcement at route level (Cycle 2 stubs assume founder is owner of their own brands)
- ❌ Multi-brand permission scoping UI (post-MVP)
- ❌ Transfer-ownership flow (post-MVP — but copy references it in disabled-helper text)
- ❌ Real session/last-active tracking (stub timestamps; B1)
- ❌ Email format validation beyond non-empty + contains "@" (B1 backend validates rigorously)
- ❌ Avatar / FAB / RelativeTime kit primitives (composed inline per DEC-079; promote on 3+ uses)
- ❌ Web desktop wide-table view (§5.3.9 desktop variant) — Cycle 6/7
- ❌ §5.3.12 audit log

### 1.3 Assumptions

- J-A8 polish baseline shipped at `2d0ec549`: Sheet RN-Modal portal, ConfirmDialog (mounted at screen-root works), Brand v6 schema, BrandProfileView with `onEdit` prop pattern, Icon set with `users` glyph.
- Founder always has `role: "owner"` on their own brands; no role-based field gating in Cycle 2.
- AsyncStorage persistence works on web via Cycle 0b WEB3 fixes.
- `useLocalSearchParams<{...}>()` returns string segments on all 3 platforms (verified J-A7/J-A8).
- Floating BottomNav is rendered ONLY inside `(tabs)/_layout.tsx`; J-A9 routes outside `(tabs)/` won't collide with FAB.
- `ConfirmDialog` mount at screen-View tree root (not nested in ScrollView/FlatList) renders correctly on all 3 platforms (verified J-A8 unsaved-changes flow).

---

## 2. Authoritative design source

**§5.3.9 Team list** (line 1864-1868):
> **Mobile:** list of glass card rows for each member: avatar + name + role pill + last-active timestamp + overflow ⋯. "+ Invite teammate" FAB bottom-right.
> **Desktop:** data table at lg+: Name | Role | Email | Joined | Last active | Actions.
> **States:** empty (only owner) → CTA to invite. Pending invitation rows (greyed) with "Resend" / "Cancel" buttons.

**§5.3.10 Invite teammate** (line 1870-1874):
> **Mobile sheet:** Email input + Role select (5 options) + Optional note textarea + Send invitation primary CTA.
> **Desktop modal:** 480 wide.
> **Edge cases:** Email already a member → inline error "Already on the team." Email already invited (pending) → "Already invited. Resend?"

**§5.3.11 Member detail** (line 1876-1880):
> **Mobile:** profile-style screen with avatar, name, role, joined, last active, change role CTA, remove CTA.
> **Desktop:** right inspector pattern from team table.
> **States:** owner (cannot change own role; cannot remove self).

**§7 copy bank** (lines 2330-2333):
- "Pick a role for {email}." (invite empty role validation)
- "Invitation sent to {email}." (invite success toast)
- "{Name} is already on the team." (invite duplicate inline error)
- "Remove {Name} from {Brand}? They'll lose access immediately." (remove confirm body)

**§6.3.5 role-change diff** (line 3104):
> Sara picks Event Manager. Body shows diff: "Will lose: brand finances, team management. Will keep: event creation."

**§6.2.2 roles** (lines 1629-1631):
- account_owner — Everything (Home, Events, Chat, Account, Brand settings, Team, Payments, Audit)
- brand_admin — Everything except Account-deletion (own only), can manage team
- event_manager — Home, Events (assigned only), Account; cannot see Payments financial figures (sees totals only), cannot manage team
- (implied from §6.2.2 list) finance_manager — Payments + reports
- (implied) marketing_manager — Marketing surfaces (Cycle 14+)
- (implied) scanner — Scanner mode only (Cycle 11)

The 5 invitable roles: brand_admin · event_manager · finance_manager · marketing_manager · scanner. (account_owner is NEVER invitable — there is exactly one per brand and ownership transfer is post-MVP.)

---

## 3. Layer specifications

### 3.1 Schema layer (Brand v6 → v7)

**File:** `mingla-business/src/store/currentBrandStore.ts`

**Add new types:**

```typescript
/**
 * Full role enum used by team members. Distinct from `BrandRole` (which is
 * the CURRENT-USER perspective on a brand — am I owner/admin of this brand?).
 * BrandMemberRole is the TEAM-MEMBER perspective — what role does this
 * person hold on this brand?
 *
 * NEW in J-A9 schema v7. Per Designer Handoff §6.2.2.
 */
export type BrandMemberRole =
  | "owner"
  | "brand_admin"
  | "event_manager"
  | "finance_manager"
  | "marketing_manager"
  | "scanner";

/**
 * Roles that can be ASSIGNED via invite. Owner is excluded — exactly one
 * owner per brand; ownership transfer is post-MVP. NEW in J-A9 schema v7.
 */
export type InviteRole = Exclude<BrandMemberRole, "owner">;

/**
 * Member status. Future-proof for `'suspended'` (post-MVP suspension flow).
 * NEW in J-A9 schema v7.
 */
export type BrandMemberStatus = "active";

export interface BrandMember {
  id: string;
  name: string;
  email: string;
  role: BrandMemberRole;
  status: BrandMemberStatus;
  /** ISO 8601 timestamp when the member joined the brand. */
  joinedAt: string;
  /** ISO 8601 timestamp of last activity. Optional — future B1 wiring. */
  lastActiveAt?: string;
  /** Avatar photo URL. Optional; rendering falls back to initial. */
  photo?: string;
}

export type BrandInvitationStatus = "pending";

export interface BrandInvitation {
  id: string;
  email: string;
  role: InviteRole;
  /** ISO 8601 timestamp when the invitation was sent. */
  invitedAt: string;
  /** Optional note from inviter, shown on the accept screen (B1 cycle). */
  note?: string;
  status: BrandInvitationStatus;
}
```

**Extend Brand type:**

```typescript
export type Brand = {
  // ... v6 fields unchanged ...
  /**
   * Active team members on this brand. Owner is always pinned at index 0.
   * NEW in J-A9 schema v7. Undefined treated as `[]` at read sites.
   */
  members?: BrandMember[];
  /**
   * Pending invitations for this brand. Rendered as greyed rows in the team
   * list with Resend/Cancel actions. NEW in J-A9 schema v7. Undefined
   * treated as `[]` at read sites.
   */
  pendingInvitations?: BrandInvitation[];
};
```

**Persist version bump:**

- `persistOptions.name` → `"mingla-business.currentBrand.v7"`
- `version: 7`
- Migration adds v7 case (passthrough — new fields start undefined):

```typescript
migrate: (persistedState, version) => {
  if (version < 2) {
    return { currentBrand: null, brands: [] };
  }
  if (version === 2) {
    // ... existing v2→v3 logic unchanged ...
  }
  // v3 → v7: passthrough. New optional fields start undefined for all
  // brands; render-time defaults to [] / true / "GB" handle absence.
  // v6 → v7 specifically: members + pendingInvitations start undefined.
  return persistedState as PersistedState;
}
```

**Header comment update:** extend schema-version history with v7 entry:

```
*   v7 (Cycle 2 J-A9): adds members?: BrandMember[] + pendingInvitations?:
*                       BrandInvitation[] (passthrough migration; both arrays
*                       start undefined, defaulted to [] at read sites)
```

### 3.2 Stub data layer

**File:** `mingla-business/src/store/brandList.ts`

Each of 4 STUB_BRANDS gets `members` + `pendingInvitations` arrays. **Coverage spread:**
- **Lonely Moth (lm):** 3 active (Sara owner + Marcus brand_admin + Liz event_manager) + 1 pending (joel scanner)
- **The Long Lunch (tll):** 2 active (Ada owner + Liam brand_admin) + 0 pending
- **Sunday Languor (sl):** 2 active (Mira owner + Tom finance_manager) + 1 pending (sam marketing_manager)
- **Hidden Rooms (hr):** 1 active (Maya owner only — empty state demo) + 0 pending

The exact arrays:

```typescript
// Lonely Moth
members: [
  {
    id: "m_lm_sara",
    name: "Sara Marlowe",
    email: "sara@lonelymoth.events",
    role: "owner",
    status: "active",
    joinedAt: "2024-03-12T09:00:00Z",
    lastActiveAt: "2026-04-29T14:20:00Z",
  },
  {
    id: "m_lm_marcus",
    name: "Marcus Chen",
    email: "marcus@lonelymoth.events",
    role: "brand_admin",
    status: "active",
    joinedAt: "2025-07-01T10:00:00Z",
    lastActiveAt: "2026-04-29T11:45:00Z",
  },
  {
    id: "m_lm_liz",
    name: "Liz Okafor",
    email: "liz.okafor@gmail.com",
    role: "event_manager",
    status: "active",
    joinedAt: "2026-01-15T13:00:00Z",
    lastActiveAt: "2026-04-28T18:00:00Z",
  },
],
pendingInvitations: [
  {
    id: "i_lm_joel",
    email: "joel.parker@gmail.com",
    role: "scanner",
    invitedAt: "2026-04-27T10:00:00Z",
    status: "pending",
  },
],

// The Long Lunch
members: [
  {
    id: "m_tll_ada",
    name: "Ada Kwame",
    email: "ada@thelonglunch.co.uk",
    role: "owner",
    status: "active",
    joinedAt: "2024-08-20T09:00:00Z",
    lastActiveAt: "2026-04-29T08:30:00Z",
  },
  {
    id: "m_tll_liam",
    name: "Liam Reeves",
    email: "liam@thelonglunch.co.uk",
    role: "brand_admin",
    status: "active",
    joinedAt: "2024-09-01T09:00:00Z",
    lastActiveAt: "2026-04-29T07:15:00Z",
  },
],
pendingInvitations: [],

// Sunday Languor
members: [
  {
    id: "m_sl_mira",
    name: "Mira Patel",
    email: "mira@sundaylanguor.com",
    role: "owner",
    status: "active",
    joinedAt: "2023-05-10T09:00:00Z",
    lastActiveAt: "2026-04-29T16:00:00Z",
  },
  {
    id: "m_sl_tom",
    name: "Tom Reilly",
    email: "tom@sundaylanguor.com",
    role: "finance_manager",
    status: "active",
    joinedAt: "2025-02-22T11:00:00Z",
    lastActiveAt: "2026-04-26T10:00:00Z",
  },
],
pendingInvitations: [
  {
    id: "i_sl_sam",
    email: "sam.morgan@hotmail.com",
    role: "marketing_manager",
    invitedAt: "2026-04-25T14:00:00Z",
    note: "Help us with the May launch newsletter.",
    status: "pending",
  },
],

// Hidden Rooms (empty-state demo)
members: [
  {
    id: "m_hr_maya",
    name: "Maya Okonkwo",
    email: "maya@hidden-rooms.co.uk",
    role: "owner",
    status: "active",
    joinedAt: "2024-11-05T09:00:00Z",
    lastActiveAt: "2026-04-28T20:00:00Z",
  },
],
pendingInvitations: [],
```

**Header comment update:** note v7 schema additions per spec.

### 3.3 Route layer — Team list (NEW)

**File:** `mingla-business/app/brand/[id]/team/index.tsx`

```typescript
import React from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandTeamView } from "../../../../src/components/brand/BrandTeamView";
import { canvas } from "../../../../src/constants/designSystem";
import {
  useBrandList,
  useCurrentBrandStore,
  type Brand,
  type BrandInvitation,
} from "../../../../src/store/currentBrandStore";

export default function BrandTeamRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const brands = useBrandList();
  const setBrands = useCurrentBrandStore((s) => s.setBrands);
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const currentBrand = useCurrentBrandStore((s) => s.currentBrand);
  const brand =
    typeof idParam === "string" && idParam.length > 0
      ? brands.find((b) => b.id === idParam) ?? null
      : null;

  const handleBack = (): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/account" as never);
    }
  };

  const handleSendInvite = (invitation: BrandInvitation): void => {
    if (brand === null) return;
    const next: Brand = {
      ...brand,
      pendingInvitations: [...(brand.pendingInvitations ?? []), invitation],
    };
    setBrands(brands.map((b) => (b.id === next.id ? next : b)));
    if (currentBrand !== null && currentBrand.id === next.id) {
      setCurrentBrand(next);
    }
  };

  const handleCancelInvite = (invitationId: string): void => {
    if (brand === null) return;
    const next: Brand = {
      ...brand,
      pendingInvitations: (brand.pendingInvitations ?? []).filter(
        (i) => i.id !== invitationId,
      ),
    };
    setBrands(brands.map((b) => (b.id === next.id ? next : b)));
    if (currentBrand !== null && currentBrand.id === next.id) {
      setCurrentBrand(next);
    }
  };

  const handleOpenMember = (memberId: string): void => {
    if (brand === null) return;
    router.push(`/brand/${brand.id}/team/${memberId}` as never);
  };

  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top,
        backgroundColor: canvas.discover, // I-12 invariant
      }}
    >
      <BrandTeamView
        brand={brand}
        onBack={handleBack}
        onSendInvite={handleSendInvite}
        onCancelInvite={handleCancelInvite}
        onOpenMember={handleOpenMember}
      />
    </View>
  );
}
```

### 3.4 Route layer — Member detail (NEW)

**File:** `mingla-business/app/brand/[id]/team/[memberId].tsx`

Similar pattern with nested format-agnostic resolver:

```typescript
const params = useLocalSearchParams<{
  id: string | string[];
  memberId: string | string[];
}>();
const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
const memberIdParam = Array.isArray(params.memberId)
  ? params.memberId[0]
  : params.memberId;

const brand = (typeof idParam === "string" && idParam.length > 0)
  ? brands.find((b) => b.id === idParam) ?? null
  : null;

const member = (brand !== null && typeof memberIdParam === "string" && memberIdParam.length > 0)
  ? (brand.members ?? []).find((m) => m.id === memberIdParam) ?? null
  : null;
```

Save handlers:

```typescript
const handleChangeRole = (memberId: string, nextRole: BrandMemberRole): void => {
  if (brand === null) return;
  const next: Brand = {
    ...brand,
    members: (brand.members ?? []).map((m) =>
      m.id === memberId ? { ...m, role: nextRole } : m,
    ),
  };
  setBrands(brands.map((b) => (b.id === next.id ? next : b)));
  if (currentBrand !== null && currentBrand.id === next.id) {
    setCurrentBrand(next);
  }
};

const handleRemoveMember = (memberId: string): void => {
  if (brand === null) return;
  const next: Brand = {
    ...brand,
    members: (brand.members ?? []).filter((m) => m.id !== memberId),
  };
  setBrands(brands.map((b) => (b.id === next.id ? next : b)));
  if (currentBrand !== null && currentBrand.id === next.id) {
    setCurrentBrand(next);
  }
};
```

After remove: `router.back()` (back to team list — member is gone). After role change: stay on detail screen (refreshed state shows new role).

### 3.5 Component — BrandTeamView (NEW)

**File:** `mingla-business/src/components/brand/BrandTeamView.tsx`

**Props:**

```typescript
export interface BrandTeamViewProps {
  brand: Brand | null;
  onBack: () => void;
  onSendInvite: (invitation: BrandInvitation) => void;
  onCancelInvite: (invitationId: string) => void;
  onOpenMember: (memberId: string) => void;
}
```

**Layout:**

- **TopBar:** `leftKind="back"` + title `"Team"` + onBack=`onBack` + `rightSlot={<View />}`
- **Not-found state** when `brand === null`: same pattern as J-A7/J-A8 (GlassCard "Brand not found" + Back to Account Button)
- **Empty state** when `brand.members?.length <= 1` (only owner) AND `brand.pendingInvitations?.length === 0`:
  - GlassCard variant="elevated" with "Invite teammates to help run {brand.displayName}" + body "Brand admins, event managers, finance managers, marketing managers, and scanners — pick the right role for each person." + "Invite teammate" Button (primary, leadingIcon="plus")
  - Owner's own row STILL renders above the empty-state card so they see themselves on the team
- **Populated state:** ScrollView with two sections:
  - **Active members** — section label "TEAM" — owner pinned at index 0 + others sorted by joinedAt descending
  - **Pending invitations** — section label "PENDING" — only renders when `pendingInvitations.length > 0`

**Member row** (Active):

```typescript
<Pressable onPress={() => onOpenMember(member.id)} style={styles.memberRow}>
  <Avatar40 name={member.name} photo={member.photo} />
  <View style={styles.memberTextCol}>
    <Text style={styles.memberName} numberOfLines={1}>{member.name}</Text>
    <View style={styles.memberMetaRow}>
      <Pill variant={rolePillVariant(member.role)}>{rolePillLabel(member.role)}</Pill>
      <Text style={styles.memberLastActive}>
        {member.lastActiveAt !== undefined
          ? `Active ${formatRelativeTime(member.lastActiveAt)}`
          : "Never signed in"}
      </Text>
    </View>
  </View>
  <Icon name="chevR" size={16} color={textTokens.tertiary} />
</Pressable>
```

**Pending row:**

```typescript
<View style={styles.pendingRow}>
  <Avatar40 name={invitation.email} dimmed />
  <View style={styles.memberTextCol}>
    <Text style={[styles.memberName, styles.pendingDimmed]} numberOfLines={1}>{invitation.email}</Text>
    <View style={styles.memberMetaRow}>
      <Pill variant="draft">Pending · {rolePillLabel(invitation.role)}</Pill>
      <Text style={[styles.memberLastActive, styles.pendingDimmed]}>
        Invited {formatRelativeTime(invitation.invitedAt)}
      </Text>
    </View>
  </View>
  <Pressable
    onPress={() => handleResend(invitation)}
    accessibilityRole="button"
    accessibilityLabel="Resend invitation"
    style={styles.pendingActionBtn}
  >
    <Text style={styles.pendingActionLabel}>Resend</Text>
  </Pressable>
  <Pressable
    onPress={() => onCancelInvite(invitation.id)}
    accessibilityRole="button"
    accessibilityLabel="Cancel invitation"
    style={styles.pendingActionBtn}
  >
    <Text style={[styles.pendingActionLabel, styles.pendingActionDestructive]}>Cancel</Text>
  </Pressable>
</View>
```

**FAB** (absolute bottom-right):

```typescript
<View style={[styles.fabWrap, { bottom: Math.max(insets.bottom, spacing.lg) + spacing.md }]} pointerEvents="box-none">
  <Pressable
    onPress={() => setInviteSheetVisible(true)}
    accessibilityRole="button"
    accessibilityLabel="Invite teammate"
    style={styles.fab}
  >
    <Icon name="plus" size={24} color="#ffffff" />
  </Pressable>
</View>
```

**Mounted at View root (NOT inside ScrollView):**
- `<BrandInviteSheet visible={inviteSheetVisible} onClose={...} brand={brand} onSend={onSendInvite} />`
- `<Toast .../>` for "Invitation sent to {email}." and "Invite resent to {email}."

**Inline helper components** (in same file):

```typescript
const Avatar40: React.FC<{ name: string; photo?: string; dimmed?: boolean }> = ({ name, photo, dimmed }) => {
  const initial = name.charAt(0).toUpperCase();
  return (
    <View style={[avatarStyles.wrap, dimmed && avatarStyles.dimmed]}>
      {photo !== undefined ? (
        <Image source={{ uri: photo }} style={avatarStyles.image} />
      ) : (
        <Text style={avatarStyles.initial}>{initial}</Text>
      )}
    </View>
  );
};

// Inline relative-time formatter — minutes / hours / days / weeks / "Apr 3"
const formatRelativeTime = (iso: string): string => { /* see §3.10 */ };
```

**Role pill mapping:**

```typescript
const rolePillLabel = (role: BrandMemberRole): string => {
  switch (role) {
    case "owner": return "Owner";
    case "brand_admin": return "Admin";
    case "event_manager": return "Events";
    case "finance_manager": return "Finance";
    case "marketing_manager": return "Marketing";
    case "scanner": return "Scanner";
  }
};

const rolePillVariant = (role: BrandMemberRole): PillVariant => {
  // Owner = primary (warm); admin = neutral; specialists = neutral
  return role === "owner" ? "primary" : "neutral";
  // (PillVariant TBD — implementor matches existing kit options)
};
```

### 3.6 Component — BrandInviteSheet (NEW)

**File:** `mingla-business/src/components/brand/BrandInviteSheet.tsx`

**Props:**

```typescript
export interface BrandInviteSheetProps {
  visible: boolean;
  onClose: () => void;
  brand: Brand;
  onSend: (invitation: BrandInvitation) => void;
}
```

**Body** (mounted inside Sheet primitive at `snapPoint="full"`):

- Header: title "Invite teammate" (h2)
- Email Input (`variant="email"`) with placeholder `"teammate@email.com"` + leadingIcon="mail" + clearable
- Role select field — Pressable that opens nested RolePickerSheet:
  - Tap → opens `<RolePickerSheet visible={...} options={INVITE_ROLES} selectedRole={draft.role} onPick={(r) => setDraft({...draft, role: r})} />`
  - When `draft.role` is undefined: shows placeholder text "Pick a role" with chevR icon
  - When set: shows the role label + role description
- Optional note (InlineTextArea, minHeight: 96, placeholder "Add a note (optional)")
- Send invitation Button (primary, fullWidth, disabled until email valid + role selected, simulated 300ms async, success path = call `onSend`, fire Toast on parent + close Sheet)
- Cancel Button (secondary, fullWidth) → `onClose()` directly (no dirty-check — invite sheet doesn't preserve drafts)

**State:**

```typescript
const [draft, setDraft] = useState<{
  email: string;
  role: InviteRole | undefined;
  note: string;
}>({ email: "", role: undefined, note: "" });
const [submitting, setSubmitting] = useState<boolean>(false);
const [inlineError, setInlineError] = useState<string | undefined>(undefined);
const [rolePickerVisible, setRolePickerVisible] = useState<boolean>(false);

// Reset draft on open — so each invite session starts clean
useEffect(() => {
  if (visible) {
    setDraft({ email: "", role: undefined, note: "" });
    setInlineError(undefined);
  }
}, [visible]);
```

**Validation** (called on Send tap):

```typescript
const validate = (): string | undefined => {
  const trimmed = draft.email.trim().toLowerCase();
  if (trimmed.length === 0 || !trimmed.includes("@")) {
    return "Enter a valid email.";
  }
  // Already a member?
  const memberMatch = (brand.members ?? []).find((m) => m.email.toLowerCase() === trimmed);
  if (memberMatch !== undefined) {
    return `${memberMatch.name} is already on the team.`;
  }
  // Already invited?
  const inviteMatch = (brand.pendingInvitations ?? []).find((i) => i.email.toLowerCase() === trimmed);
  if (inviteMatch !== undefined) {
    return "Already invited. Resend?";
  }
  if (draft.role === undefined) {
    return `Pick a role for ${draft.email}.`;
  }
  return undefined;
};
```

**Send handler:**

```typescript
const handleSend = useCallback((): void => {
  if (submitting) return;
  const error = validate();
  if (error !== undefined) {
    setInlineError(error);
    return;
  }
  setSubmitting(true);
  setInlineError(undefined);
  // [TRANSITIONAL] simulated async — replaced by real Supabase call in B1.
  setTimeout(() => {
    onSend({
      id: `i_${Date.now().toString(36)}`,
      email: draft.email.trim().toLowerCase(),
      role: draft.role!,
      invitedAt: new Date().toISOString(),
      note: draft.note.trim().length > 0 ? draft.note.trim() : undefined,
      status: "pending",
    });
    setSubmitting(false);
    onClose();
  }, 300);
}, [draft, submitting, brand.members, brand.pendingInvitations, onSend, onClose]);
```

**Inline error rendering:** below email Input or below role field depending on which field the error references. For "Pick a role for X." — render below role select. For "{Name} is already on the team." or "Already invited. Resend?" — render below email Input.

### 3.7 Component — BrandMemberDetailView (NEW)

**File:** `mingla-business/src/components/brand/BrandMemberDetailView.tsx`

**Props:**

```typescript
export interface BrandMemberDetailViewProps {
  brand: Brand | null;
  member: BrandMember | null;
  /** True when the member being viewed is the founder (current user). */
  isCurrentUserSelf: boolean;
  onBack: () => void;
  onChangeRole: (memberId: string, nextRole: BrandMemberRole) => void;
  onRemove: (memberId: string) => void;
}
```

**Resolution of `isCurrentUserSelf`:** Cycle 2 has no real auth user yet — for stub purposes, `isCurrentUserSelf = (member.role === 'owner')`. (The founder owns all 4 stub brands; the owner row IS the current user.) Document with `[TRANSITIONAL]` comment in route file: "Replaced when B1 wires `auth.users.id` to compare against `member.userId`."

**Layout:**

- **TopBar:** `leftKind="back"` + title `"Member"` + onBack=`onBack` + rightSlot=`<View />`
- **Not-found state** when `member === null`: GlassCard "Member not found" + Back Button
- **Populated state** ScrollView:
  - GlassCard elevated — Avatar84 (centred) + name (h2 centred) + role pill (centred)
  - Stats row (2-col):
    - "Joined" / `formatJoinedDate(member.joinedAt)` (e.g., "Aug 2025")
    - "Last active" / `formatRelativeTime(member.lastActiveAt)` or "Never signed in"
  - GlassCard base — Email row (label "EMAIL" + value `member.email` + tap to copy = TRANSITIONAL Toast for now)
  - **Action buttons** (only when NOT owner-self):
    - "Change role" Button (secondary, fullWidth, leadingIcon="users") — opens RolePickerSheet preselected to current role
    - "Remove from {brand.displayName}" Button (destructive, fullWidth, leadingIcon="trash" if exists, otherwise no leading icon) — opens ConfirmDialog destructive
  - **Owner-self disabled state:**
    - GlassCard base with helper text: "You're the owner of {brand.displayName}. Owners can't be removed or change their own role. To leave, transfer ownership first." (Transfer-ownership flow is post-MVP — copy is honest stub)
    - No action buttons rendered

**ConfirmDialog (mounted at screen-View root, NOT inside ScrollView per HF-1 carry-over):**

```typescript
<ConfirmDialog
  visible={removeDialogVisible}
  onClose={() => setRemoveDialogVisible(false)}
  onConfirm={() => {
    setRemoveDialogVisible(false);
    onRemove(member.id);
  }}
  variant="simple"
  destructive
  title={`Remove ${member.name}?`}
  description={`Remove ${member.name} from ${brand.displayName}? They'll lose access immediately.`}
  confirmLabel="Remove"
  cancelLabel="Keep on team"
/>
```

**RolePickerSheet (mounted at screen-View root):**

```typescript
<RolePickerSheet
  visible={rolePickerVisible}
  onClose={() => setRolePickerVisible(false)}
  options={INVITE_ROLES} // 5 options excluding owner
  selectedRole={member.role}
  onPick={(nextRole) => {
    setRolePickerVisible(false);
    if (nextRole !== member.role) {
      onChangeRole(member.id, nextRole);
    }
  }}
/>
```

### 3.8 Component — RolePickerSheet (NEW, reusable)

**File:** `mingla-business/src/components/brand/RolePickerSheet.tsx`

**Props:**

```typescript
export interface RolePickerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Role options to show. For invite use INVITE_ROLES. For owner-self change-role this picker is never opened. */
  options: BrandMemberRole[];
  selectedRole: BrandMemberRole | undefined;
  onPick: (role: BrandMemberRole) => void;
}
```

**Body** (mounted inside Sheet at `snapPoint="full"`):

- Header: "Pick a role"
- For each role in options, render a Pressable row:
  - Row layout: Pill (role name) + 2-line description + check icon if selected
  - Tap → calls `onPick(role)` (parent closes the sheet)

**Role descriptions** (per §6.2.2 + §6.3.5):

```typescript
const ROLE_DESCRIPTIONS: Record<BrandMemberRole, string> = {
  owner: "Full access to everything, including team management, payments, and brand settings.",
  brand_admin: "Manage events, team, payments, and brand settings. Cannot delete the brand.",
  event_manager: "Create and run events. Cannot see financial figures or manage team.",
  finance_manager: "View payments, payouts, refunds, and finance reports. No event editing.",
  marketing_manager: "Run marketing campaigns and email blasts. No financial access.",
  scanner: "Scan tickets at the door. No edit access. Cannot view financials.",
};

const INVITE_ROLES: BrandMemberRole[] = [
  "brand_admin",
  "event_manager",
  "finance_manager",
  "marketing_manager",
  "scanner",
];
```

### 3.9 J-A7 wiring (BrandProfileView modification)

**File:** `mingla-business/src/components/brand/BrandProfileView.tsx`

Add `onTeam` prop:

```typescript
export interface BrandProfileViewProps {
  brand: Brand | null;
  onBack: () => void;
  onEdit: (brandId: string) => void;
  /**
   * Called when user taps the "Team & permissions" Operations row.
   * Receives the brand id. Pattern mirrors `onEdit` (J-A8) — view component
   * takes a navigation callback; route owns navigation.
   * NEW in J-A9.
   */
  onTeam: (brandId: string) => void;
}
```

Modify `OPERATIONS_ROWS` — replace static array with hook-derived value to inject the dynamic sub-text and per-row handler:

```typescript
const memberCount = (brand?.members ?? []).length;
const operationsRows = useMemo(() => [
  {
    icon: "bank" as IconName,
    label: "Payments & Stripe",
    sub: "Not connected",
    onPress: () => fireToast("Stripe Connect lands in J-A10."),
  },
  {
    icon: "users" as IconName,
    label: "Team & permissions",
    sub: `${memberCount} ${memberCount === 1 ? "member" : "members"}`,
    onPress: () => brand !== null && onTeam(brand.id),
  },
  {
    icon: "receipt" as IconName,
    label: "Tax & VAT",
    sub: "Not configured",
    onPress: () => fireToast("Tax settings land in a later cycle."),
  },
  {
    icon: "chart" as IconName,
    label: "Finance reports",
    sub: "Stripe-ready CSVs",
    onPress: () => fireToast("Finance reports land in J-A12."),
  },
], [brand, memberCount, fireToast, onTeam]);
```

Update render to use `operationsRows[i].onPress`. The `[TRANSITIONAL] toastMessage: "Team UI lands in J-A9."` line is REMOVED — implementor verifies via grep.

### 3.10 Route wiring (BrandProfileRoute modification)

**File:** `mingla-business/app/brand/[id]/index.tsx`

Pass `onTeam`:

```typescript
const handleOpenTeam = (brandId: string): void => {
  router.push(`/brand/${brandId}/team` as never);
};

return (
  <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: canvas.discover }}>
    <BrandProfileView
      brand={brand}
      onBack={handleBack}
      onEdit={handleOpenEdit}
      onTeam={handleOpenTeam}
    />
  </View>
);
```

### 3.11 Inline `formatRelativeTime` utility

Composed inline in BrandTeamView (and reused in BrandMemberDetailView via local copy or shared inline):

```typescript
const formatRelativeTime = (iso: string): string => {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
  // Fall back to absolute date
  return new Date(iso).toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
  });
};

const formatJoinedDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });
```

If 3+ uses surface, lift to `src/utils/formatRelativeTime.ts` (D-INV-A9-5 watch-point).

---

## 4. Success Criteria

**AC#1** Tap "Team & permissions" Operations row on `/brand/[id]/` → navigates to `/brand/[id]/team`. (Toast `[TRANSITIONAL]` removed.)

**AC#2** Team list renders all active members with avatar + name + role pill + last-active timestamp. Owner pinned at index 0.

**AC#3** Sub-text on Operations row #2 of J-A7 shows accurate member count: "1 member" / "3 members" / "2 members" / "1 member" for the 4 stubs respectively.

**AC#4** Empty state — Hidden Rooms team list (1 member, owner-only) shows: owner row + GlassCard with "Invite teammates to help run Hidden Rooms" + Invite teammate Button. NO "Pending" section header.

**AC#5** Pending section — Lonely Moth team list shows TEAM section (3 members) + PENDING section (1 row: joel.parker@gmail.com greyed + "Pending · Scanner" pill + "Invited 2d ago" + Resend / Cancel buttons).

**AC#6** Tap FAB "+" bottom-right → BrandInviteSheet opens at full snap-point.

**AC#7** Invite sheet validation — empty email + Send → inline error "Enter a valid email." NO state mutation.

**AC#8** Invite sheet duplicate-member — type `marcus@lonelymoth.events` (already a member of LM) + role + Send → inline error "Marcus Chen is already on the team." NO state mutation.

**AC#9** Invite sheet duplicate-invitation — type `joel.parker@gmail.com` (already pending on LM) + role + Send → inline error "Already invited. Resend?" NO state mutation.

**AC#10** Invite sheet missing role — valid email + no role + Send → inline error "Pick a role for {email}."

**AC#11** Invite happy path — valid new email + role + (optional note) + Send → ~300ms simulated delay → Sheet closes → Toast "Invitation sent to {email}." → new pending row appears in list immediately.

**AC#12** Tap Resend on pending row → Toast `[TRANSITIONAL]` "Invite resent to {email}." NO state mutation.

**AC#13** Tap Cancel on pending row → invitation removed from list. (Stub: no confirmation dialog needed for cancel.)

**AC#14** Tap any active member row → navigates to `/brand/[id]/team/[memberId]`.

**AC#15** Member detail (non-owner) — renders avatar + name + role pill + Joined + Last active + Email + Change role Button (secondary) + Remove member Button (destructive).

**AC#16** Member detail (owner-self) — renders the same identity block + GlassCard with helper text "You're the owner of {brand}. Owners can't be removed or change their own role. To leave, transfer ownership first." NO Change role / Remove buttons.

**AC#17** Tap Change role → RolePickerSheet opens at full snap-point with 5 options (admin/events/finance/marketing/scanner). Current role shows check icon.

**AC#18** Tap a role in picker → Sheet closes → if role differs from current, store updates → role pill on member detail screen reflects new role immediately.

**AC#19** Tap Remove member → ConfirmDialog destructive: title "Remove {Name}?" + body "Remove {Name} from {brand}? They'll lose access immediately." + Remove (destructive) / Keep on team buttons.

**AC#20** ConfirmDialog Remove confirm → member removed from store → router.back() → team list reflects deletion immediately.

**AC#21** ConfirmDialog Keep on team → dialog closes; member remains.

**AC#22** Member-not-found state when `:memberId` doesn't match any member: GlassCard "Member not found" + Back button.

**AC#23** Brand-not-found state when `:id` doesn't match any brand on team list AND member detail routes: same pattern as J-A7/J-A8.

**AC#24** Persist v6 → v7 migration cold-launch — app opens without crash; existing v6 brands hydrate with `members` and `pendingInvitations` undefined; team list renders empty state for those brands.

**AC#25** Web direct URL navigation `/brand/lm/team` and `/brand/lm/team/m_lm_marcus` open correctly.

**AC#26** TopBar on team list: title "Team" + back arrow. TopBar on member detail: title "Member" + back arrow.

**AC#27** `npx tsc --noEmit` exits 0. No `any`, no `@ts-ignore`, no kit extension. Both new routes have `backgroundColor: canvas.discover` (I-12).

**AC#28** All `[TRANSITIONAL]` markers grep-verifiable: 300ms simulated invite-send delay (BrandInviteSheet) + Resend Toast (BrandTeamView) + Email-tap-to-copy Toast (BrandMemberDetailView) + isCurrentUserSelf stub comment (route file). J-A9 marker `"Team UI lands in J-A9."` REMOVED from BrandProfileView.

**AC#29** Avatar40 inline composition matches design tokens — circular Pressable bg `accent.tint` + border `accent.border` + initial in `accent.warm`. Photo URL renders as Image when present. Dimmed variant has 50% opacity (for pending rows).

**AC#30** FAB position safe-area-aware — bottom inset = `Math.max(insets.bottom, spacing.lg) + spacing.md`. Right inset = `spacing.md`. 56×56 circular Pressable, accent.warm bg, white plus icon.

**AC#31** Format relative-time outputs match expected pattern — `lastActiveAt = "2026-04-29T14:20:00Z"` (assume current time 2026-04-29T20:00:00Z, ~5h ago) → renders "5h ago". `lastActiveAt = "2026-04-26T10:00:00Z"` → renders "3d ago".

**AC#32** Pending row "Invited 2d ago" computed via formatRelativeTime against `invitation.invitedAt`.

**AC#33** Inline error styling on invite sheet — text color `semantic.error` + caption typography + appears below the relevant Input/field; clears when user edits the relevant field.

---

## 5. Invariants

| ID | Preserve / Establish |
|---|---|
| I-1 | designSystem.ts not modified |
| I-3 | iOS / Android / web all execute |
| I-4 | No `app-mobile/` imports |
| I-6 | tsc strict clean — explicit return types on all new components and inline helpers |
| I-7 | TRANSITIONAL markers labeled (Resend Toast · simulated invite-send delay · email-tap-to-copy · isCurrentUserSelf stub heuristic) |
| I-9 | No animation timings touched (Sheet/ConfirmDialog reuse existing animations) |
| I-11 | Format-agnostic ID resolver — same pattern in `[memberId]` segment |
| I-12 | Host-bg cascade — both new routes set `backgroundColor: canvas.discover` |
| I-13 | Overlay-portal contract — Sheet (invite + role-picker) inherits RN Modal portal; ConfirmDialog mounted at screen-View root (HF-1 mitigation) |
| DEC-071 | Frontend-first; no backend code |
| DEC-079 | Kit closure preserved (Avatar / FAB / RelativeTime composed inline; no new primitive) |
| DEC-080 | TopSheet untouched |
| DEC-081 | No `mingla-web/` references |
| DEC-082 | Icon set unchanged — `users` + `chevR` + `plus` already exist; no new icons needed |

**Retired markers:** J-A7's `"Team UI lands in J-A9."` Toast row exits this cycle.

**New code-structural pattern:** Operations-row navigation prop on BrandProfileView (J-A8 added `onEdit`; J-A9 adds `onTeam`; J-A10 will add `onPayments`; J-A12 will add `onReports`). Document in BrandProfileViewProps interface comment.

---

## 6. Test Cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-A9-01 | Operations row navigation | Tap "Team & permissions" on /brand/lm/ | Navigates to /brand/lm/team | Component (J-A7) + Route |
| T-A9-02 | Member-count sub-text | Inspect Operations row #2 sub-text on /brand/lm/ | "3 members" | Component (J-A7) |
| T-A9-03 | Member-count singular | Inspect Operations row #2 sub-text on /brand/hr/ | "1 member" | Component (J-A7) |
| T-A9-04 | Team list populated | Open /brand/lm/team | Sara (Owner) + Marcus + Liz active rows + 1 pending row | Component + Route |
| T-A9-05 | Owner pinned at index 0 | Open /brand/lm/team | Sara row is FIRST | Component |
| T-A9-06 | Pending section appears only when pending count > 0 | Open /brand/tll/team | NO PENDING section header rendered | Component |
| T-A9-07 | Empty-state demo | Open /brand/hr/team | Owner row + GlassCard "Invite teammates to help run Hidden Rooms" + Invite Button | Component |
| T-A9-08 | FAB renders bottom-right | Inspect /brand/lm/team | 56×56 circular accent.warm button at bottom-right | Component |
| T-A9-09 | FAB tap opens invite sheet | Tap FAB | Sheet opens at full snap-point | Component |
| T-A9-10 | Invite empty email | Send invitation with empty email | Inline error "Enter a valid email." | Component |
| T-A9-11 | Invite invalid email | Send "abc" without @ | Inline error "Enter a valid email." | Component |
| T-A9-12 | Invite duplicate member | Send marcus@lonelymoth.events to LM | Inline error "Marcus Chen is already on the team." | Component |
| T-A9-13 | Invite duplicate pending | Send joel.parker@gmail.com to LM | Inline error "Already invited. Resend?" | Component |
| T-A9-14 | Invite missing role | Valid email, no role, Send | Inline error "Pick a role for {email}." | Component |
| T-A9-15 | Invite happy path | Valid new email + role + Send | 300ms saving → Sheet closes → Toast "Invitation sent" → new pending row | Component + Route |
| T-A9-16 | Resend pending | Tap Resend on Joel row | Toast TRANSITIONAL "Invite resent" — list unchanged | Component |
| T-A9-17 | Cancel pending | Tap Cancel on Joel row | Joel row removed from list | Component + Route |
| T-A9-18 | Member detail navigation | Tap Marcus row | Navigates to /brand/lm/team/m_lm_marcus | Component + Route |
| T-A9-19 | Member detail non-owner | Open /brand/lm/team/m_lm_marcus | Avatar + name + Admin pill + Joined + Last active + Email + Change role + Remove buttons | Component |
| T-A9-20 | Member detail owner-self | Open /brand/lm/team/m_lm_sara | Avatar + name + Owner pill + Joined + Last active + Email + helper card "You're the owner..." NO Change role / Remove buttons | Component |
| T-A9-21 | Change role picker | Tap Change role on Marcus | RolePickerSheet opens with 5 options + "Admin" preselected | Component |
| T-A9-22 | Change role apply | Pick "Events" in picker | Sheet closes → Marcus role pill becomes "Events" | Component + Route |
| T-A9-23 | Change role same | Pick "Admin" (current) in picker | Sheet closes → no state mutation | Component |
| T-A9-24 | Remove confirm dialog | Tap Remove on Marcus | ConfirmDialog "Remove Marcus Chen?" + "Remove Marcus Chen from Lonely Moth? They'll lose access immediately." | Component |
| T-A9-25 | Remove confirm | Tap Remove in dialog | Dialog closes → router.back() → Marcus gone from list | Component + Route |
| T-A9-26 | Remove cancel | Tap "Keep on team" in dialog | Dialog closes → Marcus remains | Component |
| T-A9-27 | Member-not-found | Navigate to /brand/lm/team/xyz | Not-found GlassCard + Back button | Component + Route |
| T-A9-28 | Brand-not-found team | Navigate to /brand/xyz/team | Not-found GlassCard + Back button | Component + Route |
| T-A9-29 | Brand-not-found member | Navigate to /brand/xyz/team/abc | Not-found GlassCard + Back button | Component + Route |
| T-A9-30 | Persist v6→v7 | Cold-launch with v6 persisted state | App opens; brands hydrate with members=undefined; team list renders empty state | State migration |
| T-A9-31 | Web direct URL list | Paste /brand/sl/team in browser, sign in | Team list renders for Sunday Languor | Route + web |
| T-A9-32 | Web direct URL detail | Paste /brand/sl/team/m_sl_tom in browser, sign in | Member detail renders for Tom Reilly | Route + web |
| T-A9-33 | Web back button | Web team list → tap member → web back button | Returns to team list with state preserved | Route + web |
| T-A9-34 | Format relative time | lastActiveAt = (now - 5h) | Renders "5h ago" | Inline utility |
| T-A9-35 | Format joined date | joinedAt = "2025-07-01T10:00:00Z" | Renders "Jul 2025" | Inline utility |
| T-A9-36 | Avatar fallback | Member with no photo | Renders initial in accent.warm over accent.tint | Component |
| T-A9-37 | Avatar dimmed | Pending row | Avatar40 with 50% opacity | Component |
| T-A9-38 | tsc strict | `npx tsc --noEmit` | exit 0 | Build |
| T-A9-39 | Host-bg cascade | Inspect /brand/lm/team and /brand/lm/team/m_lm_marcus | Both have dark canvas (canvas.discover) | Route |
| T-A9-40 | TRANSITIONAL marker grep | Grep BrandProfileView.tsx for "Team UI lands in J-A9" | 0 matches (marker REMOVED) | Build |
| T-A9-41 | Sheet portal — invite | Open invite sheet on team list | Sheet renders above all content (not clipped by ScrollView) | Component |
| T-A9-42 | Sheet portal — role picker | Open role picker on member detail | Sheet renders above ConfirmDialog if both somehow open (RN Modal stacks newer-on-top) | Component |
| T-A9-43 | ConfirmDialog mount discipline | Inspect tree — ConfirmDialog mounted at View root | NOT inside ScrollView; renders correctly when triggered | Component |
| T-A9-44 | Inline error clears on edit | Type "abc" → Send (error) → type "@" character | Error clears immediately | Component |

---

## 7. Implementation Order

1. **Schema bump** — currentBrandStore.ts: add types (BrandMemberRole, InviteRole, BrandMemberStatus, BrandMember, BrandInvitationStatus, BrandInvitation) + extend Brand with `members?` + `pendingInvitations?`. Bump persist v6 → v7. Header comment update.
2. **tsc check** — clean.
3. **Stub data** — brandList.ts: add member arrays + pendingInvitations to all 4 stubs per §3.2.
4. **tsc check** — clean.
5. **Build RolePickerSheet** — `src/components/brand/RolePickerSheet.tsx`. Reusable Sheet picker. Sheet snap-point="full". Inline ROLE_DESCRIPTIONS map.
6. **tsc check** — clean.
7. **Build BrandInviteSheet** — `src/components/brand/BrandInviteSheet.tsx`. Email Input + role select Pressable (opens RolePickerSheet) + Optional note (InlineTextArea inline) + Send Button. Validation + 300ms simulated delay. Inline error rendering. Reset draft on visible toggle.
8. **tsc check** — clean.
9. **Build BrandTeamView** — `src/components/brand/BrandTeamView.tsx`. TopBar + ScrollView with TEAM + PENDING sections + FAB at bottom-right. Inline Avatar40 + formatRelativeTime + formatJoinedDate utilities + role mappings. Mount BrandInviteSheet at View root. Toast.
10. **tsc check** — clean.
11. **Build BrandMemberDetailView** — `src/components/brand/BrandMemberDetailView.tsx`. TopBar + identity block + stats row + email row + actions OR owner-self helper card. Mount RolePickerSheet + ConfirmDialog at View root. Toast.
12. **tsc check** — clean.
13. **Create team-list route** — `app/brand/[id]/team/index.tsx`. Format-agnostic id resolver + canvas.discover host-bg + onSendInvite + onCancelInvite + onOpenMember handlers wired to setBrands.
14. **tsc check** — clean.
15. **Create member-detail route** — `app/brand/[id]/team/[memberId].tsx`. Nested format-agnostic resolver + canvas.discover host-bg + onChangeRole + onRemove handlers + isCurrentUserSelf stub. After remove: router.back().
16. **tsc check** — clean.
17. **Wire J-A7 Operations row** — modify BrandProfileView.tsx: add `onTeam` prop, replace OPERATIONS_ROWS static array with hook-derived `operationsRows` injecting per-row onPress + dynamic Team sub-text. Remove `[TRANSITIONAL]` Toast for the team row only. Modify `app/brand/[id]/index.tsx` to pass `onTeam` handler.
18. **tsc check** — clean.
19. **Grep verify** — check absent: `"Team UI lands in J-A9"` (must be 0 matches in BrandProfileView). Check present: TRANSITIONAL markers in BrandInviteSheet (300ms), BrandTeamView (Resend Toast), BrandMemberDetailView (email-tap-to-copy + isCurrentUserSelf stub).
20. **Implementation report** — outputs/IMPLEMENTATION_BIZ_CYCLE_2_J_A9_BRAND_TEAM.md with old→new receipts per file.

---

## 8. Regression Prevention

- **Operations-row navigation pattern documented** — `BrandProfileViewProps` interface comment lists the growing prop set: `onEdit` (J-A8), `onTeam` (J-A9), future `onPayments` (J-A10), `onPaymentsOnboard` (J-A10), `onReports` (J-A12), etc. Pattern: every Operations row that becomes live gets a navigation callback prop on the view; the route owns the navigation; the view never `useRouter`s itself.
- **TRANSITIONAL marker churn discipline** — the OPERATIONS_ROWS hook-derived array drops one Toast call per cycle. J-A9 removes `"Team UI lands in J-A9."`; J-A10 removes `"Stripe Connect lands in J-A10."`; J-A12 removes `"Finance reports land in J-A12."`. Implementor verifies each cycle.
- **Roles type discipline** — `BrandRole` (current-user view) and `BrandMemberRole` (team-member view) MUST stay distinct. Naming separation enforced. Code comment in currentBrandStore.ts:
  ```
  // BrandRole: from the brand list, what role does the current user hold on
  // this brand? Used for permission gating in the founder-facing UI.
  // BrandMemberRole: from a brand's perspective, what role does a given
  // team member hold? Used for member rendering + role assignment.
  // These are intentionally separate enums — do NOT collapse them.
  ```
- **Sheet mount discipline** — code comment in BrandInviteSheet + RolePickerSheet:
  ```
  // I-13 invariant: this Sheet portals to OS root via the kit Sheet
  // primitive (which wraps RN Modal). Safe to mount anywhere in the tree.
  ```
- **ConfirmDialog mount discipline** — code comment in BrandMemberDetailView:
  ```
  // HF-1 carry-over: ConfirmDialog wraps kit ./Modal which does NOT yet
  // portal to OS root. Mount this dialog at the screen-View tree root
  // (NOT inside ScrollView/FlatList/positioned ancestor) until HF-1's
  // separate ORCH ships the portal upgrade.
  ```
- **Format-agnostic resolver for nested segments** — establishes the pattern for `/brand/[id]/team/[memberId]`. Future surfaces with nested IDs (`/event/[id]/orders/[orderId]`) follow same `find()`-on-array pattern with NO normalization. Tested by T-A9-27, T-A9-28, T-A9-29.

---

## 9. Founder-facing UX (plain English summary)

When this lands the founder will:

- On any brand profile, tap **"Team & permissions"** → land on a team list showing themselves (Owner) + any teammates they've added, plus pending invitations greyed below
- Tap **+ FAB bottom-right** → invite sheet slides up. Type teammate's email, pick a role from 5 options (Admin / Events / Finance / Marketing / Scanner), optionally add a note, tap **Send invitation** → ~300ms pause → Toast "Invitation sent to {email}." → list refreshes with the new pending row
- Tap **Resend** on a pending row → Toast "Invite resent to {email}." (purely UI — real email pipeline is B5)
- Tap **Cancel** on a pending row → invitation disappears
- Tap any active member row → land on member detail screen showing avatar, name, role, joined date, last active, email
- Tap **Change role** → role picker slides up with 5 options + descriptions. Pick a new role → role pill on the screen updates immediately
- Tap **Remove from {brand}** → confirmation dialog "Remove {Name}?" → confirm → member removed → returns to team list
- On their own profile (the Owner) → no Change role / Remove buttons. Helper card explains "You're the owner. Owners can't be removed or change their own role. To leave, transfer ownership first." (Transfer-ownership flow is post-MVP — copy is honest stub.)

**What this DOESN'T do yet:** real email pipeline (Resend stays Toast-only), real session tracking (last-active is stub timestamps), real role enforcement (Cycle 2 has no permission gating — anyone can edit anything; B1 wires RLS), the accept-invitation deep-link flow (the email a teammate would click in their inbox needs real tokens — also B1), permissions matrix view (deferred), audit log (deferred).

---

## 10. Out-of-band carve-outs

| Carry-over | Status in J-A9 |
|---|---|
| **D-IMPL-A7-6** Host-bg cascade (J-A7) | ✅ ADDRESSED — both new routes apply I-12 |
| **H-1 (J-A6 audit)** ID format tolerance | ✅ ADDRESSED — same format-agnostic resolver in nested segment |
| **HF-1 (J-A8 polish)** ConfirmDialog NOT portaled | ⚠ MITIGATED — ConfirmDialog mounted at screen-View root (not inside ScrollView). Permanent fix is separate ORCH dispatch. |
| **HF-2 (J-A8 polish)** kit `./Modal` NOT portaled | ⚠ MITIGATED — same as HF-1 (ConfirmDialog uses kit Modal). |
| **D-INV-A8-1** "Allow DMs" + "List in Discover" toggles | ❌ DEFERRED to §5.3.6 settings cycle |
| **D-INV-A8-2** Custom links multi-add UI | ❌ DEFERRED to polish or settings cycle |
| **D-INV-A8-3** Toggle primitive carve-out | ⏸ Watch-point — not triggered by J-A9 |
| **D-INV-A9-1** Permissions matrix UI | ❌ DEFERRED to §5.3.6 settings or B1 |
| **D-INV-A9-2** Accept-invitation deep-link | ❌ DEFERRED to B1 (real tokens) |
| **D-INV-A9-3** Avatar primitive carve-out | ⏸ Watch-point — J-A9 hits 3+ uses count |
| **D-INV-A9-4** TextArea primitive carve-out | ⏸ Watch-point — J-A9 hits 2 uses |
| **D-INV-A9-5** formatRelativeTime utility | ⏸ Watch-point — J-A9 hits first use |
| **D-INV-A9-6** FAB primitive carve-out | ⏸ Watch-point — J-A9 hits first use |
| **D-INV-A9-7** Transfer-ownership flow | ❌ DEFERRED to post-MVP |
| **D-INV-A9-8** Real session/last-active tracking | ❌ DEFERRED to B1 |
| **D-INV-A9-9** Real cross-brand email-uniqueness check | ❌ DEFERRED to B1 |

---

## 11. Dispatch hand-off

Implementor dispatch shall reference both:
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-BIZ-CYCLE-2-J-A9.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-BIZ-CYCLE-2-J-A9_BRAND_TEAM.md` (this file)

Implementor follows §7 implementation order verbatim. Tester (or operator smoke) verifies T-A9-01 through T-A9-44 inclusive.

---

**End of J-A9 spec.**
