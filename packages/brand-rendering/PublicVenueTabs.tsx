import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type {
  offeringSurfaceStyles,
  ResolvedTheme,
  ThemePalette,
} from "@mingla/offering-rendering";

type Surface = ReturnType<typeof offeringSurfaceStyles>;
export type PublicVenueTab = "overview" | "menu" | "reservations";

export interface PublicVenueTabsProps {
  initialTab?: PublicVenueTab;
  hasMenu: boolean;
  overview: React.ReactNode;
  menu: React.ReactNode;
  reservations: React.ReactNode;
  palette: ThemePalette;
  surface: Surface;
  theme: ResolvedTheme;
  onTabViewed?: (tab: PublicVenueTab) => void;
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
export function PublicVenueTabs({
  initialTab = "overview",
  hasMenu,
  overview,
  menu,
  reservations,
  palette,
  surface,
  theme,
  onTabViewed,
}: PublicVenueTabsProps): React.ReactElement {
  const tabs: PublicVenueTab[] = hasMenu
    ? ["overview", "menu", "reservations"]
    : ["overview", "reservations"];
  const safeInitial = tabs.includes(initialTab) ? initialTab : "overview";
  const [activeTab, setActiveTab] = useState<PublicVenueTab>(safeInitial);

  useEffect(() => {
    if (!tabs.includes(activeTab)) setActiveTab("overview");
  }, [activeTab, hasMenu]);

  useEffect(() => {
    setActiveTab(safeInitial);
  }, [safeInitial]);

  const select = (tab: PublicVenueTab): void => {
    setActiveTab(tab);
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
}

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
