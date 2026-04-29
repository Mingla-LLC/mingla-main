import React, { useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Animated,
  Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Calendar from "expo-calendar";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { ExpandedCardData } from "../../types/expandedCardTypes";
import { formatPriceRange } from "../utils/formatters";
import { glass, radius, spacing } from "../../constants/designSystem";
import { colors } from "../../constants/colors";
import { toastManager } from "../ui/Toast";
import { parseEventDateTime } from "../../utils/parseEventDateTime";

interface EventDetailLayoutProps {
  card: ExpandedCardData;
  nightOut: NonNullable<ExpandedCardData["nightOutData"]>;
  isSaved: boolean;
  onSave: (card: ExpandedCardData) => Promise<void> | void;
  onShare?: (card: ExpandedCardData) => void;
  onClose: () => void;
  onOpenBrowser: (url: string, title: string) => void;
  accountPreferences?: {
    currency?: string;
    measurementSystem?: "Metric" | "Imperial";
  };
  seatMapFailed: boolean;
  setSeatMapFailed: (failed: boolean) => void;
  openDirections: () => void;
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
  onClose,
  onOpenBrowser,
  accountPreferences,
  seatMapFailed,
  setSeatMapFailed,
  openDirections,
}: EventDetailLayoutProps): React.ReactElement {
  const { t } = useTranslation(["cards", "common"]);
  const insets = useSafeAreaInsets();
  const [aboutCollapsed, setAboutCollapsed] = useState(true);
  const saveBounceScale = useRef(new Animated.Value(1)).current;

  const eventName = nightOut.eventName || card.title;
  const heroSource = card.image || (card.images && card.images[0]) || null;
  const isOnsale = nightOut.ticketStatus === "onsale";
  const isOffsale = nightOut.ticketStatus === "offsale";
  const hasTicketUrl = !!nightOut.ticketUrl;
  // Presale + TBA derived from absence of an active onsale URL
  const isTba = !isOnsale && !isOffsale && !hasTicketUrl;
  const isPresale = !isOnsale && !isOffsale && hasTicketUrl;

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

  const handleGetTickets = (): void => {
    if (isOnsale && hasTicketUrl) {
      onOpenBrowser(nightOut.ticketUrl, `Tickets – ${eventName}`);
    }
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

  const ctaLabel = isOnsale && hasTicketUrl
    ? t("cards:expanded.get_tickets", {
        price: formatPriceRange(nightOut.price, accountPreferences?.currency),
      })
    : isOffsale
    ? t("cards:expanded.sold_out")
    : isTba
    ? t("cards:expanded.tickets_tba")
    : t("cards:expanded.tickets_coming_soon");

  const ctaBg = isOnsale && hasTicketUrl
    ? colors.primary
    : isOffsale
    ? "rgba(102, 102, 102, 1)"
    : "#F59E0B"; // amber for presale/TBA

  return (
    <View style={styles.container}>
      {/* Hero poster + genre chip overlay */}
      <View style={styles.heroWrap}>
        {heroSource ? (
          <Image
            source={{ uri: heroSource }}
            style={styles.heroPoster}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.heroPoster, styles.heroPlaceholder]}>
            <Icon name="musical-notes" size={48} color="rgba(255,255,255,0.30)" />
          </View>
        )}
        <LinearGradient
          colors={["rgba(0,0,0,0)", "rgba(12,14,18,0.95)"]}
          style={styles.heroGradient}
          pointerEvents="none"
        />
        {(nightOut.genre || nightOut.subGenre) && (
          <View style={styles.genreChip}>
            <Text style={styles.genreChipText} numberOfLines={1}>
              {nightOut.genre}
              {nightOut.subGenre ? ` · ${nightOut.subGenre}` : ""}
            </Text>
          </View>
        )}
      </View>

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

      {/* Get Tickets CTA */}
      <TouchableOpacity
        style={[styles.cta, { backgroundColor: ctaBg }]}
        activeOpacity={isOnsale && hasTicketUrl ? 0.85 : 1}
        onPress={handleGetTickets}
        disabled={!isOnsale || !hasTicketUrl}
        accessibilityRole="button"
        accessibilityLabel={ctaLabel}
        accessibilityState={{ disabled: !isOnsale || !hasTicketUrl }}
      >
        {isOnsale && hasTicketUrl && (
          <Icon name="ticket-outline" size={18} color={colors.white} />
        )}
        <Text
          style={styles.ctaText}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {ctaLabel}
        </Text>
      </TouchableOpacity>

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
              size={18}
              color={isSaved ? colors.primary : colors.white}
            />
          </Animated.View>
          <Text style={styles.secondaryChipText}>
            {isSaved
              ? t("cards:expanded.saved")
              : t("cards:expanded.save")}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryChip}
          activeOpacity={0.7}
          onPress={handleSharePress}
          accessibilityRole="button"
          accessibilityLabel={t("cards:expanded.share")}
        >
          <Icon name="share-outline" size={18} color={colors.white} />
          <Text style={styles.secondaryChipText}>
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
            <Icon name="calendar-outline" size={18} color={colors.white} />
            <Text style={styles.secondaryChipText}>
              {t("cards:expanded.add_to_calendar")}
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
            >
              <Text style={styles.moreToggle}>
                {aboutCollapsed
                  ? t("cards:expanded.show_more")
                  : t("cards:expanded.show_less")}
              </Text>
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
  heroWrap: {
    width: "100%",
    aspectRatio: 16 / 9,
    maxHeight: 240,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: glass.surfaceDark.backgroundColor,
  },
  heroPoster: {
    ...StyleSheet.absoluteFillObject,
  },
  heroPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  heroGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "60%",
  },
  genreChip: {
    position: "absolute",
    left: 12,
    bottom: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(12, 14, 18, 0.42)",
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
  ctaText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.white,
    flexShrink: 1,
  },
  secondaryRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: spacing.sm,
  },
  secondaryChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 40,
    gap: 6,
    backgroundColor: glass.surfaceDark.backgroundColor,
    borderColor: glass.surfaceDark.borderColor,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  secondaryChipText: {
    fontSize: 14,
    fontWeight: "500",
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
  moreToggle: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.primary,
    marginTop: 6,
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
