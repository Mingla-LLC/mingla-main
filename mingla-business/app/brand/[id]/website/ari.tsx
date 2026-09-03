import React, { useCallback, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { AriChatScreen } from "../../../../src/screens/ari/AriChatScreen";
import { SafeScreen } from "../../../../src/components/ui/SafeScreen";
import { TopBar } from "../../../../src/components/ui/TopBar";
import { Button } from "../../../../src/components/ui/Button";
import {
  canvas,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../../../src/constants/designSystem";
import { isFeatureEnabled } from "../../../../src/config/featureFlags";
import { useCurrentBrandRole } from "../../../../src/hooks/useCurrentBrandRole";
import { useResponsiveLayout } from "../../../../src/hooks/useResponsiveLayout";
import { useBrandSite, useBrandSitePreview } from "../../../../src/hooks/useBrandSite";
import { openWebsiteUrl } from "../../../../src/sites/websiteExternalOpen";
import { studioReturnSurface } from "../../../../src/sites/studioHandoff";

/**
 * #2830 — edit the website WITH the draft in front of you.
 *
 * Ari previously edited the site from the Ari tab: a full-screen conversation
 * with no sight of the page it was changing. You confirmed a proposal, then
 * left to mint a preview to find out what you had agreed to.
 *
 * Desktop puts the draft on the LEFT and the conversation on the RIGHT.
 * Phone stacks them — preview above, conversation below — because a split
 * column at 390pt gives neither half enough room to be useful.
 *
 * It reuses `AriChatScreen` in embedded mode rather than reimplementing the
 * chat, so the split view and the tab cannot become two different Aris.
 */
export default function BrandWebsiteAriRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const brandId = Array.isArray(params.id) ? params.id[0] : params.id;
  const safeBrandId = typeof brandId === "string" ? brandId : "";
  const { isWideDesktop } = useResponsiveLayout();
  const role = useCurrentBrandRole(safeBrandId || null);
  const enabled = isFeatureEnabled("sites") && !role.isLoading &&
    role.rank >= 20 && safeBrandId.length > 0;
  const site = useBrandSite(safeBrandId, enabled);
  const preview = useBrandSitePreview(safeBrandId, site.data?.id ?? null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(`/brand/${safeBrandId}/website` as never);
  }, [router, safeBrandId]);

  const openPreview = useCallback((): void => {
    setPreviewError(null);
    void preview
      .mutateAsync(studioReturnSurface(Platform.OS))
      .then((grant) => openWebsiteUrl(grant.preview_url))
      .catch(() => {
        setPreviewError(
          "Mingla could not open a private preview just now. Your draft is unchanged.",
        );
      });
  }, [preview]);

  if (!isFeatureEnabled("sites")) {
    return <Redirect href={`/brand/${safeBrandId}` as never} />;
  }
  if (!role.isLoading && role.rank < 20) {
    return <Redirect href={`/brand/${safeBrandId}` as never} />;
  }

  const draft = (
    <View style={styles.previewPane} testID="website-ari-preview">
      <View style={styles.previewBar}>
        <Text style={styles.previewLabel}>Draft</Text>
        <Text style={styles.previewNote} numberOfLines={1}>
          Not live until you publish
        </Text>
      </View>
      <View style={styles.previewBody}>
        <Text style={styles.body}>
          Open the private preview to see the exact draft Ari is editing,
          rendered by the same engine that serves your live website.
        </Text>
        {previewError ? (
          <Text style={styles.previewError}>{previewError}</Text>
        ) : null}
        <Button
          label="Open private preview"
          loading={preview.isPending}
          onPress={openPreview}
          leadingIcon="eye"
          fullWidth
        />
        <Button
          label="Review and publish"
          onPress={() =>
            router.push(`/brand/${safeBrandId}/website` as never)
          }
          variant="secondary"
          fullWidth
        />
      </View>
    </View>
  );

  const conversation = (
    <View style={styles.chatPane} testID="website-ari-chat">
      <AriChatScreen embedded />
    </View>
  );

  return (
    <SafeScreen style={{ backgroundColor: canvas.discover }}>
      <TopBar
        leftKind="back"
        title="Edit with Ari"
        onBack={handleBack}
        rightSlot={null}
      />
      {isWideDesktop ? (
        <View style={styles.splitRow} testID="website-ari-split">
          {draft}
          {conversation}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.stack}
          testID="website-ari-stack"
        >
          {draft}
          {conversation}
        </ScrollView>
      )}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  splitRow: {
    flex: 1,
    flexDirection: "row",
    gap: spacing.lg,
    padding: spacing.md,
  },
  stack: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
  previewPane: {
    flex: 1.3,
    minWidth: 0,
    minHeight: 220,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    overflow: "hidden",
  },
  chatPane: {
    flex: 1,
    minWidth: 0,
    minHeight: 360,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    overflow: "hidden",
  },
  previewBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: glass.border.profileBase,
  },
  previewLabel: {
    ...typography.micro,
    color: textTokens.primary,
    textTransform: "uppercase",
  },
  previewNote: { ...typography.caption, color: textTokens.tertiary, flex: 1 },
  previewBody: {
    flex: 1,
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.lg,
  },
  body: { ...typography.body, color: textTokens.secondary },
  previewError: { ...typography.bodySm, color: textTokens.primary },
});
