/**
 * Issue #4265 — one card in the Likes two-column grid.
 *
 * Anatomy (SavedCard.dc.html): a 4:5 photo with a kind chip top-left, the
 * filled heart top-right (removes the card, with Undo), and — once booked — an
 * orange date chip bottom-left. Below: the name (max two lines), one facts
 * line, then the main button and a square Share button.
 *
 * Replaces the old SavedSimpleCardRow / SavedCuratedCardRow pair. It is
 * memoised and every callback it receives is permanently stable (see
 * `rowHandlers` in SavedTab), so a schedule / removal / filter change only
 * re-renders the cards it actually touches.
 */
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Heart } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { glass, ANDROID_GLASS_USES_OPAQUE_FALLBACK } from "../../constants/designSystem";
import { resolvePlacePhotoThumbSource } from "../../utils/placePhotoThumb";
import { getReadableCategoryName } from "../../utils/categoryUtils";
import { formatCurrency } from "../utils/formatters";
import { formatEventDateChip } from "../../utils/eventDateDisplay";
import { isPlaceOpenNow, extractWeekdayText } from "../../utils/openingHoursUtils";
import { HapticFeedback } from "../../utils/hapticFeedback";
import type { SavedPrimaryAction } from "./savedGridModel";

const L = glass.likes;
const OPAQUE = ANDROID_GLASS_USES_OPAQUE_FALLBACK;

/** The subset of a saved card this component reads. */
export interface SavedGridCardData {
  id: string;
  title: string;
  category?: string;
  image?: string;
  images?: string[];
  rating?: number;
  travelTime?: string;
  priceRange?: string;
  source?: "solo" | "collaboration";
  sessionName?: string;
  openingHours?: unknown;
  utcOffsetMinutes?: number | null;
  utc_offset_minutes?: number | null;
  // Present on curated plans / brand events; read defensively.
  subtitle?: unknown;
  stops?: unknown;
  coverMediaUrl?: unknown;
  coverMediaType?: unknown;
  masterDateUtc?: unknown;
  masterEndAtUtc?: unknown;
  timezone?: unknown;
  estimatedDurationMinutes?: unknown;
  totalPriceMin?: unknown;
  totalPriceMax?: unknown;
}

export interface SavedGridCardProps {
  card: SavedGridCardData;
  width: number;
  primaryAction: SavedPrimaryAction;
  /** A curated plan (stops, no brand). */
  isCurated: boolean;
  /** A brand-authored event. */
  isBrandExperience: boolean;
  /** "Sat 12 PM" when the card is in the calendar and the date is known. */
  scheduledLabel: string | null;
  isScheduling: boolean;
  currencyCode: string;
  reduceMotion: boolean;
  /** All callbacks carry the card id; SavedTab resolves it to its own card. */
  onOpen: (cardId: string) => void;
  onPrimary: (cardId: string, action: SavedPrimaryAction) => void;
  onShare: (cardId: string) => void;
  onRemove: (cardId: string) => void;
  onLongPress: (cardId: string) => void;
}

interface CuratedStopLike {
  placeName?: string;
  imageUrl?: string;
  rating?: number;
}

