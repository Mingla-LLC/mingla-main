import { supabase } from "./supabase";
import type { EventCoverMediaType } from "../store/draftEventStore";
import type { OfferingGalleryImage } from "@mingla/offering-rendering";
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

// Every cover writer needs the same server id before it can attest anything.
const requireServerEventId = (eventId: string): void => {
  if (eventId.trim().length === 0) {
    throw new EventCoverMediaError(
      "missing_server_event_id",
      "Save failed because this event is missing its server id.",
    );
  }
};

// The edge function attests each attribution field independently; anything
// that is not a string is absent, never a coerced value.
const attestedString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

export const registerEventCoverSelection = async (
  serverEventId: string,
  selectionRef: string,
  mediaUrl: string | null,
  mediaType: EventCoverMediaType | null,
  posterUrl: string | null,
  metadata: EventCoverProviderMetadata,
): Promise<EventCoverProviderMetadata> => {
  const { data, error } = await supabase.functions.invoke(
    "event-cover-attest-selection",
    {
      body: {
        event_id: serverEventId,
        selection_ref: selectionRef,
        url: mediaUrl,
        type: mediaType,
        poster_url: posterUrl,
        provider: metadata.provider ?? "upload",
        source_url: metadata.sourceUrl ?? null,
        credit: metadata.credit ?? null,
        credit_url: metadata.creditUrl ?? null,
        alt: metadata.alt ?? null,
      },
    },
  );
  if (error !== null)
    throw new EventCoverMediaError("upload_failed", error.message);
  const response =
    data !== null && typeof data === "object" && !Array.isArray(data)
      ? (data as { metadata?: Record<string, unknown> })
      : null;
  const attested = response?.metadata;
  if (attested === undefined) {
    if ((metadata.provider ?? "upload") !== "upload") {
      throw new EventCoverMediaError(
        "upload_failed",
        "Cover verification did not return provider attribution.",
      );
    }
    return metadata;
  }
  return {
    provider: metadata.provider ?? "upload",
    sourceUrl: attestedString(attested.sourceUrl),
    credit: attestedString(attested.credit),
    creditUrl: attestedString(attested.creditUrl),
    alt: attestedString(attested.alt),
  };
};

export interface AttestedEventCoverSelection {
  selectionRef: string;
  metadata: EventCoverProviderMetadata;
}

export const attestEventCoverSelection = async (
  serverEventId: string,
  mediaUrl: string,
  mediaType: EventCoverMediaType,
  metadata: EventCoverProviderMetadata,
  posterUrl: string | null = mediaType === "image" ? mediaUrl : null,
): Promise<AttestedEventCoverSelection> => {
  requireServerEventId(serverEventId);
  const stablePosterUrl = posterUrl?.trim() || null;
  if (
    stablePosterUrl === null ||
    (mediaType === "image" && stablePosterUrl !== mediaUrl) ||
    (mediaType !== "image" && stablePosterUrl === mediaUrl)
  ) {
    throw new EventCoverMediaError(
      "upload_failed",
      "Cover save failed because its fallback image is missing or invalid.",
    );
  }
  const selectionRef = randomId();
  const attestedMetadata = await registerEventCoverSelection(
    serverEventId,
    selectionRef,
    mediaUrl,
    mediaType,
    stablePosterUrl,
    metadata,
  );
  return { selectionRef, metadata: attestedMetadata };
};

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
  requireServerEventId(input.eventId);

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
  const contentType =
    normalized.inferredMimeType ??
    eventCoverContentType({
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

export const setEventCover = async (
  serverEventId: string,
  mediaUrl: string,
  mediaType: EventCoverMediaType,
  metadata: EventCoverProviderMetadata,
  posterUrl: string | null = mediaType === "image" ? mediaUrl : null,
): Promise<{
  id: string;
  cover_media_url: string;
  cover_media_poster_url: string;
  cover_media_type: EventCoverMediaType;
}> => {
  const stablePosterUrl = posterUrl?.trim() || null;
  const attested = await attestEventCoverSelection(
    serverEventId,
    mediaUrl,
    mediaType,
    metadata,
    stablePosterUrl,
  );
  const { data: responseData, error } = await supabase.rpc(
    "business_set_event_cover_media",
    {
      p_event_id: serverEventId,
      p_selection_ref: attested.selectionRef,
      p_url: mediaUrl,
      p_type: mediaType,
      p_poster_url: stablePosterUrl,
      p_provider: attested.metadata.provider ?? null,
      p_source_url: attested.metadata.sourceUrl ?? null,
      p_credit: attested.metadata.credit ?? null,
      p_credit_url: attested.metadata.creditUrl ?? null,
      p_alt: attested.metadata.alt ?? null,
    },
  );

  if (error !== null) {
    throw new EventCoverMediaError("upload_failed", error.message);
  }
  const data =
    responseData !== null &&
    typeof responseData === "object" &&
    !Array.isArray(responseData)
      ? (responseData as { event?: Record<string, unknown> }).event
      : null;
  if (data === null || data === undefined) {
    throw new EventCoverMediaError(
      "missing_server_event_id",
      "Save failed because this event could not be found.",
    );
  }
  if (
    data.cover_media_url !== mediaUrl ||
    data.cover_media_poster_url !== stablePosterUrl
  ) {
    throw new EventCoverMediaError(
      "persist_mismatch",
      "Save succeeded but the cover did not persist. Refresh and try again.",
    );
  }
  return data as {
    id: string;
    cover_media_url: string;
    cover_media_poster_url: string;
    cover_media_type: EventCoverMediaType;
  };
};

/**
 * issue #868 [cover-gallery] — persist ONLY the additional-photos gallery.
 *
 * Writes `cover_media_gallery` and NOTHING else — the primary cover fields
 * (cover_media_url/_type + provider metadata) are UNTOUCHED (setEventCover /
 * clearEventCover own those; no write path syncs or derives one from the other,
 * I-PROPOSED-868-GALLERY-ADDITIVE-INDEPENDENT). Keeps the same event-only guards
 * as setEventCover (event_type='event', deleted_at IS NULL) and a persist check.
 */
export const setEventCoverGallery = async (
  serverEventId: string,
  gallery: OfferingGalleryImage[],
): Promise<{ id: string; cover_media_gallery: OfferingGalleryImage[] }> => {
  requireServerEventId(serverEventId);
  const { data, error } = await supabase
    .from("events")
    .update({
      cover_media_gallery: gallery,
      updated_at: new Date().toISOString(),
    })
    .eq("id", serverEventId)
    .eq("event_type", "event")
    .is("deleted_at", null)
    .select("id, cover_media_gallery")
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
  return data as { id: string; cover_media_gallery: OfferingGalleryImage[] };
};

export const clearEventCover = async (serverEventId: string): Promise<void> => {
  requireServerEventId(serverEventId);
  const { data, error } = await supabase.rpc(
    "business_clear_event_cover_media",
    {
      p_event_id: serverEventId,
    },
  );

  if (error !== null) {
    throw new EventCoverMediaError("upload_failed", error.message);
  }
  const event =
    data !== null && typeof data === "object" && !Array.isArray(data)
      ? (data as { event?: Record<string, unknown> }).event
      : null;
  if (event === null || event === undefined) {
    throw new EventCoverMediaError(
      "missing_server_event_id",
      "Save failed because this event could not be found.",
    );
  }
};
