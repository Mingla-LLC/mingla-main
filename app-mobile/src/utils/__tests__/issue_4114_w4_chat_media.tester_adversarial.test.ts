// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 4 — tester adversarial suite for the phone half of chat
// media. The implementor suite covers the normal limits and paths; this one
// attacks the boundaries and spoofs:
//   * a 61 s video is refused, 60 s (and the 0.5 s rounding slack) is not;
//     exactly 25 MB passes, one byte more is refused;
//   * MIME spoofs: the picker's own report wins over a misleading extension, an
//     unknown type is refused, and a `.mov` labelled as a photo can never be
//     stored under a video MIME;
//   * every path the phone builds is accepted by the SQL storage helper's
//     regex, a view-once path always sits in once/, and hostile ids are refused;
//   * a stored path is never mistaken for a URL and vice versa;
//   * the signed-URL cache never caches a failed sign and shares one call.
//
// KNOWN DEFECT (tester finding T-W4-2, ignored until fixed): SignedUrlCache.clear()
// (run on logout) does not stop a sign that is already in flight from writing
// its URL into the cleared cache, so the previous account's link survives
// logout. [TRANSITIONAL] exit: un-ignore when clear() invalidates in-flight work.
//
// FAILS-ON-REVERT: drop the `+ 0.5` slack or use `>=` for the length check,
// let a file fall back to its extension when the picker reported a MIME, or
// drop the `once/` segment for view-once paths, and this suite fails.

import {
  buildChatAttachmentPath,
  isChatStoragePath,
  isDirectMediaUrl,
  MAX_ATTACHMENT_BYTES,
  mimeTypeForAsset,
  SignedUrlCache,
  validateChatMedia,
} from "../chatMedia.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${e}`);
}

const CONV = "0f0f0f0f-1111-4111-8111-111111111111";
const CLIENT = "a1a1a1a1-2222-4222-8222-222222222222";
const video = (durationMs: number | null, fileSize: number | null = 1000) => ({
  uri: "file:///clip.mp4", kind: "video", mimeType: "video/mp4", durationMs, fileSize,
});

Deno.test("#4114 W4 adversarial: the 60 s and 25 MB limits hold at their exact edges", () => {
  assertEquals(validateChatMedia(video(61_000)), "video_too_long", "a 61 s video is refused");
  assertEquals(validateChatMedia(video(60_000)), null, "60 s is allowed");
  assertEquals(validateChatMedia(video(60_400)), null, "picker rounding just over 60 s is allowed");
  assertEquals(validateChatMedia(video(60_600)), "video_too_long", "60.6 s is refused");
  assertEquals(validateChatMedia(video(1000, MAX_ATTACHMENT_BYTES)), null, "exactly 25 MB passes");
  assertEquals(validateChatMedia(video(1000, MAX_ATTACHMENT_BYTES + 1)), "video_too_large", "one byte over is refused");
  const file = { uri: "file:///a.pdf", kind: "file", mimeType: "application/pdf", fileSize: MAX_ATTACHMENT_BYTES + 1 };
  assertEquals(validateChatMedia(file), "file_too_large", "files have the same ceiling");
});

Deno.test("#4114 W4 adversarial: MIME spoofs never upgrade a file to an allowed type", () => {
  // The picker said it is an executable; the name claims a photo.
  const exe = { uri: "file:///photo.png", kind: "file", mimeType: "application/x-msdownload", fileName: "photo.png" };
  assertEquals(mimeTypeForAsset(exe), "application/x-msdownload", "the picker's report wins over the name");
  assertEquals(validateChatMedia(exe), "unsupported_type", "and it is refused");
  // No report, a double extension that ends in something unknown.
  const dbl = { uri: "file:///x", kind: "file", mimeType: null, fileName: "invoice.pdf.exe" };
  assertEquals(mimeTypeForAsset(dbl), "application/octet-stream", "unknown extension is octet-stream");
  assertEquals(validateChatMedia(dbl), "unsupported_type", "refused");
  // A .mov the library mislabelled as a photo keeps its real MIME (video), so
  // the image path never stores it as image/*.
  const mov = { uri: "file:///IMG_0001.MOV", kind: "image", mimeType: null, fileName: "IMG_0001.MOV" };
  assertEquals(mimeTypeForAsset(mov), "video/quicktime", "a .mov is a video whatever the picker kind says");
  // Aliases normalise, never widen.
  assertEquals(mimeTypeForAsset({ uri: "x", mimeType: "video/mov" }), "video/quicktime", "alias");
  assertEquals(mimeTypeForAsset({ uri: "x", mimeType: "  IMAGE/JPG " }), "image/jpeg", "case and spacing");
  assertEquals(validateChatMedia({ uri: "x", kind: "video", mimeType: "video/x-flv", durationMs: 1000 }), "unsupported_type", "unknown video type refused");
});

