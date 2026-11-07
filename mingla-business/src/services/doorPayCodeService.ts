/**
 * issue #4271 — door pay codes: the public service. Re-exports the shared core
 * (types, DoorPayCodeError, status readers, row mapper; doorPayCodeCore.ts) and
 * wraps each call in a loader for doorPayCodeServiceImpl.ts, fetched on the
 * first call, so the host screen, the door sale sheet and the guest page do not
 * hoist the calls into the eager web __common chunk. See doorPayCodeCore.ts for
 * the edge function contract.
 */
import type { BuyerDetails } from "../components/checkout/CartContext";
import type { TicketCheckoutProviderHandoff } from "./ticketCheckoutService";
import type {
  CreateDoorPayCodeInput,
  DoorPayCodeCreated,
  DoorPayCodeQuote,
  DoorPayCodeRow,
  DoorPayCodeView,
  DoorPayLatePayment,
  DoorPayLiveStatus,
  DoorPayUnsettledStatus,
} from "./doorPayCodeCore";

export * from "./doorPayCodeCore";

type DoorPayCodeServiceImpl = typeof import("./doorPayCodeServiceImpl");

let implPromise: Promise<DoorPayCodeServiceImpl> | null = null;

/** One load per session; a failed load is retried on the next call. */
const loadImpl = (): Promise<DoorPayCodeServiceImpl> => {
  implPromise ??= import("./doorPayCodeServiceImpl").catch((error: unknown) => {
    implPromise = null;
    throw error;
  });
  return implPromise;
};

export const quoteDoorPayCode = async (
  input: Omit<CreateDoorPayCodeInput, "replacesCodeId">,
): Promise<DoorPayCodeQuote> => (await loadImpl()).quoteDoorPayCode(input);

export const createDoorPayCode = async (input: CreateDoorPayCodeInput): Promise<DoorPayCodeCreated> =>
  (await loadImpl()).createDoorPayCode(input);

export const viewDoorPayCode = async (code: string): Promise<DoorPayCodeView> =>
  (await loadImpl()).viewDoorPayCode(code);

export const cancelDoorPayCode = async (codeId: string): Promise<"cancelled" | DoorPayUnsettledStatus> =>
  (await loadImpl()).cancelDoorPayCode(codeId);

/** The host's clock passed expires_at: only the server says what that means. */
export const settleDoorPayCode = async (codeId: string): Promise<DoorPayLiveStatus> =>
  (await loadImpl()).settleDoorPayCode(codeId);

export const textDoorPayLink = async (input: {
  codeId: string;
  phone: string;
  phoneCountryIso: string | null;
}): Promise<{ last4: string }> => (await loadImpl()).textDoorPayLink(input);

export const fetchDoorPayCode = async (codeId: string): Promise<DoorPayCodeRow> =>
  (await loadImpl()).fetchDoorPayCode(codeId);

export const fetchDoorPayLatePayment = async (codeId: string): Promise<DoorPayLatePayment | null> =>
  (await loadImpl()).fetchDoorPayLatePayment(codeId);

/** The paid code's guest name for the host's paid screen; null for a walk-up. */
export const fetchDoorPayGuestName = async (codeId: string): Promise<string | null> =>
  (await loadImpl()).fetchDoorPayGuestName(codeId);

/** issue #4271 — server answer to "may this user take money at this door?" */
export const fetchCanTakeDoorPayment = async (eventId: string): Promise<boolean> =>
  (await loadImpl()).fetchCanTakeDoorPayment(eventId);

/** issue #4271 — the guest's checkout for a door code (Stripe hosted URL or Paystack). */
export const createDoorCodeCheckout = async (input: {
  doorCode: string;
  eventId?: string;
  buyer: BuyerDetails;
}): Promise<TicketCheckoutProviderHandoff> => (await loadImpl()).createDoorCodeCheckout(input);
