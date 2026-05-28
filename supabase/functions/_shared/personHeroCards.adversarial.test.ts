import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { resolveFriendLocation } from "./personHeroCards.ts";

Deno.test("ORCH-0986 adversarial: missing friend GPS returns null and does not invent a fallback", async () => {
  const calls: Array<{ name: string; args: Record<string, string> }> = [];
  const adminClient = {
    rpc(name: string, args: Record<string, string>) {
      calls.push({ name, args });
      return Promise.resolve({ data: [], error: null });
    },
  };

  const result = await resolveFriendLocation(
    adminClient,
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  );

  assertEquals(result, null);
  assertEquals(calls, [{
    name: "get_paired_friend_last_location",
    args: {
      p_viewer_id: "11111111-1111-4111-8111-111111111111",
      p_friend_id: "22222222-2222-4222-8222-222222222222",
    },
  }]);
});
