import { useCurrentBrandRole } from "./useCurrentBrandRole";
import {
  canHostAdAction,
  type HostAdAction,
} from "../utils/hostAdPermission";

export interface HostAdPermissionsState {
  canRead: boolean;
  canPlan: boolean;
  canFund: boolean;
  canLaunch: boolean;
  canPause: boolean;
  canEnd: boolean;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

export function useHostAdPermissions(
  brandId: string | null,
): HostAdPermissionsState {
  const roleState = useCurrentBrandRole(brandId);
  const allowed = (action: HostAdAction): boolean =>
    !roleState.isLoading && !roleState.isError &&
    canHostAdAction(roleState, action);

  return {
    canRead: allowed("read"),
    canPlan: allowed("plan"),
    canFund: allowed("fund"),
    canLaunch: allowed("launch"),
    canPause: allowed("pause"),
    canEnd: allowed("end"),
    isLoading: roleState.isLoading,
    isError: roleState.isError,
    refetch: roleState.refetch,
  };
}
