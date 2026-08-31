import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as React from "react";
import { useAuth } from "../../context/AuthContext";
import { ensureSecureRandom } from "../../lib/secureRandomSafe";
import {
  PeopleServiceError,
} from "../../services/peopleService";
import {
  getBrandPersonMaintenanceOperation,
  listBrandPersonMergeCandidates,
  listBrandPersonMergeHistory,
  mergeBrandPeople,
  previewBrandPersonMerge,
  previewBrandPersonSplit,
  promoteBrandPersonContact,
  splitBrandPersonMerge,
} from "../../services/peopleMaintenanceService";
import type {
  BrandPersonMaintenanceOperation,
  BrandPersonMergeResult,
  BrandPersonPromoteResult,
  BrandPersonSplitResult,
} from "../../types/people";
import { marketingKeys } from "./marketingKeys";

const queryRetry = (count: number, error: Error): boolean =>
  count < 2 && error instanceof PeopleServiceError && error.retryable;

const RECOVERY_VERSION = 1 as const;
const RECOVERY_TTL_MS = 24 * 60 * 60 * 1000;
const RECOVERY_MAX_PER_SCOPE = 10;
const RECOVERY_KEY_PREFIX = "mingla:brand-person-maintenance:v1";

export type MaintenanceOperationKind = "merge" | "promote" | "split";
export type MaintenanceRecoveryState =
  | "loading"
  | "ready"
  | "retry_available"
  | "check_again"
  | "storage_blocked"
  | "receipt";

export interface PersistedMaintenanceIntent {
  version: typeof RECOVERY_VERSION;
  actorId: string;
  brandId: string;
  operationKind: MaintenanceOperationKind;
  intentKey: string;
  clientRequestId: string;
  createdAt: number;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function recoveryStorageKey(actorId: string, brandId: string): string {
  return `${RECOVERY_KEY_PREFIX}:${actorId}:${brandId}`;
}

function isPersistedIntent(
  value: unknown,
): value is PersistedMaintenanceIntent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return Object.keys(entry).length === 7 && entry.version === RECOVERY_VERSION &&
    typeof entry.actorId === "string" && entry.actorId.length > 0 &&
    typeof entry.brandId === "string" && entry.brandId.length > 0 &&
    (entry.operationKind === "merge" || entry.operationKind === "promote" ||
      entry.operationKind === "split") &&
    typeof entry.intentKey === "string" && entry.intentKey.length > 0 &&
    entry.intentKey.length <= 512 &&
    typeof entry.clientRequestId === "string" &&
    UUID_PATTERN.test(entry.clientRequestId) &&
    typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt);
}

