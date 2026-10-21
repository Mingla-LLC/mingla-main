import { useEffect, useMemo, useState } from "react";

import type { TicketStub } from "../store/draftEventStore";
import { supabase } from "../services/supabase";
import type { TicketLinkResolve } from "../services/ticketLinkPublicTypes";

const resolveTicketLink = async (token: string): Promise<TicketLinkResolve> => {
  const { data, error } = await supabase.functions.invoke("ticket-link-public", {
    body: { op: "resolve", token },
  });
  if (error) throw error;
  return data as TicketLinkResolve;
};

export const privateTicketFromLink = (
  value: TicketLinkResolve | null,
  eventId: string | null,
): TicketStub | null => {
  if (
    value?.state !== "active" ||
    value.kind !== "private_ticket" ||
    value.eventId !== eventId ||
    value.tier === undefined
  ) return null;
  const tier = value.tier;
  const unlimited = tier.isUnlimited === true;
  return {
    id: tier.id,
    name: tier.name,
    description: tier.description ?? null,
    priceGbp: (tier.priceCents ?? 0) / 100,
    priceAllInGbp: (tier.allInCents ?? tier.priceCents ?? 0) / 100,
    currency: tier.currency,
    capacity: unlimited
      ? null
      : (tier.remaining ?? tier.maxPurchaseQty ?? 5_000),
    isFree: (tier.priceCents ?? 0) === 0,
    isUnlimited: unlimited,
    visibility: "public",
    displayOrder: 0,
    approvalRequired: false,
    passwordProtected: false,
    password: null,
    passwordConfigured: false,
    waitlistEnabled: tier.waitlistEnabled === true,
    minPurchaseQty: tier.minPurchaseQty ?? 1,
    maxPurchaseQty: tier.maxPurchaseQty ?? null,
    allowTransfers: true,
    saleStartAt: tier.saleStartAt ?? null,
    saleEndAt: tier.saleEndAt ?? null,
    availableAt: "both",
  };
};

export function useTicketLinkUnlock(token: string | null, eventId: string | null): {
  loading: boolean;
  resolved: TicketLinkResolve | null;
  ticket: TicketStub | null;
} {
  const [resolved, setResolved] = useState<TicketLinkResolve | null>(null);
  const [loading, setLoading] = useState(token !== null);

  useEffect(() => {
    let cancelled = false;
    if (token === null) {
      setResolved(null);
      setLoading(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    resolveTicketLink(token)
      .then((value) => {
        if (!cancelled) setResolved(value);
      })
      .catch(() => {
        if (!cancelled) setResolved({ state: "not_found" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [token]);

  const ticket = useMemo(
    () => privateTicketFromLink(resolved, eventId),
    [eventId, resolved],
  );
  return { loading, resolved, ticket };
}
