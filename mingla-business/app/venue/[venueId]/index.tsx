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

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
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
import { VenueIdentityBand } from "../../../src/components/venue/VenueIdentityBand";
import { VenueModulePillRow } from "../../../src/components/venue/VenueModulePillRow";
import { VenuePreviewAction } from "../../../src/components/venue/VenuePreviewAction";
import {
  parseVenueItemParam,
  parseVenueModuleParam,
} from "../../../src/components/venue/venueModules";
// #2099 §F3 — EXTENSIONLESS on purpose: Metro resolves `.web` on web and
// `.native` on iOS/Android, so the correction feature never enters a native
// graph. TypeScript is served by the sibling `.d.ts` (the same shape
// `useShareNetworkState.{web,native,d}.ts` already relies on).
import PendingVenueIdentityCorrectionLauncher from "../../../src/components/venue/PendingVenueIdentityCorrectionLauncher";
// #4490 — both workspaces load from the one Host venue owner (same names and
// props as the shells; see LazyVenueSuites.tsx).
import { StaySuiteShell, VenueSuiteShell } from "../../../src/components/venue/host/LazyVenueSuites";
import { loadVenueHostScreens } from "../../../src/components/venue/host/venueHostOwner";
import { Button } from "../../../src/components/ui/Button";
import { IconChrome } from "../../../src/components/ui/IconChrome";
import { ShareModal } from "../../../src/components/ui/ShareModal";
import { Toast } from "../../../src/components/ui/Toast";
import { TopBar } from "../../../src/components/ui/TopBar";
import {
  color,
  space,
  type,
} from "../../../src/constants/designSystem";
import {
  venuePublicPath,
  venuePublicUrl,
} from "../../../src/constants/publicUrls";
import { SignedInNotFoundNotice } from "../../../src/components/auth/SignedInNotFoundNotice";
import { useAuth } from "../../../src/context/AuthContext";
// #3259 — names the signed-in account on the empty branch below and offers the
// wrong-account escape. Owns the await-before-navigate ordering.
import { useSwitchAccount } from "../../../src/hooks/useSwitchAccount";
import { useUnsavedChangesGuard } from "../../../src/hooks/useUnsavedChangesGuard";
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
import { QueryClientContext } from "@tanstack/react-query";
import { useSuccessfulBusinessRecentOpen } from "../../../src/hooks/useBusinessRecent";
import { OptionalFeatureBoundary } from "../../../src/components/brandContact/OptionalFeatureBoundary";


// #3872 — Local reviews belong to the Creator and Referral program, so they
// load through its one lazy owner and stay out of the eager web chunk.
const LocalReviewsManager = React.lazy(async () => {
  const mod = await import("../../../src/components/programs/creatorProgramOwner");
  return { default: mod.LocalReviewsManager };
});

// #4420 (R8 P19) — the Overview Reviews summary row loads with the reviews
// themselves (lazily), never on the venue page's first paint.
const VenueReviewsSummaryRow = React.lazy(async () => {
  const mod = await import("../../../src/components/venue/VenueReviewsSummaryRow");
  return { default: mod.VenueReviewsSummaryRow };
});

function paramValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default function VenueManagementPage(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, isAuthReady } = useAuth();
  const { signedInEmail, onSwitchAccount } = useSwitchAccount();
  const { isWideDesktop } = useResponsiveLayout();
  const params = useLocalSearchParams<{
    venueId?: string | string[];
    focus?: string | string[];
    module?: string | string[];
    item?: string | string[];
  }>();
  const venueId = paramValue(params.venueId);
  const focus =
    paramValue(params.focus) === "feedback" ? ("feedback" as const) : undefined;
  // `?module=<id>` deep link — Issue #1735 G-3 (`insights`, Overview tile +
  // to-do nudges), Issue #1791 (`orders`, the landing point of every
  // `mingla-business://venue/{id}/orders` push) and #3389 (`tables` / `menu`
  // from the Home data-completeness to-dos, which used to land on Overview).
  // Any known venue module is accepted; unknown values keep Overview. A booking
  // module on a venue whose reservations are off is left for Overview by the
  // shell once its settings load (`shouldLeaveBookingModule`).
  const requestedModule = paramValue(params.module);
  const initialModule = parseVenueModuleParam(requestedModule);
  // #4490 — `&item=<id>` opens that offer on arrival (`?module=offers`).
  const initialItemId = parseVenueItemParam(params.item) ?? null;

  const venueQuery = useVenueListing(venueId);
  const venue = venueQuery.data ?? null;
  // One owner per truth: the page derives its brand from the VENUE row (a
  // deep link may arrive while another brand is active).
  const brandId = venue?.brandId ?? null;
  const brand = useBrand(brandId).data ?? null;
  const pipeline = useVenuePipelineState(venueId);

  const listingStatus = listingStatusView({
    hasVenue: venue !== null,
    status: pipeline.data?.status ?? null,
    claimStatus: venue?.claimStatus,
  });
  // #4490 fix 2 (N74): a stay venue Mingla approved is not "Live" until its
  // stay itself sells (the Stay overview's own rule: booking state active and
  // a live room or place). The header says the same thing as the overview.
  // Read through the query cache only for a stay venue (no extra hook, so the
  // route's module tests that mount without a query client are unchanged).
  const routeQueryClient = React.useContext(QueryClientContext);
  const stayVenueHeader = venue?.venueCategory === "stay";
  const [stayLive, setStayLive] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    if (!stayVenueHeader || routeQueryClient === undefined || typeof venueId !== "string" || venueId.length === 0) {
      setStayLive(null);
      return undefined;
    }
    let cancelled = false;
    // #4490 — from the Host venue owner the suites load from anyway (a
    // separate import() of this service put it in two chunks, i.e. __common).
    void loadVenueHostScreens()
      .then(({ getStayInventory }) =>
        routeQueryClient.fetchQuery({
          queryKey: ["stay-inventory", venueId],
          staleTime: 10_000,
          queryFn: () => getStayInventory(venueId),
        }),
      )
      .then((snap) => {
        if (cancelled) return;
        setStayLive(
          snap.settings?.booking_state === "active" &&
            (snap.offerings ?? []).some((offering) => offering.status === "live"),
        );
      })
      .catch(() => {
        if (!cancelled) setStayLive(null);
      });
    return () => {
      cancelled = true;
    };
  }, [stayVenueHeader, routeQueryClient, venueId]);
  const status =
    stayVenueHeader && listingStatus.label === "Live on Mingla" && stayLive === false
      ? { ...listingStatus, label: "Approved · not live yet", tone: "info" as const, hint: "Mingla approved your venue. Finish the Stay overview to start taking bookings." }
      : listingStatus;

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
  const venueDirtyModules = useVenueSuiteStore((s) => s.dirtyModules);
  const setPendingLeaveFocus = useVenueSuiteStore(
    (s) => s.setPendingLeaveFocus,
  );

  const requestLeave = useVenueSuiteStore((s) => s.requestLeave);
  const handleBack = useCallback((restoreFocus?: () => void): void => {
    setPendingLeaveFocus(restoreFocus ?? null);
    const proceed = (): void => {
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)/hub/listing" as never);
    };
    if (requestLeave !== null) {
      requestLeave(proceed, restoreFocus);
      return;
    }
    proceed();
  }, [requestLeave, router, setPendingLeaveFocus]);
  // #4453 — unsaved venue edits hold a brand switch. Android back keeps its own path (#3655).
  useUnsavedChangesGuard({ dirty: venueDirtyModules.size > 0, onRequestLeave: handleBack, hardwareBack: false });

  // #4490 N11: keep the open module in the address. Moving by the side nav
  // used to leave `?module=offers` behind, so a reload or a shared link opened
  // the wrong module. `setParams` replaces the address (no extra history
  // entry); an offer or member opened by `&item=` belongs to the module it was
  // opened in, so it is dropped on a move.
  const handleModuleChange = useCallback(
    (module: string): void => {
      router.setParams({
        module: module === "overview" ? undefined : module,
        item: undefined,
      } as never);
    },
    [router],
  );

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

  // #4490 — the Host preview of a venue that is not public yet.
  const handlePreviewPage = useCallback((): void => {
    if (venueId === null) return;
    router.push(`/venue/${venueId}/preview` as never);
  }, [venueId, router]);

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

  // #3385 — a venue sub-screen (deck readiness) saved and returned here.
  // Consumed once, for THIS venue only, so the confirmation shows exactly once.
  const savedFlash = useVenueSuiteStore((s) => s.savedFlash);
  const takeSavedFlash = useVenueSuiteStore((s) => s.takeSavedFlash);
  useEffect(() => {
    if (savedFlash === null || venueId === null) return;
    const message = takeSavedFlash(venueId, Date.now());
    if (message !== null) setToast({ kind: "success", message });
  }, [savedFlash, takeSavedFlash, venueId]);

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
      <View style={[styles.root, { paddingTop: insets.top + space[2] }]}>
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
      <View style={[styles.root, { paddingTop: insets.top + space[2] }]}>
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
          {/*
            #3259 P2-3 — the host's own hedge is for a reader we know NOTHING
            about. When the notice renders it says this and names the account,
            so showing both states one cause and then a different set of causes
            a line apart. Signed-out keeps it verbatim.
          */}
          {signedInEmail === null ? (
            <Text style={styles.helper}>
              This venue may have been removed, or the link is out of date.
            </Text>
          ) : null}
          <Button
            label="Back to your venues"
            variant="secondary"
            size="md"
            onPress={() => handleBack()}
          />
          {/*
            #3259 — a signed-in reader gets the account named and a way out. The
            client CANNOT tell a deleted row from an RLS-filtered one
            (`.maybeSingle()` returns `{data: null, error: null}` for both), so
            the copy states both and asserts neither.
          */}
          <SignedInNotFoundNotice
            variant="restricted"
            signedInEmail={signedInEmail}
            onSwitchAccount={onSwitchAccount}
            testID="venue-not-found-signed-in-notice"
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

  // #4420 B8 — the Local reviews panel scrolls WITH the suite's Overview (its
  // header) instead of sitting in this page's fixed header stack, where a long
  // list ate the screen and nothing below it could be reached (iOS and short
  // desktop windows). An optional, lazily-loaded panel: if its chunk fails to
  // load or it throws, it hides itself and the rest of the venue page stays up.
  // #4420 — the Reviews module shows loading / empty / error states (the panel
  // is the whole page there); as a Stay Overview header it stays optional.
  const renderLocalReviews = (
    variant: "panel" | "module",
  ): React.ReactElement | null =>
    venue.claimStatus === "verified" &&
    brandId !== null &&
    venue.placePoolId !== null ? (
      <OptionalFeatureBoundary name="venue-local-reviews">
        <Suspense fallback={null}>
          <LocalReviewsManager
            brandId={brandId}
            placePoolId={venue.placePoolId}
            variant={variant}
          />
        </Suspense>
      </OptionalFeatureBoundary>
    ) : null;
  const localReviewsPanel = renderLocalReviews("panel");

  return (
    <View style={[styles.root, { paddingTop: insets.top + space[2] }]}>
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
            ) : venue !== null && venueId !== null ? (
              // #4490 — a venue that is not public yet (in review, say) has no
              // public page to view, but its owner can see exactly the page
              // guests will get, with booking switched off. It is deliberately
              // separate from #1483's public/share controls.
              <VenuePreviewAction
                compact={!isWideDesktop}
                onPress={handlePreviewPage}
              />
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
          dirtyModules={venueDirtyModules}
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
          overviewHeader={localReviewsPanel}
          initialModule={initialModule ?? "overview"}
          initialItemId={initialItemId}
          requestedModule={requestedModule ?? null}
          onModuleChange={handleModuleChange}
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
          initialItemId={initialItemId}
          onModuleChange={handleModuleChange}
          // #4420 (round-3 item 19) — Local reviews are their own Reviews
          // module now, not a panel at the top of Overview.
          reviewsPanel={renderLocalReviews("module")}
          renderReviewsSummary={
            localReviewsPanel !== null && brandId !== null && venue.placePoolId !== null
              ? (openReviews) => (
                  <OptionalFeatureBoundary name="venue-reviews-summary">
                    <Suspense fallback={null}>
                      <VenueReviewsSummaryRow
                        brandId={brandId}
                        placePoolId={venue.placePoolId as string}
                        onOpen={openReviews}
                      />
                    </Suspense>
                  </OptionalFeatureBoundary>
                )
              : undefined
          }
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
    backgroundColor: color.canvas,
  },
  // #1483 — the TopBar host. Matches app/event/[id]/index.tsx:993-995 and
  // app/trip/[id]/index.tsx:741-743 exactly (the bar is inset, not full-bleed).
  headerWrap: {
    paddingHorizontal: space[4],
  },
  headerRightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  bannerHost: {
    marginBottom: -space[2],
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
    gap: space[2],
    paddingHorizontal: space[6],
  },
  helper: {
    fontSize: type.small.fontSize,
    color: color.text2,
    textAlign: "center",
  },
  notFoundTitle: {
    fontSize: type.h1.fontSize,
    fontWeight: type.h1.fontWeight,
    color: color.text1,
    textAlign: "center",
  },
});
