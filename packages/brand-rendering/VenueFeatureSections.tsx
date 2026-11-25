/**
 * #4490 — the Overview pieces a venue's FEATURES add to the live page:
 *
 *   - "Ways to come": one row per thing the venue sells, each opening its tab;
 *   - "What's on": events held at the venue, each opening its public page;
 *   - the special days list inside the hours card;
 *   - the What's on tab body (the same rows, all of them).
 *
 * Every colour comes from the page's resolved palette and every font from its
 * theme; sizes and radii come from the shared design tokens. A section with
 * nothing to show returns null, so a venue with no such features renders
 * exactly as it did before (the render-parity baselines hold).
 *
 * No data layer, no `useAuth`, no router: the host hands in `onSelectTab` and
 * `onOpenEvent`. With no `onOpenEvent` (or in a preview) an event row is plain
 * text, never a dead button.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import type {
  offeringSurfaceStyles,
  ThemePalette,
} from "@mingla/offering-rendering";
import { accentFill } from "@mingla/offering-rendering/themeAccentStyle";

import { radius, spacing, typography } from "../offering-rendering/designTokens";
import { BrandRenderingReact as React } from "./PublicVenueTabs";
import type { BrandRenderingReactElement } from "./PublicVenueTabs";
import type { PublicVenueTab } from "./publicVenueTabState";
import {
  formatVenueMoney,
  venueEventWhen,
  type VenueFeatureEventView,
  type VenueSpecialDayRow,
  type VenueWayRow,
} from "./venueFeaturePage";

type Surface = ReturnType<typeof offeringSurfaceStyles>;

export interface VenueFeatureSectionStyleProps {
  palette: ThemePalette;
  surface: Surface;
  themedFont: { fontFamily: string };
  boldFont: { fontFamily: string; fontWeight?: "normal" };
}

// ── Ways to come ──────────────────────────────────────────────────────────

export interface VenueWaysToComeProps extends VenueFeatureSectionStyleProps {
  rows: readonly VenueWayRow[];
  onSelectTab: (tab: PublicVenueTab) => void;
}

export const VenueWaysToCome = ({
  rows,
  onSelectTab,
  palette,
  surface,
  themedFont,
  boldFont,
}: VenueWaysToComeProps): BrandRenderingReactElement | null => {
  if (rows.length === 0) return null;
  return (
    <View testID="issue-4490-ways-to-come">
      <Text
        accessibilityRole="header"
        style={[styles.sectionLabel, { color: palette.tertiaryText }]}
      >
        WAYS TO COME
      </Text>
      <View style={[styles.card, surface.card]}>
        {rows.map((row, index) => (
          <Pressable
            key={`${row.tab}-${row.title}`}
            onPress={() => onSelectTab(row.tab)}
            accessibilityRole="button"
            accessibilityLabel={
              row.price === null ? row.title : `${row.title}, ${row.price}`
            }
            testID={`issue-4490-way-${row.tab}`}
            style={({ pressed }) => [
              styles.row,
              index > 0
                ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.cutoutBorder }
                : null,
              pressed ? styles.pressed : null,
            ]}
          >
            <View style={styles.rowText}>
              <Text
                style={[styles.rowTitle, boldFont, { color: palette.primaryText }]}
                numberOfLines={2}
              >
                {row.title}
              </Text>
              {row.line !== null ? (
                <Text
                  style={[styles.rowLine, themedFont, { color: palette.secondaryText }]}
                  numberOfLines={2}
                >
                  {row.line}
                </Text>
              ) : null}
            </View>
            {row.price !== null ? (
              <Text style={[styles.rowPrice, { color: palette.primaryText }]}>
                {row.price}
              </Text>
            ) : null}
            <Text
              style={[styles.chevron, { color: palette.accent }]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              ›
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
};

// ── What's on ─────────────────────────────────────────────────────────────

export interface VenueEventRowsProps extends VenueFeatureSectionStyleProps {
  events: readonly VenueFeatureEventView[];
  timeZone: string | null;
  currencyCode: string;
  exponent: number;
  /** Opens the event's public page. Absent = rows are plain text. */
  onOpenEvent: ((href: string) => void) | undefined;
  /** A preview shows the button greyed out: nothing can be bought yet. */
  disabled: boolean;
}

const eventPriceText = (
  event: VenueFeatureEventView,
  currencyCode: string,
  exponent: number,
): string | null => {
  if (event.fromMinor === null) return null;
  return event.fromMinor === 0
    ? "Free"
    : formatVenueMoney(event.fromMinor, currencyCode, exponent);
};

