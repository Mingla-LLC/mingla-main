# SPEC — BIZ Cycle 14 (Account: edit profile, settings, delete-flow, sign out)

**Status:** BINDING contract — produced by `/mingla-forensics` SPEC mode 2026-05-04 against dispatch [`prompts/SPEC_BIZ_CYCLE_14_ACCOUNT.md`](../prompts/SPEC_BIZ_CYCLE_14_ACCOUNT.md)
**Cycle:** Cycle 14 — Account: edit profile, settings, delete-flow, sign out (canonical per [`github/epics/cycle-14.md`](../github/epics/cycle-14.md))
**Confidence:** **H** — investigation H per thread + H overall; all 14 architectural decisions locked via DEC-096; SPEC executes the dispatch §3.3 anticipated D-14-2 fallback pivot (NEW `creator_avatars` bucket) since `brand_covers` bucket verified absent; remaining 13 decisions ship verbatim.
**Estimated IMPL wall:** ~48h (epic budget exact match)

---

## 1 — Layman summary

Cycle 14 ships Phase 5 — operator's Account hub. Today's tab is a Cycle 0a placeholder (sign-out + email + brand list + dev seeds); Cycle 14 transforms it into a hub-and-spoke pattern: existing baseline preserved (D-14-17); ADD 3 sub-routes (`/account/edit-profile` for J-A1 name+photo; `/account/notifications` for J-A2 4-toggle settings; `/account/delete` for J-A4 4-step delete flow); RENAME existing sign-out button to "Sign out everywhere" (already global default in Supabase v2.39+; D-14-8). PR #59 already shipped 80% of the schema (`creator_accounts.deleted_at` + `account_deletion_requests` audit table + `marketing_opt_in` + `phone_e164`). NEW 1-line invariant I-35 codifies the soft-delete contract. Single migration adds **`creator_avatars` storage bucket** (D-14-2 fallback pivot — `brand_covers` verified absent during SPEC). ZERO new dependencies. ~+1640 net LOC across 7 NEW + 5 MOD files.

---

## 1.5 — Pivots from dispatch (operator-aware)

| Decision | Dispatch value | SPEC effective value | Why |
|----------|----------------|----------------------|-----|
| **D-14-2** | "Reuse `brand_covers` bucket with `profiles/` path prefix" | **NEW `creator_avatars` bucket** (mirror consumer-app `avatars` migration pattern) | Verified at SPEC-time: `brand_covers` bucket does NOT exist (0 migrations match `storage.buckets` insert for it); Cycle 7 brand "cover" is hue-based via `EventCover.tsx` not image upload; `expo-image-picker` is INSTALLED but UNUSED in mingla-business src/. Dispatch §3.3 anticipated this fallback under name "profile_photos"; renamed to `creator_avatars` for naming consistency with consumer-app `avatars` bucket pattern (`20250226000007_create_avatars_storage_bucket.sql`). |

**Operator-aware impact:** the fallback adds ~55 LOC migration that wasn't in DEC-096's scope estimate but DOES match dispatch §3.3 anticipated path. Net file count unchanged (still 1 NEW migration); migration content size unchanged (~40-55 LOC). No operator decision-lock-in needed — SPEC executes the documented fallback.

The other 13 decisions (D-14-1, D-14-3..D-14-17 minus D-14-2) ship verbatim per DEC-096.

---

## 2 — Cited inputs (binding context)

