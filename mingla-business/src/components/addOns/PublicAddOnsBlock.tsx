/**
 * issue #3281 S2 — the public "Add at checkout:" list, loaded on use by
 * `publicAddOnsSlot` (components/offering/LazyPublicParts). Thumbnails are the stored objects in the public
 * `event_covers` bucket (the bucket S1 fixed for add-on photos), never an
 * image transformation URL (the spend cap is armed).
 */

import React from "react";
import { OfferingAddOnsBlock } from "@mingla/offering-rendering/OfferingAddOnsBlock";
import type { ThemePalette } from "@mingla/offering-rendering/themePalette";

import { supabase } from "../../services/supabase";

const photoUrl = (path: string): string =>
  supabase.storage.from("event_covers").getPublicUrl(path).data.publicUrl;

export interface PublicAddOnsBlockProps {
  id: string;
  addOns: unknown;
  currency: string | null;
  palette: ThemePalette;
}

export default function PublicAddOnsBlock(props: PublicAddOnsBlockProps): React.ReactElement {
  return <OfferingAddOnsBlock enabled photoUrl={photoUrl} {...props} />;
}
