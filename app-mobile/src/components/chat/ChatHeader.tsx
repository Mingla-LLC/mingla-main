/**
 * Issue #4114 Wave 3 (D9): the one chat header for every kind of chat.
 *
 * One 48pt title row: back (36x44), identity (32pt avatar or 2-avatar stack +
 * count, title 16/600, a 12.5pt subtitle), then on the right either the orange
 * 34pt primary action (Swipe, in a collab) or the options button. Under it, a
 * 40pt strip that exists only when the collab has matches or plans. Heights
 * come from CHAT_HEADER_METRICS: 62pt without the strip, 108pt with it.
 *
 * The same component takes a single avatar and a "Collaborating" subtitle, so
 * the 1:1 collab variant (Wave 5) needs no second header.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Icon } from "../ui/Icon";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import { chatTokens } from "../../constants/chatTokens";
import {
  CHAT_HEADER_METRICS as M,
  type CollabHeaderStripModel,
} from "./chatHeaderModel";

export interface ChatHeaderParticipant {
  id: string;
  name?: string;
  username?: string;
  avatar_url?: string;
}

export interface ChatHeaderStripLabels {
  matchesCount: (count: number) => string;
  matchesLoading: string;
  newMatches: string;
  lastPlan: string;
  plansLoading: string;
  moreCount: (count: number) => string;
  openMatches: string;
  openPlans: string;
}

export interface ChatHeaderProps {
  topInset: number;
  title: string;
  subtitle?: React.ReactNode;
  onBack: () => void;
  backLabel: string;
  /**
   * `single`: one person. `stack`: a group (2 avatars + count). `cover`: an
   * event/trip cover. `brand`: a brand channel's logo as a rounded square (Wave 6).
   */
  avatarKind: "single" | "stack" | "cover" | "brand";
  avatarUrl?: string | null;
  participants?: readonly ChatHeaderParticipant[];
  participantCount?: number;
  isOnline?: boolean;
  /** Ring the avatar in orange (a collab). */
  collaborating?: boolean;
  onIdentityPress?: () => void;
  identityA11yLabel: string;
  primaryAction?: { label: string; a11yLabel: string; onPress: () => void } | null;
  /** Issue #4114 Wave 6: an icon button before the options button (the brand channel's shop button). */
  secondaryAction?: { icon: string; a11yLabel: string; onPress: () => void } | null;
  onMorePress?: () => void;
  moreA11yLabel?: string;
  strip?: CollabHeaderStripModel | null;
  stripLabels?: ChatHeaderStripLabels;
  onStripPress?: (view: "matches" | "plans") => void;
  locale?: string;
}

const STRIP_OPEN_HEIGHT = M.stripGap + M.strip;
const STRIP_MOTION_MS = 240;

function initials(name: string): string {
  return (
    name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .substring(0, 2) || "?"
  );
}

function participantName(participant: ChatHeaderParticipant): string {
  return (participant.name || participant.username || "?").trim();
}

function Avatar({
  uri,
  name,
  size,
  ringed,
  square,
}: {
  uri?: string | null;
  name: string;
  size: number;
  ringed?: boolean;
  square?: boolean;
}): React.ReactElement {
  const shape = { width: size, height: size, borderRadius: square ? M.brandAvatarRadius : size / 2 };
  return (
    <View style={[styles.avatarShell, shape, ringed && styles.avatarRing]}>
      {uri ? (
        <ImageWithFallback source={{ uri }} style={shape} />
      ) : (
        <Text style={styles.avatarInitials}>{initials(name)}</Text>
      )}
    </View>
  );
}

function formatPlanTile(iso: string, locale?: string): { weekday: string; day: string; time: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { weekday: "", day: "", time: "" };
  return {
    weekday: date.toLocaleDateString(locale, { weekday: "short" }).toUpperCase(),
    day: String(date.getDate()),
    time: date.toLocaleString(locale, { weekday: "short", hour: "numeric", minute: "2-digit" }),
  };
}

