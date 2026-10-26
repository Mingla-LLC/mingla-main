// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 simulator QA, P3 polish. Pure rules are run here; the wiring is
// pinned from the source so a revert of any call site fails CI.
//
// FAILS-ON-REVERT: the country button back to a direct open; a failed invite
// text back to "Invited by text"; the Mute row back to an icon name the icon
// set does not have; BlockUserModal / the group settings sheet back to light;
// your own initials back in the header stack; the strip's loading cells back;
// the failed-send alert back.

import { openAfterKeyboardHides, OPEN_AFTER_KEYBOARD_FALLBACK_MS } from "../../utils/openAfterKeyboard.ts";
import { sendFailureFeedback } from "../../utils/threadModel.ts";
import { headerAvatarStack, buildCollabHeaderStrip } from "../chat/chatHeaderModel.ts";
import { buildSentRows } from "../connections/friendsSheetModel.ts";
import { buildFriendMenu } from "../../utils/chatMenuModel.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("P3a with the keyboard up, one tap dismisses it and then opens the picker", () => {
  const events: string[] = [];
  let hide: (() => void) | null = null;
  let timer: (() => void) | null = null;
  const keyboard = {
    isVisible: () => true,
    dismiss: () => events.push("dismiss"),
    addListener: (_e: string, fn: () => void) => { hide = fn; return { remove: () => events.push("removed") }; },
  };
  openAfterKeyboardHides(keyboard, () => events.push("open"), (fn, ms) => { assert(ms === OPEN_AFTER_KEYBOARD_FALLBACK_MS, "fallback delay"); timer = fn; });
  assert(events.join() === "dismiss", "dismiss first, nothing opened yet");
  hide!();
  timer!();
  assert(events.join() === "dismiss,removed,open", `opened once: ${events.join()}`);
  const down: string[] = [];
  openAfterKeyboardHides({ isVisible: () => false, dismiss: () => down.push("dismiss"), addListener: () => ({ remove() {} }) }, () => down.push("open"));
  assert(down.join() === "open", "keyboard down opens at once");
});

Deno.test("P3a the Add a friend country button waits for the keyboard", async () => {
  const page = strip(await read("components/ConnectionsPage.tsx"));
  assert(/onOpenCountryPicker=\{\(\) => openAfterKeyboardHides\(Keyboard, \(\) => setAddFriendPickerOpen\(true\)\)\}/.test(page), "wired");
  const sheet = strip(await read("components/connections/AddFriendSheet.tsx"));
  assert(/keyboardShouldPersistTaps: "handled"/.test(sheet), "the sheet's scroll keeps taps");
});

