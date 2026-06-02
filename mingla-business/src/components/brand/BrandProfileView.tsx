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

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Image as RNImage,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { brandKeys } from "../../hooks/useBrands";
import { eventOrdersKeys } from "../../hooks/useEventOrders";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { Brand, BrandStripeStatus } from "../../store/currentBrandStore";
import { formatCurrencyRound, formatCount } from "../../utils/currency";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { canPerformAction } from "../../utils/permissionGates";
import {
  getBrandProfileStripeBannerCopy,
  getBrandProfileStripeOperationsSub,
} from "../../utils/brandStripeUiState";

import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import { KpiTile } from "../ui/KpiTile";
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
   * ORCH-1040 — called when user taps the "Venue listing" Operations row.
   * Receives the brand id; parent routes to /brand/{id}/listing (the venue
   * listing management page: status, AI scores, changes-remaining, manage).
   */
  onListing: (brandId: string) => void;
  /**
   * Called when user taps the empty-events "Build a new event" CTA.
   * Routes to `/event/create` (the Cycle 3 wedge).
   * NEW in Cycle 7 FX1 — replaces Cycle-2 J-A7 TRANSITIONAL Toast that
   * was supposed to retire when Cycle 3 shipped (pre-existing miss).
   */
  onCreateEvent: () => void;
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
  effectiveStripeStatus,
  onBack,
  onEdit,
  onTeam,
  onStripe,
  onPayments,
  onPricingDefaults,
  onReports,
  onAuditLog,
  onBlasts,
  onViewPublic,
  onListing,
  onCreateEvent,
  onOpenLink,
  onRequestDelete,
}) => {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

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

  // ORCH-0807 Rev 3 — Brand cover band on the hero card. 3-state fallback
  // chain mirrors PublicBrandPage.tsx:259-304 verbatim: (1) coverMediaUrl
  // present + load succeeds → image element (expo-image on Android for
  // correct GIF animation; RN core <Image> on iOS+web per ORCH-0805-WEB
  // hotfix); (2) coverMediaUrl present + load fails → hue gradient via
  // onError flip; (3) coverMediaUrl null → hue gradient.
  const coverMediaUrl =
    typeof brand?.coverMediaUrl === "string" ? brand.coverMediaUrl : null;
  const [coverMediaFailed, setCoverMediaFailed] = useState<boolean>(false);
  // Reset failure flag whenever the URL changes (brand switch, new upload).
  useEffect(() => {
    setCoverMediaFailed(false);
  }, [coverMediaUrl]);

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
  const stripeStatus =
    effectiveStripeStatus ?? brand?.stripeStatus ?? "not_connected";

  const operationsRows = useMemo<OperationsRow[]>(() => {
    const rows: OperationsRow[] = [
      {
        // ORCH-1040 — venue listing management (status, AI scores, changes,
        // edit/resubmit). First row: it's the core of the brand's deck presence.
        icon: "list",
        label: "Venue listing",
        sub: "Status, your match scores, and manage",
        onPress: () => {
          if (brand !== null) onListing(brand.id);
        },
      },
      {
        icon: "bank",
        label: "Payments & Stripe",
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
    ];
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
    onListing,
    onTeam,
    onBlasts,
    onPayments,
    onPricingDefaults,
    onReports,
    onAuditLog,
    canViewAuditLog,
    stripeStatus,
  ]);

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
        {/* SECTION A — Hero card with cover band + half-overlap avatar.
            ORCH-0807 Rev 3 — mirrors the PublicBrandPage.tsx:259-346 pattern
            so the internal Brand Profile view shows the same hero treatment
            buyers see on the public page. Cover band fills the top of the
            card edge-to-edge (GlassCard padding=0); the round avatar sits
            on top with -42px margin-top so half-of-it overlaps the cover. */}
        <GlassCard variant="elevated" padding={0}>
          <View style={styles.heroCoverBand} pointerEvents="none">
            {coverMediaUrl !== null && coverMediaUrl.length > 0 && !coverMediaFailed ? (
              Platform.OS === "android" ? (
                <ExpoImage
                  source={{ uri: coverMediaUrl }}
                  style={styles.heroCoverFill}
                  contentFit="cover"
                  onError={() => setCoverMediaFailed(true)}
                  accessibilityLabel="Brand cover"
                />
              ) : (
                <RNImage
                  source={{ uri: coverMediaUrl }}
                  // ORCH-0805-WEB hotfix — explicit width/height "100%"
                  // because react-native-web's <img> doesn't honor
                  // position: absolute; inset: 0 the way RN native does.
                  style={[
                    styles.heroCoverFill,
                    { width: "100%", height: "100%" },
                  ]}
                  resizeMode="cover"
                  onError={() => setCoverMediaFailed(true)}
                  accessibilityLabel="Brand cover"
                />
              )
            ) : (
              <View
                style={[
                  styles.heroCoverFill,
                  { backgroundColor: `hsl(${brand.coverHue}, 60%, 45%)` },
                ]}
              />
            )}
          </View>
          <View style={styles.heroBody}>
            <View style={styles.heroAvatarRow}>
              {/* ORCH-0807 — wires profile_photo_url to the read-side Avatar.
                  The negative marginTop on heroAvatarRow pulls half the
                  84×84 avatar up over the cover band (mirrors
                  PublicBrandPage's half-in/half-out overlap). */}
              <Avatar name={brand.displayName} size="hero" photo={brand.photo} />
            </View>
            <Text style={styles.heroName}>{brand.displayName}</Text>
          {typeof brand.tagline === "string" && brand.tagline.length > 0 ? (
            <Text style={styles.heroTagline}>{brand.tagline}</Text>
          ) : null}

          {hasBio ? (
            <Text style={styles.heroBio}>{brand.bio}</Text>
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
                    style={styles.socialChip}
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
            value={formatCurrencyRound(brand.stats.rev, brand.defaultCurrency ?? "GBP")}
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

        {/* SECTION E — Recent Events */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Recent events</Text>
        </View>
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

        {/* Cycle 17e-A — Danger zone (delete brand) */}
        {onRequestDelete !== undefined && brand !== null ? (
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

  // Hero -----------------------------------------------------------------
  // ORCH-0807 Rev 3 — cover band on top of the hero card, padded content
  // body below, avatar pulled up -42px so half of its 84×84 frame overlaps
  // the cover band (matches PublicBrandPage half-in/half-out pattern).
  heroCoverBand: {
    height: 140,
    width: "100%",
    overflow: "hidden",
    borderTopLeftRadius: radiusTokens.lg,
    borderTopRightRadius: radiusTokens.lg,
  },
  heroCoverFill: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  heroBody: {
    padding: spacing.lg,
  },
  heroAvatarRow: {
    alignItems: "center",
    marginTop: -42, // half of Avatar hero size (84) → 50% overlap on cover band
    marginBottom: spacing.md,
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
    marginTop: 4,
  },
  heroBio: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    marginTop: spacing.md,
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
  socialsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
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
