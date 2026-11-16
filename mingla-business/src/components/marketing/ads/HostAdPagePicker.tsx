/**
 * #4238 — the "What are you promoting?" page list for Host ads.
 *
 * Each page shows its cover (or a type tile), its type, date and city, so an
 * event, a trip, a venue and the brand page are easy to tell apart. No raw URL
 * is shown. Type filter chips appear once the brand has two or more types.
 *
 * #4238: a series shows its next date and how many more ("Sun 8 Nov · +4 more
 * dates"), in the page's own time zone. A page that can't be promoted is shown
 * greyed out with a plain reason and can't be chosen
 * (I-4238-AD-PICKER-SAYS-WHY).
 */

import React, { useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { type as typeTokens, color, radius, space } from "../../../constants/designSystem";
import type { HostAdPage } from "../../../services/hostAdPlanService";
import {
  type HostAdPageFilter,
  hostAdPageDetails,
  hostAdPageSchedule,
  hostAdPageTypeLabel,
  hostAdPageUnavailableReason,
  isImageCoverUrl,
  pageTypeFilters,
} from "./hostAdPageLabels";

// #4420: a selected row or filter is ringed in paper (orange is retired here).
const SELECTED = color.paper;

export const HOST_AD_PAGE_PICKER_EMPTY =
  "You don't have a public page to promote yet. Publish an event, experience, trip or venue first.";

export const HOST_AD_PAGE_PICKER_NONE_PROMOTABLE =
  "None of your pages can be promoted right now. Each one says why.";

export interface HostAdPagePickerProps {
  pages: readonly HostAdPage[];
  selected: HostAdPage | null;
  onSelect: (page: HostAdPage) => void;
}

/** The screen-reader sentence for one page row. */
export function hostAdPageAccessibilityLabel(page: HostAdPage): string {
  const date = hostAdPageSchedule(page);
  const city = page.city?.trim() ? page.city.trim() : null;
  const reason = hostAdPageUnavailableReason(page);
  return `${page.title}, ${hostAdPageTypeLabel(page.page_type)}${
    date ? `, ${date}` : ""
  }${city ? `, ${city}` : ""}${reason ? `, can't be promoted: ${reason}` : ""}`;
}

export function HostAdPagePicker({
  pages,
  selected,
  onSelect,
}: HostAdPagePickerProps): React.ReactElement {
  const [filter, setFilter] = useState<HostAdPageFilter>("all");
  const filters = useMemo(() => pageTypeFilters(pages), [pages]);
  const activeFilter = filters.includes(filter) ? filter : "all";
  const visible = useMemo(
    () =>
      activeFilter === "all"
        ? pages
        : pages.filter((page) => page.page_type === activeFilter),
    [activeFilter, pages],
  );

  if (pages.length === 0) {
    return (
      <Text style={styles.empty} testID="host-ad-page-empty">
        {HOST_AD_PAGE_PICKER_EMPTY}
      </Text>
    );
  }

  const nonePromotable = pages.every(
    (page) => hostAdPageUnavailableReason(page) !== null,
  );

  return (
    <View style={styles.root}>
      {nonePromotable ? (
        <Text style={styles.empty} testID="host-ad-page-none-promotable">
          {HOST_AD_PAGE_PICKER_NONE_PROMOTABLE}
        </Text>
      ) : null}
      {filters.length > 2 ? (
        <View
          style={styles.filterRow}
          accessibilityRole="tablist"
          accessibilityLabel="Page type"
        >
          {filters.map((value) => {
            const isSelected = value === activeFilter;
            const label = value === "all" ? "All" : hostAdPageTypeLabel(value);
            return (
              <Pressable
                key={value}
                style={[styles.filter, isSelected && styles.filterSelected]}
                onPress={() => setFilter(value)}
                accessibilityRole="tab"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={label}
                testID={`host-ad-page-filter-${value}`}
              >
                <Text style={styles.filterLabel}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {visible.map((page) => {
        const reason = hostAdPageUnavailableReason(page);
        const unavailable = reason !== null;
        const isSelected =
          !unavailable &&
          selected?.page_type === page.page_type &&
          selected?.id === page.id;
        const typeLabel = hostAdPageTypeLabel(page.page_type);
        const details = hostAdPageDetails(page);
        return (
          <Pressable
            key={`${page.page_type}:${page.id}`}
            style={[styles.row, isSelected && styles.rowSelected]}
            onPress={unavailable ? undefined : () => onSelect(page)}
            disabled={unavailable}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected, disabled: unavailable }}
            accessibilityLabel={hostAdPageAccessibilityLabel(page)}
            testID={`host-ad-page-${page.id}`}
          >
            {isImageCoverUrl(page.cover_url) ? (
              <Image
                source={{ uri: page.cover_url as string }}
                style={[styles.cover, unavailable && styles.dimmed]}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View
                style={[styles.cover, styles.tile, unavailable && styles.dimmed]}
              >
                <Text style={styles.tileLetter}>
                  {typeLabel.slice(0, 1)}
                </Text>
              </View>
            )}
            <View style={styles.text}>
              {/* #4238: only the page's own details dim; the reason the Host
                  needs to read stays at full strength (>= 4.5:1). */}
              <View style={[styles.titleRow, unavailable && styles.dimmed]}>
                <Text style={styles.title} numberOfLines={2}>
                  {page.title}
                </Text>
                <View style={styles.badge}>
                  <Text style={styles.badgeLabel}>{typeLabel}</Text>
                </View>
              </View>
              {details ? (
                <Text
                  style={[styles.meta, unavailable && styles.dimmed]}
                  numberOfLines={1}
                >
                  {details}
                </Text>
              ) : null}
              {reason ? (
                <Text
                  style={styles.reason}
                  numberOfLines={2}
                  testID={`host-ad-page-reason-${page.id}`}
                >
                  {reason}
                </Text>
              ) : null}
            </View>
            {unavailable ? null : (
              <View
                style={[styles.radio, isSelected && styles.radioSelected]}
              />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[2] },
  empty: {
    ...typeTokens.small,
    color: color.text2,
    lineHeight: 20,
  },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: space[1] },
  filter: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: space[4],
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
  },
  filterSelected: {
    borderColor: SELECTED,
    backgroundColor: color.fill.tabOn,
  },
  filterLabel: { ...typeTokens.caption, color: color.text1 },
  row: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    padding: space[2],
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
    backgroundColor: color.fill.tile,
  },
  rowSelected: {
    borderColor: SELECTED,
    backgroundColor: color.fill.tabOn,
  },
  dimmed: { opacity: 0.5 },
  cover: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: color.fill.tile,
  },
  tile: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
  },
  tileLetter: {
    ...typeTokens.h1,
    color: color.text2,
  },
  text: { flex: 1, gap: 2 },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[1],
  },
  title: {
    ...typeTokens.small,
    flex: 1,
    color: color.text1,
    fontWeight: "600",
  },
  badge: {
    paddingHorizontal: space[1],
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: color.fill.tile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
  },
  badgeLabel: { ...typeTokens.caption, color: color.text2 },
  meta: { ...typeTokens.caption, color: color.text2 },
  // #4238: the greyed-out row's reason, full strength: text.primary over the
  // dark canvas measures well above 4.5:1 (secondary at 0.5 opacity was 3.42).
  reason: { ...typeTokens.caption, color: color.text1 },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: color.text3,
  },
  radioSelected: { borderWidth: 5, borderColor: SELECTED },
});
