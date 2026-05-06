# SPEC — Cycle 17e-A (Brand CRUD wiring + delete UX + media-ready schema)

**Cycle:** 17e-A (BIZ — founder-feedback feature absorption; Refinement Pass post-closure)
**Mode:** BINDING SPEC (forensics SPEC mode output)
**Forensics anchor:** [`reports/INVESTIGATION_BIZ_CYCLE_17E_A_BRAND_CRUD_WIRING.md`](../reports/INVESTIGATION_BIZ_CYCLE_17E_A_BRAND_CRUD_WIRING.md) (verbatim binding)
**SPEC dispatch anchor:** [`prompts/SPEC_BIZ_CYCLE_17E_A_BRAND_CRUD_WIRING.md`](../prompts/SPEC_BIZ_CYCLE_17E_A_BRAND_CRUD_WIRING.md)
**Authored:** 2026-05-05
**Status:** BINDING — implementor follows verbatim; deviations escalate to orchestrator

---

## §1. Layman summary

Wire mingla-business brand CRUD (create + read + update + delete) end-to-end against the `brands` Supabase table. Surface delete UX on 3 surfaces with a 4-step state machine (Warn → Cascade preview → Type-to-confirm → Soft-delete) that mirrors Cycle 14 J-A14 account-delete. Add a 6-column migration to `brands` to (a) close the 12-cycle-old TRANSITIONAL marker at `brandMapping.ts:184-191` for `kind`/`address`/`coverHue`, and (b) pre-load 17e-B Tier 2 schema (`cover_media_url` + `cover_media_type` + `profile_photo_type`) so the future cover/profile media picker becomes UI-only.

After this ships: operator's brand changes sync across devices · delete is safe (rejects when upcoming events exist) · operator's design choices (kind/address/coverHue) persist · 17e-B's effort drops by ~3-4h.

---

## §2. Scope + Non-Goals + Assumptions

### §2.1 In-scope

- 1 NEW database migration (6 columns added to `brands`)
- 1 NEW service file: `mingla-business/src/services/brandsService.ts` (5 functions)
- 1 MOD service file: `mingla-business/src/services/brandMapping.ts` (6 fields handled; TRANSITIONAL defaults removed)
- 1 NEW hook file: `mingla-business/src/hooks/useBrands.ts` (5 hooks + factory keys)
- 1 MOD store file: `mingla-business/src/store/currentBrandStore.ts` (v12 → v13 schema; remove `brands: Brand[]` + `setBrands`; add 3 new optional UI Brand fields)
- 4 MOD UI files: `BrandSwitcherSheet.tsx` + `BrandProfileView.tsx` + `BrandEditView.tsx` + `app/(tabs)/account.tsx`
- 1 NEW UI file: `mingla-business/src/components/brand/BrandDeleteSheet.tsx` (~250 LOC; 4-step state machine)
- 2 MOD route files: `app/brand/[id]/edit.tsx` + `app/brand/[id]/payments/onboard.tsx`
- 1 MOD/DELETE store file: `mingla-business/src/store/brandList.ts` (STUB_BRANDS dev-seed disposition per Decision 8 = C accept-as-loss)
- 3 NEW invariants pre-written DRAFT in `INVARIANT_REGISTRY.md` (I-PROPOSED-A/B/C)
- Cross-domain audit: every events query verified to filter `brands.deleted_at IS NULL`

### §2.2 Out of scope (explicit non-goals)

- **17e-B Tier 1 (event cover picker UI)** — separate cycle; events schema already ready; columns pre-loaded by 17e-A do NOT get UI in 17e-A
- **17e-B Tier 2 (brand cover + profile picker UI)** — separate cycle; schema is pre-loaded by 17e-A so 17e-B Tier 2 is UI-only
- **Giphy/Pexels edge function (`media-search`)** — 17e-B specs + ships; NOT pre-stubbed in 17e-A (avoids dead code)
- **Brand `profile_photo_url` upload pipeline** — placeholder toast at `BrandEditView.tsx:284-286` stays TRANSITIONAL; 17e-B picker UI handles
- **Stripe Connect dual-source cleanup** (forensics F-G) — observation only; B-cycle Stripe wire ORCH register
- **Restore-from-soft-delete UX** — out of scope per Decision 12; recover via DB intervention only
- **Cycle 14 account-soft-delete cascade-into-brands** — verify at IMPL pre-flight; if missing AND ≤30 LOC patch, add inline; if larger, escalate to orchestrator (separate cascade ORCH)
- **B-cycle backend wires** — Resend / Stripe webhooks / OneSignal / audit_log writers / invite-brand-member edge function — out of scope
- **Brand realtime subscriptions** — defer to future polish cycle; React Query invalidation post-mutation is sufficient for single-device UX
- **Bulk-import/export of brands** — out of scope

### §2.3 Assumptions (verify at IMPL pre-flight)

- **A-1:** `events.status` enum includes 'upcoming' + 'live' values. **Verification:** read `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` for `events.status` column constraint. If enum is named differently (e.g., 'scheduled' vs 'upcoming'), SPEC §3.2.5 service function adjusts accordingly + cycle proceeds. **If enum is structurally different**, escalate to orchestrator.
- **A-2:** Cycle 14 account-soft-delete (`creator_accounts.deleted_at = now()`) does NOT auto-cascade-soft-delete owned brands. **Verification:** grep `creator_accounts` triggers + check `account_deletion_requests` workflow. If cascade exists, 17e-A IMPL preserves; if missing AND adding adds ≤30 LOC, IMPL adds inline; if missing AND ≥30 LOC, escalate.
- **A-3:** No code currently subscribes to `brands` table via Supabase Realtime. **Verification:** grep `subscribe.*brands` in `mingla-business/src/`. Forensics §F-M confirmed empty; re-verify at IMPL pre-flight.
- **A-4:** `idx_brands_slug_active` UNIQUE WHERE `deleted_at IS NULL` permits slug reuse after soft-delete. **Verification:** read migration line 11395. Forensics §B confirmed; soft-delete frees the slug.
- **A-5:** RLS UPDATE policy `Brand admin plus can update brands` (line 14114) allows UPDATE that sets `deleted_at` since policy doesn't restrict by column. **Verification:** test via Supabase SQL editor with brand_admin auth context (operator-side smoke).

---

## §3. Per-layer specifications

### §3.1 Database layer

#### §3.1.1 NEW migration file

**Path:** `supabase/migrations/20260506000000_brand_kind_address_cover_hue_media.sql`

**SQL (verbatim — implementor copies):**

```sql
-- Cycle 17e-A — adds 6 brand columns enabling persistent CRUD wiring + 17e-B Tier 2 schema pre-load.
--
-- Closes brandMapping.ts:184-191 TRANSITIONAL marker (Cycle 7 v10 + Cycle 7 FX2 v11 carry-forward).
-- Pre-loads 17e-B Tier 2 schema (cover_media_url + cover_media_type + profile_photo_type) so
-- the future Giphy/Pexels/upload picker UI cycle is UI-only.
--
-- Mirrors the events table cover_media shape (events.cover_media_url + events.cover_media_type
-- with CHECK ('image','video','gif') exactly).
--
-- No backfill required — existing rows (if any) get safe defaults at migration time.
-- No new RLS policies — existing INSERT/UPDATE/DELETE/SELECT policies cover new columns implicitly.
-- No new indexes — existing idx_brands_account_id + idx_brands_slug_active sufficient.

ALTER TABLE public.brands
  ADD COLUMN kind text NOT NULL DEFAULT 'popup'
    CHECK (kind IN ('physical', 'popup')),
  ADD COLUMN address text,
  ADD COLUMN cover_hue integer NOT NULL DEFAULT 25
    CHECK (cover_hue >= 0 AND cover_hue < 360),
  ADD COLUMN cover_media_url text,
  ADD COLUMN cover_media_type text
    CHECK (cover_media_type IS NULL OR cover_media_type IN ('image','video','gif')),
  ADD COLUMN profile_photo_type text
    CHECK (profile_photo_type IS NULL OR profile_photo_type IN ('image','video','gif'));

COMMENT ON COLUMN public.brands.kind IS
  'Cycle 7 v10 — physical brand owns/leases venue (renders address); popup operates across multiple venues. Default popup (safer, no fake address shown).';
COMMENT ON COLUMN public.brands.address IS
  'Cycle 7 v10 — public-facing address for physical brands. Free-form. NULL when popup OR not yet shared.';
COMMENT ON COLUMN public.brands.cover_hue IS
  'Cycle 7 FX2 v11 — gradient hue for public brand page hero (0-359). Defaults to 25 (warm orange = accent.warm). Fallback when cover_media_url IS NULL.';
COMMENT ON COLUMN public.brands.cover_media_url IS
  'Cycle 17e-A schema pre-load for 17e-B Tier 2 — Supabase storage URL OR Giphy/Pexels URL. NULL falls back to cover_hue gradient.';
COMMENT ON COLUMN public.brands.cover_media_type IS
  'Cycle 17e-A schema pre-load — image/video/gif. NULL when cover_media_url IS NULL.';
COMMENT ON COLUMN public.brands.profile_photo_type IS
  'Cycle 17e-A schema pre-load (Q1=B amendment) — image/video/gif. NULL allowed. Existing profile_photo_url defaults to image semantics when type IS NULL.';
```

**No new indexes.** No new RLS policies. No backfill.

