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
 *   Wave 7:            a 480px JPEG thumbnail next to every ordinary photo and
 *                      video (`<conversationId>/<clientId>_thumb.jpg`; videos
 *                      take a frame through expo-video's generateThumbnailsAsync),
 *                      never for view once; the 200 MB daily allowance is
 *                      checked before an upload and explains a refusal.
 *
 * Every native module used here (expo-image-manipulator, expo-file-system) is
 * already in the shipped 1.1.x binary; nothing new is added, so this is OTA-safe.
 */
import * as ImageManipulator from 'expo-image-manipulator';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import {
  isVideoPlayerReleasedForReload,
  registerVideoPlayerForReload,
} from '@mingla/offering-rendering/videoPlayerReloadRelease';
import { supabase, supabaseUrl, getSupabaseFunctionHeaders } from './supabase';
import {
  CHAT_MEDIA_BUCKET,
  PHOTO_JPEG_QUALITY,
  THUMB_JPEG_QUALITY,
  buildChatThumbPath,
  shouldMakeThumbnail,
  thumbResize,
  isOverDailyQuota,
  type ChatMediaQuota,
  ChatUploadCancelRegistry,
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
  | 'daily_limit'
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

const uploads = new ChatUploadCancelRegistry<UploadTask>();

/**
 * Cancels this message's (client id) upload, whether it is running or still
 * waiting to start. False when the upload had already finished (nothing to
 * cancel; a retry of the message is not blocked).
 */
export async function cancelChatMediaUpload(clientId: string): Promise<boolean> {
  return (await uploads.cancel(clientId)) !== 'finished';
}

export function isChatMediaUploading(clientId: string): boolean {
  return uploads.isRunning(clientId);
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
  /** Wave 7: the thumbnail's object path (`messages.thumb_path`), or null when none was made. */
  thumbPath: string | null;
  /** Wave 7: the media's own dimensions (photos after resizing), for the card's shape. */
  width: number | null;
  height: number | null;
}

/** A local 480px JPEG and its size. */
export interface LocalThumbnail {
  uri: string;
  width: number;
  height: number;
}

const VIDEO_READY_TIMEOUT_MS = 6000;

/** Waits until a player has loaded its source (or failed / timed out). */
function waitForPlayerReady(player: VideoPlayer): Promise<void> {
  if (player.status === 'readyToPlay') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.remove();
      reject(new Error('video_thumbnail_timeout'));
    }, VIDEO_READY_TIMEOUT_MS);
    const subscription = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'readyToPlay') {
        clearTimeout(timer);
        subscription.remove();
        resolve();
      } else if (status === 'error') {
        clearTimeout(timer);
        subscription.remove();
        reject(new Error(error?.message ?? 'video_thumbnail_load_failed'));
      }
    });
  });
}

/**
 * Wave 7: the first frame of a local video as a 480px JPEG. A player is
 * created from the local file with no view mounted, registered for the #2107
 * restart release while it lives, and always released afterwards.
 */
export async function makeVideoThumbnail(uri: string): Promise<LocalThumbnail> {
  const player = createVideoPlayer(uri);
  const unregister = registerVideoPlayerForReload(player);
  try {
    player.muted = true;
    await waitForPlayerReady(player);
    if (isVideoPlayerReleasedForReload(player)) throw new Error('video_thumbnail_released');
    const [frame] = await player.generateThumbnailsAsync([0], { maxWidth: 480, maxHeight: 480 });
    if (!frame) throw new Error('video_thumbnail_empty');
    const context = ImageManipulator.ImageManipulator.manipulate(frame);
    const resize = thumbResize(frame.width, frame.height);
    if (resize) context.resize(resize);
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ compress: THUMB_JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG });
    return { uri: saved.uri, width: saved.width, height: saved.height };
  } finally {
    unregister();
    if (!isVideoPlayerReleasedForReload(player)) {
      try {
        player.release();
      } catch (error) {
        console.warn('[chatMediaUpload] video thumbnail player release failed', error);
      }
    }
  }
}

