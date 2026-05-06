/**
 * Maps `public.brands` rows (B1 / BUSINESS_PROJECT_PLAN §B.2) to the UI `Brand`
 * shape in `currentBrandStore`, and back for Supabase insert/update payloads.
 *
 * Limitations (until schema or product changes):
 * - `Brand.contact.phoneCountryIso` is **not** stored on `brands`; it is lost on
 *   save unless you add a column or JSON convention later.
 * - `Brand.stats` and `Brand.currentLiveEvent` are **not** columns; pass them
 *   via `mapBrandRowToUi` options (from events/orders queries or defaults).
 * - UI `BrandRole` is only `owner` | `admin`; server has more roles — use
 *   `membershipRoleToUiBrandRole` or supply `role` explicitly.
 * - Bio + tagline share `brands.description` using a double-newline split
 *   (tagline first block, bio rest). Single-paragraph description maps to bio only.
 */

import type {
  Brand,
  BrandCustomLink,
  BrandLinks,
  BrandLiveEvent,
  BrandRole,
  BrandStats,
} from "../store/currentBrandStore";
import { deriveBrandStripeStatus } from "../utils/deriveBrandStripeStatus";

/** Snapshot of `public.brands` columns needed for mapping (B1 + Cycle 17e-A). */
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
  // NEW Cycle 17e-A — migration 20260506000000 added these 6 columns:
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

/** Insert shape for `.from('brands').insert()` (server fills id/timestamps). */
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
  // NEW Cycle 17e-A — all optional (DB defaults handle absence):
  kind?: "physical" | "popup";
  address?: string | null;
  cover_hue?: number;
  cover_media_url?: string | null;
  cover_media_type?: "image" | "video" | "gif" | null;
  profile_photo_type?: "image" | "video" | "gif" | null;
};

export const EMPTY_BRAND_STATS: BrandStats = {
  events: 0,
  followers: 0,
  rev: 0,
  attendees: 0,
};

const SOCIAL_KEYS = [
  "website",
  "instagram",
  "tiktok",
  "x",
  "facebook",
  "youtube",
  "linkedin",
  "threads",
] as const satisfies readonly (keyof Omit<BrandLinks, "custom">)[];

/**
 * Server `brand_team_members.role` → UI `BrandRole`.
 * Non-admin owner-like roles collapse to `admin` for current TopBar typing.
 */
export function membershipRoleToUiBrandRole(
  memberRole: string | null | undefined
): BrandRole {
  const r = memberRole?.toLowerCase() ?? "";
  if (r === "account_owner") return "owner";
  if (r === "brand_admin") return "admin";
  return "admin";
}

/** Split `brands.description` into optional tagline + bio (double-newline). */
export function splitBrandDescription(description: string | null | undefined): {
  tagline?: string;
  bio?: string;
} {
  const raw = description?.trim();
  if (!raw) return {};
  const parts = raw.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) return { bio: parts[0] };
  return { tagline: parts[0], bio: parts.slice(1).join("\n\n") };
}

/** Join UI tagline + bio for `brands.description`. */
export function joinBrandDescription(
  tagline: string | undefined,
  bio: string | undefined
): string | null {
  const t = tagline?.trim();
  const b = bio?.trim();
  if (t && b) return `${t}\n\n${b}`;
  if (b) return b;
  if (t) return t;
  return null;
}

function linksToSocialJson(links: BrandLinks | undefined): Record<string, string> {
  if (!links) return {};
  const out: Record<string, string> = {};
  for (const key of SOCIAL_KEYS) {
    const v = links[key];
    if (typeof v === "string" && v.trim().length > 0) out[key] = v.trim();
  }
  return out;
}

function normalizeCustomLinks(raw: unknown): BrandCustomLink[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x): x is BrandCustomLink =>
      x !== null &&
      typeof x === "object" &&
      typeof (x as BrandCustomLink).label === "string" &&
      typeof (x as BrandCustomLink).url === "string"
  );
}

function socialJsonToLinks(
  socialRaw: unknown,
  customRaw: unknown
): BrandLinks | undefined {
  const sl =
    socialRaw !== null &&
    typeof socialRaw === "object" &&
    !Array.isArray(socialRaw)
      ? (socialRaw as Record<string, unknown>)
      : {};
  const links: BrandLinks = {};
  for (const key of SOCIAL_KEYS) {
    const v = sl[key];
    if (typeof v === "string" && v.trim().length > 0) {
      links[key] = v.trim();
    }
  }
  const custom = normalizeCustomLinks(customRaw);
  if (custom.length > 0) links.custom = custom;
  return Object.keys(links).length > 0 ? links : undefined;
}

export interface MapBrandRowToUiOptions {
  /** Required — not stored on `brands`. */
  role: BrandRole;
  /** Defaults to `EMPTY_BRAND_STATS` if omitted. */
  stats?: BrandStats;
  /** Defaults to `null` if omitted. */
  currentLiveEvent?: BrandLiveEvent | null;
}

