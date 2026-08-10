/**
 * Issue #1735 G-9..G-13 — the competitor watch (list · per-row grade ·
 * deterministic diff chips · remove).
 *
 * Data = the LIVE P-46 CRUD actions (`useCompetitorWatch` etc. — deployed
 * #1734 platform wave). Grading is EXPLICIT and metered: one full grader run
 * per tap against the shared venues quota (P-47); NO batch button (decision
 * row 17). Diff chips come exclusively from `diffGraderReports` over the two
 * newest persisted reports (P-49; I-PROPOSED-1735-COMPETITOR-DIFF-
 * DETERMINISTIC). Removal states the product truth (P-48): history is
 * archived, never deleted — no client copy may promise deletion.
 *
 * Failures on this explicit-tap surface SPEAK (row-level visible error +
 * retry) — never hide-silently. Every dated grade carries its date; >60-day
 * checks render the date in warning tone with "Re-check?".
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import {
  captureIntelCompetitorGraded,
  captureIntelReportOpened,
  captureIntelRunCompleted,
  captureIntelRunFailed,
  captureIntelRunStarted,
} from "../../../analytics/businessAnalyticsEvents";
import type { CompetitorWatchRow } from "../../../services/growthToolsService";
import {
  useCompetitorWatch,
  useIntelRun,
  useIntelSubjectLatest,
  useRemoveCompetitor,
} from "../../../hooks/useGrowthTools";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { GlassCard } from "../../ui/GlassCard";
import { GradeBadge } from "./GradeBadge";
import { diffGraderReports } from "./graderReportDiff";
import {
  competitorCheckIsStale,
  formatCheckedDate,
} from "./insightsInstruments";

export const COMPETITOR_WATCH_CAP = 5;

export interface CompetitorWatchSectionProps {
  brandId: string | null;
  venueListingId: string | null;
  offline: boolean;
  /** Module opens the add sheet (sheets live at the module root — I-13). */
  onRequestAdd: (atCap: boolean) => void;
  /** Module opens the full competitor report (same G-8 renderers). */
  onOpenReport: (row: CompetitorWatchRow) => void;
  testID?: string;
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : "?";
}

