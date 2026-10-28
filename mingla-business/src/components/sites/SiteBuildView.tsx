import React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { semantic, spacing, text as textTokens, typography } from "../../constants/designSystem";

/*
 * #2829 W9a — part 6, "Build your pages": one press creates the website
 * draft (its address first, if it has none) and every page the plan asks
 * for. Private: nothing is public until a separate publish.
 */

export interface SiteBuildViewProps {
  isLoading: boolean;
  loadError: string | null;
  canManage: boolean;
  approved: boolean;
  /** "Home · Trips · About · Contact" from the plan. */
  pagesLine: string;
  /** The address the draft has, or the one Core proposes before it exists. */
  address: string | null;
  hasSite: boolean;
  phase: "idle" | "working" | "done";
  builtLine: string | null;
  error: string | null;
  previewLoading: boolean;
  previewPane: React.ReactNode;
  onBuild: () => void;
  onApproveFirst: () => void;
  onShowDraft: () => void;
  onBackToPlan: () => void;
  onRetry: () => void;
}

export function SiteBuildView(props: SiteBuildViewProps): React.ReactElement {
  if (props.isLoading) return <View style={styles.centered}><ActivityIndicator accessibilityLabel="Loading" /></View>;
  if (props.loadError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.body} accessibilityRole="alert">{props.loadError}</Text>
        <Button label="Try again" onPress={props.onRetry} variant="secondary" />
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Build your pages</Text>
      <GlassCard>
        <View style={styles.card}>
          <Text style={styles.heading}>Create website draft</Text>
          {props.address ? <Text style={styles.value} testID="build-address">{props.address}</Text> : null}
          <Text style={styles.body} testID="build-pages">{props.pagesLine}</Text>
          <Text style={styles.caption}>Private draft. Nothing is public until you publish.</Text>
          {!props.hasSite && props.address ? (
            <Text style={styles.caption}>This becomes your website&apos;s address. It never changes afterwards; you can add your own domain later.</Text>
          ) : null}
        </View>
      </GlassCard>
      {props.error ? <Text style={styles.error} accessibilityRole="alert" testID="build-error">{props.error}</Text> : null}
      {props.phase === "done" && props.builtLine ? (
        <Text style={styles.body} accessibilityLiveRegion="polite" testID="build-done">Your draft is ready: {props.builtLine}</Text>
      ) : null}
      {!props.canManage ? (
        <Text style={styles.caption}>Only a brand admin or the owner can create the website draft.</Text>
      ) : !props.approved ? (
        <>
          <Text style={styles.body}>Approve your plan first; the draft is built from it.</Text>
          <Button label="Review and approve the plan" onPress={props.onApproveFirst} testID="build-approve-first" />
        </>
      ) : props.phase === "done" ? (
        <View style={styles.row}>
          <Button label="Back to your plan" onPress={props.onBackToPlan} testID="build-back" />
          <Button label={props.previewLoading ? "Getting your draft…" : "Show draft"} onPress={props.onShowDraft} variant="secondary" loading={props.previewLoading} disabled={props.previewLoading} testID="build-show-draft" />
        </View>
      ) : (
        <Button
          label={props.phase === "working" ? "Creating your draft…" : props.error ? "Try again" : "Create website draft"}
          onPress={props.onBuild}
          loading={props.phase === "working"}
          disabled={props.phase === "working"}
          testID="build-create"
        />
      )}
      {props.previewPane}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.md },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  title: { ...typography.h2, color: textTokens.primary },
  heading: { ...typography.h3, color: textTokens.primary },
  body: { ...typography.body, color: textTokens.secondary },
  value: { ...typography.monoMd, color: textTokens.primary },
  caption: { ...typography.caption, color: textTokens.tertiary },
  error: { ...typography.bodySm, color: semantic.errorText },
  card: { padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
