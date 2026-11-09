/**
 * #4347 wave 4 (decision 4) — the Explorer layer on a host venue's public page.
 *
 * The page body is the shared `@mingla/brand-rendering` PublicVenueScreen, the
 * SAME module buyer web renders, and it is not changed here. The consumer
 * route adds two things through the screen's optional host slots (buyer web
 * passes neither, so the web page is unchanged):
 *
 *   1. `VenueExplorerOverview` (the Overview slot): "When you'd go" — the
 *      place sheet's block (wave 2), in the page's own palette when every
 *      colour pair measures legible, otherwise on a neutral white card — and
 *      "Experiences here", whose prices follow the Part 1 rule (converted, "≈").
 *   2. `VenueExplorerBar` (the action-bar slot): Save · Schedule · Share · one
 *      main button. It is the place sheet's pinned `ActionButtons`, acting on
 *      the deck card the person tapped (see deckVenueHandoff), so Save and
 *      Schedule take the deck's own save and calendar paths. The main button is
 *      "Reserve a table" when the venue takes reservations (all three
 *      `useVenueReservable` conditions AND the page's own sheet gate), and
 *      Directions otherwise. It replaces the page's own reserve bar, so there
 *      is never a second reserve bar.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useReducedMotion } from 'react-native-reanimated';
import type {
  PublicVenueActionBarContext,
  PublicVenueThemedContext,
} from '@mingla/brand-rendering/PublicVenueScreen';

import ActionButtons from '../expandedCard/ActionButtons';
import { WhenYoudGo } from '../expandedCard/WhenYoudGo';
import VenueExperiencesSection from '../expandedCard/VenueExperiencesSection';
import { pinnedPrimaryStyles } from '../expandedCard/pinnedPrimary';
import { PINNED_BAR, PINNED_PRIMARY } from '../expandedCard/spineTokens';
import { openPlaceDirections } from '../expandedCard/placeDirections';
import { whenChips, type WhenKey } from '../expandedCard/placeSheetModel';
import { formatClockMinute } from '../deckCard/useDeckFactLabels';
import { Icon } from '../ui/Icon';
import { toastManager } from '../ui/Toast';
import { weatherService } from '../../services/weatherService';
import { useVenueReservable } from '../../hooks/useVenueReservable';
import { useLocalePreferences } from '../../hooks/useLocalePreferences';
import type { BusinessEventCard } from '../../types/mergedDiscover';
import type { ExpandedCardData } from '../../types/expandedCardTypes';
import type { DeckVenueHandoff } from './deckVenueHandoff';
import {
  brandHoursToWeekdayText,
  crowdCategoryFor,
  venuePrimaryAction,
  whenColorsFor,
  type BrandHourEntry,
} from './venueExplorerModel';

/** The venue facts the layer reads (a subset of `ConsumerPublicVenue`). */
export interface ExplorerVenue {
  readonly name: string;
  readonly address: string | null;
  readonly lat: number;
  readonly lng: number;
  readonly placePoolId: string | null;
  readonly venueCategory: string | null;
  readonly hours: readonly BrandHourEntry[];
}

export const venueWeatherKeys = {
  all: ['venueWeather'] as const,
  at: (lat: number, lng: number) => [...venueWeatherKeys.all, lat.toFixed(3), lng.toFixed(3)] as const,
};

/** Bar height above the safe area: top padding + button + top border. */
export const VENUE_EXPLORER_BAR_HEIGHT = PINNED_BAR.paddingTop + PINNED_BAR.buttonHeight + 1;

const hasCoords = (lat: number, lng: number): boolean =>
  Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

// ─────────────────────────────────────────────────────────────────────────────
// 1. The Overview slot
// ─────────────────────────────────────────────────────────────────────────────

