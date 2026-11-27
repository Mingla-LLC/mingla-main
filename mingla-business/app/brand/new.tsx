/**
 * /brand/new — full-screen brand setup, step F1 (#4389).
 *
 * One of the two mounts of BrandCreationFlow (the other is
 * /brand/[id]/setup). `?partner_mode=client` keeps the partner client flow.
 * `?resume_brand=` is an alias for /brand/{id}/setup. `?draft=` shows N1
 * ("You have a brand in progress") when the server refused a second brand.
 * #4389 N1 up front: a host who already has a draft sees N1 before typing;
 * `?discard=1` (switcher "Discard draft") opens straight on its confirm.
 * #881 kept: a host with partner mode on first says who the brand is for
 * (Step 0 of the partner client flow); "Myself" hands over to the setup.
 * The choice rules live in brandNewEntry.ts (I-881-PARTNER-INTENT).
 */
import React, { Suspense, useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  LazyBrandCreationFlow,
  LazyDraftInProgress,
  LazyPartnerClientBrandCreationFlow,
} from "../../src/components/brand/LazyBrandCreationFlow";

import { BRAND_NEW_COPY } from "../../src/components/brand/brandNewCopy";
import { Toast } from "../../src/components/ui/Toast";
import { useBrandListState } from "../../src/hooks/useBrandListShim";
import { useBrandSetupStates } from "../../src/hooks/useBrandSetupStates";
import { usePartnerStripeStatus } from "../../src/hooks/usePartnerStripe";
import { decideBrandNewEntry } from "../../src/components/brand/brandNewEntry";
import { setupFlowHop } from "../../src/services/brandSetupCore";

import { color, space } from "../../src/constants/designSystem";
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
  const [closedDraftId, setClosedDraftId] = useState<string | null>(null);
  const [discardedName, setDiscardedName] = useState<string | null>(null);
  // #4389 N1 up front — a host with a draft sees "You have a brand in
  // progress" before typing, from every way in (switcher, Ari, Hub).
  const brandList = useBrandListState();
  const setupStates = useBrandSetupStates(brandList.brands);
  // #881 — partner intent (Step 0) before the self setup.
  const partnerStatus = usePartnerStripeStatus();
  const [selfTyped, setSelfTyped] = useState(false);
  const [selfChosen, setSelfChosen] = useState(false);
  const [intentShown, setIntentShown] = useState(false);
  const onTypedNameChange = useCallback((typed: string): void => {
    setSelfTyped(typed.length > 0);
  }, []);
  const chooseSelf = useCallback((): void => setSelfChosen(true), []);
  const entry = decideBrandNewEntry({
    partnerModeParam: first(params.partner_mode),
    partnerEnabled: partnerStatus.isError ? null : partnerStatus.data?.partner_enabled ?? null,
    selfTyped,
    selfChosen,
    intentShown,
  });
  useEffect(() => {
    if (entry === "partner-intent" && !intentShown) setIntentShown(true);
  }, [entry, intentShown]);
  // #3645 kept: once a flow is on screen, a brand-list change never swaps it
  // out. Creating the first brand makes the list hold a draft (the brand just
  // created) and can refetch; without this latch N1 or the loading gap would
  // replace the flow mid-setup. N1 up front is decided at open only.
  const [flowOpened, setFlowOpened] = useState(false);
  const leave = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home" as never);
  }, [router]);

  const resume = first(params.resume_brand);
  const requestedDraftId = first(params.draft);
  const knownDraft =
    brandList.brands.find((b) => b.id === (flowOpened ? null : setupStates.draftId)) ?? null;
  const draftName = knownDraft?.displayName;
  // #4627 — a direct/server draft hint that the list-wide reader missed is
  // validated inside the already-lazy setup chunk. A rejected teammate/stale
  // hint falls through to F1 and never reaches N1 or discard.
  const guardedDraftId =
    knownDraft?.id ?? (requestedDraftId !== closedDraftId ? requestedDraftId : null);
  const showingDraft = guardedDraftId !== null && guardedDraftId !== closedDraftId;
  const waitingForDrafts =
    !flowOpened &&
    first(params.partner_mode) !== "client" &&
    (brandList.isLoading || setupStates.isLoading);
  const body = entry === "client" ? (
    <LazyPartnerClientBrandCreationFlow onComplete={leave} onCancel={leave} />
  ) : showingDraft ? (
    <LazyDraftInProgress
      draftId={guardedDraftId}
      draftName={draftName}
      startConfirming={first(params.discard) === "1" && requestedDraftId === guardedDraftId}
      onContinue={() => router.replace(`/brand/${guardedDraftId}/setup` as never)}
      onDiscarded={(name) => {
        setClosedDraftId(guardedDraftId);
        setDiscardedName(name);
      }}
      onRejected={() => setClosedDraftId(guardedDraftId)}
    />
  ) : waitingForDrafts || resume !== null ? null : entry === "partner-intent" ? (
    <LazyPartnerClientBrandCreationFlow onComplete={leave} onCancel={leave} onSelfChosen={chooseSelf} />
  ) : (
    <LazyBrandCreationFlow brandId={null} onExit={leave} onTypedNameChange={onTypedNameChange} />
  );
  const showsFlow = body !== null && !showingDraft;
  useEffect(() => {
    if (showsFlow && !flowOpened) setFlowOpened(true);
  }, [showsFlow, flowOpened]);

  // The web bank-setup return (`resume_brand`) is a hop inside the setup.
  if (resume !== null) return <Redirect href={setupFlowHop(`/brand/${resume}/setup`) as never} />;
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: color.canvas }}>
      <Suspense fallback={null}>{body}</Suspense>
      {discardedName !== null ? (
        <View style={{ position: "absolute", left: 0, right: 0, top: insets.top + space[2] }} pointerEvents="box-none">
          <Toast
            visible
            kind="success"
            message={BRAND_NEW_COPY.n1.discarded(discardedName)}
            onDismiss={() => setDiscardedName(null)}
          />
        </View>
      ) : null}
    </View>
  );
}
