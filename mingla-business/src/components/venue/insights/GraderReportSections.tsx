/**
 * Issue #1735 G-8 — the grader full-report renderers (design v1 §3.1 sheet
 * sections carried verbatim; ORDER BINDING):
 *
 *   screenshot before/after → score + 5 sub-scores → 11 site signals →
 *   fixes ≤6 → rewritten hero → competition + head-to-head → AI read →
 *   honesty rail.
 *
 * Parser is DEFENSIVE: every section tolerates absent/malformed fields and
 * renders NOTHING (never fabricates — Constitution #9); `meta.schema_version`
 * absence is legal (P-11 legacy rows). Shared by the site workspace AND the
 * competitor report sheet (same report shape — G-9).
 *
 * Icons: ONLY glyphs already registered in the web lucide shim's USED_ICONS
 * (Check / AlertTriangle / X) — a new name would trip the INV-4 drift gate.
 * GlassCard layout keys via `contentStyle` ONLY (GlassCard.tsx footgun).
 */

import React from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { AlertTriangle, Check, X } from "lucide-react-native";

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import type {
  GraderReport,
  GraderSiteSignal,
} from "../../../services/growthToolsService";
import { GlassCard } from "../../ui/GlassCard";
import {
  GRADER_SUB_SCORE_LABELS,
  formatCheckedDate,
  graderSubScoreKeys,
} from "./insightsInstruments";

const MAX_FIXES = 6;

function SignalGlyph({ status }: { status: string }): React.ReactElement {
  if (status === "pass") return <Check size={16} color={semantic.success} />;
  if (status === "warn") {
    return <AlertTriangle size={16} color={semantic.warning} />;
  }
  return <X size={16} color={semantic.error} />;
}

function isRenderableSignal(
  signal: GraderSiteSignal,
): signal is { key: string; label: string; status: string; detail?: string } {
  return (
    typeof signal?.key === "string" &&
    typeof signal?.label === "string" &&
    (signal.status === "pass" || signal.status === "warn" ||
      signal.status === "fail")
  );
}

export interface GraderReportSectionsProps {
  report: GraderReport;
  testID?: string;
}

