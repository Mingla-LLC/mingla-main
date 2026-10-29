// @ts-nocheck — Deno-runtime suite; app-mobile's broad tsc sweep includes
// Deno suites and unrelated packages that are not configured for that command.
//
// MINGLA-INVARIANT: I-4187-PROGRAM-CHAT-CANONICAL | issue #4187 | Admin program messages render in the canonical Explorer Chats list as an official managed thread, retain official sender snapshots, allow persistent text/photo/video replies on the canonical media rail, and do not expose member/leave/view-once/file controls.
// MINGLA-INVARIANT: I-4187-CHAT-COMPOSER-SURFACE-GEOMETRY | issue #4187 | The Explorer chat composer clears exactly one current bottom surface: the rendered floating nav while the keyboard is closed, or the keyboard toolbar while it is open; nav and keyboard clearances never add together.
import { buildBrowseItems, chatAvatarSpec, chatKind, matchesChatFilter } from "../chatListModel.ts";
import {
  CHAT_COMPOSER_SURFACE_GAP,
  resolveChatComposerBottom,
} from "../../../utils/chatComposerGeometry.ts";

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

Deno.test("#4187 chat composer sits flush to the nav and keyboard toolbar", () => {
  const common = {
    keyboardToolbarHeight: 42,
    floatingNavBottom: 91,
    androidSafeAreaBottom: 24,
    androidWindowShrinkAmount: 0,
  } as const;

  equals(CHAT_COMPOSER_SURFACE_GAP, 8, "one compact surface gap");
  equals(
    resolveChatComposerBottom({
      ...common,
      platform: "ios",
      keyboardVisible: false,
      keyboardHeight: 0,
    }),
    91,
    "closed iOS composer uses the rendered nav footprint exactly",
  );
  equals(
    resolveChatComposerBottom({
      ...common,
      platform: "ios",
      keyboardVisible: true,
      keyboardHeight: 336,
    }),
    386,
    "open iOS composer clears the keyboard, toolbar, and one 8pt gap",
  );
  equals(
    resolveChatComposerBottom({
      ...common,
      platform: "android",
      keyboardVisible: true,
      keyboardHeight: 300,
      androidWindowShrinkAmount: 324,
    }),
    50,
    "resized Android window adds only toolbar and gap",
  );
  equals(
    resolveChatComposerBottom({
      ...common,
      platform: "android",
      keyboardVisible: true,
      keyboardHeight: 300,
    }),
    374,
    "non-resizing Android window receives the manual keyboard lift once",
  );

  const components = new URL("../../", import.meta.url);
  const source = Deno.readTextFileSync(new URL("MessageInterface.tsx", components));
  assert(source.includes("getFloatingBottomNavSheetInset(safeInsets.bottom)"), "closed composer uses actual floating nav geometry");
  assert(source.includes("resolveChatComposerBottom({"), "all chat types share the tested resolver");
  assert(!source.includes("bottomNavTotalHeight + INPUT_CAPSULE_MARGIN_BOTTOM"), "the stale page-layout approximation cannot return");
});