| # | Input | Why bound to this SPEC |
|---|-------|----------------------|
| 1 | [`reports/INVESTIGATION_BIZ_CYCLE_14_ACCOUNT.md`](../reports/INVESTIGATION_BIZ_CYCLE_14_ACCOUNT.md) | Source of schema findings (PR #59 80%-complete) + auth provider variant matrix + 6 D-CYCLE14-FOR discoveries |
| 2 | [`DECISION_LOG.md`](../DECISION_LOG.md) DEC-096 | Locks 14 architectural decisions D-14-1..D-14-17 (D-14-12/15/16 schema-resolved; D-14-2 SPEC-pivoted per §1.5) |
| 3 | [`github/epics/cycle-14.md`](../github/epics/cycle-14.md) | Canonical epic — 5 journeys (J-A1..J-A5); ~48h budget; Phase 5 — Account + Polish |
| 4 | [`prompts/SPEC_BIZ_CYCLE_14_ACCOUNT.md`](../prompts/SPEC_BIZ_CYCLE_14_ACCOUNT.md) | Dispatch — 12 sections + 36 SC + 40 T + 15-step impl order outlines |
| 5 | `mingla-business/app/(tabs)/account.tsx` (Cycle 0a + 1) | Baseline preserved per D-14-17 |
| 6 | `mingla-business/src/context/AuthContext.tsx` (Cycle 6 + 0b) | Recovery-on-sign-in MOD point |
| 7 | `mingla-business/src/services/creatorAccount.ts` | `ensureCreatorAccount` + new `updateCreatorAccount` helper |
| 8 | `mingla-business/src/utils/clearAllStores.ts` (Cycle 3 origin + extended each cycle) | Const #6 cascade extension for new notification store |
| 9 | `supabase/migrations/20260502100000_b1_business_schema_rls.sql` lines 38-78 | PR #59 — `creator_accounts.deleted_at` + `account_deletion_requests` table + `marketing_opt_in` (already shipped) |
| 10 | `supabase/migrations/20250226000007_create_avatars_storage_bucket.sql` | Architectural model for NEW `creator_avatars` migration (mirror pattern; tighten path-scoped RLS) |
| 11 | `supabase/functions/delete-user/index.ts` (consumer app) | Architectural model for B-cycle business delete-account edge fn (D-CYCLE14-FOR-1) |
| 12 | Memory rules (11 entries, MEMORY.md) | `feedback_diagnose_first_workflow` · `feedback_orchestrator_never_executes` · `feedback_no_summary_paragraph` · `feedback_implementor_uses_ui_ux_pro_max` · `feedback_keyboard_never_blocks_input` · `feedback_rn_color_formats` · `feedback_toast_needs_absolute_wrap` · `feedback_rn_sub_sheet_must_render_inside_parent` · `feedback_anon_buyer_routes` · `feedback_no_coauthored_by` · `feedback_sequential_one_step_at_a_time` |

---

## 3 — Scope · Non-goals · Assumptions

### 3.1 Scope (BINDING)

**4 NEW route/utility files:**

| Path | Purpose | Approx LOC |
|------|---------|------------|
| `mingla-business/app/account/edit-profile.tsx` | J-A1 — Edit profile (name + photo) | ~280 |
| `mingla-business/app/account/notifications.tsx` | J-A2 — Notification settings (4 toggles + TRANSITIONAL banner) | ~220 |
| `mingla-business/app/account/delete.tsx` | J-A4 — Delete-account 4-step internal state machine | ~620 |
| `mingla-business/src/utils/accountDeletionPreview.ts` | Pure aggregator over 6 stores for itemized cascade preview | ~150 |

**3 NEW hooks/store:**

| Path | Purpose | Approx LOC |
|------|---------|------------|
| `mingla-business/src/hooks/useCreatorAccount.ts` | React Query hook + update mutation against `creator_accounts` | ~95 |
| `mingla-business/src/hooks/useAccountDeletion.ts` | React Query mutation for `creator_accounts.deleted_at` UPDATE + recovery helper | ~85 |
| `mingla-business/src/store/notificationPrefsStore.ts` | Zustand persist v1 — 4-toggle TRANSITIONAL state | ~95 |

**5 MOD files:**

| Path | Change | Approx LOC delta |
|------|--------|------------------|
| `mingla-business/app/(tabs)/account.tsx` | ADD Settings GlassCard with 3 NavRows + RENAME sign-out button + new handlers + 3 imports | +55 / 0 |
| `mingla-business/src/context/AuthContext.tsx` | Recovery-on-sign-in: bootstrap reads `creator_accounts.deleted_at`; auto-clear if non-null + emit `recoveryEvent` flag for consumer toast | +35 / 0 |
| `mingla-business/src/services/creatorAccount.ts` | Add `updateCreatorAccount(userId, patch)` mutation helper alongside existing `ensureCreatorAccount` | +30 / 0 |
| `mingla-business/src/utils/clearAllStores.ts` | Add `useNotificationPrefsStore.reset()` to cascade per Const #6 | +1 |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | NEW invariant I-35 — `creator_accounts.deleted_at` soft-delete contract + recover-on-sign-in auto-clear + 30-day window | +28 |

**1 NEW migration:**

| Path | Purpose | Approx LOC |
|------|---------|------------|
| `supabase/migrations/20260504_b1_phase5_creator_avatars.sql` | NEW `creator_avatars` storage bucket + 3 path-scoped RLS policies (upload self / update self / public read for organiser pages) | ~55 |

**Totals:** 7 NEW files + 5 MOD + 1 NEW migration = 13 file touches. ~+1690 net LOC.

**0 NEW dependencies** (`expo-image-picker` already installed; just unused in mingla-business src/ today).

### 3.2 Non-goals (DO NOT IMPLEMENT)

- Backend / RLS / edge-function work beyond `creator_avatars` bucket: `request-account-deletion` edge fn + 30-day cron + `auth.admin.deleteUser` CASCADE + Resend account-deletion email all DEFER to B-cycle
- Push notification SDK install (`react-native-onesignal` / `expo-notifications` / `@notifee`) — TRANSITIONAL toggles only Cycle 14
- Email-OTP auth path (Mingla Business stays Google + Apple)
- `creator_accounts.business_name` / `phone_e164` editability (D-CYCLE14-FOR-2/3 deferred)
- Brand ownership transfer (D-CYCLE14-FOR-4 — IMMUTABLE trigger blocks; future cycle)
- Active sessions list (D-14-9 omit per lock)
- Per-event audit log writes for account events (D-14-15 — `account_deletion_requests` service-role-only)
- Force-transfer / block-on-active-events (D-14-14 lock — warn-don't-block)
- Reuse of `brand_covers` bucket (verified absent — pivoted to NEW `creator_avatars` per §1.5)
- Cleanup of unused `expo-image-picker` package import (out of scope; Cycle 14 puts it to use)

### 3.3 Assumptions

- `creator_avatars` bucket creation succeeds via `supabase db push` (no upstream blockers — mirrors proven `avatars` bucket pattern)
- Supabase JS v2.39+ defaults `signOut()` to `{ scope: 'global' }` — verified in package.json (`@supabase/supabase-js@^2.74.0`); implementor reconfirms at Step 0
- All 6 source stores (orderStore + doorSalesStore + guestStore + scanStore + currentBrandStore + brandTeamStore) hydrate before Account tab renders — cascade preview reads raw entries directly. Stale-cache risk acceptable (counts are "best estimate"; B-cycle hard-delete is server-side authoritative).

---

## 4 — Layer specification

### 4.1 Database / Storage layer

#### 4.1.1 NEW migration — `supabase/migrations/20260504_b1_phase5_creator_avatars.sql`

**Mirror pattern from `20250226000007_create_avatars_storage_bucket.sql` with TIGHTER path-scoped RLS** (mingla-business is operator-side; we want self-write only on `creator_avatars/{userId}.{ext}` paths):

```sql
-- Cycle 14 Phase 5 — creator_avatars storage bucket for operator profile photos.
-- Mirrors consumer-app avatars bucket pattern (20250226000007) with tighter
-- path-scoped RLS — operator can only upload/update files where the path
-- prefix matches their own auth.uid().
--
-- Path convention: creator_avatars/{userId}.{ext} where ext is jpg|png|webp.
-- Public read so brand profile pages (anon access) can fetch by URL.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'creator_avatars',
  'creator_avatars',
  true, -- Public bucket so avatars can be served on organiser profile pages
  10485760, -- 10MB file size limit (matches consumer-app avatars)
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies for creator_avatars bucket
-- Path structure: creator_avatars/{userId}.{ext}

DROP POLICY IF EXISTS "Creator can upload own avatar"
  ON storage.objects;
DROP POLICY IF EXISTS "Creator can update own avatar"
  ON storage.objects;
DROP POLICY IF EXISTS "Creator can delete own avatar"
  ON storage.objects;
DROP POLICY IF EXISTS "Anyone can read creator avatars"
  ON storage.objects;

-- Authenticated user can upload only to their own userId path
CREATE POLICY "Creator can upload own avatar"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'creator_avatars'
    AND split_part(name, '.', 1) = auth.uid()::text
  );

-- Authenticated user can update only their own avatar file
CREATE POLICY "Creator can update own avatar"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'creator_avatars'
    AND split_part(name, '.', 1) = auth.uid()::text
  );

-- Authenticated user can delete only their own avatar file
CREATE POLICY "Creator can delete own avatar"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'creator_avatars'
    AND split_part(name, '.', 1) = auth.uid()::text
  );

-- Anyone can read avatars (organiser profile pages are anon-accessible)
CREATE POLICY "Anyone can read creator avatars"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'creator_avatars');

COMMENT ON POLICY "Creator can upload own avatar" ON storage.objects IS
  'Cycle 14 Phase 5 — path-scoped self-write. File path MUST be creator_avatars/{userId}.{ext}.';
```

**Path enforcement note:** `split_part(name, '.', 1) = auth.uid()::text` extracts the part before the first `.` from the file name. So a file `creator_avatars/abc-123-uuid.jpg` has `split_part = 'abc-123-uuid'` and matches `auth.uid()::text` if the user's UUID is `abc-123-uuid`. This blocks path-injection attacks and ensures one user can't overwrite another's avatar.

**Implementor note:** mobile uploads via `supabase.storage.from('creator_avatars').upload('{userId}.{ext}', blob, { upsert: true })` — `upsert: true` allows update via the same INSERT path as upload (RLS triggers UPDATE policy automatically when the row exists).

### 4.2 Verification step (mandatory at Step 0 BEFORE any code)

Before writing any code, implementor verifies:

1. **`creator_avatars` bucket migration applies cleanly.** Run `supabase db push` against a test DB or read live `storage.buckets` to confirm bucket creation. If migration conflicts → STOP and surface to orchestrator.
2. **Supabase JS v2.39+ default `signOut()` scope is `global`.** Read `node_modules/@supabase/auth-js/src/GoTrueClient.ts` `signOut` method default arg OR upstream docs. If different → STOP (D-14-8 pivot needed).
3. **`creator_accounts.deleted_at` column exists in production schema.** Re-confirm PR #59 schema (already verified at forensics; reconfirm at Step 0). If absent → STOP.

### 4.3 Hook layer

#### 4.3.1 NEW — `mingla-business/src/hooks/useCreatorAccount.ts`

**Header docstring:**

```ts
/**
 * useCreatorAccount — React Query hook for the signed-in user's creator_accounts row (Cycle 14).
 *
 * Per DEC-096 D-14-3: direct React Query mutation against creator_accounts via
 * existing self-write UPDATE RLS policy (creator can read/write own account).
 *
 * Const #5 server state in React Query — NOT Zustand (this is server-fetched data).
 *
 * Per Cycle 14 SPEC §4.3.1.
 */
```

**Required exports (verbatim signatures):**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";

export interface CreatorAccountRow {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  marketing_opt_in: boolean;
  deleted_at: string | null;
}

export interface CreatorAccountUpdatePatch {
  display_name?: string;
  avatar_url?: string | null;
  marketing_opt_in?: boolean;
}

export interface CreatorAccountState {
  data: CreatorAccountRow | null;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

const STALE_TIME_MS = 5 * 60 * 1000; // 5 min — account row changes are rare

export const creatorAccountKeys = {
  all: ["creator-account"] as const,
  byId: (userId: string): readonly [string, string] =>
    ["creator-account", userId] as const,
};

const DISABLED_KEY = ["creator-account-disabled"] as const;

export const useCreatorAccount = (): CreatorAccountState => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const enabled = userId !== null;

  const { data, isLoading, isError, refetch } = useQuery<CreatorAccountRow | null>({
    queryKey: enabled ? creatorAccountKeys.byId(userId) : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<CreatorAccountRow | null> => {
      if (!enabled || userId === null) return null;
      const { data, error } = await supabase
        .from("creator_accounts")
        .select("id, email, display_name, avatar_url, marketing_opt_in, deleted_at")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });

  return { data: data ?? null, isLoading, isError, refetch };
};

export const useUpdateCreatorAccount = (): {
  mutateAsync: (patch: CreatorAccountUpdatePatch) => Promise<void>;
  isPending: boolean;
} => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (patch: CreatorAccountUpdatePatch): Promise<void> => {
      if (user === null) throw new Error("Not signed in");
      const { error } = await supabase
        .from("creator_accounts")
        .update(patch)
        .eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: (): void => {
      if (user !== null) {
        queryClient.invalidateQueries({
          queryKey: creatorAccountKeys.byId(user.id),
        });
      }
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};
```

#### 4.3.2 NEW — `mingla-business/src/hooks/useAccountDeletion.ts`

**Header docstring:**

```ts
/**
 * useAccountDeletion — React Query mutation for soft-deleting + recovery (Cycle 14).
 *
 * Per DEC-096 D-14-12 (FORCED — schema already shipped): UPDATE creator_accounts
 * .deleted_at = now() via existing self-write UPDATE RLS policy. NO insert into
 * account_deletion_requests (B-cycle service-role edge fn writes that audit row).
 *
 * Per D-CYCLE14-FOR-6: recovery-on-sign-in auto-clears the marker — implemented
 * here as `tryRecoverAccountIfDeleted` non-hook helper (consumed by AuthContext
 * bootstrap per §4.6.5).
 *
 * Per Cycle 14 SPEC §4.3.2.
 */
```

**Required exports:**

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import { creatorAccountKeys } from "./useCreatorAccount";

/**
 * Mutation: soft-delete current user's account by setting deleted_at = now().
 * On success the caller fires signOut() — not done here so the mutation has a
 * clean separation of concerns (caller controls navigation post-delete).
 */
export const useRequestAccountDeletion = (): {
  mutateAsync: () => Promise<void>;
  isPending: boolean;
} => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (): Promise<void> => {
      if (user === null) throw new Error("Not signed in");
      const { error } = await supabase
        .from("creator_accounts")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: (): void => {
      if (user !== null) {
        queryClient.invalidateQueries({
          queryKey: creatorAccountKeys.byId(user.id),
        });
      }
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};

/**
 * Non-hook helper called from AuthContext bootstrap. If the signed-in user has
 * a non-null deleted_at, clear it (auto-recovery within 30-day window) and
 * return true so the caller can show "Welcome back — your account has been
 * recovered." toast on next mount.
 *
 * Returns false if no recovery happened (deleted_at was already null OR query
 * failed — caller treats as no-op).
 */
export const tryRecoverAccountIfDeleted = async (
  userId: string,
): Promise<boolean> => {
  const { data, error } = await supabase
    .from("creator_accounts")
    .select("deleted_at")
    .eq("id", userId)
    .maybeSingle();
  if (error || data === null) return false;
  if (data.deleted_at === null) return false;
  const { error: updateError } = await supabase
    .from("creator_accounts")
    .update({ deleted_at: null })
    .eq("id", userId);
  return !updateError;
};
```

### 4.4 Service layer

#### 4.4.1 MOD — `mingla-business/src/services/creatorAccount.ts`

Existing `ensureCreatorAccount(user)` upsert helper preserved. ADD:

```ts
/**
 * Update creator_accounts row by id. Throws on error (caller surfaces toast).
 * Cycle 14 NEW per SPEC §4.4.1. Used by useUpdateCreatorAccount mutation.
 */
export async function updateCreatorAccount(
  userId: string,
  patch: {
    display_name?: string;
    avatar_url?: string | null;
    marketing_opt_in?: boolean;
  },
): Promise<void> {
  const { error } = await supabase
    .from("creator_accounts")
    .update(patch)
    .eq("id", userId);
  if (error) throw error;
}
```

(Implementor note: `useUpdateCreatorAccount` hook may inline the supabase call rather than use this helper — either is fine; SPEC writer's preference is the helper for testability + future-proofing.)

### 4.5 Store layer

#### 4.5.1 NEW — `mingla-business/src/store/notificationPrefsStore.ts`

**Header docstring:**

```ts
/**
 * notificationPrefsStore — persisted Zustand store for notification preferences (Cycle 14).
 *
 * Per DEC-096 D-14-7: 4-toggle TRANSITIONAL state until B-cycle wires real
 * delivery (OneSignal SDK + Resend + edge fn + user_notification_prefs table).
 *
 * Marketing toggle is also synced to creator_accounts.marketing_opt_in via
 * useUpdateCreatorAccount mutation in the consumer (this store holds the
 * client-side cache for ALL 4; the marketing one is ALSO persisted to backend
 * since the schema column exists).
 *
 * Constitutional notes:
 *   - #2 one owner per truth: notification prefs UI cache lives ONLY here
 *     (mirrors marketing schema column for the 1 already-persisted toggle).
 *   - #6 logout clears: extended via clearAllStores per SPEC §3.1.
 *   - #9 no fabricated data: store starts at DEFAULT_PREFS; never seeded.
 *
 * [TRANSITIONAL] Zustand persist holds prefs client-side. EXIT: B-cycle wires
 *   user_notification_prefs schema + OneSignal delivery + Resend email; this
 *   store contracts to a cache (or removes entirely if backend is sole authority).
 *
 * Per Cycle 14 SPEC §4.5.1.
 */
```

**Required exports:**

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
} from "zustand/middleware";

export interface NotificationPrefs {
  /** Order activity (transactional). Default true. */
  orderActivity: boolean;
  /** Scanner activity (transactional). Default true. */
  scannerActivity: boolean;
  /** Brand team invitations + role changes. Default true. */
  brandTeam: boolean;
  /**
   * Marketing newsletter / weekly digest. Default false (GDPR-favored).
   * ALSO synced to creator_accounts.marketing_opt_in via parent component.
   */
  marketing: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  orderActivity: true,
  scannerActivity: true,
  brandTeam: true,
  marketing: false,
};

export interface NotificationPrefsStoreState {
  prefs: NotificationPrefs;
  setPref: (key: keyof NotificationPrefs, value: boolean) => void;
  /**
   * Hydrate marketing toggle from the canonical schema column on app load
   * (consumer calls this after useCreatorAccount resolves with marketing_opt_in).
   * Other 3 toggles are local-only TRANSITIONAL.
   */
  hydrateMarketingFromBackend: (marketingOptIn: boolean) => void;
  reset: () => void;
}

type PersistedState = Pick<NotificationPrefsStoreState, "prefs">;

const persistOptions: PersistOptions<
  NotificationPrefsStoreState,
  PersistedState
> = {
  name: "mingla-business.notificationPrefsStore.v1",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (s): PersistedState => ({ prefs: s.prefs }),
  version: 1,
};

export const useNotificationPrefsStore = create<NotificationPrefsStoreState>()(
  persist(
    (set) => ({
      prefs: { ...DEFAULT_PREFS },
      setPref: (key, value): void => {
        set((s) => ({ prefs: { ...s.prefs, [key]: value } }));
      },
      hydrateMarketingFromBackend: (marketingOptIn): void => {
        set((s) => ({
          prefs: { ...s.prefs, marketing: marketingOptIn },
        }));
      },
      reset: (): void => {
        set({ prefs: { ...DEFAULT_PREFS } });
      },
    }),
    persistOptions,
  ),
);
```

### 4.6 Utility layer

#### 4.6.1 NEW — `mingla-business/src/utils/accountDeletionPreview.ts`

**Header docstring:**

```ts
/**
 * accountDeletionPreview — Pure aggregator joining 6 client stores into
 * AccountDeletionPreview for J-A4 cascade preview screen (Cycle 14).
 *
 * Per DEC-096 D-14-10: itemized full counts (brands owned + brands team-of +
 * live events + sold orders £total + comps + scanner invites + team invites).
 *
 * Per DEC-096 D-14-14: hasActiveOrUpcomingEvents flag for warn-don't-block
 * branch in delete.tsx Step 2.
 *
 * Selector contract: caller passes RAW arrays (raw entries + useMemo at the
 * route layer per Cycle 9c v2 + Cycle 12 lesson). NEVER subscribe to
 * fresh-array selectors directly.
 *
 * Pure: no side effects, no console.log, no async.
 *
 * Per Cycle 14 SPEC §4.6.1.
 */
```

**Required exports:**

```ts
import type { Brand } from "../store/currentBrandStore";
import type { BrandTeamEntry } from "../store/brandTeamStore";
import type { CompGuestEntry } from "../store/guestStore";
import type { DoorSaleRecord } from "../store/doorSalesStore";
import type { LiveEvent } from "../store/liveEventStore";
import type { OrderRecord } from "../store/orderStore";
import type { ScanRecord } from "../store/scanStore";
import { deriveLiveStatus } from "./eventLifecycle";

export interface AccountDeletionPreview {
  brandsOwnedCount: number;
  brandsTeamMemberCount: number;
  liveEventsCount: number;
  pastEventsCount: number;
  soldOrdersCount: number;
  totalRevenueGbp: number;
  doorSalesCount: number;
  compsCount: number;
  scannerInvitationsCount: number;
  teamInvitationsCount: number;
  /** True if any event is "live" or "upcoming" status — used for D-14-14 warn block. */
  hasActiveOrUpcomingEvents: boolean;
}

export interface AccountDeletionPreviewInputs {
  userId: string;
  brands: Brand[];
  brandTeamEntries: BrandTeamEntry[];
  liveEvents: LiveEvent[];
  orderEntries: OrderRecord[];
  doorSalesEntries: DoorSaleRecord[];
  compEntries: CompGuestEntry[];
  scanEntries: ScanRecord[];
}

export const EMPTY_PREVIEW: AccountDeletionPreview = {
  brandsOwnedCount: 0,
  brandsTeamMemberCount: 0,
  liveEventsCount: 0,
  pastEventsCount: 0,
  soldOrdersCount: 0,
  totalRevenueGbp: 0,
  doorSalesCount: 0,
  compsCount: 0,
  scannerInvitationsCount: 0,
  teamInvitationsCount: 0,
  hasActiveOrUpcomingEvents: false,
};

/**
 * Deterministic, side-effect-free aggregator. Same inputs → identical output.
 *
 * **Note:** brandsOwnedCount is approximate from local Zustand cache. Stub-mode
 * brands (brandList.STUB_BRANDS) all count as "owned" via Brand.role === "owner"
 * inspection. Real backend ownership distinction lands B-cycle.
 */
export const computeAccountDeletionPreview = (
  inputs: AccountDeletionPreviewInputs,
): AccountDeletionPreview => {
  const {
    userId,
    brands,
    brandTeamEntries,
    liveEvents,
    orderEntries,
    doorSalesEntries,
    compEntries,
    scanEntries,
  } = inputs;

  // Brands owned (Brand.role === "owner" — stub-mode synthesis path)
  const brandsOwnedCount = brands.filter((b) => b.role === "owner").length;
  // Team member of brands (excluding owned brands — only count brands where user is admin/manager but NOT owner)
  const ownedBrandIds = new Set(
    brands.filter((b) => b.role === "owner").map((b) => b.id),
  );
  const brandsTeamMemberCount = brandTeamEntries.filter(
    (e) =>
      e.status === "accepted" &&
      e.inviteeEmail.length > 0 &&
      !ownedBrandIds.has(e.brandId),
  ).length;

  // Events split by lifecycle status
  let liveEventsCount = 0;
  let pastEventsCount = 0;
  let hasActiveOrUpcomingEvents = false;
  for (const ev of liveEvents) {
    const status = deriveLiveStatus(ev);
    if (status === "live" || status === "upcoming") {
      liveEventsCount += 1;
      hasActiveOrUpcomingEvents = true;
    } else {
      pastEventsCount += 1;
    }
  }

  // Orders + revenue (live amount = total - refunded across paid + refunded_partial)
  const liveOrders = orderEntries.filter(
    (o) => o.status === "paid" || o.status === "refunded_partial",
  );
  const soldOrdersCount = liveOrders.length;
  const totalRevenueGbp = liveOrders.reduce(
    (sum, o) => sum + Math.max(0, o.totalGbpAtPurchase - o.refundedAmountGbp),
    0,
  );

  // Door sales count (each row is one sale; door buyers may be multi-line)
  const doorSalesCount = doorSalesEntries.length;

  // Comps
  const compsCount = compEntries.length;

  // Scanner invitations (sent by this user — count entries where invitedBy === userId)
  // Note: scannerInvitationsStore is NOT in inputs; SPEC writer's call whether to extend
  // inputs OR scope to brand-team only. For Cycle 14 simplicity, count brand-team invitations
  // sent by this user (already in inputs); scanner invites omitted from the count.
  const scannerInvitationsCount = 0;

  // Team invitations sent (brand_team_members entries where this user invited)
  const teamInvitationsCount = brandTeamEntries.filter(
    (e) => e.invitedBy === userId,
  ).length;

  // Mark scanEntries as intentionally unused (kept in inputs for symmetry with reconciliation aggregator pattern)
  void scanEntries;

  return {
    brandsOwnedCount,
    brandsTeamMemberCount,
    liveEventsCount,
    pastEventsCount,
    soldOrdersCount,
    totalRevenueGbp: Math.round(totalRevenueGbp * 100) / 100,
    doorSalesCount,
    compsCount,
    scannerInvitationsCount,
    teamInvitationsCount,
    hasActiveOrUpcomingEvents,
  };
};
```

**Implementor note on `scannerInvitationsCount`:** SPEC writer scoped this to `0` for Cycle 14 simplicity (`useScannerInvitationsStore` is a separate store; including it would expand the inputs interface by 1 field). If operator wants scanner invites surfaced in cascade preview, implementor extends `AccountDeletionPreviewInputs` with `scannerInvitations: ScannerInvitation[]` + the count derivation. Surfaced at IMPL Step 5 for operator decision.

### 4.7 Component layer

#### 4.7.1 MOD — `mingla-business/app/(tabs)/account.tsx` (per D-14-17 PRESERVE + ADD)

Existing structure stays:
- TopBar (brand chip → switcher) — unchanged
- "Account" GlassCard with email + sign-out button → **RENAME button "Sign out" → "Sign out everywhere"** + add subline below button: "Signs you out on every device."
- "Your brands" GlassCard — unchanged
- Dev tools GlassCard (gated `__DEV__`) — unchanged

ADD a NEW GlassCard between "Account" and "Your brands" (insertion point: line 158 before `{brands.length > 0 ? (`):

```tsx
<GlassCard variant="elevated" padding={spacing.lg}>
  <Text style={styles.title}>Settings</Text>
  <Text style={styles.body}>Manage your profile, notifications, and account.</Text>
  <View style={styles.navRowsCol}>
    <SettingsNavRow
      icon="user"
      label="Edit profile"
      onPress={handleEditProfile}
    />
    <SettingsNavRow
      icon="bell"
      label="Notifications"
      onPress={handleNotifications}
    />
    <SettingsNavRow
      icon="trash"
      label="Delete account"
      destructive
      onPress={handleDeleteAccount}
    />
  </View>
</GlassCard>
```

`SettingsNavRow` is composed inline in `account.tsx` (mirrors `brandRow` pattern at lines 165-187). Destructive variant uses `accent.warm` for icon (matches Cycle 13 reconciliation discrepancy palette) + same opacity for pressed.

**Handler imports + callbacks (added to component body):**

```ts
const handleEditProfile = useCallback((): void => {
  router.push("/account/edit-profile" as never);
}, [router]);

const handleNotifications = useCallback((): void => {
  router.push("/account/notifications" as never);
}, [router]);

const handleDeleteAccount = useCallback((): void => {
  router.push("/account/delete" as never);
}, [router]);
```

**Sign-out button rename (line 140 of existing file):**

```tsx
<Button
  label="Sign out everywhere"
  onPress={handleSignOut}
  variant="secondary"
  size="md"
/>
{/* New caption below the button */}
<Text style={styles.signOutCaption}>
  Signs you out on every device.
</Text>
```

New StyleSheet entry for the caption + nav rows column:

```ts
signOutCaption: {
  fontSize: typography.caption.fontSize,
  color: textTokens.tertiary,
  marginTop: spacing.xs,
},
navRowsCol: {
  gap: spacing.sm,
  marginTop: spacing.md,
},
// SettingsNavRow styles mirror existing brandRow + chevR pattern
```

#### 4.7.2 NEW — `mingla-business/app/account/edit-profile.tsx` (J-A1 ~280 LOC)

**Header docstring:**

```ts
/**
 * Edit profile route — Cycle 14 J-A1 (DEC-096 D-14-1 + D-14-2 + D-14-3).
 *
 * D-14-1: email read-only via OAuth (Mingla Business is Google + Apple only)
 * D-14-2: profile photo via NEW creator_avatars bucket per SPEC §1.5 pivot
 * D-14-3: persistence via direct React Query mutation (useUpdateCreatorAccount)
 *
 * Per Cycle 14 SPEC §4.7.2.
 */
```

**State (all hooks declared BEFORE early-return per ORCH-0710):**

```ts
const insets = useSafeAreaInsets();
const router = useRouter();
const { user } = useAuth();
const { data: account, isLoading } = useCreatorAccount();
const { mutateAsync: updateAccount, isPending: updating } = useUpdateCreatorAccount();

// Form state — initialized once account row hydrates
const [name, setName] = useState<string>("");
const [photoUri, setPhotoUri] = useState<string | null>(null);
const [uploadingPhoto, setUploadingPhoto] = useState<boolean>(false);
const [toast, setToast] = useState<{ visible: boolean; message: string }>({ visible: false, message: "" });

// Derived state
const provider = useMemo<"google" | "apple" | "unknown">(() => {
  const p = user?.app_metadata?.provider;
  return p === "google" || p === "apple" ? p : "unknown";
}, [user]);

const hasUnsavedChanges = useMemo<boolean>(() => {
  if (account === null) return false;
  return (
    name.trim() !== (account.display_name ?? "").trim() ||
    photoUri !== (account.avatar_url ?? null)
  );
}, [name, photoUri, account]);

// Hydrate form from account row on first load
useEffect(() => {
  if (account !== null) {
    setName(account.display_name ?? "");
    setPhotoUri(account.avatar_url ?? null);
  }
}, [account]);
```

**ALL states the route MUST render:**

| State | Trigger | Render |
|-------|---------|--------|
| **Loading** | `isLoading === true` | Spinner / skeleton (mirror Cycle 13 reconciliation route shell) |
| **Loaded + populated** | `account !== null` | Form: avatar circle + name TextInput + email read-only + Save CTA |
| **Submitting** | `updating === true` | Disable form + show "Saving..." on CTA |
| **Uploading photo** | `uploadingPhoto === true` | Disable photo button + spinner over avatar |
| **Error (initial query)** | `isError === true` | EmptyState "Couldn't load profile" + retry CTA |
| **Save success** | `updateAccount` resolves | Toast "Profile updated." + router.back() after 0.8s |
| **Save error** | `updateAccount` rejects | Toast "Couldn't save. Tap to try again." + form preserved |
| **Photo upload error** | Storage upload rejects | Toast "Couldn't upload photo. Tap to try again." + photoUri reverted |

**Photo picker flow:**

```ts
import * as ImagePicker from "expo-image-picker";

const handlePickPhoto = useCallback(async (): Promise<void> => {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== "granted") {
    setToast({ visible: true, message: "Photo permission required." });
    return;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  });
  if (result.canceled || result.assets.length === 0) return;
  const asset = result.assets[0];
  setUploadingPhoto(true);
  try {
    const ext = asset.uri.split(".").pop()?.toLowerCase() ?? "jpg";
    const validExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
    const path = `${user!.id}.${validExt}`;
    // Fetch the local file as Blob
    const response = await fetch(asset.uri);
    const blob = await response.blob();
    const { error: uploadError } = await supabase.storage
      .from("creator_avatars")
      .upload(path, blob, {
        upsert: true,
        contentType: blob.type ?? `image/${validExt}`,
      });
    if (uploadError) throw uploadError;
    const { data: publicUrlData } = supabase.storage
      .from("creator_avatars")
      .getPublicUrl(path);
    setPhotoUri(`${publicUrlData.publicUrl}?t=${Date.now()}`); // cache-bust
  } catch (_err) {
    setToast({ visible: true, message: "Couldn't upload photo. Tap to try again." });
  } finally {
    setUploadingPhoto(false);
  }
}, [user]);
```

**Save flow:**

```ts
const handleSave = useCallback(async (): Promise<void> => {
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    setToast({ visible: true, message: "Name can't be empty." });
    return;
  }
  if (trimmedName.length > 80) {
    setToast({ visible: true, message: "Name must be 80 characters or less." });
    return;
  }
  try {
    await updateAccount({
      display_name: trimmedName,
      avatar_url: photoUri,
    });
    setToast({ visible: true, message: "Profile updated." });
    setTimeout(() => router.back(), 800);
  } catch (_err) {
    setToast({ visible: true, message: "Couldn't save. Tap to try again." });
  }
}, [name, photoUri, updateAccount, router]);
```

**Email read-only row:**

```tsx
<View style={styles.emailRow}>
  <Text style={styles.emailLabel}>Email</Text>
  <Text style={styles.emailValue}>{account?.email ?? user?.email ?? ""}</Text>
  <Pill variant="info">
    {provider === "google" ? "via Google" : provider === "apple" ? "via Apple" : "via OAuth"}
  </Pill>
  <Text style={styles.emailHint}>
    Email is managed by your sign-in provider.
  </Text>
</View>
```

**Keyboard discipline (memory rule `feedback_keyboard_never_blocks_input`):**

ScrollView wraps form with:
```tsx
<ScrollView
  keyboardShouldPersistTaps="handled"
  keyboardDismissMode="on-drag"
  automaticallyAdjustKeyboardInsets
  ...
>
```

Plus dynamic paddingBottom that reacts to Keyboard listener (mirror Cycle 3 wizard pattern referenced in memory rule).

#### 4.7.3 NEW — `mingla-business/app/account/notifications.tsx` (J-A2 ~220 LOC)

**Header docstring:**

```ts
/**
 * Notification settings route — Cycle 14 J-A2 (DEC-096 D-14-4..D-14-7).
 *
 * D-14-4: 4 categories (Order activity / Scanner activity / Brand team / Marketing)
 * D-14-5: TRANSITIONAL toggles only — B-cycle wires real delivery
 * D-14-6: GDPR-favored defaults — transactional ON · marketing OFF
 * D-14-7: Zustand persist + sync marketing to creator_accounts.marketing_opt_in only
 *
 * Per Cycle 14 SPEC §4.7.3.
 */
```

**State (hooks BEFORE early-return):**

```ts
const insets = useSafeAreaInsets();
const router = useRouter();
const { data: account } = useCreatorAccount();
const { mutateAsync: updateAccount } = useUpdateCreatorAccount();
const prefs = useNotificationPrefsStore((s) => s.prefs);
const setPref = useNotificationPrefsStore((s) => s.setPref);
const hydrateMarketing = useNotificationPrefsStore((s) => s.hydrateMarketingFromBackend);
const [toast, setToast] = useState<{ visible: boolean; message: string }>({ visible: false, message: "" });

// Hydrate marketing toggle from canonical schema column once
useEffect(() => {
  if (account !== null) {
    hydrateMarketing(account.marketing_opt_in);
  }
}, [account, hydrateMarketing]);
```

**Toggle handler:**

```ts
const handleToggle = useCallback(
  async (key: keyof NotificationPrefs, value: boolean): Promise<void> => {
    setPref(key, value);
    if (key === "marketing") {
      // DOUBLE-WIRE per D-14-7: also persist to creator_accounts.marketing_opt_in
      try {
        await updateAccount({ marketing_opt_in: value });
      } catch (_err) {
        setToast({ visible: true, message: "Couldn't save. Tap to try again." });
        // Revert local toggle on backend failure
        setPref(key, !value);
      }
    }
  },
  [setPref, updateAccount],
);
```

**Render:**

```tsx
<View style={styles.host}>
  <ChromeRow title="Notifications" onBack={handleBack} />
  <ScrollView contentContainerStyle={styles.scroll}>
    {/* TRANSITIONAL banner — D-14-5 */}
    <View style={styles.banner}>
      <Text style={styles.bannerTitle}>NOTIFICATION SETTINGS</Text>
      <Text style={styles.bannerBody}>
        Toggles save now; delivery wires up when the backend ships in B-cycle.
      </Text>
    </View>

    {/* 4 category toggles */}
    <GlassCard variant="elevated" padding={spacing.lg}>
      <ToggleRow
        label="Order activity"
        description="When buyers purchase, refund, or cancel"
        value={prefs.orderActivity}
        onToggle={(v) => handleToggle("orderActivity", v)}
      />
      <ToggleRow
        label="Scanner activity"
        description="When scanners check in guests at the door"
        value={prefs.scannerActivity}
        onToggle={(v) => handleToggle("scannerActivity", v)}
      />
      <ToggleRow
        label="Brand team"
        description="When team invitations are accepted or roles change"
        value={prefs.brandTeam}
        onToggle={(v) => handleToggle("brandTeam", v)}
      />
      <ToggleRow
        label="Marketing"
        description="Newsletter and product updates from Mingla"
        value={prefs.marketing}
        onToggle={(v) => handleToggle("marketing", v)}
      />
    </GlassCard>
  </ScrollView>
  <ToastWrap toast={toast} onDismiss={() => setToast({ visible: false, message: "" })} />
</View>
```

`ToggleRow` may compose existing `Switch` from React Native + label + description. Implementor's call whether to inline or extract as kit primitive.

**Banner styling per memory rule `feedback_rn_color_formats`** — use hex/rgb only, no oklch. Mirror Cycle 12 TESTING MODE banner pattern (warm-orange tint background + warm-orange text).

#### 4.7.4 NEW — `mingla-business/app/account/delete.tsx` (J-A4 SUBSTANTIVE — ~620 LOC)

**Header docstring:**

```ts
/**
 * Delete account route — Cycle 14 J-A4 4-step internal state machine
 * (DEC-096 D-14-10..D-14-14).
 *
 * 4 steps in single route (NOT 4 separate routes — keeps stack clean for back nav):
 *   Step 1 — Warn — full-bleed warning + Apple privacy-relay note (if applicable)
 *   Step 2 — Cascade preview — itemized counts + active-events warn block
 *   Step 3 — Type-to-confirm — account email match
 *   Step 4 — Confirmation — success toast + signOut + navigate to BusinessWelcomeScreen
 *
 * D-14-12 (FORCED): UPDATE creator_accounts.deleted_at = now() via existing
 * self-write UPDATE RLS policy. NO insert into account_deletion_requests
 * (B-cycle service-role edge fn writes that audit row).
 *
 * D-14-14: warn-loudly-don't-block on active events.
 *
 * I-35 invariant: deleted_at is the soft-delete marker; recover-on-sign-in
 * auto-clears (per AuthContext bootstrap MOD §4.7.5).
 *
 * Per Cycle 14 SPEC §4.7.4.
 */
```

**Step state machine:**

```ts
type DeleteStep = 1 | 2 | 3 | 4;

const insets = useSafeAreaInsets();
const router = useRouter();
const { user, signOut } = useAuth();
// Raw entries + useMemo per Cycle 9c v2 selector pattern rule (T-30 grep gate)
const allOrders = useOrderStore((s) => s.entries);
const allDoorSales = useDoorSalesStore((s) => s.entries);
const allComps = useGuestStore((s) => s.entries);
const allScans = useScanStore((s) => s.entries);
const allLiveEvents = useLiveEventStore((s) => s.events);
const allBrands = useBrandList();
const allBrandTeam = useBrandTeamStore((s) => s.entries);

const { mutateAsync: requestDeletion, isPending: deleting } = useRequestAccountDeletion();

const [step, setStep] = useState<DeleteStep>(1);
const [confirmEmailInput, setConfirmEmailInput] = useState<string>("");
const [toast, setToast] = useState<{ visible: boolean; message: string }>({ visible: false, message: "" });

const provider = useMemo<"google" | "apple" | "unknown">(() => {
  const p = user?.app_metadata?.provider;
  return p === "google" || p === "apple" ? p : "unknown";
}, [user]);

const preview = useMemo(() => {
  if (user === null) return EMPTY_PREVIEW;
  return computeAccountDeletionPreview({
    userId: user.id,
    brands: allBrands,
    brandTeamEntries: allBrandTeam,
    liveEvents: allLiveEvents,
    orderEntries: allOrders,
    doorSalesEntries: allDoorSales,
    compEntries: allComps,
    scanEntries: allScans,
  });
}, [user, allBrands, allBrandTeam, allLiveEvents, allOrders, allDoorSales, allComps, allScans]);

const emailMatches = useMemo<boolean>(() => {
  if (user?.email === null || user?.email === undefined) return false;
  return (
    confirmEmailInput.trim().toLowerCase() ===
    user.email.trim().toLowerCase()
  );
}, [confirmEmailInput, user]);
```

**Step 1 — Warn screen:**

```tsx
{step === 1 ? (
  <View style={styles.warnHost}>
    <Icon name="trash" size={48} color={accent.warm} />
    <Text style={styles.warnTitle}>Delete your Mingla Business account?</Text>
    <Text style={styles.warnBody}>
      You'll lose access to all your brands, events, ticket data, team
      memberships, and history. You have 30 days to recover by signing in
      again — after that, everything is permanently erased.
    </Text>
    {provider === "apple" ? (
      <View style={styles.appleNote}>
        <Text style={styles.appleNoteText}>
          If you used Apple's "Hide My Email", you may also need to remove
          Mingla from appleid.apple.com after deletion.
        </Text>
      </View>
    ) : null}
    <View style={styles.ctaRow}>
      <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
      <Button label="Continue" variant="secondary" onPress={() => setStep(2)} />
    </View>
  </View>
) : null}
```

**Step 2 — Cascade preview:**

```tsx
{step === 2 ? (
  <View style={styles.previewHost}>
    <Text style={styles.previewTitle}>Here's what you'll lose:</Text>
    <View style={styles.cascadeList}>
      {preview.brandsOwnedCount > 0 ? (
        <CascadeRow icon="user" label={`${preview.brandsOwnedCount} brand${preview.brandsOwnedCount === 1 ? "" : "s"} you own`} />
      ) : null}
      {preview.brandsTeamMemberCount > 0 ? (
        <CascadeRow icon="users" label={`${preview.brandsTeamMemberCount} brand${preview.brandsTeamMemberCount === 1 ? "" : "s"} you're a team member of`} />
      ) : null}
      {preview.liveEventsCount > 0 ? (
        <CascadeRow icon="calendar" label={`${preview.liveEventsCount} live or upcoming event${preview.liveEventsCount === 1 ? "" : "s"}`} />
      ) : null}
      {preview.pastEventsCount > 0 ? (
        <CascadeRow icon="clock" label={`${preview.pastEventsCount} past event${preview.pastEventsCount === 1 ? "" : "s"}`} />
      ) : null}
      {preview.soldOrdersCount > 0 ? (
        <CascadeRow icon="ticket" label={`${preview.soldOrdersCount} ticket sale${preview.soldOrdersCount === 1 ? "" : "s"} · ${formatGbp(preview.totalRevenueGbp)}`} />
      ) : null}
      {preview.doorSalesCount > 0 ? (
        <CascadeRow icon="cash" label={`${preview.doorSalesCount} door sale${preview.doorSalesCount === 1 ? "" : "s"}`} />
      ) : null}
      {preview.compsCount > 0 ? (
        <CascadeRow icon="user" label={`${preview.compsCount} comp guest${preview.compsCount === 1 ? "" : "s"}`} />
      ) : null}
      {preview.teamInvitationsCount > 0 ? (
        <CascadeRow icon="send" label={`${preview.teamInvitationsCount} team invitation${preview.teamInvitationsCount === 1 ? "" : "s"} sent`} />
      ) : null}
    </View>
    {/* D-14-14 active-events warn block */}
    {preview.hasActiveOrUpcomingEvents ? (
      <View style={styles.activeEventsWarn}>
        <Icon name="flag" size={16} color={accent.warm} />
        <Text style={styles.activeEventsWarnText}>
          You have live or upcoming events. Buyers will lose access to those
          events when your account is permanently deleted on day 31. Consider
          cancelling them first.
        </Text>
      </View>
    ) : null}
    <View style={styles.ctaRow}>
      <Button label="Back" variant="ghost" onPress={() => setStep(1)} />
      <Button label="Continue" variant="secondary" onPress={() => setStep(3)} />
    </View>
  </View>
) : null}
```

**Step 3 — Type-to-confirm:**

```tsx
{step === 3 ? (
  <View style={styles.confirmHost}>
    <Text style={styles.confirmTitle}>Type your email to confirm</Text>
    <Text style={styles.confirmEmail}>{user?.email ?? ""}</Text>
    <TextInput
      style={styles.confirmInput}
      placeholder="Type your email"
      value={confirmEmailInput}
      onChangeText={setConfirmEmailInput}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType="email-address"
      editable={!deleting}
    />
    <View style={styles.ctaRow}>
      <Button label="Back" variant="ghost" onPress={() => setStep(2)} disabled={deleting} />
      <Button
        label={deleting ? "Deleting..." : "Delete my account"}
        variant="destructive"  // or "secondary" with red tint per kit
        disabled={!emailMatches || deleting}
        onPress={handleConfirmDelete}
      />
    </View>
  </View>
) : null}
```

**Step 4 — Confirmation + sign-out:**

```ts
const handleConfirmDelete = useCallback(async (): Promise<void> => {
  if (!emailMatches) return;
  try {
    await requestDeletion();
    setStep(4);
    setToast({ visible: true, message: "Account scheduled for deletion. Recover within 30 days by signing in again." });
    // 1.2s wait → signOut → navigate
    setTimeout(async (): Promise<void> => {
      await signOut();
      router.replace("/" as never);
    }, 1200);
  } catch (_err) {
    setToast({ visible: true, message: "Couldn't delete. Tap to try again." });
    setStep(3);  // Return to type-to-confirm with input cleared
    setConfirmEmailInput("");
  }
}, [emailMatches, requestDeletion, signOut, router]);
```

```tsx
{step === 4 ? (
  <View style={styles.successHost}>
    <Icon name="check" size={48} color="#34c759" />
    <Text style={styles.successTitle}>Account scheduled for deletion</Text>
    <Text style={styles.successBody}>
      You can recover it by signing in again within 30 days. After that,
      everything will be permanently erased.
    </Text>
    {/* Auto-navigates after 1.2s; no CTA needed */}
  </View>
) : null}
```

**Hook ordering verification (ORCH-0710 grep gate T-31):** all hooks declared lines ~10-50; conditional render at line ~80+. Implementor verifies by line-number grep at Step 11.

**Toast wrap absolute (memory rule `feedback_toast_needs_absolute_wrap`):**

```tsx
<View style={styles.toastWrap} pointerEvents="box-none">
  <Toast visible={toast.visible} kind="info" message={toast.message} onDismiss={() => setToast({ visible: false, message: "" })} />
</View>
// styles.toastWrap = { position: "absolute", top: 80, left: 0, right: 0, zIndex: 100 }
```

#### 4.7.5 MOD — `mingla-business/src/context/AuthContext.tsx` (recovery-on-sign-in)

**Insertion point:** inside `bootstrap` async + inside `onAuthStateChange` listener, after the existing `await ensureCreatorAccount(s.user);` call (lines 87 + 102 of existing file).

**Implementation:**

```ts
import { tryRecoverAccountIfDeleted } from "../hooks/useAccountDeletion";

// Add to AuthContextValue type:
type AuthContextValue = {
  // ... existing fields ...
  /**
   * Set to a value when account recovery just fired on sign-in.
   * Consumer (account.tsx) reads + clears via clearLastRecoveryEvent.
   */
  lastRecoveryEvent: { recoveredAt: string } | null;
  clearLastRecoveryEvent: () => void;
};

// Inside AuthProvider:
const [lastRecoveryEvent, setLastRecoveryEvent] = useState<{ recoveredAt: string } | null>(null);
const clearLastRecoveryEvent = useCallback((): void => {
  setLastRecoveryEvent(null);
}, []);

// Inside bootstrap (replace existing ensureCreatorAccount call):
if (s?.user) {
  await ensureCreatorAccount(s.user);
  // Cycle 14 — recover-on-sign-in auto-clear (D-CYCLE14-FOR-6 + I-35)
  const recovered = await tryRecoverAccountIfDeleted(s.user.id);
  if (recovered) {
    setLastRecoveryEvent({ recoveredAt: new Date().toISOString() });
  }
}

// Same pattern inside onAuthStateChange.

// Add to value useMemo:
const value = useMemo(
  () => ({
    user, session, loading,
    signInWithGoogle, signInWithApple, signOut,
    lastRecoveryEvent, clearLastRecoveryEvent,
  }),
  [user, session, loading, signInWithGoogle, signInWithApple, signOut, lastRecoveryEvent, clearLastRecoveryEvent],
);
```

**account.tsx consumer:** subscribe to `lastRecoveryEvent` via `useAuth()`; on non-null, show toast "Welcome back — your account has been recovered." + call `clearLastRecoveryEvent()` to clear flag.

```ts
const { lastRecoveryEvent, clearLastRecoveryEvent } = useAuth();
useEffect(() => {
  if (lastRecoveryEvent !== null) {
    setToast({ visible: true, message: "Welcome back — your account has been recovered." });
    clearLastRecoveryEvent();
  }
}, [lastRecoveryEvent, clearLastRecoveryEvent]);
```

### 4.8 Realtime layer

**N/A.** No Realtime subscriptions in Cycle 14.

### 4.9 INVARIANT_REGISTRY amendment — NEW I-35

Append after I-34 in `Mingla_Artifacts/INVARIANT_REGISTRY.md`:

```markdown
---

### I-35 `creator_accounts.deleted_at` is the soft-delete marker (mingla-business — Cycle 14)

**Statement:** Account soft-deletion semantics are encoded in `public.creator_accounts.deleted_at` (timestamptz, nullable). Mobile UPDATEs the column via existing self-write UPDATE RLS policy (Cycle 0a creator_accounts migration line 42-50). Recovery-on-sign-in auto-clears the marker if the user signs in within the 30-day window. After the 30-day window, B-cycle cron service-role flips `account_deletion_requests.status = 'completed'` + calls `auth.admin.deleteUser` → CASCADE through ~80 tables (consumer-app `delete-user` edge fn pattern).

**Rules:**
- Mobile MAY UPDATE `deleted_at` to `now()` (request soft-delete) OR `null` (recovery).
- Mobile MUST NOT UPDATE `deleted_at` to any other value (no future-dated soft-deletes; no past-dated retroactive marks).
- Mobile MUST NOT INSERT into `account_deletion_requests` directly — that table is service-role-only (B-cycle edge fn writes audit rows).
- Auto-recovery fires in `AuthContext` bootstrap + onAuthStateChange after `ensureCreatorAccount(user)` — mobile does NOT prompt the user explicitly; signing in IS the recovery action (per D-CYCLE14-FOR-6 lock).

**Why:** GDPR R4 critical-path mandates a 30-day recovery window. The schema-level marker pattern (instead of a separate `is_deleted` boolean) lets B-cycle cron compute "elapsed days" trivially via `now() - deleted_at`. Recovery-as-sign-in matches industry standard (Apple ID, Google Account, Stripe).

**Established by:** Cycle 14 SPEC §4.9 + DEC-096 D-14-12/13/14.

**Enforcement:** Convention. Optional CI gate: grep mobile codebase for `deleted_at:` and verify the only RHS values are `new Date().toISOString()` OR `null`. Future tightening: B-cycle adds DB CHECK constraint `(deleted_at IS NULL OR deleted_at <= now())`.

**EXIT CONDITION:** None — permanent invariant. The 30-day window is a permanent product semantics; B-cycle hard-delete cron honors it.

**Test that catches a regression:** T-37 INVARIANT_REGISTRY entry presence + grep `\.update\({ deleted_at:` in mobile code returns ONLY `now()` ISO and `null` literals.
```

---

## 5 — Success criteria (SC-1..SC-36)

(Per dispatch §5; restated with verification methods)

| # | Criterion | Verification |
|---|-----------|--------------|
| **SC-1** | NEW route exists at `app/account/edit-profile.tsx`; deep-linkable via `/account/edit-profile`; gated to authenticated user | File exists; expo-router auto-registers; useAuth gate at component top |
| **SC-2** | Edit profile renders current `display_name` + `avatar_url` from `creator_accounts` query; loading state shows spinner | Component test mocking `useCreatorAccount` |
| **SC-3** | Edit profile name TextInput max length 80 chars; trim + reject empty before save | `handleSave` validates trimmedName.length 1..80 |
| **SC-4** | Edit profile photo picker via `expo-image-picker` opens; selected image uploads to `creator_avatars/{userId}.{ext}` | Component + Storage RLS test |
| **SC-5** | Edit profile email row renders `user.email` read-only with "via Google\|Apple\|OAuth" badge derived from `user.app_metadata.provider` | grep `via Google\|via Apple\|via OAuth` in route file |
| **SC-6** | Save CTA fires `useUpdateCreatorAccount.mutateAsync`; success → toast "Profile updated." + back; error → "Couldn't save. Tap to try again." | Component test |
| **SC-7** | NEW route exists at `app/account/notifications.tsx`; 4 toggles render with default state per D-14-6 | Component test |
| **SC-8** | Marketing toggle DOUBLE-WIRES — Zustand `setPref` AND `useUpdateCreatorAccount.mutateAsync({ marketing_opt_in })` | Component test |
| **SC-9** | Other 3 toggles (Order activity / Scanner activity / Brand team) write to Zustand only; persisted via store v1 | Store unit test |
| **SC-10** | Notification route shows TRANSITIONAL banner with B-cycle delivery copy verbatim per §4.7.3 | grep in route file |
| **SC-11** | NEW route exists at `app/account/delete.tsx`; 4-step internal state machine (Warn → Preview → Confirm → Done) | Component state machine test |
| **SC-12** | Step 1 warn copy includes Apple privacy-relay note IF user signed in via Apple | grep `appleid.apple.com` in route file + provider conditional |
| **SC-13** | Step 2 cascade preview itemizes counts per `computeAccountDeletionPreview`; only renders non-zero rows | Component test with mock preview |
| **SC-14** | Step 2 active-events warn block renders when `hasActiveOrUpcomingEvents === true` with warm-orange callout | Component test |
| **SC-15** | Step 3 type-to-confirm enables CTA only when input matches `user.email` (case-insensitive trim) | Component test |
| **SC-16** | Step 4 success path: UPDATE `creator_accounts.deleted_at` → toast → 1.2s wait → `signOut()` → navigate to `/` | Component test |
| **SC-17** | Step 4 error path: toast "Couldn't delete. Tap to try again." + return to Step 3 with input cleared | Component test |
| **SC-18** | account.tsx baseline preserved: TopBar + Account card + email + brand list + dev seeds all unchanged | git diff shows ADDITIVE-only (3 NavRows + caption + handlers + imports) |
| **SC-19** | account.tsx sign-out button label === "Sign out everywhere" + caption "Signs you out on every device." | grep |
| **SC-20** | account.tsx adds NEW Settings GlassCard with 3 NavRows | grep `<SettingsNavRow` |
| **SC-21** | Delete account NavRow uses destructive style variant | code review |
| **SC-22** | AuthContext bootstrap recovers `creator_accounts.deleted_at` to null IF user signs in; `lastRecoveryEvent` flag set; consumer toast fires | Component test |
| **SC-23** | `useUpdateCreatorAccount` invalidates `creator-account` query key on success | Hook test |
| **SC-24** | `computeAccountDeletionPreview` is pure: same inputs → identical output structurally; deterministic | Util unit test |
| **SC-25** | `notificationPrefsStore.reset()` wired into `clearAllStores.ts` cascade | grep |
| **SC-26** | NEW migration adds `creator_avatars` bucket + 4 RLS policies (upload self / update self / delete self / public read) | grep migration file |
| **SC-27** | Const #1 No dead taps — every NavRow + every CTA + every toggle responds with feedback | manual smoke + code review |
| **SC-28** | Const #3 No silent failures — every mutation has onError + user-visible toast | grep `setToast` in catch blocks |
| **SC-29** | Const #6 Logout clears — `clearAllStores` cascade includes `useNotificationPrefsStore.reset()` | grep |
| **SC-30** | Const #7 Label temporary — TRANSITIONAL banner + comments on notification store + AuthContext recovery + migration | grep `[TRANSITIONAL]\|TRANSITIONAL` |
| **SC-31** | Const #9 No fabricated data — cascade preview shows actual counts; never seeds fake values; only renders rows with non-zero counts | code review + T-13 |
| **SC-32** | tsc clean — only 2 pre-existing errors persist (D-CYCLE12-IMPL-1/2) | `npx tsc --noEmit` |
| **SC-33** | NO oklch/lab/lch/color-mix in any new file | grep gate T-29 |
| **SC-34** | Toast wraps absolute-positioned per memory rule (4 routes) | grep `position: "absolute"` in styles.toastWrap |
| **SC-35** | Hook ordering ORCH-0710 — ALL hooks BEFORE any conditional early-return in delete.tsx | line-number grep at Step 11 |
| **SC-36** | Memory rule `feedback_keyboard_never_blocks_input` — TextInputs in edit-profile + delete Step 3 use ScrollView keyboardShouldPersistTaps + automaticallyAdjustKeyboardInsets pattern | grep |

---

## 6 — Invariants

| ID | Status | Cycle 14 application |
|----|--------|---------------------|
| I-19 | PRESERVE | Account ops are read-only over OrderRecord; ZERO mutations |
| I-21 | PRESERVE | Account surface is operator-side; uses `useAuth`. NEVER imported by `app/o/`, `app/e/`, `app/checkout/` (T-30 grep gate) |
| I-25..31 | PRESERVE | No Cycle 14 touchpoint on tickets/scans/door/team substantive surfaces (only counts read for preview) |
| I-32 | PRESERVE | Cycle 14 has no new permission gates (account ops are self-action via existing self-write RLS) |
| I-33/34 | PRESERVE | No permissions_override or permissions_matrix touchpoint |
| **NEW I-35** | **NEW** | `creator_accounts.deleted_at` soft-delete marker contract per §4.9 — codifies recovery-on-sign-in + 30-day window + service-role-only `account_deletion_requests` writes |

I-35 documented in `INVARIANT_REGISTRY.md` per §4.9 (~+28 LOC).

---

## 7 — Test cases (T-01..T-40)

### 7.1 Aggregator unit tests (deterministic, offline)

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Empty user | All inputs empty arrays | All counts === 0; hasActiveOrUpcomingEvents === false | Util |
| T-02 | 2 brands owned + 1 team-of | 2 Brand `role: "owner"` + 1 BrandTeamEntry `status: "accepted"` for non-owned brand | `brandsOwnedCount === 2` · `brandsTeamMemberCount === 1` | Util |
| T-03 | Mixed event lifecycle | 2 LiveEvent live + 3 LiveEvent past (deriveLiveStatus returns) | `liveEventsCount === 2` · `pastEventsCount === 3` · `hasActiveOrUpcomingEvents === true` | Util |
| T-04 | Mixed orders + door + comps | 3 paid orders £10 each + 1 refunded_partial £20 net £15 + 2 door sales + 5 comps | `soldOrdersCount === 4` · `totalRevenueGbp === 45` · `doorSalesCount === 2` · `compsCount === 5` | Util |

### 7.2 Permission + auth tests

| Test | Scenario | Expected |
|------|----------|----------|
| T-05 | Sign-out everywhere | `supabase.auth.signOut()` called WITHOUT scope arg (defaults global per Supabase v2.39+); `clearAllStores` fires |
| T-06 | Recover-on-sign-in (within 30 days) | User row has `deleted_at = ISO`; sign in → `tryRecoverAccountIfDeleted` returns true → `deleted_at` cleared; `lastRecoveryEvent` flag set; "Welcome back" toast fires on next account.tsx mount |
| T-07 | Recover-on-sign-in (no deletion pending) | User row has `deleted_at = null`; sign in → no recovery; no toast |

### 7.3 Profile edit tests

| Test | Scenario | Expected |
|------|----------|----------|
| T-08 | Edit name happy path | TextInput "John Doe" + Save → mutation fires with `{ display_name: "John Doe" }` → toast "Profile updated." → router.back() |
| T-09 | Edit name network failure | Mutation rejects → toast "Couldn't save. Tap to try again." |
| T-10 | Edit name empty | TextInput "" + Save → toast "Name can't be empty." (no mutation fires) |
| T-11 | Edit name too long | TextInput 81+ chars + Save → toast "Name must be 80 characters or less." |
| T-12 | Edit photo upload | `expo-image-picker` selects → upload to `creator_avatars/{userId}.{ext}` → `setPhotoUri` to public URL with cache-bust |
| T-13 | Edit photo upload failure | Storage error → toast "Couldn't upload photo. Tap to try again." + photoUri reverted |
| T-14 | Email row read-only | TextInput-shaped View (NOT TextInput) renders user.email + provider badge |

### 7.4 Notification toggle tests

| Test | Scenario | Expected |
|------|----------|----------|
| T-15 | Marketing toggle ON | Zustand `setPref('marketing', true)` AND `useUpdateCreatorAccount.mutateAsync({ marketing_opt_in: true })` both fire |
| T-16 | Marketing toggle ON network failure | mutateAsync rejects → toast "Couldn't save. Tap to try again." + Zustand reverted to false |
| T-17 | Order activity toggle | Zustand only; no Supabase mutation |
| T-18 | Default state | Defaults match D-14-6: orderActivity / scannerActivity / brandTeam === true; marketing === false |
| T-19 | Marketing hydration | On mount, `account.marketing_opt_in` value hydrates Zustand via `hydrateMarketingFromBackend` |
| T-20 | TRANSITIONAL banner visible | grep banner copy in route file |

### 7.5 Delete-account flow tests

| Test | Scenario | Expected |
|------|----------|----------|
| T-21 | Step 1 warn renders | Full-bleed copy; Continue + Cancel CTAs |
| T-22 | Step 1 Apple privacy-relay note | Renders only if `user.app_metadata.provider === "apple"` |
| T-23 | Step 1 → Step 2 | Tap Continue → setStep(2) |
| T-24 | Step 2 itemized cascade | Per `computeAccountDeletionPreview`; only non-zero rows rendered |
| T-25 | Step 2 active-events warn | Warm-orange callout renders when `hasActiveOrUpcomingEvents === true` |
| T-26 | Step 2 → Step 3 | Tap Continue → setStep(3) |
| T-27 | Step 3 type-to-confirm match | Input "seth@example.com" + user.email "seth@example.com" → emailMatches === true; CTA enabled |
| T-28 | Step 3 type-to-confirm mismatch | Input "seth@" → CTA disabled |
| T-29 | Step 3 case-insensitive match | Input "SETH@EXAMPLE.COM" + user.email "seth@example.com" → emailMatches === true |
| T-30 | Step 4 success | UPDATE `deleted_at` succeeds → setStep(4) → toast → 1.2s → signOut → navigate `/` |
| T-31 | Step 4 RLS denial | Mutation rejects → toast → setStep(3) + clear input |
| T-32 | Step 4 network failure | Mutation rejects → toast → setStep(3) + clear input |

### 7.6 Static + regression tests

| Test | Method | Expected |
|------|--------|----------|
| T-33 | tsc clean | `npx tsc --noEmit \| grep -v ".expo/types/router.d.ts"` exit 0 with only pre-existing errors |
| T-34 | RN color formats | grep `oklch\|lab\\(\|lch\\(\|color-mix` in 4 new routes + 3 hooks/utils + 1 store → 0 hits |
| T-35 | I-21 anon-route safety | grep `account/edit-profile\|account/notifications\|account/delete\|useCreatorAccount\|useNotificationPrefsStore\|useAccountDeletion\|computeAccountDeletionPreview` in `app/o/`, `app/e/`, `app/checkout/` → 0 hits |
| T-36 | Hook ordering ORCH-0710 in delete.tsx | All hook lines BEFORE first conditional `return` line |
| T-37 | Toast wrap absolute | `position: "absolute"` in styles.toastWrap of all 4 routes |
| T-38 | account.tsx baseline preserved | git diff shows ADDITIVE; no deletions of brand list + email + dev seeds |
| T-39 | clearAllStores cascade | grep `useNotificationPrefsStore.getState().reset()` in `clearAllStores.ts` → 1 match |
| T-40 | INVARIANT_REGISTRY I-35 entry | grep `### I-35` in INVARIANT_REGISTRY.md → 1 match |

---

## 8 — Implementation order (15 sequential steps with tsc checkpoints)

Per `feedback_sequential_one_step_at_a_time` — tsc checkpoint after EACH step; STOP on failure.

| Step | What | Where | tsc | Tests run |
|------|------|-------|-----|-----------|
| **0** | Verification step (mandatory) | Read `node_modules/@supabase/auth-js/src/GoTrueClient.ts` for signOut default scope; verify `creator_accounts.deleted_at` exists in PR #59 schema; verify `creator_avatars` bucket creation succeeds via test migration apply | — | — |
| **1** | NEW migration `20260504_b1_phase5_creator_avatars.sql` per §4.1.1 | `supabase/migrations/20260504_b1_phase5_creator_avatars.sql` | — | — |
| **2** | `useCreatorAccount.ts` hook | NEW per §4.3.1 | ✅ | — |
| **3** | `useAccountDeletion.ts` hook + recover helper | NEW per §4.3.2 | ✅ | — |
| **4** | `notificationPrefsStore.ts` | NEW per §4.5.1 | ✅ | T-18 |
| **5** | `accountDeletionPreview.ts` aggregator | NEW per §4.6.1 | ✅ | T-01..T-04 |
| **6** | `clearAllStores.ts` MOD | Add `useNotificationPrefsStore.reset()` per §3.1 | ✅ | T-39 |
| **7** | `creatorAccount.ts` MOD | Add `updateCreatorAccount` helper per §4.4.1 | ✅ | — |
| **8** | `/ui-ux-pro-max` pre-flight (mandatory per D-CYCLE14-FOR-5) | Run `python .claude/skills/ui-ux-pro-max/scripts/search.py "operator account profile settings delete-account 4-step destructive flow dark glass" --domain product` for J-A1 + J-A4. Document query + applied guidance in IMPL report §8. | — | — |
| **9** | `app/account/edit-profile.tsx` route | NEW per §4.7.2 | ✅ | T-08..T-14 |
| **10** | `app/account/notifications.tsx` route | NEW per §4.7.3 | ✅ | T-15..T-20 |
| **11** | `app/account/delete.tsx` route (substantive) | NEW per §4.7.4 — 4-step internal state machine; ALL hooks BEFORE early-return per ORCH-0710 | ✅ | T-21..T-32 |
| **12** | `AuthContext.tsx` MOD — recover-on-sign-in | Per §4.7.5 | ✅ | T-06, T-07 |
| **13** | `app/(tabs)/account.tsx` MOD — preserve + ADD 3 rows + RENAME button | Per §4.7.1 | ✅ | T-38 |
| **14** | INVARIANT_REGISTRY MOD — I-35 | NEW invariant per §4.9 | — | T-40 |
| **15** | Verification matrix + grep regression battery (T-33..T-37) + final IMPL report | Produce `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_14_ACCOUNT_REPORT.md` per Cycle 13 precedent (15 sections) + curated `git add` list | ✅ | T-33..T-40 |

---

## 9 — Regression prevention

| Class | Safeguard | Test |
|-------|-----------|------|
| Selector pattern drift (Cycle 9c v2 lesson) | grep gate — raw entries + useMemo in cascade preview consumer | T-24 component shape |
| Hook ordering crash (ORCH-0710 lesson) | grep gate — all hooks BEFORE early-return in delete.tsx | T-36 |
| Anon buyer route leakage (I-21) | grep gate — account/* + new hooks NEVER imported by anon routes | T-35 |
| Existing baseline regression | git diff — additive only on account.tsx | T-38 |
| RN color silent invisibility | grep gate — 0 hits for oklch/lab/lch/color-mix | T-34 |
| Cascade preview false positives | render gate — only non-zero rows render | T-24 |
| Permission UX dishonesty (Const #1) | code gate — sign-out-everywhere caption visible; warn-not-block on active events | T-25 |
| Soft-delete-without-recovery (I-35) | code gate — AuthContext bootstrap auto-clears `deleted_at` | T-06 |
| Logout cascade gap (Const #6) | grep gate — `useNotificationPrefsStore.reset()` in clearAllStores | T-39 |

**Protective comment requirement** at top of:
- `app/account/delete.tsx` — header docstring citing DEC-096 + 4-step UX + I-35 + recover-on-sign-in
- `src/utils/accountDeletionPreview.ts` — pure aggregator contract + deterministic
- `src/hooks/useCreatorAccount.ts` — query key factory + RLS self-write
- `src/store/notificationPrefsStore.ts` — TRANSITIONAL marker + B-cycle EXIT condition
- `supabase/migrations/20260504_b1_phase5_creator_avatars.sql` — cite Cycle 14 + path-scoped RLS rationale

---

## 10 — Hard constraints / non-goals

### 10.1 What implementor MUST NOT do

- DO NOT install push notification SDKs (`react-native-onesignal` / `expo-notifications` / `@notifee`) — D-14-5 lock
- DO NOT install email-OTP path or modify auth providers — D-14-1 lock
- DO NOT add `creator_accounts.business_name` / `phone_e164` editable surfaces — D-CYCLE14-FOR-2/3 deferred
- DO NOT block deletion when active events present — D-14-14 warn-only
- DO NOT add force-transfer brand ownership flow — IMMUTABLE trigger blocks; D-CYCLE14-FOR-4 future cycle
- DO NOT write `account_deletion_requests` row from mobile — D-14-15 service-role-only B-cycle pipeline
- DO NOT propose new dependencies (D-14-5 + D-14-7 forced TRANSITIONAL/reuse; only `creator_avatars` migration is new schema)
- DO NOT subscribe to fresh-array selectors — Cycle 9c v2 + Cycle 12 lesson; cascade preview uses raw entries + useMemo
- DO NOT skip `/ui-ux-pro-max` pre-flight at Step 8
- DO NOT silently re-interpret SPEC ambiguity — STOP and surface

If a SPEC ambiguity surfaces during IMPL, register as `D-CYCLE14-IMPL-N` and HALT until orchestrator clarifies.

### 10.2 What implementor MUST do

- Run tsc checkpoint after each of the 15 steps in §8
- Honor ALL 11 memory rules (§11)
- Produce 15-section IMPL report per Cycle 13 precedent
- Surface ANY ambiguity to orchestrator BEFORE silent reinterpretation
- Stop on tsc failure; do NOT proceed past a checkpoint with errors

---

## 11 — Memory rule deference

| Rule | Application | Verify by |
|------|-------------|-----------|
| `feedback_diagnose_first_workflow` | Surface ANY ambiguity to orchestrator BEFORE writing IMPL — no silent reinterpretation | IMPL report §8 |
| `feedback_orchestrator_never_executes` | Implementor does NOT spawn forensics/orchestrator/tester | No agent calls in IMPL |
| `feedback_no_summary_paragraph` | Chat output is tight summary + report path | IMPL report §1 |
| `feedback_implementor_uses_ui_ux_pro_max` | Step 8 mandatory pre-flight before component code; document query + applied guidance | IMPL report §8 |
| `feedback_keyboard_never_blocks_input` | TextInputs in edit-profile + delete Step 3 use ScrollView keyboardShouldPersistTaps + automaticallyAdjustKeyboardInsets | IMPL report §11 + T-36 grep |
| `feedback_rn_color_formats` | Mandatory hex/rgb/hsl only — grep gate T-34 | IMPL report §8 |
| `feedback_toast_needs_absolute_wrap` | Mandatory absolute-positioned wrap in all 4 routes — grep gate T-37 | IMPL report §8 |
| `feedback_rn_sub_sheet_must_render_inside_parent` | Delete-flow uses single-route state machine (recommended); IF uses sub-sheets, MUST render inside parent | IMPL report §8 (likely N/A — single-route state machine recommended over sheets) |
| `feedback_anon_buyer_routes` | I-21 enforcement — grep gate T-35 | IMPL report §8 |
| `feedback_no_coauthored_by` | Commit message MUST NOT include AI attribution | IMPL report §15 commit message proposal |
| `feedback_sequential_one_step_at_a_time` | Sequential 15 steps with tsc checkpoints; stop on failure | IMPL report §3 + §8 |

---

## 12 — Cross-references

- Canonical epic: [`Mingla_Artifacts/github/epics/cycle-14.md`](../github/epics/cycle-14.md)
- Investigation: [`reports/INVESTIGATION_BIZ_CYCLE_14_ACCOUNT.md`](../reports/INVESTIGATION_BIZ_CYCLE_14_ACCOUNT.md)
- SPEC dispatch: [`prompts/SPEC_BIZ_CYCLE_14_ACCOUNT.md`](../prompts/SPEC_BIZ_CYCLE_14_ACCOUNT.md)
- Decision lock-in: `DECISION_LOG.md` DEC-096
- Cycle 13 close (Phase 4 feature-complete; Cycle 13 IMPL pattern reused for cascade preview aggregator): [`reports/IMPLEMENTATION_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION_REPORT.md`](../reports/IMPLEMENTATION_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION_REPORT.md)
- Cycle 13a (rank-gating + permission plumbing — Cycle 14 doesn't need permission gates; reuses React Query + useCurrentBrandRole pattern): [`reports/IMPLEMENTATION_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS_REPORT.md`](../reports/IMPLEMENTATION_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS_REPORT.md)
- Existing baseline: `mingla-business/app/(tabs)/account.tsx` (Cycle 0a + 1)
- AuthContext: `mingla-business/src/context/AuthContext.tsx` (Cycle 6 + 0b)
- creatorAccount service: `mingla-business/src/services/creatorAccount.ts`
- Logout cascade: `mingla-business/src/utils/clearAllStores.ts` (10 stores → 11 with notificationPrefsStore)
- Schema chain: `supabase/migrations/20260404000001_creator_accounts.sql` (origin) + `20260502100000_b1_business_schema_rls.sql` lines 38-78 (PR #59 — already shipped)
- Avatars bucket pattern: `supabase/migrations/20250226000007_create_avatars_storage_bucket.sql` (mirror with tighter path-scoped RLS)
- Consumer-app delete-user (B-cycle architectural model): `supabase/functions/delete-user/index.ts`
- BUSINESS_PRD §1 — account model + auth requirements
- Strategic Plan R4 — account-deletion GDPR critical-path
- INVARIANT_REGISTRY: I-19/21/25..34 (preserved) + I-35 (NEW)
- Memory rules honored (§11): 11 entries
- Forensics discoveries (D-CYCLE14-FOR-1..6) referenced; D-CYCLE14-FOR-5 (`/ui-ux-pro-max` pre-flight) + D-CYCLE14-FOR-6 (auto-clear on recovery) honored in §8 + §4.7.5
