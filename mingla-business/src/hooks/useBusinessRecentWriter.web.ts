import {
  useCallback,
  useEffect,
  useRef,
} from "react";
import { useFocusEffect } from "expo-router";

import { queryClient } from "../config/queryClient";
import { useAuth } from "../context/AuthContext";
import type { BusinessRecentEntityType } from "../store/businessRecentStore";

const useRecentFocusEffect: typeof useFocusEffect =
  typeof useFocusEffect === "function"
    ? useFocusEffect
    : (effect) => useEffect(effect, [effect]);

export function useSuccessfulBusinessRecentOpen(input: {
  brandId: string | null;
  entityType: BusinessRecentEntityType;
  entityId: string | null;
  ready: boolean;
  title?: string;
  coverUrl?: string | null;
  coverPosterUrl?: string | null;
  coverType?: "image" | "video" | "gif" | null;
  status?: string | null;
}): void {
  const { user } = useAuth();
  const focusedRef = useRef(false);
  const recordedRef = useRef(false);
  const attemptRef = useRef(0);
  const recordRef = useRef<() => void>(() => undefined);
  const identity = `${user?.id ?? ""}:${input.brandId ?? ""}:${input.entityType}:${input.entityId ?? ""}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;

  useRecentFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      recordedRef.current = false;
      recordRef.current();
      return () => {
        focusedRef.current = false;
        attemptRef.current += 1;
      };
    }, []),
  );

  const record = useCallback((): void => {
    if (
      !focusedRef.current ||
      recordedRef.current ||
      !input.ready ||
      input.brandId === null ||
      input.entityId === null ||
      user === null
    )
      return;
    recordedRef.current = true;
    const attempt = ++attemptRef.current;
    const requestedIdentity = identity;
    void import("./businessRecentOpenRuntime").then((runtime) =>
      runtime.recordSuccessfulBusinessRecentOpen({
        ...input,
        brandId: input.brandId as string,
        entityId: input.entityId as string,
        userId: user.id,
        online: typeof navigator === "undefined" || navigator.onLine,
        queryClient,
        isCurrent: () =>
          focusedRef.current &&
          attemptRef.current === attempt &&
          identityRef.current === requestedIdentity,
      }),
    );
  }, [identity, input, queryClient, user]);
  recordRef.current = record;
  useEffect(record, [record]);
}

export function promoteBusinessRecentDraft(input: {
  userId: string;
  brandId: string;
  entityType: BusinessRecentEntityType;
  localId: string;
  serverId: string;
}): void {
  void import("./businessRecentOpenRuntime").then((runtime) =>
    runtime.promoteRecentDraft(input),
  );
}

export function discardBusinessRecentDraft(input: {
  userId: string;
  brandId: string;
  entityType: BusinessRecentEntityType;
  localId: string;
}): void {
  void import("./businessRecentOpenRuntime").then((runtime) =>
    runtime.discardRecentDraft(input),
  );
}
