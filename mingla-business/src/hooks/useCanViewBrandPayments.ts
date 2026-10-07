/**
 * useCanViewBrandPayments — client mirror of biz_can_view_payments_for_brand.
 * #3660 Phase 3: owner/admin/FM may view status without mutate rights.
 */

import { useCurrentBrandRole } from "./useCurrentBrandRole";
import { canViewBrandPayments } from "../utils/brandPaymentsPermission";
import type { CanManageBrandPaymentsState } from "./useCanManageBrandPayments";

export function useCanViewBrandPayments(
  brandId: string | null,
): CanManageBrandPaymentsState {
  const { role, accepted, isLoading, isError, refetch } = useCurrentBrandRole(
    brandId,
  );

  const allowed = !isLoading && !isError &&
    canViewBrandPayments({ role, accepted });

  return { allowed, isLoading, isError, refetch };
}
