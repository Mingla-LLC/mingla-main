/**
 * /venue/[venueId]/preview (#4490) — the Host's preview of a venue's public
 * page, for a venue guests cannot open yet (in review, say).
 *
 * It renders the SAME shared screen the buyer web and the Explorer render
 * (`@mingla/brand-rendering/PublicVenueScreen`), from the SAME read
 * (`biz_preview_venue_page`, which returns the public page's payload for a
 * brand member whatever the claim status). What differs is only what a preview
 * must differ in: a banner that says guests cannot book yet, and every booking
 * and ticket button disabled with that reason. Nothing here can book, buy or
 * message anyone, and nothing fires guest analytics.
 *
 * Signed-in Host route (not in the public allowlist): the server refuses a
 * non-member. States: loading, error with retry, nothing to preview, page.
 */
// orch-strict-grep-allow safearea-on-fullscreen-routes — the banner applies insets.top; the screen below gets top 0 so the cover never double-pads
import React, { Suspense, useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
// DEEP specifier, never the barrel (i-1047-biz-bundle-budget-deferral). Type
// only: the screen itself comes from the public venue page's chunk (below).
import type { PublicVenueScreenProps } from "@mingla/brand-rendering/PublicVenueScreen";
import type { PublicMenuGroup } from "@mingla/brand-rendering";
import type {
  MapsAppId,
  MapsOpenTarget,
} from "@mingla/offering-rendering/mapsDeepLink";

import { Button } from "../../../src/components/ui/Button";
import { Icon } from "../../../src/components/ui/Icon";
import { Toast } from "../../../src/components/ui/Toast";
import { PublicGlassProvider } from "../../../src/components/offering/PublicGlassProvider";
import { toVenueViewModel } from "../../../src/components/venue/toPublicVenueViewModel";
import { color, radius, space, type } from "../../../src/constants/designSystem";
import { brandPublicPath } from "../../../src/constants/publicUrls";
import { useVenuePreviewPage } from "../../../src/hooks/useVenuePreviewPage";
import { usePublicMenus } from "../../../src/hooks/useMenus";
import { useThemeFont } from "../../../src/theme/useThemeFont";
import { copyAddressText } from "../../../src/utils/copyAddressText";
import { openMapsTarget } from "../../../src/utils/openMapsTarget";

/**
 * #4490 — the SAME shared screen the buyer web renders, taken from the public
 * venue route's own chunk (`app/b/[brandSlug]/v/[venueSlug].tsx` re-exports
 * it). Importing it here as well put the whole public venue page in two lazy
 * chunks, which web export hoists into the eager `__common` chunk every
 * visitor downloads. A Host opening a preview loads the guest page's chunk;
 * a guest never loads this route.
 */
const PublicVenueScreen = React.lazy(async (): Promise<{ default: React.ComponentType<PublicVenueScreenProps> }> => ({
  default: (await import("../../b/[brandSlug]/v/[venueSlug]")).PublicVenueScreen,
}));

/** The one reason every disabled button gives. */
export const VENUE_PREVIEW_NOTE = "Preview: guests can't book yet";

const EMPTY_MENU: PublicMenuGroup[] = [];

function paramValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function PreviewBanner({
  onBack,
  topInset,
}: {
  onBack: () => void;
  topInset: number;
}): React.ReactElement {
  return (
    <View style={[styles.bannerWrap, { paddingTop: topInset + space[2] }]}>
      <View style={styles.banner} testID="venue-preview-banner">
        <View style={styles.bannerText} accessibilityRole="header">
          <Text style={styles.bannerTitle}>{VENUE_PREVIEW_NOTE}</Text>
          <Text style={styles.bannerBody} numberOfLines={2}>
            This is the page guests will see once your venue is live.
          </Text>
        </View>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back to your venue"
          testID="venue-preview-back"
          style={({ pressed }) => [styles.back, pressed ? styles.pressed : null]}
        >
          <Icon name="chevL" size={16} color={color.text1} />
          <Text style={styles.backLabel}>Back to venue</Text>
        </Pressable>
      </View>
    </View>
  );
}

function StateView({
  title,
  body,
  children,
  testID,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
  testID: string;
}): React.ReactElement {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.stateWrap}
      keyboardShouldPersistTaps="handled"
      testID={testID}
    >
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateBody}>{body}</Text>
      {children}
    </ScrollView>
  );
}

