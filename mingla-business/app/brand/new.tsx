/**
 * /brand/new — full-screen brand setup, step F1 (#4389).
 *
 * One of the two mounts of BrandCreationFlow (the other is
 * /brand/[id]/setup). `?partner_mode=client` keeps the partner client flow.
 * `?resume_brand=` is an alias for /brand/{id}/setup. `?draft=` shows N1
 * ("You have a brand in progress") when the server refused a second brand.
 */
import React, { Suspense, useCallback, useState } from "react";
import { View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  LazyBrandCreationFlow,
  LazyDraftInProgress,
  LazyPartnerClientBrandCreationFlow,
} from "../../src/components/brand/LazyBrandCreationFlow";
import { canvas } from "../../src/constants/designSystem";

const first = (v: string | string[] | undefined): string | null => {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" && x.length > 0 ? x : null;
};

export default function BrandNewRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    partner_mode?: string | string[];
    resume_brand?: string | string[];
    draft?: string | string[];
    draft_name?: string | string[];
  }>();
  const [draftGone, setDraftGone] = useState(false);
  const leave = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home" as never);
  }, [router]);

  const resume = first(params.resume_brand);
  if (resume !== null) return <Redirect href={`/brand/${resume}/setup` as never} />;

  const draft = first(params.draft);
  const body = first(params.partner_mode) === "client" ? (
    <LazyPartnerClientBrandCreationFlow onComplete={leave} onCancel={leave} />
  ) : draft !== null && !draftGone ? (
    <LazyDraftInProgress
      draftId={draft}
      draftName={first(params.draft_name) ?? ""}
      onContinue={() => router.replace(`/brand/${draft}/setup` as never)}
      onDiscarded={() => setDraftGone(true)}
    />
  ) : (
    <LazyBrandCreationFlow brandId={null} onExit={leave} />
  );
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: canvas.discover }}>
      <Suspense fallback={null}>{body}</Suspense>
    </View>
  );
}
