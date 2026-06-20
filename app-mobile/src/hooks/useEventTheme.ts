import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  resolveTheme,
  isThemeAnimationSlug,
  isThemeColor,
  isThemeFontSlug,
  type ResolvedTheme,
  type ThemeInput,
} from "@mingla/offering-rendering";

import { supabase } from "../services/supabase";
import type { BusinessEventCard } from "../types/mergedDiscover";

export const eventThemeKeys = {
  all: ["brandTheme"] as const,
  byEventId: (eventId: string) => [...eventThemeKeys.all, eventId] as const,
};

interface ThemeRow {
  brand_theme_color: string | null;
  brand_theme_font: string | null;
  brand_theme_animation: string | null;
  theme_color_override: string | null;
  theme_font_override: string | null;
  theme_animation_override: string | null;
}

const asThemeInput = (
  color: unknown,
  font: unknown,
  animation: unknown,
): ThemeInput | null => {
  const out: ThemeInput = {};
  if (isThemeColor(color)) out.color = color;
  if (isThemeFontSlug(font)) out.font = font;
  if (isThemeAnimationSlug(animation)) out.animation = animation;
  return Object.keys(out).length > 0 ? out : null;
};

export const useEventTheme = (
  card: BusinessEventCard | null,
): UseQueryResult<ResolvedTheme> => {
  const eventId = card?.eventId ?? null;
  return useQuery({
    queryKey: eventId === null ? eventThemeKeys.all : eventThemeKeys.byEventId(eventId),
    enabled: eventId !== null,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (eventId === null) return resolveTheme(null, null);
      const { data, error } = await supabase
        .from("business_public_events_view")
        .select(
          "brand_theme_color,brand_theme_font,brand_theme_animation,theme_color_override,theme_font_override,theme_animation_override",
        )
        .eq("id", eventId)
        .maybeSingle();
      if (error !== null) throw error;
      const row = data as ThemeRow | null;
      return resolveTheme(
        asThemeInput(
          row?.brand_theme_color,
          row?.brand_theme_font,
          row?.brand_theme_animation,
        ),
        asThemeInput(
          row?.theme_color_override,
          row?.theme_font_override,
          row?.theme_animation_override,
        ),
      );
    },
  });
};
