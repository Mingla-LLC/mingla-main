import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, findNodeHandle, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { captureCompetitorIntelligenceEvent } from "../../../analytics/competitorIntelligenceAnalytics";
import { androidOpaque, competition, competitorSheet, glass, semantic, spacing, text as textTokens, typography } from "../../../constants/designSystem";
import { BUTTON_MAX_FONT_SCALE, isLargeText } from "../../../constants/dynamicType";
import { useCompetitorBrief } from "../../../hooks/useCompetitorIntelligence";
import { useVenueListing } from "../../../hooks/useVenueListings";
import { openExternal } from "../../../services/guestFunnelLink";
import type { CompetitorBriefEvidence, CompetitorBriefResult, CompetitorBriefV2, CompetitorWatchRow } from "../../../types/growthTools";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { actionTimeframeLabel, buildCompetitorDecisionView, type CompetitorSignalView } from "./competitorDecisionReport";

export function openCompetitorPublicUrl(url: string): void {
  const failed = (): void => AccessibilityInfo.announceForAccessibility("We couldn’t open that source. Try again.");
  if (!/^https?:\/\//i.test(url)) return failed();
  if (Platform.OS === "web") { try { openExternal(url); } catch { failed(); } return; }
  void Linking.openURL(url).catch(failed);
}
interface Props { visible: boolean; onClose: () => void; brandId: string | null; venueName?: string | null; venueListingId?: string | null; row: CompetitorWatchRow | null; offline?: boolean; }
export function CompetitorBriefSheet(props: Props): React.ReactElement {
  if (props.venueName !== undefined || !props.venueListingId) return <Content {...props} venueName={props.venueName ?? null} />;
  return <WithVenue {...props} venueListingId={props.venueListingId} />;
}
function WithVenue(props: Props & { venueListingId: string }): React.ReactElement {
  const venue = useVenueListing(props.venueListingId);
  return <Content {...props} venueName={venue.data?.name ?? null} />;
}
function Content({ visible, onClose, brandId, row, offline = false }: Omit<Props, "venueListingId" | "venueName"> & { venueName: string | null }): React.ReactElement {
  const query = useCompetitorBrief(brandId, row?.id ?? null, visible);
  const closeRef = useRef<React.ElementRef<typeof Pressable>>(null);
  const scrollRef = useRef<ScrollView>(null);
  const signalRefs = useRef(new Map<string, View>());
  const data = normalizeBriefSchema(query.data);
  const insufficient = Boolean(data?.brief?.whatChanged.every((fact) => /Mingla checked .*public|public information was checked/i.test(fact.text)));
  const decision = data && !insufficient ? buildCompetitorDecisionView(data) : null;
  const { width, fontScale } = useWindowDimensions();
  const insetStyle = width >= 1024 ? styles.insetWide : width >= 360 ? styles.insetRegular : styles.insetCompact;
  const accessibilityHeader = isLargeText(fontScale);
  const firstRun = !data?.updatedAt || Math.abs(Date.parse(data.updatedAt) - Date.parse(row?.createdAt ?? "")) < 86_400_000;
  const state = reportState(data?.brief?.status === "partial" ? "partial" : data?.freshness ?? row?.freshness, data?.noMeaningfulChange ?? false, Boolean(data?.brief) && !insufficient, query.isFetching, query.isError, offline);
  useEffect(() => {
    if (!visible || Platform.OS !== "web") return;
    const timer = setTimeout(() => closeRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [visible]);
  return <Sheet visible={visible} onClose={onClose} snapPoint="full" presentation="competition" panelBackground={competition.surface} style={styles.sheet} testID="competitor-brief-sheet">
    <ScrollView ref={scrollRef} contentContainerStyle={[styles.body, insetStyle]}>
      <View style={styles.header}>
        <View style={[styles.headerTop, accessibilityHeader ? styles.headerTopAccessible : null]}><Text maxFontSizeMultiplier={BUTTON_MAX_FONT_SCALE} style={styles.eyebrow}>WEEKLY COMPETITOR BRIEF</Text><Button ref={closeRef} label="Close" accessibilityLabel="Close weekly competitor brief" variant="ghost" size="md" onPress={onClose} style={accessibilityHeader ? styles.closeAccessible : undefined} testID="competitor-brief-close" /></View>
        <Text accessibilityRole="header" maxFontSizeMultiplier={BUTTON_MAX_FONT_SCALE} style={styles.title}>{row?.name ?? "Weekly competitor brief"}</Text>
        {row?.city ? <Text style={styles.meta}>{row.city}</Text> : null}
        <View style={styles.statusRail}><Text style={styles.status} testID="competitor-brief-sheet-header-status">{state.label}</Text>{data?.checkedAt ? <Text style={styles.meta}>{`Checked ${formatDateTime(data.checkedAt)}`}</Text> : null}{(data?.nextRefreshAt ?? row?.nextRefreshAt) ? <Text style={styles.meta}>{`Next check ${formatScheduleTime(data?.nextRefreshAt ?? row?.nextRefreshAt ?? "")}`}</Text> : null}</View>
      </View>
      {state.message ? <View style={styles.stateBanner} testID={`competitor-brief-state-${state.id}`}><Text style={styles.copy}>{state.message}</Text></View> : null}
      {query.isLoading && !data ? <View style={styles.preparing}><ActivityIndicator color={textTokens.secondary} /><Text style={styles.copy}>Preparing your first sourced brief</Text></View> : null}
      {query.isError && !data ? <View style={styles.card}><Text style={styles.cardTitle}>Couldn&apos;t load competitor insights</Text><Text style={styles.copy}>Your saved competitor is still safe.</Text><Button label="Try again" variant="secondary" size="md" onPress={() => void query.refetch()} /></View> : null}
      {decision ? <>
        <View style={styles.readCard} testID="competitor-brief-the-read"><ReadLine label="WHAT HAPPENED" text={decision.happened} /><ReadLine label="WHY CARE" text={decision.whyCare} /><ReadLine label="DO THIS NEXT" text={decision.doNext} /></View>
        <View style={styles.health} testID="competitor-brief-signal-health"><Text style={styles.cardTitle}>Signal health</Text><Text style={styles.meta}>{sourceHealth(data?.sources ?? row?.sources ?? [])}</Text></View>
        <Section title={firstRun ? "CURRENT PUBLIC SIGNALS" : "WHAT CHANGED"} testID="competitor-brief-sheet-section-signals">{decision.signals.map((signal) => <SignalCard key={signal.id} signal={signal} nativeRef={(node) => { if (node) signalRefs.current.set(signal.id, node); else signalRefs.current.delete(signal.id); }} watchId={row?.id} schemaVersion={data?.schemaVersion ?? 2} />)}</Section>
        {decision.interpretations.length ? <Section title="COMPETITIVE READ" testID="competitor-brief-sheet-section-why"><Text style={styles.help}>What these verified signals could mean for your venue.</Text>{decision.interpretations.map((item, index) => <View key={`${item.text}-${index}`} style={styles.card}><Text style={styles.cardTitle}>{`${titleCase(item.type)} · ${titleCase(item.confidence)} confidence`}</Text><Text style={styles.copy}>{item.text}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Based on signal ${item.signalNumber}`} onPress={() => focusSignal(signalRefs.current.get(decision.signals[item.signalNumber - 1]?.id ?? ""), scrollRef.current)} style={styles.smallControl}><Text style={styles.link}>{`Based on signal ${item.signalNumber}`}</Text></Pressable></View>)}</Section> : null}
        {decision.comparisons.length ? <Section title={`YOU VS ${row?.name?.toUpperCase() ?? "COMPETITOR"}`} testID="competitor-brief-sheet-section-comparisons">{decision.comparisons.map((item) => <View key={item.id} style={styles.card}><Text style={styles.cardTitle}>{`${item.label} · ${titleCase(item.confidence)} confidence`}</Text><Text style={styles.copy}>{`You: ${item.ownerText}`}</Text><Text style={styles.copy}>{`${row?.name ?? "Competitor"}: ${item.competitorText}`}</Text></View>)}</Section> : null}
        <Section title="YOUR MOVE" testID="competitor-brief-sheet-section-actions">{decision.actions.filter((item) => item.primary).map((item) => <View key={item.id} style={styles.primaryAction} testID={`competitor-brief-primary-action-${item.id}`}><Text style={styles.provenance}>THIS WEEK · PRIMARY</Text><Text style={styles.copy}>{item.text}</Text></View>)}{decision.actions.some((item) => !item.primary) ? <Text style={styles.cardTitle}>Also worth considering</Text> : null}{decision.actions.filter((item) => !item.primary).map((item, index) => <View key={item.id} style={styles.secondaryAction} testID={`competitor-brief-secondary-action-${item.id}`}><Text style={styles.provenance}>{`${index + 1}. ${actionTimeframeLabel(item.timeframe).toUpperCase()}`}</Text><Text style={styles.copy}>{item.text}</Text></View>)}</Section>
      </> : data && !query.isFetching && !query.isError ? <View style={styles.card} testID="competitor-brief-sheet-insufficient"><Text style={styles.cardTitle}>Not enough public detail</Text><Text style={styles.copy}>Add or correct a weekly-eligible public source, then Mingla will try again.</Text></View> : null}
    </ScrollView>
  </Sheet>;
}
function normalizeBriefSchema(value: CompetitorBriefResult | undefined): CompetitorBriefResult | undefined {
  if (!value || Object.prototype.hasOwnProperty.call(value, "schemaVersion")) return value;
  return { ...value, schemaVersion: 2 } as CompetitorBriefV2;
}
function ReadLine({ label, text }: { label: string; text: string }): React.ReactElement { return <View style={styles.readLine}><Text style={styles.provenance}>{label}</Text><Text style={styles.copy}>{text}</Text></View>; }
function SignalCard({ signal, nativeRef, watchId, schemaVersion }: { signal: CompetitorSignalView; nativeRef: (node: View | null) => void; watchId?: string; schemaVersion: number }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  return <View ref={nativeRef} accessible accessibilityLabel={`Signal ${signal.number}, ${signal.label}`} style={styles.card} testID={`competitor-signal-${signal.id}`}><Text style={styles.provenance}>{`SIGNAL ${signal.number} · ${signal.label.toUpperCase()}`}</Text><Text style={styles.copy}>{signal.summary}</Text><Pressable accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={`Evidence, ${signal.sourceName}, ${expanded ? "expanded" : "collapsed"}`} onPress={() => setExpanded((value) => !value)} style={styles.disclosure} testID={`competitor-signal-${signal.id}-evidence`}><Text style={styles.link}>{`Evidence · ${signal.sourceName}`}</Text><Text style={styles.link}>{expanded ? "⌃" : "⌄"}</Text></Pressable>{expanded ? <EvidenceDetail evidence={signal.evidence} sourceName={signal.sourceName} watchId={watchId} schemaVersion={schemaVersion} /> : null}</View>;
}
function focusSignal(node: View | undefined, scroll: ScrollView | null): void {
  if (!node || !scroll) return;
  const scrollHandle = findNodeHandle(scroll);
  if (scrollHandle === null) return;
  node.measureLayout(scrollHandle, (_x, y) => {
    scroll.scrollTo({ y: Math.max(0, y - spacing.md), animated: true });
    const handle = findNodeHandle(node);
    if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
  }, () => undefined);
}
function EvidenceDetail({ evidence, sourceName, watchId, schemaVersion }: { evidence: CompetitorBriefEvidence; sourceName: string; watchId?: string; schemaVersion: number }): React.ReactElement { return <View style={styles.evidence}><Text style={styles.copy}>{evidence.observation}</Text>{evidence.observedAt ? <Text style={styles.meta}>{`Observed ${formatDateTime(evidence.observedAt)}`}</Text> : null}<Text style={styles.meta}>{`Checked ${formatDateTime(evidence.checkedAt)}`}</Text><Pressable accessibilityRole="link" accessibilityLabel={`Open original ${sourceName} source, opens outside Mingla`} style={styles.smallControl} onPress={() => { captureCompetitorIntelligenceEvent("competitor_evidence_opened", { watch_id: watchId, schema_version: schemaVersion }); openCompetitorPublicUrl(evidence.publicUrl); }}><Text style={styles.link}>Open original source ↗</Text></Pressable></View>; }
function Section({ title, testID, children }: { title: string; testID: string; children: React.ReactNode }): React.ReactElement { return <View style={styles.section} testID={testID}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>; }
function titleCase(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " "); }
function sourceHealth(sources: Array<{ capability?: string; health?: string; availability?: string }>): string { const weekly = sources.filter((item) => item.capability !== "link_only"); const healthy = weekly.filter((item) => item.health === "current" && item.availability === "enabled").length; return weekly.length ? `${healthy} of ${weekly.length} weekly sources available` : "No weekly source available · saved links remain references"; }
function reportState(freshness: string | undefined, noChange: boolean, hasBrief: boolean, fetching: boolean, error: boolean, offline: boolean): { id: string; label: string; message: string | null } {
  if (offline) return { id: "offline", label: "Offline · showing last update", message: hasBrief ? "Reconnect for a fresh check. Your last report remains available." : "Reconnect to prepare the first sourced brief." };
  if (error && hasBrief) return { id: "error", label: "Needs retry · showing last update", message: "We couldn’t complete the latest check. Your last report remains available." };
  if (freshness === "budget_delayed") return { id: "budget-delayed", label: "Next check delayed", message: "This week’s automatic allowance is in use. Mingla will check again at the scheduled time." };
  if (freshness === "needs_attention" || freshness === "stale") return { id: "stale", label: "Needs attention · showing last update", message: "One or more public sources need attention." };
  if (freshness === "partial") return { id: "partial", label: "Partial · supported sources only", message: "Some public sources were unavailable, so this report uses verified sources only." };
  if (freshness === "refreshing" || fetching) return { id: "refreshing", label: "Checking public sources…", message: hasBrief ? "Checking public sources… Your last report remains visible." : null };
  if (noChange) return { id: "no-change", label: "Current", message: "No meaningful public change this week" };
  return { id: hasBrief ? "current" : "insufficient", label: hasBrief ? "Current" : "Not enough public detail", message: null };
}
function formatDateTime(iso: string): string { const date = new Date(iso); return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—"; }
function formatScheduleTime(iso: string): string { const date = new Date(iso); if (!Number.isFinite(date.getTime())) return "—"; return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`; }
const competitionCardSurface = Platform.OS === "android" ? androidOpaque.rowFill : competition.surfaceRaised;
const competitionBorder = Platform.OS === "android" ? androidOpaque.rowBorder : glass.border.profileElevated;
const competitionSubtleBorder = Platform.OS === "android" ? androidOpaque.rowBorder : glass.border.profileBase;
const opaque = { backgroundColor: competitionCardSurface, borderWidth: StyleSheet.hairlineWidth, borderColor: competitionBorder, overflow: "hidden" as const, ...Platform.select({ android: { elevation: 0, shadowOpacity: 0 }, default: {} }) };
const styles = StyleSheet.create({
  sheet: { width: "100%", maxWidth: competitorSheet.briefMaxWidth, borderWidth: StyleSheet.hairlineWidth, borderColor: glass.border.profileElevated }, body: { gap: competitorSheet.sectionGap, paddingTop: spacing.md, paddingBottom: spacing.xl },
  insetCompact: { paddingHorizontal: competitorSheet.contentInsetCompact }, insetRegular: { paddingHorizontal: competitorSheet.contentInsetRegular }, insetWide: { paddingHorizontal: competitorSheet.contentInsetWide },
  header: { gap: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: competitionBorder }, headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }, headerTopAccessible: { flexDirection: "column", alignItems: "stretch", justifyContent: "flex-start", gap: spacing.sm }, closeAccessible: { alignSelf: "flex-end", minWidth: 44, minHeight: 44, flexShrink: 0 }, eyebrow: { ...typography.labelCap, color: textTokens.tertiary }, title: { ...typography.h3, color: textTokens.primary }, meta: { ...typography.caption, color: textTokens.tertiary }, statusRail: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, status: { ...typography.caption, color: textTokens.primary },
  stateBanner: { ...opaque, borderRadius: 16, padding: spacing.md }, preparing: { gap: spacing.md, alignItems: "center", paddingVertical: spacing.xl }, readCard: { ...opaque, borderRadius: 24, padding: Platform.OS === "web" ? 24 : 20, gap: spacing.lg }, readLine: { gap: spacing.xs, maxWidth: competitorSheet.readableCopyMaxWidth }, health: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: spacing.sm, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: competitionBorder },
  section: { gap: competitorSheet.cardGap }, sectionTitle: { ...typography.labelCap, color: textTokens.secondary }, help: { ...typography.bodySm, color: textTokens.secondary }, card: { ...opaque, borderRadius: 16, padding: spacing.md, gap: spacing.sm }, primaryAction: { ...opaque, borderRadius: 24, padding: Platform.OS === "web" ? 24 : 20, gap: spacing.sm }, secondaryAction: { padding: spacing.md, gap: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: competitionSubtleBorder }, disclosure: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, smallControl: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }, evidence: { gap: spacing.xs, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: competitionSubtleBorder },
  cardTitle: { ...typography.bodySm, color: textTokens.primary, fontWeight: "600" }, provenance: { ...typography.labelCap, color: textTokens.tertiary }, copy: { ...typography.body, color: textTokens.primary, maxWidth: competitorSheet.readableCopyMaxWidth }, link: { ...typography.bodySm, color: semantic.info, fontWeight: "600" },
});
export default CompetitorBriefSheet;
