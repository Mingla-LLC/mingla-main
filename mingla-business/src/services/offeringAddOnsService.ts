/**
 * issue #3281 S3 — the one read and the one write of an offering's add-ons.
 *
 * Both RPCs work for every offering type (event, trip, experience, RSVP) and
 * check the caller's rank on the server. Saves send the whole list with the
 * revision the editor read; a stale save is refused with PT409
 * `add_ons_changed_elsewhere`. Services throw (Constitution 3): callers show
 * the copy from `addOnErrorCopy(error.code)`.
 */

import {
  parseOfferingAddOns,
  type AddOnSaveItem,
  type OfferingAddOnsPayload,
} from "../components/addOns/addOnsEditorModel";
import { supabase } from "./supabase";

export class OfferingAddOnsError extends Error {
  readonly code: string;
  readonly sqlState: string | null;

  constructor(code: string, sqlState: string | null = null) {
    super(code);
    this.name = "OfferingAddOnsError";
    this.code = code;
    this.sqlState = sqlState;
  }
}

interface RpcError {
  code?: string | null;
  message?: string | null;
}

/**
 * issue #3281 G-9 — the database has no add-on reader yet (web deploys before
 * its migrations): the function, table or column does not exist. Same codes
 * the plan-v2 schema probe treats as "not applied" (kept inline: this service
 * loads with every offering editor).
 */
const READER_ABSENT_CODES: ReadonlySet<string> = new Set([
  "42703",
  "42883",
  "42P01",
  "PGRST202",
  "PGRST204",
  "PGRST205",
]);

const toError = (error: RpcError): OfferingAddOnsError => {
  const message = typeof error.message === "string" ? error.message.trim() : "";
  const sqlState = typeof error.code === "string" ? error.code : null;
  if (sqlState !== null && READER_ABSENT_CODES.has(sqlState)) {
    return new OfferingAddOnsError("add_ons_unavailable", sqlState);
  }
  // The SQL raises bare snake_case codes; anything else is a transport error.
  const code = /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(message)
    ? message
    : sqlState === "PT409"
      ? "add_ons_changed_elsewhere"
      : "unknown";
  return new OfferingAddOnsError(code, sqlState);
};

export const fetchOfferingAddOns = async (eventId: string): Promise<OfferingAddOnsPayload> => {
  const { data, error } = await supabase.rpc("biz_offering_add_ons", { p_event_id: eventId });
  if (error !== null) throw toError(error);
  try {
    return parseOfferingAddOns(data);
  } catch {
    throw new OfferingAddOnsError("add_ons_invalid");
  }
};

export const saveOfferingAddOns = async (input: {
  eventId: string;
  addOns: AddOnSaveItem[];
  expectedRevision: number;
}): Promise<OfferingAddOnsPayload> => {
  const { data, error } = await supabase.rpc("biz_offering_add_ons_save", {
    p_event_id: input.eventId,
    p_add_ons: input.addOns,
    p_expected_revision: input.expectedRevision,
  });
  if (error !== null) throw toError(error);
  try {
    return parseOfferingAddOns(data);
  } catch {
    throw new OfferingAddOnsError("add_ons_invalid");
  }
};

/** Bucket and folder S1 fixed for add-on photos (`ticket_add_ons` CHECKs). */
export const ADD_ON_PHOTO_BUCKET = "event_covers";

/** Public URL of a stored add-on photo. Never a transformation endpoint. */
export const addOnPhotoPublicUrl = (path: string): string =>
  supabase.storage.from(ADD_ON_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;

/**
 * Uploads the two JPEGs the device made (full and thumbnail) under
 * `add-ons/{eventId}/{uuid}.jpg` and `{uuid}_thumb.jpg`.
 */
export const uploadAddOnPhoto = async (input: {
  eventId: string;
  photoId: string;
  full: Uint8Array | Blob;
  thumb: Uint8Array | Blob;
}): Promise<{ photoPath: string; photoThumbPath: string }> => {
  const photoPath = `add-ons/${input.eventId}/${input.photoId}.jpg`;
  const photoThumbPath = `add-ons/${input.eventId}/${input.photoId}_thumb.jpg`;
  const bucket = supabase.storage.from(ADD_ON_PHOTO_BUCKET);
  const full = await bucket.upload(photoPath, input.full, { contentType: "image/jpeg", upsert: true });
  if (full.error !== null) throw new OfferingAddOnsError("add_on_photo_upload_failed");
  const thumb = await bucket.upload(photoThumbPath, input.thumb, { contentType: "image/jpeg", upsert: true });
  if (thumb.error !== null) throw new OfferingAddOnsError("add_on_photo_upload_failed");
  return { photoPath, photoThumbPath };
};
