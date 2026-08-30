import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as React from "react";
import { useAuth } from "../../context/AuthContext";
import { ensureSecureRandom } from "../../lib/secureRandomSafe";
import {
  getBrandPersonMaintenanceOperation,
  listBrandPersonMergeCandidates,
  listBrandPersonMergeHistory,
  mergeBrandPeople,
  PeopleServiceError,
  previewBrandPersonMerge,
  previewBrandPersonSplit,
  promoteBrandPersonContact,
  splitBrandPersonMerge,
} from "../../services/peopleService";
import type {
  BrandPersonMaintenanceOperation,
  BrandPersonMergeResult,
  BrandPersonPromoteResult,
  BrandPersonSplitResult,
} from "../../types/people";
import { marketingKeys } from "./marketingKeys";

const queryRetry = (count: number, error: Error): boolean =>
  count < 2 && error instanceof PeopleServiceError && error.retryable;

export function createMaintenanceRequestId(): string {
  ensureSecureRandom();
  const cryptoValue = (globalThis as {
    crypto?: {
      randomUUID?: () => string;
      getRandomValues?: <T extends ArrayBufferView | null>(array: T) => T;
    };
  }).crypto;
  if (typeof cryptoValue?.randomUUID === "function") {
    return cryptoValue.randomUUID();
  }
  if (typeof cryptoValue?.getRandomValues !== "function") {
    throw new Error("secure_random_unavailable");
  }
  const bytes = cryptoValue.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${
    hex.slice(6, 8).join("")
  }-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export function stableMaintenanceRequestId(
  requests: Map<string, string>,
  intentKey: string,
): string {
  const existing = requests.get(intentKey);
  if (existing) return existing;
  const created = createMaintenanceRequestId();
  requests.set(intentKey, created);
  return created;
}

export interface UseBrandPersonMaintenanceInput {
  brandId: string | null;
  personId: string | null;
  roleResolved: boolean;
  accepted: boolean;
  rank: number;
  online: boolean;
  candidateSearch: string;
  pickerOpen: boolean;
  mergeReviewOpen: boolean;
  selectedPersonId: string | null;
  historyEnabled: boolean;
  splitOpen: boolean;
  splitMergeEventId: string | null;
}

export function useBrandPersonMaintenance(
  input: UseBrandPersonMaintenanceInput,
) {
  const { isAuthReady, user } = useAuth();
  const queryClient = useQueryClient();
  const maintenanceRequestIdsRef = React.useRef<Map<string, string>>(new Map());
  const readAllowed = input.roleResolved && input.accepted && input.rank >= 20;
  const mergeAllowed = readAllowed && input.rank >= 50;
  const authenticated = isAuthReady && user !== null && input.brandId !== null;
  const readEnabled = authenticated && readAllowed;
  const mergeEnabled = authenticated && mergeAllowed;

  React.useEffect(() => {
    if (input.brandId === null || (readEnabled && input.accepted)) return;
    void queryClient.cancelQueries({
      queryKey: marketingKeys.people.all(input.brandId),
    });
    queryClient.removeQueries({
      queryKey: marketingKeys.people.all(input.brandId),
    });
    maintenanceRequestIdsRef.current.clear();
  }, [input.accepted, input.brandId, queryClient, readEnabled]);

  const candidates = useInfiniteQuery({
    queryKey: input.brandId && input.personId
      ? marketingKeys.people.mergeCandidates(
        input.brandId,
        input.personId,
        input.candidateSearch,
      )
      : marketingKeys.all,
    queryFn: ({ pageParam }) =>
      listBrandPersonMergeCandidates({
        brandId: input.brandId!,
        personId: input.personId!,
        search: input.candidateSearch.trim() || null,
        cursor: pageParam,
        limit: 50,
      }),
    initialPageParam: null as { updatedAt: string; personId: string } | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: mergeEnabled && input.pickerOpen && input.online
      && input.personId !== null,
    staleTime: 15_000,
    retry: queryRetry,
  });

  const mergePreview = useQuery({
    queryKey: input.brandId && input.personId && input.selectedPersonId
      ? marketingKeys.people.mergePreview(
        input.brandId,
        input.personId,
        input.selectedPersonId,
      )
      : marketingKeys.all,
    queryFn: () =>
      previewBrandPersonMerge({
        brandId: input.brandId!,
        leftPersonId: input.personId!,
        rightPersonId: input.selectedPersonId!,
      }),
    enabled: mergeEnabled && input.mergeReviewOpen && input.online
      && input.personId !== null && input.selectedPersonId !== null,
    staleTime: 0,
    retry: queryRetry,
  });

  const history = useInfiniteQuery({
    queryKey: input.brandId && input.personId
      ? marketingKeys.people.mergeHistory(input.brandId, input.personId)
      : marketingKeys.all,
    queryFn: ({ pageParam }) =>
      listBrandPersonMergeHistory({
        brandId: input.brandId!,
        personId: input.personId!,
        cursor: pageParam,
        limit: 20,
      }),
    initialPageParam: null as { createdAt: string; mergeEventId: string } | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: readEnabled && input.historyEnabled && input.personId !== null,
    staleTime: 30_000,
    retry: queryRetry,
  });

  const splitPreview = useQuery({
    queryKey: input.brandId && input.splitMergeEventId
      ? [
        ...marketingKeys.people.mergeHistory(input.brandId, input.personId ?? ""),
        "split-preview",
        input.splitMergeEventId,
      ] as const
      : marketingKeys.all,
    queryFn: () =>
      previewBrandPersonSplit({
        brandId: input.brandId!,
        mergeEventId: input.splitMergeEventId!,
      }),
    enabled: mergeEnabled && input.splitOpen && input.online
      && input.splitMergeEventId !== null,
    staleTime: 0,
    retry: queryRetry,
  });

  const invalidateMaintenance = React.useCallback(async (): Promise<void> => {
    if (!input.brandId) return;
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: marketingKeys.people.all(input.brandId),
      }),
      queryClient.invalidateQueries({
        queryKey: marketingKeys.audiences.book(input.brandId),
      }),
    ]);
  }, [input.brandId, queryClient]);

  const recover = React.useCallback(async <T extends BrandPersonMaintenanceOperation>(
    requestId: string,
    run: () => Promise<T>,
  ): Promise<T> => {
    if (!input.brandId) throw new PeopleServiceError("people_forbidden", false);
    if (!input.online) {
      throw new PeopleServiceError("people_temporarily_unavailable", true);
    }
    try {
      return await run();
    } catch (caught) {
      if (!(caught instanceof PeopleServiceError) || !caught.retryable) throw caught;
      try {
        return await getBrandPersonMaintenanceOperation({
          brandId: input.brandId,
          clientRequestId: requestId,
        }) as T;
      } catch {
        throw caught;
      }
    }
  }, [input.brandId, input.online]);

  const merge = useMutation({
    mutationFn: async (variables: {
      intentKey: string;
      winnerPersonId: string;
      loserPersonId: string;
      winnerVersion: string;
      loserVersion: string;
    }): Promise<BrandPersonMergeResult> => {
      const clientRequestId = stableMaintenanceRequestId(
        maintenanceRequestIdsRef.current,
        `merge:${variables.intentKey}`,
      );
      return recover(clientRequestId, () =>
        mergeBrandPeople({
          brandId: input.brandId!,
          ...variables,
          clientRequestId,
        }));
    },
    retry: false,
    onSuccess: invalidateMaintenance,
  });

  const promote = useMutation({
    mutationFn: async (variables: {
      intentKey: string;
      personId: string;
      contactMethodId: string;
      personVersion: string;
    }): Promise<BrandPersonPromoteResult> => {
      const clientRequestId = stableMaintenanceRequestId(
        maintenanceRequestIdsRef.current,
        `promote:${variables.intentKey}`,
      );
      return recover(clientRequestId, () =>
        promoteBrandPersonContact({
          brandId: input.brandId!,
          ...variables,
          clientRequestId,
        }));
    },
    retry: false,
    onSuccess: invalidateMaintenance,
  });

  const split = useMutation({
    mutationFn: async (variables: {
      intentKey: string;
      mergeEventId: string;
      splitVersion: string;
    }): Promise<BrandPersonSplitResult> => {
      const clientRequestId = stableMaintenanceRequestId(
        maintenanceRequestIdsRef.current,
        `split:${variables.intentKey}`,
      );
      return recover(clientRequestId, () =>
        splitBrandPersonMerge({
          brandId: input.brandId!,
          ...variables,
          clientRequestId,
        }));
    },
    retry: false,
    onSuccess: invalidateMaintenance,
  });

  const clearIntent = React.useCallback((intentKey: string): void => {
    maintenanceRequestIdsRef.current.delete(intentKey);
  }, []);

  return {
    candidates,
    candidateRows: candidates.data?.pages.flatMap((page) => page.rows) ?? [],
    mergePreview,
    history,
    historyRows: history.data?.pages.flatMap((page) => page.rows) ?? [],
    splitPreview,
    merge,
    promote,
    split,
    canRead: readEnabled,
    canMerge: mergeEnabled,
    mutationAllowed: input.online && readEnabled,
    clearIntent,
  };
}
