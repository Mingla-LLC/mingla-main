import { EXPLORER_FIXTURE_IDS, sampleMessages } from "./fixtures";

const user = { id: EXPLORER_FIXTURE_IDS.personA, email: "sample@example.invalid", user_metadata: { display_name: "Sample Ava" } };
export function useAppStore(selector?: (state: { user: typeof user }) => unknown) {
  const state = { user };
  return selector ? selector(state) : state;
}
useAppStore.getState = () => ({ user });

export class BoardMessageService {
  static async getBoardMessages() { return { data: sampleMessages, error: null }; }
  static async markAllMessagesAsRead() { return { error: null }; }
  static async markMessageAsRead() { return { error: null }; }
  static async sendBoardMessage() { throw new Error("capture_harness_blocked_mutation"); }
  static async updateMessage() { throw new Error("capture_harness_blocked_mutation"); }
  static async deleteMessage() { throw new Error("capture_harness_blocked_mutation"); }
  static async toggleReaction() { throw new Error("capture_harness_blocked_mutation"); }
}

export const realtimeService = {
  subscribeToBoardSession: () => undefined,
  unregisterBoardCallbacks: () => undefined,
  broadcastTypingStart: () => undefined,
  broadcastTypingStop: () => undefined,
};
export const useNetworkMonitor = () => ({ isConnected: true, isInternetReachable: true });
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
export const BoardErrorHandler = { handleNetworkError: (error: unknown) => error, showError: () => undefined };

const query = {
  select: () => query, eq: () => query, is: () => query, order: () => query,
  range: () => query, limit: () => query, maybeSingle: async () => ({ data: null, error: null }),
  single: async () => ({ data: null, error: null }),
  then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }),
};
export const supabase = { from: () => query };

export const mixpanelService = new Proxy({}, { get: () => () => undefined });
export const logAppsFlyerEvent = () => undefined;
export const recordCardExpand = () => undefined;
export const useFeatureGate = () => ({ canAccess: () => true });
export const useKeyboard = () => ({ keyboardHeight: 0 });
export const useUserLocation = () => ({ data: null, isLoading: false });
export const useVenueReservable = () => ({ data: false });
export const useReplaceStop = () => ({ alternatives: [], isLoading: false, error: null, fetchAlternatives: () => { throw new Error("capture_harness_blocked_mutation"); }, clearAlternatives: () => undefined });
export const useRecommendationsOptional = () => null;
export const openExpandedCardContentShare = () => { throw new Error("capture_harness_blocked_share"); };
export const registerContentShareHandler = () => () => undefined;
export const savedCardsService = new Proxy({}, { get: () => () => { throw new Error("capture_harness_blocked_mutation"); } });
export const CalendarService = {
  fetchUserCalendarEntries: async () => [],
  fetchUserBusinessEventOrders: async () => [],
  addEntryFromSavedCard: async () => { throw new Error("capture_harness_blocked_mutation"); },
  updateEntry: async () => { throw new Error("capture_harness_blocked_mutation"); },
};
export const DeviceCalendarService = new Proxy({}, { get: () => () => { throw new Error("capture_harness_blocked_external_calendar"); } });
export const toastManager = { show: () => undefined, success: () => undefined, error: () => undefined, warning: () => undefined };
export const postHogService = { capture: () => undefined };
export const weatherService = { getWeatherForecast: async () => null };
export const busynessService = { getVenueBusyness: async () => null };
export async function fetchRsvpPartyPasses() { return [{ entityType: "primary", entityId: EXPLORER_FIXTURE_IDS.rsvp, displayName: "Sample Explorer", qrCode: "mingla-demo://not-valid/sample-rsvp-3176", pdfFetchRef: EXPLORER_FIXTURE_IDS.rsvp }]; }
export async function fetchRsvpPassPdf() { throw new Error("capture_harness_blocked_pdf"); }
export async function submitDeckRsvp() { throw new Error("capture_harness_blocked_mutation"); }
export function openMapsTarget() { throw new Error("capture_harness_blocked_external_link"); }
