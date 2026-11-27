/**
 * #4630 — the brand chat's banner, directly under the header (where #4114's
 * "Next up" banner sat before #4475 removed it with the fold).
 *
 * One state at a time (brandChatBannerModel): your booking today, your next
 * booking (one or several, with "Your ticket" and "+N more"), the brand's next
 * offering when you hold none, a quiet "View <Brand>" line when nothing is
 * coming up, or a retry line when the read failed. Hidden while loading, in a
 * Removed chat and for a non-member. Fixed: it never scrolls away or dismisses.
 *
 * No dead taps: a control whose route needs a slug that is missing is not
 * drawn, and the row becomes plain text.
 */
import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { Icon } from "../ui/Icon";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import { chatTokens } from "../../constants/chatTokens";
import { spacing } from "../../constants/designSystem";
import { chatKeys } from "../../hooks/queryKeys";
import { useA11yPreferences } from "../../hooks/useA11yPreferences";
import { messagingService } from "../../services/messagingService";
import {
  BRAND_CHAT_MORE_HREF,
  brandChatBannerState,
  formatBannerDate,
  formatBannerTime,
  type BrandChatBannerState,
  type BrandChatSummary,
} from "./brandChatBannerModel";

/** Under this window width the thumbnail is hidden (design D9). */
const THUMB_MIN_WINDOW_WIDTH = 360;
const ENTER_MS = 150;
/** "+N more" hit area overlaps the ticket pill's by 6 pt (design). */
const MORE_HIT_OVERLAP = 6;

export interface BrandChatBannerProps {
  conversationId: string;
  /** The chat's brand name, until the summary brings the server's. */
  brandName: string;
}

