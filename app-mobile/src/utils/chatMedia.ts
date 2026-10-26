/**
 * Issue #4114 Wave 4 — the rules for chat photos, videos and files, in one
 * dependency-free module (no React Native imports, so it runs under Deno).
 *
 *   * Real MIME types come from the picked asset (iOS gives HEIC photos and
 *     QuickTime .mov videos); only when the asset has none is the file
 *     extension used. Photos are re-encoded to JPEG by the upload service, so
 *     their upload type is image/jpeg because the bytes ARE JPEG, not by guess.
 *   * Limits (decision D7): a video is refused on the phone above 60 seconds or
 *     25 MB, any file above 25 MB, photos are resized to about 1600px.
 *   * Storage: the private `message-attachments` bucket. The message stores the
 *     object PATH (`<conversationId>/<clientId>.<ext>`, view once under
 *     `<conversationId>/once/`), never a URL. Messages sent before Wave 4 hold
 *     a public https URL and keep rendering as they are.
 *   * Signed URLs are cached until shortly before they expire. Ordinary chat
 *     media links last 7 days (Wave 7) so the image cache keeps them usable;
 *     view once never uses them (its one link comes from open-view-once).
 *   * Wave 7 thumbnails: every ordinary photo and video also gets a 480px JPEG
 *     at `<conversationId>/<clientId>_thumb.jpg`; bubbles show it and the full
 *     file loads only when tapped. View once never makes one.
 *   * Wave 7 allowance (D17): 200 MB per person per day, enforced by storage;
 *     a refusal says "You've reached today's limit for photos and videos".
 */

export const CHAT_MEDIA_BUCKET = 'message-attachments';
export const MAX_CHAT_MEDIA_ITEMS = 10;
export const MAX_VIDEO_SECONDS = 60;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_JPEG_QUALITY = 0.8;
/**
 * Thread media links (Wave 7: 7 days, so cached thumbnails stay usable); the
 * view-once link is the edge function's 60 seconds and never uses this.
 */
export const SIGNED_URL_SECONDS = 7 * 24 * 60 * 60;
/** Wave 7: the bubble thumbnail's longer edge, and its JPEG quality (about 40–60 KB). */
export const THUMB_MAX_EDGE = 480;
export const THUMB_JPEG_QUALITY = 0.7;
/**
 * Wave 7 (D17): chat photos and videos one person may upload per 24 hours.
 * QA run 2: only a FALLBACK — the app reads the real limit from the server's
 * `issue_4114_chat_media_quota()` and uses this only when that read fails.
 */
export const DAILY_CHAT_MEDIA_BYTES = 200 * 1024 * 1024;
/** Wave 7: the storage error text of the daily allowance trigger. */
export const DAILY_LIMIT_ERROR = 'chat_media_daily_limit';
/** Ask for a fresh link this long before the cached one expires. */
export const SIGNED_URL_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Keep in step with the bucket's allowed_mime_types in 20271230034114_issue_4114_chat_media.sql. */
export const CHAT_ATTACHMENT_MIME_TYPES: readonly string[] = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
  'video/mp4', 'video/quicktime', 'video/x-m4v', 'video/3gpp', 'video/webm',
  'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav',
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv', 'application/zip',
];

export type ChatMediaKind = 'image' | 'video' | 'file';

/** One item from the camera, the photo library or the document picker. */
export interface PickedChatMedia {
  uri: string;
  kind: ChatMediaKind;
  /** The asset's own MIME type, when the picker reports one. */
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  /** Video length in milliseconds (expo-image-picker reports ms). */
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
}

export type ChatMediaRefusal = 'video_too_long' | 'video_too_large' | 'file_too_large' | 'unsupported_type';

const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif',
  mp4: 'video/mp4', mov: 'video/quicktime', qt: 'video/quicktime', m4v: 'video/x-m4v', '3gp': 'video/3gpp', webm: 'video/webm',
  mp3: 'audio/mpeg', m4a: 'audio/x-m4a', aac: 'audio/aac', wav: 'audio/wav',
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', csv: 'text/csv', zip: 'application/zip',
};

