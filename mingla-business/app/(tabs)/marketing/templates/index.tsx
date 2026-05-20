/**
 * Marketing → Templates (ORCH-0863 Phase B).
 *
 * Lists starter pack (5 read-only Mingla seeds) + user-authored templates.
 * Starter section always renders; user section hidden when zero rows. FAB
 * navigates to templates/new (sentinel route handled by [id].tsx).
 */

import React, { useCallback } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { EmptyState } from "../../../../src/components/ui/EmptyState";
import { Icon } from "../../../../src/components/ui/Icon";
import { TemplateCard } from "../../../../src/components/marketing/TemplateCard";
import {
  accent,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../../../src/constants/designSystem";
import { useAuth } from "../../../../src/context/AuthContext";
import { useStarterTemplates } from "../../../../src/hooks/marketing/useStarterTemplates";
import { useUserTemplates } from "../../../../src/hooks/marketing/useUserTemplates";
import { useStickyFooterOffset } from "../../../../src/hooks/useStickyFooterOffset";

export default function MarketingTemplatesRoute(): React.ReactElement {
  const router = useRouter();
  const fabOffset = useStickyFooterOffset();
  const { user } = useAuth();
  const accountId = user?.id ?? null;
  const starterQuery = useStarterTemplates();
  const userQuery = useUserTemplates(accountId);

  const handleOpenTemplate = useCallback(
    (id: string) => {
      router.push(`/marketing/templates/${id}` as never);
    },
    [router],
  );

  const handleNewTemplate = useCallback(() => {
    router.push("/marketing/templates/new" as never);
  }, [router]);

  // Starter loading + no cache → full-screen spinner.
  if (starterQuery.isLoading && starterQuery.data === undefined) {
    return (
      <View style={styles.host}>
        <View style={styles.centerHost}>
          <ActivityIndicator size="small" color={textTokens.secondary} />
        </View>
      </View>
    );
  }

  // Starter query error is unusual (seeded DB read) — treat as full-screen error.
  if (starterQuery.isError || starterQuery.data === undefined) {
    return (
      <View style={styles.host}>
        <View style={styles.centerHost}>
          <EmptyState
            illustration="users"
            title="Couldn't load templates"
            description="Pull to retry."
          />
        </View>
      </View>
    );
  }

  const starters = starterQuery.data;
  const userTemplates = userQuery.data ?? [];
  const userError = userQuery.isError;

  return (
    <View style={styles.host}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionLabel}>MINGLA STARTER PACK</Text>
        <Text style={styles.sectionCaption}>Read-only — duplicate to customize.</Text>
        {starters.map((tmpl) => (
          <TemplateCard
            key={tmpl.id}
            template={tmpl}
            onPress={handleOpenTemplate}
          />
        ))}

        {userTemplates.length > 0 ? (
          <>
            <View style={styles.sectionSpacer} />
            <Text style={styles.sectionLabel}>YOUR TEMPLATES</Text>
            {userTemplates.map((tmpl) => (
              <TemplateCard
                key={tmpl.id}
                template={tmpl}
                onPress={handleOpenTemplate}
              />
            ))}
          </>
        ) : null}

        {userError && userTemplates.length === 0 ? (
          <Text style={styles.userErrorText}>
            Couldn't load your templates. Pull to retry.
          </Text>
        ) : null}
      </ScrollView>

      <Pressable
        onPress={handleNewTemplate}
        accessibilityRole="button"
        accessibilityLabel="New template"
        style={({ pressed }) => [
          styles.fab,
          { bottom: fabOffset },
          pressed ? styles.fabPressed : null,
        ]}
      >
        <Icon name="plus" size={24} color={textTokens.primary} />
        <Text style={styles.fabLabel}>New template</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: 120,
    gap: spacing.sm,
  },
  centerHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  sectionLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  sectionCaption: {
    ...typography.bodySm,
    color: textTokens.tertiary,
    marginBottom: spacing.xs,
  },
  sectionSpacer: {
    height: spacing.md,
  },
  userErrorText: {
    ...typography.bodySm,
    color: "#f59e0b",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
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
