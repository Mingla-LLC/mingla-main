/**
 * BrandProfileView — founder view of a brand profile (J-A7).
 *
 * Renders two states:
 *   - `brand === null` → Not Found GlassCard with back CTA
 *   - `brand !== null` → Hero + Stats Strip + Stripe Banner + Operations
 *                        + Recent Events + Sticky Bottom Shelf
 *
 * All inert CTAs (Edit, View public, Stripe banner, Operations rows,
 * empty-bio CTA, empty-events CTA) fire `[TRANSITIONAL]` Toast strings
 * pointing to their target cycle (J-A8 / J-A9 / J-A10 / J-A12 / Cycle 3).
 *
 * Authoritative design source: `Mingla_Artifacts/handoffs/HANDOFF_BUSINESS_DESIGNER.md`
 * §5.3.3 (lines 1825-1830). The design package's `BrandProfileScreen` is the
 * EDITOR (J-A8), NOT this view — see investigation H-A7-1.
 *
 * Per spec §3.4. Sticky shelf renders absolute-positioned above safe-area.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useReducedMotion } from "react-native-reanimated";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { brandKeys } from "../../hooks/useBrands";
import { eventOrdersKeys } from "../../hooks/useEventOrders";
import { useBusinessEventsForBrand } from "../../hooks/useBusinessEvents";

import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { Brand, BrandStripeStatus } from "../../store/currentBrandStore";
import type { LiveEvent } from "../../store/liveEventStore";
import { formatCurrencyRound, formatCount } from "../../utils/currency";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { canPerformAction } from "../../utils/permissionGates";
import { isBrandPayoutReady } from "../../utils/brandPayout";
import {
  getBrandProfileStripeBannerCopy,
  getBrandProfileStripeOperationsSub,
} from "../../utils/brandStripeUiState";
import { deriveCardStatus } from "../../../app/(tabs)/hub/eventCardStatus";
// Issue #1835 — brand deletion is owner-only; hide the danger zone for anyone
// whose delete the `brands` RLS policy would refuse.
import { useAuth } from "../../context/AuthContext";
import { canDeleteBrand } from "../../utils/brandDeletePermission";
import { isFeatureEnabled } from "../../config/featureFlags";

import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import { KpiTile } from "../ui/KpiTile";
import { OfferingListCard } from "../offering/OfferingListCard";
import { liveEventToOfferingModel } from "../offering/offeringCardModels";
import { TopBar } from "../ui/TopBar";

interface OperationsRow {
  icon: IconName;
  label: string;
  sub: string;
  /** Tap handler — navigation to the linked surface. */
  onPress: () => void;
}

/**
 * Normalize a social-link field value into a full URL. Founders may type
 * either a full URL (`https://instagram.com/lonelymoth`) or a handle
 * (`@lonelymoth` / `lonelymoth`). Mirrors the pattern in PublicBrandPage.
 *
 * Cycle 7 FX1 — added inline rather than lifted to a shared util; lift
 * only if a 3rd consumer appears.
 */
const normalizeSocialUrl = (raw: string, base: string): string => {
  const trimmed = raw.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  const handle = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return `${base}${handle}`;
};

/**
 * Pattern note: BrandProfileViewProps grows a navigation callback prop per
 * cycle as Operations rows + the Stripe banner go live. Current set
 * (FINAL for Cycle 2):
 *   - J-A8: onEdit (sticky-shelf "Edit brand")
 *   - J-A9: onTeam (Operations row "Team & permissions")
 *   - J-A10: onStripe (Stripe banner) + onPayments (Operations row "Payments & Stripe")
 *   - J-A12: onReports (Operations row "Finance reports")
 * Each callback is owned by the route file (see app/brand/[id]/index.tsx),
 * which calls router.push to navigate. This view component never imports
 * `useRouter` — keeps the view re-renderable in tests / web parity.
 *
 * Tax & VAT is configured under Payments & Stripe (ORCH-0804 "Tax &
 * registrations" CTA in BrandPaymentsView). No standalone Operations row.
 */