**Operator runs:** `cd supabase && supabase db push` BEFORE IMPL begins (per IMPL pre-flight Step 1).

#### §3.1.2 No edge function changes

17e-A is service+hook+UI only. No edge functions touched.

### §3.2 Service layer

#### §3.2.1 NEW file: `mingla-business/src/services/brandsService.ts`

**Imports:**

```ts
import { supabase } from "./supabase";
import {
  mapBrandRowToUi,
  mapUiToBrandInsert,
  mapUiToBrandUpdatePatch,
  type BrandRow,
} from "./brandMapping";
import type { Brand, BrandRole } from "../store/currentBrandStore";
```

#### §3.2.2 Custom error class

```ts
/**
 * Thrown by `createBrand` when slug collides with existing non-deleted brand.
 * Postgrest 23505 unique_violation on idx_brands_slug_active.
 *
 * Hook layer maps this to inline form error per Decision 11.
 */
export class SlugCollisionError extends Error {
  constructor(public attemptedSlug: string) {
    super(`Brand slug "${attemptedSlug}" is already taken by an active brand.`);
    this.name = "SlugCollisionError";
  }
}
```

#### §3.2.3 `createBrand`

```ts
export interface CreateBrandInput {
  accountId: string;
  name: string;
  slug: string;
  kind: "physical" | "popup";
  address: string | null;
  coverHue: number;
  // Optional initial fields:
  bio?: string;
  tagline?: string;
  contact?: { email?: string; phone?: string };
  links?: Brand["links"];
}

export async function createBrand(
  input: CreateBrandInput,
  role: BrandRole,
): Promise<Brand> {
  const insertPayload = mapUiToBrandInsert({
    accountId: input.accountId,
    brand: {
      displayName: input.name,
      slug: input.slug,
      kind: input.kind,
      address: input.address,
      coverHue: input.coverHue,
      bio: input.bio,
      tagline: input.tagline,
      contact: input.contact,
      links: input.links,
    },
  });

  const { data, error } = await supabase
    .from("brands")
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new SlugCollisionError(input.slug);
    }
    throw error;
  }
  if (data === null) throw new Error("createBrand: insert returned null row");

  return mapBrandRowToUi(data as BrandRow, { role });
}
```

#### §3.2.4 `getBrands`

```ts
export async function getBrands(accountId: string): Promise<Brand[]> {
  const { data, error } = await supabase
    .from("brands")
    .select("*")
    .eq("account_id", accountId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data as BrandRow[]).map((row) =>
    // Default role "owner" — useCurrentBrandRole resolves real role per brand
    mapBrandRowToUi(row, { role: "owner" }),
  );
}
```

#### §3.2.5 `getBrand` (single)

```ts
export async function getBrand(brandId: string): Promise<Brand | null> {
  const { data, error } = await supabase
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  if (data === null) return null;
  return mapBrandRowToUi(data as BrandRow, { role: "owner" });
}
```

#### §3.2.6 `updateBrand`

```ts
export async function updateBrand(
  brandId: string,
  patch: Partial<Brand>,
  existingDescription: string | null,
): Promise<Brand> {
  const updatePayload = mapUiToBrandUpdatePatch(patch, { existingDescription });

  // Defensive: empty patch is no-op
  if (Object.keys(updatePayload).length === 0) {
    const existing = await getBrand(brandId);
    if (existing === null) {
      throw new Error("updateBrand: brand not found or soft-deleted");
    }
    return existing;
  }

  const { data, error } = await supabase
    .from("brands")
    .update(updatePayload)
    .eq("id", brandId)
    .is("deleted_at", null) // defensive — RLS already prevents update of soft-deleted
    .select()
    .single();

  if (error) throw error;
  if (data === null) {
    throw new Error("updateBrand: update returned null row (possibly soft-deleted concurrently)");
  }
  return mapBrandRowToUi(data as BrandRow, { role: "owner" });
}
```

#### §3.2.7 `softDeleteBrand`

```ts
export interface SoftDeleteRejection {
  rejected: true;
  reason: "upcoming_events";
  upcomingEventCount: number;
}
export interface SoftDeleteSuccess {
  rejected: false;
  brandId: string;
}
export type SoftDeleteResult = SoftDeleteSuccess | SoftDeleteRejection;

export async function softDeleteBrand(brandId: string): Promise<SoftDeleteResult> {
  // Step 1 — count upcoming OR live events for this brand (assumption A-1).
  const { count, error: countError } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", brandId)
    .in("status", ["upcoming", "live"])
    .is("deleted_at", null);

  if (countError) throw countError;

  if (count !== null && count > 0) {
    // Workflow rejection — NOT thrown; UI handles via modal
    return { rejected: true, reason: "upcoming_events", upcomingEventCount: count };
  }

  // Step 2 — soft-delete via UPDATE.
  const nowIso = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("brands")
    .update({ deleted_at: nowIso })
    .eq("id", brandId)
    .is("deleted_at", null); // defensive idempotency

  if (updateError) throw updateError;

  // Step 3 — clear default_brand_id pointer if matches (R-3 / F-H mitigation).
  const { error: clearDefaultError } = await supabase
    .from("creator_accounts")
    .update({ default_brand_id: null })
    .eq("default_brand_id", brandId);

  if (clearDefaultError) {
    // Soft-delete already succeeded — log and continue (not fatal)
    console.warn("[softDeleteBrand] clear default_brand_id failed:", clearDefaultError.message);
  }

  return { rejected: false, brandId };
}
```

#### §3.2.8 Error contract (per Const #3)

| Function | Throws | Returns |
|---|---|---|
| createBrand | `SlugCollisionError` (23505) · raw Postgrest error | Brand on success |
| getBrands | raw Postgrest error | Brand[] (possibly empty) |
| getBrand | raw Postgrest error | Brand or null |
| updateBrand | raw Postgrest error | Brand on success |
| softDeleteBrand | raw Postgrest error (count/update) | SoftDeleteSuccess OR SoftDeleteRejection (workflow rejection NEVER throws) |

NEVER `return null` on error. NEVER swallow with `catch () {}`. Hook layer catches + maps to user UX.

### §3.3 `brandMapping.ts` MODIFIED

#### §3.3.1 BrandRow interface — ADD 6 fields

```ts
export interface BrandRow {
  id: string;
  account_id: string;
  name: string;
  slug: string;
  description: string | null;
  profile_photo_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  social_links: unknown;
  custom_links: unknown;
  display_attendee_count: boolean;
  tax_settings: unknown;
  default_currency: string;
  stripe_connect_id: string | null;
  stripe_payouts_enabled: boolean;
  stripe_charges_enabled: boolean;
  // NEW Cycle 17e-A:
  kind: "physical" | "popup";
  address: string | null;
  cover_hue: number;
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | "gif" | null;
  profile_photo_type: "image" | "video" | "gif" | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
```

#### §3.3.2 BrandTableInsert — ADD 6 fields (all optional with defaults preserved)

```ts
export type BrandTableInsert = {
  account_id: string;
  name: string;
  slug: string;
  description?: string | null;
  profile_photo_url?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  social_links?: Record<string, string>;
  custom_links?: BrandCustomLink[];
  display_attendee_count?: boolean;
  tax_settings?: Record<string, unknown>;
  default_currency?: string;
  stripe_connect_id?: string | null;
  stripe_payouts_enabled?: boolean;
  stripe_charges_enabled?: boolean;
  // NEW Cycle 17e-A:
  kind?: "physical" | "popup";       // defaults to 'popup' DB-side
  address?: string | null;
  cover_hue?: number;                 // defaults to 25 DB-side
  cover_media_url?: string | null;
  cover_media_type?: "image" | "video" | "gif" | null;
  profile_photo_type?: "image" | "video" | "gif" | null;
};
```

#### §3.3.3 mapBrandRowToUi — REMOVE TRANSITIONAL defaults; READ from row

**Lines 184-191 BEFORE (delete):**
```ts
// [TRANSITIONAL] Cycle 7 FX2 added kind/address/coverHue ...
kind: "popup" as const,
address: null,
coverHue: 25,
```

**REPLACE WITH:**
```ts
// Cycle 17e-A — schema now carries kind/address/cover_hue/cover_media_*/profile_photo_type;
// TRANSITIONAL hardcoded defaults removed; closes D-CYCLE12-IMPL-2 + Cycle 7 v10 + FX2 v11.
kind: row.kind,
address: row.address,
coverHue: row.cover_hue,
coverMediaUrl: row.cover_media_url ?? undefined,
coverMediaType: row.cover_media_type ?? undefined,
profilePhotoType: row.profile_photo_type ?? undefined,
```

#### §3.3.4 mapUiToBrandInsert — pass through 6 new fields when present on UI Brand

