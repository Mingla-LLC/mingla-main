// MINGLA-INVARIANT: I-4187-OFFICIAL-PROGRAM-NOTIFICATION | issue #4187 | An Admin-authored Local or Creator program message uses the official program-team name in the recipient notification; the recipient's reply retains the ordinary named group title.
import { unifiedMessageTitle } from "../messageKeys.ts";

function equals(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

Deno.test("#4187 Admin program sends use the official team title", () => {
  equals(unifiedMessageTitle({
    conversationType: "group",
    conversationName: "Mingla Creator team",
    programKind: "creator",
    programTargetUserId: "creator-id",
    senderId: "admin-id",
    senderName: "Admin One",
  }), "Mingla Creator team", "official Creator team");
});

Deno.test("#4187 recipient replies and ordinary groups keep normal named-group titles", () => {
  equals(unifiedMessageTitle({
    conversationType: "group",
    conversationName: "Mingla Local team",
    programKind: "local",
    programTargetUserId: "local-id",
    senderId: "local-id",
    senderName: "Lola Local",
  }), "Lola Local in Mingla Local team", "recipient reply");
  equals(unifiedMessageTitle({
    conversationType: "direct",
    senderId: "friend-id",
    senderName: "Friend",
  }), "Friend", "ordinary direct message");
});
