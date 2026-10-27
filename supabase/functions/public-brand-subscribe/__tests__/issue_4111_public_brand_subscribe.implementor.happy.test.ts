// #4111 Wave A — public-brand-subscribe: identical answers for an account
// email and a new email; double opt-in email and (cap permitting) SMS link.
// FAILS-ON-REVERT: making the response depend on the account lookup, or
// sending the SMS without the server's cap decision, fails these checks.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createPublicBrandSubscribeHandler } from "../handler.ts";
import { sha256Hex } from "../../_shared/brandEnquiry.ts";
import type { PublicEnquiryDeps } from "../../_shared/brandEnquiryRuntime.ts";

const NOW = 1_800_000_000_000;

function harness(rpcResult: Record<string, unknown>) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const emails: Array<Record<string, unknown>> = [];
  const texts: Array<Record<string, unknown>> = [];
  const floors: number[] = [];
  let n = 0;
  const deps: PublicEnquiryDeps = {
    now: () => NOW,
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
      return Promise.resolve({ data: rpcResult, error: null });
    },
    resolveBrand: () => Promise.resolve({ id: "41110000-0000-4000-b900-0000000000a1", name: "Lantern Room", slug: "lantern" }),
    moderate: () => Promise.reject(new Error("unused")),
    sendEmail: (m) => {
      emails.push(m as unknown as Record<string, unknown>);
      return Promise.resolve({ ok: true });
    },
    sendSms: (m) => {
      texts.push(m as unknown as Record<string, unknown>);
      return Promise.resolve({ ok: true });
    },
    makeToken: () => `${n++}`.padStart(43, "T"),
    log: () => {},
  };
  return { handle: createPublicBrandSubscribeHandler(deps), rpcCalls, emails, texts, floors };
}

function post(body: Record<string, unknown>): Request {
  return new Request("https://x.test/public-brand-subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://host.usemingla.com" },
    body: JSON.stringify({ brand_slug: "lantern", hp: "", t0: NOW - 15_000, ...body }),
  });
}

Deno.test("#4111 an account email and a new email get byte-identical answers", async () => {
  const account = harness({ status: "created", pending_id: "p1", send_sms: false });
  const fresh = harness({ status: "created", pending_id: "p2", send_sms: false });
  const a = await account.handle(post({ email: "member@example.com" }));
  const b = await fresh.handle(post({ email: "new@example.com" }));
  assertEquals([a.status, b.status], [202, 202]);
  assertEquals(await a.text(), await b.text());
  assertEquals([account.floors, fresh.floors], [[NOW], [NOW]]);
  // The edge never looks the account up itself: that happens at confirm.
  assert(account.rpcCalls.every((c) => c.name === "issue_4111_create_subscribe_pending"));
  assertEquals(account.emails.length, 1);
  assertEquals(account.rpcCalls[0].args.p_email_token_hash, await sha256Hex("0".padStart(43, "T")));
  assert(String((account.emails[0].cta as { url: string }).url).endsWith("0".padStart(43, "T")));
});

Deno.test("#4111 the text link is sent only when the server says the SMS cap has room", async () => {
  const room = harness({ status: "created", pending_id: "p3", send_sms: true });
  await room.handle(post({ email: "x@example.com", phone: "+15555550199", wants_sms: true }));
  assertEquals(room.texts.length, 1);
  // The text goes through the dispatcher with its own idempotency key and the
  // confirm link carrying the SMS token (never the email token).
  assertEquals(room.texts[0].idempotencyKey, "brand_subscribe_confirm_sms:p3");
  assert(String(room.texts[0].confirmUrl).endsWith("1".padStart(43, "T")));
  assertEquals(room.rpcCalls[0].args.p_wants_sms, true);
  assertEquals(room.rpcCalls[0].args.p_sms_token_hash, await sha256Hex("1".padStart(43, "T")));

  const full = harness({ status: "created", pending_id: "p4", send_sms: false });
  await full.handle(post({ email: "x@example.com", phone: "+15555550199", wants_sms: true }));
  assertEquals(full.texts.length, 0);
  assertEquals(full.emails.length, 1);

  const noPhone = harness({ status: "created", pending_id: "p5", send_sms: false });
  await noPhone.handle(post({ email: "x@example.com", wants_sms: true }));
  assertEquals(noPhone.rpcCalls[0].args.p_wants_sms, false);
});

Deno.test("#4111 honeypot, rate limit and recent duplicates are silent 202s", async () => {
  const bot = harness({ status: "created" });
  const r1 = await bot.handle(post({ email: "x@example.com", hp: "filled" }));
  assertEquals(r1.status, 202);
  assertEquals(bot.rpcCalls.length, 0);
  for (const status of ["rate_limited", "recent", "unavailable"]) {
    const h = harness({ status });
    const res = await h.handle(post({ email: "x@example.com" }));
    assertEquals(res.status, 202);
    assertEquals(await res.json(), { status: "sent" });
    assertEquals(h.emails.length, 0);
  }
  const bad = harness({ status: "created" });
  assertEquals((await bad.handle(post({ email: "not-an-email" }))).status, 400);
});
