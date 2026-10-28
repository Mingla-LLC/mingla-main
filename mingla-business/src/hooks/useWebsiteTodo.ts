import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { brandSiteKeys } from "../sites/brandSiteKeys";
import type { WebsiteTodo } from "../sites/websiteTodo";

/**
 * #2829 W9a — the Home to-do's website row. The plan code is loaded with a
 * dynamic import inside the query, so it is NOT in the boot payload every
 * Business visitor downloads (#3493); only these few lines are. Keyed under
 * the plan (brandSiteKeys.planTodo), so every plan change refreshes it.
 * Unknown (loading or failed) → no row.
 */
export function useWebsiteTodo(brandId: string | null): WebsiteTodo | null {
  const { isAuthReady } = useAuth();
  const query = useQuery({
    queryKey: brandSiteKeys.planTodo(brandId ?? ""),
    enabled: isAuthReady && brandId !== null,
    staleTime: 60_000,
    retry: 1,
    queryFn: async () => (await import("../sites/websiteTodo")).loadWebsiteTodo(brandId ?? ""),
  });
  return query.isSuccess ? query.data : null;
}
