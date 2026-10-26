// #4111 — independent tester adversarial proof for the three public edges
// (public-brand-enquiry, public-brand-subscribe, public-enquiry-thread).
//
// The implementor suites fake the clock and sleepFloor. This suite runs the
// REAL response floor and the real clock, and attacks what a scripted sender
// can see: every silent refusal must be byte-identical to a success and take
// at least 600 ms; malformed honeypots / timestamps / tokens never reach the
// database; anonymous senders can never attach a booking; hostile Origins are
// refused before any work; push providers only ever receive opaque ids.
//
// FAILS-ON-REVERT: making sleepFloor a no-op, letting a non-string honeypot
// through looksAutomated, or adding guest_name/body to the enquiry provider
// keys each fails a named test below.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createPublicBrandEnquiryHandler } from "../handler.ts";
import { createPublicBrandSubscribeHandler } from "../../public-brand-subscribe/handler.ts";
import { createPublicEnquiryThreadHandler } from "../../public-enquiry-thread/handler.ts";
import { looksAutomated, RESPONSE_FLOOR_MS, sleepFloor } from "../../_shared/brandEnquiry.ts";
import type { PublicEnquiryDeps } from "../../_shared/brandEnquiryRuntime.ts";
import { providerSafePayload } from "../../_shared/notifyV2.ts";
import { renderCategoryMessage } from "../../_shared/notifyTemplates.ts";

const BRAND = { id: "4111a000-0000-4000-a900-0000000000a1", name: "Adv Lantern", slug: "adv-lantern" };
const TOKEN = "Z".repeat(43);

interface Probe {
  deps: PublicEnquiryDeps;
  rpc: Array<{ name: string; args: Record<string, unknown> }>;
  emails: unknown[];
  sms: unknown[];
  logs: Array<{ level: string; event: string }>;
}

function probe(opts: {
  rpcData?: Record<string, unknown>;
  rpcError?: boolean;
  brand?: typeof BRAND | null;
  moderation?: { flagged: boolean; checked: boolean };
} = {}): Probe {
  const rpc: Probe["rpc"] = [];
  const emails: unknown[] = [];
  const sms: unknown[] = [];
  const logs: Probe["logs"] = [];
  const deps: PublicEnquiryDeps = {
    now: () => Date.now(),
    sleepFloor: (started) => sleepFloor(started),
    originDeps: {
      localStack: false,
      isActiveSiteHost: () => Promise.resolve(false),
      sitesEnvironment: () => Promise.resolve(null),
    },
    rpc: (name, args) => {
      rpc.push({ name, args });
      if (opts.rpcError) return Promise.resolve({ data: null, error: { message: "boom", code: "XX000" } });
      return Promise.resolve({ data: opts.rpcData ?? { status: "created" }, error: null });
    },
    resolveBrand: () => Promise.resolve(opts.brand === undefined ? BRAND : opts.brand),
    moderate: () =>
      Promise.resolve({
        flagged: opts.moderation?.flagged ?? false,
        categories: opts.moderation?.flagged ? ["spam"] : [],
        checked: opts.moderation?.checked ?? true,
      }),
    sendEmail: (m) => {
      emails.push(m);
      return Promise.resolve({ ok: true });
    },
    sendSms: (m) => {
      sms.push(m);
      return Promise.resolve({ ok: true });
    },
    makeToken: () => TOKEN,
    log: (level, event) => {
      logs.push({ level, event });
    },
  };
  return { deps, rpc, emails, sms, logs };
}

