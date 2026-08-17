/**
 * TicketCheckoutAccessNotice (NATIVE) — issue #2101 [named-buyer checkout].
 *
 * A typed null renderer. It imports NEITHER the eligibility hook NOR the
 * service NOR Supabase, so Metro's platform resolution keeps the real module
 * out of every native bundle and native behavior is byte-identical to today.
 * No native screen, app version bump, EAS build, store release or OTA is part
 * of this issue.
 *
 * Native clients are NOT unprotected: the shared backend is authoritative, so a
 * non-allowed native buyer receives the stable server denial with zero
 * provider side effects.
 */

import React from "react";

export interface TicketCheckoutAccessNoticeProps {
  eventId: string;
  testID?: string;
}

export const TicketCheckoutAccessNotice: React.FC<
  TicketCheckoutAccessNoticeProps
> = () => null;
