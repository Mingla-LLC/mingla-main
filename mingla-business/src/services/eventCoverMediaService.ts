import { supabase } from "./supabase";
import type { EventCoverMediaType } from "../store/draftEventStore";
import {
  EventCoverMediaError,
  EVENT_COVER_MAX_BYTES,
  EVENT_COVER_MAX_VIDEO_DURATION_MS,
  classifyEventCoverMedia,
  validateEventCoverAsset,
  type EventCoverMediaErrorCode,
} from "../utils/eventCoverMediaRules";

export const EVENT_COVER_BUCKET = "event_covers";
export {
  EventCoverMediaError,
  EVENT_COVER_MAX_BYTES,
  EVENT_COVER_MAX_VIDEO_DURATION_MS,
  classifyEventCoverMedia,
  validateEventCoverAsset,
  type EventCoverMediaErrorCode,
};

export interface EventCoverAssetInput {
  uri: string;
  brandId: string;
  eventId: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  durationMs?: number | null;
}

export interface EventCoverUploadResult {
  publicUrl: string;
  storagePath: string;
  mediaType: EventCoverMediaType;
}

const EXTENSION_BY_TYPE: Record<EventCoverMediaType, string> = {
  image: "jpg",
  gif: "gif",
  video: "mp4",
};

const cleanMime = (mimeType?: string | null): string =>
  typeof mimeType === "string" ? mimeType.trim().toLowerCase() : "";

const randomId = (): string => {
  const maybeCrypto = globalThis.crypto as Crypto | undefined;
  if (typeof maybeCrypto?.randomUUID === "function") {
    return maybeCrypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const eventCoverPath = (
  brandId: string,
  eventId: string,
  mediaType: EventCoverMediaType,
): string => `${brandId}/${eventId}/${randomId()}.${EXTENSION_BY_TYPE[mediaType]}`;

export const uploadEventCoverMedia = async (
  input: EventCoverAssetInput,
): Promise<EventCoverUploadResult> => {
  if (input.eventId.trim().length === 0) {
    throw new EventCoverMediaError(
      "missing_server_event_id",
      "Save failed because this event is missing its server id.",
    );
  }

  const preliminaryType = validateEventCoverAsset(input);
  const response = await fetch(input.uri);
  if (!response.ok) {
    throw new EventCoverMediaError(
      "upload_failed",
      "We couldn't read that file. Try another cover.",
    );
  }

  const blob = await response.blob();
  const mediaType = validateEventCoverAsset({
    ...input,
    mimeType: input.mimeType ?? blob.type,
    fileSize: input.fileSize ?? blob.size,
  });
  const storagePath = eventCoverPath(input.brandId, input.eventId, mediaType);
  const contentType =
    cleanMime(input.mimeType) ||
    cleanMime(blob.type) ||
    (preliminaryType === "video" ? "video/mp4" : "image/jpeg");

  const { error } = await supabase.storage
    .from(EVENT_COVER_BUCKET)
    .upload(storagePath, blob, { contentType, upsert: true });

  if (error !== null) {
    throw new EventCoverMediaError("upload_failed", error.message);
  }

  const { data } = supabase.storage
    .from(EVENT_COVER_BUCKET)
    .getPublicUrl(storagePath);

  return {
    publicUrl: data.publicUrl,
    storagePath,
    mediaType,
  };
};

export const updatePublishedEventCoverMedia = async (
  serverEventId: string,
  mediaUrl: string | null,
  mediaType: EventCoverMediaType | null,
): Promise<void> => {
  if (serverEventId.trim().length === 0) {
    throw new EventCoverMediaError(
      "missing_server_event_id",
      "Save failed because this event is missing its server id.",
    );
  }
  const { error } = await supabase
    .from("events")
    .update({
      cover_media_url: mediaUrl,
      cover_media_type: mediaUrl === null ? null : mediaType,
      updated_at: new Date().toISOString(),
    })
    .eq("id", serverEventId)
    .is("deleted_at", null);

  if (error !== null) {
    throw new EventCoverMediaError("upload_failed", error.message);
  }
};
