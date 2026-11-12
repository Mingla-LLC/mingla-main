/**
 * #4389 — F4's "Tap to Pay on iPhone" card. It lives in the door card-sale
 * chunk (doorSaleScreens.ts, loaded through LazyDoorSaleScreens) because it
 * reads the same Tap to Pay release, device and setup-hint modules as the
 * door screens; loading it on F4 keeps them out of the eager web __common.
 *
 *   - not on for this phone and brand: Apple's art (a 186pt cropped band),
 *     the pitch and "Set up Tap to Pay on iPhone";
 *   - on: "Tap to Pay on iPhone · On", with "Take a payment" only when an
 *     event is on now.
 */
import React, { useEffect, useState } from "react";
import { Image, Platform, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { radius, spacing, text as textTokens, typography } from "../../../constants/designSystem";
import { useTapToPayOnForBrand } from "../../../hooks/useTapToPayAvailability";
import { useTapToPaySettingsEntry } from "../../../hooks/useTapToPaySettingsEntry";
import { tapToPayBrandEligible } from "../../../utils/tapToPayBrandEligible";
import { BRAND_SETUP_COPY as C } from "../../brand/brandSetupCopy";
import { Button } from "../../ui/Button";

/** #4389 design .ttph .vis: a 186pt band; the 720×559 art is 330pt wide, cropped. */
export const TTP_BAND_HEIGHT = 186;
export const TTP_ART_WIDTH = 330;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TTP_VISUAL: number | null = (() => {
  try {
    return require("../../../../assets/tap-to-pay/ttp-visual.png") as number;
  } catch {
    // A plain node test run has no asset transform; the card draws without art.
    return null;
  }
})();

export interface F4TapToPayCardProps {
  brandId: string;
  provider: "stripe" | "paystack";
  country: string | null;
}

export const F4TapToPayCard: React.FC<F4TapToPayCardProps> = ({ brandId, provider, country }) => {
  const router = useRouter();
  const entry = useTapToPaySettingsEntry(brandId);
  const show = Platform.OS === "ios" && entry !== null &&
    tapToPayBrandEligible({ paymentProvider: provider, payoutCountry: country });
  const on = useTapToPayOnForBrand(show ? brandId : null);
  const [canTakePayment, setCanTakePayment] = useState(false);
  useEffect(() => {
    if (!on) return undefined;
    let alive = true;
    // openDoorSale (and the event list it reads) loads on use, as on Home.
    void import("../../../utils/openDoorSale")
      .then(({ hasDoorSaleEvent }) => hasDoorSaleEvent(brandId))
      .then((has) => {
        if (alive) setCanTakePayment(has);
      })
      .catch((error: unknown) => console.warn("[F4TapToPayCard] could not read events for Take a payment", error));
    return () => {
      alive = false;
    };
  }, [on, brandId]);

  if (!show) return null;
  return (
    <View style={styles.card} testID="brand-setup-ttp-card">
      {/* Apple's in-app tile visual (Tap to Pay on iPhone marketing art). */}
      {TTP_VISUAL !== null ? (
        // #4389 — a short cropped band (design: 186pt), never the full-height art.
        <View style={styles.band} testID="brand-setup-ttp-band">
          <Image source={TTP_VISUAL} style={styles.visual} resizeMode="cover" accessible={false} />
        </View>
      ) : null}
      {on ? (
        // #4389 — on for this brand on this phone: the ready state, never "Set up" again.
        <>
          <Text style={styles.title} numberOfLines={1} testID="brand-setup-ttp-on">{C.f4.ttpOn}</Text>
          {canTakePayment ? (
            <Button
              label={C.f4.takePayment}
              onPress={() => {
                void import("../../../utils/openDoorSale")
                  .then(({ openDoorSale }) => openDoorSale(router, brandId, null, { source: "brand_setup" }))
                  .catch((error: unknown) => console.warn("[F4TapToPayCard] Take a payment failed to open", error));
              }}
              variant="primary"
              size="md"
              fullWidth
              testID="brand-setup-ttp-take-payment"
            />
          ) : null}
        </>
      ) : (
        <>
          <Text style={styles.title} numberOfLines={1}>{C.f4.ttpTitle}</Text>
          <Text style={styles.body}>{C.f4.ttpBody}</Text>
          <Text style={styles.helper}>{C.f4.ttpTerms}</Text>
          <Button
            label={C.f4.ttpCta}
            onPress={() => router.push(`/account/tap-to-pay?brandId=${encodeURIComponent(brandId)}` as never)}
            variant="primary"
            size="md"
            fullWidth
            testID="brand-setup-ttp-setup"
          />
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { marginTop: spacing.md, padding: spacing.md, gap: spacing.sm, borderRadius: radius.lg, backgroundColor: "rgba(255,255,255,0.06)", overflow: "hidden" },
  band: { height: TTP_BAND_HEIGHT, overflow: "hidden", borderRadius: radius.md },
  visual: { position: "absolute", right: -26, top: -6, width: TTP_ART_WIDTH, height: TTP_ART_WIDTH * (559 / 720) },
  title: { ...typography.h3, color: textTokens.primary },
  body: { ...typography.body, color: textTokens.primary },
  helper: { ...typography.bodySm, color: textTokens.tertiary },
});

export default F4TapToPayCard;
