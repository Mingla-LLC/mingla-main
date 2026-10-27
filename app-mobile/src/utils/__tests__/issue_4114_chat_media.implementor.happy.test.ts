// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 4 — the chat media rules (utils/chatMedia.ts), driven
// behaviourally:
//   * MIME types come from the asset (HEIC photo, QuickTime video), not a
//     hard-coded image/jpeg / video/mp4; the extension is only a fallback;
//   * a video over 60 s or over 25 MB, and a file over 25 MB, are refused;
//   * new attachments get a private-bucket object PATH (view once under once/),
//     and old public URLs still count as directly displayable;
//   * a retried upload that already landed (409) counts as uploaded;
//   * signed links are cached, shared between concurrent requests, refreshed
//     before they expire;
//   * view-once wording state for sender and recipient;
//   * the phone's MIME allowlist equals the bucket's allowed_mime_types.
//
// FAILS-ON-REVERT: hard-coding `return 'image/jpeg'` / 'video/mp4' in
// mimeTypeForAsset, deleting the 60-second check in validateChatMedia, or
// dropping the 409 branch of classifyUploadResponse fails here.
// MINGLA-INVARIANT: I-4114-CHAT-MEDIA-PRIVATE-PATH | issue #4114 | New chat attachments are uploaded to the private message-attachments bucket and the message stores the object path; no new message stores a public URL.

import {
  CHAT_ATTACHMENT_MIME_TYPES,
  CHAT_MEDIA_BUCKET,
  MAX_ATTACHMENT_BYTES,
  MAX_VIDEO_SECONDS,
  PHOTO_MAX_EDGE,
  SignedUrlCache,
  buildChatAttachmentPath,
  classifyUploadResponse,
  extensionForMime,
  isChatStoragePath,
  isDirectMediaUrl,
  mimeTypeForAsset,
  photoResize,
  validateChatMedia,
  viewOnceState,
} from "../chatMedia.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function eq(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const CONV = "0f0e6c3a-6f1d-4c55-9a51-2b7c1f0d9e11";
const CLIENT = "7d4b2a10-3c5e-4f60-8a71-9b8c7d6e5f40";

Deno.test("W4 MIME types are taken from the asset (HEIC, MOV), extension only as a fallback", () => {
  eq(mimeTypeForAsset({ uri: "file:///x/IMG_0001.HEIC", mimeType: "image/heic", fileName: "IMG_0001.HEIC" }), "image/heic", "HEIC photo");
  eq(mimeTypeForAsset({ uri: "file:///x/IMG_0002.MOV", mimeType: "video/quicktime", fileName: "IMG_0002.MOV" }), "video/quicktime", "MOV video");
  eq(mimeTypeForAsset({ uri: "file:///x/clip.mov", mimeType: null, fileName: null }), "video/quicktime", "MOV by extension");
  eq(mimeTypeForAsset({ uri: "file:///x/a.png", mimeType: undefined, fileName: "a.png" }), "image/png", "PNG by name");
  eq(mimeTypeForAsset({ uri: "file:///x/report.pdf", mimeType: "application/pdf", fileName: "report.pdf" }), "application/pdf", "PDF");
  eq(mimeTypeForAsset({ uri: "file:///x/a", mimeType: "image/jpg", fileName: null }), "image/jpeg", "image/jpg alias");
  eq(mimeTypeForAsset({ uri: "file:///x/blob", mimeType: null, fileName: null }), "application/octet-stream", "unknown");
  eq(extensionForMime("video/quicktime"), "mov", "mov extension");
  eq(extensionForMime("image/heic"), "heic", "heic extension");
});

Deno.test("W4 a video over 60 seconds or 25 MB, and a file over 25 MB, are refused on the phone", () => {
  eq(MAX_VIDEO_SECONDS, 60, "D7 video length");
  eq(MAX_ATTACHMENT_BYTES, 25 * 1024 * 1024, "D7 size");
  eq(PHOTO_MAX_EDGE, 1600, "D7 photo edge");
  const video = { uri: "file:///v.mov", kind: "video", mimeType: "video/quicktime", fileSize: 4_000_000 };
  eq(validateChatMedia({ ...video, durationMs: 59_000 }), null, "59 s is fine");
  eq(validateChatMedia({ ...video, durationMs: 61_000 }), "video_too_long", "61 s is refused");
  eq(validateChatMedia({ ...video, durationMs: 30_000, fileSize: 26 * 1024 * 1024 }), "video_too_large", "26 MB video refused");
  eq(validateChatMedia({ uri: "file:///f.pdf", kind: "file", mimeType: "application/pdf", fileSize: 26 * 1024 * 1024 }), "file_too_large", "26 MB file refused");
  eq(validateChatMedia({ uri: "file:///f.exe", kind: "file", mimeType: "application/x-msdownload", fileSize: 10 }), "unsupported_type", "exe refused");
  eq(validateChatMedia({ uri: "file:///p.heic", kind: "image", mimeType: "image/heic", fileSize: 40 * 1024 * 1024 }), null, "photos are re-encoded, never refused for size");
  eq(photoResize(4032, 3024), { width: 1600 }, "landscape resized by width");
  eq(photoResize(3024, 4032), { height: 1600 }, "portrait resized by height");
  eq(photoResize(1200, 900), null, "small photo untouched");
});

