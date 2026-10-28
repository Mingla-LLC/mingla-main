/*
 * #2829 W5 (SC-21, A4, T-W5) — the site's send route for its contact form and
 * newsletter box.
 *
 *  - a JSON send and a plain HTML (no-JavaScript) send reach Mingla's public
 *    function with exactly the #4111 body, the brand and site from the
 *    publication Core resolved for the host, and the visitor's address;
 *  - newsletter consent text is the block's own rendered words;
 *  - no-JS answers 303 back to the same page of this site with the outcome;
 *  - the honeypot, a too-fast send, a forged or stale stamp, a sixth send from
 *    one address and an over-limit email are refused visibly and never sent;
 *  - "not taking messages" (Mingla's switch or its 404) says so; a network
 *    failure or a refusal is never shown as sent;
 *  - the site, brand and form never come from the request.
 */
// MINGLA-INVARIANT: I-PROPOSED-2829-09 | issue #2829 | Site forms send to the brand's Mingla contacts and enquiries (#4111) with the exact consent words the visitor saw; marketing permission only on explicit signup; nothing is shown as sent unless Mingla accepted it.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({ runtimeConfig: () => ({ runtimeHmac: Buffer.alloc(32, 9).toString("base64"), formsFunctionsBaseUrl: "http://127.0.0.1:1" }) }));

import { w5Artifact } from "../contracts/w5Content.fixture";
import { disclosureVersion, newsletterDisclosureText } from "../contracts/generated/forms.ts";
import { clearFormRateLimits, handleFormSubmission, type FormSubmissionDeps } from "./formSubmission";
import { formStampSignature } from "./siteForms";
import type { ResolvedSite } from "./publication";

const artifact = w5Artifact();
const site = { site_id: artifact.site_id } as unknown as ResolvedSite;
const load = async () => ({ artifact, resolution: site });
const RENDERED = 1_760_000_000_000;
const NOW = RENDERED + 10_000;

type Sent = { fn: string; body: Record<string, unknown>; address: string | null };

function deps(reply: { status: number; body: unknown } | Error = { status: 202, body: { status: "sent" } }, extra: Partial<FormSubmissionDeps> = {}) {
  const sent: Sent[] = [];
  const value: FormSubmissionDeps = {
    now: () => NOW,
    forward: async (fn, body, address) => {
      sent.push({ fn, body, address });
      if (reply instanceof Error) throw reply;
      return reply;
    },
    availability: async () => "available",
    ...extra,
  };
  return { sent, value };
}

async function fields(patch: Record<string, string> = {}, block = "0") {
  return {
    page: "contact-us",
    block,
    t0: String(RENDERED),
    ts: await formStampSignature(artifact.site_id, RENDERED),
    website: "",
    name: "Fixture Person",
    email: "person@example.com",
    message: "Is the spring trip open?",
    ...patch,
  };
}

function jsonRequest(kind: string, body: Record<string, string>, address = "203.0.113.7") {
  return new Request(`http://brand.sites.localhost/api/forms/${kind}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "x-forwarded-for": `${address}, 10.0.0.1` },
    body: JSON.stringify(body),
  });
}

function formRequest(kind: string, body: Record<string, string>, address = "203.0.113.8") {
  return new Request(`http://brand.sites.localhost/api/forms/${kind}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": address },
    body: new URLSearchParams(body).toString(),
  });
}

beforeEach(() => clearFormRateLimits());

describe("#2829 W5 a contact message reaches Mingla", () => {
  it("sends the exact #4111 enquiry body (JavaScript) and says thank you", async () => {
    const { sent, value } = deps();
    const response = await handleFormSubmission("contact", jsonRequest("contact", await fields({ phone: "+1 555 010 0100" })), load, value);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, kind: "contact", message: `Thanks, your message is with ${artifact.brand.display_name}.` });
    expect(sent).toEqual([{
      fn: "public-brand-enquiry",
      address: "203.0.113.7",
      body: {
        brand_id: artifact.brand_id,
        entry: "site",
        context_kind: "none",
        source: "site",
        reason: "website_contact",
        origin: artifact.site_id,
        name: "Fixture Person",
        email: "person@example.com",
        phone: "+15550100100",
        body: "Is the spring trip open?",
        hp: "",
        t0: RENDERED,
      },
    }]);
  });

  it("works without JavaScript: a 303 back to the same form with the outcome", async () => {
    const { sent, value } = deps();
    const response = await handleFormSubmission("contact", formRequest("contact", await fields()), load, value);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/contact-us?sent=contact&form=0#form-0");
    expect(sent).toHaveLength(1);
    const refused = await handleFormSubmission("contact", formRequest("contact", await fields({ email: "nope" })), load, value);
    expect(refused.headers.get("location")).toBe("/contact-us?formError=email&formKind=contact&form=0#form-0");
  });
});

describe("#2829 W5 a newsletter signup records what the visitor saw", () => {
  it("sends the block's own words and their version", async () => {
    const { sent, value } = deps();
    const response = await handleFormSubmission("newsletter", jsonRequest("newsletter", await fields({ email: "Reader@Example.com" }, "1")), load, value);
    expect(response.status).toBe(200);
    expect((await response.json()).message).toBe("Check your inbox to confirm your subscription.");
    const block = artifact.pages.find((page) => page.path === "contact-us")!.blocks[1]! as Record<string, unknown>;
    const text = newsletterDisclosureText(block);
    expect(text).toBe("Join the list\nOne letter a month.\nSubscribe\nUnsubscribe any time.");
    expect(sent[0]).toEqual({
      fn: "public-brand-subscribe",
      address: "203.0.113.7",
      body: {
        brand_id: artifact.brand_id,
        email: "reader@example.com",
        hp: "",
        t0: RENDERED,
        source: "site",
        origin: artifact.site_id,
        disclosure_text: text,
        disclosure_version: await disclosureVersion("newsletter", text),
      },
    });
  });
});