export interface BrandProfileViewProps {
  brand: Brand | null;
  /**
   * ORCH-1100 Wave 3 — cold-direct-load auth-readiness flash fix.
   * True while the brand is still being RESOLVED (auth/session warming on a
   * cold direct load, or the brand query has not yet fetched). When true the
   * view renders a LOADING state instead of the "Brand not found" empty branch,
   * so a refresh/bookmark of `/brand/{id}` no longer flashes "not found" before
   * the row resolves. Genuinely-missing brands (resolved + null) still render
   * the not-found state. Defaults to false → behaviour unchanged for callers
   * that don't pass it (e.g. tests / public-page consumers that already have
   * the brand).
   */
  isResolving?: boolean;
  /**
   * META-ORCH-1235 (§4.1) — true when the gating brand query rejected
   * (including a `withTimeout` TimeoutError after retries). When `brand` is
   * null AND `isError` is true, the view renders a recoverable error state
   * with a Retry button (wired to `onRetry` → `refetch()`) INSTEAD of the
   * permanent spinner or the genuine "Brand not found" empty branch. A
   * timeout/error is recoverable; a genuine not-found is not. Defaults to
   * false → behaviour unchanged for callers that don't pass it.
   */
  isError?: boolean;
  /**
   * META-ORCH-1235 (§4.1) — invoked when the user taps Retry on the error
   * state. Parent wires this to the brand query's `refetch()`.
   */
  onRetry?: () => void;
  /**
   * Live Stripe status wins over cached brand.stripeStatus when provided.
   * This prevents the profile banner/operations row from showing stale
   * "verifying" after Stripe has already marked the account active.
   */
  effectiveStripeStatus?: BrandStripeStatus;
  onBack: () => void;
  /**
   * Called when user taps the sticky-shelf "Edit brand" button.
   * Receives the brand id so the parent route can navigate.
   */
  onEdit: (brandId: string) => void;
  /**
   * Called when user taps the "Team & permissions" Operations row.
   * Receives the brand id. NEW in J-A9.
   */
  onTeam: (brandId: string) => void;
  /**
   * Called when user taps the Stripe banner (any visible state — banner is
   * suppressed when stripeStatus === "active"). NEW in J-A10. Pattern
   * continues onEdit + onTeam.
   */
  onStripe: (brandId: string) => void;
  /**
   * Called when user taps the "Payments & Stripe" Operations row.
   * Receives the brand id. NEW in J-A10.
   */
  onPayments: (brandId: string) => void;
  /** ORCH-1006 — opens the brand-level all-in pricing defaults screen. */
  onPricingDefaults: (brandId: string) => void;
  /**
   * Called when user taps the "Finance reports" Operations row.
   * Receives the brand id. NEW in J-A12 — final navigation prop in
   * the Cycle-2 chain.
   */
  onReports: (brandId: string) => void;
  /**
   * Called when user taps the "Audit log" Operations row.
   * Receives the brand id. NEW in Cycle 13a (SPEC §4.14). The row is
   * gated on rank >= MIN_RANK.VIEW_AUDIT_LOG so only brand_admin+
   * sees this entry point in the menu.
   */
  onAuditLog: (brandId: string) => void;
  /** #2830 — opens the lazy, provider-neutral Website workspace. */
  onWebsite?: (brandId: string) => void;
  /**
   * Called when user taps the "Blasts" Operations row (renamed from
   * "Customers" 2026-05-12 for bottom-nav consistency). Receives the
   * brand id. NEW in ORCH-0815-A2-ui (DEC-149 dual-surface Marketing
   * Hub — contextual entry point from inside the brand). Lists every
   * distinct buyer of the brand's events with a "Blast these N
   * customers →" CTA that pre-fills the marketing composer.
   */
  onBlasts: (brandId: string) => void;
  /**
   * Called when user taps "View public page". Receives the brand SLUG
   * (not id) — the public page route is `/b/{brandSlug}`.
   * NEW in Cycle 7 FX1 — replaces Cycle-2 J-A7 TRANSITIONAL Toast now
   * that Cycle 7 has shipped the public brand page.
   */
  onViewPublic: (brandSlug: string) => void;
  /**
   * Called when user taps the empty-events "Build a new event" CTA.
   * Routes to `/event/create` (the Cycle 3 wedge).
   * NEW in Cycle 7 FX1 — replaces Cycle-2 J-A7 TRANSITIONAL Toast that
   * was supposed to retire when Cycle 3 shipped (pre-existing miss).
   */
  onCreateEvent: () => void;
  /**
   * ORCH-1121 — called when user taps a Recent-Events row. Receives the
   * event id, its event_type, and its derived status so the route file can
   * dispatch via `routeForEventRowDefensive` (event → /event/{id},
   * experience → /experience/{id}). NOT a dead tap.
   */
  onOpenEvent: (eventId: string, eventType?: string, status?: string) => void;
  /**
   * ORCH-1121 — called when user taps the "See all" header link (only shown
   * when the brand has more than the 5 most-recent events shown). Routes to
   * the Hub events list.
   */
  onSeeAllEvents: () => void;
  /**
   * Called when user taps a social chip on the brand profile. Receives
   * the normalized full URL. Caller wires to `Linking.openURL`.
   * NEW in Cycle 7 FX1 — replaces Cycle-2 J-A7 TRANSITIONAL Toast.
   * Mirrors the new ShareModal social-link pattern from Cycle 7.
   */
  onOpenLink: (url: string) => void;
  /**
   * Cycle 17e-A — called when operator taps "Delete brand" in the danger
   * zone. Parent opens BrandDeleteSheet pre-populated with this brand.
   * Hidden when undefined (e.g., for read-only public-page consumers).
   */
  onRequestDelete?: (brand: Brand) => void;
}