const MIME_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/x-m4v': 'm4v', 'video/3gpp': '3gp', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav',
  'application/pdf': 'pdf', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt', 'text/csv': 'csv', 'application/zip': 'zip',
};

/** Aliases some pickers report for the same type. */
const MIME_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg', 'video/mov': 'video/quicktime',
  'audio/mp3': 'audio/mpeg', 'audio/m4a': 'audio/x-m4a', 'audio/x-wav': 'audio/wav',
  'application/x-zip-compressed': 'application/zip',
};

function extensionOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const clean = value.split('?')[0].split('#')[0];
  const last = clean.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  if (dot < 0 || dot === last.length - 1) return null;
  return last.slice(dot + 1).toLowerCase();
}

/** The asset's real MIME type: its own report first, then its file name or URI extension. */
export function mimeTypeForAsset(item: Pick<PickedChatMedia, 'mimeType' | 'fileName' | 'uri'>): string {
  const reported = item.mimeType?.trim().toLowerCase();
  if (reported && reported.includes('/')) return MIME_ALIASES[reported] ?? reported;
  const ext = extensionOf(item.fileName) ?? extensionOf(item.uri);
  if (ext && EXTENSION_MIME[ext]) return EXTENSION_MIME[ext];
  return 'application/octet-stream';
}

export function extensionForMime(mimeType: string, fallbackName?: string | null): string {
  const known = MIME_EXTENSION[mimeType];
  if (known) return known;
  const ext = extensionOf(fallbackName);
  return ext && /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin';
}

export function isAllowedAttachmentMime(mimeType: string): boolean {
  return CHAT_ATTACHMENT_MIME_TYPES.includes(mimeType);
}

/** Refuses what the phone must not send (checked before any upload starts). */
export function validateChatMedia(item: PickedChatMedia): ChatMediaRefusal | null {
  const size = typeof item.fileSize === 'number' && Number.isFinite(item.fileSize) ? item.fileSize : null;
  if (item.kind === 'video') {
    const seconds = typeof item.durationMs === 'number' && Number.isFinite(item.durationMs) ? item.durationMs / 1000 : null;
    if (seconds !== null && seconds > MAX_VIDEO_SECONDS + 0.5) return 'video_too_long';
    if (size !== null && size > MAX_ATTACHMENT_BYTES) return 'video_too_large';
  } else if (item.kind === 'file') {
    if (size !== null && size > MAX_ATTACHMENT_BYTES) return 'file_too_large';
  }
  // Photos are re-encoded to JPEG before upload, so any picked photo is sendable.
  if (item.kind !== 'image' && !isAllowedAttachmentMime(mimeTypeForAsset(item))) return 'unsupported_type';
  return null;
}

/**
 * Issue #4114 QA run 3: the picker's own copies (the iPhone 720p H.264 export,
 * camera captures, library photos) live in `Caches/ImagePicker/`. They are
 * ours to delete once a send is confirmed, an upload is cancelled, a pick is
 * refused, or the item leaves the tray. Nothing outside that folder (a
 * Photos asset, a document-picker copy) is ever deleted.
 */
export function isPickerTempFile(uri: string | null | undefined): uri is string {
  if (typeof uri !== 'string' || !uri.startsWith('file://')) return false;
  if (uri.includes('/../') || uri.includes('%2e%2e') || uri.includes('%2E%2E')) return false;
  return /\/Caches\/ImagePicker\/[^/]+$/.test(uri) || /\/cache\/ImagePicker\/[^/]+$/.test(uri);
}

