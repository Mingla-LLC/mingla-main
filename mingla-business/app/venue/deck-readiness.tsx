/**
 * META-ORCH-1009 Sub-E — durable deck-readiness resume route.
 */

import React, { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  canvas,
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";
import { useAuth } from "../../src/context/AuthContext";
import { useBrand } from "../../src/hooks/useBrands";
import { useBrandPlaceAuthoringContext } from "../../src/hooks/useBrandPlacePipelineState";
import {
  VenueDeckReadinessSetup,
} from "../../src/components/venue/VenueCreatorWizard";
import { IconChrome } from "../../src/components/ui/IconChrome";
import type { CoverPatch } from "../../src/components/ui/CoverPicker";
import type { DeckReadinessFocus } from "../../src/utils/deckReadinessRoutes";

const FOCUS_VALUES = new Set<DeckReadinessFocus>([
  "basics",
  "website",
  "hours",
  "cover",
  "confirm",
  "review",
]);
const EMPTY_FACETS: Record<string, boolean | null> = {};

function paramValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizeFocus(value: string | null): DeckReadinessFocus {
  return value !== null && FOCUS_VALUES.has(value as DeckReadinessFocus)
    ? (value as DeckReadinessFocus)
    : "review";
}

export default function VenueDeckReadinessRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, isAuthReady } = useAuth();
  const params = useLocalSearchParams<{
    brand_id?: string | string[];
    place_pool_id?: string | string[];
    focus?: string | string[];
  }>();
  const brandId = paramValue(params.brand_id);
  const requestedPlacePoolId = paramValue(params.place_pool_id);
  const focus = normalizeFocus(paramValue(params.focus));
  const brandQuery = useBrand(brandId);
  const brand = brandQuery.data ?? null;
  const placePoolId = requestedPlacePoolId ?? brand?.placePoolId ?? null;
  const contextQuery = useBrandPlaceAuthoringContext(brandId, placePoolId);

  const cover = useMemo<CoverPatch | null>(() => {
    const context = contextQuery.data;
    if (context === undefined) return null;
    return {
      coverMediaUrl: context.cover_media_url,
      coverMediaType: context.cover_media_type,
      coverMediaProvider: null,
      coverMediaSourceUrl: null,
      coverMediaCredit: null,
      coverMediaCreditUrl: null,
      coverMediaAlt: null,
    };
  }, [contextQuery.data]);

  if (!isAuthReady || user === null) {
    return <View style={[styles.root, { paddingTop: insets.top }]} />;
  }

  const loading =
    brandQuery.isLoading ||
    (placePoolId !== null && contextQuery.isLoading);

  if (loading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.helper}>Loading deck readiness...</Text>
        </View>
      </View>
    );
  }

  if (brand === null || placePoolId === null || contextQuery.data === undefined) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.chrome}>
          <IconChrome
            icon="chevL"
            accessibilityLabel="Back"
            onPress={() => router.back()}
          />
          <Text style={styles.chromeTitle}>Deck readiness</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.center}>
          <Text style={styles.title}>Venue setup not found</Text>
          <Text style={styles.helper}>
            Create or link a venue before reviewing deck readiness.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.chrome}>
        <IconChrome
          icon="chevL"
          accessibilityLabel="Back"
          onPress={() => router.back()}
        />
        <Text style={styles.chromeTitle}>Deck readiness</Text>
        <View style={{ width: 36 }} />
      </View>
      <VenueDeckReadinessSetup
        accountId={user.id}
        brand={brand}
        placePoolId={placePoolId}
        focus={focus}
        initialTier2={contextQuery.data.tier2}
        initialPendingBio={
          contextQuery.data.pending_ai_outputs?.generated_bio ?? null
        }
        initialFacets={contextQuery.data.pending_ai_outputs?.facets ?? EMPTY_FACETS}
        initialCoaching={contextQuery.data.coaching}
        initialCover={cover}
        onDone={() => router.replace("/(tabs)/hub/events" as never)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  chrome: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chromeTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  title: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
    textAlign: "center",
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    textAlign: "center",
  },
});