function stopsOf(card: SavedGridCardData): CuratedStopLike[] {
  return Array.isArray(card.stops) ? (card.stops as CuratedStopLike[]) : [];
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** The best cover we have, in the order each card type owns it. */
export function savedGridCoverUrl(card: SavedGridCardData, isBrandExperience: boolean): string | null {
  if (isBrandExperience && card.coverMediaType !== "video") {
    const cover = str(card.coverMediaUrl);
    if (cover) return cover;
  }
  return (
    str(card.image) ??
    (Array.isArray(card.images) ? str(card.images[0]) : null) ??
    str(stopsOf(card)[0]?.imageUrl) ??
    null
  );
}

type TFn = (key: string, options?: Record<string, unknown>) => string;

function curatedDurationLabel(card: SavedGridCardData): string | null {
  const total = typeof card.estimatedDurationMinutes === "number" ? card.estimatedDurationMinutes : 0;
  if (total <= 0) return null;
  const hrs = Math.floor(total / 60);
  const mins = total % 60;
  return hrs > 0 ? `${hrs}h${mins > 0 ? ` ${mins}min` : ""}` : `${mins}min`;
}

/**
 * The one facts line under the title. Missing facts are left out, never
 * guessed (Constitution #9).
 */
export function buildSavedGridFacts(
  card: SavedGridCardData,
  opts: {
    t: TFn;
    isCurated: boolean;
    isBrandExperience: boolean;
    isEnded: boolean;
    currencyCode: string;
  },
): string {
  const { t } = opts;
  if (opts.isEnded) return t("activity:savedTab.eventEnded");
  const parts: string[] = [];

  if (card.source === "collaboration" && str(card.sessionName)) {
    parts.push(t("activity:savedTab.fromSession", { name: card.sessionName }));
  }

  if (opts.isBrandExperience) {
    if (str(card.masterDateUtc)) {
      parts.push(
        formatEventDateChip({
          masterDateUtc: card.masterDateUtc as string,
          masterEndAtUtc: (str(card.masterEndAtUtc) as string | null) ?? null,
          timezone: str(card.timezone) ?? "UTC",
        }),
      );
    }
    const venue = str(stopsOf(card)[0]?.placeName);
    if (venue) parts.push(venue);
    return parts.join(" · ");
  }

  if (opts.isCurated) {
    const stops = stopsOf(card);
    const rated = stops.filter((s) => typeof s.rating === "number" && s.rating > 0);
    if (rated.length > 0) {
      parts.push((rated.reduce((sum, s) => sum + (s.rating as number), 0) / rated.length).toFixed(1));
    }
    const duration = curatedDurationLabel(card);
    if (duration) parts.push(duration);
    const min = typeof card.totalPriceMin === "number" ? card.totalPriceMin : 0;
    const max = typeof card.totalPriceMax === "number" ? card.totalPriceMax : 0;
    parts.push(
      min === 0 && max === 0
        ? t("common:free")
        : `${formatCurrency(min, opts.currencyCode)}–${formatCurrency(max, opts.currencyCode)}`,
    );
    return parts.join(" · ");
  }

  // ORCH-1195: closed RIGHT NOW is information, not a gate — the Schedule
  // button stays enabled and the chosen time is validated when it is picked.
  const openNow = isPlaceOpenNow(
    extractWeekdayText(card.openingHours as Parameters<typeof extractWeekdayText>[0]),
    card.utcOffsetMinutes ?? card.utc_offset_minutes ?? null,
  );
  if (openNow === false) parts.unshift(t("activity:savedTab.closedNow"));
  if (card.rating != null && Number(card.rating) > 0) parts.push(Number(card.rating).toFixed(1));
  if (str(card.travelTime) && card.travelTime !== "0 min") parts.push(card.travelTime as string);
  if (str(card.priceRange)) parts.push(card.priceRange as string);
  return parts.join(" · ");
}

export function savedGridKindLabel(
  card: SavedGridCardData,
  opts: { t: TFn; isCurated: boolean; isBrandExperience: boolean },
): string {
  if (opts.isBrandExperience) return opts.t("activity:savedTab.kindEvent");
  if (opts.isCurated) return opts.t("activity:savedTab.kindPlan", { count: stopsOf(card).length });
  return (
    str(card.subtitle) ??
    (getReadableCategoryName(card.category ?? "") || null) ??
    opts.t("activity:savedTab.kindPlace")
  );
}

function SavedGridCardImpl({
  card,
  width,
  primaryAction,
  isCurated,
  isBrandExperience,
  scheduledLabel,
  isScheduling,
  currencyCode,
  reduceMotion,
  onOpen,
  onPrimary,
  onShare,
  onRemove,
  onLongPress,
}: SavedGridCardProps): React.ReactElement {
  const { t } = useTranslation(["activity", "common"]);
  const isEnded = primaryAction === "findSimilar";

  // The design asks for the existing 384 px `_thumb.jpg` here (Supabase image
  // transformations are barred by the spend-cap hold). A place with no thumb
  // yet falls back to its original on the first load error.
  const coverUrl = savedGridCoverUrl(card, isBrandExperience);
  const thumb = resolvePlacePhotoThumbSource(coverUrl);
  const [useFallback, setUseFallback] = useState(false);
  const imageUri = useFallback && thumb?.fallbackUri ? thumb.fallbackUri : (thumb?.uri ?? coverUrl);
  const handleImageError = useCallback(() => {
    if (thumb?.fallbackUri) setUseFallback(true);
  }, [thumb?.fallbackUri]);

  const kind = savedGridKindLabel(card, { t, isCurated, isBrandExperience });
  const facts = buildSavedGridFacts(card, { t, isCurated, isBrandExperience, isEnded, currencyCode });
  const title = card.title?.trim() || stopsOf(card).map((s) => s.placeName).filter(Boolean).join(" → ");

  const cardId = card.id;
  const open = useCallback(() => {
    HapticFeedback.light();
    onOpen(cardId);
  }, [cardId, onOpen]);
  const longPress = useCallback(() => {
    HapticFeedback.longPress();
    onLongPress(cardId);
  }, [cardId, onLongPress]);
  const remove = useCallback(() => {
    HapticFeedback.light();
    onRemove(cardId);
  }, [cardId, onRemove]);
  const share = useCallback(() => {
    HapticFeedback.light();
    onShare(cardId);
  }, [cardId, onShare]);
  const primary = useCallback(() => {
    HapticFeedback.light();
    onPrimary(cardId, primaryAction);
  }, [cardId, onPrimary, primaryAction]);
  const onA11yAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === "longpress") onLongPress(cardId);
    },
    [cardId, onLongPress],
  );

  const quiet = primaryAction === "inCalendar" || primaryAction === "findSimilar";
  const primaryDisabled = primaryAction === "inCalendar" || isScheduling;
  const primaryLabel =
    primaryAction === "tickets"
      ? t("activity:savedTab.tickets")
      : primaryAction === "inCalendar"
        ? t("activity:savedTab.inCalendar")
        : primaryAction === "findSimilar"
          ? t("activity:savedTab.findSimilar")
          : t("activity:savedTab.schedule");
  const primaryA11y =
    primaryAction === "tickets"
      ? t("activity:savedTab.a11yTickets", { title })
      : primaryAction === "inCalendar"
        ? t("activity:savedTab.a11yInCalendar", { title })
        : primaryAction === "findSimilar"
          ? t("activity:savedTab.a11yFindSimilar", { title })
          : t("activity:savedTab.a11ySchedule", { title });
  const primaryIcon =
    primaryAction === "tickets" ? "ticket-outline" : primaryAction === "findSimilar" ? null : "calendar";

  const a11yActions = [{ name: "longpress", label: t("activity:savedTab.a11yMoreHint") }];

  return (
    <View style={[styles.root, { width }, isEnded && styles.ended]}>
      <View style={styles.photoFrame}>
        <Pressable
          onPress={open}
          onLongPress={longPress}
          delayLongPress={350}
          style={styles.photo}
          accessibilityRole="button"
          accessibilityLabel={t("activity:savedTab.a11yOpen", { title })}
          accessibilityHint={t("activity:savedTab.a11yMoreHint")}
          accessibilityActions={a11yActions}
          onAccessibilityAction={onA11yAction}
        >
          {imageUri ? (
            <ExpoImage
              source={{ uri: imageUri }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={card.id}
              transition={reduceMotion ? 0 : L.card.imageFadeMs}
              onError={handleImageError}
              accessible={false}
            />
          ) : null}
          <LinearGradient
            pointerEvents="none"
            colors={[L.card.scrimTop, L.card.scrimBottom]}
            style={styles.scrim}
          />
          <View pointerEvents="none" style={styles.kindChip}>
            <Text style={styles.kindChipText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {kind}
            </Text>
          </View>
          {scheduledLabel ? (
            <View pointerEvents="none" style={styles.dateChip}>
              <Icon name="checkmark" size={14} color={L.textPrimary} strokeWidth={2.4} />
              <Text style={styles.dateChipText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {scheduledLabel}
              </Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          onPress={remove}
          style={styles.heartHit}
          accessibilityRole="button"
          accessibilityLabel={t("activity:savedTab.a11yRemove", { title })}
        >
          <View style={styles.heartCircle}>
            <Heart size={16} color={L.accent} fill={L.accent} strokeWidth={2} />
          </View>
        </Pressable>
      </View>

      <Pressable
        onPress={open}
        onLongPress={longPress}
        delayLongPress={350}
        style={styles.textBlock}
        accessibilityRole="button"
        accessibilityLabel={facts ? `${title}. ${facts}` : title}
        accessibilityHint={t("activity:savedTab.a11yMoreHint")}
        accessibilityActions={a11yActions}
        onAccessibilityAction={onA11yAction}
      >
        <Text style={styles.title} numberOfLines={2} maxFontSizeMultiplier={1.6}>
          {title}
        </Text>
        {facts ? (
          <Text style={styles.facts} numberOfLines={1} maxFontSizeMultiplier={1.6}>
            {facts}
          </Text>
        ) : null}
      </Pressable>

      <View style={styles.actions}>
        <Pressable
          onPress={primary}
          disabled={primaryDisabled}
          hitSlop={{ top: 2, bottom: 2 }}
          style={({ pressed }) => [
            styles.primary,
            quiet ? styles.primaryQuiet : styles.primaryLoud,
            pressed && !primaryDisabled && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={primaryA11y}
          accessibilityState={{ disabled: primaryDisabled, busy: isScheduling }}
        >
          {isScheduling ? (
            <ActivityIndicator size="small" color={L.textPrimary} />
          ) : (
            <>
              {primaryIcon ? <Icon name={primaryIcon} size={15} color={L.textPrimary} strokeWidth={2} /> : null}
              <Text style={styles.primaryText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {primaryLabel}
              </Text>
            </>
          )}
        </Pressable>
        <Pressable
          onPress={share}
          hitSlop={{ top: 2, bottom: 2, left: 2, right: 2 }}
          style={({ pressed }) => [styles.share, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t("activity:savedTab.a11yShare", { title })}
        >
          <Icon name="share-outline" size={17} color={L.textPrimary} strokeWidth={2} />
        </Pressable>
      </View>
    </View>
  );
}

export const SavedGridCard = React.memo(SavedGridCardImpl);

const styles = StyleSheet.create({
  root: {
    gap: 8,
  },
  ended: {
    opacity: L.card.endedOpacity,
  },
  photoFrame: {
    position: "relative",
  },
  photo: {
    aspectRatio: L.card.photoAspectRatio,
    borderRadius: L.card.photoRadius,
    overflow: "hidden",
    backgroundColor: OPAQUE ? L.card.photoPlaceholderOpaque : L.card.photoPlaceholder,
  },
  scrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "40%",
  },
  kindChip: {
    position: "absolute",
    left: 8,
    top: 8,
    maxWidth: "70%",
    minHeight: L.card.chipHeight,
    paddingHorizontal: 8,
    borderRadius: 999,
    justifyContent: "center",
    backgroundColor: OPAQUE ? L.card.chipBgOpaque : L.card.chipBg,
  },
  kindChipText: {
    color: L.textPrimary,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  dateChip: {
    position: "absolute",
    left: 8,
    bottom: 8,
    maxWidth: "85%",
    minHeight: L.card.dateChipHeight,
    paddingLeft: 6,
    paddingRight: 8,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: L.accent,
  },
  dateChipText: {
    color: L.textPrimary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    flexShrink: 1,
  },
  heartHit: {
    position: "absolute",
    right: 4,
    top: 4,
    width: L.card.hitTarget,
    height: L.card.hitTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  heartCircle: {
    width: L.card.heartCircle,
    height: L.card.heartCircle,
    borderRadius: L.card.heartCircle / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OPAQUE ? L.card.chipBgOpaque : L.card.chipBg,
  },
  textBlock: {
    gap: 2,
    paddingHorizontal: 2,
  },
  title: {
    color: L.textPrimary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
  },
  facts: {
    color: L.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
  },
  primary: {
    flex: 1,
    minWidth: 0,
    minHeight: L.card.buttonHeight,
    borderRadius: L.card.buttonRadius,
    borderWidth: 1,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  primaryLoud: {
    backgroundColor: L.accent,
    borderColor: L.accent,
  },
  primaryQuiet: {
    backgroundColor: OPAQUE ? L.card.quietFillOpaque : L.card.quietFill,
    borderColor: L.card.quietBorder,
  },
  primaryText: {
    color: L.textPrimary,
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  share: {
    width: L.card.buttonHeight,
    minHeight: L.card.buttonHeight,
    borderRadius: L.card.buttonRadius,
    borderWidth: 1,
    borderColor: L.card.quietBorder,
    backgroundColor: OPAQUE ? L.card.quietFillOpaque : L.card.quietFill,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.8,
  },
});