Deno.test("#4114 W4 adversarial: every built path satisfies the SQL storage helper, view once always in once/", async () => {
  const sql = await Deno.readTextFile(
    new URL("../../../../supabase/migrations/20271230034114_issue_4114_chat_media.sql", import.meta.url),
  );
  const pattern = /p_name !~\s*'([^']+)'/.exec(sql);
  assert(pattern, "the helper's name regex is present");
  const serverRegex = new RegExp(pattern[1]);
  for (const ext of ["jpg", "mp4", "pdf", "docx", "m4a", "3gp"]) {
    for (const once of [false, true]) {
      const path = buildChatAttachmentPath(CONV.toUpperCase(), CLIENT.toUpperCase(), ext.toUpperCase(), once);
      assert(serverRegex.test(path), `server accepts ${path}`);
      assertEquals(path.split("/")[1] === "once", once, `once/ segment for viewOnce=${once}`);
      assert(isChatStoragePath(path) && !isDirectMediaUrl(path), "a stored path is a path, not a URL");
    }
  }
  for (const [conv, client, ext] of [
    ["../etc", CLIENT, "jpg"],
    [CONV, `${CLIENT}/../x`, "jpg"],
    [CONV, CLIENT, "jp g"],
    [CONV, CLIENT, "toolongext"],
    [CONV, CLIENT, ""],
  ]) {
    let threw = false;
    try {
      buildChatAttachmentPath(conv, client, ext, false);
    } catch {
      threw = true;
    }
    assert(threw, `hostile path parts are refused: ${conv} ${client} ${ext}`);
  }
  for (const url of ["https://x.supabase.co/storage/v1/object/public/messages/a.jpg", "file:///tmp/a.jpg", "javascript:alert(1)"]) {
    assert(!isChatStoragePath(url), `${url} is never signed as a storage path`);
  }
  assert(!isDirectMediaUrl("javascript:alert(1)"), "a javascript: URL is never rendered directly");
});

Deno.test("#4114 W4 adversarial: the signed-URL cache never caches a failure and shares one call", async () => {
  let calls = 0;
  let fail = true;
  let now = 0;
  const cache = new SignedUrlCache(async (path) => {
    calls += 1;
    if (fail) throw new Error("sign failed");
    return `signed:${path}:${calls}`;
  }, () => now, 3600);
  let failed = false;
  try {
    await cache.get("p");
  } catch {
    failed = true;
  }
  assert(failed && cache.peek("p") === null, "a failed sign is not cached");
  fail = false;
  const [a, b] = await Promise.all([cache.get("p"), cache.get("p")]);
  assertEquals([a === b, calls], [true, 2], "concurrent gets share one call");
  now = 3600 * 1000 - 4 * 60 * 1000; // inside the 5-minute refresh margin
  assertEquals(cache.peek("p"), null, "a link about to expire is never handed out");
});

Deno.test({
  name: "#4114 W4 adversarial [KNOWN DEFECT T-W4-2]: clear() on logout drops a sign that is still in flight",
  ignore: true,
  fn: async () => {
    let release: (value: string) => void = () => {};
    const cache = new SignedUrlCache(() => new Promise<string>((resolve) => { release = resolve; }), () => 0, 3600);
    const pending = cache.get("conv/a.jpg");
    cache.clear(); // logout while the previous account's sign is running
    release("signed-for-previous-account");
    await pending.catch(() => undefined);
    assertEquals(cache.peek("conv/a.jpg"), null, "the previous account's link must not survive logout");
  },
});
