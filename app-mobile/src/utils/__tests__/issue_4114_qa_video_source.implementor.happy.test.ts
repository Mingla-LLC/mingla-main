// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 simulator QA run 3 (rule change from run 2, updated honestly):
// iPhone chat videos ALWAYS send the 720p H.264 export, which plays on every
// phone. Run 2 sent the original when it was smaller, and that original is
// usually 1080p HEVC, which many older Android phones cannot play. The export
// is sent when it is within 25 MB and 60 s (even when larger than the
// original: 9.7 MB HEVC became a 13.3 MB export, which is sent), and refused
// with the usual size message above 25 MB. The picker's temp copies in
// Caches/ImagePicker are deleted after the send, a cancel, a refusal or a
// tray removal; nothing outside that folder is ever deleted.
//
// FAILS-ON-REVERT: bring back the "send the original if smaller" path
// (chooseChatVideoSource / preferSmallerOriginalVideo / the Photos copy), stop
// refusing an export over 25 MB, or drop any temp-file cleanup call, and a
// case fails.

import {
  MAX_ATTACHMENT_BYTES,
  isPickerTempFile,
  validateChatMedia,
} from "../chatMedia.ts";
import * as chatMedia from "../chatMedia.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}
const read = (rel: string) => Deno.readTextFile(new URL(rel, import.meta.url));
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const exists = async (rel: string) => {
  try {
    await Deno.stat(new URL(rel, import.meta.url));
    return true;
  } catch {
    return false;
  }
};

const MB = 1024 * 1024;
const exported = (fileSize: number, durationMs: number) => ({
  uri: "file:///var/mobile/Containers/Data/Application/X/Library/Caches/ImagePicker/A.mp4",
  kind: "video",
  mimeType: "video/mp4",
  fileName: "A.mp4",
  fileSize,
  durationMs,
});

Deno.test("QA run 3: the 720p export is sent within 25 MB and 60 s, even when larger than the original", () => {
  assertEquals(validateChatMedia(exported(13.3 * MB, 12_000)), null, "the evidence clip's 13.3 MB export is sent");
  assertEquals(validateChatMedia(exported(MAX_ATTACHMENT_BYTES, 60_000)), null, "25 MB and 60 s exactly are allowed");
});

Deno.test("QA run 3: an export over 25 MB or 60 s is refused with the usual message", () => {
  assertEquals(validateChatMedia(exported(MAX_ATTACHMENT_BYTES + 1, 50_000)), "video_too_large", "over 25 MB");
  assertEquals(validateChatMedia(exported(10 * MB, 61_000)), "video_too_long", "over 60 s");
});

Deno.test("QA run 3: the send-the-original path is gone", async () => {
  assert(!("chooseChatVideoSource" in chatMedia) && !("videoMimeFromHeader" in chatMedia), "no original-vs-export chooser");
  assert(!(await exists("../../services/chatVideoOriginalService.ts")), "the Photos-original copy service is removed");
  const thread = stripComments(await read("../../components/MessageInterface.tsx"));
  assert(!/preferSmallerOriginalVideo|chatVideoOriginalService|ph:\/\//.test(thread), "the picker never reads the Photos original");
  assert(/launchImageLibraryAsync\(\{[\s\S]*?\.\.\.CHAT_VIDEO_EXPORT[\s\S]*?addPickedMedia\(result\.assets\.map\(assetToPicked\)\)/.test(thread), "library picks send the export as returned");
});

Deno.test("QA run 3: only the picker's own temp copies are deletable", () => {
  assert(isPickerTempFile("file:///var/mobile/Containers/Data/Application/X/Library/Caches/ImagePicker/A.mp4"), "iOS export");
  assert(isPickerTempFile("file:///data/user/0/com.mingla/cache/ImagePicker/B.jpg"), "Android pick");
  assert(!isPickerTempFile("ph://ABC-123"), "a Photos asset");
  assert(!isPickerTempFile("file:///var/mobile/Containers/Data/Application/X/Library/Caches/DocumentPicker/C.pdf"), "a document copy");
  assert(!isPickerTempFile("file:///x/Library/Caches/ImagePicker/../Documents/D.mp4"), "no path escape");
  assert(!isPickerTempFile("file:///x/Library/Caches/ImagePicker/sub/E.mp4"), "only the folder's own files");
  assert(!isPickerTempFile(null) && !isPickerTempFile("https://cdn/x.mp4"), "nothing else");
});

Deno.test("QA run 3: temp copies are deleted after the send, a cancel, a refusal and a tray removal", async () => {
  const service = stripComments(await read("../../services/chatPickerTempFiles.ts"));
  assert(/uris\.filter\(isPickerTempFile\)/.test(service), "the service deletes only picker temp files");
  assert(/deleteAsync\(uri, \{ idempotent: true \}\)\.catch\(/.test(service) && /console\.warn\(/.test(service), "a failed delete is logged, never thrown");

  const thread = stripComments(await read("../../components/MessageInterface.tsx"));
  const add = thread.slice(thread.indexOf("const addPickedMedia = "), thread.indexOf("const assetToPicked = "));
  assert(/discarded\.push\(item\)/.test(add) && /discardPickerTempFiles\(discarded\.map\(\(item\) => item\.uri\)\)/.test(add), "a refused pick's copy goes");
  assert(/onRemoveItem=\{\(index\) => \{\s*releasePickerTempFiles\(\[pendingMedia\[index\]\?\.uri\]\);\s*void discardPickerTempFiles\(\[pendingMedia\[index\]\?\.uri\]\);/.test(thread), "a tray removal's copy goes");
  assert(/useEffect\(\(\) => \(\) => \{\s*const trayUris = pendingMediaRef\.current\.map\(\(item\) => item\.uri\);\s*releasePickerTempFiles\(trayUris\);\s*void discardPickerTempFiles\(trayUris\);/.test(thread), "leaving with unsent items drops their copies");

  const page = stripComments(await read("../../components/ConnectionsPage.tsx"));
  assert(/unsent: true \}\]\);\s*releasePickerTempFiles\(\[pending\.localMedia\.uri\]\);\s*void discardPickerTempFiles\(\[pending\.localMedia\.uri\]\);/.test(page), "a cancelled upload's copy goes");
  assert(/transformMessage\(sentMessage, user\.id\)\]\);\s*if \(current\.localMedia\) \{\s*releasePickerTempFiles\(\[current\.localMedia\.uri\]\);\s*void discardPickerTempFiles\(\[current\.localMedia\.uri\]\);/.test(page), "a confirmed send's copy goes");
});
