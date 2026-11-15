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
 *
 * META-ORCH-1255 Leg B — VENUE-SCOPED. Pre-1255 this surface read the brand's
 * ONE listing via useBrandPlacePipelineState(brandId) and
 * useBrandPlaceAuthoringContext(brandId, placePoolId), with the claim fields on
 * the brand row. Venues are first-class rows now: the component takes a
 * REQUIRED `venueId`, reads claim fields from the `venue_listings` row
 * (useVenueListing), the pipeline row via useVenuePipelineState(venueId), and
 * the authoring context venue-keyed. The feedback loop (banner, sheet,
 * resubmit) is venue-keyed too (I-PROPOSED-1255-VENUE-APPROVAL-PER-VENUE-ROW).
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// #1841 [keyboard-guard-blind-spots] — this scroll hosts VenuePitchField, a
// multiline TextInput rendered through the `Input` primitive, so the bare
// react-native ScrollView left the focused pitch box behind the keyboard's Done
// bar. SmartScrollView resolves to react-native-keyboard-controller's
// KeyboardAwareScrollView on native at the wrapper's DERIVED
// DEFAULT_BOTTOM_OFFSET, and to a plain RN ScrollView on web. Never pass
// `bottomOffset` from a call site (I-PROPOSED-1834-…-DONE-BAR).
import { ScrollView } from "../../wrappers/SmartScrollView";

import { VenueClaimFeedbackSheet } from "../brand/VenueClaimFeedbackSheet";
import { VenueClaimStatusBanner } from "../brand/VenueClaimStatusBanner";
import { Button } from "../ui/Button";
import { ArrowLeft, Sparkles } from "lucide-react-native";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { GlassCard } from "../ui/GlassCard";
import { Skeleton } from "../ui/Skeleton";
import { Toast } from "../ui/Toast";
import { VenuePitchField } from "./VenuePitchField";
import {
  color,
  space,
  type,
} from "../../constants/designSystem";
import { venueSignalLabel } from "../../constants/venueSignals";
import { useAuth } from "../../context/AuthContext";
import { useBrand } from "../../hooks/useBrands";
import {
  useBrandPlaceAuthoringContext,
  useVenuePipelineState,
} from "../../hooks/useBrandPlacePipelineState";
import { useVenueListing } from "../../hooks/useVenueListings";
import { useVenueClaimOpenCount } from "../../hooks/useVenueClaimFeedback";
import {
  fetchVenuePitchSource,
  runTier2Pipeline,
  updateVenuePitch,
} from "../../services/businessPlaceAuthoringService";
import { listingStatusView, type ListingTone } from "../../utils/listingStatus";

// META-ORCH-1290 Leg B (D-5, DESIGN §4.2) — the populated scores fill ramps by
// strength for glanceability (one hue, the number is always shown so color is
// never the only signal). ≥70 full warm, 40–69 mid, <40 faint.
function scoreFill(score: number): string {
  if (score >= 70) return color.accent;
  if (score >= 40) return color.accentTint;
  return color.accentTint;
}
const SCORES_TOP_N = 6;

const TONE_COLOR: Record<ListingTone, string> = {
  neutral: color.text2,
  info: color.info,
  warning: color.warning,
  success: color.success,
};
const TONE_TINT: Record<ListingTone, string> = {
  neutral: color.fill.tabOn,
  info: color.infoTint,
  warning: color.warningTint,
  success: color.successTint,
};

const PRICE_TIER_LABEL: Record<string, string> = {
  chill: "Chill",
  comfy: "Comfy",
  bougie: "Bougie",
  lavish: "Lavish",
};