export function parsePersistedMaintenanceIntents(
  raw: string | null,
  actorId: string,
  brandId: string,
  now = Date.now(),
): { entries: PersistedMaintenanceIntent[]; dirty: boolean } {
  if (raw === null) return { entries: [], dirty: false };
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { entries: [], dirty: true };
  }
  if (!Array.isArray(decoded)) return { entries: [], dirty: true };
  let dirty = false;
  const byIntent = new Map<string, PersistedMaintenanceIntent>();
  for (const value of decoded) {
    if (!isPersistedIntent(value) || value.actorId !== actorId ||
      value.brandId !== brandId || value.createdAt > now ||
      now - value.createdAt >= RECOVERY_TTL_MS) {
      dirty = true;
      continue;
    }
    const prior = byIntent.get(value.intentKey);
    if (!prior || value.createdAt > prior.createdAt) {
      if (prior) dirty = true;
      byIntent.set(value.intentKey, value);
    } else {
      dirty = true;
    }
  }
  const entries = [...byIntent.values()].sort((left, right) =>
    right.createdAt - left.createdAt
  ).slice(0, RECOVERY_MAX_PER_SCOPE);
  if (entries.length !== byIntent.size) dirty = true;
  return { entries, dirty };
}

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
  const enabledRead = isAuthReady && user !== null && input.brandId !== null &&
    input.roleResolved && input.accepted && input.rank >= 20;
  const enabledMerge = isAuthReady && user !== null && input.brandId !== null &&
    input.roleResolved && input.accepted && input.rank >= 50;
  const [recoveryState, setRecoveryState] = React.useState<MaintenanceRecoveryState>(
    "loading",
  );
  const [recoveredOperation, setRecoveredOperation] = React.useState<
    BrandPersonMaintenanceOperation | null
  >(null);
  const [recoveredIntentKey, setRecoveredIntentKey] = React.useState<string | null>(
    null,
  );
  const [recoveredOperationKind, setRecoveredOperationKind] = React.useState<
    MaintenanceOperationKind | null
  >(null);
  const [recoveryEpoch, setRecoveryEpoch] = React.useState(0);
  const priorRecoveryKeyRef = React.useRef<string | null>(null);

  const writeRecoveryEntries = React.useCallback(async (
    key: string,
    entries: PersistedMaintenanceIntent[],
  ): Promise<void> => {
    if (entries.length === 0) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, JSON.stringify(entries));
  }, []);

  React.useEffect(() => {
    let active = true;
    const clearPriorScope = async (): Promise<void> => {
      const priorKey = priorRecoveryKeyRef.current;
      priorRecoveryKeyRef.current = null;
      maintenanceRequestIdsRef.current.clear();
      setRecoveredOperation(null);
      setRecoveredIntentKey(null);
      setRecoveredOperationKind(null);
      if (priorKey) await AsyncStorage.removeItem(priorKey);
    };
    const hydrate = async (): Promise<void> => {
      if (!isAuthReady || !input.roleResolved) {
        if (active) setRecoveryState("loading");
        return;
      }
      if (
        user === null || input.brandId === null || !input.accepted ||
        input.rank < 20
      ) {
        try {
          await clearPriorScope();
          if (active) setRecoveryState("ready");
        } catch {
          if (active) setRecoveryState("storage_blocked");
        }
        return;
      }
      const key = recoveryStorageKey(user.id, input.brandId);
      if (
        priorRecoveryKeyRef.current !== null &&
        priorRecoveryKeyRef.current !== key
      ) {
        try {
          await AsyncStorage.removeItem(priorRecoveryKeyRef.current);
        } catch {
          if (active) setRecoveryState("storage_blocked");
          return;
        }
      }
      priorRecoveryKeyRef.current = key;
      if (active) {
        setRecoveryState("loading");
        setRecoveredOperation(null);
        setRecoveredIntentKey(null);
        setRecoveredOperationKind(null);
      }
      try {
        const parsed = parsePersistedMaintenanceIntents(
          await AsyncStorage.getItem(key),
          user.id,
          input.brandId,
        );
        const entries = parsed.entries.filter((entry) => {
          const allowed = entry.operationKind === "promote" || input.rank >= 50;
          if (!allowed) return false;
          maintenanceRequestIdsRef.current.set(
            entry.intentKey,
            entry.clientRequestId,
          );
          return true;
        });
        if (parsed.dirty || entries.length !== parsed.entries.length) {
          await writeRecoveryEntries(key, entries);
        }
        if (!active) return;
        if (entries.length === 0) {
          setRecoveryState("ready");
          return;
        }
        if (!input.online) {
          setRecoveryState("check_again");
          return;
        }
        let retryEntry: PersistedMaintenanceIntent | null = null;
        for (const entry of entries) {
          try {
            const operation = await getBrandPersonMaintenanceOperation({
              brandId: input.brandId,
              clientRequestId: entry.clientRequestId,
            });
            if (!active) return;
            setRecoveredOperation(operation);
            setRecoveredIntentKey(entry.intentKey);
            setRecoveredOperationKind(entry.operationKind);
            setRecoveryState("receipt");
            return;
          } catch (caught) {
            if (!active) return;
            if (
              caught instanceof PeopleServiceError &&
              caught.code === "people_not_found"
            ) {
              retryEntry ??= entry;
              continue;
            }
            if (active) setRecoveryState("check_again");
            return;
          }
        }
        if (active) {
          setRecoveredIntentKey(retryEntry?.intentKey ?? null);
          setRecoveredOperationKind(retryEntry?.operationKind ?? null);
          setRecoveryState(retryEntry ? "retry_available" : "ready");
        }
      } catch {
        if (active) setRecoveryState("storage_blocked");
      }
    };
    void hydrate();
    return () => {
      active = false;
    };
  }, [
    input.accepted,
    input.brandId,
    input.online,
    input.rank,
    input.roleResolved,
    isAuthReady,
    recoveryEpoch,
    user,
    writeRecoveryEntries,
  ]);

  React.useEffect(() => {
    if (input.brandId === null || (enabledRead && input.accepted)) return;
    void queryClient.cancelQueries({
      queryKey: marketingKeys.people.all(input.brandId),
    });
    queryClient.removeQueries({
      queryKey: marketingKeys.people.all(input.brandId),
    });
  }, [enabledRead, input.accepted, input.brandId, queryClient]);

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
    enabled: enabledMerge && input.pickerOpen && input.online
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
    enabled: enabledMerge && input.mergeReviewOpen && input.online
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
    enabled: enabledRead && input.historyEnabled && input.online &&
      input.personId !== null,
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
    enabled: enabledMerge && input.splitOpen && input.online
      && input.splitMergeEventId !== null,
    staleTime: 0,
    retry: queryRetry,
  });

  const invalidateMaintenance = React.useCallback(async (
    refetchType: "active" | "none" = "active",
  ): Promise<void> => {
    if (!input.brandId) return;
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: marketingKeys.people.all(input.brandId),
        refetchType,
      }),
      queryClient.invalidateQueries({
        queryKey: marketingKeys.audiences.book(input.brandId),
        refetchType,
      }),
    ]);
  }, [input.brandId, queryClient]);

  const removePersistedIntent = React.useCallback(async (
    intentKey: string,
  ): Promise<void> => {
    if (user === null || input.brandId === null) {
      throw new PeopleServiceError("people_forbidden", false);
    }
    const key = recoveryStorageKey(user.id, input.brandId);
    try {
      const parsed = parsePersistedMaintenanceIntents(
        await AsyncStorage.getItem(key),
        user.id,
        input.brandId,
      );
      const entries = parsed.entries.filter((entry) => entry.intentKey !== intentKey);
      await writeRecoveryEntries(key, entries);
      maintenanceRequestIdsRef.current.delete(intentKey);
      if (recoveredIntentKey === intentKey) {
        setRecoveredOperation(null);
        setRecoveredIntentKey(null);
        setRecoveredOperationKind(null);
      }
      if (entries.length === 0) setRecoveryState("ready");
      else {
        setRecoveryState("loading");
        setRecoveryEpoch((value) => value + 1);
      }
    } catch {
      setRecoveryState("storage_blocked");
      throw new PeopleServiceError("people_temporarily_unavailable", true);
    }
  }, [
    input.brandId,
    recoveredIntentKey,
    user,
    writeRecoveryEntries,
  ]);

  const persistIntent = React.useCallback(async (
    operationKind: MaintenanceOperationKind,
    intentKey: string,
    clientRequestId: string,
  ): Promise<void> => {
    const operationAllowed = operationKind === "promote" ? enabledRead : enabledMerge;
    if (!operationAllowed || !input.online || user === null || input.brandId === null) {
      throw new PeopleServiceError(
        input.online ? "people_forbidden" : "people_temporarily_unavailable",
        !input.online,
      );
    }
    if (recoveryState !== "ready" && recoveryState !== "retry_available") {
      throw new PeopleServiceError("people_temporarily_unavailable", true);
    }
    const key = recoveryStorageKey(user.id, input.brandId);
    try {
      const parsed = parsePersistedMaintenanceIntents(
        await AsyncStorage.getItem(key),
        user.id,
        input.brandId,
      );
      const next: PersistedMaintenanceIntent = {
        version: RECOVERY_VERSION,
        actorId: user.id,
        brandId: input.brandId,
        operationKind,
        intentKey,
        clientRequestId,
        createdAt: Date.now(),
      };
      const entries = [
        next,
        ...parsed.entries.filter((entry) => entry.intentKey !== intentKey),
      ].sort((left, right) => right.createdAt - left.createdAt).slice(
        0,
        RECOVERY_MAX_PER_SCOPE,
      );
      await writeRecoveryEntries(key, entries);
    } catch {
      setRecoveryState("storage_blocked");
      throw new PeopleServiceError("people_temporarily_unavailable", true);
    }
  }, [
    input.brandId,
    input.online,
    enabledMerge,
    enabledRead,
    recoveryState,
    user,
    writeRecoveryEntries,
  ]);

  const recover = React.useCallback(async <T extends BrandPersonMaintenanceOperation>(
    requestId: string,
    intentKey: string,
    operationKind: MaintenanceOperationKind,
    run: () => Promise<T>,
  ): Promise<T> => {
    if (!input.brandId) throw new PeopleServiceError("people_forbidden", false);
    if (!input.online) {
      throw new PeopleServiceError("people_temporarily_unavailable", true);
    }
    try {
      return await run();
    } catch (caught) {
      if (!(caught instanceof PeopleServiceError)) throw caught;
      const stale = caught.code === "people_merge_stale" ||
        caught.code === "people_split_stale";
      if (!caught.retryable && !stale) throw caught;
      try {
        const operation = await getBrandPersonMaintenanceOperation({
          brandId: input.brandId,
          clientRequestId: requestId,
        }) as T;
        setRecoveredOperation(operation);
        setRecoveredIntentKey(intentKey);
        setRecoveredOperationKind(operationKind);
        setRecoveryState("receipt");
        return operation;
      } catch (lookupError) {
        if (
          lookupError instanceof PeopleServiceError &&
          lookupError.code === "people_not_found"
        ) {
          if (stale) {
            await removePersistedIntent(intentKey);
            await invalidateMaintenance();
          } else {
            setRecoveredIntentKey(intentKey);
            setRecoveredOperationKind(operationKind);
            setRecoveryState("retry_available");
          }
          throw caught;
        }
        setRecoveryState("check_again");
        if (stale) {
          throw new PeopleServiceError("people_temporarily_unavailable", true);
        }
        throw caught;
      }
    }
  }, [input.brandId, input.online, invalidateMaintenance, removePersistedIntent]);

  const recordReceipt = React.useCallback((
    intentKey: string,
    operationKind: MaintenanceOperationKind,
    operation: BrandPersonMaintenanceOperation,
  ): void => {
    setRecoveredOperation(operation);
    setRecoveredIntentKey(intentKey);
    setRecoveredOperationKind(operationKind);
    setRecoveryState("receipt");
  }, []);

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
      const intentKey = `merge:${variables.intentKey}`;
      await persistIntent("merge", intentKey, clientRequestId);
      return recover(clientRequestId, intentKey, "merge", () =>
        mergeBrandPeople({
          brandId: input.brandId!,
          ...variables,
          clientRequestId,
        }));
    },
    retry: false,
    onSuccess: async (operation, variables) => {
      recordReceipt(`merge:${variables.intentKey}`, "merge", operation);
      await invalidateMaintenance("none");
    },
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
      const intentKey = `promote:${variables.intentKey}`;
      await persistIntent("promote", intentKey, clientRequestId);
      return recover(clientRequestId, intentKey, "promote", () =>
        promoteBrandPersonContact({
          brandId: input.brandId!,
          ...variables,
          clientRequestId,
        }));
    },
    retry: false,
    onSuccess: async (operation, variables) => {
      recordReceipt(`promote:${variables.intentKey}`, "promote", operation);
      await invalidateMaintenance("none");
    },
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
      const intentKey = `split:${variables.intentKey}`;
      await persistIntent("split", intentKey, clientRequestId);
      return recover(clientRequestId, intentKey, "split", () =>
        splitBrandPersonMerge({
          brandId: input.brandId!,
          ...variables,
          clientRequestId,
        }));
    },
    retry: false,
    onSuccess: async (operation, variables) => {
      recordReceipt(`split:${variables.intentKey}`, "split", operation);
      await invalidateMaintenance("none");
    },
  });

  const acknowledgeRecovery = React.useCallback(async (): Promise<void> => {
    if (recoveryState !== "receipt" || recoveredIntentKey === null) return;
    await removePersistedIntent(recoveredIntentKey);
    await invalidateMaintenance();
  }, [
    invalidateMaintenance,
    recoveredIntentKey,
    recoveryState,
    removePersistedIntent,
  ]);

  const abandonRecovery = React.useCallback(async (): Promise<void> => {
    if (recoveryState !== "retry_available" || recoveredIntentKey === null) return;
    await removePersistedIntent(recoveredIntentKey);
  }, [recoveredIntentKey, recoveryState, removePersistedIntent]);

  const checkRecovery = React.useCallback((): void => {
    if (!input.online) return;
    setRecoveryState("loading");
    setRecoveryEpoch((value) => value + 1);
  }, [input.online]);

  const retryRecoveredIntent = async (): Promise<BrandPersonMaintenanceOperation> => {
    if (recoveryState !== "retry_available" || recoveredIntentKey === null ||
      recoveredOperationKind === null) {
      throw new PeopleServiceError("people_temporarily_unavailable", true);
    }
    const fields = recoveredIntentKey.split(":");
    if (recoveredOperationKind === "merge" && fields.length === 5 && fields[0] === "merge") {
      return merge.mutateAsync({
        intentKey: fields.slice(1).join(":"),
        winnerPersonId: fields[1],
        loserPersonId: fields[2],
        winnerVersion: fields[3],
        loserVersion: fields[4],
      });
    }
    if (recoveredOperationKind === "promote" && fields.length === 4 && fields[0] === "promote") {
      return promote.mutateAsync({
        intentKey: fields.slice(1).join(":"),
        personId: fields[1],
        contactMethodId: fields[2],
        personVersion: fields[3],
      });
    }
    if (recoveredOperationKind === "split" && fields.length === 3 && fields[0] === "split") {
      return split.mutateAsync({
        intentKey: fields.slice(1).join(":"),
        mergeEventId: fields[1],
        splitVersion: fields[2],
      });
    }
    setRecoveryState("storage_blocked");
    throw new PeopleServiceError("people_temporarily_unavailable", true);
  };

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
    canRead: enabledRead,
    canMerge: enabledMerge,
    mutationAllowed: input.online && enabledRead &&
      (recoveryState === "ready" || recoveryState === "retry_available"),
    recoveryState,
    recoveredOperation,
    recoveredOperationKind,
    recoveredIntentKey,
    acknowledgeRecovery,
    abandonRecovery,
    checkRecovery,
    retryRecoveredIntent,
  };
}
