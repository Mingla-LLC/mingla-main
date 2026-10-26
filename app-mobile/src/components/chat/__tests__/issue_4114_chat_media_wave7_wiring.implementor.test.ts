// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 7 — the wiring the pure models cannot see:
//   * received bubble colours: every text colour inside a received bubble
//     passes WCAG AA (4.5:1) on the dark #1D2026 surface (computed here), and
//     the bubble, its text, sender name, mention chips, reply quotes and shared
//     cards all use those tokens (no light-theme greys left);
//   * thumbnails: the video frame comes from expo-video's
//     generateThumbnailsAsync on a player created without a view, registered
//     for the #2107 restart release and always released; the upload service
//     uploads a thumbnail only through shouldMakeThumbnail, and the send passes
//     thumb_path; bubbles show thumbnails through expo-image with the storage
//     path as the cache key, and full media only loads on tap;
//   * D17: the upload service checks the allowance first, and the send shows
//     "You've reached today's limit" (text sends untouched);
//   * iPhone videos export at 720p from the library and the camera.
//
// FAILS-ON-REVERT: put bubbleReceived back on colors.chat.bubbleReceived (or
// any received text back to a grey below 4.5:1), delete the player release or
// the reload registration in makeVideoThumbnail, drop the CHAT_VIDEO_EXPORT
// spread from either picker call, or remove the daily_limit toast — each fails.

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const read = (path: string) => Deno.readTextFileSync(new URL(path, import.meta.url));

const tokens = read("../../../constants/chatTokens.ts");
const bubble = read("../MessageBubble.tsx");
const mention = read("../MentionChip.tsx");
const quote = read("../ReplyQuoteBlock.tsx");
const curated = read("../PlaceCuratedChatCard.tsx");
const upload = read("../../../services/chatMediaUploadService.ts");
const messaging = read("../../../services/messagingService.ts");
const page = read("../../ConnectionsPage.tsx");
const thread = read("../../MessageInterface.tsx");

