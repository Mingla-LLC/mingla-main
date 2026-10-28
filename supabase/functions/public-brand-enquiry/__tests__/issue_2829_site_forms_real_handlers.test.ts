// #2829 (A10/A16 merge-onto #4111) — the EXACT request bodies a Mingla Sites
// contact form and newsletter box send (built by the shared site contract,
// _shared/siteContracts/forms.ts, which the runtime uses) go through #4111's
// REAL public-brand-enquiry and public-brand-subscribe handlers, and the
// site's outcome mapping reads the real answers correctly. The runtime
// forwards server-side, so the request carries no Origin header.
// FAILS-ON-REVERT: changing a site body field (entry/source/origin/reason,
// disclosure) or the outcome mapping makes the matching assertion fail.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createPublicBrandEnquiryHandler } from "../handler.ts";
import { createPublicBrandSubscribeHandler } from "../../public-brand-subscribe/handler.ts";
import type { PublicEnquiryDeps } from "../../_shared/brandEnquiryRuntime.ts";
import {
  disclosureVersion,
  enquiryRequestBody,
  formOutcome,
  newsletterDisclosureText,
  subscribeRequestBody,
} from "../../_shared/siteContracts/forms.ts";

const NOW = 1_800_000_000_000;
const BRAND = { id: "28290000-0000-4000-8000-0000000000b1", name: "Young & Stamped", slug: "youngandstamped" };
const SITE = "28290000-0000-4000-8000-0000000000c1";

function harness(rpcData: Record<string, unknown>, brand: typeof BRAND | null = BRAND) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let n = 0;
  const deps: PublicEnquiryDeps = {
    now: () => NOW,
    sleepFloor: () => Promise.resolve(),
    originDeps: {
      localStack: false,
      isActiveSiteHost: () => Promise.resolve(false),
      sitesEnvironment: () => Promise.resolve(null),
    },
    rpc: (name, args) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: rpcData, error: null });
    },
    resolveBrand: () => Promise.resolve(brand),
    moderate: () => Promise.resolve({ flagged: false, categories: [], checked: true }),
    sendEmail: () => Promise.resolve({ ok: true }),
    sendSms: () => Promise.resolve({ ok: true }),
    makeToken: () => `${n++}`.padStart(43, "T"),
    log: () => {},
  };
  return { deps, rpcCalls };
}

// What the runtime's forwardToMingla sends: JSON + the visitor address, no Origin.
function serverPost(fn: string, body: Record<string, unknown>): Request {
  return new Request(`http://127.0.0.1:55321/functions/v1/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify(body),
  });
}

const contact = { name: "Ada", email: "Ada@Example.com", phone: "+15555550123", message: "Is the Bali trip still open?" };

Deno.test("#2829 a site contact form's body is accepted by the real enquiry handler as a site enquiry", async () => {
  const h = harness({ status: "created", enquiry_id: "e-1", topic_label: "Website" });
  const body = enquiryRequestBody({ brandId: BRAND.id, siteId: SITE, renderedAt: NOW - 20_000, contact });
  const res = await createPublicBrandEnquiryHandler(h.deps)(serverPost("public-brand-enquiry", body));
  const answer = await res.json();
  assertEquals(res.status, 202);
  assertEquals(formOutcome("contact", res.status, answer), { ok: true });
  assertEquals(h.rpcCalls.length, 1);
  const args = h.rpcCalls[0].args;
  assertEquals(h.rpcCalls[0].name, "issue_4111_create_web_enquiry");
  assertEquals(args.p_brand_id, BRAND.id);
  assertEquals(args.p_source, "site");
  assertEquals(args.p_origin, SITE);
  assertEquals(args.p_entry, "site");
  assertEquals(args.p_context_kind, "none");
  assertEquals(args.p_reason, "website_contact");
  assertEquals(args.p_name, "Ada");
  assertEquals(args.p_email, "ada@example.com");
  assertEquals(args.p_phone, "+15555550123");
  assertEquals(args.p_body, contact.message);
});

Deno.test("#2829 the site reads the real enquiry handler's refusals correctly", async () => {
  const bad = enquiryRequestBody({ brandId: BRAND.id, siteId: SITE, renderedAt: NOW - 20_000, contact: { ...contact, email: "nope" } });
  let res = await createPublicBrandEnquiryHandler(harness({}).deps)(serverPost("public-brand-enquiry", bad));
  assertEquals(formOutcome("contact", res.status, await res.json()), { ok: false, error: "email" });

  const off = harness({ status: "unavailable" });
  const ok = enquiryRequestBody({ brandId: BRAND.id, siteId: SITE, renderedAt: NOW - 20_000, contact });
  res = await createPublicBrandEnquiryHandler(off.deps)(serverPost("public-brand-enquiry", ok));
  assertEquals(res.status, 404);
  assertEquals(formOutcome("contact", res.status, await res.json()), { ok: false, error: "unavailable" });

  // A too-fast submission is dropped silently by #4111 (202, no rows): the
  // site refuses < 3 s itself before forwarding (FORM_MIN_FILL_MS), so this
  // path is never shown to a visitor as sent without being sent.
  const fast = harness({ status: "created" });
  res = await createPublicBrandEnquiryHandler(fast.deps)(
    serverPost("public-brand-enquiry", enquiryRequestBody({ brandId: BRAND.id, siteId: SITE, renderedAt: NOW - 1_000, contact })),
  );
  assertEquals(res.status, 202);
  assertEquals(fast.rpcCalls.length, 0);
});

Deno.test("#2829 a site newsletter box's body is accepted by the real subscribe handler with the exact disclosure", async () => {
  const h = harness({ status: "created", pending_id: "p-1", send_sms: false });
  const text = newsletterDisclosureText({ heading: "Join the list", body: "One letter a month.", button_label: "Subscribe", small_print: "Unsubscribe any time." });
  const version = await disclosureVersion("newsletter", text);
  const body = subscribeRequestBody({
    brandId: BRAND.id, siteId: SITE, renderedAt: NOW - 20_000, email: "Reader@Example.com",
    disclosureText: text, disclosureVersion: version,
  });
  const res = await createPublicBrandSubscribeHandler(h.deps)(serverPost("public-brand-subscribe", body));
  assertEquals(res.status, 202);
  assertEquals(formOutcome("newsletter", res.status, await res.json()), { ok: true });
  assertEquals(h.rpcCalls.length, 1);
  const args = h.rpcCalls[0].args;
  assertEquals(h.rpcCalls[0].name, "issue_4111_create_subscribe_pending");
  assertEquals(args.p_brand_id, BRAND.id);
  assertEquals(args.p_source, "site");
  assertEquals(args.p_origin, SITE);
  assertEquals(args.p_email, "reader@example.com");
  assertEquals(args.p_disclosure_text, text);
  assertEquals(args.p_disclosure_version, version);
});
