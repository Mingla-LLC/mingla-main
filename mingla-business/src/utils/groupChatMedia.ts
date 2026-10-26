/**
 * Issue #4114 Wave 6 — how the host's event chat shows a message's media.
 *
 * Since #4114 Wave 4, Explorer photos and videos are stored in the PRIVATE
 * `message-attachments` bucket and `messages.file_url` holds the object path
 * (`<conversation_id>/<client_id>.<ext>`), not a URL. Rendering that path as
 * an image URI shows a broken image, so the host panel signs it (cached per
 * path until shortly before it expires). Older messages keep their public
 * `messages` bucket URL and render as they are.
 *
 * A view-once photo or video is never shown to the host: only its sender may
 * read the object (storage policy), so the panel shows "View once photo" text.
 *
 * Pure (no React Native or Supabase imports) so it is unit-tested directly.
 * Mirrors app-mobile/src/utils/chatMedia.ts (isChatStoragePath,
 * isDirectMediaUrl, SignedUrlCache); the two apps share no package for it.
 */

export const GROUP_CHAT_MEDIA_BUCKET = "message-attachments";
export const GROUP_CHAT_SIGNED_URL_SECONDS = 60 * 60;
export const GROUP_CHAT_SIGNED_URL_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** A `file_url` that is an object path in the private bucket (Explorer, Wave 4+). */
export function isGroupChatStoragePath(fileUrl: string | null | undefined): fileUrl is string {
  return !!fileUrl && !/^[a-z][a-z0-9+.-]*:/i.test(fileUrl) && /^[0-9a-f-]{36}\//i.test(fileUrl);
}

/** A `file_url` from before Wave 4 (a public https URL) or a local file. */
export function isGroupChatDirectUrl(fileUrl: string | null | undefined): fileUrl is string {
  return !!fileUrl && /^(https?|file|content|ph|assets-library):/i.test(fileUrl);
}

export interface GroupChatMediaMessage {
  message_type: string;
  file_url: string | null;
  view_once?: boolean | null;
}

export type GroupChatMediaKind = "none" | "view_once_photo" | "view_once_video" | "image" | "video";

/** What the host panel draws for a message's attachment. */
export function groupChatMediaKind(message: GroupChatMediaMessage): GroupChatMediaKind {
  const isPhoto = message.message_type === "image";
  const isVideo = message.message_type === "video";
  if (!isPhoto && !isVideo) return "none";
  if (message.view_once === true) return isVideo ? "view_once_video" : "view_once_photo";
  if (!message.file_url) return "none";
  return isVideo ? "video" : "image";
}

interface CacheEntry {
  url: string;
  expiresAt: number;
}

/**
 * Signed URLs per path, cached until shortly before they expire; concurrent
 * requests for one path share a single call. A failed sign is not cached.
 */
export class GroupChatSignedUrlCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<string>>();
  // Bumped by clear(): a sign started before the clear (the previous account's)
  // can never write its link back into the cache.
  private generation = 0;

  constructor(
    private readonly sign: (path: string, seconds: number) => Promise<string>,
    private readonly now: () => number = () => Date.now(),
    private readonly seconds: number = GROUP_CHAT_SIGNED_URL_SECONDS,
  ) {}

  peek(path: string): string | null {
    const entry = this.entries.get(path);
    if (!entry || entry.expiresAt - GROUP_CHAT_SIGNED_URL_REFRESH_MARGIN_MS <= this.now()) return null;
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
        if (generation !== this.generation) throw new Error("signed_url_cache_cleared");
        this.entries.set(path, { url, expiresAt: started + this.seconds * 1000 });
        return url;
      })
      .finally(() => {
        if (this.inflight.get(path) === request) this.inflight.delete(path);
      });
    this.inflight.set(path, request);
    return request;
  }

  clear(): void {
    this.generation += 1;
    this.entries.clear();
    this.inflight.clear();
  }
}

/** The displayable link for a `file_url`: direct URLs as they are, stored paths signed, anything else null. */
export function createGroupChatMediaResolver(cache: GroupChatSignedUrlCache): {
  resolve: (fileUrl: string | null | undefined) => Promise<string | null>;
  peek: (fileUrl: string | null | undefined) => string | null;
} {
  return {
    resolve: async (fileUrl) => {
      if (!fileUrl) return null;
      if (isGroupChatDirectUrl(fileUrl)) return fileUrl;
      if (!isGroupChatStoragePath(fileUrl)) return null;
      return await cache.get(fileUrl);
    },
    peek: (fileUrl) => {
      if (!fileUrl) return null;
      if (isGroupChatDirectUrl(fileUrl)) return fileUrl;
      return isGroupChatStoragePath(fileUrl) ? cache.peek(fileUrl) : null;
    },
  };
}
