// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4456 — the phone's side of Unsend for everyone and Delete for me, and
// the sign-in profile fallback.
//
// MINGLA-INVARIANT: I-4456-READS-KEEP-TOMBSTONES | issue #4456 | thread pages, single-message reads and the Chats list last message keep unsent placeholders (deleted_at null OR unsent_kind in sender, admin); unread counts and read receipts still skip removed messages
// MINGLA-INVARIANT: I-4456-PROFILE-FALLBACK-REAL-COLUMNS | issue #4456 | the sign-in fallback profile insert names only id, email, display_name, first_name, last_name, created_at and updated_at
//
// FAILS-ON-REVERT: write deleted_at from the phone again, drop the tombstone
// read filter, write the reported message's text into the report, put the
// hardcoded "Message deleted" back, or put profile_image / username back in
// the fallback insert, and the matching case fails.

const root = new URL("../../", import.meta.url);
async function read(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(path, root));
}
function strip(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("#4456 service: unsend and delete-for-me go through the server", async () => {
  const service = strip(await read("services/messagingService.ts"));
  assert(/supabase\.rpc\('unsend_messages', \{ p_message_ids: ids \}\)/.test(service), "unsend RPC");
  assert(/supabase\.rpc\('hide_messages_for_me', \{ p_message_ids: ids \}\)/.test(service), "hide RPC");
  assert(/supabase\.rpc\('unhide_messages_for_me', \{ p_message_ids: ids \}\)/.test(service), "undo RPC");
  assert(!/\.update\(\{ deleted_at:/.test(service), "the phone never writes deleted_at");
  assert(!/async unsendMessage\(/.test(service), "the old single unsend is gone");
});

Deno.test("#4456 service: reads keep the unsent line, counts skip it", async () => {
  const service = strip(await read("services/messagingService.ts"));
  // #4459: a message the brand removed in its Guest chat keeps its line too.
  assert(/LIVE_OR_TOMBSTONE_FILTER = 'deleted_at\.is\.null,unsent_kind\.in\.\(sender,admin,host\)'/.test(service), "the filter");
  assert((service.match(/\.or\(LIVE_OR_TOMBSTONE_FILTER\)/g) ?? []).length === 3, "last message, thread pages and single reads");
  assert(/\.or\(LIVE_OR_TOMBSTONE_FILTER, \{ referencedTable: 'last_message' \}\)/.test(service), "the Chats list last message");
  assert(/deleted_at, unsent_at, unsent_by, unsent_kind,/.test(service), "the list reads the tombstone columns");
  assert(/\.or\(`sender_id\.neq\.\$\{userId\},sender_id\.is\.null`\)\s*\.is\('deleted_at', null\)/.test(service), "read receipts skip removed messages");
  assert(/\.in\('message_type', \['image', 'video', 'card'\]\)\s*\.is\('deleted_at', null\)/.test(service), "the media sheet skips removed messages");
});

Deno.test("#4456 thread: confirm, Undo, the unsent line and reply quotes", async () => {
  const chat = strip(await read("components/MessageInterface.tsx"));
  assert(/<UnsendConfirmSheet/.test(chat), "confirm sheet");
  assert(/setTimeout\(\(\) => \{\s*setUnsendError\(null\);\s*setUnsendRequest\(\{ ids, mode, preview \}\);\s*\}, MENU_PRESENT_AFTER_DISMISS_MS\)/.test(chat), "opens after the menu closed");
  assert(/const result = await onUnsendMessages\(unsendRequest\.ids\);/.test(chat), "not optimistic: waits for the server");
  assert(/durationMs: duration,\s*action: undo/.test(chat), "Delete for me shows Undo");
  assert(/screenReader \? DELETE_FOR_ME_UNDO_SCREEN_READER_MS : DELETE_FOR_ME_UNDO_MS/.test(chat), "10 s with a screen reader");
  assert(/if \(item\.message\.tombstone\) \{\s*return \(\s*<>\s*<UnsentBubble/.test(chat), "tombstone rows render the unsent line");
  assert(/deletedState: 'unsent'/.test(chat) && /deletedState: 'unavailable'/.test(chat), "reply quotes resolve both states");
  assert(/unsendConfirm: unsendRequest !== null/.test(chat), "Android back closes the confirm");
  assert(/messageIds: \(row\.message\.albumItems && row\.message\.albumItems\.length > 1 \? row\.message\.albumItems : \[row\.message\]\)/.test(chat), "an album is one action");
  assert(!/if \(row\.message\.viewOnce\) return;/.test(chat), "view once has a menu");
  assert(/width: 44,\s*height: 44,\s*backgroundColor: "transparent",\s*borderRadius: 22/.test(chat), "the card close button is 44pt");
});

Deno.test("#4456 menu: a labelled list, no dead props", async () => {
  const menu = strip(await read("components/chat/MessageContextMenu.tsx"));
  assert(!/position\??:/.test(menu) && !/onEdit/.test(menu) && !/onDelete\??:/.test(menu), "position, onEdit and onDelete are gone");
  assert(/enableDynamicSizing/.test(menu) && /\['86%'\]/.test(menu), "sizes to fit, up to 86%");
  assert(/messageActionGroups\(actionIds\)/.test(menu), "two groups");
  assert(/chat:actionDeleteForMeCaption/.test(menu) && /chat:actionUnsendCaption/.test(menu), "each delete action states its reach");
  assert(/onNeedsConnection/.test(menu), "offline delete actions explain themselves");
});

Deno.test("#4456 the unsent line and quotes use real metrics and i18n", async () => {
  const line = strip(await read("components/chat/UnsentBubble.tsx"));
  assert(/const FULL = 16;/.test(line) && /const SMALL = 4;/.test(line), "16 corners, 4pt tail");
  assert(/borderColor: chatTokens\.tombstoneBorder/.test(line) && /fontStyle: "italic"/.test(line), "outlined, italic");
  const quote = strip(await read("components/chat/ReplyQuoteBlock.tsx"));
  assert(!/Message deleted/.test(quote), "no hardcoded English");
  assert(/chat:replyQuoteUnsent/.test(quote) && /chat:replyQuoteUnavailable/.test(quote), "both states translated");
});

Deno.test("#4456 reports name the message; the phone sends no copy", async () => {
  const report = strip(await read("services/reportService.ts"));
  assert(/\.\.\.\(messageId \? \{ message_id: messageId \} : \{\}\)/.test(report), "report carries the message id");
  const page = strip(await read("components/ConnectionsPage.tsx"));
  assert(!/Reported message \$\{/.test(page), "no message text in the report");
  assert(/submitReport\(userId, reason as ReportReason, details, reportedMessage\?\.id \?\? null\)/.test(page), "the id is passed");
});

Deno.test("#4456 every new string is in English", async () => {
  const en = JSON.parse(await read("i18n/locales/en/chat.json"));
  const keys = {
    actionDeleteForMe: [], actionDeleteForMeAlbum: ["{{count}}"], actionUnsendAlbum: ["{{count}}"], actionRemoveForEveryone: [],
    actionDeleteForMeCaption: [], actionUnsendCaption: [], actionRemoveCaption: [], actionNeedsConnection: [], actionNeverSentCaption: [],
    unsendAlbumTitle: ["{{count}}"], unsendConfirm: [], removeConfirm: [], unsendBusy: [], tryAgain: [], removeTitle: [], removeBody: [],
    deletedForYouToast: [], undo: [], deleteForMeFailed: [], actionsOffline: [], tombstoneYouUnsent: [], tombstoneTheyUnsent: ["{{name}}"],
    tombstoneYouRemoved: [], tombstoneAdminRemoved: ["{{name}}"], tombstoneAdminRemovedYours: ["{{name}}"], replyQuoteUnsent: [],
    replyQuoteUnavailable: [], a11yReplyingTo: ["{{name}}", "{{text}}"], a11yDismissNotice: [],
  };
  for (const [key, placeholders] of Object.entries(keys)) {
    assert(typeof en[key] === "string" && en[key].length > 0, `en chat.${key}`);
    for (const p of placeholders) assert(en[key].includes(p), `en chat.${key} keeps ${p}`);
  }
  assert(en.actionUnsend === "Unsend for everyone", "Unsend says its reach");
  assert(en.unsendBody.includes("notification"), "the confirm says a banner cannot be pulled back");
  assert(!("unsentToast" in en), "the old toast is gone");
});

Deno.test("#4456 sign-in fallback writes only real profile columns", async () => {
  const auth = await read("hooks/useAuthSimple.ts");
  const start = auth.indexOf("// User exists but profile doesn't - create one");
  const insert = /\.insert\(\{([\s\S]*?)\}\)/.exec(auth.slice(start));
  assert(insert, "the fallback insert");
  const keys = [...insert[1].matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);
  const expected = ["id", "email", "display_name", "first_name", "last_name", "created_at", "updated_at"];
  assert(JSON.stringify(keys) === JSON.stringify(expected), `insert keys ${keys.join(", ")}`);
  assert(/createError\?\.code === "23505"/.test(auth.slice(start)), "a create conflict reads the existing profile");
});

// Device pass F-2: an icon name missing from the Icon map renders nothing
// ("Unknown icon name"), which left Unsend, Remove, the unsent line and the
// confirm sheet without their icons.
Deno.test("#4456 every icon the unsend surfaces use is registered", async () => {
  const iconSource = await read("components/ui/Icon.tsx");
  const map = /const ICON_MAP: Record<string, LucideIcon> = \{([\s\S]*?)\n\};/.exec(iconSource);
  assert(map, "the Icon map");
  const registered = new Set([...map[1].matchAll(/^\s*'([a-z0-9-]+)':/gm)].map((m) => m[1]));
  const used = new Set<string>();
  for (const path of [
    "components/chat/MessageContextMenu.tsx",
    "components/chat/UnsentBubble.tsx",
    "components/chat/UnsendConfirmSheet.tsx",
  ]) {
    const source = strip(await read(path));
    for (const m of source.matchAll(/<Icon\s+name="([a-z0-9-]+)"/g)) used.add(m[1]);
    for (const m of source.matchAll(/<Icon\s+name=\{([^}]*)\}/g)) {
      for (const lit of m[1].matchAll(/"([a-z0-9-]+)"/g)) used.add(lit[1]);
    }
    const icons = /const ICONS: Record<MessageActionId, string> = \{([\s\S]*?)\};/.exec(source);
    if (icons) for (const m of icons[1].matchAll(/'([a-z0-9-]+)'/g)) used.add(m[1]);
  }
  // The design's icons, by the names the Icon map registers (same glyphs:
  // CircleMinus and Shield).
  for (const name of ["remove-circle", "shield", "trash-outline", "flag-outline"]) {
    assert(used.has(name), `the scan sees ${name}`);
  }
  const missing = [...used].filter((name) => !registered.has(name));
  assert(missing.length === 0, `icons not in the Icon map: ${missing.join(", ")}`);
});

// Device pass F-1: a view-mode body cannot be measured by dynamic sizing, so
// the confirm never opened and its modal window swallowed every touch.
Deno.test("#4456 the confirm sheet opens like the menu and can never stay up unopened", async () => {
  const sheet = strip(await read("components/chat/UnsendConfirmSheet.tsx"));
  assert(/scrollMode="scroll"/.test(sheet) && !/scrollMode="view"/.test(sheet), "a measurable scroll body");
  assert(/UNSEND_CONFIRM_SNAP_POINTS = \["86%"\]/.test(sheet) && /snapPoints=\{UNSEND_CONFIRM_SNAP_POINTS/.test(sheet), "the menu's snap cap");
  assert(/onChange=\{handleChange\}/.test(sheet) && /if \(openedRef\.current\) return;[\s\S]*?onCancel\(\);[\s\S]*?onOpenFailed\?\.\(\);/.test(sheet), "an unopened sheet is closed by the watchdog");
  const menu = strip(await read("components/chat/MessageContextMenu.tsx"));
  assert(!/scrollMode="view"[\s\S]{0,200}enableDynamicSizing|enableDynamicSizing[\s\S]{0,200}scrollMode="view"/.test(menu), "the menu never pairs dynamic sizing with a view body");
  const chat = strip(await read("components/MessageInterface.tsx"));
  assert(/onOpenFailed=\{\(\) => showNotification\(t\('chat:unsendFailed'\), '', 'error'\)\}/.test(chat), "a failed open is reported");
});

// Device pass F-3: Android cut the italic unsent line to "Ana unsent a".
Deno.test("#4456 the unsent line wraps inside a numeric width on Android", async () => {
  const line = strip(await read("components/chat/UnsentBubble.tsx"));
  assert(!/numberOfLines/.test(line), "the line is never capped");
  assert(/maxWidth: Math\.round\(width \* UNSENT_BUBBLE_MAX_WIDTH_RATIO\)/.test(line), "numeric max width");
  assert(!/maxWidth: "78%"/.test(line), "no percentage width inside a flex row");
  assert(/paddingRight: 3/.test(line) && /textBreakStrategy=\{Platform\.OS === "android" \? "simple" : undefined\}/.test(line), "room for the italic overhang");
});
