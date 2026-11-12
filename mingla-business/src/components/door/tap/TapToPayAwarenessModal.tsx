/**
 * #4271 — Apple's full-screen awareness splash (3.1 to 3.3, 6.2). A sibling of the
 * root Stack. Once per user and device, iPhone only, owner or admin only. It is
 * Apple's Hero banner from the Tap to Pay on iPhone Marketing Toolkit, drawn
 * whole and untouched (tapToPayMarketing.ts), with native "Get started", "Not
 * now" and a "Terms apply." target laid over the free areas of Apple's template.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { radius as radiusTokens, spacing } from "../../../constants/designSystem";
import {
  TAP_TO_PAY_AWARENESS,
  TAP_TO_PAY_AWARENESS_CTA,
  TAP_TO_PAY_DISCLAIMERS,
  type TapToPayAwarenessAssets,
} from "../../../constants/tapToPayMarketing";
import { useAuth } from "../../../context/AuthContext";
import { useBrand } from "../../../hooks/useBrands";
import { useBrandSetupChecklist } from "../../../hooks/useBrandSetupChecklist";
import { isBrandChargeReady } from "../../../utils/brandPayout";
import { useCurrentBrandRole } from "../../../hooks/useCurrentBrandRole";
import { tapToPayBrandEligible, useTapToPaySettingsEntry } from "../../../hooks/useTapToPaySettingsEntry";
import { useCurrentBrandId } from "../../../store/currentBrandStore";
import { tapToPayMayAcceptTerms } from "../../../utils/brandRole";

export const tapAwarenessSeenKey = (userId: string): string =>
  `mingla.tapToPay.awarenessSeen.v1.${userId}`;

const tapSetupRoute = (brandId: string): string => `/account/tap-to-pay?brandId=${encodeURIComponent(brandId)}`;

/**
 * #4389 HT — Home's "Get started" opens this splash first, then setup. The
 * mounted splash listens; with no splash mounted (no art, not iPhone) the
 * caller opens setup itself (returns false). A host the splash would not
 * show for (not eligible, may not accept the terms) goes straight to setup.
 */
const openListeners = new Set<(brandId: string) => void>();
export function openTapToPayAwareness(brandId: string): boolean {
  if (Platform.OS !== "ios" || openListeners.size === 0) return false;
  openListeners.forEach((listener) => listener(brandId));
  return true;
}

/**
 * #4389 (Seth, device: "just opened from nowhere") — the automatic once-only
 * showing (Apple 3.3) happens ONLY on the Home tab, once the brand's setup is
 * complete. Never over brand setup (/brand/new, /brand/{id}/setup), bank
 * setup (/brand/{id}/connect, /brand/{id}/payments/onboard, the native
 * secure screen and the browser sheet run from those routes), Door mode,
 * checkout or Ari's first-run lock (no Home tab then). A host's own request
 * (Home "Get started", F4 "Set up Tap to Pay on iPhone") opens it anywhere.
 *
 * Invariant I-4389-TTP-SPLASH-HOME-ONLY | issue #4389 | TapToPayAwarenessModal auto-shows only when the focused route is the Home tab and brand_setup is complete; openTapToPayAwareness works anywhere; the seen flag is written only after the splash was shown. Enforced by issue_4389_ttp_splash_home_only.implementor.test.tsx.
 */
export function tapAwarenessAutoShowAllowed(input: {
  pathname: string | null;
  setupComplete: boolean;
}): boolean {
  const path = (input.pathname ?? "").replace(/\/+$/, "");
  return input.setupComplete && (path === "/home" || path === "/(tabs)/home");
}

export interface TapToPayAwarenessModalProps {
  /** Test seam: the toolkit assets. */
  assets?: TapToPayAwarenessAssets | null;
}

/** No assets, no hooks: with TAP_TO_PAY_AWARENESS null this does nothing at all at the root. */
export const TapToPayAwarenessModal = ({
  assets = TAP_TO_PAY_AWARENESS,
}: TapToPayAwarenessModalProps): React.ReactElement | null =>
  assets === null ? null : <AwarenessModal assets={assets} />;