/** Wave 7: a 480px JPEG of a (prepared) photo. */
export async function makePhotoThumbnail(item: PreparedChatMedia): Promise<LocalThumbnail> {
  const resize = thumbResize(item.width, item.height);
  const result = await ImageManipulator.manipulateAsync(
    item.uri,
    resize ? [{ resize }] : [],
    { compress: THUMB_JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
  );
  return { uri: result.uri, width: result.width, height: result.height };
}

/** Wave 7: the thumbnail for an ordinary photo or video (null for view once and files). */
export async function makeChatThumbnail(item: PreparedChatMedia, viewOnce: boolean): Promise<LocalThumbnail | null> {
  if (!shouldMakeThumbnail(item.kind, viewOnce)) return null;
  return item.kind === 'video' ? await makeVideoThumbnail(item.uri) : await makePhotoThumbnail(item);
}

/**
 * Wave 7 (D17): what the signed-in person uploaded in the last 24 hours. Null
 * when it cannot be read (storage still enforces the allowance).
 */
export async function readChatMediaQuota(): Promise<ChatMediaQuota | null> {
  const { data, error } = await supabase.rpc('issue_4114_chat_media_quota');
  if (error) {
    console.warn('[chatMediaUpload] allowance read failed', { code: error.code });
    return null;
  }
  const row = (Array.isArray(data) ? data[0] : data) as { used_bytes?: number | string; limit_bytes?: number | string } | null;
  if (!row) return null;
  const usedBytes = Number(row.used_bytes);
  const limitBytes = Number(row.limit_bytes);
  return Number.isFinite(usedBytes) && Number.isFinite(limitBytes) ? { usedBytes, limitBytes } : null;
}

export async function uploadChatMedia(args: UploadChatMediaArgs): Promise<UploadedChatMedia> {
  const { conversationId, clientId, item, viewOnce, onProgress } = args;
  uploads.begin(clientId);
  if (uploads.takeCancelledBeforeStart(clientId)) throw new ChatMediaUploadError('cancelled');
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
  if (uploads.takeCancelledBeforeStart(clientId)) throw new ChatMediaUploadError('cancelled');

  // Wave 7 (D17): refuse before any bytes move when this would pass today's allowance.
  if (isOverDailyQuota(await readChatMediaQuota(), size)) throw new ChatMediaUploadError('daily_limit');

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

  const entry = uploads.start(clientId, task);
  let response: { status: number; body: string } | null | undefined;
  try {
    response = await task.uploadAsync();
  } catch (error) {
    uploads.settle(clientId, false);
    if (entry.cancelled) throw new ChatMediaUploadError('cancelled');
    // QA run 2: any failure asks the allowance, so a refusal that surfaced as
    // a dropped or generic response still says "today's limit".
    if (isOverDailyQuota(await readChatMediaQuota(), size)) throw new ChatMediaUploadError('daily_limit');
    throw new ChatMediaUploadError('network', error instanceof Error ? error.message : String(error));
  }
  const outcome = response ? classifyUploadResponse(response.status, response.body ?? '') : null;
  uploads.settle(clientId, !entry.cancelled && (outcome === 'uploaded' || outcome === 'already_uploaded'));
  if (entry.cancelled || !response) throw new ChatMediaUploadError('cancelled');

  if (outcome === 'uploaded' || outcome === 'already_uploaded') {
    const thumbPath = await uploadChatThumbnail({ conversationId, clientId, item, viewOnce, accessToken, FileSystem });
    onProgress?.(1);
    return {
      path,
      mimeType: item.mimeType,
      fileSize: typeof size === 'number' ? size : null,
      thumbPath,
      width: item.width,
      height: item.height,
    };
  }
  console.warn('[chatMediaUpload] upload refused', { status: response.status, outcome });
  if (outcome === 'refused_type') throw new ChatMediaUploadError('refused_type');
  if (outcome === 'refused_size') throw new ChatMediaUploadError('refused_size');
  if (outcome === 'daily_limit') throw new ChatMediaUploadError('daily_limit');
  // Storage may wrap the allowance refusal in a generic 500: ask the allowance,
  // with the server's own limit (QA run 2: the hardcoded 200 MB missed it).
  if (isOverDailyQuota(await readChatMediaQuota(), size)) throw new ChatMediaUploadError('daily_limit');
  throw new ChatMediaUploadError('failed', `upload_status_${response.status}`);
}

/**
 * Wave 7: makes and uploads the thumbnail of an ordinary photo or video. A
 * thumbnail that cannot be made or stored is logged and the message is sent
 * without one (it then shows the full file, as messages always have).
 */
async function uploadChatThumbnail(args: {
  conversationId: string;
  clientId: string;
  item: PreparedChatMedia;
  viewOnce: boolean;
  accessToken: string;
  FileSystem: typeof import('expo-file-system/legacy');
}): Promise<string | null> {
  const { conversationId, clientId, item, viewOnce, accessToken, FileSystem } = args;
  if (!shouldMakeThumbnail(item.kind, viewOnce)) return null;
  try {
    const thumb = await makeChatThumbnail(item, viewOnce);
    if (!thumb) return null;
    const thumbPath = buildChatThumbPath(conversationId, clientId);
    const result = await FileSystem.uploadAsync(
      `${supabaseUrl}/storage/v1/object/${CHAT_MEDIA_BUCKET}/${thumbPath}`,
      thumb.uri,
      {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          ...getSupabaseFunctionHeaders(accessToken),
          'Content-Type': 'image/jpeg',
          'x-upsert': 'false',
          'cache-control': '604800',
        },
      },
    );
    const outcome = classifyUploadResponse(result.status, result.body ?? '');
    if (outcome === 'uploaded' || outcome === 'already_uploaded') return thumbPath;
    console.warn('[chatMediaUpload] thumbnail refused; sending without one', { status: result.status, outcome });
    return null;
  } catch (error) {
    console.warn('[chatMediaUpload] thumbnail failed; sending without one', error);
    return null;
  }
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
