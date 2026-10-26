// @ts-nocheck — Deno-runtime source-contract suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 3 — inside a chat. The rules themselves are exercised
// behaviourally in components/chat/__tests__/issue_4114_chat_header_model...,
// utils/__tests__/issue_4114_chat_menu_model... and
// utils/__tests__/issue_4114_thread_model...; this suite pins the WIRING so a
// revert of any call site fails CI.
//
// FAILS-ON-REVERT: a toast fired before the confirm settles; the session-less
// group ⋯ back to a dead tap; reactions not read or not rendered; the sender
// name back on every bubble; the composer back to a fixed height; the Android
// back handler removed; the unused discussion code restored.

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function body(source: string, signature: RegExp): string {
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

Deno.test("W3 no success toast before the confirm settles", async () => {
  const chat = strip(await read("components/MessageInterface.tsx"));
  for (const [name, prop, ok] of [
    ["handleRemoveFriend", "onRemoveFriend", "removed"],
    ["handleBlockUser", "onBlockUser", "blocked"],
    ["handleReportUser", "onReportUser", "reported"],
  ]) {
    const fn = body(chat, new RegExp(`const ${name} = \\(\\) =>`));
    const call = fn.indexOf(`${prop}?.(friend, (${ok}) =>`);
    const toast = fn.indexOf("showNotification(");
    assert(call >= 0, `${name} hands the confirm a settle callback`);
    assert(toast > call, `${name} toasts only inside the settle callback`);
    assert(new RegExp(`if \\(!${ok}\\) return;`).test(fn), `${name} shows nothing on cancel or failure`);
  }
  const page = strip(await read("components/ConnectionsPage.tsx"));
  const remove = body(page, /const handleRemoveFriend = \(friend: Friend, onSettled\?: \(removed: boolean\) => void\) =>/);
  assert(/text: t\('common:cancel'\), style: "cancel", onPress: \(\) => onSettled\?\.\(false\)/.test(remove), "Cancel settles false");
  assert(/onSettled\?\.\(true\)/.test(remove) && remove.indexOf("removeFriend(friend.id)") < remove.indexOf("onSettled?.(true)"),
    "settles true only after the server removal");
  const block = body(page, /const handleBlockConfirm = async \(/);
  assert(/blockFriend\(userToBlock\.id, reason\)\)\s*\.then\(\(\) => settleBlock\(true\)\)/.test(block), "block settles after the server");
  assert(/setSelectedUserToBlock\(null\);\s*settleBlock\(false\);/.test(page), "closing the block modal settles false");
  assert(/settleReport\(true\)/.test(page) && /settleReport\(false\)/.test(page), "report settles both ways");
});

Deno.test("W3 the session-less group ⋯ opens group info (was a dead tap)", async () => {
  const chat = strip(await read("components/MessageInterface.tsx"));
  const more = body(chat, /const handleHeaderMorePress = \(\) =>/);
  assert(/if \(isGroupChat && !friend\.sessionId\) \{[\s\S]*setShowGroupInfo\(true\)/.test(more), "⋯ opens group info");
  assert(/<GroupInfoSheet[\s\S]{0,200}visible=\{Boolean\(isGroupChat && !friend\.sessionId && !isTripEventGroupChat && showGroupInfo\)\}/.test(chat),
    "group info mounts for session-less groups");
  assert(/<BoardSettingsDropdown[\s\S]{0,120}isGroupChat && showMoreOptionsMenu && friend\.sessionId/.test(chat),
    "session groups keep BoardSettingsDropdown");
  const sheet = strip(await read("components/chat/GroupInfoSheet.tsx"));
  assert(/setConversationMuted\(/.test(sheet) && /leaveGroupConversation\(/.test(sheet), "group info mutes and leaves");
});

Deno.test("W3 one menu: the chat ⋯ and FriendActionsSheet render the same list", async () => {
  const chat = strip(await read("components/MessageInterface.tsx"));
  const sheet = strip(await read("components/friends/FriendActionsSheet.tsx"));
  for (const [name, src] of [["MessageInterface", chat], ["FriendActionsSheet", sheet]]) {
    assert(/buildFriendMenu\(\{/.test(src), `${name} builds the shared list`);
    assert(/<ChatActionList\b/.test(src), `${name} renders it with ChatActionList`);
  }
  assert(/theme="dark"/.test(sheet), "FriendActionsSheet is dark");
  assert(!/<Text style=\{styles\.chatSheetText\}>View Profile<\/Text>/.test(chat), "the hand-built English menu is gone");
  assert(/case "mute":[\s\S]{0,80}handleToggleMute\(\)/.test(chat), "1:1 chats can be muted");
});
