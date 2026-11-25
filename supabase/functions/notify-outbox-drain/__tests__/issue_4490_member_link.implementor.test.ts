// #4490 P6 — the drain builds a member email's link at send time from the
// member id and the stored token hash; no match, no link (the email still goes).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveVenueMemberDispatch } from "../index.ts";
import { deriveVenueMemberToken } from "../../_shared/venueMembershipToken.ts";
import { venueOfferTokenHashHex } from "../../_shared/venueOfferBookingToken.ts";

const SUB = "00000000-4490-4000-8000-0000000000d6";
const KEY = { kid: "k1", key: new Uint8Array(32).fill(9) };
// deno-lint-ignore no-explicit-any
const RING: any = { ok: true, current: KEY, previous: null };
const env = (name: string) =>
  ({ BUSINESS_WEB_ORIGIN: "http://localhost:8491", SUPABASE_URL: "http://kong:8000" } as Record<string, string>)[name];

function admin(hash: string | null) {
  return {
    from: (table: string) => {
      assertEquals(table, "venue_membership_subscriptions");
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: { member_token_hash: hash }, error: null }) }),
        }),
      };
    },
  };
}

Deno.test("a member email gets the member page link, built at send time", async () => {
  const token = await deriveVenueMemberToken({ subscriptionId: SUB, key: KEY });
  const hash = `\\x${await venueOfferTokenHashHex(token)}`;
  const url = await resolveVenueMemberDispatch(admin(hash), {
    id: "o1", contact: "amaka@example.com", payload: { subscription_id: SUB },
  }, env, RING);
  assertEquals(url, `http://localhost:8491/visit/plan/${SUB}#t=${token}`);
});

Deno.test("no matching token, no email contact or no member id: no link", async () => {
  const row = { id: "o1", contact: "amaka@example.com", payload: { subscription_id: SUB } };
  assertEquals(await resolveVenueMemberDispatch(admin("\\x" + "0".repeat(64)), row, env, RING), null);
  assertEquals(await resolveVenueMemberDispatch(admin(null), { ...row, contact: "+2348000000000" }, env, RING), null);
  assertEquals(await resolveVenueMemberDispatch(admin(null), { ...row, payload: {} }, env, RING), null);
});
