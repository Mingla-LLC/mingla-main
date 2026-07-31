import { supabase } from "./supabase";
import type {
  StayGuestInput,
  StayQuote,
  StayQuoteInput,
  StayReservationAction,
  StayReservationEnvelope,
  StayReservationGroup,
  StayCancelPreview,
  StayStaffReservationGroup,
  StayStaffReservationList,
} from "../types/stayReservation";

type InvokeInput = {
  action: StayReservationAction;
  payload: Record<string, unknown>;
  expectedVersion?: number;
};

export class StayReservationError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "StayReservationError";
    this.code = code;
  }
}

async function invokeError(error: {
  message?: string;
  context?: unknown;
}): Promise<StayReservationError> {
  const context = error.context;
  if (
    context !== null &&
    context !== undefined &&
    typeof (context as Response).json === "function"
  ) {
    try {
      const body = (await (context as Response).json()) as {
        code?: unknown;
        message?: unknown;
      };
      if (typeof body.code === "string" && body.code.length > 0) {
        return new StayReservationError(
          body.code,
          typeof body.message === "string" ? body.message : undefined,
        );
      }
    } catch {
      // Preserve the stable fallback below for an unreadable edge response.
    }
  }
  return new StayReservationError("stay_reservation_failed", error.message);
}

async function invoke<T>({
  action,
  payload,
  expectedVersion,
}: InvokeInput): Promise<T> {
  const { data, error } = await supabase.functions.invoke<
    StayReservationEnvelope<T>
  >("stay-reservations", {
    body: { action, payload, expectedVersion },
  });
  if (error) throw await invokeError(error);
  if (!data || data.kind !== "success") {
    throw new StayReservationError(
      data?.code ?? "stay_reservation_failed",
      data?.message,
    );
  }
  return data.data;
}

export const stayReservationService = {
  quote(input: StayQuoteInput): Promise<StayQuote> {
    return invoke<StayQuote>({ action: "quote", payload: input });
  },

  createGroup(input: {
    quoteId: string;
    idempotencyKey: string;
    guest: StayGuestInput;
    expectedQuoteVersion: number;
  }): Promise<StayReservationGroup> {
    return invoke<StayReservationGroup>({
      action: "create_group",
      payload: {
        quoteId: input.quoteId,
        idempotencyKey: input.idempotencyKey,
        guest: input.guest,
      },
      expectedVersion: input.expectedQuoteVersion,
    });
  },

  approveRequest(input: {
    groupId: string;
    idempotencyKey: string;
    expectedVersion: number;
  }): Promise<StayReservationGroup> {
    return invoke<StayReservationGroup>({
      action: "approve_request",
      payload: {
        groupId: input.groupId,
        idempotencyKey: input.idempotencyKey,
      },
      expectedVersion: input.expectedVersion,
    });
  },

  declineRequest(input: {
    groupId: string;
    idempotencyKey: string;
    expectedVersion: number;
  }): Promise<StayReservationGroup> {
    return invoke<StayReservationGroup>({
      action: "decline_request",
      payload: {
        groupId: input.groupId,
        idempotencyKey: input.idempotencyKey,
      },
      expectedVersion: input.expectedVersion,
    });
  },

  getGroup(groupId: string): Promise<StayReservationGroup> {
    return invoke<StayReservationGroup>({
      action: "get_group",
      payload: { groupId },
    });
  },

  listStaffGroups(venueId: string): Promise<StayStaffReservationList> {
    return invoke<StayStaffReservationList>({
      action: "list_staff_groups",
      payload: { venueId },
    });
  },

  getStaffGroup(groupId: string): Promise<StayStaffReservationGroup> {
    return invoke<StayStaffReservationGroup>({
      action: "get_staff_group",
      payload: { groupId },
    });
  },

  cancelPreview(input: {
    groupId: string;
    selectedLineIds: string[];
    expectedVersion: number;
  }): Promise<StayCancelPreview> {
    return invoke<StayCancelPreview>({
      action: "cancel_preview",
      payload: {
        groupId: input.groupId,
        selectedLineIds: input.selectedLineIds,
      },
      expectedVersion: input.expectedVersion,
    });
  },

  cancel(input: {
    previewId: string;
    previewHash: string;
    reason: string;
    idempotencyKey: string;
  }): Promise<{
    refundId: string;
    groupId: string;
    state: string;
    amountMinor: string;
    currencyCode: string;
    group: StayReservationGroup;
  }> {
    return invoke({
      action: "cancel",
      payload: input,
    });
  },
};
