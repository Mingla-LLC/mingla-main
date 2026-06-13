import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../context/AuthContext";
import { setCreatorDefaultBrand } from "../services/creatorAccount";
import { useCurrentBrandStore } from "../store/currentBrandStore";
import { resolveCurrentBrandId } from "../utils/currentBrandResolver";
import type { ResolveCurrentBrandResult } from "../utils/currentBrandResolver";
import { useBrands } from "./useBrands";
import { useCreatorAccount } from "./useCreatorAccount";
import {
  CURRENT_BRAND_QUERY_ERROR,
  hasCurrentBrandRecoveryQueryError,
} from "../utils/currentBrandRecoveryErrors";

export {
  CURRENT_BRAND_QUERY_ERROR,
  hasCurrentBrandRecoveryQueryError,
} from "../utils/currentBrandRecoveryErrors";

export interface CurrentBrandRecoveryState {
  isResolving: boolean;
  isError: boolean;
  errorMessage: string | null;
}

/**
 * ORCH-1133 — SINGLE-WRITER invariant for the global current-brand pointer.
 *
 * This hook is mounted in FIVE+ concurrent subscriber trees (RootLayoutInner,
 * TabsLayout, home, event/create, and useBusinessTodos — itself fanned out).
 * Every mount used to run the WRITE effect below, so the shared Zustand
 * `currentBrandId` had 5+ owners — a one-owner-per-truth violation. Under
 * auth-lock / session-flicker timing, multiple mounts re-resolving and writing
 * `setCurrentBrandId` can ping-pong across commits, manifesting as the
 * `useSyncExternalStore` "Maximum update depth exceeded" render loop.
 *
 * Fix: the WRITE effect now runs ONLY when `authoritative: true` is passed.
 * `authoritative` defaults to FALSE, so by default the hook is READ-ONLY — it
 * still returns `isResolving` / `isError` / `errorMessage` for UI gating but
 * never writes the global store. EXACTLY ONE call site passes
 * `authoritative: true`: `app/_layout.tsx` (RootLayoutInner), the highest
 * always-mounted root for any authenticated business session. Because the
 * write effect's inputs (userId, brands, creatorAccount, currentBrandId — all
 * global/shared state) are independent of WHICH component mounts the hook, the
 * root mount reproduces the identical recovery the redundant mounts performed.
 * Do NOT pass `authoritative: true` from any other site.
 */
export interface CurrentBrandRecoveryOptions {
  /**
   * When true, this mount is the sole authoritative owner of the
   * `setCurrentBrandId` / default-brand write. Pass ONLY from
   * `app/_layout.tsx` (RootLayoutInner). Default false = read-only consumer.
   */
  authoritative?: boolean;
}

const DEFAULT_BRAND_SAVE_ERROR =
  "Brand selected for now. Couldn't save it as your default.";

const inFlightDefaultWrites = new Set<string>();

export interface BrandRecoveryWriteInput {
  authoritative: boolean;
  isAuthReady: boolean;
  userId: string | null;
  resolution: ResolveCurrentBrandResult | null;
  appliedKey: string;
  appliedKeyRef: { current: string | null };
  currentBrandId: string | null;
  setCurrentBrandId: (brandId: string | null) => void;
  setErrorMessage: (message: string | null) => void;
}

/**
 * ORCH-1133 — the gated write body of `useCurrentBrandRecovery`'s effect,
 * extracted as a pure function so the single-writer invariant is directly
 * testable without a React renderer (none is installed under the default
 * node/ts-jest config). Behaviorally identical to the inline effect it replaced.
 *
 * Returns `true` iff it actually wrote the current-brand store.
 * The FIRST line is the single-writer gate: a non-authoritative caller does
 * NOTHING (no setCurrentBrandId, no default-brand write, no appliedKeyRef
 * mutation).
 */
