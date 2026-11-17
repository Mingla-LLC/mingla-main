import type { StayPaymentSession } from "@mingla/brand-rendering/stayGuest";
import type { ThemeInput } from "@mingla/offering-rendering";
import { themeInputFromFields } from "@mingla/offering-rendering/themeResolver";

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
  /** issue #4420 — the brand's public slug (null for a deleted brand). */
  brandSlug?: string | null;
  /**
   * issue #4420 — the brand's public theme, guarded into a ThemeInput (only
   * valid colours, fonts and animations survive). Null when the brand has no
   * theme or the details predate it: the page then stays on the Mingla
   * default palette, never a guessed colour.
   */
  brandTheme: ThemeInput | null;
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

/** #4420 — the details RPC's `brandTheme` object → a guarded ThemeInput. */
export function brandThemeFrom(raw: unknown): ThemeInput | null {
  if (raw === null || typeof raw !== "object") return null;
  const fields = raw as Record<string, unknown>;
  return themeInputFromFields(
    fields.color,
    fields.font,
    fields.animation,
    fields.gradient,
  );
}

export const stayStaffPaymentLinkService = {
  async view(token: string): Promise<StayStaffPaymentLinkDetails> {
    const raw = await invoke<
      Omit<StayStaffPaymentLinkDetails, "brandTheme"> & { brandTheme?: unknown }
    >({ action: "view", token });
    return { ...raw, brandTheme: brandThemeFrom(raw.brandTheme) };
  },
  pay(input: {
    token: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<StayPaymentSession> {
    return invoke({ action: "pay", ...input });
  },
};
