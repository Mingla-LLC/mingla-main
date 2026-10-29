/**
 * ORCH-0821 — AriSettingsScreen
 * Memory transparency + privacy controls. Three sections:
 *   - Mode (locked to Co-pilot in MVP)
 *   - What Ari knows (profile fields with edit/forget)
 *   - Privacy (delete all data + AI disclosure note)
 */

import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper. Per SPEC §7.F.
import { ScrollView } from "../../wrappers/SmartScrollView";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ariPalette,
  ariThread,
  canvas,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useAriPreferences } from "../../hooks/useAriPreferences";
import { useAriKnowledge } from "../../hooks/useAriKnowledge";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import type {
  AriAgentJob,
  AriMemoryKind,
  AriMemoryNote,
} from "../../services/ariKnowledgeService";

const MEMORY_KINDS: AriMemoryKind[] = [
  "preference",
  "business_fact",
  "workflow",
  "correction",
];

function jobErrorCopy(code: string): string {
  if (code === "PERMISSION_DENIED") {
    return "You do not currently have permission to complete this step.";
  }
  if (code === "UNAUTHENTICATED") {
    return "Your session needs to be refreshed.";
  }
  if (code === "TOOL_TIMEOUT") {
    return "This step took too long to finish. It is safe to try again.";
  }
  return "This step needs attention before it can continue.";
}

function labelForMemoryKind(kind: AriMemoryKind): string {
  return kind.replace("_", " ").replace(/^./, (value) => value.toUpperCase());
}

function labelForJobStatus(status: AriAgentJob["status"]): string {
  return status.replace("_", " ").replace(/^./, (value) => value.toUpperCase());
}

