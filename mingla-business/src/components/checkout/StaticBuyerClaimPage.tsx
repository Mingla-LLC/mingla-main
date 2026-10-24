import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { captureWeb } from "../../analytics/webAnalytics";
import {
  BUYER_CLAIM_COPY,
  type BuyerClaimNoun,
} from "../../constants/buyerClaimCopy";
import {
  detectClientPlatform,
  openExternal,
  resolveGuestFunnelTarget,
  type Platform as DevicePlatform,
} from "../../services/guestFunnelLink";
import { SafeScreen } from "../ui/SafeScreen";

type StaticBuyerClaimKind = Extract<BuyerClaimNoun, "ticket" | "pass">;

export interface StaticBuyerClaimPageProps {
  kind: StaticBuyerClaimKind;
  analyticsSurface: "legacy_order_page" | "rsvp_pass_legacy";
  scrubFragment?: boolean;
}

const genericEntity = (kind: StaticBuyerClaimKind) => ({
  entityType: kind === "pass" ? ("rsvp" as const) : ("event" as const),
  brandSlug: "mingla",
  entitySlug: "legacy-claim",
});

/**
 * #4063 — legacy public purchase URLs no longer reveal or render credentials.
 * They only point the buyer to Explorer, where signed-in ownership is checked.
 */
export const StaticBuyerClaimPage: React.FC<StaticBuyerClaimPageProps> = ({
  kind,
  analyticsSurface,
  scrubFragment = false,
}) => {
  const nativePlatform: DevicePlatform | null =
    Platform.OS === "ios"
      ? "ios"
      : Platform.OS === "android"
        ? "android"
        : null;
  const [platform, setPlatform] = useState<DevicePlatform | null>(
    nativePlatform,
  );

  useEffect(() => {
    if (nativePlatform === null) setPlatform(detectClientPlatform());
  }, [nativePlatform]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined")
      return undefined;
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.appendChild(meta);

    if (
      scrubFragment &&
      typeof window !== "undefined" &&
      window.location.hash.length > 0
    ) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
    captureWeb("buyer_claim_card_viewed", { surface: analyticsSurface, kind });
    return () => meta.remove();
  }, [analyticsSurface, kind, scrubFragment]);

  const target = useMemo(
    () =>
      platform === null
        ? null
        : resolveGuestFunnelTarget(genericEntity(kind), platform).ctaUrl,
    [kind, platform],
  );

  const open = useCallback((): void => {
    if (target === null) return;
    if (Platform.OS === "web") openExternal(target);
    else void Linking.openURL(target);
  }, [target]);

  const title =
    kind === "pass"
      ? BUYER_CLAIM_COPY.pass.genericTitle
      : BUYER_CLAIM_COPY.order.genericTitle;

  return (
    <SafeScreen edges={["top", "bottom"]} style={styles.host}>
      <View
        style={styles.card}
        accessibilityRole="summary"
        accessibilityLabel={title}
      >
        <Text style={styles.brand}>Mingla</Text>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <Text style={styles.body}>{BUYER_CLAIM_COPY.signInGeneric}</Text>
        <Pressable
          accessibilityRole="button"
          disabled={target === null}
          onPress={open}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            target === null && styles.buttonDisabled,
          ]}
          testID="static-buyer-claim-primary"
        >
          <Text style={styles.buttonText}>{BUYER_CLAIM_COPY.button[kind]}</Text>
        </Pressable>
      </View>
    </SafeScreen>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0c0e12",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    gap: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.12)",
    borderRadius: 22,
    backgroundColor: "#15181f",
    padding: 24,
  },
  brand: { color: "#ff6b2c", fontSize: 24, fontWeight: "900" },
  title: {
    color: "#fff",
    fontSize: 22,
    lineHeight: 29,
    fontWeight: "800",
    textAlign: "center",
  },
  body: {
    color: "rgba(255,255,255,.72)",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  button: {
    width: "100%",
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "#ff6b2c",
    paddingHorizontal: 18,
  },
  buttonPressed: { opacity: 0.82 },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: "#0c0e12", fontSize: 15, fontWeight: "900" },
});

export default StaticBuyerClaimPage;
