/**
 * useTemplate — single template fetch by id (ORCH-0863). Used by the
 * Template detail screen (`templates/[id].tsx`) for both read-only and
 * editable modes.
 */

import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { getTemplate } from "../../services/marketing/marketingTemplateService";
import type { MarketingTemplateRow } from "../../types/marketing";
import { marketingKeys } from "./marketingKeys";

const STALE_TIME_MS = 60 * 1000;

export interface UseTemplateState {
  data: MarketingTemplateRow | null | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: UseQueryResult<MarketingTemplateRow | null>["refetch"];
}

export function useTemplate(
  templateId: string | null | undefined,
): UseTemplateState {
  // The "new" sentinel route param (templates/new) means "no fetch" — the
  // caller renders an empty editor.
  const enabled =
    typeof templateId === "string" &&
    templateId.length > 0 &&
    templateId !== "new";
  const query = useQuery<MarketingTemplateRow | null>({
    queryKey: enabled
      ? marketingKeys.templates.byId(templateId as string)
      : marketingKeys.templates.all,
    queryFn: async () => getTemplate(templateId as string),
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
