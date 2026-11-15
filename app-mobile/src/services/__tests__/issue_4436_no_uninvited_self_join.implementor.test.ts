// @ts-nocheck — Deno-runtime suite; app-mobile's broad tsc sweep includes
// Deno suites that are not configured for that command.
//
// #4436: the app has no client path that inserts an uninvited pending member
// row. The old invite-code join helpers are gone; the group link
// (join_group_by_link, a server function) is the one join path.
const root = new URL("../../../", import.meta.url);
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("#4436 the invite-code self-join helpers are deleted", () => {
  const service = Deno.readTextFileSync(new URL("src/services/boardInviteService.ts", root));
  assert(!/static async joinByInviteCode\(/.test(service), "joinByInviteCode is gone");
  assert(!/static async joinByInviteLink\(/.test(service), "joinByInviteLink is gone");
  assert(!/from\('session_participants'\)\s*\.insert\(/.test(service), "no member row insert in the invite service");
});