```ts
export function mapUiToBrandInsert(input: MapUiToBrandInsertInput): BrandTableInsert {
  const { accountId, brand } = input;
  const row: BrandTableInsert = {
    account_id: accountId,
    name: brand.displayName.trim(),
    slug: brand.slug.trim(),
    description: joinBrandDescription(brand.tagline, brand.bio),
    profile_photo_url: brand.photo?.trim() || null,
    contact_email: brand.contact?.email?.trim() || null,
    contact_phone: brand.contact?.phone?.trim() || null,
    social_links: linksToSocialJson(brand.links),
    custom_links: brand.links?.custom?.length ? brand.links.custom : [],
    tax_settings: {},
    default_currency: "GBP",
    stripe_connect_id: null,
    stripe_payouts_enabled: false,
    stripe_charges_enabled: false,
  };
  if (brand.displayAttendeeCount !== undefined) {
    row.display_attendee_count = brand.displayAttendeeCount;
  }
  // NEW Cycle 17e-A — only include when present on input (DB defaults handle absence)
  if (brand.kind !== undefined) row.kind = brand.kind;
  if (brand.address !== undefined) row.address = brand.address;
  if (brand.coverHue !== undefined) row.cover_hue = brand.coverHue;
  if (brand.coverMediaUrl !== undefined) row.cover_media_url = brand.coverMediaUrl ?? null;
  if (brand.coverMediaType !== undefined) row.cover_media_type = brand.coverMediaType ?? null;
  if (brand.profilePhotoType !== undefined) row.profile_photo_type = brand.profilePhotoType ?? null;
  return row;
}
```

#### §3.3.5 mapUiToBrandUpdatePatch — handle 6 new fields when patched

```ts
export function mapUiToBrandUpdatePatch(
  patch: Partial<Brand>,
  options?: MapUiToBrandUpdateOptions,
): Partial<BrandTableInsert> {
  const out: Partial<BrandTableInsert> = {};

  if (patch.displayName !== undefined) out.name = patch.displayName.trim();
  // NB: slug NOT included — trigger forbids slug change per I-17. UI must not patch slug.
  if (patch.tagline !== undefined || patch.bio !== undefined) {
    const prev = splitBrandDescription(options?.existingDescription ?? null);
    const nextTagline = patch.tagline !== undefined ? patch.tagline : prev.tagline;
    const nextBio = patch.bio !== undefined ? patch.bio : prev.bio;
    out.description = joinBrandDescription(nextTagline, nextBio);
  }
  if (patch.photo !== undefined) out.profile_photo_url = patch.photo?.trim() || null;
  if (patch.contact !== undefined) {
    out.contact_email = patch.contact?.email?.trim() || null;
    out.contact_phone = patch.contact?.phone?.trim() || null;
  }
  if (patch.links !== undefined) {
    out.social_links = linksToSocialJson(patch.links);
    out.custom_links = patch.links?.custom?.length ? patch.links.custom : [];
  }
  if (patch.displayAttendeeCount !== undefined) {
    out.display_attendee_count = patch.displayAttendeeCount;
  }
  // NEW Cycle 17e-A — patches the 6 columns when present
  if (patch.kind !== undefined) out.kind = patch.kind;
  if (patch.address !== undefined) out.address = patch.address;
  if (patch.coverHue !== undefined) out.cover_hue = patch.coverHue;
  if (patch.coverMediaUrl !== undefined) out.cover_media_url = patch.coverMediaUrl ?? null;
  if (patch.coverMediaType !== undefined) out.cover_media_type = patch.coverMediaType ?? null;
  if (patch.profilePhotoType !== undefined) out.profile_photo_type = patch.profilePhotoType ?? null;

  return out;
}
```

### §3.4 UI Brand type expansion (`currentBrandStore.ts`)

Add 3 NEW optional fields to existing `Brand` type:

```ts
/**
 * Cover media URL (Supabase storage OR Giphy/Pexels). NEW in Cycle 17e-A schema (column pre-load).
 * UI render: if present, shows media; falls back to coverHue gradient when null/undefined.
 * Picker UI ships in 17e-B Tier 2.
 */
coverMediaUrl?: string;
/**
 * Cover media type. NEW in Cycle 17e-A schema (column pre-load).
 * 17e-B Tier 2 picker writes this.
 */
coverMediaType?: "image" | "video" | "gif";
/**
 * Profile photo type — supports animated avatars per Q1=B amendment.
 * NEW in Cycle 17e-A schema (column pre-load). Picker UI ships in 17e-B Tier 2.
 * Existing profile_photo_url defaults to image semantics when this is undefined.
 */
profilePhotoType?: "image" | "video" | "gif";
```

The existing 3 fields `kind`, `address`, `coverHue` STAY on the Brand type unchanged — only their TRANSITIONAL marker comment in `brandMapping.ts:184-191` is removed (per §3.3.3).

### §3.5 Hook layer — NEW file `mingla-business/src/hooks/useBrands.ts`

#### §3.5.1 Imports + factory keys

```ts
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  createBrand,
  getBrands,
  getBrand,
  updateBrand,
  softDeleteBrand,
  SlugCollisionError,
  type CreateBrandInput,
  type SoftDeleteResult,
} from "../services/brandsService";
import { brandRoleKeys } from "./useCurrentBrandRole";
import type { Brand } from "../store/currentBrandStore";

const STALE_TIME_MS = 5 * 60 * 1000; // 5 min — brands change infrequently

export const brandKeys = {
  all: ["brands"] as const,
  lists: () => [...brandKeys.all, "list"] as const,
  list: (accountId: string) => [...brandKeys.lists(), accountId] as const,
  details: () => [...brandKeys.all, "detail"] as const,
  detail: (brandId: string) => [...brandKeys.details(), brandId] as const,
};

const DISABLED_KEY = ["brands-disabled"] as const;
```

#### §3.5.2 `useBrands(accountId)`

```ts
export const useBrands = (
  accountId: string | null,
): UseQueryResult<Brand[]> => {
  const enabled = accountId !== null;
  return useQuery<Brand[]>({
    queryKey: enabled ? brandKeys.list(accountId) : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<Brand[]> => {
      if (!enabled || accountId === null) return [];
      return getBrands(accountId);
    },
  });
};
```

#### §3.5.3 `useBrand(brandId)`

```ts
export const useBrand = (
  brandId: string | null,
): UseQueryResult<Brand | null> => {
  const enabled = brandId !== null;
  return useQuery<Brand | null>({
    queryKey: enabled ? brandKeys.detail(brandId) : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<Brand | null> => {
      if (!enabled || brandId === null) return null;
      return getBrand(brandId);
    },
  });
};
```

#### §3.5.4 `useCreateBrand` (OPTIMISTIC per Decision 10)

```ts
export interface UseCreateBrandResult {
  mutateAsync: (input: CreateBrandInput) => Promise<Brand>;
  isPending: boolean;
}

export const useCreateBrand = (): UseCreateBrandResult => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const mutation = useMutation<Brand, Error, CreateBrandInput, { snapshot: Brand[] | undefined }>({
    mutationFn: async (input: CreateBrandInput): Promise<Brand> => {
      // Service-layer call; SlugCollisionError surfaces here for hook to map
      return createBrand(input, "owner");
    },
    onMutate: async (input) => {
      // Cancel in-flight list query so optimistic patch isn't overwritten
      await queryClient.cancelQueries({ queryKey: brandKeys.list(input.accountId) });
      const snapshot = queryClient.getQueryData<Brand[]>(brandKeys.list(input.accountId));
      // Apply optimistic — temp ID prefix `_temp_` so onSuccess can identify
      const tempBrand: Brand = {
        id: `_temp_${Date.now().toString(36)}`,
        displayName: input.name,
        slug: input.slug,
        kind: input.kind,
        address: input.address,
        coverHue: input.coverHue,
        role: "owner",
        stats: { events: 0, followers: 0, rev: 0, attendees: 0 },
        currentLiveEvent: null,
        bio: input.bio,
        tagline: input.tagline,
        contact: input.contact,
        links: input.links,
      };
      queryClient.setQueryData<Brand[]>(brandKeys.list(input.accountId), (prev) =>
        prev !== undefined ? [tempBrand, ...prev] : [tempBrand],
      );
      return { snapshot };
    },
    onError: (_error, input, context) => {
      // Rollback to snapshot
      if (context !== undefined && context.snapshot !== undefined) {
        queryClient.setQueryData<Brand[]>(brandKeys.list(input.accountId), context.snapshot);
      }
    },
    onSuccess: (serverBrand, input) => {
      // Replace temp with server-returned row
      queryClient.setQueryData<Brand[]>(brandKeys.list(input.accountId), (prev) => {
        if (prev === undefined) return [serverBrand];
        return prev.map((b) => (b.id.startsWith("_temp_") ? serverBrand : b));
      });
      // Cache the detail for fast subsequent reads
      queryClient.setQueryData<Brand>(brandKeys.detail(serverBrand.id), serverBrand);
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};
```

#### §3.5.5 `useUpdateBrand` (OPTIMISTIC)