export const AriSettingsScreen: React.FC = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const prefs = useAriPreferences();
  const currentBrand = useCurrentBrand();
  const knowledge = useAriKnowledge(currentBrand?.id ?? null);
  const [displayName, setDisplayName] = useState(
    prefs.profile?.display_name ?? "",
  );
  const [timezone, setTimezone] = useState(
    prefs.profile?.preferred_timezone ?? "",
  );
  const [memoryKind, setMemoryKind] = useState<AriMemoryKind>("preference");
  const [memoryDraft, setMemoryDraft] = useState("");
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);

  React.useEffect(() => {
    if (prefs.profile) {
      setDisplayName(prefs.profile.display_name ?? "");
      setTimezone(prefs.profile.preferred_timezone ?? "");
    }
  }, [prefs.profile]);

  const handleSave = async (): Promise<void> => {
    try {
      await prefs.update({
        display_name: displayName.trim() || null,
        preferred_timezone: timezone.trim() || null,
      });
      Alert.alert("Saved", "Your preferences are updated.");
    } catch (err) {
      Alert.alert(
        "Couldn't save",
        err instanceof Error ? err.message : "Unknown error",
      );
    }
  };

  const handleDeleteAll = (): void => {
    Alert.alert(
      "Delete all Ari data?",
      "This permanently removes every conversation, fact, and preference Ari has stored for you. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete everything",
          style: "destructive",
          onPress: async () => {
            try {
              await prefs.deleteAll();
              Alert.alert(
                "Deleted",
                "All Ari data for your account has been removed.",
              );
              router.back();
            } catch (err) {
              Alert.alert(
                "Couldn't delete",
                err instanceof Error ? err.message : "Unknown error",
              );
            }
          },
        },
      ],
    );
  };

  const resetMemoryComposer = (): void => {
    setEditingMemoryId(null);
    setMemoryKind("preference");
    setMemoryDraft("");
  };

  const handleSaveMemory = async (): Promise<void> => {
    const content = memoryDraft.trim();
    if (!content) return;
    try {
      if (editingMemoryId) {
        await knowledge.updateMemory({
          noteId: editingMemoryId,
          kind: memoryKind,
          content,
        });
      } else {
        await knowledge.saveMemory({ kind: memoryKind, content });
      }
      resetMemoryComposer();
    } catch (err) {
      Alert.alert(
        "Couldn't save memory",
        err instanceof Error ? err.message : "Unknown error",
      );
    }
  };

  const beginMemoryEdit = (note: AriMemoryNote): void => {
    setEditingMemoryId(note.id);
    setMemoryKind(note.kind);
    setMemoryDraft(note.content);
  };

  const handleForgetMemory = (note: AriMemoryNote): void => {
    Alert.alert(
      "Forget this memory?",
      "Ari will stop using it in future conversations.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Forget",
          style: "destructive",
          onPress: async () => {
            try {
              await knowledge.forgetMemory(note.id);
              if (editingMemoryId === note.id) resetMemoryComposer();
            } catch (err) {
              Alert.alert(
                "Couldn't forget memory",
                err instanceof Error ? err.message : "Unknown error",
              );
            }
          },
        },
      ],
    );
  };

  const handleJobControl = async (
    job: AriAgentJob,
    action: "pause" | "resume" | "cancel",
  ): Promise<void> => {
    try {
      await knowledge.controlJob({
        jobId: job.id,
        revision: job.revision,
        action,
      });
    } catch (err) {
      Alert.alert(
        "Couldn't update task",
        err instanceof Error ? err.message : "Unknown error",
      );
    }
  };

  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Back to chat"
        >
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Ari Settings</Text>
        <View style={{ width: 64 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Mode */}
        <Section title="Mode">
          <View style={styles.row}>
            <Text style={styles.rowLabel}>
              Co-pilot (always ask before writes)
            </Text>
            <Text style={styles.rowValue}>Active</Text>
          </View>
          <Text style={styles.hint}>
            Autopilot for reads is coming in a future update.
          </Text>
        </Section>

        {/* What Ari knows */}
        <Section title="What Ari knows about you">
          <FieldRow label="Display name">
            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your name"
              placeholderTextColor={textTokens.tertiary}
              style={styles.input}
              accessibilityLabel="Display name for Ari"
            />
          </FieldRow>
          <FieldRow label="Preferred timezone">
            <TextInput
              value={timezone}
              onChangeText={setTimezone}
              placeholder="e.g. America/New_York"
              placeholderTextColor={textTokens.tertiary}
              style={styles.input}
              accessibilityLabel="Preferred timezone for Ari"
            />
          </FieldRow>
          <Pressable
            onPress={handleSave}
            style={({ pressed }) => [styles.saveBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Save preferences"
          >
            <Text style={styles.saveBtnText}>Save</Text>
          </Pressable>
        </Section>

        <Section
          title={`Ari memory${currentBrand ? ` · ${currentBrand.displayName}` : ""}`}
        >
          <Text style={styles.about}>
            Review exactly what Ari may carry into future conversations. Brand
            memories stay with the active brand; personal preferences can be
            corrected or forgotten here.
          </Text>
          <View style={styles.kindRow}>
            {MEMORY_KINDS.map((kind) => (
              <Pressable
                key={kind}
                onPress={() => setMemoryKind(kind)}
                style={({ pressed }) => [
                  styles.kindChip,
                  memoryKind === kind && styles.kindChipSelected,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: memoryKind === kind }}
              >
                <Text
                  style={[
                    styles.kindChipText,
                    memoryKind === kind && styles.kindChipTextSelected,
                  ]}
                >
                  {labelForMemoryKind(kind)}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={memoryDraft}
            onChangeText={setMemoryDraft}
            multiline
            maxLength={1200}
            placeholder="What should Ari remember?"
            placeholderTextColor={textTokens.tertiary}
            style={styles.memoryInput}
            accessibilityLabel="Memory content"
          />
          <View style={styles.inlineActions}>
            {editingMemoryId ? (
              <Pressable
                onPress={resetMemoryComposer}
                style={styles.secondaryAction}
                accessibilityRole="button"
                accessibilityLabel="Cancel memory edit"
              >
                <Text style={styles.secondaryActionText}>Cancel edit</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={handleSaveMemory}
              disabled={!memoryDraft.trim() || knowledge.isSaving}
              accessibilityRole="button"
              accessibilityLabel={
                editingMemoryId ? "Update Ari memory" : "Save Ari memory"
              }
              accessibilityState={{
                disabled: !memoryDraft.trim() || knowledge.isSaving,
              }}
              style={({ pressed }) => [
                styles.primaryAction,
                (!memoryDraft.trim() || knowledge.isSaving) && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.primaryActionText}>
                {editingMemoryId ? "Update memory" : "Remember this"}
              </Text>
            </Pressable>
          </View>
          {knowledge.isLoading ? (
            <ActivityIndicator color={ariPalette.flame} />
          ) : null}
          {!knowledge.isLoading && knowledge.memory.length === 0 ? (
            <Text style={styles.emptyText}>
              Ari has no saved memories for this scope yet.
            </Text>
          ) : null}
          {knowledge.memory.map((note) => (
            <View key={note.id} style={styles.memoryCard}>
              <View style={styles.cardHeader}>
                <Text style={styles.memoryKind}>
                  {labelForMemoryKind(note.kind)}
                </Text>
                <Text style={styles.cardMeta}>
                  {note.brand_id ? "This brand" : "All brands"}
                </Text>
              </View>
              <Text style={styles.memoryContent}>{note.content}</Text>
              <View style={styles.inlineActions}>
                <Pressable
                  onPress={() => beginMemoryEdit(note)}
                  style={styles.textAction}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${labelForMemoryKind(note.kind)} memory`}
                >
                  <Text style={styles.textActionLabel}>Edit</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleForgetMemory(note)}
                  style={styles.textAction}
                  accessibilityRole="button"
                  accessibilityLabel={`Forget ${labelForMemoryKind(note.kind)} memory`}
                >
                  <Text style={styles.forgetLabel}>Forget</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </Section>

        <Section title="Long-running tasks">
          <Text style={styles.about}>
            Ari keeps completed steps when you close the app. Pause, resume, or
            cancel any unfinished task without repeating finished work.
          </Text>
          {!knowledge.isLoading && knowledge.jobs.length === 0 ? (
            <Text style={styles.emptyText}>No saved Ari tasks yet.</Text>
          ) : null}
          {knowledge.jobs.map((job) => (
            <View key={job.id} style={styles.memoryCard}>
              <View style={styles.cardHeader}>
                <Text style={styles.jobTitle}>{job.goal_summary}</Text>
                <View style={styles.statusPill}>
                  <Text style={styles.statusText}>
                    {labelForJobStatus(job.status)}
                  </Text>
                </View>
              </View>
              <Text style={styles.cardMeta}>
                {job.completed_step_keys.length} completed ·{" "}
                {job.pending_step_keys.length} remaining
              </Text>
              {job.last_error_code ? (
                <Text style={styles.errorText}>
                  Needs attention: {jobErrorCopy(job.last_error_code)}
                </Text>
              ) : null}
              {!["completed", "cancelled"].includes(job.status) ? (
                <View style={styles.inlineActions}>
                  {job.status === "paused" ? (
                    <Pressable
                      onPress={() => handleJobControl(job, "resume")}
                      style={styles.primaryAction}
                      disabled={knowledge.isControllingJob}
                      accessibilityRole="button"
                      accessibilityLabel={`Resume ${job.goal_summary}`}
                      accessibilityState={{
                        disabled: knowledge.isControllingJob,
                      }}
                    >
                      <Text style={styles.primaryActionText}>Resume</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => handleJobControl(job, "pause")}
                      style={styles.secondaryAction}
                      disabled={knowledge.isControllingJob}
                      accessibilityRole="button"
                      accessibilityLabel={`Pause ${job.goal_summary}`}
                      accessibilityState={{
                        disabled: knowledge.isControllingJob,
                      }}
                    >
                      <Text style={styles.secondaryActionText}>Pause</Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => handleJobControl(job, "cancel")}
                    style={styles.textAction}
                    disabled={knowledge.isControllingJob}
                    accessibilityRole="button"
                    accessibilityLabel={`Cancel ${job.goal_summary}`}
                    accessibilityState={{
                      disabled: knowledge.isControllingJob,
                    }}
                  >
                    <Text style={styles.forgetLabel}>Cancel task</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))}
        </Section>

        {/* Privacy */}
        <Section title="Privacy">
          <Pressable
            onPress={handleDeleteAll}
            style={({ pressed }) => [
              styles.destructiveBtn,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Delete all Ari data for my account"
          >
            <Text style={styles.destructiveText}>Delete all Ari data</Text>
          </Pressable>
        </Section>

        {/* About */}
        <Section title="About">
          <Text style={styles.about}>
            Ari is powered by Mingla&apos;s AI. Your conversations are stored so
            Ari remembers context across visits. Ari is not a financial, legal,
            or tax advisor.
          </Text>
        </Section>

        {__DEV__ ? (
          <Section title="Local preview">
            <Text style={styles.about}>
              Inspect every Ari response, research, recovery, and memory state
              with deterministic local data.
            </Text>
            <Pressable
              onPress={() => router.push("/auth/ari-renditions" as never)}
              style={({ pressed }) => [
                styles.previewBtn,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Open Ari rendition gallery"
            >
              <Text style={styles.previewBtnText}>Open 65-state gallery</Text>
            </Pressable>
          </Section>
        ) : null}
      </ScrollView>
    </View>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
    <View style={styles.sectionInner}>{children}</View>
  </View>
);

const FieldRow: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <View style={styles.fieldRow}>
    <Text style={styles.fieldLabel}>{label}</Text>
    {children}
  </View>
);

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: glass.border.profileBase,
  },
  backBtn: {
    height: 44,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    width: 64,
  },
  backText: {
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
  },
  title: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  pressed: {
    opacity: 0.7,
  },
  content: {
    padding: spacing.md,
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: typography.labelCap.fontSize,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    color: textTokens.tertiary,
  },
  sectionInner: {
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radius.md,
    overflow: "hidden",
    padding: spacing.md,
    gap: spacing.md,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 44,
  },
  rowLabel: {
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
    flex: 1,
  },
  rowValue: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.tertiary,
  },
  hint: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.tertiary,
  },
  fieldRow: {
    gap: 4,
  },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    letterSpacing: typography.caption.letterSpacing,
  },
  input: {
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: glass.border.pending,
    minHeight: 44,
  },
  kindRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  kindChip: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    justifyContent: "center",
    backgroundColor: canvas.discover,
  },
  kindChipSelected: {
    backgroundColor: ariPalette.userBubble,
    borderColor: ariPalette.userBubble,
  },
  kindChipText: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
  },
  kindChipTextSelected: {
    color: ariThread.onUserBubble,
    fontWeight: "700",
  },
  memoryInput: {
    minHeight: 88,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    textAlignVertical: "top",
    backgroundColor: canvas.discover,
  },
  inlineActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  primaryAction: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ariPalette.userBubble,
  },
  primaryActionText: {
    color: ariThread.onUserBubble,
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
  },
  secondaryAction: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryActionText: {
    color: textTokens.primary,
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
  },
  disabled: {
    opacity: 0.45,
  },
  emptyText: {
    color: textTokens.tertiary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
  },
  memoryCard: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: glass.border.profileBase,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  memoryKind: {
    color: textTokens.primary,
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
  },
  memoryContent: {
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
  },
  cardMeta: {
    color: textTokens.tertiary,
    fontSize: typography.caption.fontSize,
  },
  textAction: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  textActionLabel: {
    color: textTokens.primary,
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
  },
  forgetLabel: {
    color: semantic.error,
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
  },
  jobTitle: {
    flex: 1,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    fontWeight: "600",
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: glass.tint.profileElevated,
  },
  statusText: {
    color: textTokens.secondary,
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
  },
  errorText: {
    color: semantic.error,
    fontSize: typography.bodySm.fontSize,
  },
  saveBtn: {
    marginTop: spacing.sm,
    height: 44,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileElevated,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  destructiveBtn: {
    height: 44,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: semantic.errorTint,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  destructiveText: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: semantic.error,
  },
  about: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  previewBtn: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: ariPalette.userBubble,
    paddingHorizontal: spacing.md,
  },
  previewBtnText: {
    color: ariThread.onUserBubble,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "700",
  },
});

export default AriSettingsScreen;
