import {
  type StayCancelPreview,
  type StayGuestCartLineInput,
  type StayGuestCheckoutInput,
  type StayPaymentSession,
  type StayQuote,
  type StayReservationGroup,
} from "@mingla/brand-rendering/stayGuest";

import { supabase } from "./supabase";
import { randomId } from "../utils/randomId";
import {
  getStoredAdMatchData,
  getStoredClickAttribution,
  identifyAdBuyer,
} from "../analytics/webAnalytics";

type StayEnvelope<T> =
  | { kind: "success"; data: T; requestId: string }
  | { kind: "error"; code: string; message: string; requestId: string };

/**
 * issue #4420 wave 2 (D-S7) — what the "booked under another email" page may
 * show a non-owner, from the server: never dates, rooms or totals.
 */
export interface StayOtherContactView {
  maskedEmail: string;
  venueName: string | null;
  brandSlug: string | null;
  brandName: string | null;
  publicReference: string | null;
  /** The booking has a guest email the server can send again. */
  resendable: boolean;
}

export class StayGuestError extends Error {
  readonly code: string;
  /** issue #4420 wave 2 (D-S7) — `stay_group_other_contact` only. */
  readonly otherContact: StayOtherContactView | null;
  /**
   * issue #4420 wave 2 (D-S7) — `stay_group_other_contact` only: the
   * booking contact's MASKED email ("g•••@example.com"), from the server.
   */
  readonly maskedEmail: string | null;

  constructor(
    code: string,
    message?: string,
    maskedEmail: string | null = null,
    otherContact: StayOtherContactView | null = null,
  ) {
    super(message ?? code.replaceAll("_", " "));
    this.name = "StayGuestError";
    this.code = code;
    this.maskedEmail = maskedEmail;
    this.otherContact = otherContact;
  }
}

const idempotencyKey = (scope: string): string =>
  `stay:${scope}:${randomId()}`;

async function invoke<T>(input: {
  action:
    | "quote"
    | "create_group"
    | "get_group"
    | "create_payment"
    | "cancel_preview"
    | "cancel"
    | "resend_guest_link";
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
    let maskedEmail: string | null = null;
    let otherContact: StayOtherContactView | null = null;
    const context = error.context as Response | undefined;
    if (context && typeof context.json === "function") {
      try {
        const body = (await context.json()) as {
          code?: unknown;
          message?: unknown;
          maskedEmail?: unknown;
          venueName?: unknown;
          brandSlug?: unknown;
          brandName?: unknown;
          publicReference?: unknown;
          resendable?: unknown;
        };
        if (typeof body.code === "string") code = body.code;
        if (typeof body.message === "string") message = body.message;
        if (typeof body.maskedEmail === "string" && body.maskedEmail.includes("•••@")) {
          maskedEmail = body.maskedEmail;
          const text = (value: unknown): string | null =>
            typeof value === "string" && value.length > 0 ? value : null;
          otherContact = {
            maskedEmail: body.maskedEmail,
            venueName: text(body.venueName),
            brandSlug: text(body.brandSlug),
            brandName: text(body.brandName),
            publicReference: text(body.publicReference),
            resendable: body.resendable === true,
          };
        }
      } catch {
        // Use the stable fallback when the edge response is not JSON.
      }
    }
    throw new StayGuestError(code, message, maskedEmail, otherContact);
  }
  if (!data || data.kind !== "success") {
    throw new StayGuestError(
      data?.code ?? "stay_reservation_failed",
      data?.message,
    );
  }
  return data.data;
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

  createGroup(
    quote: StayQuote,
    guest: StayGuestCheckoutInput["guest"],
  ): Promise<StayReservationGroup> {
    const attributionClickId = getStoredClickAttribution().clickId;
    const adMatchData = getStoredAdMatchData?.() ?? {
      fbp: null, fbc: null, scid: null, ttp: null,
      clientUserAgent: null, trackingOptOut: false,
    };
    void identifyAdBuyer?.({
      email: guest.email,
      phone: guest.phone,
    })?.catch(() => undefined);
    return invoke({
      action: "create_group",
      payload: {
        quoteId: quote.quoteId,
        guest,
        idempotencyKey: idempotencyKey("group"),
        ...(attributionClickId ? { attributionClickId } : {}),
        adMatchData,
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

  /**
   * issue #4420 wave 2 (D-S7) — "Email me the booking link again": the server
   * re-sends it to the booking's OWN address and answers with the mask only.
   */
  resendGuestLink(groupId: string): Promise<{ maskedEmail: string }> {
    return invoke({
      action: "resend_guest_link",
      payload: { groupId },
    });
  },

  createPayment(group: StayReservationGroup): Promise<StayPaymentSession> {
    return invoke({
      action: "create_payment",
      payload: {
        groupId: group.groupId,
        idempotencyKey: `stay:payment:${group.groupId}`,
        surface: "web",
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
