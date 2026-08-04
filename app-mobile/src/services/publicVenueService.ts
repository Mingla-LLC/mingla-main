/**
 * The consumer app's read of `venue_public_view`, adapted by
 * `app/b/[brandSlug]/v/[venueSlug].tsx` into the shared `PublicVenueViewModel`.
 *
 * #1560 [consumer-adopts-shared] — this model used to DROP nine columns the
 * same `select("*")` already put on the wire. `lat`/`lng` were fetched and
 * thrown away, which is why the consumer venue page had no map for a month
 * while the buyer-web page rendered one from the identical row. They are read
 * now, alongside `place_pool_id` (the discovery-price key) and the venue's
 * typical-spend band. The gallery runs the SAME cascade the buyer surface runs
 * (`buildVenueGalleryPhotoUrls`, now shared) instead of a raw `pool_photo_urls`
 * read, so the two surfaces cannot publish different photographs.
 */
import type { PublicMenuGroup } from "@mingla/brand-rendering";
// #1560 — DEEP specifier, never the barrel: the bare "@mingla/brand-rendering"
// re-exports PublicBrandPage, which imports lucide-react-native at module
// scope. Enforced for both venue routes by issue-1550-venue-page-single-owner.
import { buildVenueGalleryPhotoUrls } from "@mingla/brand-rendering/venuePublicPhotos";
import {
  isThemeAnimationSlug,
  isThemeColor,
  isThemeFontSlug,
  type ThemeInput,
} from "@mingla/offering-rendering";

import { supabase } from "./supabase";

/**
 * The place-discovery spend band. Same shape and same two RPCs the buyer-web
 * page reads (`publicEventsService.getPublicVenueDiscoveryPrice`); resolved in
 * SOURCE currency with the minor-unit exponent, never a hardcoded 2 (#1384).
 */
export interface ConsumerVenueDiscoveryPrice {
  minMinor: number;
  maxMinor: number | null;
  currencyCode: string;
  minorUnitExponent: number;
}

export interface ConsumerPublicVenue {
  id: string;
  brandId: string;
  brandSlug: string;
  brandName: string;
  slug: string;
  name: string;
  venueCategory: "restaurant" | "play" | "creative_and_arts" | "stay" | null;
  address: string | null;
  city: string | null;
  /** #1560 — on the wire since day one; dropped by this mapper until now. */
  lat: number;
  lng: number;
  placePoolId: string | null;
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  coverHue: number;
  pitch: string | null;
  theme: ThemeInput | null;
  hours: Array<{
    weekday: number;
    openTime: string | null;
    closeTime: string | null;
    isClosed: boolean;
  }>;
  galleryPhotoUrls: string[];
  menu: PublicMenuGroup[];
  /** Null when unpriced, unknown, or not applicable — never a fabricated band. */
  discoveryPrice: ConsumerVenueDiscoveryPrice | null;
  reservability:
    | { state: "available"; venueId: string; currency: string | null }
    | { state: "unavailable" | "error"; venueId: null; currency: null };
}

interface VenueRow {
  id: string;
  brand_id: string;
  brand_slug: string;
  brand_name: string;
  slug: string;
  name: string;
  venue_category:
    | "restaurant"
    | "play"
    | "creative_and_arts"
    | "stay"
    | null;
  address: string | null;
  city: string | null;
  lat: number;
  lng: number;
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | "gif" | null;
  cover_hue: number;
  pitch: string | null;
  theme_color: string | null;
  theme_font: string | null;
  theme_animation: string | null;
  hours: unknown;
  pool_photo_urls: string[] | null;
  place_pool_id: string | null;
}

interface MenuRow {
  id: string;
  menu_id: string;
  menu_name: string;
  menu_description: string | null;
  item_name: string;
  item_description: string | null;
  price_cents: number | null;
  currency: string;
}

const asHours = (value: unknown): ConsumerPublicVenue["hours"] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (entry === null || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.weekday !== "number") return [];
    return [
      {
        weekday: row.weekday,
        openTime: typeof row.open_time === "string" ? row.open_time : null,
        closeTime: typeof row.close_time === "string" ? row.close_time : null,
        isClosed: row.is_closed === true,
      },
    ];
  });
};

const groupMenus = (rows: MenuRow[]): PublicMenuGroup[] => {
  const groups: PublicMenuGroup[] = [];
  const map = new Map<string, PublicMenuGroup>();
  for (const row of rows) {
    let group = map.get(row.menu_id);
    if (group === undefined) {
      group = {
        menuId: row.menu_id,
        menuName: row.menu_name,
        menuDescription: row.menu_description,
        items: [],
      };
      map.set(row.menu_id, group);
      groups.push(group);
    }
    group.items.push({
      id: row.id,
      name: row.item_name,
      description: row.item_description,
      priceCents: row.price_cents,
      currency: row.currency,
    });
  }
  return groups;
};

/**
 * #1560 — the typical-spend band, resolved exactly as the buyer-web page
 * resolves it (`publicEventsService.getPublicVenueDiscoveryPrice`): a projected
 * range plus the SOURCE currency's minor-unit exponent, both from RPCs. A
 * non-active range, a non-integer minor amount, or a currency with no exponent
 * metadata all resolve to `null` — the lede is then omitted rather than
 * rendered against a guessed exponent (#1384 / Constitution #9).
 */
