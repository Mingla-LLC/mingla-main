/**
 * +not-found — Cycle 16a J-X4 (DEC-098 D-16-7).
 *
 * Mingla-branded 404 / unknown-route screen. Replaces Expo Router's
 * generic crash UI with a friendly + on-brand "Go home" path.
 *
 * Cross-platform: same component renders on native deep-link (e.g.
 * `mingla-business://garbage`) + web direct URL (e.g.
 * `business.mingla.com/garbage`). No platform branching.
 *
 * Per Cycle 16a SPEC §3.2.1.
 */

import React from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "../src/components/ui/Button";
import {
  backgroundWarmGlow,
  colors,
  fontWeights,
  spacing,
  typography,
} from "../src/constants/designSystem";
import { HapticFeedback } from "../src/utils/hapticFeedback";
// ISSUE-1001 — the official business lockup now imports from the canonical
// master @mingla/brand-assets (packages/brand-assets/mingla-business-logo.png);
// the app-local copy is deleted.
import { MINGLA_BUSINESS_LOGO } from "@mingla/brand-assets";

const logo = MINGLA_BUSINESS_LOGO;

/**
 * #2180 P2-1 — the CTA label's own Dynamic Type ceiling.
 *
 * React Native's iOS multiplier table (`RCTAccessibilityManager.mm`) runs to
 * 3.571 at the largest accessibility size, and `RCTTextAttributes.mm:139`
 * multiplies `lineHeight` by the same figure. The shared `Button` primitive
 * renders its label inside a pill of FIXED height (`SIZE_HEIGHT.md` = 44) and
 * exposes no `maxFontSizeMultiplier`, so at AX5 a 14/20 label lays out at
 * 50/71.4 pt and the glyphs are cut off — on the one screen whose entire job is
 * to show the user a way out.
 *
 * 2.0 is not a shortfall: WCAG 1.4.4 asks for 200 % resize, and 200 % of 14/20
 * is 28/40 pt — the largest label a 44 pt pill can host intact. So the cap IS
 * the requirement. The touch target stays 44 pt and the label stays whole.
 */
export const CTA_MAX_FONT_SCALE = 2;

/**
 * #2180 P2-1 — where "large type" begins. RN's table puts the largest ordinary
 * step at 1.353 and the first ACCESSIBILITY step at 1.786, so 1.5 is the
 * boundary between them and belongs to no real step in either direction.
 */
export const LARGE_TYPE_FONT_SCALE = 1.5;

/**
 * #2180 P2-1 — the `labelStyle` that pins the rendered CTA label at
 * `CTA_MAX_FONT_SCALE`, expressed the only way the `Button` primitive allows.
 *
 * RN multiplies whatever we hand it by the live `fontScale`, so dividing by
 * that scale first makes the RENDERED size `base x min(fontScale, cap)` — the
 * exact semantics of the `maxFontSizeMultiplier` prop `Button` does not expose.
 * At or below the cap this returns the primitive's own 14/20 unchanged, so
 * nothing moves at ordinary type sizes.
 */
export function ctaLabelStyle(fontScale: number): {
  fontSize: number;
  lineHeight: number;
} {
  const scale = fontScale > 0 ? fontScale : 1;
  let ratio = 1;
  // #2180 P2-1 — THE CLAMP. Delete this one line and the label renders at
  // `base * fontScale` again: 50 / 71.4 pt at AX5, inside a 44 pt pill.
  if (scale > CTA_MAX_FONT_SCALE) ratio = CTA_MAX_FONT_SCALE / scale;
  return {
    fontSize: typography.buttonMd.fontSize * ratio,
    lineHeight: typography.buttonMd.lineHeight * ratio,
  };
}

