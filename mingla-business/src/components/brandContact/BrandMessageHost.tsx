/**
 * #4111 — the heavy half of "Message {Brand}": topic groups, transports, the
 * shared sheet, the signed-in plans loader and the native sign-in step. It is
 * LAZY — `useBrandMessage` mounts it only after the first Message tap, so none
 * of this sits in any page's boot payload (or the shared __common chunk).
 *
 *   signed in (web or native)  → RPC brand_enquiry_send (source 'web'), with the
 *                                guest's own plans from brand_enquiry_my_plans
 *   signed out, web            → edge public-brand-enquiry (never a plan)
 *   signed out, native         → a "Sign in to message {Brand}" step; a native
 *                                screen never sends anonymously
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import {
  buildEnquiryTopicGroups,
  type EnquiryPrefill,
  type EnquirySendOutcome,
  type EnquirySendRequest,
} from "@mingla/brand-rendering/enquiry/enquiryTopics";
// Static on purpose: this host is itself the lazy chunk. Lazy-loading the sheet
// separately would make the topic builder shared by two lazy chunks, which
// Metro hoists into the eager __common chunk.
import {
  BrandMessageSheet,
  type EnquiryPhoneFieldArgs,
} from "@mingla/brand-rendering/enquiry/BrandMessageSheet";

import { captureWeb } from "../../analytics/webAnalytics";
import type { MyBrandPlansState } from "./MyBrandPlansLoader";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";
import { explorerAppUrl, openExternalUrl, threadPathFromUrl } from "./brandContactLinks";
import type { BrandMessageTarget, UseBrandMessageInput } from "./brandMessageTypes";

const MyBrandPlansLoader = React.lazy(() => import("./MyBrandPlansLoader"));

const PLANS_LOADING: MyBrandPlansState = { plans: [], state: "loading", refetch: () => undefined };

const LazyEnquiryPhoneField = React.lazy(async () => {
  const module = await import("./EnquiryPhoneField");
  return { default: module.EnquiryPhoneField };
});

const renderPhone =
  (countryIso: string | null | undefined) =>
  (args: EnquiryPhoneFieldArgs): React.ReactElement => (
    <React.Suspense fallback={<View style={styles.phoneFallback} />}>
      <LazyEnquiryPhoneField {...args} startCountries={[countryIso]} />
    </React.Suspense>
  );

export interface BrandMessageHostProps extends Omit<UseBrandMessageInput, "brand"> {
  brand: BrandMessageTarget;
  /** Each new nonce opens the sheet (or the sign-in step) once. */
  trigger: { nonce: number; prefill: EnquiryPrefill | null };
}

export default function BrandMessageHost({
  brand,
  viewer,
  entry,
  offerings = [],
  venue = null,
  resumePath,
  onBookTable,
  trigger,
}: BrandMessageHostProps): React.ReactElement {
  const router = useRouter();
  const signedIn = viewer.userId !== null;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [prefill, setPrefill] = useState<EnquiryPrefill | null>(null);
  const [plans, setPlans] = useState<MyBrandPlansState>(PLANS_LOADING);

  useEffect(() => {
    if (!signedIn && Platform.OS !== "web") {
      setSignInOpen(true);
      return;
    }
    setPrefill(trigger.prefill);
    setSheetOpen(true);
    // Only a new tap (nonce) re-opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger.nonce]);

  const groups = useMemo(
    () =>
      buildEnquiryTopicGroups({
        brandName: brand.name,
        signedIn,
        plans: plans.plans,
        offerings,
        venue,
      }),
    [brand.name, offerings, plans.plans, signedIn, venue],
  );

  const onSend = useCallback(
    async (request: EnquirySendRequest): Promise<EnquirySendOutcome> => {
      const service = await import("../../services/publicEnquiryService");
      const outcome = signedIn
        ? await service.sendSignedInEnquiry(brand.id, request)
        : await service.sendPublicEnquiry(brand.id, request);
      if (outcome.ok) {
        captureWeb("brand_message_sent", {
          surface: Platform.OS === "web" ? "buyer_web" : "business_preview",
          brand_id: brand.id,
          entry: request.entry,
          context_kind: request.contextKind,
          reason: request.reason,
          signed_in: signedIn,
        });
      }
      return outcome;
    },
    [brand, signedIn],
  );

  const onViewConversation = useCallback(
    (outcome: Extract<EnquirySendOutcome, { ok: true }>): void => {
      const path = threadPathFromUrl(outcome.threadUrl);
      setSheetOpen(false);
      if (path !== null) router.push(path as never);
    },
    [router],
  );

  return (
      <>
        {signedIn ? (
          <React.Suspense fallback={null}>
            <MyBrandPlansLoader brandId={brand.id} onChange={setPlans} />
          </React.Suspense>
        ) : null}
        {signedIn || Platform.OS === "web" ? (
            <BrandMessageSheet
              visible={sheetOpen}
              onClose={() => setSheetOpen(false)}
              brandName={brand.name}
              theme={brand.theme}
              groups={groups}
              viewer={signedIn ? { kind: "signed_in", name: viewer.name ?? "your Mingla account" } : { kind: "signed_out_web" }}
              entry={entry}
              prefill={prefill}
              plansState={!signedIn ? "idle" : plans.state}
              onRetryPlans={plans.refetch}
              onSend={onSend}
              onViewConversation={signedIn ? undefined : onViewConversation}
              onOpenApp={signedIn ? undefined : () => openExternalUrl(explorerAppUrl())}
              onRequestRefund={(pick) => {
                if (pick.contextId === null) return;
                setSheetOpen(false);
                router.push(`/o/venue/${pick.contextId}` as never);
              }}
              onBookTable={
                onBookTable === undefined
                  ? undefined
                  : (pick) => {
                      setSheetOpen(false);
                      onBookTable(pick);
                    }
              }
              renderPhoneField={signedIn ? undefined : renderPhone(brand.countryIso)}
            />
        ) : null}
        <SimpleConfirmDialog
          visible={signInOpen}
          onClose={() => setSignInOpen(false)}
          onConfirm={() => {
            setSignInOpen(false);
            const next = resumePath ?? `/b/${brand.slug}`;
            router.push(`/auth?next=${encodeURIComponent(next)}` as never);
          }}
          title={`Sign in to message ${brand.name}`}
          description={`Sign in so ${brand.name} can reply to you.`}
          confirmLabel="Sign in"
          cancelLabel="Not now"
          testID="brand-message-signin"
        />
      </>
    );
}

const styles = StyleSheet.create({
  phoneFallback: { minHeight: 48 },
});
