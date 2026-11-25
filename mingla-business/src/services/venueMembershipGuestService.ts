/**
 * #4490 P6-3 — a guest's membership calls: join a plan and read / leave /
 * stay / pause / resume it (edge `venue-offers`), and pay a month or confirm
 * the return from the payment page (edge `venue-membership-pay-link`).
 *
 * Anonymous by design, like buying entry: a signed-out browser sends only the
 * project key and is known by its cart key (join) and afterwards by the
 * member token `membership_join` returns once (kept on this device, or
 * arriving in the `#t=` fragment of a member email). A signed-in visitor's
 * session is sent automatically and the functions use it instead. Every
 * failure is thrown as `VenueOfferGuestError` with the server's code (turned
 * into words by `memberGuestErrorCopy`, never shown raw).
 */
import { supabase } from "./supabase";
import { VenueOfferGuestError } from "./venueOfferGuestService";

async function invoke(fn: "venue-offers" | "venue-membership-pay-link", body: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    const response = (error as { context?: unknown }).context as Response | undefined;
    if (response && typeof response.json === "function") {
      const parsed = (await response.json().catch(() => ({}))) as { code?: unknown };
      throw new VenueOfferGuestError(
        typeof parsed.code === "string" ? parsed.code : "membership_request_failed",
        typeof response.status === "number" ? response.status : null,
      );
    }
    throw new VenueOfferGuestError("membership_request_failed", null);
  }
  if (!data || typeof data !== "object" || (data as { kind?: unknown }).kind !== "success") {
    throw new VenueOfferGuestError("membership_request_failed", null);
  }
  return (data as { data: unknown }).data;
}

const token = (t: string | null): Record<string, string> => (t !== null && t.length > 0 ? { token: t } : {});

export interface MembershipJoinResult {
  raw: unknown;
  subscriptionId: string;
  memberToken: string | null;
  status: string | null;
}

export interface MembershipPayRedirect {
  authorizationUrl: string;
  amountMinor: number | null;
  currencyCode: string | null;
}

export type MembershipReturnOutcome = "confirmed" | "pending" | "not_paid" | "failed" | "nothing_to_confirm";

export const venueMembershipGuestService = {
  async join(input: {
    planId: string;
    member: { name: string; email: string; phone?: string };
    startOn: string | null;
    cartKey: string;
    idempotencyKey: string;
  }): Promise<MembershipJoinResult> {
    const raw = (await invoke("venue-offers", {
      action: "membership_join",
      planId: input.planId,
      member: input.member,
      ...(input.startOn !== null ? { startOn: input.startOn } : {}),
      cartKey: input.cartKey,
      idempotencyKey: input.idempotencyKey,
    })) as Record<string, unknown>;
    const subscriptionId = typeof raw?.subscriptionId === "string" ? raw.subscriptionId : null;
    if (subscriptionId === null) throw new VenueOfferGuestError("membership_request_failed", null);
    return {
      raw,
      subscriptionId,
      memberToken: typeof raw.memberToken === "string" ? raw.memberToken : null,
      status: typeof raw.status === "string" ? raw.status : null,
    };
  },

  async get(input: { subscriptionId: string; token: string | null }): Promise<unknown> {
    return invoke("venue-offers", { action: "membership_get", subscriptionId: input.subscriptionId, ...token(input.token) });
  },

  async act(input: {
    subscriptionId: string;
    token: string | null;
    action: "membership_leave" | "membership_stay" | "membership_pause" | "membership_resume";
    idempotencyKey: string;
  }): Promise<unknown> {
    return invoke("venue-offers", {
      action: input.action,
      subscriptionId: input.subscriptionId,
      ...token(input.token),
      idempotencyKey: input.idempotencyKey,
    });
  },

  async pay(input: { subscriptionId: string; token: string | null; idempotencyKey: string }): Promise<MembershipPayRedirect> {
    const raw = (await invoke("venue-membership-pay-link", {
      action: "pay",
      subscriptionId: input.subscriptionId,
      ...token(input.token),
      idempotencyKey: input.idempotencyKey,
    })) as Record<string, unknown>;
    if (raw?.kind === "requires_redirect" && typeof raw.authorizationUrl === "string") {
      return {
        authorizationUrl: raw.authorizationUrl,
        amountMinor: typeof raw.amountMinor === "number" ? raw.amountMinor : null,
        currencyCode: typeof raw.currencyCode === "string" ? raw.currencyCode : null,
      };
    }
    throw new VenueOfferGuestError("membership_payment_unavailable", null);
  },

  async confirmReturn(input: { subscriptionId: string; token: string | null }): Promise<{ outcome: MembershipReturnOutcome; member: unknown }> {
    const raw = (await invoke("venue-membership-pay-link", {
      action: "confirm_return",
      subscriptionId: input.subscriptionId,
      ...token(input.token),
    })) as Record<string, unknown>;
    const o = raw?.outcome;
    return {
      outcome: o === "confirmed" || o === "pending" || o === "not_paid" || o === "failed" ? o : "nothing_to_confirm",
      member: raw?.member ?? null,
    };
  },
};
