/**
 * issue #3281 S2 — Explorer's `addOns` slot for the shared offering bodies:
 * "Add at checkout:" under each ticket, package and option. Null while
 * FEATURE_FLAG_ADD_ONS is off (the default), so the screens render as before.
 * Thumbnails are the stored objects in the public `event_covers` bucket, never
 * an image transformation URL (the spend cap is armed).
 */

import React from "react";
import {
  OfferingAddOnsBlock,
  type OfferingAddOnsSlot,
} from "@mingla/offering-rendering/OfferingAddOnsBlock";

import { FEATURE_FLAG_ADD_ONS } from "../../config/featureFlags";
import { SUPABASE_URL } from "../../config/supabaseProject";

// The public object URL (storage/v1/object/public), built from the one project
// URL owner, so this module imports no client (the detail screens' render
// suites load it). Never /render/image.
export const addOnPhotoUrl = (path: string): string =>
  `${SUPABASE_URL}/storage/v1/object/public/event_covers/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

const slot: OfferingAddOnsSlot = (id, addOns, currency, palette) => (
  <OfferingAddOnsBlock
    enabled
    id={id}
    addOns={addOns}
    currency={currency}
    palette={palette}
    photoUrl={addOnPhotoUrl}
    // The RSVP card lists only what a guest can pick there: free add-ons (#3281 S6).
    freeOnly={id === "rsvp"}
  />
);

export const publicAddOnsSlot = (): OfferingAddOnsSlot | null =>
  FEATURE_FLAG_ADD_ONS ? slot : null;