export function BrandChatBanner({ conversationId, brandName }: BrandChatBannerProps): React.ReactElement | null {
  const { t, i18n } = useTranslation(["chat"]);
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { reduceMotion } = useA11yPreferences();

  const summary = useQuery<BrandChatSummary>({
    queryKey: chatKeys.brandChatSummary(conversationId),
    queryFn: async () => {
      const { data, error } = await messagingService.getMyBrandChatSummary(conversationId);
      if (error || !data) throw new Error(error ?? "brand chat summary: no data");
      return data;
    },
    enabled: Boolean(conversationId),
    staleTime: 60_000,
  });

  const state: BrandChatBannerState = useMemo(
    () => brandChatBannerState({
      summary: summary.data,
      now: new Date(),
      isLoading: summary.isPending,
      isError: summary.isError,
    }),
    [summary.data, summary.isError, summary.isPending],
  );

  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const visible = state.kind !== "hidden";
  useEffect(() => {
    if (!visible) return;
    if (reduceMotion) {
      opacity.setValue(1);
      return;
    }
    Animated.timing(opacity, { toValue: 1, duration: ENTER_MS, useNativeDriver: true }).start();
  }, [opacity, reduceMotion, visible]);

  if (state.kind === "hidden") return null;

  const brand = (summary.data?.member ? summary.data.brandName : "") || brandName;
  const go = (href: string | null) => (href ? () => router.push(href as never) : undefined);
  const pressedPill = ({ pressed }: { pressed: boolean }) => [
    pressed ? (reduceMotion ? styles.pressedOpacity : styles.pressedScale) : null,
  ];

  if (state.kind === "error") {
    const copy = t("chat:brandChatBannerError");
    return (
      <Animated.View style={[styles.host, styles.hostSlim, { opacity }]} testID="brand-chat-banner-error">
        <Pressable
          style={({ pressed }) => [styles.slimMain, pressed ? styles.pressedOpacity : null]}
          onPress={() => void summary.refetch()}
          accessibilityRole="button"
          accessibilityLabel={copy}
        >
          <Icon name="refresh" size={16} color={chatTokens.danger} />
          <Text style={[styles.slimText, styles.slimTextError]} numberOfLines={1}>{copy}</Text>
        </Pressable>
      </Animated.View>
    );
  }

  if (state.kind === "nothing_upcoming") {
    const copy = t("chat:brandChatNothingUpcoming", { brand });
    const view = t("chat:brandChatViewBrand", { brand });
    const onPress = go(state.brandHref);
    return (
      <Animated.View style={[styles.host, styles.hostSlim, { opacity }]} testID="brand-chat-banner-nothing">
        <Pressable
          style={({ pressed }) => [styles.slimMain, pressed && onPress ? styles.pressedOpacity : null]}
          onPress={onPress}
          disabled={!onPress}
          accessibilityRole={onPress ? "button" : "text"}
          accessibilityLabel={onPress ? `${copy}. ${view}` : copy}
        >
          <Icon name="storefront" size={16} color={chatTokens.textSoft} />
          <Text style={styles.slimText} numberOfLines={1}>{copy}</Text>
        </Pressable>
        {onPress ? (
          <Pressable
            style={styles.hit}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={view}
            android_ripple={{ color: chatTokens.strip, borderless: true }}
            testID="brand-chat-banner-view-brand"
          >
            {({ pressed }) => (
              <View style={[styles.viewPill, pressedPill({ pressed })]}>
                <Text style={styles.viewPillText} numberOfLines={1}>{view}</Text>
                <Icon name="chevron-forward" size={15} color={chatTokens.textPrimary} />
              </View>
            )}
          </Pressable>
        ) : null}
      </Animated.View>
    );
  }

  // The full banner: live today, next (one or several), or the brand's next offering.
  const locale = i18n.language;
  let kicker: string;
  let line: string;
  let title: string;
  let when: string;
  let cover: string | null;
  let mainHref: string | null;
  let live = false;
  if (state.kind === "next_no_ticket") {
    kicker = t("chat:brandChatBannerNextFrom", { brand });
    title = state.offering.title;
    when = formatBannerDate(state.offering.startsAt, locale);
    line = joinLine(title, when);
    cover = state.offering.coverMediaUrl;
    mainHref = state.eventHref;
  } else {
    const booking = state.booking;
    if (state.kind === "live_today") {
      live = true;
      kicker = t("chat:brandChatBannerToday");
      title = booking.title;
      when = formatBannerTime(booking.startsAt, locale);
      line = joinLine(title, when);
    } else {
      kicker = t("chat:nextUpInDays", { count: state.days });
      title = booking.title;
      when = formatBannerDate(booking.startsAt, locale);
      line = joinLine(title, when);
    }
    cover = booking.coverMediaUrl;
    mainHref = state.eventHref;
  }
  const onMain = go(mainHref);
  let ctaText = "";
  if (state.kind === "next_no_ticket") {
    switch (state.cta) {
      case "tickets":
        ctaText = t("chat:brandChatGetTickets");
        break;
      case "rsvp":
        ctaText = t("chat:brandChatRsvp");
        break;
      case "book":
        ctaText = t("chat:brandChatBook");
        break;
      default: {
        const exhaustive: never = state.cta;
        ctaText = exhaustive;
      }
    }
  }
  const ticketText = state.kind === "next_no_ticket"
    ? ""
    : state.booking.ticketCount > 1
      ? t("chat:brandChatYourTickets", { count: state.booking.ticketCount })
      : t("chat:brandChatYourTicket");
  const mainLabel = onMain ? t("chat:countdownOpenEvent", { copy: `${kicker}, ${line}` }) : `${kicker}, ${line}`;
  const showThumb = width >= THUMB_MIN_WINDOW_WIDTH;

  return (
    <Animated.View style={[styles.host, { opacity }]} testID={`brand-chat-banner-${state.kind}`}>
      <Pressable
        style={({ pressed }) => [styles.main, pressed && onMain ? styles.pressedOpacity : null]}
        onPress={onMain}
        disabled={!onMain}
        accessibilityRole={onMain ? "button" : "text"}
        accessibilityLabel={mainLabel}
        testID="brand-chat-banner-main"
      >
        {showThumb ? (
          <View style={styles.thumb}>
            {cover ? (
              <ImageWithFallback source={{ uri: cover }} style={styles.thumbImage} />
            ) : (
              <Icon name="calendar" size={18} color={chatTokens.accent} />
            )}
          </View>
        ) : null}
        <View style={styles.copy}>
          <View style={styles.kickerRow}>
            {live ? <View style={styles.liveDot} /> : null}
            <Text style={styles.kicker} numberOfLines={1} maxFontSizeMultiplier={1.3}>{kicker}</Text>
          </View>
          {/* #4630 (test P3-1): the title truncates; the date or time stays whole. */}
          <View style={styles.lineRow}>
            <Text style={[styles.line, styles.lineTitle]} numberOfLines={1} maxFontSizeMultiplier={1.3}>{title}</Text>
            {when ? (
              <Text style={[styles.line, styles.lineWhen]} numberOfLines={1} maxFontSizeMultiplier={1.3}>{` · ${when}`}</Text>
            ) : null}
          </View>
        </View>
      </Pressable>

      {state.kind === "next_no_ticket" ? (
        onMain ? (
          <Pressable
            style={styles.hit}
            onPress={onMain}
            accessibilityRole="button"
            accessibilityLabel={`${ctaText}, ${state.offering.title}`}
            android_ripple={{ color: chatTokens.strip, borderless: true }}
            testID="brand-chat-banner-cta"
          >
            {({ pressed }) => (
              <View style={[styles.ticketPill, pressedPill({ pressed })]}>
                <Text style={styles.ticketPillText} numberOfLines={1}>{ctaText}</Text>
              </View>
            )}
          </Pressable>
        ) : null
      ) : (
        <>
          <Pressable
            style={styles.hit}
            onPress={go(state.bookingHref)}
            accessibilityRole="button"
            accessibilityLabel={`${ticketText}, ${state.booking.title}`}
            android_ripple={{ color: chatTokens.strip, borderless: true }}
            testID="brand-chat-banner-ticket"
          >
            {({ pressed }) => (
              <View style={[styles.ticketPill, pressedPill({ pressed })]}>
                <Icon name="ticket-outline" size={15} color={chatTokens.accent} />
                <Text style={styles.ticketPillText} numberOfLines={1}>{ticketText}</Text>
              </View>
            )}
          </Pressable>
          {state.kind !== "next_with_ticket" && state.moreCount > 0 ? (
            <Pressable
              style={[styles.hit, styles.moreHit]}
              onPress={go(BRAND_CHAT_MORE_HREF)}
              accessibilityRole="button"
              accessibilityLabel={t("chat:brandChatMoreBookingsA11y", { count: state.moreCount })}
              android_ripple={{ color: chatTokens.strip, borderless: true }}
              testID="brand-chat-banner-more"
            >
              {({ pressed }) => (
                <View style={[styles.morePill, pressedPill({ pressed })]}>
                  <Text style={styles.morePillText} numberOfLines={1}>{t("chat:moreEvents", { count: state.moreCount })}</Text>
                </View>
              )}
            </Pressable>
          ) : null}
        </>
      )}
    </Animated.View>
  );
}