export function GraderReportSections({
  report,
  testID = "grader-report",
}: GraderReportSectionsProps): React.ReactElement {
  const scores = report.scores;
  const beforeUrl = report.screenshot?.image_url ?? null;
  const afterUrl = report.screenshot?.after_url ?? null;
  const signals = (report.site_signals?.checks ?? []).filter(isRenderableSignal);
  const fetchFailed = report.meta?.fetch_failed === true;
  const fixes = Array.isArray(report.fixes)
    ? report.fixes
      .filter((f) => typeof f?.title === "string" && f.title.trim().length > 0)
      .slice(0, MAX_FIXES)
    : [];
  const hero = report.rewritten_hero;
  const heroRenderable = typeof hero?.after_copy === "string" &&
    hero.after_copy.trim().length > 0;
  const competitors = Array.isArray(report.competition?.competitors)
    ? report.competition.competitors.filter(
      (c) => typeof c?.name === "string" && c.name.trim().length > 0,
    )
    : [];
  const headToHeadRows = Array.isArray(report.head_to_head?.rows)
    ? report.head_to_head.rows.filter(
      (r) =>
        typeof r?.dimension === "string" &&
        typeof r?.you === "string" &&
        typeof r?.them === "string",
    )
    : [];
  const aiRead = typeof report.ai_read === "string" &&
      report.ai_read.trim().length > 0
    ? report.ai_read.trim()
    : null;
  const checkedDate = formatCheckedDate(report.meta?.generated_at);

  return (
    <View style={styles.column} testID={testID}>
      {/* 1 — screenshot before/after (absent when both null). */}
      {beforeUrl !== null || afterUrl !== null ? (
        <GlassCard variant="base" contentStyle={styles.cardContent}>
          <Text style={styles.sectionCap}>YOUR SITE, BEFORE AND AFTER</Text>
          {beforeUrl !== null ? (
            <View style={styles.shotWrap}>
              <Text style={styles.shotLabel}>Now</Text>
              <Image
                source={{ uri: beforeUrl }}
                style={styles.shot}
                resizeMode="cover"
                accessibilityLabel="Screenshot of the website today"
              />
            </View>
          ) : null}
          {afterUrl !== null ? (
            <View style={styles.shotWrap}>
              <Text style={styles.shotLabel}>With Mingla</Text>
              <Image
                source={{ uri: afterUrl }}
                style={styles.shot}
                resizeMode="cover"
                accessibilityLabel="Preview of the redesigned page"
              />
            </View>
          ) : null}
        </GlassCard>
      ) : null}

      {/* 2 — score + 5 sub-scores. */}
      {scores !== undefined &&
          (typeof scores.overall === "number" ||
            typeof scores.grade === "string")
        ? (
          <GlassCard variant="base" contentStyle={styles.cardContent}>
            <Text style={styles.sectionCap}>SCORE</Text>
            <View style={styles.scoreHeadRow}>
              {typeof scores.grade === "string" ? (
                <Text style={styles.scoreGrade}>{scores.grade}</Text>
              ) : null}
              {typeof scores.overall === "number" &&
                  Number.isFinite(scores.overall)
                ? (
                  <Text style={styles.scoreOverall}>
                    {`${Math.round(scores.overall)} / 100`}
                  </Text>
                )
                : null}
            </View>
            <View style={styles.subScoreList}>
              {graderSubScoreKeys().map((key) => {
                const value = scores[key];
                if (typeof value !== "number" || !Number.isFinite(value)) {
                  return null;
                }
                const pct = Math.max(0, Math.min(100, Math.round(value)));
                return (
                  <View
                    key={key}
                    style={styles.subScoreRow}
                    accessibilityLabel={`${
                      GRADER_SUB_SCORE_LABELS[key]
                    }: ${pct} out of 100`}
                  >
                    <Text style={styles.subScoreLabel} numberOfLines={1}>
                      {GRADER_SUB_SCORE_LABELS[key]}
                    </Text>
                    <View style={styles.subScoreTrack}>
                      <View
                        style={[styles.subScoreFill, { width: `${pct}%` }]}
                      />
                    </View>
                    <Text style={styles.subScoreValue}>{pct}</Text>
                  </View>
                );
              })}
            </View>
          </GlassCard>
        )
        : null}

      {/* 3 — 11 site signals (fetch_failed → the honest unreachable line). */}
      {fetchFailed || signals.length > 0 ? (
        <GlassCard variant="base" contentStyle={styles.cardContent}>
          <Text style={styles.sectionCap}>SITE SIGNALS</Text>
          {fetchFailed ? (
            <Text style={styles.bodySm} testID={`${testID}-signals-unreachable`}>
              The website couldn&apos;t be reached during this check — signal
              results aren&apos;t available.
            </Text>
          ) : (
            <View style={styles.signalList}>
              {signals.map((signal) => (
                <View
                  key={signal.key}
                  style={styles.signalRow}
                  accessibilityLabel={`${signal.label}: ${signal.status}. ${
                    signal.detail ?? ""
                  }`}
                >
                  <SignalGlyph status={signal.status} />
                  <View style={styles.signalTextWrap}>
                    <Text style={styles.signalLabel}>{signal.label}</Text>
                    {typeof signal.detail === "string" &&
                        signal.detail.trim().length > 0
                      ? <Text style={styles.signalDetail}>{signal.detail}</Text>
                      : null}
                  </View>
                </View>
              ))}
            </View>
          )}
        </GlassCard>
      ) : null}

      {/* 4 — fixes ≤6. */}
      {fixes.length > 0 ? (
        <GlassCard variant="base" contentStyle={styles.cardContent}>
          <Text style={styles.sectionCap}>FIXES</Text>
          <View style={styles.signalList}>
            {fixes.map((fix, index) => (
              <View key={`${fix.title}-${index}`} style={styles.fixRow}>
                <View style={styles.fixHeadRow}>
                  <Text style={styles.fixTitle}>{fix.title}</Text>
                  {fix.impact === "high" ? (
                    <View style={styles.fixImpactPill}>
                      <Text style={styles.fixImpactText}>HIGH IMPACT</Text>
                    </View>
                  ) : null}
                </View>
                {typeof fix.why === "string" && fix.why.trim().length > 0
                  ? <Text style={styles.bodySm}>{fix.why}</Text>
                  : null}
                {typeof fix.change === "string" && fix.change.trim().length > 0
                  ? <Text style={styles.fixChange}>{fix.change}</Text>
                  : null}
              </View>
            ))}
          </View>
        </GlassCard>
      ) : null}

      {/* 5 — rewritten hero. */}
      {heroRenderable ? (
        <GlassCard variant="base" contentStyle={styles.cardContent}>
          <Text style={styles.sectionCap}>YOUR HERO, REWRITTEN</Text>
          {typeof hero?.before_excerpt === "string" &&
              hero.before_excerpt.trim().length > 0
            ? <Text style={styles.heroBefore}>{hero.before_excerpt.trim()}</Text>
            : null}
          <Text style={styles.heroAfter}>{hero?.after_copy?.trim()}</Text>
        </GlassCard>
      ) : null}

      {/* 6 — competition + head-to-head (conditional keys; horizontal scroll). */}
      {competitors.length > 0 || headToHeadRows.length > 0 ? (
        <GlassCard variant="base" contentStyle={styles.cardContent}>
          <Text style={styles.sectionCap}>THE COMPETITION</Text>
          {typeof report.competition?.your_rank_read === "string" &&
              report.competition.your_rank_read.trim().length > 0
            ? (
              <Text style={styles.bodySm}>
                {report.competition.your_rank_read.trim()}
              </Text>
            )
            : null}
          {competitors.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.compRow}
            >
              {competitors.map((competitor, index) => (
                <View key={`${competitor.name}-${index}`} style={styles.compCard}>
                  <Text style={styles.compName} numberOfLines={1}>
                    {competitor.name}
                  </Text>
                  {typeof competitor.city === "string" &&
                      competitor.city.trim().length > 0
                    ? (
                      <Text style={styles.compCity} numberOfLines={1}>
                        {competitor.city}
                      </Text>
                    )
                    : null}
                  {Array.isArray(competitor.what_they_do_better) &&
                      typeof competitor.what_they_do_better[0] === "string"
                    ? (
                      <Text style={styles.compBetter} numberOfLines={3}>
                        {competitor.what_they_do_better[0]}
                      </Text>
                    )
                    : null}
                </View>
              ))}
            </ScrollView>
          ) : null}
          {headToHeadRows.length > 0 ? (
            <View style={styles.h2hWrap}>
              {typeof report.head_to_head?.competitor === "string" ? (
                <Text style={styles.h2hTitle}>
                  {`Head to head vs ${report.head_to_head.competitor}`}
                </Text>
              ) : null}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.h2hScroll}
              >
                <View>
                  {headToHeadRows.map((row, index) => (
                    <View key={`${row.dimension}-${index}`} style={styles.h2hRow}>
                      <Text style={styles.h2hDimension} numberOfLines={1}>
                        {row.dimension}
                      </Text>
                      <Text
                        style={[
                          styles.h2hCell,
                          row.winner === "you" ? styles.h2hWin : null,
                        ]}
                        numberOfLines={2}
                      >
                        {row.you}
                      </Text>
                      <Text
                        style={[
                          styles.h2hCell,
                          row.winner === "them" ? styles.h2hWin : null,
                        ]}
                        numberOfLines={2}
                      >
                        {row.them}
                      </Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>
          ) : null}
        </GlassCard>
      ) : null}

      {/* 7 — AI read. */}
      {aiRead !== null ? (
        <GlassCard variant="base" contentStyle={styles.cardContent}>
          <Text style={styles.sectionCap}>THE AI READ</Text>
          <Text style={styles.bodySm}>{aiRead}</Text>
        </GlassCard>
      ) : null}

      {/* Honesty rail — load-bearing, never dropped. */}
      <View style={styles.honestyWrap}>
        <Text style={styles.honesty}>
          {checkedDate !== null
            ? `Checked ${checkedDate} · AI-scored — re-run after you update your site.`
            : "AI-scored — re-run after you update your site."}
        </Text>
        {report.meta?.competition_source === "pool_only" ? (
          <Text style={styles.honesty}>
            Based on our directory — live competitor research unavailable right
            now.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    gap: spacing.md,
  },
  cardContent: {
    gap: spacing.sm,
  },
  sectionCap: {
    ...typography.labelCap,
    color: textTokens.secondary,
  },
  bodySm: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  // screenshots
  shotWrap: {
    gap: spacing.xs,
  },
  shotLabel: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  shot: {
    width: "100%",
    aspectRatio: 16 / 10,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
  },
  // scores
  scoreHeadRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
  },
  scoreGrade: {
    ...typography.statValue,
    color: textTokens.primary,
  },
  scoreOverall: {
    ...typography.bodySm,
    color: textTokens.secondary,
    paddingBottom: 4,
  },
  subScoreList: {
    gap: spacing.sm,
  },
  subScoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  subScoreLabel: {
    width: 118,
    ...typography.caption,
    color: textTokens.secondary,
  },
  subScoreTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: glass.tint.profileBase,
    overflow: "hidden",
  },
  subScoreFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: accent.warm,
  },
  subScoreValue: {
    width: 28,
    textAlign: "right",
    ...typography.caption,
    fontWeight: "700",
    color: textTokens.primary,
  },
  // signals
  signalList: {
    gap: spacing.sm,
  },
  signalRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  signalTextWrap: {
    flex: 1,
    gap: 2,
  },
  signalLabel: {
    ...typography.bodySm,
    fontWeight: "600",
    color: textTokens.primary,
  },
  signalDetail: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  // fixes
  fixRow: {
    gap: 4,
  },
  fixHeadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  fixTitle: {
    flexShrink: 1,
    ...typography.bodySm,
    fontWeight: "600",
    color: textTokens.primary,
  },
  fixImpactPill: {
    backgroundColor: glass.tint.badge.idle,
    borderColor: glass.border.badge,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  fixImpactText: {
    ...typography.micro,
    color: textTokens.secondary,
  },
  fixChange: {
    ...typography.bodySm,
    color: textTokens.primary,
  },
  // hero
  heroBefore: {
    ...typography.bodySm,
    color: textTokens.tertiary,
  },
  heroAfter: {
    ...typography.body,
    color: textTokens.primary,
  },
  // competition
  compRow: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  compCard: {
    width: 200,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    padding: spacing.sm,
    gap: 4,
  },
  compName: {
    ...typography.bodySm,
    fontWeight: "600",
    color: textTokens.primary,
  },
  compCity: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  compBetter: {
    ...typography.caption,
    color: textTokens.secondary,
  },
  h2hWrap: {
    gap: spacing.xs,
  },
  h2hTitle: {
    ...typography.bodySm,
    fontWeight: "600",
    color: textTokens.primary,
  },
  h2hScroll: {
    paddingVertical: spacing.xs,
  },
  h2hRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: 4,
  },
  h2hDimension: {
    width: 120,
    ...typography.caption,
    color: textTokens.tertiary,
  },
  h2hCell: {
    width: 150,
    ...typography.caption,
    color: textTokens.secondary,
  },
  h2hWin: {
    color: semantic.success,
    fontWeight: "600",
  },
  // honesty rail
  honestyWrap: {
    gap: 2,
  },
  honesty: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
});

export default GraderReportSections;
