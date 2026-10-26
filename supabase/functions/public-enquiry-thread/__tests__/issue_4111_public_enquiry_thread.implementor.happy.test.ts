// #4111 Wave A — public-enquiry-thread: token hashing, expiry, guest view.
// FAILS-ON-REVERT: passing the raw token to the database, or returning the
// RPC's thread JSON unfiltered, fails the assertions below.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createPublicEnquiryThreadHandler } from "../handler.ts";
import { sha256Hex } from "../../_shared/brandEnquiry.ts";
import type { PublicEnquiryDeps } from "../../_shared/brandEnquiryRuntime.ts";

const TOKEN = "Zt9_".repeat(11); // 44 url-safe chars
const NEW_TOKEN = "N".repeat(43);

function harness(responses: Record<string, unknown>) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const emails: Array<Record<string, unknown>> = [];
  const floors: number[] = [];
  const deps: PublicEnquiryDeps = {
    now: () => 1_000,
    sleepFloor: (s) => {
      floors.push(s);
      return Promise.resolve();
    },
    originDeps: {
      localStack: false,
      isActiveSiteHost: () => Promise.resolve(false),
      sitesEnvironment: () => Promise.resolve(null),
    },
    rpc: (name, args) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: responses[name] ?? null, error: null });
    },
    resolveBrand: () => Promise.resolve(null),
    moderate: () => Promise.reject(new Error("unused")),
    sendEmail: (m) => {
      emails.push(m as unknown as Record<string, unknown>);
      return Promise.resolve({ ok: true });
    },
    sendSms: () => Promise.reject(new Error("unused")),
    makeToken: () => NEW_TOKEN,
    log: () => {},
  };
  return { handle: createPublicEnquiryThreadHandler(deps), rpcCalls, emails, floors };
}

const THREAD = {
  status: "ok",
  enquiry: {
    brand_name: "Lantern Room",
    brand_slug: "lantern",
    brand_logo_url: null,
    brand_accent: "#C4471A",
    status: "replied",
    topic_label: "General question",
    channel_label: "Web",
    guest: { name: "Wale", email: "should-not-leak@example.com" },
    context: { kind: "offering" },
  },
  messages: [
    { id: "m1", who: "guest", display: "Wale", body: "Hello", at: "2026-10-25T10:00:00Z", mine: true },
    { id: "m2", who: "brand", display: "Mina at Lantern Room", body: "Hi!", at: "2026-10-25T10:05:00Z", sender_id: "member-uuid" },
  ],
};

Deno.test("#4111 GET looks the thread up by the token's SHA-256 and returns only the guest view", async () => {
  const h = harness({ issue_4111_thread_by_token: THREAD });
  const res = await h.handle(new Request(`https://x.test/public-enquiry-thread?token=${TOKEN}`));
  assertEquals(res.status, 200);
  assertEquals(h.rpcCalls[0].args.p_token_hash, await sha256Hex(TOKEN));
  const body = await res.json();
  assertEquals(body, {
    status: "ok",
    brand: { name: "Lantern Room", slug: "lantern", logo_url: null, accent: "#C4471A" },
    topic_label: "General question",
    enquiry_status: "replied",
    channel_label: "Web",
    messages: [
      { who: "guest", display: "Wale", body: "Hello", at: "2026-10-25T10:00:00Z" },
      { who: "brand", display: "Mina at Lantern Room", body: "Hi!", at: "2026-10-25T10:05:00Z" },
    ],
  });
  const text = JSON.stringify(body);
  assert(!text.includes("@example.com") && !text.includes("member-uuid"));
  assertEquals(h.floors.length, 1);
});

Deno.test("#4111 expired and unknown tokens answer 410 and 404", async () => {
  const expired = harness({ issue_4111_thread_by_token: { status: "expired" } });
  assertEquals((await expired.handle(new Request(`https://x.test/t?token=${TOKEN}`))).status, 410);
  const unknown = harness({ issue_4111_thread_by_token: { status: "invalid" } });
  assertEquals((await unknown.handle(new Request(`https://x.test/t?token=${TOKEN}`))).status, 404);
  const malformed = harness({});
  assertEquals((await malformed.handle(new Request("https://x.test/t?token=short"))).status, 404);
  assertEquals(malformed.rpcCalls.length, 0);
});

Deno.test("#4111 POST appends a guest message by hashed token", async () => {
  const h = harness({ issue_4111_guest_post_by_token: { status: "sent", message_id: "m3" } });
  const res = await h.handle(new Request("https://x.test/t", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: TOKEN, body: "  Thanks!  " }),
  }));
  assertEquals(res.status, 202);
  assertEquals(h.rpcCalls[0].args.p_token_hash, await sha256Hex(TOKEN));
  assertEquals(h.rpcCalls[0].args.p_body, "Thanks!");
});

Deno.test("#4111 'email me a new link' is always 202 and only emails a real owner", async () => {
  const owner = harness({
    issue_4111_reissue_link: {
      status: "issued",
      guest_email: "wale@example.com",
      guest_name: "Wale",
      brand_name: "Lantern Room",
    },
  });
  const res = await owner.handle(new Request("https://x.test/t", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "new_link", email: "Wale@example.com" }),
  }));
  assertEquals(res.status, 202);
  assertEquals(owner.rpcCalls[0].args.p_token_hash, await sha256Hex(NEW_TOKEN));
  assertEquals(owner.emails.length, 1);
  assertEquals((owner.emails[0].cta as { url: string }).url, `https://host.usemingla.com/m/${NEW_TOKEN}`);

  const stranger = harness({ issue_4111_reissue_link: { status: "none" } });
  const res2 = await stranger.handle(new Request("https://x.test/t", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "new_link", email: "nobody@example.com" }),
  }));
  assertEquals(res2.status, 202);
  assertEquals(await res2.json(), { status: "sent" });
  assertEquals(stranger.emails.length, 0);
});
