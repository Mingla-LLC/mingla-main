/**
 * ORCH-0821 — AriSettingsScreen
 * Memory transparency + privacy controls. Three sections:
 *   - Mode (locked to Co-pilot in MVP)
 *   - What Ari knows (profile fields with edit/forget)
 *   - Privacy (delete all data + AI disclosure note)
 */

import React, { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper. Per SPEC §7.F.
import { ScrollView } from "../../wrappers/SmartScrollView";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  canvas,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useAriPreferences } from "../../hooks/useAriPreferences";

export const AriSettingsScreen: React.FC = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const prefs = useAriPreferences();
  const [displayName, setDisplayName] = useState(prefs.profile?.display_name ?? "");
  const [timezone, setTimezone] = useState(prefs.profile?.preferred_timezone ?? "");

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
      Alert.alert("Couldn't save", err instanceof Error ? err.message : "Unknown error");
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
              Alert.alert("Deleted", "All Ari data for your account has been removed.");
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
            <Text style={styles.rowLabel}>Co-pilot (always ask before writes)</Text>
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

        {/* Privacy */}
        <Section title="Privacy">
          <Pressable
            onPress={handleDeleteAll}
            style={({ pressed }) => [styles.destructiveBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Delete all Ari data for my account"
          >
            <Text style={styles.destructiveText}>Delete all Ari data</Text>
          </Pressable>
        </Section>

        {/* About */}
        <Section title="About">
          <Text style={styles.about}>
            Ari uses Google Gemini. Your conversations are stored so Ari remembers context across
            visits. Ari is not a financial, legal, or tax advisor.
          </Text>
        </Section>
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
  saveBtn: {
    marginTop: spacing.sm,
    height: 44,
    borderRadius: radius.md,
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
});

export default AriSettingsScreen;
