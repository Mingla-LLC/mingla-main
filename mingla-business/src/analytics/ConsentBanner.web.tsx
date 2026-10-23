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
  const [preferencesOpen, setPreferencesOpen] = useState<boolean>(false);
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

  if (Platform.OS !== "web") return null;
  if (consentState !== "unresolved" && !preferencesOpen) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ad privacy choices"
        onPress={() => setPreferencesOpen(true)}
        style={({ focused, hovered }: WebPressableState) => [
          styles.choiceLinkHost,
          hovered ? styles.manageHovered : null,
          focused ? styles.focusRing : null,
        ]}
      >
        <Text style={styles.choiceLink}>Ad privacy choices</Text>
      </Pressable>
    );
  }

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
          <Text style={styles.title}>Ad privacy</Text>
          <Text style={styles.body}>
            We use cookies and advertising tools from Meta, Snapchat and TikTok
            to measure and improve our ads.
          </Text>
          <Pressable
            onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
            accessibilityRole="link"
            accessibilityLabel="Privacy policy"
            style={({ focused }: WebPressableState) => [
              styles.privacyLink,
              focused ? styles.focusRing : null,
            ]}
          >
            {({ focused, hovered }: WebPressableState) => (
              <Text style={styles.body}>
                <Text
                  style={[
                    styles.link,
                    focused || hovered ? styles.linkActive : null,
                  ]}
                >
                  Privacy policy
                </Text>
              </Text>
            )}
          </Pressable>
        </View>

        <View style={styles.decisionBand}>
          <View style={[styles.actions, compact ? styles.actionsCompact : null]}>
            <View style={styles.action}>
              <Button
                label="OK"
                onPress={() => {
                  void grantConsent().finally(() => setPreferencesOpen(false));
                }}
                variant="primary"
                size="md"
                fullWidth
                accentColor={accent.warm}
                accessibilityLabel="OK"
                testID="issue-2769-consent-accept"
              />
            </View>
            <View style={styles.action}>
              <Button
                label="Opt out of ad tracking"
                onPress={() => {
                  denyConsent();
                  setPreferencesOpen(false);
                }}
                variant="secondary"
                size="md"
                fullWidth
                accessibilityLabel="Opt out of ad tracking"
                testID="issue-2769-consent-reject"
              />
            </View>
          </View>

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
  choiceLinkHost: {
    position: "absolute",
    right: spacing.md,
    bottom: spacing.md,
    zIndex: 9998,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radiusTokens.sm,
    backgroundColor: "rgba(18, 20, 26, 0.92)",
  },
  choiceLink: {
    color: accent.warm,
    fontSize: 13,
    fontWeight: "700",
    textDecorationLine: "underline",
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
