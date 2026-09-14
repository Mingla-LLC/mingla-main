import { sampleBrand } from "./fixtures";

const localNetworkState = { type: "wifi", isConnected: true, isInternetReachable: true, details: null };
const localNetInfo = {
  fetch: async () => localNetworkState,
  refresh: async () => localNetworkState,
  configure: () => undefined,
  addEventListener: (listener: (state: typeof localNetworkState) => void) => {
    listener(localNetworkState);
    return () => undefined;
  },
};
export default localNetInfo;
export const useNetInfo = () => localNetworkState;

export const useAuth = () => ({ loading: false, session: null, user: null });
export const useBrandList = () => [sampleBrand];
export const useEventOrders = () => ({ status: "ready", data: [], error: null, isRefreshing: false, refetch: async () => undefined });
export const socialProofKeys = { summary: (id: string) => ["capture-social-proof", id] as const };
export async function fetchSocialProof() { return { sample: [], privateGuestList: false, hideRemainingCount: false }; }
export const usePublicTicketCheckoutRouteAccess = () => ({ blocked: false, requiresSignIn: false, state: "unrestricted" });
export const captureWeb = () => undefined;
export async function submitPublicRsvp() { throw new Error("capture_harness_blocked_mutation"); }
export async function submitRsvpContribution() { throw new Error("capture_harness_blocked_checkout"); }
export async function fetchPublicRsvpPassPdf() { throw new Error("capture_harness_blocked_pdf"); }
export const useThemeFont = () => undefined;
export function openMapsTarget() { throw new Error("capture_harness_blocked_external_link"); }
export async function copyAddressText() { throw new Error("capture_harness_blocked_external_copy"); }
export async function shareCanonicalPublicPageOnWeb() { throw new Error("capture_harness_blocked_share"); }
