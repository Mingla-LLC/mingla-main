// @ts-nocheck — Deno-runtime source-contract suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 4 — the wiring that makes attach work, pinned so a revert
// of any call site fails CI. The rules themselves are exercised behaviourally
// in src/utils/__tests__/issue_4114_chat_media.implementor.happy.test.ts.
//
//   * one upload service: the private message-attachments bucket, a stored
//     PATH (never getPublicUrl), the asset's MIME type on the request;
//   * ConnectionsPage: the first message of a new chat goes through the same
//     service (no `chat-files` bucket), no hard-coded image/jpeg / video/mp4,
//     no storage calls of its own, Retry keeps the client id;
//   * MessageInterface: File opens expo-document-picker, photos open the
//     shared ImageLightbox, videos the expo-video player, the fake 500 ms
//     timer is gone, and view once has no long-press menu;
//   * expo-video, expo-document-picker and expo-image-manipulator are already
//     in the installed binary (package.json + app.json plugin + an existing
//     importer), so the OTA adds no native module.
//
// FAILS-ON-REVERT: restoring `.from('chat-files')`, `getPublicUrl(` in the send
// path, `contentType = "video/mp4"`, the `}, 500);` preview timer, the
// photo-library "document" fallback, or the custom image-preview <Modal>
// instead of <ImageLightbox fails here.

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function functionBody(source: string, signature: RegExp): string {
  const match = signature.exec(source);
  assert(match, `missing ${signature}`);
  const start = source.indexOf("{", match.index + match[0].length - 1);
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated body for ${signature}`);
}

Deno.test("W4 one upload service: private bucket, stored path, real MIME type, cancel", async () => {
  const service = stripComments(await read("services/chatMediaUploadService.ts"));
  assert(!/getPublicUrl\s*\(/.test(service), "the upload service never makes a public URL");
  assert(/storage\/v1\/object\/\$\{CHAT_MEDIA_BUCKET\}\/\$\{path\}/.test(service), "uploads go to the private bucket by path");
  assert(/buildChatAttachmentPath\(/.test(service), "the path comes from buildChatAttachmentPath");
  assert(/'Content-Type': item\.mimeType/.test(service), "the request carries the asset's MIME type");
  assert(/manipulateAsync\(/.test(service) && /SaveFormat\.JPEG/.test(service), "photos are resized and re-encoded");
  // Wave 7: the result also carries the thumbnail path and the media's size.
  assert(/return \{\s*path,\s*mimeType: item\.mimeType/.test(service), "the result is the path, not a URL");
  // #4114 rework: the cancel bookkeeping lives in utils/chatMedia.ts
  // (ChatUploadCancelRegistry, behaviour-tested in issue_4114_upload_cancel).
  assert(/uploads\.cancel\(clientId\)/.test(service) && /uploads\.start\(clientId, task\)/.test(service), "uploads can be cancelled");
  const media = stripComments(await read("utils/chatMedia.ts"));
  assert(/await active\.task\.cancelAsync\(\)/.test(media), "a running upload's task is cancelled");
  assert(/createSignedUrl\(path, seconds\)/.test(service), "display links are signed");
  assert(/functions\.invoke<[\s\S]*?>\('open-view-once'/.test(service), "view once opens through the edge function");
});

Deno.test("W4 ConnectionsPage: the first message uses the service; no storage calls, no hard-coded MIME", async () => {
  const page = stripComments(await read("components/ConnectionsPage.tsx"));
  assert(!/chat-files/.test(page), "the non-existent chat-files bucket is gone");
  assert(!/getPublicUrl\s*\(/.test(page), "no public URL is made for a new message");
  assert(!/supabase\.storage/.test(page), "ConnectionsPage does no storage calls of its own");
  assert(!/"video\/mp4"|"image\/jpeg"/.test(page), "no hard-coded MIME types");

  const deliver = functionBody(page, /const deliverMessage = async \(/);
  assert(/prepareChatMedia\(pending\.localMedia\)/.test(deliver) && /uploadChatMedia\(\{/.test(deliver),
    "deliverMessage uploads through the one service");
  assert(deliver.indexOf("uploadChatMedia(") < deliver.indexOf("messagingService.sendMessage("),
    "the upload finishes before the insert");
  assert(/fileUrl: uploaded\.path/.test(deliver), "the message stores the storage path");
  // Wave 7: the options also carry the thumbnail, media facts and album id.
  assert(/messagingService\.sendMessage\([\s\S]*clientId,\s*\{\s*viewOnce: current\.viewOnce === true,/.test(deliver),
    "the send passes the client id and the view-once flag");

  const ensure = functionBody(page, /const ensureChatConversation = async \(/);
  assert(/messagingService\.ensureConversation\(/.test(ensure), "a new chat is created before its first send");
  const media = functionBody(page, /const handleSendMedia = async \(/);
  assert(/ensureChatConversation\(\)/.test(media) && /deliverMessage\(conversationId, message\)/.test(media),
    "media sends (first message included) go through ensureChatConversation + deliverMessage");
  const text = functionBody(page, /const handleSendMessage = async \(/);
  assert(/ensureChatConversation\(\)/.test(text) && /deliverMessage\(conversationId, optimisticMsg\)/.test(text),
    "text sends take the same path");

  const cancel = functionBody(page, /const handleCancelMediaUpload = \(/);
  assert(/cancelChatMediaUpload\(target\.clientId\)/.test(cancel), "cancel stops the upload by client id");
});

Deno.test("W4 MessageInterface: real document picker, lightbox, video player, no fake timer", async () => {
  const chat = stripComments(await read("components/MessageInterface.tsx"));
  assert(!/\},\s*500\);/.test(chat) && !/isProcessingFile/.test(chat), "the fake 500 ms loading timer is gone");
  const file = functionBody(chat, /const handlePickFile = async \(/);
  assert(/DocumentPicker\.getDocumentAsync\(/.test(file) && !/launchImageLibraryAsync/.test(file),
    "File opens the document picker, not the photo library");
  const library = functionBody(chat, /const handlePickLibrary = async \(/);
  assert(/requestGalleryPermission\(\)/.test(library) && /allowsMultipleSelection: true/.test(library) && /selectionLimit:/.test(library),
    "Photos and videos is a multi-select through the permission wrapper");
  const camera = functionBody(chat, /const handlePickCamera = async \(/);
  assert(/launchCameraAsync\(/.test(camera), "Camera opens the camera");
  const add = functionBody(chat, /const addPickedMedia = \(/);
  assert(/validateChatMedia\(item\)/.test(add), "every pick is validated before it can be sent");

  // Wave 7: the lightbox holds every photo of an album (one photo for a single image).
  assert(/<ImageLightbox\b/.test(chat) && /visible=\{!!lightbox\}/.test(chat), "photos open in the shared ImageLightbox");
  assert(/<ChatVideoPlayerModal url=\{videoUrl\}/.test(chat), "videos open in the in-app player");
  const press = functionBody(chat, /const handleBubblePress = useCallback\(\(row: ThreadRow, albumIndex\?: number\) =>/);
  assert(/handleOpenImage\(/.test(press) && /handleOpenVideo\(/.test(press) && /handleOpenViewOnce\(/.test(press),
    "tapping a photo, video or view-once bubble opens it");
  const openImage = functionBody(chat, /const handleOpenImage = async \(/);
  assert(/resolveChatMediaUrl\(fileUrl\)/.test(openImage) && /setLightboxUrl\(url\)/.test(openImage),
    "the lightbox gets a resolved (signed) link");
  const longPress = functionBody(chat, /const handleBubbleLongPress = useCallback\(\(row: ThreadRow, pageY: number\) =>/);
  assert(/if \(row\.message\.viewOnce\) return;/.test(longPress), "view once has no long-press menu");
  assert(/<ChatAttachSheet\b/.test(chat), "the attach sheet replaces the clipped menu");
});

Deno.test("W4 bubbles: view once draws no preview; media resolve stored paths", async () => {
  const bubble = stripComments(await read("components/chat/MessageBubble.tsx"));
  // Wave 7: photos and videos share one media card, drawn only when not view once.
  assert(/const isMediaCard = \(message\.type === 'image' \|\| message\.type === 'video'\) && !message\.viewOnce;/.test(bubble),
    "a view-once photo or video never renders its image or a tile");
  assert(/useChatMediaUrl\(source\)/.test(bubble), "photos resolve stored paths to signed links");
  const service = stripComments(await read("services/messagingService.ts"));
  assert(/options\.viewOnce === true \? \{ view_once: true \} : \{\}/.test(service), "view_once is only sent when true");
  assert(/item\.view_once !== true/.test(service), "view-once items stay out of the shared media grid");
});

Deno.test("W4 no new native module: expo-video, document picker and image manipulator are already shipped", async () => {
  const pkg = JSON.parse(await read("../package.json"));
  const app = JSON.parse(await read("../app.json"));
  for (const dep of ["expo-video", "expo-document-picker", "expo-image-manipulator", "expo-image-picker", "expo-file-system"]) {
    assert(typeof pkg.dependencies?.[dep] === "string", `${dep} is in package.json`);
  }
  const plugins = JSON.stringify(app.expo?.plugins ?? []);
  assert(plugins.includes('"expo-video"'), "expo-video is a config plugin in app.json");
  const welcome = await read("components/signIn/WelcomeVideoBackground.tsx");
  assert(/from "expo-video"/.test(welcome), "expo-video already loads on the shipped sign-in screen");
  const intake = await read("components/expandedCard/ConsumerIntakeForm.tsx");
  assert(/from "expo-document-picker"/.test(intake), "expo-document-picker already ships");
  const camera = await read("services/cameraService.ts");
  assert(/from 'expo-image-manipulator'/.test(camera), "expo-image-manipulator already ships");
});
