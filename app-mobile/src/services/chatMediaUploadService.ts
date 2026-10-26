/**
 * Issue #4114 Wave 4 — the ONE way a chat photo, video or file reaches storage,
 * and the one way the app gets a link to show it.
 *
 *   prepareChatMedia   photos resized to about 1600px and re-encoded as JPEG
 *                      (expo-image-manipulator); videos and files untouched.
 *   uploadChatMedia    private `message-attachments` bucket, path
 *                      `<conversationId>/<clientId>.<ext>` (view once under
 *                      `once/`), the asset's real MIME type, upload progress and
 *                      cancel (expo-file-system upload task). The path is keyed by
 *                      the message's client id, so a retry re-uses it and a retry
 *                      of an upload that already landed counts as done.
 *   resolveChatMediaUrl  a short-lived signed URL for a stored path (cached);
 *                      a pre-Wave-4 public URL is returned as it is.
 *   openViewOnceMedia  the recipient's one open, through the open-view-once
 *                      edge function (recipients cannot read view-once objects).
 *
 * Every native module used here (expo-image-manipulator, expo-file-system) is
 * already in the shipped 1.1.x binary; nothing new is added, so this is OTA-safe.
 */
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase, supabaseUrl, getSupabaseFunctionHeaders } from './supabase';
import {
  CHAT_MEDIA_BUCKET,
  PHOTO_JPEG_QUALITY,
  SignedUrlCache,
  buildChatAttachmentPath,
  classifyUploadResponse,
  extensionForMime,
  isAllowedAttachmentMime,
  isChatStoragePath,
  isDirectMediaUrl,
  isWithinUploadLimit,
  mimeTypeForAsset,
  photoResize,
  shouldReencodePhoto,
  type ChatMediaKind,
  type PickedChatMedia,
} from '../utils/chatMedia';

