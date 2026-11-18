/**
 * CheckoutPaletteScope — #4420 D-C1. Each checkout flow's layout wraps its
 * steps in one of these, so every step, the shared checkout parts and the
 * header wear the offering's own colours (see checkoutTheme.ts).
 *
 * The palette is resolved from the SAME payload the offering page and the
 * steps already read (React Query, same keys, so no extra request), with the
 * same resolvers as the public page. While it loads, and for a deep link with
 * no theme, the steps stay on Graphite: never a guessed colour.
 *
 * Anon-tolerant (buyer routes): no auth, no account reads.
 */
import React, { useContext, useEffect, useMemo } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import type { ResolvedTheme, ThemeInput, ThemePalette } from "@mingla/offering-rendering";
import { boldFontFamily } from "@mingla/offering-rendering/themePalette";

import { usePublicEventById } from "../../hooks/usePublicEvents";
import { tripKeys } from "../../hooks/tripKeys";
import { usePublicExperienceById } from "../../hooks/usePublicExperience";
import {
  resolveCheckoutPalette,
  resolveCheckoutTheme,
  setActiveCheckoutPalette,
  setActiveCheckoutTheme,
} from "./checkoutTheme";
import { useThemeFont } from "../../theme/useThemeFont";

/**
 * Sets the active checkout palette during render (so the very first paint of
 * a step already has it) and hands Graphite back when the flow unmounts.
 */
export function useActiveCheckoutPalette(
  palette: ThemePalette | null,
  theme: ResolvedTheme | null = null,
): void {
  setActiveCheckoutPalette(palette);
  setActiveCheckoutTheme(palette === null ? null : theme);
  // #4420 wave 2 — host-owned titles draw in the host's bold face.
  useThemeFont(palette !== null && theme !== null ? boldFontFamily(theme) : null);
  useEffect(
    () => () => {
      setActiveCheckoutPalette(null);
      setActiveCheckoutTheme(null);
    },
    [],
  );
}

const useThemeOf = (
  brandTheme: ThemeInput | null | undefined,
  offeringThemeOverrides: ThemeInput | null | undefined,
  ready: boolean,
): ResolvedTheme | null =>
  useMemo(
    () =>
      ready ? resolveCheckoutTheme({ brandTheme, offeringThemeOverrides }) : null,
    [brandTheme, offeringThemeOverrides, ready],
  );

const usePaletteOf = (
  brandTheme: ThemeInput | null | undefined,
  offeringThemeOverrides: ThemeInput | null | undefined,
  ready: boolean,
): ThemePalette | null =>
  useMemo(
    () =>
      ready
        ? resolveCheckoutPalette({ brandTheme, offeringThemeOverrides })
        : null,
    [brandTheme, offeringThemeOverrides, ready],
  );

export const EventCheckoutPaletteScope: React.FC<{
  eventId: string;
  children: React.ReactNode;
}> = ({ eventId, children }) => {
  const query = usePublicEventById(eventId.length > 0 ? eventId : null);
  const data = query.data ?? null;
  const palette = usePaletteOf(
    data?.brand?.theme,
    data?.event.themeOverrides,
    data !== null,
  );
  const theme = useThemeOf(data?.brand?.theme, data?.event.themeOverrides, data !== null);
  useActiveCheckoutPalette(palette, theme);
  return <>{children}</>;
};

export const ExperienceCheckoutPaletteScope: React.FC<{
  experienceEventId: string;
  children: React.ReactNode;
}> = ({ experienceEventId, children }) => {
  const query = usePublicExperienceById(
    experienceEventId.length > 0 ? experienceEventId : null,
  );
  const data = query.data ?? null;
  const palette = usePaletteOf(
    data?.brand.theme,
    data?.experience.themeOverrides,
    data !== null,
  );
  const theme = useThemeOf(data?.brand.theme, data?.experience.themeOverrides, data !== null);
  useActiveCheckoutPalette(palette, theme);
  return <>{children}</>;
};

interface CachedTripPage {
  trip?: { id?: string };
  brand?: { theme?: ThemeInput | null };
  themeOverrides?: ThemeInput | null;
}

const isCachedTripPage = (value: unknown): value is CachedTripPage =>
  typeof value === "object" && value !== null && "trip" in value;

/**
 * The trip checkout's by-id payload carries no theme, so the palette comes
 * from the public trip page the guest arrived from (its query is still in
 * the cache under `tripKeys.public()`). A deep link straight to checkout has no
 * such entry and stays on Graphite.
 */
export const TripCheckoutPaletteScope: React.FC<{
  tripEventId: string;
  children: React.ReactNode;
}> = ({ tripEventId, children }) => {
  const queryClient = useContext(QueryClientContext);
  const page =
    queryClient === undefined || tripEventId.length === 0
      ? null
      : (queryClient
          .getQueriesData<unknown>({ queryKey: tripKeys.public() })
          .map(([, value]) => value)
          .find(
            (value): value is CachedTripPage =>
              isCachedTripPage(value) &&
              value.trip?.id === tripEventId &&
              value.brand !== undefined &&
              "theme" in value.brand,
          ) ?? null);
  const palette = usePaletteOf(
    page?.brand?.theme,
    page?.themeOverrides,
    page !== null,
  );
  const theme = useThemeOf(page?.brand?.theme, page?.themeOverrides, page !== null);
  useActiveCheckoutPalette(palette, theme);
  return <>{children}</>;
};
