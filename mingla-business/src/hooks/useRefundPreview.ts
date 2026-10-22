import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";

export interface RefundPreviewLineInput {
  orderLineItemId: string;
  quantity: number;
}

export interface RefundPreview {
  orderId: string;
  currency: string;
  amountCents: number;
  remainingCents: number;
  withinRemaining: boolean;
  lines: Array<{
    orderLineItemId: string;
    quantity: number;
    amountCents: number;
  }>;
}

export const refundPreviewKeys = {
  preview: (orderId: string, linesKey: string) =>
    ["refund-preview", orderId, linesKey] as const,
};

const parsePreview = (raw: unknown): RefundPreview => {
  const value = raw as Record<string, unknown>;
  const rows = Array.isArray(value.lines) ? value.lines : [];
  return {
    orderId: String(value.order_id ?? ""),
    currency: String(value.currency ?? ""),
    amountCents: Number(value.amount_cents ?? 0),
    remainingCents: Number(value.remaining_cents ?? 0),
    withinRemaining: value.within_remaining === true,
    lines: rows.map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        orderLineItemId: String(row.order_line_item_id ?? ""),
        quantity: Number(row.quantity ?? 0),
        amountCents: Number(row.amount_cents ?? 0),
      };
    }),
  };
};

export function useRefundPreview(
  orderId: string | null,
  lines: RefundPreviewLineInput[],
): UseQueryResult<RefundPreview, Error> & { isDebouncing: boolean } {
  const { isAuthReady } = useAuth();
  const immediateKey = JSON.stringify(lines);
  const [debouncedKey, setDebouncedKey] = useState(immediateKey);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKey(immediateKey), 250);
    return () => clearTimeout(timer);
  }, [immediateKey]);
  const debouncedLines = useMemo(
    () => JSON.parse(debouncedKey) as RefundPreviewLineInput[],
    [debouncedKey],
  );
  const enabled =
    isAuthReady &&
    orderId !== null &&
    debouncedLines.length > 0 &&
    debouncedLines.every(
      (line) => line.orderLineItemId.length > 0 && line.quantity > 0,
    );
  const query = useQuery<RefundPreview, Error>({
    queryKey: refundPreviewKeys.preview(orderId ?? "disabled", debouncedKey),
    enabled,
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      if (orderId === null) throw new Error("order_missing");
      const { data, error } = await supabase.rpc("refund_preview", {
        p_order_id: orderId,
        p_lines: debouncedLines.map((line) => ({
          order_line_item_id: line.orderLineItemId,
          quantity: line.quantity,
        })),
      });
      if (error) throw new Error(error.message);
      return parsePreview(data);
    },
  });
  return { ...query, isDebouncing: immediateKey !== debouncedKey };
}
