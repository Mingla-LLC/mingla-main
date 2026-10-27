// @ts-nocheck — Deno-runtime source-contract suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 simulator QA run 2 (evidence 06i): a picked video showed a
// generic video icon in the attach tray. It now shows its poster frame, from
// the same Wave 7 frame grab the upload uses for the bubble thumbnail (grabbed
// once per video and shared).
//
// FAILS-ON-REVERT: put the icon back for videos, grab the frame separately
// from the upload's thumbnail, or keep a failed grab cached, and a case fails.

const root = new URL("../../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("QA run 2: the attach tray shows a picked video's poster frame", async () => {
  const sheet = strip(await read("components/chat/ChatAttachSheet.tsx"));
  const item = sheet.slice(sheet.indexOf("function ItemThumb("));
  assert(/if \(item\.kind === "video"\) return <VideoThumb uri=\{item\.uri\} \/>;/.test(item), "videos use the poster thumb");
  const video = sheet.slice(sheet.indexOf("function VideoThumb("), sheet.indexOf("function ItemThumb("));
  assert(/videoPosterFor\(uri\)/.test(video), "grabs through the shared poster");
  assert(/<Image source=\{\{ uri: posterUri \}\}/.test(video), "renders the frame");
  assert(/if \(live\) setPosterUri\(poster\.uri\);/.test(video), "a late frame for an old item is ignored");
  assert(/console\.warn\("\[ChatAttachSheet\] video poster failed/.test(video), "a failed grab is logged, the icon stays");
});

Deno.test("QA run 2: one frame grab per video, shared with the upload thumbnail", async () => {
  const service = strip(await read("services/chatMediaUploadService.ts"));
  const poster = service.slice(service.indexOf("export function videoPosterFor("), service.indexOf("export async function makeChatThumbnail("));
  assert(/const cached = videoPosters\.get\(uri\);\s*if \(cached\) return cached;/.test(poster), "cached per uri");
  assert(/const poster = makeVideoThumbnail\(uri\);/.test(poster), "reuses the Wave 7 grab");
  assert(/if \(videoPosters\.get\(uri\) === poster\) videoPosters\.delete\(uri\);/.test(poster), "a failed grab is forgotten");
  const make = service.slice(service.indexOf("export async function makeChatThumbnail("));
  assert(/item\.kind === 'video' \? await videoPosterFor\(item\.uri\)/.test(make.slice(0, 400)), "upload thumbnail uses the same poster");
});