/**
 * Issue #4114 sim run 4 (item 3c): on iPhone, expo-image-picker 17 copies the
 * original `.mov` into `Caches/ImagePicker/` before it transcodes, and never
 * deletes it; only the `.mp4` export comes back, so per-uri deletes miss it
 * (9.9 MB left after a send, 208 MB after a refusal). After each picker step
 * the folder is swept: every file in it goes unless a still-pending tray item
 * or an in-flight or failed upload (which needs it for its preview or retry)
 * holds it.
 *
 * `folderUri` is `cacheDirectory + 'ImagePicker/'`; `names` is what the folder
 * lists; `heldUris` are the uris still in use. Returns the uris to delete,
 * every one of them a direct child of that folder (never a sub-folder, never
 * a path that escapes it).
 */
export function selectPickerSweepTargets(
  folderUri: string,
  names: ReadonlyArray<string>,
  heldUris: Iterable<string | null | undefined>,
): string[] {
  if (!/\/(Caches|cache)\/ImagePicker\/$/.test(folderUri)) return [];
  const held = new Set<string>();
  for (const uri of heldUris) {
    if (!isPickerTempFile(uri)) continue;
    const name = uri.slice(uri.lastIndexOf('/') + 1);
    held.add(name);
    try {
      held.add(decodeURIComponent(name));
    } catch {
      // A malformed escape: the raw name is still held.
    }
  }
  const targets: string[] = [];
  for (const name of names) {
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) continue;
    if (held.has(name)) continue;
    const uri = folderUri + name;
    if (isPickerTempFile(uri)) targets.push(uri);
  }
  return targets;
}

/** Size check after preparation (a photo can only shrink; files and videos are unchanged). */
export function isWithinUploadLimit(bytes: number | null | undefined): boolean {
  return typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= MAX_ATTACHMENT_BYTES;
}

/** Resize to fit PHOTO_MAX_EDGE on the longer side; null when the photo is already small enough. */
export function photoResize(
  width: number | null | undefined,
  height: number | null | undefined,
): { width: number } | { height: number } | null {
  if (!width || !height || width <= 0 || height <= 0) return { width: PHOTO_MAX_EDGE };
  if (Math.max(width, height) <= PHOTO_MAX_EDGE) return null;
  return width >= height ? { width: PHOTO_MAX_EDGE } : { height: PHOTO_MAX_EDGE };
}

/** GIFs keep their animation: they are sent as they are, never re-encoded. */
export function shouldReencodePhoto(mimeType: string): boolean {
  return mimeType !== 'image/gif';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildChatAttachmentPath(
  conversationId: string,
  clientId: string,
  extension: string,
  viewOnce: boolean,
): string {
  if (!UUID.test(conversationId) || !UUID.test(clientId)) {
    throw new Error('chat_media_bad_path_ids');
  }
  const ext = extension.toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(ext)) throw new Error('chat_media_bad_extension');
  return `${conversationId.toLowerCase()}/${viewOnce ? 'once/' : ''}${clientId.toLowerCase()}.${ext}`;
}

/**
 * Wave 7: the thumbnail sibling of an ordinary attachment,
 * `<conversationId>/<clientId>_thumb.jpg` (never under once/).
 */
export function buildChatThumbPath(conversationId: string, clientId: string): string {
  if (!UUID.test(conversationId) || !UUID.test(clientId)) {
    throw new Error('chat_media_bad_path_ids');
  }
  return `${conversationId.toLowerCase()}/${clientId.toLowerCase()}_thumb.jpg`;
}

/** Wave 7: resize to fit THUMB_MAX_EDGE on the longer side; null when already small enough. */
export function thumbResize(
  width: number | null | undefined,
  height: number | null | undefined,
): { width: number } | { height: number } | null {
  if (!width || !height || width <= 0 || height <= 0) return { width: THUMB_MAX_EDGE };
  if (Math.max(width, height) <= THUMB_MAX_EDGE) return null;
  return width >= height ? { width: THUMB_MAX_EDGE } : { height: THUMB_MAX_EDGE };
}

/** Wave 7: a thumbnail is made for ordinary photos and videos only, never view once or files. */
export function shouldMakeThumbnail(kind: ChatMediaKind, viewOnce: boolean): boolean {
  return !viewOnce && (kind === 'image' || kind === 'video');
}