const AwarenessModal = ({ assets }: { assets: TapToPayAwarenessAssets }): React.ReactElement | null => {
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const brandId = useCurrentBrandId();
  const brandQuery = useBrand(brandId);
  const entry = useTapToPaySettingsEntry(brandId);
  const role = useCurrentBrandRole(brandId);
  const [seen, setSeen] = useState<boolean | null>(null);
  const [requested, setRequested] = useState<string | null>(null);
  const pathname = usePathname();
  const eligible =
    Platform.OS === "ios" &&
    entry !== null &&
    brandId !== null &&
    tapToPayBrandEligible(brandQuery.data) &&
    tapToPayMayAcceptTerms(role.rank);
  const eligibleRef = useRef<{ eligible: boolean; brandId: string | null }>({ eligible, brandId });
  eligibleRef.current = { eligible, brandId };
  useEffect(() => {
    const listener = (id: string): void => {
      const now = eligibleRef.current;
      if (now.eligible && now.brandId === id) setRequested(id);
      else router.push(tapSetupRoute(id) as never);
    };
    openListeners.add(listener);
    return () => {
      openListeners.delete(listener);
    };
  }, [router]);

  useEffect(() => {
    setSeen(null);
    if (userId === null) return undefined;
    let alive = true;
    AsyncStorage.getItem(tapAwarenessSeenKey(userId))
      .then((value) => {
        if (alive) setSeen(value === "1");
      })
      .catch((error: unknown) => {
        // Unreadable: treat as seen. Better to miss a splash than repeat one.
        console.warn("[door-tap] could not read the awareness flag", error instanceof Error ? error.message : "unknown");
        if (alive) setSeen(true);
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  // Read only while an automatic showing is possible (eligible, not seen).
  const setupChecklist = useBrandSetupChecklist(eligible && seen === false ? brandId : null);
  const autoAllowed = tapAwarenessAutoShowAllowed({
    pathname,
    setupComplete: setupChecklist.data?.facts.complete === true,
  });

  const markSeen = useCallback((): void => {
    setSeen(true);
    if (userId === null) return;
    void AsyncStorage.setItem(tapAwarenessSeenKey(userId), "1").catch((error: unknown) => {
      console.warn("[door-tap] could not save the awareness flag", error instanceof Error ? error.message : "unknown");
    });
  }, [userId]);

  // Apple's Tap to Pay on iPhone toolkit art and copy: never on Android. The
  // splash leads to Apple's terms, so only someone who may accept them sees it.
  // It shows once per user and device, or when Home's "Get started" asks.
  if (!eligible || brandId === null) return null;
  const onRequest = requested === brandId;
  if (!onRequest && !(seen === false && autoAllowed)) return null;
  const close = (): void => {
    setRequested(null);
    markSeen();
  };
  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
      <AwarenessBanner
        assets={assets}
        onGetStarted={() => {
          close();
          // #4389 — a brand still without a payment account finishes setup
          // first (Get paid), instead of landing on a Tap to Pay dead end.
          router.push(
            (isBrandChargeReady(brandQuery.data ?? null)
              ? tapSetupRoute(brandId)
              : `/brand/${encodeURIComponent(brandId)}/setup?step=pay`) as never,
          );
        }}
        onNotNow={close}
      />
    </Modal>
  );
};

/** A length in the artwork's frame as a percentage of the drawn image box. */
const artPercent = (value: number, of: number): `${number}%` => `${(value / of) * 100}%`;

interface AwarenessBannerProps {
  assets: TapToPayAwarenessAssets;
  onGetStarted: () => void;
  onNotNow: () => void;
}

/**
 * Apple's 9:16 banner drawn whole (fit width, or fit height and centred when the
 * screen is shorter), inside the safe area, on white. The controls sit in the
 * image box by percentage, so they track the art wherever it is drawn.
 */
const AwarenessBanner = ({ assets, onGetStarted, onNotNow }: AwarenessBannerProps): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [area, setArea] = useState<{ width: number; height: number }>({
    width: window.width - insets.left - insets.right,
    height: window.height - insets.top - insets.bottom,
  });
  const [termsOpen, setTermsOpen] = useState<boolean>(false);
  const { frame } = assets;
  const ratio = frame.width / frame.height;
  const boxWidth = Math.max(0, Math.min(area.width, area.height * ratio));
  const boxHeight = boxWidth / ratio;
  // "Terms apply." is about 11pt tall on a phone: widen its target to 44pt.
  const termsHeight = (assets.terms.height / frame.height) * boxHeight;
  const termsSlop = Math.max(0, Math.ceil((MIN_TARGET - termsHeight) / 2));
  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    if (width !== area.width || height !== area.height) setArea({ width, height });
  };

  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right },
      ]}
      testID="tap-awareness-modal"
    >
      <View style={styles.area} onLayout={onLayout}>
        <View style={{ width: boxWidth, height: boxHeight }} testID="tap-awareness-box">
          <Image
            source={assets.hero}
            style={styles.art}
            resizeMode="contain"
            accessible
            accessibilityRole="image"
            accessibilityLabel={assets.accessibilityLabel}
            accessibilityIgnoresInvertColors
            testID="tap-awareness-art"
          />
          <Pressable
            onPress={onGetStarted}
            accessibilityRole="button"
            accessibilityLabel={TAP_TO_PAY_AWARENESS_CTA}
            hitSlop={{ top: 4, bottom: 4 }}
            style={({ pressed }) => [
              styles.cta,
              {
                left: artPercent(assets.cta.x, frame.width),
                top: artPercent(assets.cta.y, frame.height),
                minWidth: artPercent(assets.cta.width, frame.width),
                minHeight: artPercent(assets.cta.height, frame.height),
              },
              pressed ? styles.ctaPressed : null,
            ]}
            testID="tap-awareness-get-started"
          >
            <Text style={styles.ctaText} numberOfLines={1}>
              {TAP_TO_PAY_AWARENESS_CTA}
            </Text>
          </Pressable>
          <Pressable
            onPress={onNotNow}
            accessibilityRole="button"
            accessibilityLabel="Not now"
            style={[
              styles.notNow,
              { left: artPercent(assets.notNow.x, frame.width), top: artPercent(assets.notNow.y, frame.height) },
            ]}
            testID="tap-awareness-not-now"
          >
            <Text style={styles.notNowText}>Not now</Text>
          </Pressable>
          <Pressable
            onPress={() => setTermsOpen(true)}
            accessibilityRole="link"
            accessibilityLabel="Terms apply. Show Tap to Pay on iPhone terms"
            hitSlop={{ top: termsSlop, bottom: termsSlop, left: 8, right: 8 }}
            style={{
              position: "absolute",
              left: artPercent(assets.terms.x, frame.width),
              top: artPercent(assets.terms.y, frame.height),
              width: artPercent(assets.terms.width, frame.width),
              height: artPercent(assets.terms.height, frame.height),
            }}
            testID="tap-awareness-terms"
          />
        </View>
      </View>
      {termsOpen ? <AwarenessTerms onClose={() => setTermsOpen(false)} /> : null}
    </View>
  );
};

