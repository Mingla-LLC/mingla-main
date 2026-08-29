import React from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { captureCompetitorIntelligenceEvent } from "../../../analytics/competitorIntelligenceAnalytics";
import {
  spacing,
  semantic,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import { useCompetitorBrief } from "../../../hooks/useCompetitorIntelligence";
import { openExternal } from "../../../services/guestFunnelLink";
import type {
  CompetitorBriefEvidence,
  CompetitorWatchRow,
} from "../../../types/growthTools";
import { Button } from "../../ui/Button";
import { GlassCard } from "../../ui/GlassCard";
import { Sheet } from "../../ui/Sheet";

export function openCompetitorPublicUrl(url: string): void {
  const failed = (): void =>
    AccessibilityInfo.announceForAccessibility(
      "We couldn’t open that source. Try again.",
    );
  if (!/^https?:\/\//i.test(url)) {
    failed();
    return;
  }
  if (Platform.OS === "web") {
    try {
      openExternal(url);
    } catch {
      failed();
    }
    return;
  }
  void Linking.openURL(url).catch((error: unknown) => {
    console.error(
      "[CompetitorIntelligence] external source open failed",
      error instanceof Error ? error.message : "unknown",
    );
    failed();
  });
}

export function CompetitorBriefSheet({
  visible,
  onClose,
  brandId,
  venueName = null,
  row,
}: {
  visible: boolean;
  onClose: () => void;
  brandId: string | null;
  venueName?: string | null;
  row: CompetitorWatchRow | null;
}): React.ReactElement {
  const query = useCompetitorBrief(brandId, row?.id ?? null, visible);
  const data = query.data;
  const tiktok =
    data?.sources?.find((source) => source.kind === "tiktok") ??
    row?.sources?.find((source) => source.kind === "tiktok");
  const changedAt = data?.updatedAt ?? row?.lastBriefUpdatedAt ?? null;
  const firstBrief =
    !changedAt ||
    Math.abs(Date.parse(changedAt) - Date.parse(row?.createdAt ?? "")) <
      86_400_000;
  const generic = data?.brief
    ? data.brief.whatChanged.every((fact) =>
        /Mingla checked .*public|public information was checked/i.test(
          fact.text,
        ),
      )
    : false;
  const primaryAction = data?.brief?.worthDoing.find(
    (action) => action.isPrimary,
  );
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoint="full"
      presentation="competition"
      style={styles.sheet}
      testID="competitor-brief-sheet"
    >
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.eyebrow}>WEEKLY BRIEF</Text>
            <Button
              label="Close"
              accessibilityLabel="Close weekly competitor brief"
              variant="ghost"
              size="md"
              onPress={onClose}
            />
          </View>
          <Text accessibilityRole="header" style={styles.title}>
            {row?.name ?? "Weekly competitor brief"}
          </Text>
          {row?.city ? <Text style={styles.meta}>{row.city}</Text> : null}
          <View style={styles.statusRail}>
            <Text
              style={styles.status}
              testID="competitor-brief-sheet-header-status"
            >
              {freshnessLabel(data?.freshness ?? row?.freshness)}
            </Text>
            {changedAt ? (
              <Text
                style={styles.meta}
              >{`Updated ${formatDateTime(changedAt)}`}</Text>
            ) : null}
            {(data?.nextRefreshAt ?? row?.nextRefreshAt) ? (
              <Text
                style={styles.meta}
              >{`Next check ${formatScheduleTime(data?.nextRefreshAt ?? row?.nextRefreshAt ?? "")}`}</Text>
            ) : null}
          </View>
        </View>
        {query.isLoading ? (
          <ActivityIndicator
            accessibilityLabel="Loading weekly competitor brief"
            color={textTokens.secondary}
          />
        ) : null}
        {query.isError ? (
          <GlassCard variant="base">
            <Text style={styles.error}>
              Couldn&apos;t load competitor insights.
            </Text>
            <Button
              label="Try again"
              variant="secondary"
              size="md"
              onPress={() => void query.refetch()}
            />
          </GlassCard>
        ) : null}
        {data?.noMeaningfulChange ? (
          <Text style={styles.changed}>
            No meaningful public change this week
          </Text>
        ) : null}
        {data?.brief && !generic ? (
          <>
            <Section
              title={
                firstBrief
                  ? "CURRENT PUBLIC OBSERVATIONS"
                  : `WHAT CHANGED SINCE ${new Date(row?.createdAt ?? changedAt ?? "").toLocaleDateString()}`
              }
              testID="competitor-brief-sheet-section-what-changed"
            >
              {data.brief.whatChanged.map((fact, index) => {
                const evidence = data.brief?.evidence.find(
                  (item) => item.id === fact.evidenceId,
                );
                return (
                  <View
                    key={fact.id}
                    style={styles.fact}
                    testID={`competitor-brief-sheet-fact-${fact.id}`}
                  >
                    <Text
                      style={styles.provenance}
                    >{`${index + 1}. Observed fact`}</Text>
                    <Text style={styles.copy}>{fact.text}</Text>
                    {evidence ? (
                      <EvidenceRow
                        evidence={evidence}
                        row={row}
                        linked
                        testID={`competitor-brief-sheet-fact-${fact.id}-evidence`}
                      />
                    ) : null}
                  </View>
                );
              })}
            </Section>
            <Section
              title={
                venueName
                  ? `WHY THIS MAY MATTER TO ${venueName.toUpperCase()}`
                  : "WHY IT MAY MATTER TO YOUR VENUE"
              }
              testID="competitor-brief-sheet-section-why"
            >
              {data.brief.whyItMatters.map((item, index) => (
                <View
                  style={styles.interpretation}
                  key={`${item.text}-${index}`}
                  testID={`competitor-brief-sheet-interpretation-${index}`}
                >
                  <Text style={styles.provenance}>Mingla interpretation</Text>
                  <Text style={styles.copy}>{item.text}</Text>
                </View>
              ))}
            </Section>
            <Section
              title="WORTH DOING NEXT"
              testID="competitor-brief-sheet-section-actions"
            >
              {primaryAction ? (
                <GlassCard
                  key={primaryAction.id}
                  variant="elevated"
                  contentStyle={styles.action}
                  testID={`competitor-brief-sheet-action-${primaryAction.id}`}
                >
                  <Text style={styles.provenance}>Suggested action</Text>
                  <Text style={styles.copy}>{primaryAction.text}</Text>
                </GlassCard>
              ) : null}
            </Section>
            <Section
              title="SOURCE EVIDENCE"
              testID="competitor-brief-sheet-section-evidence"
            >
              {data.brief.evidence.map((evidence) => (
                <EvidenceRow
                  key={evidence.id}
                  evidence={evidence}
                  row={row}
                  testID={`competitor-brief-sheet-evidence-${evidence.id}`}
                />
              ))}
              {tiktok ? (
                <Button
                  label="Open TikTok"
                  variant="secondary"
                  size="md"
                  accessibilityLabel={`Open ${row?.name ?? "competitor"} on TikTok, opens outside Mingla`}
                  onPress={() => openCompetitorPublicUrl(tiktok.url)}
                  testID="competitor-brief-sheet-open-tiktok"
                />
              ) : null}
            </Section>
          </>
        ) : data && data.freshness === "refreshing" ? (
          <>
            <Text style={styles.changed}>
              Preparing your first sourced brief
            </Text>
            <Text style={styles.copy}>
              We&apos;re checking the public sources you added. This can take a
              moment.
            </Text>
          </>
        ) : null}
        {data?.brief && generic ? (
          <GlassCard
            variant="base"
            testID="competitor-brief-sheet-insufficient"
          >
            <Text style={styles.changed}>
              Not enough public detail for a useful brief yet
            </Text>
            <Text style={styles.copy}>
              We checked the saved source, but could not verify a specific
              public observation.
            </Text>
            {tiktok ? (
              <Button
                label="Open source"
                variant="secondary"
                size="md"
                onPress={() => openCompetitorPublicUrl(tiktok.url)}
              />
            ) : null}
          </GlassCard>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

function EvidenceRow({
  evidence,
  row,
  linked = false,
  testID,
}: {
  evidence: CompetitorBriefEvidence;
  row: CompetitorWatchRow | null;
  linked?: boolean;
  testID: string;
}): React.ReactElement {
  const source = row?.sources?.find((item) => item.id === evidence.sourceId);
  const sourceName =
    source?.kind === "instagram"
      ? "Instagram"
      : source?.kind === "website"
        ? "Website"
        : "Source";
  return (
    <View
      style={[styles.evidence, linked ? styles.linkedEvidence : null]}
      testID={testID}
    >
      <Text style={styles.provenance}>{sourceName}</Text>
      <Text style={styles.copy}>{evidence.observation}</Text>
      {evidence.observedAt ? (
        <Text
          style={styles.meta}
        >{`Observed ${formatDateTime(evidence.observedAt)}`}</Text>
      ) : null}
      <Text
        style={styles.meta}
      >{`Checked ${formatDateTime(evidence.checkedAt)}`}</Text>
      <Button
        label="Open source evidence"
        variant="secondary"
        size="md"
        accessibilityLabel={`Open ${sourceName} source evidence, checked ${new Date(evidence.checkedAt).toLocaleDateString()}, opens outside Mingla`}
        onPress={() => {
          captureCompetitorIntelligenceEvent("competitor_evidence_opened", {
            watch_id: row?.id,
            schema_version: 2,
          });
          openCompetitorPublicUrl(evidence.publicUrl);
        }}
        testID={`${testID}-open`}
      />
    </View>
  );
}
function Section({
  title,
  testID,
  children,
}: {
  title: string;
  testID: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <View style={styles.section} testID={testID}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}
function freshnessLabel(value?: string): string {
  return value === "budget_delayed"
    ? "Refresh delayed"
    : value === "needs_attention"
      ? "Needs attention"
      : value === "link_only"
        ? "Link only"
        : value
          ? value.charAt(0).toUpperCase() + value.slice(1)
          : "Preparing";
}
function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—";
}
function formatScheduleTime(iso: string, nowMs = Date.now()): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  const now = new Date(nowMs);
  const day = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const days = Math.round((day - today) / 86_400_000);
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  if (days >= 2 && days <= 6)
    return `${date.toLocaleDateString([], { weekday: "long" })}, ${time}`;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}
const styles = StyleSheet.create({
  sheet: { width: "100%", maxWidth: 720 },
  body: { gap: spacing.lg, paddingBottom: spacing.xl },
  header: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.16)",
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  eyebrow: { ...typography.labelCap, color: textTokens.tertiary },
  title: { ...typography.h3, color: textTokens.primary },
  statusRail: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  status: { ...typography.caption, color: semantic.info },
  section: { gap: spacing.sm + spacing.xs, marginTop: spacing.sm },
  sectionTitle: { ...typography.labelCap, color: textTokens.secondary },
  fact: {
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 12,
  },
  interpretation: {
    gap: spacing.sm,
    paddingLeft: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: semantic.info,
  },
  action: { gap: spacing.sm, padding: spacing.md + spacing.xs },
  evidence: {
    minHeight: 56,
    gap: spacing.xs,
    paddingVertical: spacing.sm + spacing.xs,
  },
  linkedEvidence: {
    marginTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.12)",
  },
  provenance: { ...typography.labelCap, color: textTokens.tertiary },
  copy: { ...typography.body, color: textTokens.primary },
  changed: { ...typography.body, color: textTokens.primary, fontWeight: "600" },
  meta: { ...typography.caption, color: textTokens.tertiary },
  error: { ...typography.bodySm, color: semantic.error },
});
export default CompetitorBriefSheet;
