import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  Image,
  ScrollView,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Modal,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Icon } from './ui/Icon';
import {
  GenderOption,
  HolidayDefinition,
  HolidayCardSection,
} from "../types/holidayTypes";
import {
  STANDARD_HOLIDAYS,
  DEFAULT_PERSON_SECTIONS,
} from "../constants/holidays";
import { usePairedCards, useShufflePairedCards } from "../hooks/usePairedCards";
import { useHolidayCategories } from "../hooks/useHolidayCategories";
import { usePairedSaves } from "../hooks/usePairedSaves";
import { usePairedUserVisits } from "../hooks/useVisits";
import { getCategoryIcon, getCategoryColor, getReadableCategoryName } from "../utils/categoryUtils";
import { computeTravelInfo } from "../utils/travelTime";
import { PriceTierSlug, formatTierLabel } from "../constants/priceTiers";
import { useLocalePreferences } from "../hooks/useLocalePreferences";
import { getCurrencySymbol, getCurrencyRate } from "./utils/formatters";
import { ordinal } from "../utils/ordinalSuffix";
import { s, vs, ms, SCREEN_WIDTH } from "../utils/responsive";
import { colors } from "../constants/designSystem";
import CalendarButton from "./CalendarButton";
import ShuffleButton from "./ShuffleButton";
import PersonTabBar from "./PersonTabBar";
// ORCH-0684: PersonGridCard import removed — never used by this file.
// Other surfaces (PairedSavesListScreen, PairedProfileSection) still import it.
import BilateralToggle from "./BilateralToggle";
import VisitBadge from "./VisitBadge";
import PairedProfileSection from "./profile/PairedProfileSection";
import PairedSavesListScreen from "./PairedSavesListScreen";
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

// ── Price tier helper ───────────────────────────────────────────────────────
const VALID_TIERS: Set<string> = new Set(["chill", "comfy", "bougie", "lavish"]);
function asPriceTier(v: string | null | undefined): PriceTierSlug | null {
  return v && VALID_TIERS.has(v) ? (v as PriceTierSlug) : null;
}

// ── Shared card data shape ──────────────────────────────────────────────────

export interface FallbackCard {
  id: string;
  title: string;
  category: string;
  image: string;
  rating: number;
  address: string;
  priceRange: string;
}

// ── Props ───────────────────────────────────────────────────────────────────

interface PersonHolidayViewProps {
  pairedUserId: string;
  pairingId: string;
  displayName: string;
  birthday: string | null;
  gender: string | null;
  location: { latitude: number; longitude: number };
  userId: string;
  customHolidays?: Array<{
    id: string;
    name: string;
    month: number;
    day: number;
    year: number;
  }>;
  onAddCustomDay?: () => void;
  fallbackCards?: FallbackCard[];
  /** Persisted set of archived holiday IDs for the current person */
  archivedHolidayIds?: string[];
  /** Called when user archives a holiday — parent persists to AsyncStorage */
  onArchiveHoliday?: (holidayId: string) => void;
  /** Called when user unarchives a holiday — parent persists to AsyncStorage */
  onUnarchiveHoliday?: (holidayId: string) => void;
  /** Called when any card is tapped — parent should open ExpandedCardModal */
  onCardPress?: (card: {
    id: string;
    title: string;
    category: string;
    imageUrl: string | null;
    rating: number | null;
    address: string | null;
    priceRange: string | null;
    cardType: "single" | "curated";
    experienceType: string | null;
    website: string | null;
    description: string | null;
    lat: number | null;
    lng: number | null;
    googlePlaceId: string | null;
    priceTier: string | null;
    tagline: string | null;
    stops: number;
    stopsData: unknown[] | null;
    totalPriceMin: number | null;
    totalPriceMax: number | null;
    estimatedDurationMinutes: number | null;
    shoppingList: unknown[] | null;
    travelTime?: string;
    distance?: string;
    travelMode?: string;
  }) => void;
  /** Called when a card from the saves list is tapped — passes raw cardData + navigation context */
  onSaveCardPress?: (cardData: Record<string, unknown>, index: number, allCardData: Record<string, unknown>[]) => void;
  /** Called when user deletes a custom holiday */
  onDeleteCustomDay?: (holidayId: string, holidayName: string) => void;
  /** User's preferred travel mode — used for travel time computation on card press */
  travelMode?: string;
  /** When true, auto-open the saves list modal on mount (e.g., from map "cards" button) */
  autoOpenSaves?: boolean;
  /** Called after autoOpenSaves is consumed so parent can reset the flag */
  onAutoOpenSavesConsumed?: () => void;
}

// ── Category icon mapping (matches DiscoverScreen) ──────────────────────────

const CATEGORY_ICONS: Record<string, string> = {
  "Nature & Views": "leaf-outline",
  Nature: "leaf-outline",
  "First Meet": "chatbubbles-outline",
  "Picnic Park": "basket-outline",
  Drink: "wine-outline",
  "Casual Eats": "fast-food-outline",
  "Fine Dining": "restaurant-outline",
  Watch: "film-outline",
  "Live Performance": "musical-notes-outline",
  "Creative & Arts": "color-palette-outline",
  Play: "game-controller-outline",
  Wellness: "body-outline",
  Flowers: "flower-outline",
};

function getCatIcon(category: string): string {
  return CATEGORY_ICONS[category] || getCategoryIcon(category) || "ellipse-outline";
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getFirstName(d: string): string {
  return d.split(" ")[0] || d;
}

function getDaysUntil(m: number, d: number): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const y = today.getFullYear();
  let next = new Date(y, m, d);
  next.setHours(0, 0, 0, 0);
  if (next < today) next = new Date(y + 1, m, d);
  return Math.ceil((next.getTime() - today.getTime()) / 864e5);
}

function getNextOccurrenceDate(m: number, d: number): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const y = today.getFullYear();
  let dt = new Date(y, m, d);
  dt.setHours(0, 0, 0, 0);
  if (dt < today) dt = new Date(y + 1, m, d);
  return dt;
}

