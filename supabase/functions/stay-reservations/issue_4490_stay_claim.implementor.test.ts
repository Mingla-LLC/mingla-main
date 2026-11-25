// #4490 Explorer W1 — the signed-in /stay page carries the app claim card
// (spec 06 W1 web item 1): get_group adds `claim` (kind stay_group) while
// VENUE_APP_HANDOFF is on, and { shortUrl: null, code: null } while it is off.
// fails-on-revert: drop the get_group claim branch and SC-1 fails (no claim).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleStayReservations } from "./index.ts";

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");

const groupId = "00000000-4490-4000-8000-0000000000f1";

const read = (handoff: boolean, calls: string[]): Promise<Response> =>
  handleStayReservations(
    new Request("http://local/stay-reservations", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: JSON.stringify({ action: "get_group", payload: { groupId } }),
    }),
    {
      createRpcClient: () => ({
        rpc: () => Promise.resolve({ data: { groupId, state: "confirmed" }, error: null }),
      }),
      createServiceRpcClient: () => ({
        rpc: (name: string, params: Record<string, unknown>) => {
          calls.push(`${name}:${String(params.p_subject_kind ?? params.p_flag ?? "")}`);
          if (name === "issue_4490_flag_on") return Promise.resolve({ data: handoff, error: null });
          return Promise.resolve({ data: { code: "K7Q2MX0002", claimed: false }, error: null });
        },
      }),
    },
  );

Deno.test("SC-1 handoff on: the stay read carries the stay_group claim link", async () => {
  const calls: string[] = [];
  const response = await read(true, calls);
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.data.claim, { shortUrl: "https://usemingla.com/c/K7Q2MX0002", code: "K7Q2MX0002" });
  assertEquals(calls.includes("mint_claim_link:stay_group"), true);
});

Deno.test("SC-2 handoff off: no claim link is minted", async () => {
  const calls: string[] = [];
  const body = await (await read(false, calls)).json();
  assertEquals(body.data.claim, { shortUrl: null, code: null });
  assertEquals(calls.some((c) => c.startsWith("mint_claim_link")), false);
});
