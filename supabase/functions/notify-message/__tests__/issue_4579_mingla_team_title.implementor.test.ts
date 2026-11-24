// MINGLA-INVARIANT: I-4579-BRAND-PUSH-NAME | issue #4579 | A push from a brand-linked chat names a Mingla admin who was added to the brand automatically by issue_4579_admin_public_name (a real first name or "Mingla Team"), never by an email or handle; a failed lookup says "Someone"; other chats keep the profile name.
import { brandChatSenderName, unifiedMessageTitle } from "../messageKeys.ts";

function equals(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

// The database rule, reduced to what this test needs: the RPC returns the
// public name for a Mingla Team member and the fallback for anyone else.
const lookup =
  (publicNames: Record<string, string>, calls: string[] = []) =>
  (brandId: string, senderId: string, fallback: string) => {
    calls.push(`${brandId}:${senderId}`);
    return Promise.resolve({
      name: publicNames[senderId] ?? fallback,
      error: false,
    });
  };

Deno.test("#4579 a Mingla Team member's brand push uses the public name, never the handle", async () => {
  const name = await brandChatSenderName(
    {
      linkedEntityType: "brand",
      brandId: "brand-1",
      senderId: "admin-1",
      fallback: "kunle",
    },
    lookup({ "admin-1": "Kunle" }),
  );
  equals(name, "Kunle", "public name");
  equals(
    unifiedMessageTitle({
      conversationType: "group",
      conversationName: "Mama's Kitchen",
      senderId: "admin-1",
      senderName: name,
    }),
    "Kunle in Mama's Kitchen",
    "push title",
  );
});

Deno.test("#4579 a handle-only profile falls back to Mingla Team", async () => {
  const name = await brandChatSenderName(
    {
      linkedEntityType: "brand",
      brandId: "brand-1",
      senderId: "admin-2",
      fallback: "ray.k",
    },
    lookup({ "admin-2": "Mingla Team" }),
  );
  equals(name, "Mingla Team", "fallback name");
  equals(name.includes("ray"), false, "no handle");
});

Deno.test("#4579 an invited host keeps their own name; other chats skip the lookup", async () => {
  const calls: string[] = [];
  equals(
    await brandChatSenderName(
      {
        linkedEntityType: "brand",
        brandId: "brand-1",
        senderId: "host-1",
        fallback: "Hana Host",
      },
      lookup({}, calls),
    ),
    "Hana Host",
    "host name",
  );
  equals(
    await brandChatSenderName(
      {
        linkedEntityType: "direct",
        brandId: null,
        senderId: "friend",
        fallback: "Friend",
      },
      lookup({}, calls),
    ),
    "Friend",
    "direct chat",
  );
  equals(
    await brandChatSenderName(
      {
        linkedEntityType: "session",
        brandId: "brand-1",
        senderId: "friend",
        fallback: "Friend",
      },
      lookup({}, calls),
    ),
    "Friend",
    "session chat",
  );
  equals(calls.length, 1, "only the brand chat asked the database");
});

Deno.test("#4579 a failed lookup never falls back to a possible handle", async () => {
  const name = await brandChatSenderName(
    {
      linkedEntityType: "brand",
      brandId: "brand-1",
      senderId: "admin-1",
      fallback: "kunle",
    },
    () => Promise.resolve({ name: null, error: true }),
  );
  equals(name, "Someone", "failed lookup");
});
