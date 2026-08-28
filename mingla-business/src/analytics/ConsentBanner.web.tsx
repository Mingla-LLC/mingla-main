/** Buyer-web cookie consent, composed as one viewport-bounded persistent action. */

import React, { useEffect, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { Button } from "../components/ui/Button";
import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../constants/designSystem";
import { denyConsent, grantConsent } from "./webAnalytics.web";
import { phNoCaptureProps } from "./phMask.web";
import { useWebConsentState } from "./useWebConsentState.web";

const PRIVACY_POLICY_URL = "https://usemingla.com/privacy-policy";

type WebConsentStyle = Omit<
  ViewStyle,
  "left" | "right" | "bottom" | "maxHeight"
> & {
  left?: number | string;
  right?: number | string;
  bottom?: number | string;
  maxHeight?: number | string;
  overflowY?: "auto";
  overscrollBehaviorY?: "contain";
  WebkitOverflowScrolling?: "touch";
  outlineWidth?: number;
  outlineStyle?: "solid";
  outlineColor?: string;
  outlineOffset?: number;
  cursor?: "pointer";
};

type WebPressableState = PressableStateCallbackType & {
  focused?: boolean;
  hovered?: boolean;
};

const safeBottom = "max(16px, env(safe-area-inset-bottom, 0px))";
const safeTop = "max(16px, env(safe-area-inset-top, 0px))";

export function ConsentBanner(): React.ReactElement | null {
  const consentState = useWebConsentState();
  const [manageOpen, setManageOpen] = useState<boolean>(false);
  const [compact, setCompact] = useState<boolean>(
    () => typeof window !== "undefined" && window.innerWidth < 320,
  );

  useEffect(() => {
    const query = window.matchMedia("(max-width: 319px)");
    const sync = (): void => setCompact(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  if (Platform.OS !== "web" || consentState !== "unresolved") return null;

  return (
    <View
      role="region"
      accessibilityLabel="Cookie consent"
      {...phNoCaptureProps()}
      style={[
        styles.host,
        ({
          left: "max(16px, env(safe-area-inset-left, 0px))",
          right: "max(16px, env(safe-area-inset-right, 0px))",
          bottom: safeBottom,
        } as WebConsentStyle as StyleProp<ViewStyle>),
      ]}
      pointerEvents="box-none"
    >
      <View
        style={[
          styles.panel,
          compact ? styles.panelCompact : null,
          ({
            maxHeight: `calc(100dvh - ${safeTop} - ${safeBottom})`,
          } as WebConsentStyle as StyleProp<ViewStyle>),
        ]}
      >
        <View
          style={[
            styles.readingBand,
            ({
              overflowY: "auto",
              overscrollBehaviorY: "contain",
              WebkitOverflowScrolling: "touch",
            } as WebConsentStyle as StyleProp<ViewStyle>),
          ]}
        >
          <Text style={styles.title}>Cookies &amp; analytics</Text>
          <Text style={styles.body}>
            We use cookies and privacy-first analytics to understand how people
            use Mingla and improve checkout. Nothing is tracked until you accept.
          </Text>
          <Pressable
            onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
            accessibilityRole="link"
            accessibilityLabel="Privacy Policy"
            style={({ focused }: WebPressableState) => [
              styles.privacyLink,
              focused ? styles.focusRing : null,
            ]}
          >
            {({ focused, hovered }: WebPressableState) => (
              <Text style={styles.body}>
                See our{" "}
                <Text
                  style={[
                    styles.link,
                    focused || hovered ? styles.linkActive : null,
                  ]}
                >
                  Privacy Policy
                </Text>
                .
              </Text>
            )}
          </Pressable>

          {manageOpen ? (
            <Text nativeID="issue-2769-consent-details" style={styles.manageNote}>
              Analytics help us improve Mingla by measuring page views, funnel
              drop-off, and conversions. Choose Accept to turn them on, or Reject
              to keep them off. You can change this anytime by clearing your site
              data.
            </Text>
          ) : null}
        </View>

        <View style={styles.decisionBand}>
          <View style={[styles.actions, compact ? styles.actionsCompact : null]}>
            <View style={styles.action}>
              <Button
                label="Accept all"
                onPress={grantConsent}
                variant="primary"
                size="md"
                fullWidth
                accentColor={accent.warm}
                accessibilityLabel="Accept cookies and analytics"
                testID="issue-2769-consent-accept"
              />
            </View>
            <View style={styles.action}>
              <Button
                label="Reject"
                onPress={denyConsent}
                variant="secondary"
                size="md"
                fullWidth
                accessibilityLabel="Reject cookies and analytics"
                testID="issue-2769-consent-reject"
              />
            </View>
          </View>

          <Pressable
            onPress={() => setManageOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityLabel="Manage analytics preferences"
            accessibilityState={{ expanded: manageOpen }}
            aria-controls="issue-2769-consent-details"
            testID="issue-2769-consent-manage"
            style={({ focused, hovered }: WebPressableState) => [
              styles.manageBtn,
              hovered ? styles.manageHovered : null,
              focused ? styles.focusRing : null,
            ]}
          >
            <Text style={styles.manageLabel}>
              {manageOpen ? "Hide details" : "Manage"}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    alignItems: "center",
    zIndex: 9999,
  },
  panel: {
    width: "100%",
    maxWidth: 520,
    minHeight: 0,
    backgroundColor: "rgba(18, 20, 26, 0.98)",
    borderRadius: radiusTokens.xl,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
    padding: spacing.lg,
    gap: spacing.sm,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
  },
  panelCompact: {
    padding: spacing.md,
  },
  readingBand: {
    flexShrink: 1,
    minHeight: 0,
    gap: spacing.sm,
  },
  decisionBand: {
    flexShrink: 0,
    gap: spacing.xs,
  },
  title: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.2,
  },
  body: {
    fontSize: 13,
    lineHeight: 19,
    color: textTokens.secondary,
  },
  privacyLink: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    borderRadius: radiusTokens.sm,
  },
  link: {
    color: accent.warm,
    fontWeight: "600",
  },
  linkActive: {
    textDecorationLine: "underline",
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
  actionsCompact: {
    flexDirection: "column",
  },
  action: {
    flex: 1,
  },
  manageBtn: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    borderRadius: radiusTokens.sm,
    paddingHorizontal: spacing.sm,
  },
  manageHovered: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    cursor: "pointer",
  },
  manageLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: textTokens.tertiary,
  },
  focusRing: {
    outlineWidth: 2,
    outlineStyle: "solid",
    outlineColor: accent.warm,
    outlineOffset: 2,
  },
});
