/**
 * /venue/[venueId] (META-ORCH-1255, DESIGN §5) — the per-venue management
 * PAGE. Pushed from the Hub venue card list; everything on screen is scoped
 * to ONE `venue_listings` row.
 *
 * Header (#1483, superseding DESIGN §5.2's hand-rolled row): TWO bands, the
 * same split every other detail page uses (`app/event/[id]/index.tsx`).
 *   Band 1 — the shared `TopBar` (`leftKind="back"`), section title
 *            "Stay"/"Venue", page actions in `rightSlot`.
 *   Band 2 — `VenueIdentityBand`: cover + venue name (2 lines) + category·city
 *            + the shared ListingStatusChip (never truncates).
 * No venue switcher — back-only switching, zero wrong-venue writes.
 *
 * `rightSlot` actions (#1483) are HIDDEN, never disabled, unless the venue is
 * publicly reachable: `venue_public_view` is defined `WHERE claim_status =
 * 'verified'`, so every other claim state 404s on the public page. Same shape
 * as `buildOfferingManageActions` dropping a row when its handler is
 * undefined.
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
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { VenueClaimFeedbackSheet } from "../../../src/components/brand/VenueClaimFeedbackSheet";
import { VenueClaimStatusBanner } from "../../../src/components/brand/VenueClaimStatusBanner";
import { StaySuiteShell } from "../../../src/components/stay/StaySuiteShell";
import { VenueIdentityBand } from "../../../src/components/venue/VenueIdentityBand";
import { VenueModulePillRow } from "../../../src/components/venue/VenueModulePillRow";
// #2099 §F3 — EXTENSIONLESS on purpose: Metro resolves `.web` on web and
// `.native` on iOS/Android, so the correction feature never enters a native
// graph. TypeScript is served by the sibling `.d.ts` (the same shape
// `useShareNetworkState.{web,native,d}.ts` already relies on).
import PendingVenueIdentityCorrectionLauncher from "../../../src/components/venue/PendingVenueIdentityCorrectionLauncher";
import { VenueSuiteShell } from "../../../src/components/venue/VenueSuiteShell";
import { Button } from "../../../src/components/ui/Button";
import { IconChrome } from "../../../src/components/ui/IconChrome";
import { ShareModal } from "../../../src/components/ui/ShareModal";
import { Toast } from "../../../src/components/ui/Toast";
import { TopBar } from "../../../src/components/ui/TopBar";
import {
  canvas,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import {
  venuePublicPath,
  venuePublicUrl,
} from "../../../src/constants/publicUrls";
import { useAuth } from "../../../src/context/AuthContext";
import { useVenuePipelineState } from "../../../src/hooks/useBrandPlacePipelineState";
import { useBrand } from "../../../src/hooks/useBrands";
import { useResponsiveLayout } from "../../../src/hooks/useResponsiveLayout";
import { useVenueClaimOpenCount } from "../../../src/hooks/useVenueClaimFeedback";
import { useVenueListing } from "../../../src/hooks/useVenueListings";
// #1483 — THE ONE OWNER of "open an external destination" inside
// mingla-business (I-PROPOSED-1381-OPEN-EXTERNAL-SINGLE-OWNER, gate
// `.github/scripts/strict-grep/orch-1381-open-external-no-double-nav.mjs`).
// It opens with a BARE `window.open(dest, "_blank")` then severs
// `win.opener = null`: a `noopener`/`noreferrer` feature string makes open()
// return null EVEN ON SUCCESS, so an inline re-roll would either double-
// navigate or turn a genuinely blocked popup into a dead tap (Constitution #1).
import { openExternal } from "../../../src/services/guestFunnelLink";
import { useVenueSuiteStore } from "../../../src/store/venueSuiteStore";
import { listingStatusView } from "../../../src/utils/listingStatus";
import { useSuccessfulBusinessRecentOpen } from "../../../src/hooks/useBusinessRecent";

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
    module?: string | string[];
  }>();
  const venueId = paramValue(params.venueId);
  const focus =
    paramValue(params.focus) === "feedback" ? ("feedback" as const) : undefined;
  // Issue #1735 G-3 — `?module=insights` deep link (Overview tile + to-do
  // nudges). Whitelist the literal "insights" ONLY: it is command-band, so it
  // is always in `visibleModules` and can never select a hidden module. Any
  // other value is ignored (the default Overview stands).
  //
  // Issue #1791 — `?module=orders` joins it, and this is the landing point of
  // every `mingla-business://venue/{id}/orders` push the alerting spine sends.
  // Same whitelist reasoning: `orders` is command-band and therefore always
  // visible, so a tapped notification can never select a hidden module.
  const requestedModule = paramValue(params.module);
  const initialModule = requestedModule === "insights"
    ? ("insights" as const)
    : requestedModule === "orders"
    ? ("orders" as const)
    : undefined;

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
  const setPendingLeaveFocus = useVenueSuiteStore(
    (s) => s.setPendingLeaveFocus,
  );

  const handleBack = useCallback((restoreFocus?: () => void): void => {
    setPendingLeaveFocus(restoreFocus ?? null);
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/hub/listing" as never);
  }, [router, setPendingLeaveFocus]);

  // ----- public-page actions (#1483) -----
  // `venue_public_view` is defined `WHERE claim_status = 'verified'`, so any
  // other claim state renders PublicVenueNotFound. The controls are therefore
  // HIDDEN (never disabled) unless the page really exists. The slug clauses are
  // the PublicUrlError guard — `venuePublicUrl`/`venuePublicPath` throw on an
  // empty segment, which would white-screen this page at render time.
  const brandSlug = brand?.slug ?? null;
  const venueSlug = venue?.slug ?? null;
  const canShowPublic =
    venue?.claimStatus === "verified" &&
    brandSlug !== null &&
    brandSlug.length > 0 &&
    venueSlug !== null &&
    venueSlug.length > 0;
  const [shareVisible, setShareVisible] = useState<boolean>(false);

  // D1 — in-app on native (the public page is a route in this same app), new
  // browser tab on desktop web (the operator keeps the manager open).
  const handleViewPublic = useCallback((): void => {
    if (brandSlug === null || venueSlug === null) return;
    if (Platform.OS === "web") {
      openExternal(venuePublicUrl({ brandSlug, venueSlug }));
    } else {
      router.push(venuePublicPath({ brandSlug, venueSlug }) as never);
    }
  }, [brandSlug, venueSlug, router]);

  // ----- claim-feedback loop (ORCH-1064, venue-keyed) -----
  const followUpAt = venue?.claimFollowUpAt ?? null;
  const hasFollowUp =
    (venue?.claimStatus === "pending_review" ||
      venue?.claimStatus === "suspended") &&
    Boolean(followUpAt);
  const openFeedbackCount = useVenueClaimOpenCount(
    brandId,
    venueId,
    followUpAt,
  );
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

  useSuccessfulBusinessRecentOpen({
    brandId, entityType: "venue", entityId: venueId,
    ready: isAuthReady && user !== null && venue !== null,
    title: venue?.name, coverUrl: venue?.coverMediaUrl,
    coverPosterUrl: venue?.coverMediaPosterUrl, coverType: venue?.coverMediaType,
    status: venue?.claimStatus,
  });

  if (!isAuthReady || user === null) {
    return <View style={[styles.root, { paddingTop: insets.top }]} />;
  }

  if (venueQuery.isLoading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerWrap}>
          <TopBar
            leftKind="back"
            onBack={handleBack}
            rightSlot={<View />}
            testID="venue-page-topbar-loading"
          />
        </View>
        <ScrollView
          style={styles.center}
          contentContainerStyle={styles.centerContent}
        >
          <ActivityIndicator />
          <Text style={styles.helper}>Loading venue…</Text>
        </ScrollView>
      </View>
    );
  }

  if (venue === null || venueId === null) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerWrap}>
          <TopBar
            leftKind="back"
            onBack={handleBack}
            rightSlot={<View />}
            testID="venue-page-topbar-not-found"
          />
        </View>
        <ScrollView
          style={styles.center}
          contentContainerStyle={styles.centerContent}
        >
          <Text style={styles.notFoundTitle}>Venue not found</Text>
          <Text style={styles.helper}>
            This venue may have been removed, or the link is out of date.
          </Text>
          <Button
            label="Back to your venues"
            variant="secondary"
            size="md"
            onPress={() => handleBack()}
          />
        </ScrollView>
      </View>
    );
  }

  // #1483 — the SINGLE source of the stay/venue split on this page. Both the
  // TopBar section title and the suite-shell branch read this one boolean.
  //
  // The stay equality check below must appear EXACTLY ONCE in this file — in
  // source AND in comments. The issue-1424 gate's self-test neutralises it with
  // `String.replace(from, to)`, which rewrites only the FIRST occurrence, then
  // asserts the gate consequently fails. Any second copy (even inside a
  // comment, since the gate reads raw source) survives that reversion, keeps
  // the gate green, and silently disarms the stay-authoring guard. Do NOT
  // re-inline this comparison and do NOT quote it anywhere in this file.
  const isStayVenue = venue.venueCategory === "stay";

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      {/* #1483 band 1 — the shared TopBar. `rightSlot` on a leftKind="back"
          consumer is the documented canonical replace mechanism (TopBar.tsx:
          66-77); I-37 forbids it only on leftKind="brand". No `moreH` overflow
          menu — there is nothing to put in it and an empty menu is a dead tap
          (Constitution #1). */}
      <View style={styles.headerWrap}>
        <TopBar
          leftKind="back"
          onBack={handleBack}
          title={isStayVenue ? "Stay" : "Venue"}
          testID="venue-page-topbar"
          rightSlot={
            canShowPublic ? (
              <View style={styles.headerRightRow}>
                {isWideDesktop ? (
                  <Button
                    label="View public page"
                    variant="secondary"
                    size="sm"
                    leadingIcon="eye"
                    onPress={handleViewPublic}
                    testID="venue-page-view-public"
                  />
                ) : (
                  <IconChrome
                    icon="eye"
                    size={36}
                    accessibilityLabel="View public page"
                    onPress={handleViewPublic}
                    testID="venue-page-view-public"
                  />
                )}
                <IconChrome
                  icon="share"
                  size={36}
                  accessibilityLabel="Share venue"
                  onPress={() => setShareVisible(true)}
                  testID="venue-page-share"
                />
              </View>
            ) : (
              // Empty placeholder for layout balance (TopBar.tsx:71-73). The
              // controls are HIDDEN, never disabled.
              <View />
            )
          }
        />
      </View>

      {/* #1483 band 2 — venue identity (cover + name + category·city + chip). */}
      <VenueIdentityBand
        venue={venue}
        status={status}
        testID="venue-page-identity-band"
      />

      {/* #2099 §F3 — the pending-identity correction slot. It is a DIRECT
          sibling of the identity band, wrapped in exactly one expression
          container, and it sits ABOVE the pill row, the claim banner and BOTH
          suite branches so a `stay` venue (which renders StaySuiteShell and
          never reaches VenueSuiteShell) keeps the control after a play→stay
          correction — which is what the same-RPC rollback needs. The gate is
          the claim state and nothing else: no viewport conjunct, no
          feedback-round conjunct, no wrapper View (the native launcher returns
          null, and a padded wrapper would leave a visible empty band on iOS
          and Android). */}
      {venue.claimStatus === "pending_review" ? (
        <PendingVenueIdentityCorrectionLauncher
          venueId={venueId}
          claimStatus={venue.claimStatus}
        />
      ) : null}

      {!isWideDesktop &&
      venue.venueCategory !== "stay" &&
      venueSelectModule !== null ? (
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

      {isStayVenue && brandId !== null ? (
        <StaySuiteShell
          brandId={brandId}
          venueId={venueId}
          venueName={venue.name}
          venueApproved={venue.claimStatus === "verified"}
        />
      ) : (
        <VenueSuiteShell
          brandId={brandId}
          venueId={venueId}
          focus={focus}
          // #1735 G-3 — `?module=insights` lands with Insights active; the
          // shell's store sync propagates it to the pill row/rail. Stays never
          // reach this branch (Insights does not exist for stays in v1 — G-21).
          initialModule={initialModule ?? "overview"}
        />
      )}

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
      {/* #1483 — construction is gated: venuePublicUrl throws PublicUrlError
          on an empty segment, so it is only ever called behind canShowPublic. */}
      {canShowPublic && brandSlug !== null && venueSlug !== null ? (
        <ShareModal
          preloadContent
          visible={shareVisible}
          onClose={() => setShareVisible(false)}
          url={venuePublicUrl({ brandSlug, venueSlug })}
          contentKind="venue"
          title={venue.name}
        />
      ) : null}

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
  // #1483 — the TopBar host. Matches app/event/[id]/index.tsx:993-995 and
  // app/trip/[id]/index.tsx:741-743 exactly (the bar is inset, not full-bleed).
  headerWrap: {
    paddingHorizontal: spacing.md,
  },
  headerRightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  bannerHost: {
    marginBottom: -spacing.sm,
  },
  // #2211 — the not-found branch is centred and carries the only
  // 'Back to your venues' Button; the loading branch shares the root.
  center: {
    flex: 1,
    overflow: "hidden",
  },
  centerContent: {
    // #2211 — EXPLICIT flexGrow (RN defaults content containers to 0).
    flexGrow: 1,
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
