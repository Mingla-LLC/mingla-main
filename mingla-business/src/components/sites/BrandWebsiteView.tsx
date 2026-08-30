import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import {
  accent,
  glass,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type {
  BrandSiteAnalytics,
  BrandSiteOverview,
  BrandSiteVersion,
} from "../../sites/contracts";
import {
  deriveWebsiteJourneyState,
  primarySiteHost,
} from "../../sites/contracts";

interface BrandWebsiteViewProps {
  brandName: string;
  site: BrandSiteOverview | null;
  rank: number;
  isLoading: boolean;
  isError: boolean;
  isProvisioning: boolean;
  isOpeningStudio: boolean;
  isPreviewing: boolean;
  isPublishing: boolean;
  isRollingBack: boolean;
  versions: BrandSiteVersion[];
  analytics: BrandSiteAnalytics | null;
  onRetry: () => void;
  onProvision: () => void;
  onOpenStudio: () => void;
  onPreview: () => void;
  onViewLive: (hostname: string) => void;
  onOpenAri: () => void;
  onPublish: () => void;
  onRollback: (version: BrandSiteVersion) => void;
}

const statusCopy: Record<BrandSiteOverview["status"], string> = {
  provisioning: "Creating your private Website workspace…",
  draft: "Your draft is ready to edit and preview.",
  publishing: "Publishing is in progress. You can leave safely.",
  published: "Your last verified Website is live.",
  suspended:
    "Public delivery is paused. Your verified publication is preserved.",
  error: "Setup needs attention. Your last verified Website remains safe.",
};

export const BrandWebsiteView: React.FC<BrandWebsiteViewProps> = ({
  brandName,
  site,
  rank,
  isLoading,
  isError,
  isProvisioning,
  isOpeningStudio,
  isPreviewing,
  isPublishing,
  isRollingBack,
  versions,
  analytics,
  onRetry,
  onProvision,
  onOpenStudio,
  onPreview,
  onViewLive,
  onOpenAri,
  onPublish,
  onRollback,
}) => {
  const host = useMemo(
    () => (site === null ? null : primarySiteHost(site)),
    [site],
  );
  const state = deriveWebsiteJourneyState(site);
  const canProvision = rank >= 50;
  const canWork = rank >= 20;

  if (!canWork) {
    return null;
  }
  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator
          color={accent.warm}
          accessibilityLabel="Loading Website"
        />
        <Text style={styles.body}>Loading Website…</Text>
      </View>
    );
  }
  if (isError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Couldn’t load Website</Text>
        <Text style={styles.body}>Your public Website is unaffected.</Text>
        <Button label="Try again" onPress={onRetry} variant="secondary" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.headingRow}>
        <View style={styles.headingIcon}>
          <Icon name="globe" size={22} color={accent.warm} />
        </View>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>RESTAURANT WEBSITE V1</Text>
          <Text style={styles.title}>{brandName} Website</Text>
          <Text style={styles.body}>
            Structured editing, private previews and verified publishing.
          </Text>
        </View>
      </View>

      {site === null ? (
        <GlassCard
          variant="elevated"
          contentStyle={styles.cardContent}
          testID="website-not-setup"
        >
          <Text style={styles.cardTitle}>Your Website isn’t set up yet</Text>
          <Text style={styles.body}>
            Mingla will create one private draft using the fixed Restaurant
            Website v1 layout.
          </Text>
          {canProvision ? (
            <Button
              label="Set up Website"
              loading={isProvisioning}
              onPress={() =>
                Alert.alert(
                  "Create Website draft?",
                  "This creates a private draft. Nothing becomes public until a separate publish confirmation.",
                  [
                    { text: "Cancel", style: "cancel" },
                    { text: "Create draft", onPress: onProvision },
                  ],
                )
              }
              leadingIcon="plus"
            />
          ) : (
            <Text style={styles.helper}>
              A brand admin needs to set this up.
            </Text>
          )}
        </GlassCard>
      ) : (
        <>
          <GlassCard variant="elevated" contentStyle={styles.cardContent}>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  site.status === "published"
                    ? styles.statusDotLive
                    : site.status === "error"
                      ? styles.statusDotError
                      : undefined,
                ]}
              />
              <Text style={styles.cardTitle}>
                {site.status === "published"
                  ? "Verified live"
                  : "Website workspace"}
              </Text>
            </View>
            <Text style={styles.body}>{statusCopy[site.status]}</Text>
            <Text style={styles.meta}>
              Journey state {state} · Last checked{" "}
              {new Date(site.updated_at).toLocaleString()}
            </Text>
            <View style={styles.actionStack}>
              <Button
                label="Open Mingla Studio"
                loading={isOpeningStudio}
                onPress={onOpenStudio}
                leadingIcon="edit"
                fullWidth
              />
              <Button
                label="Preview draft"
                loading={isPreviewing}
                onPress={onPreview}
                variant="secondary"
                leadingIcon="eye"
                fullWidth
              />
              <Button
                label="Publish Website"
                loading={isPublishing}
                onPress={() =>
                  Alert.alert(
                    "Publish Website?",
                    "Mingla will validate and verify this exact revision before changing the public Website.",
                    [
                      { text: "Preview again", style: "cancel", onPress: onPreview },
                      { text: "Publish Website", onPress: onPublish },
                    ],
                  )
                }
                variant="secondary"
                fullWidth
              />
              <Button
                label="Edit with Ari"
                onPress={onOpenAri}
                variant="ghost"
                fullWidth
              />
            </View>
          </GlassCard>

          <GlassCard variant="base" contentStyle={styles.cardContent}>
            <Text style={styles.cardTitle}>Analytics</Text>
            {analytics === null ? (
              <Text style={styles.body}>Analytics are unavailable. Your Website remains live.</Text>
            ) : (
              <View style={styles.metricRow}>
                <View style={styles.metric}><Text style={styles.metricValue}>{analytics.events_30d}</Text><Text style={styles.helper}>Privacy-safe events · 30 days</Text></View>
                <View style={styles.metric}><Text style={styles.metricValue}>{analytics.consumed_handoffs}</Text><Text style={styles.helper}>Attributed checkouts</Text></View>
              </View>
            )}
          </GlassCard>

          <GlassCard variant="base" contentStyle={styles.cardContent}>
            <Text style={styles.cardTitle}>Versions</Text>
            {versions.length === 0 ? (
              <Text style={styles.body}>No verified publication versions yet.</Text>
            ) : versions.slice(0, 5).map((version) => (
              <View key={version.id} style={styles.versionRow}>
                <View style={styles.versionCopy}>
                  <Text style={styles.versionTitle}>Revision {version.source_revision_id}</Text>
                  <Text style={styles.helper}>{version.status} · {new Date(version.requested_at).toLocaleString()}</Text>
                </View>
                {version.status === "published" && version.id !== site.active_publication_id ? (
                  <Button
                    label="Publish this version"
                    loading={isRollingBack}
                    onPress={() =>
                      Alert.alert(
                        "Publish this earlier version?",
                        "It will be validated again and published as a new version. History is preserved.",
                        [
                          { text: "Cancel", style: "cancel" },
                          { text: "Publish earlier version", onPress: () => onRollback(version) },
                        ],
                      )
                    }
                    variant="ghost"
                  />
                ) : null}
              </View>
            ))}
          </GlassCard>

          <GlassCard variant="base" contentStyle={styles.cardContent}>
            <Text style={styles.cardTitle}>Permanent Mingla address</Text>
            {host === null ? (
              <Text style={styles.body}>
                Your permanent address will appear after setup completes.
              </Text>
            ) : (
              <>
                <Text style={styles.address}>{host.hostname}</Text>
                <Text style={styles.helper}>Managed by Mingla.</Text>
                {site.active_publication_id !== null &&
                host.status === "active" ? (
                  <Button
                    label="View Website"
                    onPress={() => onViewLive(host.hostname)}
                    variant="secondary"
                    leadingIcon="eye"
                  />
                ) : null}
              </>
            )}
          </GlassCard>

          {site.status === "error" ? (
            <GlassCard variant="base" contentStyle={styles.cardContent}>
              <Text style={styles.failureTitle}>Last good preserved</Text>
              <Text style={styles.body}>
                Review the draft in Mingla Studio, then publish again when it
                validates.
              </Text>
            </GlassCard>
          ) : null}
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
  headingRow: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "flex-start",
  },
  headingIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: accent.tint,
    borderColor: accent.border,
    borderWidth: 1,
  },
  headingCopy: { flex: 1, gap: spacing.xs },
  eyebrow: {
    color: accent.warm,
    fontSize: typography.labelCap.fontSize,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  title: {
    color: textTokens.primary,
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
  },
  body: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
  },
  cardContent: { gap: spacing.md },
  cardTitle: {
    color: textTokens.primary,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
  },
  helper: {
    color: textTokens.tertiary,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
  },
  meta: { color: textTokens.tertiary, fontSize: typography.caption.fontSize },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: accent.warm,
  },
  statusDotLive: { backgroundColor: semantic.success },
  statusDotError: { backgroundColor: semantic.error },
  actionStack: { gap: spacing.sm },
  address: {
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    padding: spacing.sm,
    borderRadius: 10,
    backgroundColor: glass.tint.profileBase,
  },
  failureTitle: {
    color: semantic.error,
    fontSize: typography.h3.fontSize,
    fontWeight: "700",
  },
  metricRow: { flexDirection: "row", gap: spacing.sm },
  metric: { flex: 1, gap: spacing.xs },
  metricValue: { color: textTokens.primary, fontSize: typography.h2.fontSize, fontWeight: "700" },
  versionRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: glass.border.profileBase },
  versionCopy: { flex: 1, gap: spacing.xs },
  versionTitle: { color: textTokens.primary, fontSize: typography.bodySm.fontSize, fontWeight: "600" },
});
