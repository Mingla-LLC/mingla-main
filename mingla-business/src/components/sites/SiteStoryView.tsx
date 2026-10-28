import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
// #2829 W11 — the keyboard-aware scroll wrapper (ORCH-0892), not bespoke plumbing.
import { ScrollView } from "../../wrappers/SmartScrollView";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { accent, radius, semantic, spacing, text as textTokens, typography } from "../../constants/designSystem";
import type { MainActionChip, StoryQuestions } from "../../../../packages/site-contracts/src/sitePlan.ts";
import type { SitePlanStory } from "../../sites/sitePlanState";
import { APPROVED_PLAN_LABELS } from "../../sites/planScreens";

/*
 * #2829 W9a — parts 4 and 5: three questions about the business (worded by
 * what was ticked), then the one-page plan to approve. The plan is built
 * only from the owner's answers and Mingla's facts; approving builds nothing
 * by itself — "Create website draft" is its own step.
 */

export interface SiteStoryViewProps {
  step: "questions" | "approve";
  isLoading: boolean;
  loadError: string | null;
  readOnly: boolean;
  questions: StoryQuestions;
  chips: readonly MainActionChip[];
  story: SitePlanStory;
  summary: Record<string, string>;
  approved: boolean;
  /** Approve needs the brand's name and one line about it (Core says why). */
  approveBlocked: string | null;
  isSaving: boolean;
  notice: { kind: "info" | "error"; message: string } | null;
  onChange: (key: keyof SitePlanStory, value: string) => void;
  onSaveAnswers: () => void;
  onApprove: () => void;
  onEditBrand: () => void;
  onRetry: () => void;
}

const MAX = 300;

export function SiteStoryView(props: SiteStoryViewProps): React.ReactElement {
  if (props.isLoading) return <View style={styles.centered}><ActivityIndicator accessibilityLabel="Loading" /></View>;
  if (props.loadError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.body} accessibilityRole="alert">{props.loadError}</Text>
        <Button label="Try again" onPress={props.onRetry} variant="secondary" />
      </View>
    );
  }
  const notice = props.notice ? (
    <Text style={props.notice.kind === "error" ? styles.error : styles.body} accessibilityRole={props.notice.kind === "error" ? "alert" : undefined} testID="story-notice">
      {props.notice.message}
    </Text>
  ) : null;
  if (props.step === "approve") {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.title}>Approve the plan</Text>
        <Text style={styles.body}>This is the plan, not the website. Change any line by going back to that part.</Text>
        <GlassCard>
          <View style={styles.card}>
            {APPROVED_PLAN_LABELS.filter(([key]) => props.summary[key]).map(([key, label]) => (
              <View key={key} style={styles.field} testID={`summary-${key}`}>
                <Text style={styles.caption}>{label}</Text>
                <Text style={styles.value}>{props.summary[key]}</Text>
              </View>
            ))}
          </View>
        </GlassCard>
        {props.approveBlocked ? (
          <GlassCard>
            <View style={styles.card}>
              <Text style={styles.body} testID="story-approve-blocked">{props.approveBlocked}</Text>
              {!props.readOnly ? <Button label="Add your brand details" onPress={props.onEditBrand} variant="secondary" size="sm" testID="story-edit-brand" /> : null}
            </View>
          </GlassCard>
        ) : null}
        {notice}
        {props.readOnly ? (
          <Text style={styles.caption}>Only a brand admin or the owner can approve the plan.</Text>
        ) : (
          <Button
            label={props.isSaving ? "Saving…" : props.approved ? "Approved · build your pages" : "Approve and build"}
            onPress={props.onApprove}
            loading={props.isSaving}
            disabled={props.isSaving || props.approveBlocked !== null}
            testID="story-approve"
          />
        )}
      </ScrollView>
    );
  }
  const field = (key: "who" | "why", label: string) => (
    <View style={styles.field}>
      <Text style={styles.heading}>{label}</Text>
      <TextInput
        value={props.story[key] ?? ""}
        onChangeText={(value) => props.onChange(key, value.slice(0, MAX))}
        editable={!props.readOnly}
        multiline
        maxLength={MAX}
        style={styles.input}
        placeholderTextColor={textTokens.tertiary}
        accessibilityLabel={label}
        testID={`story-${key}`}
      />
      <Text style={styles.caption}>{(props.story[key] ?? "").length}/{MAX}</Text>
    </View>
  );
  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Your story</Text>
        <Text style={styles.body}>Your answers decide what the top of your site says and what its main button does. Answer in your own words; Mingla never makes them up.</Text>
        {field("who", props.questions.who)}
        {field("why", props.questions.why)}
        <View style={styles.field}>
          <Text style={styles.heading}>{props.questions.main_action}</Text>
          <View style={styles.chips}>
            {props.chips.map((chip) => {
              const on = props.story.main_action === chip.label;
              return (
                <Pressable
                  key={chip.label}
                  onPress={() => props.onChange("main_action", on ? "" : chip.label)}
                  disabled={props.readOnly}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Use ${chip.label} as the main action`}
                  style={[styles.chip, on ? styles.chipOn : null]}
                  testID={`story-action-${chip.label}`}
                >
                  <Text style={styles.body}>{chip.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        {notice}
        {props.readOnly ? (
          <Text style={styles.caption}>Only a brand admin or the owner can change this.</Text>
        ) : (
          <Button label={props.isSaving ? "Saving…" : "Save and review the plan"} onPress={props.onSaveAnswers} loading={props.isSaving} disabled={props.isSaving} testID="story-save" />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  title: { ...typography.h2, color: textTokens.primary },
  heading: { ...typography.h3, color: textTokens.primary },
  body: { ...typography.body, color: textTokens.secondary },
  value: { ...typography.body, color: textTokens.primary },
  caption: { ...typography.caption, color: textTokens.tertiary },
  error: { ...typography.bodySm, color: semantic.errorText },
  card: { padding: spacing.md, gap: spacing.sm },
  field: { gap: spacing.xs },
  input: { ...typography.body, color: textTokens.primary, borderWidth: 1, borderColor: textTokens.quaternary, borderRadius: radius.sm, padding: spacing.sm, minHeight: 72, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: textTokens.quaternary },
  chipOn: { borderColor: accent.warm, backgroundColor: accent.tint },
});