function token(name: string): string {
  const block = tokens.slice(tokens.indexOf("export const receivedBubbleTokens"));
  const match = new RegExp(`\\b${name}: "([^"]+)"`).exec(block);
  assert(match, `token ${name} exists`);
  return match[1];
}
function rgba(value: string, over?: [number, number, number]): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  assert(m && over, `colour ${value}`);
  const a = Number(m[4]);
  return [0, 1, 2].map((i) => Number(m[i + 1]) * a + over[i] * (1 - a)) as [number, number, number];
}
function luminance([r, g, b]: [number, number, number]): number {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(fg: [number, number, number], bg: [number, number, number]): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

Deno.test("#4114 W7: received bubbles are dark and every text colour passes AA", () => {
  const surface = rgba(token("bubble"));
  assert(token("bubble").toUpperCase() === "#1D2026", "the received surface is #1D2026");
  const quoteSurface = rgba(token("quoteBg"), surface);
  const mentionSurface = rgba(token("mentionBg"));
  const checks: Array<[string, [number, number, number], [number, number, number]]> = [
    ["text", rgba(token("text")), surface],
    ["textSecondary", rgba(token("textSecondary"), surface), surface],
    ["senderName", rgba(token("senderName")), surface],
    ["icon", rgba(token("icon")), surface],
    ["mentionText", rgba(token("mentionText")), mentionSurface],
    ["quoteName", rgba(token("quoteName")), quoteSurface],
    ["quoteText", rgba(token("quoteText"), quoteSurface), quoteSurface],
    ["quoteDeleted", rgba(token("quoteDeleted")), quoteSurface],
  ];
  for (const [name, fg, bg] of checks) {
    const ratio = contrast(fg, bg);
    assert(ratio >= 4.5, `${name} is ${ratio.toFixed(2)}:1 on its surface (needs 4.5:1)`);
  }
});

Deno.test("#4114 W7: every element inside a received bubble uses the dark tokens", () => {
  assert(/bubbleReceived: \{\s*backgroundColor: receivedBubbleTokens\.bubble,/.test(bubble), "bubble surface");
  assert(/textReceived: \{\s*color: receivedBubbleTokens\.text,/.test(bubble), "bubble text");
  assert(/senderNameReceived: \{\s*color: receivedBubbleTokens\.senderName,/.test(bubble), "sender name");
  assert(/fileSizeReceived: \{\s*color: receivedBubbleTokens\.textSecondary,/.test(bubble), "file size");
  assert(!bubble.includes("colors.chat.bubbleReceived"), "no light received surface left");
  // QA run 2: the two mention paths became one tokenizer-driven renderer (renderMessageText).
  assert((bubble.match(/variant=\{isMe \? 'sent' : 'receivedDark'\}/g) ?? []).length === 1, "the one mention path uses the dark chip");
  assert(/chipReceivedDark: \{\s*backgroundColor: receivedBubbleTokens\.mentionBg,/.test(mention), "dark mention chip");
  assert(/containerReceived: \{\s*backgroundColor: receivedBubbleTokens\.quoteBg,/.test(quote), "reply quote surface");
  assert(/senderNameReceived: \{\s*color: receivedBubbleTokens\.quoteName,/.test(quote), "reply quote name");
  assert(/previewTextReceived: \{\s*color: receivedBubbleTokens\.quoteText,/.test(quote), "reply quote text");
  assert(curated.includes("textReceived:{color:receivedBubbleTokens.text}"), "shared place card text");
});

Deno.test("#4114 W7: video frames come from a released, reload-registered player", () => {
  const fn = upload.slice(upload.indexOf("export async function makeVideoThumbnail"), upload.indexOf("export async function makePhotoThumbnail"));
  assert(fn.includes("createVideoPlayer(uri)"), "a player without a mounted view");
  assert(fn.includes("registerVideoPlayerForReload(player)"), "registered for the #2107 restart release");
  assert(fn.includes("generateThumbnailsAsync([0]"), "the first frame");
  const fin = fn.slice(fn.indexOf("} finally {"));
  assert(fin.includes("unregister();") && fin.includes("player.release();"), "always released");
  assert(fin.indexOf("isVideoPlayerReleasedForReload(player)") < fin.indexOf("player.release();"), "never released twice");
  assert(fn.includes("ImageManipulator.SaveFormat.JPEG"), "saved as JPEG");
});

Deno.test("#4114 W7: thumbnails upload for ordinary media only and reach the message", () => {
  const thumb = upload.slice(upload.indexOf("async function uploadChatThumbnail"));
  assert(thumb.includes("if (!shouldMakeThumbnail(item.kind, viewOnce)) return null;"), "view once and files skipped");
  assert(thumb.includes("buildChatThumbPath(conversationId, clientId)"), "the sibling name");
  assert(upload.includes("const thumbPath = await uploadChatThumbnail("), "uploaded after the full file");
  assert(messaging.includes("if (options.thumbPath) facts.thumb_path = options.thumbPath;"), "sent as thumb_path");
  assert(page.includes("thumbPath: uploaded.thumbPath ?? undefined,"), "kept on the message after upload");
  assert(page.includes("thumbPath: current.thumbPath ?? null,"), "passed to the send");
  assert(page.includes('thumbPath: msg.thumb_path ?? undefined,'), "read back from the server row");
});

Deno.test("#4114 W7: bubbles show cached thumbnails; full media loads on tap", () => {
  assert(bubble.includes("import { Image as ExpoImage } from 'expo-image';"), "expo-image");
  assert(bubble.includes("{ uri: url, cacheKey: source }"), "cached under the storage path, not the signed link");
  assert(bubble.includes('cachePolicy="memory-disk"'), "disk cache");
  assert(bubble.includes("source={message.localUri ?? message.thumbPath ?? message.fileUrl}"), "photo: thumbnail first, old messages keep the file");
  assert(bubble.includes("const poster = message.thumbPath;"), "video: only the thumbnail, never the video file");
  assert(thread.includes("void mediaHandlersRef.current.handleOpenImage("), "a tap opens the full photo");
  assert(thread.includes("handleOpenAlbum(message.albumItems, albumIndex ?? 0)"), "an album opens at the tapped photo");
});

Deno.test("#4114 W7: the allowance is checked first and its refusal is shown", () => {
  const up = upload.slice(upload.indexOf("export async function uploadChatMedia"));
  assert(up.indexOf("readChatMediaQuota()") < up.indexOf("FileSystem.createUploadTask("), "checked before any bytes move");
  assert(up.includes("throw new ChatMediaUploadError('daily_limit')"), "a refusal is its own error");
  assert(page.includes('code === "daily_limit"') && page.includes('t("chat:mediaDailyLimit")'), "the toast");
});

// QA run 2 (Seth approved 720p): the export is 1280x720 H.264 again.
// QA run 3: the export is always what is sent (H.264 plays everywhere); the
// send-the-original path is gone (issue_4114_qa_video_source).
Deno.test("#4114 W7: iPhone exports chat videos at 720p from the library and the camera", () => {
  assert(thread.includes("videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720"), "library preset");
  assert(thread.includes("videoQuality: ImagePicker.UIImagePickerControllerQualityType.IFrame1280x720"), "camera quality");
  assert(!/MediumQuality|LowQuality|UIImagePickerControllerQualityType\.Medium\b/.test(thread), "never the ~480p preset");
  assert(!/preferSmallerOriginalVideo/.test(thread), "library picks send the 720p export, never the original");
  assert(/Platform\.OS === "ios"\s*\?/.test(thread.slice(thread.indexOf("export const CHAT_VIDEO_EXPORT"))), "iPhone only");
  const library = thread.slice(thread.indexOf("launchImageLibraryAsync({"), thread.indexOf("launchImageLibraryAsync({") + 800);
  const camera = thread.slice(thread.indexOf("launchCameraAsync({"), thread.indexOf("launchCameraAsync({") + 400);
  assert(library.includes("...CHAT_VIDEO_EXPORT"), "library uses it");
  assert(camera.includes("...CHAT_VIDEO_EXPORT"), "camera uses it");
  assert(library.includes("videoMaxDuration: 60") && camera.includes("videoMaxDuration: 60"), "60 s guard kept");
});
