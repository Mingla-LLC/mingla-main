/**
 * +not-found — #2180 [get-app link opens the installed app and strands the user].
 *
 * Mingla-branded 404 / unknown-route screen for the consumer app. Before this file
 * existed, every unmatched route in `app-mobile` fell through to expo-router's
 * built-in developer-facing "Unmatched Route" view
 * (`expo-router/build/getRoutes.js:56` -> `./views/Unmatched`), which is not a
 * screen any real user should ever see.
 *
 * `+native-intent.tsx` catches claimed-but-unserved links BEFORE this screen can
 * mount, so this stays a real 404 with a working exit rather than an auto-redirect.
 *
 * Modelled on the corrected `mingla-business/app/+not-found.tsx`; the copy matches
 * deliberately, because it is the same moment for the user.
 */

import React from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  backgroundWarmGlow,
  colors,
  fontWeights,
  spacing,
  touchTargets,
} from "../src/constants/designSystem";
import { HapticFeedback } from "../src/utils/hapticFeedback";
import { MINGLA_WORDMARK } from "@mingla/brand-assets";

const logo = MINGLA_WORDMARK;

/**
 * #2180 P2-1 — the CTA label's own Dynamic Type ceiling. Mirrors
 * `mingla-business/app/+not-found.tsx`, because this is the same moment for the
 * user and it must degrade the same way.
 *
 * React Native's iOS multiplier table (`RCTAccessibilityManager.mm`) runs to
 * 3.571 at the largest accessibility size and multiplies `lineHeight` by the
 * same figure, so an uncapped 16/24 label lays out at 57/86 pt and its glyphs
 * are cut off. WCAG 1.4.4 asks for 200 % resize; 200 % of 16/24 is 32/48 pt,
 * which this pill hosts intact because it is `minHeight`-based and grows.
 */
export const CTA_MAX_FONT_SCALE = 2;

/**
 * #2180 P2-1 — where "large type" begins. RN's table puts the largest ordinary
 * step at 1.353 and the first ACCESSIBILITY step at 1.786, so 1.5 is the
 * boundary between them and belongs to no real step in either direction.
 */
export const LARGE_TYPE_FONT_SCALE = 1.5;

export default function NotFoundScreen(): React.ReactElement {
  const router = useRouter();
  // #2180 P2-1 — reactive, so a Dynamic Type change while this screen is open
  // re-lays it out rather than leaving a stale measurement behind.
  const { fontScale } = useWindowDimensions();
  const largeType = fontScale >= LARGE_TYPE_FONT_SCALE;

  const handleGoHome = (): void => {
    HapticFeedback.buttonPress();
    // router.replace (NOT push) — back button can't return to the 404.
    // The index gate at `/` routes per signed-in/signed-out state.
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
            setting the wordmark + heading + subtext outgrow the room this
            region gets on a 375x667 screen; `overflow: hidden` alone simply
            threw the excess away, clipping the wordmark and the subtext out of
            existence. Scrolling degrades the region instead of deleting it, and
            — because the footer is still a `flexShrink: 0` SIBLING, never a
            child — the exit cannot move no matter how tall the content grows.
            `flex: 1` + `overflow: hidden` stay on the scroll host, so the
            structural guarantee is strengthened, not weakened.
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
            pushing this footer off the bottom of the screen. That is exactly
            what stranded users on the business app's 404: its "Go home" button
            sat inside the centred column and landed at y ~ 1478 on an 852 pt
            screen, leaving force-quit as the only way out.
          */}
          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go home"
              onPress={handleGoHome}
              style={({ pressed }) => [
                styles.button,
                pressed && styles.buttonPressed,
              ]}
            >
              {/*
                #2180 P2-1 — the label is capped at 200 % and pinned to one
                line, so it can never outgrow the pill or be cut off. The pill
                is `minHeight`-based, so it GROWS to host the bigger label and
                the touch target only ever gets larger than 44 pt.
              */}
              <Text
                style={styles.buttonText}
                numberOfLines={1}
                maxFontSizeMultiplier={CTA_MAX_FONT_SCALE}
              >
                Go home
              </Text>
            </Pressable>
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
    // at scale 1, so an Image with no effective height lays out at
    // width / scale — on the business 404 that was 2000 pt, which pushed the
    // heading, the subtext and the "Go home" button off the bottom of the
    // screen and made it escapable only by force-quitting. `aspectRatio` is
    // never used in place of a height here. 140 x 50 matches this app's
    // existing wordmark treatment (`AppLoadingScreen`, `WelcomeScreen`) and is
    // the wordmark's own 1356:480 ratio, stated explicitly.
    width: 140,
    height: 50,
    flexShrink: 0,
    marginBottom: spacing.lg,
  },
  logoCompact: {
    // #2180 P2-1 — at accessibility type sizes the heading and the subtext need
    // the room more than the wordmark does. Still explicit numerics on BOTH
    // axes and still no `aspectRatio`; 112x40 holds the wordmark's own 1356:480
    // ratio, stated as two numbers.
    width: 112,
    height: 40,
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
  footer: {
    // #2180 — never allowed to shrink, and never inside the centred region.
    flexShrink: 0,
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },
  button: {
    width: "100%",
    maxWidth: 320,
    minHeight: touchTargets.minimum,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  buttonPressed: {
    opacity: 0.88,
  },
  buttonText: {
    color: colors.text.inverse,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: fontWeights.bold,
  },
});
