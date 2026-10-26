// #4111 Wave A — guest reply digest: service-role only, fresh link per email,
// the token hash is stored only after a successful send, failure releases.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createGuestDigestHandler } from "../handler.ts";
import { sha256Hex } from "../../_shared/brandEnquiry.ts";

const KEY = "service-role-key-for-tests";

function harness(sendOk: boolean) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const emails: Array<Record<string, unknown>> = [];
  const handle = createGuestDigestHandler({
    serviceRoleKey: KEY,
    rpc: (name, args) => {
      rpcCalls.push({ name, args });
      if (name === "issue_4111_claim_guest_digests") {
        return Promise.resolve({
          data: [{
            enquiry_id: "e-1",
            previous_emailed_at: "2026-10-25T09:00:00Z",
            guest_email: "wale@example.com",
            guest_name: "Wale",
            brand_name: "Lantern Room",
            messages: [{ display: "Mina at Lantern Room", body: "Yes, there is a ramp." }],
          }],
          error: null,
        });
      }
      return Promise.resolve({ data: true, error: null });
    },
    sendEmail: (m) => {
      emails.push(m as unknown as Record<string, unknown>);
      return Promise.resolve({ ok: sendOk, error: sendOk ? null : "provider_down" });
    },
    makeToken: () => "D".repeat(43),
    log: () => {},
  });
  return { handle, rpcCalls, emails };
}

const auth = (key: string) =>
  new Request("https://x.test/brand-enquiry-guest-digest", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
  });

Deno.test("#4111 digest refuses anything but the service-role bearer", async () => {
  const h = harness(true);
  assertEquals((await h.handle(auth("anon-key"))).status, 401);
  assertEquals(h.rpcCalls.length, 0);
});

Deno.test("#4111 a sent digest stores the new link's hash; a failed one releases the claim", async () => {
  const ok = harness(true);
  const res = await ok.handle(auth(KEY));
  assertEquals(await res.json(), { claimed: 1, sent: 1, failed: 0 });
  assertEquals((ok.emails[0].cta as { url: string }).url, `https://host.usemingla.com/m/${"D".repeat(43)}`);
  const complete = ok.rpcCalls.find((c) => c.name === "issue_4111_complete_guest_digest")!;
  assertEquals(complete.args, {
    p_enquiry_id: "e-1",
    p_token_hash: await sha256Hex("D".repeat(43)),
    p_sent: true,
    p_previous_emailed_at: "2026-10-25T09:00:00Z",
  });

  const failed = harness(false);
  assertEquals(await (await failed.handle(auth(KEY))).json(), { claimed: 1, sent: 0, failed: 1 });
  const release = failed.rpcCalls.find((c) => c.name === "issue_4111_complete_guest_digest")!;
  assertEquals([release.args.p_sent, release.args.p_token_hash], [false, null]);
});