const asDiscoveryPrice = (
  projected: unknown,
  currencies: unknown,
): ConsumerVenueDiscoveryPrice | null => {
  const row = (Array.isArray(projected) ? projected[0] : projected) as
    | Record<string, unknown>
    | null
    | undefined;
  if (row === null || row === undefined) return null;
  if (row.price_range_status !== "active") return null;
  const minMinor = Number(row.source_min_minor);
  if (!Number.isSafeInteger(minMinor)) return null;
  if (typeof row.source_currency_code !== "string") return null;
  const currencyCode = row.source_currency_code;
  const metadata = (Array.isArray(currencies) ? currencies : []).find(
    (item) =>
      item !== null &&
      typeof item === "object" &&
      (item as { code?: unknown }).code === currencyCode,
  ) as { minor_unit_exponent?: unknown } | undefined;
  if (
    metadata === undefined ||
    !Number.isInteger(metadata.minor_unit_exponent)
  ) {
    return null;
  }
  const rawMax = row.source_max_minor;
  const maxMinor =
    rawMax === null || rawMax === undefined ? null : Number(rawMax);
  return {
    minMinor,
    maxMinor: maxMinor !== null && Number.isSafeInteger(maxMinor)
      ? maxMinor
      : null,
    currencyCode,
    minorUnitExponent: metadata.minor_unit_exponent as number,
  };
};

export async function fetchConsumerPublicVenue(
  brandSlug: string,
  venueSlug: string,
): Promise<ConsumerPublicVenue | null> {
  const { data, error } = await supabase
    .from("venue_public_view")
    .select("*")
    .eq("brand_slug", brandSlug)
    .eq("slug", venueSlug)
    .maybeSingle();
  if (error !== null) throw error;
  if (data === null) return null;
  const row = data as VenueRow;

  // #1560 — the discovery-price pair joins the SAME fan-out, so the typical-
  // spend lede costs no extra round trip. Same Stay/place-pool gating as the
  // reservability probe: a Stay prices nightly (#1562), not by spend band.
  const pricedByPlace =
    row.place_pool_id !== null && row.venue_category !== "stay";
  const [menuResult, reservableResult, projectedResult, currencyResult] =
    await Promise.all([
      row.venue_category === "stay"
        ? Promise.resolve({ data: [], error: null })
        : supabase
          .from("public_menus_view")
          .select(
            "id, menu_id, menu_name, menu_description, item_name, item_description, price_cents, currency, menu_sort_order, item_sort_order",
          )
          .eq("brand_slug", brandSlug)
          .eq("venue_slug", venueSlug)
          .order("menu_sort_order", { ascending: true })
          .order("item_sort_order", { ascending: true }),
      row.place_pool_id === null || row.venue_category === "stay"
        ? Promise.resolve({ data: null, error: null })
        : supabase.rpc("pg_venue_reservable_for_place", {
            p_place_pool_id: row.place_pool_id,
          }),
      pricedByPlace
        ? supabase.rpc("place_discovery_range_for_viewer", {
            p_place_pool_id: row.place_pool_id,
            p_display_currency: null,
            p_snapshot: null,
          })
        : Promise.resolve({ data: null, error: null }),
      pricedByPlace
        ? supabase.rpc("issue_1384_supported_currencies")
        : Promise.resolve({ data: null, error: null }),
    ]);
  if (menuResult.error !== null) throw menuResult.error;

  const resolved = (
    Array.isArray(reservableResult.data)
      ? reservableResult.data[0]
      : reservableResult.data
  ) as
    | {
        reservable?: boolean;
        venue_id?: string | null;
        currency?: string | null;
      }
    | undefined;
  const reservability =
    reservableResult.error !== null
      ? { state: "error" as const, venueId: null, currency: null }
      : resolved?.reservable === true && typeof resolved.venue_id === "string"
        ? {
            state: "available" as const,
            venueId: resolved.venue_id,
            currency: resolved.currency ?? null,
          }
        : { state: "unavailable" as const, venueId: null, currency: null };

  const theme: ThemeInput = {};
  if (isThemeColor(row.theme_color)) theme.color = row.theme_color;
  if (isThemeFontSlug(row.theme_font)) theme.font = row.theme_font;
  if (isThemeAnimationSlug(row.theme_animation)) {
    theme.animation = row.theme_animation;
  }

  return {
    id: row.id,
    brandId: row.brand_id,
    brandSlug: row.brand_slug,
    brandName: row.brand_name,
    slug: row.slug,
    name: row.name,
    venueCategory: row.venue_category,
    address: row.address,
    city: row.city,
    lat: row.lat,
    lng: row.lng,
    placePoolId: row.place_pool_id,
    coverMediaUrl: row.cover_media_url,
    coverMediaType: row.cover_media_type,
    coverHue: row.cover_hue,
    pitch: row.pitch,
    theme: Object.keys(theme).length > 0 ? theme : null,
    hours: asHours(row.hours),
    // #1560 — the SHARED cascade (operator cover + profile first, place-pool
    // photos only when neither exists). Was `row.pool_photo_urls ?? []`, which
    // is a different set of photographs from the one buyer web publishes.
    galleryPhotoUrls: buildVenueGalleryPhotoUrls({
      coverMediaUrl: row.cover_media_url,
      profilePhotoUrl: null,
      poolPhotoUrls: row.pool_photo_urls,
    }),
    menu: groupMenus((menuResult.data ?? []) as MenuRow[]),
    // A price RPC failure is NOT a page failure — the lede is omitted and the
    // rest of the venue renders (the buyer page throws here; on a native page
    // with one query that would blank the whole screen over a missing band).
    discoveryPrice:
      projectedResult.error !== null || currencyResult.error !== null
        ? null
        : asDiscoveryPrice(projectedResult.data, currencyResult.data),
    reservability,
  };
}
