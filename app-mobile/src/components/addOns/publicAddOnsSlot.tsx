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
import { supabase } from "../../services/supabase";

export const addOnPhotoUrl = (path: string): string =>
  supabase.storage.from("event_covers").getPublicUrl(path).data.publicUrl;

const slot: OfferingAddOnsSlot = (id, addOns, currency, palette) => (
  <OfferingAddOnsBlock
    enabled
    id={id}
    addOns={addOns}
    currency={currency}
    palette={palette}
    photoUrl={addOnPhotoUrl}
  />
);

export const publicAddOnsSlot = (): OfferingAddOnsSlot | null =>
  FEATURE_FLAG_ADD_ONS ? slot : null;