function post(path: string, body: unknown, origin: string | null = "https://host.usemingla.com"): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.7" };
  if (origin !== null) headers.Origin = origin;
  return new Request(`https://edge.test/functions/v1/${path}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function timed(handler: (req: Request) => Promise<Response>, req: Request) {
  const started = performance.now();
  const res = await handler(req);
  const text = await res.text();
  const headers = [...res.headers.entries()].sort(([a], [b]) => a.localeCompare(b));
  return { status: res.status, text, headers, ms: performance.now() - started };
}

const validSubscribe = (over: Record<string, unknown> = {}) => ({
  brand_id: BRAND.id,
  email: "someone@test.local",
  t0: Date.now() - 10_000,
  hp: "",
  ...over,
});

Deno.test("subscribe: account, new email, automated, rate limited, unknown brand and server error are indistinguishable and all wait ≥600 ms", async () => {
  const cases: Array<[string, Probe, Record<string, unknown>]> = [
    ["account email", probe({ rpcData: { status: "created", pending_id: "p1", send_sms: false } }), validSubscribe({ email: "has-account@test.local" })],
    ["new email", probe({ rpcData: { status: "created", pending_id: "p2", send_sms: false } }), validSubscribe({ email: "brand-new@test.local" })],
    ["honeypot", probe(), validSubscribe({ hp: "http://spam" })],
    ["too fast", probe(), validSubscribe({ t0: Date.now() - 100 })],
    ["rate limited", probe({ rpcData: { status: "rate_limited" } }), validSubscribe()],
    ["resend within 30s", probe({ rpcData: { status: "recent" } }), validSubscribe()],
    ["unknown brand", probe({ brand: null }), validSubscribe({ brand_id: crypto.randomUUID() })],
    ["database error", probe({ rpcError: true }), validSubscribe()],
  ];
  const seen = new Set<string>();
  for (const [label, p, body] of cases) {
    const handler = createPublicBrandSubscribeHandler(p.deps);
    const r = await timed(handler, post("public-brand-subscribe", body));
    assertEquals(r.status, 202, label);
    assertEquals(r.text, '{"status":"sent"}', label);
    assert(r.ms >= RESPONSE_FLOOR_MS - 5, `${label} answered in ${r.ms.toFixed(0)} ms`);
    seen.add(JSON.stringify(r.headers));
  }
  assertEquals(seen.size, 1, "response headers differ between outcomes");
});

Deno.test("subscribe: the text link is only requested when the server said the cap has room", async () => {
  const roomless = probe({ rpcData: { status: "created", pending_id: "p3", send_sms: false } });
  await createPublicBrandSubscribeHandler(roomless.deps)(
    post("public-brand-subscribe", validSubscribe({ phone: "+14155550100", wants_sms: true })),
  );
  assertEquals(roomless.sms.length, 0, "texted past the monthly cap");
  // wants_sms without a phone never asks for an SMS token.
  const nophone = probe({ rpcData: { status: "created", pending_id: "p4", send_sms: true } });
  await createPublicBrandSubscribeHandler(nophone.deps)(
    post("public-brand-subscribe", validSubscribe({ wants_sms: true })),
  );
  assertEquals(nophone.rpc[0].args.p_wants_sms, false);
  assertEquals(nophone.rpc[0].args.p_sms_token_hash, null);
  assertEquals(nophone.sms.length, 0);
});

const validEnquiry = (over: Record<string, unknown> = {}) => ({
  brand_id: BRAND.id,
  reason: "general_question",
  body: "Is the rooftop open on Sundays?",
  name: "Ada",
  email: "ada@test.local",
  t0: Date.now() - 10_000,
  hp: "",
  ...over,
});

Deno.test("enquiry: hostile honeypots and timestamps are silent, never reach the database, and look exactly like a send", async () => {
  const sent = probe({ rpcData: { status: "created", enquiry_id: "e1", topic_label: "General question" } });
  const ok = await timed(createPublicBrandEnquiryHandler(sent.deps), post("public-brand-enquiry", validEnquiry()));
  assertEquals(ok.status, 202);
  // Timestamps are computed when each request is sent (every answer waits
  // 600 ms, so a list built up front would age past the 3 s line).
  const hostile: Array<[string, () => Record<string, unknown>]> = [
    ["honeypot text", () => ({ hp: "x" })],
    ["honeypot whitespace-padded", () => ({ hp: "  x  " })],
    ["honeypot number", () => ({ hp: 0 })],
    ["honeypot array", () => ({ hp: [] })],
    ["honeypot object", () => ({ hp: {} })],
    ["honeypot boolean", () => ({ hp: false })],
    ["t0 missing", () => ({ t0: undefined })],
    ["t0 string junk", () => ({ t0: "soon" })],
    ["t0 zero", () => ({ t0: 0 })],
    ["t0 negative", () => ({ t0: -5 })],
    ["t0 in the future", () => ({ t0: Date.now() + 60_000 })],
    ["t0 2.9 s ago", () => ({ t0: Date.now() - 2_900 })],
  ];
  for (const [label, over] of hostile) {
    const p = probe();
    const r = await timed(createPublicBrandEnquiryHandler(p.deps), post("public-brand-enquiry", validEnquiry(over())));
    assertEquals(p.rpc.length, 0, `${label} reached the database`);
    assertEquals(p.emails.length, 0, `${label} sent an email`);
    assertEquals(r.status, ok.status, label);
    assertEquals(r.text, ok.text, `${label} body differs from a real send`);
    assertEquals(JSON.stringify(r.headers), JSON.stringify(ok.headers), label);
    assert(r.ms >= RESPONSE_FLOOR_MS - 5, `${label} answered in ${r.ms.toFixed(0)} ms`);
  }
});

Deno.test("enquiry: blocked / rate limited / database error are 202 with no email and the same shape", async () => {
  for (const status of ["blocked", "rate_limited"]) {
    const p = probe({ rpcData: { status } });
    const r = await timed(createPublicBrandEnquiryHandler(p.deps), post("public-brand-enquiry", validEnquiry()));
    assertEquals(r.status, 202, status);
    assert(/^\{"status":"sent","thread_url":"https:\/\/host\.usemingla\.com\/m\/[A-Za-z0-9_-]{43}"\}$/.test(r.text), r.text);
    assertEquals(p.emails.length, 0, `${status} emailed`);
    assert(r.ms >= RESPONSE_FLOOR_MS - 5);
  }
  const broken = probe({ rpcError: true });
  const r = await timed(createPublicBrandEnquiryHandler(broken.deps), post("public-brand-enquiry", validEnquiry()));
  assertEquals(r.status, 202);
  assertEquals(broken.emails.length, 0);
  assert(broken.logs.some((l) => l.level === "error"), "a database failure was not logged");
});

Deno.test("enquiry: an anonymous sender can never attach an order or booking, whatever the casing or shape", async () => {
  for (const kind of ["order", "rsvp", "reservation", "stay", "venue_order", "ORDER", " order", "Offering", ""]) {
    const p = probe();
    const r = await timed(
      createPublicBrandEnquiryHandler(p.deps),
      post("public-brand-enquiry", validEnquiry({ context_kind: kind, context_id: crypto.randomUUID() })),
    );
    if (kind === "") {
      // An empty kind is not "none": it is refused too.
      assertEquals(r.status, 400, "empty kind");
    } else {
      assertEquals(r.status, 400, kind);
    }
    assertEquals(p.rpc.length, 0, `${kind} reached the database`);
  }
  const bad = probe();
  const r = await timed(
    createPublicBrandEnquiryHandler(bad.deps),
    post("public-brand-enquiry", validEnquiry({ context_kind: "offering", context_id: "'; drop table brands;--" })),
  );
  assertEquals(r.status, 400);
  assertEquals(bad.rpc.length, 0);
});

Deno.test("enquiry: a moderation outage still delivers, unflagged, and is logged — never silently", async () => {
  const p = probe({ moderation: { flagged: false, checked: false }, rpcData: { status: "created", enquiry_id: "e2" } });
  await createPublicBrandEnquiryHandler(p.deps)(post("public-brand-enquiry", validEnquiry()));
  assertEquals(p.rpc.length, 1);
  assertEquals(p.rpc[0].args.p_spam_flag, false);
  assert(p.logs.some((l) => l.event.includes("moderation_unavailable")), "outage not logged");
  const flagged = probe({ moderation: { flagged: true, checked: true }, rpcData: { status: "created", enquiry_id: "e3" } });
  await createPublicBrandEnquiryHandler(flagged.deps)(post("public-brand-enquiry", validEnquiry()));
  assertEquals(flagged.rpc[0].args.p_spam_flag, true, "flagged text delivered unflagged");
});

Deno.test("every public edge refuses look-alike origins before doing any work", async () => {
  const hostile = [
    "https://host.usemingla.com.evil.example",
    "https://evil-host.usemingla.com",
    "http://host.usemingla.com",
    "https://mingla-business-x.vercel.app.evil.example",
    "https://host.usemingla.com/path",
    "null",
    "http://localhost:8081",
  ];
  for (const origin of hostile) {
    const e = probe();
    const s = probe();
    const t = probe();
    const r1 = await createPublicBrandEnquiryHandler(e.deps)(post("public-brand-enquiry", validEnquiry(), origin));
    const r2 = await createPublicBrandSubscribeHandler(s.deps)(post("public-brand-subscribe", validSubscribe(), origin));
    const r3 = await createPublicEnquiryThreadHandler(t.deps)(post("public-enquiry-thread", { token: TOKEN, body: "hi" }, origin));
    for (const [r, p, name] of [[r1, e, "enquiry"], [r2, s, "subscribe"], [r3, t, "thread"]] as const) {
      assertEquals(r.status, 403, `${name} accepted ${origin}`);
      assertEquals(r.headers.get("Access-Control-Allow-Origin"), null, `${name} echoed ${origin}`);
      assertEquals(p.rpc.length, 0, `${name} did work for ${origin}`);
      await r.body?.cancel();
    }
  }
});

Deno.test("thread: malformed tokens never reach the database; honeypot posts are silent; new-link answers never reveal ownership", async () => {
  for (const token of ["", "short", "A".repeat(39), "A".repeat(65), "A".repeat(42) + "+", "../../etc", "A".repeat(42) + "%"]) {
    const p = probe();
    const r = await createPublicEnquiryThreadHandler(p.deps)(
      new Request(`https://edge.test/functions/v1/public-enquiry-thread?token=${encodeURIComponent(token)}`, {
        headers: { Origin: "https://host.usemingla.com" },
      }),
    );
    assertEquals(r.status, 404, token);
    assertEquals(p.rpc.length, 0, `token ${JSON.stringify(token)} reached the database`);
    await r.body?.cancel();
  }
  const hp = probe({ rpcData: { status: "sent" } });
  const r = await createPublicEnquiryThreadHandler(hp.deps)(
    post("public-enquiry-thread", { token: TOKEN, body: "buy now", hp: "x" }),
  );
  assertEquals(r.status, 202);
  assertEquals(hp.rpc.length, 0, "honeypot post reached the database");
  await r.body?.cancel();

  const owner = probe({ rpcData: { status: "issued", guest_email: "a@test.local", brand_name: "B", guest_name: "A" } });
  const nobody = probe({ rpcData: { status: "none" } });
  const limited = probe({ rpcData: { status: "rate_limited" } });
  const answers = [];
  for (const p of [owner, nobody, limited]) {
    answers.push(await timed(
      createPublicEnquiryThreadHandler(p.deps),
      post("public-enquiry-thread", { action: "new_link", email: "a@test.local" }),
    ));
  }
  assertEquals(new Set(answers.map((a) => `${a.status}|${a.text}|${JSON.stringify(a.headers)}`)).size, 1);
  for (const a of answers) assert(a.ms >= RESPONSE_FLOOR_MS - 5, `new_link answered in ${a.ms.toFixed(0)} ms`);
  assertEquals(owner.emails.length, 1);
  assertEquals(nobody.emails.length + limited.emails.length, 0);
});

