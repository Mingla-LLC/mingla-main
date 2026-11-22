/**
 * issue #3281 — where an add-on's stored photo is read from: the public
 * `event_covers` bucket, the stored object as is (never an image
 * transformation URL; the spend cap is armed). One owner for the editor's
 * upload and every public page's thumbnail.
 */

import type { OfferingAddOnsDisplay } from "@mingla/offering-rendering/offeringAddOnChips";

import { featureFlags } from "../config/featureFlags";
import { supabase } from "./supabase";

export const ADD_ON_PHOTO_BUCKET = "event_covers";

export const addOnPhotoPublicUrl = (path: string): string =>
  supabase.storage.from(ADD_ON_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;

const PUBLIC_ADD_ONS: OfferingAddOnsDisplay = { photoUrl: addOnPhotoPublicUrl };

/**
 * issue #3281 S2 — what a public page passes its offering body to list each
 * ticket's add-ons; null (EXPO_PUBLIC_FF_EXTRAS_ENABLED off) lists none.
 */
export const publicAddOnsDisplay = (): OfferingAddOnsDisplay | null =>
  featureFlags.extras ? PUBLIC_ADD_ONS : null;
