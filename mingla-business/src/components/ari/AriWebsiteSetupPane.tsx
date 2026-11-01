import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { supabase } from "../../services/supabase";

type Raw = Record<string, unknown>;
type SetupPart = { key: string; label: string; done: boolean };
type SetupGap = { key: string; label: string; state: string; humanActionRequired: boolean };

const PART_LABELS: Readonly<Record<string, string>> = {
  offer: "What you'll offer",
  brand: "Your brand details",
  look: "Choose your design",
  story: "Your story",
  approve: "Approve the plan",
  build: "Build your pages",
  first_offering: "Add your first trip or event",
  publish: "Check and publish",
};

const obj = (value: unknown): Raw =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Raw : {};

function normalizePlan(value: unknown): {
  parts: SetupPart[];
  gaps: SetupGap[];
  doneCount: number;
  contextComplete: boolean;
} {
  const root = obj(value);
  const status = obj(root.status);
  const completeness = obj(root.completeness);
  const parts = (Array.isArray(status.parts) ? status.parts : []).map(obj).map((part) => {
    const key = String(part.key ?? "");
    return { key, label: PART_LABELS[key] ?? key, done: part.done === true };
  }).filter((part) => part.key.length > 0);
  const gaps = (Array.isArray(completeness.fields) ? completeness.fields : []).map(obj).filter((field) => {
    const state = String(field.state ?? "missing");
    return field.requirement !== "optional" && state !== "verified" && state !== "not_applicable";
  }).map((field) => ({
    key: String(field.key ?? ""),
    label: String(field.label ?? field.key ?? "Brand detail"),
    state: String(field.state ?? "missing").replaceAll("_", " "),
    humanActionRequired: field.human_action_required === true,
  }));
  return {
    parts,
    gaps,
    doneCount: Number(status.done_count ?? parts.filter((part) => part.done).length),
    contextComplete: completeness.context_complete === true,
  };
}

async function getWebsiteSetup(brandId: string) {
  // Keep this on-intent pane independent from the full Website workspace
  // service. Sharing that large module across the Ari and Website chunks makes
  // Metro hoist it into __common for every Host (#3493).
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; data?: unknown }>(
    "brand-site-control",
    { body: { route: `/v1/brands/${brandId}/site-plan`, method: "GET" } },
  );
  if (error !== null || !data || data.ok !== true) {
    throw error ?? new Error("Website setup plan unavailable");
  }
  return normalizePlan(data.data);
}

