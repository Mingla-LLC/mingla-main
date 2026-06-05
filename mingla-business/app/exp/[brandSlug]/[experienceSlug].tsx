/**
 * /exp/[brandSlug]/[experienceSlug] — public buyer-anon experience detail.
 * META-ORCH-1059 Sub-C. Mirrors /t/[brandSlug]/[tripSlug] exactly:
 * full-bleed cover hero, X-close + share IconChrome overlays, a ScrollView of
 * ExperiencePreview + ExperienceCheckoutFlow.
 *
 * Anon-tolerant per feedback_anon_buyer_routes.md: no useAuth, no sign-in
 * redirect — anyone with the share link sees the page. Lives OUTSIDE
 * app/(tabs)/ (same as /t/, /e/, /b/, /checkout-trip/).
 *
 * ExperienceMiniCard already pushes /exp/{brandSlug}/{experienceSlug}; this
 * route resolves it.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — design-intent full-bleed cover on the public experience share-link page (mirrors /t/{brandSlug}/{tripSlug}); the buyer-facing banner aesthetic is intentional. ExperiencePreview renders the cover full-bleed to the screen edge by design; the X-close + share overlays absolute-position over the cover but do not introduce SafeScreen wrapping. Per META-ORCH-1059 Sub-C (mirror of ORCH-0859/0874 trip public page).

import React, { useCallback } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { IconChrome } from "../../../src/components/ui/IconChrome";
import { usePublicExperienceBySlug } from "../../../src/hooks/usePublicExperience";
import { ExperiencePreview } from "../../../src/components/experience/ExperiencePreview";
import { ExperienceCheckoutFlow } from "../../../src/components/experience/ExperienceCheckoutFlow";

function allDatesPast(isos: string[], nowMs: number = Date.now()): boolean {
  const valid = isos
    .map((iso) => new Date(iso).getTime())
    .filter((ms) => Number.isFinite(ms));
  if (valid.length === 0) return false;
  return valid.every((ms) => ms < nowMs);
}

export default function PublicExperienceRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    brandSlug: string | string[];
    experienceSlug: string | string[];
  }>();
  const brandSlug = Array.isArray(params.brandSlug)
    ? params.brandSlug[0]
    : params.brandSlug;
  const experienceSlug = Array.isArray(params.experienceSlug)
    ? params.experienceSlug[0]
    : params.experienceSlug;

  const query = usePublicExperienceBySlug(
    typeof brandSlug === "string" ? brandSlug : null,
    typeof experienceSlug === "string" ? experienceSlug : null,
  );

  const handleClose = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (typeof brandSlug === "string" && brandSlug.length > 0) {
      router.replace(`/b/${brandSlug}` as never);
    } else {
      router.replace("/" as never);
    }
  }, [router, brandSlug]);

  const handleShare = useCallback(async (): Promise<void> => {
    if (typeof brandSlug !== "string" || typeof experienceSlug !== "string") {
      return;
    }
    const url = `https://business.usemingla.com/exp/${brandSlug}/${experienceSlug}`;
    const title = query.data?.experience.title ?? "Mingla experience";
    try {
      await Share.share(
        Platform.OS === "ios"
          ? { url, message: title }
          : { message: `${title} ${url}`, title },
      );
    } catch {
      // User-cancelled native Share is non-actionable; Constitution #3 exempts.
    }
  }, [brandSlug, experienceSlug, query.data?.experience.title]);

  if (query.isLoading || query.isFetching) {
    return (
      <View style={styles.stateHost}>
        <ActivityIndicator />
        <Text style={styles.stateText}>Loading experience…</Text>
      </View>
    );
  }

  if (query.isError) {
    // Supabase errors are { code, message, … } objects, not JS Errors.
    const rawError: unknown = query.error;
    const errorMessage =
      rawError !== null &&
      typeof rawError === "object" &&
      "message" in rawError &&
      typeof (rawError as { message: unknown }).message === "string"
        ? (rawError as { message: string }).message
        : "Check your connection and try again.";
    return (
      <View style={styles.stateHost}>
        <Text style={styles.stateTitle}>Couldn&rsquo;t load experience</Text>
        <Text style={styles.stateText}>{errorMessage}</Text>
      </View>
    );
  }

  const payload = query.data;
  if (payload === null || payload === undefined) {
    // Not found, OR not live yet (draft never resolves via anon RLS).
    return (
      <View style={styles.stateHost}>
        <Text style={styles.stateTitle}>Experience not found</Text>
        <Text style={styles.stateText}>
          This experience may not be live yet, or the link is wrong.
        </Text>
      </View>
    );
  }

  const experience = payload.experience;
  const dateIsos = experience.dates.map((d) => d.startAt);
  const isEnded = allDatesPast(dateIsos);
  const ticket = experience.ticket;
  const isSoldOut =
    ticket !== null &&
    !ticket.isUnlimited &&
    ticket.quantityTotal !== null &&
    ticket.ticketsRemaining !== null &&
    ticket.ticketsRemaining <= 0;

  return (
    <View style={styles.host}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <ExperiencePreview
          experience={experience}
          brand={payload.brand}
        />

        {isEnded ? (
          <View style={styles.bannerWrap}>
            <GlassCard variant="elevated" padding={spacing.md} radius="lg">
              <Text style={styles.bannerTitle}>This experience has ended</Text>
              <Text style={styles.bannerBody}>
                Every date for this experience is in the past. Check the
                organizer&rsquo;s page for what&rsquo;s next.
              </Text>
            </GlassCard>
          </View>
        ) : isSoldOut ? (
          <View style={styles.bannerWrap}>
            <GlassCard variant="elevated" padding={spacing.md} radius="lg">
              <Text style={styles.bannerTitle}>Sold out</Text>
              <Text style={styles.bannerBody}>
                Every spot on this experience is taken.
              </Text>
            </GlassCard>
          </View>
        ) : !experience.bookable ? (
          // ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED — graceful
          // unavailable for a PAID experience whose brand can't charge yet.
          // Details still render read-only above; only the checkout flow is
          // replaced (no 404, no checkout 409 toast). Reuses the sold-out
          // visual language.
          <View style={styles.bannerWrap}>
            <GlassCard variant="elevated" padding={spacing.md} radius="lg">
              <Text style={styles.bannerTitle}>Booking unavailable right now</Text>
              <Text style={styles.bannerBody}>
                This organizer is finishing their payment setup. Check back soon —
                or explore their other offerings.
              </Text>
            </GlassCard>
          </View>
        ) : (
          <ExperienceCheckoutFlow
            experience={experience}
            brand={payload.brand}
          />
        )}
      </ScrollView>

      {/* X-close + share IconChrome overlays on the cover hero. */}
      <View
        style={[styles.closeOverlay, { top: insets.top + spacing.sm }]}
        pointerEvents="box-none"
      >
        <IconChrome
          icon="close"
          size={36}
          onPress={handleClose}
          accessibilityLabel="Close"
        />
      </View>
      <View
        style={[styles.shareOverlay, { top: insets.top + spacing.sm }]}
        pointerEvents="box-none"
      >
        <IconChrome
          icon="share"
          size={36}
          onPress={() => {
            void handleShare();
          }}
          accessibilityLabel="Share"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: "#0c0e12",
    position: "relative",
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  closeOverlay: {
    position: "absolute",
    left: spacing.sm,
    zIndex: 50,
  },
  shareOverlay: {
    position: "absolute",
    right: spacing.sm,
    zIndex: 50,
  },
  bannerWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: semantic.error,
  },
  bannerBody: {
    fontSize: 13,
    color: textTokens.secondary,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  stateHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: "#0c0e12",
  },
  stateTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
    textAlign: "center",
  },
  stateText: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    textAlign: "center",
  },
});