export const runBrandRecoveryWrite = (input: BrandRecoveryWriteInput): boolean => {
  const {
    authoritative,
    isAuthReady,
    userId,
    resolution,
    appliedKey,
    appliedKeyRef,
    currentBrandId,
    setCurrentBrandId,
    setErrorMessage,
  } = input;

  // ORCH-1133 — single-writer invariant: only the one authoritative owner
  // (app/_layout.tsx / RootLayoutInner) may write the global current-brand
  // store. Read-only mounts return before touching anything.
  if (!authoritative) return false;
  if (!isAuthReady || userId === null || resolution === null) return false;

  if (appliedKeyRef.current === appliedKey) return false;
  appliedKeyRef.current = appliedKey;
  setErrorMessage(null);

  let wrote = false;
  if (resolution.brandId !== currentBrandId) {
    setCurrentBrandId(resolution.brandId);
    wrote = true;
  }

  if (resolution.reason !== "newest-brand" || resolution.brandId === null) {
    return wrote;
  }

  const writeKey = `${userId}:${resolution.brandId}`;
  if (inFlightDefaultWrites.has(writeKey)) return wrote;
  inFlightDefaultWrites.add(writeKey);
  void setCreatorDefaultBrand(userId, resolution.brandId)
    .catch(() => {
      setErrorMessage(DEFAULT_BRAND_SAVE_ERROR);
    })
    .finally(() => {
      inFlightDefaultWrites.delete(writeKey);
    });
  return wrote;
};

export const useCurrentBrandRecovery = (
  options?: CurrentBrandRecoveryOptions,
): CurrentBrandRecoveryState => {
  // ORCH-1133 single-writer gate: default read-only. Only the root mount
  // (app/_layout.tsx) passes authoritative:true and runs the write effect.
  const authoritative = options?.authoritative ?? false;
  const { authStatus, isAuthReady, user } = useAuth();
  const userId = user?.id ?? null;
  const brandsQuery = useBrands(userId);
  const creatorAccount = useCreatorAccount();
  const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);
  const setCurrentBrandId = useCurrentBrandStore((s) => s.setCurrentBrandId);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const appliedKeyRef = useRef<string | null>(null);

  const brands = useMemo(
    () => brandsQuery.data ?? [],
    [brandsQuery.data],
  );
  const brandIdsKey = useMemo(
    () => brands.map((brand) => brand.id).join("|"),
    [brands],
  );
  const defaultBrandId = creatorAccount.data?.default_brand_id ?? null;
  const hasQueryError = hasCurrentBrandRecoveryQueryError(
    brandsQuery.isError,
    creatorAccount.isError,
  );
  const dataReady =
    isAuthReady &&
    userId !== null &&
    brandsQuery.isFetched &&
    creatorAccount.isFetched &&
    !hasQueryError;
  const resolution = useMemo(
    () =>
      dataReady
        ? resolveCurrentBrandId({
            currentBrandId,
            defaultBrandId,
            brands,
          })
        : null,
    [brands, currentBrandId, dataReady, defaultBrandId],
  );

  useEffect(() => {
    const appliedKey = [
      userId,
      currentBrandId ?? "null",
      defaultBrandId ?? "null",
      brandIdsKey,
      resolution?.brandId ?? "null",
      resolution?.reason ?? "null",
    ].join("::");

    runBrandRecoveryWrite({
      authoritative,
      isAuthReady,
      userId,
      resolution,
      appliedKey,
      appliedKeyRef,
      currentBrandId,
      setCurrentBrandId,
      setErrorMessage,
    });
  }, [
    authoritative,
    userId,
    isAuthReady,
    currentBrandId,
    defaultBrandId,
    brandIdsKey,
    resolution,
    setCurrentBrandId,
  ]);

  const isResolving =
    (authStatus === "bootstrapping" || authStatus === "refreshing") ||
    (isAuthReady &&
      userId !== null &&
    (!brandsQuery.isFetched ||
      !creatorAccount.isFetched ||
      (resolution !== null &&
        resolution.brandId !== currentBrandId &&
        errorMessage === null)));

  return {
    isResolving,
    isError: hasQueryError || errorMessage !== null,
    errorMessage: hasQueryError ? CURRENT_BRAND_QUERY_ERROR : errorMessage,
  };
};
