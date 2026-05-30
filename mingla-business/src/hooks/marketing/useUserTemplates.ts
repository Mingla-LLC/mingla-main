/**
 * useUserTemplates — list of user-authored templates for the current
 * account (ORCH-0863). 60s stale.
 */

import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../../context/AuthContext";
import { listUserTemplates } from "../../services/marketing/marketingTemplateService";
import type { MarketingTemplateRow } from "../../types/marketing";
import { marketingKeys } from "./marketingKeys";

const STALE_TIME_MS = 60 * 1000;

export interface UseUserTemplatesState {
  data: MarketingTemplateRow[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: UseQueryResult<MarketingTemplateRow[]>["refetch"];
}

export function useUserTemplates(
  accountId: string | null | undefined,
): UseUserTemplatesState {
  // ORCH-1004 — user-authored templates are auth.uid()-scoped; gate on auth.
  const { isAuthReady } = useAuth();
  const enabled =
    isAuthReady && typeof accountId === "string" && accountId.length > 0;
  const query = useQuery<MarketingTemplateRow[]>({
    queryKey: enabled
      ? marketingKeys.templates.user(accountId as string)
      : marketingKeys.templates.all,
    queryFn: async () => listUserTemplates({ account_id: accountId as string }),
    enabled,
    staleTime: STALE_TIME_MS,
  });
  return useMemo(
    () => ({
      data: query.data,
      isLoading: query.isLoading,
      isError: query.isError,
      refetch: query.refetch,
    }),
    [query.data, query.isLoading, query.isError, query.refetch],
  );
}
