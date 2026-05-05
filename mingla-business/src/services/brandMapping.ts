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

/** Snapshot of `public.brands` columns needed for mapping (B1 migration). */
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

  return {
    id: row.id,
    displayName: row.name,
    slug: row.slug,
    // [TRANSITIONAL] Cycle 7 FX2 added kind/address/coverHue to UI Brand type but
    // brands table doesn't carry these columns yet. Defaults: popup (safer — no fake
    // address shown), null address, hue 25 (warm-orange — matches accent.warm scheme).
    // EXIT: B-cycle adds the 3 columns to brands table → BrandRow interface + this
    // mapper read from `row` directly. Per Cycle 17a §A.3; closes D-CYCLE12-IMPL-2.
    kind: "popup" as const,
    address: null,
    coverHue: 25,
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
  if (patch.slug !== undefined) {
    out.slug = patch.slug.trim();
  }
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

  return out;
}