/** Row expansion — mounts the two-report read ONLY while expanded (G-12). */
function CompetitorRowExpansion({
  brandId,
  row,
  onOpenReport,
  testID,
}: {
  brandId: string | null;
  row: CompetitorWatchRow;
  onOpenReport: (row: CompetitorWatchRow) => void;
  testID: string;
}): React.ReactElement {
  const latestQuery = useIntelSubjectLatest(
    brandId,
    "venues",
    `competitor:${row.id}`,
    { includePrevious: true, enabled: row.latest !== null },
  );

  const diff = useMemo(() => {
    const data = latestQuery.data;
    if (data === undefined || data.status !== "report_ready") return null;
    if (data.previous === null) return null; // single run — no chips, no diff UI.
    return diffGraderReports(
      { report: data.previous.report, createdAt: data.previous.createdAt },
      { report: data.latest.report, createdAt: data.latest.createdAt },
    );
  }, [latestQuery.data]);

  return (
    <View style={styles.expansion} testID={testID}>
      {row.latest !== null && latestQuery.isLoading ? (
        <ActivityIndicator size="small" color={textTokens.tertiary} />
      ) : null}
      {row.latest !== null && latestQuery.isError ? (
        <View style={styles.expansionErrorRow}>
          <Text style={styles.errorLine}>
            Couldn&apos;t load their check history — try again.
          </Text>
          <Button
            label="Retry"
            variant="ghost"
            size="sm"
            onPress={() => {
              void latestQuery.refetch();
            }}
          />
        </View>
      ) : null}
      {diff !== null ? (
        <View style={styles.diffWrap} testID={`${testID}-diff`}>
          <Text style={styles.diffCap}>WHAT CHANGED</Text>
          {diff.chips.length > 0 ? (
            <View style={styles.chipRow}>
              {diff.chips.map((chip) => (
                <View key={chip.label} style={styles.chip}>
                  <Text style={styles.chipText}>{chip.label}</Text>
                </View>
              ))}
              {diff.overflowCount > 0 ? (
                <View style={styles.chip}>
                  <Text style={styles.chipText}>
                    {`+${diff.overflowCount} more in the report`}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : (
            <Text style={styles.diffQuiet}>No changes between checks.</Text>
          )}
          {diff.unreadableOnIso !== null ? (
            <Text style={styles.diffQuiet}>
              {`Their site couldn't be read on ${
                formatCheckedDate(diff.unreadableOnIso) ?? "the last check"
              }.`}
            </Text>
          ) : null}
          {/* Dated footer on every chip row (G-12 rule 4). */}
          <Text style={styles.diffDates}>
            {`${formatCheckedDate(diff.prevCreatedAt) ?? "—"} → ${
              formatCheckedDate(diff.latestCreatedAt) ?? "—"
            }`}
          </Text>
        </View>
      ) : null}
      {row.latest !== null ? (
        <Button
          label="See their report"
          variant="secondary"
          size="sm"
          onPress={() => {
            captureIntelReportOpened("insights_competitor", row.latest?.grade ?? null);
            onOpenReport(row);
          }}
          testID={`${testID}-see-report`}
        />
      ) : null}
      {/* G-9 honesty rail — verbatim, dated, on every competitor surface. */}
      {row.latest !== null ? (
        <Text style={styles.honesty}>
          {`A read of their public website on ${
            formatCheckedDate(row.latest.checkedAt) ?? "the dated check"
          } — their site, not their business.`}
        </Text>
      ) : null}
    </View>
  );
}

export function CompetitorWatchSection({
  brandId,
  venueListingId,
  offline,
  onRequestAdd,
  onOpenReport,
  testID = "competitor-watch",
}: CompetitorWatchSectionProps): React.ReactElement {
  const watchQuery = useCompetitorWatch(brandId, venueListingId);
  const rows = watchQuery.data ?? [];
  const run = useIntelRun();
  const removeMutation = useRemoveCompetitor(brandId, venueListingId);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [gradingId, setGradingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; rateLimited: boolean } | null>(
    null,
  );
  const [removeTarget, setRemoveTarget] = useState<CompetitorWatchRow | null>(null);

  const atCap = rows.length >= COMPETITOR_WATCH_CAP;

  const gradeCompetitor = useCallback(
    (row: CompetitorWatchRow): void => {
      if (brandId === null || run.isPending || offline) return;
      setGradingId(row.id);
      setRowError(null);
      captureIntelRunStarted("insights_competitor");
      run.mutate(
        {
          tool: "venues",
          brandId,
          // Mirrored from the watch row for validation symmetry — the server
          // takes the engine input FROM THE ROW regardless (P-41, the
          // diff-determinism guarantee).
          input: {
            name: row.name,
            city: row.city ?? "",
            website: row.website ?? "",
          },
          subject: { type: "competitor", id: row.id },
          venueListingId,
        },
        {
          onSuccess: (result) => {
            setGradingId(null);
            const grade = typeof result.report.scores?.grade === "string"
              ? result.report.scores.grade
              : null;
            captureIntelRunCompleted("insights_competitor", grade);
            captureIntelCompetitorGraded(grade);
          },
          onError: (error) => {
            setGradingId(null);
            setRowError({ id: row.id, rateLimited: error.code === "rate_limited" });
            captureIntelRunFailed("insights_competitor");
          },
        },
      );
    },
    [brandId, venueListingId, offline, run],
  );

  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.headRow}>
        <Text style={styles.headCap}>COMPETITION</Text>
        <Text style={styles.headCount}>
          {`Watching ${rows.length} of ${COMPETITOR_WATCH_CAP}`}
        </Text>
      </View>

      {watchQuery.isLoading ? (
        <GlassCard variant="base" contentStyle={styles.cardContent}>
          <ActivityIndicator size="small" color={textTokens.tertiary} />
        </GlassCard>
      ) : watchQuery.isError ? (
        // Standing surface — VISIBLE error + retry, never hide-silently.
        <GlassCard
          variant="base"
          contentStyle={styles.cardContent}
          testID={`${testID}-error`}
        >
          <Text style={styles.errorLine}>
            Couldn&apos;t load your competitor watch — try again.
          </Text>
          <View style={styles.actionRow}>
            <Button
              label="Try again"
              variant="secondary"
              size="sm"
              onPress={() => {
                void watchQuery.refetch();
              }}
              testID={`${testID}-retry`}
            />
          </View>
        </GlassCard>
      ) : rows.length === 0 ? (
        <GlassCard
          variant="base"
          contentStyle={styles.cardContent}
          testID={`${testID}-empty`}
        >
          <Text style={styles.bodySm}>
            Watch up to 5 competitors — we&apos;ll grade their sites the way we
            grade yours.
          </Text>
        </GlassCard>
      ) : (
        <GlassCard variant="base" padding={0} contentStyle={styles.listContent}>
          {rows.map((row, index) => {
            const grading = gradingId === row.id && run.isPending;
            const expanded = expandedId === row.id;
            const checkedDate = row.latest !== null
              ? formatCheckedDate(row.latest.checkedAt)
              : null;
            const staleCheck = row.latest !== null &&
              competitorCheckIsStale(row.latest.checkedAt);
            const thisRowError = rowError?.id === row.id ? rowError : null;
            return (
              <View
                key={row.id}
                style={[styles.rowWrap, index > 0 ? styles.rowDivider : null]}
              >
                {/* Row body + expansion toggle. Sibling Pressables (never
                    nested) so a11y keeps every target. */}
                <Pressable
                  style={styles.row}
                  onPress={() => setExpandedId(expanded ? null : row.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.name}${
                    row.city !== null ? `, ${row.city}` : ""
                  }. ${
                    row.latest !== null
                      ? `Grade ${row.latest.grade ?? "unknown"}${
                        checkedDate !== null ? `, checked ${checkedDate}` : ""
                      }.`
                      : "Not graded yet."
                  }`}
                  testID={`${testID}-row-${row.id}`}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initialOf(row.name)}</Text>
                  </View>
                  <View style={styles.rowTextWrap}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {row.name}
                    </Text>
                    {row.city !== null && row.city.length > 0 ? (
                      <Text style={styles.rowCity} numberOfLines={1}>
                        {row.city}
                      </Text>
                    ) : null}
                  </View>
                  {grading ? (
                    <ActivityIndicator
                      size="small"
                      color={textTokens.secondary}
                      testID={`${testID}-row-${row.id}-grading`}
                    />
                  ) : (
                    <GradeBadge grade={row.latest?.grade ?? null} size={28} />
                  )}
                  {checkedDate !== null ? (
                    <Text
                      style={[
                        styles.rowChecked,
                        staleCheck ? styles.rowCheckedStale : null,
                      ]}
                    >
                      {staleCheck
                        ? `${checkedDate} · Re-check?`
                        : `Checked ${checkedDate}`}
                    </Text>
                  ) : null}
                </Pressable>

                {thisRowError !== null ? (
                  <View style={styles.rowErrorWrap}>
                    <Text style={styles.errorLine}>
                      {thisRowError.rateLimited
                        ? "You've used today's checks — they refresh tomorrow."
                        : "Couldn't finish their check — try again."}
                    </Text>
                    {!thisRowError.rateLimited ? (
                      <Button
                        label="Retry"
                        variant="ghost"
                        size="sm"
                        onPress={() => gradeCompetitor(row)}
                        testID={`${testID}-row-${row.id}-retry`}
                      />
                    ) : null}
                  </View>
                ) : null}

                {expanded ? (
                  <>
                    <CompetitorRowExpansion
                      brandId={brandId}
                      row={row}
                      onOpenReport={onOpenReport}
                      testID={`${testID}-row-${row.id}-expansion`}
                    />
                    <View style={styles.rowActions}>
                      <Button
                        label={row.latest === null ? "Grade their site" : "Re-check"}
                        variant="secondary"
                        size="sm"
                        disabled={grading || offline || run.isPending}
                        onPress={() => gradeCompetitor(row)}
                        testID={`${testID}-row-${row.id}-grade`}
                      />
                      <Button
                        label="Remove"
                        variant="ghost"
                        size="sm"
                        onPress={() => setRemoveTarget(row)}
                        testID={`${testID}-row-${row.id}-remove`}
                      />
                    </View>
                  </>
                ) : null}
              </View>
            );
          })}
        </GlassCard>
      )}

      <View style={styles.addWrap}>
        <Button
          label="+ Watch a competitor"
          variant="secondary"
          size="md"
          fullWidth
          disabled={atCap || watchQuery.isLoading || watchQuery.isError}
          onPress={() => onRequestAdd(atCap)}
          accessibilityLabel="Watch a competitor"
          testID={`${testID}-add`}
        />
        {atCap ? (
          <Text style={styles.capLine} testID={`${testID}-cap`}>
            Watching 5 of 5 — remove one to add another.
          </Text>
        ) : null}
      </View>

      <ConfirmDialog
        visible={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => {
          const target = removeTarget;
          if (target === null) return;
          removeMutation.mutate(
            { competitorId: target.id },
            {
              onSuccess: () => setRemoveTarget(null),
              onError: (error) => {
                // Explicit-tap surface — the failure speaks via the dialog's
                // own error line; never a silent swallow.
                console.error("[CompetitorWatchSection] remove failed", error);
              },
            },
          );
        }}
        title={`Stop watching ${removeTarget?.name ?? "this competitor"}?`}
        description="Their check history is archived — re-adding them starts fresh."
        confirmLabel="Stop watching"
        destructive
        confirmLoading={removeMutation.isPending}
        errorMessage={removeMutation.isError
          ? "Couldn't remove them — try again."
          : null}
        testID={`${testID}-remove-confirm`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headCap: {
    ...typography.labelCap,
    color: textTokens.secondary,
  },
  headCount: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  cardContent: {
    gap: spacing.sm,
  },
  listContent: {
    padding: 0,
  },
  bodySm: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  actionRow: {
    flexDirection: "row",
  },
  errorLine: {
    ...typography.bodySm,
    color: semantic.error,
    flexShrink: 1,
  },
  // rows
  rowWrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
  },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: glass.tint.badge.idle,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.badge,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    ...typography.bodySm,
    fontWeight: "600",
    color: textTokens.primary,
  },
  rowTextWrap: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    ...typography.bodySm,
    fontWeight: "600",
    color: textTokens.primary,
  },
  rowCity: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  rowChecked: {
    ...typography.caption,
    color: textTokens.tertiary,
    maxWidth: 92,
    textAlign: "right",
  },
  rowCheckedStale: {
    color: semantic.warning,
  },
  rowErrorWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  rowActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  // expansion
  expansion: {
    gap: spacing.sm,
  },
  expansionErrorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  diffWrap: {
    gap: spacing.xs,
  },
  diffCap: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  chip: {
    backgroundColor: glass.tint.badge.idle,
    borderColor: glass.border.badge,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  chipText: {
    ...typography.caption,
    color: textTokens.primary,
  },
  diffQuiet: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  diffDates: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  addWrap: {
    gap: spacing.xs,
  },
  capLine: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  honesty: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
});

export default CompetitorWatchSection;
