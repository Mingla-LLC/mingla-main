/**
 * /brand/[id]/listing — ORCH-1040 brand venue listing management.
 *
 * The dedicated page where a brand owner sees their venue listing end-to-end and
 * manages it: current status (Draft / In review / Live / Needs fixes / Changes
 * needed), what they submitted (cover, website, price tiers, gallery, AI pitch),
 * the per-signal AI match scores the venue received, how many "Recommend me"
 * changes remain, any admin rejection message, and the actions to edit/resubmit
 * (reusing the deck-readiness wizard) or view the public page when live.
 *
 * Closes the Sub-E/Sub-F loop: the scores + changes-remaining + rejection message
 * were produced by the pipeline/admin but never surfaced to the brand until now.
 */
import React, { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../../src/components/ui/Button";
import { EventCoverMedia } from "../../../src/components/ui/EventCoverMedia";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Icon } from "../../../src/components/ui/Icon";
import {
  accent,
  canvas,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { venueSignalLabel } from "../../../src/constants/venueSignals";
import { useBrand } from "../../../src/hooks/useBrands";
import {
  useBrandPlaceAuthoringContext,
  useBrandPlacePipelineState,
} from "../../../src/hooks/useBrandPlacePipelineState";
import { listingStatusView, type ListingTone } from "../../../src/utils/listingStatus";

const TONE_COLOR: Record<ListingTone, string> = {
  neutral: textTokens.secondary,
  info: semantic.info,
  warning: semantic.warning,
  success: semantic.success,
};
const TONE_TINT: Record<ListingTone, string> = {
  neutral: "rgba(255,255,255,0.10)",
  info: semantic.infoTint,
  warning: semantic.warningTint,
  success: semantic.successTint,
};

const PRICE_TIER_LABEL: Record<string, string> = {
  chill: "Chill",
  comfy: "Comfy",
  bougie: "Bougie",
  lavish: "Lavish",
};

export default function BrandListingRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const brandId =
    typeof idParam === "string" && idParam.length > 0 ? idParam : null;

  const brand = useBrand(brandId).data ?? null;
  const placePoolId = brand?.placePoolId ?? null;
  const pipeline = useBrandPlacePipelineState(brandId);
  const ctx = useBrandPlaceAuthoringContext(brandId, placePoolId);

  const hasVenue = placePoolId !== null;
  const statusV = listingStatusView({
    hasVenue,
    status: pipeline.data?.status ?? null,
    claimStatus: brand?.claimStatus,
  });

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace(`/brand/${brandId}` as never);
  }, [router, brandId]);

  const handleAddVenue = useCallback((): void => {
    router.push("/venue/create" as never);
  }, [router]);

  const handleEdit = useCallback((): void => {
    if (brandId === null || placePoolId === null) return;
    router.push(
      `/venue/deck-readiness?brand_id=${brandId}&place_pool_id=${placePoolId}&focus=review&fix=review_pipeline` as never,
    );
  }, [router, brandId, placePoolId]);

  const handleViewPublic = useCallback((): void => {
    if (brand?.slug !== undefined && brand.slug.length > 0) {
      router.push(`/b/${brand.slug}` as never);
    }
  }, [router, brand?.slug]);

  const bio = useMemo<string | null>(() => {
    const confirmed = ctx.data?.confirmed_ai_outputs as
      | { generated_bio?: string; sales_bio?: string }
      | null
      | undefined;
    const pending = ctx.data?.pending_ai_outputs;
    return (
      confirmed?.generated_bio ??
      confirmed?.sales_bio ??
      pending?.generated_bio ??
      null
    );
  }, [ctx.data]);

  const priceTiers = useMemo<string[]>(() => {
    const raw = (ctx.data?.tier2 as { price_tiers?: unknown } | undefined)
      ?.price_tiers;
    return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string") : [];
  }, [ctx.data]);

  const scoreRows = useMemo(() => {
    const scores = ctx.data?.ai_signal_scores ?? null;
    if (scores === null) return [];
    return Object.entries(scores)
      .filter(([, v]) => v.inappropriate_for !== true)
      .map(([id, v]) => ({ id, label: venueSignalLabel(id), score: v.score_0_to_100 }))
      .sort((a, b) => b.score - a.score);
  }, [ctx.data]);

  const editsRemaining = ctx.data?.recommend_edits_remaining ?? null;
  const rejected =
    brand?.claimStatus === "rejected" || pipeline.data?.status === "failed";
  const rejectionReason = brand?.rejectionReason ?? null;
  const isLive = brand?.claimStatus === "verified";
  const loading = pipeline.isLoading || (hasVenue && ctx.isLoading);

  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
        >
          <Icon name="arrowL" size={22} color={textTokens.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Your listing</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {!hasVenue ? (
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.sectionTitle}>No listing yet</Text>
            <Text style={styles.body}>
              Add your venue so Mingla can recommend it to people deciding where to go.
            </Text>
            <View style={styles.actionRow}>
              <Button label="Add your venue" variant="primary" size="md" leadingIcon="sparkle" onPress={handleAddVenue} />
            </View>
          </GlassCard>
        ) : loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={accent.warm} />
          </View>
        ) : (
          <>
            {/* Status */}
            <GlassCard variant="elevated" padding={spacing.lg}>
              <View style={[styles.badge, { backgroundColor: TONE_TINT[statusV.tone] }]}>
                <View style={[styles.dot, { backgroundColor: TONE_COLOR[statusV.tone] }]} />
                <Text style={[styles.badgeText, { color: TONE_COLOR[statusV.tone] }]}>
                  {statusV.label}
                </Text>
              </View>
              <Text style={styles.statusHint}>{statusV.hint}</Text>
            </GlassCard>

            {/* Rejection message */}
            {rejected && rejectionReason !== null ? (
              <GlassCard variant="base" padding={spacing.lg}>
                <Text style={[styles.sectionTitle, { color: semantic.warning }]}>What to change</Text>
                <Text style={styles.body}>{rejectionReason}</Text>
                <Text style={styles.subtle}>
                  Make the changes below, then resubmit to go live.
                </Text>
              </GlassCard>
            ) : null}

            {/* What you submitted */}
            <GlassCard variant="base" padding={spacing.lg}>
              <Text style={styles.sectionTitle}>What you submitted</Text>
              <View style={styles.submittedRow}>
                {ctx.data?.cover_media_url != null ? (
                  <EventCoverMedia
                    mediaUrl={ctx.data.cover_media_url}
                    mediaType={ctx.data.cover_media_type === "video" ? "video" : "image"}
                    radius={12}
                    label="Cover"
                    height={72}
                    width={72}
                  />
                ) : null}
                <View style={styles.submittedText}>
                  <Text style={styles.venueName}>{brand?.displayName ?? "Your venue"}</Text>
                  {ctx.data?.website != null && ctx.data.website.length > 0 ? (
                    <Text style={styles.metaLine} numberOfLines={1}>{ctx.data.website}</Text>
                  ) : null}
                  <Text style={styles.metaLine}>
                    {ctx.data?.gallery_urls.length ?? 0} photos
                    {priceTiers.length > 0
                      ? ` · ${priceTiers.map((t) => PRICE_TIER_LABEL[t] ?? t).join(", ")}`
                      : ""}
                  </Text>
                </View>
              </View>
              {bio !== null && bio.length > 0 ? (
                <>
                  <Text style={styles.fieldLabel}>Your pitch</Text>
                  <Text style={styles.body}>{bio}</Text>
                </>
              ) : null}
            </GlassCard>

            {/* AI match scores */}
            {scoreRows.length > 0 ? (
              <GlassCard variant="base" padding={spacing.lg}>
                <Text style={styles.sectionTitle}>How you match Mingla moments</Text>
                <Text style={styles.subtle}>
                  Your AI scores per signal — higher means we recommend you more for that moment.
                </Text>
                <View style={styles.scoreList}>
                  {scoreRows.map((row) => (
                    <View key={row.id} style={styles.scoreRow}>
                      <Text style={styles.scoreLabel} numberOfLines={1}>{row.label}</Text>
                      <View style={styles.scoreBarTrack}>
                        <View
                          style={[
                            styles.scoreBarFill,
                            { width: `${Math.max(0, Math.min(100, row.score))}%` },
                          ]}
                        />
                      </View>
                      <Text style={styles.scoreValue}>{row.score}</Text>
                    </View>
                  ))}
                </View>
              </GlassCard>
            ) : null}

            {/* Changes remaining */}
            {editsRemaining !== null ? (
              <GlassCard variant="base" padding={spacing.lg}>
                <Text style={styles.sectionTitle}>Changes remaining</Text>
                <Text style={styles.body}>
                  {editsRemaining > 0
                    ? `You can re-run "Recommend me" ${editsRemaining} more ${editsRemaining === 1 ? "time" : "times"}.`
                    : "You've used all your changes. Contact support if you need more."}
                </Text>
              </GlassCard>
            ) : null}

            {/* Manage actions */}
            <View style={styles.actionsCol}>
              <Button
                label="Edit listing"
                variant="primary"
                size="md"
                leadingIcon="edit"
                onPress={handleEdit}
                accessibilityLabel="Edit your venue listing"
              />
              {isLive ? (
                <Button
                  label="View public page"
                  variant="secondary"
                  size="md"
                  leadingIcon="eye"
                  onPress={handleViewPublic}
                  accessibilityLabel="View your public venue page"
                />
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: canvas.discover },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  headerTitle: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  headerSpacer: { flex: 1 },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl * 3,
    gap: spacing.md,
  },
  loadingBox: { paddingVertical: spacing.xl * 2, alignItems: "center" },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badgeText: { fontSize: typography.bodySm.fontSize, fontWeight: "700" },
  statusHint: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: 20,
    color: textTokens.secondary,
    marginTop: spacing.sm,
  },
  sectionTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  body: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: 20,
    color: textTokens.secondary,
  },
  subtle: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
  submittedRow: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  submittedText: { flex: 1, gap: 2 },
  venueName: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  metaLine: { fontSize: typography.caption.fontSize, color: textTokens.secondary },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    color: textTokens.tertiary,
    textTransform: "uppercase",
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  scoreList: { marginTop: spacing.sm, gap: spacing.sm },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  scoreLabel: { width: 110, fontSize: typography.caption.fontSize, color: textTokens.secondary },
  scoreBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.10)",
    overflow: "hidden",
  },
  scoreBarFill: { height: 8, borderRadius: 4, backgroundColor: accent.warm },
  scoreValue: {
    width: 28,
    textAlign: "right",
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  actionRow: { marginTop: spacing.md, alignItems: "flex-start" },
  actionsCol: { gap: spacing.sm, marginTop: spacing.xs },
});
