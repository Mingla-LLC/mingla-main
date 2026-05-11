import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../context/AuthContext";
import { setCreatorDefaultBrand } from "../services/creatorAccount";
import { useCurrentBrandStore } from "../store/currentBrandStore";
import { resolveCurrentBrandId } from "../utils/currentBrandResolver";
import { useBrands } from "./useBrands";
import { useCreatorAccount } from "./useCreatorAccount";

export interface CurrentBrandRecoveryState {
  isResolving: boolean;
  isError: boolean;
  errorMessage: string | null;
}

const DEFAULT_BRAND_SAVE_ERROR =
  "Brand selected for now. Couldn't save it as your default.";

const inFlightDefaultWrites = new Set<string>();

export const useCurrentBrandRecovery = (): CurrentBrandRecoveryState => {
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
  const dataReady =
    isAuthReady &&
    userId !== null &&
    brandsQuery.isFetched &&
    !brandsQuery.isError &&
    creatorAccount.isFetched &&
    !creatorAccount.isError;
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
    if (!isAuthReady || userId === null || resolution === null) return;

    const appliedKey = [
      userId,
      currentBrandId ?? "null",
      defaultBrandId ?? "null",
      brandIdsKey,
      resolution.brandId ?? "null",
      resolution.reason,
    ].join("::");

    if (appliedKeyRef.current === appliedKey) return;
    appliedKeyRef.current = appliedKey;
    setErrorMessage(null);

    if (resolution.brandId !== currentBrandId) {
      setCurrentBrandId(resolution.brandId);
    }

    if (resolution.reason !== "newest-brand" || resolution.brandId === null) {
      return;
    }

    const writeKey = `${userId}:${resolution.brandId}`;
    if (inFlightDefaultWrites.has(writeKey)) return;
    inFlightDefaultWrites.add(writeKey);
    void setCreatorDefaultBrand(userId, resolution.brandId)
      .catch(() => {
        setErrorMessage(DEFAULT_BRAND_SAVE_ERROR);
      })
      .finally(() => {
        inFlightDefaultWrites.delete(writeKey);
      });
  }, [
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
    isError: errorMessage !== null,
    errorMessage,
  };
};
