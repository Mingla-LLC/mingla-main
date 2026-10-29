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
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { EmptyState } from "../../../../src/components/ui/EmptyState";
import { TemplateCard } from "../../../../src/components/marketing/TemplateCard";
import {
  spacing,
  text as textTokens,
  typography,
} from "../../../../src/constants/designSystem";
import { useAuth } from "../../../../src/context/AuthContext";
import { useStarterTemplates } from "../../../../src/hooks/marketing/useStarterTemplates";
import { useUserTemplates } from "../../../../src/hooks/marketing/useUserTemplates";
import { useResponsiveLayout } from "../../../../src/hooks/useResponsiveLayout";

export default function MarketingTemplatesRoute(): React.ReactElement {
  const router = useRouter();
  const { isWideDesktop } = useResponsiveLayout();
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
        <View style={[styles.templateGrid, isWideDesktop && styles.templateGridWide]}>
          {starters.map((tmpl) => (
            <View key={tmpl.id} style={isWideDesktop ? styles.templateCellWide : styles.templateCell}>
              <TemplateCard template={tmpl} onPress={handleOpenTemplate} />
            </View>
          ))}
        </View>

        {userTemplates.length > 0 ? (
          <>
            <View style={styles.sectionSpacer} />
            <Text style={styles.sectionLabel}>YOUR TEMPLATES</Text>
            <View style={[styles.templateGrid, isWideDesktop && styles.templateGridWide]}>
              {userTemplates.map((tmpl) => (
                <View key={tmpl.id} style={isWideDesktop ? styles.templateCellWide : styles.templateCell}>
                  <TemplateCard template={tmpl} onPress={handleOpenTemplate} />
                </View>
              ))}
            </View>
          </>
        ) : null}

        {userError && userTemplates.length === 0 ? (
          <Text style={styles.userErrorText}>
            Couldn&apos;t load your templates. Pull to retry.
          </Text>
        ) : null}
      </ScrollView>

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
  templateGrid: { gap: spacing.sm },
  templateGridWide: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start" },
  templateCell: { width: "100%" },
  templateCellWide: { flexBasis: "48%", flexGrow: 1, minWidth: 360 },
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
});