describe("#2829 W5 nothing is dropped silently", () => {
  it("refuses the honeypot, a too-fast send and a forged or stale stamp without sending", async () => {
    const { sent, value } = deps();
    const trap = await handleFormSubmission("contact", jsonRequest("contact", await fields({ website: "http://spam.example" })), load, value);
    expect(trap.status).toBe(400);
    expect((await trap.json()).error).toBe("trap");
    const fast = await handleFormSubmission("contact", jsonRequest("contact", await fields()), load, { ...value, now: () => RENDERED + 1_000 });
    expect((await fast.json()).error).toBe("fast");
    const forged = await handleFormSubmission("contact", jsonRequest("contact", await fields({ ts: "forged" })), load, value);
    expect((await forged.json()).error).toBe("expired");
    const otherSite = await formStampSignature("aaaaaaaa-bbbb-4ccc-8ddd-000000000777", RENDERED);
    const replayed = await handleFormSubmission("contact", jsonRequest("contact", await fields({ ts: otherSite })), load, value);
    expect((await replayed.json()).error).toBe("expired");
    const stale = await handleFormSubmission("contact", jsonRequest("contact", await fields()), load, { ...value, now: () => RENDERED + 25 * 3600_000 });
    expect((await stale.json()).error).toBe("expired");
    expect(sent).toHaveLength(0);
  });

  it("limits sends per visitor address and per email, as Mingla does", async () => {
    const { sent, value } = deps();
    for (let i = 0; i < 3; i += 1) {
      const ok = await handleFormSubmission("contact", jsonRequest("contact", await fields()), load, value);
      expect(ok.status).toBe(200);
    }
    const fourthSameEmail = await handleFormSubmission("contact", jsonRequest("contact", await fields()), load, value);
    expect((await fourthSameEmail.json()).error).toBe("rate");
    for (let i = 0; i < 2; i += 1) {
      await handleFormSubmission("contact", jsonRequest("contact", await fields({ email: `other${i}@example.com` })), load, value);
    }
    const sixth = await handleFormSubmission("contact", jsonRequest("contact", await fields({ email: "sixth@example.com" })), load, value);
    expect(sixth.status).toBe(429);
    expect((await sixth.json()).error).toBe("rate");
    expect(sent).toHaveLength(5);
    // Another visitor is unaffected.
    const other = await handleFormSubmission("contact", jsonRequest("contact", await fields({ email: "new@example.com" }), "198.51.100.9"), load, value);
    expect(other.status).toBe(200);
  });

  it("says plainly when the brand takes no messages", async () => {
    const off = deps(undefined, { availability: async () => "unavailable" });
    const response = await handleFormSubmission("contact", jsonRequest("contact", await fields()), load, off.value);
    expect(response.status).toBe(409);
    expect((await response.json()).message).toBe("Messages can't be sent from this website right now. Please email hello@fixture.invalid.");
    expect(off.sent).toHaveLength(0);
    const mingla404 = deps({ status: 404, body: { error: "enquiries_unavailable" } });
    expect((await (await handleFormSubmission("contact", jsonRequest("contact", await fields()), load, mingla404.value)).json()).error).toBe("unavailable");
  });

  it("never shows a failure as sent", async () => {
    for (const reply of [new Error("network"), { status: 500, body: null }, { status: 403, body: { error: "origin_not_allowed" } }, { status: 200, body: { status: "sent" } }]) {
      clearFormRateLimits();
      const { value } = deps(reply);
      const response = await handleFormSubmission("contact", jsonRequest("contact", await fields()), load, value);
      const body = await response.json();
      expect(body.ok).toBe(false);
      expect(body.error).toBe("server");
    }
  });
});

describe("#2829 W5 the site, brand and form come from the publication", () => {
  it("refuses a form that is not on the posted page, or a publication of another site", async () => {
    const { sent, value } = deps();
    const wrongBlock = await handleFormSubmission("contact", jsonRequest("contact", await fields({}, "1")), load, value);
    expect((await wrongBlock.json()).error).toBe("server");
    const noPage = await handleFormSubmission("contact", jsonRequest("contact", await fields({ page: "../../admin" })), load, value);
    expect((await noPage.json()).error).toBe("server");
    const foreign = async () => ({ artifact, resolution: { site_id: "aaaaaaaa-bbbb-4ccc-8ddd-000000000777" } as unknown as ResolvedSite });
    const crossSite = await handleFormSubmission("contact", jsonRequest("contact", await fields()), foreign, value);
    expect((await crossSite.json()).error).toBe("server");
    // A posted brand or origin is ignored: the body is built from the publication.
    await handleFormSubmission("contact", jsonRequest("contact", await fields({ brand_id: "evil", origin: "evil" })), load, value);
    expect(sent.at(-1)?.body.brand_id).toBe(artifact.brand_id);
    expect(sent.at(-1)?.body.origin).toBe(artifact.site_id);
    // A no-JS failure that cannot find the page goes home, never to a posted address.
    const lost = await handleFormSubmission("contact", formRequest("contact", await fields({ page: "https://evil.example" })), load, value);
    expect(lost.headers.get("location")).toBe("/?formError=server&formKind=contact");
  });
});
