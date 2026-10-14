/**
 * #3645 — lazy host for the RSVP "Return to draft" / "Cancel RSVP" dialogs.
 *
 * A static import from the RSVP dashboard would pull the dialogs, the cancel
 * mutation and the lifecycle service into the route's start-up code for
 * something a host opens rarely. Same treatment, and same reason, as
 * LazyPublishedBanner. Nothing is loaded until the host first taps one of the
 * two buttons; after that the dialogs stay mounted so closing can animate.
 */

import React from "react";

import type { RsvpLifecycleDialogsProps } from "./RsvpLifecycleDialogs";

const RsvpLifecycleDialogsImpl = React.lazy(async () => {
  const module = await import("./RsvpLifecycleDialogs");
  return { default: module.RsvpLifecycleDialogs };
});

export const LazyRsvpLifecycleDialogs: React.FC<RsvpLifecycleDialogsProps> = (
  props,
) => (
  <React.Suspense fallback={null}>
    <RsvpLifecycleDialogsImpl {...props} />
  </React.Suspense>
);
