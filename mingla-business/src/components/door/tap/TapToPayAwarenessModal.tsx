/**
 * #4271 — Apple's full-screen awareness splash (3.1 to 3.3, 6.2). A sibling of the
 * root Stack. Once per user and device. It cannot render until Apple's toolkit
 * assets are set in tapToPayMarketing.ts.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Image, Modal, Platform, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";

import { canvas, spacing, text as textTokens, typography } from "../../../constants/designSystem";
import { tapOnboardingCopy } from "../../../constants/tapToPayCopy";
import { TAP_TO_PAY_AWARENESS, type TapToPayAwarenessAssets } from "../../../constants/tapToPayMarketing";
import { useAuth } from "../../../context/AuthContext";
import { useBrand } from "../../../hooks/useBrands";
import { useCurrentBrandRole } from "../../../hooks/useCurrentBrandRole";
import { tapToPayBrandEligible, useTapToPaySettingsEntry } from "../../../hooks/useTapToPaySettingsEntry";
import { useCurrentBrandId } from "../../../store/currentBrandStore";
import { tapToPayMayAcceptTerms } from "../../../utils/brandRole";
import { Button } from "../../ui/Button";

export const tapAwarenessSeenKey = (userId: string): string =>
  `mingla.tapToPay.awarenessSeen.v1.${userId}`;

export interface TapToPayAwarenessModalProps {
  /** Test seam: the toolkit assets. */
  assets?: TapToPayAwarenessAssets | null;
}

/** No assets, no hooks: until the toolkit lands this does nothing at all at the root. */
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

  const markSeen = useCallback((): void => {
    setSeen(true);
    if (userId === null) return;
    void AsyncStorage.setItem(tapAwarenessSeenKey(userId), "1").catch((error: unknown) => {
      console.warn("[door-tap] could not save the awareness flag", error instanceof Error ? error.message : "unknown");
    });
  }, [userId]);

  if (
    seen !== false ||
    entry === null ||
    brandId === null ||
    !tapToPayBrandEligible(brandQuery.data) ||
    // The splash leads to Apple's terms, so only someone who may accept them sees it.
    !tapToPayMayAcceptTerms(role.rank)
  ) {
    return null;
  }
  const button = tapOnboardingCopy(Platform.OS).button;
  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={markSeen}>
      <View style={styles.host} testID="tap-awareness-modal">
        <Image source={assets.hero} style={styles.hero} resizeMode="contain" accessibilityIgnoresInvertColors />
        <Text style={styles.title} accessibilityRole="header">
          {assets.title}
        </Text>
        <Text style={styles.body}>{assets.body}</Text>
        <Button
          label={button}
          onPress={() => {
            markSeen();
            router.push(`/account/tap-to-pay?brandId=${encodeURIComponent(brandId)}` as never);
          }}
          variant="primary"
          size="lg"
          fullWidth
          accessibilityLabel={button}
          testID="tap-awareness-setup"
        />
        <Button
          label="Not now"
          onPress={markSeen}
          variant="ghost"
          size="md"
          fullWidth
          accessibilityLabel="Not now"
          testID="tap-awareness-not-now"
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1, justifyContent: "center", gap: spacing.md, padding: spacing.lg, backgroundColor: canvas.discover },
  hero: { width: "100%", height: 240 },
  title: { ...typography.h3, color: textTokens.primary, textAlign: "center" },
  body: { ...typography.body, color: textTokens.secondary, textAlign: "center" },
});
