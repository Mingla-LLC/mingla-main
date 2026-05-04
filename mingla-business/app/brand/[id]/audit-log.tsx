/**
 * /brand/[id]/audit-log — J-T5 read-only audit log viewer (Cycle 13a).
 *
 * Route-level rank gate: only brand_admin+ (rank >= 50) sees the actual
 * list. Below-threshold users see "Insufficient permissions" empty state.
 *
 * RLS today scopes audit_log SELECT to `user_id = auth.uid()` — users see
 * only their own actions. Brand-admin-can-read-all is queued for B-cycle
 * (SPEC §10.4). The TRANSITIONAL banner is honest about this.
 *
 * Hook ordering follows ORCH-0710: ALL hooks run on every render before any
 * early-return shell.
 *
 * Per Cycle 13a SPEC §4.12.
 */

import React, { useCallback, useMemo } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "../../../src/components/ui/EmptyState";
import { Spinner } from "../../../src/components/ui/Spinner";
import { TopBar } from "../../../src/components/ui/TopBar";
import {
  canvas,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { useAuditLog, type AuditLogRow } from "../../../src/hooks/useAuditLog";
import { useCurrentBrandRole } from "../../../src/hooks/useCurrentBrandRole";
import { canPerformAction } from "../../../src/utils/permissionGates";
import { formatRelativeTime } from "../../../src/utils/relativeTime";

const truncId = (id: string | null): string =>
  id === null ? "—" : `…${id.slice(-6)}`;

interface DisplayRow {
  id: string;
  action: string;
  targetSummary: string;
  actorSummary: string;
  relativeTime: string;
}

const toDisplayRow = (row: AuditLogRow): DisplayRow => {
  const targetSummary =
    row.target_type !== null && row.target_id !== null
      ? `${row.target_type} ${truncId(row.target_id)}`
      : row.target_type !== null
        ? row.target_type
        : "—";
  const actorSummary =
    row.user_id !== null
      ? `User …${row.user_id.slice(-6)}`
      : "System";
  return {
    id: row.id,
    action: row.action,
    targetSummary,
    actorSummary,
    relativeTime: formatRelativeTime(row.created_at),
  };
};

export default function AuditLogRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const brandIdResolved =
    typeof idParam === "string" && idParam.length > 0 ? idParam : null;

  const { rank, isLoading: roleLoading } = useCurrentBrandRole(brandIdResolved);
  const { rows, isLoading: rowsLoading, isError } = useAuditLog(
    brandIdResolved,
  );

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
                Audit log fills as the backend wires server-side recording in
                B-cycle. You currently see your own actions only — brand-wide
                visibility for admins lands later.
              </Text>
            </View>

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
                  title="No audit entries yet"
                  description="Acted-on items show up here as the backend wires server-side recording."
                />
              </View>
            ) : (
              displayRows.map((r) => (
                <View key={r.id} style={styles.row}>
                  <View style={styles.rowTopLine}>
                    <Text style={styles.rowAction}>{r.action}</Text>
                    <Text style={styles.rowTime}>{r.relativeTime}</Text>
                  </View>
                  <Text style={styles.rowTarget}>{r.targetSummary}</Text>
                  <Text style={styles.rowActor}>{r.actorSummary}</Text>
                </View>
              ))
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
  emptyHost: {
    paddingTop: spacing.xl,
    alignItems: "center",
  },
  spinnerHost: {
    paddingTop: spacing.xl,
    alignItems: "center",
  },
  row: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    marginBottom: spacing.xs + 2,
  },
  rowTopLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  rowAction: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
    fontFamily: "monospace",
  },
  rowTime: {
    fontSize: 12,
    color: textTokens.tertiary,
  },
  rowTarget: {
    fontSize: 12,
    color: textTokens.secondary,
  },
  rowActor: {
    fontSize: 11,
    color: textTokens.tertiary,
    marginTop: 2,
  },
});
