/**
 * Marketing → Templates → [id] — template detail screen (ORCH-0863 Phase B).
 *
 * Two modes:
 *   - read-only (starter rows): subject + body display + "Duplicate" + "Use this template"
 *   - editable (user rows OR id="new"): subject + body inputs + Save + Delete + "Use this template"
 *
 * Honors:
 *   - feedback_keyboard_never_blocks_input.md — KeyboardAvoidingView wrap
 *   - feedback_back_listener_disarm_pattern.md — dirty-state back-block via sanctionedExitRef
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "../../../../src/components/ui/EmptyState";
import { Icon } from "../../../../src/components/ui/Icon";
import { TemplateEditor, type TemplateEditorMode } from "../../../../src/components/marketing/TemplateEditor";
import {
  accent,
  canvas,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../../src/constants/designSystem";
import { useAuth } from "../../../../src/context/AuthContext";
import { useCurrentBrand } from "../../../../src/hooks/useCurrentBrand";
import { useTemplate } from "../../../../src/hooks/marketing/useTemplate";
import {
  useCreateUserTemplate,
  useDeleteUserTemplate,
  useDuplicateTemplate,
  useUpdateUserTemplate,
} from "../../../../src/hooks/marketing/useTemplateMutations";

export default function TemplateDetailRoute(): React.ReactElement {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const templateId = typeof rawId === "string" && rawId.length > 0 ? rawId : null;

  const { user } = useAuth();
  const accountId = user?.id ?? null;
  const currentBrand = useCurrentBrand();
  const brandId = currentBrand?.id ?? null;

  const isNewMode = templateId === "new";
  const templateQuery = useTemplate(isNewMode ? null : templateId);

  const [subject, setSubject] = useState<string>("");
  const [body, setBody] = useState<string>("");
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [hydrated, setHydrated] = useState<boolean>(false);
  const sanctionedExitRef = useRef<boolean>(false);

  const createMutation = useCreateUserTemplate(accountId);
  const updateMutation = useUpdateUserTemplate(accountId);
  const duplicateMutation = useDuplicateTemplate(accountId);
  const deleteMutation = useDeleteUserTemplate(accountId);

  // Hydrate subject + body from loaded template (once).
  useEffect(() => {
    if (isNewMode) {
      setHydrated(true);
      return;
    }
    if (templateQuery.data === undefined || templateQuery.data === null) return;
    if (hydrated) return;
    setSubject(templateQuery.data.subject_template ?? "");
    setBody(templateQuery.data.body_template);
    setHydrated(true);
  }, [isNewMode, templateQuery.data, hydrated]);

  const template = templateQuery.data ?? null;
  const isReadOnly = !isNewMode && template !== null && template.is_starter_pack === true;
  const isEditable = !isReadOnly; // new mode + user rows
  const mode: TemplateEditorMode = isNewMode ? "new" : isReadOnly ? "readonly" : "editable";

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/marketing/templates" as never);
  }, [router]);

  const handleSubjectChange = useCallback((next: string) => {
    setSubject(next);
    setIsDirty(true);
  }, []);

  const handleBodyChange = useCallback((next: string) => {
    setBody(next);
    setIsDirty(true);
  }, []);

  const performSave = useCallback(async (): Promise<string | null> => {
    if (accountId === null) return null;
    if (subject.trim().length === 0 && body.trim().length === 0) {
      Alert.alert("Add a name + body", "Subject is optional, but body is required.");
      return null;
    }
    if (isNewMode) {
      // Use subject as the name when present, fallback to "Untitled template".
      const name = subject.trim().length > 0 ? subject.trim() : "Untitled template";
      const created = await createMutation.mutateAsync({
        account_id: accountId,
        brand_id: brandId,
        name,
        subject_template: subject.length > 0 ? subject : null,
        body_template: body,
      });
      setIsDirty(false);
      sanctionedExitRef.current = true;
      router.replace(`/marketing/templates/${created.id}` as never);
      return created.id;
    }
    if (template === null) return null;
    const name = template.name;
    const updated = await updateMutation.mutateAsync({
      template_id: template.id,
      name,
      subject_template: subject.length > 0 ? subject : null,
      body_template: body,
    });
    setIsDirty(false);
    return updated.id;
  }, [accountId, brandId, subject, body, isNewMode, template, createMutation, updateMutation, router]);

  const handleSave = useCallback(() => {
    void performSave();
  }, [performSave]);

  const handleDuplicate = useCallback(async () => {
    if (accountId === null || template === null) return;
    try {
      const copy = await duplicateMutation.mutateAsync({
        source_template_id: template.id,
        account_id: accountId,
        brand_id: brandId,
      });
      sanctionedExitRef.current = true;
      router.replace(`/marketing/templates/${copy.id}` as never);
    } catch (err) {
      Alert.alert(
        "Couldn't duplicate",
        err instanceof Error ? err.message : "Try again in a moment.",
      );
    }
  }, [accountId, brandId, template, duplicateMutation, router]);

  const handleDelete = useCallback(() => {
    if (template === null) return;
    Alert.alert(
      "Delete this template?",
      "This can't be undone. Campaigns that used this template keep their saved content.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteMutation.mutateAsync({ template_id: template.id });
              sanctionedExitRef.current = true;
              if (router.canGoBack()) router.back();
              else router.replace("/(tabs)/marketing/templates" as never);
            } catch (err) {
              Alert.alert(
                "Couldn't delete",
                err instanceof Error ? err.message : "Try again in a moment.",
              );
            }
          },
        },
      ],
    );
  }, [template, deleteMutation, router]);

  const handleUse = useCallback(async () => {
    let id: string | null = null;
    if (isNewMode || isDirty) {
      id = await performSave();
      if (id === null) return;
    } else if (template !== null) {
      id = template.id;
    }
    if (id === null) return;
    sanctionedExitRef.current = true;
    router.push(`/marketing/campaigns/compose?template=${id}` as never);
  }, [isNewMode, isDirty, performSave, template, router]);

  // Back-block when dirty (mirrors composer pattern at compose.tsx:384-420).
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove" as never, (event: unknown) => {
      const ev = event as { preventDefault: () => void };
      if (sanctionedExitRef.current) return;
      if (!isDirty) return;
      ev.preventDefault?.();
      Alert.alert(
        "Save changes?",
        "You've edited this template. Save them so you can use them later — or discard.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => {
              sanctionedExitRef.current = true;
              if (router.canGoBack()) router.back();
              else router.replace("/(tabs)/marketing/templates" as never);
            },
          },
          {
            text: "Save",
            onPress: async () => {
              await performSave();
              sanctionedExitRef.current = true;
              if (router.canGoBack()) router.back();
              else router.replace("/(tabs)/marketing/templates" as never);
            },
          },
        ],
      );
    });
    return unsubscribe;
  }, [navigation, isDirty, performSave, router]);

  // Loading
  if (!isNewMode && templateQuery.isLoading && templateQuery.data === undefined) {
    return (
      <View style={styles.host}>
        <Header onBack={handleBack} title="Template" rightSlot={null} />
        <View style={styles.centerHost}>
          <ActivityIndicator size="small" color={textTokens.secondary} />
        </View>
      </View>
    );
  }

  // Not found / error
  if (!isNewMode && (templateQuery.isError || templateQuery.data === null)) {
    return (
      <View style={styles.host}>
        <Header onBack={handleBack} title="Template" rightSlot={null} />
        <View style={styles.centerHost}>
          <EmptyState
            illustration="users"
            title="Couldn't load template"
            description="The link may be stale."
          />
        </View>
      </View>
    );
  }

  // RLS: caller doesn't own this user template
  if (
    !isNewMode &&
    template !== null &&
    template.is_starter_pack === false &&
    accountId !== null &&
    template.account_id !== accountId
  ) {
    return (
      <View style={styles.host}>
        <Header onBack={handleBack} title="Template" rightSlot={null} />
        <View style={styles.centerHost}>
          <EmptyState
            illustration="users"
            title="Couldn't load template"
            description="You don't have access to this template."
          />
        </View>
      </View>
    );
  }

  const headerTitle = (() => {
    if (isNewMode) return "New template";
    if (template === null) return "Template";
    return `${isDirty && isEditable ? "• " : ""}${template.name}`;
  })();

  const saveBusy = createMutation.isPending || updateMutation.isPending;
  const headerRight = (() => {
    if (isReadOnly) {
      // Read-only mode (starter template): Duplicate lives in the header
      // right slot (the editable-mode Save slot's mirror — never both visible).
      if (duplicateMutation.isPending) {
        return <ActivityIndicator size="small" color={textTokens.secondary} />;
      }
      return (
        <Pressable
          onPress={handleDuplicate}
          accessibilityRole="button"
          accessibilityLabel="Duplicate this template"
          accessibilityHint="Creates a copy you can edit"
          style={({ pressed }) => [styles.headerSave, pressed ? styles.iconBtnPressed : null]}
          hitSlop={8}
        >
          <Text style={styles.headerSaveText}>Duplicate</Text>
        </Pressable>
      );
    }
    if (isEditable && (isDirty || isNewMode)) {
      if (saveBusy) {
        return <ActivityIndicator size="small" color={textTokens.secondary} />;
      }
      return (
        <Pressable
          onPress={handleSave}
          accessibilityRole="button"
          accessibilityLabel="Save changes"
          accessibilityState={{ disabled: !(isDirty || isNewMode) }}
          style={({ pressed }) => [styles.headerSave, pressed ? styles.iconBtnPressed : null]}
          hitSlop={8}
        >
          <Text style={styles.headerSaveText}>Save</Text>
        </Pressable>
      );
    }
    return null;
  })();

  // Delete only renders for existing editable user templates (NOT in
  // read-only / new modes). It's a destructive inline text-link at the
  // bottom of the scroll content, NOT a sticky footer button (per the
  // FAB-philosophy fix that removed the sticky bar).
  const showDeleteLink = isEditable && !isNewMode && template !== null;

  return (
    <View style={styles.host}>
      <Header onBack={handleBack} title={headerTitle} rightSlot={headerRight} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.kavHost}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 120 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <TemplateEditor
            mode={mode}
            subject={subject}
            body={body}
            onSubjectChange={isEditable ? handleSubjectChange : undefined}
            onBodyChange={isEditable ? handleBodyChange : undefined}
          />
          {showDeleteLink ? (
            <Pressable
              onPress={handleDelete}
              accessibilityRole="button"
              accessibilityLabel="Delete this template"
              accessibilityHint="Removes the template. Existing campaigns keep their saved content."
              style={({ pressed }) => [styles.deleteLink, pressed ? styles.deleteLinkPressed : null]}
              hitSlop={8}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <ActivityIndicator size="small" color={semantic.error} />
              ) : (
                <Text style={styles.deleteLinkText}>Delete this template</Text>
              )}
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Floating primary CTA — matches the Overview / Campaigns / Templates
          FAB pattern (position: absolute, right + bottom: insets.bottom + 96,
          accent.warm-tinted pill). Visible in every mode; tap handler routes
          to composer with template pre-fill (and auto-saves first when
          editable / new and dirty). */}
      <Pressable
        onPress={() => { void handleUse(); }}
        accessibilityRole="button"
        accessibilityLabel="Use this template"
        accessibilityHint="Opens the campaign composer with this template loaded"
        style={({ pressed }) => [
          styles.fab,
          { bottom: insets.bottom + 96 },
          pressed ? styles.fabPressed : null,
        ]}
        disabled={saveBusy}
      >
        <Text style={styles.fabLabel}>Use this template →</Text>
      </Pressable>
    </View>
  );
}

