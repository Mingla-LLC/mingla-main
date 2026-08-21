import React from "react";

import { useManualGroups } from "../../hooks/marketing/useManualGroups";
import type { ManualGroupSummary } from "../../types/marketing";

export interface ManualGroupsLoaderState {
  brandId: string;
  data: ManualGroupSummary[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

export function ManualGroupsLoader({
  brandId,
  onState,
}: {
  brandId: string;
  onState: (state: ManualGroupsLoaderState) => void;
}): null {
  const groups = useManualGroups(brandId, true);
  React.useEffect(() => {
    onState({
      brandId,
      data: groups.data ?? [],
      isLoading: groups.isLoading,
      isError: groups.isError,
      refetch: groups.refetch,
    });
  }, [brandId, groups.data, groups.isError, groups.isLoading, groups.refetch, onState]);
  return null;
}
