import { supabase } from "./supabase";
import type { EventCoverMediaType } from "../store/draftEventStore";
import {
  EventCoverMediaError,
  EVENT_COVER_MAX_BYTES,
  EVENT_COVER_UPLOAD_LIMIT_COPY,
  EVENT_COVER_MAX_VIDEO_DURATION_MS,
  classifyEventCoverMedia,
  eventCoverContentType,
  eventCoverExtension,
  normalizeEventCoverAsset,
  validateEventCoverAsset,
  verifyEventCoverPublicUrl,
  type EventCoverMediaErrorCode,
} from "../utils/eventCoverMediaRules";
import { readEventCoverFileBytes } from "./eventCoverFileReader";
import type { EventCoverProviderMetadata } from "../types/eventCoverProvider";
import { randomId } from "../utils/randomId";

export const EVENT_COVER_BUCKET = "event_covers";
export {
  EventCoverMediaError,
  EVENT_COVER_MAX_BYTES,
  EVENT_COVER_UPLOAD_LIMIT_COPY,
  EVENT_COVER_MAX_VIDEO_DURATION_MS,
  classifyEventCoverMedia,
  eventCoverContentType,
  eventCoverExtension,
  normalizeEventCoverAsset,
  validateEventCoverAsset,
  verifyEventCoverPublicUrl,
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
  pickerType?: string | null;
}

export interface EventCoverUploadResult {
  publicUrl: string;
  storagePath: string;
  mediaType: EventCoverMediaType;
}

export const eventCoverPath = (
  brandId: string,
  eventId: string,
  mediaType: EventCoverMediaType,
  mimeType?: string | null,
  fileName?: string | null,
  uri?: string | null,
): string =>
  `${brandId}/${eventId}/${randomId()}.${eventCoverExtension({
    mediaType,
    mimeType,
    fileName,
    uri,
  })}`;

const logCoverUploadDebug = (
  label: string,
  payload: Record<string, unknown>,
): void => {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.info(`[eventCoverMedia] ${label}`, payload);
  }
};

export const uploadEventCoverMedia = async (
  input: EventCoverAssetInput,
): Promise<EventCoverUploadResult> => {
  if (input.eventId.trim().length === 0) {
    throw new EventCoverMediaError(
      "missing_server_event_id",
      "Save failed because this event is missing its server id.",
    );
  }

  if (
    typeof input.fileSize === "number" &&
    input.fileSize > EVENT_COVER_MAX_BYTES
  ) {
    throw new EventCoverMediaError(
      "file_too_large",
      "Covers must be 30 MB or smaller.",
    );
  }

  const fileBytes = await readEventCoverFileBytes(input.uri);
  if (fileBytes.byteLength <= 0) {
    logCoverUploadDebug("local-file-empty", {
      fileName: input.fileName,
      inputFileSize: input.fileSize,
      mimeType: input.mimeType,
      pickerType: input.pickerType,
      uri: input.uri,
    });
    throw new EventCoverMediaError(
      "upload_failed",
      "We couldn't read that file. Try another cover.",
    );
  }

  if (fileBytes.byteLength > EVENT_COVER_MAX_BYTES) {
    throw new EventCoverMediaError(
      "file_too_large",
      "Covers must be 30 MB or smaller.",
    );
  }

  const normalized = normalizeEventCoverAsset({
    byteHeader: fileBytes.bytes,
    durationMs: input.durationMs,
    fileName: input.fileName,
    fileSize: fileBytes.byteLength,
    mimeType: input.mimeType,
    pickerType: input.pickerType,
    uri: input.uri,
  });
  const mediaType = validateEventCoverAsset(normalized);
  const contentType = normalized.inferredMimeType ?? eventCoverContentType({
    byteHeader: fileBytes.bytes,
    fileName: input.fileName,
    mediaType,
    mimeType: input.mimeType,
    uri: input.uri,
  });
  const storagePath = eventCoverPath(
    input.brandId,
    input.eventId,
    mediaType,
    contentType,
    input.fileName,
    input.uri,
  );

  logCoverUploadDebug("upload-start", {
    contentType,
    durationMs: input.durationMs,
    fileName: input.fileName,
    fileSize: fileBytes.byteLength,
    mediaType,
    pickerType: input.pickerType,
    storagePath,
  });

  const { error } = await supabase.storage
    .from(EVENT_COVER_BUCKET)
    .upload(storagePath, fileBytes.bytes, { contentType, upsert: true });

  if (error !== null) {
    throw new EventCoverMediaError("upload_failed", error.message);
  }

  const { data } = supabase.storage
    .from(EVENT_COVER_BUCKET)
    .getPublicUrl(storagePath);

  await verifyEventCoverPublicUrl(data.publicUrl, mediaType);
  logCoverUploadDebug("upload-verified", {
    mediaType,
    publicUrl: data.publicUrl,
    storagePath,
  });

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
  metadata: EventCoverProviderMetadata | null = null,
): Promise<void> => {
  if (serverEventId.trim().length === 0) {
    throw new EventCoverMediaError(
      "missing_server_event_id",
      "Save failed because this event is missing its server id.",
    );
  }
  // ORCH-0859 REWORK 3 (events-type-filter audit): event-wizard cover
  // media writer is event-only. Trip wizard manages its own cover via
  // theme.business_trip + its own service path.
  const { data, error } = await supabase
    .from("events")
    .update({
      cover_media_url: mediaUrl,
      cover_media_type: mediaUrl === null ? null : mediaType,
      cover_media_provider: mediaUrl === null ? null : metadata?.provider ?? null,
      cover_media_source_url: mediaUrl === null ? null : metadata?.sourceUrl ?? null,
      cover_media_credit: mediaUrl === null ? null : metadata?.credit ?? null,
      cover_media_credit_url: mediaUrl === null ? null : metadata?.creditUrl ?? null,
      cover_media_alt: mediaUrl === null ? null : metadata?.alt ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", serverEventId)
    .eq("event_type", "event")
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error !== null) {
    throw new EventCoverMediaError("upload_failed", error.message);
  }
  if (data === null) {
    throw new EventCoverMediaError(
      "missing_server_event_id",
      "Save failed because this event could not be found.",
    );
  }
};