Deno.test("W4 new attachments store a private-bucket path; old public URLs still display", () => {
  eq(CHAT_MEDIA_BUCKET, "message-attachments", "private bucket");
  eq(buildChatAttachmentPath(CONV, CLIENT, "mov", false), `${CONV}/${CLIENT}.mov`, "normal path");
  eq(buildChatAttachmentPath(CONV, CLIENT, "jpg", true), `${CONV}/once/${CLIENT}.jpg`, "view-once path");
  let threw = false;
  try { buildChatAttachmentPath("messages/x", CLIENT, "jpg", false); } catch { threw = true; }
  assert(threw, "a non-uuid conversation id is refused");
  assert(isChatStoragePath(`${CONV}/${CLIENT}.jpg`), "a path is a storage path");
  assert(!isChatStoragePath("https://x.supabase.co/storage/v1/object/public/messages/a.jpg"), "a URL is not a path");
  assert(isDirectMediaUrl("https://x.supabase.co/storage/v1/object/public/messages/a.jpg"), "legacy public URL displays as is");
  assert(isDirectMediaUrl("file:///var/mobile/photo.jpg"), "local file displays as is");
  assert(!isDirectMediaUrl(`${CONV}/${CLIENT}.jpg`), "a path needs a signed link");
});

Deno.test("W4 a retried upload that already landed counts as uploaded", () => {
  eq(classifyUploadResponse(200, "{}"), "uploaded", "200");
  eq(classifyUploadResponse(409, '{"error":"Duplicate","message":"The resource already exists"}'), "already_uploaded", "409");
  eq(classifyUploadResponse(400, '{"statusCode":"409","error":"Duplicate"}'), "already_uploaded", "duplicate body");
  eq(classifyUploadResponse(413, "Payload too large"), "refused_size", "413");
  eq(classifyUploadResponse(400, '{"error":"invalid_mime_type","message":"mime type video/x not supported"}'), "refused_type", "mime");
  eq(classifyUploadResponse(500, "oops"), "failed", "500");
});

Deno.test("W4 signed links are cached, shared and refreshed before they expire", async () => {
  let now = 1_000_000;
  const calls: string[] = [];
  const cache = new SignedUrlCache(async (path, seconds) => {
    calls.push(`${path}:${seconds}`);
    return `https://signed/${path}?n=${calls.length}`;
  }, () => now, 3600);
  const path = `${CONV}/${CLIENT}.jpg`;
  const [a, b] = await Promise.all([cache.get(path), cache.get(path)]);
  eq(a, b, "concurrent requests share one link");
  eq(calls.length, 1, "one sign call");
  eq(cache.peek(path), a, "peek returns the cached link");
  now += 3000 * 1000;
  eq(await cache.get(path), a, "still cached inside the margin");
  now += 400 * 1000; // within 5 minutes of expiry
  const fresh = await cache.get(path);
  assert(fresh !== a, "refreshed before expiry");
  eq(calls.length, 2, "second sign call");
});

Deno.test("W4 view-once state: recipient opens once; sender sees Opened time or count", () => {
  const me = "me";
  eq(viewOnceState({ isMe: false, currentUserId: me, views: [], purged: false }), { role: "recipient", status: "unopened" }, "unopened");
  eq(viewOnceState({ isMe: false, currentUserId: me, views: [{ user_id: me, viewed_at: "t" }], purged: false }), { role: "recipient", status: "opened" }, "opened from server");
  eq(viewOnceState({ isMe: false, currentUserId: me, views: [], purged: false, openedLocally: true }), { role: "recipient", status: "opened" }, "opened on this phone");
  eq(viewOnceState({ isMe: false, currentUserId: me, views: [], purged: true }), { role: "recipient", status: "expired" }, "expired");
  eq(
    viewOnceState({ isMe: true, currentUserId: me, views: [{ user_id: "a", viewed_at: "2026-10-26T09:40:00Z" }, { user_id: "b", viewed_at: "2026-10-26T09:45:00Z" }], purged: false }),
    { role: "sender", status: "opened", openedAt: "2026-10-26T09:45:00Z", openedCount: 2 },
    "sender sees the latest open and the count",
  );
  eq(viewOnceState({ isMe: true, currentUserId: me, views: [], purged: false }), { role: "sender", status: "not_opened", openedAt: null, openedCount: 0 }, "not opened yet");
});

Deno.test("W4 the phone's MIME allowlist equals the bucket's allowed_mime_types", async () => {
  const sql = await Deno.readTextFile(new URL("../../../../supabase/migrations/20271230034114_issue_4114_chat_media.sql", import.meta.url));
  const block = sql.slice(sql.indexOf("ARRAY["), sql.indexOf("]::text[]"));
  const fromSql = [...block.matchAll(/'([a-z0-9.+-]+\/[a-z0-9.+-]+)'/g)].map((m) => m[1]).sort();
  eq(fromSql, [...CHAT_ATTACHMENT_MIME_TYPES].sort(), "same list on the phone and the bucket");
});