function getNextOccurrence(
  getDate: (y: number) => Date
): { date: Date; daysAway: number } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const y = today.getFullYear();
  let occ = getDate(y);
  occ.setHours(0, 0, 0, 0);
  if (occ < today) {
    occ = getDate(y + 1);
    occ.setHours(0, 0, 0, 0);
  }
  return { date: occ, daysAway: Math.ceil((occ.getTime() - today.getTime()) / 864e5) };
}

function filterByGender(
  holidays: HolidayDefinition[],
  gender: GenderOption | string | null
): HolidayDefinition[] {
  return holidays.filter((h) => {
    if (!h.genderFilter || !gender) return true;
    return h.genderFilter.includes(gender as GenderOption);
  });
}

function fmtMonthDay(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

function parseDateOnly(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return { year: y, month: m - 1, day: d };
}

function fmtBirthdayMD(s: string) {
  const { month, day } = parseDateOnly(s);
  return fmtMonthDay(new Date(new Date().getFullYear(), month, day));
}

function turningAge(s: string): number {
  const { year: by, month: bm, day: bd } = parseDateOnly(s);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const y = today.getFullYear();
  const bday = new Date(y, bm, bd);
  bday.setHours(0, 0, 0, 0);
  return bday < today ? y + 1 - by : y - by;
}

function countdownText(d: number, t: (key: string) => string): { big: string; small: string } {
  if (d === 0) return { big: t('social:holiday.today'), small: "" };
  if (d === 1) return { big: "1", small: t('social:holiday.day') };
  return { big: String(d), small: t('social:holiday.days') };
}

function seededShuffle<T>(arr: T[], seed: string): T[] {
  const c = [...arr];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  for (let i = c.length - 1; i > 0; i--) {
    h = ((h << 5) - h + i) | 0;
    const j = Math.abs(h) % (i + 1);
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c;
}

// ── Compact Card (matches GridCard visual from For You tab) ─────────────────

function CompactCard({
  title,
  category,
  imageUrl,
  rating,
  priceRange,
  isCurated,
  experienceType,
  stops,
  onPress,
}: {
  title: string;
  category: string;
  imageUrl: string | null;
  rating: number | null;
  priceRange: string | null;
  isCurated: boolean;
  experienceType: string | null;
  stops: number;
  onPress?: () => void;
}) {
  const catIcon = isCurated
    ? experienceType === "romantic"
      ? "heart-outline"
      : experienceType === "adventurous"
      ? "compass-outline"
      : "sparkles-outline"
    : getCatIcon(category);

  const catLabel = isCurated
    ? experienceType
      ? experienceType.charAt(0).toUpperCase() + experienceType.slice(1)
      : i18n.t('social:holiday.curated')
    : getReadableCategoryName(category);

  return (
    <TouchableOpacity
      style={[styles.compactCard, isCurated && styles.compactCardCurated]}
      onPress={onPress}
      activeOpacity={0.9}
    >
      {/* Image */}
      <View style={styles.compactCardImageWrap}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.compactCardImage} resizeMode="cover" />
        ) : (
          <View style={[styles.compactCardImage, styles.compactCardImageFallback]}>
            <Icon name="image-outline" size={s(28)} color="#d1d5db" />
          </View>
        )}
        {/* Category badge */}
        <View style={[styles.compactCardBadge, isCurated && styles.compactCardBadgeCurated]}>
          <Icon name={catIcon} size={s(13)} color={isCurated ? "white" : "#eb7825"} />
        </View>
      </View>

      {/* Content */}
      <View style={styles.compactCardContent}>
        <Text style={[styles.compactCardTitle, isCurated && styles.compactCardTitleCurated]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[styles.compactCardCategory, isCurated && styles.compactCardCatCurated]} numberOfLines={1}>
          {catLabel}
          {isCurated && stops > 0 ? ` · ${i18n.t('social:holiday.stops', { count: stops })}` : ""}
        </Text>
        <View style={styles.compactCardFooter}>
          {/* ORCH-0684 D-Q5: hide price line when priceRange is null —
              never render a fabricated default (Constitution #9). The
              empty View placeholder preserves footer layout via
              justifyContent:'space-between'. */}
          {priceRange ? (
            <Text style={[styles.compactCardPrice, isCurated && styles.compactCardPriceCurated]}>
              {priceRange}
            </Text>
          ) : <View />}
          {rating != null && rating > 0 ? (
            <View style={styles.compactCardRatingRow}>
              <Icon name="star" size={s(11)} color="white" />
              <Text style={[styles.compactCardRatingText, isCurated && styles.compactCardRatingCurated]}>
                {rating.toFixed(1)}
              </Text>
            </View>
          ) : (
            <View style={styles.compactCardArrow}>
              <Icon name="chevron-right" size={s(12)} color="white" />
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Card Row ────────────────────────────────────────────────────────────────

function CardRow({
  pairedUserId,
  holidayKey,
  sections,
  location,
  fallbackCards,
  onCardPress,
  onShuffleCategories,
  travelMode,
  onLoaded,
  excludeCardIds = [],
  enabled = true,
  onCardsLoaded,
  mode,                  // ORCH-0684: bilateral toggle override
  isCustomHoliday,       // ORCH-0684: composition rule routing
  yearsElapsed,          // ORCH-0684: anniversary detection
}: {
  pairedUserId: string;
  holidayKey: string;
  sections: HolidayCardSection[];
  location: { latitude: number; longitude: number };
  fallbackCards?: FallbackCard[];
  onCardPress?: PersonHolidayViewProps["onCardPress"];
  onShuffleCategories?: () => Promise<void>;
  travelMode?: string;
  onLoaded?: () => void;
  excludeCardIds?: string[];
  enabled?: boolean;
  onCardsLoaded?: (cardIds: string[]) => void;
  mode?: "default" | "individual" | "bilateral";
  isCustomHoliday?: boolean;
  yearsElapsed?: number;
}) {
  const { t } = useTranslation(['social', 'common']);
  const { currency } = useLocalePreferences();
  const currencySymbol = getCurrencySymbol(currency);
  const currencyRate = getCurrencyRate(currency);
  const hasLoc = location.latitude !== 0 || location.longitude !== 0;

  const { data, isLoading, isFetching, isError, refetch } = usePairedCards(
    enabled && hasLoc
      ? { pairedUserId, holidayKey, location, sections, excludeCardIds, mode, isCustomHoliday, yearsElapsed }
      : null
  );

  const allCards = data?.cards ?? [];
  const pairedCards = allCards;

  // Report loaded card IDs to parent for next stage's exclusions
  const reportedRef = useRef(false);
  useEffect(() => {
    if (!isLoading && !isFetching && allCards.length > 0 && onCardsLoaded && !reportedRef.current) {
      reportedRef.current = true;
      onCardsLoaded(allCards.map(c => c.id));
    }
  }, [isLoading, isFetching, allCards, onCardsLoaded]);

  // Reset reported flag when query re-fires (e.g., after shuffle or stage change)
  useEffect(() => {
    reportedRef.current = false;
  }, [holidayKey, enabled]);

  const shufflePairedCards = useShufflePairedCards();
  const handleShuffle = useCallback(async () => {
    reportedRef.current = false;
    await shufflePairedCards(pairedUserId, holidayKey, sections, location, excludeCardIds, isCustomHoliday, yearsElapsed);
    if (onShuffleCategories) onShuffleCategories();
  }, [shufflePairedCards, pairedUserId, holidayKey, sections, location, excludeCardIds, isCustomHoliday, yearsElapsed, onShuffleCategories]);

  // Signal parent that loading finished
  useEffect(() => {
    if (!isLoading && !isFetching && onLoaded) {
      onLoaded();
    }
  }, [isLoading, isFetching, onLoaded]);

  const sectionFallback = useMemo(() => {
    if (!fallbackCards || fallbackCards.length === 0) return [];
    return seededShuffle(fallbackCards, holidayKey).slice(0, 6);
  }, [fallbackCards, holidayKey]);

  if (!hasLoc || isLoading || (!data && isFetching)) {
    return (
      <View style={styles.loadingRow}>
        <ActivityIndicator size="small" color="#eb7825" />
        <Text style={styles.loadingText}>
          {hasLoc ? t('social:holiday.loading_recommendations') : t('social:holiday.getting_location')}
        </Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.errorRow}>
        <Icon name="cloud-offline-outline" size={s(20)} color="#9ca3af" />
        <Text style={styles.errorText}>{t('social:holiday.couldnt_load')}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => refetch()} activeOpacity={0.7}>
          <Icon name="refresh-outline" size={s(14)} color="#eb7825" />
          <Text style={styles.retryText}>{t('social:holiday.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.cardsScroll}
    >
      {pairedCards.length > 0
        ? pairedCards.map((c) => (
            <CompactCard
              key={c.id}
              title={c.title}
              category={c.category}
              imageUrl={c.imageUrl}
              rating={c.rating}
              priceRange={c.priceTier ? formatTierLabel(c.priceTier as PriceTierSlug, currencySymbol, currencyRate) : null}
              isCurated={c.cardType === "curated"}
              experienceType={c.experienceType}
              stops={c.stops}
              onPress={() => {
                const travel = c.lat != null && c.lng != null && location.latitude !== 0
                  ? computeTravelInfo(location.latitude, location.longitude, c.lat, c.lng, travelMode || 'walking')
                  : undefined;
                onCardPress?.({
                  id: c.id,
                  title: c.title,
                  category: c.category,
                  imageUrl: c.imageUrl,
                  rating: c.rating,
                  address: c.address,
                  priceRange: c.priceTier ? formatTierLabel(c.priceTier as PriceTierSlug, currencySymbol, currencyRate) : null,
                  cardType: c.cardType,
                  experienceType: c.experienceType,
                  website: c.website,
                  description: c.description,
                  lat: c.lat,
                  lng: c.lng,
                  googlePlaceId: c.googlePlaceId,
                  priceTier: c.priceTier,
                  tagline: c.tagline,
                  stops: c.stops,
                  stopsData: c.stopsData,
                  totalPriceMin: c.totalPriceMin,
                  totalPriceMax: c.totalPriceMax,
                  estimatedDurationMinutes: c.estimatedDurationMinutes,
                  shoppingList: c.shoppingList,
                  travelTime: travel?.travelTime,
                  distance: travel?.distance,
                  travelMode,
                });
              }}
            />
          ))
        : sectionFallback.map((c) => (
            <CompactCard
              key={`fb-${c.id}`}
              title={c.title}
              category={c.category}
              imageUrl={c.image}
              rating={c.rating}
              priceRange={c.priceRange}
              isCurated={false}
              experienceType={null}
              stops={0}
              onPress={() =>
                onCardPress?.({
                  id: c.id,
                  title: c.title,
                  category: c.category,
                  imageUrl: c.image,
                  rating: c.rating,
                  address: c.address,
                  priceRange: c.priceRange,
                  cardType: "single",
                  experienceType: null,
                  website: null,
                  description: null,
                  lat: null,
                  lng: null,
                  googlePlaceId: null,
                  priceTier: null,
                  tagline: null,
                  stops: 0,
                  stopsData: null,
                  totalPriceMin: null,
                  totalPriceMax: null,
                  estimatedDurationMinutes: null,
                  shoppingList: null,
                })
              }
            />
          ))}
      <ShuffleButton onShuffle={handleShuffle} />
    </ScrollView>
  );
}

// ── Collapsible Holiday Section ─────────────────────────────────────────────

function HolidaySectionView({
  holiday, daysAway, date,
  pairedUserId, pairingId, firstName, location,
  fallbackCards, onCardPress,
  isExpanded, onToggle, onArchive,
  travelMode, excludeCardIds, enabled, onCardsLoaded,
  mode,                  // ORCH-0684
}: {
  holiday: HolidayDefinition;
  daysAway: number;
  date: Date;
  pairedUserId: string;
  pairingId: string;
  firstName: string;
  location: { latitude: number; longitude: number };
  fallbackCards?: FallbackCard[];
  onCardPress?: PersonHolidayViewProps["onCardPress"];
  isExpanded: boolean;
  onToggle: () => void;
  onArchive: () => void;
  travelMode?: string;
  excludeCardIds?: string[];
  enabled?: boolean;
  onCardsLoaded?: (cardIds: string[]) => void;
  mode?: "default" | "individual" | "bilateral";
}) {
  const { t } = useTranslation(['social', 'common']);
  const { sections: aiSections, invalidate } = useHolidayCategories(holiday.id, holiday.name);
  const cd = countdownText(daysAway, t);

  return (
    <View style={styles.holidaySection}>
      <TouchableOpacity style={styles.holidayHeader} activeOpacity={0.7} onPress={onToggle}>
        <View style={styles.holidayHeaderLeft}>
          <View style={styles.holidayNameRow}>
            <Text style={styles.holidayName}>{holiday.name}</Text>
            <View style={styles.holidayActions}>
              <TouchableOpacity onPress={onArchive} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="archive-outline" size={s(16)} color="#9ca3af" />
              </TouchableOpacity>
              <Icon name={isExpanded ? "chevron-up" : "chevron-down"} size={s(18)} color="#9ca3af" />
            </View>
          </View>
          <Text style={styles.holidayDate}>{fmtMonthDay(date)}</Text>
        </View>
        <View style={styles.holidayDays}>
          <Text style={styles.holidayDaysNum}>{cd.big}</Text>
          {cd.small !== "" && <Text style={styles.holidayDaysLabel}>{cd.small}</Text>}
        </View>
      </TouchableOpacity>

      {isExpanded && (
        <>
          <View style={styles.calRow}>
            <CalendarButton
              holidayKey={holiday.id} pairingId={pairingId}
              eventTitle={holiday.name} nextOccurrence={date}
              notes={`Reminder from Mingla — ${firstName}'s ${holiday.name}`}
              personName={firstName} occasionLabel={holiday.name}
            />
          </View>
          <CardRow
            pairedUserId={pairedUserId} holidayKey={holiday.id}
            sections={aiSections} location={location}
            fallbackCards={fallbackCards} onCardPress={onCardPress}
            onShuffleCategories={invalidate}
            travelMode={travelMode}
            excludeCardIds={excludeCardIds}
            enabled={enabled}
            onCardsLoaded={onCardsLoaded}
            mode={mode}
            isCustomHoliday={false}
          />
        </>
      )}
    </View>
  );
}

// ── Custom Holiday Section ──────────────────────────────────────────────────

function CustomHolidaySectionView({
  holiday, pairedUserId, pairingId, firstName, location,
  fallbackCards, onCardPress, isExpanded, onToggle, onDelete,
  travelMode, excludeCardIds, enabled, onCardsLoaded,
  mode,                  // ORCH-0684
}: {
  holiday: { id: string; name: string; month: number; day: number; year: number };
  pairedUserId: string; pairingId: string; firstName: string;
  location: { latitude: number; longitude: number };
  fallbackCards?: FallbackCard[];
  onCardPress?: PersonHolidayViewProps["onCardPress"];
  isExpanded: boolean; onToggle: () => void;
  onDelete?: () => void;
  travelMode?: string;
  excludeCardIds?: string[];
  enabled?: boolean;
  onCardsLoaded?: (cardIds: string[]) => void;
  mode?: "default" | "individual" | "bilateral";
}) {
  const { t } = useTranslation(['social', 'common']);
  const da = getDaysUntil(holiday.month - 1, holiday.day);
  const nd = getNextOccurrenceDate(holiday.month - 1, holiday.day);
  const cd = countdownText(da, t);
  const { sections: ai, invalidate } = useHolidayCategories(`custom_${holiday.id}`, holiday.name);
  const yr = new Date().getFullYear();
  const elapsed = yr - holiday.year;
  const commem = elapsed <= 0 ? t('social:holiday.first_year') : t('social:holiday.year_ordinal', { ordinal: ordinal(elapsed) });

  return (
    <View style={styles.holidaySection}>
      <TouchableOpacity style={styles.holidayHeader} activeOpacity={0.7} onPress={onToggle}>
        <View style={styles.holidayHeaderLeft}>
          <View style={styles.holidayNameRow}>
            <Text style={styles.holidayName}>{holiday.name}</Text>
            <View style={styles.holidayActions}>
              {onDelete && (
                <TouchableOpacity onPress={onDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Icon name="trash-outline" size={s(16)} color="#9ca3af" />
                </TouchableOpacity>
              )}
              <Icon name={isExpanded ? "chevron-up" : "chevron-down"} size={s(18)} color="#9ca3af" />
            </View>
          </View>
          <Text style={styles.holidayDate}>
            {fmtMonthDay(new Date(yr, holiday.month - 1, holiday.day))} · {commem}
          </Text>
        </View>
        <View style={styles.holidayDays}>
          <Text style={styles.holidayDaysNum}>{cd.big}</Text>
          {cd.small !== "" && <Text style={styles.holidayDaysLabel}>{cd.small}</Text>}
        </View>
      </TouchableOpacity>

      {isExpanded && (
        <>
          <View style={styles.calRow}>
            <CalendarButton
              holidayKey={`custom_${holiday.id}`} pairingId={pairingId}
              eventTitle={holiday.name} nextOccurrence={nd}
              notes={t('social:holiday.reminder_notes', { event: holiday.name })}
              personName={firstName} occasionLabel={holiday.name}
            />
          </View>
          <CardRow
            pairedUserId={pairedUserId} holidayKey={`custom_${holiday.id}`}
            sections={ai} location={location}
            fallbackCards={fallbackCards} onCardPress={onCardPress}
            onShuffleCategories={invalidate}
            travelMode={travelMode}
            excludeCardIds={excludeCardIds}
            enabled={enabled}
            onCardsLoaded={onCardsLoaded}
            mode={mode}
            isCustomHoliday={true}
            yearsElapsed={elapsed > 0 ? elapsed : 0}
          />
        </>
      )}
    </View>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function PersonHolidayView({
  pairedUserId, pairingId, displayName, birthday, gender,
  location, userId, customHolidays, onAddCustomDay,
  fallbackCards, archivedHolidayIds, onArchiveHoliday, onUnarchiveHoliday,
  onCardPress, onSaveCardPress, onDeleteCustomDay, travelMode,
  autoOpenSaves, onAutoOpenSavesConsumed,
}: PersonHolidayViewProps) {
  const { t } = useTranslation(['social', 'common']);
  const firstName = getFirstName(displayName);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [showArchived, setShowArchived] = useState(false);

  // ── Preference Intelligence state ──────────────────────────────────────
  const [activeTab, setActiveTab] = useState(0); // 0=Picks, 1=Saves, 2=Visits
  // ORCH-0684 D-Q4: widened to include "default" so edge fn can auto-decide
  // bilateral when both users meet the preference threshold. The AsyncStorage
  // value (if set) is the user's explicit override.
  const [bilateralMode, setBilateralMode] = useState<"default" | "individual" | "bilateral">("default");
  const [showSavesList, setShowSavesList] = useState(false);
  const [showVisitsList, setShowVisitsList] = useState(false);

  // Staged dedup: accumulate card IDs from each loading stage
  const [stage1Ids, setStage1Ids] = useState<string[]>([]);
  const [stage1Done, setStage1Done] = useState(false);
  const [stage2Ids, setStage2Ids] = useState<string[]>([]);
  const [stage2Done, setStage2Done] = useState(false);
  const customLoadedRef = useRef(0);

  // Reset when viewing a different person
  useEffect(() => {
    setStage1Ids([]);
    setStage1Done(false);
    setStage2Ids([]);
    setStage2Done(false);
    customLoadedRef.current = 0;
  }, [pairedUserId]);

  // If no birthday, skip stage 1 immediately
  const hasBirthday = !!birthday;
  useEffect(() => {
    if (!hasBirthday) setStage1Done(true);
  }, [hasBirthday]);

  // If no custom holidays, skip stage 2 immediately
  const customCount = customHolidays?.length || 0;
  useEffect(() => {
    if (customCount === 0) setStage2Done(true);
  }, [customCount]);

  // Stable combined exclude list for standard holidays
  const standardExcludeIds = useMemo(() => [...stage1Ids, ...stage2Ids], [stage1Ids, stage2Ids]);

  // Load bilateral mode from AsyncStorage per paired person.
  // ORCH-0684 D-Q4: only "individual" or "bilateral" persist as overrides;
  // the absence of a value means "default" (auto-decide in edge fn).
  useEffect(() => {
    AsyncStorage.getItem(`bilateral_mode_${pairedUserId}`).then((stored) => {
      if (stored === "bilateral" || stored === "individual") {
        setBilateralMode(stored);
      } else {
        setBilateralMode("default");
      }
    }).catch(() => {});
  }, [pairedUserId]);

  const handleModeChange = useCallback((mode: "default" | "individual" | "bilateral") => {
    setBilateralMode(mode);
    if (mode === "default") {
      AsyncStorage.removeItem(`bilateral_mode_${pairedUserId}`).catch(() => {});
    } else {
      AsyncStorage.setItem(`bilateral_mode_${pairedUserId}`, mode).catch(() => {});
    }
  }, [pairedUserId]);

  // Paired saves & visits
  const { data: savesData, isLoading: savesLoading } = usePairedSaves(pairedUserId);
  const { data: visitsData, isLoading: visitsLoading } = usePairedUserVisits(userId, pairedUserId);
  const saves = savesData?.saves ?? [];
  const visits = visitsData ?? [];

  // Auto-open saves modal when triggered from map "cards" button
  useEffect(() => {
    if (autoOpenSaves && saves.length > 0) {
      setShowSavesList(true);
      onAutoOpenSavesConsumed?.();
    } else if (autoOpenSaves && !savesLoading && saves.length === 0) {
      onAutoOpenSavesConsumed?.();
    }
  }, [autoOpenSaves, saves.length, savesLoading]);

  // Derive archived set from persisted prop (parent owns state + AsyncStorage)
  const archivedSet = useMemo(
    () => new Set(archivedHolidayIds ?? []),
    [archivedHolidayIds]
  );

  const sortedHolidays = useMemo(() => {
    const filtered = filterByGender(STANDARD_HOLIDAYS, gender);
    return filtered
      .map((h) => {
        const { date, daysAway } = getNextOccurrence(h.getDate);
        return { holiday: h, date, daysAway };
      })
      .sort((a, b) => a.daysAway - b.daysAway);
  }, [gender]);

  // CRIT-002 fix: useEffect (side-effect) instead of useMemo (pure computation)
  const [hasAutoExpanded, setHasAutoExpanded] = useState(false);
  useEffect(() => {
    if (!hasAutoExpanded && sortedHolidays.length > 0) {
      const init = new Set<string>();
      sortedHolidays.slice(0, 2).forEach(({ holiday }) => init.add(holiday.id));
      setExpandedIds(init);
      setHasAutoExpanded(true);
    }
  }, [sortedHolidays, hasAutoExpanded]);

  const toggle = useCallback((id: string) => {
    setExpandedIds((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);

  const handleArchive = useCallback((id: string) => {
    onArchiveHoliday?.(id);
    setExpandedIds((p) => { const n = new Set(p); n.delete(id); return n; });
  }, [onArchiveHoliday]);

  const handleUnarchive = useCallback((id: string) => {
    onUnarchiveHoliday?.(id);
  }, [onUnarchiveHoliday]);

  const visible = useMemo(
    () => sortedHolidays.filter(({ holiday }) => !archivedSet.has(holiday.id)),
    [sortedHolidays, archivedSet]
  );
  const archived = useMemo(
    () => sortedHolidays.filter(({ holiday }) => archivedSet.has(holiday.id)),
    [sortedHolidays, archivedSet]
  );

  // Sub-screen handling moved to Modals at end of return (fixes FlatList-in-ScrollView nesting)

  return (
    <View style={styles.root}>
      {/* ── 1. Birthday Hero Card + Card Row (always visible) ──── */}
      {birthday && (() => {
        const fn = getFirstName(displayName);
        const { month: bm, day: bd } = parseDateOnly(birthday);
        // Guard: if birthday string is malformed, skip the entire hero section
        if (isNaN(bm) || isNaN(bd)) return null;
        const da = getDaysUntil(bm, bd);
        const ta = turningAge(birthday);
        const cd = countdownText(da, t);
        const nd = getNextOccurrenceDate(bm, bd);
        return (
          <View style={styles.birthdaySection}>
            <View style={styles.heroCard}>
              <View style={styles.heroContent}>
                <View style={styles.heroLeft}>
                  <Text style={styles.heroTitle}>{fn}</Text>
                  <Text style={styles.heroSubtitle}>{t('social:holiday.birthday_label')} · {fmtBirthdayMD(birthday)}</Text>
                  <Text style={styles.heroAge}>{t('social:holiday.turning_age', { age: ta })}</Text>
                </View>
                <View style={styles.heroDaysWrap}>
                  <Text style={styles.heroDaysNum}>{cd.big}</Text>
                  {cd.small !== "" && <Text style={styles.heroDaysLabel}>{cd.small}</Text>}
                </View>
              </View>
              {saves.length > 0 && (
                <TouchableOpacity
                  style={styles.heroLikedBtn}
                  onPress={() => setShowSavesList(true)}
                  activeOpacity={0.7}
                >
                  <Icon name="heart" size={s(14)} color="white" />
                  <Text style={styles.heroLikedText}>
                    {t('social:holiday.liked_places', { count: saves.length })}
                  </Text>
                  <Icon name="chevron-forward" size={s(14)} color="rgba(255,255,255,0.7)" />
                </TouchableOpacity>
              )}
              <CalendarButton
                holidayKey="birthday" pairingId={pairingId}
                eventTitle={t('social:holiday.birthday_event', { name: fn })} nextOccurrence={nd}
                notes={t('social:holiday.reminder_notes', { event: t('social:holiday.birthday_event', { name: fn }) })}
                personName={fn} occasionLabel={t('social:holiday.birthday_label')}
                inverted
              />
            </View>
            {/* Birthday card row — always visible beneath hero */}
            <CardRow
              pairedUserId={pairedUserId} holidayKey="birthday"
              sections={DEFAULT_PERSON_SECTIONS} location={location}
              fallbackCards={fallbackCards} onCardPress={onCardPress}
              travelMode={travelMode}
              excludeCardIds={[]}
              enabled={true}
              mode={bilateralMode}
              isCustomHoliday={false}
              onCardsLoaded={(ids) => {
                setStage1Ids(ids);
                setStage1Done(true);
              }}
            />
          </View>
        );
      })()}

      {/* ── 2. Your Special Days (custom holidays) ────────────────── */}
      <View style={styles.sectionWrap}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>{t('social:holiday.your_special_days')}</Text>
          {onAddCustomDay && (
            <TouchableOpacity onPress={onAddCustomDay} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="add-circle-outline" size={s(24)} color="#eb7825" />
            </TouchableOpacity>
          )}
        </View>
        {customHolidays && customHolidays.length > 0 ? (
          customHolidays.map((ch) => (
            <CustomHolidaySectionView
              key={ch.id} holiday={ch}
              pairedUserId={pairedUserId} pairingId={pairingId}
              firstName={firstName} location={location}
              fallbackCards={fallbackCards} onCardPress={onCardPress}
              isExpanded={expandedIds.has(`custom_${ch.id}`)}
              onToggle={() => toggle(`custom_${ch.id}`)}
              onDelete={onDeleteCustomDay ? () => onDeleteCustomDay(ch.id, ch.name) : undefined}
              travelMode={travelMode}
              excludeCardIds={stage1Ids}
              enabled={stage1Done}
              mode={bilateralMode}
              onCardsLoaded={(ids) => {
                setStage2Ids(prev => [...prev, ...ids]);
                customLoadedRef.current += 1;
                if (customLoadedRef.current >= (customHolidays?.length || 0)) {
                  setStage2Done(true);
                }
              }}
            />
          ))
        ) : (
          <TouchableOpacity style={styles.emptyCustom} onPress={onAddCustomDay} activeOpacity={0.7}>
            <Icon name="calendar-outline" size={s(28)} color="#d1d5db" />
            <Text style={styles.emptyCustomText}>{t('social:holiday.mark_a_day')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Preference Intelligence UI (hidden — backend active) ── */}
      {/* Tab bar (Picks/Saves/Visits) and bilateral toggle are built but
          hidden until saves/visits have real user data. The backend
          preference learning, visit tracking, paired saves sharing, and
          bilateral matching are all active and influencing holiday card
          generation via get-person-hero-cards. */}

      {/* ── 5. Upcoming Holidays (moved to bottom) ────────────────── */}
      {sortedHolidays.length > 0 && (
        <View style={styles.sectionWrap}>
          <Text style={styles.sectionTitleStandalone}>{t('social:holiday.upcoming_holidays')}</Text>

          {visible.map(({ holiday, date, daysAway }) => (
            <HolidaySectionView
              key={holiday.id}
              holiday={holiday} daysAway={daysAway} date={date}
              pairedUserId={pairedUserId} pairingId={pairingId}
              firstName={firstName} location={location}
              fallbackCards={fallbackCards} onCardPress={onCardPress}
              isExpanded={expandedIds.has(holiday.id)}
              onToggle={() => toggle(holiday.id)}
              onArchive={() => handleArchive(holiday.id)}
              travelMode={travelMode}
              excludeCardIds={standardExcludeIds}
              enabled={stage2Done || (customHolidays?.length || 0) === 0}
              mode={bilateralMode}
            />
          ))}

          {archived.length > 0 && (
            <View style={styles.archWrap}>
              <TouchableOpacity style={styles.archToggle} onPress={() => setShowArchived((v) => !v)} activeOpacity={0.7}>
                <View style={styles.archToggleLeft}>
                  <Icon name="archive-outline" size={s(16)} color="#6b7280" />
                  <Text style={styles.archLabel}>{t('social:holiday.archived')}</Text>
                  <Text style={styles.archCount}>({archived.length})</Text>
                </View>
                <Icon name={showArchived ? "chevron-up" : "chevron-down"} size={s(16)} color="#6b7280" />
              </TouchableOpacity>
              {showArchived && archived.map(({ holiday, date, daysAway }) => (
                <View key={holiday.id} style={styles.archItem}>
                  <View style={styles.flex1}>
                    <Text style={styles.archItemName}>{holiday.name}</Text>
                    <Text style={styles.archItemMeta}>
                      {fmtMonthDay(date)} · {t('social:holiday.days_away', { count: daysAway })}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => handleUnarchive(holiday.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Icon name="arrow-undo-outline" size={s(16)} color="#6b7280" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
      {/* Saves list — rendered as Modal to avoid FlatList-in-ScrollView nesting */}
      <Modal visible={showSavesList} animationType="slide" presentationStyle="pageSheet">
        <PairedSavesListScreen
          title={t('social:holiday.saves_title', { name: firstName })}
          items={saves.map((sv) => ({
            id: sv.id,
            title: sv.title,
            category: sv.category,
            imageUrl: sv.imageUrl,
            priceTier: asPriceTier(sv.priceTier),
            rating: sv.rating,
            timestamp: sv.savedAt,
            timestampLabel: t('social:holiday.saved'),
          }))}
          isLoading={savesLoading}
          onBack={() => setShowSavesList(false)}
          onCardPress={(id) => {
            const idx = saves.findIndex((s) => s.id === id);
            const sv = idx >= 0 ? saves[idx] : undefined;
            if (!sv) return;
            // Close saves modal first, then open expanded card (avoids stacked Modal issues on iOS)
            setShowSavesList(false);
            const cd = (sv.cardData ?? {}) as Record<string, unknown>;
            if (onSaveCardPress) {
              const allCd = saves.map((s) => ((s.cardData ?? {}) as Record<string, unknown>));
              // Small delay to let pageSheet dismiss before opening expanded modal
              setTimeout(() => onSaveCardPress(cd, idx, allCd), 300);
            }
          }}
        />
      </Modal>

      {/* Visits list — rendered as Modal */}
      <Modal visible={showVisitsList} animationType="slide" presentationStyle="pageSheet">
        <PairedSavesListScreen
          title={t('social:holiday.visits_title', { name: firstName })}
          items={visits.map((v) => ({
            id: v.id,
            title: v.cardData?.title || t('social:holiday.unknown_place'),
            category: v.cardData?.category || "",
            imageUrl: v.cardData?.imageUrl || "",
            priceTier: asPriceTier(v.cardData?.priceTier),
            timestamp: v.visitedAt,
            timestampLabel: t('social:holiday.visited'),
            isVisited: true,
          }))}
          isLoading={visitsLoading}
          onBack={() => setShowVisitsList(false)}
          onCardPress={() => {}}
        />
      </Modal>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const CARD_W = s(150);

const styles = StyleSheet.create({
  root: { paddingBottom: s(80) },

  // ── Birthday hero ────────────────────────────────────
  birthdaySection: { marginBottom: s(24) },
  heroCard: {
    backgroundColor: "#eb7825",
    borderRadius: s(20),
    paddingTop: s(20),
    paddingHorizontal: s(20),
    paddingBottom: s(16),
    marginBottom: s(4),
  },
  heroContent: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  heroLeft: { flex: 1 },
  heroDaysWrap: { alignItems: "flex-end" },
  heroTitle: { fontSize: s(22), fontWeight: "700", color: "white", marginBottom: s(4) },
  heroSubtitle: { fontSize: s(14), color: "rgba(255,255,255,0.9)", marginBottom: s(2) },
  heroAge: { fontSize: s(15), fontWeight: "600", color: "rgba(255,255,255,0.95)" },
  heroLikedBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.15)",
    borderRadius: s(10),
    paddingHorizontal: s(14),
    paddingVertical: s(9),
    marginTop: s(12),
  },
  heroLikedText: {
    fontSize: s(14),
    fontWeight: "600",
    color: "white",
    marginLeft: s(8),
    flex: 1,
  },
  heroDaysNum: { fontSize: s(36), fontWeight: "700", color: "white", lineHeight: s(40) },
  heroDaysLabel: { fontSize: s(16), fontWeight: "700", color: "white", lineHeight: s(24), marginTop: s(4) },

  // ── Section headers ──────────────────────────────────
  sectionWrap: { marginBottom: s(24) },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: s(12) },
  sectionTitle: { fontSize: s(18), fontWeight: "700", color: "#111827" },
  sectionTitleStandalone: { fontSize: s(18), fontWeight: "700", color: "#111827", marginBottom: s(12) },

  // ── Holiday section (collapsible) ────────────────────
  holidaySection: {
    backgroundColor: "white",
    borderRadius: s(12),
    marginBottom: s(10),
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
    overflow: "hidden",
  },
  holidayHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: s(14), paddingHorizontal: s(16) },
  holidayHeaderLeft: { flex: 1 },
  holidayNameRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: s(2) },
  holidayActions: { flexDirection: "row", alignItems: "center", gap: s(12) },
  holidayName: { fontSize: s(15), fontWeight: "600", color: "#111827", flex: 1 },
  holidayDate: { fontSize: s(12), fontWeight: "500", color: "#eb7825" },
  holidayDays: { alignItems: "flex-end", marginLeft: s(16) },
  holidayDaysNum: { fontSize: s(20), fontWeight: "700", color: "#eb7825" },
  holidayDaysLabel: { fontSize: s(11), color: "#6b7280" },
  calRow: { paddingHorizontal: s(16), paddingBottom: s(8) },

  // ── Archived ─────────────────────────────────────────
  archWrap: { marginTop: s(8) },
  archToggle: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: s(10), paddingHorizontal: s(4) },
  archToggleLeft: { flexDirection: "row", alignItems: "center", gap: s(6) },
  archLabel: { fontSize: s(13), fontWeight: "500", color: "#6b7280" },
  archCount: { fontSize: s(13), color: "#9ca3af" },
  archItem: { flexDirection: "row", alignItems: "center", paddingVertical: s(10), paddingHorizontal: s(4), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5e7eb" },
  flex1: { flex: 1 },
  archItemName: { fontSize: s(14), fontWeight: "500", color: "#6b7280" },
  archItemMeta: { fontSize: s(12), color: "#9ca3af", marginTop: s(2) },

  // ── Empty custom day ─────────────────────────────────
  emptyCustom: {
    alignItems: "center", justifyContent: "center", paddingVertical: s(24),
    backgroundColor: "#fafafa", borderRadius: s(12),
    borderWidth: 1, borderColor: "#e5e7eb", borderStyle: "dashed",
  },
  emptyCustomText: { fontSize: s(14), fontWeight: "500", color: "#9ca3af", marginTop: s(8) },

  // ── Loading ──────────────────────────────────────────
  loadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: s(24), gap: s(12) },
  loadingText: { fontSize: s(14), color: "#6b7280" },
  errorRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: vs(16), paddingHorizontal: s(16), gap: s(8) },
  errorText: { fontSize: s(13), color: "#9ca3af" },
  retryButton: { flexDirection: "row", alignItems: "center", gap: s(4), paddingHorizontal: s(12), paddingVertical: vs(6), borderRadius: s(8), backgroundColor: "#fff7ed" },
  retryText: { fontSize: s(13), fontWeight: "600", color: "#eb7825" },

  // ── Cards scroll ─────────────────────────────────────
  cardsScroll: { paddingHorizontal: s(12), paddingVertical: s(8), paddingBottom: s(16), gap: s(10) },

  // ── Compact card (matches GridCard visual from For You) ──
  compactCard: {
    width: CARD_W,
    backgroundColor: "white",
    borderRadius: s(14),
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  compactCardCurated: {
    backgroundColor: "#1C1C1E",
  },
  compactCardImageWrap: {
    position: "relative",
    height: s(100),
  },
  compactCardImage: {
    width: "100%",
    height: "100%",
  },
  compactCardImageFallback: {
    backgroundColor: "#f3f4f6",
    justifyContent: "center",
    alignItems: "center",
  },
  compactCardBadge: {
    position: "absolute",
    bottom: s(6),
    left: s(6),
    backgroundColor: "white",
    paddingHorizontal: s(6),
    paddingVertical: s(4),
    borderRadius: s(6),
  },
  compactCardBadgeCurated: {
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  compactCardContent: {
    padding: s(10),
  },
  compactCardTitle: {
    fontSize: s(13),
    fontWeight: "600",
    color: "#111827",
    marginBottom: s(3),
    lineHeight: s(17),
    minHeight: s(34),
  },
  compactCardTitleCurated: {
    color: "white",
  },
  compactCardCategory: {
    fontSize: s(11),
    fontWeight: "500",
    color: "#6b7280",
    marginBottom: s(6),
  },
  compactCardCatCurated: {
    color: "#9ca3af",
  },
  compactCardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  compactCardPrice: {
    fontSize: s(11),
    fontWeight: "400",
    color: "#eb7825",
  },
  compactCardPriceCurated: {
    color: "#F59E0B",
  },
  compactCardRatingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(2),
  },
  compactCardRatingText: {
    fontSize: s(11),
    fontWeight: "400",
    color: "#1f2937",
  },
  compactCardRatingCurated: {
    color: "#d1d5db",
  },
  compactCardArrow: {
    width: s(20),
    height: s(20),
    borderRadius: s(10),
    backgroundColor: "#eb7825",
    justifyContent: "center",
    alignItems: "center",
  },
});

// ── Preference Intelligence Styles ──────────────────────────────────────────

const piStyles = StyleSheet.create({
  tabContentWrapper: {
    minHeight: vs(200),
  },
  emptyTabContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: vs(40),
    paddingHorizontal: s(32),
  },
  emptyTabTitle: {
    fontSize: ms(15),
    fontWeight: "600",
    color: colors.gray[600],
    marginTop: vs(10),
    textAlign: "center",
  },
  emptyTabBody: {
    fontSize: ms(13),
    color: colors.gray[400],
    marginTop: vs(4),
    textAlign: "center",
    lineHeight: ms(18),
  },
  bilateralEmptyContainer: {
    alignItems: "center",
    paddingHorizontal: s(24),
    paddingVertical: vs(32),
    marginTop: vs(16),
    backgroundColor: colors.gray[50],
    borderRadius: s(16),
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
  bilateralEmptyTitle: {
    fontSize: ms(16),
    fontWeight: "600",
    color: "#111827",
    textAlign: "center",
    marginTop: vs(12),
  },
  bilateralEmptyBody: {
    fontSize: ms(13),
    color: "#6b7280",
    textAlign: "center",
    marginTop: vs(6),
    lineHeight: ms(18),
    marginBottom: vs(16),
  },
  bilateralFallbackButton: {
    backgroundColor: "#eb7825",
    borderRadius: s(12),
    paddingVertical: vs(10),
    paddingHorizontal: s(20),
  },
  bilateralFallbackText: {
    fontSize: ms(14),
    fontWeight: "600",
    color: "#ffffff",
  },
  horizontalListContent: {
    paddingRight: s(16),
  },
  cardSeparator: {
    width: s(12),
  },
  visitCardContainer: {
    position: "relative",
  },
});
