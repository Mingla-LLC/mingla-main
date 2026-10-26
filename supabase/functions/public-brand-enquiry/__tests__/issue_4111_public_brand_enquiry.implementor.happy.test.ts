// #4111 Wave A — public-brand-enquiry happy path + silent refusals.
// FAILS-ON-REVERT: removing the honeypot/min-fill check, the token hashing,
// or the origin allowlist makes the matching assertions below fail.

import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createPublicBrandEnquiryHandler } from "../handler.ts";
import { resolveAllowedOrigin, sha256Hex } from "../../_shared/brandEnquiry.ts";
import type { PublicEnquiryDeps } from "../../_shared/brandEnquiryRuntime.ts";

const BRAND = { id: "41110000-0000-4000-b900-0000000000a1", name: "Lantern Room", slug: "lantern" };
const NOW = 1_800_000_000_000;
const TOKEN = "A".repeat(43);

interface Harness {
  deps: PublicEnquiryDeps;
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  emails: Array<Record<string, unknown>>;
  floors: number[];
  logs: string[];
}

function harness(opts: {
  tokens?: string[];
  rpcStatus?: string;
  moderation?: { flagged: boolean; checked: boolean };
  siteHosts?: string[];
  sitesEnvironment?: string | null | "throw";
} = {}): Harness {
  const rpcCalls: Harness["rpcCalls"] = [];
  const emails: Harness["emails"] = [];
  const floors: number[] = [];
  const logs: string[] = [];
  const deps: PublicEnquiryDeps = {
    now: () => NOW,
    sleepFloor: (started) => {
      floors.push(started);
      return Promise.resolve();
    },
    originDeps: {
      localStack: false,
      isActiveSiteHost: (host) => Promise.resolve((opts.siteHosts ?? []).includes(host)),
      sitesEnvironment: () =>
        opts.sitesEnvironment === "throw"
          ? Promise.reject(new Error("column environment does not exist"))
          : Promise.resolve(opts.sitesEnvironment ?? null),
    },
    rpc: (name, args) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({
        data: { status: opts.rpcStatus ?? "created", enquiry_id: "e-1", topic_label: "General question" },
        error: null,
      });
    },
    resolveBrand: () => Promise.resolve(BRAND),
    moderate: () =>
      Promise.resolve({
        flagged: opts.moderation?.flagged ?? false,
        categories: opts.moderation?.flagged ? ["harassment"] : [],
        checked: opts.moderation?.checked ?? true,
      }),
    sendEmail: (message) => {
      emails.push(message as unknown as Record<string, unknown>);
      return Promise.resolve({ ok: true });
    },
    sendSms: () => Promise.reject(new Error("not used")),
    makeToken: (() => {
      const queue = [...(opts.tokens ?? [])];
      return () => queue.shift() ?? TOKEN;
    })(),
    log: (_level, event) => {
      logs.push(event);
    },
  };
  return { deps, rpcCalls, emails, floors, logs };
}

