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

import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
import { formatGbpRound, formatCount } from "../../utils/currency";

import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { EventCover } from "../ui/EventCover";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import { KpiTile } from "../ui/KpiTile";
import { Pill } from "../ui/Pill";
import { Toast } from "../ui/Toast";
import { TopBar } from "../ui/TopBar";

interface ToastState {
  visible: boolean;
  message: string;
}

interface StubPastEventRow {
  id: string;
  title: string;
  when: string;
  hue: number;
  sold: string;
}

// [TRANSITIONAL] stub past-events list — replaced by real event fetch in
// Cycle 3 when event endpoints land. Keyed by brand.id so each brand shows
// distinct copy. Empty arrays render the empty-events GlassCard.
const STUB_PAST_EVENTS: Record<string, StubPastEventRow[]> = {
  lm: [
    { id: "lm-p1", title: "Slow Burn vol. 3", when: "Sat · 21:00", hue: 25, sold: "228 / 240" },
    { id: "lm-p2", title: "Slow Burn vol. 2", when: "Sat · 21:00", hue: 35, sold: "238 / 240" },
    { id: "lm-p3", title: "Slow Burn vol. 1", when: "Sat · 20:00", hue: 45, sold: "262 / 280" },
  ],
  tll: [
    { id: "tll-p1", title: "Long Lunch — Aug edition", when: "Sun · 13:00", hue: 150, sold: "12 / 12" },
  ],
  sl: [
    { id: "sl-p1", title: "Sunday Languor — June", when: "Sun · 11:30", hue: 195, sold: "62 / 80" },
    { id: "sl-p2", title: "Sunday Languor — May", when: "Sun · 11:30", hue: 200, sold: "78 / 80" },
    { id: "sl-p3", title: "Sunday Languor — April", when: "Sun · 11:30", hue: 205, sold: "74 / 80" },
  ],
  hr: [
    { id: "hr-p1", title: "Hidden Rooms — Laundrette", when: "Fri · 20:00", hue: 340, sold: "48 / 50" },
    { id: "hr-p2", title: "Hidden Rooms — Studio", when: "Sat · 21:00", hue: 350, sold: "44 / 50" },
  ],
};

