/**
 * /brand/new — full-screen brand setup, step F1 (#4389).
 *
 * One of the two mounts of BrandCreationFlow (the other is
 * /brand/[id]/setup). `?partner_mode=client` keeps the partner client flow.
 * `?resume_brand=` is an alias for /brand/{id}/setup. `?draft=` shows N1
 * ("You have a brand in progress") when the server refused a second brand.
 * #4389 N1 up front: a host who already has a draft sees N1 before typing;
 * `?discard=1` (switcher "Discard draft") opens straight on its confirm.
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
import { canvas, spacing } from "../../src/constants/designSystem";
import { BRAND_SETUP_COPY } from "../../src/components/brand/brandSetupCopy";
import { Toast } from "../../src/components/ui/Toast";
import { useBrandListState } from "../../src/hooks/useBrandListShim";
import { useBrandSetupStates } from "../../src/hooks/useBrandSetupStates";

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
    discard?: string | string[];
  }>();
  const [draftGone, setDraftGone] = useState(false);
  const [discardedName, setDiscardedName] = useState<string | null>(null);
  // #4389 N1 up front — a host with a draft sees "You have a brand in
  // progress" before typing, from every way in (switcher, Ari, Hub).
  const brandList = useBrandListState();
  const brandIds = React.useMemo(() => brandList.brands.map((b) => b.id), [brandList.brands]);
  const setupStates = useBrandSetupStates(brandIds);
  const leave = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home" as never);
  }, [router]);

  const resume = first(params.resume_brand);
  if (resume !== null) return <Redirect href={`/brand/${resume}/setup` as never} />;

  const knownDraftId = setupStates.draftId;
  const knownDraft = brandList.brands.find((b) => b.id === knownDraftId) ?? null;
  const draft = first(params.draft) ?? knownDraft?.id ?? null;
  const draftName = first(params.draft_name) ?? knownDraft?.displayName ?? "";
  const waitingForDrafts =
    first(params.draft) === null &&
    first(params.partner_mode) !== "client" &&
    (brandList.isLoading || setupStates.isLoading);
  const body = first(params.partner_mode) === "client" ? (
    <LazyPartnerClientBrandCreationFlow onComplete={leave} onCancel={leave} />
  ) : draft !== null && !draftGone ? (
    <LazyDraftInProgress
      draftId={draft}
      draftName={draftName}
      startConfirming={first(params.discard) === "1"}
      onContinue={() => router.replace(`/brand/${draft}/setup` as never)}
      onDiscarded={() => {
        setDraftGone(true);
        setDiscardedName(draftName);
      }}
    />
  ) : waitingForDrafts ? null : (
    <LazyBrandCreationFlow brandId={null} onExit={leave} />
  );
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: canvas.discover }}>
      <Suspense fallback={null}>{body}</Suspense>
      {discardedName !== null ? (
        <View style={{ position: "absolute", left: 0, right: 0, top: insets.top + spacing.sm }} pointerEvents="box-none">
          <Toast
            visible
            kind="success"
            message={BRAND_SETUP_COPY.n1.discarded(discardedName)}
            onDismiss={() => setDiscardedName(null)}
          />
        </View>
      ) : null}
    </View>
  );
}
