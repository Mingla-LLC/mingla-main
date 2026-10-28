/*
 * #2829 W5 (amendment A4) — CONTRACT TEST: what a site's contact form and
 * newsletter box send to Mingla's public enquiry and subscribe functions
 * (#4111), and what each answer means for the visitor.
 *
 * #4111 is not merged into this branch; these shapes are its documented
 * handler contracts (public-brand-enquiry/handler.ts and
 * public-brand-subscribe/handler.ts headers on 4111-brand-enquiries). This
 * suite pins them byte for byte so a drift on either side fails here. When
 * this branch is merged onto #4111, a Deno suite should feed these exact
 * bodies through the real handlers (follow-up recorded on #2829).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  checkContactInput,
  checkNewsletterEmail,
  checkSubmissionTiming,
  disclosureVersion,
  ENQUIRY_FUNCTION,
  enquiryRequestBody,
  formOutcome,
  FORM_MIN_FILL_MS,
  newsletterDisclosureText,
  subscribeRequestBody,
  SUBSCRIBE_FUNCTION,
} from "./generated/forms.ts";

const BRAND = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const SITE = "aaaaaaaa-bbbb-4ccc-8ddd-000000000002";

describe("#2829 W5 the requests a site sends", () => {
  it("names #4111's two public functions", () => {
    expect(ENQUIRY_FUNCTION).toBe("public-brand-enquiry");
    expect(SUBSCRIBE_FUNCTION).toBe("public-brand-subscribe");
  });

  it("sends a contact message exactly as #4111's site contact contract says", () => {
    const checked = checkContactInput(
      { name: "  Fixture   Person ", email: " Person@Example.COM ", phone: "+1 (555) 010-0100", message: "  Hello, is the spring trip open?  " },
      { phoneShown: true },
    );
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(enquiryRequestBody({ brandId: BRAND, siteId: SITE, renderedAt: 1_700_000_000_000, contact: checked.value })).toEqual({
      brand_id: BRAND,
      entry: "site",
      context_kind: "none",
      source: "site",
      reason: "website_contact",
      origin: SITE,
      name: "Fixture Person",
      email: "person@example.com",
      phone: "+15550100100",
      body: "Hello, is the spring trip open?",
      hp: "",
      t0: 1_700_000_000_000,
    });
  });

  it("leaves the phone out when the form does not ask for one", () => {
    const checked = checkContactInput({ name: "A", email: "a@b.co", phone: "+15550100100", message: "Ten letters!" }, { phoneShown: false });
    expect(checked.ok && enquiryRequestBody({ brandId: BRAND, siteId: SITE, renderedAt: 1, contact: checked.value })).not.toHaveProperty("phone");
  });

  it("sends a newsletter signup with the exact words the box showed", async () => {
    const block = { heading: "Join  the list", body: "One letter\na month.", button_label: "Subscribe", small_print: " Unsubscribe any time. " };
    const text = newsletterDisclosureText(block);
    expect(text).toBe("Join the list\nOne letter a month.\nSubscribe\nUnsubscribe any time.");
    const version = await disclosureVersion("newsletter", text);
    expect(version).toMatch(/^site-newsletter:[0-9a-f]{16}$/);
    expect(subscribeRequestBody({ brandId: BRAND, siteId: SITE, renderedAt: 42, email: "a@b.co", disclosureText: text, disclosureVersion: version })).toEqual({
      brand_id: BRAND,
      email: "a@b.co",
      hp: "",
      t0: 42,
      source: "site",
      origin: SITE,
      disclosure_text: text,
      disclosure_version: version,
    });
  });

  it("gives the same words the same version, and different words a different one", async () => {
    const a = await disclosureVersion("newsletter", "Join the list\nSubscribe");
    expect(await disclosureVersion("newsletter", "Join the list\nSubscribe")).toBe(a);
    expect(await disclosureVersion("newsletter", "Join the list\nSign up")).not.toBe(a);
    // The first 16 hex of sha256 of exactly those words.
    expect(a).toBe(`site-newsletter:${createHash("sha256").update("Join the list\nSubscribe").digest("hex").slice(0, 16)}`);
  });
});

describe("#2829 W5 checks the site makes before sending (so nothing is dropped silently)", () => {
  it("asks for what #4111 requires", () => {
    expect(checkContactInput({ name: "", email: "a@b.co", message: "Long enough message" }, { phoneShown: false })).toEqual({ ok: false, error: "missing" });
    expect(checkContactInput({ name: "A", email: "not-an-email", message: "Long enough message" }, { phoneShown: false })).toEqual({ ok: false, error: "email" });
    expect(checkContactInput({ name: "A", email: "a@b.co", message: "too short" }, { phoneShown: false })).toEqual({ ok: false, error: "short" });
    expect(checkContactInput({ name: "A", email: "a@b.co", message: "x".repeat(2001) }, { phoneShown: false })).toEqual({ ok: false, error: "toolong" });
    expect(checkContactInput({ name: "x".repeat(81), email: "a@b.co", message: "Long enough message" }, { phoneShown: false })).toEqual({ ok: false, error: "toolong" });
    expect(checkContactInput({ name: "A", email: "a@b.co", phone: "0555 0100", message: "Long enough message" }, { phoneShown: true })).toEqual({ ok: false, error: "phone" });
    expect(checkNewsletterEmail("")).toEqual({ ok: false, error: "missing" });
    expect(checkNewsletterEmail("a@b")).toEqual({ ok: false, error: "email" });
  });

  it("traps bots and refuses a form sent faster than #4111 accepts", () => {
    expect(checkSubmissionTiming({ honeypot: "http://spam", renderedAt: 0, now: 60_000 })).toBe("trap");
    expect(checkSubmissionTiming({ honeypot: "", renderedAt: 10_000, now: 10_000 + FORM_MIN_FILL_MS - 1 })).toBe("fast");
    expect(checkSubmissionTiming({ honeypot: "", renderedAt: 10_000, now: 10_000 + FORM_MIN_FILL_MS })).toBeNull();
    expect(checkSubmissionTiming({ honeypot: "", renderedAt: 10_000, now: 5_000 })).toBe("expired");
    expect(FORM_MIN_FILL_MS).toBe(3_000);
  });
});

describe("#2829 W5 what #4111's answers mean", () => {
  it("treats only 202 sent as success", () => {
    expect(formOutcome("contact", 202, { status: "sent", thread_url: "https://host.usemingla.com/m/x" })).toEqual({ ok: true });
    expect(formOutcome("newsletter", 202, { status: "sent" })).toEqual({ ok: true });
    expect(formOutcome("contact", 200, { status: "sent" })).toEqual({ ok: false, error: "server" });
    expect(formOutcome("contact", 202, {})).toEqual({ ok: false, error: "server" });
  });

  it("maps each refusal to its plain reason", () => {
    expect(formOutcome("contact", 400, { error: "invalid_input", field: "email" })).toEqual({ ok: false, error: "email" });
    expect(formOutcome("contact", 400, { error: "invalid_input", field: "phone" })).toEqual({ ok: false, error: "phone" });
    expect(formOutcome("contact", 400, { error: "invalid_input", field: "body" })).toEqual({ ok: false, error: "missing" });
    expect(formOutcome("contact", 400, { error: "invalid_input", field: "origin" })).toEqual({ ok: false, error: "server" });
    expect(formOutcome("contact", 404, { error: "enquiries_unavailable" })).toEqual({ ok: false, error: "unavailable" });
    expect(formOutcome("contact", 403, { error: "origin_not_allowed" })).toEqual({ ok: false, error: "server" });
    expect(formOutcome("newsletter", 400, { error: "invalid_input", field: "email" })).toEqual({ ok: false, error: "email" });
    expect(formOutcome("newsletter", 500, null)).toEqual({ ok: false, error: "server" });
  });
});
