// @ts-nocheck — Deno-runtime suite; app-mobile's broad tsc sweep includes
// Deno suites that are not configured for that command.
//
// #4435 group chat rules on the phone: create picks and the 15 cap, default
// names, leave copy, who can manage whom, and the server-checked verbs.
import {
  createButtonMode, defaultGroupName, GROUP_CAP, groupErrorKey, leaveCopyVariant, MAX_CREATE_PICKS,
  memberActions, pickRowState, remainingSlots, REMOVE_UNDO_MS, resolvedGroupName,
} from "../../../utils/groupChatModel.ts";

const root = new URL("../../../../", import.meta.url);
const read = (p: string): string => Deno.readTextFileSync(new URL(p, root));
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function equals(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("#4435 create: 0 friends is 'Just me for now', 1+ is 'Next'; picks stop at 14", () => {
  equals(createButtonMode(0), "just_me", "nobody picked");
  equals(createButtonMode(3), "next", "3 picked");
  equals(MAX_CREATE_PICKS, 14, "14 picks");
  equals(GROUP_CAP, 15, "cap 15");
  equals(pickRowState({ picked: false, inGroup: false, pickedCount: 13, slots: 14 }), "pickable", "13 of 14 still pickable");
  equals(pickRowState({ picked: false, inGroup: false, pickedCount: 14, slots: 14 }), "full", "the 15th is Group full");
  equals(pickRowState({ picked: true, inGroup: false, pickedCount: 14, slots: 14 }), "picked", "a picked row can be unpicked");
  equals(pickRowState({ picked: false, inGroup: true, pickedCount: 0, slots: 14 }), "in_group", "already in");
});

Deno.test("#4435 add people: slots come from the server's accepted count", () => {
  equals(remainingSlots(14), 1, "14 of 15: one more");
  equals(remainingSlots(15), 0, "full");
  equals(remainingSlots(20), 0, "never negative");
});

Deno.test("#4435 default names (Q4)", () => {
  equals(defaultGroupName("Ada", []), { kind: "solo", firstName: "Ada" }, "group of one");
  equals(defaultGroupName("Ada", ["Tobi", "Kemi"]), { kind: "people", firstNames: ["Tobi", "Kemi"] }, "friends' first names");
  equals(resolvedGroupName("  Saturday crew ", "Tobi & Kemi"), "Saturday crew", "typed name wins");
  equals(resolvedGroupName("   ", "Tobi & Kemi"), "Tobi & Kemi", "blank uses the default");
  equals(resolvedGroupName("x".repeat(140), "d").length, 100, "server limit 100");
});

Deno.test("#4435 leave copy: last deletes, second-to-last keeps it open", () => {
  equals(leaveCopyVariant(1), "last", "last person");
  equals(leaveCopyVariant(2), "second_to_last", "two left");
  equals(leaveCopyVariant(5), "standard", "more");
});

Deno.test("#4435 member actions: admins manage people, nobody manages the creator", () => {
  const creator = { userId: "c", isCreator: true, isAdmin: true };
  const admin = { userId: "a", isCreator: false, isAdmin: true };
  const member = { userId: "m", isCreator: false, isAdmin: false };
  equals(memberActions(admin, member), ["make_admin", "remove", "view_profile"], "admin on a member");
  equals(memberActions(creator, admin), ["remove_admin", "remove", "view_profile"], "creator on an admin");
  equals(memberActions(admin, creator), ["view_profile"], "nobody removes or demotes the creator");
  equals(memberActions(member, admin), ["view_profile"], "a member only views");
  equals(memberActions(admin, admin), ["view_profile"], "never yourself");
  equals(REMOVE_UNDO_MS, 6000, "6 second undo");
});

Deno.test("#4435 server error codes map to copy", () => {
  equals(groupErrorKey("conflict_group_full"), "chat:group_full_toast", "full");
  equals(groupErrorKey("creator_protected"), "chat:group_creator_protected", "creator");
  equals(groupErrorKey("last_admin"), "chat:group_last_admin", "last admin");
  equals(groupErrorKey("boom"), "chat:group_action_failed", "anything else");
});

Deno.test("#4435 the group verbs are server functions, never table writes", () => {
  const service = read("src/services/groupChatService.ts");
  for (const rpc of ["create_group_chat", "remove_group_member", "set_group_admin"]) {
    assert(service.includes(`supabase.rpc("${rpc}"`), `${rpc} is an RPC`);
  }
  assert(!/update\(\{ is_admin/.test(service), "no direct admin write");
});
