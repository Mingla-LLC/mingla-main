/**
 * #4389 (screen HT) — the Tap to Pay card on Home (moved out of Account).
 *
 * iPhone: Apple's in-app tile visual and Apple's exact words, "Terms apply."
 * Android: a plain card (Apple's art is iPhone-only). Not the owner/admin: a
 * line saying who can turn it on (Apple 3.8.1). Web never mounts it.
 * "Get started" opens the existing Tap to Pay setup; "Not now" moves it to To do.
 */
import React, { useEffect, useRef } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import {
  radius as radiusTokens,
  color,
  space,
  type,
} from "../../constants/designSystem";
import type { HomeTapCardMode } from "../../utils/homeTakePayment";
import { trackBrandSetup } from "../brand/brandSetupAnalytics";
import { TapToPayIcon } from "../door/tap/TapToPayIcon";
import { useBrandTeamMemberDirectory } from "../../hooks/useBrandTeamMemberDirectory";
import { Button } from "../ui/Button";
import { HOME_SETUP_TAP_COPY as C } from "./homeSetupTapCopy";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TTP_VISUAL: number | null = (() => {
  try {
    return require("../../../assets/tap-to-pay/ttp-visual.png") as number;
  } catch {
    // A plain node test run has no asset transform; the card draws without art.
    return null;
  }
})();

export interface HomeTapToPayCardProps {
  mode: Exclude<HomeTapCardMode, null>;
  os: "ios" | "android";
  brandId: string;
  brandName: string;
  onGetStarted: () => void;
  onNotNow: () => void;
}

export const HomeTapToPayCard: React.FC<HomeTapToPayCardProps> = ({
  mode,
  os,
  brandId,
  brandName,
  onGetStarted,
  onNotNow,
}) => {
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    if (shownFor.current === brandId) return;
    shownFor.current = brandId;
    trackBrandSetup("ttp_home_card_shown", { platform: os, brand_id: brandId });
  }, [brandId, os]);

  const getStarted = (): void => {
    trackBrandSetup("ttp_home_card_cta", { platform: os, brand_id: brandId });
    onGetStarted();
  };
  const notNow = (): void => {
    trackBrandSetup("ttp_home_card_not_now", { platform: os, brand_id: brandId });
    onNotNow();
  };
  const owner = mode === "owner";
  // The not-owner line names the owner (team directory), else "the owner".
  const team = useBrandTeamMemberDirectory(owner ? brandId : null);
  const ownerName =
    team.data?.find((m) => m.role === "brand_owner" && (m.displayName ?? "").trim().length > 0)?.displayName?.trim() ??
    C.ht.ownerFallback;

  if (os === "ios") {
    return (
      <View
        style={styles.hero}
        accessibilityRole="summary"
        accessibilityLabel={C.ht.iosTitle}
        testID="home-ttp-card-ios"
      >
        {TTP_VISUAL !== null ? (
          <Image
            source={TTP_VISUAL}
            style={styles.visual}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
            accessible={false}
          />
        ) : null}
        <View style={styles.heroText}>
          <Text style={styles.heroTitle} numberOfLines={1}>
            {C.ht.iosTitle}
          </Text>
          <Text style={styles.heroBody}>{C.ht.iosBody}</Text>
          {owner ? (
            <Text style={styles.ownerLine}>
              {C.ht.notOwnerIos(ownerName, brandName)}
            </Text>
          ) : (
            <View style={styles.ctaRow}>
              <View style={styles.cta}>
                <Button label={C.ht.getStarted} onPress={getStarted} variant="primary" size="md" fullWidth testID="home-ttp-get-started" />
              </View>
              <View style={styles.cta}>
                <Button label={C.ht.notNow} onPress={notNow} variant="ghost" size="md" fullWidth testID="home-ttp-not-now" />
              </View>
            </View>
          )}
          <Text style={styles.legal}>{C.ht.terms}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.plain} testID="home-ttp-card-android">
      <View style={styles.plainHead}>
        <TapToPayIcon size={22} />
        <View style={styles.plainCopy}>
          <Text style={styles.plainTitle}>{C.ht.androidTitle}</Text>
          <Text style={styles.plainBody}>{C.ht.androidBody}</Text>
        </View>
      </View>
      {owner ? (
        <Text style={styles.ownerLineDark}>{C.ht.notOwner(ownerName, brandName)}</Text>
      ) : (
        <View style={styles.ctaRow}>
          <View style={styles.cta}>
            <Button label={C.ht.notNow} onPress={notNow} variant="secondary" size="md" fullWidth testID="home-ttp-not-now" />
          </View>
          <View style={styles.cta}>
            <Button label={C.ht.getStarted} onPress={getStarted} variant="primary" size="md" fullWidth testID="home-ttp-get-started" />
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  hero: {
    marginBottom: space[4],
    borderRadius: radiusTokens.lg,
    overflow: "hidden",
    // #4420: Apple's light Tap to Pay hero (white paper, near-black ink, grey) on the nearest tokens.
    backgroundColor: color.paper,
  },
  visual: { width: "100%", aspectRatio: 720 / 559 },
  heroText: { padding: space[4], gap: space[2] },
  heroTitle: { ...type.h1, color: color.ink },
  heroBody: { ...type.body, color: color.text4 },
  ownerLine: { ...type.small, color: color.text4 },
  legal: { ...type.caption, color: color.text4 },
  ctaRow: { flexDirection: "row", gap: space[2] },
  cta: { flex: 1 },
  plain: {
    marginBottom: space[4],
    padding: space[4],
    gap: space[2],
    borderRadius: radiusTokens.lg,
    backgroundColor: color.fill.tile,
    borderWidth: 1,
    borderColor: color.lineStrong,
  },
  plainHead: { flexDirection: "row", gap: space[2], alignItems: "center" },
  plainCopy: { flex: 1, gap: 2 },
  plainTitle: { ...type.row, color: color.text1, fontWeight: "600" },
  plainBody: { ...type.small, color: color.text2 },
  ownerLineDark: { ...type.small, color: color.text2 },
});