function request(body: Record<string, unknown>, origin: string | null = "https://host.usemingla.com"): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" };
  if (origin) headers.Origin = origin;
  return new Request("https://example.test/functions/v1/public-brand-enquiry", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const VALID = {
  brand_slug: "lantern",
  entry: "brand_page",
  context_kind: "none",
  reason: "general_question",
  body: "Do you take bookings for groups of ten?",
  name: "Wale",
  email: "Wale@Example.com",
  phone: "+1 (555) 555-0123",
  ok_to_call: true,
  hp: "",
  t0: NOW - 20_000,
};

Deno.test("#4111 valid enquiry creates rows with the hashed token and emails the /m/ link", async () => {
  const h = harness();
  const res = await createPublicBrandEnquiryHandler(h.deps)(request(VALID));
  assertEquals(res.status, 202);
  const body = await res.json();
  assertEquals(body, { status: "sent", thread_url: `https://host.usemingla.com/m/${TOKEN}` });
  assertEquals(res.headers.get("access-control-allow-origin"), "https://host.usemingla.com");
  assertEquals(h.floors, [NOW]);

  assertEquals(h.rpcCalls.length, 1);
  const call = h.rpcCalls[0];
  assertEquals(call.name, "issue_4111_create_web_enquiry");
  assertEquals(call.args.p_brand_id, BRAND.id);
  assertEquals(call.args.p_source, "web");
  assertEquals(call.args.p_email, "wale@example.com");
  assertEquals(call.args.p_phone, "+15555550123");
  assertEquals(call.args.p_ok_to_call, true);
  assertEquals(call.args.p_token_hash, await sha256Hex(TOKEN));
  assert(call.args.p_token_hash !== TOKEN, "raw token must never reach the database");
  assertMatch(String(call.args.p_ip_hash), /^[0-9a-f]{64}$/);
  assertEquals(call.args.p_spam_flag, false);
  assertMatch(String(call.args.p_disclosure_text), /Lantern Room will see your name and email/);

  assertEquals(h.emails.length, 1);
  assertEquals(h.emails[0].to, "wale@example.com");
  assertEquals((h.emails[0].cta as { url: string }).url, `https://host.usemingla.com/m/${TOKEN}`);
});

Deno.test("#4111 honeypot and too-fast submissions are silent 202 with no rows and no email", async () => {
  for (const variant of [{ hp: "http://spam" }, { t0: NOW - 1_000 }, { t0: undefined }]) {
    const h = harness();
    const res = await createPublicBrandEnquiryHandler(h.deps)(request({ ...VALID, ...variant }));
    assertEquals(res.status, 202);
    const body = await res.json();
    assertEquals(body.status, "sent");
    assertEquals(h.rpcCalls.length, 0);
    assertEquals(h.emails.length, 0);
    assertEquals(h.floors, [NOW]);
  }
});

Deno.test("#4111 rate limited and blocked senders get the same 202 and no email", async () => {
  for (const rpcStatus of ["rate_limited", "blocked"]) {
    const h = harness({ rpcStatus });
    const res = await createPublicBrandEnquiryHandler(h.deps)(request(VALID));
    assertEquals(res.status, 202);
    assertEquals(await res.json(), { status: "sent", thread_url: `https://host.usemingla.com/m/${TOKEN}` });
    assertEquals(h.emails.length, 0);
  }
});

Deno.test("#4111 anonymous callers cannot attach an order; a switched-off brand is 404", async () => {
  const h = harness();
  const order = await createPublicBrandEnquiryHandler(h.deps)(
    request({ ...VALID, context_kind: "order", context_id: "41110000-0000-4000-bf00-0000000000c1" }),
  );
  assertEquals(order.status, 400);
  assertEquals((await order.json()).field, "context");
  assertEquals(h.rpcCalls.length, 0);

  const off = await createPublicBrandEnquiryHandler(harness({ rpcStatus: "unavailable" }).deps)(request(VALID));
  assertEquals(off.status, 404);
});

Deno.test("#4111 flagged moderation still delivers, marked as possible spam; an outage is logged", async () => {
  const flagged = harness({ moderation: { flagged: true, checked: true } });
  await createPublicBrandEnquiryHandler(flagged.deps)(request(VALID));
  assertEquals(flagged.rpcCalls[0].args.p_spam_flag, true);
  assertEquals(flagged.rpcCalls[0].args.p_moderation_categories, ["harassment"]);

  const outage = harness({ moderation: { flagged: false, checked: false } });
  await createPublicBrandEnquiryHandler(outage.deps)(request(VALID));
  assert(outage.logs.includes("[public-brand-enquiry] moderation_unavailable"));
});

Deno.test("#4111 Mingla Sites contact form shape is accepted from an active Sites host", async () => {
  const h = harness({ siteHosts: ["gogi.sites.usemingla.com"] });
  const res = await createPublicBrandEnquiryHandler(h.deps)(request({
    brand_id: BRAND.id,
    entry: "site",
    context_kind: "none",
    source: "site",
    origin: "gogi.sites.usemingla.com",
    reason: "website_contact",
    body: "Do you host private birthday dinners?",
    name: "Sita",
    email: "sita@example.com",
    disclosure_text: "Shown on the site form",
    disclosure_version: "site-v1",
    t0: NOW - 10_000,
  }, "https://gogi.sites.usemingla.com"));
  assertEquals(res.status, 202);
  assertEquals(res.headers.get("access-control-allow-origin"), "https://gogi.sites.usemingla.com");
  const args = h.rpcCalls[0].args;
  assertEquals([args.p_source, args.p_origin, args.p_entry, args.p_context_kind], [
    "site", "gogi.sites.usemingla.com", "site", "none",
  ]);
  assertEquals(args.p_disclosure_text, "Shown on the site form");
});

Deno.test("#4111 an unknown browser origin is refused before any work", async () => {
  const h = harness();
  const res = await createPublicBrandEnquiryHandler(h.deps)(request(VALID, "https://evil.example"));
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("access-control-allow-origin"), null);
  assertEquals(h.rpcCalls.length, 0);
});

Deno.test("#4111 *.sites.localhost is denied unless the Sites config says environment=local", async () => {
  const origin = "http://gogi.sites.localhost:3001";
  // Column not there yet (the lookup errors) → deny.
  const missing = await resolveAllowedOrigin(origin, harness({ sitesEnvironment: "throw" }).deps.originDeps);
  assertEquals(missing.allowed, false);
  // Column present but production → deny.
  const prod = await resolveAllowedOrigin(origin, harness({ sitesEnvironment: "production" }).deps.originDeps);
  assertEquals(prod.allowed, false);
  // Request is refused end to end.
  const h = harness({ sitesEnvironment: null });
  const res = await createPublicBrandEnquiryHandler(h.deps)(request(VALID, origin));
  assertEquals(res.status, 403);
  assertEquals(h.rpcCalls.length, 0);
  // Only an explicit local environment opens it.
  const local = await resolveAllowedOrigin(origin, harness({ sitesEnvironment: "local" }).deps.originDeps);
  assertEquals(local, { allowed: true, origin, kind: "local_site" });
});

Deno.test("#4111 P1-2 the browser gets its own token; only the emailed token is stored as the confirming one", async () => {
  const EMAILED = "E".repeat(43);
  const BROWSER = "B".repeat(43);
  const h = harness({ tokens: [EMAILED, BROWSER] });
  const res = await createPublicBrandEnquiryHandler(h.deps)(request(VALID));
  assertEquals(res.status, 202);
  // The sending browser can open the thread at once, with the browser token…
  assertEquals(await res.json(), { status: "sent", thread_url: `https://host.usemingla.com/m/${BROWSER}` });
  // …while the receipt email carries the emailed token, and only that one.
  assertEquals((h.emails[0].cta as { url: string }).url, `https://host.usemingla.com/m/${EMAILED}`);
  assertEquals(JSON.stringify(h.emails[0]).includes(BROWSER), false);
  // The database learns which is which (and never a raw token).
  assertEquals(h.rpcCalls.length, 1);
  assertEquals(h.rpcCalls[0].args.p_token_hash, await sha256Hex(EMAILED));
  assertEquals(h.rpcCalls[0].args.p_browser_token_hash, await sha256Hex(BROWSER));
});