interface HeaderProps {
  onBack: () => void;
  title: string;
  rightSlot: React.ReactNode;
}
const Header: React.FC<HeaderProps> = ({ onBack, title, rightSlot }) => (
  <View style={styles.header}>
    <Pressable
      onPress={onBack}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={({ pressed }) => [styles.iconBtn, pressed ? styles.iconBtnPressed : null]}
      hitSlop={8}
    >
      <Icon name="arrowL" size={24} color={textTokens.primary} />
    </Pressable>
    <Text style={styles.headerTitle} numberOfLines={1}>
      {title}
    </Text>
    {rightSlot !== null ? <View style={styles.headerRight}>{rightSlot}</View> : <View style={styles.headerRightSpacer} />}
  </View>
);

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  kavHost: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    minHeight: 56,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
  },
  iconBtnPressed: {
    opacity: 0.78,
  },
  headerTitle: {
    ...typography.bodyLg,
    color: textTokens.primary,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
  },
  headerRight: {
    minWidth: 44,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  headerRightSpacer: {
    width: 44,
  },
  headerSave: {
    paddingHorizontal: spacing.md,
    minHeight: 44,
    justifyContent: "center",
  },
  headerSaveText: {
    ...typography.buttonMd,
    color: accent.warm,
  },
  centerHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    // paddingBottom is set per-render via insets.bottom + 120 to clear the
    // floating FAB and the BottomNav capsule. Templates detail uses the same
    // FAB pattern as Overview / Campaigns / Templates list, NOT a sticky footer.
  },
  // Inline destructive Delete link rendered at the bottom of the scroll
  // content in editable mode (existing user-template rows only). Mirrors the
  // iOS Settings "Delete account" placement convention. NOT sticky.
  deleteLink: {
    marginTop: spacing.xl,
    paddingVertical: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  deleteLinkPressed: {
    opacity: 0.6,
  },
  deleteLinkText: {
    ...typography.buttonMd,
    color: semantic.error,
  },
  // Floating CTA — exact-same shape as the Overview / Campaigns / Templates
  // list FABs (position: absolute, right: spacing.md, bottom: insets.bottom +
  // 96 to clear the floating BottomNav capsule, accent.warm-tinted pill).
  fab: {
    position: "absolute",
    right: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 48,
    borderRadius: radius.full,
    backgroundColor: "rgba(235, 120, 37, 0.42)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.32,
    shadowRadius: 12,
    elevation: 6,
  },
  fabPressed: {
    opacity: 0.85,
  },
  fabLabel: {
    ...typography.bodySm,
    fontWeight: "600",
    color: textTokens.primary,
  },
});