Deno.test("P3b a failed invite text says so and offers Share", async () => {
  const rows = buildSentRows({
    outgoingFriendRequests: [],
    legacyPhoneInvites: [],
    pairingPills: [
      { id: "i1", type: "pending_invite", displayName: "+15550001", avatarUrl: null, pillState: "greyed_waiting_signup", pairedUserId: null, birthday: null, pairingId: null, pairRequestId: null, pendingInviteId: "i1", createdAt: "t", inviteSmsFailed: true },
      { id: "i2", type: "pending_invite", displayName: "+15550002", avatarUrl: null, pillState: "greyed_waiting_signup", pairedUserId: null, birthday: null, pairingId: null, pairRequestId: null, pendingInviteId: "i2", createdAt: "t" },
    ],
  });
  assert(rows[0].smsFailed === true && rows[1].smsFailed === false, "failed flag carried");
  const view = strip(await read("components/connections/RequestsView.tsx"));
  assert(/row\.smsFailed \? \(/.test(view) && /t\("connections:fs_sent_invite_not_texted"\)/.test(view), "not-texted copy");
  assert(/onPress=\{\(\) => void shareInvite\(\)\}/.test(view), "Share opens the share sheet");
  const service = strip(await read("services/pairingService.ts"));
  assert(/inviteSmsFailed: \(invite as \{ sms_status\?: string \| null \}\)\.sms_status === "failed"/.test(service), "read from the row");
  const fn = strip(await Deno.readTextFile(new URL("../../supabase/functions/send-pair-request/index.ts", root)));
  assert(/\.from\("pending_pair_invites"\)\s*\.update\(\{ sms_status: smsStatus \}\)\s*\.eq\("id", invite\.id\)/.test(fn), "server persists the outcome");
  const sql = await Deno.readTextFile(new URL("../../supabase/migrations/20271230084114_issue_4114_invite_sms_status.sql", root));
  assert(/ADD COLUMN IF NOT EXISTS sms_status text/.test(sql), "column added");
  for (const locale of ["en", "fr", "yo"]) {
    const json = JSON.parse(await read(`i18n/locales/${locale}/connections.json`));
    assert(typeof json.fs_sent_invite_not_texted === "string" && json.fs_sent_invite_not_texted.length > 0, `${locale} copy`);
  }
});

Deno.test("P3c every thread-menu icon exists in the icon set (Mute had none)", async () => {
  const icons = await read("components/ui/Icon.tsx");
  let seen = 0;
  for (const surface of ["chat", "friendSheet"]) {
    for (const pairState of ["paired", "pending", "none"]) {
      for (const isMuted of [false, true]) {
        for (const canEndCollab of [false, true]) {
          const items = buildFriendMenu({ surface, isFriend: true, pairState, canOpenPairedView: true, canUnpair: true, canViewProfile: true, hasConversation: true, isMuted, canStartCollab: true, canEndCollab });
          for (const item of items) {
            seen += 1;
            assert(icons.includes(`'${item.icon}':`), `icon "${item.icon}" for ${item.id} is in the icon set`);
          }
        }
      }
    }
  }
  assert(seen > 20, "menus were built");
  const info = await read("components/chat/GroupInfoSheet.tsx");
  for (const [, name] of info.matchAll(/<Icon name="([a-z-]+)"/g)) assert(icons.includes(`'${name}':`), `group info icon ${name}`);
});

Deno.test("P3d BlockUserModal and the chat's group settings are dark, on tokens", async () => {
  const block = strip(await read("components/BlockUserModal.tsx"));
  assert(/theme="dark"/.test(block), "dark dialog");
  const hexes = [...block.matchAll(/"#[0-9a-fA-F]{3,8}"/g)].map((m) => m[0]);
  assert(hexes.length === 1 && hexes[0].toLowerCase() === '"#ef4444"', `only the Block button keeps a literal: ${hexes}`);
  const chat = strip(await read("components/MessageInterface.tsx"));
  assert(/<BoardSettingsDropdown\s+visible=\{Boolean\(isGroupChat && showMoreOptionsMenu && friend\.sessionId\)\}\s+theme="dark"/.test(chat), "chat opens it dark");
  const settings = strip(await read("components/board/BoardSettingsDropdown.tsx"));
  assert(/const st = dark \? darkStyles : styles;/.test(settings) && /theme=\{dark \? "dark" : "light"\}/.test(settings), "sheet follows the theme");
  assert(/theme=\{dark \? DARK_PHONE_THEME : undefined\}/.test(settings) && /theme=\{theme\}/.test(settings), "phone field and friend list follow");
  const dark = settings.slice(settings.indexOf("const DARK_PALETTE"), settings.indexOf("const DARK_PHONE_THEME"));
  assert(!/"#/.test(dark), "the dark palette is all chat tokens");
  const comp = settings.slice(settings.indexOf("export const BoardSettingsDropdown"), settings.indexOf("interface SettingsPalette"));
  assert(!/styles\./.test(comp.replace(/darkStyles/g, "")), "no light-only style left in the component");
});

Deno.test("P3e the header avatar stack leaves you out", async () => {
  const people = [{ id: "me", name: "Ada" }, { id: "ben", name: "Ben" }, { id: "cara", name: "Cara" }];
  const stack = headerAvatarStack(people, 3, "me");
  assert(stack.participants.map((p) => p.id).join() === "ben,cara", "others only");
  assert(stack.participantCount === 2, "count without you");
  assert(headerAvatarStack(people, 5, "me").participantCount === 4, "server count minus you");
  assert(headerAvatarStack(people.slice(1), 2, "me").participantCount === 2, "nothing removed when you are not listed");
  const chat = strip(await read("components/MessageInterface.tsx"));
  assert(/participants=\{headerStack\.participants\}\s+participantCount=\{headerStack\.participantCount\}/.test(chat), "the header uses it");
});

Deno.test("P3f the collab strip stays hidden until it has data", () => {
  const base = { actionIds: ["matches", "swipe", "plans"], matches: [], plans: [], seenMatchIds: new Set(), now: 0, untitled: "Plan" };
  const loading = buildCollabHeaderStrip({ ...base, matchesLoading: true, plansLoading: true });
  assert(loading.visible === false && loading.matches === null && loading.plan === null, "no loading cells");
  const withMatch = buildCollabHeaderStrip({ ...base, matches: [{ id: "m1", card_data: { title: "Suya" } }], matchesLoading: false, plansLoading: true });
  assert(withMatch.visible && withMatch.matches?.count === 1 && withMatch.plan === null, "a match shows; plans still hidden");
});

Deno.test("P3g a failed send shows only the inline retry; a refused send toasts", async () => {
  assert(sendFailureFeedback("network down") === "inline_retry", "retryable");
  assert(sendFailureFeedback(null) === "inline_retry", "unknown is retryable");
  assert(sendFailureFeedback("new row violates row-level security policy") === "toast_not_allowed", "policy");
  assert(sendFailureFeedback("User is blocked") === "toast_not_allowed", "blocked");
  const page = strip(await read("components/ConnectionsPage.tsx"));
  const deliver = page.slice(page.indexOf("const deliverMessage = async"), page.indexOf("const handleToggleReaction = async"));
  assert(!/Alert\.alert\(/.test(deliver), "no alert on a failed send");
  assert(/if \(sendFailureFeedback\(sendError\) === "toast_not_allowed"\) \{\s*showToast\(/.test(deliver), "refused send toasts");
  assert(!/t\("chat:mediaUploadFailed"\)/.test(deliver), "a retryable upload failure does not toast");
});