```ts
export interface UpdateBrandInput {
  brandId: string;
  patch: Partial<Brand>;
  existingDescription: string | null;
  accountId: string; // for list-cache invalidation
}

export interface UseUpdateBrandResult {
  mutateAsync: (input: UpdateBrandInput) => Promise<Brand>;
  isPending: boolean;
}

export const useUpdateBrand = (): UseUpdateBrandResult => {
  const queryClient = useQueryClient();
  const mutation = useMutation<Brand, Error, UpdateBrandInput, { detailSnap?: Brand | null; listSnap?: Brand[] }>({
    mutationFn: async ({ brandId, patch, existingDescription }) =>
      updateBrand(brandId, patch, existingDescription),
    onMutate: async ({ brandId, patch, accountId }) => {
      await queryClient.cancelQueries({ queryKey: brandKeys.detail(brandId) });
      await queryClient.cancelQueries({ queryKey: brandKeys.list(accountId) });
      const detailSnap = queryClient.getQueryData<Brand | null>(brandKeys.detail(brandId)) ?? null;
      const listSnap = queryClient.getQueryData<Brand[]>(brandKeys.list(accountId));
      // Optimistic detail update
      if (detailSnap !== null) {
        const optimistic: Brand = { ...detailSnap, ...patch };
        queryClient.setQueryData<Brand>(brandKeys.detail(brandId), optimistic);
        // Mirror in list
        if (listSnap !== undefined) {
          queryClient.setQueryData<Brand[]>(
            brandKeys.list(accountId),
            listSnap.map((b) => (b.id === brandId ? optimistic : b)),
          );
        }
      }
      return { detailSnap, listSnap };
    },
    onError: (_error, { brandId, accountId }, context) => {
      if (context?.detailSnap !== undefined) {
        queryClient.setQueryData(brandKeys.detail(brandId), context.detailSnap);
      }
      if (context?.listSnap !== undefined) {
        queryClient.setQueryData(brandKeys.list(accountId), context.listSnap);
      }
    },
    onSuccess: (serverBrand, { brandId, accountId }) => {
      queryClient.setQueryData<Brand>(brandKeys.detail(brandId), serverBrand);
      queryClient.setQueryData<Brand[]>(brandKeys.list(accountId), (prev) => {
        if (prev === undefined) return [serverBrand];
        return prev.map((b) => (b.id === brandId ? serverBrand : b));
      });
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};
```

#### §3.5.6 `useSoftDeleteBrand` (PESSIMISTIC per Decision 10)

```ts
export interface SoftDeleteBrandInput {
  brandId: string;
  accountId: string; // for list-cache invalidation
}

export interface UseSoftDeleteBrandResult {
  mutateAsync: (input: SoftDeleteBrandInput) => Promise<SoftDeleteResult>;
  isPending: boolean;
}

export const useSoftDeleteBrand = (): UseSoftDeleteBrandResult => {
  const queryClient = useQueryClient();
  const mutation = useMutation<SoftDeleteResult, Error, SoftDeleteBrandInput>({
    mutationFn: async ({ brandId }) => softDeleteBrand(brandId),
    onSuccess: (result, { brandId, accountId }) => {
      if (!result.rejected) {
        // Invalidate list — re-fetch shows brand absent
        queryClient.invalidateQueries({ queryKey: brandKeys.list(accountId) });
        // Clear detail cache
        queryClient.removeQueries({ queryKey: brandKeys.detail(brandId) });
        // Clear role cache for this brand
        queryClient.removeQueries({ queryKey: ["brand-role", brandId] });
      }
      // On rejection: caller (BrandDeleteSheet) handles via modal; no cache changes
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};
```

#### §3.5.7 Re-exports

```ts
export { SlugCollisionError } from "../services/brandsService";
export type {
  CreateBrandInput,
  SoftDeleteResult,
  SoftDeleteSuccess,
  SoftDeleteRejection,
} from "../services/brandsService";
```

### §3.6 Zustand store migration (`currentBrandStore.ts`)

#### §3.6.1 Schema bump v12 → v13

Persisted state shape change: REMOVE `brands: Brand[]`. Keep `currentBrand: Brand | null`.

```ts
// v13 (Cycle 17e-A): drops `brands: Brand[]` from persisted state.
// Server state owned by useBrands() per Const #5. Zustand keeps only the
// SELECTION (currentBrand) which is client UI state.
```

#### §3.6.2 State + actions

```ts
export type CurrentBrandState = {
  currentBrand: Brand | null;
  setCurrentBrand: (brand: Brand | null) => void;
  reset: () => void;
};

type PersistedState = Pick<CurrentBrandState, "currentBrand">;

const persistOptions: PersistOptions<CurrentBrandState, PersistedState> = {
  name: "mingla-business.currentBrand.v13",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (state) => ({ currentBrand: state.currentBrand }),
  version: 13,
  migrate: (persistedState, version) => {
    // Cycle 17e-A — v12 → v13 drops brands array per Const #5 (server state via useBrands).
    // Preserves currentBrand selection. v1-v11 already collapsed by Cycle 17d Stage 1 §E.
    if (version < 13) {
      const old = persistedState as Partial<{ currentBrand: Brand | null }> | null;
      return { currentBrand: old?.currentBrand ?? null };
    }
    return persistedState as PersistedState;
  },
};

export const useCurrentBrandStore = create<CurrentBrandState>()(
  persist(
    (set) => ({
      currentBrand: null,
      setCurrentBrand: (brand) => set({ currentBrand: brand }),
      reset: () => set({ currentBrand: null }),
    }),
    persistOptions,
  ),
);

export const useCurrentBrand = (): Brand | null =>
  useCurrentBrandStore((s) => s.currentBrand);
```

#### §3.6.3 REMOVED — `setBrands` action + `brands` array

**Cascade (subtract before adding per Const #8):**
- Delete `setBrands: (brands: Brand[]) => void` from `CurrentBrandState`
- Delete `brands: [],` from create() initial state
- Delete `setBrands: (brands) => set({ brands })` action
- Delete `useBrandList` hook export (5 callers migrate to `useBrands()`)

#### §3.6.4 Migration plan for 5 setBrands call sites

| Site | New behavior |
|---|---|
| `app/(tabs)/account.tsx:55,134` | DELETE `handleSeedStubs` + `handleWipeBrands` per Decision 8=C; remove imports of STUB_BRANDS + setBrands |
| `BrandSwitcherSheet.tsx:92,121` | Replace `useBrandList()` → `useBrands(accountId).data ?? []`; replace `setBrands` create call → `useCreateBrand().mutateAsync(...)` |
| `app/brand/[id]/edit.tsx:39,59` | Remove `setBrands` direct write; pass `useUpdateBrand` mutation through to BrandEditView's onSave |
| `app/brand/[id]/payments/onboard.tsx:34,62` | Same pattern — Stripe-status-persist via `useUpdateBrand({ patch: { stripeStatus, ... } })` |

### §3.7 Component layer

#### §3.7.1 BrandSwitcherSheet.tsx — MOD (~+80/-15 LOC est.)

**Loading state:** show skeleton 4 brand-row placeholders + "Loading your brands…" header copy.
**Error state:** GlassCard centered "Couldn't load brands. Tap to retry." button.
**Empty state:** existing "Create your first brand" mode (no change — already handled).
**Populated state:** rows render from `useBrands(accountId).data` (server-derived).
**Submitting state (create):** existing "Creating…" spinner stays.

**NEW: per-row trailing trash icon** (right of brand name, before checkmark):
```tsx
<Pressable
  onPress={() => onRequestDeleteBrand(brand)}
  accessibilityRole="button"
  accessibilityLabel={`Delete ${brand.displayName}`}
  hitSlop={8}
  style={styles.rowDeleteBtn}
>
  <Icon name="trash" size={16} color={textTokens.tertiary} />
</Pressable>
```

When the only brand is being viewed, hide trailing trash on the row currently selected? **NO** — show on every row including current. Tapping opens BrandDeleteSheet pre-populated with that brand. If current brand is deleted, parent sets currentBrand=null after success.

**NEW: slug-collision inline error** (create mode):
- After submit, if mutation throws `SlugCollisionError`, render red helper text under the Input: "This brand name is taken. Try a small variation (e.g. 'Lonely Moth Events')."
- Input border becomes red.
- "Create brand" button stays enabled (operator types new name → error clears via state reset on input change).

**Accessibility labels:** every Pressable per I-39. New trash button label `"Delete <brand name>"`.

#### §3.7.2 BrandProfileView.tsx — MOD (~+45 LOC est.)

ADD danger-styled CTA at the bottom of the view (after existing content blocks):

```tsx
{role === "owner" || role === "account_owner" || role === "brand_admin" ? (
  <View style={styles.dangerZone}>
    <Text style={styles.dangerLabel}>Danger zone</Text>
    <Button
      label="Delete brand"
      variant="dangerSecondary" // existing variant or new — implementor verifies via /ui-ux-pro-max
      size="md"
      leadingIcon="trash"
      onPress={() => onRequestDelete(brand)}
      accessibilityLabel="Delete this brand"
    />
  </View>
) : null}
```

Visible only to brand_admin+ rank. Lower ranks see nothing in this section.

#### §3.7.3 BrandEditView.tsx — MOD (~+55 LOC est.)

**Slug field:** render read-only at top of form:
```tsx
<View style={styles.field}>
  <Text style={styles.fieldLabel}>Your URL</Text>
  <View style={[styles.inputWrap, styles.inputWrapLocked]}>
    <Text style={styles.lockedSlugText}>
      mingla.com/b/{brand.slug}
    </Text>
    <Icon name="lock" size={14} color={textTokens.tertiary} />
  </View>
  <Text style={styles.fieldHelper}>URL is locked when the brand is created.</Text>
</View>
```

**handleSave wires `useUpdateBrand`** instead of phone-only `setTimeout` simulated-delay:

```tsx
const updateMutation = useUpdateBrand();

const handleSave = useCallback(async (): Promise<void> => {
  if (!isDirty || updateMutation.isPending || draft === null) return;
  try {
    const updatedBrand = await updateMutation.mutateAsync({
      brandId: draft.id,
      patch: computeDirtyFieldsPatch(draft, brand!), // helper computes minimal patch
      existingDescription: joinBrandDescription(brand?.tagline, brand?.bio),
      accountId: user?.id ?? "",
    });
    onSave(updatedBrand);
    fireToast("Saved");
    setTimeout(() => onAfterSave(), POST_SAVE_NAV_DELAY_MS);
  } catch (error) {
    fireToast(error instanceof Error ? `Couldn't save: ${error.message}` : "Couldn't save. Tap to try again.");
  }
}, [draft, brand, isDirty, updateMutation, onSave, onAfterSave, fireToast, user?.id]);
```

**Delete CTA at bottom** (mirror BrandProfileView dangerZone):

```tsx
<View style={styles.dangerZone}>
  <Button
    label="Delete brand"
    variant="dangerSecondary"
    size="md"
    leadingIcon="trash"
    onPress={() => onRequestDelete(draft)}
  />
