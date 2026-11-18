import { useCurrentBrandRole } from "./useCurrentBrandRole";
import {
  canHostAdAction,
  canHostAdTopUp,
  canHostAdWithdraw,
  type HostAdAction,
} from "../utils/hostAdPermission";

export interface HostAdPermissionsState {
  canRead: boolean;
  canPlan: boolean;
  canFund: boolean;
  canLaunch: boolean;
  canPause: boolean;
  canEnd: boolean;
  /** #4238 ads roles: Ads credit top-up (owner, admin, Finance). */
  canTopUp: boolean;
  /** #4238 ads roles: Ads credit withdraw (owner or Finance). */
  canWithdraw: boolean;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

export function useHostAdPermissions(
  brandId: string | null,
): HostAdPermissionsState {
  const roleState = useCurrentBrandRole(brandId);
  const ready = !roleState.isLoading && !roleState.isError;
  const allowed = (action: HostAdAction): boolean =>
    ready && canHostAdAction(roleState, action);

  return {
    canRead: allowed("read"),
    canPlan: allowed("plan"),
    canFund: allowed("fund"),
    canLaunch: allowed("launch"),
    canPause: allowed("pause"),
    canEnd: allowed("end"),
    canTopUp: ready && canHostAdTopUp(roleState),
    canWithdraw: ready && canHostAdWithdraw(roleState),
    isLoading: roleState.isLoading,
    isError: roleState.isError,
    refetch: roleState.refetch,
  };
}
