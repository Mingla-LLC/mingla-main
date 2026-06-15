/**
 * VenueListingContent (ORCH-1145) — the venue-listing management surface,
 * extracted verbatim from `app/brand/[id]/listing.tsx` (ORCH-1040) so BOTH
 * the new Hub "Venue" tab (`app/(tabs)/hub/listing.tsx`) and the kept route
 * alias render the SAME UI from ONE source (no duplication, no redesign).
 *
 * The brand owner sees their venue listing end-to-end and manages it: current
 * status (Draft / In review / Live / Needs fixes / Changes needed), what they
 * submitted (cover, website, price tiers, gallery, AI pitch), the per-signal AI
 * match scores the venue received, how many "Recommend me" changes remain, any
 * admin rejection message, and the actions to edit/resubmit (reusing the
 * deck-readiness wizard) or view the public page when live.
 *
 * Route-agnostic by design:
 *  - `brandId` is supplied by the caller (route param on the alias; active
 *    brand via `useCurrentBrand()` in the Hub tab) — NOT read from route params.
 *  - `focus` (the `?focus=feedback` deep-link signal) is a prop, not a route
 *    param, so the component can be mounted from either surface.
 *  - `chromeMode="page"` renders the page header + back button (alias fallback);
 *    `chromeMode="tab"` renders NO header/back — the Hub layout owns the chrome.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { VenueClaimFeedbackSheet } from "../brand/VenueClaimFeedbackSheet";
import { VenueClaimStatusBanner } from "../brand/VenueClaimStatusBanner";
import { Button } from "../ui/Button";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Toast } from "../ui/Toast";
import {
  accent,
  canvas,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { venueSignalLabel } from "../../constants/venueSignals";
import { useAuth } from "../../context/AuthContext";
import { useBrand } from "../../hooks/useBrands";
import {
  useBrandPlaceAuthoringContext,
  useBrandPlacePipelineState,
} from "../../hooks/useBrandPlacePipelineState";
import { useVenueClaimOpenCount } from "../../hooks/useVenueClaimFeedback";
import { listingStatusView, type ListingTone } from "../../utils/listingStatus";

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

export interface VenueListingContentProps {
  /** The brand whose listing to render. May be null while resolving. */
  brandId: string | null;
  /**
   * Deep-link signal forwarded from `/brand/{id}/listing?focus=feedback`.
   * When `"feedback"` AND an active follow-up round exists, auto-opens the
   * feedback sheet once. Route-agnostic — supplied as a prop, not a route param.
   */
  focus?: "feedback";
  /**
   * `"page"` → render the page header row + back button (route-alias fallback).
   * `"tab"`  → render NO header/back; the Hub `_layout.tsx` owns the chrome.
   */
  chromeMode: "tab" | "page";
}

