import type { StayPaymentSession } from "@mingla/brand-rendering/stayGuest";

import { supabase } from "./supabase";

export interface StayStaffPaymentLinkDetails {
  groupId: string;
  publicReference: string;
  state: string;
  version: number;
  currencyCode: string;
  totalMinor: string;
  guestName: string;
  venueName: string;
  brandName: string;
  expiresAt: string;
  paid: boolean;
  lines: {
    kind: "room" | "place";
    name: string;
    roomCheckIn: string | null;
    roomCheckOut: string | null;
    roomQuantity: number | null;
    placeGuests: number | null;
    totalMinor: string;
  }[];
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(
    "stay-staff-payment-link",
    { body },
  );
  if (error) {
    const response = error.context as Response | undefined;
    if (response && typeof response.json === "function") {
      const parsed = await response.json().catch(() => ({})) as { code?: unknown };
      if (typeof parsed.code === "string") throw new Error(parsed.code);
    }
    throw new Error("stay_payment_link_failed");
  }
  if (!data || typeof data !== "object" || (data as { kind?: unknown }).kind !== "success") {
    throw new Error("stay_payment_link_failed");
  }
  return (data as { data: T }).data;
}

export const stayStaffPaymentLinkService = {
  view(token: string): Promise<StayStaffPaymentLinkDetails> {
    return invoke({ action: "view", token });
  },
  pay(input: {
    token: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<StayPaymentSession> {
    return invoke({ action: "pay", ...input });
  },
};

