// #4187 Admin program messaging wiring. The PostgreSQL suite proves the
// authorization/idempotency/RLS contract; these checks keep both Admin entry
// points on that one contract and preserve the recipient-facing copy.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const service = read("services/creatorProgramsService.js");
const words = read("lib/creatorPrograms.js");
const panel = read("components/programs/ProgramConversationPanel.jsx");
const creators = read("pages/ProgramCreatorsPage.jsx");
const locals = read("pages/locals/LocalsPanel.jsx");

test("#4187 both program surfaces use the shared conversation panel", () => {
  assert.match(creators, /programKind="creator"/);
  assert.match(creators, /targetUserId=\{creator\.creator_id\}/);
  assert.match(locals, /id: "messages"/);
  assert.match(locals, /programKind="local"/);
  assert.match(locals, /targetUserId=\{selected\.target_user_id\}/);
  assert.match(locals, /Search Locals and applicants/);
});

test("#4187 Admin calls only the server-authorized program messaging RPCs", () => {
  for (const rpc of [
    "admin_program_local_people",
    "admin_program_conversation_thread",
    "admin_program_media_prepare",
    "admin_program_message_send",
  ]) assert.match(service, new RegExp(`"${rpc}"`));
  assert.match(service, /type: "message"/);
  assert.match(service, /messageId: result\.message\.id/);
  assert.match(service, /conversationId: result\.conversation_id/);
});

test("#4187 a saved message is visibly described as an Explorer Chats conversation", () => {
  assert.match(panel, /Text, photos and videos appear in Explorer Chats\. Replies arrive here\./);
  assert.match(panel, /The thread appears in \{name\}'s Chats after the first message\./);
  assert.match(panel, /Send to Chats/);
  assert.match(panel, /retryRef\.current/);
  assert.match(panel, /postgres_changes/);
});

test("#4187 Admin media uses the private canonical chat bucket with preview, playback and download", () => {
  assert.match(service, /PROGRAM_MEDIA_BUCKET = "message-attachments"/);
  assert.match(service, /prepareProgramMediaConversation/);
  assert.match(service, /uploadProgramMedia/);
  assert.match(service, /createSignedUrl/);
  assert.match(service, /downloadProgramMedia/);
  assert.match(service, /error: "message_media_unavailable"/);
  assert.match(words, /message_media_unavailable: "That photo or video is no longer available\."/);
  assert.match(panel, /Add photo or video/);
  assert.match(panel, /accept="image\/jpeg[^"]*video\/webm"/);
  assert.match(panel, /<video src=\{url\} controls/);
  assert.match(panel, /downloadProgramMedia\(message\.file_url/);
  assert.match(panel, /"Downloading…" : "Download"/);
});