export function VenueListingContent({
  brandId,
  focus,
  chromeMode,
}: VenueListingContentProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const brand = useBrand(brandId).data ?? null;
  const placePoolId = brand?.placePoolId ?? null;
  const pipeline = useBrandPlacePipelineState(brandId);
  const ctx = useBrandPlaceAuthoringContext(brandId, placePoolId);

  // ORCH-1064 — venue-claim feedback affordance (re-targeted from the Hub).
  // The follow_up tile + sheet live HERE now (META-ORCH-1059 removed the Hub
  // mount). openCount drives the tile badge; the sheet + a single Toast host are
  // mounted at the bottom of this screen.
  const followUpAt = brand?.claimFollowUpAt ?? null;
  // ORCH-1073 — a `suspended` listing also carries a follow-up stamp + to-do
  // round; surface the same interactive banner + feedback sheet + resubmit loop.
  const hasFollowUp =
    (brand?.claimStatus === "pending_review" ||
      brand?.claimStatus === "suspended") && Boolean(followUpAt);
  const openFeedbackCount = useVenueClaimOpenCount(brandId, followUpAt);
  const [feedbackVisible, setFeedbackVisible] = useState<boolean>(false);
  const [toast, setToast] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const handleOpenFeedback = useCallback((): void => {
    setFeedbackVisible(true);
  }, []);

  const handleCloseFeedback = useCallback((): void => {
    setFeedbackVisible(false);
  }, []);

  const handleResubmitted = useCallback((): void => {
    setToast({
      kind: "success",
      message: "Sent back for review — we'll take another look.",
    });
  }, []);

  const handleFeedbackError = useCallback((message: string): void => {
    setToast({ kind: "error", message });
  }, []);

  const handleDismissToast = useCallback((): void => {
    setToast(null);
  }, []);

  // Deep-link: /brand/{id}/listing?focus=feedback (from the to-do row) auto-opens
  // the sheet once, only when there is actually an active follow-up round.
  // ORCH-1145 — `focus` is now a prop (route-agnostic), forwarded by the alias.
  useEffect(() => {
    if (focus === "feedback" && hasFollowUp) {
      setFeedbackVisible(true);
    }
  }, [focus, hasFollowUp]);

  const hasVenue = placePoolId !== null;
  const statusV = listingStatusView({
    hasVenue,
    status: pipeline.data?.status ?? null,
    claimStatus: brand?.claimStatus,
  });

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else if (brandId !== null) router.replace(`/brand/${brandId}` as never);
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

  const isTab = chromeMode === "tab";
  // ORCH-1145 — page mode keeps the page-internal safe-area top; tab mode lets
  // the layout supply top chrome. Tab mode clears the floating BottomNav
  // (insets.bottom + 120, the nav-lock companion pin pattern) so the last card
  // stays tappable; page mode keeps the original generous bottom pad.
  const scrollBottomPad = isTab ? insets.bottom + 120 : spacing.xl * 3;

  return (
    <View style={[styles.host, isTab ? null : { paddingTop: insets.top }]}>
      {isTab ? null : (
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
      )}

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: scrollBottomPad }]}
        showsVerticalScrollIndicator={false}
      >
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

            {/* ORCH-1064 — venue-claim feedback affordance. Re-homed from the Hub
                (META-ORCH-1059). The reusable follow_up tile renders ONLY when the
                claim is pending_review WITH an admin follow-up stamp; tapping it
                (or the "View feedback" button via the same handler) opens the
                feedback sheet. The open-count badge shows "N to fix" / "Ready". */}
            {hasFollowUp ? (
              <View style={styles.bannerHost}>
                <VenueClaimStatusBanner
                  brand={brand}
                  openCount={openFeedbackCount}
                  onPressFeedback={handleOpenFeedback}
                />
              </View>
            ) : null}

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
              {/* ORCH-1064 — explicit "View feedback" CTA (badge = open count)
                  alongside the tappable status tile, so the affordance is obvious
                  in the actions row too. Present only with an active follow-up. */}
              {hasFollowUp ? (
                <Button
                  label={
                    openFeedbackCount > 0
                      ? `View feedback · ${openFeedbackCount}`
                      : "View feedback"
                  }
                  variant="secondary"
                  size="md"
                  leadingIcon="flag"
                  onPress={handleOpenFeedback}
                  accessibilityLabel={
                    openFeedbackCount > 0
                      ? `View venue feedback, ${openFeedbackCount} to fix`
                      : "View venue feedback"
                  }
                />
              ) : null}
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

      {/* ORCH-1064 — feedback sheet + single Toast host (re-homed from the Hub). */}
      <VenueClaimFeedbackSheet
        visible={feedbackVisible}
        brand={brand}
        accountId={user?.id ?? null}
        onClose={handleCloseFeedback}
        onResubmitted={handleResubmitted}
        onActionError={handleFeedbackError}
      />
      <Toast
        visible={toast !== null}
        kind={toast?.kind ?? "success"}
        message={toast?.message ?? ""}
        onDismiss={handleDismissToast}
      />
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
  // ORCH-1064 — cancel the banner's own marginHorizontal so the re-homed
  // follow_up tile aligns flush with the surrounding GlassCards; trim its
  // marginBottom (the scroll already supplies `gap: spacing.md`).
  bannerHost: { marginHorizontal: -spacing.md, marginBottom: -spacing.sm },
});

export default VenueListingContent;
