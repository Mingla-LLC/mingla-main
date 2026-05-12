/**
 * /brand/[id]/audit-log — read-only audit log viewer (Cycle 13a + ORCH-0806
 * human-readable labels + pagination + category filter).
 *
 * Route-level rank gate: only brand_admin+ (rank >= 50) sees the actual
 * list. Below-threshold users see "Insufficient permissions" empty state.
 *
 * RLS today scopes audit_log SELECT to `user_id = auth.uid()` — users see
 * only their own actions on this brand. Brand-admin-can-read-all is queued
 * for B-cycle (Cycle 13a SPEC §10.4). The banner is honest about that scope.
 *
 * Hook ordering follows ORCH-0710: ALL hooks run on every render before any
 * early-return shell.
 *
 * Per Cycle 13a SPEC §4.12 + ORCH-0806 SPEC §7.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../../src/components/ui/Button";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { Icon } from "../../../src/components/ui/Icon";
import { Pill } from "../../../src/components/ui/Pill";
import { Spinner } from "../../../src/components/ui/Spinner";
import { TopBar } from "../../../src/components/ui/TopBar";
import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import {
  useAuditLog,
  type AuditCategoryFilter,
  type AuditLogRow,
} from "../../../src/hooks/useAuditLog";
import { useCurrentBrandRole } from "../../../src/hooks/useCurrentBrandRole";
import { canPerformAction } from "../../../src/utils/permissionGates";
import {
  AUDIT_CATEGORIES,
  resolveAuditActionLabel,
} from "../../../src/utils/auditActionLabels";
import { formatRelativeTime } from "../../../src/utils/relativeTime";

const truncId = (id: string | null): string =>
  id === null ? "—" : `…${id.slice(-6)}`;

interface DisplayRow {
  id: string;
  title: string;
  detail?: string;
  iconName: ReturnType<typeof resolveAuditActionLabel>["iconHint"];
  targetSummary: string;
  actorSummary: string;
  relativeTime: string;
}

const toDisplayRow = (row: AuditLogRow): DisplayRow => {
  const label = resolveAuditActionLabel(row.action);
  const targetSummary =
    row.target_type !== null && row.target_id !== null
      ? `${row.target_type} ${truncId(row.target_id)}`
      : row.target_type !== null
        ? row.target_type
        : "—";
  const actorSummary =
    row.user_id !== null ? `User …${row.user_id.slice(-6)}` : "System";
  return {
    id: row.id,
    title: label.title,
    detail: label.detail,
    iconName: label.iconHint,
    targetSummary,
    actorSummary,
    relativeTime: formatRelativeTime(row.created_at),
  };
};

const FILTER_OPTIONS: readonly { id: AuditCategoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  ...AUDIT_CATEGORIES.map(({ id, label }) => ({ id, label })),
];

export default function AuditLogRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const brandIdResolved =
    typeof idParam === "string" && idParam.length > 0 ? idParam : null;

  const [categoryFilter, setCategoryFilter] = useState<AuditCategoryFilter>(
    "all",
  );

  const { rank, isLoading: roleLoading } = useCurrentBrandRole(brandIdResolved);
  const { rows, isLoading: rowsLoading, isError, hasMore, isFetchingMore, fetchMore } =
    useAuditLog(brandIdResolved, categoryFilter);

  const displayRows = useMemo<DisplayRow[]>(
    () => rows.map(toDisplayRow),
    [rows],
  );

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/account" as never);
    }
  }, [router]);

  const handleLoadMore = useCallback((): void => {
    if (!isFetchingMore && hasMore) {
      fetchMore();
    }
  }, [fetchMore, hasMore, isFetchingMore]);

  const canView = canPerformAction(rank, "VIEW_AUDIT_LOG");
  const isLoading = roleLoading || rowsLoading;

  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <TopBar
        leftKind="back"
        title="Audit log"
        onBack={handleBack}
        rightSlot={null}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {!canView && !roleLoading ? (
          <View style={styles.emptyHost}>
            <EmptyState
              illustration="shield"
              title="Insufficient permissions"
              description="You need brand admin access or above to view the audit log."
            />
          </View>
        ) : (
          <>
            <View style={styles.banner}>
              <Text style={styles.bannerText}>
                You see audit events tied to your account on this brand.
              </Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
              accessibilityRole="tablist"
            >
              {FILTER_OPTIONS.map((opt) => {
                const isActive = opt.id === categoryFilter;
                return (
                  <Pressable
                    key={opt.id}
                    onPress={() => setCategoryFilter(opt.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Filter audit log by ${opt.label}`}
                    accessibilityState={{ selected: isActive }}
                    style={styles.filterChipPressable}
                  >
                    <Pill variant={isActive ? "accent" : "draft"}>
                      {opt.label}
                    </Pill>
                  </Pressable>
                );
              })}
            </ScrollView>

            {isLoading ? (
              <View style={styles.spinnerHost}>
                <Spinner />
              </View>
            ) : isError ? (
              <View style={styles.emptyHost}>
                <EmptyState
                  illustration="bell"
                  title="Couldn't load audit log"
                  description="Tap back and try again. If this keeps happening, check your connection."
                />
              </View>
            ) : displayRows.length === 0 ? (
              <View style={styles.emptyHost}>
                <EmptyState
                  illustration="receipt"
                  title={
                    categoryFilter === "all"
                      ? "No audit entries yet"
                      : "No events match this filter"
                  }
                  description={
                    categoryFilter === "all"
                      ? "Acted-on items show up here as the backend wires server-side recording."
                      : "Try a different category or 'All'."
                  }
                />
              </View>
            ) : (
              <>
                {displayRows.map((r) => (
                  <View key={r.id} style={styles.row}>
                    <View style={styles.iconCol}>
                      <Icon name={r.iconName} size={18} color={accent.warm} />
                    </View>
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle}>{r.title}</Text>
                      {r.detail !== undefined ? (
                        <Text style={styles.rowDetail}>{r.detail}</Text>
                      ) : null}
                      <Text style={styles.rowMeta}>
                        {r.relativeTime} · {r.actorSummary} · {r.targetSummary}
                      </Text>
                    </View>
                  </View>
                ))}
                {hasMore ? (
                  <View style={styles.loadMoreHost}>
                    <Button
                      label={isFetchingMore ? "Loading…" : "Load more"}
                      onPress={handleLoadMore}
                      variant="secondary"
                      size="md"
                      disabled={isFetchingMore}
                    />
                  </View>
                ) : null}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  banner: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    padding: spacing.sm + 2,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(59, 130, 246, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.24)",
  },
  bannerText: {
    fontSize: 12,
    color: textTokens.secondary,
    lineHeight: 18,
  },
  filterRow: {
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  filterChipPressable: {
    marginRight: 0,
  },
  emptyHost: {
    paddingTop: spacing.xl,
    alignItems: "center",
  },
  spinnerHost: {
    paddingTop: spacing.xl,
    alignItems: "center",
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    marginBottom: spacing.xs + 2,
  },
  iconCol: {
    width: 26,
    alignItems: "center",
    paddingTop: 2,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: 2,
  },
  rowDetail: {
    fontSize: 12,
    color: textTokens.secondary,
    lineHeight: 16,
    marginBottom: 2,
  },
  rowMeta: {
    fontSize: 11,
    color: textTokens.tertiary,
  },
  loadMoreHost: {
    marginTop: spacing.md,
    alignItems: "center",
  },
});
