/**
 * #4490 Explorer W3 — the card sheet's blocks for a CLAIMED venue, after the
 * About section: "Ways to come", "What's on" (with "See all") and
 * "Message {venue}" (the existing venue chat button; no new messaging rail).
 *
 * Every row opens the venue page in the app: the sheet closes first, then the
 * page opens on the row's tab (or the event page). Data is the page payload
 * already read for the sheet's main button (`useVenueFeaturesForPlace`), so
 * the blocks have no loading or error of their own: they render when it has
 * resolved, and are absent when it has not (the sheet is exactly today's).
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { PlaceVenueFeatures } from "../../hooks/useVenueFeaturesForPlace";
import { CalendarPlanMessageButton } from "../brandEnquiry/CalendarPlanMessageButton";
import { fontWeights, spacing, typography } from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import { Section } from "./SpineParts";
import { SPINE } from "./spineTokens";
import {
  venuePagePath,
  venueSheetEvents,
  venueSheetWays,
  type VenueSheetWayRow,
} from "./venueSheetModel";

export interface VenueSheetBlocksProps {
  place: PlaceVenueFeatures;
  /** `useVenueReservable`'s answer (null while it is still checking). */
  tablesReservable: boolean | null;
  venueType: string | null;
  /** Close the sheet, then open this app path. */
  onOpenPath: (path: string) => void;
  /** A Ways to come row was tapped (fires `venue_tapped_to_book`). */
  onWayTapped: (row: VenueSheetWayRow) => void;
}

export function VenueSheetBlocks({
  place,
  tablesReservable,
  venueType,
  onOpenPath,
  onWayTapped,
}: VenueSheetBlocksProps): React.ReactElement | null {
  const { t } = useTranslation(["cards"]);
  const ways = venueSheetWays(place.features, { tablesReservable, venueType });
  const events = venueSheetEvents(place.features.events, place.timezone);
  const venueName = place.venueName || place.brandName;
  return (
    <>
      <Section title={t("cards:sheet.ways_to_come", { defaultValue: "Ways to come" })} hidden={ways.length === 0}>
        <View style={styles.list} testID="sheet-ways-to-come">
          {ways.map((row, index) => (
            <Pressable
              key={row.tab}
              onPress={() => {
                onWayTapped(row);
                onOpenPath(venuePagePath(place.brandSlug, place.venueSlug, row.tab));
              }}
              style={({ pressed }) => [styles.row, index === 0 ? null : styles.rowDivided, pressed ? styles.rowPressed : null]}
              accessibilityRole="button"
              accessibilityLabel={[row.title, row.price].filter((p): p is string => p !== null).join(", ")}
              testID={`sheet-way-${row.tab}`}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{row.title}</Text>
                {row.line !== null ? (
                  <Text style={styles.rowLine} numberOfLines={2}>
                    {row.line}
                  </Text>
                ) : null}
              </View>
              {row.price !== null ? <Text style={styles.rowPrice}>{row.price}</Text> : null}
              <Icon name="chevron-forward" size={16} color={SPINE.factLabel} />
            </Pressable>
          ))}
        </View>
      </Section>

      <Section
        title={t("cards:sheet.whats_on", { defaultValue: "What's on" })}
        hidden={events.length === 0}
        trailing={
          <Pressable
            onPress={() => onOpenPath(venuePagePath(place.brandSlug, place.venueSlug, "whats_on"))}
            accessibilityRole="button"
            accessibilityLabel={t("cards:sheet.see_all", { defaultValue: "See all" })}
            hitSlop={spacing.sm}
            testID="sheet-whats-on-see-all"
          >
            <Text style={styles.seeAll}>{t("cards:sheet.see_all", { defaultValue: "See all" })}</Text>
          </Pressable>
        }
      >
        <View style={styles.list} testID="sheet-whats-on">
          {events.map((event, index) => (
            <Pressable
              key={event.id}
              onPress={() => onOpenPath(event.href)}
              style={({ pressed }) => [styles.row, index === 0 ? null : styles.rowDivided, pressed ? styles.rowPressed : null]}
              accessibilityRole="button"
              accessibilityLabel={[event.title, event.when].filter((p): p is string => p !== null).join(", ")}
              testID={`sheet-event-${event.id}`}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{event.title}</Text>
                {event.when !== null ? <Text style={styles.rowLine}>{event.when}</Text> : null}
              </View>
              <Icon name="chevron-forward" size={16} color={SPINE.factLabel} />
            </Pressable>
          ))}
        </View>
      </Section>

      <View style={styles.message}>
        <CalendarPlanMessageButton
          target={{
            brandId: place.brandId,
            brandSlug: place.brandSlug,
            brandName: place.brandName,
            displayName: venueName,
            prefill: { contextKind: "venue", contextId: place.venueId ?? place.venueSlug },
          }}
          testID="sheet-message-venue"
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: SPINE.gutter },
  row: {
    minHeight: SPINE.factRowMinHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rowDivided: { borderTopWidth: 1, borderTopColor: SPINE.rule },
  rowPressed: { backgroundColor: SPINE.pressedRow },
  rowText: { flex: 1, minWidth: 0, gap: spacing.xxs },
  rowTitle: { color: SPINE.factValue, fontSize: SPINE.factValueSize, fontWeight: fontWeights.bold },
  rowLine: { color: SPINE.muted, fontSize: SPINE.factLabelSize, lineHeight: typography.sm.lineHeight },
  rowPrice: { color: SPINE.factValue, fontSize: SPINE.factLabelSize, fontWeight: fontWeights.semibold },
  seeAll: { color: SPINE.link, fontSize: SPINE.factLabelSize, fontWeight: fontWeights.bold },
  message: { paddingHorizontal: SPINE.gutter, paddingTop: SPINE.sectionPaddingVertical },
});
