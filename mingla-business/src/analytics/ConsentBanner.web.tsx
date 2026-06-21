/**
 * ConsentBanner.web.tsx — Mingla-branded cookie/analytics consent banner.
 *   META-ORCH-1187 [Growth Analytics Hub] Phase 1, LEG 2 (buyer web).
 *
 * WEB-ONLY (Metro resolves this `.web.tsx` on web, the `ConsentBanner.tsx`
 * no-op on native). Built from mingla-business's existing RN primitives + design
 * tokens — NO third-party CMP, NO new design system.
 *
 * The REAL gate (§4.E): on first visit (no stored choice) the banner shows and
 * PostHog stays opted-out-by-default + GA4 stays consent-default-denied — NO
 * cookies / NO capture. Accept → grantConsent() (PostHog opt-in + GA4 consent
 * update granted). Reject → denyConsent() (gates stay closed). The choice is
 * persisted (mingla_consent_v1) so it does not re-nag the same visitor.
 *
 * Mounted web-guarded in app/_layout.tsx. Returns null once a choice exists.
 */

import React, { useEffect, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "../components/ui/Button";
import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../constants/designSystem";
import {
  denyConsent,
  grantConsent,
  readStoredConsent,
} from "./webAnalytics.web";
import { phNoCaptureProps } from "./phMask.web";

const PRIVACY_POLICY_URL = "https://usemingla.com/privacy-policy";

export function ConsentBanner(): React.ReactElement | null {
  // Native should never mount this (the .tsx no-op covers native), but guard
  // defensively so a mis-mount is inert.
  const [visible, setVisible] = useState<boolean>(false);
  const [manageOpen, setManageOpen] = useState<boolean>(false);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    // Show only when the visitor has not chosen yet.
    setVisible(readStoredConsent() === null);
  }, []);

  if (Platform.OS !== "web" || !visible) return null;

  const handleAccept = (): void => {
    grantConsent();
    setVisible(false);
  };

  const handleReject = (): void => {
    denyConsent();
    setVisible(false);
  };

  const handlePrivacy = (): void => {
    void Linking.openURL(PRIVACY_POLICY_URL);
  };

  return (
    <View
      // accessibility: label; keeps a high zIndex so it overlays the
      // public-page ParallaxCover chrome.
      accessibilityLabel="Cookie consent"
      // ph-no-capture: never record the banner itself in session replay.
      {...phNoCaptureProps()}
      style={styles.host}
      pointerEvents="box-none"
    >
      <View style={styles.panel}>
        <Text style={styles.title}>Cookies &amp; analytics</Text>
        <Text style={styles.body}>
          We use cookies and privacy-first analytics to understand how people
          use Mingla and improve checkout. Nothing is tracked until you accept.
          See our{" "}
          <Text
            style={styles.link}
            onPress={handlePrivacy}
            accessibilityRole="link"
          >
            Privacy Policy
          </Text>
          .
        </Text>

        {manageOpen ? (
          <Text style={styles.manageNote}>
            Analytics help us improve Mingla by measuring page views, funnel
            drop-off, and conversions. Choose Accept to turn them on, or Reject
            to keep them off. You can change this anytime by clearing your site
            data.
          </Text>
        ) : null}

        <View style={styles.actions}>
          <View style={styles.actionPrimary}>
            <Button
              label="Accept all"
              onPress={handleAccept}
              variant="primary"
              size="md"
              fullWidth
              accessibilityLabel="Accept cookies and analytics"
            />
          </View>
          <View style={styles.actionSecondary}>
            <Button
              label="Reject"
              onPress={handleReject}
              variant="secondary"
              size="md"
              fullWidth
              accessibilityLabel="Reject cookies and analytics"
            />
          </View>
        </View>

        <Pressable
          onPress={() => setManageOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel="Manage analytics preferences"
          style={styles.manageBtn}
        >
          <Text style={styles.manageLabel}>
            {manageOpen ? "Hide details" : "Manage"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    // Above the public-page ParallaxCover chrome + sticky checkout CTAs.
    zIndex: 9999,
  },
  panel: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: "rgba(18, 20, 26, 0.98)",
    borderRadius: radiusTokens.xl,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
    padding: spacing.lg,
    gap: spacing.sm,
    // Subtle lift; web-only shadow.
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.2,
  },
  body: {
    fontSize: 13,
    lineHeight: 19,
    color: textTokens.secondary,
  },
  link: {
    color: accent.warm,
    fontWeight: "600",
  },
  manageNote: {
    fontSize: 12,
    lineHeight: 18,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  actionPrimary: {
    flex: 1,
  },
  actionSecondary: {
    flex: 1,
  },
  manageBtn: {
    alignSelf: "flex-start",
    paddingVertical: spacing.xs,
  },
  manageLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: textTokens.tertiary,
  },
});
