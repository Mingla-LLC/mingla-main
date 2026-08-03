import type { PublicMenuGroup } from "@mingla/brand-rendering";
import {
  isThemeAnimationSlug,
  isThemeColor,
  isThemeFontSlug,
  type ThemeInput,
} from "@mingla/offering-rendering";

import { supabase } from "./supabase";

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

  const [menuResult, reservableResult] = await Promise.all([
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
    coverMediaUrl: row.cover_media_url,
    coverMediaType: row.cover_media_type,
    coverHue: row.cover_hue,
    pitch: row.pitch,
    theme: Object.keys(theme).length > 0 ? theme : null,
    hours: asHours(row.hours),
    galleryPhotoUrls: row.pool_photo_urls ?? [],
    menu: groupMenus((menuResult.data ?? []) as MenuRow[]),
    reservability,
  };
}