</View>
```

#### §3.7.4 NEW BrandDeleteSheet.tsx (~250 LOC est.)

**File path:** `mingla-business/src/components/brand/BrandDeleteSheet.tsx`

**State machine (4 states):**

```ts
type DeleteStep =
  | { kind: "warn" }
  | { kind: "preview"; counts: CascadePreviewCounts }
  | { kind: "confirm"; counts: CascadePreviewCounts }
  | { kind: "submitting" };

interface CascadePreviewCounts {
  pastEventCount: number;
  upcomingEventCount: number; // 0 confirmed via softDeleteBrand pre-flight
  liveEventCount: number;
  teamMemberCount: number;
  hasStripeConnect: boolean;
}
```

**Step 1 — Warn:**
```
Title: "Delete this brand?"
Body:
  "Deleting hides this brand from your list. Your data is preserved for 30 days
   (recoverable via support). After 30 days, deletion may become permanent in
   future cycles.

   This action cannot be undone from within the app today."

Buttons:
  [Cancel] [Continue]
```

**Step 2 — Cascade preview:** parent passes counts. Sheet renders:
```
Title: "What gets deleted with this brand"

GlassCard rows:
  • {pastEventCount} past events (history preserved)
  • {liveEventCount} live events (still running — must be cancelled first)  ← red if > 0
  • {teamMemberCount} team member{s}
  • {hasStripeConnect ? "Stripe Connect link (will be unlinked)" : "No Stripe Connect setup"}

Helper text: "Tickets, orders, refunds, and audit logs stay in your records."

Buttons:
  [Back] [Delete brand → type to confirm]
```

**Step 3 — Type-to-confirm:**
```
Title: "Type {brand.displayName} to confirm"

Input (clearable, accessibilityLabel="Confirmation brand name"):
  placeholder: brand.displayName

Submit button enabled ONLY when input.trim().toLowerCase() === brand.displayName.trim().toLowerCase()

Buttons:
  [Back] [Delete brand]