/**
 * Wave 7: would this upload take the person past today's allowance? The limit
 * is the server's (QA run 2); the 200 MB constant is only the fallback.
 */
export function wouldExceedDailyLimit(
  usedBytes: number,
  nextBytes: number | null | undefined,
  limitBytes: number = DAILY_CHAT_MEDIA_BYTES,
): boolean {
  const next = typeof nextBytes === 'number' && Number.isFinite(nextBytes) ? Math.max(0, nextBytes) : 0;
  const limit = Number.isFinite(limitBytes) && limitBytes > 0 ? limitBytes : DAILY_CHAT_MEDIA_BYTES;
  return usedBytes >= limit || usedBytes + next > limit;
}

/** What `issue_4114_chat_media_quota()` returned (null when it could not be read). */
export interface ChatMediaQuota {
  usedBytes: number;
  limitBytes: number;
}

/** QA run 2: the server's allowance says this upload is (or was) over today's limit. */
export function isOverDailyQuota(quota: ChatMediaQuota | null, nextBytes: number | null | undefined): boolean {
  return quota !== null && wouldExceedDailyLimit(quota.usedBytes, nextBytes, quota.limitBytes);
}

/** A message `file_url` that is an object path in the private bucket (Wave 4+). */
export function isChatStoragePath(fileUrl: string | null | undefined): fileUrl is string {
  return !!fileUrl && !/^[a-z][a-z0-9+.-]*:/i.test(fileUrl) && /^[0-9a-f-]{36}\//i.test(fileUrl);
}

/** A message `file_url` from before Wave 4 (a public https URL) or a local file on this phone. */
export function isDirectMediaUrl(fileUrl: string | null | undefined): fileUrl is string {
  return !!fileUrl && /^(https?|file|content|ph|assets-library):/i.test(fileUrl);
}

export type UploadOutcome =
  | 'uploaded'
  | 'already_uploaded'
  | 'refused_type'
  | 'refused_size'
  | 'daily_limit'
  | 'failed';

/** Classifies a Storage upload response. A retry of an upload that already landed is a success. */
export function classifyUploadResponse(status: number, body: string): UploadOutcome {
  if (status >= 200 && status < 300) return 'uploaded';
  const text = body.toLowerCase();
  // Wave 7: the allowance trigger's own text, whatever status Storage wraps it in.
  if (text.includes(DAILY_LIMIT_ERROR)) return 'daily_limit';
  if (status === 409 || text.includes('already exists') || text.includes('duplicate')) return 'already_uploaded';
  if (status === 413 || text.includes('maximum allowed size') || text.includes('payload too large')) return 'refused_size';
  if (status === 415 || text.includes('mime type') || text.includes('invalid_mime_type')) return 'refused_type';
  return 'failed';
}

interface CacheEntry {
  url: string;
  expiresAt: number;
}

/**
 * Short-lived signed URLs, cached per path until shortly before they expire,
 * with concurrent requests for the same path sharing one call.
 */
export class SignedUrlCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<string>>();
  // Bumped by clear(): a sign started before the clear (the previous account's)
  // can never write its link back into the cache.
  private generation = 0;

  constructor(
    private readonly sign: (path: string, seconds: number) => Promise<string>,
    private readonly now: () => number = () => Date.now(),
    private readonly seconds: number = SIGNED_URL_SECONDS,
  ) {}

  peek(path: string): string | null {
    const entry = this.entries.get(path);
    if (!entry || entry.expiresAt - SIGNED_URL_REFRESH_MARGIN_MS <= this.now()) return null;
    return entry.url;
  }

  get(path: string): Promise<string> {
    const cached = this.peek(path);
    if (cached) return Promise.resolve(cached);
    const running = this.inflight.get(path);
    if (running) return running;
    const started = this.now();
    const generation = this.generation;
    const request: Promise<string> = this.sign(path, this.seconds)
      .then((url) => {
        if (generation !== this.generation) throw new Error('signed_url_cache_cleared');
        this.entries.set(path, { url, expiresAt: started + this.seconds * 1000 });
        return url;
      })
      .finally(() => {
        if (this.inflight.get(path) === request) this.inflight.delete(path);
      });
    this.inflight.set(path, request);
    return request;
  }

  forget(path: string): void {
    this.entries.delete(path);
  }

  clear(): void {
    this.generation += 1;
    this.entries.clear();
    this.inflight.clear();
  }
}

