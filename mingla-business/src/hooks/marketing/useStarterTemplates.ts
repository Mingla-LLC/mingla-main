/**
 * useStarterTemplates — read-only list of the 5 Mingla starter-pack
 * email templates (ORCH-0863). 5-min stale because starter templates are
 * seeded by migration and never change at runtime.
 */

import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { listStarterTemplates } from "../../services/marketing/marketingTemplateService";
import type { MarketingTemplateRow } from "../../types/marketing";
import { marketingKeys } from "./marketingKeys";

const STALE_TIME_MS = 5 * 60 * 1000;

export interface UseStarterTemplatesState {
  data: MarketingTemplateRow[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: UseQueryResult<MarketingTemplateRow[]>["refetch"];
}

export function useStarterTemplates(): UseStarterTemplatesState {
  const query = useQuery<MarketingTemplateRow[]>({
    queryKey: marketingKeys.templates.starter,
    queryFn: async () => listStarterTemplates(),
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