function joinLine(title: string, when: string): string {
  return when ? `${title} · ${when}` : title;
}

const styles = StyleSheet.create({
  host: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 9,
    paddingBottom: 9,
    paddingLeft: spacing.md,
    paddingRight: 12,
    backgroundColor: chatTokens.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.hairline,
  },
  hostSlim: {
    minHeight: 44,
    paddingTop: 0,
    paddingBottom: 0,
    paddingRight: 8,
    gap: 8,
  },
  main: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 10,
  },
  slimMain: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pressedOpacity: {
    opacity: 0.82,
  },
  pressedScale: {
    transform: [{ scale: 0.96 }],
  },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: 10,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: chatTokens.accentSoft,
  },
  thumbImage: {
    width: 40,
    height: 40,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  kickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: chatTokens.accent,
  },
  kicker: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: chatTokens.accent,
  },
  lineRow: {
    flexDirection: "row",
    alignItems: "baseline",
    minWidth: 0,
  },
  lineTitle: {
    flexShrink: 1,
    minWidth: 0,
  },
  lineWhen: {
    flexShrink: 0,
  },
  line: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  hit: {
    minWidth: 44,
    minHeight: 44,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },
  moreHit: {
    marginLeft: -MORE_HIT_OVERLAP,
  },
  ticketPill: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: chatTokens.accentSoft,
  },
  ticketPillText: {
    fontSize: 13,
    fontWeight: "600",
    color: chatTokens.accent,
  },
  morePill: {
    height: 32,
    paddingHorizontal: 11,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: chatTokens.hairline,
  },
  morePillText: {
    fontSize: 13,
    fontWeight: "600",
    color: chatTokens.textPrimary,
  },
  slimText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    color: chatTokens.textSecondary,
  },
  slimTextError: {
    color: chatTokens.danger,
  },
  viewPill: {
    height: 30,
    paddingLeft: 12,
    paddingRight: 10,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: chatTokens.hairline,
  },
  viewPillText: {
    fontSize: 13,
    fontWeight: "600",
    color: chatTokens.textPrimary,
  },
});
