// @ts-nocheck — Deno-runtime suite; app-mobile's broad tsc sweep includes
// Deno suites and unrelated packages that are not configured for that command.
//
// MINGLA-INVARIANT: I-4187-PROGRAM-CHAT-CANONICAL | issue #4187 | Admin program messages render in the canonical Explorer Chats list as an official managed thread, retain official sender snapshots, allow persistent text/photo/video replies on the canonical media rail, and do not expose member/leave/view-once/file controls.
import { buildBrowseItems, chatAvatarSpec, chatKind, matchesChatFilter } from "../chatListModel.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function equals(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const program = {
  id: "program-chat",
  created_at: "2026-10-29T12:00:00.000Z",
  type: "group" as const,
  name: "Mingla Local team",
  linked_entity_type: "direct" as const,
  program_kind: "local" as const,
  participants: [{ id: "local" }, { id: "admin" }],
  last_message: { content: "Welcome", created_at: "2026-10-29T12:01:00.000Z" },
};

Deno.test("#4187 official program chats appear in All as a square Mingla thread", () => {
  equals(chatKind(program), "program", "program kind wins over its group transport");
  assert(matchesChatFilter(program, "all"), "visible in the main Chats list");
  assert(!matchesChatFilter(program, "groups"), "not presented as a social collaboration group");
  equals(buildBrowseItems({ active: [program], archivedCount: 0, filter: "all" }).map((item) => item.kind), ["chat"], "canonical chat row");
  equals(chatAvatarSpec({ kind: "program", currentUserId: "local", label: program.name, participants: program.participants }).shape, "square", "official team avatar");
});

Deno.test("#4187 Explorer presents an official managed thread with durable photo and video replies", () => {
  const components = new URL("../../", import.meta.url);
  const src = new URL("../../../", import.meta.url);
  const connections = Deno.readTextFileSync(new URL("ConnectionsPage.tsx", components));
  const message = Deno.readTextFileSync(new URL("MessageInterface.tsx", components));
  const info = Deno.readTextFileSync(new URL("chat/GroupInfoSheet.tsx", components));
  const service = Deno.readTextFileSync(new URL("services/messagingService.ts", src));
  const copy = JSON.parse(Deno.readTextFileSync(new URL("i18n/locales/en/chat.json", src)));
  assert(connections.includes("allowAttachments"), "program chat keeps the attachment composer");
  assert(connections.includes("allowViewOnce={!activeChat.programKind}"), "program chat disables disappearing media");
  assert(connections.includes("allowFiles={!activeChat.programKind}"), "program chat limits attachments to photos and videos");
  assert(connections.includes("handleSendMedia(items, caption, viewOnce, replyToId)"), "program media uses the canonical upload handler");
  assert(message.includes("chat:programTeamSubtitle"), "official subtitle is wired");
  equals(copy.programTeamSubtitle, "Official Mingla program team", "official subtitle is visible");
  assert(message.includes("managed={isProgramChat}"), "managed state reaches group info");
  assert(info.includes("!managed ? members.map"), "member controls are hidden for managed chat");
  assert(info.includes("!managed ? <TouchableOpacity"), "leave control is hidden for managed chat");
  assert(service.includes("lastMessageRaw.sender_display_name_snapshot"), "chat list preserves official sender snapshot");
  assert(service.includes("message.sender_display_name_snapshot"), "opened messages preserve official sender snapshot");
  const migration = Deno.readTextFileSync(new URL("../../../../../supabase/migrations/20280212004187_issue_4187_admin_program_messaging.sql", import.meta.url));
  assert(migration.includes("conversation.program_target_user_id=auth.uid()"), "recipient program threads enter the canonical access batch");
  assert(migration.includes("lifecycle.hidden_at IS NULL"), "program chat access respects the recipient's hidden lifecycle state");
});