```

**Step 4 — Submitting:**
```
GlassCard centered with loading spinner + "Deleting…"
```

**On rejection (upcoming events):**
```
Modal (NOT a separate Sheet — uses ConfirmDialog primitive):
  Title: "Cannot delete this brand"
  Body: "You have {upcomingEventCount} upcoming event{s} on this brand.
         Cancel or transfer these events first, then come back to delete the brand."
  Button: [View events] (deeplink to brand's events list) | [Close]
```

**Keyboard discipline:** Step 3 input must remain visible above keyboard per `feedback_keyboard_never_blocks_input`. Use `automaticallyAdjustKeyboardInsets` on the ScrollView.

**Accessibility:** every Pressable has explicit `accessibilityLabel` per I-39. Type-to-confirm input has `accessibilityHint="Type the brand name exactly to confirm deletion"`.

**No nested Sheet primitives.** This is a single Sheet that renders different contents per state. Per `feedback_rn_sub_sheet_must_render_inside_parent` — there's nothing to nest.

**Pre-flight design verification:** Implementor MUST invoke `/ui-ux-pro-max` BEFORE writing this file per `feedback_implementor_uses_ui_ux_pro_max`. Document output verbatim in IMPL report under "Pre-flight design verification".

#### §3.7.5 Routes — `app/brand/[id]/edit.tsx` MOD (~+25/-15 LOC est.)

```tsx
const updateMutation = useUpdateBrand();
const deleteMutation = useSoftDeleteBrand();
const [deleteSheetVisible, setDeleteSheetVisible] = useState(false);

const handleSave = useCallback(async (next: Brand): Promise<void> => {
  // BrandEditView passes the full draft; Cycle 17e-A SPEC delegates patch computation here
  // OR moves it inside the mutation (simpler — see §3.7.3 — implementor decides)
}, [updateMutation]);

const handleRequestDelete = useCallback((): void => {
  setDeleteSheetVisible(true);
}, []);

return (
  <View style={...}>
    <BrandEditView
      brand={brand}
      onCancel={handleBack}
      onSave={handleSave}
      onAfterSave={handleBack}
      onRequestDelete={handleRequestDelete}  // NEW prop
    />
    <BrandDeleteSheet
      visible={deleteSheetVisible}
      brand={brand}
      onClose={() => setDeleteSheetVisible(false)}
      onDeleted={() => {
        setDeleteSheetVisible(false);
        if (currentBrand?.id === brand?.id) setCurrentBrand(null);
        router.replace("/(tabs)/account" as never);
      }}
    />
  </View>
);
```

#### §3.7.6 Routes — `app/brand/[id]/payments/onboard.tsx` MOD (~+10/-15 LOC est.)

Replace `setBrands` direct write with `useUpdateBrand` mutation patching `stripeStatus` + related fields.

#### §3.7.7 Tab — `app/(tabs)/account.tsx` MOD (~-30 LOC est.)

- Replace `useBrandList()` → `useBrands(user?.id ?? null).data ?? []`
- Remove `setBrands` import
- Remove `STUB_BRANDS` import
- Remove `handleSeedStubs` callback (lines 130-139)
- Remove `handleWipeBrands` callback (lines 141-144)
- Remove dev-seed Pressables that triggered them
- Remove `STUB_DEFAULT_BRAND_ID` import if exclusively used here

Per Decision 8 = C accept-as-loss: production operators see no change (they never had stub brands). DEV operators get blank brand list on first 17e-A run; create real brands via the wired Switcher sheet.

### §3.8 `mingla-business/src/store/brandList.ts` MOD or DELETE

Decision: **DELETE the file** if `STUB_BRANDS` and `STUB_DEFAULT_BRAND_ID` are referenced ONLY by `account.tsx` and `useCurrentBrandRole.ts` header comment.

Implementor verifies via grep. If other consumers exist, REMOVE only the exports that account.tsx uses; preserve any others (cite in IMPL report).

`useCurrentBrandRole.ts` stub-mode synthesis fallback (lines 152-158) STAYS as belt-and-suspenders for any future stub-state edge cases. Forensics §F-D: dead code post-17e-A but preserves safety. Carry-forward TRANSITIONAL is acceptable.

### §3.9 Cross-domain audit (REQUIRED at IMPL pre-flight)

**Audit:** every code path reading from `events` table must filter `brands.deleted_at IS NULL` (R-2 / F-F mitigation).

**Procedure:**
```bash
# Find all events queries
grep -rn "from(\"events\")" mingla-business/src/ mingla-business/app/
# For each result: verify the query either
#   (a) includes a JOIN/inner-eq through brands with deleted_at IS NULL, OR
#   (b) is filtered upstream by useBrands().data which already excludes soft-deleted, OR
#   (c) operates on a brand-scoped context where brand existence is pre-verified
```

**If audit finds violations:** SPEC's softDeleteBrand mutation already returns success; the offending query must be patched in 17e-A IMPL (not deferred). If patch is >50 LOC across multiple files, escalate to orchestrator for scope check.

---

## §4. Success criteria (numbered, observable, testable)

### Database layer

| SC | Criterion | Verification |
|---|---|---|
| **SC-DB-1** | Migration applies cleanly on a fresh Supabase clone | `supabase db push` exits 0; no errors |
| **SC-DB-2** | All 6 columns present on `brands` table | `\d brands` shows kind, address, cover_hue, cover_media_url, cover_media_type, profile_photo_type |
| **SC-DB-3** | `kind` CHECK constraint enforces ('physical', 'popup') | `INSERT INTO brands (..., kind) VALUES (..., 'invalid')` fails with 23514 |
| **SC-DB-4** | `cover_hue` CHECK constraint enforces 0-359 | INSERT 360 fails with 23514 |
| **SC-DB-5** | `cover_media_type` CHECK enforces ('image','video','gif') OR NULL | INSERT 'png' fails; NULL succeeds |
| **SC-DB-6** | `profile_photo_type` CHECK enforces same enum OR NULL | Same |
| **SC-DB-7** | Existing brand rows (if any) get safe defaults post-migration | Query post-migration shows kind='popup', cover_hue=25, others NULL |
| **SC-DB-8** | RLS policies still permit INSERT/UPDATE/DELETE for brand_admin+ | Smoke test via Supabase SQL editor with auth context |

### Service layer

| SC | Criterion | Verification |
|---|---|---|
| **SC-SVC-1** | `brandsService.ts` exists with 5 exported functions + SlugCollisionError | Direct file read |
| **SC-SVC-2** | `createBrand` returns mapped Brand on success; throws SlugCollisionError on 23505 | Test with known-collision slug |
| **SC-SVC-3** | `getBrands(accountId)` filters `deleted_at IS NULL` AND `account_id = accountId` | Mix of active + soft-deleted; only active returned |
| **SC-SVC-4** | `getBrand(brandId)` returns null when row is soft-deleted | Verified manually |
| **SC-SVC-5** | `updateBrand` patches only present fields; preserves description on tagline/bio split-update | Patch with only `displayName` keeps description intact |
| **SC-SVC-6** | `softDeleteBrand` returns SoftDeleteRejection when `events` count > 0 | Test with 1 upcoming event |
| **SC-SVC-7** | `softDeleteBrand` returns SoftDeleteSuccess + sets `deleted_at` when 0 events | Verified via SELECT post-call |
| **SC-SVC-8** | `softDeleteBrand` clears `creator_accounts.default_brand_id` when matches | Verified via SELECT post-call |
| **SC-SVC-9** | All services throw on raw Postgrest error per Const #3 | Force RLS denial; service throws |

### Mapper layer

| SC | Criterion | Verification |
|---|---|---|
| **SC-MAP-1** | `BrandRow` interface includes all 6 new fields | Direct file read |
| **SC-MAP-2** | `BrandTableInsert` includes all 6 new fields as optional | Direct file read |
| **SC-MAP-3** | `mapBrandRowToUi` reads kind/address/cover_hue from row (NOT hardcoded) | Direct file read; lines 184-191 TRANSITIONAL block GONE |
| **SC-MAP-4** | `mapBrandRowToUi` reads cover_media_url/cover_media_type/profile_photo_type as undefined when NULL | Test row with NULL fields |
| **SC-MAP-5** | `mapUiToBrandInsert` passes through 6 new fields when present on UI Brand | Test with all fields populated |
| **SC-MAP-6** | `mapUiToBrandUpdatePatch` handles 6 new fields when patched | Test patch with `{ kind: 'physical' }` |

### Hook layer

| SC | Criterion | Verification |
|---|---|---|
| **SC-HOOK-1** | `useBrands.ts` exists with 5 exported hooks + brandKeys factory | Direct file read |
| **SC-HOOK-2** | `useBrands` query key uses `brandKeys.list(accountId)` | Direct file read; matches factory |
| **SC-HOOK-3** | `staleTime` = 5 minutes on both queries | Direct file read |
| **SC-HOOK-4** | `enabled = accountId !== null` (guard pattern) | Direct file read |
| **SC-HOOK-5** | `useCreateBrand` is OPTIMISTIC — `onMutate` snapshots + applies temp row | Direct file read |
| **SC-HOOK-6** | `useCreateBrand` `onError` rolls back to snapshot | Direct file read |
| **SC-HOOK-7** | `useCreateBrand` `onSuccess` replaces temp with server row | Direct file read |
| **SC-HOOK-8** | `useUpdateBrand` is OPTIMISTIC | Direct file read |
| **SC-HOOK-9** | `useSoftDeleteBrand` is PESSIMISTIC + handles SoftDeleteRejection without throwing | Direct file read |
| **SC-HOOK-10** | `useSoftDeleteBrand` `onSuccess` invalidates list + removes detail + role caches | Direct file read |
| **SC-HOOK-11** | All mutations have `onError` handlers per Const #3 | Direct file read |

### Store layer

| SC | Criterion | Verification |
|---|---|---|
| **SC-STORE-1** | `currentBrandStore.ts` schema bumped v12 → v13 | Direct file read; persistOptions.name ends `.v13` |
| **SC-STORE-2** | `setBrands` action removed from CurrentBrandState | Direct file read |
| **SC-STORE-3** | `brands: Brand[]` removed from create() initial state | Direct file read |
| **SC-STORE-4** | `useBrandList` hook export removed | Direct file read |
| **SC-STORE-5** | v12 → v13 migrate function preserves currentBrand | Test: persisted v12 state → v13 read shows same currentBrand |
| **SC-STORE-6** | UI Brand type expanded with coverMediaUrl/coverMediaType/profilePhotoType (optional) | Direct file read |

### UI layer

| SC | Criterion | Verification |
|---|---|---|
| **SC-UI-BS-1** | BrandSwitcherSheet reads brands from `useBrands()` | Direct file read |
| **SC-UI-BS-2** | Loading state renders skeleton + "Loading your brands…" | Code-trace |
| **SC-UI-BS-3** | Error state renders retry button | Code-trace |
| **SC-UI-BS-4** | Create handler wires `useCreateBrand().mutateAsync()` | Direct file read |
| **SC-UI-BS-5** | Per-row trailing trash icon present + accessibility-labeled | Code-trace + I-39 gate |
| **SC-UI-BS-6** | Slug collision shows inline error + clears on input change | Manual test |
| **SC-UI-BP-1** | BrandProfileView danger zone + "Delete brand" CTA visible to brand_admin+ | Code-trace |
| **SC-UI-BE-1** | BrandEditView slug field renders read-only with "URL locked" hint | Direct file read |
| **SC-UI-BE-2** | handleSave wires `useUpdateBrand().mutateAsync()` | Direct file read |
| **SC-UI-BE-3** | Delete CTA visible at bottom for brand_admin+ | Code-trace |
| **SC-UI-BDS-1** | BrandDeleteSheet exists at `src/components/brand/BrandDeleteSheet.tsx` | Direct file read |
| **SC-UI-BDS-2** | 4-step state machine renders correctly per state | Manual test |
| **SC-UI-BDS-3** | Type-to-confirm input gates Delete button (case-insensitive trim) | Manual test |
| **SC-UI-BDS-4** | Reject-modal renders on `SoftDeleteRejection` with correct event count | Manual test with 1 upcoming event |
| **SC-UI-BDS-5** | `/ui-ux-pro-max` pre-flight invocation documented in IMPL report | IMPL report §3 |

### Cross-domain

| SC | Criterion | Verification |
|---|---|---|
| **SC-CROSS-1** | Every `from("events")` query in mingla-business filters via `brands.deleted_at IS NULL` (or upstream filtered) | Audit per §3.9 |
| **SC-CROSS-2** | No new code introduces `setBrands` calls | grep returns 0 in `mingla-business/src/` post-IMPL |
| **SC-CROSS-3** | No new code introduces raw `from("brands")` reads without `.is("deleted_at", null)` | grep audit |

### Constitutional

| SC | Criterion | Verification |
|---|---|---|
| **SC-CONST-1** | All 14 constitutional rules PASS or N/A | Per-rule audit at IMPL post-flight |
| **SC-CONST-2** | tsc clean post each implementation step | `cd mingla-business && npx tsc --noEmit` exits 0 at each checkpoint |
| **SC-CONST-3** | All 3 strict-grep CI gates exit 0 (i37 + i38 + i39 baseline preserved) | Run all 3 against final state |

**Total: 38 SCs.**

---

## §5. Invariants

### §5.1 Existing invariants preserved

| Invariant | How preserved |
|---|---|
| **I-17 (slug FROZEN at brand creation)** | `trg_brands_immutable_slug` trigger (line 12571) blocks slug UPDATE; UI hides slug edit field per §3.7.3; mapper omits slug from mapUiToBrandUpdatePatch per §3.3.5 |
| **I-32 (rank parity SQL ↔ TS)** | `useCurrentBrandRole` continues to use `BRAND_ROLE_RANK` from `brandRole.ts`; not touched |
| **I-35 (soft-delete contract for creator_accounts)** | Mirrored pattern for brands (Cycle 14 J-A14 reference) |
| **I-37 (TopBar default cluster)** | No TopBar changes; gate exit 0 verifies |
| **I-38 (IconChrome touch-target ≥ 44 effective)** | New IconChrome consumers (none expected) inherit kit default; gate verifies |
| **I-39 (Pressable accessibilityLabel coverage)** | New Pressables (BrandDeleteSheet steps + BrandSwitcherSheet trash + BrandProfileView delete CTA + BrandEditView delete CTA) all have explicit labels per §3.7; gate verifies |

### §5.2 NEW invariants (DRAFT — flip ACTIVE post-CLOSE)

#### I-PROPOSED-A: BRAND-LIST-FILTERS-DELETED

**Invariant text:** Every code path reading from `brands` table MUST filter `deleted_at IS NULL` (either via `.is("deleted_at", null)` chain at the service layer OR via JOIN with `deleted_at IS NULL` predicate). Unfiltered reads risk surfacing soft-deleted brands to UI.

**CI gate:** strict-grep AST gate scans `mingla-business/src/services/` + `mingla-business/src/hooks/` for `from("brands")` reads without `is("deleted_at", null)` chain. Allowlist comment escape-hatch: `// orch-strict-grep-allow brands-deleted-filter — <reason>`.

**Plug-in path:** registry pattern per `feedback_strict_grep_registry_pattern`. New file `.github/scripts/strict-grep/i-PROPOSED-A-brands-deleted-filter.mjs` + 1 workflow job in `.github/workflows/strict-grep-mingla-business.yml`.

**Status:** DRAFT — flips to ACTIVE on Cycle 17e-A CLOSE.

#### I-PROPOSED-B: BRAND-SOFT-DELETE-CASCADES-DEFAULT

**Invariant text:** Every soft-delete of a brand row MUST also `UPDATE creator_accounts SET default_brand_id = NULL WHERE default_brand_id = ?`. Stale default pointer leaves operator stuck post-delete.

**Test enforces:** SC-SVC-8 (functional test). No structural CI gate (logic-level constraint, not grep-able).

**Status:** DRAFT — flips to ACTIVE on Cycle 17e-A CLOSE.

#### I-PROPOSED-C: BRAND-CRUD-VIA-REACT-QUERY

**Invariant text:** Brand list state is owned by React Query (`useBrands` hook); Zustand `currentBrandStore` keeps ONLY selection state (`currentBrand: Brand | null`). The `setBrands` action and `brands: Brand[]` array MUST NOT exist post-Cycle-17e-A.

**CI gate:** strict-grep gate scans `mingla-business/src/` for `setBrands\(` references. Returns 0 hits expected. Allowlist: `// orch-strict-grep-allow setBrands-call — <reason>` (none expected).

**Plug-in path:** new file `.github/scripts/strict-grep/i-PROPOSED-C-brand-crud-react-query.mjs` + 1 workflow job.

**Status:** DRAFT — flips to ACTIVE on Cycle 17e-A CLOSE.

---

## §6. Test cases (numbered)

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | Migration applies | `supabase db push` on fresh clone | exit 0; 6 columns + CHECK constraints exist | DB |
| T-02 | Existing brand row gets safe defaults | INSERT row pre-migration; apply migration; SELECT | row.kind = 'popup'; row.cover_hue = 25; others NULL | DB |
| T-03 | createBrand happy path | Valid input + auth | Brand returned; row inserted; 23 columns populated | Service |
| T-04 | createBrand slug collision | Slug already taken by active brand | throws SlugCollisionError(slug) | Service |
| T-05 | createBrand RLS denial | account_id ≠ auth.uid() | throws Postgrest 42501 | Service |
| T-06 | getBrands filters deleted | 3 active + 2 soft-deleted brands | returns 3 active | Service |
| T-07 | getBrand returns null on soft-delete | brand row has deleted_at set | returns null | Service |
| T-08 | updateBrand patches non-immutable fields | patch = { displayName: 'New' } | row.name updated; description preserved | Service |
| T-09 | updateBrand on soft-deleted brand | soft-deleted target | throws (RLS denies + maybeSingle returns null) | Service |
| T-10 | softDeleteBrand happy path | brand with 0 upcoming events | returns SoftDeleteSuccess; row.deleted_at set | Service |
| T-11 | softDeleteBrand reject upcoming | brand with 2 upcoming events | returns SoftDeleteRejection { upcomingEventCount: 2 } | Service |
| T-12 | softDeleteBrand clears default | brand IS user's default_brand_id | creator_accounts.default_brand_id = NULL | Service |
| T-13 | softDeleteBrand idempotency | already soft-deleted | UPDATE no-op (RLS-filtered); returns success or no-error | Service |
| T-14 | mapBrandRowToUi handles all 6 new fields | row with all 6 set | UI Brand has matching values | Mapper |
| T-15 | mapBrandRowToUi NULL coverMedia | row.cover_media_url = null | brand.coverMediaUrl = undefined | Mapper |
| T-16 | mapUiToBrandInsert preserves new fields | brand with kind = 'physical' | insertPayload.kind = 'physical' | Mapper |
| T-17 | mapUiToBrandUpdatePatch omits slug | patch = { slug: 'attempted-rename' } | out.slug NOT present (mapper drops it) | Mapper |
| T-18 | useBrands fetches on accountId set | hook with accountId | data is Brand[] | Hook |
| T-19 | useBrands disabled when accountId null | hook with null | enabled false; never fires | Hook |
| T-20 | useCreateBrand optimistic add | mutateAsync({ valid input }) | list cache instantly contains temp brand | Hook |
| T-21 | useCreateBrand error rollback | mutation throws SlugCollisionError | list cache reverts to snapshot | Hook |
| T-22 | useCreateBrand success replace | mutation succeeds | temp brand replaced with server row in list cache | Hook |
| T-23 | useUpdateBrand optimistic patch | mutateAsync({ valid patch }) | detail + list cache instantly reflect patch | Hook |
| T-24 | useSoftDeleteBrand pessimistic | mutateAsync called | UI shows submitting state until server response | Hook |
| T-25 | useSoftDeleteBrand reject without throwing | server returns SoftDeleteRejection | promise resolves with rejection (no throw) | Hook |
| T-26 | currentBrandStore v12 → v13 migrate | v12 persisted state with brands array | v13 read returns currentBrand only; brands gone | Store |
| T-27 | BrandSwitcherSheet renders from server | useBrands returns 3 brands | 3 rows render | UI |
| T-28 | BrandSwitcherSheet trash icon present per row | populated state | 3 trash icons; each accessibility-labeled | UI |
| T-29 | BrandSwitcherSheet slug collision inline error | submit duplicate slug | red border + error helper text | UI |
| T-30 | BrandProfileView delete CTA visible to admin | role = brand_admin | CTA renders | UI |
| T-31 | BrandProfileView delete CTA hidden to lower rank | role = scanner | CTA absent | UI |
| T-32 | BrandEditView slug locked | render with brand | slug field renders with lock icon + helper text | UI |
| T-33 | BrandEditView Save wires mutation | valid edit | mutation fires; toast on success | UI |
| T-34 | BrandDeleteSheet 4 states render | step transition | each state's UI matches §3.7.4 | UI |
| T-35 | BrandDeleteSheet type-to-confirm gating | input != name | submit button disabled | UI |
| T-36 | BrandDeleteSheet type-to-confirm case-insensitive | input "lonely moth" vs "Lonely Moth" | enabled (case-insensitive trim match) | UI |
| T-37 | BrandDeleteSheet reject modal | softDeleteBrand returns rejection | ConfirmDialog modal renders with event count | UI |
| T-38 | tsc clean post-IMPL | `npx tsc --noEmit` | exits 0 | Static |
| T-39 | i37 gate exits 0 | run gate against final state | 0 | Static |
| T-40 | i38 gate exits 0 | run gate against final state | 0 | Static |
| T-41 | i39 gate exits 0 | run gate against final state | 0 | Static |
| T-42 | Cross-domain: events queries filter brands.deleted_at | grep audit per §3.9 | 0 unsafe queries | Cross |
| T-43 | No setBrands callers post-IMPL | grep `setBrands\(` in mingla-business/src | 0 hits | Cross |
| T-44 | No raw from("brands") without is("deleted_at", null) | grep audit | 0 unsafe queries (or all allowlist-tagged) | Cross |
| T-45 | currentBrandStore reset preserves currentBrand=null | reset() called | currentBrand = null | Store |

**Total: 45 test cases.**

---

## §7. Implementation order (sequential — single-sweep per `feedback_sequential_one_step_at_a_time`)

### IMPL pre-flight (operator + implementor)

**Operator-side (BEFORE implementor begins):**
1. Apply migration: `cd supabase && supabase db push` — this writes the 6 columns to remote DB.
2. Confirm via Supabase dashboard SQL editor: `\d brands` shows the 6 new columns.
3. Notify orchestrator/implementor that DB is ready.

**Implementor pre-flight:**
1. Verify Assumption A-1 (events.status enum includes 'upcoming' + 'live') via direct migration read.
2. Verify Assumption A-2 (account-soft-delete cascade-into-brands status) via grep + creator_accounts trigger read.
3. Run `cd mingla-business && npx tsc --noEmit` — verify pre-IMPL tsc baseline = 0.
4. Run all 3 strict-grep CI gates — verify pre-IMPL exit 0 for each.
5. Invoke `/ui-ux-pro-max` per `feedback_implementor_uses_ui_ux_pro_max` for BrandDeleteSheet design pre-flight. Document output in IMPL report.

### IMPL steps (12 sequential)

| # | Step | Files | Estimate |
|---|---|---|---|
| 1 | Database migration applied (operator) + verified (implementor) | `supabase/migrations/20260506000000_brand_kind_address_cover_hue_media.sql` | 30 min ops + 5 min verify |
| 2 | Service layer (5 functions + SlugCollisionError) | NEW `mingla-business/src/services/brandsService.ts` (~150 LOC) | 2h |
| 3 | Mapper updates (6 fields + TRANSITIONAL removal) | MOD `brandMapping.ts` (~+25/-10 LOC) | 30 min |
| 4 | UI Brand type expansion (3 new optional fields) | MOD `currentBrandStore.ts` Brand type (~+15 LOC) | 15 min |
| 5 | Hook layer (5 hooks + factory keys) | NEW `mingla-business/src/hooks/useBrands.ts` (~200 LOC) | 2.5h |
| 6 | Store migration v12 → v13 (remove brands array + setBrands action) | MOD `currentBrandStore.ts` (~-25/+10 LOC) | 30 min |
| 7 | Migrate setBrands callers (5 sites) | MOD account.tsx + BrandSwitcherSheet + edit.tsx + payments/onboard.tsx (~+70/-50 LOC) | 1.5h |
| 8 | BrandDeleteSheet (4-step state machine) — `/ui-ux-pro-max` pre-flight | NEW `mingla-business/src/components/brand/BrandDeleteSheet.tsx` (~250 LOC) | 2h |
| 9 | BrandSwitcherSheet wire create + per-row delete | MOD BrandSwitcherSheet.tsx (~+80/-15 LOC) | 1.5h |
| 10 | BrandProfileView delete CTA | MOD BrandProfileView.tsx (~+45 LOC) | 30 min |
| 11 | BrandEditView wire update + delete CTA + slug-locked hint | MOD BrandEditView.tsx (~+55 LOC) | 1h |
| 12 | Routes + dev-seed cleanup + cross-domain audit verify | MOD `app/brand/[id]/edit.tsx` + payments/onboard.tsx + `(tabs)/account.tsx` + cross-domain grep audit per §3.9 | 1h |

**Per-step verification checkpoint:** after each step, run `cd mingla-business && npx tsc --noEmit` (must exit 0). After steps 7, 9, 10, 11, 12 also run all 3 strict-grep CI gates.

**Total IMPL effort: ~13-14h focused.** Within original 12-16h estimate.

### IMPL post-flight

1. Final `npx tsc --noEmit` — exits 0.
2. All 3 CI gates exit 0.
3. Final cross-domain audit per §3.9 — 0 unsafe events queries; 0 setBrands callers; 0 unfiltered brand reads.
4. IMPL report written per `references/report-template.md` with Old → New receipts, /ui-ux-pro-max output, verification matrix, discoveries.

---

## §8. Regression prevention

### §8.1 Structural safeguards

- **3 NEW invariants** (I-PROPOSED-A/B/C) ratify ACTIVE post-CLOSE; CI gates enforce kit-wide
- **Strict-grep gate I-PROPOSED-A** prevents unfiltered `from("brands")` reads kit-wide
- **Strict-grep gate I-PROPOSED-C** prevents new `setBrands\(` callers
- **TS strict mode** blocks accidental `setBrands` re-introduction (hook surface gone post-IMPL)

### §8.2 Test enforcement

- T-42 (cross-domain audit) verifies events queries filter at IMPL post-flight
- T-43 (setBrands grep) verifies action is gone
- T-44 (brands query grep) verifies all reads filter deleted_at
- T-12 (clear default_brand_id) enforces I-PROPOSED-B mitigation

### §8.3 Protective comments (REQUIRED)

- `currentBrandStore.ts` migrate function: cite "Cycle 17e-A — v12 → v13 drops brands array per Const #5; useBrands() owns server state. Original chain at commit aae7784d for audit trail."
- `brandMapping.ts:184-191` REPLACEMENT: cite "Cycle 17e-A — schema now carries kind/address/cover_hue/cover_media_*/profile_photo_type; TRANSITIONAL hardcoded defaults removed; closes D-CYCLE12-IMPL-2 + Cycle 7 v10 + FX2 v11."
- `useBrands.ts` factory keys: cite "Cycle 17e-A — brand list query keys per `references/query-key-discipline.md` factory pattern."

---

## §9. Risks + mitigations (carry-forward from forensics §7)

| Risk | Severity | SPEC mitigation |
|---|---|---|
| **R-1: kind/address/coverHue persistence** | S1-high | RESOLVED — §3.1 migration adds 6 columns; §3.3 mapper handles |
| **R-2: events orphaned on brand soft-delete** | S1-high | §3.9 cross-domain audit at IMPL pre-flight; T-42 enforces |
| **R-3: default_brand_id stale pointer** | S2-medium | §3.2.7 softDeleteBrand Step 3 clears matching pointer; T-12 enforces |
| **R-4: slug collision on CREATE** | S1-high | §3.2.2 SlugCollisionError + §3.7.1 inline UX |
| **R-5: events status enum mismatch** | S1-high | Assumption A-1 verifies at IMPL pre-flight; SPEC §3.2.7 uses ['upcoming', 'live'] which can be adjusted if enum differs |
| **R-6: stripe_connect dual-source** | S2-medium | OUT OF 17e-A SCOPE — observation only; B-cycle Stripe wire ORCH register |
| **R-7: stub-brand fallback dead code** | S3-low | useCurrentBrandRole stub-mode synthesis preserved as belt-and-suspenders; carry-forward TRANSITIONAL acceptable |
| **R-8: dev-seed regression** | S3-low | RESOLVED — Decision 8 = C accept-as-loss; account.tsx removes seed/wipe handlers |
| **R-9: account-soft-delete cascade interaction** | S2-medium | Assumption A-2 verifies at IMPL pre-flight; if missing AND ≤30 LOC patch, IMPL adds inline; else escalate |

---

## §10. Operator-side checklist

### §10.1 Pre-IMPL (operator runs BEFORE implementor begins)

```bash
# 1. Apply migration to remote Supabase
cd supabase && supabase db push

# 2. Verify migration applied
# Open Supabase Dashboard SQL editor and run:
\d brands
# Confirm output includes: kind | address | cover_hue | cover_media_url | cover_media_type | profile_photo_type
```

If `supabase db push` reports "no migrations to apply", verify the migration file exists at `supabase/migrations/20260506000000_brand_kind_address_cover_hue_media.sql`.

### §10.2 Pre-CLOSE (operator runs AFTER tester PASS)

**Commit + push:**

Combined Stage 2 + 17e-A or standalone — operator decides.

```
feat(business): Cycle 17e-A — Brand CRUD wiring + delete UX + media-ready schema

Wires brand CRUD end-to-end against the brands Supabase table. Adds 6
columns to brands (kind, address, cover_hue, cover_media_url,
cover_media_type, profile_photo_type) — closes 12-cycle-old TRANSITIONAL
marker + pre-loads 17e-B Tier 2 cover/profile picker schema.

Surfaces:
- BrandDeleteSheet (NEW) — 4-step state machine: Warn → Cascade preview
  → Type-to-confirm → Soft-delete via deleted_at = now()
- BrandSwitcherSheet — wires useCreateBrand + per-row delete affordance
- BrandProfileView — danger-zone Delete brand CTA (brand_admin+ only)
- BrandEditView — wires useUpdateBrand + slug-locked hint + delete CTA

Reject-if-upcoming-events safety net protects paying customers.
default_brand_id auto-clears on soft-delete to prevent stuck-on-deleted-brand UX.

3 NEW invariants (I-PROPOSED-A/B/C) ratify ACTIVE.

Closes D-17d-FOUNDER-1 (brand delete UX). 17e-B (cover/profile picker)
unblocked — pure UI cycle.
```

**EAS dual-platform OTA** (per `feedback_eas_update_no_web` — 2 separate commands):

```bash
cd mingla-business && eas update --branch production --platform ios --message "Cycle 17e-A: Brand CRUD wiring"
cd mingla-business && eas update --branch production --platform android --message "Cycle 17e-A: Brand CRUD wiring"
```

**Important caveat:** verify mingla-business has its own EAS OTA channel. If not yet wired, the changes ship with the next mingla-business build.

**Migration deploys with code:** SQL migration must be applied via `supabase db push` BEFORE the OTA. Operator already ran in §10.1 — confirm idempotency in Supabase Dashboard before publishing OTA.

### §10.3 Post-OTA smoke (operator-side post-CLOSE)

1. **Create brand:** open Switcher → "Create a new brand" → enter name → Save → brand appears in list. Open on second device → verify brand syncs.
2. **Edit brand:** open Edit view → change `kind` to physical → type address → pick coverHue → Save → verify slug field shows lock icon. Open on second device → verify changes synced.
3. **Delete brand (no events):** create test brand → open Profile → tap "Delete brand" → progress through 4-step sheet → type brand name → tap Delete → verify brand removed from list.
4. **Delete brand (with upcoming event):** create test brand → create test event with `status='upcoming'` → tap Delete → verify rejection modal "Cannot delete — 1 upcoming event" → cancel → cancel the event first → retry delete → succeeds.
5. **Slug collision:** try to create a brand with same name as existing → verify inline error "name is taken. Try a small variation."

If any visual or behavioral regression: revert via git, flag for retest dispatch.

---

## §11. Cross-references

- **Forensics report:** [`reports/INVESTIGATION_BIZ_CYCLE_17E_A_BRAND_CRUD_WIRING.md`](../reports/INVESTIGATION_BIZ_CYCLE_17E_A_BRAND_CRUD_WIRING.md) (verbatim binding for Findings F-A through F-N)
- **SPEC dispatch:** [`prompts/SPEC_BIZ_CYCLE_17E_A_BRAND_CRUD_WIRING.md`](../prompts/SPEC_BIZ_CYCLE_17E_A_BRAND_CRUD_WIRING.md)
- **Stage 1 forensics §I + §J:** [`reports/INVESTIGATION_BIZ_CYCLE_17D_PERF_PASS.md`](../reports/INVESTIGATION_BIZ_CYCLE_17D_PERF_PASS.md) (schema readiness baseline)
- **Cycle 14 J-A14 reference (account-delete):** `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_14_ACCOUNT.md` (mirror for 4-step delete state machine)
- **Memory rules:** `feedback_implementor_uses_ui_ux_pro_max` · `feedback_supabase_neq_null` · `feedback_keyboard_never_blocks_input` · `feedback_rn_sub_sheet_must_render_inside_parent` · `feedback_orchestrator_never_executes` · `feedback_eas_update_no_web` · `feedback_strict_grep_registry_pattern`

---

**Authored:** 2026-05-05
**Authored by:** mingla-forensics (SPEC mode — binding contract)
**Status:** BINDING — implementor follows verbatim; deviations escalate
**Awaiting:** orchestrator REVIEW → operator applies migration via `supabase db push` → operator dispatches `/mingla-implementor take over`
**Next steps after IMPL returns:** orchestrator REVIEW → operator dispatches `/mingla-tester take over` → CLOSE protocol (DEC-109; flips I-PROPOSED-A/B/C to ACTIVE in `INVARIANT_REGISTRY.md`)
