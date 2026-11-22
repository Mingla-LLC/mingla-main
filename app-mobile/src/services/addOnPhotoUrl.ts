/**
 * issue #3281 S2 — Explorer's public add-on list: each add-on's stored photo
 * from the public `event_covers` bucket, the stored object as is (never an
 * image transformation URL), and whether detail pages list add-ons at all.
 */

import type { OfferingAddOnsDisplay } from "@mingla/offering-rendering/offeringAddOnChips";

import { FEATURE_FLAG_ADD_ONS } from "../config/featureFlags";
import { supabase } from "./supabase";

const ADD_ON_PHOTO_BUCKET = "event_covers";

const PUBLIC_ADD_ONS: OfferingAddOnsDisplay = {
  photoUrl: (path: string): string =>
    supabase.storage.from(ADD_ON_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl,
};

/** Null (the flag off, the default) lists no add-ons. */
export const publicAddOnsDisplay = (): OfferingAddOnsDisplay | null =>
  FEATURE_FLAG_ADD_ONS ? PUBLIC_ADD_ONS : null;
