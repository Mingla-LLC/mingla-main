/**
 * #4111 — the Business app's controller for "Message {Brand}" (buyer web and
 * the Business preview). It owns who is writing and how the message travels:
 *
 *   signed in (web or native)  → RPC brand_enquiry_send (source 'web'), with the
 *                                guest's own plans from brand_enquiry_my_plans
 *   signed out, web            → edge public-brand-enquiry (never a plan)
 *   signed out, native         → a "Sign in to message {Brand}" step; a native
 *                                screen never sends anonymously
 *
 * The caller passes the viewer (so anon routes such as the cancel page never
 * need useAuth) and whatever offerings/venue the page already loaded. The sheet
 * itself is the shared `@mingla/brand-rendering/enquiry/BrandMessageSheet`,
 * loaded lazily on the first Message tap so no page's boot payload grows.
 */
import React, { useCallback, useMemo, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import type { ResolvedTheme } from "@mingla/offering-rendering";
import {
  buildEnquiryTopicGroups,
  type EnquiryEntry,
  type EnquiryOffering,
  type EnquiryPick,
  type EnquiryPrefill,
  type EnquirySendOutcome,
  type EnquirySendRequest,
  type EnquiryVenue,
} from "@mingla/brand-rendering/enquiry/enquiryTopics";
import type {
  BrandMessageSheetProps,
  EnquiryPhoneFieldArgs,
} from "@mingla/brand-rendering/enquiry/BrandMessageSheet";

import { captureWeb } from "../../analytics/webAnalytics";
import { useMyBrandPlans, usePublicBrandEnquiryProfile } from "../../hooks/usePublicBrandEnquiry";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";
import { explorerAppUrl, openExternalUrl, threadPathFromUrl } from "./brandContactLinks";

const BrandMessageSheet = React.lazy<React.ComponentType<BrandMessageSheetProps>>(async () => {
  const module = await import("@mingla/brand-rendering/enquiry/BrandMessageSheet");
  return { default: module.BrandMessageSheet };
});

const LazyEnquiryPhoneField = React.lazy(async () => {
  const module = await import("./EnquiryPhoneField");
  return { default: module.EnquiryPhoneField };
});

export interface BrandMessageTarget {
  id: string;
  name: string;
  slug: string;
  theme: ResolvedTheme;
  /** ISO country the phone picker starts on (brand or venue). */
  countryIso?: string | null;
}

export interface BrandMessageViewer {
  userId: string | null;
  /** Shown in "Sending as {name}." */
  name: string | null;
}

export interface UseBrandMessageInput {
  brand: BrandMessageTarget | null;
  viewer: BrandMessageViewer;
  entry: EnquiryEntry;
  offerings?: ReadonlyArray<EnquiryOffering>;
  venue?: EnquiryVenue | null;
  /** Where sign-in returns to (native signed-out). */
  resumePath?: string;
  onBookTable?: (pick: EnquiryPick) => void;
}

export interface BrandMessageController {
  /** The brand takes enquiries (card / buttons render only when true). */
  available: boolean;
  replyMinutes: number | null;
  open: (prefill?: EnquiryPrefill | null) => void;
  overlays: React.ReactNode;
}

const renderPhone =
  (countryIso: string | null | undefined) =>
  (args: EnquiryPhoneFieldArgs): React.ReactElement => (
    <React.Suspense fallback={<View style={styles.phoneFallback} />}>
      <LazyEnquiryPhoneField {...args} startCountries={[countryIso]} />
    </React.Suspense>
  );

export function useBrandMessage({
  brand,
  viewer,
  entry,
  offerings = [],
  venue = null,
  resumePath,
  onBookTable,
}: UseBrandMessageInput): BrandMessageController {
  const router = useRouter();
  const brandId = brand?.id ?? null;
  const signedIn = viewer.userId !== null;
  const profile = usePublicBrandEnquiryProfile(brandId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [prefill, setPrefill] = useState<EnquiryPrefill | null>(null);
  const plans = useMyBrandPlans(brandId, viewer.userId, signedIn && mounted);

  const available = profile.data?.available === true;
  const groups = useMemo(
    () =>
      brand === null
        ? []
        : buildEnquiryTopicGroups({
            brandName: brand.name,
            signedIn,
            plans: plans.data ?? [],
            offerings,
            venue,
          }),
    [brand, offerings, plans.data, signedIn, venue],
  );

  const open = useCallback(
    (next?: EnquiryPrefill | null): void => {
      if (brand === null || !available) return;
      if (!signedIn && Platform.OS !== "web") {
        setSignInOpen(true);
        return;
      }
      setPrefill(next ?? null);
      setMounted(true);
      setSheetOpen(true);
      captureWeb("brand_message_opened", {
        surface: Platform.OS === "web" ? "buyer_web" : "business_preview",
        brand_id: brand.id,
        entry,
        prefilled: next !== null && next !== undefined,
        signed_in: signedIn,
      });
    },
    [available, brand, entry, signedIn],
  );

  const onSend = useCallback(
    async (request: EnquirySendRequest): Promise<EnquirySendOutcome> => {
      if (brand === null) return { ok: false, message: "We couldn't send that. Try again." };
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

  const overlays =
    brand === null ? null : (
      <>
        {mounted ? (
          <React.Suspense fallback={null}>
            <BrandMessageSheet
              visible={sheetOpen}
              onClose={() => setSheetOpen(false)}
              brandName={brand.name}
              theme={brand.theme}
              groups={groups}
              viewer={signedIn ? { kind: "signed_in", name: viewer.name ?? "your Mingla account" } : { kind: "signed_out_web" }}
              entry={entry}
              prefill={prefill}
              plansState={!signedIn ? "idle" : plans.isError ? "error" : plans.isPending ? "loading" : "ready"}
              onRetryPlans={() => {
                void plans.refetch();
              }}
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
          </React.Suspense>
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

  return {
    available,
    replyMinutes: profile.data?.replyMinutes ?? null,
    open,
    overlays,
  };
}

/** The display name for "Sending as {name}." from a Supabase user. */
export const viewerNameFromUser = (
  user: { email?: string | null; user_metadata?: Record<string, unknown> | null } | null,
): string | null => {
  if (user === null) return null;
  const meta = user.user_metadata ?? {};
  for (const key of ["display_name", "full_name", "name"]) {
    const value = meta[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return typeof user.email === "string" && user.email.length > 0 ? user.email : null;
};

const styles = StyleSheet.create({
  phoneFallback: { minHeight: 48 },
});
