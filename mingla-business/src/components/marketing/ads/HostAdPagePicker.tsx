/**
 * #4238 — the "What are you promoting?" page list for Host ads.
 *
 * Each page shows its cover (or a type tile), its type, date and city, so an
 * event, a trip, a venue and the brand page are easy to tell apart. No raw URL
 * is shown. Type filter chips appear once the brand has two or more types.
 */

import React, { useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import {
  glass,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import type { HostAdPage } from "../../../services/hostAdPlanService";
import {
  type HostAdPageFilter,
  hostAdPageDate,
  hostAdPageDetails,
  hostAdPageTypeLabel,
  isImageCoverUrl,
  pageTypeFilters,
} from "./hostAdPageLabels";

const SELECTED = "#FF7A18";

export const HOST_AD_PAGE_PICKER_EMPTY =
  "You don't have a public page to promote yet. Publish an event, experience, trip or venue first.";

export interface HostAdPagePickerProps {
  pages: readonly HostAdPage[];
  selected: HostAdPage | null;
  onSelect: (page: HostAdPage) => void;
}

/** The screen-reader sentence for one page row. */
export function hostAdPageAccessibilityLabel(page: HostAdPage): string {
  const date = hostAdPageDate(page.starts_at);
  const city = page.city?.trim() ? page.city.trim() : null;
  return `${page.title}, ${hostAdPageTypeLabel(page.page_type)}${
    date ? `, ${date}` : ""
  }${city ? `, ${city}` : ""}`;
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

  return (
    <View style={styles.root}>
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
        const isSelected =
          selected?.page_type === page.page_type && selected?.id === page.id;
        const typeLabel = hostAdPageTypeLabel(page.page_type);
        return (
          <Pressable
            key={`${page.page_type}:${page.id}`}
            style={[styles.row, isSelected && styles.rowSelected]}
            onPress={() => onSelect(page)}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={hostAdPageAccessibilityLabel(page)}
            testID={`host-ad-page-${page.id}`}
          >
            {isImageCoverUrl(page.cover_url) ? (
              <Image
                source={{ uri: page.cover_url as string }}
                style={styles.cover}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View style={[styles.cover, styles.tile]}>
                <Text style={styles.tileLetter}>
                  {typeLabel.slice(0, 1)}
                </Text>
              </View>
            )}
            <View style={styles.text}>
              <View style={styles.titleRow}>
                <Text style={styles.title} numberOfLines={2}>
                  {page.title}
                </Text>
                <View style={styles.badge}>
                  <Text style={styles.badgeLabel}>{typeLabel}</Text>
                </View>
              </View>
              {hostAdPageDetails(page) ? (
                <Text style={styles.meta} numberOfLines={1}>
                  {hostAdPageDetails(page)}
                </Text>
              ) : null}
            </View>
            <View style={[styles.radio, isSelected && styles.radioSelected]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  empty: {
    ...typography.bodySm,
    color: textTokens.secondary,
    lineHeight: 20,
  },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  filter: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
  },
  filterSelected: {
    borderColor: SELECTED,
    backgroundColor: "rgba(255,122,24,.11)",
  },
  filterLabel: { ...typography.caption, color: textTokens.primary },
  row: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
    backgroundColor: glass.tint.chrome.idle,
  },
  rowSelected: {
    borderColor: SELECTED,
    backgroundColor: "rgba(255,122,24,.11)",
  },
  cover: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: glass.tint.chrome.idle,
  },
  tile: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
  },
  tileLetter: {
    ...typography.h3,
    color: textTokens.secondary,
  },
  text: { flex: 1, gap: 2 },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
  },
  title: {
    ...typography.bodySm,
    flex: 1,
    color: textTokens.primary,
    fontWeight: "600",
  },
  badge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: glass.tint.chrome.idle,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
  },
  badgeLabel: { ...typography.caption, color: textTokens.secondary },
  meta: { ...typography.caption, color: textTokens.secondary },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: textTokens.tertiary,
  },
  radioSelected: { borderWidth: 5, borderColor: SELECTED },
});