export interface VenueListingContentProps {
  /** The brand that owns the venue. May be null while resolving. */
  brandId: string | null;
  /** META-ORCH-1255 — the venue_listings row this surface manages. */
  venueId: string | null;
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
  venueId,
  focus,
  chromeMode,
}: VenueListingContentProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const brand = useBrand(brandId).data ?? null;
  const venueQuery = useVenueListing(venueId);
  const venue = venueQuery.data ?? null;
  const placePoolId = venue?.placePoolId ?? null;
  const pipeline = useVenuePipelineState(venueId);
  const ctx = useBrandPlaceAuthoringContext(brandId, placePoolId, venueId);

  // ORCH-1064 — venue-claim feedback affordance (re-targeted from the Hub).
  // The follow_up tile + sheet live HERE now (META-ORCH-1059 removed the Hub
  // mount). openCount drives the tile badge; the sheet + a single Toast host are
  // mounted at the bottom of this screen.
  const followUpAt = venue?.claimFollowUpAt ?? null;
  // ORCH-1073 — a `suspended` listing also carries a follow-up stamp + to-do
  // round; surface the same interactive banner + feedback sheet + resubmit loop.
  const hasFollowUp =
    (venue?.claimStatus === "pending_review" ||
      venue?.claimStatus === "suspended") && Boolean(followUpAt);
  const openFeedbackCount = useVenueClaimOpenCount(brandId, venueId, followUpAt);
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

  const hasVenue = venue !== null;
  const statusV = listingStatusView({
    hasVenue,
    status: pipeline.data?.status ?? null,
    claimStatus: venue?.claimStatus,
  });

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else if (brandId !== null) router.replace(`/brand/${brandId}` as never);
  }, [router, brandId]);

  const handleAddVenue = useCallback((): void => {
    router.push("/venue/create" as never);
  }, [router]);

  const handleEdit = useCallback((): void => {
    if (brandId === null || placePoolId === null || venueId === null) return;
    router.push(
      `/venue/deck-readiness?brand_id=${brandId}&place_pool_id=${placePoolId}&venue_id=${venueId}&focus=review&fix=review_pipeline` as never,
    );
  }, [router, brandId, placePoolId, venueId]);

  const handleViewPublic = useCallback((): void => {
    if (brand?.slug !== undefined && brand.slug.length > 0) {
      router.push(`/b/${brand.slug}` as never);
    }
  }, [router, brand?.slug]);

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

  const rejected =
    venue?.claimStatus === "rejected" || pipeline.data?.status === "failed";
  const rejectionReason = venue?.rejectionReason ?? null;
  const isLive = venue?.claimStatus === "verified";
  const hasScores = scoreRows.length > 0;

  // META-ORCH-1290 Leg B (D-5, DESIGN §4.2) — top-6 by default, Show all toggle.
  const [showAllScores, setShowAllScores] = useState(false);
  const visibleScores = showAllScores
    ? scoreRows
    : scoreRows.slice(0, SCORES_TOP_N);

  // ── Editable pitch (D-3, §4.1) ──────────────────────────────────────────
  const [pitchText, setPitchText] = useState<string>("");
  const [persistedPitch, setPersistedPitch] = useState<string>("");
  const [reScoring, setReScoring] = useState(false);
  const pitchSeededFor = useRef<string | null>(null);

  // Seed the pitch from the REAL owner-authored source (generative_summary for a
  // live venue, the staged tier1.description for a pending one) — NOT the stale
  // AI-generated bio. Seed once per place (re-seed only if the owner hasn't
  // touched it).
  useEffect(() => {
    if (placePoolId === null) return;
    if (pitchSeededFor.current === placePoolId) return;
    let cancelled = false;
    void fetchVenuePitchSource(placePoolId)
      .then((src) => {
        if (cancelled) return;
        const seed = (
          isLive
            ? src.generativeSummary ?? src.tier1Description
            : src.tier1Description ?? src.generativeSummary
        ) ?? "";
        pitchSeededFor.current = placePoolId;
        setPitchText(seed);
        setPersistedPitch(seed);
      })
      .catch(() => {
        // non-blocking — the field falls back to empty (owner can draft/type).
      });
    return (): void => {
      cancelled = true;
    };
  }, [placePoolId, isLive]);

  const handleGeneratePitch = useCallback(async (): Promise<string> => {
    if (brandId === null || venueId === null || placePoolId === null) {
      throw new Error("missing_ids");
    }
    const res = await runTier2Pipeline({
      brandId,
      venueId,
      placePoolId,
      // Preserve the staged website/price while regenerating just the bio.
      tier2: (ctx.data?.tier2 as Record<string, unknown> | undefined) ?? {},
    });
    return res.generated_bio;
  }, [brandId, venueId, placePoolId, ctx.data]);

  const handleSavePitch = useCallback(async (): Promise<void> => {
    // META-ORCH-1290 (B2): the pitch write now goes through the `update_pitch`
    // pipeline action, which requires the owning brand + venue (server decides
    // apply-vs-stage via placeWriteMode). isLive stays a CLIENT-only flag for the
    // re-scoring caption below.
    if (placePoolId === null || brandId === null || venueId === null) return;
    await updateVenuePitch({ brandId, venueId, placePoolId, pitch: pitchText });
    setPersistedPitch(pitchText.trim());
    if (isLive) setReScoring(true);
    setToast({ kind: "success", message: "Pitch updated." });
    void ctx.refetch();
  }, [placePoolId, brandId, venueId, pitchText, isLive, ctx]);

  const pitchTrimmed = pitchText.trim();
  const pitchSaveDisabled =
    pitchTrimmed === persistedPitch.trim() ||
    (pitchTrimmed.length > 0 && pitchTrimmed.length < 20);
  const loading =
    venueQuery.isLoading ||
    pipeline.isLoading ||
    (hasVenue && placePoolId !== null && ctx.isLoading);

  const isTab = chromeMode === "tab";
  // ORCH-1145 — page mode keeps the page-internal safe-area top; tab mode lets
  // the layout supply top chrome. Tab mode clears the floating BottomNav
  // (insets.bottom + 120, the nav-lock companion pin pattern) so the last card
  // stays tappable; page mode keeps the original generous bottom pad.
  const scrollBottomPad = isTab ? insets.bottom + 120 : space[7] * 3;

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
            <ArrowLeft size={22} color={color.text1} />
          </Pressable>
          <Text style={styles.headerTitle}>Your listing</Text>
          <View style={styles.headerSpacer} />
        </View>
      )}

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: scrollBottomPad }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {!hasVenue ? (
          <GlassCard variant="elevated" padding={space[6]}>
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
            <ActivityIndicator color={color.accent} />
          </View>
        ) : (
          <>
            {/* Status */}
            <GlassCard variant="elevated" padding={space[6]}>
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
                  claimRow={
                    venue !== null
                      ? {
                          claimStatus: venue.claimStatus,
                          rejectionReason: venue.rejectionReason,
                          claimFollowUpAt: venue.claimFollowUpAt,
                        }
                      : null
                  }
                  openCount={openFeedbackCount}
                  onPressFeedback={handleOpenFeedback}
                />
              </View>
            ) : null}

            {/* Rejection message */}
            {rejected && rejectionReason !== null ? (
              <GlassCard variant="base" padding={space[6]}>
                <Text style={[styles.sectionTitle, { color: color.warning }]}>What to change</Text>
                <Text style={styles.body}>{rejectionReason}</Text>
                <Text style={styles.subtle}>
                  Make the changes below, then resubmit to go live.
                </Text>
              </GlassCard>
            ) : null}

            {/* What you submitted */}
            <GlassCard variant="base" padding={space[6]}>
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
                  <Text style={styles.venueName}>{venue?.name ?? "Your venue"}</Text>
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
              {/* ORCH-1304 [approve generates the pitch] — the editable pitch
                  field is shown ONLY once the venue is verified/live. Mingla
                  writes the pitch at approve; before that there is nothing to
                  edit, so a pending/rejected venue sees a read-only placeholder
                  (no pre-approval owner-side pitch generation). The live branch
                  (Regenerate + edit + Save → generative_summary) is unchanged. */}
              <Text style={styles.fieldLabel}>Your pitch</Text>
              {isLive ? (
                <VenuePitchField
                  value={pitchText}
                  onChangeText={setPitchText}
                  onGenerate={handleGeneratePitch}
                  onSave={handleSavePitch}
                  saveDisabled={pitchSaveDisabled}
                  reScoreCaption={
                    isLive
                      ? "Editing your pitch sends it back for a quick re-score — your listing stays live."
                      : null
                  }
                  testIDPrefix="listing-pitch"
                />
              ) : (
                <View style={styles.pitchPlaceholder} testID="listing-pitch-pending">
                  <Text style={styles.pitchPlaceholderText}>
                    Mingla writes your pitch when your venue is approved. You&apos;ll
                    be able to edit it here after.
                  </Text>
                </View>
              )}
            </GlassCard>

            {/* META-ORCH-1290 D-5 — the vibe-scores card ALWAYS renders: a LOCKED
                pre-approval state (honest ghost preview, NO fake numbers) and a
                POPULATED post-approval state (human labels, strength ramp, top-6
                + Show all). The old edit-cap "changes-left" card is RETIRED with
                the self-run "Recommend me" edit-cap (OQ-4). */}
            <GlassCard variant="base" padding={space[6]}>
              {hasScores ? (
                <>
                  <View style={styles.scoreHeader}>
                    <Sparkles size={16} color={color.accent} />
                    <Text style={styles.sectionTitleInline}>
                      How you match Mingla moments
                    </Text>
                  </View>
                  <Text style={styles.subtle}>
                    Higher means we recommend you more for that moment.
                  </Text>
                  {reScoring ? (
                    <View style={styles.reScoreRow}>
                      <ActivityIndicator size="small" color={color.accent} />
                      <Text style={styles.reScoreText}>
                        Re-scoring your latest changes — this updates shortly.
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.scoreList}>
                    {visibleScores.map((row) => (
                      <View
                        key={row.id}
                        style={styles.scoreRow}
                        accessibilityRole="progressbar"
                        accessibilityValue={{ min: 0, max: 100, now: row.score }}
                        accessibilityLabel={`${row.label}, ${row.score} out of 100`}
                      >
                        <Text style={styles.scoreLabel} numberOfLines={1}>
                          {row.label}
                        </Text>
                        <View style={styles.scoreBarTrack}>
                          <View
                            style={[
                              styles.scoreBarFill,
                              {
                                width: `${Math.max(0, Math.min(100, row.score))}%`,
                                backgroundColor: scoreFill(row.score),
                              },
                            ]}
                          />
                        </View>
                        <Text style={styles.scoreValue}>{row.score}</Text>
                      </View>
                    ))}
                  </View>
                  {scoreRows.length > SCORES_TOP_N ? (
                    <View style={styles.showAllRow}>
                      <Button
                        label={
                          showAllScores
                            ? `Show top ${SCORES_TOP_N}`
                            : `Show all ${scoreRows.length}`
                        }
                        variant="ghost"
                        size="sm"
                        onPress={() => setShowAllScores((v) => !v)}
                      />
                    </View>
                  ) : null}
                </>
              ) : (
                <>
                  <View style={styles.scoreHeader}>
                    <Sparkles size={16} color={color.text3} />
                    <Text style={styles.sectionTitleInline}>Your vibe scores</Text>
                  </View>
                  <Text style={styles.body} accessibilityLiveRegion="polite">
                    Your vibe scores appear once an admin approves your listing —
                    they decide which explorer feeds you show up in.
                  </Text>
                  <View style={styles.ghostPreview}>
                    {[0, 1, 2, 3].map((i) => (
                      <View key={i} style={styles.scoreRow}>
                        <Skeleton width={88} height={12} radius="sm" />
                        <View style={styles.scoreBarTrack} />
                        <Text style={styles.scoreValueGhost}>—</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </GlassCard>

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
        venueId={venueId}
        venueName={venue?.name ?? null}
        venueFollowUpAt={followUpAt}
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
  host: { flex: 1, backgroundColor: color.canvas },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space[4],
    paddingBottom: space[2],
    gap: space[2],
  },
  headerTitle: {
    fontSize: type.h1.fontSize,
    fontWeight: type.h1.fontWeight,
    color: color.text1,
  },
  headerSpacer: { flex: 1 },
  scroll: {
    paddingHorizontal: space[4],
    gap: space[4],
  },
  loadingBox: { paddingVertical: space[7] * 2, alignItems: "center" },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: space[1],
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    borderRadius: 999,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badgeText: { fontSize: type.small.fontSize, fontWeight: "700" },
  statusHint: {
    fontSize: type.small.fontSize,
    lineHeight: 20,
    color: color.text2,
    marginTop: space[2],
  },
  sectionTitle: {
    fontSize: type.body.fontSize,
    fontWeight: "700",
    color: color.text1,
    marginBottom: space[1],
  },
  body: {
    fontSize: type.small.fontSize,
    lineHeight: 20,
    color: color.text2,
  },
  subtle: {
    fontSize: type.caption.fontSize,
    color: color.text3,
    marginTop: space[1],
  },
  submittedRow: { flexDirection: "row", gap: space[4], alignItems: "center" },
  submittedText: { flex: 1, gap: 2 },
  venueName: {
    fontSize: type.small.fontSize,
    fontWeight: "700",
    color: color.text1,
  },
  metaLine: { fontSize: type.caption.fontSize, color: color.text2 },
  fieldLabel: {
    fontSize: type.caption.fontSize,
    fontWeight: "700",
    color: color.text3,
    textTransform: "uppercase",
    marginTop: space[4],
    marginBottom: space[1],
  },
  // ORCH-1304 — read-only pitch placeholder for a pending/rejected venue (the
  // editable field appears only once the venue is approved/live).
  pitchPlaceholder: {
    padding: space[4],
    borderRadius: 12,
    backgroundColor: color.fill.tile,
  },
  pitchPlaceholderText: {
    fontSize: type.small.fontSize,
    lineHeight: 20,
    color: color.text2,
  },
  scoreList: { marginTop: space[2], gap: space[2] },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  scoreLabel: { width: 110, fontSize: type.caption.fontSize, color: color.text2 },
  scoreBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: color.fill.tabOn,
    overflow: "hidden",
  },
  scoreBarFill: { height: 8, borderRadius: 4, backgroundColor: color.accent },
  scoreValue: {
    width: 28,
    textAlign: "right",
    fontSize: type.caption.fontSize,
    fontWeight: "700",
    color: color.text1,
  },
  // META-ORCH-1290 D-5 scores card
  scoreHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    marginBottom: space[1],
  },
  sectionTitleInline: {
    fontSize: type.body.fontSize,
    fontWeight: "700",
    color: color.text1,
  },
  reScoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    marginTop: space[1],
  },
  reScoreText: {
    flex: 1,
    fontSize: type.caption.fontSize,
    color: color.text3,
  },
  showAllRow: { marginTop: space[2], alignItems: "flex-start" },
  ghostPreview: { marginTop: space[2], gap: space[2], opacity: 0.6 },
  scoreValueGhost: {
    width: 28,
    textAlign: "right",
    fontSize: type.caption.fontSize,
    fontWeight: "700",
    color: color.text3,
  },
  actionRow: { marginTop: space[4], alignItems: "flex-start" },
  actionsCol: { gap: space[2], marginTop: space[1] },
  // ORCH-1064 — cancel the banner's own marginHorizontal so the re-homed
  // follow_up tile aligns flush with the surrounding GlassCards; trim its
  // marginBottom (the scroll already supplies `gap: space[4]`).
  bannerHost: { marginHorizontal: -space[4], marginBottom: -space[2] },
});

export default VenueListingContent;