Deno.test("looksAutomated: exactly 3 s passes, 2.999 s does not", () => {
  const now = 1_900_000_000_000;
  assertEquals(looksAutomated("", now - 3_000, now), false);
  assertEquals(looksAutomated("", now - 2_999, now), true);
  assertEquals(looksAutomated(null, now - 3_000, now), false);
  assertEquals(looksAutomated(undefined, String(now - 5_000), now), false);
});

Deno.test("push providers only get opaque ids for enquiry notifications — never names, text, email or phone", () => {
  const payload = {
    enquiry_id: "e", conversation_id: "c", message_id: "m", brand_id: "b",
    guest_name: "Gia Adv", body: "my number is +14155550123", guest_email: "gia@test.local",
    guest_phone_e164: "+14155550123", topic_label: "Refund", brand_name: "Adv Lantern", sender_name: "Mina at Adv Lantern",
  };
  for (const category of [
    "business.brand_enquiry_new", "business.brand_enquiry_message",
    "business.brand_enquiry_nudge", "explorer.brand_enquiry_reply",
  ]) {
    const safe = providerSafePayload(category, payload);
    assertEquals(Object.keys(safe).sort(), ["brand_id", "conversation_id", "enquiry_id", "message_id"], category);
    const rendered = JSON.stringify(renderCategoryMessage(category, payload));
    assert(!rendered.includes("gia@test.local"), `${category} rendered the guest email`);
  }
});
