/**
 * #4111 Wave D — the heavy half of Explorer's "Message {Brand}". Mounted on
 * the first tap by `useExplorerBrandMessage` (signed-in only; the signed-out
 * step never reaches here).
 *
 *   plans      brand_enquiry_my_plans (React Query, signed-in)
 *   offerings  + venue: whatever the opening screen already loaded
 *   send       brand_enquiry_send with p_source 'explorer'
 *   sent       the thread opens (/enquiry/{id}); the sheet closes
 *   shortcuts  Can't find my tickets → Likes → Calendar
 *              Cancel (reservation)  → the existing reservation cancel
 *              Food-order refund     → the order's canonical receipt
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  buildEnquiryTopicGroups,
  type EnquiryEntry,
  type EnquiryOffering,
  type EnquiryPick,
  type EnquirySendOutcome,
  type EnquirySendRequest,
  type EnquiryVenue,
} from "@mingla/brand-rendering/enquiry/enquiryTopics";
import { BrandMessageSheet } from "@mingla/brand-rendering/enquiry/BrandMessageSheet";

import { useMyBrandPlans } from "../../hooks/useBrandEnquiries";
import { cancelMyReservation, myReservationsKeys } from "../../hooks/useMyReservations";
import { brandEnquiryKeys } from "../../hooks/queryKeys";
import { sendExplorerEnquiry } from "../../services/brandEnquiryService";
import { openShellDestination } from "../../services/deepLinkService";
import { postHogService } from "../../services/postHogService";
import { toastManager } from "../ui/Toast";
import type { ExplorerBrandTarget, ExplorerMessageTrigger } from "./useExplorerBrandMessage";

const EMPTY_OFFERINGS: readonly EnquiryOffering[] = [];

export interface ExplorerBrandMessageHostProps {
  brand: ExplorerBrandTarget;
  entry: EnquiryEntry;
  offerings?: readonly EnquiryOffering[];
  venue: EnquiryVenue | null;
  onBookTable?: (pick: EnquiryPick) => void;
  onCancelReservation?: (reservationId: string) => void;
  userId: string;
  viewerName: string;
  /** Each new nonce opens the sheet once. */
  trigger: ExplorerMessageTrigger;
}

export default function ExplorerBrandMessageHost({
  brand,
  entry,
  offerings = EMPTY_OFFERINGS,
  venue,
  onBookTable,
  onCancelReservation,
  userId,
  viewerName,
  trigger,
}: ExplorerBrandMessageHostProps): React.ReactElement {
  const { t } = useTranslation("enquiry");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [visible, setVisible] = useState(false);
  const lastEnquiryId = useRef<string | null>(null);
  const plans = useMyBrandPlans(userId, brand.id);

  useEffect(() => {
    setVisible(true);
  }, [trigger.nonce]);

  const groups = useMemo(
    () =>
      buildEnquiryTopicGroups({
        brandName: brand.name,
        signedIn: true,
        plans: plans.data ?? [],
        offerings,
        venue,
      }),
    [brand.name, offerings, plans.data, venue],
  );

  const onSend = useCallback(
    async (request: EnquirySendRequest): Promise<EnquirySendOutcome> => {
      const result = await sendExplorerEnquiry(brand.id, request);
      lastEnquiryId.current = result.enquiryId;
      if (result.outcome.ok) {
        postHogService.capture("brand_message_sent", {
          surface: "consumer_native",
          brand_id: brand.id,
          entry: request.entry,
          context_kind: request.contextKind,
          reason: request.reason,
          signed_in: true,
        });
      }
      return result.outcome;
    },
    [brand.id],
  );

  const onSent = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: brandEnquiryKeys.list(userId) });
    const enquiryId = lastEnquiryId.current;
    if (enquiryId === null) return;
    router.push(`/enquiry/${encodeURIComponent(enquiryId)}` as never);
  }, [queryClient, router, userId]);

  const close = useCallback(() => setVisible(false), []);

  const openCalendar = useCallback((): void => {
    setVisible(false);
    if (!openShellDestination({ kind: "page", page: "likes", params: { tab: "calendar" } })) {
      toastManager.show(t("enquiry:open_failed", { brand: brand.name }), "error");
    }
  }, [brand.name, t]);

  const cancelReservation = useCallback(
    (pick: EnquiryPick): void => {
      if (pick.contextKind !== "reservation" || pick.contextId === null) return;
      const reservationId = pick.contextId;
      setVisible(false);
      if (onCancelReservation !== undefined) {
        onCancelReservation(reservationId);
        return;
      }
      Alert.alert(t("enquiry:cancel_title"), t("enquiry:cancel_body", { brand: brand.name }), [
        { text: t("enquiry:cancel_keep"), style: "cancel" },
        {
          text: t("enquiry:cancel_confirm"),
          style: "destructive",
          onPress: () => {
            void cancelMyReservation(reservationId)
              .then(async () => {
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: myReservationsKeys.byUser(userId) }),
                  queryClient.invalidateQueries({ queryKey: brandEnquiryKeys.plans(userId, brand.id) }),
                ]);
                toastManager.show(t("enquiry:cancel_done"), "success");
              })
              .catch(() => {
                toastManager.show(t("enquiry:cancel_failed", { brand: brand.name }), "error");
              });
          },
        },
      ]);
    },
    [brand.id, brand.name, onCancelReservation, queryClient, t, userId],
  );

  const requestRefund = useCallback(
    (pick: EnquiryPick): void => {
      if (pick.contextKind !== "venue_order" || pick.contextId === null) return;
      setVisible(false);
      // The canonical receipt for a food order (#4063 Purchases).
      router.push(`/purchases/venue_order/${encodeURIComponent(pick.contextId)}` as never);
    },
    [router],
  );

  return (
    <BrandMessageSheet
      visible={visible}
      onClose={close}
      brandName={brand.name}
      theme={brand.theme}
      groups={groups}
      viewer={{ kind: "signed_in", name: viewerName }}
      entry={entry}
      prefill={trigger.prefill}
      plansState={plans.isError ? "error" : plans.isPending ? "loading" : "ready"}
      onRetryPlans={() => {
        void plans.refetch();
      }}
      onSend={onSend}
      onSent={onSent}
      closeOnSent
      onOpenCalendar={openCalendar}
      onCancelSelf={cancelReservation}
      onRequestRefund={requestRefund}
      onBookTable={
        onBookTable === undefined
          ? undefined
          : (pick) => {
              setVisible(false);
              onBookTable(pick);
            }
      }
      testID="explorer-brand-message-sheet"
    />
  );
}
