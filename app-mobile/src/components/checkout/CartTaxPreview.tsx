// ORCH-1006 Slice 3 (Surface 6, WAVE 1) — buyer-side all-in price preview.
//
// SPEC §B.6 / §D.4: the billing-address form + the "Calculate tax" gate are
// REMOVED from the buyer flow. Tax is sourced at the VENUE server-side
// (events.venue_tax_address); the buyer NEVER types an address. This module is
// now a HEADLESS hook that fires the repurposed `mode:"preview"` engine call
// (no address) as soon as the cart is non-empty, and returns the all-in
// `buyer_total` + the canonical `pricing_breakdown` for the sticky-bar display
// + the "What's included" panel.
//
// History: this file used to render a `<CartTaxPreview>` billing-address form
// component that gated the CTA behind a manual "Calculate tax" tap (which
// computed £0 for nearly everyone — pure friction). That component is deleted.
// Its only consumer was `TicketCartSheet.tsx`, which now drives this hook.

import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "../../services/supabase";

/**
 * The canonical server `pricing_breakdown` shape (ORCH-1006 engine —
 * `_shared/allInPricingEngine.ts` `PricingBreakdown`). Mirrored here as the
 * client-side read contract for the all-in surfaces. All money fields are in
 * the smallest currency unit (cents/pence). Currency is resolved server-side;
 * NEVER hardcode a symbol — format with the breakdown's `currency`.
 */
export interface PricingBreakdown {
  region: string;
  currency: string;
  tax_behavior: "inclusive" | "exclusive";
  tax_basis: string;
  switches: {
    pass_tax: boolean;
    pass_mingla_fee: boolean;
    pass_service_fee: boolean;
  };
  base_cents: number;
  buyer_subtotal_cents: number;
  buyer_total_cents: number;
  components: {
    mingla_fee_cents: number;
    service_fee_cents: number;
    tax_cents: number;
  };
  passed: {
    mingla_fee_cents: number;
    service_fee_cents: number;
    tax_cents: number;
  };
  absorbed: {
    mingla_fee_cents: number;
    service_fee_cents: number;
    tax_cents: number;
  };
  application_fee_amount_cents: number;
  connected_account_payout_cents: number;
  stripe_tax_calculation_id: string | null;
  effective_take_rate_bps: number;
  take_rate_source: string;
}

/**
 * Result of the headless all-in preview. `totalCents` is the buyer's all-in
 * total (engine `buyer_total_cents`); `calculationId` is forwarded to the
 * checkout-create call so the buyer pays exactly what the preview showed.
 */
export interface CartAllInPreviewResult {
  calculationId: string | null;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  pricingBreakdown: PricingBreakdown | null;
  taxBreakdown: unknown[];
}

type PreviewLine = { ticketTypeId: string; quantity: number };

interface PreviewResponse {
  kind?: string;
  calculationId: string | null;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  currency?: string;
  pricingBreakdown?: PricingBreakdown | null;
  taxBreakdown?: unknown[];
}

export type CartAllInPreviewStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error";

export interface UseCartAllInPreviewResult {
  status: CartAllInPreviewStatus;
  preview: CartAllInPreviewResult | null;
  /** Manual retry after a true network failure. */
  retry: () => void;
}

const linesKey = (lines: PreviewLine[]): string =>
  lines
    .filter((l) => l.quantity > 0)
    .map((l) => `${l.ticketTypeId}:${l.quantity}`)
    .sort()
    .join("|");

/**
 * useCartAllInPreview — fires the no-address `mode:"preview"` engine call and
 * keeps the all-in total + breakdown in sync with the cart lines. Refetches
 * whenever the line set/quantities change. NO address, NO manual gate.
 *
 * @param enabled  false while the sheet is closed / submitting / cart empty.
 */
export const useCartAllInPreview = (args: {
  eventId: string;
  lines: PreviewLine[];
  buyer: { name: string; email: string; phone: string; marketingOptIn?: boolean };
  enabled: boolean;
}): UseCartAllInPreviewResult => {
  const { eventId, lines, buyer, enabled } = args;

  const [status, setStatus] = useState<CartAllInPreviewStatus>("idle");
  const [preview, setPreview] = useState<CartAllInPreviewResult | null>(null);

  const key = enabled ? linesKey(lines) : "";
  // Latest in-flight request token so a stale response never overwrites a
  // newer one (rapid quantity taps).
  const requestRef = useRef(0);
  const [retryTick, setRetryTick] = useState(0);

  const retry = useCallback(() => setRetryTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled || key.length === 0) {
      setStatus("idle");
      setPreview(null);
      return;
    }

    let cancelled = false;
    const token = ++requestRef.current;
    setStatus("loading");

    void (async () => {
      const { data, error } = await supabase.functions.invoke<PreviewResponse>(
        "ticket-checkout-create",
        {
          body: {
            eventId,
            surface: "native",
            mode: "preview",
            // No address — the engine sources tax at the venue (SPEC §B.1).
            buyer: {
              name: buyer.name,
              email: buyer.email,
              phone: buyer.phone,
              marketingOptIn: buyer.marketingOptIn === true,
            },
            lines: lines.filter((l) => l.quantity > 0),
          },
        },
      );
      if (cancelled || token !== requestRef.current) return;
      if (error || !data) {
        setStatus("error");
        setPreview(null);
        return;
      }
      setPreview({
        calculationId: data.calculationId ?? null,
        subtotalCents: data.subtotalCents,
        taxCents: data.taxCents,
        totalCents: data.totalCents,
        currency: data.currency ?? data.pricingBreakdown?.currency ?? "GBP",
        pricingBreakdown: data.pricingBreakdown ?? null,
        taxBreakdown: data.taxBreakdown ?? [],
      });
      setStatus("ready");
    })();

    return () => {
      cancelled = true;
    };
    // `key` captures the line set; buyer fields are stable per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, eventId, retryTick]);

  return { status, preview, retry };
};
