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
  Platform,
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
import { Input } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { ArrowLeft, Sparkles } from "lucide-react-native";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { GlassCard } from "../ui/GlassCard";
import { Skeleton } from "../ui/Skeleton";
import { Toast } from "../ui/Toast";
import { VenuePitchField } from "./VenuePitchField";
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
  useVenuePipelineState,
} from "../../hooks/useBrandPlacePipelineState";
import { useVenueListing } from "../../hooks/useVenueListings";
import { useVenueClaimOpenCount } from "../../hooks/useVenueClaimFeedback";
import {
  correctPendingVenueIdentity,
  previewPendingVenueIdentityCorrection,
  type PendingVenueIdentityPreview,
} from "../../services/venueListingsService";
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
  if (score >= 70) return accent.warm;
  if (score >= 40) return "rgba(235,120,37,0.66)";
  return "rgba(235,120,37,0.38)";
}
const SCORES_TOP_N = 6;

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
  const [correctionOpen, setCorrectionOpen] = useState(false);

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
            <ArrowLeft size={22} color={textTokens.primary} />
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
            <GlassCard variant="base" padding={spacing.lg}>
              {hasScores ? (
                <>
                  <View style={styles.scoreHeader}>
                    <Sparkles size={16} color={accent.warm} />
                    <Text style={styles.sectionTitleInline}>
                      How you match Mingla moments
                    </Text>
                  </View>
                  <Text style={styles.subtle}>
                    Higher means we recommend you more for that moment.
                  </Text>
                  {reScoring ? (
                    <View style={styles.reScoreRow}>
                      <ActivityIndicator size="small" color={accent.warm} />
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
                    <Sparkles size={16} color={textTokens.tertiary} />
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
              {Platform.OS === "web" && venue?.claimStatus === "pending_review" ? (
                <Button
                  label="Correct venue identity"
                  variant="secondary"
                  size="md"
                  leadingIcon="edit"
                  onPress={() => setCorrectionOpen(true)}
                  accessibilityLabel="Correct this pending venue identity"
                />
              ) : null}
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
      {Platform.OS === "web" && venue?.claimStatus === "pending_review" ? (
        <PendingIdentityCorrectionDialog
          visible={correctionOpen}
          venueId={venue.id}
          onClose={() => setCorrectionOpen(false)}
          onSuccess={() => {
            setCorrectionOpen(false);
            setToast({ kind: "success", message: "Pending venue identity corrected." });
            void Promise.all([venueQuery.refetch(), pipeline.refetch(), ctx.refetch()]);
          }}
        />
      ) : null}
      <Toast
        visible={toast !== null}
        kind={toast?.kind ?? "success"}
        message={toast?.message ?? ""}
        onDismiss={handleDismissToast}
      />
    </View>
  );
}

function PendingIdentityCorrectionDialog({
  visible,
  venueId,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  venueId: string;
  onClose: () => void;
  onSuccess: () => void;
}): React.ReactElement {
  const [preview, setPreview] = useState<PendingVenueIdentityPreview | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [category, setCategory] = useState<"restaurant" | "play" | "creative_and_arts" | "stay">("play");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("Checking whether this venue can be corrected.");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadPreview = useCallback(async (): Promise<void> => {
    setLoading(true);
    setStatus("Checking whether this venue can be corrected.");
    try {
      const next = await previewPendingVenueIdentityCorrection(venueId);
      setPreview(next);
      if (next.eligible) {
        setName((current) => current || next.current.name);
        setSlug((current) => current || next.current.slug);
        setCategory(next.current.category);
        setStatus("This unused pending venue can be corrected.");
      } else {
        setStatus(`This venue cannot be corrected (${next.code ?? "UNKNOWN"}).`);
      }
    } catch {
      setPreview(null);
      setStatus("Couldn't check this venue. Check your connection and retry.");
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    if (visible) void loadPreview();
  }, [loadPreview, visible]);

  useEffect(() => {
    if (!visible || Platform.OS !== "web" || globalThis.document === undefined) return;
    const previous = globalThis.document.activeElement as HTMLElement | null;
    const panel = globalThis.document.querySelector('[data-testid="issue-2099-correction-dialog"]');
    const focusable = (): HTMLElement[] => Array.from(
      panel?.querySelectorAll<HTMLElement>('button,input,select,[tabindex]:not([tabindex="-1"])') ?? [],
    ).filter((element) => !element.hasAttribute("disabled"));
    focusable()[0]?.focus();
    const trap = (event: KeyboardEvent): void => {
      if (event.key !== "Tab") return;
      const nodes = focusable();
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && globalThis.document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && globalThis.document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    globalThis.document.addEventListener("keydown", trap);
    return (): void => {
      globalThis.document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [visible]);

  const submit = useCallback(async (): Promise<void> => {
    if (preview?.eligible !== true || submitting) return;
    setSubmitting(true);
    setStatus("Correcting the pending venue identity.");
    try {
      const cryptoLike = globalThis.crypto as unknown as { randomUUID?: () => string } | undefined;
      const requestId = cryptoLike?.randomUUID?.()
        ?? `00000000-0000-4000-8000-${String(Date.now()).padStart(12, "0").slice(-12)}`;
      const result = await correctPendingVenueIdentity({ preview, name, slug, category, reason, requestId });
      if (!result.ok) {
        if (result.code === "STALE_VERSION" || result.code === "DEPENDENCY_SCHEMA_CHANGED") {
          setStatus("The venue changed while this form was open. Review the refreshed values and confirm again.");
          await loadPreview();
        } else {
          setStatus(`Couldn't correct this venue (${result.code ?? "UNKNOWN"}).`);
        }
        return;
      }
      onSuccess();
    } catch {
      setStatus("Couldn't correct this venue. Your entries are preserved; retry when you're online.");
    } finally {
      setSubmitting(false);
    }
  }, [category, loadPreview, name, onSuccess, preview, reason, slug, submitting]);

  const canSubmit = preview?.eligible === true && name.trim().length > 0 && /^[a-z0-9]{1,32}$/.test(slug) && reason.trim().length > 0 && !submitting;
  return (
    <Modal visible={visible} onClose={submitting ? () => undefined : onClose} dismissOnScrimTap={!submitting} testID="issue-2099-correction-dialog">
      <View accessibilityViewIsModal style={styles.correctionForm}>
        <Text style={styles.correctionTitle} accessibilityRole="header">Correct venue identity</Text>
        <Text style={styles.body}>This keeps the same venue, owner and location. Only its pending name, URL and category change.</Text>
        {preview ? <Text style={styles.correctionComparison}>Current: {preview.current.name} · {preview.current.slug} · {preview.current.category}</Text> : null}
        <Text style={styles.fieldLabel}>Proposed name</Text>
        <Input value={name} onChangeText={setName} accessibilityLabel="Proposed venue name" disabled={submitting} />
        <Text style={styles.fieldLabel}>Proposed URL slug</Text>
        <Input value={slug} onChangeText={setSlug} accessibilityLabel="Proposed venue URL slug" autoCapitalize="none" disabled={submitting} error={slug.length > 0 && !/^[a-z0-9]{1,32}$/.test(slug) ? "Use 1–32 lowercase letters or numbers." : null} errorId="issue-2099-slug-error" />
        <Text style={styles.fieldLabel}>Proposed category</Text>
        <View style={styles.categoryRow} accessibilityLabel="Proposed venue category">
          {(["restaurant", "play", "creative_and_arts", "stay"] as const).map((value) => (
            <Pressable key={value} onPress={() => setCategory(value)} disabled={submitting} accessibilityRole="radio" accessibilityState={{ checked: category === value }} style={[styles.categoryChoice, category === value ? styles.categoryChoiceSelected : null]}>
              <Text style={styles.body}>{value.replaceAll("_", " ")}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.fieldLabel}>Reason</Text>
        <Input value={reason} onChangeText={setReason} accessibilityLabel="Reason for correcting this venue" disabled={submitting} />
        <Text accessibilityLiveRegion="polite" style={styles.correctionStatus}>{status}</Text>
        <View style={styles.correctionActions}>
          <Button label={loading ? "Checking…" : "Retry check"} variant="secondary" onPress={() => void loadPreview()} disabled={loading || submitting} />
          <Button label={submitting ? "Correcting…" : "Correct pending venue"} variant="primary" onPress={() => void submit()} disabled={!canSubmit} accessibilityLabel="Correct pending venue" />
        </View>
      </View>
    </Modal>
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
  // ORCH-1304 — read-only pitch placeholder for a pending/rejected venue (the
  // editable field appears only once the venue is approved/live).
  pitchPlaceholder: {
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  pitchPlaceholderText: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: 20,
    color: textTokens.secondary,
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
  // META-ORCH-1290 D-5 scores card
  scoreHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  sectionTitleInline: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  reScoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  reScoreText: {
    flex: 1,
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  showAllRow: { marginTop: spacing.sm, alignItems: "flex-start" },
  ghostPreview: { marginTop: spacing.sm, gap: spacing.sm, opacity: 0.6 },
  scoreValueGhost: {
    width: 28,
    textAlign: "right",
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    color: textTokens.tertiary,
  },
  actionRow: { marginTop: spacing.md, alignItems: "flex-start" },
  actionsCol: { gap: spacing.sm, marginTop: spacing.xs },
  correctionForm: { gap: spacing.sm, minWidth: 320 },
  correctionTitle: { fontSize: typography.h3.fontSize, fontWeight: "700", color: textTokens.primary },
  correctionComparison: { fontSize: typography.caption.fontSize, color: textTokens.secondary, padding: spacing.sm, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10 },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  categoryChoice: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  categoryChoiceSelected: { borderColor: accent.warm, backgroundColor: "rgba(235,120,37,0.14)" },
  correctionStatus: { minHeight: 20, color: textTokens.secondary, fontSize: typography.bodySm.fontSize },
  correctionActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, marginTop: spacing.sm },
  // ORCH-1064 — cancel the banner's own marginHorizontal so the re-homed
  // follow_up tile aligns flush with the surrounding GlassCards; trim its
  // marginBottom (the scroll already supplies `gap: spacing.md`).
  bannerHost: { marginHorizontal: -spacing.md, marginBottom: -spacing.sm },
});

export default VenueListingContent;
