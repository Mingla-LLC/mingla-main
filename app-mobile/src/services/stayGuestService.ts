import {
  parsePublicStayDetail,
  type MyStayReservationGroup,
  type PublicStayDetail,
  type StayCancelPreview,
  type StayGuestCartLineInput,
  type StayGuestCheckoutInput,
  type StayPaymentSession,
  type StayQuote,
  type StayReservationGroup,
} from "@mingla/brand-rendering/stayGuest";

import { supabase } from "./supabase";
import { getStoredNativeAdClickId } from "./nativeAdAttributionService";

type StayEnvelope<T> =
  | { kind: "success"; data: T; requestId: string }
  | { kind: "error"; code: string; message: string; requestId: string };

export class StayGuestError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code.replaceAll("_", " "));
    this.name = "StayGuestError";
    this.code = code;
  }
}

const randomId = (): string => {
  const maybeCrypto = (globalThis as { crypto?: Crypto }).crypto;
  return typeof maybeCrypto?.randomUUID === "function"
    ? maybeCrypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
};

const idempotencyKey = (scope: string): string =>
  `stay:${scope}:${randomId()}`;

async function invoke<T>(input: {
  action:
    | "quote"
    | "create_group"
    | "get_group"
    | "create_payment"
    | "cancel_preview"
    | "cancel";
  payload: Record<string, unknown>;
  expectedVersion?: number;
}): Promise<T> {
  const { data, error } = await supabase.functions.invoke<StayEnvelope<T>>(
    "stay-reservations",
    {
      body: {
        action: input.action,
        payload: input.payload,
        expectedVersion: input.expectedVersion,
      },
    },
  );
  if (error) {
    let code = "stay_reservation_failed";
    let message = error.message;
    const context = error.context as Response | undefined;
    if (context && typeof context.json === "function") {
      try {
        const body = (await context.json()) as {
          code?: unknown;
          message?: unknown;
        };
        if (typeof body.code === "string") code = body.code;
        if (typeof body.message === "string") message = body.message;
      } catch {
        // Use the stable fallback when the edge response is not JSON.
      }
    }
    throw new StayGuestError(code, message);
  }
  if (!data || data.kind !== "success") {
    throw new StayGuestError(
      data?.code ?? "stay_reservation_failed",
      data?.message,
    );
  }
  return data.data;
}

export async function fetchPublicStayDetail(
  venueId: string,
): Promise<PublicStayDetail | null> {
  const { data, error } = await supabase.rpc("pg_public_stay_details", {
    p_venue_id: venueId,
  });
  if (error) throw error;
  return parsePublicStayDetail(data, (path) =>
    supabase.storage.from("brand_covers").getPublicUrl(path).data.publicUrl
  );
}

export async function fetchMyStayReservations(): Promise<
  MyStayReservationGroup[]
> {
  const { data, error } = await supabase.rpc("pg_my_stay_reservation_groups");
  if (error) throw error;
  return Array.isArray(data) ? (data as MyStayReservationGroup[]) : [];
}

export const stayGuestService = {
  quote(
    venueId: string,
    lines: StayGuestCartLineInput[],
  ): Promise<StayQuote> {
    return invoke({
      action: "quote",
      payload: {
        venueId,
        lines,
        idempotencyKey: idempotencyKey("quote"),
      },
    });
  },

  async createGroup(
    quote: StayQuote,
    guest: StayGuestCheckoutInput["guest"],
  ): Promise<StayReservationGroup> {
    const attributionClickId = await getStoredNativeAdClickId();
    return invoke({
      action: "create_group",
      payload: {
        quoteId: quote.quoteId,
        guest,
        idempotencyKey: idempotencyKey("group"),
        ...(attributionClickId ? { attributionClickId } : {}),
      },
      expectedVersion: quote.version,
    });
  },

  getGroup(groupId: string): Promise<StayReservationGroup> {
    return invoke({
      action: "get_group",
      payload: { groupId },
    });
  },

  createPayment(group: StayReservationGroup): Promise<StayPaymentSession> {
    return invoke({
      action: "create_payment",
      payload: {
        groupId: group.groupId,
        idempotencyKey: `stay:payment:${group.groupId}`,
        surface: "native",
      },
      expectedVersion: group.version,
    });
  },

  cancelPreview(
    group: StayReservationGroup,
    selectedLineIds: string[],
  ): Promise<StayCancelPreview> {
    return invoke({
      action: "cancel_preview",
      payload: { groupId: group.groupId, selectedLineIds },
      expectedVersion: group.version,
    });
  },

  cancel(
    preview: StayCancelPreview,
    reason: string,
  ): Promise<{
    refundId: string;
    groupId: string;
    state: string;
    amountMinor: string;
    currencyCode: string;
    group: StayReservationGroup;
  }> {
    return invoke({
      action: "cancel",
      payload: {
        previewId: preview.previewId,
        previewHash: preview.previewHash,
        reason,
        idempotencyKey: idempotencyKey("cancel"),
      },
    });
  },
};
