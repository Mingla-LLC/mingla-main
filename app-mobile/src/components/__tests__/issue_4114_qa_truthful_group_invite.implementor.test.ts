// @ts-nocheck — Deno-runtime source-contract suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 simulator QA run 2 (evidence 09l): a group phone invite said
// "Text message sent" with no SMS provider. send-phone-invite now returns the
// real SMS outcome (smsStatus, as send-pair-request does since Wave 2b; its
// behaviour is pinned in supabase/functions/__tests__/issue_1541_sms_sole_send_path),
// and both group invite surfaces say "Invite not texted" with Share when the
// text did not go out.
//
// FAILS-ON-REVERT: treat a cold invite as texted without reading smsStatus, or
// show "Text message sent" unconditionally, and a case fails.

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("QA run 2: a cold invite carries the server's real SMS outcome", async () => {
  const service = strip(await read("services/sessionInviteService.ts"));
  assert(/texted: sent\?\.smsStatus === 'sent',/.test(service), "texted only when the server says sent");
  assert(/inviteLink: typeof sent\?\.inviteLink === 'string'/.test(service), "the link to share");
  const types = strip(await read("types/phoneInvite.ts"));
  assert(/smsStatus\?: "sent" \| "failed";/.test(types), "response type has smsStatus");
});

Deno.test("QA run 2: group settings says 'Text message sent' only when it was", async () => {
  const board = strip(await read("components/board/BoardSettingsDropdown.tsx"));
  const cold = board.slice(board.indexOf('} else if (outcome.kind === "cold") {'), board.indexOf('} else if (outcome.kind === "cold") {') + 700);
  assert(/if \(outcome\.texted\) \{[\s\S]*?invitedTextSent[\s\S]*?\} else \{\s*showInviteNotTextedAlert\(t, outcome\.phoneE164, outcome\.inviteLink\);/.test(cold), "texted gate");
});

Deno.test("QA run 2: the pending collab sheet does not claim a text went out", async () => {
  const sheet = strip(await read("components/connections/PendingCollabChatSheet.tsx"));
  const cold = sheet.indexOf('if (outcome.kind === "cold" && !outcome.texted) {');
  assert(cold >= 0 && cold < sheet.indexOf('"Invite sent"'), "not-texted branch comes before the success alert");
});

Deno.test("QA run 2: the not-texted alert says so and offers Share", async () => {
  const alert = strip(await read("utils/inviteNotTextedAlert.ts"));
  assert(/t\("connections:fs_sent_invite_not_texted"\)/.test(alert), "title");
  assert(/text: t\("connections:af_share"\)/.test(alert), "Share button");
  assert(/Share\.share\(\{ message: t\("connections:af_share_message", \{ link \}\) \}\)/.test(alert), "shares the link");
  const en = JSON.parse(await read("i18n/locales/en/board.json"));
  assert(typeof en.boardSettingsDropdown.inviteNotTextedBody === "string", "body copy");
});