export function VenueExplorerOverview({
  context,
  venue,
  handoff,
  onOpenExperience,
  now,
}: {
  context: PublicVenueThemedContext;
  venue: ExplorerVenue;
  handoff: DeckVenueHandoff | null;
  onOpenExperience: (card: BusinessEventCard) => void;
  /** Injectable clock, for tests. */
  now?: Date;
}): React.ReactElement {
  const { i18n } = useTranslation(['cards']);
  const reducedMotion = useReducedMotion();
  const { currency, measurementSystem } = useLocalePreferences();
  const [whenKey, setWhenKey] = useState<WhenKey>('now');
  const when = useMemo(() => whenColorsFor(context.palette), [context.palette]);

  const coordsOk = hasCoords(venue.lat, venue.lng);
  const weather = useQuery({
    queryKey: venueWeatherKeys.at(venue.lat, venue.lng),
    queryFn: () => weatherService.getWeatherForecast(venue.lat, venue.lng),
    enabled: coordsOk,
    staleTime: 15 * 60 * 1000,
  });

  const card: ExpandedCardData | null = handoff?.card ?? null;
  const cardOffset = card?.utcOffsetMinutes ?? null;
  const utcOffsetMinutes: number | null =
    cardOffset ??
    (typeof weather.data?.utcOffsetSeconds === 'number' ? Math.round(weather.data.utcOffsetSeconds / 60) : null);
  const at = now ?? new Date();
  const scheduledAt = (() => {
    const raw = (card as { scheduledAt?: unknown } | null)?.scheduledAt;
    if (typeof raw !== 'string') return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  })();
  const chips = whenChips(at, utcOffsetMinutes, scheduledAt);
  const language = i18n?.language ?? 'en';
  const clock = useCallback((minute: number) => formatClockMinute(minute, language), [language]);
  // The host's own published hours; the deck card's Google hours when the host
  // has none. Either way, unknown hours only hide the "quieter at" hint.
  const openingHours = brandHoursToWeekdayText(venue.hours) ?? card?.openingHours ?? null;

  return (
    <View style={styles.overview} testID="venue-explorer-overview">
      <View testID={when.themed ? 'venue-when-themed' : 'venue-when-neutral'}>
        <WhenYoudGo
          chips={chips}
          selected={whenKey}
          onSelect={setWhenKey}
          hourly={weather.data?.hourlyForecast ?? null}
          weatherUtcOffsetSeconds={weather.data?.utcOffsetSeconds ?? null}
          category={crowdCategoryFor(card?.category, venue.venueCategory)}
          utcOffsetMinutes={utcOffsetMinutes}
          openingHours={openingHours}
          driveTime={card?.travelTime ?? null}
          lat={coordsOk ? venue.lat : null}
          lng={coordsOk ? venue.lng : null}
          measurementSystem={measurementSystem}
          clock={clock}
          reducedMotion={reducedMotion}
          colors={when.colors}
          fontFamily={context.theme.fontFamilyValue}
        />
      </View>
      <VenueExperiencesSection
        placePoolId={venue.placePoolId}
        currency={currency}
        onOpenExperience={onOpenExperience}
        colors={when.colors}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. The pinned action bar
// ─────────────────────────────────────────────────────────────────────────────

export function VenueExplorerBar({
  context,
  venue,
  handoff,
  bottomInset,
  onShare,
  onLeave,
}: {
  context: PublicVenueActionBarContext;
  venue: ExplorerVenue;
  handoff: DeckVenueHandoff;
  bottomInset: number;
  onShare: () => void;
  /** Back to the deck (after a save, a schedule, or before the paywall). */
  onLeave: () => void;
}): React.ReactElement {
  const { t } = useTranslation(['cards']);
  const { data: reservable } = useVenueReservable(venue.placePoolId);
  const primary = venuePrimaryAction({
    bookingKind: context.bookingKind,
    canReserve: context.canReserve,
    reservable,
  });
  const { card } = handoff;

  const handleSave = useCallback(
    async (saved: ExpandedCardData): Promise<void> => {
      // The deck's own save (solo save or collab vote). On success the card
      // leaves the deck, as it does from the place sheet, and we go back to it.
      await handoff.save(saved);
      onLeave();
    },
    [handoff, onLeave],
  );

  const directions = useCallback((): void => {
    openPlaceDirections(
      {
        lat: hasCoords(venue.lat, venue.lng) ? venue.lat : null,
        lng: hasCoords(venue.lat, venue.lng) ? venue.lng : null,
        label: venue.address || venue.name,
        googlePlaceId: card.googlePlaceId ?? null,
      },
      {
        onUnavailable: () =>
          toastManager.show(t('cards:expanded.directions_unavailable', { defaultValue: "Couldn't open directions" }), 'error'),
      },
    );
  }, [card.googlePlaceId, t, venue.address, venue.lat, venue.lng, venue.name]);

  const reserveLabel = context.bookingKind === 'stay' ? context.reserveAction : t('cards:sheet.reserve');

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(bottomInset, 12) }]} testID="venue-explorer-bar">
      <ActionButtons
        variant="pinned"
        card={card}
        onSave={handleSave}
        onClose={onLeave}
        isSaved={handoff.isSaved}
        userPreferences={handoff.userPreferences}
        currentMode={handoff.currentMode}
        onCardRemoved={handoff.onCardRemoved}
        onScheduleSuccess={() => onLeave()}
        onPaywallRequired={() => {
          onLeave();
          handoff.onPaywallRequired?.();
        }}
        canAccessCurated={handoff.canAccessCurated}
        onShare={onShare}
        shareLabel={t('cards:swipeable.share_card', { defaultValue: 'Share {{title}}', title: venue.name })}
        reserve={
          primary === 'reserve' ? (
            <TouchableOpacity
              testID="venue-primary-reserve"
              style={pinnedPrimaryStyles.button}
              activeOpacity={0.85}
              onPress={context.openReservation}
              accessibilityRole="button"
              accessibilityLabel={t('cards:sheet.reserve_a11y', { name: venue.name })}
            >
              <Icon name="restaurant-outline" size={18} color={PINNED_PRIMARY.label} />
              <Text style={pinnedPrimaryStyles.label} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                {reserveLabel}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              testID="venue-primary-directions"
              style={pinnedPrimaryStyles.button}
              activeOpacity={0.85}
              onPress={directions}
              accessibilityRole="button"
              accessibilityLabel={t('cards:sheet.directions_a11y', { name: venue.name })}
            >
              <Icon name="navigate-outline" size={18} color={PINNED_PRIMARY.label} />
              <Text style={pinnedPrimaryStyles.label} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                {t('cards:sheet.directions')}
              </Text>
            </TouchableOpacity>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overview: {
    gap: 20,
  },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 6,
    backgroundColor: '#FFFFFF',
  },
});