export function mapBrandRowToUi(row: BrandRow, options: MapBrandRowToUiOptions): Brand {
  const { tagline, bio } = splitBrandDescription(row.description);
  const links = socialJsonToLinks(row.social_links, row.custom_links);
  const hasContact = !!(row.contact_email?.trim() || row.contact_phone?.trim());

  // B2a: derive stripeStatus from brands.stripe_* denormalized cache.
  // Cache is mirrored from canonical stripe_connect_accounts via DB trigger
  // tg_sync_brand_stripe_cache per D-B2-3. Cache does NOT carry requirements
  // JSONB or detached_at — for full state, useBrandStripeStatus hook fetches
  // stripe_connect_accounts directly (per D-B2-16).
  // R-3 fix: previously this mapper IGNORED row.stripe_* and brand.stripeStatus
  // was purely client-side fiction. Now derived from server cache.
  const stripeStatus = deriveBrandStripeStatus({
    has_account: row.stripe_connect_id != null,
    charges_enabled: row.stripe_charges_enabled,
    payouts_enabled: row.stripe_payouts_enabled,
    // requirements + detached_at not on cache; left undefined per TS twin contract
  });

  return {
    id: row.id,
    displayName: row.name,
    slug: row.slug,
    // Cycle 17e-A — schema now carries kind/address/cover_hue/cover_media_*/profile_photo_type;
    // TRANSITIONAL hardcoded defaults removed. Closes D-CYCLE12-IMPL-2 + Cycle 7 v10
    // + FX2 v11. Per migration 20260506000000.
    kind: row.kind,
    address: row.address,
    coverHue: row.cover_hue,
    coverMediaUrl: row.cover_media_url ?? undefined,
    coverMediaType: row.cover_media_type ?? undefined,
    profilePhotoType: row.profile_photo_type ?? undefined,
    photo: row.profile_photo_url ?? undefined,
    role: options.role,
    stats: options.stats ?? { ...EMPTY_BRAND_STATS },
    currentLiveEvent: options.currentLiveEvent ?? null,
    bio: bio ?? undefined,
    tagline: tagline ?? undefined,
    contact: hasContact
      ? {
          email: row.contact_email?.trim() || undefined,
          phone: row.contact_phone?.trim() || undefined,
        }
      : undefined,
    links,
    displayAttendeeCount: row.display_attendee_count,
    stripeStatus,
  };
}

export interface MapUiToBrandInsertInput {
  accountId: string;
  brand: Pick<Brand, "displayName" | "slug"> &
    Partial<
      Omit<Brand, "id" | "role" | "stats" | "currentLiveEvent" | "displayName" | "slug">
    >;
}

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
  // NEW Cycle 17e-A — only include when present on input (DB defaults handle absence).
  if (brand.kind !== undefined) row.kind = brand.kind;
  if (brand.address !== undefined) row.address = brand.address;
  if (brand.coverHue !== undefined) row.cover_hue = brand.coverHue;
  if (brand.coverMediaUrl !== undefined) {
    row.cover_media_url = brand.coverMediaUrl ?? null;
  }
  if (brand.coverMediaType !== undefined) {
    row.cover_media_type = brand.coverMediaType ?? null;
  }
  if (brand.profilePhotoType !== undefined) {
    row.profile_photo_type = brand.profilePhotoType ?? null;
  }
  return row;
}

export interface MapUiToBrandUpdateOptions {
  /**
   * Current `brands.description` from the server. Required when patching only
   * one of `tagline` / `bio` so the other block is preserved.
   */
  existingDescription?: string | null;
}

/**
 * Partial update payload: only include keys for fields present on `patch`.
 * For `tagline` / `bio`, merges with `existingDescription` when only one is set.
 * When updating `links`, pass the **full** `Brand.links` object from editor state
 * (not a deep partial) so platforms not edited are not cleared in `social_links`.
 */
export function mapUiToBrandUpdatePatch(
  patch: Partial<Brand>,
  options?: MapUiToBrandUpdateOptions
): Partial<BrandTableInsert> {
  const out: Partial<BrandTableInsert> = {};

  if (patch.displayName !== undefined) {
    out.name = patch.displayName.trim();
  }
  // Cycle 17e-A — slug NOT patched per I-17 (trg_brands_immutable_slug trigger
  // rejects slug change). Defensive drop if UI ever passes patch.slug — no SQL throw.
  // (Removed `out.slug = patch.slug.trim()` line; was never reachable in practice
  // because BrandEditView never exposed slug edit.)
  if (patch.tagline !== undefined || patch.bio !== undefined) {
    const prev = splitBrandDescription(options?.existingDescription ?? null);
    const nextTagline =
      patch.tagline !== undefined ? patch.tagline : prev.tagline;
    const nextBio = patch.bio !== undefined ? patch.bio : prev.bio;
    out.description = joinBrandDescription(nextTagline, nextBio);
  }
  if (patch.photo !== undefined) {
    out.profile_photo_url = patch.photo?.trim() || null;
  }
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
  // NEW Cycle 17e-A — patches the 6 columns when present.
  // NB: slug NOT included in patch handling — trigger trg_brands_immutable_slug
  // forbids slug change per I-17. UI must not patch slug; if `patch.slug` is
  // ever passed, it's silently dropped here (defensive — no SQL throw).
  if (patch.kind !== undefined) out.kind = patch.kind;
  if (patch.address !== undefined) out.address = patch.address;
  if (patch.coverHue !== undefined) out.cover_hue = patch.coverHue;
  if (patch.coverMediaUrl !== undefined) {
    out.cover_media_url = patch.coverMediaUrl ?? null;
  }
  if (patch.coverMediaType !== undefined) {
    out.cover_media_type = patch.coverMediaType ?? null;
  }
  if (patch.profilePhotoType !== undefined) {
    out.profile_photo_type = patch.profilePhotoType ?? null;
  }

  return out;
}