export const BrandProfileView: React.FC<BrandProfileViewProps> = ({
  brand,
  isResolving = false,
  isError = false,
  onRetry,
  effectiveStripeStatus,
  onBack,
  onEdit,
  onTeam,
  onStripe,
  onPayments,
  onPricingDefaults,
  onReports,
  onAuditLog,
  onWebsite,
  onBlasts,
  onViewPublic,
  onCreateEvent,
  onOpenEvent,
  onSeeAllEvents,
  onOpenLink,
  onRequestDelete,
}) => {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { width: windowWidth } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  // Issue #1835 — signed-in operator, for the owner-only delete gate below.
  const { user: authUser } = useAuth();

  // ORCH-0816 — pull-to-refresh as a manual freshness signal alongside the
  // Realtime subscription on `orders` in useBrand. Invalidates the detail
  // cache for this brand AND every event-orders key (per-event tiles).
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const handleRefresh = useCallback(async (): Promise<void> => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: brand !== null ? brandKeys.detail(brand.id) : brandKeys.all,
        }),
        queryClient.invalidateQueries({ queryKey: eventOrdersKeys.all }),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient, brand]);

  // ORCH-1121 — Brand cover hero. 3-state fallback chain (PRESERVED from the
  // earlier ORCH-0807 implementation): (1) coverMediaUrl present + load
  // succeeds → EventCoverMedia (image / GIF / VIDEO, per-platform element +
  // motion-gated animation owned by ECM); (2) coverMediaUrl present + load
  // fails → hue gradient via the coverMediaFailed flip; (3) coverMediaUrl
  // null → hue gradient. The business hero intentionally diverges from the
  // buyer-facing PublicBrandPage (ORCH-1121, Seth-accepted).
  const coverMediaUrl =
    typeof brand?.coverMediaUrl === "string" ? brand.coverMediaUrl : null;
  const [coverMediaFailed, setCoverMediaFailed] = useState<boolean>(false);
  // Reset failure flag whenever the URL changes (brand switch, new upload).
  useEffect(() => {
    setCoverMediaFailed(false);
  }, [coverMediaUrl]);

  // ORCH-1121 — About-us read-more toggle (only shown when the bio is long
  // enough to clip; see the render branch). TOP-LEVEL hook (ORCH-0710
  // ordering): declared above the early returns.
  const [aboutExpanded, setAboutExpanded] = useState<boolean>(false);
  const toggleAboutExpanded = useCallback((): void => {
    if (!reduceMotion) {
      LayoutAnimation.configureNext(
        LayoutAnimation.Presets.easeInEaseOut,
      );
    }
    setAboutExpanded((prev) => !prev);
  }, [reduceMotion]);

  // ORCH-1121 — Recent Events live data. Brand-scoped query at TOP LEVEL
  // (ORCH-0710 hook ordering): passes `brand?.id ?? null` so the hook is
  // NEVER conditional — a null brand yields an empty, disabled query that
  // returns []. The hook returns PUBLISHED events (scheduled/live/ended/
  // cancelled, including past) and already excludes trips; drafts come from
  // a separate source and are intentionally NOT merged here.
  const {
    data: brandEvents = [],
    isLoading: eventsLoading,
    isError: eventsError,
    refetch: refetchEvents,
  } = useBusinessEventsForBrand(brand?.id ?? null);

  const recentEvents = useMemo<
    { event: LiveEvent; status: ReturnType<typeof deriveCardStatus> }[]
  >(() => {
    return brandEvents
      .map((e) => ({ event: e, status: deriveCardStatus(e) }))
      .sort((a, b) => {
        // Most-recent first by event date; null dates sort last.
        const ta =
          a.event.date !== null ? new Date(a.event.date).getTime() : null;
        const tb =
          b.event.date !== null ? new Date(b.event.date).getTime() : null;
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return tb - ta;
      })
      .slice(0, 5);
  }, [brandEvents]);
  const totalEventCount = brandEvents.length;

  const handleEdit = useCallback((): void => {
    if (brand !== null) {
      onEdit(brand.id);
    }
  }, [brand, onEdit]);

  // Cycle 7 FX1: routes to /b/{brand.slug} via parent route handler.
  // Retired Cycle-2 J-A7 TRANSITIONAL Toast (exit condition met by Cycle 7).
  const handleViewPublic = useCallback((): void => {
    if (brand !== null) onViewPublic(brand.slug);
  }, [brand, onViewPublic]);

  const handleStripeBanner = useCallback((): void => {
    if (brand !== null) {
      onStripe(brand.id);
    }
  }, [brand, onStripe]);

  const handleEmptyBio = useCallback((): void => {
    if (brand !== null) {
      onEdit(brand.id);
    }
  }, [brand, onEdit]);

  // Cycle 7 FX1: routes to /event/create via parent route handler.
  // Retired Cycle-2 J-A7 TRANSITIONAL Toast (exit condition met by Cycle 3).
  const handleCreateEvent = useCallback((): void => {
    onCreateEvent();
  }, [onCreateEvent]);

  // Cycle 7 FX1: opens external URL via parent route handler (Linking.openURL).
  // Retired Cycle-2 J-A7 TRANSITIONAL Toast.
  const handleOpenLink = useCallback(
    (url: string): void => {
      onOpenLink(url);
    },
    [onOpenLink],
  );

  // Hook-derived Operations rows. Each row's onPress is a live navigation
  // callback. Live wirings: J-A8 onEdit (sticky shelf — separate from this
  // list) · J-A9 onTeam (Team row) · J-A10 onPayments (Payments row) ·
  // J-A12 onReports (Finance reports row).
  // Cycle 13a (SPEC §4.14): Audit log row gated on brand_admin+ rank.
  // useCurrentBrandRole runs every render with the current brand id; null
  // brand short-circuits via the hook's `enabled` flag, never an early return
  // before this hook (preserves ORCH-0710 hook ordering).
  const { rank: currentRank } = useCurrentBrandRole(brand?.id ?? null);
  const canViewAuditLog = canPerformAction(currentRank, "VIEW_AUDIT_LOG");
  const canViewWebsite = isFeatureEnabled("sites") &&
    canPerformAction(currentRank, "WEBSITE_WORKSPACE");
  const [websiteContext, setWebsiteContext] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!canViewWebsite || brand === null || onWebsite === undefined) {
      setWebsiteContext(null);
      return () => {
        active = false;
      };
    }
    setWebsiteContext("Checking website status…");
    void import("../../sites/brandWebsiteEntry")
      .then(async ({ loadBrandWebsiteEntryContext }) => {
        const context = await loadBrandWebsiteEntryContext(brand.id);
        if (active) setWebsiteContext(context);
      })
      .catch(() => {
        if (active) setWebsiteContext("Status unavailable");
      });
    return () => {
      active = false;
    };
  }, [brand, canViewWebsite, onWebsite]);
  // META-ORCH-1076 — provider-neutral: a connected Paystack brand is payout-ready,
  // so the "Connect bank to sell tickets" banner + Operations sub treat it as
  // active even though its Stripe status is "not_connected".
  const stripeStatus = isBrandPayoutReady(brand)
    ? "active"
    : (effectiveStripeStatus ?? brand?.stripeStatus ?? "not_connected");

  // ORCH-1145 — venue listing moved to the Hub "Venue" tab; do NOT re-add a
  // brand-page row here (single doorway). The venue-visibility gate now lives
  // in `deriveHubVisibleTabs` (useHubTabs.ts), conditional on the same
  // hasPhysicalLocation || placePoolId predicate. The standalone
  // /brand/{id}/listing route is preserved as a thin redirect to the Hub tab.
  const operationsRows = useMemo<OperationsRow[]>(() => {
    const rows: OperationsRow[] = [];
    if (canViewWebsite && onWebsite !== undefined) {
      rows.push({
        icon: "globe",
        label: "Website",
        sub: websiteContext ?? "Open website workspace",
        onPress: () => {
          if (brand !== null) onWebsite(brand.id);
        },
      });
    }
    rows.push(
      {
        icon: "bank",
        label: "Payments & Bank",
        sub: getBrandProfileStripeOperationsSub(stripeStatus),
        onPress: () => {
          if (brand !== null) onPayments(brand.id);
        },
      },
      {
        // ORCH-1006 — Surface 2. Brand-level all-in pricing defaults.
        icon: "pound",
        label: "Pricing defaults",
        sub: "Who covers VAT and fees by default",
        onPress: () => {
          if (brand !== null) onPricingDefaults(brand.id);
        },
      },
      {
        icon: "users",
        label: "Team & permissions",
        // Cycle 13a: brand.members is dropped (DEC-092). Member count now lives
        // in brandTeamStore + useCurrentBrandRole synthesis; the row caption is
        // a static prompt rather than a live count to avoid an extra hook here.
        sub: "Invite team members and set roles",
        onPress: () => {
          if (brand !== null) onTeam(brand.id);
        },
      },
      {
        // ORCH-0815-A2-ui — DEC-149 dual-surface Marketing Hub. Renamed
        // from "Customers" → "Blasts" for consistency with the bottom-nav
        // "Blast" tab. Icon switched from `users` → `send` (paper-plane)
        // to match the bottom-nav icon and instantly signal what this
        // entry does (message buyers about your next event).
        icon: "send",
        label: "Blasts",
        sub: "Message your event buyers about what's next",
        onPress: () => {
          if (brand !== null) onBlasts(brand.id);
        },
      },
      {
        icon: "chart",
        label: "Finance reports",
        sub: "Stripe-ready CSVs",
        onPress: () => {
          if (brand !== null) onReports(brand.id);
        },
      },
    );
    if (canViewAuditLog) {
      rows.push({
        icon: "shield",
        label: "Audit log",
        sub: "Recent actions on this brand",
        onPress: () => {
          if (brand !== null) onAuditLog(brand.id);
        },
      });
    }
    return rows;
  }, [
    brand,
    onTeam,
    onBlasts,
    onPayments,
    onPricingDefaults,
    onReports,
    onAuditLog,
    canViewAuditLog,
    canViewWebsite,
    onWebsite,
    websiteContext,
    stripeStatus,
  ]);

  // ----- Loading state (ORCH-1100 Wave 3) -----
  // On a COLD direct load (refresh / bookmark) of /brand/{id} the session is
  // not yet warm and the brand query has not fetched, so `brand` is null for a
  // beat before the real row resolves. Render a spinner here instead of letting
  // the not-found branch below flash "Brand not found". Once the resolve settles
  // (auth ready + query fetched) a still-null brand falls through to not-found.
  // META-ORCH-1235 (§4.1) — bounded error + Retry. A hung brand read now
  // rejects (withTimeout → TimeoutError after retries) → `isError` true. Render
  // a recoverable error state with Retry (→ refetch) INSTEAD of an unbounded
  // spinner, and BEFORE the genuine not-found branch (a timeout is recoverable,
  // a not-found is not). The spinner branch below stays for the brief auth-warm
  // window but is now guaranteed to end (the underlying read settles ≤ 15s).
  if (brand === null && isError) {
    return (
      <View style={styles.host}>
        <View style={styles.barWrap}>
          <TopBar leftKind="back" title="Brand" onBack={onBack} rightSlot={<View />} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.notFoundTitle}>Couldn{"’"}t load this brand</Text>
            <Text style={styles.notFoundBody}>
              Check your connection and try again.
            </Text>
            <View style={styles.notFoundBtnRow}>
              <Button
                label="Retry"
                onPress={() => onRetry?.()}
                variant="primary"
                size="md"
                testID="brand-profile-retry"
              />
            </View>
          </GlassCard>
        </ScrollView>
      </View>
    );
  }

  if (brand === null && isResolving) {
    return (
      <View style={styles.host}>
        <View style={styles.barWrap}>
          <TopBar leftKind="back" title="Brand" onBack={onBack} rightSlot={<View />} />
        </View>
        <View style={styles.loadingHost}>
          <ActivityIndicator
            size="large"
            color={accent.warm}
            accessibilityLabel="Loading brand"
            testID="brand-profile-loading"
          />
        </View>
      </View>
    );
  }

  // ----- Not Found state -----
  if (brand === null) {
    return (
      <View style={styles.host}>
        <View style={styles.barWrap}>
          <TopBar leftKind="back" title="Brand" onBack={onBack} rightSlot={<View />} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.notFoundTitle}>Brand not found</Text>
            <Text style={styles.notFoundBody}>
              The brand you tried to open doesn{"’"}t exist or has been removed.
              Go back to your account to pick another.
            </Text>
            <View style={styles.notFoundBtnRow}>
              <Button
                label="Back to Account"
                onPress={onBack}
                variant="secondary"
                size="md"
                leadingIcon="arrowL"
              />
            </View>
          </GlassCard>
        </ScrollView>
      </View>
    );
  }

  // ----- Populated state -----
  const hasBio = typeof brand.bio === "string" && brand.bio.trim().length > 0;
  const bioText = typeof brand.bio === "string" ? brand.bio : "";

  // ORCH-1121 — full-bleed 16:9 cover (Direction 1). The hero card spans the
  // content column: window width minus the page's horizontal padding on each
  // side (scroll uses `paddingHorizontal: spacing.md`). Height clamps to
  // [176, 240] — floor so the avatar overlap never eats the whole cover,
  // ceiling for tall screens.
  const coverWidth = Math.max(0, windowWidth - spacing.md * 2);
  const COVER_H = Math.min(240, Math.max(176, Math.round((coverWidth * 9) / 16)));

  // ORCH-1121 — show the About read-more toggle only when the bio is long
  // enough to clip the 4-line collapsed paragraph (cheap length heuristic).
  const aboutIsLong = hasBio && bioText.length > 160;

  // ORCH-1121 — has the events query settled into a genuine zero-result?
  const eventsSettledEmpty =
    !eventsLoading && !eventsError && brandEvents.length === 0;

  return (
    <View style={styles.host}>
      <View style={styles.barWrap}>
        <TopBar
          leftKind="back"
          title={brand.displayName}
          onBack={onBack}
          rightSlot={<View />}
        />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: 96 + Math.max(insets.bottom, spacing.md) }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
        }
      >
        {/* SECTION A — Direction-1 full-bleed hero (ORCH-1121).
            16:9 cover (EventCoverMedia: image/GIF/video, motion-gated) with a
            required bottom scrim, a 96px page-color ring avatar half-overlapping
            the cover seam, centered name/tagline/location, an About-us block
            with read-more, then centered social chips. The business hero
            intentionally diverges from the buyer-facing PublicBrandPage
            (Seth-accepted). GlassCard padding={0} is load-bearing for the
            edge-to-edge cover. */}
        <GlassCard variant="elevated" padding={0}>
          <View
            style={[styles.heroCover, { height: COVER_H }]}
            pointerEvents="none"
          >
            {coverMediaUrl !== null &&
            coverMediaUrl.length > 0 &&
            !coverMediaFailed ? (
              <EventCoverMedia
                hue={brand.coverHue}
                mediaUrl={coverMediaUrl}
                mediaType={brand.coverMediaType ?? null}
                radius={0}
                width="100%"
                height={COVER_H}
                videoContentFit="cover"
                label=""
                autoplay={!reduceMotion}
                playbackActive={!reduceMotion}
                loop
                muted
                onMediaError={() => setCoverMediaFailed(true)}
              />
            ) : (
              <LinearGradient
                colors={[
                  `hsl(${brand.coverHue}, 60%, 48%)`,
                  `hsl(${brand.coverHue}, 55%, 38%)`,
                ]}
                style={styles.heroCoverFill}
              />
            )}
            {/* Scrim — legibility insurance on every media state. */}
            <LinearGradient
              colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.55)"]}
              style={styles.heroCoverScrim}
              pointerEvents="none"
            />
          </View>
          <View style={styles.heroBody}>
            <View style={styles.heroAvatarRing}>
              {/* ORCH-1121 — 84×84 shared Avatar centered inside a 96px disc in
                  the page color → reads as a 6px ring + crisp cutout over the
                  cover. No Avatar fork (it carries no border prop). */}
              <Avatar name={brand.displayName} size="hero" photo={brand.photo} />
            </View>

            <View style={styles.heroNameRow}>
              <Text style={styles.heroName} numberOfLines={2}>
                {brand.displayName}
              </Text>
            </View>

            {typeof brand.tagline === "string" && brand.tagline.length > 0 ? (
              <Text style={styles.heroTagline} numberOfLines={2}>
                {brand.tagline}
              </Text>
            ) : null}

            {typeof brand.address === "string" && brand.address.length > 0 ? (
              <View style={styles.heroLocationRow}>
                <Icon name="location" size={13} color={textTokens.tertiary} />
                <Text style={styles.heroLocation} numberOfLines={1}>
                  {brand.address}
                </Text>
              </View>
            ) : null}

            <View style={styles.heroDivider} />

            {hasBio ? (
              <>
                <Text style={styles.heroAboutEyebrow}>ABOUT US</Text>
                <Text
                  style={styles.heroAboutBody}
                  numberOfLines={aboutExpanded ? undefined : 4}
                >
                  {brand.bio}
                </Text>
                {aboutIsLong ? (
                  <Pressable
                    onPress={toggleAboutExpanded}
                    accessibilityRole="button"
                    accessibilityLabel={
                      aboutExpanded ? "Show less" : "Read more"
                    }
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.heroReadMore,
                      pressed && styles.heroReadMorePressed,
                    ]}
                  >
                    <Text style={styles.heroReadMoreText}>
                      {aboutExpanded ? "Show less" : "Read more"}
                    </Text>
                  </Pressable>
                ) : null}
              </>
            ) : (
              <Pressable
                onPress={handleEmptyBio}
                accessibilityRole="button"
                accessibilityLabel="Add a brand description"
                style={styles.emptyBioCta}
              >
                <Text style={styles.emptyBioText}>
                  Add a description so people know what you{"’"}re about
                </Text>
                <Icon name="chevR" size={16} color={accent.warm} />
              </Pressable>
            )}

          {(() => {
            // Build the icon-chip list — only render chips for non-empty fields.
            // Order: email → phone → website → instagram → tiktok → x →
            // facebook → youtube → linkedin → threads. Hide entire row when
            // every contact + social field is empty (clean look per spec).
            // Each chip carries its `url` (already-normalized full URL or
            // `mailto:`/`tel:` scheme). Tap → onOpenLink(url) → parent calls
            // Linking.openURL. Cycle 7 FX1 retired the Cycle-2 dead-Toast.
            const chips: { key: string; icon: IconName; aria: string; url: string }[] = [];
            if (typeof brand.contact?.email === "string" && brand.contact.email.length > 0) {
              chips.push({ key: "email", icon: "mail", aria: `Email ${brand.contact.email}`, url: `mailto:${brand.contact.email}` });
            }
            if (typeof brand.contact?.phone === "string" && brand.contact.phone.length > 0) {
              chips.push({ key: "phone", icon: "phone", aria: `Phone ${brand.contact.phone}`, url: `tel:${brand.contact.phone}` });
            }
            if (typeof brand.links?.website === "string" && brand.links.website.length > 0) {
              chips.push({ key: "website", icon: "globe", aria: `Website ${brand.links.website}`, url: normalizeSocialUrl(brand.links.website, "https://") });
            }
            if (typeof brand.links?.instagram === "string" && brand.links.instagram.length > 0) {
              chips.push({ key: "instagram", icon: "instagram", aria: `Instagram ${brand.links.instagram}`, url: normalizeSocialUrl(brand.links.instagram, "https://instagram.com/") });
            }
            if (typeof brand.links?.tiktok === "string" && brand.links.tiktok.length > 0) {
              chips.push({ key: "tiktok", icon: "tiktok", aria: `TikTok ${brand.links.tiktok}`, url: normalizeSocialUrl(brand.links.tiktok, "https://tiktok.com/@") });
            }
            if (typeof brand.links?.x === "string" && brand.links.x.length > 0) {
              chips.push({ key: "x", icon: "x", aria: `X ${brand.links.x}`, url: normalizeSocialUrl(brand.links.x, "https://x.com/") });
            }
            if (typeof brand.links?.facebook === "string" && brand.links.facebook.length > 0) {
              chips.push({ key: "facebook", icon: "facebook", aria: `Facebook ${brand.links.facebook}`, url: normalizeSocialUrl(brand.links.facebook, "https://facebook.com/") });
            }
            if (typeof brand.links?.youtube === "string" && brand.links.youtube.length > 0) {
              chips.push({ key: "youtube", icon: "youtube", aria: `YouTube ${brand.links.youtube}`, url: normalizeSocialUrl(brand.links.youtube, "https://youtube.com/@") });
            }
            if (typeof brand.links?.linkedin === "string" && brand.links.linkedin.length > 0) {
              chips.push({ key: "linkedin", icon: "linkedin", aria: `LinkedIn ${brand.links.linkedin}`, url: normalizeSocialUrl(brand.links.linkedin, "https://linkedin.com/company/") });
            }
            if (typeof brand.links?.threads === "string" && brand.links.threads.length > 0) {
              chips.push({ key: "threads", icon: "threads", aria: `Threads ${brand.links.threads}`, url: normalizeSocialUrl(brand.links.threads, "https://threads.net/@") });
            }
            if (chips.length === 0) return null;
            return (
              <View style={styles.socialsRow}>
                {chips.map((chip) => (
                  <Pressable
                    key={chip.key}
                    onPress={() => handleOpenLink(chip.url)}
                    accessibilityRole="button"
                    accessibilityLabel={chip.aria}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    style={({ pressed }) => [
                      styles.socialChip,
                      pressed && styles.socialChipPressed,
                    ]}
                  >
                    <Icon name={chip.icon} size={18} color={accent.warm} />
                  </Pressable>
                ))}
              </View>
            );
          })()}
          </View>
        </GlassCard>

        {/* SECTION B — Stats Strip */}
        <View style={styles.statsRow}>
          <KpiTile label="Events" value={brand.stats.events} sub="all time" style={styles.statCell} />
          <KpiTile label="Attendees" value={formatCount(brand.stats.attendees)} sub="all time" style={styles.statCell} />
          <KpiTile
            label="GMV"
            value={
              brand.defaultCurrency !== undefined
                ? formatCurrencyRound(brand.stats.rev, brand.defaultCurrency)
                : "—"
            }
            sub="all time"
            style={styles.statCell}
          />
        </View>

        {/* SECTION C — Status-driven Stripe banner. Suppressed entirely
            when effective stripeStatus === "active" (banner copy is null
            — populated KPIs + payments dashboard are the affirmative
            signal, not a green "you're good" banner). */}
        {(() => {
          const bannerCopy = getBrandProfileStripeBannerCopy(stripeStatus);
          if (bannerCopy === null) return null;
          const isRestricted = stripeStatus === "restricted";
          return (
            <Pressable
              onPress={handleStripeBanner}
              accessibilityRole="button"
              accessibilityLabel={bannerCopy.title}
            >
              <GlassCard
                variant="base"
                padding={spacing.md}
                style={isRestricted ? styles.bannerDestructive : undefined}
              >
                <View style={styles.bannerRow}>
                  <View
                    style={[
                      styles.bannerIconWrap,
                      isRestricted && styles.bannerIconWrapDestructive,
                    ]}
                  >
                    <Icon
                      name="bank"
                      size={20}
                      color={isRestricted ? semantic.error : accent.warm}
                    />
                  </View>
                  <View style={styles.bannerTextCol}>
                    <Text style={styles.bannerTitle}>{bannerCopy.title}</Text>
                    <Text style={styles.bannerSub}>{bannerCopy.sub}</Text>
                  </View>
                  <Icon name="chevR" size={16} color={textTokens.tertiary} />
                </View>
              </GlassCard>
            </Pressable>
          );
        })()}

        {/* SECTION D — Operations List */}
        <GlassCard variant="base" padding={0}>
          {operationsRows.map((row, index) => {
            const isLast = index === operationsRows.length - 1;
            return (
              <Pressable
                key={row.label}
                onPress={row.onPress}
                accessibilityRole="button"
                accessibilityLabel={row.label}
                style={[styles.opsRow, !isLast && styles.opsRowDivider]}
              >
                <View style={styles.opsIconWrap}>
                  <Icon name={row.icon} size={18} color={textTokens.primary} />
                </View>
                <View style={styles.opsTextCol}>
                  <Text style={styles.opsLabel}>{row.label}</Text>
                  <Text style={styles.opsSub}>{row.sub}</Text>
                </View>
                <Icon name="chevR" size={16} color={textTokens.tertiary} />
              </Pressable>
            );
          })}
        </GlassCard>

        {/* SECTION E — Recent Events (ORCH-1121).
            ORCH-1121 (Constitution #9 / I-PROPOSED-1121-RECENT-EVENTS-LIVE-QUERY):
            this empty card is gated on a SETTLED, non-error, zero-length live
            query. Never make it unconditional again — see
            BrandProfileView.orch_1121.test.tsx (T-1). */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Recent events</Text>
          {totalEventCount > 5 ? (
            <Pressable
              onPress={onSeeAllEvents}
              accessibilityRole="button"
              accessibilityLabel="See all events"
              hitSlop={8}
              style={({ pressed }) => [
                styles.seeAllRow,
                pressed && styles.seeAllRowPressed,
              ]}
            >
              <Text style={styles.seeAllText}>See all</Text>
              <Icon name="chevR" size={14} color={accent.warm} />
            </Pressable>
          ) : null}
        </View>

        {eventsError ? (
          <GlassCard variant="base" padding={spacing.lg}>
            <Text style={styles.emptyEventsTitle}>
              Couldn{"’"}t load your events.
            </Text>
            <Text style={styles.emptyEventsBody}>
              Something went wrong fetching your events.
            </Text>
            <View style={styles.emptyEventsBtnRow}>
              <Button
                label="Tap to retry"
                onPress={() => {
                  void refetchEvents();
                }}
                variant="secondary"
                size="md"
                leadingIcon="swap"
              />
            </View>
          </GlassCard>
        ) : recentEvents.length > 0 ? (
          <View style={styles.recentEventsList}>
            {recentEvents.map(({ event, status }) => (
              <OfferingListCard
                key={event.id}
                kind="event"
                model={liveEventToOfferingModel(event, status)}
                onOpen={() =>
                  onOpenEvent(event.id, event.event_type, event.status)
                }
                // onManageOpen OMITTED → hides the 3-dot manage trigger; the
                // brand profile is a glanceable summary (management is in the Hub).
              />
            ))}
          </View>
        ) : eventsSettledEmpty ? (
          <GlassCard variant="base" padding={spacing.lg}>
            <Text style={styles.emptyEventsTitle}>No events yet</Text>
            <Text style={styles.emptyEventsBody}>
              Events you create will show here.
            </Text>
            <View style={styles.emptyEventsBtnRow}>
              <Button
                label="Create your first event"
                onPress={handleCreateEvent}
                variant="primary"
                size="md"
                leadingIcon="plus"
              />
            </View>
          </GlassCard>
        ) : (
          // Loading (query fetching, no cached rows yet): render nothing until
          // the query settles. staleTime 30s makes cached loads instant, so the
          // false-empty flash is impossible — we never show the empty card mid-
          // load (the exact bug this ORCH kills).
          <View style={styles.recentEventsLoading} pointerEvents="none">
            <View style={styles.recentEventsSkeletonRow} />
            <View style={styles.recentEventsSkeletonRow} />
          </View>
        )}

        {/* Cycle 17e-A — Danger zone (delete brand).
            Issue #1835 — owner-only: hidden for admins, whose delete the
            `brands` RLS policy refuses. */}
        {onRequestDelete !== undefined &&
        brand !== null &&
        canDeleteBrand(brand, authUser?.id ?? null) ? (
          <View style={styles.dangerZone}>
            <Text style={styles.dangerLabel}>Danger zone</Text>
            <Text style={styles.dangerHelper}>
              Deleting hides this brand from your list. Recoverable for 30 days
              via support.
            </Text>
            <View style={styles.dangerCta}>
              <Button
                label="Delete brand"
                variant="ghost"
                size="md"
                leadingIcon="trash"
                onPress={() => onRequestDelete(brand)}
                accessibilityLabel="Delete this brand"
              />
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* SECTION F — Sticky Bottom Shelf */}
      <View
        style={[
          styles.shelfWrap,
          { paddingBottom: Math.max(insets.bottom, spacing.md) },
        ]}
        pointerEvents="box-none"
      >
        <View style={styles.shelfRow}>
          <View style={styles.shelfBtnFlex}>
            <Button
              label="Edit brand"
              onPress={handleEdit}
              variant="primary"
              size="md"
              leadingIcon="edit"
              fullWidth
            />
          </View>
          <View style={styles.shelfBtnFlex}>
            <Button
              label="View public page"
              onPress={handleViewPublic}
              variant="secondary"
              size="md"
              leadingIcon="eye"
              fullWidth
            />
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  barWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },

  // Loading state (ORCH-1100 Wave 3) -------------------------------------
  loadingHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xl * 2,
  },

  // Not Found state ------------------------------------------------------
  notFoundTitle: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  notFoundBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginBottom: spacing.md,
  },
  notFoundBtnRow: {
    flexDirection: "row",
    marginTop: spacing.sm,
  },

  // Hero (ORCH-1121 — Direction 1 full-bleed) ----------------------------
  // 16:9 cover region (height supplied inline via COVER_H), padded body
  // below, 96px ring avatar half-overlapping the cover seam (-48px).
  heroCover: {
    width: "100%",
    overflow: "hidden",
    borderTopLeftRadius: radiusTokens.xl,
    borderTopRightRadius: radiusTokens.xl,
    // No Android shadow/elevation on the cover (square-halo bug); the clip +
    // scrim are the legibility mechanism.
  },
  heroCoverFill: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  heroCoverScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "50%",
  },
  heroBody: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  heroAvatarRing: {
    width: 96,
    height: 96,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: canvas.profile, // page-color ring → crisp cutout over cover
    alignSelf: "center",
    marginTop: -48, // 50% of 96 overlaps the cover seam
    marginBottom: spacing.sm,
  },
  heroNameRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.xs,
  },
  heroName: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
    textAlign: "center",
  },
  heroTagline: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    textAlign: "center",
    marginTop: 2,
  },
  heroLocationRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  heroLocation: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    letterSpacing: typography.caption.letterSpacing,
    color: textTokens.tertiary,
    flexShrink: 1,
  },
  heroDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: glass.border.profileBase,
    marginTop: spacing.md,
  },
  heroAboutEyebrow: {
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    textTransform: "uppercase",
    color: textTokens.tertiary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  heroAboutBody: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    textAlign: "left",
  },
  heroReadMore: {
    marginTop: spacing.xs,
    alignSelf: "flex-start",
  },
  heroReadMorePressed: {
    opacity: 0.7,
  },
  heroReadMoreText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
    color: accent.warm,
  },
  emptyBioCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: accent.border,
    backgroundColor: accent.tint,
    borderStyle: "dashed",
  },
  emptyBioText: {
    flex: 1,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: accent.warm,
    fontWeight: "500",
  },

  // Socials row (J-A8 polish — replaces contactCol + linksRow) -----------
  // ORCH-1121 — centered to match Direction-1 identity column.
  socialsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
    justifyContent: "center",
  },
  socialChip: {
    width: 36,
    height: 36,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
    alignItems: "center",
    justifyContent: "center",
  },
  socialChipPressed: {
    opacity: 0.7,
  },

  // Stats Strip ----------------------------------------------------------
  statsRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  statCell: {
    flex: 1,
  },

  // Banner ---------------------------------------------------------------
  bannerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  bannerDestructive: {
    borderColor: "rgba(239, 68, 68, 0.45)",
    borderWidth: 1,
  },
  bannerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
    alignItems: "center",
    justifyContent: "center",
  },
  bannerIconWrapDestructive: {
    backgroundColor: semantic.errorTint,
    borderColor: "rgba(239, 68, 68, 0.45)",
  },
  bannerTextCol: {
    flex: 1,
    minWidth: 0,
  },
  bannerTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  bannerSub: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
    marginTop: 2,
  },

  // Operations -----------------------------------------------------------
  opsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  opsRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
  },
  opsIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  opsTextCol: {
    flex: 1,
    minWidth: 0,
  },
  opsLabel: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "500",
    color: textTokens.primary,
  },
  opsSub: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: 2,
  },

  // Section header -------------------------------------------------------
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.sm,
  },
  sectionTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    letterSpacing: typography.h3.letterSpacing,
    color: textTokens.primary,
  },

  // Events ---------------------------------------------------------------
  emptyEventsTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  emptyEventsBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginTop: 4,
  },
  emptyEventsBtnRow: {
    flexDirection: "row",
    marginTop: spacing.md,
  },

  // Recent events — populated list + "See all" + loading skeleton (ORCH-1121)
  recentEventsList: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  seeAllRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  seeAllRowPressed: {
    opacity: 0.7,
  },
  seeAllText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
    color: accent.warm,
  },
  recentEventsLoading: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  recentEventsSkeletonRow: {
    height: 92 + spacing.sm * 2,
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    // Opaque Android fill (ANDROID_GLASS_USES_OPAQUE_FALLBACK); translucent on
    // iOS. No Android shadow under the rounded fill.
    backgroundColor: Platform.select({
      ios: glass.tint.profileBase,
      android: "rgba(20, 22, 26, 0.92)",
      default: glass.tint.profileBase,
    }),
    overflow: "hidden",
  },

  // Sticky shelf ---------------------------------------------------------
  shelfWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: "rgba(12, 14, 18, 0.85)",
  },
  shelfRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  shelfBtnFlex: {
    flex: 1,
  },

  // Cycle 17e-A — danger zone for brand deletion
  dangerZone: {
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    borderTopColor: glass.border.profileBase,
    gap: spacing.sm,
    marginBottom: 100,
  },
  dangerLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: semantic.error,
  },
  dangerHelper: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.tertiary,
  },
  dangerCta: {
    marginTop: spacing.xs,
  },
});

export default BrandProfileView;
