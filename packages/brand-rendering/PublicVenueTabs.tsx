import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type {
  offeringSurfaceStyles,
  ResolvedTheme,
  ThemePalette,
} from "@mingla/offering-rendering";
import {
  reconcileInitialVenueTab,
  type PublicVenueTab,
} from "./publicVenueTabState";

export type { PublicVenueTab } from "./publicVenueTabState";

type Surface = ReturnType<typeof offeringSurfaceStyles>;

export interface PublicVenueTabsProps {
  initialTab?: PublicVenueTab;
  activeTab?: PublicVenueTab;
  hasMenu: boolean;
  overview: React.ReactNode;
  menu: React.ReactNode;
  reservations: React.ReactNode;
  palette: ThemePalette;
  surface: Surface;
  theme: ResolvedTheme;
  onTabChange?: (tab: PublicVenueTab) => void;
  onTabViewed?: (tab: PublicVenueTab) => void;
}

export interface PublicVenueTabsHandle {
  focusTab: (tab: PublicVenueTab) => void;
}

const LABELS: Record<PublicVenueTab, string> = {
  overview: "Overview",
  menu: "Menu",
  reservations: "Reservations",
};

/**
 * Issue #1365 — the one shared public-venue tab composition. It intentionally
 * reuses the same pill shape and theme inputs as PublicBrandPage; adapters own
 * data, navigation, and booking side effects.
 */
export const PublicVenueTabs = forwardRef<
  PublicVenueTabsHandle,
  PublicVenueTabsProps
>(function PublicVenueTabs(
  {
    initialTab = "overview",
    activeTab: controlledActiveTab,
    hasMenu,
    overview,
    menu,
    reservations,
    palette,
    surface,
    theme,
    onTabChange,
    onTabViewed,
  },
  ref,
): React.ReactElement {
  const tabs: PublicVenueTab[] = hasMenu
    ? ["overview", "menu", "reservations"]
    : ["overview", "reservations"];
  const safeInitial = tabs.includes(initialTab) ? initialTab : "overview";
  const isControlled = controlledActiveTab !== undefined;
  const [uncontrolledActiveTab, setUncontrolledActiveTab] =
    useState<PublicVenueTab>(safeInitial);
  const activeTab =
    controlledActiveTab !== undefined && tabs.includes(controlledActiveTab)
      ? controlledActiveTab
      : isControlled
        ? "overview"
        : uncontrolledActiveTab;
  const lastInitialViewed = useRef<PublicVenueTab | null>(null);
  const onTabViewedRef = useRef(onTabViewed);
  const tabRefs = useRef<
    Partial<Record<PublicVenueTab, React.ElementRef<typeof Pressable>>>
  >({});

  useImperativeHandle(
    ref,
    () => ({
      focusTab: (tab: PublicVenueTab): void => {
        tabRefs.current[tab]?.focus();
      },
    }),
    [],
  );

  useEffect(() => {
    onTabViewedRef.current = onTabViewed;
  }, [onTabViewed]);

  useEffect(() => {
    if (
      !isControlled &&
      uncontrolledActiveTab === "menu" &&
      !hasMenu
    ) {
      setUncontrolledActiveTab("overview");
    }
  }, [hasMenu, isControlled, uncontrolledActiveTab]);

  useEffect(() => {
    const transition = reconcileInitialVenueTab(
      activeTab,
      lastInitialViewed.current,
      safeInitial,
    );
    lastInitialViewed.current = transition.lastInitialTab;
    if (!isControlled && transition.activeTab !== uncontrolledActiveTab) {
      setUncontrolledActiveTab(transition.activeTab);
    }
    if (transition.shouldEmit) {
      onTabViewedRef.current?.(safeInitial);
    }
    // activeTab is intentionally excluded: user tab changes must not replay the
    // route-initial event or snap back to the route's initial tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeInitial]);

  const select = (tab: PublicVenueTab): void => {
    if (!isControlled) {
      setUncontrolledActiveTab(tab);
    }
    onTabChange?.(tab);
    onTabViewed?.(tab);
  };

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
        accessibilityRole="tablist"
      >
        {tabs.map((tab) => {
          const active = tab === activeTab;
          return (
            <Pressable
              key={tab}
              ref={(node) => {
                tabRefs.current[tab] = node ?? undefined;
              }}
              onPress={() => select(tab)}
              accessibilityRole="tab"
              accessibilityLabel={LABELS[tab]}
              accessibilityState={{ selected: active }}
              style={[
                styles.chip,
                surface.card,
                active && {
                  backgroundColor: palette.accent,
                  borderColor: palette.accent,
                },
              ]}
            >
              <Text
                style={[
                  styles.label,
                  { fontFamily: theme.fontFamilyValue },
                  {
                    color: active ? palette.accentText : palette.secondaryText,
                  },
                ]}
              >
                {LABELS[tab]}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.pane}>
        {activeTab === "menu"
          ? menu
          : activeTab === "reservations"
            ? reservations
            : overview}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  tabs: {
    flexDirection: "row",
    gap: 6,
    paddingVertical: 2,
    paddingRight: 6,
  },
  chip: {
    minHeight: 44,
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: "center",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    overflow: "hidden",
  },
  label: {
    fontSize: 13,
    fontWeight: "800",
  },
  pane: {
    marginTop: 20,
  },
});
