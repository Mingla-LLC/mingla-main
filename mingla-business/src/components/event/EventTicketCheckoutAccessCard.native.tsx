/**
 * EventTicketCheckoutAccessCard (NATIVE) — issue #2101 [named-buyer checkout].
 *
 * A typed null renderer. Amendment 2 §A2.4 declares Business iOS and Business
 * Android as "backend-enforced compatibility; NO new UI", so this file imports
 * NEITHER the access hook NOR the service NOR Supabase. Metro's platform
 * resolution therefore excludes the real configuration module from every native
 * bundle: there is no native control to configure a restricted sale, and no
 * native build, app version bump, store release or OTA is part of this issue.
 */

import React from "react";

export interface EventTicketCheckoutAccessCardProps {
  eventId: string;
  testID?: string;
}

export const EventTicketCheckoutAccessCard: React.FC<
  EventTicketCheckoutAccessCardProps
> = () => null;