interface OperationsRow {
  icon: IconName;
  label: string;
  sub: string;
  /** Tap handler — navigation when the journey is live, fireToast when not. */
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
 * Tax & VAT row (Operations row #3) stays TRANSITIONAL Toast until §5.3.6
 * settings cycle — no `onTax` prop yet.
 */
export interface BrandProfileViewProps {
  brand: Brand | null;
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
  /**
   * Called when user taps the "Finance reports" Operations row.
   * Receives the brand id. NEW in J-A12 — final navigation prop in
   * the Cycle-2 chain.
   */
  onReports: (brandId: string) => void;
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
   * Called when user taps a social chip on the brand profile. Receives
   * the normalized full URL. Caller wires to `Linking.openURL`.
   * NEW in Cycle 7 FX1 — replaces Cycle-2 J-A7 TRANSITIONAL Toast.
   * Mirrors the new ShareModal social-link pattern from Cycle 7.
   */
  onOpenLink: (url: string) => void;
}

// Status-driven J-A7 banner copy. When entry is `null`, banner is
// SUPPRESSED (active state — populated KPIs on the dashboard are the
// affirmative signal, not a "you're good" green banner).
const J_A7_BANNER_COPY: Record<
  BrandStripeStatus,
  { title: string; sub: string } | null
> = {
  not_connected: {
    title: "Connect Stripe to sell tickets",
    sub: "Get paid for your events. Setup takes 5 minutes.",
  },
  onboarding: {
    title: "Onboarding submitted — verifying",
    sub: "We'll email you when Stripe finishes verifying your details.",
  },
  active: null,
  restricted: {
    title: "Action required",
    sub: "Stripe has limited your account. Tap to resolve.",
  },
};

// Operations row #1 dynamic sub-text per stripe status.
const OPERATIONS_SUB_TEXT: Record<BrandStripeStatus, string> = {
  not_connected: "Not connected",
  onboarding: "Onboarding…",
  active: "Active",
  restricted: "Action required",
};

export const BrandProfileView: React.FC<BrandProfileViewProps> = ({
  brand,
  onBack,
  onEdit,
  onTeam,
  onStripe,
  onPayments,
  onReports,
  onViewPublic,
  onCreateEvent,
  onOpenLink,
}) => {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastState>({ visible: false, message: "" });

  const fireToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const handleDismissToast = useCallback((): void => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

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

  // [TRANSITIONAL] Empty-bio CTA — exit when J-A8 lands.
  const handleEmptyBio = useCallback((): void => {
    fireToast("Editing lands in J-A8.");
  }, [fireToast]);

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

  const pastEvents = useMemo<StubPastEventRow[]>(() => {
    if (brand === null) return [];
    return STUB_PAST_EVENTS[brand.id] ?? [];
  }, [brand]);

  // Hook-derived Operations rows. Per-row onPress closes over either
  // fireToast (still-TRANSITIONAL rows) or the live navigation callback.
  // Live wirings: J-A8 onEdit (sticky shelf — separate from this list) ·
  // J-A9 onTeam (Team row) · J-A10 onPayments (Payments row).
  // [TRANSITIONAL] remaining inert rows — exit when J-A12 (Finance reports)
  // lands. Tax & VAT row stays TRANSITIONAL until §5.3.6 settings cycle.
  const operationsRows = useMemo<OperationsRow[]>(() => {
    const memberCount = (brand?.members ?? []).length;
    const stripeStatus = brand?.stripeStatus ?? "not_connected";
    return [
      {
        icon: "bank",
        label: "Payments & Stripe",
        sub: OPERATIONS_SUB_TEXT[stripeStatus],
        onPress: () => {
          if (brand !== null) onPayments(brand.id);
        },
      },
      {
        icon: "users",
        label: "Team & permissions",
        sub: `${memberCount} ${memberCount === 1 ? "member" : "members"}`,
        onPress: () => {
          if (brand !== null) onTeam(brand.id);
        },
      },
      {
        icon: "receipt",
        label: "Tax & VAT",
        sub: "Not configured",
        onPress: () => fireToast("Tax settings land in a later cycle."),
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
  }, [brand, fireToast, onTeam, onPayments, onReports]);

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
      >
        {/* SECTION A — Hero */}
        <GlassCard variant="elevated" padding={spacing.lg}>
          <View style={styles.heroAvatarRow}>
            <Avatar name={brand.displayName} size="hero" />
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
            const chips: Array<{ key: string; icon: IconName; aria: string; url: string }> = [];
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
        </GlassCard>

        {/* SECTION B — Stats Strip */}
        <View style={styles.statsRow}>
          <KpiTile label="Events" value={brand.stats.events} sub="all time" style={styles.statCell} />
          <KpiTile label="Attendees" value={formatCount(brand.stats.attendees)} sub="all time" style={styles.statCell} />
          <KpiTile label="GMV" value={formatGbpRound(brand.stats.rev)} sub="all time" style={styles.statCell} />
        </View>

        {/* SECTION C — Status-driven Stripe banner. Suppressed entirely
            when stripeStatus === "active" (J_A7_BANNER_COPY entry is null
            — populated KPIs + payments dashboard are the affirmative
            signal, not a green "you're good" banner). */}
        {(() => {
          const stripeStatus = brand.stripeStatus ?? "not_connected";
          const bannerCopy = J_A7_BANNER_COPY[stripeStatus];
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
        {pastEvents.length === 0 ? (
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
          <View style={styles.eventsCol}>
            {/* [TRANSITIONAL] stub past-event rows — replaced by real fetch in Cycle 3. */}
            {pastEvents.map((row) => (
              <View key={row.id} style={styles.eventRow}>
                <View style={styles.eventCoverWrap}>
                  <EventCover hue={row.hue} radius={12} label="" height={56} width={56} />
                </View>
                <View style={styles.eventTextCol}>
                  <View style={styles.eventPillRow}>
                    <Pill variant="draft">Past</Pill>
                  </View>
                  <Text style={styles.eventTitle} numberOfLines={1}>{row.title}</Text>
                  <Text style={styles.eventWhen} numberOfLines={1}>{row.when}</Text>
                </View>
                <View style={styles.eventSoldCol}>
                  <Text style={styles.eventSoldValue}>{row.sold}</Text>
                  <Text style={styles.eventSoldLabel}>sold</Text>
                </View>
              </View>
            ))}
          </View>
        )}
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

      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={handleDismissToast}
        />
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
  heroAvatarRow: {
    alignItems: "center",
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
  eventsCol: {
    gap: spacing.sm,
  },
  eventRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radiusTokens.lg,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  eventCoverWrap: {
    width: 56,
    height: 56,
    flexShrink: 0,
  },
  eventTextCol: {
    flex: 1,
    minWidth: 0,
  },
  eventPillRow: {
    flexDirection: "row",
    marginBottom: 2,
  },
  eventTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: 2,
  },
  eventWhen: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
  },
  eventSoldCol: {
    alignItems: "flex-end",
    paddingRight: 2,
  },
  eventSoldValue: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  eventSoldLabel: {
    fontSize: 10,
    color: textTokens.tertiary,
  },

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

  // Toast ----------------------------------------------------------------
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 96,
    paddingHorizontal: spacing.md,
  },
});

export default BrandProfileView;
