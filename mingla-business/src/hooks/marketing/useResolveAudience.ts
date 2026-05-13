/**
 * useResolveAudience — composer wrapper around useBrandCustomers /
 * useEventBuyers based on the `{kind}:{id}` query-param pre-fill
 * (I-PROPOSED-BU).
 */

import { useMemo } from "react";

import { useBrandCustomers } from "./useBrandCustomers";
import { useEventBuyers } from "./useEventBuyers";
import type { ResolveBuyersResult } from "../../services/marketing/marketingAudienceService";
import {
  parseAudienceParam,
  type AudienceKind,
  type ParsedAudienceParam,
} from "./parseAudienceParam";

export { parseAudienceParam };
export type { AudienceKind, ParsedAudienceParam };

export interface UseResolveAudienceState {
  data: ResolveBuyersResult | undefined;
  isLoading: boolean;
  isError: boolean;
}

export function useResolveAudience(
  parsed: ParsedAudienceParam | null,
): UseResolveAudienceState {
  const brandQuery = useBrandCustomers(
    parsed?.kind === "brand" ? parsed.id : null,
  );
  const eventQuery = useEventBuyers(
    parsed?.kind === "event" ? parsed.id : null,
  );
  return useMemo(() => {
    if (parsed === null) {
      return { data: undefined, isLoading: false, isError: false };
    }
    const source = parsed.kind === "brand" ? brandQuery : eventQuery;
    return {
      data: source.data,
      isLoading: source.isLoading,
      isError: source.isError,
    };
  }, [parsed, brandQuery, eventQuery]);
}
