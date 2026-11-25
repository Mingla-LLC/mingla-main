/**
 * GlassTabs — issue #4420 wave 2 (spec §1.1.7). The one frosted tab pill the
 * public brand page and the public venue page share (and the Stay Rooms /
 * Places toggle at the small size).
 *
 *   ( [ About ]  Upcoming 3   Events 2   Trips 1   …  ░)
 *     ink fill    secondary text, count at 70%          right-edge fade
 *
 * - One rounded glass strip (`palette.card` at 0.82 over the glass backdrop,
 *   `panelBorder` rim). The chosen tab is ink (`primaryText`) with
 *   page-coloured text; the accent stays the primary button's alone.
 * - It scrolls sideways when the tabs do not fit, keeps the chosen tab in
 *   view, and fades the right edge while more tabs sit past it (every
 *   platform).
 * - Web can pin it under the glass header (`stickyTop`).
 *
 * Presentational only. Pages own the state, the analytics and any extra
 * per-tab behaviour (the venue page's roving keyboard focus passes its DOM
 * props through `tabProps` and `tabRef`).
 */
import React, { useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleProp,
  ViewStyle,
} from "react-native";
import type { ResolvedTheme, ThemePalette } from "@mingla/offering-rendering";
import { themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";
import { OfferingGlassBackdrop } from "@mingla/offering-rendering/OfferingGlassContext";
import { hexToRgba } from "@mingla/offering-rendering/themePalette";

export interface GlassTabItem<K extends string> {
  key: K;
  label: string;
  /** Shown after the label at 12/700, 70% opacity. */
  count?: number;
  testID?: string;
}

export type GlassTabNode = React.ElementRef<typeof Pressable>;

export interface GlassTabsProps<K extends string> {
  items: ReadonlyArray<GlassTabItem<K>>;
  activeKey: K;
  onSelect: (key: K) => void;
  palette: ThemePalette;
  theme: ResolvedTheme;
  /** "md" 40 high (pages); "sm" 36 high (the Stay Rooms / Places toggle). */
  size?: "md" | "sm";
  /** Web only: pin the pill this far from the top of the scroll. */
  stickyTop?: number | null;
  /** The pinned native copy: an opaque fill and a drop shadow. */
  pinned?: boolean;
  /** The tablist's accessible name on web (`aria-label`). */
  listLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /** Extra props for one tab (web roving-focus handlers, aria ids). */
  tabProps?: (key: K, index: number, active: boolean) => Record<string, unknown>;
  tabRef?: (key: K, node: GlassTabNode | null) => void;
  /** Extra style for one tab (the venue page's focus-visible outline). */
  tabStyle?: (key: K, active: boolean) => StyleProp<ViewStyle>;
}

const FADE_WIDTH = 28;

/**
 * #4490 W3 fix 4 (W3-N34) — the pinned native copy floats over the page's
 * scrolling content, so it is opaque (spec 06 §8: Android always; on iOS the
 * Explorer has no blur behind it, and an opaque pill is legible either way).
 * At 0.96 the Menu tab's section headings ("Rice", "Noodles") read through it
 * at 375 pt. The in-flow strip keeps its lighter fill.
 */
export const glassTabFillAlpha = (args: { platform: string; pinned: boolean }): number => {
  if (args.platform === "android") return 1;
  return args.pinned ? 1 : 0.82;
};

const pillFillFor = (palette: ThemePalette, pinned: boolean): string => {
  if (palette.card.startsWith("#")) {
    return hexToRgba(palette.card, glassTabFillAlpha({ platform: Platform.OS, pinned }));
  }
  if (palette.page.startsWith("#")) {
    return hexToRgba(palette.page, Platform.OS === "android" ? 1 : 0.9);
  }
  return palette.page;
};

/**
 * #4490 W3 fix 3 — where the strip scrolls to show a pill whose left edge is
 * at `x`: a 16 pt lead-in, never before the start.
 */
export const glassTabRevealX = (x: number): number => Math.max(0, x - 16);

export function GlassTabs<K extends string>({
  items,
  activeKey,
  onSelect,
  palette,
  theme,
  size = "md",
  stickyTop = null,
  pinned = false,
  listLabel,
  testID,
  style,
  tabProps,
  tabRef,
  tabStyle,
}: GlassTabsProps<K>): React.ReactElement {
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Partial<Record<K, number>>>({});
  // #4490 W3 fix 3 (W3-N26/N30): the selected pill is brought fully into view
  // as soon as its own layout is known, not only when the selection changes.
  // A strip that mounts already on a far tab (a pinned copy, a page opened by
  // "See all" on What's on) measured nothing when the effect ran, so it stayed
  // scrolled at the start with the selected pill out of sight.
  const revealedKey = useRef<K | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number>(0);
  const [contentWidth, setContentWidth] = useState<number>(0);
  const [scrollX, setScrollX] = useState<number>(0);

  const reveal = (key: K, animated: boolean): void => {
    const x = offsets.current[key];
    if (typeof x !== "number" || scrollRef.current === null) return;
    revealedKey.current = key;
    scrollRef.current.scrollTo({ x: glassTabRevealX(x), animated });
  };

  useEffect(() => {
    if (revealedKey.current === activeKey) return;
    reveal(activeKey, true);
    // reveal reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  const fill = pillFillFor(palette, pinned);
  const overflowing = contentWidth > viewportWidth + 1 && viewportWidth > 0;
  const moreToTheRight = overflowing && scrollX + viewportWidth < contentWidth - 2;
  const sticky: ViewStyle | null =
    Platform.OS === "web" && stickyTop !== null
      ? ({
          position: "sticky",
          top: stickyTop,
          zIndex: 3,
          backdropFilter: "blur(18px)",
        } as unknown as ViewStyle)
      : null;
  const listWebProps =
    Platform.OS === "web" && listLabel !== undefined ? { "aria-label": listLabel } : {};

  return (
    <View
      style={[
        styles.pill,
        pinned && styles.pinnedShadow,
        { backgroundColor: fill, borderColor: palette.panelBorder },
        sticky,
        style,
      ]}
      testID={testID}
      onLayout={(e: LayoutChangeEvent) => {
        const w = e.nativeEvent.layout.width;
        if (w !== viewportWidth) setViewportWidth(w);
      }}
    >
      <OfferingGlassBackdrop radius={999} tint={palette.glassTint} />
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        accessibilityRole="tablist"
        scrollEventThrottle={32}
        onContentSizeChange={(w: number) => {
          if (w !== contentWidth) setContentWidth(w);
        }}
        onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
          setScrollX(e.nativeEvent.contentOffset.x);
        }}
        {...listWebProps}
      >
        {items.map((item: GlassTabItem<K>, index: number) => {
          const active = item.key === activeKey;
          return (
            <Pressable
              key={item.key}
              ref={(node: GlassTabNode | null) => tabRef?.(item.key, node)}
              onLayout={(e: LayoutChangeEvent) => {
                offsets.current[item.key] = e.nativeEvent.layout.x;
                if (item.key === activeKey && revealedKey.current !== activeKey) {
                  reveal(item.key, false);
                }
              }}
              onPress={() => onSelect(item.key)}
              accessibilityRole="tab"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: active }}
              testID={item.testID}
              {...(tabProps?.(item.key, index, active) ?? {})}
              style={[
                styles.tab,
                size === "sm" && styles.tabSmall,
                active && { backgroundColor: palette.primaryText },
                tabStyle?.(item.key, active),
              ]}
            >
              <Text
                style={[
                  styles.label,
                  themeBoldFace(theme),
                  { color: active ? palette.page : palette.secondaryText },
                ]}
                // #4490 W3 fix 3 (W3-N26): on iOS the SELECTED pill printed
                // "Overvi…" / "Tabl…" at 375 pt. A pill in this horizontal
                // strip is as wide as its label, so it needs no line limit;
                // without one, a rounding short-fall can never become an
                // ellipsis. Web keeps its one-line rule.
                {...(Platform.OS === "web" ? { numberOfLines: 1 } : {})}
              >
                {item.label}
                {item.count !== undefined ? (
                  <Text style={styles.count}> {item.count}</Text>
                ) : null}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {moreToTheRight ? (
        <View
          pointerEvents="none"
          style={[styles.fade, { backgroundColor: fill }]}
          testID="issue-4420-glass-tabs-fade"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    padding: 4,
    overflow: "hidden",
  },
  pinnedShadow: {
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  row: {
    flexGrow: 1,
    flexDirection: "row",
    gap: 4,
  },
  tab: {
    // #4490: 44 touch floor (a phone browser has no hitSlop).
    minHeight: 44,
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: "auto",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    overflow: "hidden",
  },
  tabSmall: {
    minHeight: 36,
    paddingVertical: 7,
  },
  label: {
    fontSize: 14,
    fontWeight: "700",
  },
  count: {
    fontSize: 12,
    fontWeight: "700",
    opacity: 0.7,
  },
  fade: {
    position: "absolute",
    top: 4,
    bottom: 4,
    right: 0,
    width: FADE_WIDTH,
    opacity: 0.85,
    borderTopRightRadius: 999,
    borderBottomRightRadius: 999,
  },
});

export default GlassTabs;
