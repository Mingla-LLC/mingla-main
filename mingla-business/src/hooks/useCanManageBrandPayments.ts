/**
 * useCanManageBrandPayments — the client mirror of
 * `biz_can_manage_payments_for_brand`, evaluated for the signed-in user.
 *
 * #1863 [error-toast-covers-bank-field] §4.0.3.
 *
 * Thin by design: it fetches NOTHING of its own. `useCurrentBrandRole` already
 * owns exactly one role query per brand, and this hook must not add a second.
 *
 * DEFAULT-CLOSED: `allowed` is `false` while the role query is loading and
 * `false` when it errored, matching the documented failure posture at
 * `useCurrentBrandRole.ts` ("any fetch error → rank 0; gates default-closed").
 * Consumers that need to tell "not allowed" from "we don't know yet" read
 * `isLoading` / `isError` — `BrandPaymentsPermissionGate` does exactly that, so
 * a network blip never tells a brand owner they lack permission.
 */

import { useCurrentBrandRole } from "./useCurrentBrandRole";
import { canManageBrandPayments } from "../utils/brandPaymentsPermission";

export interface CanManageBrandPaymentsState {
  allowed: boolean;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

export function useCanManageBrandPayments(
  brandId: string | null,
): CanManageBrandPaymentsState {
  const { role, accepted, isLoading, isError, refetch } = useCurrentBrandRole(
    brandId,
  );

  const allowed = !isLoading && !isError &&
    canManageBrandPayments({ role, accepted });

  return { allowed, isLoading, isError, refetch };
}
