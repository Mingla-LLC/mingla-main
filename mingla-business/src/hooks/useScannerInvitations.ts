/**
 * useScannerInvitations / mutations (ORCH-1051).
 *
 * React Query layer for the scanner-team invite flow. Replaces the
 * [TRANSITIONAL] zustand-only reads (exit condition: ORCH-1051 — now React Query). Const #5: server state lives in
 * React Query, never Zustand.
 *
 * Cache invalidation rules:
 *   - inviteScanner success → invalidate the matching list cache (brand or
 *     event scope)
 *   - revokeScannerInvitation success → invalidate the matching list cache
 *   - acceptScannerInvitation success → invalidate brand list + (when
 *     scope=event) event list + brand-role cache
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  acceptScannerInvitation,
  inviteScanner,
  listScannerInvitationsForBrand,
  listScannerInvitationsForEvent,
  revokeScannerInvitation,
  scannerInvitationKeys,
  type AcceptScannerInvitationResult,
  type InviteScannerInput,
  type InviteScannerResult,
  type ScannerInvitationRow,
} from "../services/scannerInvitationsService";
import { brandRoleKeys } from "./useCurrentBrandRole";

const STALE_TIME_MS = 30 * 1000;

export const useScannerInvitationsForBrand = (
  brandId: string | null,
): UseQueryResult<ScannerInvitationRow[]> => {
  return useQuery<ScannerInvitationRow[]>({
    queryKey: brandId !== null
      ? scannerInvitationKeys.listByBrand(brandId)
      : ["scanner-invitations-brand-disabled"],
    enabled: brandId !== null,
    staleTime: STALE_TIME_MS,
    queryFn: () => listScannerInvitationsForBrand(brandId as string),
  });
};

export const useScannerInvitationsForEvent = (
  eventId: string | null,
): UseQueryResult<ScannerInvitationRow[]> => {
  return useQuery<ScannerInvitationRow[]>({
    queryKey: eventId !== null
      ? scannerInvitationKeys.listByEvent(eventId)
      : ["scanner-invitations-event-disabled"],
    enabled: eventId !== null,
    staleTime: STALE_TIME_MS,
    queryFn: () => listScannerInvitationsForEvent(eventId as string),
  });
};

export const useInviteScanner = (): {
  mutateAsync: (input: InviteScannerInput) => Promise<InviteScannerResult>;
  isPending: boolean;
} => {
  const qc = useQueryClient();
  const mutation = useMutation<
    InviteScannerResult,
    Error,
    InviteScannerInput
  >({
    mutationFn: (input) => inviteScanner(input),
    onSuccess: (_result, input) => {
      qc.invalidateQueries({
        queryKey: scannerInvitationKeys.listByBrand(input.brandId),
      });
      if (input.scope === "event" && input.eventId) {
        qc.invalidateQueries({
          queryKey: scannerInvitationKeys.listByEvent(input.eventId),
        });
      }
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};

export const useRevokeScannerInvitation = (opts: {
  brandId: string | null;
  eventId: string | null;
}): {
  mutateAsync: (invitationId: string) => Promise<void>;
  isPending: boolean;
} => {
  const qc = useQueryClient();
  const mutation = useMutation<void, Error, string>({
    mutationFn: (invitationId) => revokeScannerInvitation(invitationId),
    onSuccess: () => {
      if (opts.brandId !== null) {
        qc.invalidateQueries({
          queryKey: scannerInvitationKeys.listByBrand(opts.brandId),
        });
      }
      if (opts.eventId !== null) {
        qc.invalidateQueries({
          queryKey: scannerInvitationKeys.listByEvent(opts.eventId),
        });
      }
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};

export const useAcceptScannerInvitation = (): {
  mutateAsync: (token: string) => Promise<AcceptScannerInvitationResult>;
  isPending: boolean;
} => {
  const qc = useQueryClient();
  const mutation = useMutation<AcceptScannerInvitationResult, Error, string>({
    mutationFn: (token) => acceptScannerInvitation(token),
    onSuccess: (result) => {
      qc.invalidateQueries({
        queryKey: scannerInvitationKeys.listByBrand(result.brandId),
      });
      if (result.scope === "event" && result.eventId) {
        qc.invalidateQueries({
          queryKey: scannerInvitationKeys.listByEvent(result.eventId),
        });
      }
      qc.invalidateQueries({
        queryKey: brandRoleKeys.allForBrand(result.brandId),
      });
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};