/** Apple's full disclaimers, over the banner, until closed. */
const AwarenessTerms = ({ onClose }: { onClose: () => void }): React.ReactElement => {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.termsBackdrop} testID="tap-awareness-terms-sheet">
      <View style={[styles.termsPanel, { paddingBottom: insets.bottom + spacing.md }]} accessibilityViewIsModal>
        <View style={styles.termsHeader}>
          <Text style={styles.termsTitle} accessibilityRole="header">
            Terms
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close terms"
            style={styles.termsClose}
            testID="tap-awareness-terms-close"
          >
            <Text style={styles.termsCloseText}>Close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.termsBody}>
          {TAP_TO_PAY_DISCLAIMERS.map((paragraph) => (
            <Text key={paragraph} style={styles.termsText} selectable>
              {paragraph}
            </Text>
          ))}
        </ScrollView>
      </View>
    </View>
  );
};

const MIN_TARGET = 44;
// Apple's banner template, not the app theme: white paper, near-black ink, grey.
const ART_PAPER = "#ffffff";
const ART_INK = "#1d1d1f";
const ART_MUTED = "#6e6e73";

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: ART_PAPER },
  area: { flex: 1, alignItems: "center", justifyContent: "center" },
  art: { width: "100%", height: "100%" },
  cta: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    backgroundColor: ART_PAPER,
    borderWidth: 1,
    borderColor: ART_INK,
    borderRadius: 999,
  },
  ctaPressed: { opacity: 0.7 },
  ctaText: { fontSize: 15, fontWeight: "600", color: ART_INK, textAlign: "center" },
  notNow: { position: "absolute", minHeight: MIN_TARGET, justifyContent: "center" },
  notNowText: { fontSize: 15, color: ART_MUTED },
  termsBackdrop: { ...StyleSheet.absoluteFillObject, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  termsPanel: {
    maxHeight: "80%",
    backgroundColor: ART_PAPER,
    borderTopLeftRadius: radiusTokens.lg,
    borderTopRightRadius: radiusTokens.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  termsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  termsTitle: { fontSize: 17, fontWeight: "600", color: ART_INK },
  termsClose: { minHeight: MIN_TARGET, minWidth: MIN_TARGET, alignItems: "flex-end", justifyContent: "center" },
  termsCloseText: { fontSize: 17, color: ART_INK, fontWeight: "600" },
  termsBody: { gap: spacing.md, paddingVertical: spacing.sm },
  termsText: { fontSize: 13, lineHeight: 18, color: ART_MUTED },
});
