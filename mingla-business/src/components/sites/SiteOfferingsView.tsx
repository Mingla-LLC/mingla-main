import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { accent, radius, semantic, spacing, text as textTokens, typography } from "../../constants/designSystem";
import {
  PLAN_OFFERING_OPTIONS,
  VENUE_DESCRIPTOR_CHIPS,
  planMenuPreview,
  type PlanOfferingKey,
} from "../../../../packages/site-contracts/src/sitePlan.ts";

/*
 * #2829 W9a — part 1, "What you'll offer": seven options in one grid (Stay
 * only while stay venues are switched on), the venue follow-up chips, and
 * the live menu line under the ticks. Each tick adds a page and a menu item;
 * unticking something that has live items asks first.
 */

export type OfferingsConfirm = { kind: "untick_live"; message: string } | { kind: "nothing_ticked" } | null;

export interface SiteOfferingsViewProps {
  isLoading: boolean;
  loadError: string | null;
  readOnly: boolean;
  includeStay: boolean;
  selected: ReadonlySet<PlanOfferingKey>;
  descriptor: string | null;
  confirm: OfferingsConfirm;
  isSaving: boolean;
  notice: { kind: "info" | "error"; message: string } | null;
  onToggle: (key: PlanOfferingKey) => void;
  onDescriptor: (chip: string | null) => void;
  onContinue: () => void;
  onConfirm: () => void;
  onCancelConfirm: () => void;
  onRetry: () => void;
}

export function SiteOfferingsView(props: SiteOfferingsViewProps): React.ReactElement {
  if (props.isLoading) {
    return <View style={styles.centered}><ActivityIndicator accessibilityLabel="Loading" /></View>;
  }
  if (props.loadError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.body} accessibilityRole="alert">{props.loadError}</Text>
        <Button label="Try again" onPress={props.onRetry} variant="secondary" />
      </View>
    );
  }
  const options = PLAN_OFFERING_OPTIONS.filter((option) => !option.stay || props.includeStay || props.selected.has(option.key));
  const venueTicked = [...props.selected].some((key) => key.startsWith("venue_"));
  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>What will people come to you for?</Text>
      <Text style={styles.body}>Tick everything you do now or plan to. Each tick gets a page on your site, even before it has anything on it.</Text>
      <View style={styles.grid}>
        {options.map((option) => {
          const on = props.selected.has(option.key);
          return (
            <Pressable
              key={option.key}
              onPress={() => props.onToggle(option.key)}
              disabled={props.readOnly}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled: props.readOnly }}
              accessibilityLabel={`${option.label}, ${option.hint}`}
              style={[styles.tile, on ? styles.tileOn : null]}
              testID={`offer-${option.key}`}
            >
              <Text style={styles.tileLabel}>{option.label}</Text>
              <Text style={styles.caption}>{option.hint}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.preview} testID="offer-preview" accessibilityLiveRegion="polite">
        Your site: {planMenuPreview([...props.selected])}
      </Text>
      {venueTicked ? (
        <GlassCard>
          <View style={styles.card}>
            <Text style={styles.heading}>Which describes you best?</Text>
            <Text style={styles.caption}>This only shapes the words and photos, not which pages you get.</Text>
            <View style={styles.chips}>
              {VENUE_DESCRIPTOR_CHIPS.map((chip) => {
                const on = props.descriptor === chip;
                return (
                  <Pressable
                    key={chip}
                    onPress={() => props.onDescriptor(on ? null : chip)}
                    disabled={props.readOnly}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    style={[styles.chip, on ? styles.chipOn : null]}
                    testID={`offer-descriptor-${chip}`}
                  >
                    <Text style={styles.body}>{chip}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </GlassCard>
      ) : null}
      {props.confirm ? (
        <GlassCard>
          <View style={styles.card} testID="offer-confirm" accessibilityLiveRegion="polite">
            <Text style={styles.body}>
              {props.confirm.kind === "untick_live"
                ? props.confirm.message
                : "Nothing ticked: your site will have Home, About and Contact, with an email sign-up on Home. Planning to sell something later? Tick it now and its page waits for you."}
            </Text>
            <View style={styles.row}>
              <Button label={props.confirm.kind === "untick_live" ? "Untick and save" : "Continue with nothing ticked"} onPress={props.onConfirm} loading={props.isSaving} disabled={props.isSaving} size="sm" testID="offer-confirm-yes" />
              <Button label="Go back" onPress={props.onCancelConfirm} variant="ghost" size="sm" disabled={props.isSaving} testID="offer-confirm-no" />
            </View>
          </View>
        </GlassCard>
      ) : null}
      {props.notice ? (
        <Text style={props.notice.kind === "error" ? styles.error : styles.body} accessibilityRole={props.notice.kind === "error" ? "alert" : undefined} testID="offer-notice">
          {props.notice.message}
        </Text>
      ) : null}
      {props.readOnly ? (
        <Text style={styles.caption}>Only a brand admin or the owner can change this.</Text>
      ) : (
        <Button label={props.isSaving ? "Saving…" : "Continue"} onPress={props.onContinue} loading={props.isSaving} disabled={props.isSaving || props.confirm !== null} testID="offer-continue" />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.md },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  title: { ...typography.h2, color: textTokens.primary },
  heading: { ...typography.h3, color: textTokens.primary },
  body: { ...typography.body, color: textTokens.secondary },
  caption: { ...typography.caption, color: textTokens.tertiary },
  error: { ...typography.bodySm, color: semantic.errorText },
  preview: { ...typography.bodySm, color: textTokens.primary },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: { width: "47%", minHeight: 72, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: textTokens.quaternary, gap: 2 },
  tileOn: { borderColor: accent.warm, backgroundColor: accent.tint },
  tileLabel: { ...typography.body, color: textTokens.primary, fontWeight: "700" },
  card: { padding: spacing.md, gap: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: textTokens.quaternary },
  chipOn: { borderColor: accent.warm, backgroundColor: accent.tint },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
