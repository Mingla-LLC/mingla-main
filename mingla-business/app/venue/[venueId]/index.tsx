/**
 * /venue/[venueId] (META-ORCH-1255, DESIGN §5) — the per-venue management
 * PAGE. Pushed from the Hub venue card list; everything on screen is scoped
 * to ONE `venue_listings` row.
 *
 * Header (DESIGN §5.2): back chevron ("Back to your venues") + venue name
 * (h3, truncates) + the shared ListingStatusChip (never truncates). No venue
 * switcher — back-only switching, zero wrong-venue writes.
 *
 * LOCKED DECISION 5 consequence (DESIGN §5.4): `venueSuiteStore`
 * activate()/deactivate() lives HERE now (moved from the Hub tab). On native
 * this pushed page sits OUTSIDE the hub layout, so the layout's pill-row
 * bridge cannot reach it — the page renders the module pill row ITSELF on
 * native/web-phone (the documented inline fallback), driven by the same
 * store the shell syncs into. Desktop ≥1024 uses the shell's own rail.
 *
 * `?focus=feedback` (admin push / to-do deep link, forwarded by the kept
 * `/brand/{id}/listing?venue=` alias) auto-opens the venue's claim-feedback
 * sheet once a follow-up round exists; a follow-up also surfaces the
 * interactive claim banner above the suite so the loop is always reachable.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft } from "lucide-react-native";

import { VenueClaimFeedbackSheet } from "../../../src/components/brand/VenueClaimFeedbackSheet";
import { VenueClaimStatusBanner } from "../../../src/components/brand/VenueClaimStatusBanner";
import { ListingStatusChip } from "../../../src/components/venue/ListingStatusChip";
import { VenueModulePillRow } from "../../../src/components/venue/VenueModulePillRow";
import { VenueSuiteShell } from "../../../src/components/venue/VenueSuiteShell";
import { Button } from "../../../src/components/ui/Button";
import { Toast } from "../../../src/components/ui/Toast";
import {
  canvas,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { useAuth } from "../../../src/context/AuthContext";
import { useVenuePipelineState } from "../../../src/hooks/useBrandPlacePipelineState";
import { useBrand } from "../../../src/hooks/useBrands";
import { useResponsiveLayout } from "../../../src/hooks/useResponsiveLayout";
import { useVenueClaimOpenCount } from "../../../src/hooks/useVenueClaimFeedback";
import { useVenueListing } from "../../../src/hooks/useVenueListings";
import { useVenueSuiteStore } from "../../../src/store/venueSuiteStore";
import { listingStatusView } from "../../../src/utils/listingStatus";

function paramValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default function VenueManagementPage(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, isAuthReady } = useAuth();
  const { isWideDesktop } = useResponsiveLayout();
  const params = useLocalSearchParams<{
    venueId?: string | string[];
    focus?: string | string[];
  }>();
  const venueId = paramValue(params.venueId);
  const focus =
    paramValue(params.focus) === "feedback" ? ("feedback" as const) : undefined;

  const venueQuery = useVenueListing(venueId);
  const venue = venueQuery.data ?? null;
  // One owner per truth: the page derives its brand from the VENUE row (a
  // deep link may arrive while another brand is active).
  const brandId = venue?.brandId ?? null;
  const brand = useBrand(brandId).data ?? null;
  const pipeline = useVenuePipelineState(venueId);

  const status = listingStatusView({
    hasVenue: venue !== null,
    status: pipeline.data?.status ?? null,
    claimStatus: venue?.claimStatus,
  });

  // LOCKED DECISION 5 — suite store lifecycle moved to this page.
  const activate = useVenueSuiteStore((s) => s.activate);
  const deactivate = useVenueSuiteStore((s) => s.deactivate);
  useEffect(() => {
    activate("overview");
    return () => deactivate();
  }, [activate, deactivate]);

  // Module pill row (native/web-phone) — the pushed page is outside the hub
  // layout, so the page owns the row; desktop uses the shell's rail.
  const venueActiveModule = useVenueSuiteStore((s) => s.activeModule);
  const venueVisibleModules = useVenueSuiteStore((s) => s.visibleModules);
  const venueSelectModule = useVenueSuiteStore((s) => s.selectModule);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/hub/listing" as never);
  }, [router]);

  // ----- claim-feedback loop (ORCH-1064, venue-keyed) -----
  const followUpAt = venue?.claimFollowUpAt ?? null;
  const hasFollowUp =
    (venue?.claimStatus === "pending_review" ||
      venue?.claimStatus === "suspended") && Boolean(followUpAt);
  const openFeedbackCount = useVenueClaimOpenCount(brandId, venueId, followUpAt);
  const [feedbackVisible, setFeedbackVisible] = useState<boolean>(false);
  const [toast, setToast] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  useEffect(() => {
    if (focus === "feedback" && hasFollowUp) setFeedbackVisible(true);
  }, [focus, hasFollowUp]);

  const claimRow = useMemo(
    () =>
      venue !== null
        ? {
            claimStatus: venue.claimStatus,
            rejectionReason: venue.rejectionReason,
            claimFollowUpAt: venue.claimFollowUpAt,
          }
        : null,
    [venue],
  );

  if (!isAuthReady || user === null) {
    return <View style={[styles.root, { paddingTop: insets.top }]} />;
  }

  if (venueQuery.isLoading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.helper}>Loading venue…</Text>
        </View>
      </View>
    );
  }

  if (venue === null || venueId === null) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel="Back to your venues"
            hitSlop={10}
          >
            <ArrowLeft size={22} color={textTokens.primary} />
          </Pressable>
        </View>
        <View style={styles.center}>
          <Text style={styles.notFoundTitle}>Venue not found</Text>
          <Text style={styles.helper}>
            This venue may have been removed, or the link is out of date.
          </Text>
          <Button
            label="Back to your venues"
            variant="secondary"
            size="md"
            onPress={handleBack}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      {/* DESIGN §5.2 — back + name (truncates) + chip (never truncates). */}
      <View style={styles.headerRow}>
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Back to your venues"
          hitSlop={10}
          testID="venue-page-back"
        >
          <ArrowLeft size={22} color={textTokens.primary} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {venue.name}
          </Text>
        </View>
        <View style={styles.headerChip}>
          <ListingStatusChip status={status} testID="venue-page-status-chip" />
        </View>
      </View>

      {!isWideDesktop && venueSelectModule !== null ? (
        <VenueModulePillRow
          modules={venueVisibleModules}
          activeModule={venueActiveModule}
          onSelect={venueSelectModule}
          onBackToHub={handleBack}
          testID="venue-page-module-pills"
        />
      ) : null}

      {hasFollowUp ? (
        <View style={styles.bannerHost}>
          <VenueClaimStatusBanner
            brand={brand}
            claimRow={claimRow}
            openCount={openFeedbackCount}
            onPressFeedback={() => setFeedbackVisible(true)}
          />
        </View>
      ) : null}

      <VenueSuiteShell brandId={brandId} venueId={venueId} focus={focus} />

      <VenueClaimFeedbackSheet
        visible={feedbackVisible}
        brand={brand}
        venueId={venueId}
        venueName={venue.name}
        venueFollowUpAt={followUpAt}
        accountId={user.id}
        onClose={() => setFeedbackVisible(false)}
        onResubmitted={() =>
          setToast({
            kind: "success",
            message: "Sent back for review — we'll take another look.",
          })
        }
        onActionError={(message) => setToast({ kind: "error", message })}
      />
      <Toast
        visible={toast !== null}
        kind={toast?.kind ?? "success"}
        message={toast?.message ?? ""}
        onDismiss={() => setToast(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  headerTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  headerChip: {
    flexShrink: 0,
  },
  bannerHost: {
    marginBottom: -spacing.sm,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    textAlign: "center",
  },
  notFoundTitle: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
    textAlign: "center",
  },
});
