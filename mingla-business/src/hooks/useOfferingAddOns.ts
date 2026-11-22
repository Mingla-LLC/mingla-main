/**
 * issue #3281 S3 — React Query hooks for the Host Add-ons editor.
 *
 * One key per offering (Constitution 4): `offeringAddOnKeys.byEvent(eventId)`.
 * A save writes its answer straight into that key (the RPC returns the fresh
 * list and revision), so there is no refetch race. The sheet owns the
 * user-facing error and, on a PT409, refetches so the host checks the latest.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import type {
  AddOnSaveItem,
  OfferingAddOnsPayload,
} from "../components/addOns/addOnsEditorModel";
import {
  fetchOfferingAddOns,
  saveOfferingAddOns,
  type OfferingAddOnsError,
} from "../services/offeringAddOnsService";

export const offeringAddOnKeys = {
  all: ["offering-add-ons"] as const,
  byEvent: (eventId: string) => ["offering-add-ons", eventId] as const,
};

export const useOfferingAddOns = (
  eventId: string,
): UseQueryResult<OfferingAddOnsPayload, OfferingAddOnsError> =>
  useQuery<OfferingAddOnsPayload, OfferingAddOnsError>({
    queryKey: offeringAddOnKeys.byEvent(eventId),
    queryFn: () => fetchOfferingAddOns(eventId),
    // The editor is open while this is read; a fresh read on every open.
    staleTime: 0,
    retry: (failures, error) => error.code === "unknown" && failures < 2,
  });

export const useSaveOfferingAddOns = (
  eventId: string,
): UseMutationResult<
  OfferingAddOnsPayload,
  OfferingAddOnsError,
  { addOns: AddOnSaveItem[]; expectedRevision: number }
> => {
  const queryClient = useQueryClient();
  return useMutation<
    OfferingAddOnsPayload,
    OfferingAddOnsError,
    { addOns: AddOnSaveItem[]; expectedRevision: number }
  >({
    mutationFn: (input) => saveOfferingAddOns({ eventId, ...input }),
    onSuccess: (payload) => {
      queryClient.setQueryData(offeringAddOnKeys.byEvent(eventId), payload);
    },
  });
};
