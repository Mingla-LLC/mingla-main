/**
 * #4271 — full-screen status layout shared by the Tap to Pay screens
 * (design T1 "not on this phone", T3 failures, H4 paid). Ring + title + body +
 * up to two actions and an optional text link, vertically centred, in the
 * Business app's dark tokens.
 *
 * Door polish: four tones (src/components/door/doorTone.ts) so the colour says
 * whether money moved: ok green, neutral grey (nothing charged), caution amber
 * (money not settled, don't charge again), bad red (declined or blocked). Each
 * tone has its own icon, so colour is never the only signal.
 */
import React, { useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { durations, spacing, text as textTokens, typography } from "../../../constants/designSystem";
import { TAP_GET_HELP } from "../../../constants/tapToPayCopy";
import { DOOR_MODE_COPY } from "../doorModeCopy";
import { useReduceMotion } from "../../../hooks/useMotionPreferences";
import { Button } from "../../ui/Button";
import { Icon, type IconName } from "../../ui/Icon";
import { doorToneStyle, type DoorTone } from "../doorTone";

export type TapStatusTone = DoorTone;

export interface TapStatusAction {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}

export interface TapStatusViewProps {
  tone: TapStatusTone;
  /** Defaults to the tone's own icon. */
  icon?: IconName;
  /** Caution only: a spinner in the ring while something is still being checked. */
  busy?: boolean;
  title: string;
  body?: string | null;
  children?: React.ReactNode;
  primary?: TapStatusAction | null;
  secondary?: TapStatusAction | null;
  /** Secondary rendered as a quiet ghost button (H4 "Done"). */
  secondaryGhost?: boolean;
  /** A quiet 44pt text link under the buttons (e.g. "Send receipt"). */
  link?: TapStatusAction | null;
  /** "Get help": a second quiet link that opens Help & Support. Hidden without a handler. */
  onHelp?: (() => void) | null;
  testID?: string;
}

export const TapStatusView = ({
  tone,
  icon,
  busy = false,
  title,
  body,
  children,
  primary,
  secondary,
  secondaryGhost = false,
  link,
  onHelp,
  testID,
}: TapStatusViewProps): React.ReactElement => {
  const style = doorToneStyle(tone);
  const reduceMotion = useReduceMotion();
  // Only a success bounces: the ring settles from 0.85 to 1. Caution and bad
  // never bounce; reduced motion gets a short fade instead of a scale.
  const scale = useRef(new Animated.Value(tone === "ok" ? 0.85 : 1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion) {
      scale.setValue(1);
      opacity.setValue(0);
      Animated.timing(opacity, { toValue: 1, duration: durations.fast, useNativeDriver: true }).start();
      return;
    }
    if (tone !== "ok") {
      scale.setValue(1);
      return;
    }
    Animated.timing(scale, {
      toValue: 1,
      duration: durations.entry,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [tone, reduceMotion, scale, opacity]);

  // iOS ignores `accessibilityLiveRegion`. Entering a caution or bad state is
  // announced through VoiceOver once (keyed on tone and title, so a body that
  // changes while the state holds is never re-read).
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (tone !== "caution" && tone !== "bad") return;
    AccessibilityInfo.announceForAccessibility(body ? `${title}. ${body}` : title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tone, title]);

  return (
    <View style={styles.host} testID={testID} accessibilityLiveRegion={style.liveRegion}>
      <Animated.View
        style={[
          styles.ring,
          { backgroundColor: style.ringFill, opacity, transform: [{ scale }] },
          style.ringBorder !== null ? { borderWidth: 1, borderColor: style.ringBorder } : null,
        ]}
        testID={`tap-tone-${tone}`}
      >
        {busy ? (
          <ActivityIndicator color={style.iconColor} />
        ) : (
          <Icon name={icon ?? style.defaultIcon} size={style.iconSize} color={style.iconColor} />
        )}
      </Animated.View>
      <Text style={tone === "ok" ? styles.titleBig : styles.title} accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {children}
      <View style={styles.actions}>
        {primary ? (
          <Button
            label={primary.label}
            onPress={primary.onPress}
            loading={primary.loading}
            disabled={primary.disabled}
            variant="primary"
            size="lg"
            fullWidth
            testID={primary.testID}
          />
        ) : null}
        {secondary ? (
          <Button
            label={secondary.label}
            onPress={secondary.onPress}
            loading={secondary.loading}
            disabled={secondary.disabled}
            variant={secondaryGhost ? "ghost" : "secondary"}
            size="lg"
            fullWidth
            testID={secondary.testID}
          />
        ) : null}
        {link ? (
          <Pressable
            onPress={link.onPress}
            disabled={link.disabled}
            accessibilityRole="button"
            accessibilityLabel={link.label}
            style={styles.link}
            testID={link.testID}
          >
            <Text style={styles.linkText}>{link.label}</Text>
          </Pressable>
        ) : null}
        {onHelp ? (
          <Pressable
            onPress={onHelp}
            accessibilityRole="button"
            accessibilityLabel={TAP_GET_HELP}
            style={styles.link}
            testID="tap-get-help"
          >
            <Text style={styles.linkText}>{TAP_GET_HELP}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  ring: {
    width: 64,
    height: 64,
    borderRadius: 999,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  title: {
    ...typography.h3,
    color: textTokens.primary,
    textAlign: "center",
  },
  titleBig: {
    ...typography.display,
    color: textTokens.primary,
    textAlign: "center",
  },
  body: {
    ...typography.bodySm,
    color: textTokens.secondary,
    textAlign: "center",
  },
  actions: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  link: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  linkText: {
    ...typography.bodySm,
    fontWeight: "600",
    color: textTokens.secondary,
    textDecorationLine: "underline",
  },
});

/**
 * #4389 S-i / T1 — Tap to Pay has no usable address for this brand: say so and
 * open the one address screen (T1). Never a dead end. The caller passes its
 * own navigation (shared Tap to Pay components take no router, #4271).
 */
export const TapAddressMissing = ({
  onAddAddress,
  onHelp,
}: {
  onAddAddress: () => void;
  onHelp?: (() => void) | null;
}): React.ReactElement => (
  <TapStatusView
    tone="neutral"
    icon="location"
    title={DOOR_MODE_COPY.addressMissing}
    body={null}
    primary={{ label: DOOR_MODE_COPY.addAddress, onPress: onAddAddress, testID: "tap-add-address" }}
    onHelp={onHelp}
    testID="tap-address-missing"
  />
);

/**
 * #4389 (iPhone 15 recording) — why Tap to Pay can't be used for this brand.
 * A US / UK brand that simply has no payment account yet ("no_card_payments")
 * is told to finish setting up payments, never that it "isn't available"; that
 * title is kept for brands that truly can't use it, with the reason.
 */
export type TapNotReadyReason =
  | "no_card_payments"
  | "unsupported_country"
  | "paystack"
  | "not_released"
  | "no_brand"
  | "server_not_available";

export function tapNotReadyCopy(
  reason: TapNotReadyReason,
  os: string,
): { kind: "finish_setup" | "unavailable"; title: string; body: string } {
  if (reason === "no_card_payments") {
    return { kind: "finish_setup", title: DOOR_MODE_COPY.ttpFinishTitle, body: DOOR_MODE_COPY.ttpFinishBody(os) };
  }
  return {
    kind: "unavailable",
    title: DOOR_MODE_COPY.ttpUnavailableTitle(os),
    body:
      reason === "unsupported_country" || reason === "paystack"
        ? DOOR_MODE_COPY.ttpCountryBody(os)
        : DOOR_MODE_COPY.ttpUnavailableBody,
  };
}

export const TapNotReady = ({
  reason,
  os,
  onFinishSetup,
  onUsePayCode,
  payCodeBusy = false,
  onHelp,
  testID,
}: {
  reason: TapNotReadyReason;
  os: string;
  /** Opens brand setup at Get paid (`/brand/{id}/setup?step=pay`). */
  onFinishSetup: (() => void) | null;
  onUsePayCode: () => void;
  payCodeBusy?: boolean;
  onHelp?: (() => void) | null;
  testID: string;
}): React.ReactElement => {
  const copy = tapNotReadyCopy(reason, os);
  if (copy.kind === "finish_setup" && onFinishSetup !== null) {
    return (
      <TapStatusView
        tone="neutral"
        icon="bank"
        title={copy.title}
        body={copy.body}
        primary={{ label: DOOR_MODE_COPY.ttpFinishCta, onPress: onFinishSetup, testID: "tap-finish-setup" }}
        secondary={{ label: DOOR_MODE_COPY.ttpUsePayCode, onPress: onUsePayCode, loading: payCodeBusy, testID: "tap-use-pay-code" }}
        onHelp={onHelp}
        testID={`${testID}-finish-setup`}
      />
    );
  }
  return (
    <TapStatusView
      tone="neutral"
      icon={os === "ios" ? "globe" : "tap"}
      title={copy.kind === "finish_setup" ? DOOR_MODE_COPY.ttpUnavailableTitle(os) : copy.title}
      body={copy.kind === "finish_setup" ? DOOR_MODE_COPY.ttpUnavailableBody : copy.body}
      primary={{ label: DOOR_MODE_COPY.ttpUsePayCode, onPress: onUsePayCode, loading: payCodeBusy }}
      onHelp={onHelp}
      testID={testID}
    />
  );
};
