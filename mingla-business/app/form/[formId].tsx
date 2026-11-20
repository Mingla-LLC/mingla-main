/**
 * /form/{formId}#t=… — #4514 a brand form's personal link (BUILD CONTRACT v2
 * §5.7). Opened from a text, an email or a push; answerable in any browser.
 *
 * ANON ROUTE: `/form/` is on PUBLIC_BUYER_ROUTE_PREFIXES (coldLoadAuthGates.ts),
 * so the root layout never bounces a guest to sign-in. NO useAuth here or in the
 * screen: the token in the URL FRAGMENT is the only key (a fragment never reaches
 * a server log). The screen loads lazily, so nothing here touches the boot payload.
 */
// orch-strict-grep-allow safearea-on-fullscreen-routes — BrandFormLinkScreen applies useSafeAreaInsets (paddingTop: insets.top on the scroll content, paddingBottom: insets.bottom on the page); the Suspense fallback is a centered spinner.
import React, { Suspense } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { color } from "../../src/constants/designSystem";

const BrandFormLinkScreen = React.lazy(
  () => import("../../src/components/forms/link/BrandFormLinkScreen"),
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function BrandFormLinkRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ formId?: string | string[]; from?: string }>();
  const raw = Array.isArray(params.formId) ? params.formId[0] ?? null : params.formId ?? null;
  const formId = raw !== null && UUID.test(raw) ? raw.toLowerCase() : null;
  return (
    <Suspense
      fallback={
        <View style={styles.loading}>
          <ActivityIndicator color={color.accentText} />
        </View>
      }
    >
      <BrandFormLinkScreen formId={formId} fromPurchase={params.from === "purchase"} />
    </Suspense>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.canvas,
  },
});