export interface PreparedChatMedia {
  uri: string;
  kind: ChatMediaKind;
  mimeType: string;
  fileName: string;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export type ChatMediaUploadErrorCode =
  | 'cancelled'
  | 'not_signed_in'
  | 'refused_type'
  | 'refused_size'
  | 'network'
  | 'failed';

export class ChatMediaUploadError extends Error {
  constructor(public readonly code: ChatMediaUploadErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ChatMediaUploadError';
  }
}

/** Resize + re-encode photos; everything else is passed through with its real MIME type. */
export async function prepareChatMedia(item: PickedChatMedia): Promise<PreparedChatMedia> {
  const assetMime = mimeTypeForAsset(item);
  const base: PreparedChatMedia = {
    uri: item.uri,
    kind: item.kind,
    mimeType: assetMime,
    fileName: item.fileName?.trim() || `${item.kind}.${extensionForMime(assetMime, item.uri)}`,
    fileSize: typeof item.fileSize === 'number' ? item.fileSize : null,
    width: item.width ?? null,
    height: item.height ?? null,
    durationMs: item.durationMs ?? null,
  };
  if (item.kind !== 'image' || !shouldReencodePhoto(assetMime)) return base;

  const resize = photoResize(item.width, item.height);
  const result = await ImageManipulator.manipulateAsync(
    item.uri,
    resize ? [{ resize }] : [],
    { compress: PHOTO_JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
  );
  const stem = (item.fileName?.replace(/\.[^.]+$/, '') || 'photo').slice(0, 80);
  return {
    ...base,
    uri: result.uri,
    // The bytes are now JPEG (re-encoded above), whatever the camera roll held.
    mimeType: 'image/jpeg',
    fileName: `${stem}.jpg`,
    fileSize: null,
    width: result.width,
    height: result.height,
  };
}

type UploadTask = {
  uploadAsync: () => Promise<{ status: number; body: string } | null | undefined>;
  cancelAsync: () => Promise<void>;
};

const activeUploads = new Map<string, { task: UploadTask; cancelled: boolean }>();
/** Cancelled before its upload started (still resizing, or queued behind another item). */
const cancelledBeforeStart = new Set<string>();

function takeCancelledBeforeStart(clientId: string): boolean {
  if (!cancelledBeforeStart.has(clientId)) return false;
  cancelledBeforeStart.delete(clientId);
  return true;
}

/** Cancels this message's (client id) upload, whether it is running or still waiting to start. */
export async function cancelChatMediaUpload(clientId: string): Promise<boolean> {
  const active = activeUploads.get(clientId);
  if (!active) {
    cancelledBeforeStart.add(clientId);
    return true;
  }
  active.cancelled = true;
  try {
    await active.task.cancelAsync();
  } catch (error) {
    console.warn('[chatMediaUpload] cancel failed', error);
  }
  return true;
}

export function isChatMediaUploading(clientId: string): boolean {
  return activeUploads.has(clientId);
}

export interface UploadChatMediaArgs {
  conversationId: string;
  clientId: string;
  item: PreparedChatMedia;
  viewOnce: boolean;
  /** 0..1 */
  onProgress?: (fraction: number) => void;
}

export interface UploadedChatMedia {
  /** The object path stored on the message (`messages.file_url`). Never a URL. */
  path: string;
  mimeType: string;
  fileSize: number | null;
}

export async function uploadChatMedia(args: UploadChatMediaArgs): Promise<UploadedChatMedia> {
  const { conversationId, clientId, item, viewOnce, onProgress } = args;
  if (takeCancelledBeforeStart(clientId)) throw new ChatMediaUploadError('cancelled');
  if (!isAllowedAttachmentMime(item.mimeType)) throw new ChatMediaUploadError('refused_type');
  if (!isWithinUploadLimit(item.fileSize)) throw new ChatMediaUploadError('refused_size');

  const path = buildChatAttachmentPath(
    conversationId,
    clientId,
    extensionForMime(item.mimeType, item.fileName),
    viewOnce && (item.kind === 'image' || item.kind === 'video'),
  );

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new ChatMediaUploadError('not_signed_in');

  const FileSystem = await import('expo-file-system/legacy');
  const info = await FileSystem.getInfoAsync(item.uri);
  const size = info.exists && typeof info.size === 'number' ? info.size : item.fileSize;
  if (!isWithinUploadLimit(size)) throw new ChatMediaUploadError('refused_size');
  if (takeCancelledBeforeStart(clientId)) throw new ChatMediaUploadError('cancelled');

  const objectUrl = `${supabaseUrl}/storage/v1/object/${CHAT_MEDIA_BUCKET}/${path}`;
  const task = FileSystem.createUploadTask(
    objectUrl,
    item.uri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
      headers: {
        ...getSupabaseFunctionHeaders(accessToken),
        'Content-Type': item.mimeType,
        'x-upsert': 'false',
        'cache-control': '3600',
      },
    },
    (event) => {
      if (!onProgress || event.totalBytesExpectedToSend <= 0) return;
      onProgress(Math.min(1, event.totalBytesSent / event.totalBytesExpectedToSend));
    },
  ) as unknown as UploadTask;

  const entry = { task, cancelled: false };
  activeUploads.set(clientId, entry);
  let response: { status: number; body: string } | null | undefined;
  try {
    response = await task.uploadAsync();
  } catch (error) {
    if (entry.cancelled) throw new ChatMediaUploadError('cancelled');
    throw new ChatMediaUploadError('network', error instanceof Error ? error.message : String(error));
  } finally {
    activeUploads.delete(clientId);
  }
  if (entry.cancelled || !response) throw new ChatMediaUploadError('cancelled');

  const outcome = classifyUploadResponse(response.status, response.body ?? '');
  if (outcome === 'uploaded' || outcome === 'already_uploaded') {
    onProgress?.(1);
    return { path, mimeType: item.mimeType, fileSize: typeof size === 'number' ? size : null };
  }
  console.warn('[chatMediaUpload] upload refused', { status: response.status, outcome });
  if (outcome === 'refused_type') throw new ChatMediaUploadError('refused_type');
  if (outcome === 'refused_size') throw new ChatMediaUploadError('refused_size');
  throw new ChatMediaUploadError('failed', `upload_status_${response.status}`);
}

const signedUrls = new SignedUrlCache(async (path, seconds) => {
  const { data, error } = await supabase.storage.from(CHAT_MEDIA_BUCKET).createSignedUrl(path, seconds);
  if (error || !data?.signedUrl) throw error ?? new Error('sign_failed');
  return data.signedUrl;
});

/**
 * The link to show a message's media. A stored path gets a cached signed URL;
 * an older message's public URL (or this phone's own local file) is used as is.
 */
export async function resolveChatMediaUrl(fileUrl: string | null | undefined): Promise<string | null> {
  if (!fileUrl) return null;
  if (isDirectMediaUrl(fileUrl)) return fileUrl;
  if (!isChatStoragePath(fileUrl)) return null;
  return await signedUrls.get(fileUrl);
}

/** The cached link, without a network call (null when it has to be fetched). */
export function peekChatMediaUrl(fileUrl: string | null | undefined): string | null {
  if (!fileUrl) return null;
  if (isDirectMediaUrl(fileUrl)) return fileUrl;
  return isChatStoragePath(fileUrl) ? signedUrls.peek(fileUrl) : null;
}

/** Logout clears the cached links (Constitution #6). */
export function clearChatMediaUrlCache(): void {
  signedUrls.clear();
}

export type ViewOnceOpenResult =
  | { ok: true; url: string; messageType: 'image' | 'video'; viewedAt: string | null }
  | { ok: false; reason: 'already_opened' | 'gone' | 'sender' | 'error' };

export async function openViewOnceMedia(messageId: string): Promise<ViewOnceOpenResult> {
  const { data, error } = await supabase.functions.invoke<{
    url?: string;
    message_type?: string;
    viewed_at?: string | null;
    error?: string;
  }>('open-view-once', { body: { message_id: messageId } });
  if (error) {
    const status = (error as { context?: { status?: number } })?.context?.status ?? null;
    if (status === 409) return { ok: false, reason: 'already_opened' };
    if (status === 410 || status === 404) return { ok: false, reason: 'gone' };
    if (status === 403) return { ok: false, reason: 'sender' };
    console.warn('[chatMediaUpload] open-view-once failed', { status });
    return { ok: false, reason: 'error' };
  }
  if (!data?.url) return { ok: false, reason: 'error' };
  return {
    ok: true,
    url: data.url,
    messageType: data.message_type === 'video' ? 'video' : 'image',
    viewedAt: data.viewed_at ?? null,
  };
}