export default function VenuePreviewRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ venueId?: string | string[] }>();
  const venueId = paramValue(params.venueId);
  const query = useVenuePreviewPage(venueId);
  const preview = query.data ?? null;
  const [toast, setToast] = useState<string | null>(null);

  const goBack = useCallback((): void => {
    if (venueId === null) {
      router.replace("/" as never);
      return;
    }
    // Always the venue's own page: a preview opened from a link has no history.
    router.replace(`/venue/${venueId}` as never);
  }, [router, venueId]);

  const venue = preview?.venue ?? null;
  const viewModel = useMemo(
    () => (venue === null ? null : toVenueViewModel(venue)),
    [venue],
  );
  // The public menu read is verified-only, so an in-review venue's menu cannot
  // be read here; the page then has no Menu tab rather than a broken one.
  const menusQuery = usePublicMenus(
    venue !== null ? venue.brandSlug : null,
    venue !== null ? venue.slug : null,
  );
  const menuGroups = menusQuery.data ?? EMPTY_MENU;

  const handleOpenMaps = useCallback(
    (target: MapsOpenTarget, app?: MapsAppId): void => {
      openMapsTarget(target, { app });
    },
    [],
  );
  const handleCopyAddress = useCallback(
    (text: string): Promise<void> => copyAddressText(text),
    [],
  );
  const handleOpenBrand = useCallback((): void => {
    if (venue === null) return;
    router.push(brandPublicPath(venue.brandSlug) as never);
  }, [router, venue]);
  const handleShare = useCallback((): void => {
    setToast("Sharing opens once your venue is live.");
  }, []);

  if (venueId === null || query.isLoading) {
    return (
      <View style={styles.root}>
        <PreviewBanner onBack={goBack} topInset={insets.top} />
        <ScrollView
          style={styles.screen}
          contentContainerStyle={styles.stateWrap}
          testID="venue-preview-loading"
        >
          <ActivityIndicator />
          <Text style={styles.stateBody}>Building your preview…</Text>
        </ScrollView>
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={styles.root}>
        <PreviewBanner onBack={goBack} topInset={insets.top} />
        <StateView
          testID="venue-preview-error"
          title="The preview could not load"
          body="Check your connection and try again."
        >
          <View style={styles.stateAction}>
            <Button
              label="Try again"
              variant="primary"
              onPress={() => {
                void query.refetch();
              }}
              testID="venue-preview-retry"
            />
          </View>
        </StateView>
      </View>
    );
  }

  if (preview === null || viewModel === null) {
    return (
      <View style={styles.root}>
        <PreviewBanner onBack={goBack} topInset={insets.top} />
        <StateView
          testID="venue-preview-empty"
          title="There is nothing to preview yet"
          body="Add your venue's details and what it offers, then come back."
        >
          <View style={styles.stateAction}>
            <Button
              label="Back to venue"
              variant="secondary"
              onPress={goBack}
              testID="venue-preview-empty-back"
            />
          </View>
        </StateView>
      </View>
    );
  }

  return (
    <PublicGlassProvider>
      <View style={styles.root} testID="venue-preview">
        <PreviewBanner onBack={goBack} topInset={insets.top} />
        <View style={styles.screen}>
          <Suspense
            fallback={
              <View style={styles.stateWrap} testID="venue-preview-screen-loading">
                <ActivityIndicator />
              </View>
            }
          >
          <PublicVenueScreen
            venue={viewModel}
            discoveryPrice={null}
            menu={menuGroups}
            menuLifecycle={{
              state: menusQuery.isError ? "error" : "ready",
              isFetching: menusQuery.isFetching,
              onRetry: () => menusQuery.refetch(),
            }}
            reservable={null}
            reservabilityState="ready"
            stayState="unavailable"
            stayDetail={null}
            safeAreaInsets={{ top: 0, bottom: insets.bottom }}
            loadThemeFont={useThemeFont}
            features={preview.features}
            preview={{ note: VENUE_PREVIEW_NOTE }}
            // Nothing is bought or booked from a preview, so the booking and
            // reservation slots render nothing and no guest analytics fire.
            bookingBody={() => null}
            reservationSheet={() => null}
            onAnalytics={() => undefined}
            onShare={handleShare}
            onClose={goBack}
            onOpenBrand={handleOpenBrand}
            onOpenMaps={handleOpenMaps}
            onCopyAddress={handleCopyAddress}
            overlays={
              <Toast
                visible={toast !== null}
                kind="info"
                message={toast ?? ""}
                onDismiss={() => setToast(null)}
              />
            }
          />
          </Suspense>
        </View>
      </View>
    </PublicGlassProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.canvas,
    ...(Platform.OS === "web" ? { minHeight: 0 } : null),
  },
  // The shared page pins its header and ambient layers with `position: fixed`.
  // Inside the Host's own shell that would paint over the Host top bar, so on
  // web the screen is made the containing block for them (a transform does
  // that) and clips to its own box: the page then lives wholly below the banner.
  screen: {
    flex: 1,
    minHeight: 0,
    ...(Platform.OS === "web"
      ? ({ transform: "translateZ(0)", overflow: "hidden" } as object)
      : null),
  },
  bannerWrap: {
    paddingHorizontal: space[4],
    paddingBottom: space[2],
    backgroundColor: color.canvas,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    minHeight: 56,
    paddingLeft: space[4],
    paddingRight: space[2],
    paddingVertical: space[2],
    borderRadius: radius.full,
    backgroundColor: color.fill.tile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  bannerText: { flex: 1, minWidth: 0 },
  bannerTitle: { ...type.caption, color: color.text1, fontWeight: "700" },
  bannerBody: { ...type.caption, color: color.text3 },
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    minHeight: 44,
    paddingHorizontal: space[3],
    borderRadius: radius.full,
  },
  backLabel: { ...type.caption, color: color.text1, fontWeight: "700" },
  pressed: { opacity: 0.85 },
  stateWrap: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    padding: space[6],
  },
  stateTitle: { ...type.title, color: color.text1, textAlign: "center" },
  stateBody: { ...type.body, color: color.text2, textAlign: "center" },
  stateAction: { marginTop: space[3] },
});
