import React from "react";
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { captureCompetitorIntelligenceEvent } from "../../../analytics/businessAnalyticsEvents";
import { spacing, semantic, text as textTokens, typography } from "../../../constants/designSystem";
import { useCompetitorBrief } from "../../../hooks/useCompetitorIntelligence";
import { openExternal } from "../../../services/guestFunnelLink";
import type { CompetitorWatchRow } from "../../../types/growthTools";
import { Button } from "../../ui/Button";
import { GlassCard } from "../../ui/GlassCard";
import { Sheet } from "../../ui/Sheet";

export function openCompetitorPublicUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  if (Platform.OS === "web") {
    openExternal(url);
    return;
  }
  void Linking.openURL(url).catch((error: unknown) => {
    console.error("[CompetitorIntelligence] external source open failed", error instanceof Error ? error.message : "unknown");
  });
}

export function CompetitorBriefSheet({ visible, onClose, brandId, row }: { visible: boolean; onClose: () => void; brandId: string | null; row: CompetitorWatchRow | null }): React.ReactElement {
  const query = useCompetitorBrief(brandId, row?.id ?? null, visible);
  const data = query.data;
  const tiktok = data?.sources?.find((source) => source.kind === "tiktok") ?? row?.sources?.find((source) => source.kind === "tiktok");
  return <Sheet visible={visible} onClose={onClose} snapPoint="full" testID="competitor-brief-sheet">
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.title}>{row?.name ?? "Weekly competitor brief"}</Text>
      {row?.city ? <Text style={styles.meta}>{row.city}</Text> : null}
      <Text style={styles.status} testID="competitor-brief-sheet-header-status">{freshnessLabel(data?.freshness ?? row?.freshness)}</Text>
      {tiktok ? <Button label="Open TikTok" variant="secondary" size="md" accessibilityLabel={`Open ${row?.name ?? "competitor"} on TikTok, opens outside Mingla`} onPress={() => openCompetitorPublicUrl(tiktok.url)} testID="competitor-brief-sheet-open-tiktok" /> : null}
      {query.isLoading ? <ActivityIndicator color={textTokens.secondary} /> : null}
      {query.isError ? <GlassCard variant="base"><Text style={styles.error}>Couldn&apos;t load competitor insights.</Text><Button label="Try again" variant="secondary" size="md" onPress={() => void query.refetch()} /></GlassCard> : null}
      {data?.noMeaningfulChange ? <Text style={styles.changed}>No meaningful public change this week</Text> : null}
      {data?.brief ? <>
        <Section title="WHAT CHANGED" testID="competitor-brief-sheet-section-what-changed">{data.brief.whatChanged.map((fact) => <GlassCard key={fact.id} variant="base" testID={`competitor-brief-sheet-fact-${fact.id}`}><Text style={styles.provenance}>Observed fact</Text><Text style={styles.copy}>{fact.text}</Text></GlassCard>)}</Section>
        <Section title="WHY IT MAY MATTER TO YOUR VENUE" testID="competitor-brief-sheet-section-why">{data.brief.whyItMatters.map((item, index) => <View key={`${item.text}-${index}`} testID={`competitor-brief-sheet-interpretation-${index}`}><Text style={styles.provenance}>Mingla interpretation</Text><Text style={styles.copy}>{item.text}</Text></View>)}</Section>
        <Section title="WORTH DOING NEXT" testID="competitor-brief-sheet-section-actions">{data.brief.worthDoing.map((action) => <GlassCard key={action.id} variant={action.isPrimary ? "elevated" : "base"} testID={`competitor-brief-sheet-action-${action.id}`}><Text style={styles.provenance}>Suggested action</Text><Text style={styles.copy}>{action.text}</Text></GlassCard>)}</Section>
        <Section title="EVIDENCE" testID="competitor-brief-sheet-section-evidence">{data.brief.evidence.map((evidence) => <GlassCard key={evidence.id} variant="base" testID={`competitor-brief-sheet-evidence-${evidence.id}`}><Text style={styles.provenance}>Observed fact</Text><Text style={styles.copy}>{evidence.observation}</Text>{evidence.observedAt ? <Text style={styles.meta}>{`Observed ${new Date(evidence.observedAt).toLocaleString()}`}</Text> : null}<Text style={styles.meta}>{`Checked ${new Date(evidence.checkedAt).toLocaleString()}`}</Text><Button label="Open source evidence" variant="secondary" size="md" accessibilityLabel={`Open source evidence, checked ${new Date(evidence.checkedAt).toLocaleDateString()}, opens outside Mingla`} onPress={() => { captureCompetitorIntelligenceEvent("competitor_evidence_opened", { watch_id: row?.id, schema_version: 2 }); openCompetitorPublicUrl(evidence.publicUrl); }} testID={`competitor-brief-sheet-evidence-${evidence.id}-open`} /></GlassCard>)}</Section>
      </> : data && data.freshness === "refreshing" ? <Text style={styles.copy}>Checking public sources…</Text> : null}
    </ScrollView>
  </Sheet>;
}

function Section({ title, testID, children }: { title: string; testID: string; children: React.ReactNode }): React.ReactElement { return <View style={styles.section} testID={testID}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>; }
function freshnessLabel(value?: string): string { return value === "budget_delayed" ? "Refresh delayed" : value === "needs_attention" ? "Needs attention" : value === "link_only" ? "Link only" : value ? value.charAt(0).toUpperCase() + value.slice(1) : "Preparing"; }
const styles = StyleSheet.create({ body: { gap: spacing.md, paddingBottom: spacing.xl }, title: { ...typography.h3, color: textTokens.primary }, status: { ...typography.caption, color: semantic.info }, section: { gap: spacing.sm, marginTop: spacing.sm }, sectionTitle: { ...typography.labelCap, color: textTokens.secondary }, provenance: { ...typography.labelCap, color: textTokens.tertiary }, copy: { ...typography.body, color: textTokens.primary }, changed: { ...typography.body, color: textTokens.primary, fontWeight: "600" }, meta: { ...typography.caption, color: textTokens.tertiary }, error: { ...typography.bodySm, color: semantic.error } });
export default CompetitorBriefSheet;
