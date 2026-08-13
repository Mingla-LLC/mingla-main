import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { GlassCard } from "../../../../src/components/ui/GlassCard";
import { Skeleton } from "../../../../src/components/ui/Skeleton";
import { canvas, spacing } from "../../../../src/constants/designSystem";
import { useResponsiveLayout } from "../../../../src/hooks/useResponsiveLayout";

const PeoplePage = React.lazy(() => import("../../../../src/components/people/people"));

function PeopleRouteFallback(): React.ReactElement {
  const { isWideDesktop, width } = useResponsiveLayout();
  const actionColumns = width > 0 && width < 352 ? 1 : isWideDesktop ? 3 : 2;
  const actionCell = {
    flexBasis: actionColumns === 1 ? "100%" : actionColumns === 2 ? "48%" : 0,
    flexGrow: 1,
    minWidth: 0,
  } as const;
  const lastActionCell = {
    ...actionCell,
    flexBasis: actionColumns === 2 ? "100%" : actionCell.flexBasis,
  } as const;
  return (
    <ScrollView
      accessibilityLiveRegion="polite"
      contentContainerStyle={styles.content}
      style={styles.host}
    >
      <Text accessibilityRole="header" style={styles.screenReaderHeading}>
        People
      </Text>
      <View style={[styles.workspace, isWideDesktop ? styles.workspaceWide : styles.workspaceCompact]}>
        <View style={isWideDesktop ? styles.bookColumnWide : styles.compactColumn}>
          <GlassCard variant="elevated" radius="xl" contentStyle={styles.card}>
            <Skeleton width={112} height={20} />
            <Skeleton width={220} height={14} />
            <View style={styles.rows}>
              {[0, 1, 2].map((row) => (
                <View key={row} style={styles.personRow}>
                  <Skeleton width={40} height={40} radius="full" />
                  <View style={styles.copy}>
                    <Skeleton width="48%" height={16} />
                    <Skeleton width="68%" height={12} />
                  </View>
                </View>
              ))}
            </View>
            <View style={styles.actions}>
              {[0, 1, 2].map((action) => (
                <View key={action} style={action === 2 ? lastActionCell : actionCell}>
                  <Skeleton width="100%" height={44} radius="full" />
                </View>
              ))}
            </View>
          </GlassCard>
        </View>
        <View style={isWideDesktop ? styles.groupsColumnWide : styles.compactColumn}>
          <GlassCard variant="base" radius="lg" contentStyle={styles.card}>
            <Skeleton width={96} height={20} />
            <Skeleton width={220} height={14} />
            <View style={styles.rows}>
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} width="100%" height={76} radius="lg" />
              ))}
            </View>
          </GlassCard>
        </View>
      </View>
    </ScrollView>
  );
}

export default function MarketingPeopleRoute(): React.ReactElement {
  return (
    <React.Suspense fallback={<PeopleRouteFallback />}>
      <PeoplePage />
    </React.Suspense>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  content: {
    flexGrow: 1,
    backgroundColor: canvas.discover,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  screenReaderHeading: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
  workspace: {
    gap: spacing.lg,
  },
  workspaceWide: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  workspaceCompact: {
    flexDirection: "column",
  },
  bookColumnWide: {
    flexBasis: 0,
    flexGrow: 5,
    minWidth: 0,
  },
  groupsColumnWide: {
    flexBasis: 0,
    flexGrow: 3,
    minWidth: 0,
  },
  compactColumn: {
    width: "100%",
    minWidth: 0,
  },
  card: {
    gap: spacing.md,
  },
  rows: {
    gap: spacing.sm,
  },
  personRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
});
