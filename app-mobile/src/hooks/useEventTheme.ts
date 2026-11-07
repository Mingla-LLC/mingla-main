import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  resolveTheme,
  type ResolvedTheme,
  type ThemeInput,
} from "@mingla/offering-rendering";
import { themeInputFromFields } from "@mingla/offering-rendering/themeResolver";
import {
  withGradientColumnFallback,
  withoutGradientColumns,
} from "@mingla/offering-rendering/themeGradientColumnFallback";

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
  brand_theme_gradient?: string | null;
  theme_gradient_override?: string | null;
}

const EVENT_THEME_SELECT =
  "brand_theme_color,brand_theme_font,brand_theme_animation,theme_color_override,theme_font_override,theme_animation_override,brand_theme_gradient,theme_gradient_override";

// issue #1023 wave 2 — one guard for every theme read (Google families and
// the gradient's second stop included); see themeInputFromFields.
const asThemeInput = (
  color: unknown,
  font: unknown,
  animation: unknown,
  gradient?: unknown,
): ThemeInput | null => themeInputFromFields(color, font, animation, gradient);

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
      // [TRANSITIONAL] #1023 — retries without the gradient columns until the
      // gradient migration is applied. Exit: migration applied to production.
      const { data, error } = await withGradientColumnFallback((withGradient) =>
        supabase
          .from("business_public_events_view")
          .select(
            withGradient
              ? EVENT_THEME_SELECT
              : withoutGradientColumns(EVENT_THEME_SELECT),
          )
          .eq("id", eventId)
          .maybeSingle(),
      );
      if (error !== null) throw error;
      const row = data as ThemeRow | null;
      return resolveTheme(
        asThemeInput(
          row?.brand_theme_color,
          row?.brand_theme_font,
          row?.brand_theme_animation,
          row?.brand_theme_gradient,
        ),
        asThemeInput(
          row?.theme_color_override,
          row?.theme_font_override,
          row?.theme_animation_override,
          row?.theme_gradient_override,
        ),
      );
    },
  });
};