export function ChatHeader({
  topInset,
  title,
  subtitle,
  onBack,
  backLabel,
  avatarKind,
  avatarUrl,
  participants = [],
  participantCount,
  isOnline = false,
  collaborating = false,
  onIdentityPress,
  identityA11yLabel,
  primaryAction,
  secondaryAction,
  onMorePress,
  moreA11yLabel,
  strip,
  stripLabels,
  onStripPress,
  locale,
}: ChatHeaderProps): React.ReactElement {
  const stripVisible = Boolean(strip?.visible && stripLabels);
  const stripHeight = useRef(new Animated.Value(stripVisible ? STRIP_OPEN_HEIGHT : 0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduceMotion(enabled);
      })
      .catch(() => {
        // Unknown: keep motion on (the platform default).
      });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    const target = stripVisible ? STRIP_OPEN_HEIGHT : 0;
    if (reduceMotion) {
      stripHeight.setValue(target);
      return;
    }
    Animated.timing(stripHeight, {
      toValue: target,
      duration: STRIP_MOTION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [reduceMotion, stripHeight, stripVisible]);

  const stack = participants.slice(0, 2);
  const extra = Math.max(0, (participantCount ?? participants.length) - stack.length);

  return (
    <View style={[styles.header, { paddingTop: topInset + M.paddingTop }]} testID="chat-header">
      <View style={styles.titleRow}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          testID="chat-header-back"
        >
          <Icon name="arrow-back" size={22} color={chatTokens.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.identity}
          onPress={onIdentityPress}
          disabled={!onIdentityPress}
          activeOpacity={0.72}
          accessibilityRole="button"
          accessibilityLabel={identityA11yLabel}
          testID="chat-header-identity"
        >
          {avatarKind === "stack" ? (
            <View style={[styles.stack, { width: M.avatar + (stack.length > 1 ? 18 : 0) + (extra > 0 ? 18 : 0) }]}>
              {stack.length === 0 ? (
                <Avatar name={title} size={M.avatar} ringed={collaborating} />
              ) : (
                stack.map((participant, index) => (
                  <View key={participant.id} style={[styles.stackItem, { left: index * 18, zIndex: 3 - index }]}>
                    <Avatar
                      uri={participant.avatar_url}
                      name={participantName(participant)}
                      size={M.avatar}
                      ringed={collaborating && index === 0}
                    />
                  </View>
                ))
              )}
              {extra > 0 ? (
                <View style={[styles.stackItem, styles.stackMore, { left: stack.length * 18 }]}>
                  <Text style={styles.stackMoreText}>+{extra}</Text>
                </View>
              ) : null}
            </View>
          ) : (
            <View>
              <Avatar uri={avatarUrl} name={title} size={M.avatar} ringed={collaborating} square={avatarKind === "brand"} />
              {avatarKind === "single" && isOnline ? <View style={styles.onlineDot} /> : null}
            </View>
          )}
          <View style={styles.identityCopy}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            {typeof subtitle === "string" ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : (
              subtitle ?? null
            )}
          </View>
        </TouchableOpacity>

        {primaryAction ? (
          <TouchableOpacity
            onPress={primaryAction.onPress}
            style={styles.primaryButton}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={primaryAction.a11yLabel}
            testID="chat-header-primary"
          >
            <Text style={styles.primaryButtonText}>{primaryAction.label}</Text>
          </TouchableOpacity>
        ) : null}

        {secondaryAction ? (
          <TouchableOpacity
            onPress={secondaryAction.onPress}
            style={styles.moreButton}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            accessibilityRole="button"
            accessibilityLabel={secondaryAction.a11yLabel}
            testID="chat-header-secondary"
          >
            <Icon name={secondaryAction.icon} size={20} color={chatTokens.textSecondary} />
          </TouchableOpacity>
        ) : null}

        {onMorePress ? (
          <TouchableOpacity
            onPress={onMorePress}
            style={styles.moreButton}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            accessibilityRole="button"
            accessibilityLabel={moreA11yLabel}
            testID="chat-header-more"
          >
            <Icon name="ellipsis-vertical" size={20} color={chatTokens.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {strip && stripLabels ? (
        <Animated.View style={[styles.stripClip, { height: stripHeight }]} testID="chat-header-strip">
          <View style={styles.strip}>
            {strip.matches ? (
              <TouchableOpacity
                style={styles.cell}
                onPress={() => onStripPress?.("matches")}
                activeOpacity={0.72}
                accessibilityRole="button"
                accessibilityLabel={`${stripLabels.openMatches}. ${stripLabels.matchesCount(strip.matches.count)}${strip.matches.hasUnseen ? `, ${stripLabels.newMatches}` : ""}`}
                testID="chat-header-matches"
              >
                {strip.matches.photos.length > 0 ? (
                  <View style={[styles.photos, { width: 24 + (strip.matches.photos.length - 1) * 12 }]}>
                    {strip.matches.photos.map((uri, index) => (
                      <ImageWithFallback
                        key={`${uri}-${index}`}
                        source={{ uri }}
                        style={[styles.photo, { left: index * 12, zIndex: 3 - index }]}
                      />
                    ))}
                  </View>
                ) : (
                  <View style={styles.cellIcon}>
                    <Icon name="heart" size={14} color={chatTokens.accent} />
                  </View>
                )}
                <View style={styles.cellCopy}>
                  <Text style={styles.cellTitle} numberOfLines={1}>
                    {strip.matches.loading
                      ? stripLabels.matchesLoading
                      : stripLabels.matchesCount(strip.matches.count)}
                  </Text>
                  {strip.matches.names ? (
                    <Text style={styles.cellMeta} numberOfLines={1}>
                      {strip.matches.names}
                    </Text>
                  ) : null}
                </View>
                {strip.matches.hasUnseen ? <View style={styles.unseenDot} testID="chat-header-unseen-dot" /> : null}
              </TouchableOpacity>
            ) : null}

            {strip.matches && strip.plan ? <View style={styles.cellDivider} /> : null}

            {strip.plan ? (() => {
              const plan = strip.plan;
              const tile = formatPlanTile(plan.scheduledAt, locale);
              const muted = plan.state === "past";
              return (
                <TouchableOpacity
                  style={styles.cell}
                  onPress={() => onStripPress?.("plans")}
                  activeOpacity={0.72}
                  accessibilityRole="button"
                  accessibilityLabel={`${stripLabels.openPlans}. ${muted ? `${stripLabels.lastPlan}, ` : ""}${plan.title} ${tile.time}`}
                  testID="chat-header-plan"
                >
                  <View style={[styles.calendarTile, muted && styles.calendarTileMuted]}>
                    <Text style={[styles.calendarWeekday, muted && styles.mutedText]}>{tile.weekday}</Text>
                    <Text style={[styles.calendarDay, muted && styles.mutedText]}>{tile.day}</Text>
                  </View>
                  <View style={styles.cellCopy}>
                    <Text style={[styles.cellTitle, muted && styles.mutedText]} numberOfLines={1}>
                      {plan.loading ? stripLabels.plansLoading : muted ? `${stripLabels.lastPlan} · ${tile.time}` : tile.time}
                    </Text>
                    <Text style={[styles.cellMeta, muted && styles.mutedText]} numberOfLines={1}>
                      {plan.title}
                      {plan.moreCount > 0 ? ` · ${stripLabels.moreCount(plan.moreCount)}` : ""}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })() : null}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingBottom: M.paddingBottom,
    paddingHorizontal: 4,
    backgroundColor: chatTokens.screenBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.hairline,
  },
  titleRow: {
    height: M.titleRow,
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    width: M.backButtonWidth,
    height: M.backButtonHeight,
    alignItems: "center",
    justifyContent: "center",
  },
  identity: {
    flex: 1,
    minWidth: 0,
    height: M.titleRow,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatarShell: {
    backgroundColor: chatTokens.accent,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 2,
    borderColor: chatTokens.screenBg,
  },
  avatarRing: {
    borderColor: chatTokens.accent,
  },
  avatarInitials: {
    color: chatTokens.textPrimary,
    fontSize: 12,
    fontWeight: "700",
  },
  stack: {
    height: M.avatar,
    position: "relative",
  },
  stackItem: {
    position: "absolute",
    top: 0,
  },
  stackMore: {
    width: M.avatar,
    height: M.avatar,
    borderRadius: M.avatar / 2,
    backgroundColor: chatTokens.surfaceRaised,
    borderWidth: 2,
    borderColor: chatTokens.screenBg,
    alignItems: "center",
    justifyContent: "center",
  },
  stackMoreText: {
    color: chatTokens.textSecondary,
    fontSize: 11,
    fontWeight: "700",
  },
  onlineDot: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: chatTokens.online,
    borderWidth: 2,
    borderColor: chatTokens.screenBg,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: chatTokens.textPrimary,
  },
  subtitle: {
    marginTop: 1,
    fontSize: 12.5,
    color: chatTokens.textSoft,
  },
  primaryButton: {
    height: M.swipeButtonHeight,
    minWidth: 72,
    paddingHorizontal: 16,
    marginLeft: 8,
    marginRight: 8,
    borderRadius: M.swipeButtonHeight / 2,
    backgroundColor: chatTokens.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: chatTokens.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
  moreButton: {
    width: 40,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  stripClip: {
    overflow: "hidden",
  },
  strip: {
    marginTop: M.stripGap,
    height: M.strip,
    marginHorizontal: 8,
    borderRadius: 14,
    backgroundColor: chatTokens.strip,
    flexDirection: "row",
    alignItems: "stretch",
  },
  cell: {
    flex: 1,
    minWidth: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    gap: 8,
  },
  cellDivider: {
    width: StyleSheet.hairlineWidth,
    marginVertical: 8,
    backgroundColor: chatTokens.hairline,
  },
  photos: {
    height: 24,
    position: "relative",
  },
  photo: {
    position: "absolute",
    top: 0,
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: chatTokens.screenBg,
  },
  cellIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: chatTokens.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  cellCopy: {
    flex: 1,
    minWidth: 0,
  },
  cellTitle: {
    fontSize: 12.5,
    fontWeight: "600",
    color: chatTokens.textPrimary,
  },
  cellMeta: {
    fontSize: 11.5,
    color: chatTokens.textMuted,
  },
  unseenDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: chatTokens.accent,
  },
  calendarTile: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: chatTokens.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  calendarTileMuted: {
    backgroundColor: chatTokens.strip,
  },
  calendarWeekday: {
    fontSize: 7.5,
    fontWeight: "700",
    color: chatTokens.accent,
    lineHeight: 9,
  },
  calendarDay: {
    fontSize: 12,
    fontWeight: "700",
    color: chatTokens.textPrimary,
    lineHeight: 14,
  },
  mutedText: {
    color: chatTokens.textMuted,
  },
});