/**
 * Which uploads (by message client id) are running, finished, or cancelled
 * before they started. Pure bookkeeping for chatMediaUploadService.
 *
 * A cancel that arrives after the upload finished is a no-op: it must not
 * leave the client id marked cancelled, or the message's retry (same client
 * id) would be refused as cancelled.
 */
export class ChatUploadCancelRegistry<Task extends { cancelAsync: () => Promise<void> }> {
  private readonly running = new Map<string, { task: Task; cancelled: boolean }>();
  private readonly cancelledBeforeStart = new Set<string>();
  private readonly finished = new Set<string>();

  /** A new attempt is starting (a retry starts fresh). */
  begin(clientId: string): void {
    this.finished.delete(clientId);
  }

  start(clientId: string, task: Task): { cancelled: boolean } {
    const entry = { task, cancelled: false };
    this.running.set(clientId, entry);
    return entry;
  }

  /** The running upload ended; `uploaded` when the object is in storage. */
  settle(clientId: string, uploaded: boolean): void {
    this.running.delete(clientId);
    if (uploaded) this.finished.add(clientId);
  }

  /** True once if the send was cancelled before its upload started. */
  takeCancelledBeforeStart(clientId: string): boolean {
    if (!this.cancelledBeforeStart.has(clientId)) return false;
    this.cancelledBeforeStart.delete(clientId);
    return true;
  }

  isRunning(clientId: string): boolean {
    return this.running.has(clientId);
  }

  /** 'running' and 'pending' were cancelled; 'finished' means nothing was left to cancel. */
  async cancel(clientId: string): Promise<'running' | 'pending' | 'finished'> {
    const active = this.running.get(clientId);
    if (active) {
      active.cancelled = true;
      try {
        await active.task.cancelAsync();
      } catch (error) {
        console.warn('[chatMediaUpload] cancel failed', error);
      }
      return 'running';
    }
    if (this.finished.has(clientId)) return 'finished';
    this.cancelledBeforeStart.add(clientId);
    return 'pending';
  }
}

/** Display summary of who opened a view-once message. */
export interface MediaViewRow {
  user_id: string;
  viewed_at: string;
}

export type ViewOnceState =
  | { role: 'recipient'; status: 'unopened' | 'opened' | 'expired' }
  | { role: 'sender'; status: 'not_opened' | 'opened'; openedAt: string | null; openedCount: number };

export function viewOnceState(args: {
  isMe: boolean;
  currentUserId: string | null;
  views: readonly MediaViewRow[] | undefined;
  purged: boolean;
  openedLocally?: boolean;
}): ViewOnceState {
  const views = args.views ?? [];
  if (args.isMe) {
    const others = views.filter((view) => view.user_id !== args.currentUserId);
    const latest = others.reduce<string | null>(
      (acc, view) => (acc === null || view.viewed_at > acc ? view.viewed_at : acc),
      null,
    );
    return {
      role: 'sender',
      status: others.length > 0 ? 'opened' : 'not_opened',
      openedAt: latest,
      openedCount: others.length,
    };
  }
  const mine = args.openedLocally === true || views.some((view) => view.user_id === args.currentUserId);
  if (mine) return { role: 'recipient', status: 'opened' };
  if (args.purged) return { role: 'recipient', status: 'expired' };
  return { role: 'recipient', status: 'unopened' };
}