export default function NotFoundScreen(): React.ReactElement {
  const router = useRouter();
  // #2180 P2-1 — reactive, so a Dynamic Type change while this screen is open
  // re-lays it out rather than leaving a stale measurement behind.
  const { fontScale } = useWindowDimensions();
  const largeType = fontScale >= LARGE_TYPE_FONT_SCALE;

  const handleGoHome = (): void => {
    HapticFeedback.buttonPress();
    // router.replace (NOT push) — back button can't return to the 404.
    // Index gate routes per signed-in/signed-out state.
    router.replace("/" as never);
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false, title: "Not found" }} />
      <LinearGradient
        colors={[colors.background.primary, backgroundWarmGlow]}
        style={styles.gradient}
      >
        <SafeAreaView
          style={styles.container}
          edges={["top", "left", "right", "bottom"]}
        >
          {/*
            #2180 P2-1 — the centred region SCROLLS. At the largest Dynamic Type
            setting the lockup + heading + subtext measure ~888 pt against the
            ~579 pt this region gets on a 375x667 screen. Before, `overflow:
            hidden` simply threw the excess away: the lockup vanished and the
            subtext was cut in half. Scrolling degrades the region instead of
            deleting it, and — because the footer is still a `flexShrink: 0`
            SIBLING, never a child — the exit cannot move no matter how tall the
            content grows. `flex: 1` + `overflow: hidden` stay on the scroll
            host, so the structural guarantee is strengthened, not weakened.
          */}
          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentContainer}
          >
            <Image
              source={logo}
              // #2180 P2-1 — both entries carry explicit numeric width AND
              // height (I-PROPOSED-2180-BRAND-IMAGE-EXPLICIT-DIMENSIONS); the
              // compact one simply gives the words more room at accessibility
              // sizes. No `aspectRatio` on either.
              style={[styles.logo, largeType ? styles.logoCompact : null]}
              resizeMode="contain"
              accessibilityLabel="Mingla logo"
              accessibilityRole="image"
            />
            <Text style={styles.heading} accessibilityRole="header">
              Hmm, that&apos;s not a real page.
            </Text>
            <Text style={styles.subtext}>Maybe a typo? Or it moved?</Text>
          </ScrollView>
          {/*
            #2180 — the exit lives OUTSIDE the centred region so no measurement
            surprise can hide it. `content` is flex:1 + overflow:hidden, so
            anything that mis-measures inside it is clipped there instead of
            pushing this footer off the bottom of the screen. On the shipped
            build the "Go home" button sat inside `content` and landed at
            y ~ 1478 on an 852 pt screen — the screen's only exit, invisible,
            and the user's only remaining action was to force-quit the app.
          */}
          <View style={styles.footer}>
            <View style={styles.cta}>
              <Button
                label="Go home"
                onPress={handleGoHome}
                variant="primary"
                size="md"
                accessibilityLabel="Go home"
                // #2180 P2-1 — caps the label at 200 % so the full word stays
                // inside the 44 pt pill at every Dynamic Type setting.
                labelStyle={ctaLabelStyle(fontScale)}
              />
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>
    </>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    // #2180 — clip anything that mis-measures in here rather than letting it
    // grow the column and push the footer (the only exit) off-screen.
    overflow: "hidden",
  },
  contentContainer: {
    // #2180 P2-1 — `flexGrow: 1` keeps the group optically centred while there
    // is room, and lets it scroll once there is not.
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  logo: {
    // #2180 — explicit width AND height. The brand masters are up to 2000x2000
    // at scale 1 (`mingla-business-logo.png` is exactly that, and Metro
    // registers it as `"scales": [1]`), so an Image with no effective height
    // lays out at width / scale = 2000 pt. `aspectRatio` did NOT constrain it
    // on device: the lockup rendered 2000x2000 pt and pushed the heading, the
    // subtext and the "Go home" button off the bottom of the screen, which is
    // what turned a wrong landing into a screen the user could only escape by
    // force-quitting. `aspectRatio` is REMOVED, not corrected — 1356/480 is
    // the wordmark's ratio and this asset is square, so even when honoured it
    // letterboxed the lockup to ~50x50 pt. At 200 pt the asset's 1385x743
    // opaque ink box renders at ~139x74 pt: the 140 pt-wide lockup this file
    // always intended.
    width: 200,
    height: 200,
    flexShrink: 0,
    marginBottom: spacing.lg,
  },
  logoCompact: {
    // #2180 P2-1 — at accessibility type sizes the heading and the subtext need
    // the room more than the lockup does. Still explicit numerics on BOTH axes
    // and still no `aspectRatio`: the master is square, so 96 pt frames the
    // 1385x743 ink box at ~66x36 pt.
    width: 96,
    height: 96,
  },
  footer: {
    // #2180 — never allowed to shrink, and never inside the centred region.
    flexShrink: 0,
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },
  heading: {
    fontSize: 22,
    lineHeight: 30,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    textAlign: "center",
  },
  subtext: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: fontWeights.regular,
    color: colors.text.secondary,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  cta: {
    width: "100%",
    maxWidth: 320,
  },
});
