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
 *   * Signed URLs are short-lived and cached until shortly before they expire.
 *
 * MINGLA-INVARIANT: I-4114-CHAT-MEDIA-PRIVATE-PATH | issue #4114 | New chat attachments are uploaded to the private message-attachments bucket and the message stores the object path; no new message stores a public URL.
 */

export const CHAT_MEDIA_BUCKET = 'message-attachments';
export const MAX_CHAT_MEDIA_ITEMS = 10;
export const MAX_VIDEO_SECONDS = 60;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_JPEG_QUALITY = 0.8;
/** Thread media links; the view-once link is the edge function's 60 seconds. */
export const SIGNED_URL_SECONDS = 60 * 60;
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

/** A message `file_url` that is an object path in the private bucket (Wave 4+). */
export function isChatStoragePath(fileUrl: string | null | undefined): fileUrl is string {
  return !!fileUrl && !/^[a-z][a-z0-9+.-]*:/i.test(fileUrl) && /^[0-9a-f-]{36}\//i.test(fileUrl);
}

/** A message `file_url` from before Wave 4 (a public https URL) or a local file on this phone. */
export function isDirectMediaUrl(fileUrl: string | null | undefined): fileUrl is string {
  return !!fileUrl && /^(https?|file|content|ph|assets-library):/i.test(fileUrl);
}

export type UploadOutcome = 'uploaded' | 'already_uploaded' | 'refused_type' | 'refused_size' | 'failed';

/** Classifies a Storage upload response. A retry of an upload that already landed is a success. */
export function classifyUploadResponse(status: number, body: string): UploadOutcome {
  if (status >= 200 && status < 300) return 'uploaded';
  const text = body.toLowerCase();
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