const VenueEventRows = ({
  events,
  timeZone,
  currencyCode,
  exponent,
  onOpenEvent,
  disabled,
  palette,
  surface,
  themedFont,
  boldFont,
}: VenueEventRowsProps): BrandRenderingReactElement => (
  <View style={[styles.card, surface.card]}>
    {events.map((event, index) => {
      const when = venueEventWhen(event.startsAt, timeZone);
      const subtitle = [when, event.spaceName]
        .filter((p): p is string => p !== null && p.length > 0)
        .join(" · ");
      const price = eventPriceText(event, currencyCode, exponent);
      const canOpen = onOpenEvent !== undefined && !disabled;
      const body = (
        <>
          <View style={styles.rowText}>
            <Text
              style={[styles.rowTitle, boldFont, { color: palette.primaryText }]}
              numberOfLines={2}
            >
              {event.title}
            </Text>
            {subtitle.length > 0 ? (
              <Text
                style={[styles.rowLine, themedFont, { color: palette.secondaryText }]}
                numberOfLines={2}
              >
                {subtitle}
              </Text>
            ) : null}
          </View>
          {price !== null ? (
            <Text style={[styles.rowPrice, { color: palette.primaryText }]}>
              {price}
            </Text>
          ) : null}
          {onOpenEvent !== undefined || disabled ? (
            <View
              style={[
                styles.ticketsPill,
                accentFill(palette),
                disabled ? styles.disabled : null,
              ]}
            >
              <Text style={[styles.ticketsLabel, { color: palette.accentText }]}>
                Tickets
              </Text>
            </View>
          ) : null}
        </>
      );
      const rowStyle = [
        styles.row,
        index > 0
          ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.cutoutBorder }
          : null,
      ];
      return canOpen ? (
        <Pressable
          key={event.id}
          onPress={() => onOpenEvent(event.href)}
          accessibilityRole="link"
          accessibilityLabel={`${event.title}${subtitle.length > 0 ? `, ${subtitle}` : ""}. Tickets`}
          testID={`issue-4490-event-${event.id}`}
          style={({ pressed }) => [rowStyle, pressed ? styles.pressed : null]}
        >
          {body}
        </Pressable>
      ) : (
        <View
          key={event.id}
          style={rowStyle}
          testID={`issue-4490-event-${event.id}`}
          accessibilityState={disabled ? { disabled: true } : undefined}
        >
          {body}
        </View>
      );
    })}
  </View>
);

export interface VenueWhatsOnCardProps extends VenueEventRowsProps {
  /** Opens the What's on tab (shown when there are more than three). */
  onSeeAll: (() => void) | null;
}

/** Overview: the next three events, and a "See all" row when there are more. */
export const VenueWhatsOnCard = (
  props: VenueWhatsOnCardProps,
): BrandRenderingReactElement | null => {
  const { events, onSeeAll, palette, boldFont } = props;
  if (events.length === 0) return null;
  const shown = events.slice(0, 3);
  return (
    <View testID="issue-4490-whats-on">
      <Text
        accessibilityRole="header"
        style={[styles.sectionLabel, { color: palette.tertiaryText }]}
      >
        WHAT&apos;S ON
      </Text>
      <VenueEventRows {...props} events={shown} />
      {events.length > shown.length && onSeeAll !== null ? (
        <Pressable
          onPress={onSeeAll}
          accessibilityRole="button"
          accessibilityLabel={`See all ${events.length} events`}
          testID="issue-4490-whats-on-see-all"
          style={({ pressed }) => [styles.seeAll, pressed ? styles.pressed : null]}
        >
          <Text style={[styles.seeAllLabel, boldFont, { color: palette.accent }]}>
            See all {events.length} →
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};

/** The What's on tab: every upcoming event. */
export const VenueWhatsOnPane = (
  props: VenueEventRowsProps,
): BrandRenderingReactElement | null => {
  if (props.events.length === 0) return null;
  return (
    <View testID="issue-4490-whats-on-pane">
      <VenueEventRows {...props} />
    </View>
  );
};

// ── Special days (inside the hours card) ──────────────────────────────────

export interface VenueSpecialDaysProps {
  rows: readonly VenueSpecialDayRow[];
  palette: ThemePalette;
  themedFont: { fontFamily: string };
}

export const VenueSpecialDays = ({
  rows,
  palette,
  themedFont,
}: VenueSpecialDaysProps): BrandRenderingReactElement | null => {
  if (rows.length === 0) return null;
  return (
    <View style={styles.specialWrap} testID="issue-4490-special-days">
      <Text style={[styles.sectionLabel, { color: palette.tertiaryText }]}>
        SPECIAL DAYS
      </Text>
      {rows.map((row) => (
        <View key={row.date} style={styles.specialRow}>
          <View style={styles.rowText}>
            <Text style={[styles.specialDay, themedFont, { color: palette.secondaryText }]}>
              {row.dateLabel}
            </Text>
            {row.label !== null ? (
              <Text
                style={[styles.specialLabel, themedFont, { color: palette.tertiaryText }]}
                numberOfLines={2}
              >
                {row.label}
              </Text>
            ) : null}
          </View>
          <Text
            style={[
              styles.specialTimes,
              { color: row.text === "Closed" ? palette.tertiaryText : palette.primaryText },
            ]}
          >
            {row.text}
          </Text>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: typography.caption.fontSize + 1,
    lineHeight: typography.caption.lineHeight + 2,
    fontWeight: "700",
    letterSpacing: 1.4,
    marginBottom: spacing.sm,
  },
  card: {
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 4,
    paddingVertical: spacing.md - 2,
    minHeight: 56,
  },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: typography.body.fontSize, fontWeight: "700" },
  rowLine: { fontSize: typography.bodySm.fontSize },
  rowPrice: {
    fontSize: typography.body.fontSize - 1,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  chevron: { fontSize: 22, lineHeight: 24 },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  ticketsPill: {
    minHeight: 36,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  ticketsLabel: { fontSize: typography.bodySm.fontSize, fontWeight: "700" },
  seeAll: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingVertical: spacing.sm,
  },
  seeAllLabel: { fontSize: typography.bodySm.fontSize + 1, fontWeight: "700" },
  specialWrap: { marginTop: spacing.md - 2 },
  specialRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm + 4,
    paddingVertical: spacing.sm - 2,
  },
  specialDay: { fontSize: typography.bodySm.fontSize + 1, lineHeight: 20 },
  specialLabel: { fontSize: typography.bodySm.fontSize - 1, lineHeight: 16 },
  specialTimes: {
    fontSize: typography.bodySm.fontSize + 1,
    lineHeight: 20,
    flexShrink: 1,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
});