export function AriWebsiteSetupPane({
  brandId,
  compact,
  activePart,
  onFixAll,
  fixing,
}: {
  brandId: string;
  compact: boolean;
  activePart: string | null;
  onFixAll: () => void;
  fixing: boolean;
}): React.ReactElement {
  const router = useRouter();
  const [compactExpanded, setCompactExpanded] = React.useState(false);
  const setup = useQuery({
    queryKey: ["brand-site-plan", brandId, "ari-setup"],
    queryFn: () => getWebsiteSetup(brandId),
    enabled: brandId.length > 0,
    staleTime: 0,
    refetchInterval: 3_000,
  });
  const plan = setup.data;
  const total = plan?.parts.length ?? 8;
  const done = plan?.doneCount ?? 0;
  const gaps = plan?.gaps ?? [];
  const activeLabel = activePart ? PART_LABELS[activePart] ?? activePart : null;
  const currentLabel = activeLabel
    ?? plan?.parts.find((part) => !part.done)?.label
    ?? (plan?.contextComplete ? "Ready for the first draft" : "Reviewing brand context");

  return (
    <View style={[styles.host, compact ? styles.compact : null]} testID="ari-website-setup">
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>Website setup</Text>
          <Text style={styles.title}>Setup plan</Text>
        </View>
        <View style={styles.headingMeta}>
          <Text style={styles.progress}>{done} of {total} done</Text>
          {compact ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={compactExpanded ? "Hide Website setup details" : "Show Website setup details"}
              accessibilityState={{ expanded: compactExpanded }}
              onPress={() => setCompactExpanded((value) => !value)}
              hitSlop={8}
              testID="ari-setup-toggle"
            >
              <Text style={styles.toggleLabel}>{compactExpanded ? "Hide details" : "Show details"}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {compact ? (
        <Text style={styles.compactSummary}>
          Current: {currentLabel}{gaps.length > 0 ? ` · ${gaps.length} ${gaps.length === 1 ? "gap" : "gaps"}` : ""}
        </Text>
      ) : null}
      {!compact || compactExpanded ? (
        <Text style={styles.body}>
          {activeLabel ? `Working on ${activeLabel}. ` : ""}
          Ari reads this same live plan, finds every field-level gap, and works through it before any draft is created.
        </Text>
      ) : null}

      {setup.isLoading ? <Text style={styles.muted}>Reading the shared plan…</Text> : null}
      {setup.isError ? <Text style={styles.error}>The plan could not refresh. Ari will not guess; try again.</Text> : null}

      {!compact && plan ? (
        <View style={styles.planList}>
          {plan.parts.map((part) => (
            <View key={part.key} style={styles.planRow}>
              <View style={[styles.dot, part.done ? styles.dotDone : null]} />
              <Text style={[styles.partLabel, part.done ? styles.partDone : null]}>{part.label}</Text>
              <Text style={styles.partState}>{part.done ? "Done" : part.key === activePart ? "Active" : "Open"}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {(!compact || compactExpanded) && plan?.contextComplete ? (
        <View style={styles.completeBox}>
          <Text style={styles.completeTitle}>Brand context complete</Text>
          <Text style={styles.completeBody}>Ari will re-check it before building the first draft.</Text>
        </View>
      ) : (!compact || compactExpanded) && plan && gaps.length > 0 ? (
        <View style={styles.gapBox}>
          <Text style={styles.gapTitle}>{gaps.length} context {gaps.length === 1 ? "gap" : "gaps"}</Text>
          {(!compact || compactExpanded) ? gaps.slice(0, compact ? 4 : 6).map((gap) => (
            <View key={gap.key} style={styles.gapRow}>
              <Text style={styles.gapLabel}>{gap.label}</Text>
              <Text style={styles.gapState}>{gap.humanActionRequired ? "your upload" : gap.state}</Text>
            </View>
          )) : null}
          {gaps.length > (compact ? 4 : 6) ? (
            <Text style={styles.muted}>
              + {gaps.length - (compact ? 4 : 6)} more in the shared plan
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ask Ari to fix all brand context gaps"
          onPress={onFixAll}
          disabled={fixing || plan?.contextComplete === true}
          style={({ pressed }) => [styles.primaryAction, pressed ? styles.pressed : null, fixing || plan?.contextComplete ? styles.disabled : null]}
          testID="ari-setup-fix-all"
        >
          <Text style={styles.primaryActionText}>{fixing ? "Ari is working…" : "Fix all gaps with Ari"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/brand/${brandId}/edit` as never)}
          style={styles.secondaryAction}
          testID="ari-setup-self"
        >
          <Text style={styles.secondaryActionText}>Add it myself</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/brand/${brandId}/website` as never)}
          style={styles.secondaryAction}
        >
          <Text style={styles.secondaryActionText}>Back to setup plan</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1.2,
    minWidth: 0,
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  compact: { flex: 0, gap: spacing.sm, padding: spacing.md, marginHorizontal: spacing.md, marginTop: spacing.sm },
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  headingCopy: { flex: 1 },
  headingMeta: { alignItems: "flex-end", gap: spacing.xs },
  eyebrow: { ...typography.micro, color: accent.warm, textTransform: "uppercase" },
  title: { ...typography.h2, color: textTokens.primary, marginTop: 2 },
  progress: { ...typography.labelCap, color: accent.warm },
  toggleLabel: { ...typography.micro, color: accent.warm, textDecorationLine: "underline" },
  compactSummary: { ...typography.bodySm, color: textTokens.primary },
  body: { ...typography.body, color: textTokens.secondary },
  muted: { ...typography.bodySm, color: textTokens.tertiaryOnCard },
  error: { ...typography.bodySm, color: semantic.errorText },
  planList: { gap: 2 },
  planRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 36 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: textTokens.quaternary },
  dotDone: { borderColor: semantic.success, backgroundColor: semantic.success },
  partLabel: { ...typography.bodySm, color: textTokens.primary, flex: 1 },
  partDone: { color: textTokens.secondary },
  partState: { ...typography.micro, color: textTokens.tertiaryOnCard, textTransform: "uppercase" },
  gapBox: { gap: spacing.xs, borderWidth: 1, borderColor: semantic.warning, borderRadius: radius.md, padding: spacing.md },
  gapTitle: { ...typography.labelCap, color: semantic.warning },
  gapRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  gapLabel: { ...typography.bodySm, color: textTokens.primary, flex: 1 },
  gapState: { ...typography.micro, color: textTokens.tertiaryOnCard, textTransform: "uppercase" },
  completeBox: { gap: spacing.xs, borderWidth: 1, borderColor: semantic.success, borderRadius: radius.md, padding: spacing.md },
  completeTitle: { ...typography.labelCap, color: semantic.success },
  completeBody: { ...typography.bodySm, color: textTokens.secondary },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  primaryAction: { minHeight: 44, justifyContent: "center", borderRadius: radius.full, backgroundColor: accent.warm, paddingHorizontal: spacing.md },
  primaryActionText: { ...typography.buttonMd, color: "#140a03" },
  secondaryAction: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm },
  secondaryActionText: { ...typography.buttonMd, color: accent.warm },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.5 },
});
