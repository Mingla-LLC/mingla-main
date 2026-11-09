import React, { useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Animated,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Calendar from "expo-calendar";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { ExpandedCardData } from "../../types/expandedCardTypes";
import { formatDisplayPrice } from "../utils/formatters";
import { glass, radius, spacing } from "../../constants/designSystem";
import { colors } from "../../constants/colors";
import { toastManager } from "../ui/Toast";
import { parseEventDateTime } from "../../utils/parseEventDateTime";
import { PlaceGallery } from "./PlaceGallery";
import { lightboxFor, sheetGalleryMedia } from "./placeSheetModel";

interface EventDetailLayoutProps {
  card: ExpandedCardData;
  nightOut: NonNullable<ExpandedCardData["nightOutData"]>;
  isSaved: boolean;
  onSave: (card: ExpandedCardData) => Promise<void> | void;
  onShare?: (card: ExpandedCardData) => void;
  shareBusy?: boolean;
  shareControlRef?: React.Ref<View>;
  onClose: () => void;
  onOpenBrowser: (url: string, title: string) => void;
  accountPreferences?: {
    currency?: string;
    measurementSystem?: "Metric" | "Imperial";
  };
  seatMapFailed: boolean;
  setSeatMapFailed: (failed: boolean) => void;
  openDirections: () => void;
  /** #4347 wave 2 — the gallery opens the sheet's ImageLightbox. */
  onOpenLightbox?: (images: string[], initialIndex: number) => void;
}

/**
 * #4347 wave 2 — the Get Tickets CTA, ONE derivation for the pinned bar. The
 * status rules are unchanged (onsale + url -> primary with the converted
 * price; offsale -> Sold out; TBA; presale / coming soon), they just moved out
 * of the scrolling body into the sheet's pinned footer.
 */
export function nightOutTicketCta(
  card: ExpandedCardData,
  nightOut: NonNullable<ExpandedCardData["nightOutData"]>,
  viewerCurrency: string | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): { label: string; background: string; enabled: boolean; eventName: string } {
  const eventName = nightOut.eventName || card.title;
  const isOnsale = nightOut.ticketStatus === "onsale";
  const isOffsale = nightOut.ticketStatus === "offsale";
  const hasTicketUrl = !!nightOut.ticketUrl;
  const isTba = !isOnsale && !isOffsale && !hasTicketUrl;
  const priceLabel: string =
    typeof nightOut.priceMinMajor === "number" && typeof nightOut.priceCurrency === "string"
      ? formatDisplayPrice({
          min: nightOut.priceMinMajor,
          max: nightOut.priceMaxMajor ?? null,
          sourceCurrency: nightOut.priceCurrency,
          viewerCurrency,
        })?.text ?? nightOut.price
      : nightOut.price;
  const enabled = isOnsale && hasTicketUrl;
  const label = enabled
    ? t("cards:expanded.get_tickets", { price: priceLabel })
    : isOffsale
    ? t("cards:expanded.sold_out")
    : isTba
    ? t("cards:expanded.tickets_tba")
    : t("cards:expanded.tickets_coming_soon");
  const background = enabled ? colors.primary : isOffsale ? "rgba(102, 102, 102, 1)" : "#F59E0B";
  return { label, background, enabled, eventName };
}

/** #4347 wave 2 — the night out's pinned "Get tickets" bar (BaseBottomSheet stickyFooter). */
export function NightOutTicketBar({
  card,
  nightOut,
  viewerCurrency,
  onOpenBrowser,
  bottomInset,
}: {
  card: ExpandedCardData;
  nightOut: NonNullable<ExpandedCardData["nightOutData"]>;
  viewerCurrency?: string;
  onOpenBrowser: (url: string, title: string) => void;
  bottomInset: number;
}): React.ReactElement {
  const { t } = useTranslation(["cards", "common"]);
  const cta = nightOutTicketCta(card, nightOut, viewerCurrency, t);
  return (
    <View style={[styles.ticketBar, { paddingBottom: Math.max(bottomInset, 12) }]} testID="sheet-ticket-bar">
      <TouchableOpacity
        style={[styles.cta, styles.ctaPinned, { backgroundColor: cta.background }]}
        activeOpacity={cta.enabled ? 0.85 : 1}
        onPress={() => {
          if (cta.enabled) onOpenBrowser(nightOut.ticketUrl, `Tickets – ${cta.eventName}`);
        }}
        disabled={!cta.enabled}
        accessibilityRole="button"
        accessibilityLabel={cta.label}
        accessibilityState={{ disabled: !cta.enabled }}
      >
        {cta.enabled && <Icon name="ticket-outline" size={18} color={colors.white} />}
        <Text style={styles.ctaText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          {cta.label}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/**
 * [ORCH-0696 S-2 lock-in] Event-shaped detail layout for the bottom-sheet
 * ExpandedCardModal. Mounted when `card.nightOutData != null` OR
 * `card.cardType === 'event'`. Place IA stays in the place fallback branch.
 *
 * Layout per design §E-5:
 *   • Above-fold (peek 50%): hero poster + genre chip + title + artist +
 *     meta row + Get Tickets CTA + secondary action row
 *   • Below-fold (expanded 90%): About / When & Where / Tags / Seat Map
 *
 * Status-aware Get Tickets CTA per design §E-5.6:
 *   onsale → primary orange + price label
 *   offsale → disabled gray + "Sold Out"
 *   presale → amber + "Presale Opens" (if presaleDate available)
 *   TBA (no ticketUrl) → amber + "Tickets TBA"
 */
export default function EventDetailLayout({
  card,
  nightOut,
  isSaved,
  onSave,
  onShare,
  shareBusy = false,
  shareControlRef = undefined,
  onClose,
  onOpenBrowser,
  accountPreferences,
  seatMapFailed,
  setSeatMapFailed,
  openDirections,
  onOpenLightbox,
}: EventDetailLayoutProps): React.ReactElement {
  const { t } = useTranslation(["cards", "common"]);
  const insets = useSafeAreaInsets();
  const [aboutCollapsed, setAboutCollapsed] = useState(true);
  const saveBounceScale = useRef(new Animated.Value(1)).current;

  const eventName = nightOut.eventName || card.title;
  const eventMedia = sheetGalleryMedia(card.images, card.image);
  const isOnsale = nightOut.ticketStatus === "onsale";
  const isOffsale = nightOut.ticketStatus === "offsale";
  const hasTicketUrl = !!nightOut.ticketUrl;
  // Presale + TBA derived from absence of an active onsale URL
  const isTba = !isOnsale && !isOffsale && !hasTicketUrl;

  const handleSavePress = async (): Promise<void> => {
    Animated.sequence([
      Animated.spring(saveBounceScale, {
        toValue: 1.18,
        useNativeDriver: true,
        damping: 12,
        stiffness: 280,
      }),
      Animated.spring(saveBounceScale, {
        toValue: 1.0,
        useNativeDriver: true,
        damping: 12,
        stiffness: 280,
      }),
    ]).start();
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      // Haptics unavailable — swallow silently
    }
    try {
      await onSave(card);
    } catch (err) {
      // Toast surface is owned by mount-site onSave handler — implementor
      // policy is to let parent surface failures; we rethrow nothing here.
    }
  };

  const handleSharePress = (): void => {
    onShare?.(card);
  };

  const handleAddToCalendar = async (): Promise<void> => {
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          t("cards:expanded.calendar_permission_title"),
          t("cards:expanded.calendar_permission_body")
        );
        return;
      }
      const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const defaultCal = cals.find(
        (c) => c.allowsModifications && c.source.name !== "Subscribed Calendars"
      );
      if (!defaultCal) {
        Alert.alert(t("cards:expanded.calendar_unavailable"), "");
        return;
      }
      const startDate = parseEventDateTime(nightOut.date, nightOut.time);
      if (!startDate) {
        Alert.alert(t("cards:expanded.calendar_date_parse_error"), "");
        return;
      }
      const endDate = new Date(startDate.getTime() + 3 * 60 * 60 * 1000);
      await Calendar.createEventAsync(defaultCal.id, {
        title: eventName,
        startDate,
        endDate,
        location: `${nightOut.venueName}${card.address ? ", " + card.address : ""}`,
        notes: nightOut.artistName ? `Artist: ${nightOut.artistName}` : undefined,
      });
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        // Haptics unavailable
      }
      toastManager.success(t("cards:expanded.calendar_added"), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[EventDetailLayout] Add to Calendar failed:", message);
      toastManager.error(t("cards:expanded.calendar_error"), 3000);
    }
  };

  return (
    <View style={styles.container}>
      {/* #4347 wave 2 — GALLERY FIRST: every photo, swipeable, opens the lightbox. */}
      <View style={styles.galleryBleed}>
      <PlaceGallery
        media={eventMedia}
        title={eventName}
        onOpen={(uri) => {
          const target = lightboxFor(eventMedia, eventMedia.findIndex((m) => m.uri === uri));
          if (target.images.length > 0) onOpenLightbox?.(target.images, target.initialIndex);
        }}
      />
      </View>
      {(nightOut.genre || nightOut.subGenre) && (
        <View style={styles.genreChipFlow}>
          <Text style={styles.genreChipText} numberOfLines={1}>
            {nightOut.genre}
            {nightOut.subGenre ? ` · ${nightOut.subGenre}` : ""}
          </Text>
        </View>
      )}

      {/* Title */}
      <Text
        style={styles.title}
        numberOfLines={3}
        accessibilityRole="header"
      >
        {eventName}
      </Text>

      {/* Artist */}
      {nightOut.artistName && (
        <Text style={styles.artist} numberOfLines={1}>
          {nightOut.artistName}
        </Text>
      )}

      {/* Meta row: Venue · Date · Time */}
      <Text style={styles.metaRow} numberOfLines={2} ellipsizeMode="tail">
        {[nightOut.venueName, nightOut.date, nightOut.time]
          .filter(Boolean)
          .join(" · ")}
      </Text>

      {/* #4347 wave 2 — Get Tickets moved to the sheet's pinned bar (NightOutTicketBar). */}

      {/* Secondary action row */}
      <View style={styles.secondaryRow}>
        <TouchableOpacity
          style={styles.secondaryChip}
          activeOpacity={0.7}
          onPress={handleSavePress}
          accessibilityRole="button"
          accessibilityLabel={
            isSaved
              ? t("cards:expanded.saved")
              : t("cards:expanded.save")
          }
          accessibilityState={{ selected: isSaved }}
        >
          <Animated.View style={{ transform: [{ scale: saveBounceScale }] }}>
            <Icon
              name={isSaved ? "bookmark" : "bookmark-outline"}
              size={16}
              color={isSaved ? colors.primary : colors.white}
            />
          </Animated.View>
          <Text
            style={styles.secondaryChipText}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
          >
            {isSaved
              ? t("cards:expanded.saved")
              : t("cards:expanded.save")}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          ref={shareControlRef}
          style={styles.secondaryChip}
          activeOpacity={0.7}
          onPress={handleSharePress}
          disabled={shareBusy}
          accessibilityRole="button"
          accessibilityLabel={t("cards:expanded.share")}
          accessibilityState={shareBusy ? { disabled: true, busy: true } : undefined}
        >
          {shareBusy ? (
            <ActivityIndicator size={16} color={colors.white} />
          ) : (
            <Icon name="share-outline" size={16} color={colors.white} />
          )}
          <Text
            style={styles.secondaryChipText}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
          >
            {t("cards:expanded.share")}
          </Text>
        </TouchableOpacity>

        {!isTba && (
          <TouchableOpacity
            style={styles.secondaryChip}
            activeOpacity={0.7}
            onPress={handleAddToCalendar}
            accessibilityRole="button"
            accessibilityLabel={t("cards:expanded.add_to_calendar")}
          >
            <Icon name="calendar-outline" size={16} color={colors.white} />
            <Text
              style={styles.secondaryChipText}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {t("cards:expanded.calendar")}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* About */}
      {card.description && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t("cards:expanded.about")}
          </Text>
          <Text
            style={styles.body}
            numberOfLines={aboutCollapsed ? 3 : undefined}
          >
            {card.description}
          </Text>
          {card.description.length > 160 && (
            <TouchableOpacity
              onPress={() => setAboutCollapsed((c) => !c)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ expanded: !aboutCollapsed }}
              accessibilityHint={
                aboutCollapsed
                  ? "Expands the description"
                  : "Collapses the description"
              }
              style={styles.moreToggleRow}
            >
              {/* ORCH-1117 — standardized copy ("Read more"/"Show less") +
                  chevron glyph. EXTERNAL event detail (F-A) gets only this
                  copy/chevron standardization — no Mingla floating Buy bar. */}
              <Text style={styles.moreToggle}>
                {aboutCollapsed ? "Read more" : "Show less"}
              </Text>
              <Icon
                name={aboutCollapsed ? "chevron-down" : "chevron-up"}
                size={16}
                color={colors.primary}
              />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* When & Where */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {t("cards:expanded.when_and_where")}
        </Text>
        <View style={styles.metaItem}>
          <Icon name="calendar-outline" size={18} color={colors.primary} />
          <View style={styles.metaItemBody}>
            <Text style={styles.body}>{nightOut.date}</Text>
            {nightOut.time && (
              <Text style={styles.bodyMuted}>{nightOut.time}</Text>
            )}
          </View>
        </View>
        <TouchableOpacity
          style={styles.metaItem}
          onPress={openDirections}
          activeOpacity={0.7}
          accessibilityRole="link"
          accessibilityLabel={`${t("cards:expanded.open_in_maps")}: ${nightOut.venueName}`}
        >
          <Icon name="location-outline" size={18} color={colors.primary} />
          <View style={styles.metaItemBody}>
            <Text style={styles.body}>{nightOut.venueName}</Text>
            {card.address && (
              <Text style={styles.bodyMuted}>{card.address}</Text>
            )}
            <Text style={styles.linkText}>
              {t("cards:expanded.open_in_maps")}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Tags */}
      {nightOut.tags && nightOut.tags.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t("cards:expanded.tags")}
          </Text>
          <View style={styles.tagsRow}>
            {nightOut.tags.map((tag, i) => (
              <View key={`${tag}-${i}`} style={styles.tagChip}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Seat Map */}
      {nightOut.seatMapUrl && !seatMapFailed && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t("cards:expanded.seat_map")}
          </Text>
          <Image
            source={{ uri: nightOut.seatMapUrl }}
            style={styles.seatMap}
            resizeMode="contain"
            onError={() => setSeatMapFailed(true)}
          />
        </View>
      )}

      <View style={{ height: insets.bottom + 16 }} />
    </View>
  );
}

const SECTION_DIVIDER_COLOR = "rgba(255, 255, 255, 0.10)";

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  galleryBleed: {
    marginHorizontal: -spacing.md,
    marginTop: -spacing.sm,
  },
  genreChipFlow: {
    alignSelf: "flex-start",
    marginTop: spacing.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(255, 255, 255, 0.10)",
    borderColor: "rgba(255, 255, 255, 0.14)",
    borderWidth: 1,
    borderRadius: 999,
  },
  genreChipText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "600",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.white,
    lineHeight: 30,
    marginTop: spacing.md,
  },
  artist: {
    fontSize: 18,
    fontWeight: "500",
    color: colors.primary,
    marginTop: 4,
  },
  metaRow: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.70)",
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 56,
    borderRadius: radius.lg,
    marginTop: spacing.md,
    gap: 8,
  },
  ctaPinned: {
    marginTop: 0,
  },
  ticketBar: {
    paddingHorizontal: spacing.md,
    paddingTop: 10,
    backgroundColor: "rgba(12, 14, 18, 1)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.12)",
  },
  ctaText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.white,
    flexShrink: 1,
  },
  secondaryRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: spacing.sm,
  },
  secondaryChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 38,
    gap: 5,
    paddingHorizontal: 6,
    backgroundColor: glass.surfaceDark.backgroundColor,
    borderColor: glass.surfaceDark.borderColor,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  secondaryChipText: {
    flexShrink: 1,
    minWidth: 0,
    textAlign: "center",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.2,
    color: colors.white,
  },
  section: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: SECTION_DIVIDER_COLOR,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.white,
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.80)",
    lineHeight: 20,
  },
  bodyMuted: {
    fontSize: 13,
    color: "rgba(255, 255, 255, 0.60)",
    marginTop: 2,
  },
  linkText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.primary,
    marginTop: 4,
  },
  moreToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
    minHeight: 44,
  },
  moreToggle: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.primary,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: spacing.md,
  },
  metaItemBody: {
    flex: 1,
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tagChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: glass.surfaceDark.backgroundColor,
    borderColor: glass.surfaceDark.borderColor,
    borderWidth: 1,
    borderRadius: 999,
  },
  tagText: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.white,
  },
  seatMap: {
    width: "100%",
    height: 200,
    borderRadius: 12,
    backgroundColor: glass.surfaceDark.backgroundColor,
  },
});
